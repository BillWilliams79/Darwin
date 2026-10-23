// stepsModel.js — the pure row model behind /swarm/steps (req #3393).
//
// PURE: plain rows in, plain rows out. No React, no MUI, no hooks, no clock —
// same shape as `Darwin/src/Steps/stepsModel.js`, whose functions this ports a
// SUBSET of rather than importing (see pipelinesViewModel.js's header for why
// this file stays a structural copy rather than an import).
//
// ## Why there is no state engine here
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
// states the actual predicate a step's link split needs —
//
//   "A step has no state column... The one case that carries a stamp of its
//   own is a step with no requirement that speaks for its progress — either
//   none at all, or only ones that stand for a whole programme."
//
// — which means GATING is a function of whether any non-container requirement
// is LINKED at all, never of its live status. That split is all this module
// computes; the grid uses it to mark tracking containers in the Reqs tooltip.
// It renders no step state at all (req #3750 removed the State column) — step
// state is the plan visualizer's to show.

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
 * The GATING subset of a link set, in one place. Used by `buildStepRows`
 * for the grid's gating/tracking split.
 *
 * TRACKING CONTAINERS ARE EXEMPT (req #3123): a container is not work and
 * never gates a step. An UNRESOLVED id — one the requirements read did not
 * return — gates, because `isTrackingRequirement2(undefined)` is false.
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
 * Every step, decorated for the editor grid with its plan labels, its
 * gating/tracking split and its delete-blocker preview. Pure CPU over rows already fetched — no
 * per-step derivation, no gateway read of its own.
 *
 * @param {Object} args
 * @param {Object[]} args.steps               pipeline_steps rows
 * @param {Object[]} args.stepRequirements    pipeline_step_requirements rows
 * @param {Object[]} args.stepDeps            pipeline_step_deps rows
 * @param {Object[]} args.requirements        any superset (needs `id`, `tracking`)
 * @param {Object[]} args.initiatives               initiatives rows (for the label/pipeline_fk dictionary)
 * @param {Object[]} [args.pipelines]         pipelines rows (`id`, `title`, `locked`)
 * @returns {Object[]}
 */
export function buildStepRows({
    steps, stepRequirements, stepDeps, requirements, initiatives, pipelines,
} = {}) {
    const initiativeById = new Map(asArray(initiatives).map((e) => [e.id, e]));
    const pipelineById = new Map(asArray(pipelines).map((p) => [p.id, p]));
    const pipelineLocked = new Set(asArray(pipelines)
        .filter((p) => p && Number(p.locked)).map((p) => p.id));

    const linksByStep = new Map();
    for (const link of asArray(stepRequirements)) {
        if (!link) continue;
        if (!linksByStep.has(link.step_fk)) linksByStep.set(link.step_fk, []);
        linksByStep.get(link.step_fk).push(link.requirement_fk);
    }

    return asArray(steps).filter(Boolean).map((step) => {
        const initiative = initiativeById.get(step.initiative_fk) || null;
        const pipeline = initiative ? (pipelineById.get(initiative.pipeline_fk) || null) : null;
        const reqIds = (linksByStep.get(step.id) || []).slice().sort((a, b) => a - b);
        const gatingReqIds = gatingRequirementIds2(reqIds, requirements);
        const gatingSet = new Set(gatingReqIds);
        const trackingReqIds = reqIds.filter((rid) => !gatingSet.has(rid));
        return {
            ...step,
            initiativeTitle: initiative ? initiative.title : null,
            pipelineFk: initiative ? initiative.pipeline_fk : null,
            pipelineTitle: pipeline ? pipeline.title : null,
            // req #3742 — the OUTERMOST lock holding this step (the level that
            // must be lifted first, as the gateway's `plan_lock.py` names it),
            // or null. The plan canvas draws any of the three as a red frame,
            // so the editor that frame's click opens must know an ancestor's
            // lock too, not only the step's own flag.
            lockedBy: (initiative && pipelineLocked.has(initiative.pipeline_fk)) ? 'pipeline'
                : (initiative && Number(initiative.locked)) ? 'initiative'
                    : Number(step.locked) ? 'step' : null,
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
