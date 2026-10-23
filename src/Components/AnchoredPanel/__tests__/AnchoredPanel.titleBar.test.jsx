// @vitest-environment jsdom
//
// Req #3857 — an Action Popup locked into the page's title bar: dragged over
// the bar it glows; released there the panel is LOCKED — drawn in the bar where
// it was dropped, only in its free space (never over the bar's own controls),
// nothing to reshape; dragged off it floats again; dropped on the navbar it
// racks and the lock goes. A bar with no room floats it, the lock kept.
// (jsdom has no layout: rects are faked.)

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
const locks = [];
const docks = [];
function Panel({ lockable = true, initialLock = null }) {
    const [dock, setDock] = useState(HOME);
    const [lock, setLock] = useState(initialLock);
    return (
        <AnchoredPanel dock={dock} rackId="f"
                       onDockChange={(d) => { docks.push(d); setDock(d || HOME); }}
                       {...(lockable ? { titleLock: lock, onTitleLockChange: (l) => { locks.push(l); setLock(l); } } : {})}
                       open onToggle={() => {}} name="Requirement" testid="f" limits={LIMITS} colors={COLORS}>
            {({ shapedWidth }) => <div data-testid="f-content" data-w={String(shapedWidth)}>rows</div>}
        </AnchoredPanel>
    );
}

let bar, chip, zone, slotNode;
/** The page's title bar, 200–1600 at y 20–52, with one control at 500–600. */
function mountBar() {
    bar = document.createElement('div');
    bar.setAttribute('data-title-bar', '');
    place(bar, { left: 200, top: 20, width: 1400, height: 32 });
    chip = document.createElement('button');
    place(chip, { left: 500, top: 24, width: 100, height: 24 });
    bar.appendChild(chip);
    document.body.appendChild(bar);
}
function mountRack() {
    zone = document.createElement('div');
    zone.setAttribute('data-panel-rack-zone', '');
    place(zone, { left: 0, top: 0, width: 180, height: 1000 });
    slotNode = document.createElement('div');
    zone.appendChild(slotNode);
    document.body.appendChild(zone);
    act(() => usePanelRackStore.getState().setSlot({ node: slotNode, width: 180 }));
}
const head = () => screen.getByTestId('f-header');
const panel = () => screen.getByTestId('f');
const press = (at) => fireEvent.pointerDown(head(), { button: 0, pointerId: 1, clientX: at[0], clientY: at[1] });
const moveTo = (at) => fireEvent.pointerMove(head(), { pointerId: 1, clientX: at[0], clientY: at[1] });
const release = (at) => fireEvent.pointerUp(head(), { pointerId: 1, clientX: at[0], clientY: at[1] });
const drag = (from, to, check) => { press(from); moveTo(to); check?.(); release(to); };

