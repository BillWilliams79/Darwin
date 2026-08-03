import { describe, it, expect } from 'vitest';
import { countPhotosForRun, countPhotosForRuns, collectPhotosForRuns, computeRideTimeRange, filterByTimeRange } from '../filterUtils.js';

// A run starting 2026-03-21T17:00:00Z, lasting 1h moving + 0 stopped → window [17:00, 18:00] UTC.
const run = {
    id: 1,
    start_time: '2026-03-21T17:00:00Z',
    run_time_sec: 3600,
    stopped_time_sec: 0,
};

const item = (dateTaken) => ({ name: `${dateTaken}.jpg`, path: `/x/${dateTaken}.jpg`, dateTaken });

describe('countPhotosForRun', () => {
    it('counts only items whose dateTaken falls within the run window', () => {
        const index = [
            item('2026-03-21T16:30:00Z'), // before — excluded
            item('2026-03-21T17:00:00Z'), // exact start — included
            item('2026-03-21T17:30:00Z'), // mid — included
            item('2026-03-21T18:00:00Z'), // exact end — included
            item('2026-03-21T18:30:00Z'), // after — excluded
        ];
        expect(countPhotosForRun(index, run)).toBe(3);
    });

    it('excludes items without a dateTaken', () => {
        const index = [
            item('2026-03-21T17:30:00Z'),
            { name: 'no-date.jpg', path: '/x/no-date.jpg' },
        ];
        expect(countPhotosForRun(index, run)).toBe(1);
    });

    it('returns 0 when no items fall in range', () => {
        expect(countPhotosForRun([item('2020-01-01T00:00:00Z')], run)).toBe(0);
    });

    it('returns 0 for null/empty index or missing run', () => {
        expect(countPhotosForRun(null, run)).toBe(0);
        expect(countPhotosForRun([], run)).toBe(0);
        expect(countPhotosForRun([item('2026-03-21T17:30:00Z')], null)).toBe(0);
    });
});

// req #3158 — the batched counterpart the /maps aggregator card uses. Its
// contract is exact agreement with a countPhotosForRun sum, at
// O(P log P + R log P) instead of O(R × P).
describe('countPhotosForRuns', () => {
    const run2 = {
        id: 2,
        start_time: '2026-03-22T09:00:00Z',
        run_time_sec: 1800,
        stopped_time_sec: 600,
    };

    const index = [
        item('2026-03-21T16:30:00Z'), // before run 1
        item('2026-03-21T17:00:00Z'), // run 1 exact start
        item('2026-03-21T17:30:00Z'), // run 1 mid
        item('2026-03-21T18:00:00Z'), // run 1 exact end
        item('2026-03-22T09:20:00Z'), // run 2 mid
        item('2026-03-22T09:40:00Z'), // run 2 (inside 30min moving + 10min stopped window)
        item('2026-03-22T10:00:00Z'), // after run 2
        { name: 'no-date.jpg', path: '/x/no-date.jpg' }, // never counted
    ];

    it('agrees exactly with a countPhotosForRun sum, boundaries included', () => {
        const runs = [run, run2];
        const expected = runs.reduce((sum, r) => sum + countPhotosForRun(index, r), 0);
        expect(countPhotosForRuns(index, runs)).toBe(expected);
        expect(countPhotosForRuns(index, runs)).toBe(5);
    });

    it('accepts an unsorted index (sorts internally)', () => {
        const shuffled = [index[4], index[0], index[7], index[2], index[6], index[1], index[3], index[5]];
        expect(countPhotosForRuns(shuffled, [run, run2])).toBe(5);
    });

    it('skips runs with a malformed start_time instead of throwing', () => {
        expect(countPhotosForRuns(index, [run, { id: 3, start_time: null }, { id: 4 }, null])).toBe(3);
    });

    it('matches countPhotosForRun on unparsable dateTaken values (counted toward every window)', () => {
        const withBad = [...index, item('not-a-date')];
        const runs = [run, run2];
        const expected = runs.reduce((sum, r) => sum + countPhotosForRun(withBad, r), 0);
        expect(countPhotosForRuns(withBad, runs)).toBe(expected);
        expect(countPhotosForRuns(withBad, runs)).toBe(7);
    });

    it('returns 0 for empty/null inputs', () => {
        expect(countPhotosForRuns(null, [run])).toBe(0);
        expect(countPhotosForRuns([], [run])).toBe(0);
        expect(countPhotosForRuns(index, [])).toBe(0);
        expect(countPhotosForRuns(index, null)).toBe(0);
    });
});

