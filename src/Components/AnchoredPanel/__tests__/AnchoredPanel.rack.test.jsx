// @vitest-environment jsdom
//
// Req #3720 — a rackable AnchoredPanel: dragged onto the navbar's drop zone it
// publishes the drag (so the navbar glows), and released there it racks —
// portalled into the navbar's rack slot at the navbar's width, nothing to
// reshape — with its floating dock untouched. More than one stack in rack
// order, a drop landing where the pointer is. Dragged off the navbar it floats
// again, docked where it was dropped. (jsdom has no layout: rects are faked.)

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

import AnchoredPanel from '../AnchoredPanel';
import { usePanelRackStore } from '../../../stores/usePanelRackStore';

const LIMITS = { minW: 120, minH: 64, autoMaxW: 420, headPx: 31 };
const COLORS = { frame: '#a64dff', background: '#000', line: '#333', text: '#fff',
    head: '#7bb8de', headHover: '#cfe4f7' };
const HOME = { h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null };
const ZONE = { left: 0, top: 0, width: 180, height: 1000 };

const place = (el, rect) => {
    el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width,
        bottom: rect.top + rect.height });
};
const docks = {};
function Panel({ id }) {
    const [dock, setDock] = useState(HOME);
    const [open, setOpen] = useState(true);
    return (
        <AnchoredPanel dock={dock} rackId={id}
                       onDockChange={(d) => { docks[id].push(d); setDock(d || HOME); }}
                       open={open} onToggle={() => setOpen(o => !o)}
                       name={`Panel ${id}`} testid={`p-${id}`} limits={LIMITS} colors={COLORS}
                       extras={<span data-testid={`p-${id}-extra`}>3</span>}
                       actions={<button type="button" data-testid={`p-${id}-x`}>×</button>}>
            {({ shapedWidth }) => <div data-testid={`p-${id}-content`} data-w={String(shapedWidth)}>rows</div>}
        </AnchoredPanel>
    );
}

let zone, slotNode;
function mountRack(width = 180) {
    zone = document.createElement('div');
    zone.setAttribute('data-panel-rack-zone', '');
    place(zone, ZONE);
    slotNode = document.createElement('div');
    slotNode.setAttribute('data-testid', 'slot');
    zone.appendChild(slotNode);
    document.body.appendChild(zone);
    act(() => usePanelRackStore.getState().setSlot({ node: slotNode, width }));
}
const head = (id) => screen.getByTestId(`p-${id}-header`);
const press = (id, at) => fireEvent.pointerDown(head(id), { button: 0, pointerId: 1, clientX: at[0], clientY: at[1] });
const moveTo = (id, at) => fireEvent.pointerMove(head(id), { pointerId: 1, clientX: at[0], clientY: at[1] });
const release = (id, at, end = 'pointerUp') => fireEvent[end](head(id), { pointerId: 1, clientX: at[0], clientY: at[1] });

