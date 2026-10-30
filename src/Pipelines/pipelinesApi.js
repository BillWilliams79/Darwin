// Mutation utilities for the pipelines data type (req #3393).
//
// Goes through the same generic gateway path darwin-mcp/services/pipelines2.py
// already POSTs/PUTs to: `{darwinUri}/pipelines`. No new backend
// surface exists or is needed. Pattern mirrors Initiatives/initiativesApi.js.
//
// `createPipeline` (req #3773) backs the page's two create controls — the
// header's "New pipeline" dialog and the Cards view's "New pipeline" tile. It
// writes the same row the MCP `create_pipeline` tool does.
//
// `deletePipeline` (req #3934) backs the card menu's "Delete pipeline". It is
// the MCP `delete_pipeline`'s two-phase delete WITHOUT its authoring-only refusal —
// this is the "delete a plan that has run" that tool's docstring defers.
//
// Column shape (from darwin-mcp/services/pipelines2.py's `update_pipeline`):
//   title           NOT NULL
//   description     nullable TEXT
//   pipeline_status authoring|authorized|orchestration_ready|orchestrating|
//                   met|wontfix|deferred (req #3965; the gateway derives
//                   started_at/completed_at from it, for every writer)
//   machine_fk      nullable
//   sort_order      nullable INT — req #3804: the card's place on the page
// (`closed`, req #3804's parking flag, was dropped by req #3965 — a finished
// plan is a terminal status.)

import call_rest_api from '../RestApi/RestApi';
import { fetchEntity } from '../hooks/factory/createEntityQueries';
import { isStale } from '../SwarmView/pipelines/orchestrationHolder';
import { NEW_PIPELINE_STATUS } from '../SwarmView/pipelines/pipelineChipStyles';

const isOk = (status) => status === 200 || status === 201 || status === 204;

// Same two-shape error contract every *Api.js module in this codebase uses —
// see Initiatives/initiativesApi.js for the full rationale.
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

// Lambda-Rest's PUT convention: the literal string 'NULL' clears a column.
export const REST_NULL = 'NULL';

/**
 * Update a pipeline's own columns. `fields` is a partial update; nullable
 * columns the caller wants CLEARED must arrive as REST_NULL.
 */
