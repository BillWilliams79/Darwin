// useSwarmDnd.js — the Swarm cards view's ONE set of drag handlers (req #3663).
//
// The page sees the whole drop at once: `onDragEnd` resolves it
// (swarmMoves.js), applies it to BOTH lists' local arrays through the registry
// and fires exactly one write — where react-dnd split it across the source's
// `end()`, the target card's `drop()` and the panel's catch-all, coordinated by
// sentinel drop results and an insert index parked in a ref. `onDragOver` only
// maintains the session (src/dnd/listSession.js).

import { useCallback } from 'react';
import {
    isHoverSwitch, policyAccepts, honoursPosition, listIdOf, indexOfId, removeRecord,
    beginSession, trackPlacement, endSession, settledOrder, commitDrop,
} from '../dnd';
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { CATEGORY_CARDS, CATEGORY_REQS, useSwarmDragStore } from './swarmDnd';
import {
    reorderRequirementsInCard, insertRequirementIntoHandCard, appendRequirementToCard,
    reorderCategories, moveCategoryToProject,
} from './swarmMoves';

const sameCategory = (row, categoryId) => parseInt(row.category_fk) === parseInt(categoryId);

/**
 * @param {Object} p
 * @param {Map} p.registry           container id → { current: entry }
 * @param {Object} p.writeCtx        { darwinUri, idToken, showError, queryClient, userName }
 * @param {Function} p.invalidateCategories
 */
export function useSwarmDnd({ registry, writeCtx, invalidateCategories }) {
    const revertDragTabSwitch = useSwarmTabStore(s => s.revertDragTabSwitch);
    const clearDragTabSwitch = useSwarmTabStore(s => s.clearDragTabSwitch);

    const listOf = useCallback((id) => registry.get(id)?.current ?? null, [registry]);

    const onDragStart = useCallback((event) => beginSession(useSwarmDragStore, event), []);

    const onDragOver = useCallback((event) => trackPlacement(useSwarmDragStore, listOf, event), [listOf]);

    const onDragCancel = useCallback(() => {
        useSwarmDragStore.getState().end();
        revertDragTabSwitch();
    }, [revertDragTabSwitch]);

    const commit = (policy, changes, payload, refresh) =>
        commitDrop(policy, writeCtx, changes, payload, refresh);

    const dropRequirement = (session, over, cancel) => {
        const { active, placement } = session;
        const keepsSource = active.keepsMovedRows;
        const row = active.row;
        const data = over.data.current;
        // A list whose policy keeps a moved row (the aggregator) is not edited.
        const source = keepsSource ? null : listOf(active.origin);
        if (!keepsSource && !source) return cancel();
        const leaveSource = source ? [[source, removeRecord(source.getItems(), row.id)]] : [];
        const moved = (categoryId) => (sameCategory(row, categoryId) ? null
            : { row, from: parseInt(row.category_fk), to: parseInt(categoryId) });

        // Carried into a hand-sorted card: land where it was placed.
        if (placement) {
            const target = listOf(placement.containerId);
            if (!target?.ready || listIdOf(over) !== placement.containerId) return cancel();
            const order = settledOrder(target, placement.containerId, session, CATEGORY_REQS, over);
            const insertIndex = order.filter(CATEGORY_REQS.isTarget).findIndex(r => r.id === row.id);
            const result = insertRequirementIntoHandCard(target.getItems(), row, insertIndex, target.categoryId);
            // From the aggregator into the row's OWN card, it is that card's
            // reorder: nothing leaves anywhere.
            const changes = sameCategory(row, target.categoryId) ? [] : leaveSource;
            commit(CATEGORY_REQS, [...changes, [target, result.rows]],
                { bulk: result.bulk, moved: moved(target.categoryId) });
            return clearDragTabSwitch();
        }

        const targetId = listIdOf(over);
        if (targetId === active.origin) {
            if (!source || data.kind !== 'item' || !honoursPosition(data)) return cancel();
            const items = source.getItems();
            const reordered = reorderRequirementsInCard(items, indexOfId(items, row.id), indexOfId(items, data.row.id));
            if (!reordered) return cancel();
            commit(CATEGORY_REQS, [[source, reordered.rows]], { bulk: reordered.bulk });
            return revertDragTabSwitch();
        }

        // A card that honours no position takes it as a whole. Its own row
        // dropped back on it (from the aggregator) is that card's no-op.
        const target = listOf(targetId);
        if (!target?.ready || sameCategory(row, target.categoryId)) return cancel();
        const appended = appendRequirementToCard(target.getItems(), row, target.categoryId, target.sortRows);
        commit(CATEGORY_REQS, [...leaveSource, [target, appended.rows]],
            { bulk: appended.bulk, moved: moved(target.categoryId) });
        return clearDragTabSwitch();
    };

    const dropCategory = (session, over, cancel) => {
        const { active, placement } = session;
        const data = over.data.current;
        const source = listOf(active.origin);
        if (!source) return cancel();

        if (placement) {
            const target = listOf(placement.containerId);
            if (!target?.ready || listIdOf(over) !== placement.containerId) return cancel();
            const order = settledOrder(target, placement.containerId, session, CATEGORY_CARDS, over);
            const insertIndex = order.filter(CATEGORY_CARDS.isTarget).findIndex(c => c.id === active.row.id);
            const moved = moveCategoryToProject(source.getItems(), target.getItems(), active.row,
                insertIndex, target.projectId);
            commit(CATEGORY_CARDS, [[source, moved.sourceCategories], [target, moved.targetCategories]],
                moved.bulk, invalidateCategories);
            return clearDragTabSwitch();
        }

        if (data.kind !== 'item' || data.containerId !== active.origin) return cancel();
        const items = source.getItems();
        const reordered = reorderCategories(items, indexOfId(items, active.row.id), indexOfId(items, data.row.id));
        if (!reordered) return cancel();
        commit(CATEGORY_CARDS, [[source, reordered.categories]], reordered.bulk, invalidateCategories);
        return revertDragTabSwitch();
    };

    // Plain function: the drop helpers read this render's props.
    const onDragEnd = ({ over }) => {
        const session = endSession(useSwarmDragStore);
        if (!session.active) return;
        const cancel = () => { revertDragTabSwitch(); };
        const data = over?.data.current;
        if (!data || isHoverSwitch(data, session.active.type) || !policyAccepts(data, session.active.type)) {
            cancel();
            return;
        }
        switch (session.active.type) {
            case 'requirement': dropRequirement(session, over, cancel); break;
            case 'category': dropCategory(session, over, cancel); break;
            default: cancel();
        }
    };

    return { onDragStart, onDragOver, onDragEnd, onDragCancel };
}
