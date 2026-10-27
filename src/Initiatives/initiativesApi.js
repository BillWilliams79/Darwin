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
import { deleteRequirements } from '../Epics/epicsApi';

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
        error.namedRefusal = true;
        throw error;
    }

    // req #3823 — another initiative WAITS FOR this one: deleting it would
    // release that gate (and `dep_initiative_fk` is RESTRICT, so the gateway
    // would answer a bare 409). Refused by name before any write.
    const waitingRows = await fetchEntity(
        `${darwinUri}/initiative_deps?dep_initiative_fk=${id}&fields=id,initiative_fk`, idToken);
    const waiting = [...new Set((Array.isArray(waitingRows) ? waitingRows : [])
        .map((row) => row.initiative_fk))].sort((a, b) => a - b);
    if (waiting.length) {
        const error = new Error(
            `Initiative ${id} cannot be deleted: initiative${waiting.length === 1 ? '' : 's'} `
            + `${waiting.join(', ')} depend${waiting.length === 1 ? 's' : ''} on it. `
            + 'Remove those initiative dependencies first.');
        error.httpStatus = { httpStatus: 409, httpMessage: 'Conflict' };
        error.namedRefusal = true;
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
            error.namedRefusal = true;
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

// ── The initiative editor's delete (req #3967) ──────────────────────────────
// The editor offers three choices, and states each one's count: the initiative
// (always deleted), its epics (deleted by default; kept by MOVING them into
// another initiative of the plan, because `epics.initiative_fk` is NOT NULL)
// and the requirements seated in those epics (kept by default). Dependencies
// are never a reason to refuse: every edge onto what is deleted is DETACHED —
// an epic outside waiting on one of its epics, an initiative waiting on it.

const rowsOf = (data) => (Array.isArray(data) ? data : []);
const inList = (ids) => `(${ids.join(',')})`;
const sortedUnique = (values) => [...new Set(values)].sort((a, b) => a - b);

function namedRefusal(message, httpStatus, httpMessage) {
    const error = new Error(message);
    error.httpStatus = { httpStatus, httpMessage };
    error.namedRefusal = true;
    return error;
}

/**
 * Read everything the delete would touch — LIVE, at the moment the reader asks
 * to delete, so the counts the editor shows are the rows the delete writes.
 *
 * @returns {Promise<Object>} `{ initiative, epics: [{id, title}], reqIds,
 *   epicEdges: [{id, epic_fk, dep_epic_fk}] (every edge onto its epics),
 *   outsideDependents: epic ids outside it that wait on one of its epics,
 *   waitingEdges: [{id, initiative_fk, dep_initiative_fk}] (initiatives waiting on it),
 *   moveTargets: [{id, title, cycle}] (the plan's other, unlocked initiatives;
 *     `cycle` — moving its epics there would close a gate loop),
 *   blocked: why nothing may be deleted, or null,
 *   blockedDeletingEpics: why its epics may not be deleted (a locked epic
 *     outside waits on one), or null — keeping them detaches no such edge }`
 */
export async function planInitiativeDelete(darwinUri, idToken, id) {
    const initiative = rowsOf(await fetchEntity(
        `${darwinUri}/initiatives?id=${id}&fields=id,title,pipeline_fk,locked`, idToken))[0];
    if (!initiative) {
        throw namedRefusal(`Initiative ${id} was not found — it may already be deleted.`,
            404, 'NOT FOUND');
    }
    const plan = initiative.pipeline_fk != null ? rowsOf(await fetchEntity(
        `${darwinUri}/pipelines?id=${initiative.pipeline_fk}&fields=id,locked`, idToken))[0] || {} : {};
    const siblings = initiative.pipeline_fk != null ? rowsOf(await fetchEntity(
        `${darwinUri}/initiatives?pipeline_fk=${initiative.pipeline_fk}&fields=id,title,locked,sort_order`,
        idToken)).filter((r) => r.id !== initiative.id) : [];
    const epics = rowsOf(await fetchEntity(
        `${darwinUri}/epics?initiative_fk=${id}&fields=id,title,locked`, idToken))
        .sort((a, b) => a.id - b.id);
    const epicIds = epics.map((r) => r.id);

    // `field=(a,b,c)` is Lambda-Rest's IN-list filter — the parens are load-bearing.
    const seats = epicIds.length ? rowsOf(await fetchEntity(
        `${darwinUri}/epic_requirements?epic_fk=${inList(epicIds)}&fields=epic_fk,requirement_fk`,
        idToken)) : [];
    const epicEdges = epicIds.length ? rowsOf(await fetchEntity(
        `${darwinUri}/epic_deps?dep_epic_fk=${inList(epicIds)}&fields=id,epic_fk,dep_epic_fk`,
        idToken)) : [];
    const waitingEdges = rowsOf(await fetchEntity(
        `${darwinUri}/initiative_deps?dep_initiative_fk=${id}&fields=id,initiative_fk,dep_initiative_fk`,
        idToken));

    const own = new Set(epicIds);
    const outsideDependents = sortedUnique(
        epicEdges.filter((r) => !own.has(r.epic_fk)).map((r) => r.epic_fk));
    // An outside epic waiting on one of these is in this plan (cross-plan edges
    // are refused at the gateway), so its effective lock is its own or its
    // initiative's — the plan's is checked below.
    const outsideRows = outsideDependents.length ? rowsOf(await fetchEntity(
        `${darwinUri}/epics?id=${inList(outsideDependents)}&fields=id,initiative_fk,locked`,
        idToken)) : [];
    const lockedInitiatives = new Set(siblings.filter((r) => Number(r.locked) === 1).map((r) => r.id));
    const lockedOutside = outsideRows.filter((r) => Number(r.locked) === 1
        || lockedInitiatives.has(r.initiative_fk)).map((r) => r.id).sort((a, b) => a - b);
    const lockedWaiting = sortedUnique(waitingEdges.map((r) => r.initiative_fk)
        .filter((i) => lockedInitiatives.has(i)));
    const lockedEpics = epics.filter((r) => Number(r.locked) === 1).map((r) => r.id);

    // NOTHING IS WRITTEN WHILE ANYTHING THE DELETE TOUCHES IS LOCKED (req #3649):
    // the gateway would refuse part-way, after edges were already detached.
    const s = (ids) => (ids.length === 1 ? '' : 's');
    let blocked = null;
    if (Number(plan.locked) === 1) blocked = 'Its plan is locked — unlock the plan to delete it.';
    else if (Number(initiative.locked) === 1) blocked = 'Locked — unlock it to delete it.';
    else if (lockedEpics.length) {
        blocked = `Epic${s(lockedEpics)} ${lockedEpics.join(', ')} under it `
            + `${lockedEpics.length === 1 ? 'is' : 'are'} locked — unlock to delete it.`;
    } else if (lockedWaiting.length) {
        blocked = `Initiative${s(lockedWaiting)} ${lockedWaiting.join(', ')} `
            + `${lockedWaiting.length === 1 ? 'waits' : 'wait'} on it and `
            + `${lockedWaiting.length === 1 ? 'is' : 'are'} locked — unlock to delete it.`;
    }

    const blockedDeletingEpics = lockedOutside.length
        ? `Epic${s(lockedOutside)} ${lockedOutside.join(', ')} `
            + `${lockedOutside.length === 1 ? 'waits' : 'wait'} on its epics and `
            + `${lockedOutside.length === 1 ? 'is' : 'are'} locked — unlock, or keep its epics.`
        : null;

    // Where its epics may be KEPT: an unlocked sibling, unless moving them
    // there closes a gate loop — the gateway does not check an epic's move
    // (initiative_deps_guard.py only flags it after the fact).
    const targets = siblings.filter((r) => Number(r.locked) !== 1)
        .sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) || a.id - b.id);
    let gateGraph = null;
    if (epicIds.length && targets.length) {
        const siblingIds = siblings.map((r) => r.id);
        const planEpics = [...epics.map((e) => ({ id: e.id, initiative_fk: id })),
            ...rowsOf(await fetchEntity(
                `${darwinUri}/epics?initiative_fk=${inList(siblingIds)}&fields=id,initiative_fk`, idToken))];
        gateGraph = {
            planEpics,
            epicDeps: rowsOf(await fetchEntity(
                `${darwinUri}/epic_deps?epic_fk=${inList(planEpics.map((e) => e.id))}`
                + '&fields=epic_fk,dep_epic_fk', idToken)),
            // The deleted initiative's own edges go with it, both directions.
            initiativeDeps: rowsOf(await fetchEntity(
                `${darwinUri}/initiative_deps?initiative_fk=${inList(siblingIds)}`
                + '&fields=initiative_fk,dep_initiative_fk', idToken))
                .filter((r) => r.dep_initiative_fk !== id),
        };
    }

    return {
        initiative,
        epics: epics.map(({ id: epicId, title }) => ({ id: epicId, title })),
        reqIds: sortedUnique(seats.map((r) => r.requirement_fk)),
        epicEdges,
        outsideDependents,
        waitingEdges,
        moveTargets: targets.map((r) => ({ id: r.id, title: r.title,
            cycle: gateGraph ? moveClosesGateCycle(epicIds, r.id, gateGraph) : false })),
        blocked,
        blockedDeletingEpics,
    };
}

