// @vitest-environment jsdom
//
// req #3583 — the swarm-ready, not-orchestrated box renders its rows, its
// empty state, collapses, opens a requirement on click, and puts the
// requirement id on a native drag under the box's own MIME type.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import UnorchestratedReqBox from '../UnorchestratedReqBox';
import { UNSEATED_REQ_MIME } from '../pipelineUnseated';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
beforeEach(() => {
    window.localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const items = [
    { id: 11, title: 'First thing', requirement_status: 'swarm_ready' },
    { id: 12, title: 'Second thing', requirement_status: 'swarm_ready' },
];

describe('UnorchestratedReqBox', () => {
    it('lists each row with its id and title and counts them', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        expect(q('pipeline-viz-unseated-count').textContent).toBe('2');
        expect(q('pipeline-viz-unseated-header').textContent).toContain('Orchestration Ready');
        expect(q('pipeline-viz-unseated-item-11').textContent).toContain('First thing');
        expect(q('pipeline-viz-unseated-item-12').getAttribute('draggable')).toBe('true');
        // Chrome: d3-zoom and the world-click hit-test both skip it.
        expect(q('pipeline-viz-unseated').hasAttribute('data-viz-chrome')).toBe(true);
    });

    it('is outlined in a strong purple (req #3605)', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const css = getComputedStyle(q('pipeline-viz-unseated'));
        expect(css.borderTopWidth).toBe('2px');
        expect(css.borderTopColor).toBe('rgb(166, 77, 255)');
    });

    it('says so when nothing is waiting', () => {
        act(() => root.render(<UnorchestratedReqBox items={[]} />));
        expect(q('pipeline-viz-unseated-empty')).not.toBeNull();
        expect(q('pipeline-viz-unseated-count').textContent).toBe('0');
    });

    it('shows neither rows nor the empty state while loading', () => {
        act(() => root.render(<UnorchestratedReqBox items={[]} isLoading />));
        expect(q('pipeline-viz-unseated-empty')).toBeNull();
        expect(q('pipeline-viz-unseated-count').textContent).toBe('…');
    });

    it('collapses to its header and reopens', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        act(() => q('pipeline-viz-unseated-toggle').click());
        expect(q('pipeline-viz-unseated-list')).toBeNull();
        expect(q('pipeline-viz-unseated-count').textContent).toBe('2');
        act(() => q('pipeline-viz-unseated-toggle').click());
        expect(q('pipeline-viz-unseated-list')).not.toBeNull();
    });

    it('opens the requirement on click', () => {
        const onOpen = vi.fn();
        act(() => root.render(<UnorchestratedReqBox items={items} onOpen={onOpen} />));
        act(() => q('pipeline-viz-unseated-item-12').click());
        expect(onOpen).toHaveBeenCalledWith(12);
    });

    it('carries the id on dragstart and greys the row only after the snapshot', () => {
        vi.useFakeTimers();
        try {
            const onDragStartItem = vi.fn();
            act(() => root.render(
                <UnorchestratedReqBox items={items} onDragStartItem={onDragStartItem} />));
            const data = {};
            const ev = new Event('dragstart', { bubbles: true });
            ev.dataTransfer = {
                setData: (k, v) => { data[k] = v; }, effectAllowed: 'all',
            };
            act(() => { q('pipeline-viz-unseated-item-11').dispatchEvent(ev); });
            expect(data[UNSEATED_REQ_MIME]).toBe('11');
            expect(onDragStartItem).not.toHaveBeenCalled();
            act(() => { vi.runAllTimers(); });
            expect(onDragStartItem).toHaveBeenCalledWith(11);
        } finally {
            vi.useRealTimers();
        }
    });

    it('greys the row being dragged', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} draggingId={11} />));
        const style = getComputedStyle(q('pipeline-viz-unseated-item-11'));
        expect(Number(style.opacity)).toBeLessThan(1);
    });

    it('takes its type size from fontPx, so it scales with the zoom', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={7.5} />));
        const box = q('pipeline-viz-unseated');
        expect(getComputedStyle(box).fontSize).toBe('7.5px');
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={15} />));
        expect(getComputedStyle(box).fontSize).toBe('15px');
    });

    it('opens in the top-right corner', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const box = q('pipeline-viz-unseated');
        expect(box.getAttribute('data-pos')).toBe('home');
        expect(box.style.top).toBe('8px');
        expect(box.style.right).toBe('8px');
    });

    // req #3622 — what docks the Urgent Review box beside this one.
    it('takes its home spot along the top edge from homeOffset', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} homeOffset="300px" />));
        const box = q('pipeline-viz-unseated');
        expect(box.style.top).toBe('8px');
        expect(box.style.right).toBe('300px');
    });

    const withGeometry = (box, header) => {
        const pane = { clientWidth: 1000, clientHeight: 600 };
        Object.defineProperty(box, 'offsetParent', { get: () => pane });
        Object.defineProperty(box, 'offsetLeft', { get: () => 700 });
        Object.defineProperty(box, 'offsetTop', { get: () => 8 });
        Object.defineProperty(box, 'offsetWidth', { get: () => 280 });
        Object.defineProperty(header, 'offsetHeight', { get: () => 36 });
    };
    const fireOn = (el) => (type, x, y) => el.dispatchEvent(new MouseEvent(type,
        { bubbles: true, clientX: x, clientY: y, button: 0 }));

    it('moves by its title bar within the pane, remembers the spot, and goes home', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        expect(getComputedStyle(bar).cursor).toBe('grabbing');
        act(() => { fire('pointermove', 410, 220); });
        expect(box.getAttribute('data-pos')).toBe('400,208');
        // (`left` itself is a CSS clamp(), which jsdom's style parser drops.)
        // Clamped: the box cannot leave the pane.
        act(() => { fire('pointermove', 5000, 5000); });
        expect(box.getAttribute('data-pos')).toBe('720,564');
        act(() => { fire('pointerup', 5000, 5000); });
        expect(getComputedStyle(bar).cursor).toBe('move');
        // Dropped in the right half: remembered from the RIGHT edge (flush = 0).
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-pos')))
            .toEqual({ r: 0, y: 564 });
        expect(box.getAttribute('data-pos')).toBe('r0,564');

        // A double-click straight after the move is the release, not "go home".
        act(() => { bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
        expect(box.getAttribute('data-pos')).toBe('r0,564');

        // Remembered on the next mount.
        act(() => root.unmount());
        root = createRoot(host);
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        expect(q('pipeline-viz-unseated').getAttribute('data-pos')).toBe('r0,564');

        // A deliberate double-click sends it home and forgets the spot.
        act(() => { q('pipeline-viz-unseated-header').dispatchEvent(
            new MouseEvent('dblclick', { bubbles: true })); });
        expect(q('pipeline-viz-unseated').getAttribute('data-pos')).toBe('home');
        expect(window.localStorage.getItem('darwin-plan-unseated-box-pos')).toBeNull();
    });

    // req #3608 — the title-bar move doubles as a drag of the whole set.
    it('reports the pointer while moving, and a drop taken as a seat sends the box back', () => {
        const onMoveOver = vi.fn();
        const onMoveDrop = vi.fn(() => true);
        act(() => root.render(<UnorchestratedReqBox items={items}
            onMoveOver={onMoveOver} onMoveDrop={onMoveDrop} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 410, 220); });
        expect(onMoveOver).toHaveBeenLastCalledWith(410, 220);
        act(() => { fire('pointerup', 410, 220); });
        expect(onMoveDrop).toHaveBeenCalledWith(410, 220);
        expect(box.getAttribute('data-pos')).toBe('home');
        expect(window.localStorage.getItem('darwin-plan-unseated-box-pos')).toBeNull();
    });

    it('a drop the visualizer declines is an ordinary move, and clears the outline', () => {
        const onMoveOver = vi.fn();
        act(() => root.render(<UnorchestratedReqBox items={items}
            onMoveOver={onMoveOver} onMoveDrop={() => false} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 110, 120); });
        act(() => { fire('pointerup', 110, 120); });
        expect(onMoveOver).toHaveBeenLastCalledWith(null, null);
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-pos')))
            .toEqual({ x: 100, y: 108 });
    });

    it('a cancelled pointer is no drop', () => {
        const onMoveDrop = vi.fn(() => true);
        act(() => root.render(<UnorchestratedReqBox items={items} onMoveDrop={onMoveDrop} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 410, 220); });
        act(() => { fire('pointercancel', 410, 220); });
        expect(onMoveDrop).not.toHaveBeenCalled();
    });

    it('an empty box only moves — it has nothing to seat', () => {
        const onMoveOver = vi.fn();
        const onMoveDrop = vi.fn(() => true);
        act(() => root.render(<UnorchestratedReqBox items={[]}
            onMoveOver={onMoveOver} onMoveDrop={onMoveDrop} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 410, 220); });
        act(() => { fire('pointerup', 410, 220); });
        expect(onMoveOver).not.toHaveBeenCalled();
        expect(onMoveDrop).not.toHaveBeenCalled();
        expect(box.getAttribute('data-pos')).not.toBe('home');
    });

    it('a box dropped in the left half is remembered from the left', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 110, 120); });
        act(() => { fire('pointerup', 110, 120); });
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-pos')))
            .toEqual({ x: 100, y: 108 });
    });

    it('a cancelled pointer ends the move; later hovering does nothing', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 410, 220); });
        act(() => { fire('pointercancel', 410, 220); });
        const after = box.getAttribute('data-pos');
        act(() => { fire('pointermove', 10, 10); });
        expect(box.getAttribute('data-pos')).toBe(after);
    });

    it('a click that wobbles does not move or remember anything', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 100, 100); });
        act(() => { fire('pointermove', 102, 101); });
        act(() => { fire('pointerup', 102, 101); });
        expect(box.getAttribute('data-pos')).toBe('home');
        expect(window.localStorage.getItem('darwin-plan-unseated-box-pos')).toBeNull();
    });

    it('a press on the collapse button never starts a move', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const box = q('pipeline-viz-unseated');
        withGeometry(box, q('pipeline-viz-unseated-header'));
        const fire = fireOn(q('pipeline-viz-unseated-toggle'));
        act(() => { fire('pointerdown', 1, 1); });
        act(() => { fire('pointermove', 200, 200); });
        expect(box.getAttribute('data-pos')).toBe('home');
    });
});
