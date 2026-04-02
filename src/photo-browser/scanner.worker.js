/**
 * scanner.worker.js
 * Web Worker: walks a FileSystemDirectoryHandle, parses EXIF/GPS metadata,
 * and posts progress/complete messages back to the main thread.
 *
 * Imported as: new Worker(new URL('./scanner.worker.js', import.meta.url), { type: 'module' })
 *
 * Messages received:
 *   { type: 'start', dirHandle: FileSystemDirectoryHandle }
 *
 * Messages posted:
 *   { type: 'progress', scanned: number }
 *   { type: 'complete', index: Array }
 *   { type: 'error', message: string }
 */

import { walkDirectory } from './DirectoryScanner.js';
import { getMediaMetadata } from './MetadataParser.js';

self.onmessage = async ({ data }) => {
    if (data.type !== 'start') return;

    const { dirHandle } = data;
    const index = [];
    let scanned = 0;

    try {
        for await (const entry of walkDirectory(dirHandle)) {
            let file;
            try {
                file = await entry.handle.getFile();
            } catch {
                // File may have disappeared or be inaccessible — skip silently
                continue;
            }

            const { date, lat, lon } = await getMediaMetadata(file, entry.mediaType);

            index.push({
                name: entry.name,
                path: entry.path,
                dateTaken: date ? date.toISOString() : null,
                lat,
                lon,
                size: file.size,
                mediaType: entry.mediaType,
            });

            scanned++;
            if (scanned % 50 === 0) {
                self.postMessage({ type: 'progress', scanned });
            }
        }

        self.postMessage({ type: 'complete', index });
    } catch (err) {
        self.postMessage({ type: 'error', message: err?.message ?? String(err) });
    }
};
