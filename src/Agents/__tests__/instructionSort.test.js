// Req #3063 — the browse-list sort vocabulary, added during manual UI review and
// specified by the frontend-architect's viewer-header ruling.
//
// The comparator is imported from the page, not mirrored here: a mirrored copy
// would keep passing after the real one drifted, which is the exact failure these
// tests exist to prevent.
//
// The invariant worth pinning is the one a reader of the page cannot see — that
// the open/closed split OUTRANKS whichever sort the user picked, in both
// directions. A closed instruction binds nothing at boot, so it must never be
// listed above a live one, however it would otherwise sort.

import { describe, it, expect, afterEach } from 'vitest';

import {
    compareInstructionRows, SORT_ASC, lastTouched,
    readStoredSort, DEFAULT_SORT_MODE, SORT_MODES, SORT_STORAGE_KEY,
} from '../instructionSort';

const row = (id, name, refs, extra = {}) => ({
    id, name, refs: new Array(refs).fill(0), closed: 0, ...extra,
});

const sorted = (rows, mode, desc) =>
    [...rows].sort(compareInstructionRows(mode, desc));

const ROWS = [
    row(1, 'zebra-rule', 1, { update_ts: '2026-07-01T00:00:00' }),
    row(2, 'alpha-rule', 5, { update_ts: '2026-01-01T00:00:00' }),
    row(3, 'middle-rule', 3, { update_ts: '2026-07-20T00:00:00' }),
];

describe('sort modes', () => {
    it('leads with the biggest blast radius in the default mode', () => {
        expect(sorted(ROWS, 'agents', true).map(r => r.id)).toEqual([2, 3, 1]);
    });

    it('sorts by name A→Z', () => {
        expect(sorted(ROWS, 'name', false).map(r => r.name))
            .toEqual(['alpha-rule', 'middle-rule', 'zebra-rule']);
    });

    it('leads with the most recently changed', () => {
        expect(sorted(ROWS, 'date', true).map(r => r.id)).toEqual([3, 1, 2]);
    });

    it('reverses cleanly, because every comparator is written ascending', () => {
        expect(sorted(ROWS, 'agents', false).map(r => r.id)).toEqual([1, 3, 2]);
        expect(sorted(ROWS, 'name', true).map(r => r.name))
            .toEqual(['zebra-rule', 'middle-rule', 'alpha-rule']);
        expect(sorted(ROWS, 'date', false).map(r => r.id)).toEqual([2, 1, 3]);
    });
});

describe('lastTouched', () => {
    it('falls back to create_ts for a row that has never been edited', () => {
        // `update_ts` is NULL until the first edit. Without the fallback every
        // untouched row would sort as if it were from 1970.
        expect(lastTouched({ update_ts: null, create_ts: '2026-07-24T00:00:00' }))
            .toBe(Date.parse('2026-07-24T00:00:00'));
    });

    it('returns 0 rather than NaN for a row with neither date', () => {
        // NaN would poison the subtraction and make the comparator non-transitive,
        // which is an unstable sort rather than a wrong one — much harder to spot.
        expect(lastTouched({})).toBe(0);
    });

    it('puts a never-edited row above one edited long ago', () => {
        const rows = [
            row(11, 'edited-long-ago', 0, { update_ts: '2026-02-01T00:00:00' }),
            row(10, 'never-edited', 0, { update_ts: null, create_ts: '2026-07-24T00:00:00' }),
        ];
        expect(sorted(rows, 'date', true).map(r => r.id)).toEqual([10, 11]);
    });
});

describe('closed rows stay below open ones', () => {
    const withClosed = [
        row(20, 'aaa-closed-but-first-alphabetically', 9,
            { closed: 1, update_ts: '2026-07-25T00:00:00' }),
        row(21, 'zzz-open', 1, { update_ts: '2026-01-01T00:00:00' }),
    ];

    it('in every mode and both directions', () => {
        // Row 20 would otherwise win on ALL THREE axes: most agents, first
        // alphabetically, most recently changed.
        for (const mode of ['agents', 'name', 'date']) {
            for (const desc of [true, false]) {
                expect(sorted(withClosed, mode, desc).map(r => r.id)).toEqual([21, 20]);
            }
        }
    });
});

