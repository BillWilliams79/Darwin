// Req #3051 — the browse-list sort vocabulary for /agents/documents.
//
// Tested here rather than through the page for the reason the module exists at
// all: keeping the comparator out of the component file keeps that file in React
// Fast Refresh, and it lets these run without pulling MUI into the test
// environment. The comparator carries two STRUCTURAL rules that outrank the
// user's chosen sort, and the interesting property of the second one is that it is
// scoped to a single mode — so most of this file is about where the rules do NOT
// apply.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    DEFAULT_SORT_MODE, SORT_MODES, SORT_ASC, SORT_STORAGE_KEY,
    lastTouched, ownerName, readStoredSort, compareDocumentRows,
} from '../documentSort';

/**
 * A decorated row in the shape DocumentsPage builds: the document columns plus
 * `links`, `owner` (the junction row carrying `owned`, or null) and `ownerName`.
 */
const row = (name, { owner = null, links = [], closed = 0, update_ts = null,
    create_ts = '2026-01-01T00:00:00' } = {}) => ({
    id: name.length * 7,
    name,
    closed,
    links,
    owner: owner ? { agent_fk: 1, relationship: 'owned' } : null,
    ownerName: owner || '',
    update_ts,
    create_ts,
});

const sorted = (rows, mode, desc) =>
    [...rows].sort(compareDocumentRows(mode, desc)).map(r => r.name);

describe('the sort vocabulary', () => {
    it('defaults to OWNER, the question the page exists to answer', () => {
        // Not a convenience: /agents/documents exists because "who owns this file?"
        // had no answer before the registry, so the owner axis leads unless the
        // user asks otherwise.
        expect(DEFAULT_SORT_MODE).toBe('owner');
        expect(SORT_MODES.some(m => m.value === DEFAULT_SORT_MODE)).toBe(true);
    });

    it('has a comparator for every advertised mode', () => {
        // A mode in the menu with no comparator would silently fall back to the
        // default and the menu would lie about what it did.
        for (const { value } of SORT_MODES) {
            expect(SORT_ASC[value], `no comparator for "${value}"`).toBeTypeOf('function');
        }
    });

    it('gives each mode the useful end of its own axis as the default direction', () => {
        const byValue = Object.fromEntries(SORT_MODES.map(m => [m.value, m.defaultDesc]));
        expect(byValue.name).toBe(false);      // A→Z
        expect(byValue.owner).toBe(false);     // A→Z by owner
        expect(byValue.agents).toBe(true);     // most-referenced first
        expect(byValue.date).toBe(true);       // newest first
    });
});

describe('lastTouched', () => {
    it('falls back to create_ts when update_ts is NULL', () => {
        // update_ts is NULL until a row is first edited. Without the fallback every
        // never-touched document sorts as if it were from 1970 and "Last updated"
        // is meaningless — which is most of the catalog.
        const r = row('A', { update_ts: null, create_ts: '2026-05-05T00:00:00' });
        expect(lastTouched(r)).toBe(Date.parse('2026-05-05T00:00:00'));
    });

    it('prefers update_ts when present', () => {
        const r = row('A', { update_ts: '2026-07-07T00:00:00', create_ts: '2026-01-01T00:00:00' });
        expect(lastTouched(r)).toBe(Date.parse('2026-07-07T00:00:00'));
    });

    it('is 0 for a row with neither, rather than NaN', () => {
        // NaN comparisons are always false, which makes a sort non-deterministic.
        expect(lastTouched({ })).toBe(0);
    });
});

describe('ownerName', () => {
    it('is the empty string for an unowned document, never undefined', () => {
        // localeCompare on undefined throws; the empty string sorts predictably.
        expect(ownerName(row('A'))).toBe('');
        expect(ownerName({})).toBe('');
    });
});

// ---------------------------------------------------------------------------
// Structural rule 1 — CLOSED LAST, everywhere.
// ---------------------------------------------------------------------------

describe('closed documents sort last in EVERY mode and BOTH directions', () => {
    // A closed document is in no agent's boot payload, so it never belongs above a
    // live one — not even when it would sort first alphabetically.
    const rows = [
        row('Aardvark', { closed: 1, owner: 'Aaa Architect' }),
        row('Zebra', { owner: 'Zzz Architect' }),
    ];

    for (const { value } of SORT_MODES) {
        for (const desc of [false, true]) {
            it(`holds in ${value} / ${desc ? 'desc' : 'asc'}`, () => {
                expect(sorted(rows, value, desc)).toEqual(['Zebra', 'Aardvark']);
            });
        }
    }

    it('outranks even the unowned pin', () => {
        // A closed UNOWNED row must not be dragged to the top by rule 2 — it is
        // still in nobody's payload.
        const mixed = [
            row('ClosedUnowned', { closed: 1 }),
            row('OpenOwned', { owner: 'Some Architect' }),
        ];
        expect(sorted(mixed, 'owner', false)).toEqual(['OpenOwned', 'ClosedUnowned']);
    });
});

// ---------------------------------------------------------------------------
// Structural rule 2 — UNOWNED FIRST, in `owner` mode ONLY.
// ---------------------------------------------------------------------------

