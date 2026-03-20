/**
 * @module cyclemeter/transform
 * Transform functions for the Cyclemeter ETL pipeline.
 * Matches Python's gps_transform.py: precision_optimizer, cm_data_format, distance_optimizer.
 */

import { haversineDistance } from './geo';
import { METERS_TO_MILES, METERS_TO_FEET, MS_TO_MPH, MAX_STOPPED_TIME } from './config';

/**
 * Truncate lat/lon coordinates to N decimal places.
 * Mutates runs in place for performance (1.69M coordinate objects).
 * @param {import('./types').Run[]} runs
 * @param {number} precision - Number of decimal places (0 = skip)
 */
export function precisionOptimizer(runs, precision) {
    if (precision === 0) return;

    const factor = 10 ** precision;

    for (const run of runs) {
        for (const coord of run.coordinates) {
            coord.latitude = Math.round(coord.latitude * factor) / factor;
            coord.longitude = Math.round(coord.longitude * factor) / factor;
        }
    }
}

/**
 * Pad a number to 2 digits with leading zero.
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
    return n < 10 ? '0' + n : String(n);
}

/**
 * Format seconds as "HH:MM:SS".
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatDuration(totalSeconds) {
    const s = Math.floor(totalSeconds);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * Apply month-granular PST/PDT timezone adjustment to an ISO startTime string.
 * Months 1,2,3,11,12 → UTC-8 (PST); otherwise → UTC-7 (PDT).
 * Matches Python's startTime_tz_adjust().
 * @param {string} isoString - ISO format date string from Cyclemeter DB
 * @returns {Date}
 */
function adjustTimezone(isoString) {
    // Cyclemeter stores UTC timestamps without 'Z' suffix.
    // Append 'Z' to force UTC interpretation (matches Python's naive datetime behavior).
    const normalized = isoString.endsWith('Z') ? isoString : isoString.replace(' ', 'T') + 'Z';
    const dt = new Date(normalized);
    const month = dt.getUTCMonth() + 1; // 1-based
    const offsetHours = [1, 2, 3, 11, 12].includes(month) ? 8 : 7;
    return new Date(dt.getTime() - offsetHours * 3600 * 1000);
}

/**
 * Format Date as "DAY :: DD MMM YYYY" matching getterdone.kml format.
 * @param {Date} date
 * @returns {string}
 */
function formatTitleDate(date) {
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = days[date.getUTCDay()];
    const dd = pad2(date.getUTCDate());
    const mmm = months[date.getUTCMonth()];
    const yyyy = date.getUTCFullYear();
    return `${day} :: ${dd} ${mmm} ${yyyy}`;
}

/**
 * Format Date as "HH:MM AM/PM".
 * @param {Date} date
 * @returns {string}
 */
function formatDescriptionTime(date) {
    let hours = date.getUTCHours();
    const minutes = pad2(date.getUTCMinutes());
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${pad2(hours)}:${minutes} ${ampm}`;
}

/**
 * Round a number to N decimal places.
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
function roundTo(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

/**
 * Format run data: unit conversions, TZ adjust, time formatting.
 * Matches Python's cm_data_format(). Mutates runs in place.
 * @param {import('./types').Run[]} runs
 * @returns {import('./types').TransformedRun[]} Same array, now with transformed fields
 */
export function formatRunData(runs) {
    for (const run of runs) {
        // Average speed: distance(m) / runTime(s) * MS_TO_MPH → mph, 2 decimals
        run.averageSpeed = roundTo((run.distance / run.runTime) * MS_TO_MPH, 2);

        // Cap stopped time at 24h - 1s
        run.stoppedTime = Math.min(run.stoppedTime, MAX_STOPPED_TIME);

        // TZ-adjust startTime
        run.startTime = adjustTimezone(run.startTime);

        // Pre-formatted date strings for KML templates
        run.titleFormattedStart = formatTitleDate(run.startTime);
        run.descFormattedStart = formatDescriptionTime(run.startTime);

        // Format durations as HH:MM:SS strings
        run.runTime = formatDuration(run.runTime);
        run.stoppedTime = formatDuration(run.stoppedTime);

        // Unit conversions
        run.distance = roundTo(run.distance * METERS_TO_MILES, 1);
        run.ascent = Math.floor(run.ascent * METERS_TO_FEET);
        run.descent = Math.floor(run.descent * METERS_TO_FEET);
        run.maxSpeed = roundTo(run.maxSpeed * MS_TO_MPH, 1);
        run.calories = Math.floor(run.calories);
    }

    return runs;
}

/**
 * Drop GPS points closer than minDelta meters apart using Haversine.
 * Mutates runs in place (coordinates array filtered, stats updated).
 * Matches Python's distance_optimizer().
 * @param {import('./types').Run[]} runs
 * @param {number} minDelta - Minimum distance in meters between consecutive points
 */
export function distanceOptimizer(runs, minDelta) {
    if (minDelta === 0) return;

    for (const run of runs) {
        const coords = run.coordinates;
        if (coords.length === 0) continue;

        const kept = [coords[0]];

        for (let i = 1; i < coords.length; i++) {
            const prev = kept[kept.length - 1];
            const curr = coords[i];
            const dist = haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);

            if (dist >= minDelta) {
                kept.push(curr);
            } else {
                run.strippedPoints++;
            }
        }

        run.coordinates = kept;
        run.currentPoints = kept.length;
    }
}
