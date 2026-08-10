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
 * THE aggregator's row rule for ONE chip — req #3419.
 *
 * Both things this card does with the rule (build the chip's ROW LIST, and count
 * the chip's BADGE) call this. They used to be two transcriptions of one
 * sentence, which is a list and its own count able to disagree.
 *
 * TWO EXCLUSIONS, and they answer different questions:
 *
 *   LAUNCH LEGALITY — `PIPELINE_FILTERED_STATUSES` chips offer a direct
 *     swarm-start, and a requirement a pipeline STEP carries is not eligible for
 *     one (req #3180). UNCONDITIONAL: offering an ineligible launch is a defect,
 *     not a viewing preference, so no toggle gates it. STEP association ONLY —
 *     widening it to epic membership would withhold work that IS launchable.
 *
 *   BROWSE PREFERENCE — the reader's global "hide orchestrated requirements"
 *     toggle, which since req #3419 means step-carried OR epic-filed. Applies to
 *     every chip, on top of (never instead of) the launch exclusion.
 *
 * @param {string} status  the chip's requirement_status
 * @param {object} ctx  from `useRequirementVisibility`
 * @param {Set<number>} [ctx.pipelinedIds]      STEP association
 * @param {Set<number>} [ctx.orchestratedIds]   step OR epic
 * @param {boolean} [ctx.hideOrchestrated]
 * @returns {(row: {id: number|string}) => boolean} true = the row belongs here
 */
export const aggregatorRowVisible = (status, {
    pipelinedIds, orchestratedIds, hideOrchestrated = false,
} = {}) => {
    const offersLaunch = PIPELINE_FILTERED_STATUSES.includes(status);
    return (row) => {
        const id = Number(row?.id);
        if (offersLaunch && pipelinedIds && pipelinedIds.has(id)) return false;
        if (hideOrchestrated && orchestratedIds && orchestratedIds.has(id)) return false;
        return true;
    };
};

/**
 * Per-status counts for the chip badges, applying the same rule as the rows.
 *
 * Pure so the "which chips filter" decision is pinned by tests rather than only
 * by a rendered card.
 *
 * INVARIANT THIS DEPENDS ON: the card counts from `useAllRequirements` while it
 * lists from `useRequirementsByStatus`, and applies NO closed-category filter to
 * EITHER — unlike RequirementsTableView, which filters its rows through
 * `categoryMap`. That is what keeps the count in sync with the list it's paired
 * with. Adding a closed-category guard to one source and not the other would
 * desynchronize the count from the list. Today the pipelined-in-closed-category
 * population is 0.
 *
 * @param {Array<{id: number, requirement_status: string}>} requirements
 * @param {string[]} statuses  the chip vocabulary; every key is initialized to 0
 * @param {object} ctx  the `useRequirementVisibility` context handed to
 *        `aggregatorRowVisible` — ONE rule, so the badge cannot disagree with
 *        the rows it sits above.
 * @returns {{counts: Object, hidden: Object}}
 */
export const tallyRequirementStatuses = (requirements, statuses, ctx = {}) => {
    const counts = {};
    const hidden = {};
    const visibleFor = {};
    statuses.forEach(s => {
        counts[s] = 0;
        hidden[s] = 0;
        visibleFor[s] = aggregatorRowVisible(s, ctx);
    });
    if (!Array.isArray(requirements)) return { counts, hidden };

    for (const r of requirements) {
        // The template row (id === '') is not a requirement and must never be
        // counted — nor reach the Set lookup, where Number('') would be 0.
        if (!r || r.id === '' || r.id === undefined || r.id === null) continue;
        const status = r.requirement_status;
        if (counts[status] === undefined) continue;
        if (!visibleFor[status](r)) {
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
