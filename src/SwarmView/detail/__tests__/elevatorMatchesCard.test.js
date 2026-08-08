// req #3302 — the prev/next elevator must agree with the category card.
//
// `requirementSort.js`'s own header states the invariant: *"Must stay in sync
// with CategoryCard.activeSort so prev/next navigation in the single-requirement
// editor matches the row order shown on the category card."* It had a guard for
// exactly half of it. The two comparators agreed and always had; what diverged is
// WHICH ROWS they sort — `CategoryCard` gained the pipelined filter in req #3258
// (default ON since req #3242) and the sibling list did not, so the elevator
// walked a strict SUPERSET of the visible rows.
//
// So this file pins BOTH halves: the ORDER (comparator parity) and the
// POPULATION (filter parity). A file that pinned only the first is what let the
// defect ship.

import { describe, it, expect } from 'vitest';
import { processSort, processSortReverse, requirementActiveSort, requirementHandSort,
         coerceSortMode, DEFAULT_SORT_MODE } from '../../processSort';
import { siblingProcessSort, siblingProcessSortReverse, siblingActiveSort, siblingElevator,
         elevatorStateFrom, readElevatorIds } from '../requirementSort';
import { excludePipelined, pipelinedRequirementIds } from '../../../utils/pipelineMembership';

const CHIPS = ['authoring', 'approved', 'swarm_ready', 'development'];

// The real rows from `darwin_dev` category 1052 (Agents), read 2026-08-07 — the
// population the defect was measured on. Only the fields either sort reads.
const AGENTS_CATEGORY = [
    { id: 3074, requirement_status: 'authoring',  started_at: null, completed_at: null, deferred_at: null, pipelined: true },
    { id: 3100, requirement_status: 'authoring',  started_at: null, completed_at: null, deferred_at: null, pipelined: false },
    { id: 3136, requirement_status: 'authoring',  started_at: null, completed_at: null, deferred_at: null, pipelined: true },
    { id: 3137, requirement_status: 'authoring',  started_at: null, completed_at: null, deferred_at: null, pipelined: true },
    { id: 3152, requirement_status: 'authoring',  started_at: null, completed_at: null, deferred_at: null, pipelined: false },
    { id: 3164, requirement_status: 'authoring',  started_at: null, completed_at: null, deferred_at: null, pipelined: true },
    { id: 3101, requirement_status: 'approved',   started_at: null, completed_at: null, deferred_at: null, pipelined: false },
    { id: 3154, requirement_status: 'approved',   started_at: null, completed_at: null, deferred_at: null, pipelined: false },
    { id: 3170, requirement_status: 'approved',   started_at: null, completed_at: null, deferred_at: null, pipelined: false },
];

const junction = (rows) => rows.filter(r => r.pipelined).map(r => ({ requirement_fk: r.id }));

// What the CARD renders: status chips, then the pipelined filter, then the sort.
//
// `CategoryCard.activeSort` is now a one-line delegation to `requirementActiveSort`
// (req #3302), so this models the card with the card's OWN comparator. It used to
// pick between `processSort`/`processSortReverse` by hand, which silently mapped
// `hand` onto `processSort` — so parity was never actually asserted in hand mode,
// which is the elevator's DEFAULT (`RequirementDetail`'s `sibSortMode` starts
// there). A model that quietly answers a different question than the one asked is
// the same vacuity this file already carries one scar from.
const cardRows = (rows, { mode = 'process', hidePipelined = true, chips = CHIPS } = {}) => {
    const byStatus = rows.filter(r => chips.includes(r.requirement_status));
    const visible = excludePipelined(byStatus, pipelinedRequirementIds(junction(rows)), hidePipelined);
    return [...visible].sort((a, b) => requirementActiveSort(mode, a, b)).map(r => r.id);
};

// What the ELEVATOR walks — through the REAL function `RequirementDetail` calls,
// never a re-derivation of it. The first cut of this file rebuilt the filter and
// the sort inline and stayed green when the component's own filter was deleted,
// which is precisely the vacuity it exists to prevent.
const elevator = (rows, { mode = 'process', hidePipelined = true, chips = CHIPS, currentId } = {}) =>
    siblingElevator(
        rows.filter(r => chips.includes(r.requirement_status)),
        {
            sortMode: mode,
            pipelinedIds: pipelinedRequirementIds(junction(rows)),
            hidePipelined,
            currentId,
        },
    );

