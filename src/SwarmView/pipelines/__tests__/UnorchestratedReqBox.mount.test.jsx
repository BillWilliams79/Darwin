// @vitest-environment jsdom
//
// req #3583 — the swarm-ready, not-orchestrated box renders its rows, its
// empty state, collapses, opens a requirement on click, and lifts a row
// through the shared dnd-kit drag surface on the press timeline (req #3665 —
// it was a native HTML5 drag).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import UnorchestratedReqBox, { FOLD_MS, UNSEATED_FLOAT_Z } from '../UnorchestratedReqBox';
import { UNSEATED_DRAG_TYPE, unseatedDragId } from '../pipelineUnseated';
import { DarwinDndContext, LIFT_DELAY_MS, LIFT_VIBRATE_MS, TOUCH_TOLERANCE_PX } from '../../../dnd';
import { buildReqColorViews, reqIdStyle } from '../pipelinePlanLayout';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
beforeEach(() => {
    window.localStorage.clear();
    // The list's fold is a remembered setting since req #3651 (per-tab
    // sessionStorage, seeded from localStorage) — clear both, or a test that
    // folds the list leaks its fold into the next.
    window.sessionStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete document.documentElement.clientWidth;
    delete document.documentElement.clientHeight;
});

// req #3687 — a PLACED box lives in the window: its frame is the viewport
// (`documentElement.clientWidth/Height`) and its spot its client rect.
const withWindow = (box, { w = 1000, h = 600, left = 0, top = 0 } = {}) => {
    Object.defineProperty(document.documentElement, 'clientWidth',
        { configurable: true, get: () => w });
    Object.defineProperty(document.documentElement, 'clientHeight',
        { configurable: true, get: () => h });
    box.getBoundingClientRect = () => ({ left, top, right: left + box.offsetWidth,
        bottom: top + box.offsetHeight, width: box.offsetWidth, height: box.offsetHeight });
};

const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const items = [
    { id: 11, title: 'First thing', requirement_status: 'swarm_ready' },
    { id: 12, title: 'Second thing', requirement_status: 'swarm_ready' },
];

