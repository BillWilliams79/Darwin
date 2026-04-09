// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { extractFromMtbProjectGpx } from '../extractMtbProject';

const DEFAULT_CONFIG = {
    mapTitle: 'Test',
    mapDescription: 'Test',
    outputFilename: 'test',
    minDelta: 10,
    precision: 5,
    queryFilter: {},
};

function gpxToBuffer(xml) {
    return new TextEncoder().encode(xml).buffer;
}

/**
 * Build a minimal MTB Project GPX 1.0 string (no timestamps, no elevation).
 */
function buildMtbGpx(points, { name } = {}) {
    const trkpts = points.map(p => `      <trkpt lat="${p.lat}" lon="${p.lon}"/>`).join('\n');
    const nameTag = name ? `    <name>${name}</name>\n` : '';
    return `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.0" xmlns="http://www.topografix.com/GPX/1/0">
  <trk>
${nameTag}    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

describe('extractFromMtbProjectGpx', () => {
    it('returns a single-element array', async () => {
        const gpx = buildMtbGpx([
            { lat: 45.642, lon: -123.359 },
            { lat: 45.643, lon: -123.360 },
        ]);
        const runs = await extractFromMtbProjectGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(runs).toHaveLength(1);
    });

    it('extracts correct Run shape with all required fields', async () => {
        const gpx = buildMtbGpx([
            { lat: 45.642, lon: -123.359 },
            { lat: 45.643, lon: -123.360 },
        ], { name: 'Test Trail' });
        const [run] = await extractFromMtbProjectGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);

        expect(run).toHaveProperty('runID');
        expect(run).toHaveProperty('routeID');
        expect(run).toHaveProperty('activityID');
        expect(run).toHaveProperty('name', 'Test Trail');
        expect(run.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO date string (today)
        expect(run).toHaveProperty('runTime', 0);
        expect(run).toHaveProperty('stoppedTime', 0);
        expect(run).toHaveProperty('distance');
        expect(run).toHaveProperty('ascent', 0);
        expect(run).toHaveProperty('descent', 0);
        expect(run).toHaveProperty('calories', 0);
        expect(run).toHaveProperty('maxSpeed', 0);
        expect(run).toHaveProperty('notes', '');
        expect(run).toHaveProperty('coordinates');
        expect(run).toHaveProperty('extractedPoints', 2);
        expect(run).toHaveProperty('currentPoints', 2);
        expect(run).toHaveProperty('strippedPoints', 0);
        expect(run).toHaveProperty('activityName', 'Ride');
        expect(run).toHaveProperty('lineIconId', 1522);
        expect(run).toHaveProperty('lineColorId', '1167b1');
    });

    it('extracts coordinates with null altitude and timestamp', async () => {
        const gpx = buildMtbGpx([
            { lat: 45.64227068, lon: -123.35918806 },
            { lat: 45.64220159, lon: -123.35937671 },
        ]);
        const [run] = await extractFromMtbProjectGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);

        expect(run.coordinates).toHaveLength(2);
        expect(run.coordinates[0].latitude).toBe(45.64227068);
        expect(run.coordinates[0].longitude).toBe(-123.35918806);
        expect(run.coordinates[0].altitude).toBeNull();
        expect(run.coordinates[0].timestamp).toBeNull();
    });

    it('computes distance via haversine', async () => {
        // Two points ~111m apart per 0.001 degree latitude
        const gpx = buildMtbGpx([
            { lat: 37.0, lon: -121.0 },
            { lat: 37.001, lon: -121.0 },
            { lat: 37.002, lon: -121.0 },
        ]);
        const [run] = await extractFromMtbProjectGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(run.distance).toBeGreaterThan(200);
        expect(run.distance).toBeLessThan(250);
    });

    it('time-based stats are all 0', async () => {
        const gpx = buildMtbGpx([
            { lat: 45.642, lon: -123.359 },
            { lat: 45.643, lon: -123.360 },
        ]);
        const [run] = await extractFromMtbProjectGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(run.runTime).toBe(0);
        expect(run.stoppedTime).toBe(0);
        expect(run.maxSpeed).toBe(0);
    });

    it('uses track name from <name> element', async () => {
        const gpx = buildMtbGpx([{ lat: 45.642, lon: -123.359 }], { name: 'Gales Creek Trail' });
        const [run] = await extractFromMtbProjectGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(run.name).toBe('Gales Creek Trail');
    });

    it('defaults name to MTB Project Trail when <name> is absent', async () => {
        const gpx = buildMtbGpx([{ lat: 45.642, lon: -123.359 }]);
        const [run] = await extractFromMtbProjectGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(run.name).toBe('MTB Project Trail');
    });

    it('generates a deterministic synthetic ID from first coordinate', async () => {
        const gpx = buildMtbGpx([
            { lat: 45.64227068, lon: -123.35918806 },
            { lat: 45.64220159, lon: -123.35937671 },
        ]);
        const [run1] = await extractFromMtbProjectGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        const [run2] = await extractFromMtbProjectGpx(gpxToBuffer(gpx), DEFAULT_CONFIG);
        expect(run1.runID).toBe(run2.runID);
        expect(run1.routeID).toBe(run1.runID);
    });

    it('two different trail start points produce different synthetic IDs', async () => {
        const gpx1 = buildMtbGpx([{ lat: 45.642, lon: -123.359 }]);
        const gpx2 = buildMtbGpx([{ lat: 37.123, lon: -121.456 }]);
        const [run1] = await extractFromMtbProjectGpx(gpxToBuffer(gpx1), DEFAULT_CONFIG);
        const [run2] = await extractFromMtbProjectGpx(gpxToBuffer(gpx2), DEFAULT_CONFIG);
        expect(run1.runID).not.toBe(run2.runID);
    });

    it('throws for GPX with no trackpoints', async () => {
        const gpx = `<?xml version="1.0"?>
<gpx version="1.0" xmlns="http://www.topografix.com/GPX/1/0">
  <trk><trkseg></trkseg></trk>
</gpx>`;
        await expect(extractFromMtbProjectGpx(gpxToBuffer(gpx), DEFAULT_CONFIG))
            .rejects.toThrow('no trackpoints found');
    });

    it('throws for GPX with no trk element', async () => {
        const gpx = `<?xml version="1.0"?>
<gpx version="1.0" xmlns="http://www.topografix.com/GPX/1/0">
</gpx>`;
        await expect(extractFromMtbProjectGpx(gpxToBuffer(gpx), DEFAULT_CONFIG))
            .rejects.toThrow('no <trk> element found');
    });

    it('throws for invalid XML', async () => {
        await expect(extractFromMtbProjectGpx(gpxToBuffer('not xml'), DEFAULT_CONFIG))
            .rejects.toThrow();
    });
});
