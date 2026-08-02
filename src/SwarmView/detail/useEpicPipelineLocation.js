// useEpicPipelineLocation.js — req #3235.
//
// Resolves which pipeline (if any) an epic is seated in, for the requirement
// page's epic box "view on plan" link.
//
// No table carries `epic_fk` — an epic reaches a pipeline only transitively:
//   epics -> features (epic_fk) -> requirements (feature_fk)
//         -> pipeline_step_requirements (requirement_fk) -> pipeline_steps (step_fk)
//         -> pipelines (pipeline_fk)
// Five hops, each a narrow FK-filtered read chained through `enabled` so a
// hop only fires once its predecessor has resolved a non-empty id list —
// never a whole-table read, matching the targeted-read discipline the epic
// box itself was built on (req #3234).
//
// TIE-BREAK: an epic seated in more than one pipeline resolves to the
// `active` one, else the lowest id — the EXACT rule `_resolve_pipeline` uses
// server-side for session attribution (darwin-mcp/services/requirements.py,
// req #3186), reused rather than reinvented per the requirement text.
//
// `isLoading` is simply every hop's own `isLoading` OR'd together: TanStack
// v5 defines `isLoading` as `status === 'pending' && fetchStatus === 'fetching'`,
// which is false for a disabled query — so a hop a shorter chain never reaches
// (e.g. an epic with zero features) contributes `false`, not a stuck `true`,
// and the chain resolves to "no pipeline" rather than "loading forever".

import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { fetchEntity } from '../../hooks/factory/createEntityQueries';

// SORTED, not just deduped (code review) — `_resolve_pipeline` sorts both of
// its id sets before use, and this chain's query keys embed the id array
// directly. An unsorted array keys two reads of the same id set differently
// whenever the server returns them in a different row order (no `sort=` is
// requested — there is nothing to order these projections BY), fragmenting
// the cache: a plain refetch (`refetchOnWindowFocus`, a stale-time expiry)
// can silently reorder the rows, miss every downstream cache entry, and the
// "view on plan" link would blink out while the chain re-resolves.
const dedupedIds = (rows, field) => [...new Set(
    (rows || []).map((r) => r?.[field]).filter((v) => v != null)
)].sort((a, b) => a - b);

/**
 * @param {?string} creatorFk
 * @param {?number} epicId
 * @param {{enabled?: boolean}} [options]
 * @returns {{pipelineId: ?number, isLoading: boolean, isError: boolean}}
 */
export function useEpicPipelineLocation(creatorFk, epicId, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const active = enabled && epicId != null && !!creatorFk && !!idToken;

    const featuresQ = useQuery({
        queryKey: ['epic_pipeline_location', 'features', creatorFk, epicId],
        queryFn: () => fetchEntity(`${darwinUri}/features?epic_fk=${epicId}&fields=id`, idToken),
        enabled: active,
    });
    const featureIds = dedupedIds(featuresQ.data, 'id');

    const requirementsQ = useQuery({
        queryKey: ['epic_pipeline_location', 'requirements', creatorFk, featureIds],
        queryFn: () => fetchEntity(
            `${darwinUri}/requirements?feature_fk=(${featureIds.join(',')})&fields=id`, idToken),
        enabled: active && featuresQ.isSuccess && featureIds.length > 0,
    });
    const requirementIds = dedupedIds(requirementsQ.data, 'id');

    const stepLinksQ = useQuery({
        queryKey: ['epic_pipeline_location', 'step_links', creatorFk, requirementIds],
        queryFn: () => fetchEntity(
            `${darwinUri}/pipeline_step_requirements?requirement_fk=(${requirementIds.join(',')})&fields=step_fk`,
            idToken),
        enabled: active && requirementsQ.isSuccess && requirementIds.length > 0,
    });
    const stepIds = dedupedIds(stepLinksQ.data, 'step_fk');

    // `plan_location`, not this hook's own name (req #3253 code review): the
    // last two hops are shared verbatim with `useRequirementStepLocation`, and
    // on a requirement whose own step is what put this epic on the plan both
    // chains ask for the SAME id set. A per-hook prefix fetched and cached the
    // identical URL twice. The first three hops stay hook-scoped — nothing else
    // asks those questions.
    const stepsQ = useQuery({
        queryKey: ['plan_location', 'steps', creatorFk, stepIds],
        queryFn: () => fetchEntity(
            `${darwinUri}/pipeline_steps?id=(${stepIds.join(',')})&fields=id,pipeline_fk`, idToken),
        enabled: active && stepLinksQ.isSuccess && stepIds.length > 0,
    });
    const pipelineIds = dedupedIds(stepsQ.data, 'pipeline_fk');

    const pipelinesQ = useQuery({
        queryKey: ['plan_location', 'pipelines', creatorFk, pipelineIds],
        queryFn: () => fetchEntity(
            `${darwinUri}/pipelines?id=(${pipelineIds.join(',')})&fields=id,pipeline_status`, idToken),
        enabled: active && stepsQ.isSuccess && pipelineIds.length > 0,
    });

    let pipelineId = null;
    if (pipelinesQ.data && pipelinesQ.data.length > 0) {
        // Active first, then lowest id — `_resolve_pipeline`'s sort key,
        // reused verbatim rather than a second tie-break invented here.
        pipelineId = [...pipelinesQ.data].sort((a, b) => {
            const aActive = a.pipeline_status === 'active' ? 0 : 1;
            const bActive = b.pipeline_status === 'active' ? 0 : 1;
            return aActive !== bActive ? aActive - bActive : a.id - b.id;
        })[0].id;
    }

    const isLoading = featuresQ.isLoading || requirementsQ.isLoading
        || stepLinksQ.isLoading || stepsQ.isLoading || pipelinesQ.isLoading;
    const isError = featuresQ.isError || requirementsQ.isError
        || stepLinksQ.isError || stepsQ.isError || pipelinesQ.isError;

    return { pipelineId, isLoading, isError };
}
