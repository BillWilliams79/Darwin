import React, { useState, useRef, useCallback } from 'react';
import { useDndContext } from '@dnd-kit/core';
import Tab from '@mui/material/Tab';
import InputBase from '@mui/material/InputBase';
import { useDragTabStore } from '../stores/useDragTabStore';
import { useDarwinDrag, useHoverSwitch, useLongPress, mergeHandlers, isHoverSwitch } from '../dnd';
import { DOMAIN_TABS, planIds } from './planDnd';

// A domain tab (req #3662, on dnd-kit): it lifts and reorders along the strip,
// it switches the page to its domain when a task or card hovers it for
// TAB_HOVER_SWITCH_MS (reverted if that drag is cancelled), and a long press
// renames it — firing WHILE HELD, on mouse and touch alike. A touch press lifts
// the tab at LIFT_DELAY_MS; still held at LONG_PRESS_MS, the lift is abandoned
// for the edit. Double-click still renames on desktop.
const DroppableTab = ({ domainIndex, domainId, domain, domainName, isActiveTab, renameDomain, ...tabProps }) => {

    const onDragTabSwitch = useDragTabStore(s => s.onDragTabSwitch);
    const { active } = useDndContext();

    // Inline editing state
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState(domainName);
    const editingRef = useRef(false);

    const enterEditMode = useCallback(() => {
        setEditValue(domainName);
        setEditing(true);
        editingRef.current = true;
    }, [domainName]);

    const exitEditMode = useCallback(() => {
        setEditing(false);
        editingRef.current = false;
    }, []);

    const saveAndExit = useCallback(() => {
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== domainName) {
            renameDomain(domainId, trimmed);
        }
        exitEditMode();
    }, [editValue, domainName, renameDomain, domainId, exitEditMode]);

    const { ref, style, attributes, listeners, isDragging, isOver } = useDarwinDrag({
        id: planIds.domain(domainId),
        type: 'domain',
        containerId: planIds.domains,
        policy: DOMAIN_TABS,
        row: domain,
        disabled: editing,
        sortsOutside: true,
    });

    // A task or area card held over this tab switches the page to it.
    const activeType = active?.data.current?.type;
    const hoverSwitching = isOver && !isActiveTab
        && isHoverSwitch({ policy: DOMAIN_TABS }, activeType);
    useHoverSwitch({ hovering: hoverSwitching, onSwitch: () => onDragTabSwitch(domainIndex) });

    const longPress = useLongPress(enterEditMode, { enabled: !editing });

    // Double-click handler for desktop editing
    const handleDoubleClick = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        enterEditMode();
    }, [enterEditMode]);

    // Suppress context menu when editing (mobile long-press)
    const handleContextMenu = useCallback((e) => {
        if (editing) {
            e.preventDefault();
        }
    }, [editing]);

    // Build the label — either InputBase (editing) or plain text
    const tabLabel = editing ? (
        <InputBase
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveAndExit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    exitEditMode();
                }
            }}
            onBlur={saveAndExit}
            onFocus={(e) => e.target.select()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            autoFocus
            inputProps={{
                maxLength: 32,
                style: { padding: 0, fontSize: 'inherit', textAlign: 'center', textTransform: 'inherit' },
                'data-testid': `domain-tab-edit-${domainIndex}`,
            }}
            sx={{ fontSize: 'inherit' }}
        />
    ) : domainName;

    // MUI Tabs owns the tab's role/aria-selected/tabIndex; dnd-kit's sortable
    // attributes would overwrite them, so only its description rides along.
    const dndAria = { 'aria-roledescription': attributes['aria-roledescription'],
                      'aria-describedby': attributes['aria-describedby'] };

    return (
        <Tab
            ref={ref}
            data-testid={`domain-tab-${domainIndex}`}
            {...tabProps}
            {...dndAria}
            {...mergeHandlers(listeners, longPress)}
            label={tabLabel}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
            style={style}
            sx={(theme) => ({
                ...(typeof tabProps.sx === 'function' ? tabProps.sx(theme) : tabProps.sx),
                touchAction: 'manipulation',
                ...(isDragging && {
                    opacity: 0.35,
                }),
                // Hover-switch countdown: the tab tints while a dragged task or
                // card waits on it, so the switch is expected, not a surprise.
                ...(hoverSwitching && {
                    backgroundColor: theme.palette.action.selected,
                }),
            })}
        />
    );
};

export default DroppableTab;
