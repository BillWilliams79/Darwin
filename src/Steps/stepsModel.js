// stepsModel.js — the pure completion-guard model behind /swarm/steps (req #3393).
//
// PURE: plain rows in, plain rows out. No React, no MUI, no hooks, no clock —
// same shape as `Darwin/src/Steps/stepsModel.js`, whose functions this ports a
// SUBSET of rather than importing (see pipelinesViewModel.js's header for why
// this file stays a structural copy rather than an import).
//
// ## Why this is a guard, not a state engine
//
// 1.0's `stepsModel.js` deliberately runs the REAL derivation engine
// (`pipelineModel.js`'s `buildPlanRows`) rather than re-deriving step state a
// second time, because Darwin already has exactly two implementations of that
// derivation on purpose (the browser's and the daemon's, kept honest by a
// shared conformance corpus) and a third would be a third thing to keep in
// step.
//
// Pipeline 2.0 moved its real derivation server-side
// (`Lambda-Rest/pipeline_compose.py` / `pipeline2_derive.py`, req #3367) —
// but that repo is not checked out in this session, so its exact algorithm
// cannot be read and verified here. Writing a THIRD, unverified JS port of it
// against a guess would be exactly the failure mode design rule 13 ("nothing
// stated twice — one implementation per rule") exists to prevent.
//
// What this module ports instead is narrower and does not need that engine at
// all: the design-intent doctrine (memory/pipeline-2-plan-layer-intent.md)
// states the actual predicate the completion guard needs —
//
//   "A step has no state column... The one case that carries a stamp of its
//   own is a step with no requirement that speaks for its progress — either
//   none at all, or only ones that stand for a whole programme."
//
// — which means GATING is a function of whether any non-container requirement
// is LINKED at all, never of its live status. That is a join over two small
// junction/dictionary reads, not a derivation, and it is the identical
// predicate 1.0's `gatingRequirementIds`/`completionGuard` implement (minus
// the epic/feature/batch machinery 2.0's containment removed). `StepsPage`
// therefore renders `completed_at` as a two-state Open/Complete chip rather
// than 1.0's three-state Pending/Running/Done — see PLAN.md for the full
// scoping rationale. Full three-state rendering is the 2.0 visualizer's job,
// once it exists and can share one real implementation with the composed
// route.

