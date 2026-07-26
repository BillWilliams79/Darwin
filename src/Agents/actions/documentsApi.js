// Mutation utilities for the architecture-document registry (req #3051).
//
// Peer to instructionsApi.js, and deliberately the same shape: all mutations go
// through call_rest_api, callers own TanStack Query invalidation, and nothing
// here touches React.
//
// REST contracts that shape this file — verified against Lambda-Rest's source,
// not assumed:
//
// - `architecture_documents` IS in Lambda-Rest CREATOR_FK_TABLES (auth_utils.py),
//   so POST overwrites any client-supplied creator_fk with the authenticated
//   Cognito sub, and PUT / DELETE are scoped to it. We still send creator_fk on
//   create: it is NOT NULL with an FK to profiles.
//
// - `agent_documents` is NOT, and correctly so — it has no creator_fk column, and
//   adding it to the set would emit `WHERE creator_fk = %s` against a column that
//   does not exist. Its only gate is the API Gateway Cognito authorizer.
//
// - `agent_documents` has a composite PK and NO `id` column. Two consequences,
//   identical to `agent_instructions`:
//     * PUT is impossible (rest_put.py requires `id`) — changing a link's
//       relationship or notes is a DELETE + re-POST, never an update.
//     * Every junction insert here sends an ARRAY body, routing to
//       _rest_post_bulk: one multi-value INSERT, no read-back, 201
//       {"inserted": N}. That started as a workaround — a single-object POST
//       used to commit the row and then return 500, because rest_post.py's
//       `WHERE id = ...` read-back raised 1054 on an id-less table after the
//       INSERT had already committed. Req #3057 fixed that (single-object POST
//       now returns 201 with no body), so the array body is no longer forced.
//       It stays because it is still one round trip for N links instead of N.
//
// - A PUT body carries ONLY the columns that changed. rest_put.py builds its SET
//   clause from the body's keys and has no version column, so a whole-row PUT
//   silently reverts a concurrent edit to any field it happens to include.
//
// - A duplicate name, a duplicate link, or a second ownership claim is an HTTP
//   409 (req #3059) carrying a structured `{error, errno, constraint, table,
//   message}` body. call_rest_api splits it: `httpStatus.httpDetail` holds the
//   object (agentRegistryUtils.restErrorMessage reads it), `httpStatus.httpMessage`
//   stays the string `assertOk` interpolates.
//
// - The string "NULL" and JSON null both become SQL NULL (rest_put.py:32,
//   rest_post.py:26 and :140). We send JSON null, matching instructionsApi.
//
// - call_rest_api THROWS on any status outside 200/201/204 — including 404 — so
//   the 404-tolerant paths catch it explicitly rather than testing the status.

import call_rest_api from '../../RestApi/RestApi';
import { serializeRoles } from '../agentRegistryUtils';

const isOk = (status) => status === 200 || status === 201 || status === 204;

/**
 * Same helper as instructionsApi's, and duplicated for the same reason that one
 * is duplicated from validationApi: coupling two registries through a ten-line
 * function is worse than the ten lines. The thrown error CARRIES `httpStatus`,
 * which every consumer downstream reads — `isNotFound`, `restErrorMessage`, and
 * `useSnackBarStore.showError` all destructure it, and showError would throw a
 * TypeError from inside a catch block without it, killing the resync that catch
 * block exists to perform.
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

// ----- architecture_documents -----

/**
 * Register a document. `name` is UNIQUE and the key does NOT exclude closed
 * rows, so the caller must pre-check against the unfiltered catalog —
 * `documentNameError` does that.
 *
 * A row is created with NO agent links: the junction needs a document id, which
 * does not exist until this returns. That ordering is deliberate and is what
 * retires the two-phase create-then-link failure mode, where a successful POST
 * followed by a failed link leaves a row owned by nobody and a dialog reporting
 * an error. A new row is simply unowned until someone claims it — a state the
 * registry already models and renders in red.
 */
export async function createArchitectureDocument(darwinUri, idToken,
    { name, doc_type = 'markdown', location = null, url = null, closed = 0, creator_fk }) {
    const r = await call_rest_api(`${darwinUri}/architecture_documents`, 'POST',
        { name, doc_type, location, url, closed, creator_fk }, idToken);
    return assertOk(r, 'createArchitectureDocument');
}

/** Partial update — `fields` must carry ONLY the columns that changed. */
export async function updateArchitectureDocument(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/architecture_documents`, 'PUT',
        [{ id, ...fields }], idToken);
    return assertOk(r, 'updateArchitectureDocument');
}

/**
 * Hard delete of the REGISTRATION — never the file on disk.
 *
 * `agent_documents` CASCADEs on `document_fk`, so this silently strips every
 * agent link including the ownership assignment, which is the one fact the
 * registry holds that cannot be reconstructed from the filesystem. Callers must
 * have shown that blast radius first. Closing (`{ closed: 1 }`) is the reversible
 * path and has the identical effect at boot.
 */
export async function deleteArchitectureDocument(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/architecture_documents`, 'DELETE',
        { id }, idToken);
    return assertOk(r, 'deleteArchitectureDocument');
}

