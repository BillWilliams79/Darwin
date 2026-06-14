import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { aggregateRequirementTrends, getISOWeek, requirementBucketKey } from '../aggregateRequirementTrends';

const cats = [
    { id: 1, category_name: 'Swarm', color: '#26c6da' },
    { id: 2, category_name: 'Maps', color: '#E91E63' },
];

const req = (completed_at, category_fk = 1) => ({ completed_at, category_fk, requirement_status: 'met' });

// Pin the timezone so local-day bucketing (req #2822) is deterministic across
// machines/CI. America/Los_Angeles is behind UTC — exactly the case that exposed
// the bug, where an evening-local close reads as the next day in UTC. Node honors
// a runtime TZ change for subsequent Date operations.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/Los_Angeles'; });
afterAll(() => { process.env.TZ = ORIGINAL_TZ; });

describe('aggregateRequirementTrends', () => {
    it('returns empty data for no rows', () => {
        const out = aggregateRequirementTrends([], cats, { timeframe: 'day' });
        expect(out.data).toEqual([]);
        expect(out.categories).toEqual([]);
        expect(out.kpis.totalClosed).toBe(0);
        expect(out.kpis.busiest).toBeNull();
        expect(out.kpis.topCategory).toBeNull();
    });

    it('ignores requirements without completed_at (met-only filter)', () => {
        const rows = [
            req('2026-06-10T10:00:00', 1),
            req(null, 1),
            { completed_at: '', category_fk: 1, requirement_status: 'met' },
        ];
        const out = aggregateRequirementTrends(rows, cats, { timeframe: 'day' });
        expect(out.kpis.totalClosed).toBe(1);
    });

    it('excludes wontfix even though it stamps completed_at (req #2850)', () => {
        const rows = [
            req('2026-06-10T10:00:00', 1),                                            // met → counts
            { completed_at: '2026-06-10T11:00:00', category_fk: 1, requirement_status: 'wontfix' }, // excluded
            { completed_at: '2026-06-10T12:00:00', category_fk: 1, requirement_status: 'development' }, // excluded
        ];
        const out = aggregateRequirementTrends(rows, cats, { timeframe: 'day' });
        expect(out.kpis.totalClosed).toBe(1);
        expect(out.data.find(d => d.key === '2026-06-10').total).toBe(1);
    });

    it('buckets by day with gap-fill between first and last', () => {
        // All times are UTC; under the pinned LA zone they stay on the same
        // calendar day (morning/afternoon local), so the day buckets are stable.
        const rows = [
            req('2026-06-10T18:00:00', 1), // Jun 10 11:00 PDT
            req('2026-06-11T06:00:00', 1), // Jun 10 23:00 PDT -> still Jun 10
            req('2026-06-12T15:00:00', 1), // Jun 12 08:00 PDT
        ];
        const out = aggregateRequirementTrends(rows, cats, { timeframe: 'day' });
        // Jun 10, 11 (gap), 12
        expect(out.data.map(d => d.key)).toEqual(['2026-06-10', '2026-06-11', '2026-06-12']);
        expect(out.data.map(d => d.total)).toEqual([2, 0, 1]);
        expect(out.data[0].label).toBe('Jun 10');
    });

    it('buckets an evening-local close on the local day, not the next UTC day (req #2822)', () => {
        // Stored UTC. In America/Los_Angeles this is Jun 11 18:00 PDT — still
        // Jun 11 locally even though the UTC calendar date is already Jun 12.
        // The pre-fix code sliced the UTC date string and wrongly reported Jun 12
        // ("closed tomorrow"); local-day bucketing must land it on Jun 11.
        const rows = [req('2026-06-12T01:00:00', 1)];
        const out = aggregateRequirementTrends(rows, cats, { timeframe: 'day' });
        expect(out.data.map(d => d.key)).toEqual(['2026-06-11']);
        expect(out.data[0].label).toBe('Jun 11');
        expect(out.data[0].total).toBe(1);
    });

    it('buckets a late-night close on the local day for a viewer ahead of UTC (req #2822)', () => {
        // Asia/Karachi is UTC+5. "2026-06-11T22:00:00" UTC is Jun 12 03:00 local,
        // so it must bucket on Jun 12 — the symmetric case to a behind-UTC viewer.
        const saved = process.env.TZ;
        process.env.TZ = 'Asia/Karachi';
        try {
            const rows = [req('2026-06-11T22:00:00', 1)];
            const out = aggregateRequirementTrends(rows, cats, { timeframe: 'day' });
            expect(out.data.map(d => d.key)).toEqual(['2026-06-12']);
            expect(out.data[0].label).toBe('Jun 12');
            expect(out.data[0].total).toBe(1);
        } finally {
            process.env.TZ = saved;
        }
    });

    it('buckets by month', () => {
        const rows = [
            req('2026-05-15T10:00:00', 1),
            req('2026-06-01T10:00:00', 1),
            req('2026-06-20T10:00:00', 1),
        ];
        const out = aggregateRequirementTrends(rows, cats, { timeframe: 'month' });
        expect(out.data.map(d => d.key)).toEqual(['2026-05', '2026-06']);
        expect(out.data.map(d => d.total)).toEqual([1, 2]);
        expect(out.data[1].label).toBe('Jun 2026');
    });

    it('buckets by ISO week', () => {
        // 2026-06-08 is a Monday (W24); 2026-06-15 is the next Monday (W25)
        const rows = [
            req('2026-06-08T10:00:00', 1),
            req('2026-06-10T10:00:00', 1),
            req('2026-06-15T10:00:00', 1),
        ];
        const out = aggregateRequirementTrends(rows, cats, { timeframe: 'week' });
        const w1 = getISOWeek(new Date(Date.UTC(2026, 5, 8)));
        const w2 = getISOWeek(new Date(Date.UTC(2026, 5, 15)));
        expect(w2.week).toBe(w1.week + 1);
        expect(out.data.length).toBe(2);
        expect(out.data[0].total).toBe(2);
        expect(out.data[1].total).toBe(1);
        // Week labels show the Monday start date, not the ISO week number (req #2826).
        expect(out.data[0].label).toBe('Jun 8 2026');
        expect(out.data[1].label).toBe('Jun 15 2026');
    });

    it('labels year-boundary weeks with the start date in the prior year (req #2826)', () => {
        // ISO week 1 of 2026 starts Monday 2026-W01 = Dec 29 2025 (Jan 1 2026 is a
        // Thursday, so its week reaches back into December). A row closing Jan 1
        // 2026 must label as the Monday "Dec 29 2025", not "W01 2026".
        const out = aggregateRequirementTrends(
            [req('2026-01-01T10:00:00', 1)], cats, { timeframe: 'week' });
        expect(out.data[0].label).toBe('Dec 29 2025');
    });

    it('splits counts per category', () => {
        const rows = [
            req('2026-06-10T10:00:00', 1),
            req('2026-06-10T11:00:00', 2),
            req('2026-06-10T12:00:00', 2),
        ];
        const out = aggregateRequirementTrends(rows, cats, { timeframe: 'day' });
        expect(out.categories.map(c => c.id)).toEqual([1, 2]);
        expect(out.data[0].cat_1).toBe(1);
        expect(out.data[0].cat_2).toBe(2);
        expect(out.data[0].total).toBe(3);
        // category color + name carried through
        expect(out.categories.find(c => c.id === 2)).toMatchObject({ name: 'Maps', color: '#E91E63' });
    });

    it('only includes selected categories', () => {
        const rows = [
            req('2026-06-10T10:00:00', 1),
            req('2026-06-10T11:00:00', 2),
        ];
        const out = aggregateRequirementTrends(rows, cats, {
            timeframe: 'day',
            selectedCategoryIds: [2],
        });
        expect(out.kpis.totalClosed).toBe(1);
        expect(out.categories.map(c => c.id)).toEqual([2]);
        expect(out.data[0].total).toBe(1);
    });

    it('excludes requirements in excludeCategoryIds (closed categories — req #2821)', () => {
        const rows = [
            req('2026-06-10T10:00:00', 1),
            req('2026-06-10T11:00:00', 2),
            req('2026-06-10T12:00:00', 2),
        ];
        const out = aggregateRequirementTrends(rows, cats, {
            timeframe: 'day',
            excludeCategoryIds: [2],
        });
        // Category 2 dropped entirely: from data, categories and KPIs.
        expect(out.kpis.totalClosed).toBe(1);
        expect(out.categories.map(c => c.id)).toEqual([1]);
        expect(out.data[0].total).toBe(1);
        expect(out.data[0].cat_2).toBeUndefined();
    });

    it('excludeCategoryIds=[] excludes nothing (toggle on)', () => {
        const rows = [
            req('2026-06-10T10:00:00', 1),
            req('2026-06-10T11:00:00', 2),
        ];
        const out = aggregateRequirementTrends(rows, cats, {
            timeframe: 'day',
            excludeCategoryIds: [],
        });
        expect(out.kpis.totalClosed).toBe(2);
        expect(out.categories.map(c => c.id)).toEqual([1, 2]);
    });

    it('excludeCategoryIds composes with selectedCategoryIds', () => {
        const rows = [
            req('2026-06-10T10:00:00', 1),
            req('2026-06-10T11:00:00', 2),
        ];
        // Selecting both but excluding 2 leaves only category 1.
        const out = aggregateRequirementTrends(rows, cats, {
            timeframe: 'day',
            selectedCategoryIds: [1, 2],
            excludeCategoryIds: [2],
        });
        expect(out.kpis.totalClosed).toBe(1);
        expect(out.categories.map(c => c.id)).toEqual([1]);
    });

    it('produces a cumulative running total', () => {
        const rows = [
            req('2026-06-10T10:00:00', 1),
            req('2026-06-12T10:00:00', 1),
            req('2026-06-12T11:00:00', 1),
        ];
        const out = aggregateRequirementTrends(rows, cats, { timeframe: 'day', cumulative: true });
        // Jun 10 -> 1, Jun 11 (gap) -> 1, Jun 12 -> 3
        expect(out.data.map(d => d.total)).toEqual([1, 1, 3]);
        expect(out.data.map(d => d.cat_1)).toEqual([1, 1, 3]);
    });

    it('windows buckets by rangeDays relative to nowMs', () => {
        const rows = [
            req('2026-06-01T10:00:00', 1),
            req('2026-06-10T10:00:00', 1),
        ];
        const nowMs = Date.UTC(2026, 5, 11); // Jun 11 2026
        const out = aggregateRequirementTrends(rows, cats, {
            timeframe: 'day',
            rangeDays: 7,
            nowMs,
        });
        // Only the last 7 days survive — Jun 1 dropped, Jun 10 kept.
        expect(out.data.some(d => d.key === '2026-06-01')).toBe(false);
        expect(out.data.some(d => d.key === '2026-06-10')).toBe(true);
        expect(out.kpis.closedInRange).toBe(1);
        // totalClosed still reflects ALL closed reqs, not just the window.
        expect(out.kpis.totalClosed).toBe(2);
    });

    it('computes busiest bucket and top category KPIs', () => {
        const rows = [
            req('2026-06-10T10:00:00', 1),
            req('2026-06-10T11:00:00', 1),
            req('2026-06-12T10:00:00', 2),
        ];
        const out = aggregateRequirementTrends(rows, cats, { timeframe: 'day' });
        expect(out.kpis.busiest).toEqual({ label: 'Jun 10', count: 2 });
        expect(out.kpis.topCategory).toEqual({ name: 'Swarm', count: 2 });
        // 3 met across 3 day-buckets (Jun 10, 11 gap, 12) → avg 1.0 per day.
        expect(out.kpis.avgPerBucket).toBeCloseTo(1.0);
    });

    it('scopes topCategory to the range window (consistent with closedInRange)', () => {
        const rows = [
            // Category 1: lots of closures long ago (outside a 30d window).
            req('2026-04-01T10:00:00', 1),
            req('2026-04-02T10:00:00', 1),
            req('2026-04-03T10:00:00', 1),
            // Category 2: a couple of recent closures inside the window.
            req('2026-06-09T10:00:00', 2),
            req('2026-06-10T10:00:00', 2),
        ];
        const nowMs = Date.UTC(2026, 5, 11); // Jun 11 2026
        const out = aggregateRequirementTrends(rows, cats, {
            timeframe: 'day', rangeDays: 30, nowMs,
        });
        // Category 1 dominates all-time but closed nothing in the last 30d, so
        // the windowed Top Category must be category 2.
        expect(out.kpis.topCategory).toEqual({ name: 'Maps', count: 2 });
        expect(out.kpis.closedInRange).toBe(2);
        expect(out.kpis.totalClosed).toBe(5);
    });

    it('falls back to a synthetic name for unknown categories', () => {
        const rows = [req('2026-06-10T10:00:00', 99)];
        const out = aggregateRequirementTrends(rows, cats, { timeframe: 'day' });
        expect(out.categories[0]).toMatchObject({ id: 99, name: 'Category 99', color: null });
    });
});