// req #3159 — the union counterpart the aggregator map's photo layer uses.
// Contract: the items themselves, each at most once across overlapping
// windows, in index order; a single run reproduces the per-ride map path
// (filterByTimeRange over computeRideTimeRange) exactly.
describe('collectPhotosForRuns', () => {
    const run2 = {
        id: 2,
        start_time: '2026-03-22T09:00:00Z',
        run_time_sec: 1800,
        stopped_time_sec: 600,
    };

    const index = [
        item('2026-03-21T16:30:00Z'), // before run 1
        item('2026-03-21T17:00:00Z'), // run 1 exact start
        item('2026-03-21T17:30:00Z'), // run 1 mid
        item('2026-03-21T18:00:00Z'), // run 1 exact end
        item('2026-03-22T09:20:00Z'), // run 2 mid
        item('2026-03-22T09:40:00Z'), // run 2
        item('2026-03-22T10:00:00Z'), // after run 2
        { name: 'no-date.jpg', path: '/x/no-date.jpg' }, // never collected
    ];

    it('returns the union across runs in index order, boundaries included', () => {
        expect(collectPhotosForRuns(index, [run, run2]))
            .toEqual([index[1], index[2], index[3], index[4], index[5]]);
    });

    it('returns each item once when run windows overlap', () => {
        const overlapping = { ...run, id: 9, start_time: '2026-03-21T17:15:00Z' };
        const result = collectPhotosForRuns(index, [run, overlapping]);
        expect(result.filter(i => i === index[2])).toHaveLength(1);
        expect(result).toEqual([index[1], index[2], index[3]]);
    });

    it('single run agrees exactly with the per-ride filterByTimeRange path', () => {
        const range = computeRideTimeRange(run);
        const perRide = filterByTimeRange(index, range.filterStart, range.filterEnd);
        expect(collectPhotosForRuns(index, [run])).toEqual(perRide);
    });

    it('includes unparsable dateTaken items once (they match every window)', () => {
        const bad = item('not-a-date');
        const result = collectPhotosForRuns([...index, bad], [run, run2]);
        expect(result.filter(i => i === bad)).toHaveLength(1);
        expect(result).toHaveLength(6);
    });

    it('excludes unparsable items when no run yields a window', () => {
        expect(collectPhotosForRuns([item('not-a-date')], [{ id: 3, start_time: null }])).toEqual([]);
    });

    it('skips runs with a malformed start_time instead of throwing', () => {
        expect(collectPhotosForRuns(index, [run, { id: 3, start_time: null }, { id: 4 }, null]))
            .toEqual([index[1], index[2], index[3]]);
    });

    it('skips runs whose start_time string is unparsable (no NaN window)', () => {
        const garbage = { id: 5, start_time: 'not a date', run_time_sec: 3600 };
        expect(collectPhotosForRuns(index, [garbage])).toEqual([]);
        // ...including for unparsable-dateTaken items: no window, no match
        expect(collectPhotosForRuns([item('not-a-date')], [garbage])).toEqual([]);
    });

    it('skips runs whose duration makes the window end NaN', () => {
        const badDuration = { id: 6, start_time: '2026-03-21T17:00:00Z', run_time_sec: 'abc' };
        expect(collectPhotosForRuns(index, [badDuration])).toEqual([]);
        expect(collectPhotosForRuns([item('not-a-date')], [badDuration])).toEqual([]);
    });

    it('returns [] for empty/null inputs', () => {
        expect(collectPhotosForRuns(null, [run])).toEqual([]);
        expect(collectPhotosForRuns([], [run])).toEqual([]);
        expect(collectPhotosForRuns(index, [])).toEqual([]);
        expect(collectPhotosForRuns(index, null)).toEqual([]);
    });
});