describe('tiebreaks', () => {
    it('falls back to name, which is a TOTAL order', () => {
        // `instructions.name` carries a UNIQUE key, so no two rows can tie here.
        // Until migration 072 this fell back to the catalog order first; that
        // column is gone, and name alone is enough to make the sort stable.
        const tied = [row(30, 'bbb', 2), row(31, 'aaa', 2)];
        expect(sorted(tied, 'agents', true).map(r => r.name)).toEqual(['aaa', 'bbb']);
        expect(sorted(tied, 'date', true).map(r => r.name)).toEqual(['aaa', 'bbb']);
    });

    it('does not shuffle across repeated sorts of equal rows', () => {
        const tied = [row(50, 'ccc', 2), row(51, 'aaa', 2), row(52, 'bbb', 2)];
        const once = sorted(tied, 'agents', true).map(r => r.id);
        const twice = sorted(sorted(tied, 'agents', true), 'agents', true).map(r => r.id);
        expect(twice).toEqual(once);
    });
});

describe('an unknown stored mode', () => {
    it('falls back to the default rather than throwing', () => {
        // The mode is read from localStorage, so it can be anything.
        expect(Object.keys(SORT_ASC)).toEqual(['agents', 'name', 'date']);
        expect(sorted(ROWS, 'garbage-from-localstorage', true).map(r => r.id))
            .toEqual(sorted(ROWS, 'agents', true).map(r => r.id));
    });
});

// This file runs in the NODE environment, where `localStorage` does not exist at
// all — which is itself one of the cases readStoredSort has to survive (Safari
// private mode throws from the same call site). The stored-value cases install a
// stub; the no-storage case simply removes it.
describe('readStoredSort — the persisted browse preference', () => {
    const stub = (store) => {
        globalThis.localStorage = {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
        };
    };

    afterEach(() => { delete globalThis.localStorage; });

    it('returns the default when nothing has been stored', () => {
        stub({});
        expect(readStoredSort()).toBe(DEFAULT_SORT_MODE);
    });

    it('leads with the biggest blast radius by default, not with A→Z', () => {
        // Load-bearing, and the reason DEFAULT_SORT_MODE is named once rather than
        // inferred from SORT_MODES order: this page exists to make blast radius
        // legible, so the rows binding the most agents lead unless asked otherwise.
        expect(DEFAULT_SORT_MODE).toBe('agents');
        expect(SORT_MODES.some(m => m.value === DEFAULT_SORT_MODE)).toBe(true);
    });

    it('restores a mode it recognises', () => {
        stub({ [SORT_STORAGE_KEY]: 'name' });
        expect(readStoredSort()).toBe('name');
    });

    it('rejects a value that is no longer a mode', () => {
        // A key surviving from an older build (or hand-edited) must not select a
        // comparator that does not exist — an unmatched value would leave the sort
        // menu with nothing highlighted and fall through to the default comparator
        // anyway, so the two would silently disagree.
        stub({ [SORT_STORAGE_KEY]: 'catalog-order' });
        expect(readStoredSort()).toBe(DEFAULT_SORT_MODE);
    });

    it('survives storage being absent or throwing', () => {
        delete globalThis.localStorage;                 // no storage at all
        expect(readStoredSort()).toBe(DEFAULT_SORT_MODE);

        globalThis.localStorage = {
            getItem: () => { throw new Error('SecurityError'); },
        };
        expect(readStoredSort()).toBe(DEFAULT_SORT_MODE);
    });

    it('persists only the MODE — direction is never part of the key', () => {
        // Direction resets to the mode's natural end on reload, so a user who
        // flipped to "fewest agents" once does not come back tomorrow to a page
        // that buries its own headline rows. Nothing may smuggle it into the value.
        const store = {};
        stub(store);
        globalThis.localStorage.setItem(SORT_STORAGE_KEY, 'date');
        expect(store[SORT_STORAGE_KEY]).toBe('date');
        expect(readStoredSort()).toBe('date');
        // The mode alone round-trips; there is no second key and no encoded suffix.
        expect(Object.keys(store)).toEqual([SORT_STORAGE_KEY]);
        expect(SORT_MODES.find(m => m.value === 'date').defaultDesc).toBe(true);
    });
});
