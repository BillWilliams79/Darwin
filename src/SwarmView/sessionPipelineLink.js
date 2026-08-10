// Which plan a session belongs to, and whether that plan has a page to go to.
//
// THE TRAP THIS EXISTS TO AVOID. `swarm_sessions` carries TWO plan attributions
// — `pipeline_fk` (1.0) and `pipeline2_fk` (2.0, req #3350) — while
// `/swarm/pipeline/:id` has already moved to the 2.0 composed read
// (`pipeline2_compose`, req #3367). So a chip built from `pipeline_fk`, which is
// what every session view did, hands a 1.0 id to a 2.0 route: measured on dev
// session 2730, `pipeline_fk=79` -> `/swarm/pipeline/79` -> 404, while the same
// plan exists in 2.0 as id 7. The ids are independent sequences; there is no
// stored mapping between them (`pipeline2_pipelines` has no legacy-id column).
//
// So: the LABEL may come from either era, but the LINK is only ever a 2.0 id.
// A title match between the two tables is NOT used to bridge the gap — plan
// titles collide in live data, and a wrong bridge sends the reader to a
// different plan, which is worse than sending them nowhere.
//
// Most sessions therefore render as text today: 243 of 246 in dev carry a 1.0
// attribution only, because #3350's stamping is forward-looking and historical
// rows were never backfilled. That is a real gap, and it belongs to the 2.0
// migration (req #3350 / the plan-layer UI re-point), not here — this module's
// only job is to make sure this app never offers a link it knows will 404.

/**
 * @param session    a swarm_sessions row (needs pipeline_fk / pipeline2_fk)
 * @param pipelines  the 1.0 `pipelines` list — title resolution only
 * @param pipelines2 the 2.0 `pipeline2_pipelines` list — title resolution only
 * @returns {state, label, title, href} — href non-null only when navigable.
 */
export const sessionPipelineLink = (session, pipelines, pipelines2) => {
    const oneOh = session?.pipeline_fk ?? null;
    const twoOh = session?.pipeline2_fk ?? null;

    if (oneOh == null && twoOh == null) {
        return { state: 'none', label: null, title: null, href: null };
    }

    // Prefer the 2.0 title when the session is 2.0-seated: that is the plan the
    // link actually opens, so naming the 1.0 row would label a chip with one
    // plan and navigate to another. A bare `#7` was the earlier symptom — an id
    // from a table no page in the app lists.
    const title = (twoOh != null ? (pipelines2 || []).find(p => p.id === twoOh)?.title : null)
        || (pipelines || []).find(p => p.id === oneOh)?.title;
    const label = title || `#${twoOh ?? oneOh}`;

    if (twoOh != null) {
        return {
            state: 'link',
            label,
            title: `Open plan ${label}`,
            href: `/swarm/pipeline/${twoOh}`,
        };
    }

    return {
        state: 'unlinked',
        label,
        title: `${label} — this session is attributed to the 1.0 plan (#${oneOh}), `
             + 'which has no page since the plan view moved to Pipeline 2.0. '
             + 'Nothing to open from here.',
        href: null,
    };
};
