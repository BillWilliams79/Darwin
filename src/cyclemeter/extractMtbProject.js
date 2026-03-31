/**
 * @module cyclemeter/extractMtbProject
 * Extract trail data from an MTB Project GPX 1.0 file.
 * MTB Project exports lat/lon-only trackpoints with no timestamps or elevation data.
 * Returns Run[] compatible with the existing transform/load pipeline.
 */

import { haversineDistance } from './geo';
import { ACTIVITY_RIDE_ID, ICON_RIDE, LINE_COLOR_ID } from './config';

/**
 * Compute a deterministic synthetic ID from the first trackpoint coordinate.
 * Used in place of a timestamp-based ID when no time data is available.
 * @param {number} lat
 * @param {number} lon
 * @returns {number}
 */
function coordinateSyntheticId(lat, lon) {
    return Math.abs(Math.round(lat * 1e5) * 1000 + Math.round(Math.abs(lon) * 10)) % 2147483647;
}

/**
 * Compute total distance from an array of lat/lon coordinates using haversine.
 * @param {Array<{ latitude: number, longitude: number }>} coords
 * @returns {number} Distance in meters
 */
function computeDistance(coords) {
    let distance = 0;
    for (let i = 1; i < coords.length; i++) {
        distance += haversineDistance(
            coords[i - 1].latitude, coords[i - 1].longitude,
            coords[i].latitude, coords[i].longitude
        );
    }
    return distance;
}

/**
 * Extract trail data from an MTB Project GPX 1.0 file.
 * @param {ArrayBuffer} arrayBuffer - GPX file contents
 * @param {import('./types').EtlConfig} config - Pipeline config (used downstream, not for extraction)
 * @returns {Promise<import('./types').Run[]>} Array with single Run object
 */
export async function extractFromMtbProjectGpx(arrayBuffer, config) {
    const text = new TextDecoder('utf-8').decode(arrayBuffer);
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new Error('Invalid GPX file: XML parse error');
    }

    const trk = doc.getElementsByTagName('trk')[0];
    if (!trk) {
        throw new Error('Invalid GPX file: no <trk> element found');
    }

    const nameEl = trk.getElementsByTagName('name')[0];
    const name = nameEl?.textContent?.trim() || 'MTB Project Trail';

    const trkpts = trk.getElementsByTagName('trkpt');
    const coordinates = [];

    for (let i = 0; i < trkpts.length; i++) {
        const pt = trkpts[i];
        coordinates.push({
            latitude: parseFloat(pt.getAttribute('lat')),
            longitude: parseFloat(pt.getAttribute('lon')),
            altitude: null,
            timestamp: null,
        });
    }

    if (coordinates.length === 0) {
        throw new Error('Invalid GPX file: no trackpoints found');
    }

    const distance = computeDistance(coordinates);
    const syntheticId = coordinateSyntheticId(coordinates[0].latitude, coordinates[0].longitude);

    const run = {
        runID: syntheticId,
        routeID: syntheticId,
        activityID: ACTIVITY_RIDE_ID,
        name,
        startTime: new Date().toISOString(),
        runTime: 0,
        stoppedTime: 0,
        distance,
        ascent: 0,
        descent: 0,
        calories: 0,
        maxSpeed: 0,
        notes: '',
        coordinates,
        extractedPoints: coordinates.length,
        currentPoints: coordinates.length,
        strippedPoints: 0,
        activityName: 'Ride',
        lineIconId: ICON_RIDE,
        lineColorId: LINE_COLOR_ID,
    };

    return [run];
}
