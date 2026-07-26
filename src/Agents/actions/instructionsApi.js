// Mutation utilities for the instruction registry (req #3049).
// Peer to Features/actions/validationApi.js: all mutations go through
// call_rest_api; callers own TanStack Query invalidation.
//
// REST contracts that shape this file — all verified against the live API, not
// assumed:
//
// - `instructions` is in Lambda-Rest CREATOR_FK_TABLES, so POST overwrites any
//   client-supplied creator_fk with the authenticated Cognito sub, and PUT /
//   DELETE are scoped to it. We still send creator_fk on create: it is NOT NULL
//   with an FK to profiles, and being explicit costs nothing.
//
// - `agent_instructions` has a composite PK and NO `id` column. Two consequences:
//     * PUT is impossible (rest_put.py requires `id`) — a load-order change is a
//       DELETE + re-POST, never an update.
//     * Every junction insert here sends an ARRAY body, routing to
//       _rest_post_bulk: one multi-value INSERT, no read-back, 201
//       {"inserted": N}. That started as a workaround — a single-object POST
//       used to commit the row and then return 500, because rest_post.py's
//       `WHERE id = ...` read-back raised 1054 on an id-less table after the
//       INSERT had already committed. Req #3057 fixed that (single-object POST
//       now returns 201 with no body), so the array body is no longer forced.
//       It stays because it is still one round trip for N links instead of N.
//
// - A duplicate name or link is an HTTP 409 (req #3059) carrying a structured
//   `{error, errno, constraint, table, message}` body. call_rest_api splits it:
//   `httpStatus.httpDetail` holds the object (agentRegistryUtils.restErrorMessage
//   reads it), `httpStatus.httpMessage` stays the string assertOk interpolates.
//
// - call_rest_api THROWS on any status outside 200/201/204 — including 404. A
//   DELETE that matched nothing throws, so the 404-tolerant paths catch it
//   explicitly rather than testing the returned status.

import call_rest_api from '../../RestApi/RestApi';

const isOk = (status) => status === 200 || status === 201 || status === 204;

/**
 * Deliberately duplicated from validationApi rather than imported: that module
 * is Features-scoped, and coupling two unrelated registries through a ten-line
 * helper is worse than the duplication. validationApi is itself self-contained.
 *
 * The thrown error CARRIES `httpStatus`. call_rest_api rejects with a bare
 * `{data, httpStatus}` object for any non-2xx, but it RETURNS (does not throw) a
 * synthetic 503 when `fetch` itself rejects — so this is the one path that
 * produces an error of a different shape. Every consumer downstream reads
 * `err.httpStatus.httpStatus`: `isNotFound`, `restErrorMessage`, and
 * `useSnackBarStore.showError`. An error without it would make all three
 * misbehave, and showError would throw a TypeError from inside a catch block —
 * killing the resync that catch block exists to perform.
 */
function assertOk(result, action) {
    const status = result?.httpStatus?.httpStatus;
    if (!isOk(status)) {
        const httpStatus = result?.httpStatus
            || { httpStatus: 0, httpMessage: 'unknown' };
        const msg = httpStatus.httpMessage || 'unknown';
        throw Object.assign(
            new Error(`${action} failed: HTTP ${status} ${msg}`), { httpStatus });
    }
    return result.data;
}

const isNotFound = (err) => err?.httpStatus?.httpStatus === 404;

// ----- instructions -----

export async function createInstruction(darwinUri, idToken,
    { name, content, closed = 0, creator_fk }) {
    // No sort_order — migration 072 dropped the catalog-order column.
    const r = await call_rest_api(`${darwinUri}/instructions`, 'POST',
        { name, content, closed, creator_fk }, idToken);
    return assertOk(r, 'createInstruction');
}

export async function updateInstruction(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/instructions`, 'PUT',
        [{ id, ...fields }], idToken);
    return assertOk(r, 'updateInstruction');
}

/**
 * Hard delete. `agent_instructions` CASCADEs on both FKs, so this silently
 * strips the instruction from every agent that bound it — callers must have
 * shown the blast radius first. Closing (`{ closed: 1 }`) is the retire path.
 */
export async function deleteInstruction(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/instructions`, 'DELETE',
        { id }, idToken);
    return assertOk(r, 'deleteInstruction');
}

