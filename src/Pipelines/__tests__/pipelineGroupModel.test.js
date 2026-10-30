// @vitest-environment node
//
// req #3972 — the "Pipeline group" scene: every pipeline a platform on one
// floor, its initiative strips, epic pedestals at (column, lane), requirement
// cubes stacked and coloured by status, dependency arcs.

import { describe, it, expect } from 'vitest';
import {
    buildPipelineGroupModel, pipelineBox, groupStatusColor, GROUP, GROUP_STATUS_LEGEND,
    UNKNOWN_STATUS_COLOR, LABEL_TIER, placeLabels,
    pipelineWhen, calendarBucket, calendarLabel, gapLabel,
} from '../pipelineGroupModel';
import { DEFAULT_PLAN_PALETTE, planPalette } from '../../SwarmView/pipelines/pipelinePlanLayout';

const layoutOf = (nodes, bands) => ({
    nodes: new Map(nodes.map((n) => [n.id, n])),
    bands: bands.map((b, i) => ({ key: 40 + i, color: `#00000${i}`, initiative: `Init ${i}`, ...b })),
});

const reqs = (list) => new Map(list.map(([id, status]) => [id, { id, title: `R${id}`, requirement_status: status }]));

const drawnPlan = (id, extra = {}) => ({
    pipeline: { id, title: `Plan ${id}`, pipeline_status: 'orchestrating' },
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

// req #4042 — the floor is a calendar: a column per occupied bucket, left to
// right in time; within a column, back to front by sort order.
describe('buildPipelineGroupModel — the calendar', () => {
    // Stamps are UTC without a zone; noon UTC is the same local day from
    // UTC−11 to UTC+11, so these fixtures bucket alike wherever the suite runs.
    const dated = (id, started, extra = {}) => drawnPlan(id, {
        pipeline: { id, title: `Plan ${id}`, pipeline_status: 'orchestrating', started_at: started, ...extra },
    });

    it('a pipeline sits on when it started, else when it was created', () => {
        expect(pipelineWhen({ started_at: '2026-10-23T12:00:00', create_ts: '2026-10-01T12:00:00' }))
            .toMatchObject({ source: 'started', day: '2026-10-23' });
        expect(pipelineWhen({ started_at: null, create_ts: '2026-10-01T12:00:00' }))
            .toMatchObject({ source: 'created', day: '2026-10-01' });
        expect(pipelineWhen({})).toBeNull();
    });

    it('buckets a day by day, by Sunday-started week, or by month', () => {
        // 2026-10-27 is a Tuesday; its week starts Sunday the 25th.
        expect(calendarBucket('2026-10-27', 'week').key).toBe('2026-10-25');
        expect(calendarBucket('2026-10-25', 'week').key).toBe('2026-10-25');
        expect(calendarBucket('2026-10-24', 'week').key).toBe('2026-10-18');
        expect(calendarBucket('2026-10-27', 'month').key).toBe('2026-10');
        expect(calendarBucket('2026-10-27', 'day').key).toBe('2026-10-27');
        // consecutive buckets are one index apart, across a month and a year
        expect(calendarBucket('2026-11-01', 'week').index - calendarBucket('2026-10-31', 'week').index).toBe(1);
        expect(calendarBucket('2027-01-15', 'month').index - calendarBucket('2026-12-01', 'month').index).toBe(1);
        expect(calendarBucket('2026-03-09', 'day').index - calendarBucket('2026-03-08', 'day').index).toBe(1);
    });

    it('labels columns and gaps as a calendar does', () => {
        expect(calendarLabel('2026-10-25', 'week')).toBe('Week of Oct 25');
        expect(calendarLabel('2026-10-27', 'day', { withYear: true })).toBe('Oct 27, 2026');
        expect(calendarLabel('2026-10-01', 'month')).toBe('October 2026');
        expect(calendarLabel(null, 'week')).toBe('Undated');
        expect(gapLabel(1, 'week')).toBe('1 week');
        expect(gapLabel(9, 'week')).toBe('9 weeks');
    });

    it('orders columns left to right in time, whatever the page order', () => {
        const model = buildPipelineGroupModel([
            dated(1, '2026-10-26T12:00:00'),
            dated(2, '2026-07-28T12:00:00'),
            dated(3, '2026-10-20T12:00:00'),
        ]);
        expect(model.columns.map((c) => c.key)).toEqual(['2026-07-26', '2026-10-18', '2026-10-25']);
        expect(model.columns.map((c) => c.pipelineIds)).toEqual([[2], [3], [1]]);
        const x = new Map(model.pipelines.map((p) => [p.id, p.x]));
        expect(x.get(2)).toBeLessThan(x.get(3));
        expect(x.get(3)).toBeLessThan(x.get(1));
        expect(model.pipelines.map((p) => p.id)).toEqual([2, 3, 1]);
    });

    it('within a column, pipelines stand back to front by sort order', () => {
        const model = buildPipelineGroupModel([
            dated(1, '2026-10-25T12:00:00', { sort_order: 3 }),
            dated(2, '2026-10-27T12:00:00', { sort_order: 1 }),
            dated(3, '2026-10-26T12:00:00', { sort_order: null }),
            dated(4, '2026-10-26T12:00:00', { sort_order: 2 }),
        ]);
        expect(model.columns).toHaveLength(1);
        expect(model.columns[0].pipelineIds).toEqual([2, 4, 1, 3]);   // unset sort order last
        const byId = new Map(model.pipelines.map((p) => [p.id, p]));
        expect([2, 4, 1, 3].map((id) => byId.get(id).rank)).toEqual([1, 2, 3, 4]);
        const zs = [2, 4, 1, 3].map((id) => byId.get(id).z);
        expect([...zs].sort((a, b) => a - b)).toEqual(zs);
        for (let i = 1; i < zs.length; i += 1) {
            const prev = byId.get([2, 4, 1, 3][i - 1]);
            expect(zs[i]).toBeGreaterThanOrEqual(prev.z + prev.d);
        }
    });

    it('the bucket decides what counts as worked closely', () => {
        const plans = [dated(1, '2026-10-20T12:00:00'), dated(2, '2026-10-26T12:00:00')];
        expect(buildPipelineGroupModel(plans, { bucket: 'week' }).columns).toHaveLength(2);
        expect(buildPipelineGroupModel(plans, { bucket: 'month' }).columns).toHaveLength(1);
        expect(buildPipelineGroupModel(plans, { bucket: 'day' }).columns).toHaveLength(2);
        expect(buildPipelineGroupModel(plans, { bucket: 'bogus' }).bucket).toBe('week');
    });

    it('names a skipped stretch and widens its aisle', () => {
        const model = buildPipelineGroupModel([
            dated(1, '2026-08-05T12:00:00'),     // week of Aug 2
            dated(2, '2026-10-14T12:00:00'),     // week of Oct 11 — 9 weeks skipped
            dated(3, '2026-10-20T12:00:00'),     // week of Oct 18 — adjacent
        ]);
        const [a, b, c] = model.columns;
        expect(b.gapBefore).toEqual({ count: 9, label: '9 weeks' });
        expect(c.gapBefore).toBeNull();
        expect(b.x - (a.x + a.w)).toBeCloseTo(GROUP.aisle + GROUP.gapAisle);
        expect(c.x - (b.x + b.w)).toBeCloseTo(GROUP.aisle);
    });

    it('an undated pipeline stands in a last column of its own', () => {
        const model = buildPipelineGroupModel([
            drawnPlan(9), dated(1, '2026-10-20T12:00:00'),
        ]);
        expect(model.columns.map((c) => c.label)).toEqual(['Week of Oct 18', 'Undated']);
        expect(model.columns[1].gapBefore).toBeNull();
    });

    it('a calendar spanning two years dates its columns with the year', () => {
        const model = buildPipelineGroupModel([
            dated(1, '2025-12-30T12:00:00'), dated(2, '2026-01-06T12:00:00'),
        ]);
        expect(model.columns.map((c) => c.label)).toEqual(['Week of Dec 28, 2025', 'Week of Jan 4, 2026']);
    });

    it('orders unset sort orders by parsed time, whatever the stamp\'s spelling', () => {
        const model = buildPipelineGroupModel([
            dated(1, '2026-10-26T12:00:00'),
            dated(2, '2026-10-26 09:00:00'),
        ]);
        expect(model.columns[0].pipelineIds).toEqual([2, 1]);
    });

    it('a column\'s date outranks the note of a skipped stretch', () => {
        expect(LABEL_TIER.column).toBeLessThan(LABEL_TIER.gap);
        expect(LABEL_TIER.epic).toBeLessThan(LABEL_TIER.gap);
    });

    it('the header strip sits behind every platform and inside the bounds', () => {
        const model = buildPipelineGroupModel([dated(1, '2026-10-20T12:00:00'), dated(2, '2026-10-27T12:00:00')]);
        for (const col of model.columns) {
            expect(col.headerZ).toBeLessThan(col.z);
            expect(col.headerZ).toBeGreaterThan(model.bounds.minZ);
        }
        for (const p of model.pipelines) expect(p.z).toBeGreaterThanOrEqual(model.columns[0].z);
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

// req #4040 — every platform's initiative and epic names are drawn, so the
// labels are decluttered: placed in priority order, an overlapping one hides.
describe('placeLabels', () => {
    const box = (left, top, extra = {}) => ({
        left, top, right: left + 100, bottom: top + 16, tier: LABEL_TIER.epic, d: 1, ...extra,
    });

    it('shows every label that overlaps nothing', () => {
        expect(placeLabels([box(0, 0), box(200, 0), box(0, 100)])).toEqual([true, true, true]);
    });

    it('a pipeline title beats an initiative, which beats an epic, wherever they sit', () => {
        const shown = placeLabels([
            box(10, 4, { tier: LABEL_TIER.epic, d: 0 }),
            box(0, 0, { tier: LABEL_TIER.initiative, d: 50 }),
            box(5, 2, { tier: LABEL_TIER.pipeline, d: 99 }),
        ]);
        expect(shown).toEqual([false, false, true]);
    });

    it('within a tier the label nearer the camera wins', () => {
        expect(placeLabels([box(0, 0, { d: 9 }), box(20, 4, { d: 1 })])).toEqual([false, true]);
    });

    it("the focused pipeline's epic names beat every other plan's titles", () => {
        const shown = placeLabels([
            box(0, 0, { tier: LABEL_TIER.pipeline, d: 0 }),
            box(10, 5, { tier: LABEL_TIER.epic, d: 50, lit: true }),
        ]);
        expect(shown).toEqual([false, true]);
    });

    it('keeps a small gap: touching boxes count as overlapping', () => {
        expect(placeLabels([box(0, 0, { d: 0 }), box(101, 0, { d: 1 })])).toEqual([true, false]);
        expect(placeLabels([box(0, 0, { d: 0 }), box(103, 0, { d: 1 })])).toEqual([true, true]);
    });

    it('nothing in, nothing shown', () => {
        expect(placeLabels([])).toEqual([]);
    });
});
