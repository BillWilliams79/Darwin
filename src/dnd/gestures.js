// gestures.js — the timed parts of the press timeline that ride alongside a
// drag (req #3662): hover-to-switch and long-press-to-edit.

import { useCallback, useEffect, useRef } from 'react';
import { LONG_PRESS_MS, PRESS_SLOP_PX, TAB_HOVER_SWITCH_MS } from './pressTimeline';

/**
 * Cancel whatever drag is in flight. dnd-kit's pointer and touch sensors end a
 * drag on Escape and expose no other handle, so a gesture that must take the
 * press away mid-drag (a long press turning into an edit) says Escape.
 */
export function cancelActiveDrag(doc = document) {
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}

/**
 * Fire `onSwitch` once a drag has hovered this target for TAB_HOVER_SWITCH_MS.
 * Leaving resets the clock; a target that already fired waits for the pointer
 * to leave before it can fire again.
 */
export function useHoverSwitch({ hovering, onSwitch, delay = TAB_HOVER_SWITCH_MS }) {
    const onSwitchRef = useRef(onSwitch);
    onSwitchRef.current = onSwitch;
    useEffect(() => {
        if (!hovering) return undefined;
        const timer = setTimeout(() => onSwitchRef.current?.(), delay);
        return () => clearTimeout(timer);
    }, [hovering, delay]);
}

/**
 * Long press that fires WHILE STILL HELD (the plan canvas's gesture, req
 * #3580): held within PRESS_SLOP_PX for LONG_PRESS_MS. Pointer events, so one
 * code path serves mouse, pen and touch. If the hold has already lifted the
 * item into a drag (touch lifts at LIFT_DELAY_MS, before this fires), the drag
 * is cancelled first — the press becomes an edit, not a drop.
 *
 * Returns handlers to spread onto the element; `mergeHandlers` combines them
 * with dnd-kit's listeners.
 */
export function useLongPress(onLongPress, { enabled = true, ms = LONG_PRESS_MS, slop = PRESS_SLOP_PX } = {}) {
    const press = useRef(null);
    const callback = useRef(onLongPress);
    callback.current = onLongPress;

    const clear = useCallback(() => {
        if (press.current) clearTimeout(press.current.timer);
        press.current = null;
    }, []);

    useEffect(() => clear, [clear]);

    const onPointerDown = useCallback((event) => {
        clear();
        if (!enabled || !event.isPrimary || event.button !== 0) return;
        const { clientX: x, clientY: y } = event;
        press.current = {
            x, y,
            timer: setTimeout(() => {
                press.current = null;
                cancelActiveDrag(event.target?.ownerDocument);
                callback.current?.();
            }, ms),
        };
    }, [clear, enabled, ms]);

    const onPointerMove = useCallback((event) => {
        const p = press.current;
        if (p && Math.hypot(event.clientX - p.x, event.clientY - p.y) > slop) clear();
    }, [clear, slop]);

    return { onPointerDown, onPointerMove, onPointerUp: clear, onPointerCancel: clear };
}

/** Combine several `{ onX: fn }` handler maps; every handler for an event runs. */
export function mergeHandlers(...maps) {
    const merged = {};
    maps.filter(Boolean).forEach(map => {
        Object.entries(map).forEach(([name, fn]) => {
            if (typeof fn !== 'function') return;
            const prev = merged[name];
            merged[name] = prev ? (...args) => { prev(...args); fn(...args); } : fn;
        });
    });
    return merged;
}
