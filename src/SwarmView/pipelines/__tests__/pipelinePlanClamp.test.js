// Req #3252 — `clampPlanTransform`, the legal region of a plan-canvas camera.
//
// A SEPARATE FILE from pipelinePlanLayout.test.js on purpose: this function has
// two callers with two different jobs, and the cases that matter are about the
// DIFFERENCE between them —
//   · the zoom behaviour's `.constrain()`, which passes `t.k` for both scale
//     bounds because d3 has already applied `scaleExtent` before calling it, so
//     only the translation is in question;
//   · the restore path (req #3252), which passes the REAL extent, because
//     `zoom.transform` applies what it is given verbatim and runs neither
//     `constrain` nor `scaleExtent`.
//
// The bound itself is req #3168's "scroll pane" rule: the world may overshoot
// the panel by at most HALF A PANEL on each side, measured on screen at every
// scale, so a pan can never carry the whole plan out of view.

import { describe, it, expect } from 'vitest';

import { clampPlanTransform } from '../pipelinePlanLayout';

const SIZE = { w: 1000, h: 600 };
const LAYOUT = { width: 4000, height: 2000 };
// Translation-only, the shape `.constrain()` uses.
const pan = (t, size = SIZE, layout = LAYOUT) =>
    clampPlanTransform(t, size, layout, t.k, t.k);

describe('clampPlanTransform', () => {
    describe('scale', () => {
        it('clamps k into [kMin, kMax]', () => {
            expect(clampPlanTransform({ x: 0, y: 0, k: 0.01 }, SIZE, LAYOUT, 0.2, 4).k).toBe(0.2);
            expect(clampPlanTransform({ x: 0, y: 0, k: 99 }, SIZE, LAYOUT, 0.2, 4).k).toBe(4);
            expect(clampPlanTransform({ x: 0, y: 0, k: 1.5 }, SIZE, LAYOUT, 0.2, 4).k).toBe(1.5);
        });

        // THE ORDER IS LOAD-BEARING. The pan bound is computed FROM k, so
        // clamping the translation first would immediately re-invalidate it. A
        // camera saved at k=8 on a wide window, restored with a ceiling of 1,
        // must be bounded against k=1's world extent, not k=8's.
        it('bounds the translation against the CLAMPED k, not the requested one', () => {
            const at8 = pan({ x: -30000, y: 0, k: 8 });
            const clamped = clampPlanTransform({ x: -30000, y: 0, k: 8 }, SIZE, LAYOUT, 0.2, 1);
            expect(clamped.k).toBe(1);
            // k=1 → world 4000 wide → loX = 500 - 4000 = -3500.
            expect(clamped.x).toBe(-3500);
            // k=8 would have allowed far more overshoot; the two must differ, or
            // the clamp order is not being respected.
            expect(at8.x).toBeLessThan(clamped.x);
        });
    });

    describe('the half-a-panel bound', () => {
        it('leaves a transform already inside the bound untouched', () => {
            const t = { x: -1200, y: -400, k: 1 };
            expect(pan(t)).toEqual(t);
        });

        it('clamps an overshoot past the top-left to half a panel', () => {
            // hiX = w/2 = 500, hiY = h/2 = 300.
            expect(pan({ x: 99999, y: 99999, k: 1 })).toEqual({ x: 500, y: 300, k: 1 });
        });

        it('clamps an overshoot past the bottom-right to half a panel', () => {
            // loX = 500 - 1*4000 = -3500; loY = 300 - 1*2000 = -1700.
            expect(pan({ x: -99999, y: -99999, k: 1 })).toEqual({ x: -3500, y: -1700, k: 1 });
        });

        // The whole reason req #3168 used a custom `constrain` rather than
        // `translateExtent`: a world-space extent grants overshoot in WORLD
        // units, so the slack grows on screen as you zoom in and the bound
        // quietly stops binding at exactly the zoom where the plan is easiest to
        // lose. Half a panel is half a panel at every k.
        it('grants the same SCREEN overshoot at every scale', () => {
            for (const k of [0.25, 1, 4, 8]) {
                expect(pan({ x: 99999, y: 99999, k }).x).toBe(SIZE.w / 2);
                expect(pan({ x: -99999, y: 0, k }).x).toBe(SIZE.w / 2 - k * LAYOUT.width);
            }
        });
    });

    describe('a world smaller than the panel', () => {
        // `Math.min(0, …)` is what keeps the DEFAULT view — world origin at the
        // panel's top-left — legal on a plan smaller than the panel. Without it
        // the bound would force a re-centre on the very first transform, moving
        // the world frame the E2E click maths reads as `screen = world*k + t`.
        const small = { width: 200, height: 100 };
        it('keeps the origin legal', () => {
            expect(pan({ x: 0, y: 0, k: 1 }, SIZE, small)).toEqual({ x: 0, y: 0, k: 1 });
        });

        it('does not allow panning it off past the origin', () => {
            expect(pan({ x: -50, y: -50, k: 1 }, SIZE, small)).toEqual({ x: 0, y: 0, k: 1 });
        });
    });

    describe('degenerate inputs', () => {
        // Reachable at mount: the ResizeObserver has not measured yet, and the
        // restore effect's own readiness guard is what keeps this from being
        // applied — but the function must not produce NaN if it is called.
        it('survives a zero-size panel', () => {
            const t = clampPlanTransform({ x: 10, y: 10, k: 1 }, { w: 0, h: 0 }, LAYOUT, 1, 1);
            expect(Number.isFinite(t.x)).toBe(true);
            expect(Number.isFinite(t.y)).toBe(true);
            expect(t).toEqual({ x: 0, y: 0, k: 1 });
        });

        it.each([[undefined], [null], [{}]])('survives a missing size/layout (%s)', (bad) => {
            const t = clampPlanTransform({ x: 10, y: 10, k: 1 }, bad, bad, 1, 1);
            expect(Number.isFinite(t.x)).toBe(true);
            expect(Number.isFinite(t.y)).toBe(true);
        });
    });
});
