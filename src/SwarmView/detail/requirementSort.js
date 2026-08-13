// Sort helpers for the RequirementDetail sibling list.
// Must stay in sync with CategoryCard.activeSort so prev/next navigation in the
// single-requirement editor matches the row order shown on the category card.
//
// req #3302 — THAT INVARIANT IS ABOUT THE POPULATION AS WELL AS THE ORDER, and
// only the order was ever honoured here. `CategoryCard` gained the pipelined
// filter in req #3258 (default ON since req #3242) and this list did not, so the
// elevator walked a strict SUPERSET of the visible rows: Up was enabled on the
// card's first row, and Down landed on a requirement the card does not show.
// `siblingElevator` below now owns BOTH halves plus the index arithmetic, so a
// test can reach the answer the component actually renders rather than
// re-deriving it — the failure mode that let this ship with a green suite.

// req #3302 — ONE IMPLEMENTATION. These were a second transcription of
// `../processSort.js`'s comparators, kept in step by hand and by this file's own
// header comment. They are now re-exports of the single implementation, under
// the names this module's callers and tests already use. The `sibling*` aliases
// survive because they read correctly at the call site (the detail page walks
// SIBLINGS); they are the same functions, which
// `__tests__/elevatorMatchesCard.test.js` asserts by identity rather than by
// comparing two orderings — a comparison passes while two copies happen to agree
// and says nothing about whether they are one thing.
export {
    STATUS_SORT_ACTIVE as STATUS_SORT,
    STATUS_SORT_PROCESS,
    STATUS_SORT_PROCESS_REVERSE,
    processSort as siblingProcessSort,
    processSortReverse as siblingProcessSortReverse,
    requirementActiveSort as siblingActiveSort,
} from '../processSort';

import { requirementActiveSort } from '../processSort';

const siblingActiveSortLocal = requirementActiveSort;

/**
 * THE elevator: which siblings the prev/next arrows walk, in what order, and
 * where the current requirement sits in them.
 *
 * One function because the three answers are one fact. Splitting them is how the
 * page came to sort the right rows and navigate the wrong ones.
 *
 * req #3419 — the population filter arrives as the CARD'S OWN PREDICATE
 * (`useRequirementVisibility().isVisible`) rather than as the ingredients to
 * re-derive it here. This file previously re-applied `excludePipelined` from a
 * `(pipelinedIds, hidePipelined)` pair — a second transcription of the rule, and
 * the very drift its own header warns about, one layer down. Handing the
 * predicate over means the elevator walks the rows the card renders BY
 * CONSTRUCTION; there is nothing left that could disagree.
 *
 * Omitting `isVisible` shows everything, which keeps the honest degradation the
 * previous shape had: while the visibility reads are in flight the predicate is
 * momentarily too permissive, never hiding a row the card is showing.
 *
 * @param {Array<{id: number|string, requirement_status: string}>} siblings
 * @param {object}  opts
 * @param {string}  opts.sortMode       'process' | 'reverse' | 'hand'
 * @param {(row: {id: number|string}) => boolean} [opts.isVisible]
 *        `useRequirementVisibility().isVisible`; omitted = every sibling walks.
 * @param {number|string} [opts.currentId]   the requirement being viewed
 * @returns {{ordered: Array, currentIndex: number, prevId: (number|null), nextId: (number|null)}}
 *   `currentIndex` is -1 when the current requirement is not in the visible set
 *   (it is itself filtered out, or the read has not landed); both ids are then
 *   null, which disables both arrows rather than guessing a neighbour.
 */
export const siblingElevator = (siblings, {
    sortMode,
    isVisible,
    currentId,
    orderedIds = null,
} = {}) => {
    // HANDED-OVER ORDER WINS, and is used verbatim — no filter, no sort. It is
    // the list the reader was looking at when they clicked, so re-deriving it
    // could only make it agree less. This is the aggregator's whole fix, and it
    // also makes the card exact in `hand` mode, where the sibling REST read does
    // not even project the `sort_order` the card ordered by.
    const ordered = orderedIds
        ? orderedIds.map(id => ({ id }))
        : (() => {
            const rows = Array.isArray(siblings) ? siblings : [];
            const visible = typeof isVisible === 'function' ? rows.filter(isVisible) : rows;
            return [...visible].sort((a, b) => siblingActiveSortLocal(sortMode, a, b));
        })();

    const idNum = parseInt(currentId, 10);
    const currentIndex = Number.isNaN(idNum)
        ? -1
        : ordered.findIndex(s => parseInt(s.id, 10) === idNum);

    return {
        ordered,
        currentIndex,
        prevId: currentIndex > 0 ? (ordered[currentIndex - 1]?.id ?? null) : null,
        nextId: currentIndex >= 0 && currentIndex < ordered.length - 1
            ? (ordered[currentIndex + 1]?.id ?? null)
            : null,
    };
};

// ── The ELEVATOR LINK — one contract, both halves (req #3302) ────────────────
//
// A category card and the SwarmStartCard aggregator show DIFFERENT LISTS of the
// same requirements: the card is one category under the status chips; the
// aggregator is EVERY category under ONE status, with its own sort. Both apply
// the SAME orchestrated toggle — since req #3502 the aggregator has no rule of
// its own (it used to exclude step-carried work from three chips
// unconditionally, which is what that requirement fixed), so scope and order are
// what still differ. Rebuilding either list from `category_fk` gets the
// aggregator wrong in both of those at once, which is what "the aggregator
// ignores top, bottom and sort order" was.
//
// So the surface that opened the detail page HANDS OVER the ordered ids it
// actually rendered, and the elevator walks those. There is no second
// derivation to drift from the first — the failure this file already carries one
// scar from. Both halves live here so the writer and the reader cannot disagree
// about the key.
//
// It is carried in router state, so a REFRESH or a pasted link has none, and the
// elevator falls back to the category query. That is the honest degradation:
// with no list on screen there is nothing for the arrows to contradict.

/** Router state for a row opening the detail page. Spread into `navigate`'s `state`. */
export const elevatorStateFrom = (requirementsArray) => ({
    // The template row (`id === ''`) is an input affordance, not a requirement.
    siblingIds: (Array.isArray(requirementsArray) ? requirementsArray : [])
        .filter(r => r && r.id !== '' && r.id !== null && r.id !== undefined)
        .map(r => Number(r.id))
        .filter(n => !Number.isNaN(n)),
});

/** The ordered ids a link carried, or `null` when it carried none. */
export const readElevatorIds = (locationState) => {
    const ids = locationState?.siblingIds;
    return Array.isArray(ids) && ids.length > 0 ? ids : null;
};
