// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest';

// vi.mock is hoisted before imports by vitest
vi.mock('fit-file-parser', () => ({
    default: vi.fn(),
}));

import FitParser from 'fit-file-parser';
import { extractFromWahooFit } from '../extractWahooFit';

const DEFAULT_CONFIG = {
    mapTitle: 'Test',
    mapDescription: 'Test',
    outputFilename: 'test',
    minDelta: 10,
    precision: 5,
    queryFilter: {},
};

const START_DATE = new Date('2026-03-15T10:00:00Z');
const START_ISO = '2026-03-15T10:00:00.000Z';

/**
 * Build a minimal FIT data object as returned by fit-file-parser in list mode.
 * Overrides are merged in at the top level.
 */
function buildFitData({
    sport = 'cycling',
    total_timer_time = 3600,
    total_elapsed_time = 3660,
    total_distance = 25000,
    total_ascent = 200,
    total_descent = 195,
    max_speed = 15.5,
    total_calories = 450,
    start_time = START_DATE,
    records = null,
    workouts = null,
} = {}) {
    return {
        sessions: [{
            sport,
            total_timer_time,
            total_elapsed_time,
            total_distance,
            total_ascent,
            total_descent,
            max_speed,
            total_calories,
            start_time,
        }],
        records: records ?? [
            {
                position_lat: 37.7749,
                position_long: -122.4194,
                altitude: 15.0,
                timestamp: new Date('2026-03-15T10:00:00Z'),
            },
            {
                position_lat: 37.7759,
                position_long: -122.4200,
                altitude: 18.0,
                timestamp: new Date('2026-03-15T10:01:00Z'),
            },
            {
                position_lat: 37.7769,
                position_long: -122.4210,
                altitude: 20.0,
                timestamp: new Date('2026-03-15T10:02:00Z'),
            },
        ],
        workouts: workouts ?? [],
        laps: [],
        file_ids: [],
    };
}

/** Set up FitParser mock to return given data from parseAsync */
function mockFitParser(fitData) {
    FitParser.mockImplementation(() => ({
        parseAsync: vi.fn().mockResolvedValue(fitData),
    }));
}

