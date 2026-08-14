// THE requirement-visibility answer for every browse surface — req #3419,
// narrowed by req #3357, made whole by req #3502.
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
// ── AND ONE ANSWER, NOT ONE-AND-A-HALF (req #3502) ──────────────────────────
//
// req #3419 unified the five copies but left the aggregator card a SECOND rule
// underneath this one: `aggregatorRowVisible`'s unconditional launch exclusion,
// which dropped step-carried work from three of its five chips with no toggle.
// So the control still had two answers — measured on production, 18 `authoring`
// requirements that the Cards view, the Table view and the elevator showed on
// request while the aggregator would not. That exclusion is deleted; its
// rationale, and what replaced the protection it gave, are in
// `TaskPlanView/swarmStartCardUtils.js`'s header. Nothing on a browse surface
// filters by orchestration except this hook.
//
// ── WHY THE EPIC-FILED-BUT-UNSEATED POPULATION IS GONE (req #3357) ──────────
//
// req #3419 unioned in a second population — requirements epic-filed through
// the retired middle tier but not yet carried by any step — because the
// toggle otherwise still showed work that was plainly part of a plan. That
// tier leaving the frontend retires the ONLY mechanism that could produce
// that population (see `utils/pipelineMembership.js`'s
// header for the full reasoning), so this hook now reads ONE bounded list —
// the step-requirement junction — instead of three.
//
// ── THE FIRST-GENERATION JUNCTION IS GONE (req #3356) ───────────────────────
//
// The one list read is `pipeline_step_requirements` — the second generation's
// junction, renamed onto that name once the first generation's own table of
// the same name was dropped. A toggle still reading the pre-rename table would
// answer from a table that no longer exists — every requirement would read as
// unorchestrated and the control would silently do nothing.
//
// THE ROW SHAPE IS IDENTICAL (`step_fk`, `requirement_fk`), so
// `pipelinedRequirementIds` / `orchestratedRequirementIds` needed no
// adaptation: only the source table moved. What DID change underneath is the
// junction's primary key — it keys on `requirement_fk` ALONE (one step per
// requirement, the req #3336 stage-2 gate ruling), so the id set this hook
// derives can no longer contain a duplicate at all. Neither function ever
// relied on that, and both stay set-valued rather than being "simplified"
// into a lookup.

import { useCallback, useMemo } from 'react';

import { useAllPipelineStepRequirements } from './useDataQueries';
import { useShowClosedStore } from '../stores/useShowClosedStore';
import { effectiveHidePipelined } from '../utils/epicMembership';
import {
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
 * @param {boolean} [opts.stepFilterActive=false]  req #3503 — the STEP filter,
 *        and the identical override for a stronger version of the same reason: a
 *        step's requirements are on a step BY DEFINITION, so with the toggle left
 *        in charge a step-filtered page is empty ALWAYS, not merely usually. A
 *        separate flag rather than a caller OR-ing into `epicFilterActive`,
 *        because a parameter named for the epic filter silently answering for the
 *        step one is how the next reader mis-reads this hook.
 * @returns {{
 *   hideOrchestrated: boolean,
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
 * `orchestratedIds` is the set the toggle hides by, exported so a row that IS
 * on screen can be MARKED from it (the gold title box, req #3419). Marking and
 * hiding must never become two answers to one question.
 *
 * `isVisible` / `filterVisible` are the browse answer — a predicate and its
 * array form. `filterVisible` returns the SAME ARRAY REFERENCE when nothing is
 * dropped, so it is safe in a `useMemo`/`useEffect` dependency.
 *
 * req #3502 REMOVED a third member, `pipelinedIds` (STEP association alone).
 * Its only consumer was the aggregator's deleted launch exclusion, and the
 * narrow fact has no other reader on a browse surface — a browse surface asks
 * "is this on screen", and that is `isVisible`. The pure function still exists
 * (`utils/pipelineMembership.js`) for anything that genuinely needs step
 * association without the toggle.
 */
export function useRequirementVisibility(
    creatorFk, { epicFilterActive = false, stepFilterActive = false } = {}) {
    const storedHideOrchestrated = useShowClosedStore(s => s.hidePipelinedRequirements);
    // req #3503 — EITHER membership filter forces the toggle off, through the one
    // predicate. `effectiveHidePipelined`'s parameter keeps its epic name: it has
    // only ever asked "is a membership scope in force", and widening the CALL is
    // what keeps this override in the single place req #3419 put it rather than
    // spawning a second predicate that could disagree with the first.
    const hideOrchestrated = effectiveHidePipelined(
        storedHideOrchestrated, epicFilterActive || stepFilterActive);

    // Read unconditionally — hooks are not conditional, and gating this on the
    // toggle would mean the FIRST flip renders stale-empty for a round trip,
    // showing rows the user just asked to hide. req #3491 widened this to a
    // second, first-generation read while both eras ran side by side; req
    // #3356 retired that hook (`useAllPipeline2StepRequirements` no longer
    // exists in `useDataQueries.js`) along with the rest of the first
    // generation, so this is back to the one read it started as.
    const { data: stepRequirements } = useAllPipelineStepRequirements(creatorFk);

    // orchestratedRequirementIds(...) === pipelinedRequirementIds(...) today
    // (req #3357 retired the epic-filed union) — computed through the named
    // export anyway so a future widening has one place to happen.
    const orchestratedIds = useMemo(
        () => orchestratedRequirementIds(stepRequirements),
        [stepRequirements]);

    const isVisible = useCallback(
        (row) => !hideOrchestrated || !orchestratedIds.has(Number(row?.id)),
        [hideOrchestrated, orchestratedIds]);

    const filterVisible = useCallback(
        (rows) => excludeByIds(rows, orchestratedIds, hideOrchestrated),
        [orchestratedIds, hideOrchestrated]);

    // REFERENTIALLY STABLE, AND THAT IS LOAD-BEARING. Callers read individual
    // members into `useMemo` dependency arrays (`SwarmStartCard`'s
    // `eligibleRequirements`/`eligibleMetRequirements`/`baseStatusCounts`,
    // `CategoryCard`'s seeding effect), and those memos feed a `useEffect` that
    // calls `setState`. A fresh identity per render therefore does not merely
    // recompute: it re-seeds local state, re-renders, and loops SYNCHRONOUSLY —
    // which pins the event loop, so it does not fail a test, it WEDGES the
    // process (no per-test timeout can interrupt it; measured at 600s+).
    //
    // Guarded by `requirementVisibility.harness.test.jsx` § referential
    // stability, which fails in milliseconds instead. Do not inline any of these
    // into a bare arrow.
    //
    // (This comment used to name `aggregatorRowVisible` as the memoized factory
    // callers passed the whole object to. req #3502 deleted that function; the
    // requirement it describes is unchanged.)
    return useMemo(
        () => ({ hideOrchestrated, orchestratedIds, isVisible, filterVisible }),
        [hideOrchestrated, orchestratedIds, isVisible, filterVisible]);
}

export default useRequirementVisibility;
