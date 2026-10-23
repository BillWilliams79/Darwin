// epicsModel.js — the pure row model behind /swarm/epics (req #3393).
//
// PURE: plain rows in, plain rows out. No React, no MUI, no hooks, no clock —
// same shape as `Darwin/src/Epics/epicsModel.js`, whose functions this ports a
// SUBSET of rather than importing (see pipelinesViewModel.js's header for why
// this file stays a structural copy rather than an import).
//
// ## Why there is no state engine here
//
// 1.0's `epicsModel.js` deliberately runs the REAL derivation engine
// (`pipelineModel.js`'s `buildPlanRows`) rather than re-deriving epic state a
// second time, because Darwin already has exactly two implementations of that
// derivation on purpose (the browser's and the daemon's, kept honest by a
// shared conformance corpus) and a third would be a third thing to keep in
// epic.
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
// states the actual predicate an epic's link split needs —
//
//   "An epic has no state column... The one case that carries a stamp of its
//   own is an epic with no requirement that speaks for its progress — either
//   none at all, or only ones that stand for a whole programme."
//
// — which means GATING is a function of whether any non-container requirement
// is LINKED at all, never of its live status. That split is all this module
// computes; the grid uses it to mark tracking containers in the Reqs tooltip.
// It renders no epic state at all (req #3750 removed the State column) — epic
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
 * The GATING subset of a link set, in one place. Used by `buildEpicRows`
 * for the grid's gating/tracking split.
 *
 * TRACKING CONTAINERS ARE EXEMPT (req #3123): a container is not work and
 * never gates an epic. An UNRESOLVED id — one the requirements read did not
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
 * The epics whose dependency row references `epicId` — a PREVIEW of the
 * database's ON DELETE RESTRICT answer, not the enforcement (see
 * `epicsApi.js`'s `deleteEpic`). No `time_at` branch to skip: 2.0's
 * `epic_deps` carries no wall-clock rows — the one time gate lives
 * on the epic itself (`not_before`).
 *
 * @param {number} epicId
 * @param {Object[]} epicDeps  epic_deps rows
 * @returns {number[]}
 */
export function dropBlockers2(epicId, epicDeps) {
    const blockers = new Set();
    for (const dep of asArray(epicDeps)) {
        if (!dep) continue;
        if (dep.dep_epic_fk == null || dep.dep_epic_fk !== epicId) continue;
        blockers.add(dep.epic_fk);
    }
    return [...blockers].sort((a, b) => a - b);
}

/**
 * Every epic, decorated for the editor grid with its plan labels, its
 * gating/tracking split and its delete-blocker preview. Pure CPU over rows already fetched — no
 * per-epic derivation, no gateway read of its own.
 *
 * @param {Object} args
 * @param {Object[]} args.epics               epics rows
 * @param {Object[]} args.epicRequirements    epic_requirements rows
 * @param {Object[]} args.epicDeps            epic_deps rows
 * @param {Object[]} args.requirements        any superset (needs `id`, `tracking`)
 * @param {Object[]} args.initiatives               initiatives rows (for the label/pipeline_fk dictionary)
 * @param {Object[]} [args.pipelines]         pipelines rows (`id`, `title`, `locked`)
 * @returns {Object[]}
 */
export function buildEpicRows({
    epics, epicRequirements, epicDeps, requirements, initiatives, pipelines,
} = {}) {
    const initiativeById = new Map(asArray(initiatives).map((e) => [e.id, e]));
    const pipelineById = new Map(asArray(pipelines).map((p) => [p.id, p]));
    const pipelineLocked = new Set(asArray(pipelines)
        .filter((p) => p && Number(p.locked)).map((p) => p.id));

    const linksByEpic = new Map();
    for (const link of asArray(epicRequirements)) {
        if (!link) continue;
        if (!linksByEpic.has(link.epic_fk)) linksByEpic.set(link.epic_fk, []);
        linksByEpic.get(link.epic_fk).push(link.requirement_fk);
    }

    return asArray(epics).filter(Boolean).map((epic) => {
        const initiative = initiativeById.get(epic.initiative_fk) || null;
        const pipeline = initiative ? (pipelineById.get(initiative.pipeline_fk) || null) : null;
        const reqIds = (linksByEpic.get(epic.id) || []).slice().sort((a, b) => a - b);
        const gatingReqIds = gatingRequirementIds2(reqIds, requirements);
        const gatingSet = new Set(gatingReqIds);
        const trackingReqIds = reqIds.filter((rid) => !gatingSet.has(rid));
        return {
            ...epic,
            initiativeTitle: initiative ? initiative.title : null,
            pipelineFk: initiative ? initiative.pipeline_fk : null,
            pipelineTitle: pipeline ? pipeline.title : null,
            // req #3742 — the OUTERMOST lock holding this epic (the level that
            // must be lifted first, as the gateway's `plan_lock.py` names it),
            // or null. The plan canvas draws any of the three as a red frame,
            // so the editor that frame's click opens must know an ancestor's
            // lock too, not only the epic's own flag.
            lockedBy: (initiative && pipelineLocked.has(initiative.pipeline_fk)) ? 'pipeline'
                : (initiative && Number(initiative.locked)) ? 'initiative'
                    : Number(epic.locked) ? 'epic' : null,
            reqIds,
            gatingReqIds,
            trackingReqIds,
            blockerEpicIds: dropBlockers2(epic.id, epicDeps),
            depIds: asArray(epicDeps)
                .filter((d) => d && d.epic_fk === epic.id && d.dep_epic_fk != null)
                .map((d) => d.dep_epic_fk)
                .sort((a, b) => a - b),
        };
    });
}
