// @vitest-environment jsdom
//
// req #3735 — the Orchestrables box docks to the Darwin navbar like every other
// Action Popup: its title-bar move publishes the rack drag (so the
// navbar glows in its purple), released over the navbar it racks — portalled
// into the rack slot at the navbar's width, nothing to stretch — and dragged off
// it floats again where it was dropped. A carry released over an epic still
// seats the set and leaves it racked; maximized, the rack is suspended.
// (jsdom has no layout: rects are faked.)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import UnorchestratedReqBox, { ORCHESTRABLES_RACK_ID } from '../UnorchestratedReqBox';
import { usePanelRackStore } from '../../../stores/usePanelRackStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POS_KEY = 'darwin-plan-unseated-box-window-pos';
const ZONE = { left: 0, top: 0, width: 180, height: 600 };
const items = [
    { id: 11, title: 'First thing', requirement_status: 'swarm_ready' },
    { id: 12, title: 'Second thing', requirement_status: 'swarm_ready' },
];

const rectOf = (r) => ({ ...r, right: r.left + r.width, bottom: r.top + r.height });
const place = (el, r) => { el.getBoundingClientRect = () => rectOf(r); };

let host, root, zone, slotNode;
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

beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    usePanelRackStore.setState({ racked: [], slot: null, drag: null, covered: false });
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => 1000 });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => 600 });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mountRack();
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    zone.remove();
    delete document.documentElement.clientWidth;
    delete document.documentElement.clientHeight;
});

// Anywhere in the document: racked, the box lives in the navbar's slot.
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const box = () => q('pipeline-viz-unseated');
const bar = () => q('pipeline-viz-unseated-header');
// The box's drawn geometry, re-applied after a rack or unrack re-mounts it.
function withGeometry({ left = 700, top = 8, width = 280 } = {}) {
    const b = box();
    const pane = { clientWidth: 1000, clientHeight: 600 };
    Object.defineProperty(b, 'offsetParent', { configurable: true, get: () => pane });
    Object.defineProperty(b, 'offsetLeft', { configurable: true, get: () => left });
    Object.defineProperty(b, 'offsetTop', { configurable: true, get: () => top });
    Object.defineProperty(b, 'offsetWidth', { configurable: true, get: () => width });
    Object.defineProperty(bar(), 'offsetHeight', { configurable: true, get: () => 36 });
    b.getBoundingClientRect = () => rectOf({ left, top, width, height: b.offsetHeight });
}
const fire = (type, x, y) => act(() => {
    bar().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
});
const drag = (from, to, end = 'pointerup') => {
    fire('pointerdown', ...from);
    fire('pointermove', ...to);
    fire(end, ...to);
};
const rackIt = () => {
    withGeometry();
    drag([710, 20], [90, 300]);
    withGeometry({ left: 0, top: 200, width: 180 });
};

