// THE requirement-visibility answer for every browse surface — req #3419,
// narrowed by req #3357.
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
// ── WHY THE EPIC-FILED-BUT-UNSEATED POPULATION IS GONE (req #3357) ──────────
//
// req #3419 unioned in a second population — requirements epic-filed via
// `requirements.feature_fk -> features.epic_fk` but not yet carried by any
// step — because the toggle otherwise still showed work that was plainly
// part of a plan. Feature leaving the frontend retires the ONLY mechanism
// that could produce that population (see `utils/pipelineMembership.js`'s
// header for the full reasoning), so this hook now reads ONE bounded list —
// the step-requirement junction — instead of three.
//
// ── THE JUNCTION IS PIPELINE 2.0's NOW (req #3356) ──────────────────────────
//
// The one list read is `pipeline_step_requirements`, not the 1.0
// `pipeline_step_requirements` this hook was built against. Pipeline 1.0 is
// being eradicated, and a toggle still reading its junction would answer from a
// table nothing writes any more — every requirement would read as unorchestrated
// and the control would silently do nothing.
//
// THE ROW SHAPE IS IDENTICAL (`step_fk`, `requirement_fk`), so
// `pipelinedRequirementIds` / `orchestratedRequirementIds` need no adaptation:
// only the source table moved. What DID change underneath is the junction's
// primary key — 2.0 keys on `requirement_fk` ALONE (one step per requirement,
// the req #3336 stage-2 gate ruling), so the id set this hook derives can no
// longer contain a duplicate at all. Neither function ever relied on that, and
// both stay set-valued rather than being "simplified" into a lookup.

import { useCallback, useMemo } from 'react';

import { useAllPipelineStepRequirements } from './useDataQueries';
import { useShowClosedStore } from '../stores/useShowClosedStore';
import { effectiveHidePipelined } from '../utils/epicMembership';
import {
    pipelinedRequirementIds,
    orchestratedRequirementIds,
    excludeByIds,
} from '../utils/pipelineMembership';

/**
 * @param {string} creatorFk  the profile userName; falsy disables every read.
 * @param {object} [opts]
 * @param {boolean} [opts.epicFilterActive=false]  req #3428 — an epic filter
 *        FORCES the orchestrated toggle off, because an epic's requirements are
 *        seated in pipeline steps by construction and the toggle defaults ON
 *        (req #3242), so an epic page would otherwise arrive empty. Applied
 *        HERE, through `effectiveHidePipelined`, rather than by each caller:
 *        req #3428 introduced that predicate to stop the header control and the
 *        row filter disagreeing, and req #3419 exists to stop the row filter
 *        being written five times — so the override belongs in the one place
 *        that answers the question. The store is never WRITTEN: dismissing the
 *        epic pill restores exactly the toggle state the reader had.
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
export function useRequirementVisibility(creatorFk, { epicFilterActive = false } = {}) {
    const storedHideOrchestrated = useShowClosedStore(s => s.hidePipelinedRequirements);
    const hideOrchestrated = effectiveHidePipelined(storedHideOrchestrated, epicFilterActive);

    // Read unconditionally — hooks are not conditional, and gating this on the
    // toggle would mean the FIRST flip renders stale-empty for a round trip,
    // showing rows the user just asked to hide.
    const { data: stepRequirements } = useAllPipelineStepRequirements(creatorFk);

    const pipelinedIds = useMemo(
        () => pipelinedRequirementIds(stepRequirements),
        [stepRequirements]);

    // orchestratedRequirementIds(stepRequirements) === pipelinedRequirementIds
    // today (req #3357 retired the epic-filed union) — computed through the
    // named export anyway so a future widening has one place to happen.
    const orchestratedIds = useMemo(
        () => orchestratedRequirementIds(stepRequirements),
        [stepRequirements]);

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
