/**
 * @module cyclemeter/extractWahooFit
 * Extract ride data from a Wahoo (or any device) FIT file.
 * Uses session-level aggregate stats (device-calculated via barometric altimeter
 * and calibrated wheel speed) rather than recomputing from GPS trackpoints.
 * Returns Run[] compatible with the existing transform/load pipeline.
 */

import FitParser from 'fit-file-parser';
import { ACTIVITY_RIDE_ID, ICON_RIDE, ICON_HIKE, LINE_COLOR_ID } from './config';

/**
 * Map FIT session sport string to Cyclemeter-compatible activity metadata.
 * @param {string} sport - Value from FIT session.sport (e.g., 'cycling', 'hiking')
 * @returns {{ activityID: number, activityName: string, lineIconId: number }}
 */
function mapFitSport(sport) {
    const normalized = (sport || '').toLowerCase().trim();
    if (normalized === 'hiking' || normalized === 'walking') {
        return { activityID: 5, activityName: 'Hike', lineIconId: ICON_HIKE };
    }
    // Default to Ride for cycling, running, and unknown types
    return { activityID: ACTIVITY_RIDE_ID, activityName: 'Ride', lineIconId: ICON_RIDE };
}

/**
 * Extract run data from a FIT file.
 * @param {ArrayBuffer} arrayBuffer - FIT file contents
 * @param {import('./types').EtlConfig} config - Pipeline config (used downstream, not here)
 * @returns {Promise<import('./types').Run[]>} Array with single Run object
 */
export async function extractFromWahooFit(arrayBuffer, config) {
    const fitParser = new FitParser({
        force: true,
        speedUnit: 'm/s',
        lengthUnit: 'm',
        mode: 'list',
    });

    const data = await fitParser.parseAsync(arrayBuffer);

    const session = data.sessions?.[0];
    if (!session) {
        throw new Error('Invalid FIT file: no session data found');
    }

    // Coordinates from per-second records; filter out records without GPS fix
    const coordinates = (data.records || [])
        .filter(r => r.position_lat != null && r.position_long != null)
        .map(r => ({
            latitude: r.position_lat,
            longitude: r.position_long,
            altitude: r.altitude ?? null,
            timestamp: r.timestamp instanceof Date
                ? r.timestamp.toISOString()
                : (r.timestamp || null),
        }));

    if (coordinates.length === 0) {
        throw new Error('Invalid FIT file: no GPS trackpoints found');
    }

    // Stats from session aggregate (more accurate than GPS recalculation:
    // barometric altimeter for ascent/descent, calibrated wheel speed for distance)
    const runTime = session.total_timer_time ?? 0;        // moving time (seconds)
    const elapsed = session.total_elapsed_time ?? runTime; // wall-clock time
    const stoppedTime = Math.max(0, elapsed - runTime);   // paused time
    const distance = session.total_distance ?? 0;          // meters
    const ascent = session.total_ascent ?? 0;              // meters
    const descent = session.total_descent ?? 0;            // meters
    const maxSpeed = session.max_speed ?? 0;               // m/s
    const calories = session.total_calories ?? 0;

    // Activity name: prefer device workout label; fall back to date-based synthesis
    const wktName = data.workouts?.[0]?.wkt_name;
    const startDate = session.start_time instanceof Date
        ? session.start_time
        : new Date(session.start_time);
    const name = wktName || `Cycling — ${startDate.toLocaleDateString('en-US', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    })}`;

    const startTime = startDate.toISOString();
    const syntheticId = Math.floor(startDate.getTime() / 1000);
    const { activityID, activityName, lineIconId } = mapFitSport(session.sport);

    return [{
        runID: syntheticId,
        routeID: syntheticId,
        activityID,
        activityName,
        name,
        startTime,
        runTime,
        stoppedTime,
        distance,
        ascent,
        descent,
        calories,
        maxSpeed,
        notes: '',
        coordinates,
        extractedPoints: coordinates.length,
        currentPoints: coordinates.length,
        strippedPoints: 0,
        lineIconId,
        lineColorId: LINE_COLOR_ID,
    }];
}
