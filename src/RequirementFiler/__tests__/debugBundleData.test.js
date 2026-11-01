// @vitest-environment jsdom
//
// req #4159 — the capture is CORRECT and COMPLETE: an empty Lambda-Rest list
// read is not a failure, what the reader saw (snackbar, alerts) is failure
// evidence, focus losses say how old they are, and storage that the view state
// already records is named instead of copied — with nothing lost.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const pageFetch = vi.hoisted(() => {
    const f = vi.fn();
    globalThis.fetch = f;
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = () => {};
    return f;
});

import {
    DEBUG_CATEGORIES, assembleBundle, buildDebugCapture, dedupeStorage, expandStorage, formatDebugBlock,
    isEmptyListRead, isFailed, seenOnScreen, snapshotStorage,
} from '../debugBundle';
import { viewState } from '../filedFromContext';
import { queryClient } from '../../QueryClient/QueryClientSetup';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { debugCaptureState } from '../../utils/debugCapture';

const profile = { id: 'user-123', userName: 'user-123', email: 'u@example.com' };
const cat = (capture, key) => JSON.parse(capture.categories.find(c => c.key === key).text);
const API = 'https://k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng';
const get = (url, status, body = '"NOT FOUND"') => {
    pageFetch.mockResolvedValueOnce(new Response(body, { status }));
    return window.fetch(url).catch(() => {});
};
const settle = () => Promise.allSettled([...(debugCaptureState()?.pendingBodies ?? [])]);
const failedLines = (block) => block.split('\n').filter(l => l.startsWith('Failed requests'));

describe('failure classification (req #4159)', () => {
    const e = (method, url, status) => ({ method, url, status });
    it('an empty LIST read is not a failure — on any gateway host, either database', () => {
        for (const url of [`${API}/darwin/engine_outcomes?pipeline_fk=12`, `${API}/darwin_dev/initiative_deps?pipeline_fk=12&fields=id`,
            'https://topology.internal/api/darwin/epic_deps', 'http://localhost/darwin/swarm_sessions/']) {
            expect(isEmptyListRead(e('GET', url, 404))).toBe(true);
            expect(isFailed(e('GET', url, 404))).toBe(false);
        }
    });
    it('everything else that went wrong stays a failure', () => {
        for (const x of [
            e('GET', `${API}/darwin/engine_outcomes`, 0),                       // no answer
            e('GET', `${API}/darwin/engine_outcomes`, 500),                     // 5xx
            e('GET', `${API}/darwin/engine_outcomes`, 400),
            e('DELETE', `${API}/darwin/epics`, 404),                            // a non-GET 404
            e('PUT', `${API}/darwin/epics`, 404),
            e('GET', `${API}/darwin/requirements?id=4159`, 404),                // a single-record lookup
            e('GET', `${API}/darwin/requirements?fields=id&id=(1,2)`, 404),
            e('GET', `${API}/darwin/pipeline_compose?pipeline_fk=15`, 404),     // ONE plan, composed
            e('GET', 'https://cdn.example.com/missing.png', 404),              // not Lambda-Rest
            e('GET', `${API}/jwt`, 404),
        ]) {
            expect(isFailed(x)).toBe(true);
        }
        expect(isFailed(e('GET', `${API}/darwin/tasks`, 200))).toBe(false);
    });
});

