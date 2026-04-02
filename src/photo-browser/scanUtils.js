/**
 * scanUtils.js
 * Scan launcher — fetches the photo index from the Darwin Photos proxy service.
 * The proxy reads Apple Photos.sqlite server-side and returns a JSON index.
 *
 * Used by PhotoSettingsView (re-scan) and on-demand from photo browser pages.
 */

import useScanStore from './useScanStore.js';
import { saveIndex } from './handleDB.js';
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
 * Start a scan via the Photos proxy.
 * Requires the Darwin Photos app to be running locally.
 */
export function startScan() {
    abortActiveScan();
    cancelledRef = false;

    const store = useScanStore.getState();
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

    // Run the scan asynchronously
    (async () => {
        const diag = (line) => useScanStore.getState().appendDiag(line);

        try {
            const proxy = await checkPhotosProxy();

            if (!proxy.available) {
                clearInterval(elapsedTimer);
                elapsedTimer = null;
                const s = useScanStore.getState();
                s.setScanState('error');
                s.setScanError(
                    'Darwin Photos app is not running.\n\n' +
                    'Install Darwin Photos from Photo Settings to browse your Apple Photos Library.'
                );
                return;
            }

            diag(`Photos proxy detected (${proxy.assetCount?.toLocaleString() ?? '?'} assets in Photos.sqlite)`);

            const index = await fetchProxyIndex(diag);

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
                folderName: 'Photos.sqlite',
                scanSource: 'proxy',
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
