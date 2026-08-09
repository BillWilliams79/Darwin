// Req #3311 — the SCROLL half of viewportMemory's contract.
//
// A separate file from `viewportMemory.test.js` (which pins the camera half)
// because the two answer different questions and only one of them has a
// fingerprint. The storage stub, and the reason for stubbing rather than using
// jsdom's own, is that file's: several cases below need storage BEHAVING BADLY,
// and a real one cannot be made to.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    SCROLL_SCHEMA_VERSION,
    readScroll,
    scrollStorageKey,
    writeScroll,
} from '../viewportMemory';

const KEY = scrollStorageKey('pipeline-plan-table', 2);
const POS = { x: 240, y: 1180 };

/** A minimal in-memory localStorage; `fail` makes every method throw. */
function installStorage({ fail = false } = {}) {
    const map = new Map();
    const boom = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    const stub = {
        getItem: fail ? boom : (k) => (map.has(k) ? map.get(k) : null),
        setItem: fail ? boom : (k, v) => { map.set(k, String(v)); },
        removeItem: fail ? boom : (k) => { map.delete(k); },
    };
    vi.stubGlobal('localStorage', stub);
    return map;
}

describe('scroll memory', () => {
    let store;
    beforeEach(() => { store = installStorage(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    // req #3431 — the scroll half moved store with the camera half, and for the
    // reason the module's own doctrine gives: a plan whose camera survived a
    // browser restart and whose table scroll did not is one feature half
    // delivered. Pinned the same way, by sessionStorage never being touched.
    describe('the store is localStorage, and only localStorage', () => {
        it('writes and reads without touching sessionStorage', () => {
            const session = vi.fn();
            vi.stubGlobal('sessionStorage',
                { getItem: session, setItem: session, removeItem: session });

            const key = scrollStorageKey('pipelines-list');
            writeScroll(key, { x: 0, y: 640 });
            expect(store.get(key)).toBeTypeOf('string');
            expect(readScroll(key)).toEqual({ x: 0, y: 640 });

            expect(session).not.toHaveBeenCalled();
        });
    });

    describe('scrollStorageKey', () => {
        it('namespaces by surface, and by record id when there is one', () => {
            expect(scrollStorageKey('pipelines-list'))
                .toBe('darwin-scroll-pipelines-list');
            expect(scrollStorageKey('pipeline-plan-table', 2))
                .toBe('darwin-scroll-pipeline-plan-table-2');
        });

        // The two surfaces on the plan page — the page scroll and the table's own
        // horizontal one — must never land on one key, or each would restore the
        // other's offset.
        it('keeps two record ids and two surfaces apart', () => {
            expect(scrollStorageKey('pipeline-plan-table', 2))
                .not.toBe(scrollStorageKey('pipeline-plan-table', 3));
            expect(scrollStorageKey('pipeline-plan-table', 2))
                .not.toBe(scrollStorageKey('pipeline-plan-table-x', 2));
        });

        // The prefix is deliberately not the camera's: a `{x,y}` read as a
        // `{x,y,k}` would be refused, but a collision is a bug either way and the
        // namespaces are what stop one.
        it('does not collide with the camera namespace', () => {
            expect(scrollStorageKey('pipeline-plan', 2)).not.toBe('darwin-viewport-pipeline-plan-2');
        });

        // `0` is a real record id and `??`-style guards get this wrong.
        it('treats a zero record id as a record id, not as absent', () => {
            expect(scrollStorageKey('s', 0)).toBe('darwin-scroll-s-0');
        });
    });

    describe('round trip', () => {
        it('returns exactly what was written', () => {
            writeScroll(KEY, POS);
            expect(readScroll(KEY)).toEqual(POS);
        });

        it('reads back the origin — 0,0 is a real position, not "nothing stored"', () => {
            writeScroll(KEY, { x: 0, y: 0 });
            expect(readScroll(KEY)).toEqual({ x: 0, y: 0 });
        });

        it('keeps two records independent', () => {
            const other = scrollStorageKey('pipelines-list');
            writeScroll(KEY, POS);
            writeScroll(other, { x: 0, y: 42 });
            expect(readScroll(KEY)).toEqual(POS);
            expect(readScroll(other)).toEqual({ x: 0, y: 42 });
        });

        it('a later write replaces the earlier one', () => {
            writeScroll(KEY, POS);
            writeScroll(KEY, { x: 1, y: 2 });
            expect(readScroll(KEY)).toEqual({ x: 1, y: 2 });
        });

        // Sub-pixel offsets are what a trackpad and a zoomed browser both
        // produce; rounding them here would be a second, silent rule.
        it('preserves a fractional offset', () => {
            writeScroll(KEY, { x: 0.5, y: 12.25 });
            expect(readScroll(KEY)).toEqual({ x: 0.5, y: 12.25 });
        });
    });

    describe('validation — never trust what came out of storage', () => {
        const put = (value) => store.set(KEY,
            typeof value === 'string' ? value : JSON.stringify(value));
        const rec = (over) => ({ v: SCROLL_SCHEMA_VERSION, ...POS, ...over });

        it('refuses unparseable JSON', () => {
            put('{not json');
            expect(readScroll(KEY)).toBeNull();
        });

        it.each([['null', 'null'], ['a bare number', '7'], ['a string', '"hi"'], ['an array', '[]']])(
            'refuses %s', (_label, raw) => {
                put(raw);
                expect(readScroll(KEY)).toBeNull();
            });

        // `window.scrollTo(0, NaN)` is SPECIFIED to normalize to 0 rather than
        // throw, so a corrupt record would scroll the reader to the top and read
        // as the feature simply not working. That silence is why this is checked.
        it.each(['x', 'y'])('refuses a non-finite %s', (field) => {
            put(rec({ [field]: null }));
            expect(readScroll(KEY)).toBeNull();
            put(rec({ [field]: 'NaN' }));
            expect(readScroll(KEY)).toBeNull();
        });

        it('refuses a missing field', () => {
            const r = rec();
            delete r.y;
            put(r);
            expect(readScroll(KEY)).toBeNull();
        });

        // Nothing here can WRITE a negative (see below), so one in storage can
        // only be corruption. Browsers clamp a negative offset to 0 rather than
        // rejecting it, so restoring one would be silent and wrong.
        it.each([[-1, 0], [0, -1]])('refuses a negative offset (%s, %s)', (x, y) => {
            put(rec({ x, y }));
            expect(readScroll(KEY)).toBeNull();
        });

        it('refuses a record from a different schema version', () => {
            put(rec({ v: SCROLL_SCHEMA_VERSION + 1 }));
            expect(readScroll(KEY)).toBeNull();
            put(rec({ v: undefined }));
            expect(readScroll(KEY)).toBeNull();
        });

        it('refuses to write a position it would refuse to read', () => {
            writeScroll(KEY, { x: NaN, y: 0 });
            writeScroll(KEY, { x: 0, y: Infinity });
            expect(store.has(KEY)).toBe(false);
        });

        // Safari reports a NEGATIVE offset during rubber-band overscroll, so a
        // fling to the top then a click is an ORDINARY gesture that produces
        // one. Refusing the record would discard a perfectly good `x` with it,
        // because a record is read whole — and it would leave a write nobody
        // can ever read. 0 is what the gesture means.
        it('clamps a negative offset on write rather than storing an unreadable record', () => {
            writeScroll(KEY, { x: 12, y: -30 });
            expect(readScroll(KEY)).toEqual({ x: 12, y: 0 });
            writeScroll(KEY, { x: -5, y: -5 });
            expect(readScroll(KEY)).toEqual({ x: 0, y: 0 });
        });
    });

    describe('no key means no persistence', () => {
        // How a caller says "this surface has no identity yet" (a plan id that
        // has not resolved) and "not this landing" (a deep link owns the
        // position). Either way it must not read or write anyone else's.
        it.each([null, undefined, ''])('reads null and writes nothing for %s', (key) => {
            writeScroll(key, POS);
            expect(store.size).toBe(0);
            expect(readScroll(key)).toBeNull();
        });
    });

    describe('storage unavailable (Safari private mode, quota)', () => {
        // A convenience, not a feature that can fail loudly. Every path degrades
        // to "there is no saved position", which is the first-ever visit.
        beforeEach(() => { installStorage({ fail: true }); });

        it('never throws, and reads as absent', () => {
            expect(() => writeScroll(KEY, POS)).not.toThrow();
            expect(readScroll(KEY)).toBeNull();
        });
    });

    describe('storage missing entirely', () => {
        it('never throws when there is no localStorage at all', () => {
            vi.stubGlobal('localStorage', undefined);
            expect(readScroll(KEY)).toBeNull();
            expect(() => writeScroll(KEY, POS)).not.toThrow();
        });
    });
});
