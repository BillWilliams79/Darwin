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
import { isActiveRequirement } from '../SwarmView/pipelines/planActiveReqs';

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
 * @returns {Map<number, {total: number, initiatives: number, initiativeDeps: number}>}
 *          epics per plan — an epic has no state to tally (req #3750) — its
 *          initiatives (req #3804, the card's info block) and the plan's
 *          initiative-to-initiative dependency edges
 */
export function pipelineSummaries({ pipelines, epics, initiatives, initiativeDeps } = {}) {
    const pipelineByInitiative = new Map();
    for (const e of asArray(initiatives)) {
        if (e && e.id != null) pipelineByInitiative.set(e.id, e.pipeline_fk);
    }

    const out = new Map();
    for (const p of asArray(pipelines)) {
        if (p && p.id != null) out.set(p.id, { total: 0, initiatives: 0, initiativeDeps: 0 });
    }
    for (const e of asArray(initiatives)) {
        if (e && out.has(e.pipeline_fk)) out.get(e.pipeline_fk).initiatives += 1;
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
 * @returns {Map<number, {met: number, closed: number, total: number}>}
 *          `closed` (req #3804) counts every terminal status — met, deferred,
 *          wontfix — the "requirements closed" the card's info block shows.
 */
const TERMINAL_REQUIREMENT_STATUSES = new Set(['met', 'deferred', 'wontfix']);

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
        if (p && p.id != null) out.set(p.id, { met: 0, closed: 0, total: 0 });
    }

    for (const link of asArray(epicRequirements)) {
        if (!link) continue;
        const pipelineId = pipelineByEpic.get(link.epic_fk);
        if (pipelineId == null || !out.has(pipelineId)) continue;
        const bucket = out.get(pipelineId);
        bucket.total += 1;
        const status = statusById.get(link.requirement_fk);
        if (status === 'met') bucket.met += 1;
        if (TERMINAL_REQUIREMENT_STATUSES.has(status)) bucket.closed += 1;
    }

    return out;
}

// ── Closed and hand-sorted (req #3804) ──────────────────────────────────────
// A plan carries `closed` (parked: hidden by default, every epic launch-
// suppressed by the server's derivation) and `sort_order` (its card's place on
// this page, ascending). A new plan is written BELOW the current minimum, so it
// lands at the front; a drag renumbers every positioned card 0..n-1.

/** A TINYINT flag as a boolean — `"0"` is false, `1`/`"1"`/`true` are true. */
export const isClosedPipeline = (p) => Boolean(Number(p?.closed ?? 0));

const position = (p) => (p?.sort_order == null || p.sort_order === ''
    ? -Infinity : Number(p.sort_order));

/**
 * Plans in display order: unpositioned (NULL) FIRST, then `sort_order`
 * ascending, newest first among equals. A plan written by a path that sets no
 * position — the MCP `create_pipeline` tool — is a NEW plan, and new plans go
 * to the front; the first drag gives it a position like every other card.
 */
export function orderPipelines(pipelines) {
    return [...(pipelines || [])].sort((a, b) => {
        const pa = position(a);
        const pb = position(b);
        if (pa !== pb) return pa < pb ? -1 : 1;
        return Number(b.id) - Number(a.id);
    });
}

/** The `sort_order` that puts a new plan in FRONT of every existing one. */
export function frontSortOrder(pipelines) {
    const positioned = (pipelines || []).map(position).filter(Number.isFinite);
    return positioned.length ? Math.min(...positioned) - 1 : 0;
}

/**
 * `pipelines` with the `sort_order` of every plan `positions` (a Map of id →
 * sort_order) names replaced — a drop's new order laid over the live rows
 * (req #3966). No positions returns `pipelines` itself.
 */
export function withPositions(pipelines, positions) {
    if (!positions?.size) return pipelines;
    return (pipelines || []).map((p) => (positions.has(p.id)
        ? { ...p, sort_order: positions.get(p.id) } : p));
}

/**
 * Move `fromId` to where `toId` stands in `ordered` (arrayMove semantics: the
 * dragged plan takes the target's index, the rest close up behind it), then
 * renumber 0..n-1. Returns the reordered rows and the `{id, sort_order}`
 * writes — only the rows whose position actually changed — or null when the
 * move is a no-op. `ordered` is the FULL ordered list, closed plans included,
 * so a reorder over a filtered view never disturbs a plan the reader cannot see.
 */
export function reorderPipelines(ordered, fromId, toId) {
    const rows = [...(ordered || [])];
    const from = rows.findIndex((p) => p.id === fromId);
    const to = rows.findIndex((p) => p.id === toId);
    if (from < 0 || to < 0 || from === to) return null;
    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved);
    const renumbered = rows.map((p, index) => ({ ...p, sort_order: index }));
    const writes = renumbered
        .filter((p, index) => position(rows[index]) !== index)
        .map((p) => ({ id: p.id, sort_order: p.sort_order }));
    return { rows: renumbered, writes };
}

// ── All Active (req #3978) ──────────────────────────────────────────────────
/**
 * Every requirement seated on ANY plan whose latest session is under way — the
 * plan visualizer's Active box rule (`isActiveRequirement`, planActiveReqs.js),
 * applied across all plans, closed ones included: a session still running on a
 * parked plan is still running. No sort and no source column (user directive):
 * listed in this page's own plan order (`orderPipelines`), each plan's
 * requirements in seat order, each requirement once.
 *
 * @param {Object} args
 * @param {Object[]} args.pipelines         pipelines rows
 * @param {Object[]} args.initiatives       ALL initiatives rows (epic -> plan)
 * @param {Object[]} args.epics             ALL epics rows
 * @param {Object[]} args.epicRequirements  ALL epic_requirements rows
 * @param {Object[]} args.requirements      any superset (`id`, `title`, `requirement_status`)
 * @param {?Map} args.sessionStatus         requirement id -> latest session status
 *                                          (buildSessionStatusIndex); null = not read yet
 * @returns {Array<{id: number, title: string, sessionStatus: string,
 *                  status: string, machineFk: ?number}>}
 */
export function allActiveRequirements({ pipelines, initiatives, epics, epicRequirements,
    requirements, sessionStatus } = {}) {
    if (!sessionStatus) return [];
    const pipelineByInitiative = new Map();
    for (const e of asArray(initiatives)) {
        if (e && e.id != null) pipelineByInitiative.set(Number(e.id), Number(e.pipeline_fk));
    }
    const pipelineByEpic = new Map();
    for (const s of asArray(epics)) {
        if (!s || s.id == null) continue;
        const pipelineId = pipelineByInitiative.get(Number(s.initiative_fk));
        if (pipelineId != null) pipelineByEpic.set(Number(s.id), pipelineId);
    }
    const seatsByPipeline = new Map();
    for (const link of asArray(epicRequirements)) {
        if (!link) continue;
        const pipelineId = pipelineByEpic.get(Number(link.epic_fk));
        if (pipelineId == null) continue;
        if (!seatsByPipeline.has(pipelineId)) seatsByPipeline.set(pipelineId, []);
        seatsByPipeline.get(pipelineId).push(Number(link.requirement_fk));
    }
    const byId = new Map();
    for (const r of asArray(requirements)) {
        if (r && r.id != null) byId.set(Number(r.id), r);
    }

    const out = [];
    const seen = new Set();
    for (const p of orderPipelines(asArray(pipelines))) {
        for (const id of seatsByPipeline.get(Number(p?.id)) || []) {
            if (seen.has(id)) continue;
            const r = byId.get(id);
            const session = sessionStatus.get(id);
            if (!r || !isActiveRequirement({ ...r, session_status: session })) continue;
            seen.add(id);
            out.push({
                id, title: r.title ?? '', sessionStatus: session,
                status: r.requirement_status, machineFk: r.machine_fk ?? null,
            });
        }
    }
    return out;
}
