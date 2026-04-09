/**
 * @module cyclemeter/extractDarwinKml
 * Extract ride data from a Darwin-generated KML file.
 * Returns Run[] compatible with the existing transform/load pipeline.
 *
 * Supports two data paths:
 * - ExtendedData path (near-lossless): when darwin: namespace elements are present
 * - CDATA fallback path (lossy): parse stats from human-readable description text
 *
 * Darwin KML files contain pairs of Placemarks per run:
 * - Icon Placemark: <Point> with start coordinates, stats in <description> CDATA
 * - Route Placemark: <LineString> with full track coordinates
 */

import {
    ACTIVITY_RIDE_ID, ICON_RIDE, ICON_HIKE, LINE_COLOR_ID,
    METERS_TO_MILES, METERS_TO_FEET, MS_TO_MPH,
} from './config';

const DARWIN_NS = 'https://darwin.one/kml/1';

/**
 * Map activity name string to pipeline activity metadata.
 * @param {string} activityName - "Ride" or "Hike"
 * @returns {{ activityID: number, activityName: string, lineIconId: number }}
 */
function mapActivity(activityName) {
    const normalized = (activityName || '').toLowerCase().trim();
    if (normalized === 'hike' || normalized === 'walk') {
        return { activityID: 5, activityName: 'Hike', lineIconId: ICON_HIKE };
    }
    return { activityID: ACTIVITY_RIDE_ID, activityName: 'Ride', lineIconId: ICON_RIDE };
}

/**
 * Read a text value from a darwin-namespaced element.
 * Tries namespace-aware lookup first, falls back to prefixed tag name (jsdom compat).
 * @param {Element} parent
 * @param {string} localName
 * @returns {string|null}
 */
function getDarwinText(parent, localName) {
    const els = parent.getElementsByTagNameNS(DARWIN_NS, localName);
    if (els.length > 0) return els[0].textContent;
    const prefixed = parent.getElementsByTagName('darwin:' + localName);
    if (prefixed.length > 0) return prefixed[0].textContent;
    return null;
}

/**
 * Read a float value from a darwin-namespaced element.
 * @param {Element} parent
 * @param {string} localName
 * @returns {number}
 */
function getDarwinFloat(parent, localName) {
    const text = getDarwinText(parent, localName);
    return text != null ? parseFloat(text) : 0;
}

/**
 * Parse coordinates from a LineString element.
 * Handles both whitespace-separated (MyMaps: "lon,lat,alt\n") and
 * minified (Darwin: "lon,latlon,lat") formats via regex.
 * @param {Element} lineStringEl
 * @returns {import('./types').Coordinate[]}
 */
function parseCoordinates(lineStringEl) {
    const coordsEl = lineStringEl.getElementsByTagName('coordinates')[0];
    if (!coordsEl) return [];

    const text = coordsEl.textContent.trim();
    const regex = /-?\d+\.?\d*,-?\d+\.?\d*(?:,-?\d+\.?\d*)?/g;
    const coordinates = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
        const parts = match[0].split(',');
        const lon = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (!isNaN(lon) && !isNaN(lat)) {
            coordinates.push({
                longitude: lon,
                latitude: lat,
                altitude: parts.length >= 3 ? parseFloat(parts[2]) : null,
                timestamp: null,
            });
        }
    }

    return coordinates;
}

/**
 * Parse duration string "HH:MM:SS" to total seconds.
 * @param {string} str
 * @returns {number}
 */
function parseDurationToSeconds(str) {
    if (!str) return 0;
    const parts = str.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
}

/**
 * Parse a regex match from description text, returning the first capture group.
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {string|null}
 */
function parseDescField(text, pattern) {
    const m = text.match(pattern);
    return m ? m[1] : null;
}

/**
 * Reconstruct a UTC startTime string from the date in the Placemark name
 * and the time in the description CDATA, reversing the PST/PDT adjustment.
 * @param {string} dateStr - e.g., "18 Aug 2011"
 * @param {string} timeStr - e.g., "05:13 PM"
 * @returns {string} UTC date-time string (e.g., "2011-08-19 00:13:00")
 */
