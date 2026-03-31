import { describe, it, expect } from 'vitest';
import { detectFormat } from '../formatDetector';

/**
 * Create a mock File from an ArrayBuffer.
 */
function makeFile(buffer, name = 'test.bin') {
    return new File([buffer], name);
}

/**
 * Create a File containing the SQLite magic header.
 */
function makeSqliteFile() {
    const encoder = new TextEncoder();
    const magic = encoder.encode('SQLite format 3\0');
    // Pad to 100 bytes (SQLite header is 100 bytes)
    const buffer = new Uint8Array(100);
    buffer.set(magic);
    return makeFile(buffer.buffer, 'Meter.db');
}

/**
 * Create a File containing GPX XML content.
 */
function makeGpxFile(content) {
    const xml = content || `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
 <trk><name>Test</name><type>cycling</type><trkseg>
  <trkpt lat="37.0" lon="-121.0"><ele>80</ele><time>2026-01-01T00:00:00Z</time></trkpt>
 </trkseg></trk>
</gpx>`;
    const encoder = new TextEncoder();
    return makeFile(encoder.encode(xml).buffer, 'activity.gpx');
}

/**
 * Create a File containing Cyclemeter KML content.
 */
function makeCyclemeterKmlFile() {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:abvio="http://cyclemeter.com/xmlschemas/1">
<Document><name>Test.kml</name></Document></kml>`;
    const encoder = new TextEncoder();
    return makeFile(encoder.encode(xml).buffer, 'Cycle-test.kml');
}

/**
 * Create a File containing generic (non-Cyclemeter) KML content.
 */
function makeGenericKmlFile() {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document><name>Test.kml</name></Document></kml>`;
    const encoder = new TextEncoder();
    return makeFile(encoder.encode(xml).buffer, 'route.kml');
}

/**
 * Create a File containing MTB Project GPX 1.0 content (no timestamps, no elevation).
 */
function makeMtbProjectGpxFile() {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<gpx version="1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.topografix.com/GPX/1/0" xsi:schemaLocation="http://www.topografix.com/GPX/1/0 http://www.topografix.com/GPX/1/0/gpx.xsd">
  <trk>
    <trkseg>
      <trkpt lat="45.64227068" lon="-123.35918806"/>
      <trkpt lat="45.64220159" lon="-123.35937671"/>
    </trkseg>
  </trk>
</gpx>`;
    const encoder = new TextEncoder();
    return makeFile(encoder.encode(xml).buffer, 'MTBProject.gpx');
}

/**
 * Create a File containing Cyclemeter GPX content.
 */
function makeCyclemeterGpxFile() {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Cyclemeter with barometer" xmlns:abvio="https://cyclemeter.com/xmlschemas/1"
 xmlns="http://www.topografix.com/GPX/1/1">
 <trk><name>Test</name><type>Cycle</type><trkseg>
  <trkpt lat="37.0" lon="-121.0"><ele>80</ele><time>2026-01-01T00:00:00Z</time></trkpt>
 </trkseg></trk></gpx>`;
    const encoder = new TextEncoder();
    return makeFile(encoder.encode(xml).buffer, 'Cycle-test.gpx');
}

describe('detectFormat', () => {
    it('detects SQLite file as cyclemeter', async () => {
        const file = makeSqliteFile();
        const info = await detectFormat(file);
        expect(info.format).toBe('cyclemeter');
        expect(info.label).toBe('Cyclemeter Database');
        expect(info.source).toBe('cyclemeter');
    });

    it('detects GPX XML file as strava-gpx', async () => {
        const file = makeGpxFile();
        const info = await detectFormat(file);
        expect(info.format).toBe('strava-gpx');
        expect(info.label).toBe('Strava GPX');
        expect(info.source).toBe('strava');
    });

    it('detects GPX with uppercase tag', async () => {
        const xml = `<?xml version="1.0"?>\n<GPX version="1.1"><trk></trk></GPX>`;
        const encoder = new TextEncoder();
        const file = makeFile(encoder.encode(xml).buffer, 'ride.gpx');
        const info = await detectFormat(file);
        expect(info.format).toBe('strava-gpx');
    });

    it('detects Cyclemeter KML as cyclemeter-kml', async () => {
        const file = makeCyclemeterKmlFile();
        const info = await detectFormat(file);
        expect(info.format).toBe('cyclemeter-kml');
        expect(info.label).toBe('Cyclemeter KML');
        expect(info.source).toBe('cyclemeter-kml');
    });

    it('detects Cyclemeter GPX as cyclemeter-gpx', async () => {
        const file = makeCyclemeterGpxFile();
        const info = await detectFormat(file);
        expect(info.format).toBe('cyclemeter-gpx');
        expect(info.label).toBe('Cyclemeter GPX');
        expect(info.source).toBe('cyclemeter-gpx');
    });

    it('detects MTB Project GPX 1.0 as mtbproject-gpx', async () => {
        const file = makeMtbProjectGpxFile();
        const info = await detectFormat(file);
        expect(info.format).toBe('mtbproject-gpx');
        expect(info.label).toBe('MTB Project GPX');
        expect(info.source).toBe('mtbproject');
    });

    it('detects GPX 1.1 (Strava) as strava-gpx, not mtbproject-gpx', async () => {
        const file = makeGpxFile(); // uses GPX 1.1 namespace
        const info = await detectFormat(file);
        expect(info.format).toBe('strava-gpx');
        expect(info.source).toBe('strava');
    });

    it('detects non-Cyclemeter GPX as strava-gpx (fallback)', async () => {
        const file = makeGpxFile();
        const info = await detectFormat(file);
        expect(info.format).toBe('strava-gpx');
        expect(info.source).toBe('strava');
    });

    it('throws for generic KML (non-Cyclemeter)', async () => {
        const file = makeGenericKmlFile();
        await expect(detectFormat(file)).rejects.toThrow('Unrecognized file format');
    });

    it('throws for random binary data', async () => {
        const buffer = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE]).buffer;
        const file = makeFile(buffer, 'random.bin');
        await expect(detectFormat(file)).rejects.toThrow('Unrecognized file format');
    });

    it('throws for empty file', async () => {
        const file = makeFile(new ArrayBuffer(0), 'empty');
        await expect(detectFormat(file)).rejects.toThrow('Unrecognized file format');
    });

    it('throws for JSON file', async () => {
        const encoder = new TextEncoder();
        const file = makeFile(encoder.encode('{"key": "value"}').buffer, 'data.json');
        await expect(detectFormat(file)).rejects.toThrow('Unrecognized file format');
    });

    it('throws for HTML file', async () => {
        const encoder = new TextEncoder();
        const file = makeFile(encoder.encode('<html><body>hello</body></html>').buffer, 'page.html');
        await expect(detectFormat(file)).rejects.toThrow('Unrecognized file format');
    });
});
