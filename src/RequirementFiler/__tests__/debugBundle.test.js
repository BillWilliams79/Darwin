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
    BUNDLE_CAPS, DEBUG_BLOCK_BEGIN, DEBUG_BLOCK_END, DEBUG_CATEGORIES, READ_CAPTURE, REDACTED_JWT, assembleBundle,
    buildDebugCapture, debugCaptureUri, formatDebugBlock, scrubJwt, snapshotStorage, withDebugBlock,
} from '../debugBundle';
import { queryClient } from '../../QueryClient/QueryClientSetup';

// A Cognito-shaped id token (JWS, three segments) and refresh token (JWE, five).
const ID_TOKEN = 'eyJraWQiOiJhYmNkZWZnaCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.U0lHTkFUVVJFLWlkLXRva2Vu';
const REFRESH = 'eyJjdHkiOiJKV1QiLCJlbmMiOiJBMjU2R0NNIn0.ZW5jcnlwdGVka2V5.aXZpdml2.Q0lQSEVSVEVYVA.VEFHLXJlZnJlc2g';
const SECRETS = [ID_TOKEN.split('.')[2], REFRESH.split('.')[4]];
const profile = { id: 'user-123', userName: 'user-123', email: 'u@example.com' };
const cat = (capture, key) => JSON.parse(capture.categories.find(c => c.key === key).text);
/** A whereToLook path resolved the way scripts/debug/read-capture.py --entry resolves it. */
const atPath = (bundle, path) => path.match(/[^.[\]]+|\[\d+\]/g)
    .reduce((v, seg) => (v == null ? v : seg.startsWith('[') ? v[Number(seg.slice(1, -1))] : v[seg]), bundle);

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
        expect(block).toContain(`${debugCaptureUri(3901)} · `);
        expect(block).toContain(`— index first: python3 ${READ_CAPTURE} 3901`);
        expect(block).toContain('Failed requests (1):');
        expect(block).toContain('- POST api/darwin_dev/requirements → 400');
        expect(block).toContain('Unknown column effort');
        expect(block).toContain('console.error: Save failed: {"status":400}');
        // Per-category sizes, the capture time and the redaction count are the index's now (req #4160).
        expect(block).not.toMatch(/Categories:|Captured at:|Redacted:/);
        const bundle = JSON.parse(text);
        expect(Object.keys(bundle)[0]).toBe('summary');
        expect(bundle.jwtRedacted).toBeGreaterThanOrEqual(1);
        expect(bundle.summary.mode).toBe('broken');
        // whereToLook names the failing request and the console line — and each path IS that entry, verbatim.
        const paths = bundle.summary.whereToLook.map(w => w.split(' ')[0]);
        expect(paths).toEqual(expect.arrayContaining([`network.entries[${bundle.network.entries.length - 1}]`, `console.entries[${bundle.console.entries.length - 1}]`]));
        expect(atPath(bundle, `network.entries[${bundle.network.entries.length - 1}]`)).toMatchObject({ method: 'POST', status: 400 });
        expect(bundle.summary.anomalies).toContain('Failed requests (1):');
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
        expect(formatDebugBlock(capture, ['console'], 1)).toContain('; dropped before save: console)');
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
        const block = formatDebugBlock(capture, [], 12).split('\n');
        expect(block.slice(0, 4)).toEqual([DEBUG_BLOCK_BEGIN,
            'Filed with the Requirement Filer — start from the page and the bundle.',
            'Surface: /maps', 'URL: /maps?x=1']);
        expect(block[4]).toMatch(new RegExp(`^Bundle: darwin://requirement-debug/12 · \\d+(\\.\\d)? (B|KB) \\(network, console, navigation, page state\\) — index first: python3 ${READ_CAPTURE} 12$`));
        expect(block.slice(5)).toEqual([DEBUG_BLOCK_END]);
        expect(JSON.parse(assembleBundle(capture, []).text).summary).toMatchObject({ mode: 'improve', anomalies: [], whereToLook: [] });
    });

    it('a lost capture still points at its row; a retried block replaces itself', () => {
        const lost = formatDebugBlock(null, [], 12);
        expect(lost).toBe([DEBUG_BLOCK_BEGIN, `Bundle (if one was saved): darwin://requirement-debug/12 — index first: python3 ${READ_CAPTURE} 12`,
            DEBUG_BLOCK_END].join('\n'));
        const once = withDebugBlock('Body\n\n--- Filed-from ---', lost);
        expect(once).toBe(`Body\n\n--- Filed-from ---\n\n${lost}`);
        expect(withDebugBlock(once, lost)).toBe(once);
        expect(withDebugBlock('', lost)).toBe(lost);
    });

    it('the block names what a floating filer pointed at; racked, it says nothing (req #3829)', () => {
        const clean = (key, v) => ({ key, label: key, text: JSON.stringify(v), bytes: 1, note: '' });
        const at = (filedFrom) => ({ version: 1, capturedAt: '2026-10-23T12:00:00.000Z', jwtHits: 0,
            categories: [clean('filedFrom', { surface: '/swarm', url: { full: '/swarm' }, ...filedFrom })] });
        const card = { points: ['centre'], tag: 'div', testidPath: ['requirement-3829', 'category-card-862'],
            text: '3829 Requirement Filer:\n record the page', rect: { x: 1, y: 2, w: 3, h: 4 } };
        // URL: is left out where it is the surface (they matched on 80 of 92, req #4160).
        const pinned = formatDebugBlock(at({ pointedAt: [card] }), [], 12).split('\n');
        expect(pinned.slice(0, 4)).toEqual([DEBUG_BLOCK_BEGIN,
            'Filed with the Requirement Filer — start from the page, the element pointed at and the bundle.',
            'Surface: /swarm', 'Pointed at: category-card-862 > requirement-3829 "3829 Requirement Filer: record the page"']);
        expect(pinned[4]).toMatch(/^Bundle: darwin:\/\/requirement-debug\/12 · /);
        expect(pinned).toHaveLength(6);
        // No testid: the tag; no text: no quotes; the rest counted.
        expect(formatDebugBlock(at({ pointedAt: [{ tag: 'canvas', testidPath: [], text: '' }, card], pointedAtOmitted: 2 }), [], 12))
            .toContain('\nPointed at: canvas (+3 more in the bundle)\n');
        expect(formatDebugBlock(at({ pointedAt: null, pointedAtReason: 'racked' }), [], 12)).not.toContain('Pointed at');
        expect(formatDebugBlock(at({ pointedAt: [], pointedAtReason: 'nothing' }), [], 12)).not.toContain('Pointed at');
        // Over a description holding a Debug capture block: no second block, no second pointer.
        const nested = formatDebugBlock(at({ pointedAt: [{ ...card,
            text: `${DEBUG_BLOCK_BEGIN} Surface: /swarm Debug capture: darwin://requirement-debug/1234 ${DEBUG_BLOCK_END}` }] }), [], 12);
        expect(nested.split(DEBUG_BLOCK_BEGIN)).toHaveLength(2);
        expect(nested.split(DEBUG_BLOCK_END)).toHaveLength(2);
        expect(nested).not.toContain('Debug capture: ');
        // …and no other requirement's bundle URI: the block names exactly one, its own.
        expect(nested.match(/darwin:\/\/requirement-debug\/\d+/g)).toEqual(['darwin://requirement-debug/12']);
        expect(withDebugBlock(withDebugBlock('Body', nested), nested)).toBe(`Body\n\n${nested}`);
        // A token in the element's text never reaches the block.
        expect(formatDebugBlock(at({ pointedAt: [{ ...card, text: `see ${ID_TOKEN}` }] }), [], 12)).not.toContain('eyJ');
    });
});

