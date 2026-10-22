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
 * Long press on an item that can also LIFT: held within PRESS_SLOP_PX for
 * LONG_PRESS_MS and then RELEASED there (`pressTimeline.js` says why it waits
 * for the release). Pointer events, so one code path serves mouse, pen and
 * touch. The hold has already lifted the item into a drag by then (it lifts at
 * LIFT_DELAY_MS), so the drag is cancelled first — the press becomes an edit,
 * not a drop. Moving past the slop at any point makes it a drag for good.
 *
 * Returns handlers to spread onto the element; `mergeHandlers` combines them
 * with dnd-kit's listeners.
 */
export function useLongPress(onLongPress, { enabled = true, ms = LONG_PRESS_MS, slop = PRESS_SLOP_PX } = {}) {
    const press = useRef(null);
    const callback = useRef(onLongPress);
    callback.current = onLongPress;

    const clear = useCallback(() => {
        const p = press.current;
        press.current = null;
        if (!p) return;
        clearTimeout(p.timer);
        p.detach();
    }, []);

    useEffect(() => clear, [clear]);

    // The press is followed at the DOCUMENT, in capture: once the item lifts,
    // the pointer is over the drag preview, not the item, and a mouse release
    // never reaches the item's own handlers. Capture also runs ahead of
    // dnd-kit's document listeners, so the drag is cancelled before it drops.
    const onPointerDown = useCallback((event) => {
        clear();
        if (!enabled || !event.isPrimary || event.button !== 0) return;
        const doc = event.target?.ownerDocument || document;
        const id = event.pointerId;
        const p = { x: event.clientX, y: event.clientY, held: false };
        const away = (e) => Math.hypot(e.clientX - p.x, e.clientY - p.y) > slop;
        const onMove = (e) => { if (e.pointerId === id && away(e)) clear(); };
        // Released where it was pressed, after the long press: the edit. A
        // drag carried off and brought back moved past the slop — a drop.
        const onUp = (e) => {
            if (e.pointerId !== id) return;
            const fire = p.held && !away(e);
            clear();
            if (!fire) return;
            // A finger's release would follow as a TAP — compatibility mouse
            // events and a click that take the focus straight back out of the
            // editor this opens. The touch sensor swallows its own touchend,
            // but cancelling the drag below detaches it first, so it is
            // swallowed here.
            if (e.pointerType === 'touch') {
                const done = () => {
                    doc.removeEventListener('touchend', swallow, true);
                    doc.removeEventListener('touchcancel', done, true);
                };
                const swallow = (te) => { if (te.cancelable) te.preventDefault(); done(); };
                doc.addEventListener('touchend', swallow, true);
                doc.addEventListener('touchcancel', done, true);
            }
            cancelActiveDrag(doc);
            callback.current?.();
        };
        const onCancel = (e) => { if (e.pointerId === id) clear(); };
        doc.addEventListener('pointermove', onMove, true);
        doc.addEventListener('pointerup', onUp, true);
        doc.addEventListener('pointercancel', onCancel, true);
        p.detach = () => {
            doc.removeEventListener('pointermove', onMove, true);
            doc.removeEventListener('pointerup', onUp, true);
            doc.removeEventListener('pointercancel', onCancel, true);
        };
        p.timer = setTimeout(() => { p.held = true; }, ms);
        press.current = p;
    }, [clear, enabled, ms, slop]);

    return { onPointerDown };
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
