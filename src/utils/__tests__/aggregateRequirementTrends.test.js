import { describe, it, expect } from 'vitest';
import { aggregateRequirementTrends, getISOWeek } from '../aggregateRequirementTrends';

const cats = [
    { id: 1, category_name: 'Swarm', color: '#26c6da' },
    { id: 2, category_name: 'Maps', color: '#E91E63' },
];

const req = (completed_at, category_fk = 1) => ({ completed_at, category_fk });

describe('aggregateRequirementTrends', () => {
    it('returns empty data for no rows', () => {
        const out = aggregateRequirementTrends([], cats, { timeframe: 'day' });
        expect(out.data).toEqual([]);
        expect(out.categories).toEqual([]);
        expect(out.kpis.totalClosed).toBe(0);
        expect(out.kpis.busiest).toBeNull();
        expect(out.kpis.topCategory).toBeNull();
    });

    it('ignores requirements without completed_at (closed-only filter)', () => {
        const rows = [
            req('2026-06-10T10:00:00', 1),
            req(null, 1),
            { completed_at: '', category_fk: 1 },
        ];
        const out = aggregateRequirementTrends(rows, cats, { timeframe: 'day' });
        expect(out.kpis.totalClosed).toBe(1);
    });

    it('buckets by day with gap-fill between first and last', () => {
        const rows = [
            req('2026-06-10T10:00:00', 1),
            req('2026-06-10T23:00:00', 1),
            req('2026-06-12T01:00:00', 1),
        ];
        const out = aggregateRequirementTrends(rows, cats, { timeframe: 'day' });
        // Jun 10, 11 (gap), 12
        expect(out.data.map(d => d.key)).toEqual(['2026-06-10', '2026-06-11', '2026-06-12']);
        expect(out.data.map(d => d.total)).toEqual([2, 0, 1]);
        expect(out.data[0].label).toBe('Jun 10');
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
