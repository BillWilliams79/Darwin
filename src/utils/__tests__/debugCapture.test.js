// @vitest-environment jsdom
//
// req #3815 — the Bug button's always-on buffers: installed on import (index.jsx
// imports the module first), they record console, errors, network and
// navigation into rings bounded by entries AND bytes — never a header, never a
// request body, every URL's credential parameters redacted.

import { describe, it, expect, vi, beforeAll } from 'vitest';

// The page's own fetch and a silent console, before the buffers wrap them
// (index.jsx's first import).
const pageFetch = vi.hoisted(() => {
    const f = vi.fn();
    globalThis.fetch = f;
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = () => {};
    return f;
});

import {
    DEBUG_CAPTURE_CAPS, bounded, cleanUrl, debugCaptureState, installDebugCapture, ser,
} from '../debugCapture';

const TOKEN = 'eyJraWQiOiJhYmNkZWZnaCJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXNlY3JldA';
let state;
const last = (name) => state.rings[name].all().at(-1);

beforeAll(() => { state = debugCaptureState(); });

describe('debug capture buffers (req #3815)', () => {
    it('installs on import, once — a second install returns the same buffers', () => {
        expect(state).toBeTruthy();
        expect(installDebugCapture()).toBe(state);
        expect(state.rings.navigation.all()[0].how).toBe('boot');
    });

    it('records console lines with their args serialized at log time', () => {
        const obj = { a: 1 };
        console.error('boom', obj);
        obj.a = 2;
        expect(last('console')).toMatchObject({ level: 'error', args: ['boom', { a: 1 }] });
        console.warn(new Error('careful'));
        expect(last('console').args[0]).toMatchObject({ error: 'Error', message: 'careful' });
    });

    it('records uncaught errors, failed resource loads and unhandled rejections', () => {
        window.dispatchEvent(new ErrorEvent('error', { message: 'x is undefined', filename: 'http://localhost/src/a.js', lineno: 3, colno: 9 }));
        expect(last('errors')).toMatchObject({ kind: 'error', message: 'x is undefined', line: 3, col: 9 });
        const img = document.createElement('img');
        img.src = 'http://localhost/missing.png?token=abc';
        document.body.appendChild(img);
        img.dispatchEvent(new Event('error'));
        expect(last('errors')).toMatchObject({ kind: 'resource', tag: 'img' });
        expect(last('errors').src).toContain('token=%5Bredacted%5D');
        const ev = new Event('unhandledrejection');
        ev.reason = new Error('rejected');
        window.dispatchEvent(ev);
        expect(last('errors')).toMatchObject({ kind: 'unhandledrejection', message: 'rejected' });
    });

    it('traces a failing fetch with its body — never its headers or request body', async () => {
        pageFetch.mockResolvedValueOnce(new Response('{"error":"blank effort"}', { status: 400 }));
        const res = await window.fetch('https://api/darwin_dev/requirements?code=SECRETCODE', {
            method: 'post', headers: { Authorization: TOKEN }, body: JSON.stringify({ refresh: TOKEN }),
        });
        expect(res.status).toBe(400);
        await Promise.allSettled([...state.pendingBodies]);
        const e = last('network');
        expect(e).toMatchObject({ kind: 'fetch', method: 'POST', status: 400, failBody: '{"error":"blank effort"}' });
        expect(e.url).toBe('https://api/darwin_dev/requirements?code=%5Bredacted%5D');
        expect(e.reqBytes).toBeGreaterThan(0);
        expect(JSON.stringify(state.rings.network.all())).not.toContain(TOKEN.split('.')[2]);
    });

    it('a request that never answered is status 0 with its error, and still throws', async () => {
        pageFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await expect(window.fetch('https://api/nowhere')).rejects.toThrow('Failed to fetch');
        expect(last('network')).toMatchObject({ status: 0, error: 'Failed to fetch' });
    });

    it('a successful fetch keeps no body', async () => {
        pageFetch.mockResolvedValueOnce(new Response('[1,2,3]', { status: 200 }));
        await window.fetch('https://api/darwin_dev/tasks');
        expect(last('network')).toMatchObject({ status: 200 });
        expect(last('network').failBody).toBeUndefined();
    });

    it('records route changes', () => {
        history.pushState({}, '', '/swarm/pipeline/7?mode=plan');
        expect(last('navigation')).toMatchObject({ how: 'pushState' });
        expect(last('navigation').url).toContain('/swarm/pipeline/7?mode=plan');
    });

    it('bounds a ring by entries and counts what it dropped', () => {
        const r = state.rings.console;
        const before = r.dropped;
        for (let i = 0; i < DEBUG_CAPTURE_CAPS.rings.console.entries + 25; i++) console.debug('line', i);
        expect(r.size).toBe(DEBUG_CAPTURE_CAPS.rings.console.entries);
        expect(r.dropped).toBeGreaterThan(before);
        expect(r.bytes).toBeLessThanOrEqual(DEBUG_CAPTURE_CAPS.rings.console.bytes);
    });

    it('one oversized entry never evicts the whole history', () => {
        console.log('keep me');
        const huge = Array.from({ length: 40 }, () => 'x'.repeat(2000));
        console.log(...huge);
        const all = state.rings.console.all();
        expect(all.at(-1).truncated).toBeGreaterThan(8192);
        expect(JSON.stringify(all.at(-1)).length).toBeLessThanOrEqual(DEBUG_CAPTURE_CAPS.entryBytes);
        expect(all.at(-2).args).toEqual(['keep me']);
    });

    it('hooks a same-origin iframe on its load, into the same rings, tagged with its frame', async () => {
        const frame = document.createElement('iframe');
        const loaded = new Promise((r) => frame.addEventListener('load', r));
        document.body.appendChild(frame);
        await loaded;
        // The frame's own console is a different object; the hook wrapped it on
        // load. (jsdom also forwards a frame's console to the parent's, which a
        // browser does not — so look for the frame-tagged entry, not the last.)
        frame.contentWindow.console.error('inside the frame');
        const tagged = state.rings.console.all().filter(e => e.args?.[0] === 'inside the frame' && e.frame);
        expect(tagged).toHaveLength(1);
        expect(tagged[0].level).toBe('error');
        expect(state.frames.length).toBeGreaterThan(0);
    });

    it('an Error from another realm (a same-origin iframe) keeps its message and stack', async () => {
        const frame = document.createElement('iframe');
        const loaded = new Promise((r) => frame.addEventListener('load', r));
        document.body.appendChild(frame);
        await loaded;
        const FrameError = frame.contentWindow.Error;
        const err = new FrameError('from the frame');
        expect(err instanceof Error).toBe(false);
        expect(ser(err)).toMatchObject({ error: 'Error', message: 'from the frame' });
        const el = frame.contentWindow.document.createElement('button');
        el.setAttribute('data-testid', 'frame-btn');
        expect(ser(el)).toBe('[<button testid=frame-btn>]');
    });

    it('a value whose probe throws is unreadable, never a lost console line', () => {
        const hostile = new Proxy({}, { get() { throw new Error('blocked'); } });
        expect(ser(hostile)).toBe('[unreadable]');
        console.info('kept', hostile);
        expect(last('console').args).toEqual(['kept', '[unreadable]']);
    });

    it('an error keeps its own fields alongside name, message and stack', () => {
        const e = Object.assign(new Error('nope'), { code: 'E_DENIED' });
        expect(ser(e)).toMatchObject({ error: 'Error', message: 'nope', code: 'E_DENIED' });
    });

    it('re-opening an XHR mid-flight drops the aborted entry and its listener', async () => {
        const before = state.rings.network.size;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'http://localhost/first');
        xhr.send();
        const done = new Promise((r) => xhr.addEventListener('loadend', r, { once: true }));
        xhr.open('GET', 'http://localhost/second');
        xhr.send();
        await done;
        await new Promise((r) => setTimeout(r, 0));
        const added = state.rings.network.all().slice(before).map(e => e.url);
        expect(added).not.toContain('http://localhost/first');
        expect(added).toContain('http://localhost/second');
        expect(state.inFlight.size).toBe(0);
        expect(Object.keys(state.rings.network.all().at(-1))).not.toContain('onLoadEnd');
    });

    it('a reused XHR records one entry per request, each with its own status', async () => {
        const before = state.rings.network.size;
        const xhr = new XMLHttpRequest();
        for (const path of ['/one', '/two']) {
            const done = new Promise((r) => xhr.addEventListener('loadend', r, { once: true }));
            xhr.open('GET', `http://localhost${path}`);
            xhr.send();
            await done;
        }
        const added = state.rings.network.all().slice(before);
        expect(added.map(e => e.url)).toEqual(['http://localhost/one', 'http://localhost/two']);
        expect(state.inFlight.size).toBe(0);
    });

    it('redacts credential parameters and token-bearing hashes from every URL', () => {
        expect(cleanUrl('https://x/cb?code=abc&state=1#id_token=zzz'))
            .toBe('https://x/cb?code=%5Bredacted%5D&state=1#[redacted]');
        expect(cleanUrl(`https://x/?X-Amz-Signature=s&ok=1`)).toBe('https://x/?X-Amz-Signature=%5Bredacted%5D&ok=1');
        expect(cleanUrl(`https://x/${'a'.repeat(5000)}`).length).toBe(DEBUG_CAPTURE_CAPS.urlMax);
    });

    it('serializes within its bounds', () => {
        const deep = { a: { b: { c: { d: 1 } } } };
        expect(ser(deep)).toEqual({ a: { b: { c: '[object]' } } });
        const loop = {}; loop.self = loop;
        expect(ser(loop)).toEqual({ self: '[circular]' });
        expect(ser(() => {})).toMatch(/^\[fn/);
        expect(bounded({ s: 'y'.repeat(20000) }, 1000).truncated).toBeGreaterThan(1000);
    });
});
