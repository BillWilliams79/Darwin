// orchestrationIndex.js — the requirement page's Orchestration box, derived (req #3435).
//
// PURE: plain rows in, plain answers out. No React, no MUI, no hooks, no clock —
// its own module so vitest can exercise every derivation without a DOM and so
// `useOrchestrationIndex.js` stays a thin wrapper over the list reads.
//
// The box shows three levels — Pipeline, Initiative, Epic — and exactly ONE of them
// WRITES. Seating work on an epic is the act that actually places a requirement
// on a plan. Since req #3579 the reader reaches that epic top-down: Pipeline
// and Initiative are selects that SCOPE the Epic list (`pipelineOptions`,
// `initiativeOptions`, `epicOptions`'s `initiativeId`), never a write of their own.
//
// req #3357 RETIRED THE INITIATIVE ROW. This module used to answer a third question
// — "which initiative does this requirement's retired middle tier name" — by
// walking the requirement's reference to it and then that tier's own
// reference to the initiative. That tier left the frontend and no replacement
// existed for 1.0: no `epics` row carried an `initiative_fk`.
// The initiative derivation went rather than being re-pointed — an accepted, visible
// reduction, not a defect. See `utils/pipelineMembership.js`'s header for the
// identical reasoning applied to the browse toggle.
//
// ## The chain — TWO HOPS UNDER 2.0, NOT ONE (req #3356)
//
// Pipeline 1.0 is eradicated, so this index reads the plan-layer tables. A
// 2.0 epic has NO `pipeline_fk` AT ALL: its plan comes through its initiative, which
// is CONTAINMENT rather than a second pointer (`epics.initiative_fk` is NOT
// NULL, and `initiatives.pipeline_fk` names the plan). So the walk gained a
// hop and this module gained an `initiatives` input:
//
//   epic_requirements (requirement_fk) -> epics (epic_fk)
//     -> initiatives (initiative_fk) -> pipelines (pipeline_fk)
//
// An epic whose initiative is missing from the read resolves to NO plan, exactly as a
// 1.0 epic with a null `pipeline_fk` did — the seat is dropped rather than
// invented, because a requirement pinned to a plan that was never read is worse
// than a box that says "No pipeline".
//
// `pipelines.pipeline_status` is the req #3965 vocabulary (authoring,
// authorized, orchestration_ready, orchestrating, met, wontfix, deferred —
// pipelineChipStyles.js), which `isOpenPipeline` and `rankPipeline` below read.
//

import { ORCHESTRATING_STATUS, isTerminalPipelineStatus } from '../pipelines/pipelineChipStyles';

// ## Tie-break: orchestrating first, then lowest id
//
// Kept for symmetry with `_resolve_attribution_2_0`'s rule
// (darwin-mcp/services/requirements.py — the 2.0 successor to `_resolve_pipeline`,
// which req #3356 deletes along with the rest of the 1.0 resolver). It applies
// the same orchestrating-first-then-lowest-id rule over the 2.0 tables.
//
// UNDER 2.0 THE MULTI-SEAT CASE IS STRUCTURALLY IMPOSSIBLE:
// `epic_requirements` has `PRIMARY KEY (requirement_fk)` alone — one
// epic per requirement, the req #3336 stage-2 gate ruling — so a requirement
// cannot be seated twice and the tie-break can never fire on live data. It stays
// as DEFENCE, not as a live case: this module folds whatever rows the wire hands
// it, and a duplicate arriving from a stale cache, a partial read or a future
// schema change must resolve deterministically rather than by array order. Do
// not delete it on the grounds that the constraint makes it unreachable.

// ── Which plans may be OFFERED, and which may host an offerable epic ───────
// "Open" is every lifecycle state a plan can still do work in: every
// NON-TERMINAL status (req #3965). The terminal three — met, won't fix,
// deferred — are named as the exclusion rather than the four survivors being
// listed: a future status is far more likely to be workable than finished, and
// an unknown status showing up in the list is the safe error.
export const isOpenPipeline = (p) =>
    !!p && !isTerminalPipelineStatus(p.pipeline_status);

const asArray = (v) => (Array.isArray(v) ? v : []);

// COERCED, always. Nothing in the gateway promises these stay JSON numbers (a
// future BIGINT serializes as a string), and every id here is used as a Map key
// or compared with `===` — a string '46' and a number 46 index as two different
// epics, and the failure is silent: the box renders "no epic" for a requirement
// that plainly has one.
const toId = (value) => {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
};

