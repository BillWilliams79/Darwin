import React from 'react';
import { useDndContext } from '@dnd-kit/core';
import Tab from '@mui/material/Tab';
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { useDarwinDrag, useHoverSwitch, isHoverSwitch } from '../dnd';
import { PROJECT_TABS, swarmIds } from './swarmDnd';

// A project tab (req #3663): a requirement row or a category card held over it
// for TAB_HOVER_SWITCH_MS switches the page to that project, so the drag can
// land in one of its cards (reverted if the drag is cancelled). The tab itself
// does not drag — it is a drop position only (its draggable half is off), in
// the same sortable vocabulary the Plan view's domain tabs use, so the one
// collision rule knows it sits in the tab strip and ignores the part of a
// clipped tab that runs on under the controls beside the strip.
const NOT_DRAGGABLE = { draggable: true, droppable: false };

const SwarmProjectTab = ({ project, projectIndex, isActiveTab, ...tabProps }) => {
    const onDragTabSwitch = useSwarmTabStore(s => s.onDragTabSwitch);
    const { active } = useDndContext();

    const { ref, isOver } = useDarwinDrag({
        id: swarmIds.project(project.id),
        type: 'project',
        containerId: swarmIds.projects,
        policy: PROJECT_TABS,
        row: project,
        disabled: NOT_DRAGGABLE,
    });

    const activeType = active?.data.current?.type;
    const hoverSwitching = isOver && !isActiveTab
        && isHoverSwitch({ policy: PROJECT_TABS }, activeType);
    useHoverSwitch({ hovering: hoverSwitching, onSwitch: () => onDragTabSwitch(projectIndex) });

    return (
        <Tab
            ref={ref}
            data-testid={`project-tab-${project.id}`}
            {...tabProps}
            sx={(theme) => ({
                // Hover-switch countdown: the tab tints while a dragged row or
                // card waits on it, so the switch is expected, not a surprise.
                ...(hoverSwitching && { backgroundColor: theme.palette.action.selected }),
            })}
        />
    );
};

export default SwarmProjectTab;
