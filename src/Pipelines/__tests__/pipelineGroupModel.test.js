// @vitest-environment node
//
// req #3972 — the "Pipeline group" scene: every pipeline a platform on one
// floor, its initiative strips, epic pedestals at (column, lane), requirement
// cubes stacked and coloured by status, dependency arcs.

import { describe, it, expect } from 'vitest';
import {
    buildPipelineGroupModel, pipelineBox, groupStatusColor, GROUP, GROUP_STATUS_LEGEND,
    UNKNOWN_STATUS_COLOR,
} from '../pipelineGroupModel';
import { DEFAULT_PLAN_PALETTE, planPalette } from '../../SwarmView/pipelines/pipelinePlanLayout';

const layoutOf = (nodes, bands) => ({
    nodes: new Map(nodes.map((n) => [n.id, n])),
    bands: bands.map((b, i) => ({ key: 40 + i, color: `#00000${i}`, initiative: `Init ${i}`, ...b })),
});

const reqs = (list) => new Map(list.map(([id, status]) => [id, { id, title: `R${id}`, requirement_status: status }]));

const drawnPlan = (id, extra = {}) => ({
    pipeline: { id, title: `Plan ${id}`, pipeline_status: 'active' },
    state: 'drawn',
    layout: layoutOf([
        { id: 1, depth: 0, lane: 0, bandIndex: 0 },
        { id: 2, depth: 1, lane: 0, bandIndex: 0 },
        { id: 3, depth: 1, lane: 3, bandIndex: 0 },     // lane 3 packs to the 2nd row
        { id: 4, depth: 2, lane: 0, bandIndex: 1 },
    ], [{}, {}]),
    rows: [
        { id: 1, title: 'E1', reqIds: [900, 901], depIds: [] },
        { id: 2, title: 'E2', reqIds: [], depIds: [1] },
        { id: 3, title: 'E3', reqIds: [902], depIds: [1] },
        { id: 4, title: 'E4', reqIds: [903], depIds: [2, 99] },
    ],
    requirementsById: reqs([[900, 'development'], [901, 'met'], [902, 'swarm_ready'], [903, 'wontfix']]),
    ...extra,
});

describe('buildPipelineGroupModel — one plan', () => {
    const model = buildPipelineGroupModel([drawnPlan(7)]);
    const p = model.pipelines[0];

    it('draws every initiative as a strip, every epic and every requirement', () => {
        expect(p.bands.map((b) => [b.key, b.label])).toEqual([[40, 'Init 0'], [41, 'Init 1']]);
        expect(p.epics.map((e) => e.id)).toEqual([1, 2, 3, 4]);
        expect(p.epics.flatMap((e) => e.reqs.map((r) => r.id)).sort()).toEqual([900, 901, 902, 903]);
        expect(model.counts).toEqual({
            pipelines: 1, initiatives: 2, epics: 4, requirements: 4, met: 1,
        });
        expect(p.counts.open).toBe(2);              // development + swarm_ready
    });

    it('places epics on the plan\'s own columns and packed lanes', () => {
        const at = new Map(p.epics.map((e) => [e.id, e]));
        expect(at.get(2).x - at.get(1).x).toBeCloseTo(GROUP.col);
        expect(at.get(1).z).toBe(at.get(2).z);
        // lane 3 is the band's second USED lane, so it sits one lane pitch down
        expect(at.get(3).z - at.get(2).z).toBeCloseTo(GROUP.lane);
        // the second band starts after the first band's two lanes and the gap
        expect(at.get(4).z).toBeCloseTo(GROUP.pad + 2 * GROUP.lane + GROUP.bandGap + GROUP.lane / 2);
        expect(at.get(4).band).toBe(41);
        expect(at.get(4).color).toBe('#000001');
        for (const e of p.epics) {
            expect(e.x).toBeGreaterThan(0);
            expect(e.x).toBeLessThan(p.w);
            expect(e.z).toBeGreaterThan(0);
            expect(e.z).toBeLessThan(p.d);
        }
    });

    it('stacks requirements terminal-first and colours them in the palette that renders', () => {
        const e1 = p.epics.find((e) => e.id === 1);
        expect(e1.reqs.map((r) => r.status)).toEqual(['met', 'development']);
        const aurora = planPalette(DEFAULT_PLAN_PALETTE).status;
        expect(e1.reqs[0].color).toBe(aurora.met);
        expect(e1.reqs[1].color).toBe(aurora.development);
        expect(e1.met).toBe(1);
        expect(e1.open).toBe(1);
        expect(e1.reqs.every((r) => r.y > GROUP.pedestalH)).toBe(true);
    });

    it('draws an arc per in-plan dependency, never for an out-of-plan one', () => {
        expect(p.arcs).toHaveLength(3);
        for (const a of p.arcs) expect(a.apex).toBeGreaterThan(Math.max(a.from[1], a.to[1]));
    });

    it('a pipeline box covers its platform and its tallest stack', () => {
        const box = pipelineBox(p);
        expect(box.maxX - box.minX).toBe(p.w);
        expect(box.maxZ - box.minZ).toBe(p.d);
        expect(box.maxY).toBeGreaterThan(GROUP.slabH);
    });
});