/**
 * Whether moving `movedIds` into initiative `targetId` closes a gate loop. An
 * epic waits on each epic it depends on, and on EVERY epic of every initiative
 * its initiative waits for, transitively (req #3823). Only the moved epics change place, so a
 * new loop must run through one of them: a walk from each looks for itself.
 */
export function moveClosesGateCycle(movedIds, targetId, { planEpics, epicDeps, initiativeDeps }) {
    const moved = new Set(movedIds);
    const initiativeOf = new Map(planEpics.map((e) => [e.id, moved.has(e.id) ? targetId : e.initiative_fk]));
    const epicsOf = new Map();
    for (const [epicId, initiativeId] of initiativeOf) {
        if (!epicsOf.has(initiativeId)) epicsOf.set(initiativeId, []);
        epicsOf.get(initiativeId).push(epicId);
    }
    const waitsFor = new Map();
    for (const r of initiativeDeps) {
        if (!waitsFor.has(r.initiative_fk)) waitsFor.set(r.initiative_fk, []);
        waitsFor.get(r.initiative_fk).push(r.dep_initiative_fk);
    }
    const dependsOn = new Map();
    for (const r of epicDeps) {
        if (!dependsOn.has(r.epic_fk)) dependsOn.set(r.epic_fk, []);
        dependsOn.get(r.epic_fk).push(r.dep_epic_fk);
    }
    // An initiative's wait is TRANSITIVE, through an initiative holding no epic
    // too (Lambda-Rest `gate_graph`): every initiative it reaches.
    const reachedInitiatives = (initiativeId) => {
        const reached = new Set();
        const stack = [...(waitsFor.get(initiativeId) || [])];
        while (stack.length) {
            const i = stack.pop();
            if (reached.has(i)) continue;
            reached.add(i);
            stack.push(...(waitsFor.get(i) || []));
        }
        return [...reached];
    };
    const next = (epicId) => [
        ...(dependsOn.get(epicId) || []),
        ...reachedInitiatives(initiativeOf.get(epicId)).flatMap((i) => epicsOf.get(i) || []),
    ];
    for (const start of moved) {
        const seen = new Set();
        const stack = next(start);
        while (stack.length) {
            const epicId = stack.pop();
            if (epicId === start) return true;
            if (seen.has(epicId)) continue;
            seen.add(epicId);
            stack.push(...next(epicId));
        }
    }
    return false;
}

