// pipelinesViewModel.js — the Pipeline 2.0 LIST page's summary model (req #3393).
//
// PURE: plain rows in, plain summaries out. No React, no MUI, no hooks, no
// clock. Counterpart of `Darwin/src/SwarmView/pipelines/pipelineViewModel.js`'s
// `pipelineSummaries`/`pipelineRequirementCounts`, but deliberately NOT a port
// of them: those depend on `buildPipelineModel`/`buildPlanRows`, the full 1.0
// derivation engine, which has no verified 2.0 counterpart reachable from this
// session (`Lambda-Rest/pipeline2_derive.py` lives in a repo this session does
// not have checked out — see `epicsModel.js`'s header for the full
// rationale, which applies here identically).
//
// So this module reports HONEST, SMALLER facts: how many epics a plan has, and
// how many of its requirements are met. An epic has NO state (req #3750 — it
// holds requirements and is never completed), so there is no per-epic
// done/open tally to report, and completeness is counted on requirements,
// whose status is stored.
//
// `hiddenPipelineStatusCounts`, `pipelinesEmptyMessage`, `machineTitle` and
// `PIPELINE_STATUS_VALUES` are NOT re-implemented here — they are pure,
// era-agnostic functions of a `pipeline_status` string and a `machine_fk`,
// with no coupling to which table produced the row, and req #3463 already
// established importing them straight from the 1.0 files as the convention
// for exactly this kind of vocabulary (its own `PipelinesPage.jsx` imported
// `pipelineStatusChipProps` the same way). `PipelinesPage.jsx` imports them
// directly from `pipelineViewModel.js` / `pipelineChipStyles.js`.
//
// THE RULE THIS FEATURE'S STRUCTURAL COPIES (PipelinesPage.jsx/InitiativesPage.jsx/
// EpicsPage.jsx as pages, initiativesApi.js/epicsApi.js/pipelinesApi.js as write
// paths, epicsModel.js as the derivation-adjacent guard) POINT AT, stated
// once here rather than in each of them (code review, req #3393 — the
// original pointer target, `devopsQueries2.js`, was deleted when the query
// LAYER moved to the shared-file convention above; the STRUCTURAL copies
// below did not move, and still need a reason): a 2.0 page/API module/model
// file that DUPLICATES a 1.0 component or write-path, rather than sharing
// it, does so because that 1.0 file is not merely data-shaped the same way —
// it is the 1.0 ERA's own behavior, and importing it would make 2.0 code
// depend on a file `#3356`'s eradication deletes. Pure, era-agnostic
// VOCABULARY (a color for a status string, a machine-id lookup, an
// orchestration-claim renderer) is safe to import, per the paragraph above;
// a component, a mutation function, or a state-derivation guard is not.

import { initiativeDepCounts } from '../SwarmView/pipelines/pipelineInitiativeDeps';

const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * Per-pipeline epic summaries for the LIST page, in one pass over the
 * whole-table reads — design rule 5 in miniature, matching 1.0's
 * `pipelineSummaries`: N pipelines summarized from the same lists the page
 * already fetched, never from N per-pipeline fetches (and NEVER from a
 * per-pipeline composed-read fan-out — that route is real but its payload is
 * sized for rendering ONE plan, not for a list index; see PLAN.md/session
 * notes on why `useComposedPipeline` is not used here).
 *
 * @param {Object} args
 * @param {Object[]} args.pipelines  pipelines rows
 * @param {Object[]} args.epics      ALL epics rows
 * @param {Object[]} args.initiatives      ALL initiatives rows (to resolve epic -> pipeline)
 * @param {Object[]} [args.initiativeDeps]  ALL `initiative_deps` rows (req #3823)
 * @returns {Map<number, {total: number, initiativeDeps: number}>}  epics per
 *          plan — an epic has no state to tally (req #3750) — and the plan's
 *          initiative-to-initiative dependency edges
 */
export function pipelineSummaries({ pipelines, epics, initiatives, initiativeDeps } = {}) {
    const pipelineByInitiative = new Map();
    for (const e of asArray(initiatives)) {
        if (e && e.id != null) pipelineByInitiative.set(e.id, e.pipeline_fk);
    }

    const out = new Map();
    for (const p of asArray(pipelines)) {
        if (p && p.id != null) out.set(p.id, { total: 0, initiativeDeps: 0 });
    }
    for (const [planId, n] of initiativeDepCounts(initiativeDeps, initiatives).byPipeline) {
        if (out.has(planId)) out.get(planId).initiativeDeps = n;
    }

    for (const epic of asArray(epics)) {
        if (!epic) continue;
        const pipelineId = pipelineByInitiative.get(epic.initiative_fk);
        if (pipelineId == null || !out.has(pipelineId)) continue;
        out.get(pipelineId).total += 1;
    }

    return out;
}

/**
 * Per-pipeline requirement met/total counts for the LIST page (parity with
 * 1.0's `pipelineRequirementCounts`, req #3225). UNLIKE the 1.0 version this
 * needs no derivation engine at all: `requirement_status === 'met'` is a
 * stored fact on the requirement row, and `epic_requirements` is a
 * real membership edge — counting the two together is a join, not a guess.
 *
 * @param {Object} args
 * @param {Object[]} args.pipelines
 * @param {Object[]} args.epics               ALL epics rows
 * @param {Object[]} args.initiatives                ALL initiatives rows
 * @param {Object[]} args.epicRequirements    ALL epic_requirements rows
 * @param {Object[]} args.requirements        any superset (needs `id`, `requirement_status`)
 * @returns {Map<number, {met: number, total: number}>}
 */
export function pipelineRequirementCounts({ pipelines, epics, initiatives,
    epicRequirements, requirements } = {}) {
    const pipelineByInitiative = new Map();
    for (const e of asArray(initiatives)) {
        if (e && e.id != null) pipelineByInitiative.set(e.id, e.pipeline_fk);
    }
    const pipelineByEpic = new Map();
    for (const s of asArray(epics)) {
        if (!s) continue;
        const pipelineId = pipelineByInitiative.get(s.initiative_fk);
        if (pipelineId != null) pipelineByEpic.set(s.id, pipelineId);
    }
    const statusById = new Map();
    for (const r of asArray(requirements)) {
        if (r && r.id != null) statusById.set(r.id, r.requirement_status);
    }

    const out = new Map();
    for (const p of asArray(pipelines)) {
        if (p && p.id != null) out.set(p.id, { met: 0, total: 0 });
    }

    for (const link of asArray(epicRequirements)) {
        if (!link) continue;
        const pipelineId = pipelineByEpic.get(link.epic_fk);
        if (pipelineId == null || !out.has(pipelineId)) continue;
        const bucket = out.get(pipelineId);
        bucket.total += 1;
        if (statusById.get(link.requirement_fk) === 'met') bucket.met += 1;
    }

    return out;
}
