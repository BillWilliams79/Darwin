import { describe, it, expect } from 'vitest';
import { countPhotosForRun } from '../filterUtils.js';

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