describe('UnorchestratedReqBox', () => {
    it('lists each row with its id and title and counts them', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        expect(q('pipeline-viz-unseated-count').textContent).toBe('2');
        expect(q('pipeline-viz-unseated-title').textContent).toBe('Orchestrable');
        expect(q('pipeline-viz-unseated-item-11').textContent).toContain('First thing');
        // A dnd-kit draggable (req #3665), not a native one — announced as a
        // plain button, since the keys open it rather than lift it.
        expect(q('pipeline-viz-unseated-item-12').getAttribute('role')).toBe('button');
        expect(q('pipeline-viz-unseated-item-12').getAttribute('aria-roledescription')).toBeNull();
        expect(q('pipeline-viz-unseated-item-12').getAttribute('draggable')).toBeNull();
        // Chrome: d3-zoom and the world-click hit-test both skip it.
        expect(q('pipeline-viz-unseated').hasAttribute('data-viz-chrome')).toBe(true);
    });

    // req #3817 — a drop target for a requirement dragged off an epic.
    it('hands its element to the drag and shows when a requirement is over it', () => {
        const dropTargetRef = { current: null };
        act(() => root.render(<UnorchestratedReqBox items={items} dropTargetRef={dropTargetRef} />));
        const box = q('pipeline-viz-unseated');
        expect(dropTargetRef.current).toBe(box);
        expect(box.getAttribute('data-drop-armed')).toBe('');
        expect(box.getAttribute('data-drop-over')).toBe('0');
        act(() => root.render(<UnorchestratedReqBox items={items} dropTargetRef={dropTargetRef}
                                                    dropArmed="ok" />));
        expect(box.getAttribute('data-drop-armed')).toBe('ok');
        expect(q('pipeline-viz-unseated-title').textContent).toBe('Orchestrable');
        act(() => root.render(<UnorchestratedReqBox items={items} dropTargetRef={dropTargetRef}
                                                    dropArmed="ok" dropOver />));
        expect(box.getAttribute('data-drop-over')).toBe('1');
        expect(q('pipeline-viz-unseated-title').textContent).toBe('Drop to un-orchestrate');
        act(() => root.render(<UnorchestratedReqBox items={items} dropTargetRef={dropTargetRef}
                                                    dropArmed="refused" />));
        expect(box.getAttribute('data-drop-armed')).toBe('refused');
        expect(getComputedStyle(box).cursor).toBe('no-drop');
    });

    it('wraps a title to two lines at most, then an ellipsis (req #3684)', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const title = q('pipeline-viz-unseated-item-title-11');
        expect(title.textContent).toBe('First thing');
        // jsdom's computed style drops -webkit-box-orient, so read the rule
        // emotion emitted for the span's own class.
        const rule = [...document.styleSheets]
            .flatMap((s) => [...s.cssRules])
            .map((r) => r.cssText)
            .filter((t) => [...title.classList].some((c) => t.startsWith(`.${c} `)))
            .join(' ');
        expect(rule).toContain('display: -webkit-box');
        expect(rule).toContain('-webkit-box-orient: vertical');
        expect(rule).toContain('-webkit-line-clamp: 2');
        expect(rule).toContain('overflow: hidden');
        expect(rule).not.toContain('nowrap');
    });

    it('is outlined in a strong purple (req #3605)', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const css = getComputedStyle(q('pipeline-viz-unseated'));
        expect(css.borderTopWidth).toBe('2px');
        expect(css.borderTopColor).toBe('rgb(166, 77, 255)');
    });

    it('is exactly as wide as the epic width it is handed (req #3620)', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={9} widthPx={612} />));
        expect(q('pipeline-viz-unseated').style.width).toBe('612px');
    });

    it('leads each row with its category color bar (req #3619)', () => {
        const colored = [
            { id: 11, title: 'First thing', requirement_status: 'swarm_ready', category_fk: 7 },
            { id: 12, title: 'Second thing', requirement_status: 'swarm_ready', category_fk: 99 },
        ];
        act(() => root.render(
            <UnorchestratedReqBox items={colored} categoryColors={{ 7: '#ff0000' }} />));
        const bar = q('pipeline-viz-unseated-bar-11');
        // First in the row, so it reads as the row's left edge.
        expect(q('pipeline-viz-unseated-item-11').firstElementChild).toBe(bar);
        const css = getComputedStyle(bar);
        expect(css.backgroundColor).toBe('rgb(255, 0, 0)');
        // Same-hue lightened edge (RequirementRow's dark-mode rule).
        expect(css.borderTopColor).toBe('rgb(255, 114, 114)');
        // No color for that category: the slot stays, empty.
        const empty = getComputedStyle(q('pipeline-viz-unseated-bar-12'));
        expect(empty.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    });

    it('gives a color MUI cannot parse a neutral edge, not a crash', () => {
        const odd = [{ id: 11, title: 'First thing', requirement_status: 'swarm_ready', category_fk: 7 }];
        act(() => root.render(
            <UnorchestratedReqBox items={odd} categoryColors={{ 7: 'red' }} />));
        const css = getComputedStyle(q('pipeline-viz-unseated-bar-11'));
        expect(css.borderTopColor).toBe('rgba(128, 128, 128, 0.5)');
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
        vi.useFakeTimers();
        try {
            act(() => root.render(<UnorchestratedReqBox items={items} />));
            act(() => q('pipeline-viz-unseated-toggle').click());
            // The list animates out, then is gone.
            act(() => { vi.advanceTimersByTime(FOLD_MS + 100); });
            expect(q('pipeline-viz-unseated-list')).toBeNull();
            expect(q('pipeline-viz-unseated-count').textContent).toBe('2');
            act(() => q('pipeline-viz-unseated-toggle').click());
            expect(q('pipeline-viz-unseated-list')).not.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    // req #3648 — the count badge leads the title bar; folded, the bar reads
    // "OR" and the box narrows to it, animating only for the fold itself.
    it('leads with the ▾ then the count badge, and folds to a narrow "OR" bar', () => {
        vi.useFakeTimers();
        try {
            act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={612} />));
            const header = q('pipeline-viz-unseated-header');
            // Every Action Popup's controls (req #3741): ▾ upper left, the
            // upper right blank — the title is the bar's last item.
            const toggle = q('pipeline-viz-unseated-toggle');
            expect(header.firstElementChild).toBe(toggle);
            expect(toggle.textContent).toBe('▾');
            expect(toggle.getAttribute('aria-label')).toBe('Orchestrable');
            expect(toggle.nextElementSibling).toBe(q('pipeline-viz-unseated-badge'));
            expect(q('pipeline-viz-unseated-badge').firstChild).toBe(q('pipeline-viz-unseated-count'));
            expect(header.lastElementChild).toBe(q('pipeline-viz-unseated-title'));
            const box = q('pipeline-viz-unseated');
            expect(box.style.width).toBe('612px');
            expect(getComputedStyle(box).transitionProperty || 'none').not.toContain('width');

            act(() => q('pipeline-viz-unseated-toggle').click());
            expect(q('pipeline-viz-unseated-title').textContent).toBe('OR');
            expect(box.getAttribute('data-open')).toBe('0');
            // Narrow: toggle + badge + "OR", not the epic width.
            expect(box.style.width).toMatch(/^calc\(.*em.*ch.*\)$/);
            expect(box.style.width).not.toContain('612');
            expect(getComputedStyle(box).transition).toContain('width');
            // The other controls are unchanged.
            expect(q('pipeline-viz-unseated-count').textContent).toBe('2');
            expect(q('pipeline-viz-unseated-toggle').getAttribute('aria-expanded')).toBe('false');

            // The width transitions only while folding — never on a zoom frame.
            act(() => { vi.advanceTimersByTime(FOLD_MS + 100); });
            expect(getComputedStyle(box).transition || 'none').not.toContain('width');

            act(() => q('pipeline-viz-unseated-toggle').click());
            expect(q('pipeline-viz-unseated-title').textContent).toBe('Orchestrable');
            expect(box.style.width).toBe('612px');
        } finally {
            vi.useRealTimers();
        }
    });

    // req #3684 — rows wrap, so their height follows the width: through a fold
    // the list is laid out at the OPEN box's inner width, never the narrowing
    // box's, so the unfold animates to the height it ends at.
    it('holds the list at the open width for the length of a fold', () => {
        vi.useFakeTimers();
        try {
            act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={612} />));
            const box = q('pipeline-viz-unseated');
            const pane = { clientWidth: 500, clientHeight: 600 };
            Object.defineProperty(box, 'offsetParent', { get: () => pane });
            Object.defineProperty(box, 'offsetWidth', { get: () => 100 });
            Object.defineProperty(box, 'clientWidth', { get: () => 96 });
            expect(q('pipeline-viz-unseated-list').style.width).toBe('');

            // Fold: still drawn while it animates out, at the open width.
            act(() => q('pipeline-viz-unseated-toggle').click());
            act(() => { vi.advanceTimersByTime(FOLD_MS + 100); });

            // Unfold: the pane caps the box (500 − 2 × 8 inset), less a 4px
            // border, whatever its folded width is mid-transition.
            act(() => q('pipeline-viz-unseated-toggle').click());
            const list = q('pipeline-viz-unseated-list');
            const boxSizing = getComputedStyle(box).boxSizing;
            expect(list.style.width).toBe(boxSizing === 'border-box' ? '480px' : '484px');

            // At rest it is the box's width again.
            act(() => { vi.advanceTimersByTime(FOLD_MS + 100); });
            expect(list.style.width).toBe('');
        } finally {
            vi.useRealTimers();
        }
    });

    it('opens the requirement on click', () => {
        const onOpen = vi.fn();
        act(() => root.render(<UnorchestratedReqBox items={items} onOpen={onOpen} />));
        act(() => q('pipeline-viz-unseated-item-12').click());
        expect(onOpen).toHaveBeenCalledWith(12);
    });

    // req #3665 — a row lifts through the shared drag surface: held still, a
    // mouse press lifts it (the long click), it greys while in the air, and its
    // drag carries the requirement for the canvas's collision detection.
    const press = (el, type, { x = 10, y = 10, pointerType = 'mouse' } = {}) => {
        const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
        Object.defineProperty(ev, 'pointerType', { value: pointerType });
        Object.defineProperty(ev, 'pointerId', { value: 1 });
        Object.defineProperty(ev, 'isPrimary', { value: true });
        el.dispatchEvent(ev);
    };

    it('a held row lifts through the shared drag surface, carrying its requirement, and greys', () => {
        vi.useFakeTimers();
        try {
            const onDragStart = vi.fn();
            const onDragCancel = vi.fn();
            act(() => root.render(
                <DarwinDndContext onDragStart={onDragStart} onDragCancel={onDragCancel}>
                    <UnorchestratedReqBox items={items} />
                </DarwinDndContext>));
            const row = q('pipeline-viz-unseated-item-11');
            act(() => { press(row, 'pointerdown'); });
            expect(onDragStart).not.toHaveBeenCalled();
            act(() => { vi.advanceTimersByTime(LIFT_DELAY_MS); });
            expect(onDragStart).toHaveBeenCalledTimes(1);
            const { active } = onDragStart.mock.calls[0][0];
            expect(active.id).toBe(unseatedDragId(11));
            expect(active.data.current.type).toBe(UNSEATED_DRAG_TYPE);
            expect(Number(active.data.current.row.id)).toBe(11);
            const lifted = q('pipeline-viz-unseated-item-11');
            expect(lifted.getAttribute('data-dragging')).toBe('1');
            expect(Number(getComputedStyle(lifted).opacity)).toBeLessThan(1);
            expect(q('pipeline-viz-unseated-item-12').getAttribute('data-dragging')).toBe('0');
            // The overlay carries a copy of the row, not an empty box.
            expect(document.querySelector('[data-testid="drag-overlay-clone"]')?.textContent).toContain('First thing');
            // Escape puts it back.
            act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); });
            act(() => { vi.runOnlyPendingTimers(); });
            expect(onDragCancel).toHaveBeenCalled();
            expect(q('pipeline-viz-unseated-item-11').getAttribute('data-dragging')).toBe('0');
        } finally {
            vi.useRealTimers();
        }
    });

    it('a quick click lifts nothing and opens the requirement', () => {
        vi.useFakeTimers();
        try {
            const onDragStart = vi.fn();
            const onOpen = vi.fn();
            act(() => root.render(
                <DarwinDndContext onDragStart={onDragStart}>
                    <UnorchestratedReqBox items={items} onOpen={onOpen} />
                </DarwinDndContext>));
            const row = q('pipeline-viz-unseated-item-12');
            act(() => { press(row, 'pointerdown'); });
            act(() => { vi.advanceTimersByTime(80); });
            act(() => { press(row, 'pointerup'); row.click(); });
            act(() => { vi.advanceTimersByTime(LIFT_DELAY_MS); });
            expect(onDragStart).not.toHaveBeenCalled();
            expect(onOpen).toHaveBeenCalledWith(12);
        } finally {
            vi.useRealTimers();
        }
    });

    it('from the keys a row is a button that opens the requirement, never a lift', () => {
        const onDragStart = vi.fn();
        const onOpen = vi.fn();
        act(() => root.render(
            <DarwinDndContext onDragStart={onDragStart}>
                <UnorchestratedReqBox items={items} onOpen={onOpen} />
            </DarwinDndContext>));
        const row = q('pipeline-viz-unseated-item-11');
        act(() => { row.focus(); });
        act(() => { row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); });
        expect(onDragStart).not.toHaveBeenCalled();
        expect(onOpen).toHaveBeenCalledWith(11);
        act(() => { row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); });
        expect(onOpen).toHaveBeenCalledTimes(2);
    });

    it('sets its own type size and face, so the lifted copy reads like the row', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={13} />));
        const row = q('pipeline-viz-unseated-item-11');
        expect(row.style.fontSize).toBe('13px');
        expect(getComputedStyle(row).fontFamily).toMatch(/Mono|Menlo/);
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

    // A 1000 × 600 window with the box at (700, 8) in it — at home that is
    // also its spot in a pane flush with the window.
    const withGeometry = (box, header) => {
        const pane = { clientWidth: 1000, clientHeight: 600 };
        Object.defineProperty(box, 'offsetParent', { get: () => pane });
        Object.defineProperty(box, 'offsetLeft', { get: () => 700 });
        Object.defineProperty(box, 'offsetTop', { get: () => 8 });
        Object.defineProperty(box, 'offsetWidth', { get: () => 280 });
        Object.defineProperty(header, 'offsetHeight', { get: () => 36 });
        withWindow(box, { left: 700, top: 8 });
    };
    const fireOn = (el) => (type, x, y) => el.dispatchEvent(new MouseEvent(type,
        { bubbles: true, clientX: x, clientY: y, button: 0 }));

    it('moves by its title bar within the window, remembers the spot, and goes home', () => {
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
        // Clamped: the box stays inside the window, its bottom above the 8px
        // inset (req #3677).
        act(() => { fire('pointermove', 5000, 5000); });
        expect(box.getAttribute('data-pos')).toBe('720,554');
        act(() => { fire('pointerup', 5000, 5000); });
        expect(getComputedStyle(bar).cursor).toBe('move');
        // Dropped in the right half: remembered from the RIGHT edge (flush = 0).
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')))
            .toEqual({ r: 0, y: 554 });
        expect(box.getAttribute('data-pos')).toBe('r0,554');

        // A double-click straight after the move is the release, not "go home".
        act(() => { bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
        expect(box.getAttribute('data-pos')).toBe('r0,554');

        // Remembered on the next mount.
        act(() => root.unmount());
        root = createRoot(host);
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        expect(q('pipeline-viz-unseated').getAttribute('data-pos')).toBe('r0,554');

        // A deliberate double-click sends it home and forgets the spot.
        act(() => { q('pipeline-viz-unseated-header').dispatchEvent(
            new MouseEvent('dblclick', { bubbles: true })); });
        expect(q('pipeline-viz-unseated').getAttribute('data-pos')).toBe('home');
        expect(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')).toBeNull();
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
        expect(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')).toBeNull();
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
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')))
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

    // req #3614 — see-through while carried, restored on release; the outline
    // is cleared when the gesture is cancelled or loses capture mid-carry.
    // req #3677 — the carry no longer folds the list: full size the whole time.
    it('turns see-through but keeps its list and grip strip while carrying, and restores on release', () => {
        const onCarryingChange = vi.fn();
        act(() => root.render(<UnorchestratedReqBox items={items}
            onCarryingChange={onCarryingChange} onMoveDrop={() => false} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        expect(box.getAttribute('data-carrying')).toBe('0');
        expect(Number(getComputedStyle(box).opacity)).toBe(1);
        act(() => { fire('pointerdown', 710, 20); });
        // A press that has not passed the slop is not yet a carry.
        expect(box.getAttribute('data-carrying')).toBe('0');
        act(() => { fire('pointermove', 410, 220); });
        expect(box.getAttribute('data-carrying')).toBe('1');
        expect(Number(getComputedStyle(box).opacity)).toBeLessThan(1);
        expect(q('pipeline-viz-unseated-list')).not.toBeNull();
        expect(q('pipeline-viz-unseated-item-12')).not.toBeNull();
        expect(box.getAttribute('data-open')).toBe('1');
        // The grip hides while moving, but its strip — and so the box's
        // height — stays.
        expect(q('pipeline-viz-unseated-grip')).toBeNull();
        expect(q('pipeline-viz-unseated-grip-strip')).not.toBeNull();
        expect(onCarryingChange).toHaveBeenLastCalledWith(true);
        act(() => { fire('pointerup', 410, 220); });
        expect(box.getAttribute('data-carrying')).toBe('0');
        expect(Number(getComputedStyle(box).opacity)).toBe(1);
        expect(q('pipeline-viz-unseated-list')).not.toBeNull();
        expect(onCarryingChange).toHaveBeenLastCalledWith(false);
    });

    // req #3677 — a move is clamped by the box's FULL height, never just its
    // title bar, so the pane's maxHeight can never squeeze it. The parts are
    // summed: a 36px title bar, a 16px grip strip and 2 × 2px border = 56px
    // of frame, plus the list's natural height. 2px of rounding slack.
    const withParts = (box, list, { boxH = 160, scroll = 220 } = {}) => {
        let scrollH = scroll;
        Object.defineProperty(box, 'offsetHeight', { get: () => boxH });
        Object.defineProperty(box, 'clientHeight', { get: () => boxH - 4 });
        Object.defineProperty(q('pipeline-viz-unseated-grip-strip'), 'offsetHeight',
            { get: () => 16 });
        // Squeezed: the list shows 100px of its rows (+1px top border).
        Object.defineProperty(list, 'offsetHeight', { get: () => 100 });
        Object.defineProperty(list, 'clientHeight', { get: () => 99 });
        Object.defineProperty(list, 'scrollHeight', { get: () => scrollH });
        return (v) => { scrollH = v; };
    };

    it('is clamped by its full height, so dragging low never squeezes it', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        withParts(box, q('pipeline-viz-unseated-list'));
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 710, 5000); });
        // 600 − 8 inset − 2 slack − (56 + 221) = 313.
        expect(box.getAttribute('data-pos')).toBe('700,313');
        act(() => { fire('pointerup', 710, 5000); });
        expect(box.getAttribute('data-pos')).toBe('r20,313');
    });

    it('takes the list at its 26em cap, not all its rows', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        withParts(box, q('pipeline-viz-unseated-list'), { scroll: 1000 });
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 710, 5000); });
        // 600 − 8 − 2 − (56 + 26 × 12) = 222.
        expect(box.getAttribute('data-pos')).toBe('700,222');
        act(() => { fire('pointerup', 710, 5000); });
    });

    it('a stretched list is clamped by its stretched height', () => {
        window.localStorage.setItem('darwin-plan-unseated-box-size',
            JSON.stringify({ ws: 1, hEm: 20 }));
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={10} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        withParts(box, q('pipeline-viz-unseated-list'));
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 710, 5000); });
        // 600 − 8 − 2 − (56 + 20em × 10) = 334.
        expect(box.getAttribute('data-pos')).toBe('700,334');
        act(() => { fire('pointerup', 710, 5000); });
    });

    it('a dropped box that grows is lifted so it stays whole, and the spot is kept', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const setScroll = withParts(box, q('pipeline-viz-unseated-list'));
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 710, 5000); });
        act(() => { fire('pointerup', 710, 5000); });
        expect(box.getAttribute('data-pos')).toBe('r20,313');
        // More rows arrive: 300px of them now.
        setScroll(300);
        act(() => root.render(<UnorchestratedReqBox items={[...items,
            { id: 13, title: 'Third thing', requirement_status: 'swarm_ready' }]} />));
        // 600 − 8 − 2 − (56 + 301) = 233.
        expect(box.getAttribute('data-pos')).toBe('r20,233');
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')))
            .toEqual({ r: 20, y: 313 });
    });

    it('an empty box never turns see-through — it carries nothing', () => {
        act(() => root.render(<UnorchestratedReqBox items={[]} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 410, 220); });
        expect(box.getAttribute('data-carrying')).toBe('0');
    });

    it('pointercancel mid-carry clears the outline', () => {
        const onMoveOver = vi.fn();
        act(() => root.render(<UnorchestratedReqBox items={items}
            onMoveOver={onMoveOver} onMoveDrop={() => true} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 410, 220); });
        expect(onMoveOver).toHaveBeenLastCalledWith(410, 220);
        act(() => { fire('pointercancel', 410, 220); });
        expect(onMoveOver).toHaveBeenLastCalledWith(null, null);
        expect(box.getAttribute('data-carrying')).toBe('0');
    });

    it('lostpointercapture mid-carry clears the outline and is no drop', () => {
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
        act(() => { fire('lostpointercapture', 410, 220); });
        expect(onMoveOver).toHaveBeenLastCalledWith(null, null);
        expect(onMoveDrop).not.toHaveBeenCalled();
        expect(box.getAttribute('data-carrying')).toBe('0');
    });

    // req #3741 — the ▾ leads the bar, so the box folds toward its LEFT edge.
    it('a fold holds the box\'s left: pinned while the width animates', () => {
        vi.useFakeTimers();
        try {
            act(() => root.render(<UnorchestratedReqBox items={items} widthPx={280} />));
            const box = q('pipeline-viz-unseated');
            withGeometry(box, q('pipeline-viz-unseated-header'));
            expect(box.style.left).toBe('');
            // jsdom's style parser drops a min()/clamp() value, so record what
            // React writes to `right`.
            let right = null;
            Object.defineProperty(box.style, 'right', { configurable: true,
                get: () => right ?? '', set: (v) => { right = v; } });
            act(() => q('pipeline-viz-unseated-toggle').click());
            // At home it is anchored right; mid-fold it is held at its left.
            expect(box.style.left).toBe('700px');
            act(() => { vi.advanceTimersByTime(FOLD_MS + 100); });
            expect(box.style.left).toBe('');
            expect(box.getAttribute('data-pos')).toBe('home');
            // Folded, it is drawn where the open box's ▾ is: its right offset
            // plus the width the fold shed.
            expect(right).toMatch(/^calc\(8px \+ min\(280px, 100% - 16px\) - min\(calc\(.*em.*ch.*\), 100% - 16px\)\)$/);
            // Unfolding holds the same left.
            act(() => q('pipeline-viz-unseated-toggle').click());
            expect(box.style.left).toBe('700px');
            act(() => { vi.advanceTimersByTime(FOLD_MS + 100); });
            expect(box.style.left).toBe('');
            expect(right).toBe('8px');
        } finally {
            vi.useRealTimers();
        }
    });

    it('an unfold with no room to its right is pinned where the open box fits', () => {
        vi.useFakeTimers();
        try {
            window.localStorage.setItem('darwin-plan-unseated-box-window-pos',
                JSON.stringify({ x: 900, y: 100 }));
            // Folded, dropped where the open box would not fit right-anchored.
            window.localStorage.setItem('darwin-pipeline-viz-unseated-open', '0');
            act(() => root.render(<UnorchestratedReqBox items={items} widthPx={280} />));
            const box = q('pipeline-viz-unseated');
            expect(box.getAttribute('data-open')).toBe('0');
            withWindow(box, { left: 900, top: 100 });
            act(() => q('pipeline-viz-unseated-toggle').click());
            expect(box.getAttribute('data-open')).toBe('1');
            expect(box.style.left).toBe('720px');
        } finally {
            vi.useRealTimers();
        }
    });

    it('a fold re-bases a box anchored left to where it is drawn', () => {
        window.localStorage.setItem('darwin-plan-unseated-box-window-pos',
            JSON.stringify({ x: 950, y: 100 }));
        act(() => root.render(<UnorchestratedReqBox items={items} widthPx={280} />));
        const box = q('pipeline-viz-unseated');
        // The window's clamp draws it at 720, not the remembered 950.
        withWindow(box, { left: 720, top: 100 });
        act(() => q('pipeline-viz-unseated-toggle').click());
        expect(box.getAttribute('data-pos')).toBe('720,100');
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')))
            .toEqual({ x: 720, y: 100 });
    });

    it('a folded bar dropped in the right half is remembered by its OPEN box\'s right edge', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} widthPx={280} />));
        act(() => q('pipeline-viz-unseated-toggle').click());
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        // The folded bar (90) is narrower than the open box (280).
        Object.defineProperty(box, 'offsetWidth', { get: () => 90 });
        Object.defineProperty(bar, 'offsetHeight', { get: () => 36 });
        withWindow(box, { left: 700, top: 8 });
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 610, 120); });
        act(() => { fire('pointerup', 610, 120); });
        // Its left is 600; the open box (280) ends 120 short of the edge.
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')))
            .toEqual({ r: 120, y: 108 });
        // Nearer the edge than the open box fits, it is remembered by its left.
        // (The mocked rect still reads 700, so the press starts there.)
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 910, 120); });
        act(() => { fire('pointerup', 910, 120); });
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')))
            .toEqual({ x: 900, y: 108 });
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
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')))
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
        expect(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')).toBeNull();
    });

    // req #3665 — the title bar on the shared press timeline.
    const fireTouch = (el) => (type, x, y) => {
        const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
        Object.defineProperty(ev, 'pointerType', { value: 'touch' });
        Object.defineProperty(ev, 'pointerId', { value: 7 });
        el.dispatchEvent(ev);
    };

    it('a finger that slides off the title bar before the lift moves nothing', () => {
        vi.useFakeTimers();
        try {
            act(() => root.render(<UnorchestratedReqBox items={items} />));
            const box = q('pipeline-viz-unseated');
            const bar = q('pipeline-viz-unseated-header');
            withGeometry(box, bar);
            const touch = fireTouch(bar);
            act(() => { touch('pointerdown', 710, 20); });
            act(() => { touch('pointermove', 710 + TOUCH_TOLERANCE_PX + 4, 20); });
            act(() => { touch('pointermove', 410, 220); });
            act(() => { vi.advanceTimersByTime(LIFT_DELAY_MS); });
            expect(box.getAttribute('data-pos')).toBe('home');
            expect(box.getAttribute('data-lifted')).toBe('0');
            act(() => { touch('pointerup', 410, 220); });
            expect(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('a finger held still lifts the box with a haptic tick, then carries it', () => {
        vi.useFakeTimers();
        const vibrate = vi.fn();
        const had = Object.getOwnPropertyDescriptor(navigator, 'vibrate');
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
        try {
            const onMoveOver = vi.fn();
            act(() => root.render(<UnorchestratedReqBox items={items} onMoveOver={onMoveOver} />));
            const box = q('pipeline-viz-unseated');
            const bar = q('pipeline-viz-unseated-header');
            withGeometry(box, bar);
            const touch = fireTouch(bar);
            act(() => { touch('pointerdown', 710, 20); });
            act(() => { touch('pointermove', 712, 21); });    // a resting fingertip
            expect(box.getAttribute('data-lifted')).toBe('0');
            act(() => { vi.advanceTimersByTime(LIFT_DELAY_MS); });
            expect(box.getAttribute('data-lifted')).toBe('1');
            expect(vibrate).toHaveBeenCalledWith(LIFT_VIBRATE_MS);
            act(() => { touch('pointermove', 410, 220); });
            expect(box.getAttribute('data-pos')).toBe('400,208');
            expect(onMoveOver).toHaveBeenLastCalledWith(410, 220);
            act(() => { touch('pointerup', 410, 220); });
            expect(box.getAttribute('data-lifted')).toBe('0');
        } finally {
            if (had) Object.defineProperty(navigator, 'vibrate', had);
            else delete navigator.vibrate;
            vi.useRealTimers();
        }
    });

    it('a mouse held on the title bar lifts it without moving it', () => {
        vi.useFakeTimers();
        try {
            act(() => root.render(<UnorchestratedReqBox items={items} />));
            const box = q('pipeline-viz-unseated');
            const bar = q('pipeline-viz-unseated-header');
            withGeometry(box, bar);
            const fire = fireOn(bar);
            act(() => { fire('pointerdown', 710, 20); });
            act(() => { vi.advanceTimersByTime(LIFT_DELAY_MS); });
            expect(box.getAttribute('data-lifted')).toBe('1');
            act(() => { fire('pointerup', 710, 20); });
            expect(box.getAttribute('data-lifted')).toBe('0');
            expect(box.getAttribute('data-pos')).toBe('home');
        } finally {
            vi.useRealTimers();
        }
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

    // req #3654 — stretched by its corner; text in exactly three sizes.
    const withResizeGeometry = (box, list) => {
        const pane = { clientWidth: 1000, clientHeight: 600 };
        Object.defineProperty(box, 'offsetParent', { get: () => pane });
        Object.defineProperty(box, 'offsetLeft', { get: () => 592 });
        Object.defineProperty(box, 'offsetTop', { get: () => 8 });
        Object.defineProperty(box, 'offsetWidth', { get: () => 400 });
        Object.defineProperty(list, 'offsetHeight', { get: () => 100 });
        Object.defineProperty(list, 'offsetTop', { get: () => 36 });
    };

    it('stretches leftward from its bottom-left grip at home, stepping the text up once', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        const grip = q('pipeline-viz-unseated-grip');
        expect(grip.getAttribute('data-corner')).toBe('bottom-left');
        expect(getComputedStyle(grip).cursor).toBe('nesw-resize');
        withResizeGeometry(box, q('pipeline-viz-unseated-list'));
        const fire = fireOn(grip);
        act(() => { fire('pointerdown', 600, 200); });
        // A small stretch: wider, same text.
        act(() => { fire('pointermove', 560, 200); });
        expect(box.style.width).toBe('440px');
        expect(box.getAttribute('data-text-step')).toBe('0');
        expect(box.style.fontSize).toBe('12px');
        // Sideways only: the list keeps its natural height.
        expect(q('pipeline-viz-unseated-list').style.height).toBe('');
        // A full epic wider: one size bigger.
        act(() => { fire('pointermove', 500, 260); });
        expect(box.style.width).toBe('500px');
        expect(box.getAttribute('data-text-step')).toBe('1');
        expect(box.style.fontSize).toBe('15px');
        expect(q('pipeline-viz-unseated-list').style.height).toBe('160px');
        // Far wider still: no bigger than that one size (and capped at the pane).
        act(() => { fire('pointermove', -2000, 260); });
        expect(box.style.fontSize).toBe('15px');
        expect(box.style.width).toBe('984px');
        act(() => { fire('pointerup', -2000, 260); });
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-size')))
            .toEqual({ ws: 984 / 400, hEm: 160 / 12 });
        // Moving the box is untouched by a resize.
        expect(box.getAttribute('data-pos')).toBe('home');
    });

    it('shrinks an epic to one size smaller, and no smaller than that', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        const grip = q('pipeline-viz-unseated-grip');
        withResizeGeometry(box, q('pipeline-viz-unseated-list'));
        const fire = fireOn(grip);
        act(() => { fire('pointerdown', 600, 200); });
        act(() => { fire('pointermove', 680, 200); });
        expect(box.style.width).toBe('320px');
        expect(box.getAttribute('data-text-step')).toBe('-1');
        expect(box.style.fontSize).toBe('9.6px');
        // Squeezed further: held at its title bar in the smaller type.
        act(() => { fire('pointermove', 2000, 200); });
        expect(box.style.fontSize).toBe('9.6px');
        expect(parseFloat(box.style.width)).toBeCloseTo(18 * 9.6, 6);
        act(() => { fire('pointerup', 2000, 200); });
    });

    it('is remembered and keeps tracking the zoom', () => {
        window.localStorage.setItem('darwin-plan-unseated-box-size',
            JSON.stringify({ ws: 1.5, hEm: 10 }));
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        expect(box.getAttribute('data-stretched')).toBe('1');
        expect(box.style.width).toBe('600px');
        expect(box.style.fontSize).toBe('15px');
        expect(q('pipeline-viz-unseated-list').style.height).toBe('120px');
        // Zoomed in: the stretch scales with it.
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={16} widthPx={800} />));
        expect(box.style.width).toBe('1200px');
        expect(box.style.fontSize).toBe('20px');
        expect(q('pipeline-viz-unseated-list').style.height).toBe('160px');
    });

    // req #3893 — the grip (or any corner) double-clicked: every title on one
    // line, the whole list, in the size that width selects.
    it('double-click on the grip or a corner fits it to its content', () => {
        window.localStorage.setItem('darwin-plan-unseated-box-size',
            JSON.stringify({ ws: 1.5, hEm: 10 }));
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={16} widthPx={800} />));
        const box = q('pipeline-viz-unseated');
        const list = q('pipeline-viz-unseated-list');
        // The measuring render: one-line titles, no width or list cap.
        let measured = null;
        const pane = { clientWidth: 2000, clientHeight: 1000 };
        Object.defineProperty(box, 'offsetParent', { get: () => pane });
        Object.defineProperty(box, 'offsetTop', { get: () => 8 });
        Object.defineProperty(box, 'offsetWidth', { get: () => 1004 });
        Object.defineProperty(box, 'clientWidth', { get: () => 1000 });
        box.getBoundingClientRect = () => {
            measured = { width: box.style.width, maxWidth: box.style.maxWidth, listH: list.style.height,
                title: q('pipeline-viz-unseated-item-title-11').style.whiteSpace
                    || getComputedStyle(q('pipeline-viz-unseated-item-title-11')).whiteSpace };
            return { left: 0, top: 8, width: 1000, height: 300 };
        };
        Object.defineProperty(list, 'scrollHeight', { get: () => 200 });
        act(() => { q('pipeline-viz-unseated-grip').dispatchEvent(
            new MouseEvent('dblclick', { bubbles: true })); });
        expect(measured).toMatchObject({ width: 'max-content', maxWidth: 'none', listH: 'auto', title: 'nowrap' });
        // Measured at 20px (one size up): 1000px wide plus a px of slack, the
        // ratio rounded UP (1.25125 → 1.26) so the widest title never wraps;
        // 200px of list — the same size at 20px.
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-size')))
            .toEqual({ ws: 1.26, hEm: 12.5 });
        expect(box.style.width).toBe('1008px');
        expect(box.style.fontSize).toBe('20px');
        expect(list.style.height).toBe('200px');
        // Any corner does the same.
        window.localStorage.removeItem('darwin-plan-unseated-box-size');
        act(() => { q('pipeline-viz-unseated-edge-se').dispatchEvent(
            new MouseEvent('dblclick', { bubbles: true })); });
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-size')))
            .toEqual({ ws: 1.26, hEm: 12.5 });
    });

    it('remembered from the left, it grows rightward from a bottom-right grip', () => {
        window.localStorage.setItem('darwin-plan-unseated-box-window-pos',
            JSON.stringify({ x: 100, y: 50 }));
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        const grip = q('pipeline-viz-unseated-grip');
        expect(grip.getAttribute('data-corner')).toBe('bottom-right');
        expect(getComputedStyle(grip).cursor).toBe('nwse-resize');
        Object.defineProperty(box, 'offsetWidth', { get: () => 400 });
        withWindow(box, { left: 100, top: 50 });
        const fire = fireOn(grip);
        act(() => { fire('pointerdown', 500, 300); });
        expect(box.getAttribute('data-pos')).toBe('100,50');
        act(() => { fire('pointermove', 600, 300); });
        expect(box.style.width).toBe('500px');
        // Room to the right edge is the cap.
        act(() => { fire('pointermove', 5000, 300); });
        expect(box.style.width).toBe('900px');
        act(() => { fire('pointerup', 5000, 300); });
    });

    it('a grip click that wobbles stretches nothing', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const box = q('pipeline-viz-unseated');
        withResizeGeometry(box, q('pipeline-viz-unseated-list'));
        const fire = fireOn(q('pipeline-viz-unseated-grip'));
        act(() => { fire('pointerdown', 600, 200); });
        act(() => { fire('pointermove', 602, 201); });
        act(() => { fire('pointerup', 602, 201); });
        expect(box.getAttribute('data-stretched')).toBe('0');
        expect(window.localStorage.getItem('darwin-plan-unseated-box-size')).toBeNull();
    });

    it('has no grip while folded', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        expect(q('pipeline-viz-unseated-grip')).not.toBeNull();
        act(() => q('pipeline-viz-unseated-toggle').click());
        expect(q('pipeline-viz-unseated-grip')).toBeNull();
    });

    it('a spot the window is clamping is re-anchored where drawn, so the grip edge moves', () => {
        // Remembered 300px from the right, but zoomed so wide the window's clamp
        // draws it at the left edge: the grip (bottom-left) must still be the
        // edge that follows the pointer.
        window.localStorage.setItem('darwin-plan-unseated-box-window-pos',
            JSON.stringify({ r: 300, y: 40 }));
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={800} />));
        const box = q('pipeline-viz-unseated');
        Object.defineProperty(box, 'offsetWidth', { get: () => 800 });
        withWindow(box, { left: 0, top: 40 });
        const fire = fireOn(q('pipeline-viz-unseated-grip'));
        act(() => { fire('pointerdown', 0, 300); });
        expect(box.getAttribute('data-pos')).toBe('r200,40');
        // Narrowed by dragging the grip right: the right edge stays put.
        act(() => { fire('pointermove', 100, 300); });
        expect(box.style.width).toBe('700px');
        act(() => { fire('pointerup', 100, 300); });
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')))
            .toEqual({ r: 200, y: 40 });
    });

    it('a sideways stretch that drifts a little leaves the height alone', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        withResizeGeometry(box, q('pipeline-viz-unseated-list'));
        const fire = fireOn(q('pipeline-viz-unseated-grip'));
        act(() => { fire('pointerdown', 600, 200); });
        act(() => { fire('pointermove', 540, 210); });
        act(() => { fire('pointerup', 540, 210); });
        expect(q('pipeline-viz-unseated-list').style.height).toBe('');
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-size')))
            .toEqual({ ws: 460 / 400, hEm: null });
    });

    it('a stretched height is held between one wrapped row and the pane bottom', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={10} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        const list = q('pipeline-viz-unseated-list');
        withResizeGeometry(box, list);
        Object.defineProperty(q('pipeline-viz-unseated-header'), 'offsetHeight',
            { get: () => 36 });
        Object.defineProperty(q('pipeline-viz-unseated-grip-strip'), 'offsetHeight',
            { get: () => 13 });
        Object.defineProperty(box, 'offsetHeight', { get: () => 153 });
        Object.defineProperty(box, 'clientHeight', { get: () => 149 });
        const fire = fireOn(q('pipeline-viz-unseated-grip'));
        act(() => { fire('pointerdown', 600, 200); });
        act(() => { fire('pointermove', 600, -500); });
        // UNSEATED_MIN_LIST_EM (4.5, req #3684) of the 10px type.
        expect(list.style.height).toBe('45px');
        // The WHOLE box stays above the inset (req #3677): 600 pane − 8 inset
        // − 2 slack − 8 box top − (36 title bar + 13 grip strip + 4 border).
        act(() => { fire('pointermove', 600, 5000); });
        expect(list.style.height).toBe('529px');
        act(() => { fire('pointerup', 600, 5000); });
    });

    it('a cancelled stretch keeps what was drawn and ends the gesture', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        withResizeGeometry(box, q('pipeline-viz-unseated-list'));
        const fire = fireOn(q('pipeline-viz-unseated-grip'));
        act(() => { fire('pointerdown', 600, 200); });
        act(() => { fire('pointermove', 500, 200); });
        act(() => { fire('pointercancel', 500, 200); });
        expect(box.style.width).toBe('500px');
        act(() => { fire('pointermove', 100, 200); });
        expect(box.style.width).toBe('500px');
    });

    it('a corrupt or absurd remembered size is ignored or bounded', () => {
        window.localStorage.setItem('darwin-plan-unseated-box-size', '{not json');
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        expect(q('pipeline-viz-unseated').getAttribute('data-stretched')).toBe('0');
        act(() => root.unmount());
        window.localStorage.setItem('darwin-plan-unseated-box-size',
            JSON.stringify({ ws: 1e308, hEm: 1e308 }));
        root = createRoot(host);
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        expect(box.style.width).toBe('8000px');
        expect(box.style.fontSize).toBe('15px');
        expect(q('pipeline-viz-unseated-list').style.height).toBe('4800px');
    });

    it('hides its grip while the box is being moved', () => {
        act(() => root.render(<UnorchestratedReqBox items={[]} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        expect(q('pipeline-viz-unseated-grip')).toBeNull();
        act(() => { fire('pointermove', 410, 220); });
        act(() => { fire('pointerup', 410, 220); });
        expect(q('pipeline-viz-unseated-grip')).not.toBeNull();
    });
    // req #3833 — every edge and corner reshapes it, in the Action Popups' own
    // hit zones (req #3743), not just the grip.
    const EDGE_IDS = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];
    it('is reshaped from every edge and corner, in the Action Popups\' zones', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const cursor = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
            nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
        for (const id of EDGE_IDS) {
            const z = q(`pipeline-viz-unseated-edge-${id}`);
            expect(z).not.toBeNull();
            expect(getComputedStyle(z).cursor).toBe(cursor[id]);
            expect(getComputedStyle(z).position).toBe('absolute');
        }
        const px = (id, prop) => parseFloat(getComputedStyle(q(`pipeline-viz-unseated-edge-${id}`))[prop]);
        // Wide below the title bar, slim on it.
        expect(px('s', 'height')).toBe(10);
        expect(px('w', 'width')).toBe(10);
        expect(px('se', 'width')).toBe(18);
        expect(px('n', 'height')).toBe(5);
        expect(px('nw', 'width')).toBe(8);
        // The list's scrollbar sits inside the right zone, not under it.
        expect(getComputedStyle(q('pipeline-viz-unseated-list')).borderRightWidth).toBe('10px');
        // The grip sits over its corner's zone, so its double-click is its own.
        expect(getComputedStyle(q('pipeline-viz-unseated-grip')).zIndex).toBe('4');
    });

    it('has no reshape edges while moved or folded', () => {
        act(() => root.render(<UnorchestratedReqBox items={[]} />));
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(q('pipeline-viz-unseated'), bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        expect(q('pipeline-viz-unseated-edge-e')).toBeNull();
        act(() => { fire('pointerup', 710, 20); });
        expect(q('pipeline-viz-unseated-edge-e')).not.toBeNull();
        act(() => q('pipeline-viz-unseated-toggle').click());
        for (const id of EDGE_IDS) expect(q(`pipeline-viz-unseated-edge-${id}`)).toBeNull();
    });

    it('its far side stretches it as the grip does, the home corner held', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        withResizeGeometry(box, q('pipeline-viz-unseated-list'));
        const fire = fireOn(q('pipeline-viz-unseated-edge-w'));
        act(() => { fire('pointerdown', 592, 200); });
        act(() => { fire('pointermove', 552, 260); });
        expect(box.style.width).toBe('440px');
        // A side never takes the height.
        expect(q('pipeline-viz-unseated-list').style.height).toBe('');
        act(() => { fire('pointerup', 552, 260); });
        expect(box.getAttribute('data-pos')).toBe('home');
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-size')))
            .toEqual({ ws: 440 / 400, hEm: null });
    });

    it('its bottom takes the height alone', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        withResizeGeometry(box, q('pipeline-viz-unseated-list'));
        const fire = fireOn(q('pipeline-viz-unseated-edge-s'));
        act(() => { fire('pointerdown', 800, 150); });
        // No height slop on an edge that only goes up and down.
        act(() => { fire('pointermove', 900, 156); });
        expect(q('pipeline-viz-unseated-list').style.height).toBe('106px');
        expect(box.style.width).toBe('400px');
        act(() => { fire('pointerup', 900, 156); });
        expect(box.getAttribute('data-pos')).toBe('home');
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-size')))
            .toEqual({ ws: 1, hEm: 106 / 12 });
    });

    it('its anchored side carries the anchor: at home it is placed, the far edge held', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        withResizeGeometry(box, q('pipeline-viz-unseated-list'));
        // 8px from the window's right edge, as at home.
        withWindow(box, { left: 592, top: 8 });
        const fire = fireOn(q('pipeline-viz-unseated-edge-e'));
        act(() => { fire('pointerdown', 990, 100); });
        // A press alone places nothing.
        expect(box.getAttribute('data-pos')).toBe('home');
        act(() => { fire('pointermove', 1000, 100); });
        // Wider by the 8px the window had, its left edge where it was.
        expect(box.style.width).toBe('408px');
        expect(box.getAttribute('data-pos')).toBe('r0,8');
        act(() => { fire('pointerup', 1000, 100); });
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')))
            .toEqual({ r: 0, y: 8 });
    });

    it('anchored left, its left side moves the anchor and its right edge holds', () => {
        window.localStorage.setItem('darwin-plan-unseated-box-window-pos',
            JSON.stringify({ x: 100, y: 50 }));
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        Object.defineProperty(box, 'offsetWidth', { get: () => 400 });
        withWindow(box, { left: 100, top: 50 });
        const fire = fireOn(q('pipeline-viz-unseated-edge-w'));
        act(() => { fire('pointerdown', 100, 300); });
        act(() => { fire('pointermove', 40, 300); });
        expect(box.style.width).toBe('460px');
        expect(box.getAttribute('data-pos')).toBe('40,50');
        // No further than the window's left edge.
        act(() => { fire('pointermove', -500, 300); });
        expect(box.style.width).toBe('500px');
        expect(box.getAttribute('data-pos')).toBe('0,50');
        act(() => { fire('pointerup', -500, 300); });
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')))
            .toEqual({ x: 0, y: 50 });
    });

    it('its top grows the list upward, the bottom held, no higher than the window', () => {
        window.localStorage.setItem('darwin-plan-unseated-box-window-pos',
            JSON.stringify({ x: 100, y: 200 }));
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        const list = q('pipeline-viz-unseated-list');
        Object.defineProperty(box, 'offsetWidth', { get: () => 400 });
        Object.defineProperty(list, 'offsetHeight', { get: () => 100 });
        withWindow(box, { left: 100, top: 200 });
        const fire = fireOn(q('pipeline-viz-unseated-edge-n'));
        act(() => { fire('pointerdown', 300, 200); });
        act(() => { fire('pointermove', 300, 150); });
        expect(list.style.height).toBe('150px');
        expect(box.getAttribute('data-pos')).toBe('100,150');
        // The width is untouched.
        expect(box.style.width).toBe('400px');
        act(() => { fire('pointermove', 300, -5000); });
        expect(list.style.height).toBe('300px');
        expect(box.getAttribute('data-pos')).toBe('100,0');
        // Shrunk from the top: the list never below its floor, the top comes down.
        act(() => { fire('pointermove', 300, 5000); });
        expect(list.style.height).toBe(`${4.5 * 12}px`);
        expect(box.getAttribute('data-pos')).toBe(`100,${200 + 100 - 54}`);
        act(() => { fire('pointerup', 300, 5000); });
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')))
            .toEqual({ x: 100, y: 246 });
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-size')))
            .toEqual({ ws: 1, hEm: 4.5 });
    });

    it('a side zone is slim beside the title bar in em, so zooming mints no rule', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} />));
        const clip = () => q('pipeline-viz-unseated-edge-e').style.clipPath
            || getComputedStyle(q('pipeline-viz-unseated-edge-e')).clipPath;
        const before = clip();
        expect(before).toContain('2.2em');
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={13.37} />));
        expect(clip()).toBe(before);
    });

    it('placed from home by its top, a pane-capped box keeps the width it was drawn at', () => {
        // Zoomed so wide the pane (1000px) caps the box below its 1200px.
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={1200} />));
        const box = q('pipeline-viz-unseated');
        const list = q('pipeline-viz-unseated-list');
        Object.defineProperty(box, 'offsetWidth', { get: () => 984 });
        Object.defineProperty(list, 'offsetHeight', { get: () => 100 });
        withWindow(box, { w: 1400, left: 408, top: 108 });
        const fire = fireOn(q('pipeline-viz-unseated-edge-n'));
        act(() => { fire('pointerdown', 800, 108); });
        act(() => { fire('pointermove', 800, 88); });
        // Not the 1200px the window would now allow: its left edge holds.
        expect(box.style.width).toBe('984px');
        expect(box.getAttribute('data-pos')).toBe('r8,88');
        act(() => { fire('pointerup', 800, 88); });
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-size')).ws)
            .toBeCloseTo(984 / 1200, 9);
    });

    it('a stretch cut short by a fold still remembers what it drew', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        withResizeGeometry(box, q('pipeline-viz-unseated-list'));
        withWindow(box, { left: 592, top: 108 });
        const fire = fireOn(q('pipeline-viz-unseated-edge-n'));
        act(() => { fire('pointerdown', 800, 108); });
        act(() => { fire('pointermove', 800, 78); });
        act(() => q('pipeline-viz-unseated-toggle').click());
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-size')))
            .toEqual({ ws: 1, hEm: 130 / 12 });
        expect(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')).not.toBeNull();
    });

    it('a top corner at home places it and takes both axes', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} fontPx={12} widthPx={400} />));
        const box = q('pipeline-viz-unseated');
        const list = q('pipeline-viz-unseated-list');
        withResizeGeometry(box, list);
        withWindow(box, { left: 592, top: 108 });
        const fire = fireOn(q('pipeline-viz-unseated-edge-nw'));
        act(() => { fire('pointerdown', 592, 108); });
        act(() => { fire('pointermove', 552, 78); });
        expect(box.style.width).toBe('440px');
        expect(list.style.height).toBe('130px');
        // Anchored right: the right offset held, the top raised.
        expect(box.getAttribute('data-pos')).toBe('r8,78');
        act(() => { fire('pointerup', 552, 78); });
    });

    // req #3687 — placed, the box is fixed in the WINDOW above the navbar, so
    // it can leave the plan pane entirely.
    it('at home it sits in the pane; placed it is fixed in the window above the navbar', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const box = q('pipeline-viz-unseated');
        expect(box.style.position).toBe('');
        expect(getComputedStyle(box).position).toBe('absolute');
        const bar = q('pipeline-viz-unseated-header');
        withGeometry(box, bar);
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 710, 20); });
        act(() => { fire('pointermove', 410, 220); });
        act(() => { fire('pointerup', 410, 220); });
        expect(box.style.position).toBe('fixed');
        expect(Number(box.style.zIndex)).toBe(UNSEATED_FLOAT_Z);
        // Above the navbar, the bottom nav and the drawer; under the modal
        // layer so the seat dialog still opens over it.
        expect(UNSEATED_FLOAT_Z).toBeGreaterThan(1200);
        expect(UNSEATED_FLOAT_Z).toBeLessThan(1300);
        // Home again: back in the pane.
        act(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10000); });
        act(() => { bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
        vi.restoreAllMocks();
        expect(box.getAttribute('data-pos')).toBe('home');
        expect(box.style.position).toBe('');
    });

    it('moves out of the pane to the window\'s top-left corner, over the navbar', () => {
        act(() => root.render(<UnorchestratedReqBox items={items} onMoveDrop={() => false} />));
        const box = q('pipeline-viz-unseated');
        const bar = q('pipeline-viz-unseated-header');
        // A pane that starts 240px in (the sidebar) and 120px down (the page
        // header); the box at home in its top-right corner.
        Object.defineProperty(box, 'offsetWidth', { get: () => 280 });
        Object.defineProperty(bar, 'offsetHeight', { get: () => 36 });
        withWindow(box, { w: 1400, h: 900, left: 1112, top: 128 });
        const fire = fireOn(bar);
        act(() => { fire('pointerdown', 1120, 140); });
        act(() => { fire('pointermove', -500, -500); });
        expect(box.getAttribute('data-pos')).toBe('0,0');
        act(() => { fire('pointerup', -500, -500); });
        expect(JSON.parse(window.localStorage.getItem('darwin-plan-unseated-box-window-pos')))
            .toEqual({ x: 0, y: 0 });
        expect(box.style.position).toBe('fixed');
    });

    it('drops a pane-relative spot remembered before it could leave the pane', () => {
        window.localStorage.setItem('darwin-plan-unseated-box-pos',
            JSON.stringify({ x: 100, y: 50 }));
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        expect(q('pipeline-viz-unseated').getAttribute('data-pos')).toBe('home');
        expect(window.localStorage.getItem('darwin-plan-unseated-box-pos')).toBeNull();
    });

    it('a window that shrinks lifts a placed box so it stays whole', () => {
        window.localStorage.setItem('darwin-plan-unseated-box-window-pos',
            JSON.stringify({ r: 0, y: 500 }));
        act(() => root.render(<UnorchestratedReqBox items={items} />));
        const box = q('pipeline-viz-unseated');
        Object.defineProperty(q('pipeline-viz-unseated-header'), 'offsetHeight',
            { get: () => 36 });
        withWindow(box, { w: 1000, h: 900, top: 500 });
        withParts(box, q('pipeline-viz-unseated-list'));
        act(() => { window.dispatchEvent(new Event('resize')); });
        expect(box.getAttribute('data-pos')).toBe('r0,500');
        withWindow(box, { w: 1000, h: 600, top: 500 });
        act(() => { window.dispatchEvent(new Event('resize')); });
        // 600 − 8 − 2 − (56 + 221) = 313.
        expect(box.getAttribute('data-pos')).toBe('r0,313');
    });

    it('a wheel over the box zooms the plan only while the box is over the plan', () => {
        const pane = document.createElement('div');
        host.appendChild(pane);
        const paneRoot = createRoot(pane);
        act(() => paneRoot.render(<UnorchestratedReqBox items={items} />));
        pane.getBoundingClientRect = () => ({ left: 240, top: 120, right: 1000, bottom: 600 });
        const zoom = vi.fn();
        pane.addEventListener('wheel', zoom);
        const box = pane.querySelector('[data-testid="pipeline-viz-unseated"]');
        const wheel = (x, y) => box.dispatchEvent(new WheelEvent('wheel',
            { bubbles: true, clientX: x, clientY: y, deltaY: 50 }));
        act(() => { wheel(800, 300); });
        expect(zoom).toHaveBeenCalledTimes(1);
        // Over the navbar: not a zoom.
        act(() => { wheel(100, 300); });
        expect(zoom).toHaveBeenCalledTimes(1);
        act(() => paneRoot.unmount());
    });

    // req #3702 — the ids follow the reader's colour preference.
    it('paints each id through idStyleOf, bold or regular as the canvas does', () => {
        const idStyleOf = (id) => (id === 11
            ? { fill: 'rgb(1, 2, 3)', bold: true }
            : { fill: 'rgb(4, 5, 6)', bold: false });
        act(() => root.render(<UnorchestratedReqBox items={items} idStyleOf={idStyleOf} />));
        const a = q('pipeline-viz-unseated-item-id-11');
        const b = q('pipeline-viz-unseated-item-id-12');
        expect(a.textContent).toBe('11');
        expect(getComputedStyle(a).color).toBe('rgb(1, 2, 3)');
        expect(getComputedStyle(a).fontWeight).toBe('700');
        expect(getComputedStyle(b).color).toBe('rgb(4, 5, 6)');
        expect(getComputedStyle(b).fontWeight).toBe('400');
        // req #3745 — the title takes the id's colour, never its weight.
        const ta = getComputedStyle(q('pipeline-viz-unseated-item-title-11'));
        const tb = getComputedStyle(q('pipeline-viz-unseated-item-title-12'));
        expect(ta.color).toBe('rgb(1, 2, 3)');
        expect(ta.fontWeight).not.toBe('700');
        expect(tb.color).toBe('rgb(4, 5, 6)');
    });

    it('with the real registry, two autonomies paint two colours', () => {
        const rows = [
            { id: 11, title: 'a', coordination_type: 'discuss' },
            { id: 12, title: 'b', coordination_type: 'deployed' },
        ];
        const views = buildReqColorViews({ requirements: rows });
        const idStyleOf = (id) => reqIdStyle({ colorKey: 'autonomy', views, reqId: id });
        act(() => root.render(<UnorchestratedReqBox items={rows} idStyleOf={idStyleOf} />));
        const ca = getComputedStyle(q('pipeline-viz-unseated-item-id-11')).color;
        const cb = getComputedStyle(q('pipeline-viz-unseated-item-id-12')).color;
        expect(ca).not.toBe(cb);
    });
});
