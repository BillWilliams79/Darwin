// DarwinSortableList — the sortable context for one list, strategy chosen by
// its drop policy (req #3662).
//
// Siblings slide aside ONLY where a position is honoured: a list whose policy
// does not allow reordering in its current sort mode (a priority-sorted card)
// gets a strategy that moves nothing, so the card highlights as a whole and a
// drop appends instead of pretending to insert somewhere it will not land.

import React, { useEffect } from 'react';
import { useDndContext } from '@dnd-kit/core';
import {
    SortableContext, verticalListSortingStrategy, horizontalListSortingStrategy,
    rectSortingStrategy,
} from '@dnd-kit/sortable';

const STRATEGY = {
    vertical: verticalListSortingStrategy,
    horizontal: horizontalListSortingStrategy,
    grid: rectSortingStrategy,
};

const stayPut = () => null;

export default function DarwinSortableList({ id, items, policy, sortMode, children }) {
    const strategy = policy.reorderAllowed(sortMode)
        ? STRATEGY[policy.orientation] ?? verticalListSortingStrategy
        : stayPut;
    return (
        <SortableContext id={id} items={items} strategy={strategy}>
            {children}
        </SortableContext>
    );
}

/**
 * Re-measure every drop zone when `value` changes mid-drag. Droppable rects are
 * measured at lift; a tab hover-switch reveals a panel whose zones measured as
 * zero-size while it was hidden, and without this they stay unreachable for the
 * rest of the drag.
 */
export function RemeasureOnChange({ value }) {
    const { active, measureDroppableContainers } = useDndContext();
    useEffect(() => {
        if (active) measureDroppableContainers();
    }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}