const elevatorRows = (rows, opts = {}) => elevator(rows, opts).ordered.map(r => r.id);

describe('the measured regression — darwin_dev category 1052, default chips', () => {
    // Before the fix the elevator's population was `byStatus` with no pipelined
    // filter, which is what these three assertions encode as the WRONG answer.
    const brokenElevator = elevatorRows(AGENTS_CATEGORY, { hidePipelined: false });

    it('reproduces the defect when the pipelined filter is skipped', () => {
        // The card's first row sat at index 1, so Up was ENABLED on the first row.
        expect(brokenElevator.indexOf(3100)).toBe(1);
        // And Down from it landed on a pipelined row the card does not show.
        expect(brokenElevator[2]).toBe(3136);
    });

    // The SYMPTOM, asserted through the arrow ids the buttons are actually
    // wired to — `disabled={!prevId}` is what "dimmed" means on screen.
    it('disables Up on the card\'s first row', () => {
        const { currentIndex, prevId } = elevator(AGENTS_CATEGORY, { currentId: 3100 });
        expect(currentIndex).toBe(0);
        expect(prevId).toBeNull();
    });

    it('sends Down to the card\'s second row, not to a hidden one', () => {
        const { nextId } = elevator(AGENTS_CATEGORY, { currentId: 3100 });
        expect(nextId).toBe(3152);
        expect(elevatorRows(AGENTS_CATEGORY)).not.toContain(3136);
    });

    it('disables Down on the last visible row', () => {
        const ids = elevatorRows(AGENTS_CATEGORY);
        const { nextId } = elevator(AGENTS_CATEGORY, { currentId: ids[ids.length - 1] });
        expect(nextId).toBeNull();
    });

    // A requirement the filter itself removes has no place in the list, so
    // neither arrow may guess a neighbour for it.
    it('disables BOTH arrows on a requirement the filter hides', () => {
        const { currentIndex, prevId, nextId } = elevator(AGENTS_CATEGORY, { currentId: 3136 });
        expect(currentIndex).toBe(-1);
        expect(prevId).toBeNull();
        expect(nextId).toBeNull();
    });
});

describe('population parity — the elevator walks exactly the card\'s rows', () => {
    it.each(['process', 'reverse', 'hand'])('agrees in %s mode with the filter ON', (mode) => {
        expect(elevatorRows(AGENTS_CATEGORY, { mode })).toEqual(cardRows(AGENTS_CATEGORY, { mode }));
    });

    // The toggle is a CONTROL, so the elevator has to follow it in both
    // positions — pinning "always exclude" would break the other half.
    it.each(['process', 'reverse', 'hand'])('agrees in %s mode with the filter OFF', (mode) => {
        const opts = { mode, hidePipelined: false };
        expect(elevatorRows(AGENTS_CATEGORY, opts)).toEqual(cardRows(AGENTS_CATEGORY, opts));
        // ...and OFF really is a different answer, or this proves nothing.
        expect(elevatorRows(AGENTS_CATEGORY, opts)).not.toEqual(elevatorRows(AGENTS_CATEGORY, { mode }));
    });

    it('agrees when the status chips are narrowed', () => {
        const opts = { chips: ['authoring'] };
        expect(elevatorRows(AGENTS_CATEGORY, opts)).toEqual(cardRows(AGENTS_CATEGORY, opts));
    });

    it('agrees when every row is pipelined — both go empty, not one', () => {
        const allPipelined = AGENTS_CATEGORY.map(r => ({ ...r, pipelined: true }));
        expect(elevatorRows(allPipelined)).toEqual([]);
        expect(cardRows(allPipelined)).toEqual([]);
    });
});

