// Pure utilities for SwarmStartCard — extracted for testability.
// Part of the "Optional Domain-Scoped Filter Card" pattern.

// Sort swarm-ready requirements chronologically by id (creation order).
export const sortSwarmReadyItems = (items) => {
    return [...items].sort((a, b) => a.id - b.id);
};

// req #3180 — the chips that OFFER a launch, and therefore the only ones the
// pipeline exclusion applies to.
//
// `development` and `met` are deliberately NOT here, and this is the decision a
// future reader is likeliest to "simplify" back to uniform. Neither is an offer:
// a `development` requirement cannot be launched by any path (/swarm-start's
// per-item gate prompts on it), and `met` is req #2584's trailing-24h
// recent-completions list. Measured against the live plan, 7 of 7 `development`
// requirements are plan-carried — filtering uniformly would empty the chip the
// user watches in-flight work through, and the Met chip would converge on
// permanently blank as the plan completes.
//
// This is per-chip, not per-card, and it does NOT reintroduce the "filtered list
// under an unfiltered count" defect: that defect is a list and a count
// disagreeing FOR ONE CHIP, and `tallyRequirementStatuses` below applies exactly
// this predicate to the count that the card applies to the list.
export const PIPELINE_FILTERED_STATUSES = ['authoring', 'approved', 'swarm_ready'];

/**
 * Per-status counts for the chip badges, plus what the pipeline exclusion removed.
 *
 * Pure so the "which chips filter" decision is pinned by tests rather than only
 * by a rendered card.
 *
 * INVARIANT THIS DEPENDS ON: the card counts from `useAllRequirements` while it
 * lists from `useRequirementsByStatus`, and applies NO closed-category filter to
 * EITHER — unlike RequirementsTableView, which filters its rows through
 * `categoryMap`. That is what makes `hidden[status]` exactly the number of rows
 * dropped from that chip's list. Adding a closed-category guard to one source and
 * not the other would desynchronize the count from the list AND overcount the
 * note, in the same edit. Today the pipelined-in-closed-category population is 0.
 *
 * @param {Array<{id: number, requirement_status: string}>} requirements
 * @param {string[]} statuses      the chip vocabulary; every key is initialized to 0
 * @param {Set<number>} pipelinedIds  from `pipelinedRequirementIds`
 * @returns {{counts: Object, hidden: Object}}
 */
export const tallyRequirementStatuses = (requirements, statuses, pipelinedIds) => {
    const counts = {};
    const hidden = {};
    statuses.forEach(s => { counts[s] = 0; hidden[s] = 0; });
    if (!Array.isArray(requirements)) return { counts, hidden };

    for (const r of requirements) {
        // The template row (id === '') is not a requirement and must never be
        // counted — nor reach the Set lookup, where Number('') would be 0.
        if (!r || r.id === '' || r.id === undefined || r.id === null) continue;
        const status = r.requirement_status;
        if (counts[status] === undefined) continue;
        if (PIPELINE_FILTERED_STATUSES.includes(status)
                && pipelinedIds && pipelinedIds.has(Number(r.id))) {
            hidden[status] += 1;
            continue;
        }
        counts[status] += 1;
    }
    return { counts, hidden };
};

// Map coordination_type to a display label for tooltips / aria.
export const getCoordLabel = (coordType) => {
    switch (coordType) {
        case 'discuss':     return 'Discuss Req';
        case 'planned':     return 'Planned';
        case 'implemented': return 'Implemented';
        case 'deployed':    return 'Deployed';
        default:            return 'No autonomy';
    }
};
