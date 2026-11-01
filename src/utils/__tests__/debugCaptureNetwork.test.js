// @vitest-environment jsdom
//
// req #4159 — the network ring stores repeated GETs LOSSLESSLY (one entry per
// request, every occurrence's own fields kept) and never lets GET traffic
// evict a write. The old one-entry-per-request list is rebuilt from the new
// encoding, field for field.

import { describe, it, expect, vi } from 'vitest';

const pageFetch = vi.hoisted(() => {
    const f = vi.fn();
    globalThis.fetch = f;
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = () => {};
    return f;
});

import { DEBUG_CAPTURE_CAPS, debugCaptureState, encodeNetworkGroup, networkOccurrences, networkRing } from '../debugCapture';

const CAP = DEBUG_CAPTURE_CAPS.rings.network;
const API = 'https://k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng/darwin';
// What the old ring held per request: every field a fetch entry had.
const req = (i, over = {}) => ({ t: 1_000_000 + i * 1000, kind: 'fetch', method: 'GET', url: `${API}/engine_outcomes?pipeline_fk=12`,
    reqBytes: null, status: 404, ms: 40 + i, resBytes: 11, failBody: '"NOT FOUND"', ...over });
// Null and absent both mean "not known": compare without them.
const norm = (list) => JSON.parse(JSON.stringify(list, (k, v) => (v === null ? undefined : v)));

