// usePlanDnd.js — the Plan view's ONE set of drag handlers (req #3662).
//
// react-dnd split every move across the source's `end()` (which filtered its
// own array) and the target's `drop()` (which inserted and wrote), coordinated
// through sentinel drop results. Here the page sees the whole drop at once:
// `onDragEnd` resolves it (planMoves.js), applies it to BOTH lists' local
// arrays through the registry, and fires exactly one write.
//
// `onDragOver` only maintains the session: which foreign list the item has
// been carried into (so that list can show it in place and its siblings slide
// aside), or which card would take it as a whole.

import { useCallback } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { isHoverSwitch, policyAccepts, honoursPosition } from '../dnd';
import { useDragTabStore } from '../stores/useDragTabStore';
import { isOrderableTask } from './closedTasks';
import {
    AREA_CARDS, AREA_TASKS, DOMAIN_TABS, PRIORITY_TASKS, usePlanDragStore,
} from './planDnd';
import {
    reorderTasksInCard, insertTaskIntoHandCard, appendTaskToCard, removeRecord,
    reorderPriorityRows, reorderAreas, moveAreaToDomain, reorderDomains, withPlacement,
} from './planMoves';

const listIdOf = (over) => {
    const data = over?.data.current;
    if (!data) return null;
    return data.kind === 'container' ? over.id : data.containerId;
};

const indexOfId = (items, id) => items.findIndex(r => r.id === id);

/** Is the dragged item's centre below the hovered row's centre? */
const isBelow = (active, over) => {
    const dragged = active.rect.current.translated;
    if (!dragged || !over.rect) return false;
    return dragged.top + dragged.height / 2 > over.rect.top + over.rect.height / 2;
};

/**
 * @param {Object} p
 * @param {Map} p.registry                 container id → { current: entry }
 * @param {Object} p.writeCtx              { darwinUri, idToken, showError }
 * @param {Function} p.invalidateTasks / p.invalidateAreas / p.invalidateDomains
 * @param {object[]} p.domains, p.setDomains, p.activeTab, p.setActiveTab
 */
