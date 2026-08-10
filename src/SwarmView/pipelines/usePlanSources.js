// usePlanSources.js — the plan page's TWO fetch heads, one per era (req #3463).
//
// ── WHAT THIS FILE IS ──────────────────────────────────────────────────────
// `PipelineDetail.jsx` renders one plan. Everything below its header — the
// table, the visualizer, the toolbar, the deep-link handshakes — consumes four
// values and nothing else:
//
//     { pipeline, model, plan, diagnostic }
//
// How those four are OBTAINED is entirely different in the two eras, and that
// difference is the whole of this file. The page picks a head by its own era
// and is otherwise era-blind.
//
//   1.0  SEVEN bounded list reads (pipelines, steps, step requirements, step
//        deps, requirements, features, epics) joined and derived in the browser
//        by `buildPipelineModel` + `orderedPlan`.
//   2.0  ONE composed read (`pipeline2_compose`, req #3367) — the join AND the
//        derivation both already ran server-side — reshaped by
//        `pipeline2Adapter.js`.
//
// ── WHY BOTH HOOKS RUN ON EVERY RENDER ─────────────────────────────────────
// React's rules of hooks forbid calling one head or the other conditionally, so
// both are called every time and the INACTIVE one is disabled at the query
// layer (`enabled: false`). A disabled TanStack query issues no request and
// holds no data — the cost of the head that is not in use is a few object
// allocations, not a fetch. This is deliberately not solved by mounting two
// components: the whole page below the fetch is shared, and duplicating it to
// avoid an `enabled` flag would reintroduce the 1100-line copy this design
// exists to avoid.
//
// ── WHY 1.0's HEAD IS A MOVE AND NOT A REWRITE ─────────────────────────────
// req #3381 replaced the 1.0 head with the 2.0 one and took production down
// (req #3462). 1.0 still runs on the seven reads, so they are lifted HERE
// verbatim — same hooks, same options, same `isLoading` conjunction, same
// `dictionaryError` disjunction, same memo dependencies. Reading this against
// the pre-#3381 `PipelineDetail.jsx` should show a relocation and no change of
// behaviour, which is the property the manual UI review checks.

import { useMemo } from 'react';

import {
    ALL_ROWS,
    useAllEpics,
    useAllFeatures,
    useAllPipelineStepDeps,
    useAllPipelineStepRequirements,
    useAllPipelineSteps,
    useAllPipelines,
    useAllPipeline2Pipelines,
    useAllRequirements,
    useComposedPipeline2,
} from '../../hooks/useDataQueries';
import {
    PLAN_REQUIREMENT_FIELDS,
    buildPipelineModel,
    orderedPlan,
} from './pipelineViewModel';
import {
    adaptComposedPipeline2,
    buildPlan2Model,
    deriveDiagnostic,
} from './pipeline2Adapter';
import { PLAN_ERA_1, PLAN_ERA_2 } from './planEra';

// A SHARED frozen empty array, for the same reason `PipelineDetail.jsx` keeps
// one: a `= []` default literal mints a NEW array on every render, which is a
// new dependency identity for every memo downstream of it.
const EMPTY = Object.freeze([]);

/**
 * Pipeline 1.0's fetch head — seven reads, joined and derived in the browser.
 *
 * @param {?number} pipelineId
 * @param {?string} creatorFk
 * @param {{enabled?: boolean, machines?: Array, costIndex?: Object}} options
 * @returns {{pipeline: ?Object, model: ?Object, plan: ?Object,
 *            diagnostic: null, isLoading: boolean, dictionaryError: boolean,
 *            knownIds: ?Array<number>}}
 */
