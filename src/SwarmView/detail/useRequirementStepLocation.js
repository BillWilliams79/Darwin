// useRequirementStepLocation.js — req #3253.
//
// Resolves which STEP of which pipeline carries THIS requirement, for the
// requirement page's "view on plan" link.
//
// Three hops, chained through `enabled` exactly as `useEpicPipelineLocation`
// (req #3235) chains its five:
//   requirement -> pipeline_step_requirements (requirement_fk)
//               -> pipeline_steps (id)
//               -> pipelines (id)
// Each is a narrow FK-filtered projection, never a whole-table read.
//
// WHY A SECOND HOOK RATHER THAN A PARAMETER ON THE FIRST. They answer different
// questions and start from different rows: the epic hook asks "which pipeline
// hosts ANY of this epic's requirements" and deliberately widens through every
// sibling requirement; this one asks "which step carries THIS requirement" and
// must not widen at all. Folding them together would make the narrow question
// pay for the wide one's fan-out, and the epic answer is still needed — it is
// the fallback when no step carries the requirement.
//
// PIPELINE TIE-BREAK: active first, then lowest id — `_resolve_pipeline`'s rule
// (darwin-mcp/services/requirements.py, req #3186), the same one the epic hook
// reuses rather than a third copy invented here.
//
// STEP TIE-BREAK, and this is the one place this hook knowingly approximates.
// The requirement text asks for "the first in DISPLAY order". Display order is
// DERIVED (`displayOrder` in pipelineModel.js) from the whole plan — every step,
// every dep row, every step's state, and the epic labels reached through the
// rule-10 chain. Computing it here would mean loading the entire plan on the
// requirement page to decide one link, which is precisely the fan-out the
// targeted-read discipline this hook was built under rules out. So the tie-break
// is the LOWEST STEP ID within the chosen pipeline: deterministic, stable across
// refetches, and reached only by a requirement seated on two steps of one plan —
// which the plan model already treats as a defect (`/swarm-start` derives its
// arguments per step, and two steps carrying one requirement command it twice).
// A requirement on one step — every requirement on the live plan — is unaffected.
//
// `isLoading` is every hop's own `isLoading` OR'd together, for the reason
// spelled out in `useEpicPipelineLocation`: TanStack v5 reports `false` for a
// disabled query, so a chain that runs dry resolves to "no step" rather than to
// a stuck `true`.

import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { fetchEntity } from '../../hooks/factory/createEntityQueries';

// SORTED, not just deduped — the id array is embedded in the query key, and an
// unsorted one keys two reads of the same id set differently whenever the server
// returns the rows in a different order (no `sort=` is requested; there is
// nothing to order these projections by). See `useEpicPipelineLocation`'s
// identical helper for the cache-fragmentation failure that guards against.
const dedupedIds = (rows, field) => [...new Set(
    (rows || []).map((r) => r?.[field]).filter((v) => v != null)
)].sort((a, b) => a - b);

/**
 * @param {?string} creatorFk
 * @param {?number} requirementId
 * @param {{enabled?: boolean}} [options]
 * @returns {{pipelineId: ?number, stepId: ?number, isLoading: boolean, isError: boolean}}
 */
export function useRequirementStepLocation(creatorFk, requirementId, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    // The route param arrives as a STRING (`useParams`), so this is the
    // `pipelineStepLink.toId` guard rather than a bare `Number()`: nullish and
    // empty are rejected BEFORE `Number` sees them, because `Number(null)` and
    // `Number('')` are both 0 and 0 is a perfectly good id — a `/swarm/requirement/`
    // with no id would otherwise query step links for requirement 0.
    const reqId = requirementId == null || requirementId === ''
        || !Number.isInteger(Number(requirementId)) ? null : Number(requirementId);
    const active = enabled && reqId != null && !!creatorFk && !!idToken;

    const stepLinksQ = useQuery({
        queryKey: ['requirement_step_location', 'step_links', creatorFk, reqId],
        queryFn: () => fetchEntity(
            `${darwinUri}/pipeline_step_requirements?requirement_fk=${reqId}&fields=step_fk`,
            idToken),
        enabled: active,
    });
    const stepIds = dedupedIds(stepLinksQ.data, 'step_fk');

    // SHARED KEY NAMESPACE with `useEpicPipelineLocation`'s last two hops (code
    // review). Both chains converge on the same two projections of the same two
    // tables, and on a requirement whose own step is what put its epic on the
    // plan the id sets are IDENTICAL — so a per-hook prefix fetched the same URL
    // twice and cached it twice, on a page whose two resolvers were each written
    // around targeted-read discipline. The prefix is `plan_location` rather than
    // either hook's name precisely because it belongs to neither.
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
        pipelineId = [...pipelinesQ.data].sort((a, b) => {
            const aActive = a.pipeline_status === 'active' ? 0 : 1;
            const bActive = b.pipeline_status === 'active' ? 0 : 1;
            return aActive !== bActive ? aActive - bActive : a.id - b.id;
        })[0].id;
    }

    // The step must belong to the pipeline that WON the tie-break — a step from
    // the losing plan paired with the winning plan's id is a link to a step that
    // is not on that plan, which the visualizer would correctly refuse to focus.
    //
    // COERCED ON BOTH SIDES (code review). The sort already tolerates a string
    // id (`a - b`); a strict `===` on `pipeline_fk` would not, and the failure is
    // SILENT — the filter empties, no step is paired, and the link degrades to
    // the epic fit with nothing anywhere saying why. Nothing in the gateway
    // promises these stay numbers (a future BIGINT serializes as a string), and
    // agreeing with the sort costs one call.
    let stepId = null;
    if (pipelineId != null) {
        const candidates = (stepsQ.data || [])
            .filter((s) => Number(s?.pipeline_fk) === Number(pipelineId)
                && Number.isInteger(Number(s.id)))
            .map((s) => Number(s.id))
            .sort((a, b) => a - b);
        if (candidates.length > 0) [stepId] = candidates;
    }

    const isLoading = stepLinksQ.isLoading || stepsQ.isLoading || pipelinesQ.isLoading;
    const isError = stepLinksQ.isError || stepsQ.isError || pipelinesQ.isError;

    // ── `isSettled` — "no step" vs "not answered yet" (code review MAJ-1) ────
    // A null `stepId` means two different things and the caller MUST be able to
    // tell them apart: the requirement page falls back to the epic link when no
    // step carries the requirement, and doing that while this chain is still in
    // flight renders — and lets the reader CLICK — the very epic fit req #3253
    // exists to remove. Reachable on the common path: navigating to a sibling
    // requirement re-renders rather than remounts, so the epic chain is a cache
    // hit and answers instantly while this one round-trips.
    //
    // DERIVED FROM `isPending`, NOT `isLoading`, and hop by hop. TanStack v5
    // defines `isLoading` as `isPending && isFetching`, and a query whose
    // `enabled` flipped true THIS render still reports `fetchStatus === 'idle'`
    // until its effect runs — so an `!isLoading` gate has a one-render hole in
    // the middle of the chain, which is exactly the window this exists to close.
    // Each hop is only awaited when the predicate that ENABLES it holds, so a
    // chain that runs dry (or errors — `isPending` goes false on `error` too)
    // settles rather than hanging, matching `isLoading`'s own contract above.
    const isSettled = !active ? true : !(
        stepLinksQ.isPending
        || (stepIds.length > 0 && stepsQ.isPending)
        || (pipelineIds.length > 0 && pipelinesQ.isPending)
    );

    return { pipelineId, stepId, isLoading, isError, isSettled };
}
