// useDarwinDrag / useDarwinDropZone — the two hooks a surface uses (req #3662).
//
// useDarwinDrag   an item that lifts AND is a position among its siblings
//                 (a task row, an area card, a domain tab). Wraps useSortable;
//                 the node is its own grip and its own keyboard activator, so
//                 Space lifts only when the item itself has focus.
// useDarwinDropZone  a list that takes items (a card, a tab strip, a card
//                 grid). Wraps useDroppable.
// useDarwinDraggable  an item that lifts but is NOT a position among its
//                 siblings — it only ever leaves its list (an Orchestrables row
//                 dropped onto a plan epic, req #3665). Wraps useDraggable; the
//                 source stays put while the overlay travels.
//
// Both register `{ kind, type, containerId, policy, sortMode, row }` as data —
// the vocabulary dropPolicy.js's collision rule reads.

import { useCallback, useMemo } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { usePressStore } from './pressStore';
import { LIFT_DELAY_MS, PRESS_CUE_DELAY_MS } from './pressTimeline';

// The press cue: the held item sinks slightly over the time a lift takes, so
// the hold visibly builds; the overlay then pops up out of it (the pickup).
const PRESS_CUE = {
    transform: 'scale(0.97)',
    filter: 'brightness(0.93)',
    transition: `transform ${LIFT_DELAY_MS - PRESS_CUE_DELAY_MS}ms ease-out ${PRESS_CUE_DELAY_MS}ms, `
              + `filter ${LIFT_DELAY_MS - PRESS_CUE_DELAY_MS}ms ease-out ${PRESS_CUE_DELAY_MS}ms`,
};

/**
 * @param {Object} p
 * @param {string} p.id            unique across the whole surface ('task:42')
 * @param {string} p.type          draggable type ('task', 'area', ...)
 * @param {string} p.containerId   the list this item sits in
 * @param {Object} p.policy        that list's drop policy
 * @param {string} [p.sortMode]    that list's sort mode, for policy.reorderAllowed
 * @param {any}    [p.row]         the item's record
 * @param {boolean}[p.disabled]
 * @param {boolean}[p.sortsOutside] keep sorting against its own list when the
 *                                  pointer leaves it (tab strips, card grids)
 */
export function useDarwinDrag({
    id, type, containerId, policy, sortMode, row, disabled = false, sortsOutside = false,
}) {
    const data = useMemo(() => ({
        kind: 'item', type, containerId, policy, sortMode, row, sortsOutside,
    }), [type, containerId, policy, sortMode, row, sortsOutside]);

    const sortable = useSortable({ id, data, disabled });
    const pressing = usePressStore(s => s.pressedId === id);
    const { setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = sortable;

    const ref = useCallback((node) => {
        setNodeRef(node);
        setActivatorNodeRef(node);
    }, [setNodeRef, setActivatorNodeRef]);

    // Translate only: a scale from the sort strategy would squash a card or a
    // row of a different height into its neighbour's slot.
    const style = useMemo(() => (pressing ? PRESS_CUE : {
        transform: CSS.Translate.toString(transform),
        transition,
    }), [pressing, transform, transition]);

    return { ...sortable, ref, style, isDragging, pressing };
}

/**
 * @param {Object} p
 * @param {string} p.id
 * @param {Object} p.policy
 * @param {string} [p.sortMode]
 * @param {any}    [p.row]
 * @param {boolean}[p.disabled]
 */
export function useDarwinDropZone({ id, policy, sortMode, row, disabled = false }) {
    const data = useMemo(() => ({
        kind: 'container', containerId: id, policy, sortMode, row,
    }), [id, policy, sortMode, row]);
    return useDroppable({ id, data, disabled });
}

/**
 * @param {Object} p
 * @param {string} p.id      unique across the whole surface ('unseated:42')
 * @param {string} p.type    draggable type
 * @param {any}    [p.row]   the item's record
 * @param {boolean}[p.disabled]
 */
export function useDarwinDraggable({ id, type, row, disabled = false }) {
    const data = useMemo(() => ({ kind: 'item', type, row }), [type, row]);
    const draggable = useDraggable({ id, data, disabled });
    const pressing = usePressStore(s => s.pressedId === id);
    const { setNodeRef, setActivatorNodeRef } = draggable;

    const ref = useCallback((node) => {
        setNodeRef(node);
        setActivatorNodeRef(node);
    }, [setNodeRef, setActivatorNodeRef]);

    return { ...draggable, ref, style: pressing ? PRESS_CUE : undefined, pressing };
}
