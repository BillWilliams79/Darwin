// @vitest-environment jsdom
//
// req #3815 — the Bug button's debug capture: every category snapshotted at the
// press, redacted (credential storage keys dropped whole, token-shaped text
// scrubbed and counted), sized per category, any category droppable, and the
// description's `Debug capture` block a worker reads without the bundle.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const pageFetch = vi.hoisted(() => {
    const f = vi.fn();
    globalThis.fetch = f;
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = () => {};
    return f;
});

import {
    BUNDLE_CAPS, DEBUG_BLOCK_BEGIN, DEBUG_BLOCK_END, DEBUG_CATEGORIES, REDACTED_JWT, assembleBundle,
    buildDebugCapture, debugCaptureUri, formatDebugBlock, scrubJwt, snapshotStorage, withDebugBlock,
} from '../debugBundle';
import { queryClient } from '../../QueryClient/QueryClientSetup';

// A Cognito-shaped id token (JWS, three segments) and refresh token (JWE, five).
const ID_TOKEN = 'eyJraWQiOiJhYmNkZWZnaCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.U0lHTkFUVVJFLWlkLXRva2Vu';
const REFRESH = 'eyJjdHkiOiJKV1QiLCJlbmMiOiJBMjU2R0NNIn0.ZW5jcnlwdGVka2V5.aXZpdml2.Q0lQSEVSVEVYVA.VEFHLXJlZnJlc2g';
const SECRETS = [ID_TOKEN.split('.')[2], REFRESH.split('.')[4]];
const profile = { id: 'user-123', userName: 'user-123', email: 'u@example.com' };
const cat = (capture, key) => JSON.parse(capture.categories.find(c => c.key === key).text);

