// Mutation utilities for the epics data type (req #3139).
//
// Epics are the top tier of Epic > Step (req #3111, migration 076). The
// frontend has read them since req #3114 (`useAllEpics`, `useEpicById`) but
// had no write path at all — the only epic surfaces were the plan
// visualizer's epic chip and the (since-retired) `/swarm/features?epic=<id>`
// filter it navigated to. This module is the write half, and it goes through
// the SAME gateway path the MCP
// epic service (`darwin-mcp/services/epics.py`, req #3146) already POSTs, PUTs
// and DELETEs: `{darwinUri}/epics`. No new backend surface exists or is needed.
//
// Pattern mirrors Customers/customersApi.js — call_rest_api directly, callers
// handle TanStack Query cache invalidation via queryClient.invalidateQueries.
//
// Column shape (measured against the live schema via services/epics.py):
//   title        NOT NULL
//   description  nullable TEXT
//   category_fk  required, ON DELETE RESTRICT — an epic always has a category
//   sort_order   nullable INT
//   closed       0 | 1

import call_rest_api from '../RestApi/RestApi';

const isOk = (status) => status === 200 || status === 201 || status === 204;

// Only ever reached for the status call_rest_api RETURNS rather than throws —
// the synthetic 503 it manufactures for a transport-level failure. Every
// gateway error (4xx/5xx) is thrown from call_rest_api as a bare
// `{data, httpStatus}` object and never arrives here at all. The thrown Error
// carries `httpStatus` so that BOTH shapes read identically to
// useSnackBarStore's two-argument form, which renders the status code beside
// the caller's message.
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
// JSON null is not the sentinel it recognizes there (same rule the MCP
// `update_epic` obeys). POST is different — it takes a real null — so this is
// applied on the PUT path only.
export const REST_NULL = 'NULL';

export async function createEpic(darwinUri, idToken,
    { title, description = null, category_fk, sort_order = null }) {
    const r = await call_rest_api(`${darwinUri}/epics`, 'POST',
        { title, description, category_fk, sort_order }, idToken);
    return assertOk(r, 'createEpic');
}

// `fields` is a partial update. Nullable columns the caller wants CLEARED must
// arrive as REST_NULL; EpicsPage's dialog does that conversion where it knows
// which fields are nullable, rather than this transport guessing from a falsy
// value (an empty-string title and a cleared description are not the same act).
export async function updateEpic(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/epics`, 'PUT', [{ id, ...fields }], idToken);
    return assertOk(r, 'updateEpic');
}

// Hard delete. Nothing RESTRICTs an epic's own deletion: `features.epic_fk` and
// `swarm_sessions.epic_fk` are both ON DELETE SET NULL, so the rows that pointed
// at it are unfiled by the database, never destroyed. Callers warn accordingly.
export async function deleteEpic(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/epics`, 'DELETE', { id }, idToken);
    return assertOk(r, 'deleteEpic');
}
