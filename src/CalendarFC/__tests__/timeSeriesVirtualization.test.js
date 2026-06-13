// req #2840 — unit coverage for the perf-hardening helpers added to
// TimeSeriesView: the strip virtualization windows and the stable per-day bucket
// reconciliation. These are the pure, exported cores of the three changes
// (virtualize panels + stabilize memo refs); the single-shared-tooltip change is
// JSX/DOM and is covered by the swarm-visualizer E2E hover test.

import { describe, it, expect } from 'vitest';
import {
    sidewalkVisibleRange,
    elevatorVisibleRange,
    bucketSignature,
    reconcileBuckets,
} from '../TimeSeriesView';

describe('sidewalkVisibleRange (uniform-width strip)', () => {
    // 21 panels, each 100px wide, 100px viewport (one panel visible at a time),
    // buffer 4 → a window of ~9 panels centered on the visible one.
    const W = 100, FW = 100, N = 21, BUF = 4;

    it('windows around the focus panel at offset 0', () => {
        const r = sidewalkVisibleRange(0, W, FW, N, BUF);
        expect(r.start).toBe(0);            // first=0, last=0 → 0-4 clamped to 0
        expect(r.end).toBe(4);              // 0 + buffer
    });

    it('tracks a scrolled offset (panel 10 at the viewport left)', () => {
        const r = sidewalkVisibleRange(-1000, W, FW, N, BUF);   // -offset/W = 10
        expect(r.start).toBe(6);            // 10 - 4
        expect(r.end).toBe(14);             // 10 + 4
    });

    it('clamps the window to the array bounds at the right edge', () => {
        const r = sidewalkVisibleRange(-(N - 1) * W, W, FW, N, BUF);   // panel 20
        expect(r.start).toBe(16);
        expect(r.end).toBe(20);             // clamped to count-1, never beyond
    });

    it('renders everything when geometry is not yet measured', () => {
        expect(sidewalkVisibleRange(0, 0, 0, N, BUF)).toEqual({ start: 0, end: N - 1 });
    });

    it('handles an empty strip', () => {
        expect(sidewalkVisibleRange(0, W, FW, 0, BUF)).toEqual({ start: 0, end: 0 });
    });

    it('widens the window when several panels fit in the viewport (zoom <1 stride)', () => {
        // 50px panels, 200px viewport → 4 panels visible; buffer 1.
        const r = sidewalkVisibleRange(-200, 50, 200, 30, 1);   // first=4, last=7
        expect(r.start).toBe(3);
        expect(r.end).toBe(8);
    });
});

describe('elevatorVisibleRange (variable-height strip)', () => {
    // 10 panels of varying heights; cumulative tops computed from them.
    const heights = [140, 200, 140, 300, 140, 140, 180, 140, 140, 160];
    const cumulative = [];
    let acc = 0;
    for (const h of heights) { cumulative.push(acc); acc += h; }
    const N = heights.length;

    it('windows the panels intersecting the viewport at the top', () => {
        // viewport [0, 400): panels 0 (0-140),1(140-340),2(340-480) intersect.
        const r = elevatorVisibleRange(0, cumulative, heights, 400, N, 1);
        expect(r.start).toBe(0);            // first=0 - buffer clamped to 0
        expect(r.end).toBe(3);             // last=2 + buffer 1
    });

    it('tracks a scrolled (negative) offset', () => {
        // offset -340 → viewport [340, 740): panel2(340-480),3(480-780) intersect.
        const r = elevatorVisibleRange(-340, cumulative, heights, 400, N, 1);
        expect(r.start).toBe(1);            // first=2 - 1
        expect(r.end).toBe(4);             // last=3 + 1
    });

    it('clamps to array bounds near the bottom', () => {
        const stripH = acc;
        const r = elevatorVisibleRange(-(stripH - 100), cumulative, heights, 400, N, 4);
        expect(r.end).toBe(N - 1);          // never beyond the last panel
        expect(r.start).toBeGreaterThanOrEqual(0);
    });

    it('renders everything when geometry is not yet synced', () => {
        expect(elevatorVisibleRange(0, null, heights, 400, N, 4)).toEqual({ start: 0, end: N - 1 });
        expect(elevatorVisibleRange(0, [1, 2], heights, 400, N, 4)).toEqual({ start: 0, end: N - 1 });
        expect(elevatorVisibleRange(0, cumulative, heights, 0, N, 4)).toEqual({ start: 0, end: N - 1 });
    });

    it('handles an empty strip', () => {
        expect(elevatorVisibleRange(0, [], [], 400, 0, 4)).toEqual({ start: 0, end: 0 });
    });
});

