// useOrchestrationIndex.js — the reads behind the Orchestration box (req #3435).
//
// SIX BOUNDED LIST READS, folded by `buildOrchestrationIndex` (pure, its own
// module). Five of them are the EXACT hook calls the plan pages already make —
// same hook, same options, therefore the same TanStack cache entries — so a
// reader arriving from `/swarm/pipeline/:id` or `/swarm/steps` pays for at most
// the sixth, and a reader arriving cold warms the plan pages in return. That
// sharing is the reason each call below is written as the plan pages write it
// rather than with a narrower projection of its own: `fieldsInKey` is on for all
// of these, so a trimmed `fields=` string is a SECOND cache entry and a second
// fetch of the same table, not a saving.
//
// ## Why list reads at all, on a page built around targeted ones
//
// The box's predecessor (the read-only Epic box, req #3234/#3235/#3253) resolved
// ONE feature, ONE epic and ONE step with by-id and FK-filtered reads — correct
// for a box that only ever reported. This box OFFERS: it needs epic→pipeline for
// every epic and the seats of any epic the reader might pick, which is the same
// question asked N times. Ten reads across two serial chains become six reads
// with one chained hop, and the single-row answers fall out of the same fold.
// See `orchestrationIndex.js`'s header for the chain itself.
//
// ## The one chained hop
//
// `requirements` is read FILTERED BY THE FEATURE ID SET rather than whole-table.
// Only requirements that carry a `feature_fk` can contribute an epic label, and
// there are ~46 features against thousands of requirements — so the filter is
// both the smaller wire payload and the smaller URL (46 short ids, versus the
// ~500 requirement ids the junction names). It costs one round trip behind the
// features read, which is a 46-row projection and normally a cache hit.

import { useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { fetchEntity } from '../../hooks/factory/createEntityQueries';
import {
    ALL_ROWS,
    useAllEpics,
    useAllFeatures,
    useAllPipelines,
    useAllPipelineSteps,
    useAllPipelineStepRequirements,
} from '../../hooks/useDataQueries';
import { buildOrchestrationIndex } from './orchestrationIndex';

// SORTED, not just deduped — the id array is embedded in the query key, and an
// unsorted one keys two reads of the same id set differently whenever the server
// returns the rows in a different order. A plain refetch can silently reorder
// them, miss the cache entry, and blank the box while the chain re-resolves.
const sortedIds = (rows, field) => [...new Set(
    (rows || []).map((r) => r?.[field]).filter((v) => v != null).map(Number)
        .filter((n) => Number.isInteger(n)),
)].sort((a, b) => a - b);

/**
 * @param {?string} creatorFk
 * @param {{enabled?: boolean}} [options]
 * @returns {{index: Object, isLoading: boolean, isError: boolean,
 *            errors: {epics: boolean, features: boolean, plan: boolean,
 *                     epicPlanMap: boolean},
 *            isSettled: boolean}}
 */
export function useOrchestrationIndex(creatorFk, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const active = enabled && !!creatorFk && !!idToken;

    const pipelinesQ = useAllPipelines(creatorFk, { enabled: active });
    const stepsQ = useAllPipelineSteps(creatorFk, { enabled: active });
    const linksQ = useAllPipelineStepRequirements(creatorFk, { enabled: active });
    const epicsQ = useAllEpics(creatorFk, { enabled: active });
    // `closed: ALL_ROWS` matches PipelineDetail/StepsPage/EpicsPage exactly —
    // both for the shared cache entry and because a CLOSED feature still carries
    // the epic label of a requirement seated on it. `epicSeatOptions` does the
    // open-only filtering on the OFFER side, where it belongs — and keeps a
    // closed feature offerable when it is the one already written.
    const featuresQ = useAllFeatures(creatorFk, { closed: ALL_ROWS, enabled: active });

    const featureIds = useMemo(() => sortedIds(featuresQ.data, 'id'), [featuresQ.data]);

    const requirementsQ = useQuery({
        queryKey: ['orchestration_index', 'requirements', creatorFk, featureIds],
        queryFn: () => fetchEntity(
            `${darwinUri}/requirements?feature_fk=(${featureIds.join(',')})&fields=id,feature_fk`,
            idToken),
        enabled: active && featuresQ.isSuccess && featureIds.length > 0,
    });

    const index = useMemo(() => buildOrchestrationIndex({
        pipelines: pipelinesQ.data,
        steps: stepsQ.data,
        stepRequirements: linksQ.data,
        requirements: requirementsQ.data,
        features: featuresQ.data,
        epics: epicsQ.data,
    }), [pipelinesQ.data, stepsQ.data, linksQ.data, requirementsQ.data,
        featuresQ.data, epicsQ.data]);

    const parts = [pipelinesQ, stepsQ, linksQ, epicsQ, featuresQ, requirementsQ];
    const isLoading = parts.some((q) => q.isLoading);
    const isError = parts.some((q) => q.isError);

    // ── ERRORS ARE REPORTED PER CONCERN, not as one flag (code review) ──────
    // The epic assignment needs `epics` and `features`; the plan row needs the
    // other four. Folding them together let a transient failure on a whole-table
    // read that has nothing to do with the write disable assignment entirely —
    // and the two per-row resolvers this hook replaced degraded gracefully by
    // design (req #3235: a failed plan-location lookup "just renders no second
    // link").
    //
    // `plan` is the PIPELINE ROW's health and nothing more: that row's facts —
    // which step of which plan seats this requirement, and the `?step=` link —
    // come from `stepRequirements` + `steps` + `pipelines` and never touch the
    // chained `requirements` read. Folding that read in here replaced a fully
    // known row with "Pipeline unavailable", which is the same over-broad flag
    // one level down.
    //
    // `epicPlanMap` is the separate question "can epic → pipeline be trusted?",
    // and it DOES need the chained read, because that is the hop from a feature
    // to the requirements seated on it. It gates NARROWING, not rendering.
    const planReadsErrored = pipelinesQ.isError || stepsQ.isError || linksQ.isError;
    const errors = {
        epics: epicsQ.isError,
        features: featuresQ.isError,
        plan: planReadsErrored,
        epicPlanMap: planReadsErrored || requirementsQ.isError,
    };

    // ── `isSettled` — "nothing to show" vs "not answered yet" ────────────────
    // The box must not render an epic list, or an "unassigned" display, from a
    // half-filled index: an epic whose seat rows have not landed looks exactly
    // like an epic seated nowhere, and the reader would be offered a filtered
    // list that silently omits real options.
    //
    // DERIVED FROM `isPending`, NOT `isLoading` (req #3253's lesson, carried
    // over): TanStack v5 defines `isLoading` as `isPending && isFetching`, and a
    // query whose `enabled` flipped true THIS render still reports
    // `fetchStatus === 'idle'` until its effect runs — so an `!isLoading` gate
    // has a one-render hole exactly where the chained hop sits. The chained hop
    // is only awaited when the predicate that enables it holds, so a features
    // read that comes back empty settles rather than hanging.
    const isSettled = !active ? true : !(
        pipelinesQ.isPending || stepsQ.isPending || linksQ.isPending
        || epicsQ.isPending || featuresQ.isPending
        || (featuresQ.isSuccess && featureIds.length > 0 && requirementsQ.isPending)
    );

    return { index, isLoading, isError, errors, isSettled };
}
