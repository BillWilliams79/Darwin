import React, { useRef, useEffect, useCallback } from 'react';
import { useDrop } from 'react-dnd';
import Tab from '@mui/material/Tab';
import { useDragTabStore } from '../stores/useDragTabStore';

const RecurringDroppableTab = ({ domainIndex, ...tabProps }) => {
    const onDragTabSwitch = useDragTabStore(s => s.onDragTabSwitch);

    const hoverTimerRef = useRef(null);
    const wasOverRef = useRef(false);
    const firedRef = useRef(false);
    const monitorRef = useRef(null);
    const tabRef = useRef(null);

    const [{ isOverCurrent }, drop] = useDrop(() => ({
        accept: ['recurringTask'],
        drop: () => ({ def: null }), // absorb drop on tab — no move, prevents snap-back
        hover: (item, monitor) => {
            monitorRef.current = monitor;
            if (firedRef.current) return;
            if (hoverTimerRef.current !== null) return;
            hoverTimerRef.current = setTimeout(() => {
                hoverTimerRef.current = null;
                const isOver = monitorRef.current?.isOver({ shallow: true });
                if (isOver) {
                    onDragTabSwitch(domainIndex);
                    firedRef.current = true;
                }
            }, 500);
        },
        collect: (monitor) => ({
            isOverCurrent: monitor.isOver({ shallow: true }),
        }),
    }), [domainIndex, onDragTabSwitch]);

    // Clear timer when hover ends
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

    const combinedRef = useCallback((el) => {
        tabRef.current = el;
        drop(el);
    }, [drop]);

    return (
        <Tab
            ref={combinedRef}
            data-testid={`recurring-domain-tab-${domainIndex}`}
            {...tabProps}
        />
    );
};

export default RecurringDroppableTab;
