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
import { serializeRoles, isDuplicateLink } from '../agentRegistryUtils';

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
 * means "the database is not in either of the two states you asked for". The UI
 * has to say so out loud and force a refetch rather than reporting the original
 * conflict and leaving a stale, wrong screen up.
 *
 * TWO KINDS OF DAMAGE, AND THEY ARE NOT THE SAME REPORT (req #3101, closing
 * finding 3a from req #3051's review).
 *
 *   `lost`     — steps whose `prev` row was genuinely deleted and could not be
 *                put back. The user has LESS than they started with: a link they
 *                did not touch is missing.
 *   `orphaned` — steps that had NO incumbent (a create-only claim on a
 *                previously-unowned document) whose INSERT may have committed
 *                while its response was lost, and whose cleanup DELETE then also
 *                failed. The user has MORE than they asked for: a link nobody
 *                authorized may be sitting in the junction.
 *
 * Until #3101 only `lost` was tracked, so the second case threw NOTHING — the
 * user saw the original, by-then-stale error and no mention of the orphan. It is
 * a double fault and the page's own resync repaints the truth a moment later,
 * which is exactly why it went unreported: the screen self-corrects while the
 * MESSAGE stays wrong about what happened.
 *
 * This is also the one place this module deliberately DIVERGES from the MCP
 * daemon. `darwin-mcp/services/agents.py::link_agent_document` catches a failed
 * restore, logs "the link is now MISSING", and then re-raises the ORIGINAL owner
 * conflict — so the user is told "someone else owns this" while a link has
 * silently vanished. That is a real defect on that path; reproducing it here
 * would just give it a second home.
 */
export class LinkRollbackError extends Error {
    constructor(message, { cause, lost, orphaned } = {}) {
        super(message);
        this.name = 'LinkRollbackError';
        this.cause = cause;
        // The links that could not be restored, so the caller can name them.
        this.lost = lost || [];
        // The links that may have been created and could not be removed.
        this.orphaned = orphaned || [];
        // Carried through so restErrorMessage / showError still work on it.
        this.httpStatus = cause?.httpStatus;
    }
}

/**
 * Compose the headline for a failed rollback.
 *
 * LOST OUTRANKS ORPHANED when both happened, because they are different sizes of
 * problem: a missing link silently changes what an agent loads at boot, while a
 * stray one is visible on the very card the user is looking at and is removable
 * with one click. Both are named when both occurred — reporting only the worse
 * one would leave the user repairing half the damage.
 */
const rollbackMessage = (lost, orphaned) => {
    // A `lost` step splits by whether its CLEANUP succeeded. If it did, the row is
    // genuinely gone. If it did not, the row is still there — carrying the value
    // the rejected edit asked for, which is the most misleading state of the three
    // and the one a message saying "missing" would send the user hunting for.
    const missing = lost.filter(s => !s.cleanupFailed);
    const stale = lost.filter(s => s.cleanupFailed);

    const parts = [];
    if (missing.length) {
        parts.push(`${missing.length} agent link${missing.length === 1 ? ' is' : 's are'} now missing`);
    }
    if (stale.length) {
        parts.push(`${stale.length} agent link${stale.length === 1 ? '' : 's'} `
            + `still carr${stale.length === 1 ? 'ies' : 'y'} the rejected value`);
    }
    if (orphaned.length) {
        parts.push(`${orphaned.length} link${orphaned.length === 1 ? '' : 's'} `
            + 'may have been created and could not be removed');
    }
    return `The change was rejected AND the database could not be put back — ${parts.join(', and ')}. `
        + 'Reload the page to see the real state.';
};

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
 * On failure every applied step is undone in REVERSE order, restoring what was
 * there — CANONICALISED, not byte-identical: the restore goes back out through
 * `linkRow`, so `serializeRoles` drops any superseded member the stored value
 * happened to carry (req #3101). A `prev` of `owned,referenced` comes back as
 * `owned`. Nothing in the live registry stores such a set, and the normalisation
 * is the desirable direction, but a rollback is a place where "exactly what was
 * there" has to be said accurately.
 *
 * Steps that were never reached are left alone. If the rollback
 * itself fails, a LinkRollbackError is thrown naming what could not be put back —
 * the original error is attached as `cause`, but it is no longer the headline,
 * because "your edit was rejected" and "the database is not in either state you
 * asked for" are different things to tell a user and the second one outranks the
 * first. That covers BOTH directions of damage: a `prev` that could not be
 * restored (`lost`) and a create-only step whose write could not be removed
 * (`orphaned`) — see LinkRollbackError.
 */
export async function applyLinkPlan(darwinUri, idToken, steps) {
    if (!steps.length) return null;

    const applied = [];   // steps that completed, newest last

    /**
     * A step's record says WHAT THE ROLLBACK MUST DO, not what happened to it.
     *
     * The two are not the same question and conflating them is how this function
     * has gone wrong twice. `cleanupNeeded` means "a row may exist here that this
     * step put there"; `restoreNeeded` means "a row that existed before this step
     * may be gone". Both are set OPTIMISTICALLY — before the await that would tell
     * us, and true whenever the outcome is UNKNOWN — because every call here is a
     * separate Lambda invocation under autocommit, so a lost response after a
     * committed statement is the normal shape of the failure, not an exotic one.
     *
     * A CLEANUP DELETE IS NOT A NO-OP, AND OPTIMISM ABOUT IT IS DESTRUCTIVE. It is
     * 404-TOLERANT, which is a different thing: against a row that is genuinely
     * there it succeeds and REMOVES it. So `cleanupNeeded` is set only where this
     * step actually issued a write of its own — never merely because the state is
     * unknown. Setting it on the leading-DELETE-threw path (a first pass at this
     * did) turns the most ordinary failure of all, the database REFUSING the
     * DELETE with the row untouched, into the rollback deleting that row itself.
     *
     * AND IT IS WITHDRAWN THE MOMENT THE UNKNOWN BECOMES KNOWN (req #3294). The
     * flag is a standing assumption, not a record of the past: a 1062 on the
     * composite PRIMARY key answers the question it was standing in for — the row
     * pre-existed, this INSERT created nothing — so the assumption is cleared
     * rather than carried into the rollback, where it would delete somebody else's
     * link. Symmetrical with the 404 rule below, and for the same reason: where
     * the database states a fact about whether the row is there, that fact governs
     * — and both of the facts it states here rule an action OUT.
     *
     * The one thing that is NOT optimistic on the restore side either is a 404 on
     * the leading DELETE. That is a definite answer — the row was already gone —
     * and resurrecting a row that did not exist is its own corruption, so
     * `restoreNeeded` stays false.
     *
     * `restoreUncertain` is the third state, and it exists so that REPAIRING and
     * REPORTING can be decided separately. A leading DELETE that THREW may or may
     * not have committed, and its rollback is exactly ONE POST — safe in both
     * directions: if the DELETE committed, the POST restores the row; if it did
     * not, the POST collides on the composite PK and is caught. A failed repair is
     * NOT reported as a missing link, because nothing ever established that a link
     * went missing; claiming one on every failed unlink would be a false alarm on
     * the common path, bought to cover a rare one.
     */
    const runStep = async (step) => {
        // PUSHED BEFORE ANY CALL IS ATTEMPTED. Recording after an await means the
        // one step that most needs a rollback is the only step the rollback never
        // sees. That was true of the INSERT (fixed by req #3051) and it was still
        // true of the leading DELETE until req #3101: a DELETE that committed and
        // then lost its response left `applied` empty, so nothing was ever put
        // back and a link vanished with no report at all.
        const record = {
            ...step, cleanupNeeded: false, restoreNeeded: false, restoreUncertain: false,
        };
        applied.push(record);

        if (step.prev) {
            try {
                // A 404 is the desired end state, not a failure — and it is the
                // one outcome that rules a restore OUT rather than in.
                record.restoreNeeded = await unlinkAgentDocument(
                    darwinUri, idToken, step.agent_fk, step.document_fk);
            } catch (err) {
                // Outcome unknown, so REPAIR but do not report — see
                // `restoreUncertain` above.
                //
                // Deliberately NOT `cleanupNeeded`. This step has written nothing,
                // so there is nothing of its own to clean up, and a cleanup DELETE
                // here would be issued against a row this step may well have failed
                // to touch — destroying the very link the rollback exists to save.
                // The lone POST below is the whole repair and it needs no DELETE in
                // front of it: it either restores the row or collides with it.
                record.restoreUncertain = true;
                throw err;
            }
        }

        if (step.next) {
            // Flagged BEFORE the await for the same reason: the write may commit
            // and the response still fail (a flake after the INSERT landed), and
            // the rollback has to assume it might be there.
            record.cleanupNeeded = true;
            try {
                await linkAgentDocument(darwinUri, idToken, {
                    ...step.next,
                    agent_fk: step.agent_fk,
                    document_fk: step.document_fk,
                });
            } catch (err) {
                // OPTIMISM IS FOR THE UNKNOWN, AND THIS IS NOT UNKNOWN (req #3294).
                //
                // A 1062 on the composite PRIMARY key is the database stating a
                // FACT: the row was already there, so this INSERT created nothing
                // and the row belongs to whoever did. NOT another user —
                // `agent_documents` is in Lambda-Rest's JUNCTION_OWNERSHIP and
                // every read and write is derived-scoped through
                // `agents.creator_fk`, so the other writer is always the same
                // identity: a second browser tab, the MCP daemon, or this tab's
                // own cache having gone stale under a plan built from it. Leaving
                // `cleanupNeeded` set would send the rollback's 404-TOLERANT
                // DELETE at that row, and against a row that is genuinely there
                // that DELETE SUCCEEDS AND REMOVES IT.
                //
                // The loss is then unreportable, which is what made it silent: this
                // step removed nothing, so it is not `lost`; its cleanup worked, so
                // it is not `orphaned`. The user is told only that their edit was
                // rejected while a link they never touched is gone.
                //
                // It is the exact write-side mirror of the read-side rule on the
                // leading DELETE above: a 404 there is a definite answer that rules
                // a restore OUT, and a 1062 on PRIMARY here is a definite answer
                // that rules the cleanup out.
                //
                // Scoped to `agent_documents` and to `PRIMARY` on purpose. The
                // other two 1062s this table raises — `uq_agent_documents_owner`
                // (a second owner for one document) and
                // `uq_agent_documents_principles` (a second principles doc for one
                // agent) — must NOT suppress anything: those INSERTs really did
                // fail to land, so there is nothing of ours behind them and the
                // cleanup goes ahead.
                if (isDuplicateLink(err, 'agent_documents')) record.cleanupNeeded = false;
                throw err;
            }
        }
    };

    const rollback = async () => {
        const lost = [];
        const orphaned = [];
        for (const step of [...applied].reverse()) {
            // TWO INDEPENDENT try BLOCKS, not one around both halves.
            //
            // They were one until req #3101, and that coupling had its own defect:
            // a step whose cleanup DELETE threw skipped its own RESTORE entirely,
            // so a failure on the half that costs the user nothing prevented the
            // half that repairs real damage from even being attempted. The two
            // undo different things and fail for different reasons; neither is
            // allowed to cancel the other.
            let cleanupFailed = false;
            try {
                // Remove whatever this step may have put here. 404-tolerant, so
                // issuing it against an EMPTY slot costs one call and never fails
                // — which is emphatically not the same as issuing it against an
                // OCCUPIED one, where it succeeds and takes the row with it. That
                // is why the decision is `cleanupNeeded` and never "just in case".
                if (step.cleanupNeeded) {
                    await unlinkAgentDocument(darwinUri, idToken,
                        step.agent_fk, step.document_fk);
                }
            } catch {
                cleanupFailed = true;
            }

            // REPAIR on either signal; REPORT only on the confirmed one.
            const restoring = (step.restoreNeeded || step.restoreUncertain) && step.prev;
            if (restoring) {
                try {
                    await linkAgentDocument(darwinUri, idToken, {
                        ...step.prev,
                        agent_fk: step.agent_fk,
                        document_fk: step.document_fk,
                    });
                } catch {
                    // Keep unwinding the rest — a second failure must not strand
                    // steps that could still be undone.
                    //
                    // `cleanupFailed` rides along because it changes what to TELL
                    // the user: with a successful cleanup the row is genuinely
                    // gone, while with a failed one the row is still there holding
                    // the value the rejected edit asked for. "Missing" and "not
                    // what you left" are different repairs.
                    if (step.restoreNeeded) {
                        lost.push({ ...step, cleanupFailed });
                        continue;
                    }
                    // Uncertain: we never established that anything was removed, so
                    // there is nothing we can honestly say went missing. The
                    // original error stays the headline.
                }
            }

            // NO RESTORE WAS ATTEMPTED and the cleanup failed, so a row this step
            // may have created is still out there, scoped to nobody's intent —
            // the orphan req #3051's review flagged as unreported.
            //
            // The predicate is "no restore ran", NOT "no `prev`". They look
            // equivalent and are not: a step whose `prev` turned out to be already
            // absent (404) carries a non-null `prev` and still skips its restore,
            // and its INSERT created a row that did not exist a moment earlier.
            // Keying on `prev` alone left exactly that shape silent — reachable
            // from a single popover Save whenever another writer removed the link
            // between the plan being built and the write running.
            //
            // It cannot double-count: the `lost` branch above `continue`s.
            if (cleanupFailed && !restoring) orphaned.push(step);
        }
        return { lost, orphaned };
    };

    try {
        for (const step of steps) await runStep(step);
        return { applied: applied.length };
    } catch (err) {
        const { lost, orphaned } = await rollback();
        if (lost.length || orphaned.length) {
            throw new LinkRollbackError(rollbackMessage(lost, orphaned),
                { cause: err, lost, orphaned });
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
