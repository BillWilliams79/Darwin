import React, { useRef, useEffect } from 'react';
import { useDrop } from 'react-dnd';
import Tab from '@mui/material/Tab';

const DroppableTab = ({ domainIndex, onDragTabSwitch, ...tabProps }) => {

    const hoverTimerRef = useRef(null);
    const wasOverRef = useRef(false);
    const firedRef = useRef(false);
    const monitorRef = useRef(null);

    const [{ isOverCurrent }, drop] = useDrop(() => ({
        accept: ['taskPlan', 'areaCard'],
        canDrop: (item, monitor) => monitor.getItemType() === 'taskPlan',
        drop: (item, monitor) => {
            // Accept task drops to prevent browser snap-back animation.
            // Returning {task: null} tells TaskEdit's end handler this is a cancel.
            if (monitor.getItemType() === 'taskPlan') {
                return { task: null };
            }
        },
        hover: (item, monitor) => {
            monitorRef.current = monitor;
            // Once we've fired for this hover sequence, don't start new timers
            if (firedRef.current) return;
            if (hoverTimerRef.current !== null) return;
            hoverTimerRef.current = setTimeout(() => {
                hoverTimerRef.current = null;
                // Only switch if still being hovered during an active drag
                if (monitorRef.current?.isOver({ shallow: true })) {
                    onDragTabSwitch(domainIndex);
                    firedRef.current = true;
                }
            }, 500);
        },
        collect: (monitor) => ({
            isOverCurrent: monitor.isOver({ shallow: true }),
        }),
    }), [domainIndex, onDragTabSwitch]);

    // Clear timer and reset when hover ends
    useEffect(() => {
        if (wasOverRef.current && !isOverCurrent) {
            if (hoverTimerRef.current !== null) {
                clearTimeout(hoverTimerRef.current);
                hoverTimerRef.current = null;
            }
            firedRef.current = false;
        }
        wasOverRef.current = isOverCurrent;
    }, [isOverCurrent]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (hoverTimerRef.current !== null) {
                clearTimeout(hoverTimerRef.current);
            }
        };
    }, []);

    return (
        <Tab
            ref={drop}
            {...tabProps}
            sx={{
                ...tabProps.sx,
                ...(isOverCurrent && {
                    backgroundColor: 'action.hover',
                }),
            }}
        />
    );
};

export default DroppableTab;