export function usePlan1Sources(pipelineId, creatorFk,
    { enabled = true, machines = EMPTY, costIndex } = {}) {
    // The list read, not a by-id read: /swarm/pipelines has already primed this
    // exact cache entry, so arriving here costs nothing. A by-id hook would be a
    // second cache entry and a guaranteed fetch on every navigation.
    const { data: pipelines = EMPTY, isLoading: pipelinesLoading,
        isSuccess: pipelinesSettled } = useAllPipelines(creatorFk, { enabled });
    const { data: steps = EMPTY, isLoading: stepsLoading } =
        useAllPipelineSteps(creatorFk, { enabled });
    const { data: stepRequirements = EMPTY, isLoading: linksLoading } =
        useAllPipelineStepRequirements(creatorFk, { enabled });
    const { data: stepDeps = EMPTY, isLoading: depsLoading } =
        useAllPipelineStepDeps(creatorFk, { enabled });
    const { data: requirements = EMPTY, isLoading: reqsLoading } =
        useAllRequirements(creatorFk, { fields: PLAN_REQUIREMENT_FIELDS, enabled });
    // Labels are a DICTIONARY here, not a catalog: closed epics/features must
    // still resolve or the plan blanks a column it has data for.
    const { data: features = EMPTY, isLoading: featuresLoading, isError: featuresError } =
        useAllFeatures(creatorFk, { closed: ALL_ROWS, enabled });
    const { data: epics = EMPTY, isLoading: epicsLoading, isError: epicsError } =
        useAllEpics(creatorFk, { enabled });

    // EVERY read gates the render, the three label dictionaries included. They are
    // not decoration: `displayOrder()` breaks ties on epic first-appearance order,
    // so rendering before features/epics resolve produces a DIFFERENT, silently
    // wrong row order — and one that verifyOrder() accepts, because a plan with no
    // epics violates no invariant. The one failure mode design rule 3's self-check
    // cannot catch is the one where the inputs, not the algorithm, are wrong.
    const isLoading = enabled && (pipelinesLoading || stepsLoading || linksLoading
        || depsLoading || reqsLoading || featuresLoading || epicsLoading);

    // Same argument, one step further: `fetchEntity` turns a 404 into `[]` and a
    // 5xx leaves `data` undefined, so a FAILED dictionary read is indistinguishable
    // from an empty one and would ship that wrong order permanently, with blank
    // Epic/Feature columns and numeric machine ids as its only symptoms. Say so.
    const dictionaryError = enabled && (featuresError || epicsError);

    const pipeline = useMemo(
        () => (enabled ? (pipelines.find((p) => p.id === pipelineId) || null) : null),
        [enabled, pipelines, pipelineId]);

    const model = useMemo(
        () => (enabled ? buildPipelineModel({
            pipeline, steps, stepRequirements, stepDeps, requirements, features, epics, machines,
        }) : null),
        [enabled, pipeline, steps, stepRequirements, stepDeps, requirements,
            features, epics, machines]);

    // `now` is read ONCE per model change and handed to the engine, which never
    // reads a clock itself. Time-gate eligibility therefore re-evaluates when the
    // data does — on focus, on invalidation — rather than on a timer.
    const plan = useMemo(
        () => (enabled && model ? orderedPlan(model, { now: new Date(), costIndex }) : null),
        [enabled, model, costIndex]);

    // req #3463 Guard B — WHICH IDS THIS ERA ACTUALLY HOLDS. The not-found alert
    // reports them, so "id 79 is not one of {2, 79, 80}" and "this table is
    // EMPTY" stop being the same sentence. Free here: it is the list read the
    // page already made.
    //
    // GATED ON `isSuccess`, NOT ON THE ARRAY (code review). `fetchEntity` leaves
    // `data` undefined on a 5xx and the `= EMPTY` default turns that into `[]`,
    // so a FAILED read and an EMPTY table are the same value — and reporting the
    // first as the second is precisely the conflation this guard exists to kill,
    // reproduced inside the guard itself. `null` means "the id list did not
    // resolve", which the alert says in as many words rather than claiming
    // anything about the data.
    const knownIds = useMemo(
        () => (enabled && pipelinesSettled ? pipelines.map((p) => p.id) : null),
        [enabled, pipelinesSettled, pipelines]);

    return {
        pipeline,
        model,
        plan,
        // 1.0 derives in the browser and cannot be handed a withheld derivation,
        // so there is never a diagnostic here. Stated rather than omitted: the
        // page's `canRender` gate reads this field for both eras.
        diagnostic: null,
        isLoading,
        dictionaryError,
        knownIds,
    };
}