/**
 * Fold the bounded list reads into everything the Orchestration box needs.
 *
 * Every returned map is keyed by NUMBER. Callers pass ids through `toId`-shaped
 * guards of their own or hand over values that came out of this index.
 *
 * @param {Object} args
 * @param {Object[]} args.pipelines         pipelines rows (id, title, pipeline_status)
 * @param {Object[]} args.initiatives             initiatives rows (id, pipeline_fk)
 * @param {Object[]} args.epics             epics rows (id, initiative_fk)
 * @param {Object[]} args.epicRequirements  epic_requirements rows
 * @returns {Object} OrchestrationIndex
 */
export function buildOrchestrationIndex({ pipelines, initiatives, epics, epicRequirements } = {}) {
    const pipelinesById = new Map();
    for (const p of asArray(pipelines)) {
        const id = toId(p?.id);
        if (id != null) pipelinesById.set(id, { ...p, id });
    }

    // initiative -> pipeline. THE MIDDLE HOP: a 2.0 epic names an initiative, never a plan
    // (containment), so without this map an epic's plan is unknowable.
    //
    // …AND the initiative ROWS, since req #3365 restored the Initiative row to the
    // Orchestration box on the user's directive. This used to be a bare id->id
    // Map on the stated grounds that "nothing here renders an initiative"; that is no
    // longer true, and the rows cost nothing — the read is already made for the
    // hop, and `initiatives`' shared projection already carries `title`, exactly as
    // `epicsById` reasons about `epics`.
    const pipelineByInitiative = new Map();
    const initiativesById = new Map();
    for (const e of asArray(initiatives)) {
        const eid = toId(e?.id);
        const pid = toId(e?.pipeline_fk);
        if (eid == null) continue;
        initiativesById.set(eid, { ...e, id: eid });
        if (pid != null) pipelineByInitiative.set(eid, pid);
    }

    // epic -> pipeline (THROUGH the initiative), and the epic rows themselves: the
    // Epic row of the Orchestration box names the epic, and `epics`'
    // shared projection already carries `title`, so this costs nothing beyond
    // the Map. An epic whose initiative did not resolve gets no entry — see the header.
    const pipelineByEpic = new Map();
    const initiativeByEpic = new Map();
    const epicsById = new Map();
    for (const s of asArray(epics)) {
        const sid = toId(s?.id);
        const eid = toId(s?.initiative_fk);
        if (sid == null) continue;
        epicsById.set(sid, { ...s, id: sid });
        // The epic's initiative, kept separately from its plan (req #3365). An epic
        // whose initiative is missing from the read has NO plan either — one hop, two
        // answers — so an unresolvable initiative is the same silence the plan gets
        // rather than an initiative id pointing at a row nobody read.
        if (eid != null && initiativesById.has(eid)) initiativeByEpic.set(sid, eid);
        const pid = eid != null ? pipelineByInitiative.get(eid) : null;
        if (pid != null) pipelineByEpic.set(sid, pid);
    }

    // Which epic of which plan carries each requirement.
    const requirementSeats = new Map();  // reqId  -> Array<{epicId, pipelineId}>
    for (const link of asArray(epicRequirements)) {
        const sid = toId(link?.epic_fk);
        const rid = toId(link?.requirement_fk);
        if (sid == null || rid == null) continue;
        const pid = pipelineByEpic.get(sid);
        if (pid == null) continue;

        const seats = requirementSeats.get(rid) || [];
        seats.push({ epicId: sid, pipelineId: pid });
        requirementSeats.set(rid, seats);
    }

    // Orchestrating first, then lowest id — `_resolve_attribution_2_0`'s rule
    // (darwin-mcp/services/requirements.py; `orchestrating` since req #3965).
    // Defence only under 2.0; see the module header for why it cannot fire on
    // live data and stays anyway.
    const rankPipeline = (pid) => {
        const p = pipelinesById.get(pid);
        return (p && p.pipeline_status === ORCHESTRATING_STATUS) ? 0 : 1;
    };
    const pickPipeline = (ids) => {
        const list = [...ids];
        if (!list.length) return null;
        list.sort((a, b) => {
            const ra = rankPipeline(a);
            const rb = rankPipeline(b);
            return ra !== rb ? ra - rb : a - b;
        });
        return list[0];
    };

    // THIS requirement's seat. Lowest epic id within the chosen plan, for the
    // reason that requirement recorded: true display order is derived from the
    // WHOLE plan. Under 2.0 a requirement seated on two epics is not merely a
    // defect the plan model reports, it is impossible — `PRIMARY KEY
    // (requirement_fk)` — so this fold is defence against malformed input, not
    // a live case.
    const requirementSeat = new Map();
    for (const [rid, seats] of requirementSeats) {
        const pid = pickPipeline(new Set(seats.map((s) => s.pipelineId)));
        if (pid == null) continue;
        const epicIds = seats.filter((s) => s.pipelineId === pid)
            .map((s) => s.epicId).sort((a, b) => a - b);
        const epicId = epicIds[0] ?? null;
        // The initiative comes from the CHOSEN epic, never resolved a second way:
        // whatever epic this seat names is the epic whose initiative the box shows,
        // so the two rows can never disagree about where the requirement sits.
        requirementSeat.set(rid, {
            pipelineId: pid,
            epicId,
            initiativeId: epicId != null ? (initiativeByEpic.get(epicId) ?? null) : null,
        });
    }

    return {
        pipelinesById,
        initiativesById,
        epicsById,
        // EXPORTED because `epicOptions` needs it (req #3356). Under 1.0 that
        // function read `epic.pipeline_fk` straight off the row; a 2.0 epic has
        // no such column, and re-walking `initiative_fk -> pipeline_fk` there would be
        // a second copy of the join this function already ran — the drift shape
        // this module exists to avoid.
        pipelineByEpic,
        // EXPORTED for the same reason, since req #3579: the Epic list narrows
        // to the initiative the reader picked, and this map is that initiative hop already
        // made — re-reading `epic.initiative_fk` would be the second copy of a join.
        initiativeByEpic,
        requirementSeat,
    };
}

