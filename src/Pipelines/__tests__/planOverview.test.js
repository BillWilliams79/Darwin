// @vitest-environment node
//
// req #3804 review — the preview's condensed layout: the plan's bands, columns
// and lanes re-spaced to the frame, centred, capped so a small plan keeps air.

import { describe, it, expect } from 'vitest';
import { planOverview, overviewArcPath, OVERVIEW } from '../planOverview';

const layoutOf = (nodes, bands) => ({
    nodes: new Map(nodes.map((n) => [n.id, n])),
    bands: bands.map((b, i) => ({ key: `b${i}`, color: `#00000${i}`, ...b })),
});

describe('planOverview', () => {
    const layout = layoutOf([
        { id: 1, depth: 0, lane: 0, bandIndex: 0 },
        { id: 2, depth: 1, lane: 0, bandIndex: 0 },
        { id: 3, depth: 1, lane: 1, bandIndex: 0 },
        { id: 4, depth: 2, lane: 0, bandIndex: 1 },
    ], [{}, {}]);
    const rows = [
        { id: 1, reqIds: [9], depIds: [] },
        { id: 2, reqIds: [], depIds: [1] },
        { id: 3, reqIds: [7, 8], depIds: [1] },
        { id: 4, reqIds: [6], depIds: [2, 99] },
    ];

    it('fits every bead inside the frame and keeps the count', () => {
        const v = planOverview(layout, rows, 400, 132);
        expect(v.beads.map((b) => [b.id, b.count])).toEqual([[1, 1], [2, 0], [3, 2], [4, 1]]);
        for (const b of v.beads) {
            expect(b.x).toBeGreaterThan(0);
            expect(b.x).toBeLessThan(400);
            expect(b.y).toBeGreaterThan(0);
            expect(b.y).toBeLessThan(132);
        }
        expect(v.bands).toHaveLength(2);
        expect(v.arcs).toHaveLength(3);               // an out-of-plan dep draws nothing
    });

    it('caps the pitch so a small plan sits centred with air around it', () => {
        const v = planOverview(layout, rows, 1200, 132);
        const xs = v.beads.map((b) => b.x);
        expect(Math.max(...xs) - Math.min(...xs)).toBe(2 * OVERVIEW.colMax);
        const band = v.bands[0];
        expect(band.x).toBeCloseTo((1200 - band.w) / 2);
    });

    it('stacks bands top to bottom with a gap, lanes inside their band', () => {
        const v = planOverview(layout, rows, 400, 132);
        const [a, b] = v.bands;
        expect(b.y).toBeCloseTo(a.y + a.h + OVERVIEW.bandGap);
    });

    it('tightens the gaps for a crowded plan, giving the room to its lanes', () => {
        const v = planOverview(layout, rows, 400, 60);
        const [a, b] = v.bands;
        expect(b.y).toBeCloseTo(a.y + a.h + OVERVIEW.tightBandGap);
        expect(v.lanePitch).toBeGreaterThan(10);
        const v2 = planOverview(layout, rows, 400, 132);
        const a2 = v2.bands[0];
        const bead3 = v2.beads.find((x) => x.id === 3);
        expect(bead3.y).toBeGreaterThan(a2.y);
        expect(bead3.y).toBeLessThan(a2.y + a2.h);
    });

    it('is null for an empty layout or no width', () => {
        expect(planOverview({ nodes: new Map(), bands: [] }, [], 400, 132)).toBeNull();
        expect(planOverview(layout, rows, 0, 132)).toBeNull();
    });
});

describe('planOverview lane packing', () => {
    it('drops lanes that hold no bead, so every row carries one', () => {
        const sparse = layoutOf([
            { id: 1, depth: 0, lane: 0, bandIndex: 0 },
            { id: 2, depth: 0, lane: 4, bandIndex: 0 },
        ], [{}]);
        const v = planOverview(sparse, [{ id: 1 }, { id: 2 }], 400, 132);
        const [b1, b2] = v.beads;
        expect(b2.y - b1.y).toBeCloseTo(v.lanePitch);
    });
});

describe('planOverview mark size', () => {
    it('draws the bead at markScale of its base size, leaving positions unchanged', () => {
        const one = layoutOf([{ id: 1, depth: 0, lane: 0, bandIndex: 0 }], [{}]);
        const v = planOverview(one, [{ id: 1 }], 400, 132);
        expect(v.r).toBeCloseTo(OVERVIEW.beadMax * OVERVIEW.markScale);
        expect(v.r / OVERVIEW.markScale).toBeLessThanOrEqual(OVERVIEW.beadMax);
    });
});

describe('planOverview edge rows', () => {
    it('skips a band holding no epic and keeps the next band\'s beads in it', () => {
        const v = planOverview(layoutOf([
            { id: 1, depth: 0, lane: 0, bandIndex: 1 },
        ], [{}, {}]), [{ id: 1 }], 400, 132);
        expect(v.bands).toHaveLength(1);
        expect(v.bands[0].key).toBe('b1');
        expect(v.beads[0].y).toBeGreaterThan(v.bands[0].y);
        expect(v.beads[0].y).toBeLessThan(v.bands[0].y + v.bands[0].h);
    });

    it('reads a missing depth, lane or band as 0, and drops a node past the bands', () => {
        const v = planOverview(layoutOf([
            { id: 1 },
            { id: 2, depth: 1, lane: 0, bandIndex: 7 },
        ], [{}]), [{ id: 1 }, { id: 2 }], 400, 132);
        expect(v.beads.map((b) => b.id)).toEqual([1]);
    });
});

describe('overviewArcPath', () => {
    it('is straight on one lane and a flat-ended curve across lanes', () => {
        expect(overviewArcPath({ x1: 0, y1: 5, x2: 10, y2: 5 })).toBe('M0,5 L10,5');
        expect(overviewArcPath({ x1: 0, y1: 0, x2: 10, y2: 8 })).toBe('M0,0 C5,0 5,8 10,8');
    });
});
