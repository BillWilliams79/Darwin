import { describe, it, expect } from 'vitest';
import { applyViewFilter } from '../mapViewFilter';

const makeRun = (overrides = {}) => ({
    id: 1,
    map_route_fk: 10,
    start_time: '2025-06-15 14:30:00',
    notes: 'Sunny day ride along the coast',
    distance_mi: '12.5',
    ...overrides,
});

const runs = [
    makeRun({ id: 1, map_route_fk: 10, start_time: '2025-06-15 14:30:00', distance_mi: '12.5', notes: 'Sunny day ride' }),
    makeRun({ id: 2, map_route_fk: 20, start_time: '2025-07-01 09:00:00', distance_mi: '25.0', notes: 'Morning loop' }),
    makeRun({ id: 3, map_route_fk: 10, start_time: '2025-08-20 17:00:00', distance_mi: '5.2', notes: null }),
    makeRun({ id: 4, map_route_fk: null, start_time: '2025-09-10 12:00:00', distance_mi: '30.1', notes: 'Rain and wind' }),
    makeRun({ id: 5, map_route_fk: 30, start_time: '2025-12-25 08:00:00', distance_mi: '0.5', notes: '' }),
];

describe('applyViewFilter', () => {
    it('returns all runs when criteria is null', () => {
        expect(applyViewFilter(runs, null)).toBe(runs);
    });

    it('returns all runs when criteria is empty object', () => {
        expect(applyViewFilter(runs, {})).toBe(runs);
    });

    it('returns all runs when criteria is undefined', () => {
        expect(applyViewFilter(runs, undefined)).toBe(runs);
    });

    describe('route filter', () => {
        it('filters by single route_id', () => {
            const result = applyViewFilter(runs, { route_ids: [10] });
            expect(result.map(r => r.id)).toEqual([1, 3]);
        });

        it('filters by multiple route_ids', () => {
            const result = applyViewFilter(runs, { route_ids: [10, 30] });
            expect(result.map(r => r.id)).toEqual([1, 3, 5]);
        });

        it('excludes runs with null map_route_fk', () => {
            const result = applyViewFilter(runs, { route_ids: [10] });
            expect(result.find(r => r.id === 4)).toBeUndefined();
        });

        it('does not filter when route_ids is empty array', () => {
            const result = applyViewFilter(runs, { route_ids: [] });
            expect(result).toHaveLength(5);
        });
    });

    describe('date range filter', () => {
        it('filters by date_start only', () => {
            const result = applyViewFilter(runs, { date_start: '2025-08-01' });
            expect(result.map(r => r.id)).toEqual([3, 4, 5]);
        });

        it('filters by date_end only', () => {
            const result = applyViewFilter(runs, { date_end: '2025-07-01' });
            expect(result.map(r => r.id)).toEqual([1, 2]);
        });

        it('filters by both date_start and date_end', () => {
            const result = applyViewFilter(runs, { date_start: '2025-07-01', date_end: '2025-09-10' });
            expect(result.map(r => r.id)).toEqual([2, 3, 4]);
        });

        it('includes runs on the end date (end of day)', () => {
            const result = applyViewFilter(runs, { date_end: '2025-06-15' });
            expect(result.map(r => r.id)).toContain(1);
        });
    });

    describe('notes search filter', () => {
        it('finds case-insensitive substring match', () => {
            const result = applyViewFilter(runs, { notes_search: 'sunny' });
            expect(result.map(r => r.id)).toEqual([1]);
        });

        it('matches partial text', () => {
            const result = applyViewFilter(runs, { notes_search: 'rain' });
            expect(result.map(r => r.id)).toEqual([4]);
        });

        it('excludes runs with null notes', () => {
            const result = applyViewFilter(runs, { notes_search: 'ride' });
            expect(result.find(r => r.id === 3)).toBeUndefined();
        });

        it('excludes runs with empty string notes', () => {
            const result = applyViewFilter(runs, { notes_search: 'ride' });
            expect(result.find(r => r.id === 5)).toBeUndefined();
        });
    });

    describe('distance range filter', () => {
        it('filters by distance_min only', () => {
            const result = applyViewFilter(runs, { distance_min: 10 });
            expect(result.map(r => r.id)).toEqual([1, 2, 4]);
        });

        it('filters by distance_max only', () => {
            const result = applyViewFilter(runs, { distance_max: 10 });
            expect(result.map(r => r.id)).toEqual([3, 5]);
        });

        it('filters by both distance_min and distance_max', () => {
            const result = applyViewFilter(runs, { distance_min: 5, distance_max: 26 });
            expect(result.map(r => r.id)).toEqual([1, 2, 3]);
        });

        it('handles exact boundary values', () => {
            const result = applyViewFilter(runs, { distance_min: 12.5, distance_max: 12.5 });
            expect(result.map(r => r.id)).toEqual([1]);
        });
    });

    describe('combined criteria', () => {
        it('ANDs route and date filters', () => {
            const result = applyViewFilter(runs, {
                route_ids: [10],
                date_start: '2025-08-01',
            });
            expect(result.map(r => r.id)).toEqual([3]);
        });

        it('ANDs notes and distance filters', () => {
            const result = applyViewFilter(runs, {
                notes_search: 'ride',
                distance_min: 10,
            });
            expect(result.map(r => r.id)).toEqual([1]);
        });

        it('all criteria combined narrows to specific runs', () => {
            const result = applyViewFilter(runs, {
                route_ids: [10, 20],
                date_start: '2025-06-01',
                date_end: '2025-07-31',
                notes_search: 'day',
                distance_min: 10,
            });
            expect(result.map(r => r.id)).toEqual([1]);
        });

        it('returns empty when no runs match all criteria', () => {
            const result = applyViewFilter(runs, {
                route_ids: [10],
                distance_min: 100,
            });
            expect(result).toHaveLength(0);
        });
    });

    describe('partner filter', () => {
        const partnerMap = new Map([
            [1, [100, 101]],  // run 1 has partners 100, 101
            [2, [100]],       // run 2 has partner 100
            [3, [102]],       // run 3 has partner 102
            // runs 4, 5 have no partners
        ]);

        it('filters by single partner_id', () => {
            const result = applyViewFilter(runs, { partner_ids: [102] }, partnerMap);
            expect(result.map(r => r.id)).toEqual([3]);
        });

        it('filters by multiple partner_ids (OR logic)', () => {
            const result = applyViewFilter(runs, { partner_ids: [101, 102] }, partnerMap);
            expect(result.map(r => r.id)).toEqual([1, 3]);
        });

        it('excludes runs with no partners', () => {
            const result = applyViewFilter(runs, { partner_ids: [100] }, partnerMap);
            expect(result.find(r => r.id === 4)).toBeUndefined();
            expect(result.find(r => r.id === 5)).toBeUndefined();
        });

        it('does not filter when partner_ids is empty array', () => {
            const result = applyViewFilter(runs, { partner_ids: [] }, partnerMap);
            expect(result).toHaveLength(5);
        });

        it('does not filter when runPartnerMap is null', () => {
            const result = applyViewFilter(runs, { partner_ids: [100] }, null);
            expect(result).toHaveLength(5);
        });

        it('ANDs partner filter with other criteria', () => {
            const result = applyViewFilter(runs, {
                partner_ids: [100],
                distance_min: 20,
            }, partnerMap);
            expect(result.map(r => r.id)).toEqual([2]);
        });
    });

    it('handles empty runs array', () => {
        expect(applyViewFilter([], { route_ids: [10] })).toEqual([]);
    });
});
