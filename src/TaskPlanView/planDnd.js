// planDnd.js — the Plan view's drag surface (req #3662): its drop policies, its
// ids, the drag session every card reads, and the registry the ONE page-level
// onDragEnd uses to reach each card's local array.
//
// The local arrays stay where they were (seeded from the query in each card,
// backing every inline-edit handler); a card registers {getItems, setItems,
// sortMode, ...} under its container id, and the page resolves a drop against
// those registrations, applies it to both sides and fires one write. The
// session and registry machinery is the shared one in src/dnd/listSession.js.

import call_rest_api from '../RestApi/RestApi';
import {
    defineDropPolicy, createDragSession, useListSession, DarwinListRegistry, useRegisterList,
} from '../dnd';
import { isOrderableTask } from './closedTasks';

// ── Ids ─────────────────────────────────────────────────────────────────────
// One namespace per draggable type: a priority task is also a row in its area
// card, and the two are different drag items.

export const planIds = {
    domain: (id) => `domain:${id}`,
    area: (id) => `area:${id}`,
    task: (id) => `task:${id}`,
    ptask: (id) => `ptask:${id}`,
    domains: 'domains',
    areas: (domainId) => `areas:${domainId}`,
    tasks: (areaId) => `tasks:${areaId}`,
    ptasks: (domainId) => `ptasks:${domainId}`,
};

// ── Writes ──────────────────────────────────────────────────────────────────

const ok = (result) => {
    const status = result?.httpStatus?.httpStatus;
    return status === 200 || status === 204;
};

const putBulk = (table, failure) => ({ darwinUri, idToken, showError }, bulk, { onSaved, onFailed } = {}) =>
    call_rest_api(`${darwinUri}/${table}`, 'PUT', bulk, idToken)
        .then(result => {
            if (ok(result)) { onSaved?.(); return; }
            onFailed?.();
            showError(result, failure);
        })
        .catch(error => { onFailed?.(); showError(error, failure); });

// ── Policies ────────────────────────────────────────────────────────────────

/** The tab strip: tabs reorder among themselves; a task or card hovering one switches to it. */
export const DOMAIN_TABS = defineDropPolicy({
    accepts: ['domain', 'task', 'area'],
    orientation: 'horizontal',
    reorderAllowed: () => true,
    hoverSwitchFor: ['task', 'area'],
    persist: putBulk('domains', 'Unable to save domain sort order'),
});

/** A domain's card grid. Area order is always hand order; the template card is never a position. */
export const AREA_CARDS = defineDropPolicy({
    accepts: ['area'],
    orientation: 'grid',
    reorderAllowed: () => true,
    isTarget: (area) => area.id !== '',
    persist: putBulk('areas', 'Unable to save area order'),
});

/**
 * An area card's task list. A hand-sorted card honours a position (siblings
 * slide aside); a priority-sorted one highlights and appends. History rows
 * (req #3506) and the template row are never positions.
 */
export const AREA_TASKS = defineDropPolicy({
    accepts: ['task'],
    orientation: 'vertical',
    reorderAllowed: (sortMode) => sortMode === 'hand',
    isTarget: isOrderableTask,
    persist: putBulk('tasks', 'Unable to save task order'),
});

/**
 * The priority card: its own rows only, reordered only in hand sort. Its write
 * is the card's own (priority_card_order PUT + POSTs), so persist delegates.
 */
export const PRIORITY_TASKS = defineDropPolicy({
    accepts: ['ptask'],
    orientation: 'vertical',
    reorderAllowed: (sortMode) => sortMode === 'hand',
    isTarget: isOrderableTask,
    persist: (_ctx, live, { entry }) => entry.persistOrder(live),
});

// ── The drag session and the registry ───────────────────────────────────────
// The shared list session (src/dnd/listSession.js, req #3663): the Plan view
// keeps its names, every list-of-cards surface shares the machinery.

export const usePlanDragStore = createDragSession();

/** The session as ONE list sees it — see `useListSession`. */
export const usePlanSession = (containerId) => useListSession(usePlanDragStore, containerId);

export const PlanListRegistry = DarwinListRegistry;

/**
 * Register a list's local state with the page — see `useRegisterList`.
 *
 * @param {string} containerId
 * @param {{ getItems: () => object[], setItems: Function, ready: boolean, sortMode?: string,
 *           sortRows?: Function, persistOrder?: Function, domainId?: any,
 *           areaId?: any }} entry
 */
export const useRegisterPlanList = useRegisterList;