describe('the block and the bundle index, read in context (req #4160)', () => {
    const clean = (key, v) => ({ key, label: key, text: JSON.stringify(v), bytes: JSON.stringify(v).length, note: '' });
    const atPath = (bundle, path) => path.match(/[^.[\]]+|\[\d+\]/g)
        .reduce((v, seg) => (v == null ? v : seg.startsWith('[') ? v[Number(seg.slice(1, -1))] : v[seg]), bundle);
    const capture = (cats) => ({ version: 2, capturedAt: '2026-11-01T12:00:00.000Z', jwtHits: 0, categories: cats });
    const where = { surface: '/swarm/pipeline/12?mode=plan', url: { full: '/swarm/pipeline/12?mode=plan' },
        state: { database: 'darwin' }, subject: [{ kind: 'pipeline', id: 12, title: 'Pre-WSL', database: 'darwin' }],
        options: { app: 'swarm' },
        pointedAt: [{ points: ['centre'], tag: 'div', testidPath: ['pipelines-card-description-12'], text: 'Plan notes' }] };

    it('ACCEPTANCE: a feature request pinned over an element reads as ≤ 5 short lines naming where, what and the bundle', () => {
        const c = capture([clean('filedFrom', where), clean('console', { dropped: 0, entries: [{ level: 'log', args: ['ok'] }] }),
            clean('network', { dropped: 0, entries: [{ method: 'GET', url: 'https://a/darwin/epics', status: 404 }], inFlight: [] })]);
        const block = formatDebugBlock(c, [], 4200);
        const inner = block.split('\n').slice(1, -1);
        expect(inner).toHaveLength(5);
        expect(inner[1]).toBe('Surface: /swarm/pipeline/12?mode=plan');
        expect(inner[2]).toBe('Subject: pipeline 12 "Pre-WSL" — production ids (darwin) — find or seed the match in darwin_dev');
        expect(inner[3]).toBe('Pointed at: pipelines-card-description-12 "Plan notes"');
        expect(inner[4]).toContain('darwin://requirement-debug/4200');
        expect(block).not.toMatch(/URL:|Categories:|Captured at:/);
        // A regression bound: on the 95 real captures the median improve block is 535 chars,
        // ≈ 223 tokens measured — memory/requirement-filer-efficacy.md § The reading pipeline.
        expect(block.length).toBeLessThanOrEqual(600);
        const bundle = JSON.parse(assembleBundle(c, []).text);
        expect(Object.keys(bundle)[0]).toBe('summary');
        expect(bundle.summary).toMatchObject({ mode: 'improve', surface: where.surface, anomalies: [],
            pointedAt: 'pipelines-card-description-12 "Plan notes"',
            subject: [{ kind: 'pipeline', id: 12, title: 'Pre-WSL', database: 'darwin' }] });
        expect(bundle.summary.url).toBeUndefined();
        expect(bundle.summary.whereToLook.map(w => w.split(' ')[0])).toEqual(['filedFrom.pointedAt[0]', 'filedFrom.subject', 'filedFrom.options']);
        for (const w of bundle.summary.whereToLook) expect(atPath(bundle, w.split(' ')[0])).toBeTruthy();
        expect(Object.keys(bundle.summary.categories)).toEqual(['filedFrom', 'console', 'network']);
    });

    it('ACCEPTANCE: a bug reads with its anomalies verbatim; whereToLook names the failing entries, even an earlier occurrence', () => {
        // A grouped GET: it failed, then succeeded — the failure is in `earlier`, not the latest.
        const grouped = { method: 'GET', url: 'https://a/darwin/tasks', status: 200, t: 2000, ms: 5,
            earlier: { count: 1, t: [1000], status: [502], ms: [9], resBytes: [null], failBody: ['{"message":"boom"}'] } };
        const del = { method: 'DELETE', url: 'https://a/darwin/epics', status: 500, t: 3000, ms: 12, failBody: 'Internal' };
        const c = capture([clean('filedFrom', where),
            clean('errors', { dropped: 0, entries: [{ kind: 'error', message: 'x is undefined', source: 'https://a/app.js', line: 1, col: 2 }] }),
            clean('network', { dropped: 0, entries: [{ method: 'GET', url: 'https://a/darwin/x', status: 200 }, grouped, del], inFlight: [] })]);
        const block = formatDebugBlock(c, [], 4201);
        expect(block).toContain('Filed with the Requirement Filer — start from the page, the element pointed at and the bundle, and what went wrong (verbatim).');
        expect(block).toContain('Uncaught errors (1):\n- [error] x is undefined — a/app.js:1:2');
        expect(block).toContain('Failed requests (2):\n- GET a/darwin/tasks → 502 (9 ms) "{\\"message\\":\\"boom\\"}" [occurrence 1 of 2]\n- DELETE a/darwin/epics → 500 (12 ms) "Internal"');
        const lines = block.split('\n');
        expect(lines.findIndex(l => l.startsWith('Pointed at:'))).toBeLessThan(lines.indexOf('Uncaught errors (1):'));
        expect(lines.at(-2)).toMatch(/^Bundle: /);
        const bundle = JSON.parse(assembleBundle(c, []).text);
        expect(bundle.summary.mode).toBe('broken');
        expect(bundle.summary.counts).toEqual({ errors: 1, requests: 2, emptyListReads: 0 });
        // `<path> <what>`, a request named short: its query and body are the entry's.
        expect(bundle.summary.whereToLook.slice(0, 3)).toEqual([
            'errors.entries[0] [error] x is undefined — a/app.js:1:2',
            'network.entries[1] GET /darwin/tasks → 502 [occurrence 1 of 2]',
            'network.entries[2] DELETE /darwin/epics → 500']);
        // Each path is the stored entry, whole — the index points, it never replaces.
        expect(atPath(bundle, 'network.entries[1]')).toEqual(grouped);
        expect(atPath(bundle, 'network.entries[2]')).toEqual(del);
        expect(bundle.network.entries).toHaveLength(3);
    });

    it('identical anomalies are quoted once with ×N; the index names the first path and counts the alike', () => {
        const err = { kind: 'error', message: 'boom', source: 'https://a/app.js', line: 1, col: 2 };
        const c = capture([clean('filedFrom', where), clean('errors', { dropped: 0, entries: [err, err, err, { ...err, message: 'other' }] })]);
        const block = formatDebugBlock(c, [], 3);
        expect(block).toContain('Uncaught errors (4):\n- [error] boom — a/app.js:1:2 (×3)\n- [error] other — a/app.js:1:2\n');
        const s = JSON.parse(assembleBundle(c, []).text).summary;
        expect(s.whereToLook.slice(0, 2)).toEqual(['errors.entries[0] [error] boom — a/app.js:1:2 (+2 alike)', 'errors.entries[3] [error] other — a/app.js:1:2']);
        expect(JSON.parse(assembleBundle(c, []).text).errors.entries).toHaveLength(4);   // every one stored
    });

    it('a request that failed alike several times is ONE verbatim line; its innermost testids name what was pointed at', () => {
        const g = { method: 'GET', url: 'https://a/darwin/swarm_completes?fields=id', status: 0, t: 5000, ms: 1944, error: 'Failed to fetch',
            earlier: { count: 2, t: [1000, 3000], status: [0, 0], ms: [1945, 1936], resBytes: [null, null], error: ['Failed to fetch', 'Failed to fetch'] } };
        const deep = { ...where, pointedAt: [{ tag: 'div', testidPath: ['card-description-12', 'card-12', 'cards-view', 'pipelines-page'], text: 'x' }] };
        const c = capture([clean('filedFrom', deep), clean('network', { dropped: 0, entries: [g], inFlight: [] })]);
        const block = formatDebugBlock(c, [], 4113);
        expect(block).toContain('Failed requests (3):\n- GET a/darwin/swarm_completes?fields=id → 0 (1936–1945 ms) Failed to fetch [3 of 3 occurrences]\n');
        expect(block).toContain('\nPointed at: … > card-12 > card-description-12 "x"\n');
        const s = JSON.parse(assembleBundle(c, []).text).summary;
        expect(s.counts.requests).toBe(3);
        expect(s.whereToLook[0]).toBe('network.entries[0] GET /darwin/swarm_completes → 0 [3 of 3 occurrences]');
    });

    it('the pointed-at text is clipped in the block and the index, whole in the bundle', () => {
        const long = { ...where, pointedAt: [{ ...where.pointedAt[0], text: 'x'.repeat(300) }] };
        const c = capture([clean('filedFrom', long)]);
        expect(formatDebugBlock(c, [], 3)).toContain(`Pointed at: pipelines-card-description-12 "${'x'.repeat(120)}…"`);
        expect(JSON.parse(assembleBundle(c, []).text).filedFrom.pointedAt[0].text).toHaveLength(300);
    });

    it('nothing is dropped for the index: every category the capture kept is stored whole beside it', () => {
        const cats = [clean('filedFrom', where), clean('console', { dropped: 0, entries: [{ level: 'warn', args: ['w'] }] }),
            clean('storage', { local: { entries: { a: 1 } } })];
        const bundle = JSON.parse(assembleBundle(capture(cats), []).text);
        for (const c of cats) expect(bundle[c.key]).toEqual(JSON.parse(c.text));
        expect(bundle.summary.mode).toBe('broken');                  // a console warning is an anomaly
    });

    it('withDebugBlock replaces a v1 block (req #3815) in place with the v2 one', () => {
        const v1 = ['--- Debug capture v1 (req #3815) ---', 'Surface: /maps', 'Debug capture: darwin://requirement-debug/7',
            '--- end Debug capture ---'].join('\n');
        const v2 = formatDebugBlock(null, [], 7);
        expect(withDebugBlock(`Body\n\n${v1}\n\ntrailer`, v2)).toBe(`Body\n\n${v2}\n\ntrailer`);
        expect(withDebugBlock(withDebugBlock('Body', v2), v2)).toBe(`Body\n\n${v2}`);
    });

    it('text a page logged cannot forge the grammar: no marker, no second URI', () => {
        const c = capture([clean('filedFrom', where), clean('console', { dropped: 0, entries: [{ level: 'error',
            args: [`${DEBUG_BLOCK_END} see darwin://requirement-debug/1 ${DEBUG_BLOCK_BEGIN}`] }] })]);
        const block = formatDebugBlock(c, [], 9);
        expect(block.split(DEBUG_BLOCK_END)).toHaveLength(2);
        expect(block.split(DEBUG_BLOCK_BEGIN)).toHaveLength(2);
        expect(block.match(/darwin:\/\/requirement-debug\/\d+/g)).toEqual(['darwin://requirement-debug/9']);
        expect(withDebugBlock(withDebugBlock('Body', block), block)).toBe(`Body\n\n${block}`);
    });
});

