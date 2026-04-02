import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkPhotosProxy, detectProxyPathPrefix } from '../scanUtils.js';

describe('checkPhotosProxy', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('returns available:true when proxy responds with status ok', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ status: 'ok', assetCount: 112000 }),
        });

        const result = await checkPhotosProxy();
        expect(result.available).toBe(true);
        expect(result.assetCount).toBe(112000);
    });

    it('returns available:false when proxy responds with non-ok status', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
        });

        const result = await checkPhotosProxy();
        expect(result.available).toBe(false);
    });

    it('returns available:false when proxy returns unexpected JSON', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ status: 'error' }),
        });

        const result = await checkPhotosProxy();
        expect(result.available).toBe(false);
    });

    it('returns available:false when fetch throws (proxy not running)', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

        const result = await checkPhotosProxy();
        expect(result.available).toBe(false);
    });

    it('returns available:false on network timeout', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));

        const result = await checkPhotosProxy();
        expect(result.available).toBe(false);
    });

    it('calls the correct health endpoint URL', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ status: 'ok', assetCount: 50 }),
        });

        await checkPhotosProxy();
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const callArgs = globalThis.fetch.mock.calls[0];
        // In test/dev mode, PHOTOS_PROXY_URL is '' (relative URL via Vite proxy)
        expect(callArgs[0]).toBe('/photos/health');
    });
});

describe('detectProxyPathPrefix', () => {
    /** Helper: create a mock FileSystemDirectoryHandle */
    function mockDirHandle({ getDirectoryHandleResult, entries = [] }) {
        return {
            getDirectoryHandle: vi.fn().mockImplementation((name) => {
                if (getDirectoryHandleResult[name]) {
                    return Promise.resolve(getDirectoryHandleResult[name]);
                }
                return Promise.reject(new DOMException('Not found', 'NotFoundError'));
            }),
            entries: vi.fn().mockImplementation(function* () {
                for (const [name, handle] of entries) {
                    yield [name, handle];
                }
            }),
        };
    }

    it('returns empty string when dirHandle has "originals" directly (is .photoslibrary root)', async () => {
        const handle = mockDirHandle({
            getDirectoryHandleResult: { originals: {} },
        });

        const prefix = await detectProxyPathPrefix(handle);
        expect(prefix).toBe('');
    });

    it('returns library name when dirHandle is parent containing .photoslibrary', async () => {
        const libraryHandle = mockDirHandle({
            getDirectoryHandleResult: { originals: {} },
        });
        const handle = mockDirHandle({
            getDirectoryHandleResult: {},
            entries: [['Photos Library.photoslibrary', { ...libraryHandle, kind: 'directory' }]],
        });

        const prefix = await detectProxyPathPrefix(handle);
        expect(prefix).toBe('Photos Library.photoslibrary');
    });

    it('returns empty string when neither originals nor .photoslibrary found', async () => {
        const handle = mockDirHandle({
            getDirectoryHandleResult: {},
            entries: [['Documents', { kind: 'directory' }], ['file.txt', { kind: 'file' }]],
        });

        const prefix = await detectProxyPathPrefix(handle);
        expect(prefix).toBe('');
    });

    it('skips .photoslibrary entries without originals inside', async () => {
        const emptyLibrary = mockDirHandle({
            getDirectoryHandleResult: {},
        });
        const handle = mockDirHandle({
            getDirectoryHandleResult: {},
            entries: [['Old Photos.photoslibrary', { ...emptyLibrary, kind: 'directory' }]],
        });

        const prefix = await detectProxyPathPrefix(handle);
        expect(prefix).toBe('');
    });
});