describe('buildPipelineGroupModel — the floor', () => {
    it('packs every pipeline without overlap and centres the field', () => {
        const plans = [7, 8, 9, 10, 11].map((id) => drawnPlan(id));
        const model = buildPipelineGroupModel(plans);
        const ps = model.pipelines;
        for (let i = 0; i < ps.length; i += 1) {
            for (let j = i + 1; j < ps.length; j += 1) {
                const a = ps[i];
                const b = ps[j];
                const apart = a.x + a.w <= b.x || b.x + b.w <= a.x
                    || a.z + a.d <= b.z || b.z + b.d <= a.z;
                expect(apart).toBe(true);
            }
        }
        const b = model.bounds;
        expect(b.minX).toBeCloseTo(-b.maxX);
        expect(b.minZ).toBeCloseTo(-b.maxZ);
        for (const p of ps) {
            expect(p.x).toBeGreaterThanOrEqual(b.minX - 1e-9);
            expect(p.x + p.w).toBeLessThanOrEqual(b.maxX + 1e-9);
            expect(p.z).toBeGreaterThanOrEqual(b.minZ - 1e-9);
            expect(p.z + p.d).toBeLessThanOrEqual(b.maxZ + 1e-9);
        }
        // more than one row: the field is a floor, not a corridor
        expect(new Set(ps.map((p) => p.z)).size).toBeGreaterThan(1);
    });

    it('keeps the page order, left to right then row by row', () => {
        const model = buildPipelineGroupModel([3, 1, 2].map((id) => drawnPlan(id)));
        expect(model.pipelines.map((p) => p.id)).toEqual([3, 1, 2]);
    });

    it('gives a loading, failed or empty plan a placeholder platform', () => {
        const model = buildPipelineGroupModel([
            { pipeline: { id: 1, title: 'A' }, state: 'loading' },
            { pipeline: { id: 2, title: 'B' }, state: 'error' },
            { pipeline: { id: 3, title: '' }, state: 'empty' },
        ]);
        expect(model.pipelines.map((p) => [p.state, p.w, p.epics.length])).toEqual([
            ['loading', GROUP.emptySize, 0], ['error', GROUP.emptySize, 0], ['empty', GROUP.emptySize, 0],
        ]);
        expect(model.pipelines[2].title).toBe('Pipeline 3');
    });

    it('an empty list is an empty field', () => {
        const model = buildPipelineGroupModel([]);
        expect(model.pipelines).toEqual([]);
        expect(model.counts.pipelines).toBe(0);
    });
});

describe('status colours', () => {
    it('an unknown status is dim, never an inherited property', () => {
        expect(groupStatusColor('bogus')).toBe(UNKNOWN_STATUS_COLOR);
        expect(groupStatusColor('constructor')).toBe(UNKNOWN_STATUS_COLOR);
        expect(groupStatusColor(null)).toBe(UNKNOWN_STATUS_COLOR);
    });

    it('the legend lists every status in lifecycle order', () => {
        expect(GROUP_STATUS_LEGEND.map((s) => s.status)).toEqual(
            ['authoring', 'approved', 'swarm_ready', 'development', 'met', 'deferred', 'wontfix']);
    });
});
