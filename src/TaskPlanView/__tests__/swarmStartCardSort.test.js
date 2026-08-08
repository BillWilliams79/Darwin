// req #3302 — the aggregator card's ORDER.
//
// The defect: `Hand Sort` / `Created Sort` were two menu entries with ONE
// behaviour, because `changeSortMode` discarded the mode it was handed and both
// ran `isMet ? metSort : createdSort`. Only the checkmark moved.
//
// So the assertions that matter here are DIFFERENCES — that the two modes are
// genuinely two orders, and that each chip's arrival order is unchanged. A suite
// that only checked "sorting produces a sorted list" would have passed against
// the broken card.

import { describe, it, expect } from 'vitest';
import {
    SORT_OLDEST,
    SORT_NEWEST,
    aggregatorSort,
    defaultSortMode,
} from '../SwarmStartCard';

const TEMPLATE = { id: '', requirement_status: 'authoring', completed_at: null };

// A queue chip (authoring/approved/swarm_ready/development): nothing is completed,
// so `completed_at` is null on every row and only the id can order them.
const QUEUE_ROWS = [
    { id: 30, completed_at: null },
    { id: 10, completed_at: null },
    { id: 20, completed_at: null },
    TEMPLATE,
];

// The met chip: completion times decide, ids only break ties.
const MET_ROWS = [
    { id: 30, completed_at: '2026-08-01T00:00:00' },
    { id: 10, completed_at: '2026-08-05T00:00:00' },
    { id: 20, completed_at: '2026-08-03T00:00:00' },
    { id: 40, completed_at: null },
    TEMPLATE,
];

const order = (rows, mode) => [...rows].sort(aggregatorSort(mode)).map(r => r.id);

describe('the two modes are two ORDERS — the defect, stated as a difference', () => {
    it('disagree on a queue chip', () => {
        expect(order(QUEUE_ROWS, SORT_OLDEST)).not.toEqual(order(QUEUE_ROWS, SORT_NEWEST));
    });

    it('disagree on the met chip', () => {
        expect(order(MET_ROWS, SORT_OLDEST)).not.toEqual(order(MET_ROWS, SORT_NEWEST));
    });

    it('are exhaustive — an unknown mode falls back to Oldest, never to nothing', () => {
        expect(order(QUEUE_ROWS, 'hand')).toEqual(order(QUEUE_ROWS, SORT_OLDEST));
        expect(order(QUEUE_ROWS, undefined)).toEqual(order(QUEUE_ROWS, SORT_OLDEST));
    });
});

describe('Oldest first', () => {
    it('is id ascending on a queue chip', () => {
        expect(order(QUEUE_ROWS, SORT_OLDEST)).toEqual([10, 20, 30, '']);
    });

    it('is the exact inverse of Newest on the met chip', () => {
        // Earliest completion first, undated last — NOT id order, which is the
        // flaw the "two modes must differ" assertion above caught.
        expect(order(MET_ROWS, SORT_OLDEST)).toEqual([30, 20, 10, 40, '']);
    });
});

describe('Newest first', () => {
    it('is id descending on a queue chip', () => {
        expect(order(QUEUE_ROWS, SORT_NEWEST)).toEqual([30, 20, 10, '']);
    });

    it('is most-recently-completed first on the met chip (req #2613)', () => {
        expect(order(MET_ROWS, SORT_NEWEST)).toEqual([10, 20, 30, 40, '']);
    });

    // Undated rows are not "earliest" — they are unknown. Putting them first
    // under Oldest would open the met chip on the rows it knows least about.
    it.each([SORT_OLDEST, SORT_NEWEST])('sinks rows with no completion to the end in %s', (mode) => {
        const ids = order(MET_ROWS, mode);
        expect(ids.indexOf(40)).toBe(ids.length - 2);   // ahead of the template only
    });

    it('is the exact reverse of Oldest, template aside', () => {
        const dated = ids => ids.filter(id => id !== '');
        expect(dated(order(MET_ROWS, SORT_NEWEST)).filter(id => id !== 40))
            .toEqual(dated(order(MET_ROWS, SORT_OLDEST)).filter(id => id !== 40).reverse());
    });
});

describe('the template row', () => {
    it('stays anchored last in both modes', () => {
        for (const mode of [SORT_OLDEST, SORT_NEWEST]) {
            expect(order(QUEUE_ROWS, mode).at(-1)).toBe('');
            expect(order(MET_ROWS, mode).at(-1)).toBe('');
        }
    });
});

describe('the per-chip default — arrival order is unchanged by req #3302', () => {
    it('is Newest for the met chip', () => {
        expect(defaultSortMode(true)).toBe(SORT_NEWEST);
    });

    it('is Oldest for the four queue chips', () => {
        expect(defaultSortMode(false)).toBe(SORT_OLDEST);
    });

    // The whole point of keeping "unchosen" as a third state: making the menu
    // real must not have changed what either chip shows before it is touched.
    it('reproduces the pre-#3302 behaviour on both chips', () => {
        // was `createdSort` — id ascending
        expect(order(QUEUE_ROWS, defaultSortMode(false))).toEqual([10, 20, 30, '']);
        // was `metSort` — most-recently-completed first
        expect(order(MET_ROWS, defaultSortMode(true))).toEqual([10, 20, 30, 40, '']);
    });
});
