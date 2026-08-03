import { describe, it, expect } from 'vitest';
import { countPhotosForRun, countPhotosForRuns } from '../filterUtils.js';

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
