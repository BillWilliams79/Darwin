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