// Bulk-delete rows by id; a 404 means every one is already gone, which is the
// goal — then there is nothing to restore either. Returns whether it deleted.
async function deleteRowsById(darwinUri, idToken, table, rows, action) {
    try {
        assertOk(await call_rest_api(`${darwinUri}/${table}`, 'DELETE',
            rows.map((r) => ({ id: r.id })), idToken), action);
        return true;
    } catch (error) {
        if (error?.httpStatus?.httpStatus === 404) return false;
        throw error;
    }
}

/**
 * Delete an initiative as `planInitiativeDelete` read it, with the reader's choices.
 *
 * ## Order of operations
 *
 * 1. Detach every initiative waiting on it (`dep_initiative_fk` is RESTRICT).
 *    First, so a kept epic moved into one of them is never judged against a
 *    gate onto the initiative it is leaving.
 * 2. Its epics: DELETED — detach every edge onto them (`dep_epic_fk` is
 *    RESTRICT even inside one cascade, see `deleteInitiative`) and let them
 *    cascade with the initiative; or KEPT — move them, with their edges, into
 *    `moveToInitiativeFk` in ONE bulk PUT.
 * 3. Delete the initiative.
 * 4. Only then, if asked, the requirements (`deleteRequirements`) — the one
 *    step that cannot be rolled back, so it waits for the rest to succeed.
 *
 * Before 1, the initiative's epics are re-read: a set changed since the panel
 * read is refused, so the counts confirmed are the rows written.
 *
 * A failure in 1-3 undoes what was written (best effort) and rethrows the
 * ORIGINAL error — or, when an undo also failed, a named error saying so. A
 * failure at 4 rethrows with `initiativeDeleted` set: the
 * initiative is gone, the requirements are not.
 */
