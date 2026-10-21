// Req #3580 — "fast click to zoom, long click to edit, double click to double
// zoom". The timing rules of the one tracker every canvas target shares.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    createPressTracker, LONG_PRESS_MS, DOUBLE_CLICK_MS, PRESS_SLOP_PX,
} from '../planPressGesture';

const cbs = () => ({ onClick: vi.fn(), onDoubleClick: vi.fn(), onLongPress: vi.fn() });

describe('createPressTracker (req #3580)', () => {
    let tr;
    beforeEach(() => { vi.useFakeTimers(); tr = createPressTracker(); });
    afterEach(() => { tr.dispose(); vi.useRealTimers(); });

    it('a quick click fires onClick once the double-click window closes', () => {
        const c = cbs();
        tr.down('a', 0, 0, c);
        tr.up('a');
        expect(c.onClick).not.toHaveBeenCalled();
        vi.advanceTimersByTime(DOUBLE_CLICK_MS);
        expect(c.onClick).toHaveBeenCalledTimes(1);
        expect(c.onDoubleClick).not.toHaveBeenCalled();
        expect(c.onLongPress).not.toHaveBeenCalled();
    });

    it('two quick clicks are ONE double click and no single click', () => {
        const c = cbs();
        tr.down('a', 0, 0, c); tr.up('a');
        vi.advanceTimersByTime(DOUBLE_CLICK_MS - 50);
        tr.down('a', 1, 1, c); tr.up('a');
        vi.advanceTimersByTime(1000);
        expect(c.onDoubleClick).toHaveBeenCalledTimes(1);
        expect(c.onClick).not.toHaveBeenCalled();
    });

    it('holding still fires onLongPress while still held, and the release does nothing', () => {
        const c = cbs();
        tr.down('a', 0, 0, c);
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(c.onLongPress).toHaveBeenCalledTimes(1);
        tr.up('a');
        vi.advanceTimersByTime(1000);
        expect(c.onClick).not.toHaveBeenCalled();
    });

    it('hands the long press its PRESS point, for the editor\'s caret (req #3665)', () => {
        const c = cbs();
        tr.down('a', 120, 48, c);
        tr.move(122, 49);
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(c.onLongPress).toHaveBeenCalledWith({ x: 120, y: 48 });
        tr.up('a');
        vi.advanceTimersByTime(1000);
        expect(c.onClick).not.toHaveBeenCalled();
        expect(c.onDoubleClick).not.toHaveBeenCalled();
    });

    it('moving past the slop is a pan: nothing fires', () => {
        const c = cbs();
        tr.down('a', 0, 0, c);
        tr.move(PRESS_SLOP_PX + 1, 0);
        vi.advanceTimersByTime(LONG_PRESS_MS);
        tr.up('a');
        vi.advanceTimersByTime(1000);
        expect(c.onClick).not.toHaveBeenCalled();
        expect(c.onLongPress).not.toHaveBeenCalled();
    });

    it('jitter inside the slop is still a click', () => {
        const c = cbs();
        tr.down('a', 0, 0, c);
        tr.move(PRESS_SLOP_PX - 1, 0);
        tr.up('a');
        vi.advanceTimersByTime(DOUBLE_CLICK_MS);
        expect(c.onClick).toHaveBeenCalledTimes(1);
    });

    it('a click on a different target does not pair into a double; the first still fires', () => {
        const a = cbs();
        const b = cbs();
        tr.down('a', 0, 0, a); tr.up('a');
        tr.down('b', 0, 0, b);
        expect(a.onClick).toHaveBeenCalledTimes(1);   // flushed by the new press
        tr.up('b');
        vi.advanceTimersByTime(DOUBLE_CLICK_MS);
        expect(b.onClick).toHaveBeenCalledTimes(1);
        expect(a.onDoubleClick).not.toHaveBeenCalled();
        expect(b.onDoubleClick).not.toHaveBeenCalled();
    });

    it('a target with no double-click handler fires its click at once', () => {
        const c = { onClick: vi.fn() };
        tr.down('a', 0, 0, c); tr.up('a');
        expect(c.onClick).toHaveBeenCalledTimes(1);
    });

    it('cancel (pointer left) drops the press without firing anything', () => {
        const c = cbs();
        tr.down('a', 0, 0, c);
        tr.cancel();
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
        tr.up('a');
        vi.advanceTimersByTime(1000);
        expect(c.onLongPress).not.toHaveBeenCalled();
        expect(c.onClick).not.toHaveBeenCalled();
    });

    it('a click followed by a press-and-drag on the same target is a pan: the click is dropped', () => {
        const c = cbs();
        tr.down('a', 0, 0, c); tr.up('a');
        tr.down('a', 0, 0, c);
        tr.move(PRESS_SLOP_PX + 10, 0);
        vi.advanceTimersByTime(1000);
        tr.up('a');
        vi.advanceTimersByTime(1000);
        expect(c.onClick).not.toHaveBeenCalled();
        expect(c.onDoubleClick).not.toHaveBeenCalled();
    });

    it('flush (a press on bare canvas) fires a waiting click at once', () => {
        const c = cbs();
        tr.down('a', 0, 0, c); tr.up('a');
        tr.flush();
        expect(c.onClick).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1000);
        expect(c.onClick).toHaveBeenCalledTimes(1);
    });

    it('a long press on the second press of a pair edits, and the first click is dropped', () => {
        const c = cbs();
        tr.down('a', 0, 0, c); tr.up('a');
        tr.down('a', 0, 0, c);
        vi.advanceTimersByTime(LONG_PRESS_MS);
        tr.up('a');
        vi.advanceTimersByTime(1000);
        expect(c.onLongPress).toHaveBeenCalledTimes(1);
        expect(c.onClick).not.toHaveBeenCalled();
        expect(c.onDoubleClick).not.toHaveBeenCalled();
    });
});
