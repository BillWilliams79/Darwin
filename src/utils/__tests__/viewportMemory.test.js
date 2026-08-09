// Req #3252 — the canvas-camera memory contract.
// Req #3431 — and the STORE it is kept in, which reversed to localStorage.
//
// The module is pure and React-free precisely so this file needs no DOM. It
// needs a `localStorage`, which jsdom would provide but which is cheaper and
// more controllable as a stub — the point of several cases below is storage
// BEHAVING BADLY (throwing, holding garbage), and a real one cannot be made to.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    VIEWPORT_SCHEMA_VERSION,
    clearViewport,
    readViewport,
    viewportStorageKey,
    writeViewport,
} from '../viewportMemory';

const KEY = viewportStorageKey('pipeline-plan', 2);
const FP = '1200x800:64:9';
const CAM = { x: -340.5, y: -120.25, k: 1.75 };

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

describe('viewportMemory', () => {
    let store;
    beforeEach(() => { store = installStorage(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    // ── req #3431 — DURABILITY IS THE FEATURE, so it is asserted directly ──
    // > *"if you navigate away you would hours later when coming back, go
    // > straight that spot. a feature saved to local storage only."*
    //
    // A tab closed is a sessionStorage cleared, so "which store" is not an
    // implementation detail here — it is the difference between the requirement
    // being met and being unreachable. Asserting the camera round-trips proves
    // nothing about it: it round-trips through either store equally well. What
    // pins it is that sessionStorage is NEVER TOUCHED, in either direction.
    describe('the store is localStorage, and only localStorage', () => {
        it('writes, reads and clears without touching sessionStorage', () => {
            const session = vi.fn();
            vi.stubGlobal('sessionStorage',
                { getItem: session, setItem: session, removeItem: session });

            writeViewport(KEY, FP, CAM);
            expect(store.get(KEY)).toBeTypeOf('string');
            expect(readViewport(KEY, FP)).toEqual(CAM);
            clearViewport(KEY);

            expect(session).not.toHaveBeenCalled();
        });
    });

    describe('viewportStorageKey', () => {
        // The key namespace is deliberately NOT `darwin-<feature>-view`: that
        // belongs to view preferences, and the whole doctrine here is that a
        // camera is not one. A collision would let a preference read as a camera.
        it('namespaces by surface and record id', () => {
            expect(viewportStorageKey('pipeline-plan', 2)).toBe('darwin-viewport-pipeline-plan-2');
            expect(viewportStorageKey('pipeline-plan', 3))
                .not.toBe(viewportStorageKey('pipeline-plan', 2));
        });
    });

    describe('round trip', () => {
        it('returns exactly what was written, for the same fingerprint', () => {
            writeViewport(KEY, FP, CAM);
            expect(readViewport(KEY, FP)).toEqual(CAM);
        });

        it('keeps two records independent', () => {
            const other = viewportStorageKey('pipeline-plan', 3);
            writeViewport(KEY, FP, CAM);
            writeViewport(other, FP, { x: 10, y: 20, k: 0.5 });
            expect(readViewport(KEY, FP)).toEqual(CAM);
            expect(readViewport(other, FP)).toEqual({ x: 10, y: 20, k: 0.5 });
        });

        it('a later write replaces the earlier one', () => {
            writeViewport(KEY, FP, CAM);
            writeViewport(KEY, FP, { x: 1, y: 2, k: 3 });
            expect(readViewport(KEY, FP)).toEqual({ x: 1, y: 2, k: 3 });
        });

        it('reads back a camera at the origin — 0,0 is a real position', () => {
            writeViewport(KEY, FP, { x: 0, y: 0, k: 1 });
            expect(readViewport(KEY, FP)).toEqual({ x: 0, y: 0, k: 1 });
        });
    });

    describe('the fingerprint gate', () => {
        // THE LOAD-BEARING RULE. A camera restored onto rescaled geometry does
        // not fail loudly — it lands somewhere unrelated, which reads as a defect
        // in the drawing rather than in the restore. Refuse, never approximate.
        it('refuses a camera taken under different geometry', () => {
            writeViewport(KEY, FP, CAM);
            expect(readViewport(KEY, '1400x800:64:9')).toBeNull();
            expect(readViewport(KEY, '1200x800:65:9')).toBeNull();
            expect(readViewport(KEY, '1200x800:64:10')).toBeNull();
        });

        it('does not delete the refused record — the geometry may come back', () => {
            writeViewport(KEY, FP, CAM);
            expect(readViewport(KEY, 'other')).toBeNull();
            expect(readViewport(KEY, FP)).toEqual(CAM);
        });

        it('an undefined fingerprint does not match a stored one', () => {
            writeViewport(KEY, FP, CAM);
            expect(readViewport(KEY, undefined)).toBeNull();
        });
    });

    describe('validation — never trust what came out of storage', () => {
        const put = (value) => store.set(KEY, typeof value === 'string' ? value : JSON.stringify(value));
        const rec = (over) => ({ v: VIEWPORT_SCHEMA_VERSION, fp: FP, ...CAM, ...over });

        it('refuses unparseable JSON', () => {
            put('{not json');
            expect(readViewport(KEY, FP)).toBeNull();
        });

        // `typeof null === 'object'`, and `"7"` parses to a number — both would
        // sail past a bare truthiness check straight into a property read.
        it.each([['null', 'null'], ['a bare number', '7'], ['a string', '"hi"'], ['an array', '[]']])(
            'refuses %s', (_label, raw) => {
                put(raw);
                expect(readViewport(KEY, FP)).toBeNull();
            });

        // A NaN does not throw when it reaches the canvas — it multiplies into
        // every coordinate and renders nothing, with no error to see. That is
        // why this is validated here rather than trusted downstream.
        it.each(['x', 'y', 'k'])('refuses a non-finite %s', (field) => {
            put(rec({ [field]: null }));
            expect(readViewport(KEY, FP)).toBeNull();
            // NaN and Infinity do not survive JSON.stringify — they arrive as
            // null — so the string forms are what a hand-edited record looks like.
            put(rec({ [field]: 'NaN' }));
            expect(readViewport(KEY, FP)).toBeNull();
        });

        it('refuses a missing field', () => {
            const r = rec();
            delete r.y;
            put(r);
            expect(readViewport(KEY, FP)).toBeNull();
        });

        // A zero or negative scale is not a small view, it is a collapsed or
        // mirrored world. No zoom behaviour can produce one.
        it.each([0, -1])('refuses a scale of %s', (k) => {
            put(rec({ k }));
            expect(readViewport(KEY, FP)).toBeNull();
        });

        it('refuses a record from a different schema version', () => {
            put(rec({ v: VIEWPORT_SCHEMA_VERSION + 1 }));
            expect(readViewport(KEY, FP)).toBeNull();
            put(rec({ v: undefined }));
            expect(readViewport(KEY, FP)).toBeNull();
        });

        it('refuses to write a camera it would refuse to read', () => {
            writeViewport(KEY, FP, { x: NaN, y: 0, k: 1 });
            writeViewport(KEY, FP, { x: 0, y: Infinity, k: 1 });
            expect(store.has(KEY)).toBe(false);
        });
    });

    describe('no key means no persistence', () => {
        // A canvas whose record id has not resolved must not read or write
        // another canvas's camera. Null is how the caller says so.
        it.each([null, undefined, ''])('reads null and writes nothing for %s', (key) => {
            writeViewport(key, FP, CAM);
            expect(store.size).toBe(0);
            expect(readViewport(key, FP)).toBeNull();
            expect(() => clearViewport(key)).not.toThrow();
        });
    });

    describe('clearViewport', () => {
        it('forgets the camera', () => {
            writeViewport(KEY, FP, CAM);
            clearViewport(KEY);
            expect(readViewport(KEY, FP)).toBeNull();
        });

        it('leaves other records alone', () => {
            const other = viewportStorageKey('pipeline-plan', 3);
            writeViewport(KEY, FP, CAM);
            writeViewport(other, FP, CAM);
            clearViewport(KEY);
            expect(readViewport(other, FP)).toEqual(CAM);
        });
    });

    describe('storage unavailable (Safari private mode, quota)', () => {
        // This is a convenience, not a feature that can fail loudly. Every path
        // has to degrade to "there is no saved camera", which is a state the
        // caller already handles — it is the first-ever visit.
        beforeEach(() => { installStorage({ fail: true }); });

        it('never throws, and reads as absent', () => {
            expect(() => writeViewport(KEY, FP, CAM)).not.toThrow();
            expect(() => clearViewport(KEY)).not.toThrow();
            expect(readViewport(KEY, FP)).toBeNull();
        });
    });

    describe('storage missing entirely', () => {
        it('never throws when there is no localStorage at all', () => {
            vi.stubGlobal('localStorage', undefined);
            expect(readViewport(KEY, FP)).toBeNull();
            expect(() => writeViewport(KEY, FP, CAM)).not.toThrow();
            expect(() => clearViewport(KEY)).not.toThrow();
        });
    });
});
