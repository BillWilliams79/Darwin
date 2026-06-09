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
