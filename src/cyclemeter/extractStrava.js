/**
 * @module cyclemeter/extractStrava
 * Extract ride data from a Strava GPX file.
 * Returns Run[] compatible with the existing transform/load pipeline.
 */

import { haversineDistance } from './geo';
import { ACTIVITY_RIDE_ID, ICON_RIDE, ICON_HIKE, LINE_COLOR_ID } from './config';

/** Distance threshold (meters) for detecting stopped time between consecutive points */
const STOP_THRESHOLD_M = 2;

/** Minimum time interval (seconds) for reliable speed calculation — filters GPS noise */
const MIN_SPEED_INTERVAL_S = 5;

/**
 * Map GPX activity type string to Cyclemeter-compatible activity metadata.
 * @param {string} typeStr - Value from <trk><type> (e.g., 'cycling', 'hiking')
 * @returns {{ activityID: number, activityName: string, lineIconId: number }}
 */
function mapActivityType(typeStr) {
    const normalized = (typeStr || '').toLowerCase().trim();
    if (normalized === 'hiking' || normalized === 'walking') {
        return { activityID: 5, activityName: 'Hike', lineIconId: ICON_HIKE };
    }
    // Default to Ride for 'cycling' and any other/unknown type
    return { activityID: ACTIVITY_RIDE_ID, activityName: 'Ride', lineIconId: ICON_RIDE };
}

/**
 * Compute derived run statistics from an array of coordinates.
 * Cyclemeter DB provides these natively; GPX does not, so we compute from trackpoints.
 * @param {Array<{ latitude: number, longitude: number, altitude: number|null, timestamp: string }>} coords
 * @returns {{ distance: number, runTime: number, stoppedTime: number, ascent: number, descent: number, maxSpeed: number }}
 */
function computeRunStats(coords) {
    if (coords.length < 2) {
        return { distance: 0, runTime: 0, stoppedTime: 0, ascent: 0, descent: 0, maxSpeed: 0 };
    }

    let distance = 0;
    let stoppedTime = 0;
    let ascent = 0;
    let descent = 0;
    let maxSpeed = 0;

    const firstTime = new Date(coords[0].timestamp).getTime();
    const lastTime = new Date(coords[coords.length - 1].timestamp).getTime();
    const runTime = (lastTime - firstTime) / 1000; // seconds

    for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1];
        const curr = coords[i];

        const segDist = haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
        const timeDelta = (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;

        distance += segDist;

        // Stop detection: consecutive points within threshold distance
        if (segDist < STOP_THRESHOLD_M && timeDelta > 0) {
            stoppedTime += timeDelta;
        }

        // Speed: require minimum time interval to filter GPS noise from instantaneous calcs
        if (timeDelta >= MIN_SPEED_INTERVAL_S && segDist >= STOP_THRESHOLD_M) {
            const speed = segDist / timeDelta; // m/s
            if (speed > maxSpeed) maxSpeed = speed;
        }

        // Elevation changes
        if (prev.altitude != null && curr.altitude != null) {
            const elevDelta = curr.altitude - prev.altitude;
            if (elevDelta > 0) ascent += elevDelta;
            else descent += Math.abs(elevDelta);
        }
    }

    return { distance, runTime, stoppedTime, ascent, descent, maxSpeed };
}

/**
 * Extract run data from a Strava GPX file.
 * @param {ArrayBuffer} arrayBuffer - GPX file contents
 * @param {import('./types').EtlConfig} config - Pipeline config (used downstream, not for extraction)
 * @returns {Promise<import('./types').Run[]>} Array with single Run object
 */
export async function extractFromStravaGpx(arrayBuffer, config) {
    const text = new TextDecoder('utf-8').decode(arrayBuffer);
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');

    // Check for XML parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new Error('Invalid GPX file: XML parse error');
    }

    const trk = doc.getElementsByTagName('trk')[0];
    if (!trk) {
        throw new Error('Invalid GPX file: no <trk> element found');
    }

    // Extract track metadata
    const nameEl = trk.getElementsByTagName('name')[0];
    const typeEl = trk.getElementsByTagName('type')[0];
    const name = nameEl?.textContent || 'Untitled Activity';
    const activityType = typeEl?.textContent || '';
    const { activityID, activityName, lineIconId } = mapActivityType(activityType);

    // Extract trackpoints
    const trkpts = trk.getElementsByTagName('trkpt');
    const coordinates = [];

    for (let i = 0; i < trkpts.length; i++) {
        const pt = trkpts[i];
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));

        const eleEl = pt.getElementsByTagName('ele')[0];
        const timeEl = pt.getElementsByTagName('time')[0];

        coordinates.push({
            latitude: lat,
            longitude: lon,
            altitude: eleEl ? parseFloat(eleEl.textContent) : null,
            timestamp: timeEl?.textContent || null,
        });
    }

    if (coordinates.length === 0) {
        throw new Error('Invalid GPX file: no trackpoints found');
    }

    // Compute derived fields
    const stats = computeRunStats(coordinates);
    const startTime = coordinates[0].timestamp;

    // Synthetic IDs: deterministic from start time (Unix epoch seconds)
    const syntheticId = Math.floor(new Date(startTime).getTime() / 1000);

    const run = {
        runID: syntheticId,
        routeID: syntheticId,
        activityID,
        name,
        startTime,
        runTime: stats.runTime,
        stoppedTime: stats.stoppedTime,
        distance: stats.distance,
        ascent: stats.ascent,
        descent: stats.descent,
        calories: 0,
        maxSpeed: stats.maxSpeed,
        notes: '',
        coordinates,
        extractedPoints: coordinates.length,
        currentPoints: coordinates.length,
        strippedPoints: 0,
        activityName,
        lineIconId,
        lineColorId: LINE_COLOR_ID,
    };

    return [run];
}
