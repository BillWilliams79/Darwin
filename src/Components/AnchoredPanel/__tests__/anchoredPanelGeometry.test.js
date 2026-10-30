// Req #3643 — the anchored panel's geometry: a toggle re-anchored to the top so
// the head (the top row) stays put, a move docked to the nearer sides, a
// reshape sized only on the axes it touched. Pattern doc:
// memory/anchored-collapse-pattern.md.

import { describe, it, expect } from 'vitest';
import {
    DOCK_SNAP, dockAfterToggle, dockForToggle, dockFromMove, dockFromResize, dockToFit, dockedStyle, freeCorner,
    moveRect, resizeRect, validDock,
} from '../anchoredPanelGeometry';

const vw = 1600;
const vh = 1000;
const auto = { w: null, ht: null };

describe('dockForToggle — the ▾ is the anchor', () => {
    it('pins the panel at its current left and top, whatever it was docked to', () => {
        expect(dockForToggle({ h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null },
            { left: 979.3, top: 597.4 }))
            .toEqual({ h: 'l', x: 979, v: 't', y: 597, w: null, ht: null });
    });
});

describe('dockAfterToggle', () => {
    const dock = { h: 'l', x: 979, v: 't', y: 597, w: null, ht: null };
    it('folded tight at the pin, re-docked to its nearest sides — the ▾ does not move', () => {
        // Folded to 166×31 at the pin: right/bottom-anchored again, same pixels.
        const d = dockAfterToggle({ left: 979, top: 597 }, { width: 166, height: 31 }, vw, vh, dock);
        expect(d).toEqual({ h: 'r', x: 1600 - 979 - 166, v: 'b', y: 1000 - 597 - 31, w: null, ht: null });
    });
    it('never snaps — a re-dock must not nudge the ▾', () => {
        expect(dockAfterToggle({ left: 5, top: 5 }, { width: 166, height: 31 }, vw, vh, dock))
            .toMatchObject({ h: 'l', x: 5, v: 't', y: 5 });
    });
    it('unfolding with too little room right of / below the ▾, it moves just enough to fit', () => {
        // Folded at the bottom-right corner (1418,953); the rows want 405×187.
        expect(dockAfterToggle({ left: 1418, top: 953 }, { width: 405, height: 187 }, vw, vh, dock))
            .toEqual({ h: 'r', x: 0, v: 'b', y: 0, w: null, ht: null });
    });
    it('never leaves the viewport — content larger than it fills it, flush', () => {
        expect(dockAfterToggle({ left: 900, top: 900 }, { width: 2000, height: 2000 }, vw, vh, dock))
            .toMatchObject({ x: 0, y: 0 });
    });
});

describe('dockFromMove', () => {
    it('docks to the nearer sides of the box, by its distance from them', () => {
        expect(dockFromMove({ left: 1200, top: 700, width: 300, height: 200 }, vw, vh, auto))
            .toEqual({ h: 'r', x: 100, v: 'b', y: 100, w: null, ht: null });
        expect(dockFromMove({ left: 200, top: 50, width: 300, height: 200 }, vw, vh, auto))
            .toEqual({ h: 'l', x: 200, v: 't', y: 50, w: null, ht: null });
    });
    it('keeps the size it had — a move never reshapes', () => {
        expect(dockFromMove({ left: 100, top: 100, width: 300, height: 200 }, vw, vh,
            { w: 300, ht: 200 })).toMatchObject({ w: 300, ht: 200 });
    });
    it(`snaps flush within ${DOCK_SNAP}px`, () => {
        expect(dockFromMove({ left: 1600 - 300 - 10, top: 4, width: 300, height: 200 }, vw, vh, auto))
            .toMatchObject({ h: 'r', x: 0, v: 't', y: 0 });
    });
});

