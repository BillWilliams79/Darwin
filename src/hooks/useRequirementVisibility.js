// THE requirement-visibility answer for every browse surface — req #3419.
//
// ── WHY THIS HOOK EXISTS (You Only Need One) ────────────────────────────────
//
// "Should this requirement be on screen given the orchestrated toggle?" was
// written FIVE times, once per surface, each re-reading the store and
// re-deriving the id set:
//
//   1. SwarmView/CategoryCard.jsx        `if (hidePipelined) rows.filter(...)`
//   2. SwarmView/RequirementsTableView   `notPipelined = r => !hide || !ids.has(...)`
//   3. TaskPlanView/SwarmStartCard.jsx   `excludePipelined(rows, ids, offers || hide)` x2
//   4. TaskPlanView/swarmStartCardUtils  inline `ids.has(Number(r.id))` in the tally
//   5. SwarmView/detail/requirementSort  `excludePipelined(rows, ids, hide)`
//
// Five copies means a fix is five edits and a miss is invisible, which is
// exactly how req #3419 became the SECOND requirement filed for one defect.
// There is now one hook: every surface asks it, nobody re-derives it, and a
// change to the rule is one edit that every surface inherits.
//
// ── WHY THE SETS ARE BUILT FROM WHOLE-TABLE READS, NOT FROM THE LIST'S ROWS ──
//
// Epic association needs `feature_fk` on the requirement. The per-surface
// projections DISAGREE about carrying it — `useRequirements` does,
// `useRequirementsByStatus`, `useRequirementsDone` and the detail page's sibling
// fetch do not — so a predicate reading `r.feature_fk` would answer correctly on
// one card and silently answer "not orchestrated" on the others. Deriving the id
// SET from its own bounded reads makes the predicate `ids.has(r.id)`, which every
// projection can satisfy, and removes the whole class of drift.
//
// COST, MEASURED — and these reads are COLD, not warm. An earlier version of
// this comment claimed they were already on the page; they are not:
//
//   * `useAllRequirements` keys on `{fields}` (useDataQueries.js), and this
//     hook's `id,feature_fk` matches no existing caller — the table asks for
//     `id,title,requirement_status,…`, the aggregator for `id,requirement_status`.
//     Three distinct cache entries, three distinct whole-table reads.
//   * the junction is read only by the PLAN pages (PipelineDetail, PipelinesPage,
//     StepsPage), not by `/swarm` or `/taskcards`.
//   * `useAllFeatures` with `{fields:'id,epic_fk', closed:'all'}` is a fourth
//     distinct key.
//
// Net: +2 whole-table reads on the `/swarm` cards, the `/swarm` table and
// `/taskcards`; +3 on `/swarm/requirement/:id`, which previously gated its one
// junction read on the toggle. All three are 2-column bounded lists and
// TanStack dedupes them across the N mounted `CategoryCard`s, so this is a
// handful of small requests and NOT a fan-out — req #3080 design rule 5 holds
// (no per-requirement fetch, and the request count does not grow with the
// number of requirements or cards). Stated plainly here so nobody has to
// re-measure it to know what the hook costs.

import { useCallback, useMemo } from 'react';

import {
    useAllPipelineStepRequirements,
    useAllRequirements,
    useAllFeatures,
    ALL_ROWS,
} from './useDataQueries';
import { useShowClosedStore } from '../stores/useShowClosedStore';
import {
    pipelinedRequirementIds,
    epicRequirementIds,
    excludeByIds,
} from '../utils/pipelineMembership';

// Whole-table projections, narrow on purpose. `fields` is in every one of these
// cache keys, so these slices never collide with a caller asking for more.
const REQUIREMENT_FIELDS = 'id,feature_fk';
const FEATURE_FIELDS = 'id,epic_fk';

/**
 * @param {string} creatorFk  the profile userName; falsy disables every read.
 * @returns {{
 *   hideOrchestrated: boolean,
 *   pipelinedIds: Set<number>,
 *   orchestratedIds: Set<number>,
 *   isVisible: (row: {id: number|string}) => boolean,
 *   filterVisible: (rows: Array) => Array,
 * }}
 *
 * `hideOrchestrated` is the persisted user control
 * (`useShowClosedStore.hidePipelinedRequirements` — the store key keeps its
 * req #3180 name so no persistence migration is needed; its MEANING is this
 * hook's, and every reader goes through here).
 *
 * `pipelinedIds` is STEP association only. It is exported for the one caller
 * that needs the narrow fact — the aggregator card's UNCONDITIONAL launch
 * exclusion (req #3180) — and must not be used to answer "is this on screen".
 *
 * `isVisible` / `filterVisible` are the browse answer. `filterVisible` returns
 * the SAME ARRAY REFERENCE when nothing is dropped, so it is safe in a
 * `useMemo`/`useEffect` dependency.
 */
export function useRequirementVisibility(creatorFk) {
    const hideOrchestrated = useShowClosedStore(s => s.hidePipelinedRequirements);

    // Read unconditionally — hooks are not conditional, and gating these on the
    // toggle would mean the FIRST flip renders stale-empty for a round trip,
    // showing rows the user just asked to hide. All three are cached lists.
    const { data: stepRequirements } = useAllPipelineStepRequirements(creatorFk);
    const { data: requirementFeatureRows } = useAllRequirements(creatorFk, {
        fields: REQUIREMENT_FIELDS,
    });
    const { data: features } = useAllFeatures(creatorFk, {
        fields: FEATURE_FIELDS,
        // A CLOSED feature still seats its requirements under its epic — see
        // `epicRequirementIds`. `closed: 0` (the hook default) would
        // un-orchestrate everything under a finished feature.
        closed: ALL_ROWS,
    });

    const pipelinedIds = useMemo(
        () => pipelinedRequirementIds(stepRequirements),
        [stepRequirements]);

    const epicIds = useMemo(
        () => epicRequirementIds(requirementFeatureRows, features),
        [requirementFeatureRows, features]);

    // The union, built here rather than by `orchestratedRequirementIds` so the
    // two halves keep their own memo and a junction refetch does not re-walk the
    // requirement/feature join (and vice versa). Same rule, same result — the
    // harness asserts it against the pure function.
    const orchestratedIds = useMemo(() => {
        if (epicIds.size === 0) return pipelinedIds;
        const ids = new Set(pipelinedIds);
        for (const id of epicIds) ids.add(id);
        return ids;
    }, [pipelinedIds, epicIds]);

    const isVisible = useCallback(
        (row) => !hideOrchestrated || !orchestratedIds.has(Number(row?.id)),
        [hideOrchestrated, orchestratedIds]);

    const filterVisible = useCallback(
        (rows) => excludeByIds(rows, orchestratedIds, hideOrchestrated),
        [orchestratedIds, hideOrchestrated]);

    // REFERENTIALLY STABLE. Callers pass the whole object to memoized predicate
    // factories (`aggregatorRowVisible`); a fresh object literal each render
    // would make every one of those recompute, mint a new array, and re-seed the
    // local state a `useEffect` holds — a render loop, not merely waste.
    return useMemo(
        () => ({ hideOrchestrated, pipelinedIds, orchestratedIds, isVisible, filterVisible }),
        [hideOrchestrated, pipelinedIds, orchestratedIds, isVisible, filterVisible]);
}

export default useRequirementVisibility;