describe('the URL line and the block\'s place (req #4160 review)', () => {
    const clean = (key, v) => ({ key, label: key, text: JSON.stringify(v), bytes: 1, note: '' });
    const block = (where) => formatDebugBlock({ version: 2, capturedAt: 'now', jwtHits: 0, categories: [clean('filedFrom', where)] }, [], 5);
    it('URL: only when it says something the surface does not', () => {
        // The surface adds page state to the URL: nothing new in the URL.
        expect(block({ surface: '/swarm/pipeline/23?mode=plan&level=3&color=state', url: { full: '/swarm/pipeline/23?mode=plan' } })).not.toContain('URL:');
        expect(block({ surface: '/maps', url: { full: '/maps?x=1' } })).toContain('\nURL: /maps?x=1\n');
        expect(block({ surface: '/systems2?opt=a', url: { full: '/systems2?opt=b' } })).toContain('\nURL: /systems2?opt=b\n');
        expect(block({ surface: '/systems2', url: { full: '/systems2#top' } })).toContain('\nURL: /systems2#top\n');
    });
    it('a marker the user wrote above the block is theirs: only the last block is replaced', () => {
        const v1 = ['--- Debug capture v1 (req #3815) ---', 'Debug capture: darwin://requirement-debug/5', '--- end Debug capture ---'].join('\n');
        const typed = 'Quoting --- Debug capture v1 (req #3815) --- from another requirement.';
        const next = formatDebugBlock(null, [], 5);
        expect(withDebugBlock(`${typed}\n\n${v1}`, next)).toBe(`${typed}\n\n${next}`);
    });
});