export async function updatePipeline(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/pipelines`, 'PUT',
        [{ id, ...fields }], idToken);
    return assertOk(r, 'updatePipeline');
}

/**
 * Write several plans' columns in ONE PUT (req #3804 — a card drag renumbers
 * every card it moved past). `rows` is `[{id, ...fields}]`.
 */
export async function updatePipelines(darwinUri, idToken, rows) {
    const r = await call_rest_api(`${darwinUri}/pipelines`, 'PUT', rows, idToken);
    return assertOk(r, 'updatePipelines');
}

/** Whether a user-typed value would be swallowed by the REST_NULL sentinel. */
export const isRestNullLiteral = (value) => String(value ?? '').trim() === REST_NULL;

/**
 * Create a plan and return its id (req #3773).
 *
 * The body is darwin-mcp's `create_pipeline` row for its defaults: a new plan
 * is born `authoring` (req #3965), a status the gateway stamps no time for —
 * `started_at` and `completed_at` go in as real nulls. POST takes a real null (the 'NULL'
 * string is the sentinel, so a title of exactly "NULL" is the caller's to
 * refuse — see `isRestNullLiteral`).
 *
 * Returns the new row's id, or null when the gateway wrote the row but sent no
 * body back (the 201-with-no-body case `epicsApi.js` documents). A caller must
 * NOT retry on null — that would make a second plan.
 */
export async function createPipeline(darwinUri, idToken,
    { title, description = null, machine_fk = null, sort_order = null }) {
    const r = await call_rest_api(`${darwinUri}/pipelines`, 'POST', {
        title,
        description,
        pipeline_status: NEW_PIPELINE_STATUS,
        machine_fk,
        locked: 0,
        // req #3804 — the caller places it (the page passes the front slot).
        sort_order,
        // No started_at / completed_at: the gateway derives both from the
        // status (req #3965), and a key sent as null would count as the
        // caller's own value and suppress the stamp.
    }, idToken);
    const data = assertOk(r, 'createPipeline');
    const row = Array.isArray(data) ? data[0] : data;
    return row?.id ?? null;
}

const rowsOf = (data) => (Array.isArray(data) ? data : []);

function namedRefusal(message, httpStatus, httpMessage) {
    const error = new Error(message);
    error.httpStatus = { httpStatus, httpMessage };
    error.namedRefusal = true;
    return error;
}

// "epic 4" / "epics 4, 7"
const plural = (noun, ids) => `${noun}${ids.length === 1 ? '' : 's'} ${ids.join(', ')}`;
const distinctSorted = (values) => [...new Set(values)].sort((a, b) => a - b);

/**
 * HARD-delete a plan (req #3934): its initiatives, their epics, the epics'
 * requirement seats and every dependency edge inside it. The REQUIREMENTS are
 * not deleted — they come out unseated. Any status may be deleted.
 *
 * ## What the schema does, and the one thing it will not
 *
 * `pipelines` -> `initiatives` -> `epics` -> `epic_requirements` CASCADE, as do
 * the plan's `orchestration_claims` and engine rows; `swarm_sessions.pipeline_fk`
 * is SET NULL, so session history survives. What will NOT cascade is the two
 * RESTRICT edges, `epic_deps.dep_epic_fk` and `initiative_deps.dep_initiative_fk`:
 * MySQL refuses one even when both of its ends are inside the same cascade
 * (measured for both — see `deleteInitiative` and darwin-mcp's
 * `delete_pipeline`). So those edges are cleared FIRST, then the plan goes in
 * one statement.
 *
 * ## Nothing is written until the delete is known to be allowed
 *
 * The edges go first, so every refusal is found BEFORE that — otherwise a
 * refused plan delete would leave the plan alive with its gates stripped:
 *   - anything LOCKED in the chain (the gateway answers 423 on the plan row
 *     anyway, req #3649 — this says so first, by name);
 *   - a LIVE orchestration claim on the plan or any initiative in it: the
 *     cascade would take the claim and engine rows out from under a running
 *     engine, so it is `/pipeline-stop`ped first. A stale claim just goes with
 *     the plan (staleness as the holder chip judges it, `isStale`);
 *   - an epic or initiative OUTSIDE this plan that waits on one inside it —
 *     deleting would release that gate (`set_epic_deps` / the initiative-deps
 *     guard refuse cross-plan edges, so this is a should-not-happen, refused
 *     by name rather than broken silently).
 * If a write after the first edge delete fails, the removed edges are
 * re-created (best effort) and the ORIGINAL error is rethrown.
 */
export async function deletePipeline(darwinUri, idToken, id) {
    const planRows = rowsOf(await fetchEntity(
        `${darwinUri}/pipelines?id=${id}&fields=id,title,locked`, idToken));
    const plan = planRows[0];
    if (!plan) throw namedRefusal(`Pipeline ${id} was not found — it may already be deleted.`, 404, 'NOT FOUND');

    const initiatives = rowsOf(await fetchEntity(
        `${darwinUri}/initiatives?pipeline_fk=${id}&fields=id,locked`, idToken));
    const initiativeIds = initiatives.map((r) => r.id);
    // `field=(a,b,c)` is Lambda-Rest's IN-list filter — the parens are
    // load-bearing (see `deleteInitiative`).
    const epics = initiativeIds.length ? rowsOf(await fetchEntity(
        `${darwinUri}/epics?initiative_fk=(${initiativeIds.join(',')})&fields=id,locked`,
        idToken)) : [];
    const epicIds = epics.map((r) => r.id);

    const lockedInitiatives = initiatives.filter((r) => Number(r.locked) === 1).map((r) => r.id);
    const lockedEpics = epics.filter((r) => Number(r.locked) === 1).map((r) => r.id);
    if (Number(plan.locked) === 1 || lockedInitiatives.length || lockedEpics.length) {
        const held = Number(plan.locked) === 1 ? 'the plan itself'
            : lockedInitiatives.length ? `${plural('initiative', lockedInitiatives)} in it`
                : `${plural('epic', lockedEpics)} in it`;
        throw namedRefusal(`"${plan.title}" cannot be deleted: ${held} is locked — unlock it first.`,
            423, 'Locked');
    }

    const liveClaims = rowsOf(await fetchEntity(
        `${darwinUri}/orchestration_claims?pipeline_fk=${id}&fields=id,pipeline_fk,initiative_fk,claimed_at,update_ts`,
        idToken)).filter((c) => !isStale(c));
    if (liveClaims.length) {
        throw namedRefusal(`"${plan.title}" cannot be deleted: an orchestrator is running it — `
            + '/pipeline-stop it first.', 409, 'Conflict');
    }

    const initiativeEdges = initiativeIds.length ? rowsOf(await fetchEntity(
        `${darwinUri}/initiative_deps?dep_initiative_fk=(${initiativeIds.join(',')})`
        + '&fields=id,initiative_fk,dep_initiative_fk', idToken)) : [];
    const epicEdges = epicIds.length ? rowsOf(await fetchEntity(
        `${darwinUri}/epic_deps?dep_epic_fk=(${epicIds.join(',')})`
        + '&fields=id,epic_fk,dep_epic_fk', idToken)) : [];

    const ownInitiatives = new Set(initiativeIds);
    const ownEpics = new Set(epicIds);
    const outsideInitiatives = distinctSorted(initiativeEdges
        .filter((r) => !ownInitiatives.has(r.initiative_fk)).map((r) => r.initiative_fk));
    const outsideEpics = distinctSorted(epicEdges
        .filter((r) => !ownEpics.has(r.epic_fk)).map((r) => r.epic_fk));
    if (outsideInitiatives.length || outsideEpics.length) {
        const who = outsideInitiatives.length ? plural('initiative', outsideInitiatives)
            : plural('epic', outsideEpics);
        throw namedRefusal(`"${plan.title}" cannot be deleted: ${who} in another plan `
            + `wait${who.includes(', ') ? '' : 's'} on it. Remove those dependencies first.`,
            409, 'Conflict');
    }

    const undos = [];
    try {
        if (initiativeEdges.length) {
            assertOk(await call_rest_api(`${darwinUri}/initiative_deps`, 'DELETE',
                initiativeEdges.map((r) => ({ id: r.id })), idToken),
                'deletePipeline (clearing its initiative dependencies)');
            undos.push(...initiativeEdges.map((r) => () => call_rest_api(
                `${darwinUri}/initiative_deps`, 'POST',
                { initiative_fk: r.initiative_fk, dep_initiative_fk: r.dep_initiative_fk }, idToken)));
        }
        if (epicEdges.length) {
            assertOk(await call_rest_api(`${darwinUri}/epic_deps`, 'DELETE',
                epicEdges.map((r) => ({ id: r.id })), idToken),
                'deletePipeline (clearing its epic dependencies)');
            undos.push(...epicEdges.map((r) => () => call_rest_api(
                `${darwinUri}/epic_deps`, 'POST',
                { epic_fk: r.epic_fk, dep_epic_fk: r.dep_epic_fk }, idToken)));
        }
        assertOk(await call_rest_api(`${darwinUri}/pipelines`, 'DELETE', { id }, idToken),
            'deletePipeline');
    } catch (error) {
        let unrestored = 0;
        for (const undo of undos.reverse()) {
            try {
                const r = await undo();
                if (!isOk(r?.httpStatus?.httpStatus)) {
                    unrestored += 1;
                    console.error('pipeline delete rollback failed', r);
                }
            } catch (e) {
                unrestored += 1;
                console.error('pipeline delete rollback failed', e);
            }
        }
        // The plan survived but lost gates the restore could not put back —
        // that is the reader's to repair, so it rides on the error they see.
        if (unrestored && error instanceof Error) {
            error.message += ` — and ${unrestored} of its ${undos.length} dependency edge`
                + `${undos.length === 1 ? '' : 's'} could not be restored; re-check its dependencies.`;
        }
        throw error;
    }
    return {
        id, title: plan.title, initiative_count: initiativeIds.length, epic_count: epicIds.length,
        dep_rows_removed: epicEdges.length, initiative_dep_rows_removed: initiativeEdges.length,
    };
}