describe('comparator identity — there is ONE implementation (req #3302)', () => {
    // This block used to compare two ORDERINGS, which passes for as long as two
    // copies happen to agree and says nothing about whether they are one thing.
    // The copies are gone: `requirementSort.js` re-exports `processSort.js`, so
    // the guard is identity. A future re-transcription fails here immediately.
    it('exports the SAME function objects, not equivalent ones', () => {
        expect(siblingProcessSort).toBe(processSort);
        expect(siblingProcessSortReverse).toBe(processSortReverse);
        expect(siblingActiveSort).toBe(requirementActiveSort);
    });

    const corpus = [
        { id: 5,  requirement_status: 'met',         completed_at: '2026-08-01T00:00:00', started_at: null, deferred_at: null },
        { id: 3,  requirement_status: 'met',         completed_at: '2026-08-03T00:00:00', started_at: null, deferred_at: null },
        { id: 9,  requirement_status: 'development', started_at: '2026-07-01T00:00:00', completed_at: null, deferred_at: null },
        { id: 1,  requirement_status: 'development', started_at: '2026-07-09T00:00:00', completed_at: null, deferred_at: null },
        { id: 12, requirement_status: 'authoring',   started_at: null, completed_at: null, deferred_at: null },
        { id: 2,  requirement_status: 'approved',    started_at: null, completed_at: null, deferred_at: null },
        { id: 7,  requirement_status: 'swarm_ready', started_at: null, completed_at: null, deferred_at: null },
        { id: 4,  requirement_status: 'deferred',    deferred_at: '2026-06-01T00:00:00', started_at: null, completed_at: null },
        { id: 8,  requirement_status: 'deferred',    deferred_at: '2026-06-30T00:00:00', started_at: null, completed_at: null },
        { id: 11, requirement_status: 'wontfix',     completed_at: '2026-05-05T00:00:00', started_at: null, deferred_at: null },
    ];

    it('routes the elevator to the matching comparator', () => {
        expect(siblingElevator(corpus, { sortMode: 'process' }).ordered.map(r => r.id))
            .toEqual([...corpus].sort(processSort).map(r => r.id));
        expect(siblingElevator(corpus, { sortMode: 'reverse' }).ordered.map(r => r.id))
            .toEqual([...corpus].sort(processSortReverse).map(r => r.id));
    });

    // req #3302 — the defect the consolidation fixes. `changeSortMode` sorted hand
    // mode with a BARE `requirementHandSort`, skipping the status band every other
    // path applies, so the two disagreed the moment terminal work was on the card.
    // Asserted as a DIFFERENCE, so it cannot pass vacuously on a fixture with no
    // terminal rows.
    it('bands terminal work below active work in hand mode', () => {
        const handed = [...corpus].sort((a, b) => requirementActiveSort('hand', a, b)).map(r => r.id);
        const bare = [...corpus].sort(requirementHandSort).map(r => r.id);
        expect(handed).not.toEqual(bare);

        const statusOf = id => corpus.find(r => r.id === id).requirement_status;
        const terminal = new Set(['met', 'deferred', 'wontfix']);
        const firstTerminal = handed.findIndex(id => terminal.has(statusOf(id)));
        const lastActive = handed.map(id => terminal.has(statusOf(id))).lastIndexOf(false);
        expect(firstTerminal).toBeGreaterThan(lastActive);
    });

    it('orders hand mode by sort_order within a band, NULL last', () => {
        const rows = [
            { id: 30, requirement_status: 'approved', sort_order: null },
            { id: 10, requirement_status: 'approved', sort_order: 2 },
            { id: 20, requirement_status: 'approved', sort_order: 1 },
        ];
        expect([...rows].sort((a, b) => requirementActiveSort('hand', a, b)).map(r => r.id))
            .toEqual([20, 10, 30]);
    });
});

