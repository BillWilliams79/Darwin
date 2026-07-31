import { describe, it, expect } from 'vitest';
import { countPhotosForRun, unionPhotosForRuns } from '../filterUtils.js';

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

describe('unionPhotosForRuns', () => {
    const runAt = (id, startIso, hours = 1) => ({
        id,
        start_time: startIso,
        run_time_sec: hours * 3600,
        stopped_time_sec: 0,
    });

    it('unions items across multiple run windows', () => {
        const runs = [
            runAt(1, '2026-03-21T17:00:00Z'), // window [17:00, 18:00]
            runAt(2, '2026-03-22T09:00:00Z'), // window [09:00, 10:00]
        ];
        const index = [
            item('2026-03-21T17:30:00Z'), // run 1
            item('2026-03-22T09:15:00Z'), // run 2
            item('2026-03-23T12:00:00Z'), // neither
        ];
        const union = unionPhotosForRuns(index, runs);
        expect(union.map(i => i.dateTaken)).toEqual([
            '2026-03-21T17:30:00Z',
            '2026-03-22T09:15:00Z',
        ]);
    });

    it('dedupes an item that falls in two overlapping windows', () => {
        const runs = [
            runAt(1, '2026-03-21T17:00:00Z'), // [17:00, 18:00]
            runAt(2, '2026-03-21T17:30:00Z'), // [17:30, 18:30] — overlaps
        ];
        const index = [item('2026-03-21T17:45:00Z')]; // inside both windows
        expect(unionPhotosForRuns(index, runs)).toHaveLength(1);
    });

    it('sorts the union by dateTaken ascending regardless of run order', () => {
        const runs = [
            runAt(2, '2026-03-22T09:00:00Z'), // later run listed first
            runAt(1, '2026-03-21T17:00:00Z'),
        ];
        const index = [
            item('2026-03-22T09:15:00Z'),
            item('2026-03-21T17:30:00Z'),
        ];
        expect(unionPhotosForRuns(index, runs).map(i => i.dateTaken)).toEqual([
            '2026-03-21T17:30:00Z',
            '2026-03-22T09:15:00Z',
        ]);
    });

    it('returns [] on missing index or empty run list', () => {
        expect(unionPhotosForRuns(null, [runAt(1, '2026-03-21T17:00:00Z')])).toEqual([]);
        expect(unionPhotosForRuns([item('2026-03-21T17:30:00Z')], [])).toEqual([]);
        expect(unionPhotosForRuns([item('2026-03-21T17:30:00Z')], null)).toEqual([]);
    });

    it('skips a run with no start_time instead of throwing', () => {
        const runs = [
            { id: 9, start_time: null, run_time_sec: 3600, stopped_time_sec: 0 },
            runAt(1, '2026-03-21T17:00:00Z'),
        ];
        const index = [item('2026-03-21T17:30:00Z')];
        expect(unionPhotosForRuns(index, runs)).toHaveLength(1);
    });
});
