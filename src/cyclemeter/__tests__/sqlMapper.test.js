import { describe, it, expect } from 'vitest';
import { mapRunToSql, filterNewRunsByCutoff, normalizeRouteName, extractUniqueRoutes } from '../sqlMapper';

describe('mapRunToSql', () => {
    const sampleRun = {
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

    it('defaults source to cyclemeter when not specified', () => {
        const result = mapRunToSql(sampleRun, null);
        expect(result.source).toBe('cyclemeter');
    });

    it('uses explicit source parameter when provided', () => {
        const result = mapRunToSql(sampleRun, null, 'strava');
        expect(result.source).toBe('strava');
    });
});

describe('normalizeRouteName', () => {
    it('strips " - Cyclemeter" suffix', () => {
        expect(normalizeRouteName('Morning Ride - Cyclemeter')).toBe('Morning Ride');
    });

    it('leaves names without suffix unchanged', () => {
        expect(normalizeRouteName('Morning Ride')).toBe('Morning Ride');
    });

    it('returns empty string for null input', () => {
        expect(normalizeRouteName(null)).toBe('');
    });

    it('returns empty string for undefined input', () => {
        expect(normalizeRouteName(undefined)).toBe('');
    });

    it('returns empty string for empty string input', () => {
        expect(normalizeRouteName('')).toBe('');
    });

    it('does not strip partial matches', () => {
        expect(normalizeRouteName('Foo-Cyclemeter')).toBe('Foo-Cyclemeter');
    });

    it('does not strip suffix in the middle of the name', () => {
        expect(normalizeRouteName('Ride - Cyclemeter Trail')).toBe('Ride - Cyclemeter Trail');
    });

    it('trims whitespace after stripping suffix', () => {
        expect(normalizeRouteName('  Morning Ride - Cyclemeter')).toBe('Morning Ride');
    });
});

describe('extractUniqueRoutes', () => {
    it('returns unique routes by routeID', () => {
        const runs = [
            { routeID: 1, name: 'Route A' },
            { routeID: 2, name: 'Route B' },
        ];
        const result = extractUniqueRoutes(runs);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ route_id: 1, name: 'Route A' });
        expect(result[1]).toEqual({ route_id: 2, name: 'Route B' });
    });

    it('deduplicates runs with the same routeID', () => {
        const runs = [
            { routeID: 1, name: 'Route A' },
            { routeID: 1, name: 'Route A' },
            { routeID: 1, name: 'Route A' },
        ];
        const result = extractUniqueRoutes(runs);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ route_id: 1, name: 'Route A' });
    });

    it('preserves first route name when duplicates have different names', () => {
        const runs = [
            { routeID: 1, name: 'First Name' },
            { routeID: 1, name: 'Second Name' },
        ];
        const result = extractUniqueRoutes(runs);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('First Name');
    });

    it('handles empty runs array', () => {
        expect(extractUniqueRoutes([])).toHaveLength(0);
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