// ----- agent_instructions (junction — array-body POST, composite-key DELETE) -----

/** Bind one instruction to one agent at a given load-order slot. */
export async function linkAgentInstruction(darwinUri, idToken,
    agent_fk, instruction_fk, sort_order = null) {
    return linkAgentInstructions(darwinUri, idToken,
        [{ agent_fk, instruction_fk, sort_order }]);
}

/**
 * Bind several links in ONE round trip. Array body → _rest_post_bulk, which is
 * the only POST path that works on a table with no `id` column.
 *
 * Every item must carry the same keys — _rest_post_bulk builds one multi-value
 * INSERT from the FIRST item's key list, so a row missing `sort_order` would
 * silently take its neighbour's value. Normalize before sending.
 */
export async function linkAgentInstructions(darwinUri, idToken, rows) {
    if (!rows.length) return null;
    const body = rows.map(({ agent_fk, instruction_fk, sort_order = null }) =>
        ({ agent_fk, instruction_fk, sort_order }));
    const r = await call_rest_api(`${darwinUri}/agent_instructions`, 'POST',
        body, idToken);
    return assertOk(r, 'linkAgentInstructions');
}

/**
 * Unbind one instruction from one agent. Tolerates an already-absent link.
 * Returns true when a row was actually removed, false when it was already gone —
 * the reorder path needs that distinction to know what it must restore.
 */
export async function unlinkAgentInstruction(darwinUri, idToken,
    agent_fk, instruction_fk) {
    try {
        const r = await call_rest_api(`${darwinUri}/agent_instructions`, 'DELETE',
            { agent_fk, instruction_fk }, idToken);
        assertOk(r, 'unlinkAgentInstruction');
        return true;
    } catch (err) {
        if (isNotFound(err)) return false;  // already gone — the desired end state
        throw err;
    }
}

const linkKey = (r) => `${r.agent_fk}:${r.instruction_fk}`;

/**
 * Apply a planned load-order change (see agentRegistryUtils.planInstructionSwap).
 *
 * Sequence: DELETE every row being rewritten, THEN one array POST re-creating
 * them all. Each call is a separate Lambda invocation under autocommit, so
 * nothing here is atomic — and the failure mode is severe: an agent that boots
 * missing binding instructions fails silently and looks fine.
 *
 * So EVERY failure path restores what was actually removed, including a failure
 * partway through the DELETE loop. Only rows this function genuinely deleted are
 * restored — a link that was already absent (404) is not resurrected, because
 * recreating a row that did not exist is its own corruption.
 *
 * @param rows      the rows to write, each { agent_fk, instruction_fk, sort_order }
 * @param originals the same links at their pre-change sort_order, for rollback
 */
export async function setAgentInstructionOrder(darwinUri, idToken, rows, originals) {
    if (!rows.length) return null;

    const originalByKey = new Map((originals || []).map(o => [linkKey(o), o]));
    const removed = [];

    // Best-effort. A failed restore must not mask the error that caused it — the
    // original failure is the one worth putting in front of a human.
    const restore = async () => {
        if (!removed.length) return;
        try { await linkAgentInstructions(darwinUri, idToken, removed); }
        catch { /* original error propagates from the caller */ }
    };

    try {
        for (const row of rows) {
            const deleted = await unlinkAgentInstruction(darwinUri, idToken,
                row.agent_fk, row.instruction_fk);
            const original = deleted ? originalByKey.get(linkKey(row)) : null;
            if (original) removed.push(original);
        }
        return await linkAgentInstructions(darwinUri, idToken, rows);
    } catch (err) {
        await restore();
        throw err;
    }
}

// REMOVED in req #3063: `syncInstructionAgents`, the membership set-diff.
//
// It existed because InstructionEditDialog committed a SET of checkboxes, so
// somebody had to work out which links that implied adding and removing. Editing
// membership through the chips means one interaction is one link or one unlink,
// and the primitives above are already exactly that.
//
// Deleted rather than left in place: the diff read as a single atomic save and
// never was — it was a loop of independent Lambda calls under autocommit, so a
// half-applied membership change was always reachable and the caller could only
// resync and hope. A dead export whose doc comment claims two callers it no
// longer has is worse than no export.
