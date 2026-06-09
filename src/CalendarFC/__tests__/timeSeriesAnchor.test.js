import { describe, it, expect } from 'vitest';
import { bucketByDate, anchorDelta, EMPTY_REQS } from '../TimeSeriesView';

// req #2800 — two frontend fixes for the still-jumpy swarm visualizer:
//   1. bucketByDate — per-day requirement slices so a window refetch re-renders
//      only the panels whose day-data changed (BeadRow memo engages).
//   2. anchorDelta — re-pin the viewport-top panel when a data refetch resizes
//      the variable-height Elevator panels, so the visible day never jumps.

describe('bucketByDate (req #2800)', () => {
    const tz = 'UTC';

    it('buckets requirements by their tz-local completion date', () => {
        const reqs = [
            { id: 1, completed_at: '2026-06-09T15:00:00Z' },
            { id: 2, completed_at: '2026-06-09T23:30:00Z' },
            { id: 3, completed_at: '2026-06-10T01:00:00Z' },
        ];
        const m = bucketByDate(reqs, tz);
        expect(m.get('2026-06-09').map(r => r.id)).toEqual([1, 2]);
        expect(m.get('2026-06-10').map(r => r.id)).toEqual([3]);
        expect(m.size).toBe(2);
    });

    it('skips requirements with no completed_at', () => {
        const reqs = [
            { id: 1, completed_at: null },
            { id: 2 },
            { id: 3, completed_at: '2026-06-09T15:00:00Z' },
        ];
        const m = bucketByDate(reqs, tz);
        expect(m.size).toBe(1);
        expect(m.get('2026-06-09').map(r => r.id)).toEqual([3]);
    });

    it('returns an empty Map for non-array / empty input', () => {
        expect(bucketByDate(null, tz).size).toBe(0);
        expect(bucketByDate(undefined, tz).size).toBe(0);
        expect(bucketByDate([], tz).size).toBe(0);
    });

    it('a day with no completions falls back to the SHARED stable EMPTY_REQS', () => {
        // This referential stability is the whole point — an empty panel keeps
        // the same prop reference across refetches so BeadRow's memo skips it.
        const m = bucketByDate([{ id: 1, completed_at: '2026-06-09T15:00:00Z' }], tz);
        const a = m.get('2026-01-01') || EMPTY_REQS;
        const b = m.get('2025-12-31') || EMPTY_REQS;
        expect(a).toBe(EMPTY_REQS);
        expect(a).toBe(b);
    });
});

describe('anchorDelta (req #2800)', () => {
    // Helper: build a panelGeom from a heights array (mirrors the component memo).
    const geom = (heights) => {
        const cumulative = [];
        let acc = 0;
        for (const h of heights) { cumulative.push(acc); acc += h; }
        return { heights, cumulative, stripHeight: acc };
    };

    it('returns 0 when the geometry reference is unchanged', () => {
        const g = geom([140, 140, 140]);
        expect(anchorDelta(g, g, 0)).toBe(0);
    });

    it('returns 0 when panel counts differ (extend/prune case)', () => {
        const prev = geom([140, 140, 140]);
        const next = geom([140, 140, 140, 140]);
        expect(anchorDelta(prev, next, -100)).toBe(0);
    });

    it('returns 0 for empty geometry', () => {
        expect(anchorDelta(geom([]), geom([]), 0)).toBe(0);
    });

    it('pins the top panel when panels above it grow (scrolled-down case)', () => {
        // Viewport top sits inside panel index 2. offset = -(top of panel 2 area).
        // prev: panels [140,140,140,200,140]; cumulative[2] = 280.
        // Put the viewport top at strip y = 290 (inside panel 2). offset = -290.
        const prev = geom([140, 140, 140, 200, 140]);
        // Data loads: panels 0 and 1 grow to 300 each (above the viewport).
        const next = geom([300, 300, 140, 200, 140]);
        const offset = -290;
        // anchorIdx: frameTop = 290 + eps(2) = 292; prev bottoms: 140,280,420...
        //   292 < 420 → anchorIdx = 2.
        // panels 0,1 grew 140→300 (+320 total above the anchor), so
        // nextCum[2] = prevCum[2] + 320 = 600; delta = 280 - 600 = -320.
        expect(anchorDelta(prev, next, offset)).toBe(-320);
        // Applying the delta: newOffset = -290 + (-320) = -610. Check the panel-top
        // -to-viewport-top distance is preserved: prevCum[2]+offset = 280-290 = -10;
        // nextCum[2]+newOffset = 600-610 = -10. Same → no visible jump.
        const newOffset = offset + anchorDelta(prev, next, offset);
        expect(next.cumulative[2] + newOffset).toBe(prev.cumulative[2] + offset);
    });

    it('collapses-to-base case keeps the top panel put', () => {
        // Every panel had data (tall); refetch 404s → all collapse to base 140.
        const prev = geom([300, 300, 300, 300, 300]);
        const next = geom([140, 140, 140, 140, 140]);
        const offset = -650; // viewport top inside panel index 2 (cum 600..900)
        const delta = anchorDelta(prev, next, offset);
        const newOffset = offset + delta;
        // anchorIdx = 2 (600 <= 652 < 900). Distance preserved.
        expect(next.cumulative[2] + newOffset).toBe(prev.cumulative[2] + offset);
    });

    it('returns 0 when nothing above the anchor changed height', () => {
        // Panels above the viewport-top panel are identical; only panels below grow.
        const prev = geom([140, 140, 140, 140, 140]);
        const next = geom([140, 140, 140, 300, 300]);
        const offset = -200; // viewport top inside panel 1 (cum 140..280)
        expect(anchorDelta(prev, next, offset)).toBe(0);
    });
});
