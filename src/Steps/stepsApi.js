// Mutation utilities for the pipeline_steps data type (req #3393).
//
// Goes through the same generic gateway path darwin-mcp/services/pipelines2.py
// already POSTs/PUTs/DELETEs: `{darwinUri}/pipeline_steps`. No new backend
// surface exists or is needed. Pattern mirrors Steps/stepsApi.js — this is its
// server-side sibling, not an import of it.
//
// ## The invariant this module has to carry itself
//
// The browser does not go through the MCP service, so `pipelines2.py`'s
// design-rule-1 guard (`completed_at` valid only on a step with zero GATING
// requirements — tracking containers exempt) is unenforced on this path
// unless it is reproduced here. It is: `stepsModel.js` holds the decision as
// a pure tested function (`completionGuard`); `completeStep` below is the
// only function that stamps the column, and it is the CALLER's job (StepsPage's
// `completeFlow`) to have just re-read this step's live links before calling it
// — the two functions below (`fetchStepRequirementIds`,
// `fetchRequirement2Tracking`) exist for that re-read.
//
// Column shape (from darwin-mcp/services/pipelines2.py's create/update
// functions):
//   epic_fk       required, the step's identity — never updated (moving a
//                 step means dropping it and creating it in the new epic,
//                 same doctrine 1.0 states for pipeline_fk)
//   title         NOT NULL
//   run           'auto' | 'manual'
//   notes         nullable TEXT — REPLACES, never appends
//   not_before    nullable TIMESTAMP, one instant, clearable
//   completed_at  nullable DATETIME — stamped by completeStep, cleared by reopenStep

import call_rest_api from '../RestApi/RestApi';
import { fetchEntity } from '../hooks/factory/createEntityQueries';

const isOk = (status) => status === 200 || status === 201 || status === 204;

function assertOk(result, action) {
    const status = result.httpStatus?.httpStatus;
    if (!isOk(status)) {
        const msg = result.httpStatus?.httpMessage || 'unknown';
        const error = new Error(`${action} failed: HTTP ${status} ${msg}`);
        error.httpStatus = result.httpStatus;
        throw error;
    }
    return result.data;
}

// Lambda-Rest's clear-a-column sentinel on PUT. Applies on both verbs at the
// gateway (rest_post.py and rest_put.py both substitute it), which is why a
// literal "NULL" typed into `title` is refused client-side below rather than
// silently landing as SQL NULL.
export const REST_NULL = 'NULL';

/** Whether a user-typed value would be swallowed by the REST_NULL sentinel. */
export const isRestNullLiteral = (value) => String(value ?? '').trim() === REST_NULL;

// The MySQL naive-datetime form Darwin stores everywhere, in UTC.
export const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export const VALID_RUN2_MODES = ['auto', 'manual'];

/**
 * Create a step under an epic. `completed_at` is never set here — a step is
 * born incomplete. Requirement links are not created either: seating is
 * MCP/Primary-only (see this module's header). Dependency rows are written
 * only by the plan visualizer's add-step actions below (`addDependentStep`,
 * `insertStepOnEdge`, req #3586; `precedeStepWith`, req #3617) — a browser
 * write racing a Primary `set_step_deps` on the same step, the same KNOWN, ACCEPTED race
 * `moveStepRequirement` records for seats.
 */
export async function createStep(darwinUri, idToken,
    { epic_fk, title, run = 'auto', notes = null, not_before = null }) {
    const r = await call_rest_api(`${darwinUri}/pipeline_steps`, 'POST',
        { epic_fk, title, run, notes, not_before, completed_at: null }, idToken);
    return assertOk(r, 'createStep');
}

/**
 * Update a step's own columns. `fields` is a partial update; nullable columns
 * the caller wants CLEARED must arrive as REST_NULL. `notes` REPLACES, never
 * appends.
 */
export async function updateStep(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/pipeline_steps`, 'PUT',
        [{ id, ...fields }], idToken);
    return assertOk(r, 'updateStep');
}

/**
 * Stamp `completed_at`. DESIGN RULE 1 IS THE CALLER'S PRECONDITION: call this
 * only for a step whose gating set was just confirmed EMPTY BY A LIVE READ
 * (StepsPage's `completeFlow`, mirroring `Steps/StepsPage.jsx`'s identical
 * guard). The cached `completionGuard` alone is the fast path, not the rule.
 */
export async function completeStep(darwinUri, idToken, id) {
    return updateStep(darwinUri, idToken, id, { completed_at: sqlNow() });
}

/** Clear `completed_at`. Unguarded — reopening only ever moves the stored
 * column towards what a derived step already reports. */
export async function reopenStep(darwinUri, idToken, id) {
    return updateStep(darwinUri, idToken, id, { completed_at: REST_NULL });
}

/**
 * HARD-delete a step, ONE statement — same single-statement rationale
 * `Steps/stepsApi.js`'s `deleteStep` states: `pipeline_step_requirements` and
 * `pipeline_step_deps` rows referencing this step as `step_fk` cascade with
 * it, while `dep_step_fk` stays ON DELETE RESTRICT — so a step another step
 * depends on comes back as a clean 409 with the plan untouched, never a
 * partial write.
 */
export async function deleteStep(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/pipeline_steps`, 'DELETE', { id }, idToken);
    return assertOk(r, 'deleteStep');
}