function reconstructUtcStartTime(dateStr, timeStr) {
    const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
        Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const dateParts = dateStr.trim().split(/\s+/);
    if (dateParts.length < 3) return '';

    const day = parseInt(dateParts[0], 10);
    const month = months[dateParts[1]];
    const year = parseInt(dateParts[2], 10);
    if (month == null || isNaN(day) || isNaN(year)) return '';

    // Parse time "HH:MM AM/PM"
    let hours = 0, minutes = 0;
    if (timeStr) {
        const timeParts = timeStr.trim().match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (timeParts) {
            hours = parseInt(timeParts[1], 10);
            minutes = parseInt(timeParts[2], 10);
            const ampm = timeParts[3].toUpperCase();
            if (ampm === 'PM' && hours !== 12) hours += 12;
            if (ampm === 'AM' && hours === 12) hours = 0;
        }
    }

    // Build local Date, then reverse the PST/PDT offset to get UTC
    // Month 1-based: 1,2,3,11,12 = PST (UTC-8); others = PDT (UTC-7)
    const monthOneBased = month + 1;
    const offsetHours = [1, 2, 3, 11, 12].includes(monthOneBased) ? 8 : 7;

    const localMs = Date.UTC(year, month, day, hours, minutes, 0);
    const utcMs = localMs + offsetHours * 3600 * 1000;
    const utcDate = new Date(utcMs);

    const pad = n => n < 10 ? '0' + n : String(n);
    return `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(utcDate.getUTCDate())} ` +
           `${pad(utcDate.getUTCHours())}:${pad(utcDate.getUTCMinutes())}:${pad(utcDate.getUTCSeconds())}`;
}

/**
 * Extract run data from a Darwin KML file using ExtendedData (near-lossless path).
 * @param {Element} extData - ExtendedData element from the icon Placemark
 * @param {import('./types').Coordinate[]} coordinates
 * @param {number} index - Run index (1-based)
 * @returns {import('./types').Run}
 */
function extractFromExtendedData(extData, coordinates, index) {
    const routeName = getDarwinText(extData, 'routeName') || '';
    const activityNameRaw = getDarwinText(extData, 'activityName') || 'Ride';
    const { activityID, activityName, lineIconId } = mapActivity(activityNameRaw);

    const startTimeUtc = getDarwinText(extData, 'startTimeUtc') || '';
    const runTimeSec = getDarwinFloat(extData, 'runTimeSec');
    const stoppedTimeSec = getDarwinFloat(extData, 'stoppedTimeSec');
    const distanceMi = getDarwinFloat(extData, 'distanceMi');
    const ascentFt = getDarwinFloat(extData, 'ascentFt');
    const descentFt = getDarwinFloat(extData, 'descentFt');
    const maxSpeedMph = getDarwinFloat(extData, 'maxSpeedMph');
    const calories = getDarwinFloat(extData, 'calories');
    const notes = getDarwinText(extData, 'notes') || '';
    const partnersStr = getDarwinText(extData, 'partners') || '';
    const source = getDarwinText(extData, 'source') || 'darwin-kml';

    // Convert imperial → metric for pipeline compatibility
    const distance = distanceMi / METERS_TO_MILES;
    const ascent = ascentFt / METERS_TO_FEET;
    const descent = descentFt / METERS_TO_FEET;
    const maxSpeed = maxSpeedMph / MS_TO_MPH;

    const avgSpeedMph = getDarwinFloat(extData, 'avgSpeedMph');

    // Use unix timestamp as synthetic ID — avoids collision with cyclemeter sequential IDs
    const syntheticId = startTimeUtc
        ? Math.floor(new Date(startTimeUtc).getTime() / 1000)
        : index;

    const run = {
        runID: syntheticId,
        routeID: syntheticId,
        activityID,
        name: routeName || `${activityName} ${index}`,
        startTime: startTimeUtc,
        runTime: runTimeSec,
        stoppedTime: stoppedTimeSec,
        distance,
        ascent,
        descent,
        calories,
        maxSpeed,
        notes,
        coordinates,
        extractedPoints: coordinates.length,
        currentPoints: coordinates.length,
        strippedPoints: 0,
        trimmedPoints: 0,
        activityName,
        lineIconId,
        lineColorId: LINE_COLOR_ID,
        // Exact imperial values from source DB — used by formatRunData and mapRunToSql
        // to avoid precision loss from metric round-trip conversion
        _darwinImperial: {
            distance: distanceMi,
            ascent: ascentFt,
            descent: descentFt,
            maxSpeed: maxSpeedMph,
            averageSpeed: avgSpeedMph,
            calories,
        },
    };

    if (partnersStr) {
        run.partnerNames = partnersStr.split(',').map(s => s.trim()).filter(Boolean);
    }

    return run;
}

/**
 * Extract run data from a Darwin KML file using CDATA description (lossy fallback path).
 * @param {string} placemarkName - Icon Placemark name (e.g., "Ride 1 :: THU :: 18 Aug 2011")
 * @param {string} description - CDATA description text
 * @param {import('./types').Coordinate[]} coordinates
 * @param {number} index - Run index (1-based)
 * @returns {import('./types').Run}
 */
