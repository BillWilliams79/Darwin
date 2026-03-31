import { describe, it, expect } from 'vitest';
import {
    mapStravaSportType,
    computeDescentFromAltitudes,
    buildCoordinatesFromStreams,
    mapStravaActivityToRun,
} from '../stravaDataMapper';

describe('mapStravaSportType', () => {
    it('maps cycling types to Ride', () => {
        const cyclingTypes = [
            'Ride', 'MountainBikeRide', 'GravelRide', 'EBikeRide',
            'EMountainBikeRide', 'VirtualRide', 'Velomobile', 'Handcycle',
        ];
        for (const type of cyclingTypes) {
            const result = mapStravaSportType(type);
            expect(result.activityID).toBe(4);
            expect(result.activityName).toBe('Ride');
            expect(result.lineIconId).toBe(1522);
        }
    });

    it('maps hiking types to Hike', () => {
        for (const type of ['Hike', 'Walk']) {
            const result = mapStravaSportType(type);
            expect(result.activityID).toBe(5);
            expect(result.activityName).toBe('Hike');
            expect(result.lineIconId).toBe(1596);
        }
    });

    it('defaults unknown types to Ride', () => {
        for (const type of ['Run', 'Swim', 'Yoga', 'Kayaking']) {
            const result = mapStravaSportType(type);
            expect(result.activityID).toBe(4);
            expect(result.activityName).toBe('Ride');
        }
    });
});

describe('computeDescentFromAltitudes', () => {
    it('returns 0 for empty or single-point arrays', () => {
        expect(computeDescentFromAltitudes([])).toBe(0);
        expect(computeDescentFromAltitudes([100])).toBe(0);
        expect(computeDescentFromAltitudes(null)).toBe(0);
    });

    it('computes descent from altitude deltas', () => {
        // 100 → 150 (+50) → 120 (-30) → 80 (-40) → 90 (+10)
        const altitudes = [100, 150, 120, 80, 90];
        expect(computeDescentFromAltitudes(altitudes)).toBe(70); // 30 + 40
    });

    it('returns 0 when only ascending', () => {
        expect(computeDescentFromAltitudes([10, 20, 30, 40])).toBe(0);
    });
});

describe('buildCoordinatesFromStreams', () => {
    it('builds coordinates from parallel arrays', () => {
        const streams = {
            latlng: { data: [[37.7749, -122.4194], [37.7750, -122.4195]] },
            altitude: { data: [50, 55] },
            time: { data: [0, 10] },
        };
        const coords = buildCoordinatesFromStreams(streams);
        expect(coords).toHaveLength(2);
        expect(coords[0]).toEqual({
            latitude: 37.7749,
            longitude: -122.4194,
            altitude: 50,
            timeOffset: 0,
        });
        expect(coords[1]).toEqual({
            latitude: 37.7750,
            longitude: -122.4195,
            altitude: 55,
            timeOffset: 10,
        });
    });

    it('handles missing altitude and time streams', () => {
        const streams = {
            latlng: { data: [[37.7749, -122.4194]] },
        };
        const coords = buildCoordinatesFromStreams(streams);
        expect(coords).toHaveLength(1);
        expect(coords[0].altitude).toBeNull();
        expect(coords[0].timeOffset).toBeNull();
    });

    it('returns empty array when no latlng data', () => {
        expect(buildCoordinatesFromStreams({})).toEqual([]);
    });
});

describe('mapStravaActivityToRun', () => {
    const mockActivity = {
        id: 12345678,
        name: 'Morning Ride',
        sport_type: 'Ride',
        start_date: '2026-03-15T14:30:00Z',
        distance: 32186.9, // ~20 miles
        moving_time: 3600,
        elapsed_time: 4200,
        total_elevation_gain: 150,
        max_speed: 12.5,
        calories: 450,
        description: 'Nice ride along the bay trail',
    };

    const mockStreams = {
        latlng: { data: [[37.77, -122.41], [37.78, -122.42], [37.79, -122.43]] },
        altitude: { data: [50, 100, 60] },
        time: { data: [0, 1800, 3600] },
    };

    it('maps all fields correctly', () => {
        const run = mapStravaActivityToRun(mockActivity, mockStreams);

        expect(run.runID).toBe(12345678);
        expect(run.routeID).toBe(12345678);
        expect(run.activityID).toBe(4);
        expect(run.activityName).toBe('Ride');
        expect(run.name).toBe('Morning Ride');
        expect(run.startTime).toBe('2026-03-15T14:30:00Z');
        expect(run.distance).toBe(32186.9);
        expect(run.runTime).toBe(3600);
        expect(run.stoppedTime).toBe(600); // 4200 - 3600
        expect(run.ascent).toBe(150);
        expect(run.descent).toBe(40); // 100→60 = 40 descent
        expect(run.maxSpeed).toBe(12.5);
        expect(run.calories).toBe(450);
        expect(run.notes).toBe('Nice ride along the bay trail');
        expect(run.lineIconId).toBe(1522);
        expect(run.lineColorId).toBe('1167b1');
    });

    it('builds coordinates from streams', () => {
        const run = mapStravaActivityToRun(mockActivity, mockStreams);
        expect(run.coordinates).toHaveLength(3);
        expect(run.extractedPoints).toBe(3);
        expect(run.currentPoints).toBe(3);
    });

    it('handles missing description as empty notes', () => {
        const activityNoDesc = { ...mockActivity, description: null };
        const run = mapStravaActivityToRun(activityNoDesc, mockStreams);
        expect(run.notes).toBe('');
    });

    it('handles hiking sport type', () => {
        const hikeActivity = { ...mockActivity, sport_type: 'Hike' };
        const run = mapStravaActivityToRun(hikeActivity, mockStreams);
        expect(run.activityID).toBe(5);
        expect(run.activityName).toBe('Hike');
        expect(run.lineIconId).toBe(1596);
    });

    it('computes stoppedTime as 0 when moving_time equals elapsed_time', () => {
        const noStopActivity = { ...mockActivity, elapsed_time: 3600 };
        const run = mapStravaActivityToRun(noStopActivity, mockStreams);
        expect(run.stoppedTime).toBe(0);
    });
});
