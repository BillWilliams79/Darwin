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
 * born incomplete. Requirement links and dependency rows are not created
 * either: seating is MCP/Primary-only (see this module's header and
 * `Darwin/src/Steps/StepsPage.jsx`'s identical rule for 1.0).
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
