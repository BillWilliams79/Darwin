import { describe, it, expect } from 'vitest';
import { computeDayHeaders } from '../dayHeaderLayout';

// AXIS_H / HEADER_H mirror the constants in KonvaSwarmCanvas.jsx.
const AXIS_H = 22;
const HEADER_H = 22;
const SIZE_H = 600;
const NOON_X = 500;
const SEL = '__none__';

// Helper: build a day row. `top` is world-space row top, `count` the badge count.
const row = (date, top, count = 0) => ({ date, top, height: 100, model: { count } });

// Convenience wrapper with the fixed test constants.
const headers = (rows, t) =>
    computeDayHeaders(rows, t, SIZE_H, NOON_X, SEL, AXIS_H, HEADER_H);

describe('computeDayHeaders — sticky push behavior (req #2852)', () => {
    it('returns [] for empty / missing input', () => {
        expect(headers([], { k: 1, x: 0, y: 0 })).toEqual([]);
        expect(headers(undefined, { k: 1, x: 0, y: 0 })).toEqual([]);
    });

    it('pins the topmost scrolled-above day under the axis', () => {
        // A scrolled above the top (screenY = -30 → pinned to AXIS_H); B far below.
        const rows = [row('2026-06-01', 0), row('2026-06-02', 200)];
        const out = headers(rows, { k: 1, x: 0, y: -30 });
        expect(out).toHaveLength(2);
        expect(out[0].date).toBe('2026-06-01');
        expect(out[0].top).toBe(AXIS_H);          // pinned under the axis
        expect(out[1].top).toBe(170);             // B at its natural row top (200 - 30)
    });

    it('PUSH: the incoming day shoves the pinned day up and BOTH stay visible (the bug)', () => {
        // A pinned (screenY = -12), B sliding into the top (screenY = 28 < AXIS_H+HEADER_H).
        // Pre-fix, the declutter filter dropped B for the whole transition; assert it is present.
        const rows = [row('2026-06-01', 0), row('2026-06-02', 40)];
        const out = headers(rows, { k: 1, x: 0, y: -12 });
        const dates = out.map(h => h.date);
        expect(dates).toContain('2026-06-01');     // outgoing (old) date still shown
        expect(dates).toContain('2026-06-02');     // incoming (new) date NOT dropped
        const a = out.find(h => h.date === '2026-06-01');
        const b = out.find(h => h.date === '2026-06-02');
        // A is pushed up to sit flush directly above B: a.top + HEADER_H === b.top.
        expect(a.top + HEADER_H).toBe(b.top);
        expect(a.top).toBeLessThan(b.top);         // old date is above (being shoved out)
    });

    it('LOCK: once the incoming day reaches the axis the old one is gone and the new one is pinned', () => {
        // B has reached the axis (screenY = 22); A is fully behind it.
        const rows = [row('2026-06-01', 0), row('2026-06-02', 60)];
        const out = headers(rows, { k: 1, x: 0, y: -38 }); // screenY_B = 60-38 = 22
        const dates = out.map(h => h.date);
        expect(dates).not.toContain('2026-06-01'); // old date filtered behind the axis
        const b = out.find(h => h.date === '2026-06-02');
        expect(b.top).toBe(AXIS_H);                // new date locked under the axis
    });

    it('symmetry: the push works the same scrolling the other direction', () => {
        // Same geometry, reached by a different pan — the incoming day still pushes, not pops.
        const rows = [row('2026-06-01', 0), row('2026-06-02', 35)];
        const out = headers(rows, { k: 1, x: 0, y: -8 }); // screenY_B = 27
        const a = out.find(h => h.date === '2026-06-01');
        const b = out.find(h => h.date === '2026-06-02');
        expect(a).toBeTruthy();
        expect(b).toBeTruthy();
        expect(a.top + HEADER_H).toBe(b.top);      // flush push pair
    });

    it('declutters deep Overview and never emits overlapping headers', () => {
        // 10 days crammed so screen spacing (10px) < HEADER_H (22px): classic Overview clutter.
        const rows = Array.from({ length: 10 }, (_, i) => row(`2026-06-${10 + i}`, i * 100));
        const out = headers(rows, { k: 0.1, x: 0, y: 0 });
        expect(out.length).toBeGreaterThan(0);
        expect(out.length).toBeLessThan(rows.length);   // genuinely decluttered
        // No two emitted headers overlap: sorted by top, each is >= HEADER_H below the previous.
        const tops = out.map(h => h.top).sort((p, q) => p - q);
        for (let i = 1; i < tops.length; i++) {
            expect(tops[i] - tops[i - 1]).toBeGreaterThanOrEqual(HEADER_H - 1e-9);
        }
    });

    it('passes through date, count and selection flag', () => {
        const rows = [row('2026-06-01', 0, 3), row('2026-06-02', 300, 0)];
        const out = computeDayHeaders(rows, { k: 1, x: 0, y: 0 }, SIZE_H, NOON_X, '2026-06-02', AXIS_H, HEADER_H);
        const a = out.find(h => h.date === '2026-06-01');
        const b = out.find(h => h.date === '2026-06-02');
        expect(a.count).toBe(3);
        expect(a.left).toBe(NOON_X);
        expect(a.isSel).toBe(false);
        expect(b.isSel).toBe(true);                // selected date flagged
    });
});
