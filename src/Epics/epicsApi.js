// Mutation utilities for the epics data type (req #3393).
//
// Goes through the same generic gateway path darwin-mcp/services/pipelines2.py
// already POSTs/PUTs/DELETEs: `{darwinUri}/epics`. No new backend
// surface exists or is needed. Pattern mirrors Epics/epicsApi.js — this is its
// server-side sibling, not an import of it (see pipelinesViewModel.js's header
// for why this file stays a structural copy rather than an import).
//
// Column shape (from darwin-mcp/services/pipelines2.py's create/update
// functions):
//   pipeline_fk   required, NOT re-homable from this module — that is
//                 `move_epic`, an MCP-only tool with cross-plan-edge
//                 checks this page deliberately does not reproduce.
//   title         NOT NULL
//   description   nullable TEXT
//   category_fk   required, ON DELETE RESTRICT
//   epic_status   active|paused
//   sort_order    nullable SMALLINT, NULL = derived order
//   closed        0 | 1

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

// Lambda-Rest's PUT convention: the literal string 'NULL' clears a column; a
// JSON null is not the sentinel it recognizes there. POST takes a real null.
// NOT PUT-only — `rest_post.py` applies the identical substitution (the
// Steps/stepsApi.js rule, ported to this module by code review, req #3393:
// EpicsPage2 validated only that a trimmed title was non-empty, so a title of
// exactly "NULL" sailed through to a NOT NULL column and surfaced as an
// opaque 500 instead of a readable refusal).
export const REST_NULL = 'NULL';

/** Whether a user-typed value would be swallowed by the REST_NULL sentinel. */
export const isRestNullLiteral = (value) => String(value ?? '').trim() === REST_NULL;

export async function createEpic(darwinUri, idToken,
    { pipeline_fk, title, description = null, category_fk, sort_order = null,
      epic_status = 'active' }) {
    const r = await call_rest_api(`${darwinUri}/epics`, 'POST',
        { pipeline_fk, title, description, category_fk, sort_order, epic_status },
        idToken);
    return assertOk(r, 'createEpic');
}

// `fields` is a partial update. `pipeline_fk` is deliberately never accepted
// here — the dialog disables that field once editing, matching the rule this
// module states above.
export async function updateEpic(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/epics`, 'PUT',
        [{ id, ...fields }], idToken);
    return assertOk(r, 'updateEpic');
}

/**
 * HARD-delete an epic and its steps — TWO-PHASE, matching the MCP's own
 * `delete_epic` (darwin-mcp/services/pipelines2.py).
 *
 * Code review (req #3393) found the original single-statement version was
 * not merely stricter than the MCP path, it was NON-FUNCTIONAL for almost
 * every real epic: `pipeline_step_deps.dep_step_fk` is ON DELETE RESTRICT,
 * and the schema's own design intent is that a dependency edge never crosses
 * an epic — so an epic with more than one step routinely has an edge
 * ENTIRELY WITHIN ITSELF (step_fk and dep_step_fk both belong to this epic).
 * Deleting the epic cascades to delete that step, which MySQL evaluates the
 * RESTRICT against even though the referencing row is itself part of the
 * same cascade (documented in darwin-mcp/tests/conftest.py for this exact
 * table) — so the single-statement version refused EVERY such delete, and
 * named a cause ("another step outside it depends on one of its steps") that
 * could not be true for a self-contained edge.
 *
 * So: read this epic's step ids, read every dep row whose `dep_step_fk`
 * names one of them (both directions matter — the row's OWN `step_fk` may be
 * inside this epic or outside it), and split on that split:
 *   - external (the referencing step_fk belongs to a DIFFERENT epic) — this
 *     is the real, design-rule-4 refusal (a step something outside this epic
 *     depends on cannot be removed out from under it). REFUSE, naming the
 *     blocking steps, same wording the single-statement version already used.
 *   - internal (the referencing step_fk is also one of this epic's own
 *     steps) — this is the false refusal above. Clear these first, exactly
 *     as the MCP does, then the epic delete cascades cleanly.
 */
export async function deleteEpic(darwinUri, idToken, id) {
    const stepRows = await fetchEntity(
        `${darwinUri}/pipeline_steps?epic_fk=${id}&fields=id`, idToken);
    const stepIds = (Array.isArray(stepRows) ? stepRows : []).map((r) => r.id);

    if (stepIds.length) {
        // `field=(a,b,c)` is Lambda-Rest's IN-list filter syntax — the
        // parens are load-bearing (see RequirementDetail.jsx / DomainEdit.jsx
        // for the same convention); a bare comma-joined value is read as one
        // literal string, not a list.
        const referencing = await fetchEntity(
            `${darwinUri}/pipeline_step_deps?dep_step_fk=(${stepIds.join(',')})`
            + '&fields=id,step_fk,dep_step_fk', idToken);
        const rows = Array.isArray(referencing) ? referencing : [];
        const ownSet = new Set(stepIds);
        const external = rows.filter((row) => !ownSet.has(row.step_fk));
        if (external.length) {
            const blockers = [...new Set(external.map((row) => row.step_fk))].sort((a, b) => a - b);
            const error = new Error(
                `Epic ${id} cannot be deleted: step${blockers.length === 1 ? '' : 's'} `
                + `${blockers.join(', ')} outside it depend${blockers.length === 1 ? 's' : ''} `
                + 'on one of its steps. Re-point or remove those dependencies first.');
            error.httpStatus = { httpStatus: 409, httpMessage: 'Conflict' };
            throw error;
        }
        const internal = rows.filter((row) => ownSet.has(row.step_fk));
        if (internal.length) {
            // ONE DELETE per row, not a single array-bodied call — the
            // generic Lambda-Rest DELETE route's bulk-by-array-of-ids
            // support is a fact about `Lambda-Rest/rest_delete.py`, which
            // this session cannot read to verify (see stepsApi.js's header
            // for the same constraint elsewhere in this feature). A loop of
            // single-id deletes is the form every *Api.js module in this
            // codebase already uses and is known to work.
            await Promise.all(internal.map((row) => call_rest_api(
                `${darwinUri}/pipeline_step_deps`, 'DELETE', { id: row.id }, idToken)
                .then((r) => assertOk(r, 'deleteEpic (clearing an intra-epic dependency edge)'))));
        }
    }

    const r = await call_rest_api(`${darwinUri}/epics`, 'DELETE', { id }, idToken);
    return assertOk(r, 'deleteEpic');
}
