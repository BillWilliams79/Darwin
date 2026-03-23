// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { extractFromCyclemeterKml } from '../extractCyclemeterKml';

const DEFAULT_CONFIG = {
    mapTitle: 'Test',
    mapDescription: 'Test',
    outputFilename: 'test',
    minDelta: 10,
    precision: 5,
    queryFilter: {},
};

/**
 * Convert a KML XML string to an ArrayBuffer for the extractor.
 */
function kmlToBuffer(xml) {
    return new TextEncoder().encode(xml).buffer;
}

/**
 * Build a minimal valid Cyclemeter KML string with configurable metadata and coordinates.
 */
function buildKml({
    routeName = 'Test Route',
    activityName = 'Cycle',
    startTime = '2026-01-01 00:00:00.000',
    runTime = 3600,
    stoppedTime = 300,
    distance = 5000,
    ascent = 50,
    descent = 30,
    calories = 200,
    maxSpeed = 8.0,
    notes = '',
    runID = 100,
    routeID = 10,
    segments = null,
} = {}) {
    // Default: single segment with 2 coordinates
    const segs = segments || [
        ['-121.0,37.0,80.0', '-121.001,37.001,82.0'],
    ];

    const placemarks = segs.map((coords, i) => `
<Placemark><name>Segment ${String(i + 1).padStart(2, '0')}</name>
<LineString><coordinates>
${coords.join('\n')}
</coordinates></LineString>
</Placemark>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:abvio="http://cyclemeter.com/xmlschemas/1">
<Document>
<Folder><name>Path</name>${placemarks}
</Folder>
<ExtendedData>
<abvio:runID>${runID}</abvio:runID>
<abvio:routeID>${routeID}</abvio:routeID>
<abvio:routeName><![CDATA[${routeName}]]></abvio:routeName>
<abvio:activityName><![CDATA[${activityName}]]></abvio:activityName>
<abvio:startTime>${startTime}</abvio:startTime>
<abvio:runTime>${runTime}</abvio:runTime>
<abvio:stoppedTime>${stoppedTime}</abvio:stoppedTime>
<abvio:distance>${distance}</abvio:distance>
<abvio:ascent>${ascent}</abvio:ascent>
<abvio:descent>${descent}</abvio:descent>
<abvio:calories>${calories}</abvio:calories>
<abvio:maxSpeed>${maxSpeed}</abvio:maxSpeed>
<abvio:notes><![CDATA[${notes}]]></abvio:notes>
</ExtendedData>
</Document></kml>`;
}

describe('extractFromCyclemeterKml', () => {
    it('returns a single-element array', async () => {
        const kml = buildKml();
        const runs = await extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG);
        expect(runs).toHaveLength(1);
    });

    it('extracts correct Run shape with all required fields', async () => {
        const kml = buildKml({
            routeName: 'Los Alamitos Creek Trail',
            activityName: 'Cycle',
            startTime: '2026-03-21 22:04:24.332',
            runTime: 1732.508,
            stoppedTime: 2911.570,
            distance: 7428.5,
            ascent: 12.2,
            descent: 0.0,
            calories: 286.019,
            maxSpeed: 8.39,
            notes: 'Lia, Ella',
            runID: 2936,
            routeID: 31,
        });
        const [run] = await extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG);

        expect(run).toHaveProperty('runID', 2936);
        expect(run).toHaveProperty('routeID', 31);
        expect(run).toHaveProperty('activityID', 4);
        expect(run).toHaveProperty('name', 'Los Alamitos Creek Trail');
        expect(run).toHaveProperty('startTime', '2026-03-21 22:04:24.332');
        expect(run).toHaveProperty('runTime', 1732.508);
        expect(run).toHaveProperty('stoppedTime', 2911.570);
        expect(run).toHaveProperty('distance', 7428.5);
        expect(run).toHaveProperty('ascent', 12.2);
        expect(run).toHaveProperty('descent', 0.0);
        expect(run).toHaveProperty('calories', 286.019);
        expect(run).toHaveProperty('maxSpeed', 8.39);
        expect(run).toHaveProperty('notes', 'Lia, Ella');
        expect(run).toHaveProperty('coordinates');
        expect(run).toHaveProperty('extractedPoints', 2);
        expect(run).toHaveProperty('currentPoints', 2);
        expect(run).toHaveProperty('strippedPoints', 0);
        expect(run).toHaveProperty('trimmedPoints', 0);
        expect(run).toHaveProperty('activityName', 'Ride');
        expect(run).toHaveProperty('lineIconId', 1522);
        expect(run).toHaveProperty('lineColorId', '1167b1');
    });

    it('extracts LineString coordinates correctly (lon,lat,ele → lat,lon,alt)', async () => {
        const kml = buildKml({
            segments: [['-121.852,37.217,80.5', '-121.851,37.218,79.6']],
        });
        const [run] = await extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG);

        expect(run.coordinates).toHaveLength(2);
        expect(run.coordinates[0].latitude).toBe(37.217);
        expect(run.coordinates[0].longitude).toBe(-121.852);
        expect(run.coordinates[0].altitude).toBe(80.5);
        expect(run.coordinates[0].timestamp).toBeNull();
        expect(run.coordinates[1].latitude).toBe(37.218);
        expect(run.coordinates[1].longitude).toBe(-121.851);
        expect(run.coordinates[1].altitude).toBe(79.6);
    });

    it('handles multiple LineString segments', async () => {
        const kml = buildKml({
            segments: [
                ['-121.0,37.0,80.0', '-121.001,37.001,79.0'],
                ['-121.002,37.002,78.0', '-121.003,37.003,77.0', '-121.004,37.004,76.0'],
            ],
        });
        const [run] = await extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG);

        expect(run.coordinates).toHaveLength(5);
        expect(run.extractedPoints).toBe(5);
        expect(run.currentPoints).toBe(5);
    });

    it('maps Cycle activity to Ride', async () => {
        const kml = buildKml({ activityName: 'Cycle' });
        const [run] = await extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG);
        expect(run.activityID).toBe(4);
        expect(run.activityName).toBe('Ride');
        expect(run.lineIconId).toBe(1522);
    });

    it('maps Hike activity to Hike', async () => {
        const kml = buildKml({ activityName: 'Hike' });
        const [run] = await extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG);
        expect(run.activityID).toBe(5);
        expect(run.activityName).toBe('Hike');
        expect(run.lineIconId).toBe(1596);
    });

    it('maps Walk activity to Hike', async () => {
        const kml = buildKml({ activityName: 'Walk' });
        const [run] = await extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG);
        expect(run.activityName).toBe('Hike');
    });

    it('defaults unknown activity to Ride', async () => {
        const kml = buildKml({ activityName: 'Swimming' });
        const [run] = await extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG);
        expect(run.activityName).toBe('Ride');
    });

    it('preserves notes from CDATA', async () => {
        const kml = buildKml({ notes: 'Lia, Ella' });
        const [run] = await extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG);
        expect(run.notes).toBe('Lia, Ella');
    });

    it('handles zero descent', async () => {
        const kml = buildKml({ descent: 0.0 });
        const [run] = await extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG);
        expect(run.descent).toBe(0.0);
    });

    it('handles coordinates without altitude (lon,lat only)', async () => {
        const kml = buildKml({
            segments: [['-121.0,37.0', '-121.001,37.001']],
        });
        const [run] = await extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG);

        expect(run.coordinates).toHaveLength(2);
        expect(run.coordinates[0].altitude).toBeNull();
        expect(run.coordinates[1].altitude).toBeNull();
    });

    it('uses stats from abvio metadata, not computed from coordinates', async () => {
        // The coordinates are far apart but abvio distance says 100m
        const kml = buildKml({
            distance: 100,
            runTime: 60,
            segments: [['-121.0,37.0,80.0', '-122.0,38.0,80.0']],
        });
        const [run] = await extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG);
        expect(run.distance).toBe(100);
        expect(run.runTime).toBe(60);
    });

    it('throws for KML with no ExtendedData', async () => {
        const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:abvio="http://cyclemeter.com/xmlschemas/1">
<Document>
<Folder><name>Path</name>
<Placemark><LineString><coordinates>-121.0,37.0,80.0</coordinates></LineString></Placemark>
</Folder>
</Document></kml>`;
        await expect(extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG))
            .rejects.toThrow('no ExtendedData element found');
    });

    it('throws for KML with no coordinates', async () => {
        const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:abvio="http://cyclemeter.com/xmlschemas/1">
<Document>
<ExtendedData>
<abvio:runID>1</abvio:runID>
<abvio:routeID>1</abvio:routeID>
<abvio:routeName>Test</abvio:routeName>
<abvio:activityName>Cycle</abvio:activityName>
<abvio:startTime>2026-01-01 00:00:00.000</abvio:startTime>
<abvio:runTime>0</abvio:runTime>
<abvio:stoppedTime>0</abvio:stoppedTime>
<abvio:distance>0</abvio:distance>
<abvio:ascent>0</abvio:ascent>
<abvio:descent>0</abvio:descent>
<abvio:calories>0</abvio:calories>
<abvio:maxSpeed>0</abvio:maxSpeed>
<abvio:notes></abvio:notes>
</ExtendedData>
</Document></kml>`;
        await expect(extractFromCyclemeterKml(kmlToBuffer(kml), DEFAULT_CONFIG))
            .rejects.toThrow('no coordinates found');
    });

    it('throws for invalid XML', async () => {
        const badXml = 'this is not xml at all';
        await expect(extractFromCyclemeterKml(kmlToBuffer(badXml), DEFAULT_CONFIG))
            .rejects.toThrow();
    });
});
