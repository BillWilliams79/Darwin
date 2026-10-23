// Mutation utilities for the initiatives data type (req #3393).
//
// Goes through the same generic gateway path darwin-mcp/services/pipelines2.py
// already POSTs/PUTs/DELETEs: `{darwinUri}/initiatives`. No new backend
// surface exists or is needed. Pattern mirrors Initiatives/initiativesApi.js — this is its
// server-side sibling, not an import of it (see pipelinesViewModel.js's header
// for why this file stays a structural copy rather than an import).
//
// Column shape (from darwin-mcp/services/pipelines2.py's create/update
// functions):
//   pipeline_fk   required, NOT re-homable from this module — that is
//                 `move_initiative`, an MCP-only tool with cross-plan-edge
//                 checks this page deliberately does not reproduce.
//   title         NOT NULL
//   description   nullable TEXT
//   category_fk   required, ON DELETE RESTRICT
//   initiative_status   active|paused
//   sort_order    SMALLINT, the plan's HARD initiative order (req #3861). The
//                 column is nullable, but no writer leaves it NULL: a create
//                 that names none is appended to its plan (`createInitiative`),
//                 and the plan canvas re-orders by dragging the name bar.
//   closed        0 | 1

import call_rest_api from '../RestApi/RestApi';
import { fetchEntity } from '../hooks/factory/createEntityQueries';
import { nextInitiativeSortOrder } from '../SwarmView/pipelines/pipelineInitiativeDrag';

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
// Epics/epicsApi.js rule, ported to this module by code review, req #3393:
// InitiativesPage validated only that a trimmed title was non-empty, so a title of
// exactly "NULL" sailed through to a NOT NULL column and surfaced as an
// opaque 500 instead of a readable refusal).
export const REST_NULL = 'NULL';

/** Whether a user-typed value would be swallowed by the REST_NULL sentinel. */
export const isRestNullLiteral = (value) => String(value ?? '').trim() === REST_NULL;

// An initiative with no `sort_order` given is APPENDED to its plan — one past the
// plan's highest — so every initiative carries a hard place in the order
// (req #3861). One extra read, on a create only.
export async function createInitiative(darwinUri, idToken,
    { pipeline_fk, title, description = null, category_fk, sort_order = null,
      initiative_status = 'active' }) {
    if (sort_order == null && pipeline_fk != null) {
        const siblings = await fetchEntity(
            `${darwinUri}/initiatives?pipeline_fk=${pipeline_fk}&fields=id,sort_order`, idToken);
        sort_order = nextInitiativeSortOrder(Array.isArray(siblings) ? siblings : []);
    }
    const r = await call_rest_api(`${darwinUri}/initiatives`, 'POST',
        { pipeline_fk, title, description, category_fk, sort_order, initiative_status },
        idToken);
    return assertOk(r, 'createInitiative');
}