// req #2850 — the Table view's click-to-zoom drill matches requirements to the
// clicked bucket via requirementBucketKey, so it MUST key identically to the chart.
describe('requirementBucketKey (click-to-zoom drill matching)', () => {
    const ORIGINAL_TZ = process.env.TZ;
    beforeAll(() => { process.env.TZ = 'America/Los_Angeles'; });
    afterAll(() => { process.env.TZ = ORIGINAL_TZ; });

    it('returns null for missing/empty/unparseable timestamps', () => {
        expect(requirementBucketKey(null, 'day')).toBeNull();
        expect(requirementBucketKey('', 'day')).toBeNull();
        expect(requirementBucketKey('not-a-date', 'day')).toBeNull();
    });

    it('keys by day / month', () => {
        // 10:00 UTC is still the same calendar day in LA (03:00 local).
        expect(requirementBucketKey('2026-06-10T10:00:00', 'day')).toBe('2026-06-10');
        expect(requirementBucketKey('2026-06-10T10:00:00', 'month')).toBe('2026-06');
    });

    it('resolves the local calendar day, not the raw UTC day (req #2822 parity)', () => {
        // 01:00 UTC Jun 12 is really Jun 11 evening in LA → buckets to Jun 11.
        expect(requirementBucketKey('2026-06-12T01:00:00', 'day')).toBe('2026-06-11');
    });

    it('matches the aggregator bucketing exactly across day/week/month', () => {
        const rows = [
            req('2026-06-10T10:00:00', 1),
            req('2026-06-10T20:00:00', 1),
            req('2026-06-12T01:00:00', 2), // local Jun 11
            req('2026-05-30T12:00:00', 1),
        ];
        for (const timeframe of ['day', 'week', 'month']) {
            const agg = aggregateRequirementTrends(rows, cats, { timeframe });
            const counts = {};
            for (const r of rows) {
                const k = requirementBucketKey(r.completed_at, timeframe);
                counts[k] = (counts[k] || 0) + 1;
            }
            // Every chart point's total equals the count of rows the drill helper
            // assigns to that same key (gap-fill buckets land at 0 on both sides).
            for (const point of agg.data) {
                expect(point.total).toBe(counts[point.key] || 0);
            }
        }
    });
});
