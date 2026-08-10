// Mutation utilities for the pipeline2_epics data type (req #3393).
//
// Goes through the same generic gateway path darwin-mcp/services/pipelines2.py
// already POSTs/PUTs/DELETEs: `{darwinUri}/pipeline2_epics`. No new backend
// surface exists or is needed. Pattern mirrors Epics/epicsApi.js — this is its
// pipeline2 sibling, not an import of it (see devopsQueries2.js's header for
// why 2.0 code carries no import edge into any 1.0 file).
//
// Column shape (from darwin-mcp/services/pipelines2.py's create/update
// functions):
//   pipeline_fk   required, NOT re-homable from this module — that is
//                 `move_pipeline2_epic`, an MCP-only tool with cross-plan-edge
//                 checks this page deliberately does not reproduce.
//   title         NOT NULL
//   description   nullable TEXT
//   category_fk   required, ON DELETE RESTRICT
//   epic_status   active|paused
//   sort_order    nullable SMALLINT, NULL = derived order
//   closed        0 | 1

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

// Lambda-Rest's PUT convention: the literal string 'NULL' clears a column; a
// JSON null is not the sentinel it recognizes there. POST takes a real null.
export const REST_NULL = 'NULL';

export async function createEpic2(darwinUri, idToken,
    { pipeline_fk, title, description = null, category_fk, sort_order = null,
      epic_status = 'active' }) {
    const r = await call_rest_api(`${darwinUri}/pipeline2_epics`, 'POST',
        { pipeline_fk, title, description, category_fk, sort_order, epic_status },
        idToken);
    return assertOk(r, 'createEpic2');
}

// `fields` is a partial update. `pipeline_fk` is deliberately never accepted
// here — the dialog disables that field once editing, matching the rule this
// module states above.
export async function updateEpic2(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/pipeline2_epics`, 'PUT',
        [{ id, ...fields }], idToken);
    return assertOk(r, 'updateEpic2');
}

// Hard delete, ONE statement — deliberately not the MCP's two-phase
// clear-dep-rows-then-delete dance (`delete_pipeline2_epic` in
// darwin-mcp/services/pipelines2.py), for the same reason Steps/stepsApi.js's
// `deleteStep` gives for staying single-statement: a browser owes no receipt
// and a partial multi-statement failure here would leave the epic's steps
// alive and stripped of their gates, which every reader would treat as
// eligible-immediately. `pipeline2_step_deps.dep_step_fk` is ON DELETE
// RESTRICT, so a cascade the database cannot complete cleanly comes back as a
// 409 with the plan untouched — the worst case is a named refusal, not a
// corrupted plan. EpicsPage2's confirm dialog says so.
export async function deleteEpic2(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/pipeline2_epics`, 'DELETE', { id }, idToken);
    return assertOk(r, 'deleteEpic2');
}
