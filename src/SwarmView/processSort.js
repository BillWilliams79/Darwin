// Exportable sort functions for SwarmView process mode.
// Consumed by CategoryCard.jsx.

export const STATUS_SORT_PROCESS = {
    authoring: 0, approved: 1, swarm_ready: 2, development: 3, deferred: 4, met: 5, wontfix: 6
};

// Reverse-order rank for status sort (req #2406). Literal user spec:
// deferred, met, development, swarm_ready, approved, authoring. wontfix (req #2783)
// is the last category overall, so it follows the terminal block (deferred, met).
export const STATUS_SORT_PROCESS_REVERSE = {
    deferred: 0, met: 1, wontfix: 2, development: 3, swarm_ready: 4, approved: 5, authoring: 6
};

// Within-group secondary sort. Shared by processSort and processSortReverse —
// recency / id-tiebreaker carry the same semantic meaning regardless of the
// primary rank direction, so they are NOT flipped in the reverse variant.
const secondarySort = (a, b) => {
    switch (a.requirement_status) {
        case 'development': {
            const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
            const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
            return aTime - bTime;  // oldest started first
        }
        case 'deferred': {
            const aTime = a.deferred_at ? new Date(a.deferred_at).getTime() : 0;
            const bTime = b.deferred_at ? new Date(b.deferred_at).getTime() : 0;
            return bTime - aTime;  // most recently deferred first
        }
        case 'met':
        case 'wontfix': {
            // wontfix is terminal like met — both timestamp via completed_at (req #2783)
            const aTime = a.completed_at ? new Date(a.completed_at).getTime() : 0;
            const bTime = b.completed_at ? new Date(b.completed_at).getTime() : 0;
            return bTime - aTime;  // most recently completed first
        }
        default:  // authoring, approved, swarm_ready — oldest (smallest id) first
            return a.id - b.id;
    }
};

export const processSort = (a, b) => {
    if (a.id === '') return 1;
    if (b.id === '') return -1;
    const aRank = STATUS_SORT_PROCESS[a.requirement_status] ?? 0;
    const bRank = STATUS_SORT_PROCESS[b.requirement_status] ?? 0;
    if (aRank !== bRank) return aRank - bRank;
    return secondarySort(a, b);
};

export const processSortReverse = (a, b) => {
    if (a.id === '') return 1;
    if (b.id === '') return -1;
    const aRank = STATUS_SORT_PROCESS_REVERSE[a.requirement_status] ?? 0;
    const bRank = STATUS_SORT_PROCESS_REVERSE[b.requirement_status] ?? 0;
    if (aRank !== bRank) return aRank - bRank;
    return secondarySort(a, b);
};

// Hand-sort comparator (req #2417 — restores in-card drag-reorder).
// Sorts by `sort_order` ASC, treating NULL/undefined as +Infinity so
// unranked rows fall to the end of the visible list. Ties (or both NULL)
// fall through to id ASC. The template row (id === '') always sorts last.
//
// Persistence: CategoryCard.jsx writes new sort_order values via bulk PUT
// when the user drops a row in `sortMode === 'hand'`. Newly created rows
// arrive with sort_order=NULL and stay in id-position until explicitly
// dragged.
export const requirementHandSort = (a, b) => {
    if (a.id === '') return 1;
    if (b.id === '') return -1;
    const aSort = (a.sort_order ?? null) === null ? Number.POSITIVE_INFINITY : a.sort_order;
    const bSort = (b.sort_order ?? null) === null ? Number.POSITIVE_INFINITY : b.sort_order;
    if (aSort !== bSort) return aSort - bSort;
    return a.id - b.id;
};

// ── THE requirement sort — one implementation, three modes (req #3302) ───────
//
// There were THREE copies of this rule and they disagreed:
//
//  1. `CategoryCard.activeSort` — status band, then `requirementHandSort`.
//  2. `CategoryCard.changeSortMode` — bare `requirementHandSort`, NO status band.
//     So picking Hand Sort ordered the rows one way and the very next refetch,
//     status-chip toggle or cross-card drop re-ordered them another, with nothing
//     on screen to explain it.
//  3. `detail/requirementSort.js` — a second transcription of the comparators for
//     the prev/next elevator, whose header already declared it must not drift.
//
// This is now the only one. (2) and (3) call it; `requirementSort.js` re-exports
// the names its own callers and tests use.
//
// The status BAND is deliberate in hand mode and is not a bug being preserved:
// terminal work sinks below active work in every mode, and `sort_order` positions
// a row WITHIN its band. `changeSortMode` skipping it was the defect.
const STATUS_SORT_ACTIVE = {
    authoring: 0, approved: 0, swarm_ready: 0, development: 0,
    deferred: 1, met: 2, wontfix: 3,
};

/**
 * @param {string} sortMode  'process' | 'reverse' | anything else → hand
 * @returns {number} comparator result; the template row (`id === ''`) sorts last.
 */
export const requirementActiveSort = (sortMode, a, b) => {
    if (a.id === '') return 1;
    if (b.id === '') return -1;
    if (sortMode === 'process') return processSort(a, b);
    if (sortMode === 'reverse') return processSortReverse(a, b);

    const aState = STATUS_SORT_ACTIVE[a.requirement_status] ?? 0;
    const bState = STATUS_SORT_ACTIVE[b.requirement_status] ?? 0;
    if (aState !== bState) return aState - bState;

    // Within a terminal band, most-recent first. `secondarySort` is not reused
    // here: it keys off the status ranks of the PROCESS ladder, and hand mode's
    // bands are coarser (all four active statuses share band 0).
    if (a.requirement_status === b.requirement_status) {
        const key = a.requirement_status === 'deferred' ? 'deferred_at'
            : (a.requirement_status === 'met' || a.requirement_status === 'wontfix') ? 'completed_at'
            : null;
        if (key) {
            const aTime = a[key] ? new Date(a[key]).getTime() : 0;
            const bTime = b[key] ? new Date(b[key]).getTime() : 0;
            if (aTime !== bTime) return bTime - aTime;
        }
    }
    return requirementHandSort(a, b);
};

export { STATUS_SORT_ACTIVE };

/** The card's default order when a category names nothing usable. */
export const DEFAULT_SORT_MODE = 'process';

/**
 * `categories.sort_mode` -> one of the three live values (req #3302).
 *
 * FOUR copies of this coercion existed and TWO of them disagreed: `CategoryCard`
 * (twice — the initial state and the rollback) and `RequirementDetail`'s initial
 * load read `'hand' | 'reverse' | else process`, while its category-CHANGE path
 * read `sort_mode || 'hand'` raw. That second form hands a legacy `'created'`
 * straight through to `requirementActiveSort`, which has no case for it and falls
 * to the HAND branch — so changing a requirement's category could silently
 * re-order the prev/next elevator by a mode the card never uses. A NULL differed
 * too: `'hand'` on one path, `'process'` on the other.
 *
 * Legacy `'created'` (retired) and anything unrecognised resolve to `process`,
 * which is what every live category row carries.
 */
export const coerceSortMode = (raw) =>
    raw === 'hand' ? 'hand' : raw === 'reverse' ? 'reverse' : DEFAULT_SORT_MODE;
