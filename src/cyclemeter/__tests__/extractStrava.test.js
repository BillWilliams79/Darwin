// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { extractFromStravaGpx } from '../extractStrava';

const DEFAULT_CONFIG = {
    mapTitle: 'Test',
    mapDescription: 'Test',
    outputFilename: 'test',
    minDelta: 10,
    precision: 5,
    queryFilter: {},
};

/**
 * Convert a GPX XML string to an ArrayBuffer for the extractor.
 */
function gpxToBuffer(xml) {
    return new TextEncoder().encode(xml).buffer;
}

/**
 * Build a minimal valid GPX string with the given trackpoints.
 * Each point is { lat, lon, ele?, time? }.
 */
function buildGpx(points, { name = 'Test Ride', type = 'cycling' } = {}) {
    const trkpts = points.map(p => {
        let children = '';
        if (p.ele != null) children += `<ele>${p.ele}</ele>`;
        if (p.time) children += `<time>${p.time}</time>`;
        return `<trkpt lat="${p.lat}" lon="${p.lon}">${children}</trkpt>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
 <trk>
  <name>${name}</name>
  <type>${type}</type>
  <trkseg>
   ${trkpts}
  </trkseg>
 </trk>
</gpx>`;
}

describe('extractFromStravaGpx', () => {
    it('returns a single-element array', async () => {
        const gpx = buildGpx([
            { lat: 37.0, lon: -121.0, ele: 80, time: '2026-01-01T00:00:00Z' },
            { lat: 37.001, lon: -121.001, ele: 82, time: '2026-01-01T00:01:00Z' },
        ]);
        const runs = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(runs).toHaveLength(1);
    });

    it('extracts correct Run shape with all required fields', async () => {
        const gpx = buildGpx([
            { lat: 37.0, lon: -121.0, ele: 80, time: '2026-01-01T00:00:00Z' },
            { lat: 37.001, lon: -121.001, ele: 85, time: '2026-01-01T00:05:00Z' },
        ]);
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);

        expect(run).toHaveProperty('runID');
        expect(run).toHaveProperty('routeID');
        expect(run).toHaveProperty('activityID');
        expect(run).toHaveProperty('name', 'Test Ride');
        expect(run).toHaveProperty('startTime', '2026-01-01T00:00:00Z');
        expect(run).toHaveProperty('runTime');
        expect(run).toHaveProperty('stoppedTime');
        expect(run).toHaveProperty('distance');
        expect(run).toHaveProperty('ascent');
        expect(run).toHaveProperty('descent');
        expect(run).toHaveProperty('calories', 0);
        expect(run).toHaveProperty('maxSpeed');
        expect(run).toHaveProperty('notes', '');
        expect(run).toHaveProperty('coordinates');
        expect(run).toHaveProperty('extractedPoints', 2);
        expect(run).toHaveProperty('currentPoints', 2);
        expect(run).toHaveProperty('strippedPoints', 0);
        expect(run).toHaveProperty('activityName', 'Ride');
        expect(run).toHaveProperty('lineIconId', 1522);
        expect(run).toHaveProperty('lineColorId', '1167b1');
    });

    it('extracts coordinates correctly', async () => {
        const gpx = buildGpx([
            { lat: 37.217067, lon: -121.851982, ele: 80.0, time: '2026-01-01T00:00:00Z' },
            { lat: 37.217080, lon: -121.852318, ele: 79.8, time: '2026-01-01T00:00:01Z' },
        ]);
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);

        expect(run.coordinates).toHaveLength(2);
        expect(run.coordinates[0].latitude).toBe(37.217067);
        expect(run.coordinates[0].longitude).toBe(-121.851982);
        expect(run.coordinates[0].altitude).toBe(80.0);
        expect(run.coordinates[0].timestamp).toBe('2026-01-01T00:00:00Z');
    });

    it('computes runTime from first and last timestamps', async () => {
        const gpx = buildGpx([
            { lat: 37.0, lon: -121.0, ele: 80, time: '2026-01-01T00:00:00Z' },
            { lat: 37.01, lon: -121.01, ele: 80, time: '2026-01-01T01:00:00Z' },
        ]);
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(run.runTime).toBe(3600); // 1 hour
    });

    it('computes distance as haversine sum', async () => {
        // Two points ~157m apart (lat diff of ~0.001 degrees at ~37N)
        const gpx = buildGpx([
            { lat: 37.0, lon: -121.0, ele: 80, time: '2026-01-01T00:00:00Z' },
            { lat: 37.001, lon: -121.0, ele: 80, time: '2026-01-01T00:01:00Z' },
            { lat: 37.002, lon: -121.0, ele: 80, time: '2026-01-01T00:02:00Z' },
        ]);
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        // ~111m per 0.001 degree latitude × 2 segments ≈ 222m
        expect(run.distance).toBeGreaterThan(200);
        expect(run.distance).toBeLessThan(250);
    });

    it('computes ascent and descent from elevation changes', async () => {
        const gpx = buildGpx([
            { lat: 37.0, lon: -121.0, ele: 100, time: '2026-01-01T00:00:00Z' },
            { lat: 37.01, lon: -121.0, ele: 150, time: '2026-01-01T00:05:00Z' },
            { lat: 37.02, lon: -121.0, ele: 120, time: '2026-01-01T00:10:00Z' },
        ]);
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(run.ascent).toBe(50);   // 100 → 150 = +50
        expect(run.descent).toBe(30);  // 150 → 120 = -30
    });

    it('computes maxSpeed from consecutive points with sufficient time interval', async () => {
        // ~1000m apart in 10 seconds = ~100 m/s (interval >= 5s threshold)
        const gpx = buildGpx([
            { lat: 37.0, lon: -121.0, ele: 80, time: '2026-01-01T00:00:00Z' },
            { lat: 37.009, lon: -121.0, ele: 80, time: '2026-01-01T00:00:10Z' },
        ]);
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        // ~0.009 deg lat ≈ 1000m, /10s = ~100 m/s
        expect(run.maxSpeed).toBeGreaterThan(90);
        expect(run.maxSpeed).toBeLessThan(110);
    });

    it('filters GPS noise from maxSpeed by ignoring short time intervals', async () => {
        // 30m GPS drift in 1 second would be ~30 m/s (67 mph) — should be ignored
        // Real movement: ~111m in 10 seconds = ~11 m/s (25 mph) — should be captured
        const gpx = buildGpx([
            { lat: 37.0, lon: -121.0, ele: 80, time: '2026-01-01T00:00:00Z' },
            { lat: 37.0003, lon: -121.0, ele: 80, time: '2026-01-01T00:00:01Z' },   // GPS drift, 1s
            { lat: 37.001, lon: -121.0, ele: 80, time: '2026-01-01T00:00:06Z' },     // real move, 5s
            { lat: 37.002, lon: -121.0, ele: 80, time: '2026-01-01T00:00:16Z' },     // real move, 10s
        ]);
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        // maxSpeed should be based on the 5s or 10s segments, not the 1s GPS noise
        expect(run.maxSpeed).toBeLessThan(25); // well under the GPS-noise 30 m/s
        expect(run.maxSpeed).toBeGreaterThan(5); // but still captures real movement
    });

    it('detects stopped time from consecutive points at same location', async () => {
        // Points 2 and 3 are at the same location with 5 minutes gap
        const gpx = buildGpx([
            { lat: 37.0, lon: -121.0, ele: 80, time: '2026-01-01T00:00:00Z' },
            { lat: 37.001, lon: -121.0, ele: 80, time: '2026-01-01T00:01:00Z' },
            { lat: 37.001, lon: -121.0, ele: 80, time: '2026-01-01T00:06:00Z' },
            { lat: 37.002, lon: -121.0, ele: 80, time: '2026-01-01T00:07:00Z' },
        ]);
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        // 5 minutes (300s) stopped at same point
        expect(run.stoppedTime).toBe(300);
    });

    it('maps cycling type to Ride activity', async () => {
        const gpx = buildGpx(
            [{ lat: 37.0, lon: -121.0, ele: 80, time: '2026-01-01T00:00:00Z' }],
            { type: 'cycling' }
        );
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(run.activityID).toBe(4);
        expect(run.activityName).toBe('Ride');
        expect(run.lineIconId).toBe(1522);
    });

    it('maps hiking type to Hike activity', async () => {
        const gpx = buildGpx(
            [{ lat: 37.0, lon: -121.0, ele: 80, time: '2026-01-01T00:00:00Z' }],
            { type: 'hiking' }
        );
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(run.activityID).toBe(5);
        expect(run.activityName).toBe('Hike');
        expect(run.lineIconId).toBe(1596);
    });

    it('defaults unknown activity type to Ride', async () => {
        const gpx = buildGpx(
            [{ lat: 37.0, lon: -121.0, ele: 80, time: '2026-01-01T00:00:00Z' }],
            { type: 'swimming' }
        );
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(run.activityName).toBe('Ride');
    });

    it('handles missing elevation elements', async () => {
        const gpx = buildGpx([
            { lat: 37.0, lon: -121.0, time: '2026-01-01T00:00:00Z' },
            { lat: 37.001, lon: -121.0, time: '2026-01-01T00:01:00Z' },
        ]);
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(run.coordinates[0].altitude).toBeNull();
        expect(run.ascent).toBe(0);
        expect(run.descent).toBe(0);
    });

    it('generates deterministic synthetic IDs from startTime', async () => {
        const gpx = buildGpx([
            { lat: 37.0, lon: -121.0, ele: 80, time: '2026-01-01T00:00:00Z' },
        ]);
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        const expected = Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000);
        expect(run.runID).toBe(expected);
        expect(run.routeID).toBe(expected);
    });

    it('handles single trackpoint (no segments to compute stats from)', async () => {
        const gpx = buildGpx([
            { lat: 37.0, lon: -121.0, ele: 80, time: '2026-01-01T00:00:00Z' },
        ]);
        const [run] = await extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(run.distance).toBe(0);
        expect(run.runTime).toBe(0);
        expect(run.maxSpeed).toBe(0);
        expect(run.extractedPoints).toBe(1);
    });

    it('throws for GPX with no trackpoints', async () => {
        const gpx = `<?xml version="1.0"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
 <trk><name>Empty</name><type>cycling</type><trkseg></trkseg></trk>
</gpx>`;
        await expect(extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG))
            .rejects.toThrow('no trackpoints found');
    });

    it('throws for GPX with no trk element', async () => {
        const gpx = `<?xml version="1.0"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
 <metadata><time>2026-01-01T00:00:00Z</time></metadata>
</gpx>`;
        await expect(extractFromStravaGpx(gpxToBuffer(gpx), DEFAULT_CONFIG))
            .rejects.toThrow('no <trk> element found');
    });

    it('throws for invalid XML', async () => {
        const badXml = 'this is not xml at all';
        await expect(extractFromStravaGpx(gpxToBuffer(badXml), DEFAULT_CONFIG))
            .rejects.toThrow();
    });
});