describe('dockFromResize', () => {
    const dock = { h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null };
    it('keeps the docked sides and sizes only the axes the drag touched', () => {
        // Top edge only: height shaped, width stays content-sized.
        expect(dockFromResize({ left: 1200, top: 600, width: 384, height: 384 }, vw, vh, dock,
            { h: null, v: 't' })).toEqual({ h: 'r', x: 16, v: 'b', y: 16, w: null, ht: 384 });
        // Left edge only: width shaped, height stays content-sized.
        expect(dockFromResize({ left: 1100, top: 800, width: 484, height: 184 }, vw, vh, dock,
            { h: 'l', v: null })).toEqual({ h: 'r', x: 16, v: 'b', y: 16, w: 484, ht: null });
    });
    it('a dragged edge that snaps flush carries the snap in its size — the other edge holds', () => {
        // Bottom edge dragged to 5 px off the viewport bottom: flush, and 5 px taller.
        expect(dockFromResize({ left: 1200, top: 700, width: 384, height: 295 }, vw, vh, dock,
            { h: null, v: 'b' })).toEqual({ h: 'r', x: 16, v: 'b', y: 0, w: null, ht: 300 });
    });
        it('stays on its edges even when reshaped past the middle', () => {
        expect(dockFromResize({ left: 20, top: 60, width: 1564, height: 924 }, vw, vh, dock,
            { h: 'l', v: 't' })).toEqual({ h: 'r', x: 16, v: 'b', y: 16, w: 1564, ht: 924 });
    });
});

describe('dockToFit (req #3893)', () => {
    const r0 = { left: 100, top: 500, width: 200, height: 150 };
    it('takes its natural size on both axes, its docked corner held', () => {
        // Docked top-left: grows right and down.
        expect(dockToFit(r0, { width: 499.2, height: 300 }, vw, vh, { h: 'l', x: 100, v: 't', y: 500, ...auto }, 120, 64))
            .toEqual({ h: 'l', x: 100, v: 't', y: 500, w: 500, ht: 300 });
        // Docked bottom-right: grows left and up, the corner where it was.
        const br = { left: 1200, top: 600, width: 200, height: 150 };
        expect(dockToFit(br, { width: 500, height: 300 }, vw, vh, { h: 'r', x: 200, v: 'b', y: 250, ...auto }, 120, 64))
            .toEqual({ h: 'r', x: 200, v: 'b', y: 250, w: 500, ht: 300 });
    });
    it('is capped at the viewport and moved only as far as it must to stay on it', () => {
        expect(dockToFit(r0, { width: 1800, height: 5000 }, vw, vh, { h: 'l', x: 100, v: 't', y: 500, ...auto }, 120, 64))
            .toEqual({ h: 'l', x: 0, v: 't', y: 0, w: vw, ht: vh });
        expect(dockToFit(r0, { width: 300, height: 700 }, vw, vh, { h: 'l', x: 100, v: 't', y: 500, ...auto }, 120, 64))
            .toEqual({ h: 'l', x: 100, v: 't', y: 300, w: 300, ht: 700 });
    });
    it('never under the minimum, so the host keeps it', () => {
        const d = dockToFit(r0, { width: 50, height: 20 }, vw, vh, { h: 'l', x: 100, v: 't', y: 500, ...auto }, 120, 64);
        expect([d.w, d.ht]).toEqual([120, 64]);
        expect(validDock(d, 120, 64)).toBe(d);
    });
});

describe('resizeRect', () => {
    const r0 = { left: 500, top: 400, width: 300, height: 200 };
    it('a corner moves both of its edges; the opposite corner stays put', () => {
        expect(resizeRect(r0, 50, 30, { h: 'r', v: 'b' }, vw, vh, 160, 64))
            .toEqual({ left: 500, top: 400, width: 350, height: 230 });
        expect(resizeRect(r0, -50, -30, { h: 'l', v: 't' }, vw, vh, 160, 64))
            .toEqual({ left: 450, top: 370, width: 350, height: 230 });
    });
    it('an edge moves only its own axis', () => {
        expect(resizeRect(r0, 50, 999, { h: 'r', v: null }, vw, vh, 160, 64))
            .toEqual({ left: 500, top: 400, width: 350, height: 200 });
        expect(resizeRect(r0, 999, -30, { h: null, v: 't' }, vw, vh, 160, 64))
            .toEqual({ left: 500, top: 370, width: 300, height: 230 });
    });
    it('a panel already under the minimum is not snapped up to it by a drag', () => {
        expect(resizeRect({ left: 500, top: 400, width: 300, height: 54 }, 0, 1,
            { h: null, v: 'b' }, vw, vh, 160, 64)).toMatchObject({ height: 55 });
    });
        it('holds the minimum and the viewport', () => {
        expect(resizeRect(r0, -1000, -1000, { h: 'r', v: 'b' }, vw, vh, 160, 64))
            .toEqual({ left: 500, top: 400, width: 160, height: 64 });
        expect(resizeRect(r0, -5000, -5000, { h: 'l', v: 't' }, vw, vh, 160, 64))
            .toEqual({ left: 0, top: 0, width: 800, height: 600 });
    });
});

