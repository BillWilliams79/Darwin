// Which plan a session belongs to, and where to open it.
//
// ── THE TRAP THIS EXISTED TO AVOID, AND WHY IT IS GONE ─────────────────────
// `swarm_sessions` carries TWO plan attributions — `pipeline_fk` (1.0, req
// #3186) and `pipeline2_fk` (2.0, req #3350) — and for one window
// `/swarm/pipeline/:id` read ONE of them while callers handed it the other. The
// chip was a 404: measured on dev session 2730 mid-req-#3455, when that route
// was briefly on the 2.0 composed read, `pipeline_fk=79` gave "No pipeline with
// id 79" while the same plan existed in 2.0 as id 7. The two are independent id
// sequences with no stored mapping (`pipeline2_pipelines` has no legacy-id
// column), so picking the wrong column was always wrong.
//
// req #3463 answered that by giving each era its OWN route and reading the era
// off the column. req #3356 finishes the job by DELETING THE QUESTION: Pipeline
// 1.0 is eradicated, so there is one attribution left and one route it opens.
// The `pipeline_fk` read, the `PLAN_ERA_1` branch and the 1.0 `pipelines` list
// parameter are all gone from this file.
//
// THE HISTORY IS KEPT ON PURPOSE. The reason this module exists at all — that
// "which era does this id belong to?" is a question a caller must never answer
// by guessing a column — is the reason req #3462 happened, and it is worth more
// than the branch it justified. A future third attribution re-opens exactly this
// file, and it should re-open it knowing that.
//
// `pipeline_fk` IS NOT READ, EVEN AS A FALLBACK. A session stamped 1.0-only is a
// historical row whose plan no longer has a page, and inventing a 2.0 link from
// its 1.0 id would send the reader to a DIFFERENT plan — the precise failure
// above, reintroduced. Such a row reports `state: 'none'`, which is the same
// answer as work outside any plan and is honest: there is nothing to open.
//
// THE ROUTE IS NOT SPELLED HERE. `planEra.js` owns the era↔route binding and
// `__tests__/planEra.test.js` fails the build on any production file that
// writes a plan route as a string — this file included. That guard is the
// mechanical reason the #3462 outage cannot recur, and hard-coding
// `/swarm/pipeline2/${id}` here would be exactly the shape it exists to catch.
//
// A title match between the two tables is NOT used to bridge the gap — plan
// titles collide in live data, and a wrong bridge sends the reader to a
// different plan, which is worse than sending them nowhere.

import { PLAN_ERA_2, planDetailPath, planEraLabel } from './pipelines/planEra';

/**
 * @param session    a swarm_sessions row (needs pipeline2_fk)
 * @param pipelines2 the 2.0 `pipeline2_pipelines` list — title resolution
 * @returns {state, era, planId, label, title, href} — href non-null only when
 *          navigable. `era`/`planId` are the SEATED plan, so a caller rendering
 *          the bare id shows the one that matches the link (req #3463).
 */
export const sessionPipelineLink = (session, pipelines2) => {
    const twoOh = session?.pipeline2_fk ?? null;

    if (twoOh == null) {
        return { state: 'none', era: null, planId: null, label: null, title: null, href: null };
    }

    const title = (pipelines2 || []).find(p => p.id === twoOh)?.title ?? null;
    const label = title || `#${twoOh}`;

    const era = PLAN_ERA_2;
    const planId = twoOh;
    const href = planDetailPath(era, planId);

    // `planDetailPath` returns null for an id that is not a usable integer, and
    // an unnavigable chip is the right answer for one — the same "omit rather
    // than render a dead link" rule the rest of that module applies. `unlinked`
    // SURVIVES the 1.0 removal because this is not the era question: it is a
    // malformed id, which no number of eras makes navigable.
    if (href == null) {
        return {
            state: 'unlinked',
            era,
            planId,
            label,
            title: `${label} — this session names plan ${JSON.stringify(planId)}, `
                 + 'which is not a usable plan id. Nothing to open from here.',
            href: null,
        };
    }

    return {
        state: 'link',
        era,
        planId,
        label,
        title: `Open Pipeline ${planEraLabel(era)} plan ${label}`,
        href,
    };
};
