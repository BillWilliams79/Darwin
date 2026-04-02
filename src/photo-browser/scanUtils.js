/**
 * scanUtils.js
 * Shared scan launcher — two paths:
 *   1. Photos proxy (localhost:8091) — reads Apple Photos.sqlite server-side, returns JSON index
 *   2. Filesystem walk — walks directory and parses metadata in the main thread (fallback)
 *
 * Used by RouteCard (first-click flow) and PhotoSettingsView (re-scan).
 */

import useScanStore from './useScanStore.js';
import { saveIndex } from './handleDB.js';
import { walkDirectory } from './DirectoryScanner.js';
import { getMediaMetadata } from './MetadataParser.js';
import { PHOTOS_PROXY_URL } from './proxyConfig.js';

let elapsedTimer = null;
let cancelledRef = false;

/**
 * Abort any in-progress scan and clean up.
 */
function abortActiveScan() {
    cancelledRef = true;
    if (elapsedTimer) {
        clearInterval(elapsedTimer);
        elapsedTimer = null;
    }
}

/**
 * Check if the Photos proxy is running and responsive.
 * @returns {Promise<{ available: boolean, assetCount?: number }>}
 */
export async function checkPhotosProxy() {
    try {
        const resp = await fetch(`${PHOTOS_PROXY_URL}/photos/health`, {
            signal: AbortSignal.timeout(2000),
        });
        if (!resp.ok) return { available: false };
        const data = await resp.json();
        return { available: data.status === 'ok', assetCount: data.assetCount };
    } catch {
        return { available: false };
    }
}

/**
 * Fetch the full asset index from the Photos proxy.
 * @param {function} diag - diagnostic logger
 * @returns {Promise<Array>} - index array in standard shape
 */