describe('moveRect', () => {
    it('follows the pointer, kept whole inside the viewport', () => {
        const r0 = { left: 500, top: 400, width: 300, height: 200 };
        expect(moveRect(r0, 100, -50, vw, vh)).toMatchObject({ left: 600, top: 350 });
        expect(moveRect(r0, 5000, 5000, vw, vh)).toMatchObject({ left: 1300, top: 800 });
        expect(moveRect(r0, -5000, -5000, vw, vh)).toMatchObject({ left: 0, top: 0 });
    });
    it('with overhang (req #4046) only its centre is kept inside — it reaches every pixel', () => {
        const r0 = { left: 500, top: 400, width: 300, height: 200 };
        expect(moveRect(r0, 100, -50, vw, vh, true)).toMatchObject({ left: 600, top: 350 });
        // Centre at the last pixel, (vw - 1, vh - 1), and at the first, (0, 0).
        expect(moveRect(r0, 5000, 5000, vw, vh, true)).toMatchObject({ left: vw - 1 - 150, top: vh - 1 - 100 });
        expect(moveRect(r0, -5000, -5000, vw, vh, true)).toMatchObject({ left: -150, top: -100 });
    });
    it('with overhang at a drawn size (dragged out of a rack, r0 is its head) the DRAWN centre is kept inside', () => {
        const head = { left: 0, top: 0, width: 180, height: 24 };
        expect(moveRect(head, -5000, -5000, vw, vh, { width: 300, height: 180 })).toMatchObject({ left: -150, top: -90 });
        expect(moveRect(head, 5000, 5000, vw, vh, { width: 300, height: 180 })).toMatchObject({ left: vw - 1 - 150, top: vh - 1 - 90 });
    });
});

describe('freeCorner', () => {
    it('is the bottom corner away from the docked side — never in the head row', () => {
        expect(freeCorner({ h: 'r', v: 'b' })).toEqual({ h: 'l', v: 'b' });
        expect(freeCorner({ h: 'l', v: 't' })).toEqual({ h: 'r', v: 'b' });
    });
});

describe('validDock', () => {
    it('accepts content-sized and shaped docks; rejects anything it could not have made', () => {
        const d = { h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null };
        expect(validDock(d, 160, 64)).toBe(d);
        expect(validDock({ ...d, w: 300, ht: 200 }, 160, 64)).toBeTruthy();
        expect(validDock(null, 160, 64)).toBeNull();
        expect(validDock({ ...d, h: 'x' }, 160, 64)).toBeNull();
        expect(validDock({ ...d, x: -5 }, 160, 64)).toBeNull();
        expect(validDock({ ...d, w: 0 }, 160, 64)).toBeNull();
        expect(validDock({ ...d, ht: 10 }, 160, 64)).toBeNull();
        expect(validDock({ ...d, ht: 'tall' }, 160, 64)).toBeNull();
    });
});

describe('dockedStyle', () => {
    const opts = { open: true, headPx: 31, autoMaxW: 420, minW: 120 };
    it('content-sized: max-content width under the cap, no height', () => {
        const st = dockedStyle({ h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null }, opts);
        expect(st.width).toBe('max-content');
        expect(st.maxWidth).toBe('min(420px, 100%)');
        expect(st.height).toBeUndefined();
        expect(st.right).toContain('16px');
        expect(st.bottom).toContain('16px');
    });
    it('shaped: the drawn size; folded, tight — content width, no height', () => {
        const dock = { h: 'l', x: 40, v: 't', y: 90, w: 300, ht: 200 };
        expect(dockedStyle(dock, opts)).toMatchObject({ width: 'min(300px, 100%)', height: '200px' });
        const folded = dockedStyle(dock, { ...opts, open: false });
        expect(folded.width).toBe('max-content');
        expect(folded.height).toBeUndefined();
    });
    it('clamps a content-sized offset by the minimum width, not the cap', () => {
        const st = dockedStyle({ h: 'r', x: 255, v: 'b', y: 16, w: null, ht: null }, opts);
        expect(st.right).toBe('clamp(0px, 255px, calc(100% - min(120px, 100%)))');
    });
    it('caps the height from the offset actually DRAWN, not the stored one', () => {
        const st = dockedStyle({ h: 'r', x: 16, v: 't', y: 695, w: null, ht: null }, opts);
        expect(st.maxHeight).toBe('max(31px, calc(100% - clamp(0px, 695px, calc(100% - 31px))))');
        expect(st.top).toBe('clamp(0px, 695px, calc(100% - 31px))');
    });
});