/** An empty index, so consumers never branch on null while the reads are in flight. */
export function emptyOrchestrationIndex() {
    return buildOrchestrationIndex({});
}

/**
 * The epics the Epic row may offer — the ONE settable level of the box.
 *
 * ## Scope: this requirement's own plan
 *
 * Concretely:
 *
 *   * the epic's plan — resolved THROUGH ITS INITIATIVE, since a 2.0 epic carries no
 *     `pipeline_fk` (req #3356) — is `pipelineId`, when one is known. With no
 *     plan known the list widens to every OPEN plan rather than emptying — a
 *     requirement that is seated nowhere still has to be placeable, or the
 *     control is dead exactly when it is needed. An epic whose initiative did not
 *     resolve is in NEITHER list: it belongs to no plan this read can name, so
 *     it can neither match a named plan nor be vouched for as open.
 *   * there is NO "open epic" filter: an epic has no state (req #3750) — it is
 *     never completed, so every epic of an offered plan can take new work.
 *
 * `currentEpicId` is always offered, whatever the filters say, on the same rule
 * the rest of this module follows: a select whose own list denies its value
 * renders blank, which reads as a data bug rather than as a filter.
 *
 * ## Order
 *
 * Epic id ascending — the canonical stored order (`pipelineEpics.defaultSort`
 * is `id:asc`, for the same load-bearing reason 1.0's block gave: no sequence
 * column exists, so the auto-increment id IS canonical stored order). True
 * DISPLAY order is derived from the whole dependency graph and would mean loading
 * the entire plan to order one dropdown, which is the fan-out design rule 5
 * forbids.
 *
 * ## Initiative (req #3579)
 *
 * `initiativeId`, when given, narrows the list to that initiative's epics — the reader picks
 * a plan, optionally an initiative, then an epic. An epic whose initiative hop did not resolve
 * matches no initiative. With no `initiativeId`, epics of a CLOSED initiative are left out, the
 * same initiatives `initiativeOptions` leaves out.
 *
 * @param {Object} index
 * @param {{pipelineId?: ?number, initiativeId?: ?number, currentEpicId?: ?number}} [options]
 * @returns {Array<{epic: Object, label: string}>}
 */
