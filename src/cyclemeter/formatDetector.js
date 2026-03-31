/**
 * @module cyclemeter/formatDetector
 * Extensible file format detection for the ETL import pipeline.
 * Identifies input file format by inspecting content (magic bytes, XML structure).
 */

/**
 * @typedef {Object} FormatInfo
 * @property {string} format - Machine-readable format ID (e.g., 'cyclemeter', 'strava-gpx')
 * @property {string} label - Human-readable label (e.g., 'Cyclemeter Database', 'Strava GPX')
 * @property {string} source - Value for map_runs.source column
 */

const SQLITE_MAGIC = 'SQLite format 3\0';

/**
 * Check if file content starts with SQLite magic bytes.
 * @param {ArrayBuffer} buffer - File content (only first 16 bytes needed)
 * @returns {boolean}
 */
function isSqliteFile(buffer) {
    if (buffer.byteLength < 16) return false;
    const header = new TextDecoder('ascii').decode(buffer.slice(0, 16));
    return header === SQLITE_MAGIC;
}

/**
 * Check if file content is GPX XML (has <gpx root element).
 * @param {ArrayBuffer} buffer - File content
 * @returns {boolean}
 */
function isGpxFile(buffer) {
    if (buffer.byteLength < 10) return false;
    // Read first 500 chars to find the root element without loading a huge file
    const snippet = new TextDecoder('utf-8').decode(buffer.slice(0, 500));
    return /<gpx[\s>]/i.test(snippet);
}

/**
 * Check if file content is a Cyclemeter KML export (<kml root + cyclemeter.com namespace).
 * @param {ArrayBuffer} buffer - File content
 * @returns {boolean}
 */
function isCyclemeterKml(buffer) {
    if (buffer.byteLength < 10) return false;
    const snippet = new TextDecoder('utf-8').decode(buffer.slice(0, 500));
    return /<kml[\s>]/i.test(snippet) && /cyclemeter\.com/i.test(snippet);
}

/**
 * Check if file content is a Cyclemeter GPX export (<gpx root + "cyclemeter" in creator/namespace).
 * @param {ArrayBuffer} buffer - File content
 * @returns {boolean}
 */
function isCyclemeterGpx(buffer) {
    if (buffer.byteLength < 10) return false;
    const snippet = new TextDecoder('utf-8').decode(buffer.slice(0, 500));
    return /<gpx[\s>]/i.test(snippet) && /cyclemeter/i.test(snippet);
}

/**
 * Check if file content is an MTB Project GPX export (GPX 1.0 namespace, no Cyclemeter marker).
 * MTB Project exports trail files as GPX 1.0 with lat/lon-only trackpoints (no timestamps).
 * @param {ArrayBuffer} buffer - File content
 * @returns {boolean}
 */
function isMtbProjectGpx(buffer) {
    if (buffer.byteLength < 10) return false;
    const snippet = new TextDecoder('utf-8').decode(buffer.slice(0, 500));
    return /<gpx[\s>]/i.test(snippet)
        && /topografix\.com\/GPX\/1\/0/i.test(snippet)
        && !/cyclemeter/i.test(snippet);
}

/**
 * Format registry — order matters (first match wins).
 * To add a new format: add an entry here and write a corresponding extractor.
 * @type {Array<{ test: function(ArrayBuffer): boolean } & FormatInfo>}
 */
const FORMAT_REGISTRY = [
    { test: isSqliteFile,    format: 'cyclemeter',     label: 'Cyclemeter Database', source: 'cyclemeter' },
    { test: isCyclemeterKml, format: 'cyclemeter-kml', label: 'Cyclemeter KML',      source: 'cyclemeter-kml' },
    { test: isCyclemeterGpx, format: 'cyclemeter-gpx', label: 'Cyclemeter GPX',      source: 'cyclemeter-gpx' },
    { test: isMtbProjectGpx, format: 'mtbproject-gpx', label: 'MTB Project GPX',     source: 'mtbproject' },
    { test: isGpxFile,       format: 'strava-gpx',     label: 'Strava GPX',          source: 'strava' },
];

/**
 * Detect the format of a dropped file by inspecting its content.
 * @param {File} file - The dropped File object
 * @returns {Promise<FormatInfo>} Detected format info
 * @throws {Error} If no registered format matches
 */
export async function detectFormat(file) {
    const buffer = await file.arrayBuffer();

    for (const entry of FORMAT_REGISTRY) {
        if (entry.test(buffer)) {
            return { format: entry.format, label: entry.label, source: entry.source };
        }
    }

    throw new Error(
        'Unrecognized file format. Supported formats: Cyclemeter database (.db), Cyclemeter KML (.kml), Cyclemeter GPX (.gpx), Strava GPX (.gpx), MTB Project GPX (.gpx)'
    );
}
