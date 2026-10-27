// Mutation utilities for the epics data type (req #3393).
//
// Goes through the same generic gateway path darwin-mcp/services/pipelines2.py
// already POSTs/PUTs/DELETEs: `{darwinUri}/epics`. No new backend
// surface exists or is needed. Pattern mirrors Epics/epicsApi.js — this is its
// server-side sibling, not an import of it.
//
// ## An epic has no state (req #3750)
//
// An epic holds requirements and carries orchestration controls; it is never
// completed or reopened, and `epics.completed_at` no longer exists.
//
// Column shape (from darwin-mcp/services/pipelines2.py's create/update
// functions):
//   initiative_fk       required, the epic's identity — never updated (moving a
//                 epic means dropping it and creating it in the new initiative,
//                 same doctrine 1.0 states for pipeline_fk)
//   title         NOT NULL
//   run           'auto' | 'manual'
//   notes         nullable TEXT — REPLACES, never appends
//   not_before    nullable TIMESTAMP, one instant, clearable

import call_rest_api from '../RestApi/RestApi';

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
 * Create an epic under an initiative. Requirement links are not created either: seating is
 * MCP/Primary-only (see this module's header). Dependency rows are written
 * only by the plan visualizer's add-epic actions below (`addDependentEpic`,
 * `insertEpicOnEdge`, req #3586; `precedeEpicWith`, req #3617) and the epics
 * table's delete (`deleteEpicFreeingDependents`, req #3877) — a browser
 * write racing a Primary `set_epic_deps` on the same epic, the same KNOWN, ACCEPTED race
 * `moveEpicRequirement` records for seats.
 */
export async function createEpic(darwinUri, idToken,
    { initiative_fk, title, run = 'auto', notes = null, not_before = null, checkpoint }) {
    // `checkpoint` (the barrier, req #3767) is sent only when the caller sets
    // it; omitted, the column DEFAULT (1, a barrier) applies.
    const r = await call_rest_api(`${darwinUri}/epics`, 'POST',
        { initiative_fk, title, run, notes, not_before,
          ...(checkpoint == null ? {} : { checkpoint }) }, idToken);
    return assertOk(r, 'createEpic');
}

/**
 * Update an epic's own columns. `fields` is a partial update; nullable columns
 * the caller wants CLEARED must arrive as REST_NULL. `notes` REPLACES, never
 * appends.
 */
export async function updateEpic(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/epics`, 'PUT',
        [{ id, ...fields }], idToken);
    return assertOk(r, 'updateEpic');
}

/**
 * HARD-delete an epic, ONE statement — same single-statement rationale
 * `Epics/epicsApi.js`'s `deleteEpic` states: `epic_requirements` and
 * `epic_deps` rows referencing this epic as `epic_fk` cascade with
 * it, while `dep_epic_fk` stays ON DELETE RESTRICT — so an epic another epic
 * depends on comes back as a clean 409 with the plan untouched, never a
 * partial write.
 */
export async function deleteEpic(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/epics`, 'DELETE', { id }, idToken);
    return assertOk(r, 'deleteEpic');
}

/**
 * Delete an epic OTHER epics depend on — the epics table's delete (req #3877):
 * free every dependent of its edge onto this epic, then delete the epic. The
 * epic's own dependency rows and its requirement seats CASCADE with it, so its
 * requirements are un-orchestrated, never deleted.
 *
 * ## Order of operations — EDGES FIRST, BECAUSE THE SCHEMA SAYS SO
 *
 * `dep_epic_fk` is ON DELETE RESTRICT, so the epic cannot go while any edge
 * still names it. A 404 on an edge means it is already gone, which is the
 * goal. If any later write fails, the edges already removed are re-created
 * (best effort) before the ORIGINAL error is rethrown: a dependent freed from
 * an epic that still exists would read as un-gated on it. A self-edge is the
 * one edge not restored — it is invalid (`set_epic_deps` refuses one).
 *
 * @param {number[]} dependentEpicIds  epics whose `epic_deps` row waits on `epicId`
 */
