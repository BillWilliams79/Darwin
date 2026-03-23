import { describe, it, expect } from 'vitest';
import { generateKml } from '../load/kml';

function makeTransformedRun(overrides = {}) {
    return {
        runID: 1,
        routeID: 56,
        activityID: 4,
        name: 'Test Route',
        startTime: new Date('2011-08-18T17:13:00Z'),
        titleFormattedStart: 'THU :: 18 Aug 2011',
        descFormattedStart: '05:13 PM',
        runTime: '00:38:38',
        stoppedTime: '00:17:07',
        distance: 7.9,
        ascent: 46,
        descent: 30,
        calories: 250,
        maxSpeed: 41.5,
        averageSpeed: 12.31,
        notes: '',
        coordinates: [
            { latitude: 33.90087, longitude: -118.41943 },
            { latitude: 33.9008, longitude: -118.41933 },
            { latitude: 33.90076, longitude: -118.41905 },
        ],
        extractedPoints: 3,
        currentPoints: 3,
        strippedPoints: 0,
        activityName: 'Ride',
        lineIconId: 1522,
        lineColorId: '1167b1',
        ...overrides,
    };
}

const config = {
    mapTitle: 'Bill and Tim Cycle the SF Bay Trail',
    mapDescription: 'Scout and ride the complete SF Bay Trail Network.',
    outputFilename: 'test',
    minDelta: 10,
    precision: 5,
    queryFilter: { routeIDs: [56] },
};

describe('generateKml', () => {
    it('produces valid KML header', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
        expect(kml).toContain('<Document>');
    });

    it('includes map title and description', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).toContain('<name>Bill and Tim Cycle the SF Bay Trail</name>');
        expect(kml).toContain('Scout and ride the complete SF Bay Trail Network.');
    });

    it('includes ride icon, hike icon, and line style blocks', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).toContain('<Style id="icon-1522-1167B1">');
        expect(kml).toContain('<Style id="icon-1596-1167B1">');
        expect(kml).toContain('<Style id="line-1167B1">');
    });

    it('includes line color in KML AABBGGRR format', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).toContain('<color>ffb16711</color>');
    });

    it('creates folder with minDelta spacing', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).toContain('<name>Activities: 10m spacing</name>');
    });

    it('creates icon placemark with correct name', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).toContain('<name>Ride 1 :: THU :: 18 Aug 2011</name>');
    });

    it('creates route placemark', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).toContain('<name>Route</name>');
        expect(kml).toContain('<LineString><coordinates>');
    });

    it('formats point coordinates as lon,lat', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).toContain('-118.41943,33.90087');
    });

    it('formats route coordinates as lon,lat (no altitude)', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).toContain('-118.41943,33.90087');
        expect(kml).toContain('-118.41933,33.9008');
        expect(kml).not.toContain(',10');
    });

    it('includes CDATA description with stats', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).toContain('Start Time : 05:13 PM');
        expect(kml).toContain('Distance : 7.9 miles');
        expect(kml).toContain('Average Speed : 12.31 mph');
        expect(kml).toContain('Max Speed : 41.5 mph');
        expect(kml).toContain('Ascent : 46 feet');
        expect(kml).toContain('Ride Time : 00:38:38');
        expect(kml).toContain('Stop Time : 00:17:07');
    });

    it('outputs minified KML without indentation whitespace', () => {
        const kml = generateKml([makeTransformedRun()], config);
        // No lines should start with spaces (except the XML declaration and kml tag)
        const lines = kml.split('\n');
        const indentedLines = lines.filter(l => l.startsWith('  '));
        expect(indentedLines).toHaveLength(0);
    });

    it('handles hike activity with icon 1596', () => {
        const run = makeTransformedRun({ activityName: 'Hike', lineIconId: 1596 });
        const kml = generateKml([run], config);
        expect(kml).toContain('<name>Hike 1 :: THU :: 18 Aug 2011</name>');
        expect(kml).toContain('#icon-1596-1167B1');
    });

    it('handles multiple runs with sequential numbering', () => {
        const runs = [
            makeTransformedRun({ titleFormattedStart: 'THU :: 18 Aug 2011' }),
            makeTransformedRun({ titleFormattedStart: 'FRI :: 19 Aug 2011' }),
        ];
        const kml = generateKml(runs, config);
        expect(kml).toContain('Ride 1 :: THU :: 18 Aug 2011');
        expect(kml).toContain('Ride 2 :: FRI :: 19 Aug 2011');
    });

    it('closes document correctly', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).toContain('</Folder>');
        expect(kml).toContain('</Document>');
        expect(kml).toContain('</kml>');
    });

    it('omits StyleMap blocks (not rendered by Maps)', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).not.toContain('<StyleMap');
        expect(kml).not.toContain('<Pair>');
    });

    it('omits LabelStyle (not rendered by Maps)', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).not.toContain('<LabelStyle');
    });

    it('omits tessellate (not rendered by Maps)', () => {
        const kml = generateKml([makeTransformedRun()], config);
        expect(kml).not.toContain('<tessellate');
    });

    it('omits icon color tint (not rendered by Maps)', () => {
        const kml = generateKml([makeTransformedRun()], config);
        // Color should appear in LineStyle but NOT in IconStyle
        const iconStyleMatch = kml.match(/<IconStyle>[\s\S]*?<\/IconStyle>/g);
        iconStyleMatch.forEach(block => {
            expect(block).not.toContain('<color>');
        });
    });

    it('produces exactly 3 Style blocks (2 icon + 1 line)', () => {
        const kml = generateKml([makeTransformedRun()], config);
        const styleCount = (kml.match(/<Style /g) || []).length;
        expect(styleCount).toBe(3);
    });
});
