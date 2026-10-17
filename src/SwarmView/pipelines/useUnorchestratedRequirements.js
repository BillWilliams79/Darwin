// useUnorchestratedRequirements.js — the rows the Plan visualizer's
// "swarm-ready, not orchestrated" box lists (req #3583).
//
// Two bounded list reads, both already cached app-wide: the swarm-ready
// requirements (the SwarmStartCard's own read) and the step-requirement
// junction (the orchestrated toggle's own read). No endpoint of its own, and
// nothing that grows with the size of the plan. Kept out of the box component
// so that file exports components only (React Fast Refresh).

import { useMemo } from 'react';

import {
    useRequirementsByStatus,
    useAllPipelineStepRequirements,
} from '../../hooks/useDataQueries';
import { unorchestratedSwarmReady } from './pipelineUnseated';

/**
 * @param {string} creatorFk  the profile userName; falsy disables both reads.
 * @returns {{items: Object[], isLoading: boolean, isError: boolean}}
 */
export function useUnorchestratedRequirements(creatorFk) {
    const reqs = useRequirementsByStatus(creatorFk, 'swarm_ready');
    const junction = useAllPipelineStepRequirements(creatorFk);
    // Until BOTH reads land the list is not an answer: a missing junction would
    // list every swarm-ready requirement as unorchestrated, and offer each of
    // them for a seat it may already have.
    const ready = reqs.data !== undefined && junction.data !== undefined;
    const items = useMemo(
        () => (ready ? unorchestratedSwarmReady(reqs.data, junction.data) : []),
        [ready, reqs.data, junction.data]);
    return {
        items,
        isLoading: !ready && !(reqs.isError || junction.isError),
        isError: reqs.isError || junction.isError,
    };
}
