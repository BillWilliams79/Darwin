/**
 * handleDB.js
 * IndexedDB helpers for persisting the scan index from the Photos proxy.
 * DB: 'photo-browser-db', version 1
 * Stores: 'handles' (legacy, unused), 'index', 'meta'
 */

import { openDB } from 'idb';

const DB_NAME = 'photo-browser-db';
const DB_VERSION = 1;

function getDB() {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('handles')) {
                db.createObjectStore('handles');
            }
            if (!db.objectStoreNames.contains('index')) {
                db.createObjectStore('index');
            }
            if (!db.objectStoreNames.contains('meta')) {
                db.createObjectStore('meta');
            }
        },
    });
}

/**
 * Save the full scan index and associated metadata.
 * @param {Array} index - array of { name, path, dateTaken, lat, lon, size, mediaType }
 * @param {{ scannedAt: string, fileCount: number, folderName: string }} meta
 */
export async function saveIndex(index, meta) {
    const db = await getDB();
    const tx = db.transaction(['index', 'meta'], 'readwrite');
    await tx.objectStore('index').put(index, 'photo-index');
    await tx.objectStore('meta').put(meta, 'scan-meta');
    await tx.done;
}

/**
 * Load the saved index array, or null if not yet scanned.
 */
export async function loadIndex() {
    try {
        const db = await getDB();
        return await db.get('index', 'photo-index') ?? null;
    } catch {
        return null;
    }
}

/**
 * Load scan metadata (scannedAt, fileCount, folderName), or null.
 */
export async function loadMeta() {
    try {
        const db = await getDB();
        return await db.get('meta', 'scan-meta') ?? null;
    } catch {
        return null;
    }
}

/**
 * Clear the index and meta.
 */
export async function clearCache() {
    const db = await getDB();
    const tx = db.transaction(['index', 'meta'], 'readwrite');
    await tx.objectStore('index').delete('photo-index');
    await tx.objectStore('meta').delete('scan-meta');
    await tx.done;
}