describe('the capture is correct and complete (req #4159)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        queryClient.clear();
        document.body.innerHTML = '';
        useSnackBarStore.setState({ open: false, message: '', history: [] });
    });

    it('ACCEPTANCE: a plan page with empty engine_outcomes / initiative_deps reads lists NO failed requests', async () => {
        const plan = `${API}/darwin/engine_outcomes?pipeline_fk=12&fields=id,status`;
        for (let i = 0; i < 4; i++) await get(plan, 404);
        await get(`${API}/darwin/initiative_deps?pipeline_fk=12`, 404);
        await settle();
        const capture = await buildDebugCapture({ profile, filedFrom: { surface: '/swarm/pipeline/12?mode=plan', url: { full: '/swarm/pipeline/12?mode=plan' } } });
        const net = cat(capture, 'network');
        expect(net.emptyListReads).toBeGreaterThanOrEqual(5);
        const block = formatDebugBlock(capture, [], 4152);
        expect(failedLines(block)).toEqual([]);
        expect(block).not.toContain('engine_outcomes');
        // Nothing else went wrong in this test, so the block is the short one.
        expect(block).not.toContain('Captured at:');
    });

    it('ACCEPTANCE: a real failure beside them is still listed verbatim, with the empty reads counted once', async () => {
        await get(`${API}/darwin/engine_outcomes?pipeline_fk=12`, 404);
        pageFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await window.fetch(`${API}/darwin/swarm_completes`).catch(() => {});
        await get(`${API}/darwin/requirements?id=999999`, 404);
        await get(`${API}/darwin/pipeline_compose?pipeline_fk=15`, 404);
        await get(`${API}/darwin/tasks`, 502, '{"message":"Internal server error"}');
        pageFetch.mockResolvedValueOnce(new Response('"NOT FOUND"', { status: 404 }));
        await window.fetch(`${API}/darwin/epics`, { method: 'DELETE', body: '[{"id":1}]' });
        await settle();
        const block = formatDebugBlock(await buildDebugCapture({ profile }), [], 4113);
        expect(block).toContain('- GET k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng/darwin/swarm_completes → 0');
        expect(block).toContain('Failed to fetch');
        expect(block).toContain('/darwin/requirements?id=999999 → 404');
        expect(block).toContain('/darwin/pipeline_compose?pipeline_fk=15 → 404');
        expect(block).toContain('/darwin/tasks → 502');
        expect(block).toContain('- DELETE k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng/darwin/epics → 404');
        expect(block).not.toMatch(/engine_outcomes\?pipeline_fk=12 → 404/);
        expect(block).toMatch(/\nEmpty list reads: \d+ \(GET 404 = no rows; not failures\)\n/);
    });

    it('ACCEPTANCE (3877\'s shape): a client-side refusal the reader saw is in the capture and the block', async () => {
        const refusal = 'Epic 388 cannot be deleted: its initiative is locked. Unlock it first.';
        useSnackBarStore.getState().showError(refusal);
        useSnackBarStore.getState().close();                 // the snackbar hid itself before the press
        const capture = await buildDebugCapture({ profile });
        const screen = cat(capture, 'screen');
        expect(screen.snackbar.history).toEqual([expect.objectContaining({ kind: 'error', message: refusal })]);
        expect(screen.snackbar.history[0].msBeforePress).toBeGreaterThanOrEqual(0);
        // Stored once: the stores category no longer copies the history.
        expect(cat(capture, 'stores').snackBar.history).toBeUndefined();
        const block = formatDebugBlock(capture, [], 3877);
        expect(block).toContain('What the user saw (1):');
        expect(block).toMatch(/- snackbar error, \d+ s before the press: Epic 388 cannot be deleted: its initiative is locked/);
        expect(capture.categories.find(c => c.key === 'screen').note).toBe('1 snackbar message (1 error), 0 alerts/dialogs shown');
    });

    it('a shown alert or dialog is recorded; an error alert is failure evidence, an info alert and a hidden one are not', async () => {
        document.body.innerHTML = `
            <div role="alert" class="MuiAlert-root MuiAlert-standardError" data-testid="plan-load-error">Could not load plan 12: HTTP 500</div>
            <div class="MuiAlert-root MuiAlert-standardInfo">3 epics are paused</div>
            <div role="alert" hidden>an old alert</div>
            <div role="dialog" data-testid="confirm-delete"><h2>Delete epic 388?</h2><button>Delete</button></div>
            <div data-testid="requirement-editor-popup"><div role="alert">the filer's own save error</div></div>`;
        const seen = seenOnScreen(document);
        expect(seen.alerts.map(a => [a.kind, a.severity ?? null, a.text])).toEqual([
            ['alert', 'error', 'Could not load plan 12: HTTP 500'],
            ['alert', 'info', '3 epics are paused'],
            ['dialog', null, 'Delete epic 388?Delete'],
        ]);
        const block = formatDebugBlock(await buildDebugCapture({ profile }), [], 4154);
        expect(block).toContain('What the user saw (1):');
        expect(block).toContain('- alert (error) plan-load-error: Could not load plan 12: HTTP 500');
        expect(block).not.toContain('epics are paused');
        expect(block).not.toContain('filer\'s own');
    });

    it('a snackbar on screen is a snackbar, not an alert: a plain message never reads as a failure', async () => {
        useSnackBarStore.getState().showMessage('Focus lost to <button> — copied for Claude');
        document.body.innerHTML = `<div class="MuiSnackbar-root" data-testid="snackbar"><div role="alert" class="MuiSnackbarContent-root">
            <div class="MuiSnackbarContent-message">Focus lost to &lt;button&gt; — copied for Claude</div></div></div>`;
        const capture = await buildDebugCapture({ profile });
        expect(cat(capture, 'screen').alerts).toEqual([expect.objectContaining({ kind: 'snackbar', role: 'alert' })]);
        expect(formatDebugBlock(capture, [], 1)).not.toContain('What the user saw');
    });

    it('a page-local snackbar holding an error Alert is still failure evidence — it never reaches the store', async () => {
        document.body.innerHTML = `<div class="MuiSnackbar-root"><div role="alert" class="MuiAlert-root MuiAlert-filledError">Import failed: bad GPX</div></div>`;
        const capture = await buildDebugCapture({ profile });
        expect(cat(capture, 'screen').alerts).toEqual([expect.objectContaining({ kind: 'alert', severity: 'error' })]);
        expect(formatDebugBlock(capture, [], 1)).toContain('- alert (error): Import failed: bad GPX');
    });

    it('the storage note counts the keys stored once against the view state', async () => {
        localStorage.setItem('darwin-pipeline-plan-mode', JSON.stringify('plan'));
        localStorage.setItem('unrelated', '42');
        const filedFrom = { surface: '/swarm', url: { full: '/swarm' }, options: { app: 'swarm', viewState: viewState('swarm') } };
        const capture = await buildDebugCapture({ profile, filedFrom });
        expect(capture.categories.find(c => c.key === 'storage').note).toMatch(/^2 keys \(1 in view state\)/);
    });

    it('a shown alert is bounded and its text is scrubbed of tokens', async () => {
        const token = 'eyJraWQiOiJhYmNkZWZnaCJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXNlY3JldA';
        document.body.innerHTML = Array.from({ length: 14 }, (_, i) => `<div role="alert">bad ${i} ${token} ${'y'.repeat(900)}</div>`).join('');
        const capture = await buildDebugCapture({ profile });
        const screen = cat(capture, 'screen');
        expect(screen.alerts.length).toBeLessThanOrEqual(10);
        expect(screen.alertsDropped).toBe(14 - screen.alerts.length);
        expect(screen.alerts.every(a => a.text.length <= 501 && a.chars > 500)).toBe(true);
        expect(assembleBundle(capture, []).text).not.toContain('c2lnbmF0dXJlLXNlY3JldA');
    });

    it('focus: every loss and event says how long before the press; a loss from before this page loaded is stale', async () => {
        const old = new Date(Date.now() - 86 * 3600e3).toISOString();
        localStorage.setItem('darwinFocusLoss', JSON.stringify([{ at: old, cause: 'remounted', label: 'template title' }]));
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        const capture = await buildDebugCapture({ profile });
        const focus = cat(capture, 'focus');
        expect(focus.pageSessionStart).toMatch(/^\d{4}-/);
        expect(focus.losses[0]).toMatchObject({ stale: true, cause: 'remounted', at: old });
        expect(focus.losses[0].msBeforePress).toBeGreaterThan(85 * 3600e3);
        for (const ev of focus.timeline) {
            expect(ev.msBeforePress).toBeGreaterThanOrEqual(0);
            expect(ev.msAgo).toBeUndefined();
        }
        expect(capture.categories.find(c => c.key === 'focus').note).toMatch(/^1 loss \(1 stale\)/);
        // One that happened during this page session is evidence: no stale mark.
        localStorage.setItem('darwinFocusLoss', JSON.stringify([{ at: new Date().toISOString(), cause: 'blurred' }]));
        const fresh = cat(await buildDebugCapture({ profile }), 'focus').losses[0];
        expect(fresh.stale).toBeUndefined();
        expect(fresh.msBeforePress).toBeLessThan(5000);
    });

    it('storage the view state already records is named, not copied — and expands back byte for byte', async () => {
        localStorage.setItem('darwin-pipeline-plan-mode', JSON.stringify('plan'));
        localStorage.setItem('darwin-plan-zoom', JSON.stringify({ state: { zoom: 1.5, pan: { x: 3, y: 4 } }, version: 0 }));
        // Serialized the same way, a deep value names the view state's (fuller) copy too.
        localStorage.setItem('darwin-swarm-deep', JSON.stringify({ a: { b: { c: { d: 1 } } } }));
        // Over the view state's copy limit it holds only a size: the storage copy stays.
        localStorage.setItem('darwin-swarm-long', JSON.stringify('z'.repeat(2500)));
        localStorage.setItem('unrelated', '42');
        const filedFrom = { surface: '/swarm', url: { full: '/swarm' }, options: { app: 'swarm', viewState: viewState('swarm') } };
        const before = { local: snapshotStorage(localStorage), session: snapshotStorage(sessionStorage) };
        const capture = await buildDebugCapture({ profile, filedFrom });
        const storage = cat(capture, 'storage');
        expect(storage.local.sameAsViewState).toEqual({ at: 'filedFrom.options.viewState', keys: ['darwin-pipeline-plan-mode', 'darwin-swarm-deep'],
            wrapped: { 'darwin-plan-zoom': { state: '[filedFrom.options.viewState]', version: 0 } } });
        expect(Object.keys(storage.local.entries).sort()).toEqual(['darwin-swarm-long', 'unrelated']);
        // LOSSLESS: the old storage values, rebuilt from the new encoding and the filedFrom category.
        expect(expandStorage(storage, cat(capture, 'filedFrom'))).toEqual(before);
        expect(dedupeStorage(before, null)).toBe(before);
        // filedFrom dropped before save: the values go back in, so nothing points at a missing category.
        const cut = JSON.parse(assembleBundle(capture, ['filedFrom']).text);
        expect(cut.storage).toEqual(before);
        expect(cut.storage.local.sameAsViewState).toBeUndefined();
    });

    it('the editor lists the new category, and the network note counts requests, entries and empty reads', async () => {
        expect(DEBUG_CATEGORIES.map(c => c.key)).toContain('screen');
        expect(DEBUG_CATEGORIES.find(c => c.key === 'screen').label).toBe('On screen');
        const url = `${API}/darwin_dev/engine_outcomes?pipeline_fk=99`;
        for (let i = 0; i < 3; i++) await get(url, 404);
        const capture = await buildDebugCapture({ profile });
        const net = cat(capture, 'network');
        const entry = net.entries.find(x => x.url === url);
        expect(entry.earlier.count).toBeGreaterThanOrEqual(2);
        expect(capture.categories.find(c => c.key === 'network').note).toMatch(/\d+ requests in \d+ entries, \d+ failed, \d+ empty list reads/);
        expect(net.requests).toBeGreaterThan(net.entries.length);
    });
});
