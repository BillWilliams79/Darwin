// Pure utilities for SwarmStartCard — extracted for testability.
// Part of the "Optional Domain-Scoped Filter Card" pattern.

// Sort swarm-ready requirements chronologically by id (creation order).
export const sortSwarmReadyItems = (items) => {
    return [...items].sort((a, b) => a.id - b.id);
};

// ── THE AGGREGATOR HAS NO RULE OF ITS OWN (req #3502) ───────────────────────
//
// `PIPELINE_FILTERED_STATUSES` and `aggregatorRowVisible` used to live here: a
// SECOND visibility rule, layered under the shared one, that dropped every
// step-carried requirement from the `authoring`/`approved`/`swarm_ready` chips
// UNCONDITIONALLY — no toggle, on the reasoning that those three chips OFFER a
// direct swarm-start and a plan-carried requirement is not eligible for one
// (req #3180).
//
// MEASURED, and it is what this requirement reports: 18 `authoring`
// requirements are step-carried on production (the reader counted 15 when they
// filed). Asked to SHOW orchestrated work, the Cards view, the Table view and
// the detail elevator all showed those rows and the aggregator did not —
// because the toggle could not reach three of its five chips. One control, four
// surfaces, two answers.
//
// So the second rule is GONE and `useRequirementVisibility` is the whole answer
// here, exactly as it is everywhere else. The protection it was providing was
// already in place elsewhere, and those mechanisms are better at the job:
//
//   • the toggle DEFAULTS to hiding orchestrated work (req #3242), so the state
//     a reader arrives in is unchanged on all five chips;
//   • a row that IS on screen is MARKED (the gold title box, req #3419) from
//     the very same Set — the reader SEES which work a plan owns, rather than
//     having it silently withheld from three chips and not the other two;
//   • `/swarm-start`'s auto-discovery still excludes step-carried requirements,
//     and that is the surface that actually launches. A browse card rendering a
//     row is not an offer; the launcher's own gate is.
//
// Do not reintroduce a per-chip predicate here. The rule is one function in
// `hooks/useRequirementVisibility.js`, and the reason it is one function is that
// it was five copies (req #3419), then two (this one), and every time there was
// more than one they disagreed.

/**
 * Per-status counts for the chip badges, applying the same rule as the rows.
 *
 * Pure, so the rule is pinned by tests rather than only by a rendered card.
 *
 * INVARIANT THIS DEPENDS ON: the card counts from `useAllRequirements` while it
 * lists from `useRequirementsByStatus`, and applies NO closed-category filter to
 * EITHER — unlike RequirementsTableView, which filters its rows through
 * `categoryMap`. That is what keeps the count in sync with the list it's paired
 * with. Adding a closed-category guard to one source and not the other would
 * desynchronize the count from the list.
 *
 * @param {Array<{id: number, requirement_status: string}>} requirements
 * @param {string[]} statuses  the chip vocabulary; every key is initialized to 0
 * @param {(row: {id: number|string}) => boolean} [isVisible]
 *        `useRequirementVisibility().isVisible` — THE predicate, and the same
 *        function object the card filters its rows with, so a badge cannot
 *        disagree with the rows beneath it.
 *
 *        OMITTING IT counts everything, and that is a supported call: a caller
 *        with no rule yet must show MORE, never hide work behind a read that has
 *        not landed.
 *
 *        PASSING A NON-FUNCTION is a different thing entirely and is a CALLER
 *        BUG — an in-flight read supplies a predicate that hides nothing, never
 *        a non-predicate. It still degrades to counting everything (this is a
 *        badge, not a place to throw), but it COMPLAINS in dev, because the
 *        state it silently produces is exactly the "filtered list under an
 *        unfiltered count" defect this file exists to prevent: the rows path
 *        would keep filtering normally while every badge counted the lot. The
 *        pre-req-#3502 signature took an OBJECT here, so that is the specific
 *        regression this catches.
 * @returns {{counts: Object, hidden: Object}}
 */
export const tallyRequirementStatuses = (requirements, statuses, isVisible) => {
    const counts = {};
    const hidden = {};
    if (isVisible !== undefined && typeof isVisible !== 'function'
        && typeof console !== 'undefined' && import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
            '[tallyRequirementStatuses] third argument must be the '
            + '`useRequirementVisibility().isVisible` PREDICATE, got '
            + `${typeof isVisible}. Counting everything — badges will not match `
            + 'the rows beneath them. (req #3502 changed this parameter from a '
            + 'context object to the predicate itself.)');
    }
    const visible = typeof isVisible === 'function' ? isVisible : () => true;
    statuses.forEach(s => {
        counts[s] = 0;
        hidden[s] = 0;
    });
    if (!Array.isArray(requirements)) return { counts, hidden };

    for (const r of requirements) {
        // The template row (id === '') is not a requirement and must never be
        // counted — nor reach the Set lookup, where Number('') would be 0.
        if (!r || r.id === '' || r.id === undefined || r.id === null) continue;
        const status = r.requirement_status;
        if (counts[status] === undefined) continue;
        if (!visible(r)) {
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