export function epicOptions(index, { pipelineId = null, initiativeId = null, currentEpicId = null } = {}) {
    const { epicsById = new Map(), pipelinesById = new Map(),
        pipelineByEpic = new Map(), initiativeByEpic = new Map(),
        initiativesById = new Map() } = index || {};
    const pid = toId(pipelineId);
    const eid = toId(initiativeId);
    const curEpic = toId(currentEpicId);

    const out = [];
    for (const epic of epicsById.values()) {
        if (epic.id === curEpic) continue;          // appended unconditionally below
        if (eid != null) {
            if (initiativeByEpic.get(epic.id) !== eid) continue;
        } else if (initiativesById.get(initiativeByEpic.get(epic.id))?.closed) {
            // "All initiatives" means every initiative the Initiative select OFFERS — a closed
            // initiative is not offered there, so its epics are not offered here.
            continue;
        }
        // The epic's plan, already joined through its initiative by
        // `buildOrchestrationIndex`. `undefined` here means the initiative hop failed,
        // which both branches below treat as "not offerable".
        const epicPipelineId = pipelineByEpic.get(epic.id);
        if (pid != null) {
            if (epicPipelineId !== pid) continue;
        } else if (epicPipelineId == null
                   || !isOpenPipeline(pipelinesById.get(epicPipelineId))) {
            continue;
        }
        out.push(epic);
    }
    out.sort((a, b) => a.id - b.id);

    if (curEpic != null) {
        // Prepended, not sorted in: it is the value the control is DISPLAYING,
        // and a reader opening the menu should find it without hunting.
        out.unshift(epicsById.get(curEpic) || { id: curEpic });
    }
    return out.map((epic) => ({ epic, label: epic.title || `Epic ${epic.id}` }));
}

// ── Req #3579 — the Pipeline and Initiative selects ─────────────────────────────
// The box is a CASCADE now: pick a plan, optionally narrow to one of its
// initiatives, then pick the epic that seats the requirement. Pipeline and Initiative
// write nothing — they SCOPE the Epic list — so these two only answer "what
// may the reader choose from". Both always include the current value, on the
// rule `epicOptions` states: a select whose own list denies its value renders
// blank, which reads as a data bug rather than as a filter.

/**
 * The plans the Pipeline select may offer: every OPEN plan (`isOpenPipeline`),
 * plus every id in `keepIds` whatever its status — the select's current value
 * AND the seat's plan, so a reader who scopes away from a closed seat plan can
 * still pick their way back to it. Ordered by title, then id — a reader finds a
 * plan by its name.
 *
 * @param {Object} index
 * @param {{keepIds?: Array<?number>}} [options]
 * @returns {Array<{pipeline: Object, label: string}>}
 */
export function pipelineOptions(index, { keepIds = [] } = {}) {
    const { pipelinesById = new Map() } = index || {};
    const keep = new Set(keepIds.map(toId).filter((v) => v != null));
    const out = [];
    for (const p of pipelinesById.values()) {
        if (keep.has(p.id) || isOpenPipeline(p)) out.push(p);
    }
    for (const k of keep) if (!pipelinesById.has(k)) out.push({ id: k });
    const label = (p) => p.title || `Pipeline ${p.id}`;
    out.sort((a, b) => label(a).localeCompare(label(b)) || a.id - b.id);
    return out.map((pipeline) => ({ pipeline, label: label(pipeline) }));
}

/**
 * The initiatives the Initiative select may offer: the open (`closed` falsy) initiatives of
 * `pipelineId`, plus every initiative of that plan in `keepIds` whatever its state —
 * the select's current value and the seat's initiative, as `pipelineOptions` keeps
 * its own. A kept id missing from the read gets a placeholder row (only for the
 * select's own value, which has to be in its list). Empty with no plan — an
 * initiative is only meaningful inside one. Ordered by `sort_order` (the
 * authoritative initiative display order since req #3430), then id.
 *
 * @param {Object} index
 * @param {{pipelineId?: ?number, keepIds?: Array<?number>, currentInitiativeId?: ?number}} [options]
 * @returns {Array<{initiative: Object, label: string}>}
 */
export function initiativeOptions(index, { pipelineId = null, keepIds = [], currentInitiativeId = null } = {}) {
    const { initiativesById = new Map() } = index || {};
    const pid = toId(pipelineId);
    if (pid == null) return [];
    const keep = new Set(keepIds.map(toId).filter((v) => v != null));
    const out = [];
    for (const e of initiativesById.values()) {
        if (toId(e.pipeline_fk) !== pid) continue;
        if (keep.has(e.id) || !e.closed) out.push(e);
    }
    const cur = toId(currentInitiativeId);
    if (cur != null && !initiativesById.has(cur)) out.push({ id: cur });
    const rank = (e) => (e.sort_order == null ? Infinity : Number(e.sort_order));
    out.sort((a, b) => (rank(a) - rank(b)) || a.id - b.id);
    return out.map((initiative) => ({ initiative, label: initiative.title || `Initiative ${initiative.id}` }));
}