export async function deleteInitiativeWithOptions(darwinUri, idToken, planned,
    { deleteEpics = true, moveToInitiativeFk = null, deleteRequirements: alsoRequirements = false } = {}) {
    const { initiative, epics, reqIds, epicEdges, waitingEdges, blocked, blockedDeletingEpics } = planned;
    const id = initiative.id;
    const keepEpics = !deleteEpics && epics.length > 0;
    const refusal = blocked || (keepEpics ? null : blockedDeletingEpics);
    if (refusal) throw namedRefusal(`Initiative ${id} cannot be deleted: ${refusal}`, 423, 'Locked');
    const target = (planned.moveTargets || []).find((t) => t.id === moveToInitiativeFk);
    if (keepEpics && !target) {
        throw namedRefusal('Choose the initiative its epics move to, or delete them.', 400, 'BAD REQUEST');
    }
    if (keepEpics && target.cycle) {
        throw namedRefusal(`Moving its epics to "${target.title}" would close a dependency loop — `
            + 'choose another initiative, or delete them.', 409, 'Conflict');
    }
    // The counts the reader confirmed are the rows written: an epic added or
    // removed since the panel read would be deleted (or missed) unseen.
    const nowEpicIds = rowsOf(await fetchEntity(
        `${darwinUri}/epics?initiative_fk=${id}&fields=id`, idToken)).map((r) => r.id).sort((a, b) => a - b);
    if (nowEpicIds.join(',') !== epics.map((e) => e.id).sort((a, b) => a - b).join(',')) {
        throw namedRefusal(`Initiative ${id}'s epics changed since the delete was opened — `
            + 'nothing was deleted. Press Delete again to see what it holds now.', 409, 'Conflict');
    }

    const undos = [];
    try {
        if (waitingEdges.length && await deleteRowsById(darwinUri, idToken, 'initiative_deps',
            waitingEdges, 'deleteInitiative (detaching the initiatives waiting on it)')) {
            undos.push(...waitingEdges.map((r) => () => createInitiativeDep(
                darwinUri, idToken, r.initiative_fk, r.dep_initiative_fk)));
        }
        if (keepEpics) {
            assertOk(await call_rest_api(`${darwinUri}/epics`, 'PUT',
                epics.map((e) => ({ id: e.id, initiative_fk: moveToInitiativeFk })), idToken),
                'deleteInitiative (moving its epics)');
            undos.push(async () => assertOk(await call_rest_api(`${darwinUri}/epics`, 'PUT',
                epics.map((e) => ({ id: e.id, initiative_fk: id })), idToken), 'restore epics'));
        } else if (epicEdges.length && await deleteRowsById(darwinUri, idToken, 'epic_deps',
            epicEdges, 'deleteInitiative (detaching the dependencies on its epics)')) {
            // A self-edge is invalid (`set_epic_deps` refuses one); it is not restored.
            undos.push(...epicEdges.filter((r) => r.epic_fk !== r.dep_epic_fk)
                .map((r) => async () => assertOk(await call_rest_api(`${darwinUri}/epic_deps`, 'POST',
                    { epic_fk: r.epic_fk, dep_epic_fk: r.dep_epic_fk }, idToken), 'restore edge')));
        }
        assertOk(await call_rest_api(`${darwinUri}/initiatives`, 'DELETE', { id }, idToken),
            'deleteInitiative');
    } catch (error) {
        let unrestored = 0;
        for (const undo of undos.reverse()) {
            try {
                await undo();
            } catch (e) {
                unrestored += 1;
                console.error('initiative delete rollback failed', e);
            }
        }
        if (unrestored) {
            // `call_rest_api` throws a plain `{data, httpStatus}`, so the note
            // rides on an Error of its own, keeping the original status.
            const reason = error?.httpStatus?.httpDetail?.message || error?.httpStatus?.httpMessage
                || error?.message || 'unknown error';
            const wrapped = new Error(`Initiative ${id} was not deleted (${reason}) — and `
                + `${unrestored} of ${undos.length} undo step${undos.length === 1 ? '' : 's'} `
                + 'could not be applied; re-check its dependencies.');
            wrapped.httpStatus = error?.httpStatus;
            wrapped.namedRefusal = true;
            throw wrapped;
        }
        throw error;
    }

    if (alsoRequirements && reqIds.length) {
        try {
            await deleteRequirements(darwinUri, idToken, reqIds);
        } catch (error) {
            const wrapped = new Error(`Initiative ${id} was deleted, but its `
                + `${reqIds.length} requirement${reqIds.length === 1 ? '' : 's'} could not be: `
                + `${error?.message || error?.httpStatus?.httpMessage || 'unknown error'}`);
            wrapped.httpStatus = error?.httpStatus;
            wrapped.initiativeDeleted = true;
            throw wrapped;
        }
    }
    return {
        id,
        epicsDeleted: keepEpics ? 0 : epics.length,
        epicsMoved: keepEpics ? epics.length : 0,
        requirementsDeleted: alsoRequirements ? reqIds.length : 0,
    };
}

