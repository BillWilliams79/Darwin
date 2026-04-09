import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkPhotosProxy } from '../scanUtils.js';

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
