// useUnorchestratedRequirements.js — the rows the Plan visualizer's
// "swarm-ready, not orchestrated" box lists (req #3583).
//
// Two bounded list reads, both already cached app-wide: the swarm-ready
// requirements (the SwarmStartCard's own read) and the epic-requirement
// junction (the orchestrated toggle's own read). No endpoint of its own, and
// nothing that grows with the size of the plan. Kept out of the box component
// so that file exports components only (React Fast Refresh).
//
// A third, also already cached: the category colors the aggregator card paints
// its per-row color bar from (req #3619). It never gates the list — a row
// whose color has not landed simply draws an empty bar, as the card does.

import { useMemo } from 'react';

import {
    useRequirementsByStatus,
    useAllPipelineEpicRequirements,
    useCategoryColors,
} from '../../hooks/useDataQueries';
import { unorchestratedSwarmReady } from './pipelineUnseated';

/**
 * @param {string} creatorFk  the profile userName; falsy disables every read.
 * @returns {{items: Object[], categoryColors: Object<number, string>,
 *            isLoading: boolean, isError: boolean}}
 */
export function useUnorchestratedRequirements(creatorFk) {
    const reqs = useRequirementsByStatus(creatorFk, 'swarm_ready');
    const junction = useAllPipelineEpicRequirements(creatorFk);
    // Until BOTH reads land the list is not an answer: a missing junction would
    // list every swarm-ready requirement as unorchestrated, and offer each of
    // them for a seat it may already have.
    const ready = reqs.data !== undefined && junction.data !== undefined;
    const items = useMemo(
        () => (ready ? unorchestratedSwarmReady(reqs.data, junction.data) : []),
        [ready, reqs.data, junction.data]);
    const colors = useCategoryColors(creatorFk);
    const categoryColors = useMemo(() => {
        const map = {};
        (colors.data || []).forEach((c) => { if (c.color) map[c.id] = c.color; });
        return map;
    }, [colors.data]);
    return {
        items,
        categoryColors,
        isLoading: !ready && !(reqs.isError || junction.isError),
        isError: reqs.isError || junction.isError,
    };
}
