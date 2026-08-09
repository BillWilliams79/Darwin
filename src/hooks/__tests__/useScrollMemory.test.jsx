// @vitest-environment jsdom
//
// Req #3311 — the LIFECYCLE half of scroll memory.
//
// `scrollMemory.test.js` pins the storage contract. This pins the things only the
// hook can get wrong, each of which is SILENT when it does:
//   · a scroll with no commit writes NOTHING (the fling that never settles)
//   · unmount commits anyway — the main path this feature exists for, since the
//     reader's last act before leaving is usually the scroll being remembered
//   · a restore that lands SHORT must not overwrite the position it failed to
//     apply (the echo), and must keep trying while the content grows
//   · a reader who scrolls during a restore WINS, and is recorded
//   · a commit that straddles a key change files the position under the key it
//     was TAKEN under (this page survives an in-place plan switch without
//     remounting)
//   · a null key persists nothing AND restores nothing
//
// ── THE DOUBLE CLAMPS AND EMITS, BECAUSE A REAL SCROLLER DOES ─────────────
// jsdom implements no layout, so `scrollTop` on a real node is a getter pinned
// at 0 and every assertion here would pass vacuously. But a double whose
// position is a plain field is just as useless in the other direction: the two
// behaviours this hook is BUILT AROUND are that a write CLAMPS to the content
// height and that it EMITS a `scroll` event. Both are modelled below.
//
// ── FRAMES ARE QUEUED, NOT SYNCHRONOUS ────────────────────────────────────
// Running an rAF callback inline would apply the restore BEFORE the effect
// attaches its listener — an ordering no browser produces, and one that hides
// the echo the hook exists to recognise. `runFrames` drains the queue after the
// render, one frame at a time, honouring cancellation.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { useScrollMemory } from '../useScrollMemory';
import { readScroll, scrollStorageKey, writeScroll } from '../../utils/viewportMemory';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const KEY = scrollStorageKey('test-surface', 1);
const OTHER = scrollStorageKey('test-surface', 2);

/** A scrolling element that clamps to its content and fires `scroll`. */
function makeTarget({ maxX = 0, maxY = 0 } = {}) {
    return {
        _x: 0,
        _y: 0,
        maxX,
        maxY,
        handlers: {},
        get scrollLeft() { return this._x; },
        set scrollLeft(v) { this.scrollTo(v, this._y); },
        get scrollTop() { return this._y; },
        set scrollTop(v) { this.scrollTo(this._x, v); },
        scrollTo(x, y) {
            const nx = Math.max(0, Math.min(x, this.maxX));
            const ny = Math.max(0, Math.min(y, this.maxY));
            if (nx === this._x && ny === this._y) return;
            this._x = nx;
            this._y = ny;
            this.handlers.scroll?.();
        },
        /** The content got taller — a DataGrid finishing its measure pass. */
        grow(maxY) { this.maxY = maxY; },
        addEventListener(type, fn) { this.handlers[type] = fn; },
        removeEventListener(type) { delete this.handlers[type]; },
    };
}

let queue = [];
let nextFrameId = 1;
let cancelledFrames = new Set();

/** Drain `n` animation frames, one at a time, honouring cancellation. */
function runFrames(n = 1) {
    for (let i = 0; i < n; i += 1) {
        const due = queue;
        queue = [];
        due.forEach(({ id, cb }) => { if (!cancelledFrames.has(id)) cb(0); });
    }
}

function mount(props) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    function Probe({ storageKey, target, restore }) {
        useScrollMemory(storageKey, target, { restore });
        return null;
    }
    const render = (p) => act(() => {
        root.render(<Probe storageKey={p.storageKey} target={p.target}
                           restore={p.restore !== false} />);
    });
    render(props);
    return { rerender: render, unmount: () => act(() => root.unmount()) };
}

