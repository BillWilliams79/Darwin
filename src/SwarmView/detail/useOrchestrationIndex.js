// useOrchestrationIndex.js — the reads behind the Orchestration box (req #3435,
// narrowed by req #3357).
//
// THREE BOUNDED LIST READS, folded by `buildOrchestrationIndex` (pure, its own
// module) — down from six: req #3357 retired the Epic row and, with it, the
// `epics`/`features` reads and the chained `requirements?feature_fk=(...)`
// query that fed it. See `orchestrationIndex.js`'s header for why no
// replacement exists for 1.0.
//
// All three are the EXACT hook calls the plan pages already make — same hook,
// same options, therefore the same TanStack cache entries — so a reader
// arriving from `/swarm/pipeline/:id` or `/swarm/steps` pays nothing extra, and
// a reader arriving cold warms the plan pages in return.

import { useContext, useMemo } from 'react';
import AuthContext from '../../Context/AuthContext';
import {
    useAllPipelines,
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
    const stepsQ = useAllPipelineSteps(creatorFk, { enabled: active });
    const linksQ = useAllPipelineStepRequirements(creatorFk, { enabled: active });

    const index = useMemo(() => buildOrchestrationIndex({
        pipelines: pipelinesQ.data,
        steps: stepsQ.data,
        stepRequirements: linksQ.data,
    }), [pipelinesQ.data, stepsQ.data, linksQ.data]);

    const parts = [pipelinesQ, stepsQ, linksQ];
    const isLoading = parts.some((q) => q.isLoading);
    const isError = parts.some((q) => q.isError);

    // `plan` is the only concern left: which step of which plan seats this
    // requirement, and the `?step=` link, come entirely from these three reads.
    const errors = { plan: pipelinesQ.isError || stepsQ.isError || linksQ.isError };

    const isSettled = !active ? true
        : !(pipelinesQ.isPending || stepsQ.isPending || linksQ.isPending);

    return { index, isLoading, isError, errors, isSettled };
}
