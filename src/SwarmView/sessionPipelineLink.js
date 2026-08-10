// Which plan a session belongs to, and whether that plan has a page to go to.
//
// THE TRAP THIS EXISTS TO AVOID. `swarm_sessions` carries TWO plan attributions
// — `pipeline_fk` (1.0) and `pipeline2_fk` (2.0, req #3350) — and
// `/swarm/pipeline/:id` reads ONE of them. Link the wrong one and the chip is a
// 404: measured on dev session 2730 mid-req-#3455, when that route was briefly
// on the 2.0 composed read, `pipeline_fk=79` gave "No pipeline with id 79"
// while the same plan existed in 2.0 as id 7. The two are independent id
// sequences with no stored mapping (`pipeline2_pipelines` has no legacy-id
// column), so one is always wrong.
//
// WHICH ONE IS RIGHT IS A PROPERTY OF THE PAGE, NOT OF THE SESSION, and it has
// already flipped once during this requirement. `PipelineDetail.jsx` resolves
// its plan with `pipelines.find(p => p.id === pipelineId)` off `useAllPipelines`
// — the **1.0** table — so `pipeline_fk` is the id that navigates today. If that
// page moves to `pipeline2_*`, THIS FUNCTION is the single place that changes;
// that is why the choice lives here and not inline in three grids.
//
// A title match between the two tables is NOT used to bridge the gap — plan
// titles collide in live data, and a wrong bridge sends the reader to a
// different plan, which is worse than sending them nowhere.

/**
 * @param session    a swarm_sessions row (needs pipeline_fk / pipeline2_fk)
 * @param pipelines  the 1.0 `pipelines` list — resolves the title AND the link
 * @param pipelines2 the 2.0 `pipeline2_pipelines` list — title resolution only,
 *                   so a 2.0-only session is named rather than shown as a bare id
 * @returns {state, label, title, href} — href non-null only when navigable.
 */
export const sessionPipelineLink = (session, pipelines, pipelines2) => {
    const oneOh = session?.pipeline_fk ?? null;
    const twoOh = session?.pipeline2_fk ?? null;

    if (oneOh == null && twoOh == null) {
        return { state: 'none', label: null, title: null, href: null };
    }

    const title = (pipelines || []).find(p => p.id === oneOh)?.title
        || (twoOh != null ? (pipelines2 || []).find(p => p.id === twoOh)?.title : null);
    const label = title || `#${oneOh ?? twoOh}`;

    if (oneOh != null) {
        return {
            state: 'link',
            label,
            title: `Open plan ${label}`,
            href: `/swarm/pipeline/${oneOh}`,
        };
    }

    // 2.0-seated only. Named, but not navigable: the plan page reads the 1.0
    // table, so a 2.0 id in the URL renders "No pipeline with id N".
    return {
        state: 'unlinked',
        label,
        title: `${label} — this session is attributed to the Pipeline 2.0 plan `
             + `(#${twoOh}), which the plan page does not serve yet. Nothing to open from here.`,
        href: null,
    };
};
