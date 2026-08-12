// useOrchestrationIndex.js — the reads behind the Orchestration box (req #3435,
// narrowed by req #3357, re-based on Pipeline 2.0 by req #3356).
//
// FOUR BOUNDED LIST READS, folded by `buildOrchestrationIndex` (pure, its own
// module). It was three until req #3356 and the fourth is not an extra
// question, it is the middle of the SAME one: a 2.0 step carries `epic_fk` and
// no `pipeline_fk`, so `epics` is what turns a step into a plan.
// Dropping it would not save a read, it would leave every step planless and the
// box permanently reading "No pipeline".
//
// (For the record of what it was: req #3357 retired the Epic ROW and with it the
// `epics`/`features` reads and the chained `requirements?feature_fk=(...)` query
// that fed it — six reads down to three. This epic read is a different one: it
// is a JOIN HOP, not a displayed row, and `buildOrchestrationIndex` keeps no
// epic in its output.)
//
// All four are the EXACT hook calls the 2.0 plan pages already make — same hook,
// same options, therefore the same TanStack cache entries — so a reader arriving
// from `/swarm/pipeline/:id`, `/swarm/steps` or `/swarm/epics` pays nothing
// extra, and a reader arriving cold warms those pages in return.

import { useContext, useMemo } from 'react';
import AuthContext from '../../Context/AuthContext';
import {
    useAllPipelines,
    useAllEpics,
    useAllPipelineSteps,
    useAllPipelineStepRequirements,
} from '../../hooks/useDataQueries';
import { buildOrchestrationIndex } from './orchestrationIndex';

/**
 * @param {?string} creatorFk
 * @param {{enabled?: boolean}} [options]
 * @returns {{index: Object, isLoading: boolean, isError: boolean,
 *            errors: {plan: boolean},
 *            isSettled: boolean}}
 */
export function useOrchestrationIndex(creatorFk, { enabled = true } = {}) {
    const { idToken } = useContext(AuthContext);
    const active = enabled && !!creatorFk && !!idToken;

    const pipelinesQ = useAllPipelines(creatorFk, { enabled: active });
    const epicsQ = useAllEpics(creatorFk, { enabled: active });
    const stepsQ = useAllPipelineSteps(creatorFk, { enabled: active });
    const linksQ = useAllPipelineStepRequirements(creatorFk, { enabled: active });

    const index = useMemo(() => buildOrchestrationIndex({
        pipelines: pipelinesQ.data,
        epics: epicsQ.data,
        steps: stepsQ.data,
        stepRequirements: linksQ.data,
    }), [pipelinesQ.data, epicsQ.data, stepsQ.data, linksQ.data]);

    const parts = [pipelinesQ, epicsQ, stepsQ, linksQ];
    const isLoading = parts.some((q) => q.isLoading);
    const isError = parts.some((q) => q.isError);

    // `plan` is the only concern left: which step of which plan seats this
    // requirement, and the `?step=` link, come entirely from these four reads.
    // THE EPICS READ IS IN THIS SET, and that is the whole reason it is stated
    // as a union rather than left out as "only a join hop": a failed epics read
    // makes every step planless, which renders identically to a requirement that
    // is genuinely seated nowhere. Reporting the box unavailable is the honest
    // answer; silently showing "No pipeline" is not.
    const errors = { plan: parts.some((q) => q.isError) };

    const isSettled = !active ? true
        : !parts.some((q) => q.isPending);

    return { index, isLoading, isError, errors, isSettled };
}