export async function deleteEpicFreeingDependents(darwinUri, idToken, epicId, dependentEpicIds = []) {
    const undos = [];
    try {
        for (const dependentId of dependentEpicIds) {
            try {
                await deleteEpicDep(darwinUri, idToken, dependentId, epicId);
            } catch (error) {
                if (error?.httpStatus?.httpStatus !== 404) throw error;
                continue;
            }
            // A self-edge goes with the epic either way; nothing to restore.
            if (dependentId !== epicId) {
                undos.push(() => createEpicDep(darwinUri, idToken, dependentId, epicId));
            }
        }
        return await deleteEpic(darwinUri, idToken, epicId);
    } catch (error) {
        await undoAll(undos);
        throw error;
    }
}

/**
 * HARD-delete requirements — the editors' "also delete its requirements"
 * (req #3967). ONE bulk DELETE, which the gateway runs as ONE statement, so
 * the set goes whole or not at all. Each requirement's seat, session links,
 * test-case links and debug capture CASCADE with it. A 404 means none of them
 * exists any more, which is the goal.
 *
 * Called AFTER the epic or initiative delete, never before: that delete can be
 * refused (and rolled back), and a requirement cannot be brought back.
 *
 * @param {number[]} ids
 */
export async function deleteRequirements(darwinUri, idToken, ids = []) {
    const unique = [...new Set(ids)].filter((id) => id != null);
    if (!unique.length) return null;
    let r;
    try {
        r = await call_rest_api(`${darwinUri}/requirements`, 'DELETE',
            unique.map((id) => ({ id })), idToken);
    } catch (error) {
        if (error?.httpStatus?.httpStatus === 404) return null;
        throw error;
    }
    return assertOk(r, 'deleteRequirements');
}

/**
 * Move a requirement's seat from one epic to another — the ONE implementation
 * of a seat edit in the browser (req #3435 wrote it inline in RequirementDetail;
 * req #3581's plan-visualizer drag-and-drop is its second caller, so it lives
 * here rather than in two copies that could disagree about the order below).
 * Either side may be null: `fromEpicId` null seats an unseated requirement,
 * `toEpicId` null unseats it.
 *
 * Seating is the junction Primary/MCP owns on the orchestration side; the
 * browser write is a KNOWN, ACCEPTED race with a polling engine (user ruling
 * 2026-08-10, recorded at RequirementDetail's epic picker) — do not add a
 * silent refusal here.
 *
 * ## Order of operations — DELETE THE OLD SEAT, THEN INSERT THE NEW
 *
 * THE REVERSE ORDER CANNOT WORK, and this is a schema fact rather than a
 * judgement call. `epic_requirements` has `PRIMARY KEY
 * (requirement_fk)` ALONE — one epic per requirement, the req #3336 stage-2
 * gate ruling — so while the old row exists there is no key for a second one
 * and the INSERT fails 100% of the time on a MOVE. `link_epic_requirement`
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
export async function moveEpicRequirement(darwinUri, idToken,
    { requirementId, fromEpicId = null, toEpicId = null }) {
    if (fromEpicId === toEpicId) return;
    const uri = `${darwinUri}/epic_requirements`;
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
    if (fromEpicId != null) {
        await write('unseat', 'DELETE', { epic_fk: fromEpicId, requirement_fk: requirementId });
    }
    if (toEpicId != null) {
        await write('seat', 'POST', { epic_fk: toEpicId, requirement_fk: requirementId });
    }
}

/**
 * Add one dependency edge: epic `epicId` waits on epic `depEpicId`. A single
 * `epic_deps` row; the gateway derives ownership from `epic_fk` and
 * verifies `dep_epic_fk` (Lambda-Rest JUNCTION_OWNERSHIP).
 */
export async function createEpicDep(darwinUri, idToken, epicId, depEpicId) {
    const r = await call_rest_api(`${darwinUri}/epic_deps`, 'POST',
        { epic_fk: epicId, dep_epic_fk: depEpicId }, idToken);
    return assertOk(r, 'createEpicDep');
}

