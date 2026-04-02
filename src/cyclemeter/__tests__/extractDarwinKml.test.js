// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { extractFromDarwinKml } from '../extractDarwinKml';
import { METERS_TO_MILES, METERS_TO_FEET, MS_TO_MPH } from '../config';

const DEFAULT_CONFIG = {
    mapTitle: 'Test',
    mapDescription: 'Test',
    outputFilename: 'test',
    minDelta: 10,
    precision: 5,
    queryFilter: {},
};

function kmlToBuffer(xml) {
    return new TextEncoder().encode(xml).buffer;
}

/**
 * Build a Darwin KML string with configurable runs.
 * @param {Object} opts
 * @param {Array} opts.runs - Array of run configs
 * @param {boolean} opts.withExtendedData - Include darwin: ExtendedData
 * @param {string} opts.coordFormat - 'whitespace' (MyMaps) or 'minified' (Darwin)
 */
function buildDarwinKml({
    runs = [{}],
    withExtendedData = false,
    coordFormat = 'whitespace',
} = {}) {
    const defaultRun = {
        activityName: 'Ride',
        runNumber: 1,
        date: 'THU :: 18 Aug 2011',
        startTime: '05:13 PM',
        distanceMi: 7.9,
        avgSpeedMph: 12.31,
        maxSpeedMph: 41.5,
        ascentFt: 46,
        runTimeStr: '00:38:38',
        stopTimeStr: '00:17:07',
        notes: '',
        routeName: 'Bay Trail North',
        coords: [[-118.4194, 33.9009], [-118.4193, 33.9008], [-118.419, 33.9006]],
        // ExtendedData fields
        startTimeUtc: '2011-08-19 00:13:00',
        runTimeSec: 2318,
        stoppedTimeSec: 1027,
        descentFt: 12,
        calories: 286,
        source: 'cyclemeter',
        partners: '',
    };

    const mergedRuns = runs.map((r, i) => ({ ...defaultRun, runNumber: i + 1, ...r }));

    const xmlns = withExtendedData
        ? '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:darwin="https://darwin.one/kml/1">'
        : '<kml xmlns="http://www.opengis.net/kml/2.2">';

    const placemarks = mergedRuns.map(r => {
        const coordStr = coordFormat === 'whitespace'
            ? r.coords.map(c => `${c[0]},${c[1]},0`).join('\n')
            : r.coords.map(c => `${c[0]},${c[1]}`).join('');

        const description = `Start Time : ${r.startTime}<br>Distance : ${r.distanceMi} miles <br>Average Speed : ${r.avgSpeedMph} mph<br>Max Speed : ${r.maxSpeedMph} mph<br>Ascent : ${r.ascentFt} feet<br>Ride Time : ${r.runTimeStr}<br>Stop Time : ${r.stopTimeStr}<br><br>${r.notes}`;

        let extendedData = '';
        if (withExtendedData) {
            extendedData = `<ExtendedData>
<darwin:startTimeUtc>${r.startTimeUtc}</darwin:startTimeUtc>
<darwin:runTimeSec>${r.runTimeSec}</darwin:runTimeSec>
<darwin:stoppedTimeSec>${r.stoppedTimeSec}</darwin:stoppedTimeSec>
<darwin:distanceMi>${r.distanceMi}</darwin:distanceMi>
<darwin:ascentFt>${r.ascentFt}</darwin:ascentFt>
<darwin:descentFt>${r.descentFt}</darwin:descentFt>
<darwin:maxSpeedMph>${r.maxSpeedMph}</darwin:maxSpeedMph>
<darwin:avgSpeedMph>${r.avgSpeedMph}</darwin:avgSpeedMph>
<darwin:calories>${r.calories}</darwin:calories>
<darwin:routeName>${r.routeName}</darwin:routeName>
<darwin:activityName>${r.activityName}</darwin:activityName>
<darwin:notes>${r.notes}</darwin:notes>
<darwin:source>${r.source}</darwin:source>
${r.partners ? `<darwin:partners>${r.partners}</darwin:partners>` : ''}
</ExtendedData>`;
        }

        return `<Placemark>
<name>${r.activityName} ${r.runNumber} :: ${r.date}</name>
<description><![CDATA[${description}]]></description>
${extendedData}
<styleUrl>#icon-1522-1167B1</styleUrl>
<Point><coordinates>${r.coords[0][0]},${r.coords[0][1]},0</coordinates></Point>
</Placemark>
<Placemark>
<name>Route</name>
<styleUrl>#line-1167B1</styleUrl>
<LineString><coordinates>${coordStr}</coordinates></LineString>
</Placemark>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
${xmlns}
<Document>
<name>Test Map</name>
<description>Test description</description>
<Style id="icon-1522-1167B1"><IconStyle><scale>1</scale></IconStyle></Style>
<Style id="line-1167B1"><LineStyle><color>ffb16711</color><width>5</width></LineStyle></Style>
<Folder>
<name>Activities: 10m spacing</name>
${placemarks}
</Folder>
</Document>
</kml>`;
}

describe('extractFromDarwinKml', () => {
    describe('CDATA fallback path', () => {
        it('extracts a single run with correct shape', async () => {
            const kml = buildDarwinKml();
            const runs = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(runs).toHaveLength(1);
            const [run] = runs;
            expect(run.runID).toBeGreaterThan(1000000000); // unix timestamp, not sequential
            expect(run.routeID).toBe(run.runID);
            expect(run).toHaveProperty('activityID', 4);
            expect(run).toHaveProperty('activityName', 'Ride');
            expect(run).toHaveProperty('lineIconId', 1522);
            expect(run).toHaveProperty('lineColorId', '1167b1');
            expect(run).toHaveProperty('extractedPoints', 3);
            expect(run).toHaveProperty('currentPoints', 3);
            expect(run).toHaveProperty('strippedPoints', 0);
            expect(run).toHaveProperty('trimmedPoints', 0);
        });

        it('parses stats from CDATA description', async () => {
            const kml = buildDarwinKml();
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            // Distance: 7.9 miles → meters
            expect(run.distance).toBeCloseTo(7.9 / METERS_TO_MILES, 0);
            // Max speed: 41.5 mph → m/s
            expect(run.maxSpeed).toBeCloseTo(41.5 / MS_TO_MPH, 1);
            // Ascent: 46 feet → meters
            expect(run.ascent).toBeCloseTo(46 / METERS_TO_FEET, 0);
            // Run time: 00:38:38 → 2318 seconds
            expect(run.runTime).toBe(2318);
            // Stopped time: 00:17:07 → 1027 seconds
            expect(run.stoppedTime).toBe(1027);
        });

        it('reconstructs UTC startTime from date and time', async () => {
            const kml = buildDarwinKml();
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            // "18 Aug 2011" + "05:13 PM" local → UTC (August = PDT, offset 7)
            // Local: 2011-08-18 17:13:00 → UTC: 2011-08-19 00:13:00
            expect(run.startTime).toBe('2011-08-19 00:13:00');
        });

        it('sets calories and descent to 0 (not in CDATA)', async () => {
            const kml = buildDarwinKml();
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.calories).toBe(0);
            expect(run.descent).toBe(0);
        });

        it('does not set _darwinImperial (CDATA path)', async () => {
            const kml = buildDarwinKml();
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run._darwinImperial).toBeUndefined();
        });

        it('uses placemark name as run name', async () => {
            const kml = buildDarwinKml();
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.name).toBe('Ride 1 :: THU :: 18 Aug 2011');
        });

        it('extracts notes from description', async () => {
            const kml = buildDarwinKml({ runs: [{ notes: 'Lia, Ella' }] });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.notes).toBe('Lia, Ella');
        });

        it('handles empty notes', async () => {
            const kml = buildDarwinKml({ runs: [{ notes: '' }] });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.notes).toBe('');
        });

        it('maps Hike activity correctly', async () => {
            const kml = buildDarwinKml({
                runs: [{
                    activityName: 'Hike',
                    date: 'SAT :: 20 Mar 2021',
                    startTime: '10:00 AM',
                }],
            });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.activityID).toBe(5);
            expect(run.activityName).toBe('Hike');
            expect(run.lineIconId).toBe(1596);
        });

        it('handles PST timezone (winter months)', async () => {
            const kml = buildDarwinKml({
                runs: [{
                    date: 'SAT :: 15 Jan 2022',
                    startTime: '02:00 PM',
                }],
            });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            // January = PST, offset 8. Local 14:00 → UTC 22:00
            expect(run.startTime).toBe('2022-01-15 22:00:00');
        });
    });

    describe('ExtendedData path', () => {
        it('uses ExtendedData values when present', async () => {
            const kml = buildDarwinKml({ withExtendedData: true });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.startTime).toBe('2011-08-19 00:13:00');
            expect(run.runTime).toBe(2318);
            expect(run.stoppedTime).toBe(1027);
            expect(run.distance).toBeCloseTo(7.9 / METERS_TO_MILES, 0);
            expect(run.maxSpeed).toBeCloseTo(41.5 / MS_TO_MPH, 1);
            expect(run.ascent).toBeCloseTo(46 / METERS_TO_FEET, 0);
        });

        it('stashes exact imperial values in _darwinImperial', async () => {
            const kml = buildDarwinKml({
                withExtendedData: true,
                runs: [{
                    distanceMi: 7.9,
                    ascentFt: 118,
                    descentFt: 25,
                    maxSpeedMph: 41.5,
                    avgSpeedMph: 13.7,
                    calories: 350,
                }],
            });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run._darwinImperial).toBeDefined();
            expect(run._darwinImperial.distance).toBe(7.9);
            expect(run._darwinImperial.ascent).toBe(118);
            expect(run._darwinImperial.descent).toBe(25);
            expect(run._darwinImperial.maxSpeed).toBe(41.5);
            expect(run._darwinImperial.averageSpeed).toBe(13.7);
            expect(run._darwinImperial.calories).toBe(350);
        });

        it('preserves descent and calories from ExtendedData', async () => {
            const kml = buildDarwinKml({
                withExtendedData: true,
                runs: [{ descentFt: 25, calories: 350 }],
            });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.descent).toBeCloseTo(25 / METERS_TO_FEET, 0);
            expect(run.calories).toBe(350);
        });

        it('uses routeName from ExtendedData as run name', async () => {
            const kml = buildDarwinKml({
                withExtendedData: true,
                runs: [{ routeName: 'Bay Trail North' }],
            });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.name).toBe('Bay Trail North');
        });

        it('parses partner names from ExtendedData', async () => {
            const kml = buildDarwinKml({
                withExtendedData: true,
                runs: [{ partners: 'Lia, Ella' }],
            });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.partnerNames).toEqual(['Lia', 'Ella']);
        });

        it('omits partnerNames when partners field is empty', async () => {
            const kml = buildDarwinKml({
                withExtendedData: true,
                runs: [{ partners: '' }],
            });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.partnerNames).toBeUndefined();
        });
    });

    describe('coordinate parsing', () => {
        it('parses whitespace-separated coordinates with altitude', async () => {
            const kml = buildDarwinKml({ coordFormat: 'whitespace' });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.coordinates).toHaveLength(3);
            expect(run.coordinates[0].longitude).toBe(-118.4194);
            expect(run.coordinates[0].latitude).toBe(33.9009);
            expect(run.coordinates[0].altitude).toBe(0);
            expect(run.coordinates[0].timestamp).toBeNull();
        });

        it('parses minified coordinates without separator', async () => {
            const kml = buildDarwinKml({ coordFormat: 'minified' });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.coordinates).toHaveLength(3);
            expect(run.coordinates[0].longitude).toBe(-118.4194);
            expect(run.coordinates[0].latitude).toBe(33.9009);
            expect(run.coordinates[0].altitude).toBeNull();
        });

        it('parses coordinates without altitude (lon,lat only)', async () => {
            const kml = buildDarwinKml({
                coordFormat: 'minified',
                runs: [{ coords: [[-121.0, 37.0], [-121.001, 37.001]] }],
            });
            const [run] = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(run.coordinates).toHaveLength(2);
            expect(run.coordinates[0].longitude).toBe(-121);
            expect(run.coordinates[0].latitude).toBe(37);
            expect(run.coordinates[0].altitude).toBeNull();
        });
    });

    describe('multi-run', () => {
        it('extracts multiple runs', async () => {
            const kml = buildDarwinKml({
                runs: [
                    { activityName: 'Ride', date: 'THU :: 18 Aug 2011' },
                    { activityName: 'Ride', date: 'FRI :: 19 Aug 2011' },
                    { activityName: 'Hike', date: 'SAT :: 20 Aug 2011' },
                ],
            });
            const runs = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            expect(runs).toHaveLength(3);
            // Timestamp-based IDs — unique per run, not sequential
            expect(runs[0].runID).toBeGreaterThan(1000000000);
            expect(runs[1].runID).toBeGreaterThan(1000000000);
            expect(runs[2].runID).toBeGreaterThan(1000000000);
            expect(new Set([runs[0].runID, runs[1].runID, runs[2].runID]).size).toBe(3); // all unique
            expect(runs[2].activityName).toBe('Hike');
        });

        it('assigns unique timestamp-based routeIDs', async () => {
            const kml = buildDarwinKml({
                runs: [
                    { date: 'THU :: 18 Aug 2011' },
                    { date: 'FRI :: 19 Aug 2011' },
                ],
            });
            const runs = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);

            // Timestamp-based IDs, not sequential
            expect(runs[0].routeID).toBeGreaterThan(1000000000);
            expect(runs[1].routeID).toBeGreaterThan(1000000000);
            expect(runs[0].routeID).not.toBe(runs[1].routeID);
        });
    });

    describe('error handling', () => {
        it('throws for KML with no Placemarks', async () => {
            const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document><name>Empty</name></Document></kml>`;
            await expect(extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG))
                .rejects.toThrow('no Placemarks found');
        });

        it('throws for KML with no icon Placemarks', async () => {
            const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document><Placemark><name>Route</name>
<LineString><coordinates>-121,37,0</coordinates></LineString>
</Placemark></Document></kml>`;
            await expect(extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG))
                .rejects.toThrow('no icon Placemarks found');
        });

        it('throws for invalid XML', async () => {
            await expect(extractFromDarwinKml(kmlToBuffer('not xml'), DEFAULT_CONFIG))
                .rejects.toThrow();
        });

        it('skips runs with no coordinates', async () => {
            // Icon placemark but route placemark has empty coordinates
            const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<Placemark>
<name>Ride 1 :: THU :: 18 Aug 2011</name>
<description><![CDATA[Start Time : 05:13 PM<br>Distance : 7.9 miles <br>Average Speed : 12.31 mph<br>Max Speed : 41.5 mph<br>Ascent : 46 feet<br>Ride Time : 00:38:38<br>Stop Time : 00:17:07<br><br>]]></description>
<Point><coordinates>-118.4194,33.9009,0</coordinates></Point>
</Placemark>
<Placemark>
<name>Route</name>
<LineString><coordinates></coordinates></LineString>
</Placemark>
<Placemark>
<name>Ride 2 :: FRI :: 19 Aug 2011</name>
<description><![CDATA[Start Time : 02:00 PM<br>Distance : 10.0 miles <br>Average Speed : 10.0 mph<br>Max Speed : 20.0 mph<br>Ascent : 100 feet<br>Ride Time : 01:00:00<br>Stop Time : 00:10:00<br><br>]]></description>
<Point><coordinates>-118.4191,33.9007,0</coordinates></Point>
</Placemark>
<Placemark>
<name>Route</name>
<LineString><coordinates>-118.4191,33.9007,0
-118.4192,33.9008,0</coordinates></LineString>
</Placemark>
</Document></kml>`;
            const runs = await extractFromDarwinKml(kmlToBuffer(kml), DEFAULT_CONFIG);
            expect(runs).toHaveLength(1);
            expect(runs[0].name).toContain('Ride 2');
        });
    });
});
