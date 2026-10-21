// @vitest-environment jsdom
// req #3665 — on an item that can lift, the long press edits on the RELEASE in
// place, so a hold that is slow to start moving is still a drag.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useLongPress } from '../gestures';
import { LONG_PRESS_MS, PRESS_SLOP_PX } from '../pressTimeline';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
let onLong;
beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    onLong = vi.fn();
    function Item() {
        const longPress = useLongPress(onLong);
        return <button type="button" data-testid="item" {...longPress}>item</button>;
    }
    act(() => root.render(<Item />));
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
});

// Real input targets: the press on the item, the rest wherever the pointer is.
const fire = (el, type, x, y, pointerType = 'mouse') => {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(ev, 'pointerId', { value: 1 });
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    Object.defineProperty(ev, 'isPrimary', { value: true });
    act(() => { el.dispatchEvent(ev); });
};
const item = () => host.querySelector('[data-testid="item"]');

describe('useLongPress', () => {
    it('held past the long press and let go in place, it fires — on the release', () => {
        fire(item(), 'pointerdown', 10, 10);
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 200); });
        expect(onLong).not.toHaveBeenCalled();
        fire(document.body, 'pointerup', 10 + PRESS_SLOP_PX, 10);
        expect(onLong).toHaveBeenCalledTimes(1);
    });

    it('a hold slow to start moving is a drag, never an edit (the reported defect)', () => {
        fire(item(), 'pointerdown', 10, 10);
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 300); });
        fire(document.body, 'pointermove', 60, 40);
        fire(document.body, 'pointerup', 60, 40);
        expect(onLong).not.toHaveBeenCalled();
    });

    it('carried off and brought back is a drop, not an edit', () => {
        fire(item(), 'pointerdown', 10, 10);
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 100); });
        fire(document.body, 'pointermove', 200, 10);
        fire(document.body, 'pointermove', 10, 10);
        fire(document.body, 'pointerup', 10, 10);
        expect(onLong).not.toHaveBeenCalled();
    });

    it('a release before the long press is no edit', () => {
        fire(item(), 'pointerdown', 10, 10);
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS - 50); });
        fire(document.body, 'pointerup', 10, 10);
        act(() => { vi.advanceTimersByTime(500); });
        expect(onLong).not.toHaveBeenCalled();
    });

    it('cancels a drag in flight before it edits, so the release is not a drop', () => {
        const keys = vi.fn();
        document.addEventListener('keydown', keys);
        try {
            fire(item(), 'pointerdown', 10, 10);
            act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 10); });
            fire(document.body, 'pointerup', 10, 10);
            expect(keys.mock.calls[0][0].key).toBe('Escape');
            expect(onLong).toHaveBeenCalledTimes(1);
        } finally {
            document.removeEventListener('keydown', keys);
        }
    });

    it('a finger\'s release is no tap afterwards, so the editor it opened keeps the focus', () => {
        const touchEnd = () => {
            const ev = new Event('touchend', { bubbles: true, cancelable: true });
            act(() => { item().dispatchEvent(ev); });
            return ev.defaultPrevented;
        };
        fire(item(), 'pointerdown', 10, 10, 'touch');
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 50); });
        fire(document.body, 'pointerup', 10, 10, 'touch');
        expect(onLong).toHaveBeenCalledTimes(1);
        expect(touchEnd()).toBe(true);
        // Once: the next tap is a tap.
        expect(touchEnd()).toBe(false);
    });
});
