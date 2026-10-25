// DarwinDndContext.jsx — the drag surface every DOM view mounts (req #3662).
//
// One component owns everything about a drag that is the same on every
// surface, so a surface only says what may land where (drop policies) and what
// a drop means (its onDragEnd):
//
//   sensors          the press timeline — DarwinPointerSensor (mouse/pen, 4 px),
//                    DarwinTouchSensor (hold to lift), KeyboardSensor
//   collisions       one policy-driven rule (dropPolicy.js)
//   measuring        ALWAYS: a tab hover-switch reveals a panel mid-drag, and
//                    rects measured at lift would leave its cards unreachable
//   auto-scroll      the page and every scroll container under the item —
//                    dnd-kit scrolls the scrollable ancestors of whatever the
//                    pointer is over, so the tab strip scrolls when a dragged
//                    task hovers its edge
//   the ONE overlay  a faithful clone of the lifted node (DragClone), with the
//                    lift itself — shadow and a slight scale — plus a haptic
//                    tick on a touch lift where the platform has one
//
// Every DOM drag surface mounts it: the Plan view (req #3662), the Swarm cards
// view with its aggregator and the Recurring page (req #3663), and — through
// ReorderList — the four editors, the Maps view bar and a test plan's cases,
// plus the phone calendar list (req #3664) — and the plan canvas's
// Orchestrables box, whose rows drop onto Konva epic cards (req #3665).
// react-dnd and @hello-pangea/dnd are gone from the app; only the requirement
// marks ON the plan canvas (Konva shapes, not DOM — they keep their own
// pointer gesture on this same press timeline) and FullCalendar's desktop grid
// drag by other means.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    DndContext, DragOverlay, MeasuringStrategy, useSensor, useSensors,
    defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import Box from '@mui/material/Box';
import {
    DarwinPointerSensor, DarwinTouchSensor, KeyboardSensor, releaseLiftFocus,
    captureLiftFocus, restoreLiftFocus,
    POINTER_SENSOR_OPTIONS, TOUCH_SENSOR_OPTIONS, KEYBOARD_CODES,
} from './sensors';
import { createDarwinCollisionDetection, darwinKeyboardCoordinates } from './dropPolicy';
import { LIFT_VIBRATE_MS } from './pressTimeline';
import DragClone, { cloneForPreview, liftedNode } from './DragClone';
import { usePressStore } from './pressStore';

const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };

// Scroll when the pointer is within the outer 12% of a scroll container; the
// stock 20% starts the page moving from well inside a phone screen.
const AUTO_SCROLL = { threshold: { x: 0.12, y: 0.12 }, acceleration: 12 };

const DROP_ANIMATION = {
    duration: 180,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }),
};

const isTouchEvent = (event) =>
    typeof TouchEvent !== 'undefined' && event instanceof TouchEvent;

function setPageDragging(on) {
    const { style } = document.body;
    style.userSelect = on ? 'none' : '';
    style.webkitUserSelect = on ? 'none' : '';
    // iOS: no text-selection loupe or link callout under a finger that is
    // carrying an item (once every surface's own patch, req #3664).
    style.webkitTouchCallout = on ? 'none' : '';
    style.cursor = on ? 'grabbing' : '';
}

/**
 * @param {Object} props
 * @param {Function} [props.onDragStart]
 * @param {Function} [props.onDragOver]
 * @param {Function} [props.onDragEnd]
 * @param {Function} [props.onDragCancel]
 * @param {(active: object) => React.ReactNode} [props.renderOverlay] a surface
 *        may supply its own preview for some items; null falls back to the clone
 * @param {(active: object) => number} [props.liftScale] per-item lift scale
 * @param {Object|Function} [props.overlaySx] a surface's own look for the lifted
 *        item, in place of the pickup (scale, pop, deep shadow) — the editors
 *        keep the look their rows had before the foundation (req #3664)
 * @param {Function} [props.collisionDetection] a surface whose targets are not
 *        DOM droppables answers "what is under the pointer" itself — the plan
 *        canvas hit-tests its Konva epic cards (req #3665). Read once, at mount.
 */
