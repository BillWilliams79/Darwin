import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import Tab from '@mui/material/Tab';
import { useDragTabStore } from '../stores/useDragTabStore';

const DroppableTab = ({ domainIndex, domainId, domainName, setDomainInsertIndex, persistDomainOrder, ...tabProps }) => {

    const onDragTabSwitch = useDragTabStore(s => s.onDragTabSwitch);

    const hoverTimerRef = useRef(null);
    const wasOverRef = useRef(false);
    const firedRef = useRef(false);
    const monitorRef = useRef(null);
    const tabRef = useRef(null);

    const [insertIndicator, setInsertIndicator] = useState(null); // 'left' | 'right' | null

    const [{ isDragging }, drag, preview] = useDrag(() => ({
        type: 'domainTab',
        item: () => {
            const rect = tabRef.current?.getBoundingClientRect();
            return {
                domainIndex,
                domainId,
                domainName,
                sourceWidth: rect?.width || 100,
                sourceHeight: rect?.height || 48,
            };
        },
        collect: (monitor) => ({
            isDragging: !!monitor.isDragging(),
        }),
        end: (_item, monitor) => {
            persistDomainOrder(monitor.didDrop(), _item.domainId);
        },
    }), [domainIndex, domainId, domainName, persistDomainOrder]);

    // Suppress browser drag ghost — custom drag layer renders preview
    useEffect(() => {
        preview(getEmptyImage());
    }, [preview]);

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
            if (monitor.getItemType() === 'domainTab') {
                return { domainTab: true };
            }
        },
        hover: (item, monitor) => {
            const type = monitor.getItemType();

            if (type === 'domainTab') {
                if (item.domainId === domainId) {
                    setInsertIndicator(null);
                    return;
                }

                const clientOffset = monitor.getClientOffset();
                if (!clientOffset || !tabRef.current) return;

                const hoverRect = tabRef.current.getBoundingClientRect();
                const hoverClientX = clientOffset.x - hoverRect.left;
                const hoverMiddleX = (hoverRect.right - hoverRect.left) / 2;

                if (hoverClientX < hoverMiddleX) {
                    setInsertIndicator('left');
                    setDomainInsertIndex(domainIndex);
                } else {
                    setInsertIndicator('right');
                    setDomainInsertIndex(domainIndex + 1);
                }
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
    }), [domainIndex, domainId, onDragTabSwitch, setDomainInsertIndex]);

    // Clear insert indicator when hover ends
    useEffect(() => {
        if (wasOverRef.current && !isOverCurrent) {
            if (hoverTimerRef.current !== null) {
                clearTimeout(hoverTimerRef.current);
                hoverTimerRef.current = null;
            }
            firedRef.current = false;
            setInsertIndicator(null);
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
        tabRef.current = el;
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
                ...(isDragging && {
                    width: 0,
                    minWidth: 0,
                    padding: 0,
                    overflow: 'hidden',
                    opacity: 0,
                }),
                ...(insertIndicator === 'left' && {
                    borderLeft: '3px solid',
                    borderLeftColor: 'primary.main',
                }),
                ...(insertIndicator === 'right' && {
                    borderRight: '3px solid',
                    borderRightColor: 'primary.main',
                }),
            }}
        />
    );
};

export default DroppableTab;
