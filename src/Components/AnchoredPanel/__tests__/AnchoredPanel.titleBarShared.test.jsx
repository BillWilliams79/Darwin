// @vitest-environment jsdom
//
// Req #3961 — several Action Popups locked into ONE title bar (the requirements
// views' header holds the Requirement Filer and the Dev Servers popups): none
// covers another. Placed, a popup keeps clear of those locked ahead of it in
// document order — the later one yields, the earlier one stays put; dropped,
// it keeps clear of every one locked there.
// (jsdom has no layout: rects are faked, as in AnchoredPanel.titleBar.)

import React, { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

import AnchoredPanel from '../AnchoredPanel';
import { usePanelRackStore } from '../../../stores/usePanelRackStore';

const LIMITS = { minW: 120, minH: 64, autoMaxW: 420, headPx: 30 };
const COLORS = { frame: '#a64dff', background: '#000', line: '#333', text: '#fff',
    head: '#7bb8de', headHover: '#cfe4f7' };
const HOME = { h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null };

const place = (el, rect) => {
    el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width,
        bottom: rect.top + rect.height });
};
/** Its rect as drawn now, from the inline style the lock set. */
const drawn = (el) => {
    const left = parseInt(el.style.left, 10);
    const width = parseInt(el.style.width, 10);
    return { left, right: left + width };
};
const overlaps = (a, b) => a.left < b.right && b.left < a.right;

const locks = { a: [], b: [] };
function Panel({ id, initialLock = null }) {
    const [dock, setDock] = useState(HOME);
    const [lock, setLock] = useState(initialLock);
    return (
        <AnchoredPanel dock={dock} rackId={id} onDockChange={(d) => setDock(d || HOME)}
                       titleLock={lock} onTitleLockChange={(l) => { locks[id].push(l); setLock(l); }}
                       open onToggle={() => {}} name={id} testid={id} limits={LIMITS} colors={COLORS}>
            {() => <div>rows</div>}
        </AnchoredPanel>
    );
}

let bar;
const redraw = () => act(async () => {
    // Each popup's rect follows the place the lock drew it at.
    ['a', 'b'].forEach((id) => {
        const el = screen.queryByTestId(id);
        if (el?.getAttribute('data-title-locked') === '1') {
            const { left, right } = drawn(el);
            place(el, { left, top: 21, width: right - left, height: 30 });
        }
    });
    window.dispatchEvent(new Event('resize'));
    await new Promise(r => requestAnimationFrame(r));
});

describe('Several popups locked into one title bar (req #3961)', () => {
    beforeEach(() => {
        locks.a.length = 0;
        locks.b.length = 0;
        localStorage.clear();
        usePanelRackStore.setState({ racked: [], slot: null, navSlot: null, pageSlot: null, drag: null, covered: false });
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1600, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 1000, configurable: true });
        bar = document.createElement('div');
        bar.setAttribute('data-title-bar', '');
        place(bar, { left: 200, top: 20, width: 1400, height: 32 });
        document.body.appendChild(bar);
    });
    afterEach(() => { cleanup(); bar.remove(); });

    it('two locked at one spot settle side by side: the earlier stays, the later yields', async () => {
        render(<><Panel id="a" initialLock={{ side: 'l', x: 600 }} />
                 <Panel id="b" initialLock={{ side: 'l', x: 600 }} /></>);
        // Two passes: each re-reads where the other is drawn.
        await redraw();
        await redraw();
        await redraw();
        const a = screen.getByTestId('a');
        const b = screen.getByTestId('b');
        expect(a.getAttribute('data-title-locked')).toBe('1');
        expect(b.getAttribute('data-title-locked')).toBe('1');
        expect(a.style.left).toBe('800px');
        expect(overlaps(drawn(a), drawn(b))).toBe(false);
        // Stable: another pass moves neither.
        const before = [a.style.left, b.style.left];
        await redraw();
        expect([a.style.left, b.style.left]).toEqual(before);
    });

    it('dropped onto another locked popup, it locks in the gap beside it', async () => {
        render(<><Panel id="a" initialLock={{ side: 'l', x: 600 }} /><Panel id="b" /></>);
        await redraw();
        const a = screen.getByTestId('a');
        expect(a.style.left).toBe('800px');
        const b = screen.getByTestId('b');
        place(b, { left: 1000, top: 600, width: 150, height: 100 });
        const head = screen.getByTestId('b-header');
        fireEvent.pointerDown(head, { button: 0, pointerId: 1, clientX: 1010, clientY: 610 });
        fireEvent.pointerMove(head, { pointerId: 1, clientX: 820, clientY: 40 });
        fireEvent.pointerUp(head, { pointerId: 1, clientX: 820, clientY: 40 });
        await redraw();
        expect(locks.b).toHaveLength(1);
        expect(b.getAttribute('data-title-locked')).toBe('1');
        expect(overlaps(drawn(a), drawn(b))).toBe(false);
        // The one already there did not move.
        expect(a.style.left).toBe('800px');
    });

    it('an open popup locked ahead counts as its head only: the later one stays on the bar\'s line', async () => {
        // A tall bar (the requirements views' row is 72px) — its line is the
        // band its first-line items span, and the earlier popup's open rows,
        // hanging 400px below, must not widen it.
        place(bar, { left: 200, top: 20, width: 1400, height: 72 });
        render(<><Panel id="a" initialLock={{ side: 'l', x: 100 }} />
                 <Panel id="b" initialLock={{ side: 'l', x: 600 }} /></>);
        await redraw();
        const a = screen.getByTestId('a');
        const b = screen.getByTestId('b');
        const topBefore = b.style.top;
        place(a, { left: parseInt(a.style.left, 10), top: parseInt(a.style.top, 10), width: 120, height: 400 });
        window.dispatchEvent(new Event('resize'));
        await act(async () => { await new Promise(r => requestAnimationFrame(r)); });
        expect(b.getAttribute('data-title-locked')).toBe('1');
        // Where it was (to the px the line's rounding moves it), not centred
        // on the open rows' 400px band — that put it ~200px below the bar.
        expect(Math.abs(parseInt(b.style.top, 10) - parseInt(topBefore, 10))).toBeLessThanOrEqual(1);
        expect(parseInt(b.style.top, 10)).toBeLessThan(20 + 72);
    });
});