describe('UnorchestratedReqBox — the navbar rack (req #3735)', () => {
    it('names itself in the rack and starts floating', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        expect(box().getAttribute('data-rack-id')).toBe(ORCHESTRABLES_RACK_ID);
        expect(box().getAttribute('data-racked')).toBe('0');
        expect(host.contains(box())).toBe(true);
    });

    it('over the navbar it publishes the drag in its purple and turns translucent', () => {
        act(() => root.render(<UnorchestratedReqBox items={[]} />));
        withGeometry();
        fire('pointerdown', 710, 20);
        fire('pointermove', 500, 300);
        expect(usePanelRackStore.getState().drag).toEqual(expect.objectContaining(
            { id: ORCHESTRABLES_RACK_ID, over: false, color: '#a64dff', fromRack: false }));
        fire('pointermove', 90, 300);
        expect(usePanelRackStore.getState().drag).toEqual(expect.objectContaining(
            { id: ORCHESTRABLES_RACK_ID, over: true, index: 0 }));
        expect(getComputedStyle(box()).opacity).toBe('0.75');
        fire('pointerup', 90, 300);
        expect(usePanelRackStore.getState().drag).toBeNull();
    });

    it('released over the navbar it racks into the slot, its floating spot untouched', () => {
        const onMoveDrop = vi.fn(() => true);
        const onMoveOver = vi.fn();
        act(() => root.render(<UnorchestratedReqBox items={items}
            onMoveDrop={onMoveDrop} onMoveOver={onMoveOver} />));
        rackIt();
        expect(usePanelRackStore.getState().racked).toEqual([ORCHESTRABLES_RACK_ID]);
        expect(slotNode.contains(box())).toBe(true);
        expect(box().getAttribute('data-racked')).toBe('1');
        // The navbar is no epic: the carry offers no seat, and its outline clears.
        expect(onMoveDrop).not.toHaveBeenCalled();
        expect(onMoveOver).toHaveBeenLastCalledWith(null, null);
        // Floating spot kept for the day it is dragged out.
        expect(box().getAttribute('data-pos')).toBe('home');
        expect(window.localStorage.getItem(POS_KEY)).toBeNull();
        // The navbar's width, the Action Popups' type, nothing to stretch.
        expect(box().style.width).toBe('100%');
        expect(box().style.fontSize).toBe('12px');
        expect(box().style.position).toBe('relative');
        expect(q('pipeline-viz-unseated-grip-strip')).toBeNull();
        expect(q('pipeline-viz-unseated-grip')).toBeNull();
        // Its rows still feed the plan from the navbar: each is still the
        // dnd-kit drag source (req #3665), not a native draggable.
        const row = q('pipeline-viz-unseated-item-11');
        expect(row.getAttribute('role')).toBe('button');
        expect(row.getAttribute('data-dragging')).toBe('0');
        expect(row.getAttribute('draggable')).toBeNull();
    });

    it('racked, its list is its rows: a stretch made while floating never sizes it (req #3747)', () => {
        window.localStorage.setItem('darwin-plan-unseated-box-size', JSON.stringify({ ws: 1, hEm: 40 }));
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const list = () => q('pipeline-viz-unseated-list');
        // Floating, the reader's stretch holds.
        expect(list().style.height).not.toBe('');
        rackIt();
        expect(box().getAttribute('data-racked')).toBe('1');
        expect(list().style.height).toBe('');
        expect(box().style.height).toBe('');
    });

    it('folded in the rack it keeps its whole name, and double-click does nothing', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        rackIt();
        act(() => { q('pipeline-viz-unseated-toggle').click(); });
        expect(box().getAttribute('data-open')).toBe('0');
        expect(q('pipeline-viz-unseated-title').textContent).toBe('Orchestrables');
        expect(box().style.width).toBe('100%');
        act(() => { bar().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
        expect(box().getAttribute('data-racked')).toBe('1');
    });

    it('dragged off the navbar it floats again where it was dropped', () => {
        act(() => root.render(<UnorchestratedReqBox items={[]} />));
        rackIt();
        fire('pointerdown', 20, 210);
        fire('pointermove', 420, 310);
        // Lifted out: drawn fixed under the pointer, still portalled.
        expect(box().style.position).toBe('fixed');
        expect(slotNode.contains(box())).toBe(true);
        expect(usePanelRackStore.getState().drag).toEqual(expect.objectContaining(
            { fromRack: true, over: false }));
        fire('pointerup', 420, 310);
        expect(usePanelRackStore.getState().racked).toEqual([]);
        expect(host.contains(box())).toBe(true);
        expect(box().getAttribute('data-racked')).toBe('0');
        expect(JSON.parse(window.localStorage.getItem(POS_KEY))).toEqual({ x: 400, y: 300 });
        expect(box().getAttribute('data-pos')).toBe('400,300');
    });

    it('a carry from the rack released over an epic seats the set and stays racked', () => {
        const onMoveDrop = vi.fn(() => true);
        act(() => root.render(<UnorchestratedReqBox items={items} onMoveDrop={onMoveDrop} />));
        rackIt();
        drag([20, 210], [520, 300]);
        expect(onMoveDrop).toHaveBeenCalledWith(520, 300);
        expect(usePanelRackStore.getState().racked).toEqual([ORCHESTRABLES_RACK_ID]);
        expect(slotNode.contains(box())).toBe(true);
        expect(box().style.position).toBe('relative');
        expect(usePanelRackStore.getState().drag).toBeNull();
    });

    it('a cancelled move from the rack leaves it racked', () => {
        act(() => root.render(<UnorchestratedReqBox items={[]} />));
        rackIt();
        drag([20, 210], [520, 300], 'pointercancel');
        expect(usePanelRackStore.getState().racked).toEqual([ORCHESTRABLES_RACK_ID]);
        expect(slotNode.contains(box())).toBe(true);
        expect(usePanelRackStore.getState().drag).toBeNull();
    });

    it('a cancelled move over the navbar never racks it', () => {
        act(() => root.render(<UnorchestratedReqBox items={[]} />));
        withGeometry();
        drag([710, 20], [90, 300], 'pointercancel');
        expect(usePanelRackStore.getState().racked).toEqual([]);
        expect(usePanelRackStore.getState().drag).toBeNull();
    });

    it('lands last in the stack, at the bottom of the other racked windows (req #3744)', () => {
        // Another window already racked and drawn below the nav buttons.
        const other = document.createElement('div');
        other.setAttribute('data-rack-id', 'devservers');
        place(other, { left: 0, top: 400, width: 180, height: 100 });
        slotNode.appendChild(other);
        usePanelRackStore.setState({ racked: ['devservers'] });
        act(() => root.render(<UnorchestratedReqBox items={[]} />));
        withGeometry();
        drag([710, 20], [90, 550]);
        expect(usePanelRackStore.getState().racked).toEqual(['devservers', ORCHESTRABLES_RACK_ID]);
        expect(box().style.order).toBe('2');
    });

    it('in the icon-only navbar it keeps its ▾ and badge, and its rows their ids', () => {
        act(() => usePanelRackStore.getState().setSlot({ node: slotNode, width: 64 }));
        usePanelRackStore.setState({ racked: [ORCHESTRABLES_RACK_ID] });
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        expect(slotNode.contains(box())).toBe(true);
        expect(q('pipeline-viz-unseated-count').textContent).toBe('2');
        expect(q('pipeline-viz-unseated-toggle')).not.toBeNull();
        expect(q('pipeline-viz-unseated-title')).toBeNull();
        expect(q('pipeline-viz-unseated-item-id-11').textContent).toBe('11');
        expect(q('pipeline-viz-unseated-item-title-11')).toBeNull();
    });

    it('with the navbar covered (the page maximized), a racked box floats and the navbar takes no drop', () => {
        usePanelRackStore.setState({ racked: [ORCHESTRABLES_RACK_ID], covered: true });
        act(() => root.render(<UnorchestratedReqBox items={[]} />));
        expect(q('pipeline-viz-unseated-header').title).not.toContain('navbar');
        expect(host.contains(box())).toBe(true);
        expect(box().getAttribute('data-racked')).toBe('0');
        // Its place in the rack is kept for when the page is restored.
        expect(usePanelRackStore.getState().racked).toEqual([ORCHESTRABLES_RACK_ID]);
        act(() => usePanelRackStore.setState({ racked: [] }));
        withGeometry();
        fire('pointerdown', 710, 20);
        fire('pointermove', 90, 300);
        expect(usePanelRackStore.getState().drag).toEqual(expect.objectContaining({ over: false }));
        fire('pointerup', 90, 300);
        expect(usePanelRackStore.getState().racked).toEqual([]);
        expect(window.localStorage.getItem(POS_KEY)).not.toBeNull();
        // Uncovered, a racked box is back in the navbar.
        act(() => usePanelRackStore.setState({ racked: [ORCHESTRABLES_RACK_ID], covered: false }));
        expect(slotNode.contains(box())).toBe(true);
    });

    it('reorders from the rack: dropped back on the navbar below the stack, it goes last', () => {
        const other = document.createElement('div');
        other.setAttribute('data-rack-id', 'devservers');
        place(other, { left: 0, top: 300, width: 180, height: 100 });
        slotNode.appendChild(other);
        usePanelRackStore.setState({ racked: [ORCHESTRABLES_RACK_ID, 'devservers'] });
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        withGeometry({ left: 0, top: 200, width: 180 });
        drag([20, 210], [90, 550]);
        expect(usePanelRackStore.getState().racked).toEqual(['devservers', ORCHESTRABLES_RACK_ID]);
        expect(slotNode.contains(box())).toBe(true);
        expect(usePanelRackStore.getState().drag).toBeNull();
    });

    it('a lost pointer capture mid-move from the rack leaves it racked, the drag ended', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        rackIt();
        drag([20, 210], [520, 300], 'lostpointercapture');
        expect(usePanelRackStore.getState().racked).toEqual([ORCHESTRABLES_RACK_ID]);
        expect(slotNode.contains(box())).toBe(true);
        expect(box().style.position).toBe('relative');
        expect(usePanelRackStore.getState().drag).toBeNull();
    });
});
