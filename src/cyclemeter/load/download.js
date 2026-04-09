/**
 * @module cyclemeter/load/download
 * File download utility using the Blob pattern (matches exportService.js).
 */

/**
 * Download a string as a file in the browser.
 * @param {string} content - File content
 * @param {string} filename - Filename including extension
 * @param {string} [mimeType='application/vnd.google-earth.kml+xml'] - MIME type
 */
export function downloadFile(content, filename, mimeType = 'application/vnd.google-earth.kml+xml') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}
