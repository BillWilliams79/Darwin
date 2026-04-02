/**
 * @module cyclemeter/extractCyclemeterKml
 * Extract ride data from a Cyclemeter KML file.
 * Returns Run[] compatible with the existing transform/load pipeline.
 *
 * Cyclemeter KML files contain rich structured metadata in the abvio: namespace
 * (runTime, distance, ascent, etc.) and path coordinates in LineString elements.
 * Stats come directly from abvio metadata — no computation from trackpoints needed.
 */

import { ACTIVITY_RIDE_ID, ICON_RIDE, ICON_HIKE, LINE_COLOR_ID } from './config';

/**
 * Map Cyclemeter activity name to pipeline activity metadata.
 * Cyclemeter uses "Cycle" (not "cycling"), "Walk", "Hike", etc.
 * @param {string} activityName - Value from abvio:activityName
 * @returns {{ activityID: number, activityName: string, lineIconId: number }}
 */
function mapCyclemeterActivity(activityName) {
    const normalized = (activityName || '').toLowerCase().trim();
    if (normalized === 'hike' || normalized === 'walk') {
        return { activityID: 5, activityName: 'Hike', lineIconId: ICON_HIKE };
    }
    return { activityID: ACTIVITY_RIDE_ID, activityName: 'Ride', lineIconId: ICON_RIDE };
}

/**
 * Read a text value from an abvio-namespaced element.
 * Tries namespace-aware lookup first, falls back to prefixed tag name (jsdom compat).
 * @param {Element} parent - Parent element to search within
 * @param {string} localName - Local name without prefix (e.g., 'runID')
 * @returns {string|null}
 */
function getAbvioText(parent, localName) {
    const els = parent.getElementsByTagNameNS('http://cyclemeter.com/xmlschemas/1', localName);
    if (els.length > 0) return els[0].textContent;
    const prefixed = parent.getElementsByTagName('abvio:' + localName);
    if (prefixed.length > 0) return prefixed[0].textContent;
    return null;
}

/**
 * Read a float value from an abvio-namespaced element.
 * @param {Element} parent - Parent element to search within
 * @param {string} localName - Local name without prefix
 * @returns {number} Parsed float, or 0 if element not found
 */
function getAbvioFloat(parent, localName) {
    const text = getAbvioText(parent, localName);
    return text != null ? parseFloat(text) : 0;
}

/**
 * Parse LineString coordinates from all Placemark elements.
 * KML coordinate format: lon,lat,ele per entry (whitespace-separated).
 * Collects from all LineString elements across all segment Placemarks.
 * @param {Document} doc - Parsed KML document
 * @returns {import('./types').Coordinate[]}
 */
function parseLineStringCoordinates(doc) {
    const coordinates = [];
    const lineStrings = doc.getElementsByTagName('LineString');

    for (let i = 0; i < lineStrings.length; i++) {
        const coordsEl = lineStrings[i].getElementsByTagName('coordinates')[0];
        if (!coordsEl) continue;

        const text = coordsEl.textContent.trim();
        const entries = text.split(/\s+/).filter(s => s.length > 0);

        for (const entry of entries) {
            const parts = entry.split(',');
            if (parts.length >= 2) {
                coordinates.push({
                    longitude: parseFloat(parts[0]),
                    latitude: parseFloat(parts[1]),
                    altitude: parts.length >= 3 ? parseFloat(parts[2]) : null,
                    timestamp: null,
                });
            }
        }
    }

    return coordinates;
}

/**
 * Extract run data from a Cyclemeter KML file.
 * @param {ArrayBuffer} arrayBuffer - KML file contents
 * @param {import('./types').EtlConfig} config - Pipeline config (used downstream, not for extraction)
 * @returns {Promise<import('./types').Run[]>} Array with single Run object
 */
export async function extractFromCyclemeterKml(arrayBuffer, config) {
    const text = new TextDecoder('utf-8').decode(arrayBuffer);
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new Error('Invalid KML file: XML parse error');
    }

    const extData = doc.getElementsByTagName('ExtendedData')[0];
    if (!extData) {
        throw new Error('Invalid Cyclemeter KML: no ExtendedData element found');
    }

    // Extract metadata from abvio namespace
    const routeID = getAbvioFloat(extData, 'routeID');
    const routeName = getAbvioText(extData, 'routeName') || 'Untitled';
    const activityNameRaw = getAbvioText(extData, 'activityName') || '';
    const startTime = getAbvioText(extData, 'startTime') || '';

    // Use unix timestamp as synthetic ID — avoids collision with cyclemeter bulk import IDs
    const syntheticId = startTime
        ? Math.floor(new Date(startTime).getTime() / 1000)
        : 0;
    const runTime = getAbvioFloat(extData, 'runTime');
    const stoppedTime = getAbvioFloat(extData, 'stoppedTime');
    const distance = getAbvioFloat(extData, 'distance');
    const ascent = getAbvioFloat(extData, 'ascent');
    const descent = getAbvioFloat(extData, 'descent');
    const calories = getAbvioFloat(extData, 'calories');
    const maxSpeed = getAbvioFloat(extData, 'maxSpeed');
    const notes = getAbvioText(extData, 'notes') || '';

    const { activityID, activityName, lineIconId } = mapCyclemeterActivity(activityNameRaw);

    const coordinates = parseLineStringCoordinates(doc);

    if (coordinates.length === 0) {
        throw new Error('Invalid Cyclemeter KML: no coordinates found');
    }

    const run = {
        runID: syntheticId,
        routeID,
        activityID,
        name: routeName,
        startTime,
        runTime,
        stoppedTime,
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
    };

    return [run];
}
