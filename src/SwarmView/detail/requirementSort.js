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

export const siblingHandSort = (a, b) => {
    const aOrder = a.sort_order ?? Infinity;
    const bOrder = b.sort_order ?? Infinity;
    return aOrder - bOrder;
};

export const siblingCreatedSort = (a, b) => a.id - b.id;

export const siblingActiveSort = (sortMode, a, b) => {
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