describe('debug bundle (req #3815)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        queryClient.clear();
    });

    it('ACCEPTANCE: a console error and a failing request are in the bundle and the block — no token anywhere', async () => {
        // The Cognito SDK's token cache, the app's own state, a token logged by mistake.
        localStorage.setItem('CognitoIdentityServiceProvider.abc.user-123.idToken', ID_TOKEN);
        localStorage.setItem('CognitoIdentityServiceProvider.abc.user-123.refreshToken', REFRESH);
        localStorage.setItem('CognitoIdentityServiceProvider.abc.LastAuthUser', 'user-123');
        localStorage.setItem('darwin_active_map_view', JSON.stringify({ state: { view: 'rides' }, version: 0 }));
        sessionStorage.setItem('maps_scrollY', '420');
        queryClient.setQueryData(['requirements', 'u'], [{ id: 1 }, { id: 2 }]);
        console.error('Save failed:', { status: 400 }, `Bearer ${ID_TOKEN}`);
        pageFetch.mockResolvedValueOnce(new Response('{"message":"Unknown column effort"}', { status: 400 }));
        await window.fetch('https://api/darwin_dev/requirements', {
            method: 'POST', headers: { Authorization: ID_TOKEN }, body: JSON.stringify({ refresh: REFRESH }),
        });

        const capture = await buildDebugCapture({ profile });
        expect(capture.categories.map(c => c.key)).toEqual(DEBUG_CATEGORIES.map(c => c.key));
        for (const c of capture.categories) expect(c.bytes).toBeGreaterThan(0);

        // The console line and the failing request, as a worker reads them.
        const consoleLines = cat(capture, 'console').entries;
        expect(consoleLines.at(-1)).toMatchObject({ level: 'error' });
        expect(consoleLines.at(-1).args).toEqual(['Save failed:', { status: 400 }, `Bearer ${REDACTED_JWT}`]);
        const failed = cat(capture, 'network').entries.at(-1);
        expect(failed).toMatchObject({ method: 'POST', status: 400, failBody: '{"message":"Unknown column effort"}' });
        expect(capture.jwtHits).toBeGreaterThanOrEqual(1);

        // Credential storage keys dropped whole, by name; the app's state kept.
        const storage = cat(capture, 'storage');
        expect(storage.local.droppedKeys.count).toBe(3);
        expect(storage.local.entries.darwin_active_map_view).toEqual({ state: { view: 'rides' }, version: 0 });
        expect(storage.session.entries.maps_scrollY).toBe(420);
        expect(cat(capture, 'identity')).toEqual(profile);
        expect(cat(capture, 'reactQuery')).toMatchObject({ total: 1, queries: [{ rows: 2 }] });

        const { text } = assembleBundle(capture, []);
        const block = formatDebugBlock(capture, [], 3901);
        for (const secret of SECRETS) {
            expect(text).not.toContain(secret);
            expect(block).not.toContain(secret);
        }
        expect(text).not.toMatch(/Authorization/);
        expect(block.startsWith(DEBUG_BLOCK_BEGIN)).toBe(true);
        expect(block.endsWith(DEBUG_BLOCK_END)).toBe(true);
        expect(block).toContain(`Debug capture: ${debugCaptureUri(3901)}`);
        expect(block).toContain('Failed requests (1):');
        expect(block).toContain('- POST api/darwin_dev/requirements → 400');
        expect(block).toContain('Unknown column effort');
        expect(block).toContain('console.error: Save failed: {"status":400}');
        expect(block).toMatch(/Redacted: \d+ token-shaped value/);
    });

    it('a dropped category is left out of the bundle and named', async () => {
        console.error('only in console');
        const capture = await buildDebugCapture({ profile });
        const full = JSON.parse(assembleBundle(capture, []).text);
        const cut = JSON.parse(assembleBundle(capture, ['console', 'storage']).text);
        expect(full.console).toBeTruthy();
        expect(cut.console).toBeUndefined();
        expect(cut.storage).toBeUndefined();
        expect(cut.dropped).toEqual(['console', 'storage']);
        expect(cut.network).toEqual(full.network);
        expect(formatDebugBlock(capture, ['console'], 1)).toContain('Dropped before save: console');
        expect(formatDebugBlock(capture, ['console'], 1)).not.toContain('only in console');
    });

    it('waits for a failure body still being read, at most 250 ms', async () => {
        let release;
        const slow = new Response(new ReadableStream({ start(c) { release = () => { c.enqueue(new TextEncoder().encode('late body')); c.close(); }; } }), { status: 500 });
        pageFetch.mockResolvedValueOnce(slow);
        await window.fetch('https://api/slow');
        const pending = buildDebugCapture({ profile });
        release();
        const capture = await pending;
        expect(cat(capture, 'network').entries.at(-1)).toMatchObject({ status: 500, failBody: 'late body' });
    });

    it('a storage area is capped, long key names are listed, never copied', () => {
        const store = new Map([['k'.repeat(300), '1'], ...Array.from({ length: 30 }, (_, i) => [`big${i}`, JSON.stringify({ a: 'v'.repeat(1500), b: 'w'.repeat(1500) })])]);
        const area = { get length() { return store.size; }, key: (i) => [...store.keys()][i], getItem: (k) => store.get(k) };
        const snap = snapshotStorage(area);
        expect(snap.truncatedKeys.count).toBeGreaterThan(1);
        expect(JSON.stringify(snap.entries).length).toBeLessThanOrEqual(BUNDLE_CAPS.storageBytes);
        expect(snap.entries.big0.truncated).toBeGreaterThan(2000);
    });

    it('a request still in flight at the press is listed as pending', async () => {
        pageFetch.mockReturnValueOnce(new Promise(() => {}));
        window.fetch('https://api/darwin_dev/hangs');
        const capture = await buildDebugCapture({ profile });
        const net = cat(capture, 'network');
        expect(net.inFlight.at(-1)).toMatchObject({ method: 'GET', url: 'https://api/darwin_dev/hangs' });
        expect(formatDebugBlock(capture, [], 3)).toContain('Still pending at the press (1):');
    });

    it('redacts a credential URL parameter inside free text, and drops the PKCE verifier key', async () => {
        console.error('redirect failed: https://darwin.one/strava/callback?code=OPAQUE123&scope=read');
        sessionStorage.setItem('pkce_code_verifier', 'VERIFIER-SECRET');
        const capture = await buildDebugCapture({ profile });
        const { text } = assembleBundle(capture, []);
        expect(text).not.toContain('OPAQUE123');
        expect(text).toContain('code=[redacted]&scope=read');
        expect(text).not.toContain('VERIFIER-SECRET');
        expect(cat(capture, 'storage').session.droppedKeys.names).toContain('pkce_code_verifier');
    });

    it('a Darwin API rejection in the query cache reads as its status, not [object Object]', async () => {
        queryClient.getQueryCache().build(queryClient, { queryKey: ['broken'] }).setState({
            status: 'error', error: { data: null, httpStatus: { httpStatus: 400, httpMessage: 'BAD REQUEST' } },
            errorUpdatedAt: Date.now(),
        });
        const capture = await buildDebugCapture({ profile });
        expect(cat(capture, 'reactQuery').queries[0].error).toBe('HTTP 400 BAD REQUEST');
    });

    it('scrubs three- and five-segment tokens and counts them', () => {
        const { text, hits } = scrubJwt(`a ${ID_TOKEN} b ${REFRESH}`);
        expect(hits).toBe(2);
        expect(text).toBe(`a ${REDACTED_JWT} b ${REDACTED_JWT}`);
    });

    it('the block keeps its verbatim lines under 2 KB and counts the rest', async () => {
        for (let i = 0; i < 8; i++) console.error(`failure ${i} `.repeat(60));
        const capture = await buildDebugCapture({ profile });
        const block = formatDebugBlock(capture, [], 7);
        const detail = block.split('\n').filter(l => l.startsWith('- ')).join('\n');
        expect(detail.length).toBeLessThanOrEqual(BUNDLE_CAPS.blockDetailBytes);
        expect(block.split('\n').filter(l => l.startsWith('- console.error')).length).toBeLessThanOrEqual(5);
    });

    it('where it was filed rides as the first category, and the block always says where', async () => {
        const filedFrom = { version: 1, surface: '/swarm/pipeline/2?mode=plan', url: { full: '/swarm/pipeline/2?mode=plan&filer=new' } };
        const capture = await buildDebugCapture({ profile, filedFrom });
        expect(capture.categories[0]).toMatchObject({ key: 'filedFrom', note: '/swarm/pipeline/2?mode=plan' });
        expect(JSON.parse(assembleBundle(capture, []).text).filedFrom).toEqual(filedFrom);
        const block = formatDebugBlock(capture, [], 9);
        expect(block).toContain('\nSurface: /swarm/pipeline/2?mode=plan\n');
        expect(block).toContain('\nURL: /swarm/pipeline/2?mode=plan&filer=new\n');
        // Dropped, it says nothing about where.
        expect(formatDebugBlock(capture, ['filedFrom'], 9)).not.toContain('Surface:');
    });

    it('nothing went wrong: the block shrinks to where it was filed and the pointer (req #3818)', () => {
        const clean = (key, v) => ({ key, label: key, text: JSON.stringify(v), bytes: 1, note: '' });
        const capture = { version: 1, capturedAt: '2026-10-23T12:00:00.000Z', jwtHits: 0, categories: [
            clean('filedFrom', { surface: '/maps', url: { full: '/maps?x=1' } }),
            clean('console', { dropped: 0, entries: [{ level: 'log', args: ['fine'] }] }),
            clean('errors', { dropped: 0, entries: [] }),
            clean('network', { dropped: 0, entries: [{ method: 'GET', url: 'https://a/b', status: 200 }], inFlight: [] }),
        ] };
        expect(formatDebugBlock(capture, [], 12)).toBe([DEBUG_BLOCK_BEGIN, 'Surface: /maps', 'URL: /maps?x=1',
            'Debug capture: darwin://requirement-debug/12', DEBUG_BLOCK_END].join('\n'));
    });

    it('a lost capture still points at its row; a retried block replaces itself', () => {
        const lost = formatDebugBlock(null, [], 12);
        expect(lost).toBe([DEBUG_BLOCK_BEGIN, 'Debug capture: darwin://requirement-debug/12', DEBUG_BLOCK_END].join('\n'));
        const once = withDebugBlock('Body\n\n--- Filed-from ---', lost);
        expect(once).toBe(`Body\n\n--- Filed-from ---\n\n${lost}`);
        expect(withDebugBlock(once, lost)).toBe(once);
        expect(withDebugBlock('', lost)).toBe(lost);
    });
});