describe('unowned documents pin to the top in OWNER mode', () => {
    const rows = [
        row('Bravo', { owner: 'Aaa Architect' }),
        row('Alpha'),                                   // unowned
        row('Charlie', { owner: 'Zzz Architect' }),
    ];

    it('leads in owner/asc — the drift the registry exists to surface', () => {
        expect(sorted(rows, 'owner', false)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('STILL leads in owner/desc — the pin is not multiplied by direction', () => {
        // Reversing the owner axis must not bury the rows the page is for.
        expect(sorted(rows, 'owner', true)).toEqual(['Alpha', 'Charlie', 'Bravo']);
    });

    it('keeps several unowned rows together, name-ordered among themselves', () => {
        const many = [
            row('Zulu'), row('Alpha'), row('Mike', { owner: 'Someone' }),
        ];
        expect(sorted(many, 'owner', false)).toEqual(['Alpha', 'Zulu', 'Mike']);
    });
});

describe('the unowned pin does NOT leak into any other mode', () => {
    // An alphabetical list that is not alphabetical reads as a bug rather than as
    // emphasis, which is why this rule is scoped to the one axis it belongs to.
    const rows = [
        row('Alpha', { owner: 'Someone' }),
        row('Bravo'),                                   // unowned
        row('Charlie', { owner: 'Someone' }),
    ];

    it('name mode stays strictly alphabetical', () => {
        expect(sorted(rows, 'name', false)).toEqual(['Alpha', 'Bravo', 'Charlie']);
        expect(sorted(rows, 'name', true)).toEqual(['Charlie', 'Bravo', 'Alpha']);
    });

    it('agents mode ranks purely by link count', () => {
        const byCount = [
            row('One', { links: [{}] , owner: 'Someone' }),
            row('Three', { links: [{}, {}, {}] }),        // unowned, but most-linked
            row('Two', { links: [{}, {}], owner: 'Someone' }),
        ];
        expect(sorted(byCount, 'agents', true)).toEqual(['Three', 'Two', 'One']);
        expect(sorted(byCount, 'agents', false)).toEqual(['One', 'Two', 'Three']);
    });

    it('date mode ranks purely by recency', () => {
        const byDate = [
            row('Old', { owner: 'Someone', update_ts: '2026-01-01T00:00:00' }),
            row('New', { update_ts: '2026-07-01T00:00:00' }),   // unowned, newest
        ];
        expect(sorted(byDate, 'date', true)).toEqual(['New', 'Old']);
        expect(sorted(byDate, 'date', false)).toEqual(['Old', 'New']);
    });
});

describe('the sort is TOTAL, so the list never shuffles between renders', () => {
    it('breaks ties on name, which carries a UNIQUE key', () => {
        const tied = [
            row('Charlie', { links: [{}] , owner: 'Same Architect' }),
            row('Alpha', { links: [{}], owner: 'Same Architect' }),
            row('Bravo', { links: [{}], owner: 'Same Architect' }),
        ];
        // Identical on every primary axis — only the tiebreak decides.
        expect(sorted(tied, 'owner', false)).toEqual(['Alpha', 'Bravo', 'Charlie']);
        expect(sorted(tied, 'agents', true)).toEqual(['Alpha', 'Bravo', 'Charlie']);
        expect(sorted(tied, 'date', true)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('is stable across repeated sorts of an already-sorted list', () => {
        const rows = [row('B', { owner: 'X' }), row('A'), row('C', { owner: 'Y' })];
        const once = sorted(rows, 'owner', false);
        const twice = [...rows].sort(compareDocumentRows('owner', false))
            .sort(compareDocumentRows('owner', false)).map(r => r.name);
        expect(twice).toEqual(once);
    });

    it('falls back to the default comparator for an unknown mode', () => {
        // Reachable from a stale localStorage value written by an older build.
        expect(sorted([row('B', { owner: 'X' }), row('A')], 'nonsense', false))
            .toEqual(['A', 'B']);
    });
});

describe('readStoredSort', () => {
    const realStorage = globalThis.localStorage;

    afterEach(() => {
        Object.defineProperty(globalThis, 'localStorage',
            { value: realStorage, configurable: true, writable: true });
    });

    const stubStorage = (getItem) => Object.defineProperty(globalThis, 'localStorage',
        { value: { getItem, setItem: vi.fn() }, configurable: true, writable: true });

    it('returns a stored mode that is still in the vocabulary', () => {
        stubStorage(() => 'name');
        expect(readStoredSort()).toBe('name');
    });

    it('falls back to the default for a mode that no longer exists', () => {
        // Protects against a value written before a mode was renamed or removed —
        // an unmatched mode would otherwise select nothing.
        stubStorage(() => 'by-vibes');
        expect(readStoredSort()).toBe(DEFAULT_SORT_MODE);
    });

    it('falls back when nothing is stored', () => {
        stubStorage(() => null);
        expect(readStoredSort()).toBe(DEFAULT_SORT_MODE);
    });

    it('survives localStorage throwing — Safari private mode', () => {
        stubStorage(() => { throw new Error('SecurityError'); });
        expect(readStoredSort()).toBe(DEFAULT_SORT_MODE);
    });

    it('uses a page-specific storage key, not the instructions one', () => {
        expect(SORT_STORAGE_KEY).toBe('darwin-documents-sort');
        expect(SORT_STORAGE_KEY).not.toBe('darwin-instructions-sort');
    });
});