/**
 * Pipeline 2.0's fetch head — ONE composed read, reshaped.
 *
 * @param {?number} pipelineId
 * @param {?string} creatorFk
 * @param {{enabled?: boolean, machines?: Array, costIndex?: Object}} options
 * @returns {{pipeline: ?Object, model: ?Object, plan: ?Object,
 *            diagnostic: ?Object, isLoading: boolean, dictionaryError: boolean,
 *            knownIds: ?Array<number>}}
 */
export function usePlan2Sources(pipelineId, creatorFk,
    { enabled = true, machines = EMPTY, costIndex } = {}) {
    const { data: composed, isLoading: composedLoading } =
        useComposedPipeline2(pipelineId, { enabled });

    // req #3463 Guard B — the 2.0 plan INDEX, and it is fetched ONLY on the
    // miss path. This is the read that would have made req #3462 visible during
    // its own verification: #3381's dev server hit the composed route 80 times
    // against an EMPTY `darwin_dev.pipeline2_pipelines` and every 404 rendered
    // as a tidy "No pipeline with id 79", indistinguishable from a plan that had
    // simply been deleted. With this, an empty table says so in as many words.
    //
    // `composed === null` is precisely the 404 (`useComposedPipeline2` maps it);
    // `undefined` is still loading and must not fire a second request.
    //
    // AND IT IS GATED ON `isSuccess` (code review), for the reason the alert
    // itself gives: while this read is in flight `data` is undefined, the
    // `= EMPTY` default makes it `[]`, and `[]` is the value that renders "this
    // table holds NO plans at all". That sentence would then appear on EVERY
    // 2.0 miss for the length of one round trip, and permanently if the read
    // 5xxes — a confident false claim about the data, which is worse than the
    // uninformative message this whole guard replaced.
    const missed = enabled && composed === null;
    const { data: known = EMPTY, isSuccess: knownSettled } =
        useAllPipeline2Pipelines(creatorFk, { enabled: missed });

    const isLoading = enabled && composedLoading;

    // req #3381 item 3 — A WITHHELD OR DEGRADED `derived` BLOCK IS A HARD STOP,
    // NOT AN EMPTY RENDER. `null` (nothing withheld) means proceed; any other
    // value is one of the four regimes (`derivation_failed` /
    // `budget_derived_only` / `budget_rows_truncated` / wholly absent) and the
    // page renders it as a diagnostic INSTEAD OF attempting a partial draw from
    // rows with no derived state.
    const diagnostic = useMemo(
        () => (enabled && composed ? deriveDiagnostic(composed) : null),
        [enabled, composed]);

    const pipeline = enabled ? (composed?.pipeline ?? null) : null;
    const canBuild = !!pipeline && !diagnostic;

    const model = useMemo(
        () => (canBuild ? buildPlan2Model(composed, machines) : null),
        [canBuild, composed, machines]);

    const plan = useMemo(
        () => (canBuild ? adaptComposedPipeline2(composed, { machines, costIndex }) : null),
        [canBuild, composed, machines, costIndex]);

    const knownIds = useMemo(
        () => (missed && knownSettled ? known.map((p) => p.id) : null),
        [missed, knownSettled, known]);

    return {
        pipeline,
        model,
        plan,
        diagnostic,
        isLoading,
        // 2.0's composed payload carries its own epic/feature labels, so the
        // dictionary failure 1.0 reports cannot happen here. The page's
        // `machines` read is separate and is reported by the page itself.
        dictionaryError: false,
        knownIds,
    };
}

/**
 * The head for `era`.
 *
 * BOTH hooks are called unconditionally — see the header. The one that is not
 * this page's era runs disabled and returns nulls.
 *
 * @param {number} era
 * @param {?number} pipelineId
 * @param {?string} creatorFk
 * @param {{machines?: Array, costIndex?: Object}} options
 */
export function usePlanSources(era, pipelineId, creatorFk, options = {}) {
    const one = usePlan1Sources(pipelineId, creatorFk,
        { ...options, enabled: era === PLAN_ERA_1 });
    const two = usePlan2Sources(pipelineId, creatorFk,
        { ...options, enabled: era === PLAN_ERA_2 });
    return era === PLAN_ERA_2 ? two : one;
}