// `fields` is a partial update. `pipeline_fk` is deliberately never accepted
// here — the dialog disables that field once editing, matching the rule this
// module states above.
export async function updateInitiative(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/initiatives`, 'PUT',
        [{ id, ...fields }], idToken);
    return assertOk(r, 'updateInitiative');
}

/**
 * Write a plan's re-ordered initiatives (req #3861) — `[{id, sort_order}]`, the
 * changed rows only. ONE bulk PUT, which the gateway runs as ONE UPDATE: a lock
 * on any row refuses the whole request (423), so a re-order never half-lands.
 */
export async function reorderInitiatives(darwinUri, idToken, writes) {
    if (!writes?.length) return null;
    const r = await call_rest_api(`${darwinUri}/initiatives`, 'PUT',
        writes.map(({ id, sort_order }) => ({ id, sort_order })), idToken);
    return assertOk(r, 'reorderInitiatives');
}

/**
 * HARD-delete an initiative and its epics — TWO-PHASE, matching the MCP's own
 * `delete_initiative` (darwin-mcp/services/pipelines2.py).
 *
 * Code review (req #3393) found the original single-statement version was
 * not merely stricter than the MCP path, it was NON-FUNCTIONAL for almost
 * every real initiative: `epic_deps.dep_epic_fk` is ON DELETE RESTRICT,
 * and the schema's own design intent is that a dependency edge never crosses
 * an initiative — so an initiative with more than one epic routinely has an edge
 * ENTIRELY WITHIN ITSELF (epic_fk and dep_epic_fk both belong to this initiative).
 * Deleting the initiative cascades to delete that epic, which MySQL evaluates the
 * RESTRICT against even though the referencing row is itself part of the
 * same cascade (documented in darwin-mcp/tests/conftest.py for this exact
 * table) — so the single-statement version refused EVERY such delete, and
 * named a cause ("another epic outside it depends on one of its epics") that
 * could not be true for a self-contained edge.
 *
 * So: read this initiative's epic ids, read every dep row whose `dep_epic_fk`
 * names one of them (both directions matter — the row's OWN `epic_fk` may be
 * inside this initiative or outside it), and split on that split:
 *   - external (the referencing epic_fk belongs to a DIFFERENT initiative) — this
 *     is the real, design-rule-4 refusal (an epic something outside this initiative
 *     depends on cannot be removed out from under it). REFUSE, naming the
 *     blocking epics, same wording the single-statement version already used.
 *   - internal (the referencing epic_fk is also one of this initiative's own
 *     epics) — this is the false refusal above. Clear these first, exactly
 *     as the MCP does, then the initiative delete cascades cleanly.
 */
export async function deleteInitiative(darwinUri, idToken, id) {
    const epicRows = await fetchEntity(
        `${darwinUri}/epics?initiative_fk=${id}&fields=id,locked`, idToken);
    const epics = Array.isArray(epicRows) ? epicRows : [];
    const epicIds = epics.map((r) => r.id);

    // NOTHING IS WRITTEN WHILE ANYTHING IN THE CHAIN IS LOCKED (req #3649).
    // The gateway refuses each locked row's own delete, but the intra-initiative
    // dependency rows go first below — so a lock found only there would leave
    // the initiative alive with its gates stripped. The initiative, its plan and its
    // epics are checked BEFORE the first write.
    const initiativeRows = await fetchEntity(
        `${darwinUri}/initiatives?id=${id}&fields=id,pipeline_fk,locked`, idToken);
    const initiative = (Array.isArray(initiativeRows) ? initiativeRows : [])[0] || {};
    const planRows = initiative.pipeline_fk != null ? await fetchEntity(
        `${darwinUri}/pipelines?id=${initiative.pipeline_fk}&fields=id,locked`, idToken) : [];
    const plan = (Array.isArray(planRows) ? planRows : [])[0] || {};
    const lockedEpics = epics.filter((s) => Number(s.locked) === 1).map((s) => s.id);
    if (Number(plan.locked) === 1 || Number(initiative.locked) === 1 || lockedEpics.length) {
        const held = Number(plan.locked) === 1 ? `its plan ${plan.id}`
            : Number(initiative.locked) === 1 ? 'the initiative itself'
                : `epic${lockedEpics.length === 1 ? '' : 's'} ${lockedEpics.join(', ')} under it`;
        const error = new Error(`Initiative ${id} cannot be deleted: ${held} is locked — unlock it first.`);
        error.httpStatus = { httpStatus: 423, httpMessage: 'Locked' };
        throw error;
    }

    if (epicIds.length) {
        // `field=(a,b,c)` is Lambda-Rest's IN-list filter syntax — the
        // parens are load-bearing (see RequirementDetail.jsx / DomainEdit.jsx
        // for the same convention); a bare comma-joined value is read as one
        // literal string, not a list.
        const referencing = await fetchEntity(
            `${darwinUri}/epic_deps?dep_epic_fk=(${epicIds.join(',')})`
            + '&fields=id,epic_fk,dep_epic_fk', idToken);
        const rows = Array.isArray(referencing) ? referencing : [];
        const ownSet = new Set(epicIds);
        const external = rows.filter((row) => !ownSet.has(row.epic_fk));
        if (external.length) {
            const blockers = [...new Set(external.map((row) => row.epic_fk))].sort((a, b) => a - b);
            const error = new Error(
                `Initiative ${id} cannot be deleted: epic${blockers.length === 1 ? '' : 's'} `
                + `${blockers.join(', ')} outside it depend${blockers.length === 1 ? 's' : ''} `
                + 'on one of its epics. Re-point or remove those dependencies first.');
            error.httpStatus = { httpStatus: 409, httpMessage: 'Conflict' };
            throw error;
        }
        const internal = rows.filter((row) => ownSet.has(row.epic_fk));
        if (internal.length) {
            // ONE DELETE per row, not a single array-bodied call — the
            // generic Lambda-Rest DELETE route's bulk-by-array-of-ids
            // support is a fact about `Lambda-Rest/rest_delete.py`, which
            // this session cannot read to verify (see epicsApi.js's header
            // for the same constraint elsewhere in this feature). A loop of
            // single-id deletes is the form every *Api.js module in this
            // codebase already uses and is known to work.
            await Promise.all(internal.map((row) => call_rest_api(
                `${darwinUri}/epic_deps`, 'DELETE', { id: row.id }, idToken)
                .then((r) => assertOk(r, 'deleteInitiative (clearing an intra-initiative dependency edge)'))));
        }
    }

    const r = await call_rest_api(`${darwinUri}/initiatives`, 'DELETE', { id }, idToken);
    return assertOk(r, 'deleteInitiative');
}