describe('bucketSignature', () => {
    const r = (over = {}) => ({
        id: 1, completed_at: '2026-06-13 10:00:00', requirement_status: 'met',
        coordination_type: 'deployed', category_fk: 3, title: 'X', ...over,
    });

    it('is stable for identical content', () => {
        expect(bucketSignature([r()])).toBe(bucketSignature([r()]));
    });

    it('changes when any rendered field changes', () => {
        const base = bucketSignature([r()]);
        expect(bucketSignature([r({ title: 'Y' })])).not.toBe(base);
        expect(bucketSignature([r({ requirement_status: 'development' })])).not.toBe(base);
        expect(bucketSignature([r({ coordination_type: 'planned' })])).not.toBe(base);
        expect(bucketSignature([r({ category_fk: 4 })])).not.toBe(base);
        expect(bucketSignature([r({ completed_at: '2026-06-13 11:00:00' })])).not.toBe(base);
    });

    it('returns empty string for empty/invalid input', () => {
        expect(bucketSignature([])).toBe('');
        expect(bucketSignature(null)).toBe('');
        expect(bucketSignature(undefined)).toBe('');
    });
});

describe('reconcileBuckets (stable per-day array refs)', () => {
    const mk = (id, title = 'T') => ({
        id, completed_at: '2026-06-13 10:00:00', requirement_status: 'met',
        coordination_type: 'deployed', category_fk: 1, title,
    });

    it('reuses the prior array reference for an unchanged day', () => {
        const a1 = [mk(1)];
        const b1 = [mk(2)];
        const fresh1 = new Map([['2026-06-13', a1], ['2026-06-14', b1]]);
        const pass1 = reconcileBuckets(new Map(), fresh1);

        // Second pass: brand-new array instances, identical content.
        const a2 = [mk(1)];
        const b2 = [mk(2)];
        const fresh2 = new Map([['2026-06-13', a2], ['2026-06-14', b2]]);
        const pass2 = reconcileBuckets(pass1.cache, fresh2);

        // Same content → reuse pass1's arrays, NOT the fresh2 instances.
        expect(pass2.map.get('2026-06-13')).toBe(a1);
        expect(pass2.map.get('2026-06-14')).toBe(b1);
        expect(pass2.map.get('2026-06-13')).not.toBe(a2);
    });

    it('returns the fresh array for a day whose content changed', () => {
        const a1 = [mk(1, 'old')];
        const pass1 = reconcileBuckets(new Map(), new Map([['d', a1]]));

        const a2 = [mk(1, 'new')];   // same id, different title → new signature
        const pass2 = reconcileBuckets(pass1.cache, new Map([['d', a2]]));

        expect(pass2.map.get('d')).toBe(a2);
        expect(pass2.map.get('d')).not.toBe(a1);
    });

    it('drops days no longer present from the cache', () => {
        const pass1 = reconcileBuckets(new Map(), new Map([['gone', [mk(1)]], ['stay', [mk(2)]]]));
        const stayArr = pass1.map.get('stay');
        const pass2 = reconcileBuckets(pass1.cache, new Map([['stay', [mk(2)]]]));
        expect(pass2.cache.has('gone')).toBe(false);
        expect(pass2.map.get('stay')).toBe(stayArr);   // unchanged day still stable
    });
});