const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * Whether a requirement row carries the req #3123 CONTAINER flag. Byte-for-
 * byte the same predicate as `pipelineModel.js`'s `isTrackingRequirement` —
 * copied rather than imported (see this module's header).
 *
 * @param {Object} req
 * @returns {boolean}
 */
export function isTrackingRequirement2(req) {
    const value = req == null ? null : req.tracking;
    if (value === null || value === undefined || value === '') return false;
    if (typeof value === 'boolean') return value;
    const n = Number(value);
    return Number.isFinite(n) ? n !== 0 : false;
}

/**
 * The GATING subset of a link set — the guard's input, in one place. Used by
 * `buildStepRows` for the grid and by the page's LIVE re-read before a
 * stamp, so the displayed guard and the enforced guard cannot be two
 * different rules.
 *
 * TRACKING CONTAINERS ARE EXEMPT (req #3123): a container is not work and
 * never gates a step. An UNRESOLVED id — one the requirements read did not
 * return — gates, because `isTrackingRequirement2(undefined)` is false and
 * refusing a stamp is the recoverable direction.
 *
 * @param {number[]} reqIds
 * @param {Object[]} requirements  any superset
 * @returns {number[]}
 */
export function gatingRequirementIds2(reqIds, requirements) {
    const byId = new Map(asArray(requirements).map((r) => [r.id, r]));
    return asArray(reqIds).filter((rid) => !isTrackingRequirement2(byId.get(rid)));
}

/**
 * Whether `completed_at` may be stamped on this row.
 *
 * THIS FUNCTION IS THE FAST PATH, NOT THE ENFORCEMENT — it answers from
 * whatever link set the caller's row was built from, which is a ≤30s cache.
 * What actually decides is StepsPage's `completeFlow`, which re-reads the
 * step's links live before any stamp and calls this again on the result.
 *
 * @param {Object} row  a step editor row carrying `gatingReqIds`/`trackingReqIds`/`completedAt`
 * @returns {{allowed: boolean, reason: string}}
 */
export function completionGuard2(row) {
    const gating = asArray(row && row.gatingReqIds);
    if (!gating.length) {
        return {
            allowed: true,
            reason: row && row.completedAt
                ? 'Complete — click to reopen this step'
                : 'Open — click to mark this step complete',
        };
    }
    const tracking = asArray(row.trackingReqIds);
    const one = tracking.length === 1;
    const exempt = tracking.length
        ? ` (${tracking.length} tracking container${one ? '' : 's'} `
          + `${tracking.join(', ')} ${one ? 'is' : 'are'} exempt and `
          + `${one ? 'was' : 'were'} not counted)`
        : '';
    return {
        allowed: false,
        reason: `Derived from ${gating.length} gating requirement`
            + `${gating.length === 1 ? '' : 's'} ${gating.join(', ')}${exempt} — `
            + 'close or unlink them to control this step by hand.',
    };
}

/**
 * The steps whose dependency row references `stepId` — a PREVIEW of the
 * database's ON DELETE RESTRICT answer, not the enforcement (see
 * `stepsApi.js`'s `deleteStep`). No `time_at` branch to skip: 2.0's
 * `pipeline_step_deps` carries no wall-clock rows — the one time gate lives
 * on the step itself (`not_before`).
 *
 * @param {number} stepId
 * @param {Object[]} stepDeps  pipeline_step_deps rows
 * @returns {number[]}
 */
export function dropBlockers2(stepId, stepDeps) {
    const blockers = new Set();
    for (const dep of asArray(stepDeps)) {
        if (!dep) continue;
        if (dep.dep_step_fk == null || dep.dep_step_fk !== stepId) continue;
        blockers.add(dep.step_fk);
    }
    return [...blockers].sort((a, b) => a - b);
}

/**
 * Every step, decorated for the editor grid with its gating/tracking split
 * and its delete-blocker preview. Pure CPU over rows already fetched — no
 * per-step derivation, no gateway read of its own.
 *
 * @param {Object} args
 * @param {Object[]} args.steps               pipeline_steps rows
 * @param {Object[]} args.stepRequirements    pipeline_step_requirements rows
 * @param {Object[]} args.stepDeps            pipeline_step_deps rows
 * @param {Object[]} args.requirements        any superset (needs `id`, `tracking`)
 * @param {Object[]} args.epics               epics rows (for the label/pipeline_fk dictionary)
 * @returns {Object[]}
 */
export function buildStepRows({ steps, stepRequirements, stepDeps, requirements, epics } = {}) {
    const epicById = new Map(asArray(epics).map((e) => [e.id, e]));

    const linksByStep = new Map();
    for (const link of asArray(stepRequirements)) {
        if (!link) continue;
        if (!linksByStep.has(link.step_fk)) linksByStep.set(link.step_fk, []);
        linksByStep.get(link.step_fk).push(link.requirement_fk);
    }

    return asArray(steps).filter(Boolean).map((step) => {
        const epic = epicById.get(step.epic_fk) || null;
        const reqIds = (linksByStep.get(step.id) || []).slice().sort((a, b) => a - b);
        const gatingReqIds = gatingRequirementIds2(reqIds, requirements);
        const gatingSet = new Set(gatingReqIds);
        const trackingReqIds = reqIds.filter((rid) => !gatingSet.has(rid));
        return {
            ...step,
            epicTitle: epic ? epic.title : null,
            pipelineFk: epic ? epic.pipeline_fk : null,
            completedAt: step.completed_at || null,
            reqIds,
            gatingReqIds,
            trackingReqIds,
            blockerStepIds: dropBlockers2(step.id, stepDeps),
            depIds: asArray(stepDeps)
                .filter((d) => d && d.step_fk === step.id && d.dep_step_fk != null)
                .map((d) => d.dep_step_fk)
                .sort((a, b) => a - b),
        };
    });
}