/** Remove one dependency edge, addressed by both columns (the UNIQUE key). */
export async function deleteEpicDep(darwinUri, idToken, epicId, depEpicId) {
    const r = await call_rest_api(`${darwinUri}/epic_deps`, 'DELETE',
        { epic_fk: epicId, dep_epic_fk: depEpicId }, idToken);
    return assertOk(r, 'deleteEpicDep');
}

// The new row's id out of a POST response. The gateway reads the row back as a
// one-element ARRAY; a 201 with no body (its read-back failed after the INSERT
// committed) carries none, and the caller must say so rather than guess.
export const createdRowOf = (data) => (Array.isArray(data) ? data[0] : data) || null;

function requireCreatedId(data) {
    const row = createdRowOf(data);
    if (row?.id == null) {
        const error = new Error('The epic was created but its id could not be read back, '
            + 'so its dependencies were not written — wire it from the plan.');
        // The row EXISTS; a retry would create a second one.
        error.orphanEpic = true;
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
            console.error('epic write rollback failed', e);
        }
    }
}

/**
 * Create an epic and gate it on `fromEpicId` — the canvas's DEPENDENT "+"
 * (req #3586): a new epic that depends on that one epic alone. Neither write
 * can introduce a cycle (the new epic has no dependents), and both epics are
 * in the same plan by construction. A failed edge deletes the new epic. (The
 * one exception is a create whose id cannot be read back — flagged
 * `orphanEpic`, because nothing can address the row to delete it.)
 *
 * @returns {Promise<Object>} the created epic row
 */
export async function addDependentEpic(darwinUri, idToken, { fromEpicId, initiative_fk, title }) {
    const created = requireCreatedId(await createEpic(darwinUri, idToken, { initiative_fk, title }));
    const epicId = created.id;
    try {
        await createEpicDep(darwinUri, idToken, epicId, fromEpicId);
    } catch (error) {
        await undoAll([() => deleteEpic(darwinUri, idToken, epicId)]);
        throw error;
    }
    return created;
}

/**
 * Create an epic and gate `toEpicId` on it — the canvas's PRECEDE "+" off a
 * card's free left side (req #3617): a new epic N that the existing epic will
 * then depend on, N → T. No cycle is possible (N is new, so nothing reaches
 * it). A failed edge undoes both writes — T → N first, because a write
 * reported as failed may still have landed and N cannot be deleted while T
 * waits on it (`dep_epic_fk` is ON DELETE RESTRICT).
 *
 * @returns {Promise<Object>} the created epic row
 */
export async function precedeEpicWith(darwinUri, idToken, { toEpicId, initiative_fk, title }) {
    const created = requireCreatedId(await createEpic(darwinUri, idToken, { initiative_fk, title }));
    const epicId = created.id;
    const undos = [() => deleteEpic(darwinUri, idToken, epicId)];
    try {
        undos.push(() => deleteEpicDep(darwinUri, idToken, toEpicId, epicId));
        await createEpicDep(darwinUri, idToken, toEpicId, epicId);
    } catch (error) {
        await undoAll(undos);
        throw error;
    }
    return created;
}

/**
 * SPLIT the edge `toEpicId` → `fromEpicId` with a new epic — the canvas's
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
 * @returns {Promise<Object>} the created epic row
 */
export async function insertEpicOnEdge(darwinUri, idToken,
    { fromEpicId, toEpicId, initiative_fk, title }) {
    const created = requireCreatedId(await createEpic(darwinUri, idToken, { initiative_fk, title }));
    const epicId = created.id;
    // Deleting N cascades its own N → A row, so the undo list never names it.
    const undos = [() => deleteEpic(darwinUri, idToken, epicId)];
    try {
        await createEpicDep(darwinUri, idToken, epicId, fromEpicId);
        undos.push(() => deleteEpicDep(darwinUri, idToken, toEpicId, epicId));
        await createEpicDep(darwinUri, idToken, toEpicId, epicId);
    } catch (error) {
        await undoAll(undos);
        throw error;
    }
    try {
        await deleteEpicDep(darwinUri, idToken, toEpicId, fromEpicId);
    } catch (error) {
        if (error?.httpStatus?.httpStatus !== 404) {
            error.redundantEdge = true;
            throw error;
        }
    }
    return created;
}