describe('AnchoredPanel rack (req #3720)', () => {
    beforeEach(() => {
        docks.a = []; docks.b = []; docks.c = [];
        localStorage.clear();
        usePanelRackStore.setState({ racked: [], slot: null, drag: null, covered: false });
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1600, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 1000, configurable: true });
        mountRack();
    });
    afterEach(() => { cleanup(); zone.remove(); });

    it('dragging over the navbar publishes the drop; releasing there racks it into the slot', () => {
        render(<Panel id="a" />);
        const panel = screen.getByTestId('p-a');
        place(panel, { left: 1200, top: 800, width: 300, height: 180 });
        expect(panel.getAttribute('data-racked')).toBe('0');

        press('a', [1300, 810]);
        moveTo('a', [900, 600]);
        // Moving, not over: the navbar is not lit. The drag carries the
        // panel's frame colour, which the navbar glows in once over (req #3728).
        expect(usePanelRackStore.getState().drag).toEqual(
            { id: 'a', fromRack: false, from: null, over: false, rack: null, index: null, color: COLORS.frame });
        moveTo('a', [90, 400]);
        expect(usePanelRackStore.getState().drag).toEqual(
            { id: 'a', fromRack: false, from: null, over: true, rack: 'nav', index: 0, color: COLORS.frame });
        release('a', [90, 400]);

        expect(usePanelRackStore.getState().drag).toBe(null);
        expect(usePanelRackStore.getState().racked).toEqual(['a']);
        // Its floating dock is untouched: no onDockChange for a rack drop.
        expect(docks.a).toEqual([]);
        const racked = screen.getByTestId('p-a');
        expect(slotNode.contains(racked)).toBe(true);
        expect(racked.getAttribute('data-racked')).toBe('1');
        expect(racked.style.width).toBe('100%');
        expect(getComputedStyle(racked).position).toBe('relative');
        // The navbar's width is the panel's shaped width; nothing reshapes.
        expect(screen.getByTestId('p-a-content').getAttribute('data-w')).toBe('180');
        expect(screen.queryByTestId('p-a-edge-se')).toBe(null);
        expect(screen.queryByTestId('p-a-grip')).toBe(null);
        expect(screen.getByTestId('p-a-title').textContent).toBe('Panel a');
    });

    it('a cancelled drag over the navbar racks nothing and clears the drop zone', () => {
        render(<Panel id="a" />);
        place(screen.getByTestId('p-a'), { left: 1200, top: 800, width: 300, height: 180 });
        press('a', [1300, 810]);
        moveTo('a', [90, 400]);
        release('a', [90, 400], 'pointerCancel');
        expect(usePanelRackStore.getState().drag).toBe(null);
        expect(usePanelRackStore.getState().racked).toEqual([]);
        expect(docks.a).toEqual([]);
    });

    it('more than one stack in rack order; a drop lands where the pointer is', () => {
        usePanelRackStore.setState({ racked: ['a'] });
        render(<><Panel id="a" /><Panel id="b" /></>);
        const a = screen.getByTestId('p-a');
        expect(slotNode.contains(a)).toBe(true);
        place(a, { left: 0, top: 300, width: 180, height: 100 });   // mid 350
        place(screen.getByTestId('p-b'), { left: 1200, top: 800, width: 300, height: 180 });

        // Above a's midpoint: lands first.
        press('b', [1300, 810]);
        moveTo('b', [90, 320]);
        expect(usePanelRackStore.getState().drag.index).toBe(0);
        release('b', [90, 320]);
        expect(usePanelRackStore.getState().racked).toEqual(['b', 'a']);
        const b = screen.getByTestId('p-b');
        expect(slotNode.contains(b)).toBe(true);
        expect(getComputedStyle(b).order).toBe('0');
        expect(getComputedStyle(screen.getByTestId('p-a')).order).toBe('2');
    });

    it('open or folded, a racked panel never grows past its content: the rack row sizes it (req #3747)', () => {
        usePanelRackStore.setState({ racked: ['a'] });
        render(<Panel id="a" />);
        const a = screen.getByTestId('p-a');
        expect(a.getAttribute('data-rack-open')).toBe('1');
        expect(getComputedStyle(a).flexGrow).not.toBe('1');
        expect(a.style.height).toBe('');
        fireEvent.click(screen.getByTestId('p-a-toggle'));
        expect(a.getAttribute('data-rack-open')).toBe('0');
        expect(getComputedStyle(a).flexGrow).not.toBe('1');
    });

    it('dropped on the navbar off the stack, a panel lands last, at the bottom (req #3744)', () => {
        usePanelRackStore.setState({ racked: ['a'] });
        render(<><Panel id="a" /><Panel id="b" /></>);
        place(screen.getByTestId('p-a'), { left: 0, top: 300, width: 180, height: 100 });
        place(screen.getByTestId('p-b'), { left: 1200, top: 800, width: 300, height: 180 });

        press('b', [1300, 810]);
        // Below the stack (it ends at 400): the bottom.
        moveTo('b', [90, 800]);
        expect(usePanelRackStore.getState().drag).toEqual(
            { id: 'b', fromRack: false, from: null, over: true, rack: 'nav', index: 1, color: COLORS.frame });
        // Above it (the nav buttons): not in the list either, the bottom.
        moveTo('b', [90, 100]);
        expect(usePanelRackStore.getState().drag.index).toBe(1);
        // Pointed at a's upper half: into position, above it.
        moveTo('b', [90, 320]);
        expect(usePanelRackStore.getState().drag.index).toBe(0);
        moveTo('b', [90, 800]);
        release('b', [90, 800]);
        expect(usePanelRackStore.getState().racked).toEqual(['a', 'b']);
    });

    it('a racked panel dragged up or down the stack reorders it (req #3729)', () => {
        usePanelRackStore.setState({ racked: ['a', 'b', 'c'] });
        render(<><Panel id="a" /><Panel id="b" /><Panel id="c" /></>);
        place(screen.getByTestId('p-a'), { left: 0, top: 300, width: 180, height: 100 });   // mid 350
        place(screen.getByTestId('p-b'), { left: 0, top: 404, width: 180, height: 100 });   // mid 454
        place(screen.getByTestId('p-c'), { left: 0, top: 508, width: 180, height: 100 });   // mid 558

        // a, down between b and c.
        press('a', [60, 310]);
        moveTo('a', [60, 500]);
        expect(usePanelRackStore.getState().drag).toEqual(
            { id: 'a', fromRack: true, from: 'nav', over: true, rack: 'nav', index: 1, color: COLORS.frame });
        release('a', [60, 500]);
        expect(usePanelRackStore.getState().racked).toEqual(['b', 'a', 'c']);
        // Reordered, not floated: still in the slot, its dock untouched.
        expect(slotNode.contains(screen.getByTestId('p-a'))).toBe(true);
        expect(screen.getByTestId('p-a').getAttribute('data-racked')).toBe('1');
        expect(docks.a).toEqual([]);

        // c, dragged up past the top: first.
        press('c', [60, 520]);
        moveTo('c', [60, 100]);
        release('c', [60, 100]);
        expect(usePanelRackStore.getState().racked).toEqual(['c', 'b', 'a']);

        // c, dragged down past the stack's end: last, not back to the top.
        press('c', [60, 310]);
        moveTo('c', [60, 900]);
        expect(usePanelRackStore.getState().drag.index).toBe(2);
        release('c', [60, 900]);
        expect(usePanelRackStore.getState().racked).toEqual(['b', 'a', 'c']);
        expect(docks.c).toEqual([]);
    });

    it('dragged off the navbar, a racked panel floats again, docked where it was dropped', () => {
        usePanelRackStore.setState({ racked: ['a'] });
        render(<Panel id="a" />);
        const a = screen.getByTestId('p-a');
        place(a, { left: 0, top: 300, width: 180, height: 100 });
        press('a', [60, 310]);
        moveTo('a', [860, 510]);
        expect(usePanelRackStore.getState().drag).toEqual(
            { id: 'a', fromRack: true, from: 'nav', over: false, rack: null, index: null, color: COLORS.frame });
        // Mid-drag it is drawn fixed under the pointer, at the navbar's width.
        const live = screen.getByTestId('p-a');
        expect(getComputedStyle(live).position).toBe('fixed');
        expect(live.style.left).toBe('800px');
        expect(live.style.width).toBe('180px');
        const proto = HTMLElement.prototype.getBoundingClientRect;
        HTMLElement.prototype.getBoundingClientRect = function () {
            return this.getAttribute('data-testid') === 'p-a'
                ? { left: 800, top: 500, width: 300, height: 150, right: 1100, bottom: 650 }
                : proto.call(this);
        };
        try { release('a', [860, 510]); } finally { HTMLElement.prototype.getBoundingClientRect = proto; }

        expect(usePanelRackStore.getState().racked).toEqual([]);
        // Pinned at the drop's left and top — the floating size is not the
        // navbar's, so a right/bottom dock taken from the 180px box would draw
        // it elsewhere — then, at the size it draws (faked: 300×150), re-docked
        // to its nearest sides without moving: left 800 → right 500, top 500 →
        // bottom 350.
        expect(docks.a[0]).toEqual({ h: 'l', x: 800, v: 't', y: 500, w: null, ht: null });
        expect(docks.a[1]).toEqual({ h: 'r', x: 500, v: 'b', y: 350, w: null, ht: null });
        const floating = screen.getByTestId('p-a');
        expect(slotNode.contains(floating)).toBe(false);
        expect(floating.getAttribute('data-racked')).toBe('0');
    });

    it('racked: ▾ folds without pinning a dock, double-click does not send it home', () => {
        usePanelRackStore.setState({ racked: ['a'] });
        render(<Panel id="a" />);
        fireEvent.click(screen.getByTestId('p-a-toggle'));
        expect(screen.getByTestId('p-a-body').getAttribute('data-folded')).toBe('1');
        fireEvent.doubleClick(screen.getByTestId('p-a-title'));
        expect(docks.a).toEqual([]);
        expect(usePanelRackStore.getState().racked).toEqual(['a']);
    });

    it('in the icon-only navbar the head keeps the ▾ and extras only', () => {
        zone.remove();
        mountRack(64);
        usePanelRackStore.setState({ racked: ['a'] });
        render(<Panel id="a" />);
        expect(screen.getByTestId('p-a-toggle')).toBeTruthy();
        expect(screen.getByTestId('p-a-extra')).toBeTruthy();
        expect(screen.queryByTestId('p-a-title')).toBe(null);
        expect(screen.queryByTestId('p-a-x')).toBe(null);
        expect(screen.getByTestId('p-a-content').getAttribute('data-w')).toBe('64');
    });

    it('racked with no navbar drawn (no slot), it floats at its dock', () => {
        act(() => usePanelRackStore.getState().setSlot(null));
        usePanelRackStore.setState({ racked: ['a'] });
        render(<Panel id="a" />);
        const a = screen.getByTestId('p-a');
        expect(slotNode.contains(a)).toBe(false);
        expect(a.getAttribute('data-racked')).toBe('0');
        expect(getComputedStyle(a).position).toBe('fixed');
    });

    it('a panel with no rackId never publishes a drag', () => {
        const onDock = vi.fn();
        render(<AnchoredPanel dock={HOME} onDockChange={onDock} open onToggle={() => {}}
                              name="Plain" testid="plain" limits={LIMITS} colors={COLORS}>
            {() => null}
        </AnchoredPanel>);
        const p = screen.getByTestId('plain');
        place(p, { left: 1200, top: 800, width: 300, height: 180 });
        const h = screen.getByTestId('plain-header');
        fireEvent.pointerDown(h, { button: 0, pointerId: 1, clientX: 1300, clientY: 810 });
        fireEvent.pointerMove(h, { pointerId: 1, clientX: 90, clientY: 400 });
        expect(usePanelRackStore.getState().drag).toBe(null);
        fireEvent.pointerUp(h, { pointerId: 1, clientX: 90, clientY: 400 });
        expect(usePanelRackStore.getState().racked).toEqual([]);
        expect(onDock).toHaveBeenCalledTimes(1);
        expect(p.hasAttribute('data-rack-id')).toBe(false);
    });

    // req #3735 — a page drawn over the navbar (the Plan page maximized) suspends
    // the rack for EVERY window, the app-wide ones included.
    it('while the navbar is covered, a racked panel floats and the navbar takes no drop', () => {
        usePanelRackStore.setState({ racked: ['a'], covered: true });
        render(<Panel id="a" />);
        const panel = screen.getByTestId('p-a');
        expect(panel.getAttribute('data-racked')).toBe('0');
        expect(slotNode.contains(panel)).toBe(false);
        act(() => usePanelRackStore.setState({ racked: [] }));
        place(screen.getByTestId('p-a'), { left: 1200, top: 800, width: 300, height: 180 });
        press('a', [1300, 810]);
        moveTo('a', [90, 300]);
        expect(usePanelRackStore.getState().drag).toEqual(expect.objectContaining({ over: false }));
        release('a', [90, 300]);
        expect(usePanelRackStore.getState().racked).toEqual([]);
        expect(usePanelRackStore.getState().drag).toBeNull();
        // Uncovered, a racked panel is back in the navbar.
        act(() => usePanelRackStore.setState({ racked: ['a'], covered: false }));
        expect(slotNode.contains(screen.getByTestId('p-a'))).toBe(true);
    });
});
