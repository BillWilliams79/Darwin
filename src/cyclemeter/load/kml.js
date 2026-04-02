/**
 * @module cyclemeter/load/kml
 * Generate KML output matching getterdone.kml format for Google MyMaps.
 */

import { KML_ICON_URL, KML_LINE_WIDTH, LINE_COLOR } from '../config';

/**
 * Format the current date as "MMM D, YYYY" (e.g., "Dec 13, 2025").
 * @returns {string}
 */
function formatCurrentDate() {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    return `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

/**
 * Escape XML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Build the CDATA description for a point placemark.
 * @param {import('../types').TransformedRun} run
 * @returns {string}
 */
function buildPointDescription(run) {
    return `Start Time : ${run.descFormattedStart}<br>` +
           `Distance : ${run.distance} miles <br>` +
           `Average Speed : ${run.averageSpeed} mph<br>` +
           `Max Speed : ${run.maxSpeed} mph<br>` +
           `Ascent : ${run.ascent} feet<br>` +
           `Ride Time : ${run.runTime}<br>` +
           `Stop Time : ${run.stoppedTime}<br><br>` +
           `${run.notes || ''}`;
}

/**
 * Build the CDATA description for a route placemark.
 * @param {import('../types').TransformedRun} run
 * @returns {string}
 */
function buildRouteDescription(run) {
    return `Date : ${run.titleFormattedStart}<br>` +
           `Start Time : ${run.descFormattedStart}<br>` +
           `Distance : ${run.distance} miles <br>` +
           `Average Speed : ${run.averageSpeed} mph<br>` +
           `Max Speed : ${run.maxSpeed} mph<br>` +
           `Ascent : ${run.ascent} feet<br>` +
           `Ride Time : ${run.runTime}<br>` +
           `Stop Time : ${run.stoppedTime}<br><br>` +
           `${run.notes || ''}`;
}

/**
 * Generate a single icon style block (Maps-optimized: no StyleMap, no LabelStyle, no color tint).
 * Icon ID (e.g., 1522, 1596) is embedded in the style name — MyMaps uses it to resolve stock icons.
 * @param {number} iconId - 1522 (ride) or 1596 (hike)
 * @param {string} colorId - Hex color ID (e.g., '1167B1')
 * @returns {string}
 */
function generateIconStyle(iconId, colorId) {
    const id = `icon-${iconId}-${colorId}`;
    return `<Style id="${id}">` +
        `<IconStyle><scale>1</scale>` +
        `<Icon><href>${KML_ICON_URL}</href></Icon></IconStyle></Style>`;
}

/**
 * Generate a single line style block (Maps-optimized: no StyleMap, no highlight).
 * @param {string} colorId
 * @returns {string}
 */
function generateLineStyle(colorId) {
    const id = `line-${colorId}`;
    return `<Style id="${id}">` +
        `<LineStyle><color>${LINE_COLOR}</color><width>${KML_LINE_WIDTH}</width></LineStyle></Style>`;
}

const DARWIN_NAMESPACE = 'https://darwin.one/kml/1';

/**
 * Build an ExtendedData block with darwin:-namespaced elements for lossless re-import.
 * Only emitted when darwinCompatibility is enabled in config.
 * @param {import('../types').TransformedRun} run
 * @returns {string}
 */
function buildExtendedData(run) {
    const el = (tag, value) => `<darwin:${tag}>${escapeXml(String(value ?? ''))}</darwin:${tag}>`;
    const lines = ['<ExtendedData>'];
    lines.push(el('startTimeUtc', run.startTimeUtc || ''));
    lines.push(el('runTimeSec', run.runTimeSec ?? 0));
    lines.push(el('stoppedTimeSec', run.stoppedTimeSec ?? 0));
    lines.push(el('distanceMi', run.distance));
    lines.push(el('ascentFt', run.ascent));
    lines.push(el('descentFt', run.descent));
    lines.push(el('maxSpeedMph', run.maxSpeed));
    lines.push(el('avgSpeedMph', run.averageSpeed));
    lines.push(el('calories', run.calories));
    lines.push(el('routeName', run.name));
    lines.push(el('activityName', run.activityName));
    lines.push(el('notes', run.notes));
    lines.push(el('source', run.source || ''));
    if (run.partnerNames && run.partnerNames.length > 0) {
        lines.push(el('partners', run.partnerNames.join(', ')));
    }
    lines.push('</ExtendedData>');
    return lines.join('');
}

/**
 * Generate a complete KML document string from transformed runs.
 * Output format matches getterdone.kml exactly.
 * When config.darwinCompatibility is true, adds darwin: ExtendedData for lossless re-import.
 * @param {import('../types').TransformedRun[]} runs
 * @param {import('../types').EtlConfig} config
 * @returns {string}
 */
export function generateKml(runs, config) {
    const colorId = '1167B1';
    const currentDate = formatCurrentDate();
    const description = `${escapeXml(config.mapDescription)} Map updated ${currentDate}`;
    const darwinCompat = config.darwinCompatibility || false;

    const parts = [];

    // Header
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    if (darwinCompat) {
        parts.push(`<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:darwin="${DARWIN_NAMESPACE}">`);
    } else {
        parts.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
    }
    parts.push(`<Document>`);
    parts.push(`<name>${escapeXml(config.mapTitle)}</name>`);
    parts.push(`<description>${description}</description>`);

    // Style blocks: ride icon, hike icon, line (Maps-optimized — no StyleMap/highlight)
    parts.push(generateIconStyle(1522, colorId));
    parts.push(generateIconStyle(1596, colorId));
    parts.push(generateLineStyle(colorId));

    // Folder with placemarks
    parts.push('<Folder>');
    parts.push(`<name>Activities: ${config.minDelta}m spacing</name>`);

    runs.forEach((run, index) => {
        const runNumber = index + 1;
        const iconStyleId = `icon-${run.lineIconId}-${colorId}`;
        const lineStyleId = `line-${colorId}`;

        // First coordinate for the icon point
        const firstCoord = run.coordinates.length > 0 ? run.coordinates[0] : null;
        const pointCoords = firstCoord ? `${firstCoord.longitude},${firstCoord.latitude}` : '0,0';

        // Icon Placemark
        parts.push(`<Placemark>`);
        parts.push(`<name>${run.activityName} ${runNumber} :: ${run.titleFormattedStart}</name>`);
        parts.push(`<description><![CDATA[${buildPointDescription(run)}]]></description>`);
        if (darwinCompat) {
            parts.push(buildExtendedData(run));
        }
        parts.push(`<styleUrl>#${iconStyleId}</styleUrl>`);
        parts.push(`<Point><coordinates>${pointCoords}</coordinates></Point>`);
        parts.push('</Placemark>');

        // Route Placemark
        const coordString = run.coordinates
            .map(c => `${c.longitude},${c.latitude}`)
            .join('');
        parts.push('<Placemark>');
        parts.push('<name>Route</name>');
        parts.push(`<description><![CDATA[${buildRouteDescription(run)}]]></description>`);
        parts.push(`<styleUrl>#${lineStyleId}</styleUrl>`);
        parts.push(`<LineString><coordinates>${coordString}</coordinates>`);
        parts.push('</LineString></Placemark>');
    });

    parts.push('</Folder>');
    parts.push('</Document>');
    parts.push('</kml>');

    return parts.join('\n');
}
