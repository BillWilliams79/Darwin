// Mutation utilities for the pipelines data type (req #3393).
//
// Goes through the same generic gateway path darwin-mcp/services/pipelines2.py
// already POSTs/PUTs to: `{darwinUri}/pipelines`. No new backend
// surface exists or is needed. Pattern mirrors Initiatives/initiativesApi.js.
//
// `createPipeline` (req #3773) backs the page's two create controls — the
// header's "New pipeline" dialog and the Cards view's "New pipeline" tile. It
// writes the same row the MCP `create_pipeline` tool does. No
// `deletePipeline`: deleting a plan stays an MCP decision (`delete_pipeline`
// refuses unless the plan is `draft` or `aborted`, and is two-phase because of
// a RESTRICT edge this module does not reproduce).
//
// Column shape (from darwin-mcp/services/pipelines2.py's `update_pipeline`):
//   title           NOT NULL
//   description     nullable TEXT
//   pipeline_status draft|active|paused|completed
//   machine_fk      nullable

import call_rest_api from '../RestApi/RestApi';

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

/** Whether a user-typed value would be swallowed by the REST_NULL sentinel. */
export const isRestNullLiteral = (value) => String(value ?? '').trim() === REST_NULL;

/**
 * Create a plan and return its id (req #3773).
 *
 * The body is darwin-mcp's `create_pipeline` row for its defaults: a new plan
 * is born `draft`, so `_derive_timestamps2` stamps nothing — `started_at` and
 * `completed_at` go in as real nulls. POST takes a real null (the 'NULL'
 * string is the sentinel, so a title of exactly "NULL" is the caller's to
 * refuse — see `isRestNullLiteral`).
 *
 * Returns the new row's id, or null when the gateway wrote the row but sent no
 * body back (the 201-with-no-body case `epicsApi.js` documents). A caller must
 * NOT retry on null — that would make a second plan.
 */
export async function createPipeline(darwinUri, idToken,
    { title, description = null, machine_fk = null }) {
    const r = await call_rest_api(`${darwinUri}/pipelines`, 'POST', {
        title,
        description,
        pipeline_status: 'draft',
        machine_fk,
        locked: 0,
        started_at: null,
        completed_at: null,
    }, idToken);
    const data = assertOk(r, 'createPipeline');
    const row = Array.isArray(data) ? data[0] : data;
    return row?.id ?? null;
}