describe('network ring — repeats stored losslessly (req #4159)', () => {
    it('a repeated GET is one entry: the latest occurrence on top, every earlier one in parallel arrays', () => {
        const r = networkRing(CAP);
        r.push(req(0));
        r.push(req(1, { status: 200, failBody: undefined, resBytes: 900 }));
        r.push(req(2));
        expect(r.size).toBe(1);
        expect(r.occurrences).toBe(3);
        const [e] = r.all();
        expect(e).toMatchObject({ method: 'GET', status: 404, t: 1_002_000, ms: 42 });
        expect(e.earlier).toEqual({ count: 2, t: [1_000_000, 1_001_000], status: [404, 200], ms: [40, 41],
            resBytes: [11, 900], failBody: ['"NOT FOUND"', null] });
    });

    it('LOSSLESS: the old one-entry-per-request list is rebuilt from the new encoding', () => {
        const r = networkRing(CAP);
        const old = [];
        const urls = ['engine_outcomes?pipeline_fk=12', 'initiative_deps?pipeline_fk=12', 'pipeline_compose?id=12'];
        for (let i = 0; i < 60; i++) {
            const e = req(i, { url: `${API}/${urls[i % 3]}`, ...(i % 7 === 0 ? { status: 0, resBytes: null, failBody: undefined, error: 'Failed to fetch' } : null) });
            if (e.failBody === undefined) delete e.failBody;
            old.push(e);
            r.push({ ...e });
            if (i % 10 === 5) {
                const w = { t: e.t + 1, kind: 'xhr', method: 'PUT', url: `${API}/epics`, reqBytes: 42, status: 200, ms: 3, resBytes: 2 };
                old.push(w);
                r.push({ ...w });
            }
        }
        expect(r.size).toBe(3 + 6);                         // three GETs + six writes, 66 requests
        const rebuilt = networkOccurrences(JSON.parse(JSON.stringify(r.all())));
        const byEnd = (a, b) => (a.t + a.ms) - (b.t + b.ms);
        expect(norm(rebuilt)).toEqual(norm([...old].sort(byEnd)));
        expect(r.dropped).toBe(0);
    });

    it('a single request keeps exactly the shape it always had', () => {
        const one = req(0);
        expect(encodeNetworkGroup([one])).toBe(one);
        expect(networkOccurrences([one])).toEqual([one]);
    });

    it('GET traffic never evicts a write: the user\'s last save survives a polling flood', () => {
        const r = networkRing(CAP);
        r.push({ t: 1, kind: 'fetch', method: 'POST', url: `${API}/requirements`, reqBytes: 300, status: 400, ms: 5, resBytes: null, failBody: 'blank effort' });
        for (let i = 0; i < 3 * CAP.entries; i++) r.push(req(i, { url: `${API}/tasks?area_fk=${i}` }));
        const all = r.all();
        expect(all.some((e) => e.method === 'POST' && e.failBody === 'blank effort')).toBe(true);
        expect(r.size).toBeLessThanOrEqual(CAP.entries);
        expect(r.bytes).toBeLessThanOrEqual(CAP.bytes);
        expect(r.dropped).toBeGreaterThan(0);
    });

    it('writes are evicted by writes once they fill half the ring — reads keep their half', () => {
        const r = networkRing(CAP);
        for (let i = 0; i < CAP.entries; i++) r.push(req(i, { url: `${API}/tasks?area_fk=${i}` }));
        for (let i = 0; i < 2 * CAP.entries; i++) r.push({ t: i, kind: 'fetch', method: 'PUT', url: `${API}/tasks`, reqBytes: 9, status: 200, ms: 1, resBytes: 2 });
        const all = r.all();
        const writes = all.filter((e) => e.method === 'PUT').length;
        expect(writes).toBeLessThanOrEqual(CAP.entries / 2 + 1);
        expect(all.length - writes).toBeGreaterThanOrEqual(CAP.entries / 2 - 1);
        // The newest write is the one kept.
        expect(all.filter((e) => e.method === 'PUT').at(-1).t).toBe(2 * CAP.entries - 1);
    });

    it('holds more history at the same cap: 200 distinct requests polled 5 times each are all kept', () => {
        const r = networkRing(CAP);
        for (let round = 0; round < 5; round++) {
            for (let i = 0; i < 40; i++) r.push(req(round * 40 + i, { url: `${API}/t${i}` }));
        }
        expect(r.size).toBe(40);
        expect(r.occurrences).toBe(200);
        expect(r.dropped).toBe(0);
    });

    it('one entry never outgrows its bound: its oldest repeats are dropped and counted', () => {
        const r = networkRing(CAP);
        const max = Math.min(DEBUG_CAPTURE_CAPS.entryBytes, CAP.bytes / 4);
        for (let i = 0; i < 2000; i++) r.push(req(i));
        const [e] = r.all();
        expect(JSON.stringify(e).length).toBeLessThanOrEqual(max);
        expect(e.earlier.dropped).toBeGreaterThan(0);
        expect(e.earlier.count + 1 + e.earlier.dropped).toBe(2000);
        expect(r.dropped).toBe(e.earlier.dropped);
    });

    it('a snapshot fixes which requests are held, and still sees a failure body that lands later', () => {
        const r = networkRing(CAP);
        const live = req(0, { failBody: undefined });
        delete live.failBody;
        r.push(live);
        r.push(req(1, { failBody: undefined }));
        const snap = r.snapshot();
        r.push(req(2, { url: `${API}/other` }));
        live.failBody = 'late';
        const entries = snap();
        expect(entries).toHaveLength(1);
        expect(entries[0].earlier.failBody).toEqual(['late']);
    });

    it('a failure\'s 4 KB body reserve is released when the body lands, so failed reads do not evict history', () => {
        const r = networkRing(CAP);
        const reserve = 2 * DEBUG_CAPTURE_CAPS.failBodyMax;
        for (let i = 0; i < 60; i++) {
            const e = req(i, { url: `${API}/table_${i}`, failBody: undefined });
            delete e.failBody;
            r.push(e, reserve);
            e.failBody = '"NOT FOUND"';
            r.settle(e);
        }
        expect(r.size).toBe(60);           // 60 × 4 KB reserved would have kept only 16
        expect(r.dropped).toBe(0);
        expect(r.bytes).toBeLessThan(CAP.bytes / 2);
    });

    it('the page\'s own fetch settles its failure body into the live ring', async () => {
        const state = debugCaptureState();
        const before = state.rings.network.bytes;
        pageFetch.mockResolvedValueOnce(new Response('"NOT FOUND"', { status: 404 }));
        await window.fetch(`${API}/settle_probe`);
        await Promise.allSettled([...state.pendingBodies]);
        await new Promise((res) => setTimeout(res, 0));
        expect(state.rings.network.bytes - before).toBeLessThan(1000);
        expect(state.rings.network.all().at(-1)).toMatchObject({ status: 404, failBody: '"NOT FOUND"' });
    });

    it('parallel failed reads reserve only what their Content-Length can cost — none is evicted before its body lands', async () => {
        const state = debugCaptureState();
        const before = state.rings.network.dropped;
        const N = 40;
        for (let i = 0; i < N; i++) {
            pageFetch.mockResolvedValueOnce(new Response('"NOT FOUND"', { status: 404, headers: { 'content-length': '11' } }));
        }
        await Promise.all(Array.from({ length: N }, (_, i) => window.fetch(`${API}/parallel_${i}?pipeline_fk=1`)));
        expect(state.rings.network.dropped).toBe(before);
        await Promise.allSettled([...state.pendingBodies]);
        await new Promise((res) => setTimeout(res, 0));
        const held = state.rings.network.all().filter((e) => /parallel_/.test(e.url));
        expect(held).toHaveLength(N);
        expect(held.every((e) => e.failBody === '"NOT FOUND"')).toBe(true);
        expect(state.rings.network.bytes).toBeLessThanOrEqual(CAP.bytes);
    });

    it('a failure body still pending keeps its reserve when the same GET repeats, and lands accounted', () => {
        const r = networkRing(CAP);
        const failing = req(0, { status: 500, failBody: undefined });
        delete failing.failBody;
        r.push(failing, 4098);
        r.push(req(1, { status: 200, failBody: undefined }));          // the poll succeeds before the body is read
        failing.failBody = 'x'.repeat(2000);
        r.settle(failing);
        expect(r.all()[0].earlier.failBody).toEqual(['x'.repeat(2000)]);
        expect(r.bytes).toBe(JSON.stringify(r.all()).length - 2 - (r.size - 1));
    });

    it('a write too big for its bound is still a write: GET traffic cannot evict it', () => {
        const r = networkRing(CAP);
        r.push({ t: 1, kind: 'fetch', method: 'POST', url: `${API}/requirements?${'q'.repeat(1900)}`, reqBytes: 1, status: 400, ms: 1,
            resBytes: 2, failBody: 'y'.repeat(2000), error: 'z'.repeat(2000), note: 'w'.repeat(4000) });
        expect(r.all()[0].truncated).toBeGreaterThan(0);
        for (let i = 0; i < 3 * CAP.entries; i++) r.push(req(i, { url: `${API}/tasks?area_fk=${i}` }));
        expect(r.all().some((e) => e.truncated)).toBe(true);
    });
});
