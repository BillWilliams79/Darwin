/**
 * @module strava/stravaDataMapper
 * Maps Strava API responses to Darwin Run objects compatible with cyclemeter/sqlMapper.
 */

import { ACTIVITY_RIDE_ID, ICON_RIDE, ICON_HIKE, LINE_COLOR_ID } from '../cyclemeter/config';

// Strava sport_type values that map to cycling
const CYCLING_TYPES = new Set([
    'Ride', 'MountainBikeRide', 'GravelRide', 'EBikeRide',
    'EMountainBikeRide', 'VirtualRide', 'Velomobile', 'Handcycle',
]);

// Strava sport_type values that map to hiking
const HIKING_TYPES = new Set(['Hike', 'Walk']);

/**
 * Map a Strava sport_type to Darwin activity metadata.
 * @param {string} sportType - Strava sport_type value
 * @returns {{ activityID: number, activityName: string, lineIconId: number }}
 */
export function mapStravaSportType(sportType) {
    if (HIKING_TYPES.has(sportType)) {
        return { activityID: 5, activityName: 'Hike', lineIconId: ICON_HIKE };
    }
    // Cycling types and all others default to Ride
    return { activityID: ACTIVITY_RIDE_ID, activityName: 'Ride', lineIconId: ICON_RIDE };
}

/**
 * Compute descent from an altitude stream (sum of negative elevation deltas).
 * @param {number[]} altitudes - Array of altitude values in meters
 * @returns {number} Total descent in meters
 */
export function computeDescentFromAltitudes(altitudes) {
    if (!altitudes || altitudes.length < 2) return 0;
    let descent = 0;
    for (let i = 1; i < altitudes.length; i++) {
        const delta = altitudes[i] - altitudes[i - 1];
        if (delta < 0) descent += Math.abs(delta);
    }
    return descent;
}

/**
 * Build coordinates array from Strava streams.
 * @param {Object} streams - { latlng: { data: [[lat,lng],...] }, altitude: { data: [...] }, time: { data: [...] } }
 * @returns {import('../cyclemeter/types').Coordinate[]}
 */
export function buildCoordinatesFromStreams(streams) {
    const latlngData = streams.latlng?.data || [];
    const altitudeData = streams.altitude?.data || [];
    const timeData = streams.time?.data || [];

    return latlngData.map((pair, i) => ({
        latitude: pair[0],
        longitude: pair[1],
        altitude: altitudeData[i] ?? null,
        timeOffset: timeData[i] ?? null,
    }));
}

/**
 * Map a Strava DetailedActivity + streams to a Darwin Run object.
 * The returned Run is compatible with sqlMapper.mapRunToSql() — all values
 * are in raw units (meters, m/s, seconds) matching the existing extractor contract.
 *
 * @param {Object} activity - Strava DetailedActivity (from GET /activities/{id})
 * @param {Object} streams - Strava streams response (from GET /activities/{id}/streams)
 * @returns {import('../cyclemeter/types').Run}
 */
export function mapStravaActivityToRun(activity, streams) {
    const { activityID, activityName, lineIconId } = mapStravaSportType(activity.sport_type);
    const coordinates = buildCoordinatesFromStreams(streams);
    const altitudes = streams.altitude?.data || [];
    const descent = computeDescentFromAltitudes(altitudes);

    return {
        runID: activity.id,
        routeID: activity.id,
        activityID,
        name: activity.name || 'Untitled Activity',
        startTime: activity.start_date,
        runTime: activity.moving_time || 0,
        stoppedTime: Math.max(0, (activity.elapsed_time || 0) - (activity.moving_time || 0)),
        distance: activity.distance || 0,
        ascent: activity.total_elevation_gain || 0,
        descent,
        calories: activity.calories || 0,
        maxSpeed: activity.max_speed || 0,
        notes: activity.description || '',
        coordinates,
        extractedPoints: coordinates.length,
        currentPoints: coordinates.length,
        strippedPoints: 0,
        trimmedPoints: 0,
        activityName,
        lineIconId,
        lineColorId: LINE_COLOR_ID,
    };
}