// ----- agent_documents (junction — array-body POST, composite-key DELETE) -----

/**
 * Normalize one link to the exact key set the bulk INSERT needs.
 *
 * `_rest_post_bulk` builds ONE multi-value INSERT from the FIRST item's key
 * list, so a row missing a key would silently take its neighbour's value. Every
 * row therefore goes through here.
 *
 * `relationship` is passed through `serializeRoles`, which is not cosmetic: this
 * is a MySQL SET under a non-strict sql_mode, so any member it does not
 * recognise — including one with a leading space from a naive `roles.join(', ')`
 * or from `relationshipLabel`, which is DISPLAY-only — makes the WHOLE assignment
 * store as `''`. The link would then carry no roles at all: not owned, not
 * autoloaded, rendered as a bland dash. Canonicalizing at the wire boundary is
 * the one place that catches it no matter which caller got it wrong.
 *
 * `notes` and `sort_order` are carried through EXPLICITLY rather than defaulted
 * away. There is no PUT on this table, so every role change is a DELETE and a
 * fresh INSERT; an INSERT that omits a column writes NULL over it rather than
 * leaving it alone. Dropping `sort_order` here would silently reset an agent's
 * document order every time anyone edited a role.
 *
 * `owned_document_fk` is a VIRTUAL generated column and is never written.
 */
const linkRow = ({ agent_fk, document_fk, relationship, notes = null, sort_order = null }) => ({
    agent_fk,
    document_fk,
    relationship: serializeRoles(relationship),
    notes: notes || null,
    sort_order: Number.isFinite(sort_order) ? sort_order : null,
});

/** Create several links in ONE round trip (one atomic multi-value INSERT). */
export async function linkAgentDocuments(darwinUri, idToken, rows) {
    if (!rows.length) return null;
    const r = await call_rest_api(`${darwinUri}/agent_documents`, 'POST',
        rows.map(linkRow), idToken);
    return assertOk(r, 'linkAgentDocuments');
}

/** Create one link. Still an array body — see the header note on id-less POST. */
export async function linkAgentDocument(darwinUri, idToken, link) {
    return linkAgentDocuments(darwinUri, idToken, [link]);
}

/**
 * Remove one link. Tolerates an already-absent row.
 *
 * Returns true when a row was actually removed, false when it was already gone.
 * The rollback below needs that distinction: recreating a row that never existed
 * is its own corruption, so only genuinely-deleted rows are ever restored.
 */
export async function unlinkAgentDocument(darwinUri, idToken, agent_fk, document_fk) {
    try {
        const r = await call_rest_api(`${darwinUri}/agent_documents`, 'DELETE',
            { agent_fk, document_fk }, idToken);
        assertOk(r, 'unlinkAgentDocument');
        return true;
    } catch (err) {
        if (isNotFound(err)) return false;   // already gone — the desired end state
        throw err;
    }
}

/**
 * Error thrown when a rollback could not put the database back.
 *
 * Its own type because the caller must treat it differently from an ordinary
 * failure: an ordinary failure means "nothing changed, try again", while this
 * means "a link you did not ask to remove is now missing". The UI has to say so
 * out loud and force a refetch rather than reporting the original conflict and
 * leaving a stale, wrong screen up.
 *
 * This is the one place this module deliberately DIVERGES from the MCP daemon.
 * `darwin-mcp/services/agents.py::link_agent_document` catches a failed restore,
 * logs "the link is now MISSING", and then re-raises the ORIGINAL owner conflict
 * — so the user is told "someone else owns this" while a link has silently
 * vanished. That is a real defect on that path; reproducing it here would just
 * give it a second home.
 */
export class LinkRollbackError extends Error {
    constructor(message, { cause, lost } = {}) {
        super(message);
        this.name = 'LinkRollbackError';
        this.cause = cause;
        // The links that could not be restored, so the caller can name them.
        this.lost = lost || [];
        // Carried through so restErrorMessage / showError still work on it.
        this.httpStatus = cause?.httpStatus;
    }
}

