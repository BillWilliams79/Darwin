import { describe, it, expect } from 'vitest';
import { precisionOptimizer, formatRunData, distanceOptimizer } from '../transform';

function makeRun(overrides = {}) {
    return {
        runID: 1,
        routeID: 56,
        activityID: 4,
        name: 'Test Route',
        startTime: '2024-08-15T00:30:00',  // UTC, August → PDT (UTC-7)
        runTime: 3600,          // 1 hour in seconds
        stoppedTime: 600,       // 10 minutes
        distance: 16090,        // meters (~10 miles)
        ascent: 100,            // meters
        descent: 80,            // meters
        calories: 450.7,
        maxSpeed: 8.94,         // m/s (~20 mph)
        notes: 'Test ride',
        coordinates: [],
        extractedPoints: 0,
        currentPoints: 0,
        strippedPoints: 0,
        activityName: 'Ride',
        lineIconId: 1522,
        lineColorId: '1167b1',
        ...overrides,
    };
}

describe('precisionOptimizer', () => {
    it('truncates coordinates to specified precision', () => {
        const runs = [makeRun({
            coordinates: [
                { latitude: 37.7749295, longitude: -122.4194155 },
                { latitude: 33.9008734, longitude: -118.4194321 },
            ],
        })];

        precisionOptimizer(runs, 5);

        expect(runs[0].coordinates[0].latitude).toBe(37.77493);
        expect(runs[0].coordinates[0].longitude).toBe(-122.41942);
        expect(runs[0].coordinates[1].latitude).toBe(33.90087);
    });

    it('skips when precision is 0', () => {
        const runs = [makeRun({
            coordinates: [{ latitude: 37.7749295, longitude: -122.4194155 }],
        })];

        precisionOptimizer(runs, 0);

        expect(runs[0].coordinates[0].latitude).toBe(37.7749295);
    });
});

describe('formatRunData', () => {
    it('calculates average speed in mph', () => {
        const runs = [makeRun()];
        formatRunData(runs);
        // 16090m / 3600s * 2.237 = ~9.99 mph
        expect(runs[0].averageSpeed).toBeCloseTo(10.0, 0);
    });

    it('caps stopped time at 86399', () => {
        const runs = [makeRun({ stoppedTime: 100000 })];
        formatRunData(runs);
        expect(runs[0].stoppedTime).toBe('23:59:59');
    });

    it('formats run time as HH:MM:SS', () => {
        const runs = [makeRun({ runTime: 3661 })];  // 1h 1m 1s
        formatRunData(runs);
        expect(runs[0].runTime).toBe('01:01:01');
    });

    it('applies PST timezone for winter months', () => {
        // January → UTC-8
        const runs = [makeRun({ startTime: '2024-01-15T20:00:00' })];
        formatRunData(runs);
        // 20:00 UTC - 8h = 12:00 PM
        expect(runs[0].descFormattedStart).toBe('12:00 PM');
    });

    it('applies PDT timezone for summer months', () => {
        // August → UTC-7
        const runs = [makeRun({ startTime: '2024-08-15T20:00:00' })];
        formatRunData(runs);
        // 20:00 UTC - 7h = 1:00 PM
        expect(runs[0].descFormattedStart).toBe('01:00 PM');
    });

    it('formats title date as DAY :: DD MMM YYYY', () => {
        // August 15, 2024 at 20:00 UTC - 7h = Aug 15, 2024 at 1PM → Thursday
        const runs = [makeRun({ startTime: '2024-08-15T20:00:00' })];
        formatRunData(runs);
        expect(runs[0].titleFormattedStart).toBe('THU :: 15 Aug 2024');
    });

    it('converts distance from meters to miles', () => {
        const runs = [makeRun({ distance: 16090 })];
        formatRunData(runs);
        expect(runs[0].distance).toBe(10);  // 16090 / 1609 = ~10.0
    });

    it('converts ascent/descent from meters to feet', () => {
        const runs = [makeRun({ ascent: 100, descent: 80 })];
        formatRunData(runs);
        expect(runs[0].ascent).toBe(328);   // 100 * 3.281 = 328.1 → 328
        expect(runs[0].descent).toBe(262);  // 80 * 3.281 = 262.48 → 262
    });

    it('converts maxSpeed from m/s to mph', () => {
        const runs = [makeRun({ maxSpeed: 8.94 })];
        formatRunData(runs);
        expect(runs[0].maxSpeed).toBe(20);  // 8.94 * 2.237 = ~20.0
    });

    it('floors calories', () => {
        const runs = [makeRun({ calories: 450.7 })];
        formatRunData(runs);
        expect(runs[0].calories).toBe(450);
    });
});

describe('distanceOptimizer', () => {
    it('strips points closer than minDelta', () => {
        const runs = [makeRun({
            coordinates: [
                { latitude: 33.90087, longitude: -118.41943 },
                { latitude: 33.90087, longitude: -118.41942 },  // ~1m away → strip
                { latitude: 33.90000, longitude: -118.41943 },  // ~97m away → keep
            ],
            extractedPoints: 3,
            currentPoints: 3,
            strippedPoints: 0,
        })];

        distanceOptimizer(runs, 10);

        expect(runs[0].coordinates.length).toBe(2);
        expect(runs[0].strippedPoints).toBe(1);
        expect(runs[0].currentPoints).toBe(2);
    });

    it('keeps all points when minDelta is 0', () => {
        const runs = [makeRun({
            coordinates: [
                { latitude: 33.90087, longitude: -118.41943 },
                { latitude: 33.90087, longitude: -118.41942 },
            ],
            extractedPoints: 2,
            currentPoints: 2,
            strippedPoints: 0,
        })];

        distanceOptimizer(runs, 0);

        expect(runs[0].coordinates.length).toBe(2);
    });

    it('handles empty coordinates', () => {
        const runs = [makeRun({
            coordinates: [],
            extractedPoints: 0,
            currentPoints: 0,
            strippedPoints: 0,
        })];

        distanceOptimizer(runs, 10);

        expect(runs[0].coordinates.length).toBe(0);
    });
});