// ── Initiative-to-initiative dependencies (req #3823) ───────────────────────
// One `initiative_deps` row is one edge: `initiative_fk` WAITS FOR
// `dep_initiative_fk`. The gateway refuses a self edge, an edge to another
// plan and an edge that closes a cycle (initiative_deps_guard.py) with a 409
// whose message `assertOk` carries verbatim; a locked initiative or plan is 423.

/** Add one edge: initiative `initiativeId` waits for `depInitiativeId`. */
export async function createInitiativeDep(darwinUri, idToken, initiativeId, depInitiativeId) {
    const r = await call_rest_api(`${darwinUri}/initiative_deps`, 'POST',
        { initiative_fk: initiativeId, dep_initiative_fk: depInitiativeId }, idToken);
    return assertOk(r, 'createInitiativeDep');
}

/** Remove one edge, addressed by both columns (the UNIQUE key). */
export async function deleteInitiativeDep(darwinUri, idToken, initiativeId, depInitiativeId) {
    const r = await call_rest_api(`${darwinUri}/initiative_deps`, 'DELETE',
        { initiative_fk: initiativeId, dep_initiative_fk: depInitiativeId }, idToken);
    return assertOk(r, 'deleteInitiativeDep');
}

/**
 * Make `initiativeId` wait for exactly `diff` — `initiativeDepDiff`'s
 * `{ add, remove }`. ADDS FIRST, ONE AT A TIME, then removals: a refused add
 * stops the save with the server's reason and the initiative still waits for
 * everything it did (over-gated, never briefly ungated).
 */
export async function setInitiativeDeps(darwinUri, idToken, initiativeId, { add = [], remove = [] }) {
    for (const dep of add) {
        await createInitiativeDep(darwinUri, idToken, initiativeId, dep);
    }
    for (const row of remove) {
        await deleteInitiativeDep(darwinUri, idToken, initiativeId, row.dep_initiative_fk);
    }
}