export default function DarwinDndContext({
    children, onDragStart, onDragOver, onDragMove, onDragEnd, onDragCancel,
    renderOverlay, liftScale, overlaySx, collisionDetection: customCollision,
    dropDuration = DROP_ANIMATION.duration, dropEasing = DROP_ANIMATION.easing,
}) {
    // req #3804 — a surface whose items travel far (a card grid, corner to
    // corner) settles the dropped item on its own, slower curve; every other
    // surface keeps the house 180ms.
    const dropAnimation = useMemo(() => (
        dropDuration === DROP_ANIMATION.duration && dropEasing === DROP_ANIMATION.easing
            ? DROP_ANIMATION : { ...DROP_ANIMATION, duration: dropDuration, easing: dropEasing }),
    [dropDuration, dropEasing]);
    const sensors = useSensors(
        useSensor(DarwinPointerSensor, POINTER_SENSOR_OPTIONS),
        useSensor(DarwinTouchSensor, TOUCH_SENSOR_OPTIONS),
        useSensor(KeyboardSensor, {
            keyboardCodes: KEYBOARD_CODES,
            coordinateGetter: darwinKeyboardCoordinates,
        }),
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const collisionDetection = useMemo(() => customCollision ?? createDarwinCollisionDetection(), []);

    const activeRef = useRef(null);
    const copyRef = useRef(null);
    const focusSpotRef = useRef(null);
    const liftSizeRef = useRef(null);
    const overListRef = useRef(null);
    const [, forceRender] = React.useReducer(x => x + 1, 0);

    // A press building toward a lift: the item sinks (useDarwinDrag reads the
    // store), so the hold reads as "about to pick up".
    const handlePending = useCallback(({ id }) => usePressStore.getState().press(id), []);
    const handleAbort = useCallback(() => usePressStore.getState().release(), []);

    const handleStart = useCallback((event) => {
        usePressStore.getState().release();
        activeRef.current = event.active;
        // The preview is copied NOW, while the source still looks like itself —
        // onDragStart runs before React commits the lift.
        copyRef.current = cloneForPreview(liftedNode(event.activatorEvent));
        // ...and its SIZE: a surface may shrink the slot the item leaves (a tall
        // task's slot is one row), and dnd-kit would size the overlay from it.
        const box = liftedNode(event.activatorEvent)?.getBoundingClientRect();
        liftSizeRef.current = box ? { width: box.width, height: box.height } : null;
        overListRef.current = event.active.data.current?.containerId ?? null;
        collisionDetection.reset?.();
        setPageDragging(true);
        // Read the clicked field's cursor BEFORE the lift takes its focus away.
        focusSpotRef.current = captureLiftFocus(event.activatorEvent, liftedNode(event.activatorEvent));
        releaseLiftFocus(event.activatorEvent?.target, liftedNode(event.activatorEvent));
        if (isTouchEvent(event.activatorEvent)) navigator.vibrate?.(LIFT_VIBRATE_MS);
        forceRender();
        onDragStart?.(event);
    }, [collisionDetection, onDragStart]);

    // When the pointer crosses into another list, the surface may re-home the
    // item there; hold the collision answer for a frame while that lands.
    const handleOver = useCallback((event) => {
        const data = event.over?.data.current;
        const list = data ? (data.kind === 'container' ? event.over.id : data.containerId) : null;
        if (list !== overListRef.current) {
            overListRef.current = list;
            collisionDetection.noteContainerChange?.();
        }
        onDragOver?.(event);
    }, [collisionDetection, onDragOver]);

    const finish = useCallback(() => {
        // A long click on text that became a drag: once the item has landed,
        // the cursor goes back into that text.
        const spot = focusSpotRef.current;
        focusSpotRef.current = null;
        if (spot) setTimeout(() => restoreLiftFocus(spot), dropAnimation.duration + 20);
        activeRef.current = null;
        copyRef.current = null;
        liftSizeRef.current = null;
        setPageDragging(false);
        forceRender();
    }, [dropAnimation.duration]);

    const handleEnd = useCallback((event) => {
        finish();
        onDragEnd?.(event);
    }, [finish, onDragEnd]);

    const handleCancel = useCallback((event) => {
        finish();
        onDragCancel?.(event);
    }, [finish, onDragCancel]);

    // A page that unmounts mid-drag must not leave the whole app unselectable.
    useEffect(() => () => { if (activeRef.current) setPageDragging(false); }, []);

    const active = activeRef.current;
    const custom = active && renderOverlay ? renderOverlay(active) : null;
    const scale = active ? (liftScale?.(active) ?? 1.03) : 1;

    return (
        <DndContext sensors={sensors}
                        collisionDetection={collisionDetection}
                        measuring={MEASURING}
                        autoScroll={AUTO_SCROLL}
                        onDragPending={handlePending}
                        onDragAbort={handleAbort}
                        onDragStart={handleStart}
                        onDragMove={onDragMove}
                        onDragOver={handleOver}
                        onDragEnd={handleEnd}
                        onDragCancel={handleCancel}>
                {children}
                <DragOverlay dropAnimation={dropAnimation} zIndex={1500}
                             style={liftSizeRef.current ?? undefined}>
                    {active && overlaySx ? (
                        <Box data-testid="drag-overlay"
                             sx={[{ width: '100%', height: '100%', overflow: 'hidden', cursor: 'grabbing' }, overlaySx]}>
                            {custom ?? <DragClone copy={copyRef.current} />}
                        </Box>
                    ) : active ? (
                        <Box data-testid="drag-overlay"
                             sx={{
                                 width: '100%', height: '100%',
                                 transform: `scale(${scale})`,
                                 transformOrigin: 'center',
                                 boxShadow: '0 12px 28px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.18)',
                                 borderRadius: 1,
                                 bgcolor: 'background.paper',
                                 overflow: 'hidden',
                                 cursor: 'grabbing',
                                 // THE PICKUP: from the pressed-in size, a pop past
                                 // its lifted size, then settle — the moment the hold
                                 // becomes a carry is unmistakable.
                                 '@keyframes darwinLift': {
                                     '0%': { transform: 'scale(0.97)', boxShadow: '0 0 0 rgba(0,0,0,0)', filter: 'brightness(0.94)' },
                                     '60%': { transform: `scale(${scale + 0.04})` },
                                     '100%': { transform: `scale(${scale})`, filter: 'none' },
                                 },
                                 animation: 'darwinLift 220ms cubic-bezier(0.2, 0, 0, 1)',
                             }}>
                            {custom ?? <DragClone copy={copyRef.current} />}
                        </Box>
                    ) : null}
                </DragOverlay>
        </DndContext>
    );
}
