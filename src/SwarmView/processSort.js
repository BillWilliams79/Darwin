// Exportable sort functions for SwarmView process mode.
// Consumed by CategoryCard.jsx and by tests/swarm/test-process-sort-cross-impl.sh
// via tests/swarm/helpers/process-sort-js.mjs.
//
// NOTE: STATUS_SORT_PROCESS and processSort are duplicated in
// scripts/swarm/sort-process.sh (Python), consumed by the /swarm-start skill
// so the skill's position N matches the UI's position N. If you change the rank
// map or any per-status secondary sort here, update sort-process.sh to match or
// /swarm-start will silently pick the wrong requirement (see req #2165).
// A cross-language consistency test lives in
// tests/swarm/test-process-sort-cross-impl.sh — edit either impl and it will fail.

export const requirementHandSort = (a, b) => {
    if (a.id === '') return 1;
    if (b.id === '') return -1;
    const aOrder = a.sort_order ?? Infinity;
    const bOrder = b.sort_order ?? Infinity;
    return aOrder - bOrder;
};

export const STATUS_SORT_PROCESS = {
    authoring: 0, approved: 1, swarm_ready: 2, development: 3, deferred: 4, met: 5
};

export const processSort = (a, b) => {
    if (a.id === '') return 1;
    if (b.id === '') return -1;
    const aRank = STATUS_SORT_PROCESS[a.requirement_status] ?? 0;
    const bRank = STATUS_SORT_PROCESS[b.requirement_status] ?? 0;
    if (aRank !== bRank) return aRank - bRank;
    switch (a.requirement_status) {
        case 'development': {
            const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
            const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
            return aTime - bTime;  // oldest started first
        }
        case 'swarm_ready':
            return requirementHandSort(a, b);  // hand sort within swarm_ready group
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

// Statuses that /swarm-start considers when picking a requirement by position.
// Matches the MCP darwin://requirements/open resource (excludes deferred + met).
export const OPEN_STATUSES_FOR_RANK = new Set([
    'authoring', 'approved', 'swarm_ready', 'development',
]);

// Build a { [requirementId]: 1-based-rank } map where rank is the position of the
// requirement in its origin category's processSort order, restricted to statuses
// /swarm-start would consider. Used by the SwarmStartCard aggregator to show the
// origin-category swarm-start position alongside each cross-category row.
export const computeCategoryRankMap = (requirements) => {
    const map = {};
    if (!Array.isArray(requirements)) return map;

    const byCategory = new Map();
    for (const r of requirements) {
        if (!r || r.id === '' || r.id === undefined || r.id === null) continue;
        if (!OPEN_STATUSES_FOR_RANK.has(r.requirement_status)) continue;
        const cat = r.category_fk;
        if (cat === undefined || cat === null) continue;
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(r);
    }

    for (const items of byCategory.values()) {
        items.sort((a, b) => processSort(a, b));
        items.forEach((r, idx) => { map[r.id] = idx + 1; });
    }
    return map;
};
