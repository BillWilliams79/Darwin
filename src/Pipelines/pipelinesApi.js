// Mutation utilities for the pipelines data type (req #3393).
//
// Goes through the same generic gateway path darwin-mcp/services/pipelines2.py
// already POSTs/PUTs to: `{darwinUri}/pipelines`. No new backend
// surface exists or is needed. Pattern mirrors Epics/epicsApi.js.
//
// No `createPipeline`/`deletePipeline` here — PipelinesPage2 has no create
// or delete affordance (pipelines are created via the MCP `create_pipeline`
// tool by the Primary AI, matching 1.0's PipelinesPage.jsx, which carries no
// create control of its own either). Only the two fields this page edits —
// `execution_mode` and `description` — need a write path.
//
// Column shape (from darwin-mcp/services/pipelines2.py's `update_pipeline`):
//   title           NOT NULL
//   description     nullable TEXT
//   pipeline_status draft|active|paused|completed|aborted
//   execution_mode  parallel|serial
//   machine_fk      nullable

import call_rest_api from '../RestApi/RestApi';

const isOk = (status) => status === 200 || status === 201 || status === 204;

// Same two-shape error contract every *Api.js module in this codebase uses —
// see Epics/epicsApi.js for the full rationale.
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
