import React, { useRef, useEffect, useCallback } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import Tab from '@mui/material/Tab';
import { useDragTabStore } from '../stores/useDragTabStore';

const DroppableTab = ({ domainIndex, domainId, moveDomainTab, persistDomainOrder, ...tabProps }) => {

    const onDragTabSwitch = useDragTabStore(s => s.onDragTabSwitch);

    const hoverTimerRef = useRef(null);
    const wasOverRef = useRef(false);
    const firedRef = useRef(false);
    const monitorRef = useRef(null);

    const [{ isDragging }, drag] = useDrag(() => ({
        type: 'domainTab',
        item: { domainIndex, domainId, settled: true, movePending: false },
        collect: (monitor) => ({
            isDragging: !!monitor.isDragging(),
        }),
        end: (_item, monitor) => {
            persistDomainOrder(monitor.didDrop());
        },
    }), [domainIndex, domainId, persistDomainOrder]);

    const [{ isOverCurrent }, drop] = useDrop(() => ({
        accept: ['taskPlan', 'areaCard', 'domainTab'],
        canDrop: (item, monitor) => {
            const type = monitor.getItemType();
            return type === 'taskPlan' || type === 'domainTab';
        },
        drop: (item, monitor) => {
            // Accept task drops to prevent browser snap-back animation.
            // Returning {task: null} tells TaskEdit's end handler this is a cancel.
            if (monitor.getItemType() === 'taskPlan') {
                return { task: null };
            }
        },
        hover: (item, monitor) => {
            const type = monitor.getItemType();

            if (type === 'domainTab') {
                const dragIndex = item.domainIndex;
                const hoverIndex = domainIndex;
                if (dragIndex === hoverIndex) {
                    item.settled = true;
                    return;
                }
                if (item.movePending) return;
                if (item.settled === false) return;

                moveDomainTab(dragIndex, hoverIndex);
                item.domainIndex = hoverIndex;
                item.settled = false;

                item.movePending = true;
                setTimeout(() => {
                    item.movePending = false;
                }, 150);
                return;
            }

            // Task/area card hover — delayed tab switch
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
    }), [domainIndex, domainId, onDragTabSwitch, moveDomainTab]);

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

    // Combine drag and drop refs
    const combinedRef = useCallback((el) => {
        drag(el);
        drop(el);
    }, [drag, drop]);

    return (
        <Tab
            ref={combinedRef}
            data-testid={`domain-tab-${domainIndex}`}
            {...tabProps}
            sx={{
                ...tabProps.sx,
                ...(isDragging && { opacity: 0.4 }),
                ...(isOverCurrent && !isDragging && {
                    backgroundColor: 'action.hover',
                }),
            }}
        />
    );
};

export default DroppableTab;