describe('useScrollMemory', () => {
    beforeEach(() => {
        localStorage.clear();
        queue = [];
        nextFrameId = 1;
        cancelledFrames = new Set();
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
            const id = nextFrameId;
            nextFrameId += 1;
            queue.push({ id, cb });
            return id;
        });
        vi.spyOn(globalThis, 'cancelAnimationFrame')
            .mockImplementation((id) => { cancelledFrames.add(id); });
    });
    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    describe('restore', () => {
        it('applies a stored position the content can reach', () => {
            writeScroll(KEY, { x: 40, y: 900 });
            const target = makeTarget({ maxX: 500, maxY: 2000 });
            const h = mount({ storageKey: KEY, target });
            runFrames(1);
            expect({ x: target.scrollLeft, y: target.scrollTop }).toEqual({ x: 40, y: 900 });
            h.unmount();
        });

        it('leaves the target alone when nothing is stored', () => {
            const target = makeTarget({ maxY: 2000 });
            target.scrollTo(0, 8);
            const h = mount({ storageKey: KEY, target });
            runFrames(4);
            expect(target.scrollTop).toBe(8);
            h.unmount();
        });

        // THE MAJOR ONE. A scroll assignment emits a `scroll` event, so a restore
        // that the scroller CLAMPS would otherwise record the clamped value and
        // commit it on unmount — destroying the position it failed to apply, and
        // destroying it worse on every subsequent visit rather than recovering.
        it('a restore the content cannot reach does NOT overwrite the stored position', () => {
            writeScroll(KEY, { x: 0, y: 2000 });
            const target = makeTarget({ maxY: 300 });     // still loading: short
            const h = mount({ storageKey: KEY, target });
            runFrames(30);
            expect(target.scrollTop).toBe(300);            // clamped, as a browser would
            h.unmount();
            expect(readScroll(KEY)).toEqual({ x: 0, y: 2000 });
        });

        // The reason the retry exists: a DataGrid auto-heights through a
        // ResizeObserver round trip, so the content is short for a few frames
        // after the rows render.
        it('keeps trying while the content is still growing', () => {
            writeScroll(KEY, { x: 0, y: 900 });
            const target = makeTarget({ maxY: 100 });
            const h = mount({ storageKey: KEY, target });
            runFrames(2);
            expect(target.scrollTop).toBe(100);            // short so far
            target.grow(2000);                             // layout settles
            runFrames(2);
            expect(target.scrollTop).toBe(900);            // and it lands
            h.unmount();
        });

        it('gives up after a bounded number of frames', () => {
            writeScroll(KEY, { x: 0, y: 900 });
            const target = makeTarget({ maxY: 100 });
            const h = mount({ storageKey: KEY, target });
            runFrames(40);                                 // well past the budget
            target.grow(2000);
            runFrames(10);
            expect(target.scrollTop).toBe(100);            // no longer retrying
            h.unmount();
        });

        // A retry that fought the reader would be worse than no retry at all.
        it('a reader who scrolls during the restore WINS, and is recorded', () => {
            writeScroll(KEY, { x: 0, y: 900 });
            const target = makeTarget({ maxY: 100 });
            const h = mount({ storageKey: KEY, target });
            runFrames(1);
            target.grow(2000);
            target.scrollTo(0, 50);                        // the reader takes over
            runFrames(10);
            expect(target.scrollTop).toBe(50);
            h.unmount();
            expect(readScroll(KEY)).toEqual({ x: 0, y: 50 });
        });

        it('stops applying after unmount — the frames are cancelled', () => {
            writeScroll(KEY, { x: 0, y: 900 });
            const target = makeTarget({ maxY: 100 });
            const h = mount({ storageKey: KEY, target });
            runFrames(1);
            h.unmount();
            target.grow(2000);
            runFrames(10);
            expect(target.scrollTop).toBe(100);            // never re-applied
        });

        // The restore is read once per key, so a second plan's position is
        // applied when the key changes under a component that never remounts.
        it('restores the NEW key when the key changes in place', () => {
            writeScroll(OTHER, { x: 0, y: 120 });
            const target = makeTarget({ maxY: 2000 });
            const h = mount({ storageKey: KEY, target });
            runFrames(2);
            h.rerender({ storageKey: OTHER, target });
            runFrames(2);
            expect(target.scrollTop).toBe(120);
            h.unmount();
        });
    });

    describe('record and commit', () => {
        it('a scroll alone writes nothing; unmount writes once', () => {
            const target = makeTarget({ maxY: 2000 });
            const h = mount({ storageKey: KEY, target });
            target.scrollTo(0, 500);
            expect(readScroll(KEY)).toBeNull();
            h.unmount();
            expect(readScroll(KEY)).toEqual({ x: 0, y: 500 });
        });

        it('writes only the LAST position of a burst', () => {
            const target = makeTarget({ maxX: 500, maxY: 2000 });
            const h = mount({ storageKey: KEY, target });
            target.scrollTo(0, 100);
            target.scrollTo(0, 200);
            target.scrollTo(12, 300);
            h.unmount();
            expect(readScroll(KEY)).toEqual({ x: 12, y: 300 });
        });

        it('unmount with no scroll at all writes nothing — never a 0,0 clobber', () => {
            writeScroll(KEY, { x: 5, y: 600 });
            const target = makeTarget({ maxX: 500, maxY: 2000 });
            const h = mount({ storageKey: KEY, target });
            runFrames(3);
            h.unmount();
            expect(readScroll(KEY)).toEqual({ x: 5, y: 600 });
        });

        // The echo is consumed ONCE, not permanently muted: the reader's own
        // scrolling after a successful restore still records.
        it('records a real scroll that follows a successful restore', () => {
            writeScroll(KEY, { x: 0, y: 600 });
            const target = makeTarget({ maxY: 2000 });
            const h = mount({ storageKey: KEY, target });
            runFrames(3);
            expect(target.scrollTop).toBe(600);
            target.scrollTo(0, 1400);
            h.unmount();
            expect(readScroll(KEY)).toEqual({ x: 0, y: 1400 });
        });

        // `pagehide` covers the returns where nothing unmounts: a reload, a tab
        // close, a Back served from the bfcache.
        it('commits on pagehide, without an unmount', () => {
            const target = makeTarget({ maxY: 2000 });
            const h = mount({ storageKey: KEY, target });
            target.scrollTo(0, 250);
            act(() => { window.dispatchEvent(new Event('pagehide')); });
            expect(readScroll(KEY)).toEqual({ x: 0, y: 250 });
            h.unmount();
        });

        it('files the position under the key it was TAKEN under', () => {
            const target = makeTarget({ maxY: 2000 });
            const h = mount({ storageKey: KEY, target });
            target.scrollTo(0, 400);
            // The plan changes in place. The pending position belongs to the
            // OUTGOING plan and must not be filed under the incoming one.
            h.rerender({ storageKey: OTHER, target });
            expect(readScroll(KEY)).toEqual({ x: 0, y: 400 });
            expect(readScroll(OTHER)).toBeNull();
            h.unmount();
        });

        it('stops listening after unmount', () => {
            const target = makeTarget({ maxY: 2000 });
            const h = mount({ storageKey: KEY, target });
            h.unmount();
            expect(target.handlers.scroll).toBeUndefined();
        });
    });

    describe('restore: false — a deep link owns this landing', () => {
        // Suppressing the whole hook would be the tempting one-liner and it
        // silently drops the reader's position for the whole visit.
        it('does not restore, but still records', () => {
            writeScroll(KEY, { x: 0, y: 900 });
            const target = makeTarget({ maxY: 2000 });
            const h = mount({ storageKey: KEY, target, restore: false });
            runFrames(4);
            expect(target.scrollTop).toBe(0);
            target.scrollTo(0, 1250);                      // where the link left them
            h.unmount();
            expect(readScroll(KEY)).toEqual({ x: 0, y: 1250 });
        });
    });

    describe('a null key persists nothing and restores nothing', () => {
        it('does not restore', () => {
            writeScroll(KEY, { x: 40, y: 900 });
            const target = makeTarget({ maxX: 500, maxY: 2000 });
            const h = mount({ storageKey: null, target });
            runFrames(4);
            expect(target.scrollTop).toBe(0);
            h.unmount();
        });

        it('does not record, and never touches the stored value', () => {
            writeScroll(KEY, { x: 40, y: 900 });
            const target = makeTarget({ maxX: 500, maxY: 2000 });
            const h = mount({ storageKey: null, target });
            expect(target.handlers.scroll).toBeUndefined();
            h.unmount();
            expect(readScroll(KEY)).toEqual({ x: 40, y: 900 });
        });

        // The gate the pipelines list uses: park while the page is a spinner,
        // then restore for real once the rows exist.
        it('restores when the key arrives later', () => {
            writeScroll(KEY, { x: 0, y: 300 });
            const target = makeTarget({ maxY: 2000 });
            const h = mount({ storageKey: null, target });
            runFrames(2);
            expect(target.scrollTop).toBe(0);
            h.rerender({ storageKey: KEY, target });
            runFrames(2);
            expect(target.scrollTop).toBe(300);
            h.unmount();
        });
    });

    describe('a null target waits for its element', () => {
        // What a `useState`-held callback ref holds until its node lands. It must
        // NOT fall back to the window, or one surface's position would be filed
        // under another's key.
        it('persists nothing while the element is absent', () => {
            writeScroll(KEY, { x: 9, y: 9 });
            const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
            const h = mount({ storageKey: KEY, target: null });
            runFrames(4);
            expect(scrollTo).not.toHaveBeenCalled();
            h.unmount();
            expect(readScroll(KEY)).toEqual({ x: 9, y: 9 });
        });
    });

    describe('the document scroller', () => {
        // The default target. jsdom has no layout, so these assert the CALL and
        // the READ — that the window branch is taken, that `scrollTo(x, y)` gets
        // its arguments in the order that cannot be written backwards silently,
        // and that the offsets come from `scrollX/scrollY` rather than the
        // element vocabulary.
        let scroll;
        beforeEach(() => {
            scroll = { x: 0, y: 0 };
            vi.spyOn(window, 'scrollTo').mockImplementation((x, y) => {
                scroll = { x, y };
            });
            Object.defineProperty(window, 'scrollX',
                { configurable: true, get: () => scroll.x });
            Object.defineProperty(window, 'scrollY',
                { configurable: true, get: () => scroll.y });
        });
        afterEach(() => {
            // `vi.restoreAllMocks` does not undo `defineProperty`. jsdom's own
            // values are plain data properties on the window.
            Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
            Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
        });

        it('restores through window.scrollTo(x, y)', () => {
            writeScroll(KEY, { x: 3, y: 77 });
            const h = mount({ storageKey: KEY, target: undefined });
            runFrames(1);
            expect(window.scrollTo).toHaveBeenCalledWith(3, 77);
            h.unmount();
        });

        it('records the window offsets on scroll', () => {
            const h = mount({ storageKey: KEY, target: undefined });
            scroll = { x: 11, y: 220 };
            act(() => { window.dispatchEvent(new Event('scroll')); });
            h.unmount();
            expect(readScroll(KEY)).toEqual({ x: 11, y: 220 });
        });
    });
});
