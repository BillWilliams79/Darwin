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
    gridSortFromMode, GRID_FIELD_BY_SORT_MODE, dbTimestamp,
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
        //
        // The expectation is written with an explicit `Z` because the stored value
        // IS UTC: `lastTouched` normalizes a bare timestamp before parsing it, so
        // comparing against a bare `Date.parse` would assert the old local-time
        // reading and fail in every timezone but UTC.
        expect(lastTouched({ update_ts: null, create_ts: '2026-07-24T00:00:00' }))
            .toBe(Date.parse('2026-07-24T00:00:00Z'));
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

// ---------------------------------------------------------------------------
// Req #3067 — the gear-mode → grid-column mapping.
//
// The Table view sorts through its own column headers, so switching from Cards
// has to SEED the grid from the persisted mode or the rows jump to an unrelated
// order for no reason the user can see. The mapping is the only thing tying the
// two vocabularies together, and a typo'd field name fails silently: DataGrid
// ignores a sort model naming a column it does not have, so the grid would simply
// fall back to its natural order and look merely "wrong" rather than broken.
// ---------------------------------------------------------------------------

describe('gridSortFromMode', () => {
    it('maps every gear mode onto a real grid column', () => {
        expect(gridSortFromMode('agents', true)).toEqual({ field: 'agent_count', sort: 'desc' });
        expect(gridSortFromMode('name', false)).toEqual({ field: 'name', sort: 'asc' });
        expect(gridSortFromMode('date', true)).toEqual({ field: 'update_ts', sort: 'desc' });
    });

    it('covers EVERY mode the gear can be in', () => {
        // The guard against adding a fourth sort mode and forgetting the table.
        for (const { value } of SORT_MODES) {
            expect(GRID_FIELD_BY_SORT_MODE[value]).toBeTruthy();
        }
    });

    it('carries the direction through', () => {
        expect(gridSortFromMode('name', true).sort).toBe('desc');
        expect(gridSortFromMode('name', false).sort).toBe('asc');
    });

    it('falls back to the page default for an unknown mode', () => {
        // `readStoredSort` already filters storage, but the mapping is also reached
        // from a seeded prop and must not emit `field: undefined`.
        expect(gridSortFromMode('nonsense', true).field)
            .toBe(GRID_FIELD_BY_SORT_MODE[DEFAULT_SORT_MODE]);
    });
});

// ---------------------------------------------------------------------------
// Req #3067 — MySQL DATETIME strings are UTC and carry no marker.
//
// A bare `Date.parse('2026-07-26 02:00:00')` treats the space-separated form as
// LOCAL time. For SORTING that offset is uniform and cancels, which is why the bug
// survived #3063 unnoticed. #3067 made `lastTouched` the value behind the
// `Last updated` COLUMN, and a display is not offset-invariant: every row stored
// between midnight and ~08:00 UTC rendered TOMORROW's date to a US Pacific viewer,
// and disagreed with the `Created` column beside it.
//
// `TZ` is pinned per-assertion via the parsed instant rather than the formatted
// string, so this test means the same thing in every timezone CI might run in.
// ---------------------------------------------------------------------------

describe('lastTouched — MySQL DATETIME is UTC', () => {
    it('parses the space-separated MySQL form as UTC, not local', () => {
        expect(lastTouched({ update_ts: '2026-07-26 02:00:00' }))
            .toBe(Date.parse('2026-07-26T02:00:00Z'));
    });

    it('agrees with the ISO form for the same instant', () => {
        expect(lastTouched({ update_ts: '2026-07-26 02:00:00' }))
            .toBe(lastTouched({ update_ts: '2026-07-26T02:00:00Z' }));
    });

    it('applies the same parse to the create_ts fallback', () => {
        expect(lastTouched({ update_ts: null, create_ts: '2026-07-24 23:30:00' }))
            .toBe(Date.parse('2026-07-24T23:30:00Z'));
    });

    it('tolerates the microsecond tail MySQL DATETIME(6) can carry', () => {
        expect(lastTouched({ update_ts: '2026-07-26 02:00:00.000000' }))
            .toBe(Date.parse('2026-07-26T02:00:00.000Z'));
    });

    it('normalizes the ISO-WITHOUT-OFFSET form too, not just the space form', () => {
        // `dbTimestamp` is exported under a generic name, so the caller that
        // re-acquires this bug will be a future one passing `2026-07-26T02:00:00`.
        // The guard is "carries no timezone information", not "contains a space".
        expect(dbTimestamp('2026-07-26T02:00:00')).toBe(Date.parse('2026-07-26T02:00:00Z'));
        expect(dbTimestamp('2026-07-26T02:00:00')).toBe(dbTimestamp('2026-07-26 02:00:00'));
    });

    it('leaves an explicit offset alone', () => {
        // A value that already says what it means must not be re-interpreted.
        expect(dbTimestamp('2026-07-26T02:00:00Z')).toBe(Date.parse('2026-07-26T02:00:00Z'));
        expect(dbTimestamp('2026-07-26T02:00:00-07:00'))
            .toBe(Date.parse('2026-07-26T02:00:00-07:00'));
    });

    it('dbTimestamp returns 0 for null/empty/garbage rather than NaN', () => {
        // NaN would poison the comparator's subtraction and make it non-transitive
        // — an unstable sort rather than a wrong one, which is far harder to spot.
        expect(dbTimestamp(null)).toBe(0);
        expect(dbTimestamp('')).toBe(0);
        expect(dbTimestamp(undefined)).toBe(0);
        expect(dbTimestamp('not a date')).toBe(0);
    });
});