describe('the index and block under load (req #4160 delta review)', () => {
    const clean = (key, v) => ({ key, label: key, text: JSON.stringify(v), bytes: 1, note: '' });
    const capture = (cats) => ({ version: 2, capturedAt: 'now', jwtHits: 0, categories: cats });
    it('a long alike why keeps its count; every kind keeps one verbatim line under the byte cap', () => {
        const long = 'w'.repeat(300);
        const big = (i) => ({ method: 'GET', url: `https://a/darwin/t${i}?${'q'.repeat(380)}`, status: 500, ms: i });
        const c = capture([
            clean('network', { dropped: 0, entries: [big(1), big(2), big(3)], inFlight: [] }),
            clean('console', { dropped: 0, entries: Array.from({ length: 6 }, () => ({ level: 'warn', args: [long] })) })]);
        const block = formatDebugBlock(c, [], 1);
        const lines = block.split('\n');
        expect(lines[lines.indexOf('Console errors and warnings (6):') + 1]).toMatch(/^- console\.warn: w+…? \(×6\)$/);
        const s = JSON.parse(assembleBundle(c, []).text).summary;
        expect(s.whereToLook).toContain(`console.entries[0] console.warn: ${'w'.repeat(46)}… (+5 alike)`);
    });
    it('a canvas object\'s title is never shortened like a testid path', () => {
        const ff = { surface: '/p', url: { full: '/p' }, pointedAt: [{ tag: 'div', testidPath: ['pipeline-plan-visualizer'],
            host: 'pipeline-plan-visualizer', object: { kind: 'epic', id: 1, title: 'A > B > C' } }] };
        expect(formatDebugBlock(capture([clean('filedFrom', ff)]), [], 1)).toContain('\nPointed at: epic #1 "A > B > C" (pipeline-plan-visualizer)\n');
    });
});
