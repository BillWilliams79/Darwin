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
// WHICH ONE IS RIGHT IS A PROPERTY OF THE PAGE, NOT OF THE SESSION. This
// function said so and named itself as the single place that would change when
// the plan page grew a 2.0 side. req #3463 is that change, and it took the
// shape this header did not predict: the page did not MOVE to `pipeline2_*`,
// a SECOND page appeared beside it. `/swarm/pipeline/:id` still serves 1.0 and
// `/swarm/pipeline2/:id` now serves 2.0, so BOTH attributions navigate and
// neither is "the id that navigates today" any more.
//
// So the `unlinked` state below is gone: it existed only because a 2.0-seated
// session had nowhere to go. Its tooltip said "which the plan page does not
// serve yet", and that sentence is now false.
//
// THE ROUTE IS NOT SPELLED HERE. `planEra.js` owns the era↔route binding and
// `__tests__/planEra.test.js` fails the build on any production file that
// writes a plan route as a string — this file included. That guard is the
// mechanical reason the #3462 outage cannot recur, and hard-coding
// `/swarm/pipeline/${id}` here would be exactly the shape it exists to catch.
//
// A title match between the two tables is NOT used to bridge the gap — plan
// titles collide in live data, and a wrong bridge sends the reader to a
// different plan, which is worse than sending them nowhere.

import { PLAN_ERA_1, PLAN_ERA_2, planDetailPath, planEraLabel } from './pipelines/planEra';

/**
 * @param session    a swarm_sessions row (needs pipeline_fk / pipeline2_fk)
 * @param pipelines  the 1.0 `pipelines` list — title resolution
 * @param pipelines2 the 2.0 `pipeline2_pipelines` list — title resolution
 * @returns {state, era, planId, label, title, href} — href non-null only when
 *          navigable. `era`/`planId` are the SEATED plan, so a caller rendering
 *          the bare id shows the one that matches the link instead of guessing
 *          which column to read (req #3463).
 */
export const sessionPipelineLink = (session, pipelines, pipelines2) => {
    const oneOh = session?.pipeline_fk ?? null;
    const twoOh = session?.pipeline2_fk ?? null;

    if (oneOh == null && twoOh == null) {
        return { state: 'none', era: null, planId: null, label: null, title: null, href: null };
    }

    const title = (pipelines || []).find(p => p.id === oneOh)?.title
        || (twoOh != null ? (pipelines2 || []).find(p => p.id === twoOh)?.title : null);
    const label = title || `#${oneOh ?? twoOh}`;

    // THE COLUMN NAMES THE ERA, and the era names the route. 1.0 is checked
    // first only because a row carrying both is a data defect that should
    // resolve somewhere rather than nowhere; the two are exclusive in practice.
    const era = oneOh != null ? PLAN_ERA_1 : PLAN_ERA_2;
    const planId = oneOh != null ? oneOh : twoOh;
    const href = planDetailPath(era, planId);

    // `planDetailPath` returns null for an id that is not a usable integer, and
    // an unnavigable chip is the right answer for one — the same "omit rather
    // than render a dead link" rule the rest of that module applies.
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
