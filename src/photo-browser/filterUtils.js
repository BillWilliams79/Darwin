/**
 * filterUtils.js
 * Shared dedup, time-range, and filtering utilities for the photo/video index.
 * Extracted from PhotoBrowser.jsx so both PhotoBrowser and PhotoMarkerLayer can reuse them.
 */

/** Extension preference for deduplication — lower = preferred */
const EXT_PREF = { '.jpeg': 0, '.jpg': 0, '.png': 1, '.heic': 2, '.heif': 2, '.mov': 3, '.mp4': 3, '.m4v': 3, '.tiff': 4, '.webp': 1, '.avi': 5 };

const isOriginal = (path) => path.includes('/originals/');

/**
 * Deduplicate the raw photo index by UUID stem.
 * Prefers JPEG > PNG > HEIC > video > TIFF by extension.
 * Merges GPS and dateTaken across duplicates.
 * Returns sorted by dateTaken ascending.
 */
export function deduplicateIndex(index) {
    if (!index || index.length === 0) return [];

    const byKey = new Map();
    for (const item of index) {
        const dotIdx = item.name.lastIndexOf('.');
        const stem = dotIdx >= 0 ? item.name.slice(0, dotIdx) : item.name;
        const ext = dotIdx >= 0 ? item.name.slice(dotIdx).toLowerCase() : '';
        const uuid = stem.length >= 36 ? stem.slice(0, 36).toUpperCase() : stem.toLowerCase();

        const existing = byKey.get(uuid);
        if (!existing) {
            byKey.set(uuid, { item, ext });
        } else {
            const newPref = EXT_PREF[ext] ?? 9;
            const oldPref = EXT_PREF[existing.ext] ?? 9;
            if (newPref < oldPref) {
                const merged = { ...item };
                if (!merged.dateTaken && existing.item.dateTaken) merged.dateTaken = existing.item.dateTaken;
                if (existing.item.lat != null && merged.lat == null) { merged.lat = existing.item.lat; merged.lon = existing.item.lon; }
                byKey.set(uuid, { item: merged, ext });
            } else if (newPref === oldPref && isOriginal(item.path) && !isOriginal(existing.item.path)) {
                byKey.set(uuid, { item, ext });
            } else {
                if (isOriginal(item.path) && item.dateTaken && !existing.item.dateTaken) existing.item.dateTaken = item.dateTaken;
                if (item.lat != null && existing.item.lat == null) { existing.item.lat = item.lat; existing.item.lon = item.lon; }
            }
        }
    }

    const deduped = [...byKey.values()].map((v) => v.item);
    deduped.sort((a, b) => {
        const da = a.dateTaken ? new Date(a.dateTaken).getTime() : 0;
        const db = b.dateTaken ? new Date(b.dateTaken).getTime() : 0;
        return da - db;
    });
    return deduped;
}

/**
 * Compute the time range for a ride, with optional before/after buffers.
 * @param {object} run - ride object with start_time, run_time_sec, stopped_time_sec
 * @param {number} beforeMin - minutes before activity start (default 0)
 * @param {number} afterMin - minutes after activity end (default 0)
 * @returns {{ filterStart: Date, filterEnd: Date } | null} null if run is missing
 */
export function computeRideTimeRange(run, beforeMin = 0, afterMin = 0) {
    if (!run) return null;
    const startUtc = new Date(run.start_time.endsWith('Z') ? run.start_time : run.start_time + 'Z');
    const endUtc = new Date(startUtc.getTime() + ((run.run_time_sec || 0) + (run.stopped_time_sec || 0)) * 1000);
    const filterStart = new Date(startUtc.getTime() - beforeMin * 60 * 1000);
    const filterEnd = new Date(endUtc.getTime() + afterMin * 60 * 1000);
    return { filterStart, filterEnd };
}

/**
 * Filter index entries to those whose dateTaken falls within [start, end].
 * Items without dateTaken are excluded.
 */
export function filterByTimeRange(items, filterStart, filterEnd) {
    if (!filterStart && !filterEnd) return items;
    return items.filter((item) => {
        if (!item.dateTaken) return false;
        const d = new Date(item.dateTaken);
        if (filterStart && d < filterStart) return false;
        if (filterEnd && d > filterEnd) return false;
        return true;
    });
}