describe('AnchoredPanel locked into the title bar (req #3857)', () => {
    beforeEach(() => {
        locks.length = 0;
        docks.length = 0;
        localStorage.clear();
        usePanelRackStore.setState({ racked: [], slot: null, navSlot: null, pageSlot: null, drag: null, covered: false });
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1600, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 1000, configurable: true });
        mountBar();
    });
    afterEach(() => { cleanup(); bar.remove(); zone?.remove(); zone = null; });

    it('dragged over the bar it glows; released there it is locked where it was dropped', () => {
        render(<Panel />);
        place(panel(), { left: 1000, top: 600, width: 150, height: 100 });
        expect(panel().getAttribute('data-title-locked')).toBe('0');
        drag([1010, 610], [810, 40], () => {
            expect(bar.getAttribute('data-title-bar-over')).toBe('1');
            expect(bar.style.boxShadow).not.toBe('');
        });
        expect(bar.getAttribute('data-title-bar-over')).toBe(null);
        expect(bar.style.boxShadow).toBe('');
        // Dropped with its left at 800: 600 from the bar's left end, nearer the left.
        expect(locks).toEqual([{ side: 'l', x: 600 }]);
        expect(docks).toEqual([]);
        const p = panel();
        expect(p.getAttribute('data-title-locked')).toBe('1');
        expect(p.style.left).toBe('800px');
        // Its head centred on the bar's line: 20 + (32 − 30) / 2.
        expect(p.style.top).toBe('21px');
        // Locked, nothing reshapes it; the width is its content's (minW in jsdom).
        expect(p.style.width).toBe('120px');
        expect(screen.queryByTestId('f-edge-se')).toBe(null);
        expect(screen.queryByTestId('f-grip')).toBe(null);
        expect(screen.getByTestId('f-content').getAttribute('data-w')).toBe('null');
    });

    it('never over the bar\'s own controls: dropped on one, it locks in the gap beside it', () => {
        render(<Panel />);
        place(panel(), { left: 1000, top: 600, width: 150, height: 100 });
        // Its left at 520 — over the 500–600 control.
        drag([1010, 610], [530, 40]);
        const left = parseInt(panel().style.left, 10);
        const right = left + parseInt(panel().style.width, 10);
        expect(right <= 500 || left >= 600).toBe(true);
        // The lock is where it LANDED, not where it was dropped.
        expect(locks).toEqual([{ side: 'l', x: left - 200 }]);
        // The control was not moved.
        expect(chip.getBoundingClientRect().left).toBe(500);
    });

    it('stays where it was put as the bar is redrawn; floats while the bar has no room, the lock kept', async () => {
        const redraw = () => act(async () => {
            window.dispatchEvent(new Event('resize'));
            await new Promise(r => requestAnimationFrame(r));
        });
        render(<Panel initialLock={{ side: 'l', x: 600 }} />);
        expect(panel().getAttribute('data-title-locked')).toBe('1');
        expect(panel().style.left).toBe('800px');
        // The bar moves (a wider navbar): the panel moves with it, 600 in.
        place(bar, { left: 300, top: 20, width: 1300, height: 32 });
        await redraw();
        expect(panel().style.left).toBe('900px');
        // The bar fills up: no gap 120 wide anywhere — it floats, never over them.
        place(chip, { left: 300, top: 24, width: 1300, height: 24 });
        await redraw();
        expect(panel().getAttribute('data-title-locked')).toBe('0');
        expect(locks).toEqual([]);
        // Room again: back where it was put.
        place(chip, { left: 500, top: 24, width: 100, height: 24 });
        await redraw();
        expect(panel().getAttribute('data-title-locked')).toBe('1');
        expect(panel().style.left).toBe('900px');
    });

    it('dragged off the bar it floats where it was dropped, the lock gone', () => {
        render(<Panel initialLock={{ side: 'l', x: 600 }} />);
        place(panel(), { left: 800, top: 21, width: 150, height: 30 });
        drag([810, 30], [1010, 630]);
        expect(locks).toEqual([null]);
        expect(docks.length).toBe(1);
        expect(panel().getAttribute('data-title-locked')).toBe('0');
    });

    it('dropped on the navbar it racks, and the lock goes', () => {
        mountRack();
        render(<Panel initialLock={{ side: 'l', x: 600 }} />);
        place(panel(), { left: 800, top: 21, width: 150, height: 30 });
        drag([810, 30], [90, 400]);
        expect(usePanelRackStore.getState().racked).toEqual(['f']);
        expect(locks).toEqual([null]);
        expect(slotNode.contains(panel())).toBe(true);
    });

    it('a racked panel dragged straight onto the bar leaves the rack locked there', () => {
        mountRack();
        usePanelRackStore.setState({ racked: ['f'] });
        render(<Panel />);
        place(panel(), { left: 0, top: 300, width: 180, height: 100 });
        drag([60, 310], [810, 40], () => expect(bar.getAttribute('data-title-bar-over')).toBe('1'));
        expect(usePanelRackStore.getState().racked).toEqual([]);
        expect(locks.length).toBe(1);
        expect(panel().getAttribute('data-title-locked')).toBe('1');
        expect(slotNode.contains(panel())).toBe(false);
        expect(docks).toEqual([]);
    });

    it('a cancelled drag over the bar clears its glow and changes nothing', () => {
        render(<Panel />);
        place(panel(), { left: 1000, top: 600, width: 150, height: 100 });
        press([1010, 610]);
        moveTo([810, 40]);
        expect(bar.getAttribute('data-title-bar-over')).toBe('1');
        fireEvent.pointerCancel(head(), { pointerId: 1, clientX: 810, clientY: 40 });
        expect(bar.getAttribute('data-title-bar-over')).toBe(null);
        expect(bar.style.boxShadow).toBe('');
        expect(locks).toEqual([]);
        expect(docks).toEqual([]);
    });

    it('a host that offers no lock: the bar is no drop zone', () => {
        render(<Panel lockable={false} />);
        place(panel(), { left: 1000, top: 600, width: 150, height: 100 });
        drag([1010, 610], [810, 40], () => expect(bar.getAttribute('data-title-bar-over')).toBe(null));
        expect(panel().getAttribute('data-title-locked')).toBe(null);
        expect(docks.length).toBe(1);
    });
});