/**
 * Apply an ordered plan of junction writes, rolling back on failure.
 *
 * A "step" is one (agent, document) pair moving from `prev` to `next`:
 *
 *   { agent_fk, document_fk, prev: link | null, next: link | null }
 *
 *   prev=null, next=link   → create
 *   prev=link, next=link   → re-classify (DELETE + POST, because there is no PUT)
 *   prev=link, next=null   → unlink
 *
 * WHY A PLAN AND NOT A SEQUENCE OF CALLS. Ownership transfer is intrinsically two
 * steps and their ORDER IS FORCED: `uq_agent_documents_owner` rejects the
 * incoming claim while the incumbent still holds `owned`, so the incumbent must
 * be dropped first. There is no ordering that avoids a window in which the
 * document is unowned — only the length of that window and whether it is
 * recoverable are in our control. Nothing here is atomic (each call is a separate
 * Lambda invocation under autocommit), so recoverability is the whole job.
 *
 * On failure every applied step is undone in REVERSE order, restoring exactly
 * what was there. Steps that were never reached are left alone. If the rollback
 * itself fails, a LinkRollbackError is thrown naming what could not be put back —
 * the original error is attached as `cause`, but it is no longer the headline,
 * because "your edit was rejected" and "a link is now missing" are different
 * things to tell a user and the second one outranks the first.
 */
export async function applyLinkPlan(darwinUri, idToken, steps) {
    if (!steps.length) return null;

    const applied = [];   // steps that completed, newest last

    const runStep = async (step) => {
        const deleted = step.prev
            ? await unlinkAgentDocument(darwinUri, idToken, step.agent_fk, step.document_fk)
            : false;

        // RECORDED BEFORE THE INSERT IS ATTEMPTED, and that ordering is the whole
        // point. A relink is DELETE-then-INSERT; if the INSERT fails, the DELETE
        // has ALREADY committed (autocommit, separate Lambda invocation) and is
        // precisely what has to be undone. Pushing after the insert — the obvious
        // way to write this — means the one step that most needs a rollback is the
        // only step the rollback never sees, and the link is silently gone.
        //
        // `deleted` records what ACTUALLY happened rather than what was intended:
        // a `prev` that turned out to be already absent (404) must never be
        // resurrected, because recreating a row that did not exist is its own
        // corruption.
        const record = { ...step, deleted, attemptedWrite: false };
        applied.push(record);

        if (step.next) {
            // Flagged BEFORE the await for the same reason: the write may commit
            // and the response still fail (a flake after the INSERT landed), and
            // the rollback has to assume it might be there.
            record.attemptedWrite = true;
            await linkAgentDocument(darwinUri, idToken, {
                ...step.next,
                agent_fk: step.agent_fk,
                document_fk: step.document_fk,
            });
        }
    };

    const rollback = async () => {
        const lost = [];
        for (const step of [...applied].reverse()) {
            try {
                // Remove whatever this step may have written. Unconditionally
                // attempted whenever a write was STARTED, not only when it was
                // observed to succeed — `unlinkAgentDocument` tolerates a 404, so
                // trying costs nothing, while skipping it would leave a committed
                // row behind whenever a response was lost after the INSERT landed.
                if (step.attemptedWrite) {
                    await unlinkAgentDocument(darwinUri, idToken,
                        step.agent_fk, step.document_fk);
                }
                // Then put back whatever it genuinely removed.
                if (step.deleted && step.prev) {
                    await linkAgentDocument(darwinUri, idToken, {
                        ...step.prev,
                        agent_fk: step.agent_fk,
                        document_fk: step.document_fk,
                    });
                }
            } catch {
                // Keep unwinding the rest — a second failure must not strand steps
                // that could still be undone. Only a step that had a row to
                // restore counts as LOST; one that merely failed to have its own
                // write cleaned up has not cost the user anything they had.
                if (step.deleted && step.prev) lost.push(step);
            }
        }
        return lost;
    };

    try {
        for (const step of steps) await runStep(step);
        return { applied: applied.length };
    } catch (err) {
        const lost = await rollback();
        if (lost.length) {
            throw new LinkRollbackError(
                'The change was rejected AND the previous links could not be restored — '
                + `${lost.length} agent link${lost.length === 1 ? ' is' : 's are'} now missing. `
                + 'Reload the page to see the real state.',
                { cause: err, lost });
        }
        throw err;
    }
}

/**
 * Re-classify one existing link — change its roles and/or notes.
 * A single-step plan, so it inherits the rollback above.
 */
export async function setAgentDocumentLink(darwinUri, idToken, { prev, next }) {
    return applyLinkPlan(darwinUri, idToken, [{
        agent_fk: prev.agent_fk,
        document_fk: prev.document_fk,
        prev,
        next,
    }]);
}

// The ownership-transfer PLANNER lives in agentRegistryUtils as
// `planOwnerTransfer`, next to the role helpers it is built from and away from
// anything that touches the network. This module executes plans; it does not
// build them. Same split as `planInstructionSwap` (utils) versus
// `setAgentInstructionOrder` (api).