/**
 * The requirement ids currently linked to a step, read LIVE — the re-read
 * design rule 1 requires before a stamp (see this module's header).
 */
export async function fetchStepRequirementIds(darwinUri, idToken, stepId) {
    const rows = await fetchEntity(
        `${darwinUri}/pipeline_step_requirements?step_fk=${stepId}`, idToken);
    return (Array.isArray(rows) ? rows : []).map(r => r.requirement_fk);
}

/**
 * One requirement's `tracking` flag, read LIVE. Returns null when the row is
 * gone — the caller must treat that as gating (see `stepsModel.js`).
 * `requirements` is shared core (it was never era-prefixed —
 * both eras attach to), so this is the same endpoint 1.0's stepsApi.js calls.
 */
export async function fetchRequirement2Tracking(darwinUri, idToken, requirementId) {
    const rows = await fetchEntity(
        `${darwinUri}/requirements?id=${requirementId}&fields=id,tracking`, idToken);
    return (Array.isArray(rows) && rows.length) ? rows[0] : null;
}

/**
 * Move a requirement's seat from one step to another — the ONE implementation
 * of a seat edit in the browser (req #3435 wrote it inline in RequirementDetail;
 * req #3581's plan-visualizer drag-and-drop is its second caller, so it lives
 * here rather than in two copies that could disagree about the order below).
 * Either side may be null: `fromStepId` null seats an unseated requirement,
 * `toStepId` null unseats it.
 *
 * Seating is the junction Primary/MCP owns on the orchestration side; the
 * browser write is a KNOWN, ACCEPTED race with a polling engine (user ruling
 * 2026-08-10, recorded at RequirementDetail's step picker) — do not add a
 * silent refusal here.
 *
 * ## Order of operations — DELETE THE OLD SEAT, THEN INSERT THE NEW
 *
 * THE REVERSE ORDER CANNOT WORK, and this is a schema fact rather than a
 * judgement call. `pipeline_step_requirements` has `PRIMARY KEY
 * (requirement_fk)` ALONE — one step per requirement, the req #3336 stage-2
 * gate ruling — so while the old row exists there is no key for a second one
 * and the INSERT fails 100% of the time on a MOVE. `link_step_requirement`
 * (darwin-mcp) says the same from the server side.
 *
 * BOTH COLUMNS go in the DELETE body even though `requirement_fk` alone is the
 * PK: `rest_delete.py` ANDs every key into the WHERE clause, so the seat is
 * removed only if the row still says what the caller last read. A seat moved by
 * somebody else meanwhile answers 404, `call_rest_api` throws, and the POST
 * never runs — a stale read aborts the move instead of completing half of it.
 *
 * THE RESIDUAL: a POST that fails after the DELETE succeeded leaves the
 * requirement seated NOWHERE. It is the only failure mode the key permits; the
 * caller surfaces the error and re-reads rather than guessing a rollback.
 */
export async function moveStepRequirement(darwinUri, idToken,
    { requirementId, fromStepId = null, toStepId = null }) {
    if (fromStepId === toStepId) return;
    const uri = `${darwinUri}/pipeline_step_requirements`;
    // Every failure is tagged with the half that failed — `'unseat'` (nothing
    // changed) or `'seat'` (the old seat is already gone) — so a caller can
    // tell the harmless failure from the residual above.
    const write = async (seatStage, method, body) => {
        try {
            return assertOk(await call_rest_api(uri, method, body, idToken),
                seatStage === 'seat' ? 'seatRequirement' : 'unseatRequirement');
        } catch (error) {
            if (error && typeof error === 'object') error.seatStage = seatStage;
            throw error;
        }
    };
    if (fromStepId != null) {
        await write('unseat', 'DELETE', { step_fk: fromStepId, requirement_fk: requirementId });
    }
    if (toStepId != null) {
        await write('seat', 'POST', { step_fk: toStepId, requirement_fk: requirementId });
    }
}

/**
 * Add one dependency edge: step `stepId` waits on step `depStepId`. A single
 * `pipeline_step_deps` row; the gateway derives ownership from `step_fk` and
 * verifies `dep_step_fk` (Lambda-Rest JUNCTION_OWNERSHIP).
 */
export async function createStepDep(darwinUri, idToken, stepId, depStepId) {
    const r = await call_rest_api(`${darwinUri}/pipeline_step_deps`, 'POST',
        { step_fk: stepId, dep_step_fk: depStepId }, idToken);
    return assertOk(r, 'createStepDep');
}

/** Remove one dependency edge, addressed by both columns (the UNIQUE key). */
export async function deleteStepDep(darwinUri, idToken, stepId, depStepId) {
    const r = await call_rest_api(`${darwinUri}/pipeline_step_deps`, 'DELETE',
        { step_fk: stepId, dep_step_fk: depStepId }, idToken);
    return assertOk(r, 'deleteStepDep');
}

