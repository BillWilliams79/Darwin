import React from 'react';
import { useDndContext } from '@dnd-kit/core';
import Tab from '@mui/material/Tab';
import { useDragTabStore } from '../stores/useDragTabStore';
import { useDarwinDrag, useHoverSwitch, isHoverSwitch } from '../dnd';
import { RECURRING_TABS, recurringIds } from './recurringDnd';

// A domain tab on the Recurring page (req #3663, on dnd-kit): a recurring task
// held over it for TAB_HOVER_SWITCH_MS switches the page to that domain, so the
// drag can land in one of its area cards (reverted if the drag is cancelled —
// releasing ON the tab is a cancel). The tab does not drag itself: it is a drop
// position only, in the same sortable vocabulary as the Plan view's tabs, so
// the collision rule knows where the strip shows it.
const NOT_DRAGGABLE = { draggable: true, droppable: false };

const RecurringDroppableTab = ({ domain, domainIndex, isActiveTab, ...tabProps }) => {
    const onDragTabSwitch = useDragTabStore(s => s.onDragTabSwitch);
    const { active } = useDndContext();

    const { ref, isOver } = useDarwinDrag({
        id: recurringIds.domain(domain.id),
        type: 'domain',
        containerId: recurringIds.domains,
        policy: RECURRING_TABS,
        row: domain,
        disabled: NOT_DRAGGABLE,
    });

    const activeType = active?.data.current?.type;
    const hoverSwitching = isOver && !isActiveTab
        && isHoverSwitch({ policy: RECURRING_TABS }, activeType);
    useHoverSwitch({ hovering: hoverSwitching, onSwitch: () => onDragTabSwitch(domainIndex) });

    return (
        <Tab
            ref={ref}
            data-testid={`recurring-domain-tab-${domainIndex}`}
            {...tabProps}
            sx={(theme) => ({
                ...(hoverSwitching && { backgroundColor: theme.palette.action.selected }),
            })}
        />
    );
};

export default RecurringDroppableTab;