function extractFromDescription(placemarkName, description, coordinates, index) {
    // Parse activity type and date from Placemark name
    const nameMatch = placemarkName.match(/(Ride|Hike)\s+\d+\s*::\s*\w+\s*::\s*(\d+\s+\w+\s+\d+)/i);
    const activityRaw = nameMatch ? nameMatch[1] : 'Ride';
    const dateStr = nameMatch ? nameMatch[2] : '';
    const { activityID, activityName, lineIconId } = mapActivity(activityRaw);

    // Parse stats from description CDATA
    const timeStr = parseDescField(description, /Start Time\s*:\s*(.+?)(?:<br>|$)/i) || '';
    const distanceMi = parseFloat(parseDescField(description, /Distance\s*:\s*([\d.]+)\s*miles/i) || '0');
    const maxSpeedMph = parseFloat(parseDescField(description, /Max Speed\s*:\s*([\d.]+)\s*mph/i) || '0');
    const ascentFt = parseFloat(parseDescField(description, /Ascent\s*:\s*([\d,]+)\s*feet/i)?.replace(/,/g, '') || '0');
    const runTimeStr = parseDescField(description, /Ride Time\s*:\s*([\d:]+)/i) || '00:00:00';
    const stopTimeStr = parseDescField(description, /Stop Time\s*:\s*([\d:]+)/i) || '00:00:00';

    // Extract notes: text after the last <br><br>
    const notesMatch = description.match(/<br><br>\s*([\s\S]*)$/i);
    const notes = notesMatch ? notesMatch[1].trim() : '';

    // Reconstruct UTC startTime
    const startTime = reconstructUtcStartTime(dateStr, timeStr);

    // Convert imperial → metric
    const distance = distanceMi / METERS_TO_MILES;
    const ascent = ascentFt / METERS_TO_FEET;
    const maxSpeed = maxSpeedMph / MS_TO_MPH;
    const runTime = parseDurationToSeconds(runTimeStr);
    const stoppedTime = parseDurationToSeconds(stopTimeStr);

    // Use unix timestamp as synthetic ID — avoids collision with cyclemeter sequential IDs
    const syntheticId = startTime
        ? Math.floor(new Date(startTime).getTime() / 1000)
        : index;

    return {
        runID: syntheticId,
        routeID: syntheticId,
        activityID,
        name: placemarkName || `${activityName} ${index}`,
        startTime,
        runTime,
        stoppedTime,
        distance,
        ascent,
        descent: 0,
        calories: 0,
        maxSpeed,
        notes,
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

/**
 * Extract run data from a Darwin KML file.
 * @param {ArrayBuffer} arrayBuffer - KML file contents
 * @param {import('./types').EtlConfig} config - Pipeline config
 * @returns {Promise<import('./types').Run[]>} Array of Run objects
 */
export async function extractFromDarwinKml(arrayBuffer, config) {
    const text = new TextDecoder('utf-8').decode(arrayBuffer);
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new Error('Invalid KML file: XML parse error');
    }

    const placemarks = doc.getElementsByTagName('Placemark');
    if (placemarks.length === 0) {
        throw new Error('Invalid Darwin KML: no Placemarks found');
    }

    // Separate icon Placemarks (have <Point>) from route Placemarks (have <LineString>)
    const iconPlacemarks = [];
    const routePlacemarks = [];

    for (let i = 0; i < placemarks.length; i++) {
        const pm = placemarks[i];
        if (pm.getElementsByTagName('Point').length > 0) {
            iconPlacemarks.push(pm);
        } else if (pm.getElementsByTagName('LineString').length > 0) {
            routePlacemarks.push(pm);
        }
    }

    if (iconPlacemarks.length === 0) {
        throw new Error('Invalid Darwin KML: no icon Placemarks found');
    }

    const runs = [];

    for (let i = 0; i < iconPlacemarks.length; i++) {
        const iconPm = iconPlacemarks[i];
        const routePm = i < routePlacemarks.length ? routePlacemarks[i] : null;

        // Parse coordinates from the route Placemark
        const coordinates = routePm
            ? parseCoordinates(routePm.getElementsByTagName('LineString')[0])
            : [];

        if (coordinates.length === 0) continue;

        const index = runs.length + 1;

        // Check for ExtendedData with darwin: namespace (near-lossless path)
        const extDataEls = iconPm.getElementsByTagName('ExtendedData');
        let hasdarwinData = false;
        let extData = null;

        for (let j = 0; j < extDataEls.length; j++) {
            const ed = extDataEls[j];
            if (getDarwinText(ed, 'startTimeUtc') != null || getDarwinText(ed, 'distanceMi') != null) {
                hasdarwinData = true;
                extData = ed;
                break;
            }
        }

        if (hasdarwinData) {
            runs.push(extractFromExtendedData(extData, coordinates, index));
        } else {
            const name = iconPm.getElementsByTagName('name')[0]?.textContent || '';
            const descEl = iconPm.getElementsByTagName('description')[0];
            const description = descEl ? descEl.textContent : '';
            runs.push(extractFromDescription(name, description, coordinates, index));
        }
    }

    if (runs.length === 0) {
        throw new Error('Invalid Darwin KML: no valid activities found');
    }

    return runs;
}