export function usePlanDnd({
    registry, writeCtx, invalidateTasks, invalidateAreas, invalidateDomains,
    domains, setDomains, activeTab, setActiveTab,
}) {
    const revertDragTabSwitch = useDragTabStore(s => s.revertDragTabSwitch);
    const clearDragTabSwitch = useDragTabStore(s => s.clearDragTabSwitch);

    const listOf = useCallback((id) => registry.get(id)?.current ?? null, [registry]);

    const onDragStart = useCallback(({ active }) => {
        const data = active.data.current;
        usePlanDragStore.getState().begin({
            id: active.id, type: data.type, row: data.row, origin: data.containerId,
        });
    }, []);

    const onDragOver = useCallback(({ active, over }) => {
        const store = usePlanDragStore.getState();
        const session = store.active;
        if (!session) return;
        const data = over?.data.current;
        if (!data || isHoverSwitch(data, session.type) || !policyAccepts(data, session.type)) {
            store.setHighlight(null);
            return;
        }
        const target = listIdOf(over);
        if (target === session.origin) {
            if (store.placement) store.place(null);
            store.setHighlight(null);
            return;
        }
        if (!honoursPosition(data)) {
            // Takes the drop as a whole: the item stays home, the card lights up.
            store.setHighlight(target);
            if (store.placement) store.place(null);
            return;
        }
        // Honours a position: its siblings slide aside — that IS the feedback.
        store.setHighlight(null);
        if (store.placement?.containerId === target) return;   // already carried here
        const list = listOf(target);
        if (!list?.ready) return;                               // still loading: not a place yet

        const items = list.getItems();
        const positions = items.filter(data.policy.isTarget);
        let index = positions.length;
        if (data.kind === 'item') {
            const at = indexOfId(positions, data.row.id);
            if (at >= 0) index = at + (isBelow(active, over) ? 1 : 0);
        }
        store.place({ containerId: target, index });
    }, [listOf]);

    const onDragCancel = useCallback(() => {
        usePlanDragStore.getState().end();
        revertDragTabSwitch();
    }, [revertDragTabSwitch]);

    // Apply a resolved drop to its lists, then write it. Success tells the
    // query cache (a card can REMOUNT mid-drag — an area card carried across
    // domains — and a remounted card seeds from the cache, so a cache left on
    // the old order would hand the next drop a stale list to renumber). Failure
    // puts every list back exactly as it was, then re-reads.
    const commit = (policy, changes, payload, refresh) => {
        const before = changes.map(([list]) => [list, list.getItems()]);
        changes.forEach(([list, next]) => list.setItems(next));
        policy.persist(writeCtx, payload, {
            onSaved: refresh,
            onFailed: () => {
                before.forEach(([list, items]) => list.setItems(items));
                refresh();
            },
        });
    };

    // The final order of a list the item was carried into: where it was
    // placed, then moved among that list's rows by the sortable.
    const settledOrder = (list, containerId, session, policy, over) => {
        const rendered = withPlacement(list.getItems(), containerId, session, policy.isTarget);
        const data = over.data.current;
        if (data.kind !== 'item' || data.containerId !== containerId) return rendered;
        const from = indexOfId(rendered, session.active.row.id);
        const to = indexOfId(rendered, data.row.id);
        return from < 0 || to < 0 ? rendered : arrayMove(rendered, from, to);
    };

    const dropTask = (session, over, cancel) => {
        const { active, placement } = session;
        const id = active.row.id;
        const data = over.data.current;
        const source = listOf(active.origin);
        if (!source) return cancel();

        if (placement) {
            const target = listOf(placement.containerId);
            if (!target?.ready || listIdOf(over) !== placement.containerId) return cancel();
            const order = settledOrder(target, placement.containerId, session, AREA_TASKS, over);
            const insertIndex = order.filter(isOrderableTask).findIndex(r => r.id === id);
            const moved = insertTaskIntoHandCard(target.getItems(), active.row, insertIndex, target.areaId);
            commit(AREA_TASKS, [[source, removeRecord(source.getItems(), id)], [target, moved.tasks]],
                moved.bulk, invalidateTasks);
            return clearDragTabSwitch();
        }

        const targetId = listIdOf(over);
        if (targetId === active.origin) {
            if (data.kind !== 'item' || !honoursPosition(data)) return cancel();
            const items = source.getItems();
            const reordered = reorderTasksInCard(items, indexOfId(items, id), indexOfId(items, data.row.id));
            if (!reordered) return cancel();
            commit(AREA_TASKS, [[source, reordered.tasks]], reordered.bulk, invalidateTasks);
            return revertDragTabSwitch();
        }

        const target = listOf(targetId);
        if (!target?.ready) return cancel();
        const appended = appendTaskToCard(target.getItems(), active.row, target.areaId, target.sortRows);
        commit(AREA_TASKS, [[source, removeRecord(source.getItems(), id)], [target, appended.tasks]],
            appended.bulk, invalidateTasks);
        return clearDragTabSwitch();
    };

    const dropPriorityTask = (session, over, cancel) => {
        const { active } = session;
        const data = over.data.current;
        if (data.kind !== 'item' || data.containerId !== active.origin || !honoursPosition(data)) return cancel();
        const list = listOf(active.origin);
        if (!list) return cancel();
        const items = list.getItems();
        const reordered = reorderPriorityRows(items, indexOfId(items, active.row.id), indexOfId(items, data.row.id));
        if (!reordered) return cancel();
        list.setItems(reordered.tasks);
        PRIORITY_TASKS.persist(writeCtx, reordered.live, { entry: list });
        return revertDragTabSwitch();
    };

    const dropArea = (session, over, cancel) => {
        const { active, placement } = session;
        const data = over.data.current;
        const source = listOf(active.origin);
        if (!source) return cancel();

        if (placement) {
            const target = listOf(placement.containerId);
            if (!target?.ready || listIdOf(over) !== placement.containerId) return cancel();
            const order = settledOrder(target, placement.containerId, session, AREA_CARDS, over);
            const insertIndex = order.filter(a => a.id !== '').findIndex(a => a.id === active.row.id);
            const moved = moveAreaToDomain(source.getItems(), target.getItems(), active.row, insertIndex, target.domainId);
            commit(AREA_CARDS, [[source, moved.sourceAreas], [target, moved.targetAreas]],
                moved.bulk, invalidateAreas);
            return clearDragTabSwitch();
        }

        if (data.kind !== 'item' || data.containerId !== active.origin) return cancel();
        const items = source.getItems();
        const reordered = reorderAreas(items, indexOfId(items, active.row.id), indexOfId(items, data.row.id));
        if (!reordered) return cancel();
        commit(AREA_CARDS, [[source, reordered.areas]], reordered.bulk, invalidateAreas);
        return revertDragTabSwitch();
    };

    const dropDomain = (session, over, cancel) => {
        const { active } = session;
        const data = over.data.current;
        if (data.kind !== 'item' || data.containerId !== active.origin || !domains) return cancel();
        const reordered = reorderDomains(domains, indexOfId(domains, active.row.id),
            indexOfId(domains, data.row.id), parseInt(activeTab));
        if (!reordered) return cancel();
        const previousTab = parseInt(activeTab);
        setDomains(reordered.domains);
        if (reordered.activeIndex >= 0 && reordered.activeIndex !== previousTab) {
            setActiveTab(reordered.activeIndex);
        }
        DOMAIN_TABS.persist(writeCtx, reordered.bulk, {
            onSaved: invalidateDomains,
            onFailed: () => {
                setDomains(domains);
                setActiveTab(previousTab);
                invalidateDomains();
            },
        });
        return undefined;
    };

    // Plain function: the drop helpers read this render's props.
    const onDragEnd = ({ over }) => {
        const store = usePlanDragStore.getState();
        const session = { active: store.active, placement: store.placement };
        store.end();
        if (!session.active) return;
        const cancel = () => { revertDragTabSwitch(); };
        const data = over?.data.current;
        if (!data || isHoverSwitch(data, session.active.type) || !policyAccepts(data, session.active.type)) {
            cancel();
            return;
        }
        switch (session.active.type) {
            case 'task': dropTask(session, over, cancel); break;
            case 'ptask': dropPriorityTask(session, over, cancel); break;
            case 'area': dropArea(session, over, cancel); break;
            case 'domain': dropDomain(session, over, cancel); break;
            default: cancel();
        }
    };

    return { onDragStart, onDragOver, onDragEnd, onDragCancel };
}