// The new row's id out of a POST response. The gateway reads the row back as a
// one-element ARRAY; a 201 with no body (its read-back failed after the INSERT
// committed) carries none, and the caller must say so rather than guess.
export const createdRowOf = (data) => (Array.isArray(data) ? data[0] : data) || null;

function requireCreatedId(data) {
    const row = createdRowOf(data);
    if (row?.id == null) {
        const error = new Error('The step was created but its id could not be read back, '
            + 'so its dependencies were not written — wire it from the plan.');
        // The row EXISTS; a retry would create a second one.
        error.orphanStep = true;
        throw error;
    }
    return row;
}

// Best-effort undo of the writes already made when a later one fails. A
// failure here is logged and swallowed: the caller reports the ORIGINAL error,
// and the refetch shows whatever the plan really holds.
async function undoAll(undos) {
    for (const undo of undos.reverse()) {
        try {
            await undo();
        } catch (e) {
            console.error('step insert rollback failed', e);
        }
    }
}

/**
 * Create a step and gate it on `fromStepId` — the canvas's DEPENDENT "+"
 * (req #3586): a new step that depends on that one step alone. Neither write
 * can introduce a cycle (the new step has no dependents), and both steps are
 * in the same plan by construction. A failed edge deletes the new step. (The
 * one exception is a create whose id cannot be read back — flagged
 * `orphanStep`, because nothing can address the row to delete it.)
 *
 * @returns {Promise<Object>} the created step row
 */
export async function addDependentStep(darwinUri, idToken, { fromStepId, epic_fk, title }) {
    const created = requireCreatedId(await createStep(darwinUri, idToken, { epic_fk, title }));
    const stepId = created.id;
    try {
        await createStepDep(darwinUri, idToken, stepId, fromStepId);
    } catch (error) {
        await undoAll([() => deleteStep(darwinUri, idToken, stepId)]);
        throw error;
    }
    return created;
}

/**
 * Create a step and gate `toStepId` on it — the canvas's PRECEDE "+" off a
 * card's free left side (req #3617): a new step N that the existing step will
 * then depend on, N → T. No cycle is possible (N is new, so nothing reaches
 * it). A failed edge undoes both writes — T → N first, because a write
 * reported as failed may still have landed and N cannot be deleted while T
 * waits on it (`dep_step_fk` is ON DELETE RESTRICT).
 *
 * @returns {Promise<Object>} the created step row
 */
export async function precedeStepWith(darwinUri, idToken, { toStepId, epic_fk, title }) {
    const created = requireCreatedId(await createStep(darwinUri, idToken, { epic_fk, title }));
    const stepId = created.id;
    const undos = [() => deleteStep(darwinUri, idToken, stepId)];
    try {
        undos.push(() => deleteStepDep(darwinUri, idToken, toStepId, stepId));
        await createStepDep(darwinUri, idToken, toStepId, stepId);
    } catch (error) {
        await undoAll(undos);
        throw error;
    }
    return created;
}

/**
 * SPLIT the edge `toStepId` → `fromStepId` with a new step — the canvas's
 * EDGE "+" (req #3586): A → B becomes A → N → B.
 *
 * ## Order of operations — B IS NEVER UNDER-GATED
 *
 * 1. create N            2. N waits on A
 * 3. B waits on N        4. B stops waiting on A
 *
 * B gains its new gate BEFORE it loses the old one, so at no instant can a
 * polling engine see B eligible early. A failure at 2 or 3 undoes what was
 * written — and a failure at 3 deletes B → N regardless, because a write
 * reported as failed may still have landed (a dropped response), and N cannot
 * be deleted while B waits on it. A failure at 4 leaves B waiting on both A
 * and N — which gates exactly as A → N → B does (N already waits on A), so it
 * is reported (`redundantEdge`) but not undone; a 404 there means the edge
 * was already gone, which is success. No cycle is possible: N's only
 * dependency is A and its only dependent is B, and A → B already existed
 * acyclically.
 *
 * @returns {Promise<Object>} the created step row
 */
export async function insertStepOnEdge(darwinUri, idToken,
    { fromStepId, toStepId, epic_fk, title }) {
    const created = requireCreatedId(await createStep(darwinUri, idToken, { epic_fk, title }));
    const stepId = created.id;
    // Deleting N cascades its own N → A row, so the undo list never names it.
    const undos = [() => deleteStep(darwinUri, idToken, stepId)];
    try {
        await createStepDep(darwinUri, idToken, stepId, fromStepId);
        undos.push(() => deleteStepDep(darwinUri, idToken, toStepId, stepId));
        await createStepDep(darwinUri, idToken, toStepId, stepId);
    } catch (error) {
        await undoAll(undos);
        throw error;
    }
    try {
        await deleteStepDep(darwinUri, idToken, toStepId, fromStepId);
    } catch (error) {
        if (error?.httpStatus?.httpStatus !== 404) {
            error.redundantEdge = true;
            throw error;
        }
    }
    return created;
}
