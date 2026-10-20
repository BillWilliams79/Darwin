// recurringDnd.js — the Recurring page's drag surface (req #3663, on the
// dnd-kit foundation req #3662 shipped): its ids, its drop policies and its
// drag session (the shared list session in src/dnd/listSession.js).
//
// A recurring task moves between area cards — in one domain, or into another
// by hovering that domain's tab (switch after TAB_HOVER_SWITCH_MS, reverted on
// cancel). Recurring tasks have no stored order, so a card never honours a
// position: it highlights as a whole and a drop appends. Dropping a row on
// its own card is a no-op.

import call_rest_api from '../RestApi/RestApi';
import { defineDropPolicy, createDragSession } from '../dnd';

export const recurringIds = {
    domain: (id) => `recurring-domain:${id}`,
    domains: 'recurring-domains',
    task: (id) => `recurring:${id}`,
    tasks: (areaId) => `recurring-tasks:${areaId}`,
};

const ok = (result) => {
    const status = result?.httpStatus?.httpStatus;
    return status === 200 || status === 204;
};

const putRecurring = ({ darwinUri, idToken, showError }, bulk, { onSaved, onFailed } = {}) =>
    call_rest_api(`${darwinUri}/recurring_tasks`, 'PUT', bulk, idToken)
        .then(result => {
            if (ok(result)) { onSaved?.(); return; }
            onFailed?.();
            showError(result, 'Unable to move recurring task');
        })
        .catch(error => { onFailed?.(); showError(error, 'Unable to move recurring task'); });

/** The domain tab strip: a dragged recurring task hovering a tab switches to it. */
export const RECURRING_TABS = defineDropPolicy({
    accepts: ['recurring'],
    orientation: 'horizontal',
    hoverSwitchFor: ['recurring'],
});

/** An area card's recurring tasks: no stored order, so the card takes a row as a whole. */
export const RECURRING_TASKS = defineDropPolicy({
    accepts: ['recurring'],
    orientation: 'vertical',
    persist: putRecurring,
});

export const useRecurringDragStore = createDragSession();
