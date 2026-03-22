/**
 * @module cyclemeter/load/kml
 * Generate KML output matching getterdone.kml format for Google MyMaps.
 */

import { KML_ICON_URL, KML_LINE_WIDTH, KML_LINE_WIDTH_HIGHLIGHT, LINE_COLOR } from '../config';

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
 * Generate an icon style block (normal + highlight + StyleMap).
 * @param {number} iconId - 1522 (ride) or 1596 (hike)
 * @param {string} colorId - Hex color ID (e.g., '1167B1')
 * @returns {string}
 */
function generateIconStyles(iconId, colorId) {
    const id = `icon-${iconId}-${colorId}`;
    return `<Style id="${id}-normal">` +
        `<IconStyle><color>${LINE_COLOR}</color><scale>1</scale>` +
        `<Icon><href>${KML_ICON_URL}</href></Icon></IconStyle>` +
        `<LabelStyle><scale>0</scale></LabelStyle></Style>\n` +
        `<Style id="${id}-highlight">` +
        `<IconStyle><color>${LINE_COLOR}</color><scale>1</scale>` +
        `<Icon><href>${KML_ICON_URL}</href></Icon></IconStyle>` +
        `<LabelStyle><scale>1</scale></LabelStyle></Style>\n` +
        `<StyleMap id="${id}">` +
        `<Pair><key>normal</key><styleUrl>#${id}-normal</styleUrl></Pair>` +
        `<Pair><key>highlight</key><styleUrl>#${id}-highlight</styleUrl></Pair>` +
        `</StyleMap>`;
}

/**
 * Generate the line style block.
 * @param {string} colorId
 * @returns {string}
 */
function generateLineStyles(colorId) {
    const id = `line-${colorId}-5000`;
    return `<Style id="${id}-normal">` +
        `<LineStyle><color>${LINE_COLOR}</color><width>${KML_LINE_WIDTH}</width></LineStyle></Style>\n` +
        `<Style id="${id}-highlight">` +
        `<LineStyle><color>${LINE_COLOR}</color><width>${KML_LINE_WIDTH_HIGHLIGHT}</width></LineStyle></Style>\n` +
        `<StyleMap id="${id}">` +
        `<Pair><key>normal</key><styleUrl>#${id}-normal</styleUrl></Pair>` +
        `<Pair><key>highlight</key><styleUrl>#${id}-highlight</styleUrl></Pair>` +
        `</StyleMap>`;
}

/**
 * Generate a complete KML document string from transformed runs.
 * Output format matches getterdone.kml exactly.
 * @param {import('../types').TransformedRun[]} runs
 * @param {import('../types').EtlConfig} config
 * @returns {string}
 */
export function generateKml(runs, config) {
    const colorId = '1167B1';
    const currentDate = formatCurrentDate();
    const description = `${escapeXml(config.mapDescription)} Map updated ${currentDate}`;

    const parts = [];

    // Header
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
    parts.push(`<Document>`);
    parts.push(`<name>${escapeXml(config.mapTitle)}</name>`);
    parts.push(`<description>${description}</description>`);

    // Style blocks: ride icon, hike icon, line
    parts.push(generateIconStyles(1522, colorId));
    parts.push(generateIconStyles(1596, colorId));
    parts.push(generateLineStyles(colorId));

    // Folder with placemarks
    parts.push('<Folder>');
    parts.push(`<name>Activities: ${config.minDelta}m spacing</name>`);

    runs.forEach((run, index) => {
        const runNumber = index + 1;
        const iconStyleId = `icon-${run.lineIconId}-${colorId}`;
        const lineStyleId = `line-${colorId}-5000`;

        // First coordinate for the icon point
        const firstCoord = run.coordinates.length > 0 ? run.coordinates[0] : null;
        const pointCoords = firstCoord ? `${firstCoord.longitude},${firstCoord.latitude}` : '0,0';

        // Icon Placemark
        parts.push(`<Placemark>`);
        parts.push(`<name>${run.activityName} ${runNumber} :: ${run.titleFormattedStart}</name>`);
        parts.push(`<description><![CDATA[${buildPointDescription(run)}]]></description>`);
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
        parts.push(`<LineString><tessellate>1</tessellate>`);
        parts.push(`<coordinates>${coordString}</coordinates>`);
        parts.push('</LineString></Placemark>');
    });

    parts.push('</Folder>');
    parts.push('</Document>');
    parts.push('</kml>');

    return parts.join('\n');
}
