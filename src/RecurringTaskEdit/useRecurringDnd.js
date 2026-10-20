// useRecurringDnd.js — the Recurring page's ONE set of drag handlers
// (req #3663). `onDragEnd` resolves the drop, moves the row out of its card
// and into the target's through the registry, and fires one write; a cancel —
// or a drop on the row's own card, a tab, or nothing — writes nothing and
// reverts any tab hover-switch.

import { useCallback } from 'react';
import {
    isHoverSwitch, policyAccepts, listIdOf, removeRecord,
    beginSession, trackPlacement, endSession, commitDrop,
} from '../dnd';
import { useDragTabStore } from '../stores/useDragTabStore';
import { RECURRING_TASKS, useRecurringDragStore } from './recurringDnd';

/**
 * Move a recurring task to another area card: it joins the end of that card
 * with its new area; the write is its area alone.
 */
export function moveRecurringTask(targetDefs, def, areaId) {
    const area = parseInt(areaId);
    return {
        defs: [...targetDefs.filter(d => d.id !== def.id), { ...def, area_fk: area }],
        bulk: [{ id: def.id, area_fk: area }],
    };
}

/**
 * @param {Object} p
 * @param {Map} p.registry          container id → { current: entry }
 * @param {Object} p.writeCtx       { darwinUri, idToken, showError }
 * @param {Function} p.invalidateRecurring
 */
export function useRecurringDnd({ registry, writeCtx, invalidateRecurring }) {
    const revertDragTabSwitch = useDragTabStore(s => s.revertDragTabSwitch);
    const clearDragTabSwitch = useDragTabStore(s => s.clearDragTabSwitch);

    const listOf = useCallback((id) => registry.get(id)?.current ?? null, [registry]);

    const onDragStart = useCallback((event) => beginSession(useRecurringDragStore, event), []);

    const onDragOver = useCallback((event) => trackPlacement(useRecurringDragStore, listOf, event), [listOf]);

    const onDragCancel = useCallback(() => {
        useRecurringDragStore.getState().end();
        revertDragTabSwitch();
    }, [revertDragTabSwitch]);

    // Plain function: reads this render's props.
    const onDragEnd = ({ over }) => {
        const { active } = endSession(useRecurringDragStore);
        if (!active) return;
        const data = over?.data.current;
        const targetId = listIdOf(over);
        const source = listOf(active.origin);
        const target = targetId ? listOf(targetId) : null;
        if (!data || isHoverSwitch(data, active.type) || !policyAccepts(data, active.type)
            || targetId === active.origin || !source || !target?.ready) {
            revertDragTabSwitch();
            return;
        }
        const moved = moveRecurringTask(target.getItems(), active.row, target.areaId);
        commitDrop(RECURRING_TASKS, writeCtx,
            [[source, removeRecord(source.getItems(), active.row.id)], [target, moved.defs]],
            moved.bulk, invalidateRecurring);
        clearDragTabSwitch();
    };

    return { onDragStart, onDragOver, onDragEnd, onDragCancel };
}
