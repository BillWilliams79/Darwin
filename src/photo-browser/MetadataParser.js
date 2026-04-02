/**
 * MetadataParser.js
 * Extracts capture date and GPS coordinates from image/video files.
 * Never falls back to file.lastModified — returns null when data is unavailable.
 */

import exifr from 'exifr';

const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v']);

function getExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

/**
 * Extract date and GPS from an image file using exifr.
 * @param {File} file
 * @returns {Promise<{ date: Date|null, lat: number|null, lon: number|null }>}
 */
export async function getImageMetadata(file) {
    try {
        const exif = await exifr.parse(file, {
            pick: ['DateTimeOriginal', 'CreateDate', 'DateTime'],
            gps: true,
        });
        if (!exif) return { date: null, lat: null, lon: null };

        const rawDate = exif.DateTimeOriginal ?? exif.CreateDate ?? exif.DateTime ?? null;
        const date = rawDate instanceof Date ? rawDate : null;

        const lat = typeof exif.latitude === 'number' ? exif.latitude : null;
        const lon = typeof exif.longitude === 'number' ? exif.longitude : null;

        return { date, lat, lon };
    } catch {
        return { date: null, lat: null, lon: null };
    }
}

// MP4 epoch starts at 1904-01-01; a creation_time of 0 produces this date.
// Any date before 2000 is almost certainly invalid metadata.
const MIN_VALID_DATE = new Date('2000-01-01');

// Read only the first portion of a video file — the moov atom with creation
// metadata is typically near the start. This avoids loading entire GB-sized
// video files into memory.
const VIDEO_READ_BYTES = 8 * 1024 * 1024; // 8 MB — moov atom for long 4K videos can be several MB

/**
 * Extract creation date from a video file using mp4box.
 * Reads only the first 2MB to find the moov/mvhd atom.
 * Supports .mp4, .mov, .m4v — returns null for .avi and on any error.
 * @param {File} file
 * @returns {Promise<{ date: Date|null, lat: null }>}
 */
export async function getVideoMetadata(file) {
    const ext = getExtension(file.name);
    if (!VIDEO_EXTENSIONS.has(ext)) {
        return { date: null, lat: null, lon: null };
    }

    try {
        const MP4Box = (await import('mp4box')).default;
        const slice = file.slice(0, Math.min(file.size, VIDEO_READ_BYTES));
        const buffer = await slice.arrayBuffer();
        buffer.fileStart = 0;

        return await new Promise((resolve) => {
            const mp4 = MP4Box.createFile();
            let resolved = false;

            mp4.onReady = (info) => {
                if (resolved) return;
                resolved = true;
                const created = info.created;
                const date = created instanceof Date
                    && !isNaN(created.getTime())
                    && created >= MIN_VALID_DATE
                    ? created
                    : null;
                resolve({ date, lat: null, lon: null });
            };

            mp4.onError = () => {
                if (resolved) return;
                resolved = true;
                resolve({ date: null, lat: null, lon: null });
            };

            mp4.appendBuffer(buffer);
            mp4.flush();

            // Safety timeout — mp4box may not fire onReady for partial reads
            // or malformed files
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    resolve({ date: null, lat: null, lon: null });
                }
            }, 2000);
        });
    } catch {
        return { date: null, lat: null, lon: null };
    }
}

/**
 * Dispatch to the appropriate metadata extractor based on mediaType.
 * @param {File} file
 * @param {'image'|'video'} mediaType
 * @returns {Promise<{ date: Date|null, lat: number|null, lon: number|null }>}
 */
export async function getMediaMetadata(file, mediaType) {
    if (mediaType === 'video') {
        return getVideoMetadata(file);
    }
    return getImageMetadata(file);
}