describe('the handed-over order — the aggregator\'s fix', () => {
    // The SwarmStartCard aggregator shows EVERY category under ONE status, with
    // its own filter and sort. Nothing derivable from a requirement's
    // `category_fk` can reproduce that list, which is why the surface hands it
    // over instead. These ids are cross-category on purpose.
    const AGGREGATOR_ROWS = [
        { id: 3170, requirement_status: 'approved' },
        { id: 3101, requirement_status: 'approved' },
        { id: 2401, requirement_status: 'approved' },
        { id: 3154, requirement_status: 'approved' },
        { id: '',   requirement_status: 'authoring' },   // the template row
    ];

    const handed = elevatorStateFrom(AGGREGATOR_ROWS);

    it('carries the rendered ids and drops the template row', () => {
        expect(handed.siblingIds).toEqual([3170, 3101, 2401, 3154]);
    });

    it('round-trips through the reader', () => {
        expect(readElevatorIds(handed)).toEqual([3170, 3101, 2401, 3154]);
    });

    it('returns null for a link that carried none', () => {
        expect(readElevatorIds(undefined)).toBeNull();
        expect(readElevatorIds({})).toBeNull();
        expect(readElevatorIds({ siblingIds: [] })).toBeNull();
        expect(readElevatorIds({ from: 'calendar' })).toBeNull();
    });

    const walk = (currentId) => siblingElevator([], {
        sortMode: 'process', currentId, orderedIds: handed.siblingIds,
    });

    it('honours the TOP limit — Up is disabled on the first rendered row', () => {
        const { currentIndex, prevId, nextId } = walk(3170);
        expect(currentIndex).toBe(0);
        expect(prevId).toBeNull();
        expect(nextId).toBe(3101);
    });

    it('honours the BOTTOM limit — Down is disabled on the last rendered row', () => {
        const { prevId, nextId } = walk(3154);
        expect(prevId).toBe(2401);
        expect(nextId).toBeNull();
    });

    it('walks the middle in the rendered order, not a re-sorted one', () => {
        expect(walk(3101).prevId).toBe(3170);
        expect(walk(3101).nextId).toBe(2401);
    });

    // The whole point: the handed-over order is used VERBATIM. Sorting it — by
    // id, by status, by anything — is what produced the reported symptom.
    it('does not re-sort the handed-over ids', () => {
        const ids = siblingElevator([], { sortMode: 'process', orderedIds: handed.siblingIds })
            .ordered.map(r => r.id);
        expect(ids).toEqual([3170, 3101, 2401, 3154]);
        expect(ids).not.toEqual([...ids].sort((a, b) => a - b));
    });

    // ...and it must not be filtered either. These rows never went through the
    // pipelined predicate on the way in; applying it here would drop rows the
    // aggregator deliberately showed.
    it('does not filter the handed-over ids', () => {
        const ids = siblingElevator([], {
            sortMode: 'process',
            orderedIds: handed.siblingIds,
            pipelinedIds: new Set([3101, 2401]),
            hidePipelined: true,
        }).ordered.map(r => r.id);
        expect(ids).toEqual([3170, 3101, 2401, 3154]);
    });

    it('falls back to the category query when the link carried no ids', () => {
        const viaQuery = siblingElevator(
            AGENTS_CATEGORY.filter(r => CHIPS.includes(r.requirement_status)),
            { sortMode: 'process', pipelinedIds: pipelinedRequirementIds(junction(AGENTS_CATEGORY)),
              hidePipelined: true, currentId: 3100, orderedIds: readElevatorIds(undefined) },
        );
        expect(viaQuery.prevId).toBeNull();
        expect(viaQuery.nextId).toBe(3152);
    });
});

describe('coerceSortMode — ONE reading of `categories.sort_mode` (req #3302)', () => {
    it.each(['hand', 'process', 'reverse'])('passes the live value %s through', (v) => {
        expect(coerceSortMode(v)).toBe(v);
    });

    // The two forms that disagreed. `RequirementDetail`'s category-CHANGE path read
    // `sort_mode || 'hand'` raw while every other reader coerced, so a legacy
    // `'created'` reached `requirementActiveSort`, which has no case for it and
    // falls to the HAND branch — changing a requirement's category silently
    // re-ordered the elevator by a mode the card never uses.
    it.each([
        ['the retired legacy value', 'created'],
        ['an unrecognised value', 'kanban'],
        ['null', null],
        ['undefined', undefined],
        ['empty', ''],
    ])('resolves %s to the default', (_label, v) => {
        expect(coerceSortMode(v)).toBe(DEFAULT_SORT_MODE);
        expect(coerceSortMode(v)).toBe('process');
    });

    // The specific silent failure: an uncoerced legacy value is not inert, it
    // selects a DIFFERENT order.
    it('a raw legacy value would have ordered as hand, not as the default', () => {
        // Both are ACTIVE, so hand puts them in one band and orders by id, while
        // process ranks them by status. A met/authoring pair would NOT distinguish
        // the branches — it sorts the same either way, which is how the first cut
        // of this assertion passed vacuously.
        const rows = [
            { id: 1, requirement_status: 'development' },
            { id: 3, requirement_status: 'authoring' },
        ];
        const asRaw = [...rows].sort((a, b) => requirementActiveSort('created', a, b)).map(r => r.id);
        const asHand = [...rows].sort((a, b) => requirementActiveSort('hand', a, b)).map(r => r.id);
        const asCoerced = [...rows].sort((a, b) => requirementActiveSort(coerceSortMode('created'), a, b)).map(r => r.id);
        expect(asRaw).toEqual(asHand);          // unrecognised falls to the hand branch
        expect(asCoerced).not.toEqual(asRaw);   // ...and coercing genuinely changes the answer
    });
});
