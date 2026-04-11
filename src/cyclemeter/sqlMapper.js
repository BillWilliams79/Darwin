/**
 * @module cyclemeter/sqlMapper
 * Maps raw Cyclemeter Run objects (pre-formatRunData) to SQL-ready objects
 * for storage in Darwin map_routes, map_runs, and map_coordinates tables.
 */

import { METERS_TO_MILES, METERS_TO_FEET, MS_TO_MPH, MAX_STOPPED_TIME } from './config';

/**
 * Map a raw Run to a map_runs SQL row.
 * Must be called BEFORE formatRunData (which destructively transforms startTime, runTime, etc.).
 * @param {import('./types').Run} run - Raw run from any extractor
 * @param {number|null} mapRouteFk - FK to map_routes table (null if route not saved)
 * @param {string} source - Source identifier for map_runs.source column (default: 'cyclemeter')
 * @returns {Object} SQL-ready object for POST to /map_runs
 */
export function mapRunToSql(run, mapRouteFk = null, source = 'cyclemeter') {
    const imperial = run._darwinImperial;

    const avgSpeedMph = imperial ? imperial.averageSpeed :
        (run.runTime > 0 ? Math.round((run.distance / run.runTime) * MS_TO_MPH * 100) / 100 : null);

    return {
        run_id: run.runID,
        map_route_fk: mapRouteFk,
        activity_id: run.activityID,
        activity_name: run.activityName,
        start_time: run.startTime ? run.startTime.replace(/\.\d+$/, '') : run.startTime,
        run_time_sec: Math.floor(run.runTime),
        stopped_time_sec: Math.min(Math.floor(run.stoppedTime), MAX_STOPPED_TIME),
        distance_mi: imperial ? imperial.distance : Math.round(run.distance * METERS_TO_MILES * 10) / 10,
        ascent_ft: imperial ? imperial.ascent : (run.ascent != null ? Math.floor(run.ascent * METERS_TO_FEET) : null),
        descent_ft: imperial ? imperial.descent : (run.descent != null ? Math.floor(run.descent * METERS_TO_FEET) : null),
        calories: imperial ? imperial.calories : (run.calories != null ? Math.floor(run.calories) : null),
        max_speed_mph: imperial ? imperial.maxSpeed : (run.maxSpeed != null ? Math.round(run.maxSpeed * MS_TO_MPH * 10) / 10 : null),
        avg_speed_mph: avgSpeedMph,
        notes: run.notes || null,
        source,
    };
}

/**
 * Map a run's coordinates to map_coordinates SQL rows.
 * @param {Array} coordinates - Array of coordinate objects from a run
 * @returns {Array<Object>} SQL-ready objects for bulk POST to /map_coordinates
 */
export function mapCoordinatesToSql(coordinates) {
    return coordinates.map((coord, index) => ({
        seq: index,
        latitude: coord.latitude,
        longitude: coord.longitude,
        altitude: coord.altitude != null ? Math.round(coord.altitude * 10) / 10 : null,
    }));
}

/**
 * Extract unique routes from raw runs.
 * @param {import('./types').Run[]} runs - Raw runs from extractFromCyclemeter
 * @returns {Array<Object>} SQL-ready objects for POST to /map_routes
 */
export function extractUniqueRoutes(runs) {
    const routeMap = new Map();
    for (const run of runs) {
        if (!routeMap.has(run.routeID)) {
            routeMap.set(run.routeID, {
                route_id: run.routeID,
                name: run.name,
            });
        }
    }
    return Array.from(routeMap.values());
}

/**
 * Normalize a route name for dedup comparison.
 * Strips the " - Cyclemeter" suffix that Strava appends to Cyclemeter route names.
 * Used for matching only — original names are preserved in the database.
 * @param {string|null|undefined} name - Route name to normalize
 * @returns {string} Normalized name
 */
export function normalizeRouteName(name) {
    if (!name) return '';
    return name.replace(/ - Cyclemeter$/, '').trim();
}

/**
 * Filter runs to only those after a date cutoff (for bulk import dedup).
 * @param {import('./types').Run[]} rawRuns - Raw runs from extractFromCyclemeter
 * @param {string|null|undefined} cutoffDate - ISO date string of latest existing run, or null/undefined for first import
 * @returns {{ newRuns: Array, skippedCount: number }}
 */
export function filterNewRunsByCutoff(rawRuns, cutoffDate) {
    if (!cutoffDate) return { newRuns: rawRuns, skippedCount: 0 };
    const cutoff = new Date(cutoffDate);
    const newRuns = rawRuns.filter(run => {
        // Strip fractional seconds before comparing — MySQL DATETIME truncates sub-second
        // precision, so the stored cutoff has no milliseconds. Without stripping, the last
        // imported run's fractional part causes a false "newer than cutoff" result,
        // re-importing it and triggering a duplicate key error (500) on map_runs POST.
        const runStart = new Date(run.startTime.replace(/\.\d+$/, ''));
        return runStart > cutoff;
    });
    return { newRuns, skippedCount: rawRuns.length - newRuns.length };
}
