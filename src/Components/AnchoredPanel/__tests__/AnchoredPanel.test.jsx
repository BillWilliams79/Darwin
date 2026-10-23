// @vitest-environment jsdom
//
// Req #3643 — AnchoredPanel: the head is the anchor and always the top row.
// Toggling re-anchors a bottom-docked panel to the top so the head stays put
// while the body folds up into it; any edge or corner reshapes, sizing only
// the axes it touched.
// (jsdom has no layout: the real head-stays-put measurement is the E2E
// DEV-04 — this pins the structure that guarantees it.)

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import AnchoredPanel from '../AnchoredPanel';

const LIMITS = { minW: 160, minH: 64, autoMaxW: 420, headPx: 31 };
const COLORS = { frame: '#a64dff', background: '#000', line: '#333', text: '#fff',
    head: '#7bb8de', headHover: '#cfe4f7' };
const HOME = { h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null };

let onDock;
function Harness({ initialDock = HOME, initialOpen = true }) {
    const [dock, setDock] = useState(initialDock);
    const [open, setOpen] = useState(initialOpen);
    return (
        <AnchoredPanel dock={dock}
                       onDockChange={(d) => { onDock(d); setDock(d || HOME); }}
                       open={open} onToggle={() => setOpen(o => !o)}
                       name="Things" testid="ap" limits={LIMITS} colors={COLORS}
                       extras={<span data-testid="ap-extra">3</span>}
                       actions={<button type="button" data-testid="ap-x">×</button>}>
            {({ shapedWidth }) => <div data-testid="ap-content" data-w={String(shapedWidth)}>rows</div>}
        </AnchoredPanel>
    );
}

const place = (el, rect) => {
    el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width,
        bottom: rect.top + rect.height });
};
const drag = (el, from, to, end = 'pointerUp') => {
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: to[0], clientY: to[1] });
    fireEvent[end](el, { pointerId: 1, clientX: to[0], clientY: to[1] });
};