async function fetchProxyIndex(diag) {
    diag('Fetching asset index from Photos proxy...');
    const start = Date.now();

    const resp = await fetch(`${PHOTOS_PROXY_URL}/photos/assets`);
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Photos proxy returned ${resp.status}: ${body}`);
    }

    const index = await resp.json();
    const elapsed = Date.now() - start;
    diag(`Received ${index.length.toLocaleString()} assets from Photos proxy in ${elapsed}ms`);
    return index;
}

/**
 * Detect whether the dirHandle needs a path prefix for proxy index paths.
 * Proxy paths start with "originals/..." (relative to .photoslibrary root).
 * If dirHandle points to a parent folder (e.g. Pictures), we need to prepend
 * the .photoslibrary directory name so getFileHandle can navigate correctly.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<string>} prefix to prepend to proxy paths (empty string if none needed)
 */
export async function detectProxyPathPrefix(dirHandle) {
    // Case 1: dirHandle IS the .photoslibrary — "originals" is a direct child
    try {
        await dirHandle.getDirectoryHandle('originals');
        return '';
    } catch {
        // Not found — try to find .photoslibrary inside dirHandle
    }

    // Case 2: dirHandle is a parent (e.g. Pictures) containing the library
    for await (const [name, handle] of dirHandle.entries()) {
        if (name.endsWith('.photoslibrary') && handle.kind === 'directory') {
            try {
                await handle.getDirectoryHandle('originals');
                return name;
            } catch {
                // This .photoslibrary doesn't have originals — keep looking
            }
        }
    }

    // Couldn't detect — return empty and let getFileHandle fail per-item
    return '';
}

const BATCH_SIZE = 50;

/**
 * Start a scan. Two paths:
 *   1. Photos proxy — dirHandle is optional (proxy serves both index and file bytes)
 *   2. Filesystem walk — requires dirHandle (File System Access API)
 *
 * @param {FileSystemDirectoryHandle|null} dirHandle - required for filesystem walk, optional for proxy
 * @param {string} folderName - display name for the folder
 */
export function startScan(dirHandle = null, folderName = '') {
    abortActiveScan();
    cancelledRef = false;

    const store = useScanStore.getState();
    store.setDirHandle(dirHandle, folderName);
    store.setScanState('scanning');
    store.setScanProgress({ scanned: 0 });
    store.setScanElapsed(0);
    store.setScanError(null);
    store.setIndex([]);
    store.clearSelection();
    store.clearDiag();

    // Elapsed timer — ticks every second
    const startTime = Date.now();
    elapsedTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        useScanStore.getState().setScanElapsed(elapsed);
    }, 1000);

    // Run the scan asynchronously in the main thread
    (async () => {
        const diag = (line) => useScanStore.getState().appendDiag(line);

        try {
            // --- Try Photos proxy first ---
            const proxy = await checkPhotosProxy();

            if (proxy.available) {
                diag(`Photos proxy detected (${proxy.assetCount?.toLocaleString() ?? '?'} assets in Photos.sqlite)`);

                const index = await fetchProxyIndex(diag);

                if (cancelledRef) return;

                // Detect if proxy paths need a prefix (e.g. "Photos Library.photoslibrary/")
                // Only needed when dirHandle exists (for FileSystem API thumbnail resolution).
                // When dirHandle is null (e.g. Safari), proxy serves files directly — no prefix needed.
                if (dirHandle) {
                    const prefix = await detectProxyPathPrefix(dirHandle);
                    if (prefix) {
                        diag(`Path prefix detected: "${prefix}" — prepending to ${index.length} paths`);
                        for (const item of index) {
                            item.path = `${prefix}/${item.path}`;
                        }
                    } else {
                        diag('dirHandle points directly at .photoslibrary root — no path prefix needed');
                    }
                } else {
                    diag('No dirHandle — proxy serves files directly');
                }

                if (cancelledRef) return;

                clearInterval(elapsedTimer);
                elapsedTimer = null;

                const s = useScanStore.getState();
                s.setScanProgress({ scanned: index.length });
                s.setIndex(index);
                s.setScanState('complete');

                // Diagnostics
                const images = index.filter(i => i.mediaType === 'image').length;
                const videos = index.filter(i => i.mediaType === 'video').length;
                const withDate = index.filter(i => i.dateTaken).length;
                const withGps = index.filter(i => i.lat != null).length;
                const sample = index.slice(0, 3).map(i => `${i.name} | ${i.mediaType} | ${i.dateTaken?.slice(0, 19) ?? 'null'}`);
                diag(`\nINDEX: ${index.length} entries (${images} images, ${videos} videos)`);
                diag(`DATES: ${withDate} with dateTaken, ${index.length - withDate} without`);
                diag(`GPS: ${withGps} with coordinates`);
                diag(`SOURCE: Photos.sqlite via proxy`);
                if (sample.length) diag(`SAMPLE:\n  ${sample.join('\n  ')}`);

                // Persist to IndexedDB
                const meta = {
                    scannedAt: new Date().toISOString(),
                    fileCount: index.length,
                    folderName,
                    scanSource: 'proxy',
                };
                try {
                    await saveIndex(index, meta);
                    diag(`SAVED: index + meta to IndexedDB (${index.length} entries)`);
                } catch (err) {
                    diag(`SAVE FAILED: ${err.name}: ${err.message}`);
                    console.warn('[scanUtils] Failed to save index to IndexedDB:', err);
                }
                return;
            }

            // --- Fallback: filesystem walk ---
            if (!dirHandle) {
                clearInterval(elapsedTimer);
                elapsedTimer = null;
                const s = useScanStore.getState();
                s.setScanState('error');
                s.setScanError('Photos proxy is not running and no folder was selected.\n\nStart the proxy or use Chrome/Edge to select a folder.');
                return;
            }
            diag('Photos proxy not detected — falling back to filesystem walk');

            const index = [];
            const blockedDirs = [];
            let scanned = 0;
            let batchCount = 0;

            for await (const entry of walkDirectory(dirHandle, '', diag)) {
                if (cancelledRef) return;

                // Blocked directory marker from walkDirectory
                if (entry.mediaType === '_blocked') {
                    blockedDirs.push(entry.path);
                    continue;
                }

                let file;
                let date = null, lat = null, lon = null, size = 0;

                try {
                    file = await entry.handle.getFile();
                    size = file.size;
                    const meta = await getMediaMetadata(file, entry.mediaType);
                    date = meta.date;
                    lat = meta.lat;
                    lon = meta.lon;
                } catch {
                    // iCloud stub or unreadable — still index with name/path for dedup
                }

                // Fall back to file.lastModified when metadata extraction fails
                if (!date && file) {
                    date = new Date(file.lastModified);
                }

                index.push({
                    name: entry.name,
                    path: entry.path,
                    dateTaken: date ? date.toISOString() : null,
                    lat,
                    lon,
                    size,
                    mediaType: entry.mediaType,
                });

                scanned++;
                batchCount++;

                if (batchCount >= BATCH_SIZE) {
                    batchCount = 0;
                    useScanStore.getState().setScanProgress({ scanned });
                    // Yield to the event loop so UI can update
                    await new Promise((r) => setTimeout(r, 0));
                }
            }

            if (cancelledRef) return;

            // Scan complete
            clearInterval(elapsedTimer);
            elapsedTimer = null;

            const s = useScanStore.getState();
            s.setScanProgress({ scanned: index.length });
            s.setIndex(index);

            if (index.length === 0 && blockedDirs.length > 0) {
                // Nothing indexed because macOS blocked access
                s.setScanState('error');
                s.setScanError(
                    `macOS blocked access to: ${blockedDirs.join(', ')}.\n\n` +
                    'The Photos Library is protected by macOS privacy controls. ' +
                    'To allow access: System Settings → Privacy & Security → Full Disk Access → enable your browser.\n\n' +
                    'This is a one-time setting. After enabling, re-scan.'
                );
            } else {
                s.setScanState('complete');
                if (blockedDirs.length > 0) {
                    s.appendDiag(`\nNote: ${blockedDirs.length} protected directory(s) skipped: ${blockedDirs.join(', ')}`);
                }
            }

            // Diagnostics
            const images = index.filter(i => i.mediaType === 'image').length;
            const videos = index.filter(i => i.mediaType === 'video').length;
            const withDate = index.filter(i => i.dateTaken).length;
            const withGps = index.filter(i => i.lat != null).length;
            const sample = index.slice(0, 3).map(i => `${i.name} | ${i.mediaType} | ${i.dateTaken?.slice(0,19) ?? 'null'}`);
            diag(`\nINDEX: ${index.length} entries (${images} images, ${videos} videos)`);
            diag(`DATES: ${withDate} with dateTaken, ${index.length - withDate} without`);
            diag(`GPS: ${withGps} with coordinates`);
            diag(`SOURCE: Filesystem walk`);
            if (sample.length) diag(`SAMPLE:\n  ${sample.join('\n  ')}`);

            // Persist to IndexedDB
            const meta = {
                scannedAt: new Date().toISOString(),
                fileCount: index.length,
                folderName,
                scanSource: 'filesystem',
            };
            try {
                await saveIndex(index, meta);
                diag(`SAVED: index + meta to IndexedDB (${index.length} entries)`);
            } catch (err) {
                diag(`SAVE FAILED: ${err.name}: ${err.message}`);
                console.warn('[scanUtils] Failed to save index to IndexedDB:', err);
            }
        } catch (err) {
            if (cancelledRef) return;
            clearInterval(elapsedTimer);
            elapsedTimer = null;
            const s = useScanStore.getState();
            s.setScanState('error');
            s.setScanError(err?.message ?? String(err));
        }
    })();
}

/**
 * Whether a scan is currently running.
 */
export function isScanActive() {
    return useScanStore.getState().scanState === 'scanning';
}
