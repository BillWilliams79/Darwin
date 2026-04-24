// Sort helpers for the RequirementDetail sibling list.
// Must stay in sync with CategoryCard.activeSort so the row number on the
// card matches the displayIndex in the single-requirement editor.

export const STATUS_SORT = {
    authoring: 0,
    approved: 0,
    swarm_ready: 0,
    development: 0,
    deferred: 1,
    met: 2,
};

export const STATUS_SORT_PROCESS = {
    authoring: 0,
    approved: 1,
    swarm_ready: 2,
    development: 3,
    deferred: 4,
    met: 5,
};

// Reverse-order rank (req #2406). Must match STATUS_SORT_PROCESS_REVERSE in ../processSort.js.
export const STATUS_SORT_PROCESS_REVERSE = {
    deferred: 0,
    met: 1,
    development: 2,
    swarm_ready: 3,
    approved: 4,
    authoring: 5,
};

export const siblingHandSort = (a, b) => {
    const aOrder = a.sort_order ?? Infinity;
    const bOrder = b.sort_order ?? Infinity;
    return aOrder - bOrder;
};

export const siblingCreatedSort = (a, b) => a.id - b.id;

// Within-group secondary sort shared by forward and reverse process sorts.
// Recency/hand-order/id-tiebreaker carry the same meaning in either direction.
const secondarySort = (a, b) => {
    switch (a.requirement_status) {
        case 'development': {
            const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
            const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
            return aTime - bTime;  // oldest started first
        }
        case 'swarm_ready':
            return siblingHandSort(a, b);  // hand sort within swarm_ready group
        case 'deferred': {
            const aTime = a.deferred_at ? new Date(a.deferred_at).getTime() : 0;
            const bTime = b.deferred_at ? new Date(b.deferred_at).getTime() : 0;
            return bTime - aTime;  // most recently deferred first
        }
        case 'met': {
            const aTime = a.completed_at ? new Date(a.completed_at).getTime() : 0;
            const bTime = b.completed_at ? new Date(b.completed_at).getTime() : 0;
            return bTime - aTime;  // most recently completed first
        }
        default:  // authoring, approved — oldest (smallest id) first
            return a.id - b.id;
    }
};

export const siblingProcessSort = (a, b) => {
    const aRank = STATUS_SORT_PROCESS[a.requirement_status] ?? 0;
    const bRank = STATUS_SORT_PROCESS[b.requirement_status] ?? 0;
    if (aRank !== bRank) return aRank - bRank;
    return secondarySort(a, b);
};

export const siblingProcessSortReverse = (a, b) => {
    const aRank = STATUS_SORT_PROCESS_REVERSE[a.requirement_status] ?? 0;
    const bRank = STATUS_SORT_PROCESS_REVERSE[b.requirement_status] ?? 0;
    if (aRank !== bRank) return aRank - bRank;
    return secondarySort(a, b);
};

export const siblingActiveSort = (sortMode, a, b) => {
    if (sortMode === 'process') return siblingProcessSort(a, b);
    if (sortMode === 'reverse') return siblingProcessSortReverse(a, b);
    const aState = STATUS_SORT[a.requirement_status] ?? 0;
    const bState = STATUS_SORT[b.requirement_status] ?? 0;
    if (aState !== bState) return aState - bState;
    if (a.requirement_status === 'met' && b.requirement_status === 'met') {
        const aTime = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const bTime = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        if (aTime !== bTime) return bTime - aTime;
    }
    if (a.requirement_status === 'deferred' && b.requirement_status === 'deferred') {
        const aTime = a.deferred_at ? new Date(a.deferred_at).getTime() : 0;
        const bTime = b.deferred_at ? new Date(b.deferred_at).getTime() : 0;
        if (aTime !== bTime) return bTime - aTime;
    }
    return sortMode === 'hand' ? siblingHandSort(a, b) : siblingCreatedSort(a, b);
};
