import { describe, it, expect } from 'vitest';
import { mapRunToSql, filterNewRunsByCutoff } from '../sqlMapper';

describe('mapRunToSql', () => {
    it('includes source field set to cyclemeter', () => {
        const run = {
            runID: 1,
            routeID: 10,
            activityID: 4,
            activityName: 'Ride',
            startTime: '2025-06-01 10:00:00',
            runTime: 3600,
            stoppedTime: 0,
            distance: 16093.4, // ~10 miles in meters
            ascent: null,
            descent: null,
            calories: null,
            maxSpeed: null,
            notes: null,
        };
        const result = mapRunToSql(run, null);
        expect(result.source).toBe('cyclemeter');
    });
});

describe('filterNewRunsByCutoff', () => {
    const makeRun = (startTime) => ({ startTime, runID: Math.random() });

    const runs = [
        makeRun('2025-01-01 10:00:00'),
        makeRun('2025-03-15 08:00:00'),
        makeRun('2025-06-01 12:00:00'),
        makeRun('2025-09-01 06:00:00'),
    ];

    it('returns all runs when cutoffDate is null (first import)', () => {
        const { newRuns, skippedCount } = filterNewRunsByCutoff(runs, null);
        expect(newRuns).toHaveLength(4);
        expect(skippedCount).toBe(0);
    });

    it('returns all runs when cutoffDate is undefined (first import)', () => {
        const { newRuns, skippedCount } = filterNewRunsByCutoff(runs, undefined);
        expect(newRuns).toHaveLength(4);
        expect(skippedCount).toBe(0);
    });

    it('returns only runs after cutoff date', () => {
        const { newRuns, skippedCount } = filterNewRunsByCutoff(runs, '2025-03-15 08:00:00');
        expect(newRuns).toHaveLength(2);
        expect(skippedCount).toBe(2);
        expect(new Date(newRuns[0].startTime).getTime()).toBeGreaterThan(new Date('2025-03-15 08:00:00').getTime());
    });

    it('returns empty when all runs are at or before cutoff', () => {
        const { newRuns, skippedCount } = filterNewRunsByCutoff(runs, '2025-12-31 23:59:59');
        expect(newRuns).toHaveLength(0);
        expect(skippedCount).toBe(4);
    });

    it('returns all runs when cutoff is before earliest run', () => {
        const { newRuns, skippedCount } = filterNewRunsByCutoff(runs, '2024-01-01 00:00:00');
        expect(newRuns).toHaveLength(4);
        expect(skippedCount).toBe(0);
    });

    it('handles empty runs array', () => {
        const { newRuns, skippedCount } = filterNewRunsByCutoff([], '2025-06-01 12:00:00');
        expect(newRuns).toHaveLength(0);
        expect(skippedCount).toBe(0);
    });
});