describe('AnchoredPanel (req #3643)', () => {
    beforeEach(() => {
        onDock = vi.fn();
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1600, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 1000, configurable: true });
    });
    afterEach(cleanup);

    it('head row: ▾, extras in the badge slot, the title — left — then actions at the far right', () => {
        render(<Harness />);
        const head = screen.getByTestId('ap-header');
        expect([...head.children].map(c => c.getAttribute('data-testid'))).toEqual(
            ['ap-toggle', 'ap-badge', 'ap-title', null]);
        expect(screen.getByTestId('ap-badge').firstChild).toBe(screen.getByTestId('ap-extra'));
        expect(getComputedStyle(head.children[3]).marginLeft).toBe('auto');
        expect(screen.getByTestId('ap-toggle').textContent).toBe('▾');
        expect(screen.getByTestId('ap-toggle').getAttribute('aria-label')).toBe('Things');
        expect(screen.getByTestId('ap-title').textContent).toBe('Things');
        // The head is the first child — the panel's top row — in every dock.
        expect(screen.getByTestId('ap').firstChild).toBe(head);
    });

    it('toggling pins the panel at its left and top, folds it tight, then re-docks it where it is', () => {
        render(<Harness />);
        // Drawn at its dock: r16, b16 in a 1600×1000 viewport.
        const panel = screen.getByTestId('ap');
        place(panel, { left: 1200, top: 797, width: 384, height: 187 });
        fireEvent.click(screen.getByTestId('ap-toggle'));
        // First pinned at its current left and top, so the ▾ holds…
        expect(onDock.mock.calls[0][0]).toEqual({ h: 'l', x: 1200, v: 't', y: 797, w: null, ht: null });
        // …then, drawn tight (the fake rect is unchanged here), re-docked to
        // the nearest sides at the pin.
        expect(onDock.mock.calls[1][0]).toEqual({ h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null });
        // Folded, the body takes no room and nothing can be reshaped.
        const body = screen.getByTestId('ap-body');
        expect(body.getAttribute('data-folded')).toBe('1');
        expect(getComputedStyle(body).display).toBe('none');
        expect(screen.queryByTestId('ap-edge-w')).toBeNull();
        expect(panel.style.width).toBe('max-content');
        fireEvent.click(screen.getByTestId('ap-toggle'));
        expect(screen.getByTestId('ap-body').getAttribute('data-folded')).toBe('0');
    });

    it('folded, the actions follow the title instead of sitting far right', () => {
        render(<Harness />);
        const actions = () => screen.getByTestId('ap-header').children[3];
        expect(getComputedStyle(actions()).marginLeft).toBe('auto');
        fireEvent.click(screen.getByTestId('ap-toggle'));
        expect(getComputedStyle(actions()).marginLeft).toBe('0px');
    });

    it('a move docks to the nearer sides of where the box was dropped', () => {
        render(<Harness />);
        place(screen.getByTestId('ap'), { left: 1200, top: 700, width: 384, height: 284 });
        drag(screen.getByTestId('ap-header'), [1300, 710], [300, 210]);
        expect(onDock).toHaveBeenCalledWith(
            { h: 'l', x: 200, v: 't', y: 200, w: null, ht: null });
    });

    it('a press on a head button is that button, never a move', () => {
        render(<Harness />);
        place(screen.getByTestId('ap'), { left: 1200, top: 700, width: 384, height: 284 });
        drag(screen.getByTestId('ap-toggle'), [1210, 960], [300, 160]);
        expect(onDock).not.toHaveBeenCalled();
    });

    it('an edge reshapes only its own axis; a corner both', () => {
        render(<Harness />);
        place(screen.getByTestId('ap'), { left: 1200, top: 700, width: 384, height: 284 });
        drag(screen.getByTestId('ap-edge-n'), [1300, 700], [1300, 600]);
        expect(onDock).toHaveBeenLastCalledWith(
            { h: 'r', x: 16, v: 'b', y: 16, w: null, ht: 384 });
        place(screen.getByTestId('ap'), { left: 1200, top: 600, width: 384, height: 384 });
        drag(screen.getByTestId('ap-edge-nw'), [1200, 600], [1100, 500]);
        expect(onDock).toHaveBeenLastCalledWith(
            { h: 'r', x: 16, v: 'b', y: 16, w: 484, ht: 484 });
        expect(screen.getByTestId('ap-content').getAttribute('data-w')).toBe('484');
    });

    it('the grab zones below the head row are easy to hit (req #3743)', () => {
        render(<Harness />);
        const px = (id, prop) => parseFloat(getComputedStyle(screen.getByTestId(`ap-edge-${id}`))[prop]);
        expect(px('e', 'width')).toBeGreaterThanOrEqual(10);
        expect(px('s', 'height')).toBeGreaterThanOrEqual(10);
        expect(px('se', 'width')).toBeGreaterThanOrEqual(18);
        expect(px('se', 'height')).toBeGreaterThanOrEqual(18);
        // The head row stays slim so the ▾ and × keep their clicks.
        expect(px('n', 'height')).toBeLessThanOrEqual(6);
        expect(px('nw', 'height')).toBeLessThanOrEqual(8);
        expect(px('nw', 'width')).toBeLessThanOrEqual(8);
        expect(screen.getByTestId('ap-edge-e').style.clipPath || getComputedStyle(screen.getByTestId('ap-edge-e')).clipPath).toContain('polygon(5px 0');
    });

    it('the live width reaches the body while reshaping', () => {
        render(<Harness />);
        place(screen.getByTestId('ap'), { left: 1200, top: 700, width: 384, height: 284 });
        const w = screen.getByTestId('ap-edge-w');
        fireEvent.pointerDown(w, { button: 0, pointerId: 1, clientX: 1200, clientY: 800 });
        fireEvent.pointerMove(w, { pointerId: 1, clientX: 1384, clientY: 800 });
        expect(screen.getByTestId('ap-content').getAttribute('data-w')).toBe('200');
        fireEvent.pointerCancel(w, { pointerId: 1, clientX: 1384, clientY: 800 });
    });

    it('a cancelled gesture puts it back; a wobble under the slop is not a move', () => {
        render(<Harness />);
        place(screen.getByTestId('ap'), { left: 1200, top: 700, width: 384, height: 284 });
        drag(screen.getByTestId('ap-header'), [1300, 710], [300, 160], 'pointerCancel');
        drag(screen.getByTestId('ap-header'), [1300, 710], [1302, 711]);
        expect(onDock).not.toHaveBeenCalled();
        expect(screen.getByTestId('ap').getAttribute('data-dock')).toBe('r16,b16');
    });

    it('double-clicking the head row sends it home', () => {
        render(<Harness initialDock={{ h: 'l', x: 50, v: 't', y: 60, w: 300, ht: null }} />);
        fireEvent.doubleClick(screen.getByTestId('ap-header'));
        expect(onDock).toHaveBeenCalledWith(null);
    });
});