// Any ArrayBuffer — actual bytes don't matter since parser is mocked
const DUMMY_BUFFER = new ArrayBuffer(100);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('extractFromWahooFit', () => {
    it('returns a single-element array', async () => {
        mockFitParser(buildFitData());
        const runs = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(runs).toHaveLength(1);
    });

    it('extracts correct Run shape with all required fields', async () => {
        mockFitParser(buildFitData());
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);

        expect(run).toHaveProperty('runID');
        expect(run).toHaveProperty('routeID');
        expect(run).toHaveProperty('activityID');
        expect(run).toHaveProperty('activityName');
        expect(run).toHaveProperty('name');
        expect(run).toHaveProperty('startTime');
        expect(run).toHaveProperty('runTime');
        expect(run).toHaveProperty('stoppedTime');
        expect(run).toHaveProperty('distance');
        expect(run).toHaveProperty('ascent');
        expect(run).toHaveProperty('descent');
        expect(run).toHaveProperty('calories');
        expect(run).toHaveProperty('maxSpeed');
        expect(run).toHaveProperty('notes', '');
        expect(run).toHaveProperty('coordinates');
        expect(run).toHaveProperty('extractedPoints', 3);
        expect(run).toHaveProperty('currentPoints', 3);
        expect(run).toHaveProperty('strippedPoints', 0);
        expect(run).toHaveProperty('lineIconId');
        expect(run).toHaveProperty('lineColorId', '1167b1');
    });

    it('uses session stats (not GPS-computed) for distance, ascent, descent, maxSpeed', async () => {
        mockFitParser(buildFitData({
            total_distance: 25000,
            total_ascent: 200,
            total_descent: 195,
            max_speed: 15.5,
        }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);

        expect(run.distance).toBe(25000);
        expect(run.ascent).toBe(200);
        expect(run.descent).toBe(195);
        expect(run.maxSpeed).toBe(15.5);
    });

    it('sets runTime from total_timer_time (moving time)', async () => {
        mockFitParser(buildFitData({ total_timer_time: 3600, total_elapsed_time: 3660 }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.runTime).toBe(3600);
    });

    it('computes stoppedTime as elapsed minus timer (paused time)', async () => {
        mockFitParser(buildFitData({ total_timer_time: 3600, total_elapsed_time: 3900 }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.stoppedTime).toBe(300); // 3900 - 3600 = 300s paused
    });

    it('clamps stoppedTime to 0 when elapsed < timer (edge case)', async () => {
        mockFitParser(buildFitData({ total_timer_time: 3660, total_elapsed_time: 3600 }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.stoppedTime).toBe(0);
    });

    it('sets calories from session total_calories', async () => {
        mockFitParser(buildFitData({ total_calories: 850 }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.calories).toBe(850);
    });

    it('uses workout wkt_name when present', async () => {
        mockFitParser(buildFitData({
            workouts: [{ wkt_name: 'Morning Epic' }],
        }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.name).toBe('Morning Epic');
    });

    it('synthesizes name from start date when no workout name', async () => {
        mockFitParser(buildFitData({ workouts: [] }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.name).toMatch(/^Cycling — /);
        expect(run.name).toContain('2026');
    });

    it('maps cycling sport to Ride activity (ID 4, icon 1522)', async () => {
        mockFitParser(buildFitData({ sport: 'cycling' }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.activityID).toBe(4);
        expect(run.activityName).toBe('Ride');
        expect(run.lineIconId).toBe(1522);
    });

    it('maps hiking sport to Hike activity (ID 5, icon 1596)', async () => {
        mockFitParser(buildFitData({ sport: 'hiking' }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.activityID).toBe(5);
        expect(run.activityName).toBe('Hike');
        expect(run.lineIconId).toBe(1596);
    });

    it('maps walking sport to Hike activity', async () => {
        mockFitParser(buildFitData({ sport: 'walking' }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.activityID).toBe(5);
        expect(run.activityName).toBe('Hike');
    });

    it('defaults unknown sport to Ride', async () => {
        mockFitParser(buildFitData({ sport: 'swimming' }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.activityID).toBe(4);
        expect(run.activityName).toBe('Ride');
    });

    it('extracts coordinates with latitude, longitude, altitude, and ISO timestamp', async () => {
        mockFitParser(buildFitData());
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);

        expect(run.coordinates).toHaveLength(3);
        expect(run.coordinates[0].latitude).toBe(37.7749);
        expect(run.coordinates[0].longitude).toBe(-122.4194);
        expect(run.coordinates[0].altitude).toBe(15.0);
        expect(run.coordinates[0].timestamp).toBe('2026-03-15T10:00:00.000Z');
    });

    it('filters out records with null position', async () => {
        mockFitParser(buildFitData({
            records: [
                { position_lat: null, position_long: null, altitude: 10, timestamp: new Date('2026-03-15T10:00:00Z') },
                { position_lat: 37.7749, position_long: -122.4194, altitude: 15.0, timestamp: new Date('2026-03-15T10:01:00Z') },
                { position_lat: null, position_long: null, altitude: 12, timestamp: new Date('2026-03-15T10:02:00Z') },
                { position_lat: 37.7759, position_long: -122.4200, altitude: 18.0, timestamp: new Date('2026-03-15T10:03:00Z') },
            ],
        }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.coordinates).toHaveLength(2);
        expect(run.extractedPoints).toBe(2);
    });

    it('generates deterministic synthetic IDs from start_time', async () => {
        mockFitParser(buildFitData({ start_time: START_DATE }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        const expected = Math.floor(START_DATE.getTime() / 1000);
        expect(run.runID).toBe(expected);
        expect(run.routeID).toBe(expected);
    });

    it('sets startTime as ISO string from session start_time', async () => {
        mockFitParser(buildFitData({ start_time: START_DATE }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.startTime).toBe(START_ISO);
    });

    it('throws "no session data found" when sessions array is empty', async () => {
        const fitData = buildFitData();
        fitData.sessions = [];
        mockFitParser(fitData);
        await expect(extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG))
            .rejects.toThrow('no session data found');
    });

    it('throws "no session data found" when sessions is undefined', async () => {
        const fitData = buildFitData();
        delete fitData.sessions;
        mockFitParser(fitData);
        await expect(extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG))
            .rejects.toThrow('no session data found');
    });

    it('throws "no GPS trackpoints found" when all records lack position', async () => {
        mockFitParser(buildFitData({
            records: [
                { position_lat: null, position_long: null, altitude: 10, timestamp: new Date() },
                { position_lat: null, position_long: null, altitude: 12, timestamp: new Date() },
            ],
        }));
        await expect(extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG))
            .rejects.toThrow('no GPS trackpoints found');
    });

    it('throws "no GPS trackpoints found" when records array is empty', async () => {
        mockFitParser(buildFitData({ records: [] }));
        await expect(extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG))
            .rejects.toThrow('no GPS trackpoints found');
    });

    it('handles altitude null in records gracefully', async () => {
        mockFitParser(buildFitData({
            records: [
                { position_lat: 37.7749, position_long: -122.4194, altitude: null, timestamp: new Date('2026-03-15T10:00:00Z') },
                { position_lat: 37.7759, position_long: -122.4200, altitude: undefined, timestamp: new Date('2026-03-15T10:01:00Z') },
            ],
        }));
        const [run] = await extractFromWahooFit(DUMMY_BUFFER, DEFAULT_CONFIG);
        expect(run.coordinates[0].altitude).toBeNull();
        expect(run.coordinates[1].altitude).toBeNull();
    });
});
