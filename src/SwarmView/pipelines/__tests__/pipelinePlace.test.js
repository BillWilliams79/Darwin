// Req #3431 — the remembered place: the storage contract, the path it builds,
// the detail-path matcher the resume gate is guarded by, and the sweep.
//
// The module is pure and React-free, so this file needs no DOM. It needs a
// `localStorage`, which is a stub rather than jsdom's: several cases below are
// about storage BEHAVING BADLY (throwing, holding garbage), and a real one
// cannot be made to. Same shape as `viewportMemory.test.js`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    PIPELINE_PLACE_SCHEMA_VERSION,
    PIPELINE_PLACE_STORAGE_KEY as KEY,
    clearPipelinePlace,
    isPipelineDetailPath,
    pipelinePlaceAtList,
    pipelinePlacePath,
    prunePipelineStorage,
    readPipelinePlace,
    writePipelinePlace,
} from '../pipelinePlace';

/** A minimal in-memory Storage; `fail` makes every method throw. */
function makeStorage({ fail = false } = {}) {
    const map = new Map();
    const boom = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    return {
        map,
        stub: {
            get length() { return map.size; },
            key: (i) => [...map.keys()][i] ?? null,
            getItem: fail ? boom : (k) => (map.has(k) ? map.get(k) : null),
            setItem: fail ? boom : (k, v) => { map.set(k, String(v)); },
            removeItem: fail ? boom : (k) => { map.delete(k); },
        },
    };
}

function install(opts) {
    const local = makeStorage(opts);
    const session = makeStorage();
    vi.stubGlobal('localStorage', local.stub);
    vi.stubGlobal('sessionStorage', session.stub);
    return { local: local.map, session: session.map };
}

const raw = (rec) => JSON.stringify(rec);

