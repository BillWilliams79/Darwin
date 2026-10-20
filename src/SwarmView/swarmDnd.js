// swarmDnd.js — the Swarm cards view's drag surface (req #3663, on the dnd-kit
// foundation req #3662 shipped): its ids, its drop policies, its write, and its
// drag session (the shared list session in src/dnd/listSession.js).
//
// The rules (memory/architecture.md § SwarmView Requirement-Row DnD, req #2417)
// live in the policies and in useSwarmDnd's one onDragEnd:
//   - a hand-sorted card reorders and persists sort_order; its rows slide aside
//   - hand → hand across cards persists category_fk AND the target's sort_order
//   - into a process/reverse card persists category_fk only; the card highlights
//   - process/reverse within a card is a no-op (it honours no position)
//   - the template row never drags and is never a position
//   - the aggregator (SwarmStartCard) is a drag SOURCE only: it takes nothing,
//     and a row moved out of it stays visible there — its policy says so
//     (`keepsMovedRows`), where it used to be a `'created'` sortMode sentinel
//   - category cards reorder in their project's grid and move to another
//     project by hovering its tab (switch after TAB_HOVER_SWITCH_MS, reverted
//     on cancel)

import call_rest_api from '../RestApi/RestApi';
import { requirementKeys } from '../hooks/useQueryKeys';
import { defineDropPolicy, createDragSession, useListSession } from '../dnd';
import { routeRequirementSlice } from './swarmMoves';

// ── Ids ─────────────────────────────────────────────────────────────────────
// One namespace per draggable type. A requirement can be on screen twice — in
// its category card and in the aggregator — and every panel mounts its own
// aggregator, so an aggregator row's id carries the panel's project too.

export const swarmIds = {
    project: (id) => `project:${id}`,
    projects: 'projects',
    category: (id) => `category:${id}`,
    categories: (projectId) => `categories:${projectId}`,
    req: (id) => `req:${id}`,
    reqs: (categoryId) => `reqs:${categoryId}`,
    aggReq: (projectId, id) => `agg-req:${projectId}:${id}`,
    aggregator: (projectId) => `aggregator:${projectId}`,
};

const isRealRow = (row) => row.id !== '';

// ── Writes ──────────────────────────────────────────────────────────────────

const ok = (result) => {
    const status = result?.httpStatus?.httpStatus;
    return status === 200 || status === 204;
};

const putCategories = ({ darwinUri, idToken, showError }, bulk, { onSaved, onFailed } = {}) =>
    call_rest_api(`${darwinUri}/categories`, 'PUT', bulk, idToken)
        .then(result => {
            if (ok(result)) { onSaved?.(); return; }
            onFailed?.();
            showError(result, 'Unable to save category order');
        })
        .catch(error => { onFailed?.(); showError(error, 'Unable to save category order'); });

/** The categoryId a requirement query is scoped to, or undefined for a cross-category slice. */
const sliceCategoryOf = (queryKey) => {
    const filter = queryKey.find(k => typeof k === 'object' && k !== null);
    return filter && 'categoryId' in filter ? parseInt(filter.categoryId) : undefined;
};

/**
 * A requirement move's write. Every requirement cache is written through
 * FIRST (req #2381): the aggregator lists from its status slices and must keep
 * a moved row; the source card re-seeds from its category slice and must lose
 * it. A failed PUT restores every snapshot.
 *
 * @param {{ bulk: object[], moved?: { row: object, from: number, to: number } }} payload
 */
const persistRequirements = (ctx, { bulk, moved = null }, { onSaved, onFailed } = {}) => {
    const { darwinUri, idToken, showError, queryClient, userName } = ctx;
    const prefix = requirementKeys.all(userName);
    queryClient.cancelQueries({ queryKey: prefix });
    const snapshots = queryClient.getQueriesData({ queryKey: prefix });
    // setQueriesData's updater gets only the data (TanStack v5), so each slice
    // is visited by hand to route it by its own key.
    for (const query of queryClient.getQueryCache().findAll({ queryKey: prefix })) {
        const old = query.state.data;
        const next = routeRequirementSlice(old, sliceCategoryOf(query.queryKey), bulk, moved);
        if (next !== old) queryClient.setQueryData(query.queryKey, next);
    }
    const failure = moved ? 'Unable to move requirement to category' : 'Unable to save requirement sort order';
    const fail = (resultOrError) => {
        snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
        onFailed?.();
        showError(resultOrError, failure);
    };
    call_rest_api(`${darwinUri}/requirements`, 'PUT', bulk, idToken)
        .then(result => (ok(result) ? onSaved?.() : fail(result)))
        .catch(fail);
};

// ── Policies ────────────────────────────────────────────────────────────────

/** The project tab strip: a dragged requirement or category card hovering a tab switches to it. */
export const PROJECT_TABS = defineDropPolicy({
    accepts: ['requirement', 'category'],
    orientation: 'horizontal',
    hoverSwitchFor: ['requirement', 'category'],
});

/** A project's card grid. Category order is hand order; the template card is never a position. */
export const CATEGORY_CARDS = defineDropPolicy({
    accepts: ['category'],
    orientation: 'grid',
    reorderAllowed: () => true,
    isTarget: isRealRow,
    persist: putCategories,
});

/**
 * A category card's requirement list. Hand sort honours a position (rows slide
 * aside); process / reverse highlights the card and a drop appends.
 */
export const CATEGORY_REQS = defineDropPolicy({
    accepts: ['requirement'],
    orientation: 'vertical',
    reorderAllowed: (sortMode) => sortMode === 'hand',
    isTarget: isRealRow,
    persist: persistRequirements,
});

/** The aggregator: a source only. Takes nothing; a row moved out of it stays. */
export const AGGREGATOR = defineDropPolicy({
    accepts: [],
    keepsMovedRows: true,
});

// ── The drag session ────────────────────────────────────────────────────────

export const useSwarmDragStore = createDragSession();

/** The session as ONE list sees it — see `useListSession`. */
export const useSwarmSession = (containerId) => useListSession(useSwarmDragStore, containerId);