describe('pipelinePlace', () => {
    let store;
    beforeEach(() => { store = install(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    describe('round trip', () => {
        it('remembers a plan', () => {
            // req #3463 also stored WHICH ERA the id belonged to, because 1.0
            // and 2.0 had disjoint id spaces and nothing translated between
            // them. req #3356 eradicated the second era, so an id IS an address
            // again and the field is gone.
            writePipelinePlace({ at: 'plan', pipelineId: 2 });
            expect(readPipelinePlace()).toEqual({ at: 'plan', pipelineId: 2 });
        });

        it('stores no era field, even when a caller passes one', () => {
            // A stale caller (or a stale record) must not smuggle an era back
            // into the shape — there is one plan surface and a second opinion
            // about which one this is cannot be a fact.
            writePipelinePlace({ at: 'plan', era: 1, pipelineId: 2 });
            expect(readPipelinePlace()).toEqual({ at: 'plan', pipelineId: 2 });
            expect(JSON.parse(store.local.get(KEY))).not.toHaveProperty('era');
        });

        it('remembers the list, keeping the plan last opened', () => {
            writePipelinePlace({ at: 'plan', pipelineId: 2 });
            writePipelinePlace(pipelinePlaceAtList(readPipelinePlace()));
            // `at` moved and the id did NOT — walking out to the list stops the
            // resume without un-marking the row the list is meant to mark.
            expect(readPipelinePlace()).toEqual({ at: 'list', pipelineId: 2 });
        });

        it('is nothing at all before the first visit', () => {
            expect(readPipelinePlace()).toBeNull();
        });

        it('forgets on clear', () => {
            writePipelinePlace({ at: 'plan', pipelineId: 2 });
            clearPipelinePlace();
            expect(readPipelinePlace()).toBeNull();
        });

        // req #3431 asked for localStorage by name, and "hours later" is
        // unreachable from the alternative. Pinned the same way the camera's is.
        it('stores in localStorage and never in sessionStorage', () => {
            writePipelinePlace({ at: 'plan', pipelineId: 2 });
            expect(store.local.has(KEY)).toBe(true);
            expect(store.session.has(KEY)).toBe(false);
        });
    });

    describe('a record that cannot be trusted', () => {
        // Each of these is handed to a route this feature then NAVIGATES to, so
        // "reads as null" is the difference between the list and a confident
        // trip to /swarm/pipeline/undefined.
        const junk = {
            'not JSON at all': '{{{',
            'a bare string': raw('plan'),
            'a number': raw(7),
            'null': raw(null),
            'an array': raw([{ at: 'plan', pipelineId: 2 }]),
            'a future schema version': raw({ v: 99, at: 'plan', pipelineId: 2 }),
            'no version': raw({ at: 'plan', pipelineId: 2 }),
            'an unknown place': raw({ v: 3, at: 'somewhere', pipelineId: 2 }),
            'no place at all': raw({ v: 3, pipelineId: 2 }),
        };
        Object.entries(junk).forEach(([name, value]) => {
            it(`refuses ${name}`, () => {
                store.local.set(KEY, value);
                expect(readPipelinePlace()).toBeNull();
            });
        });

        // A junk ID does NOT invalidate the record: `at` is still a fact, and
        // the page uses it to decide whether to resume at all. The id simply
        // resolves to null, which every consumer already treats as "no plan".
        it('keeps the place but drops an unusable id', () => {
            store.local.set(KEY, raw({
                v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', pipelineId: '12abc' }));
            expect(readPipelinePlace()).toEqual({ at: 'plan', pipelineId: null });
        });

        // `Number(null)` and `Number('')` are both 0, and 0 is a perfectly good
        // integer — so an id that never resolved would otherwise become a
        // confident navigation to a plan that does not exist.
        it('does not turn null or empty into plan 0', () => {
            store.local.set(KEY, raw({
                v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', pipelineId: null }));
            expect(readPipelinePlace().pipelineId).toBeNull();
            store.local.set(KEY, raw({
                v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', pipelineId: '' }));
            expect(readPipelinePlace().pipelineId).toBeNull();
        });

        it('stamps the current schema version on every write', () => {
            writePipelinePlace({ at: 'plan', pipelineId: 2 });
            expect(JSON.parse(store.local.get(KEY)).v).toBe(PIPELINE_PLACE_SCHEMA_VERSION);
        });

        it('refuses to write a place that is not a place', () => {
            writePipelinePlace({ at: 'nowhere', pipelineId: 2 });
            writePipelinePlace(null);
            expect(store.local.has(KEY)).toBe(false);
        });

        // ── req #3356 — EVERY OLDER VERSION IS DROPPED ─────────────────────
        // v1 was the original two-field record and v2 (req #3463) added `era`.
        // v3 is v1's shape again, so v2 COULD be read forward by stripping one
        // field — and deliberately is not. A v2 record carrying `era: 1` names
        // a plan in an id space that no longer exists, and that id may well
        // collide with a live plan of the surviving era; reading it forward
        // would resume the reader into a DIFFERENT plan than the one they left,
        // confidently. Telling the two apart means keeping the era vocabulary
        // alive inside a module that has no eras, forever, for a convenience
        // feature. The cost of dropping is one forgotten plan, once.

        it('drops a v1 record', () => {
            store.local.set(KEY, raw({ v: 1, at: 'plan', pipelineId: 2 }));
            expect(readPipelinePlace()).toBeNull();
        });

        it('drops a v2 record even though its shape could be read forward', () => {
            store.local.set(KEY, raw({ v: 2, at: 'plan', era: 2, pipelineId: 7 }));
            expect(readPipelinePlace()).toBeNull();
        });

        it('drops a v2 record naming a plan in the RETIRED id space', () => {
            // The case that decided it: id 2 was a real 1.0 plan and is also a
            // plausible id in the surviving space. Reading this forward is a
            // confident trip to somebody else's plan.
            store.local.set(KEY, raw({ v: 2, at: 'plan', era: 1, pipelineId: 2 }));
            expect(readPipelinePlace()).toBeNull();
        });

        it('still drops an unknown future version', () => {
            store.local.set(KEY, raw({ v: 99, at: 'plan', pipelineId: 2 }));
            expect(readPipelinePlace()).toBeNull();
        });

        it('pipelinePlaceAtList keeps the remembered plan, or null', () => {
            expect(pipelinePlaceAtList(null))
                .toEqual({ at: 'list', pipelineId: null });
            expect(pipelinePlaceAtList({ pipelineId: 7 }))
                .toEqual({ at: 'list', pipelineId: 7 });
        });
    });

    describe('storage that throws (Safari private mode, quota)', () => {
        // A convenience that fails loudly is worse than one that fails.
        it('never throws, in either direction', () => {
            install({ fail: true });
            expect(() => writePipelinePlace({ at: 'plan', pipelineId: 2 })).not.toThrow();
            expect(readPipelinePlace()).toBeNull();
            expect(() => clearPipelinePlace()).not.toThrow();
            expect(() => prunePipelineStorage([1])).not.toThrow();
        });
    });

    describe('pipelinePlacePath', () => {
        it('names the plan and carries no query string', () => {
            // NOT `?mode=` — see the module header. The panel comes from the
            // reader's stored preference, and a query parameter here would be a
            // link channel carrying standing state.
            expect(pipelinePlacePath({ at: 'plan', pipelineId: 2 }))
                .toBe('/swarm/pipeline/2');
        });

        it('is null when there is no plan to go to', () => {
            expect(pipelinePlacePath({ at: 'list', pipelineId: null })).toBeNull();
            expect(pipelinePlacePath(null)).toBeNull();
            expect(pipelinePlacePath({ pipelineId: 'x' })).toBeNull();
        });
    });

    describe('isPipelineDetailPath', () => {
        it('matches a plan', () => {
            expect(isPipelineDetailPath('/swarm/pipeline/2')).toBe(true);
            expect(isPipelineDetailPath('/swarm/pipeline/2/')).toBe(true);
        });

        // The singular/plural split is one character and the list is a PREFIX
        // of nothing here — but a sloppy match would make the list look like a
        // plan, which permanently disables the resume.
        it('does not match the list', () => {
            expect(isPipelineDetailPath('/swarm/pipelines')).toBe(false);
        });

        it('does not match neighbours or nonsense', () => {
            ['/swarm/pipeline', '/swarm/pipeline/', '/swarm/pipeline/abc',
                '/swarm/pipeline/2/steps', '/swarm/steps', '', null, undefined,
            ].forEach((p) => expect(isPipelineDetailPath(p)).toBe(false));
        });
    });

    describe('prunePipelineStorage', () => {
        const seed = () => {
            store.local.set('darwin-viewport-plan-view-2', 'cam2');
            store.local.set('darwin-viewport-plan-view-9', 'cam9');
            store.local.set('darwin-scroll-plan-view-table-2', 'y2');
            store.local.set('darwin-scroll-plan-view-table-9', 'y9');
            store.local.set('darwin-scroll-plan-view-table-x-2', 'x2');
            store.local.set('darwin-scroll-plan-view-table-x-9', 'x9');
        };

        it('drops every surface of a plan that no longer exists', () => {
            seed();
            prunePipelineStorage([2]);
            expect([...store.local.keys()].sort()).toEqual([
                'darwin-scroll-plan-view-table-2',
                'darwin-scroll-plan-view-table-x-2',
                'darwin-viewport-plan-view-2',
            ]);
        });

        // The horizontal key's prefix contains the vertical key's prefix, so a
        // first-match sweep reads its id as `x-9`, fails the integer test, and
        // silently exempts every horizontal offset forever.
        it('reads the horizontal table key as a plan key, not as unknown', () => {
            store.local.set('darwin-scroll-plan-view-table-x-9', 'x9');
            prunePipelineStorage([2]);
            expect(store.local.size).toBe(0);
        });

        // Deleting while enumerating `localStorage.key(i)` skips whatever slides
        // into the freed slot, which leaves half the orphans behind.
        it('collects every orphan in one pass', () => {
            for (let i = 10; i < 20; i += 1) {
                store.local.set(`darwin-viewport-plan-view-${i}`, 'cam');
            }
            prunePipelineStorage([2]);
            expect(store.local.size).toBe(0);
        });

        it('leaves keys it does not own alone', () => {
            store.local.set('darwin-scroll-pipelines-list', 'listY');
            store.local.set('darwin-swarm-pipelines-view', 'cards');
            store.local.set('darwin-viewport-swarm-canvas-9', 'someone else');
            store.local.set('maps_scrollY', '400');
            prunePipelineStorage([2]);
            expect([...store.local.keys()].sort()).toEqual([
                'darwin-scroll-pipelines-list',
                'darwin-swarm-pipelines-view',
                'darwin-viewport-swarm-canvas-9',
                'maps_scrollY',
            ]);
        });

        // "No plans exist" and "the plans have not arrived yet" are the same
        // value and opposite instructions. Acting on the second wipes every
        // position the reader has, and nothing in the app puts them back.
        it('refuses an empty live set', () => {
            seed();
            prunePipelineStorage([]);
            prunePipelineStorage(null);
            expect(store.local.size).toBe(6);
        });

        it('retires req #3311\'s key from both stores', () => {
            const old = 'darwin-swarm-pipelines-last-opened';
            store.local.set(old, '2');
            store.session.set(old, '2');
            prunePipelineStorage([2]);
            expect(store.local.has(old)).toBe(false);
            expect(store.session.has(old)).toBe(false);
        });
    });
});
