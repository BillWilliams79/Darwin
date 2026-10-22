// pipelineAdapter.js — the browser-side consumer of the Pipeline 2.0 composed
// read (req #3381). PURE: plain payload in, plain render shapes out. No React,
// no fetch, no clock — the one time-dependent fact (an empty step's TODAY,
// req #3618) takes `now` from the caller rather than reading the wall clock.
//
// THIS MODULE DOES NOT DERIVE ANYTHING (design intent: "the visualizer
// CONSUMES a derived block; it does not derive one" —
// memory/pipeline-2-visualizer-design.md § 0). `pipeline_compose` /
// `pipeline2_derive.py` (Lambda-Rest, req #3367) already ran display order,
// open work, eligibility, pause and serial-turn suppression, and
// requirement counts — server side, ONE producer, consumed identically by the
// MCP daemon and the browser. Everything below is RESHAPING: snake_case wire
// keys to the camelCase `PlanRow`/`plan` shapes `pipelinePlanLayout.js`,
// `pipelineEpicZoom.js` and `pipelineViewModel.js`'s render helpers already
// expect, plus joining the composed payload's own `steps[]`/`epics[]`/
// `requirements[]` dictionaries back onto the thin `derived.rows[]`.
//
// `derived.rows[]` already arrives in DISPLAY ORDER (`pipeline2_derive.py`
// builds it from `display_order(...)`'s own output) — there is no ordering
// left to do here.
//
// WHY A JOIN IS NEEDED AT ALL. `derived.rows[]` is deliberately compact — ids,
// enums, short id lists (req #3078 payload budget; every per-row field there
// is "an id, an enum string, a boolean, or a short list of one of those").
// `title`/`notes`/`not_before` live on `steps[]`; the epic's title and
// `sort_order` live on `epics[]`; machine labels are derived from
// `requirements[].machine_fk` (2.0 does not carry a `machines` dictionary of
// its own — the caller supplies one from `useMachines`, a small whole-app
// table, same pattern `buildCostIndex`'s two reads already use for cost).
//
// WHAT DOES NOT EXIST IN 2.0, deliberately not synthesized:
//   - the retired middle-tier label fields on a row — 2.0 has no such tier;
//     every row's epic comes directly from containment
//     (`pipeline_steps.epic_fk`), never a chained lookup through it, so there
//     is exactly one epic per step, not a dominant-label tally over several.
//   - `batches`/`batchLetterByStepId` — Batch does not exist in 2.0 (req
//     #3371 owns removing the drawing machinery; this module never builds one
//     to remove).
//   - `labelInherited` — 2.0's `epic_fk` is NOT NULL (containment), so a step
//     never lacks a label to inherit from a dependency the way a req-less 1.0
//     step could.
//   - a STEP STATE. A step has no state (req #3750, user ruling 2026-10-21):
//     it holds requirements and carries orchestration controls, and nothing
//     completes or reopens it. The one exception to "this module derives
//     nothing" is `visualizerColourInput` below — a DISPLAY rollup of the
//     step's requirements that the canvas colours by. Read its header before
//     treating `row.state` as anything else.

import { planTimeAxis } from './pipelinePlanTime';
import {
    sumReqCost, STEP_DONE, STEP_RUNNING, STEP_PENDING,
} from './pipelineModel';

const asArray = (v) => (Array.isArray(v) ? v : []);

// ── The four `derived` regimes (req #3345 § 4.5 / #3367 deliverable 3) ─────
export const WITHHELD_DERIVATION_FAILED = 'derivation_failed';
export const WITHHELD_BUDGET_DERIVED_ONLY = 'budget_derived_only';
export const WITHHELD_BUDGET_ROWS_TRUNCATED = 'budget_rows_truncated';
// Synthetic — never emitted by the server (the fourth regime is defined by
// the KEY being wholly ABSENT, so there is nothing to read a code off of).
// Named here so this module's own diagnostic object always carries SOME
// regime string, rather than a nullable field every consumer has to guard.
export const WITHHELD_ABSENT = 'derived_absent';
// Also synthetic, and DELIBERATELY a different string from WITHHELD_ABSENT
// (code review 2026-08-09): `derived.withheld === true` with no
// `withheld_reason` means the BLOCK IS PRESENT AND WITHHELD, just missing
// its own reason code (a producer bug, not the fourth regime) — labelling
// that `derived_absent` would send a reader looking for a missing KEY when
// the key is right there.
export const WITHHELD_UNSPECIFIED = 'withheld_unspecified';

/**
 * Whether `derived`'s ROWS are complete, closed over all FOUR states the key
 * can be in — not merely the three the server ever emits. An ABSENT key
 * (an old producer, or a truncated response) is the one state with nothing to
 * read a flag off of, and the only safe reading is `false` (req #3345 § 5).
 *
 * @param {*} derived
 * @returns {boolean}
 */
export function rowsComplete(derived) {
    if (derived == null || typeof derived !== 'object') return false;
    return Boolean(derived.rows_complete);
}

/**
 * A withheld-or-absent `derived` block as a renderable diagnostic, or `null`
 * when `derived` is present and NOT withheld (the ordinary case — nothing to
 * report). Callers render this as a hard stop (item 3 — "a withheld or
 * degraded derived block is a hard stop, not an empty render"): the plan
 * table/visualizer do not attempt a partial render from rows with no
 * derived state.
 *
 * @param {?Object} payload  the composed read, or null/undefined while loading
 * @returns {?{regime: string, rowsComplete: boolean, message: string}}
 */
export function deriveDiagnostic(payload) {
    const derived = payload && payload.derived;
    if (derived == null || typeof derived !== 'object') {
        return {
            regime: WITHHELD_ABSENT,
            rowsComplete: false,
            message: 'This composed read carries no `derived` block at all — the '
                + 'producer predates the 2.0 budget ladder (req #3345), or the key '
                + 'was dropped before it arrived. Treat the rows as incomplete: do '
                + 'not sequence or launch from this response.',
        };
    }
    if (!derived.withheld) return null;
    return {
        regime: derived.withheld_reason || WITHHELD_UNSPECIFIED,
        rowsComplete: rowsComplete(derived),
        message: derived.reason || 'The derived block was withheld.',
    };
}

// `epics.sort_order` as a finite number or null — never a string, never NaN.
// Lambda-Rest hands the column back as a real int/null (it is written through
// the MCP tools' own validation, never hand-typed JSON here), so this is a
// narrower guard than pipelineModel.js's `epicSortOrderOf` needs for a value
// that might arrive as an arbitrary string — but the same WHITELIST shape,
// for the same reason: `Number([])` is 0 and `Number(true)` is 1 in
// JavaScript, so naming the two legal input types closes that class outright.
function epicSortOrderOf(epic) {
    if (!epic) return null;
    const raw = epic.sort_order;
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

// Rule 10's machine-label derivation, narrowed to what 2.0's thin row already
// answers: `req_ids` minus `tracking_req_ids` (rule 10 sibling — a container
// is a launch parameter's non-answer, not a machine), each resolved through
// `requirements[].machine_fk` against the caller-supplied machines dictionary.
// NULL pin -> 'Any'; unknown id -> '#<id>' (matches pipelineModel.js's
// vocabulary so a mixed 1.0/2.0 session — StepsPage.jsx and this page open in
// two tabs — never shows two different words for the same fact).
function machineLabelsFor(reqIds, trackingReqIds, reqsById, machinesById) {
    const tracking = new Set(trackingReqIds || []);
    const labels = [];
    for (const rid of reqIds || []) {
        if (tracking.has(rid)) continue;
        const req = reqsById.get(rid);
        const fk = req && req.machine_fk != null ? req.machine_fk : null;
        const machine = fk != null ? machinesById.get(fk) : null;
        const label = fk == null ? 'Any' : (machine ? machine.title : `#${fk}`);
        if (!labels.includes(label)) labels.push(label);
    }
    return labels;
}

// ── THE VISUALIZER'S COLOUR INPUT — not a step state (req #3750) ─────────────
//
// A step HAS NO STATE: no done/running/pending, never completed, never
// reopened (req #3750, user ruling 2026-10-21). The orchestration asks every
// question of the REQUIREMENTS a step holds, through the derived row's
// `open_req_ids`, and the server sends no `state` at all.
//
// The plan visualizer and the plan table still paint a step from a three-value
// vocabulary (`STEP_DONE`/`STEP_RUNNING`/`STEP_PENDING` — the bead fill, the
// band colours, the "today" stack, the epic zoom's next-launch skip). The user
// ruled that changing HOW the visualizer tracks colour belongs to a separate
// requirement ("let the other requirement change the color tracking in the
// visualizer"), so this function keeps those consumers drawing exactly as they
// did by rolling the step's requirements up into that vocabulary, ONCE, here:
//
//   running  any GATING (non-tracking) requirement is in `development`;
//   done     the step has gating requirements and none of them is open
//            (`open_req_ids` empty);
//   pending  everything else — including an EMPTY step (no gating work).
//
// It is OWNED BY THAT COLOUR-TRACKING REQUIREMENT and exists only as the
// canvas's colour input. It is NOT a step state the orchestration has: nothing
// may gate, launch, refuse a seat, or word a step as "completed" from it. A
// consumer that needs an orchestration fact reads `openReqIds`, `eligible`,
// `gateOpen`, `launchCandidate` or `checkpointBlockedBy` instead.
//
// `open_req_ids` is the server's fact and is read as sent — never recomputed
// here from the payload's requirement rows (design rule 13: one rule, one
// implementation, req #3752). A row without it reads every gating requirement
// as open, so a missing fact never paints a step done.
export function visualizerColourInput(gatingIds, openReqIds, reqsById) {
    if (gatingIds.some((rid) => reqsById.get(rid)?.requirement_status === 'development')) {
        return STEP_RUNNING;
    }
    if (gatingIds.length > 0 && openReqIds.length === 0) return STEP_DONE;
    return STEP_PENDING;
}

/**
 * `derived.rows[]` (display order, already) joined against `steps[]`/
 * `epics[]`/`requirements[]` into `PlanRow`-shaped objects — the same shape
 * `pipelineModel.js::buildPlanRows` produces, so `planRenderRows`,
 * `pipelinePlanLayout.js` and `pipelineEpicZoom.js` cannot tell which engine
 * built the row they are drawing.
 *
 * @param {Object} payload    a composed `pipeline_compose` read, derived present
 * @param {Object[]} [machines]  from `useMachines` — 2.0 carries no dictionary
 *                                of its own (module header)
 * @returns {Object[]} PlanRow[]
 */
export function buildPlanRows(payload, machines = []) {
    const derived = payload.derived || {};
    const stepsById = new Map(asArray(payload.steps).map((s) => [s.id, s]));
    const epicsById = new Map(asArray(payload.epics).map((e) => [e.id, e]));
    const reqsById = new Map(asArray(payload.requirements).map((r) => [r.id, r]));
    const machinesById = new Map(asArray(machines).map((m) => [m.id, m]));
    const planLocked = isFlagOn(payload.pipeline?.locked, false);

    return asArray(derived.rows).map((dr) => {
        const step = stepsById.get(dr.id) || {};
        const epic = dr.epic_id != null ? epicsById.get(dr.epic_id) : null;
        const labels = machineLabelsFor(
            dr.req_ids, dr.tracking_req_ids, reqsById, machinesById);
        // req #3649 — the two stored flags, read the way the derivation
        // reads them (`checkpoint` absent = the column DEFAULT, on). The lock
        // CASCADES: a step under a locked epic or plan is as frozen as one
        // locked itself, and `lockedBy` names the OUTERMOST lock so the
        // control can say which one to lift.
        const locked = isFlagOn(dr.locked ?? step.locked, false);
        const epicLocked = isFlagOn(epic?.locked, false);
        const lockedBy = planLocked ? 'pipeline' : epicLocked ? 'epic' : locked ? 'step' : null;
        const tracking = new Set(dr.tracking_req_ids || []);
        const gatingIds = (dr.req_ids || []).filter((rid) => !tracking.has(rid));
        const openReqIds = Array.isArray(dr.open_req_ids) ? dr.open_req_ids : gatingIds;
        return {
            id: dr.id,
            title: step.title != null ? step.title : '',
            run: dr.run || step.run || 'auto',
            checkpoint: isFlagOn(dr.checkpoint ?? step.checkpoint, true),
            locked,
            effectiveLocked: lockedBy != null,
            lockedBy,
            notes: step.notes != null ? step.notes : null,
            // req #3750 — the step's open work: gating requirements not yet
            // met/deferred/wontfix. THE orchestration fact about a step.
            openReqIds,
            // The canvas's colour input — a display rollup, NOT a step state
            // (see `visualizerColourInput`).
            state: visualizerColourInput(gatingIds, openReqIds, reqsById),
            reqIds: dr.req_ids || [],
            trackingReqIds: dr.tracking_req_ids || [],
            unresolvedReqIds: dr.unresolved_req_ids || [],
            launchReqIds: dr.launch_req_ids || [],
            launchExcluded: dr.launch_excluded || [],
            launchBlock: dr.launch_block != null ? dr.launch_block : null,
            depIds: dr.dep_ids || [],
            outOfScopeDepIds: dr.out_of_scope_dep_ids || [],
            // 2.0 has no time-gate DEP ROWS (req #3349 folded them into the
            // step's own `not_before` — see the importer's `step_not_before`,
            // which does the same fold on the way in). A single value, not a
            // list, but `formatTimeGates` already takes an array and this
            // keeps every existing render call site unchanged.
            timeDeps: step.not_before ? [step.not_before] : [],
            epicId: dr.epic_id != null ? dr.epic_id : null,
            epic: epic ? epic.title : null,
            epicSortOrder: epicSortOrderOf(epic),
            epicLabels: epic ? [{ id: epic.id, title: epic.title }] : [],
            labelInherited: false,
            machineLabels: labels,
            machineLabel: labels.length ? labels.join(' / ') : '—',
            // req #3750 — may this step's launch-ready work go out now: it
            // carries launch-ready ids and its gate is open. Covers what
            // `top_up_eligible` used to answer separately; the eligible-now
            // ring is drawn from it.
            eligible: Boolean(dr.eligible),
            // req #3597 — the gate REPORTED (no dependency holds open work,
            // time gate passed), and whether this step's work may be announced for launch,
            // which no longer requires the gate: a dependency is a launch
            // PRIORITY, not a gate. A payload from a Lambda that predates the
            // fields reads as gate closed / not a candidate — never the reverse.
            gateOpen: Boolean(dr.gate_open),
            launchCandidate: Boolean(dr.launch_candidate),
            // The user's amendment: barrier steps upstream (req #3649: the
            // flag, on by default) still holding open work, holding this step.
            // Empty = no barrier blocks it.
            checkpointBlockedBy: dr.checkpoint_blocked_by || [],
            launchSuppressed: Boolean(dr.launch_suppressed),
            suppressedBy: dr.suppressed_by || [],
            swarmStartCommand: dr.swarm_start_command != null ? dr.swarm_start_command : null,
            noLaunchReason: dr.no_launch_reason != null ? dr.no_launch_reason : null,
        };
    });
}

/** A TINYINT(1) off the wire as a boolean, with the column's own DEFAULT
 *  standing in for an absent value — `"0"` is off, `1`/`"1"`/`true` on. */
export function isFlagOn(value, dflt) {
    if (value == null || value === '') return dflt;
    if (typeof value === 'boolean') return value;
    const n = Number(value);
    return Number.isFinite(n) ? n !== 0 : dflt;
}

/**
 * The full `plan` object the Table/Visualizer panels consume — the 2.0
 * counterpart of `pipelineViewModel.js::orderedPlan`, except every field
 * below is a RESHAPE of something `pipeline2_derive.py` already computed,
 * never a re-derivation. `costIndex` is the one exception: #3345 did not
 * move cost into the composed payload (verified against `pipeline_compose.py`
 * — no session/cost table appears in its reads), so it is attached here
 * exactly as `orderedPlan` attached it, from the SAME `buildCostIndex` two
 * bounded reads (req #3117) — unrelated to the fetch this requirement
 * collapses.
 *
 * @param {Object} payload   composed read, `derived` present and not withheld
 * @param {Object} [options]
 * @param {Object[]} [options.machines]
 * @param {?Object} [options.costIndex]
 * @param {?(Date|string)} [options.now]  the render clock; omitted, an empty step
 *                                        stays UNKNOWN (`pipelinePlanTime.js` rule 3)
 * @returns {Object} plan
 */
export function adaptComposedPipeline(payload, { machines = [], costIndex = null, now = null } = {}) {
    const derived = payload.derived || {};
    const rows = buildPlanRows(payload, machines);
    for (const r of rows) r.cost = sumReqCost(r.reqIds, costIndex);

    const violations = asArray(derived.violations).map((v) => ({
        invariant: v.invariant,
        message: v.message,
        stepIds: v.step_ids || [],
    }));

    const rc = derived.requirement_counts || {};
    const requirementCounts = {
        overall: rc.overall || { met: 0, total: 0 },
        byEpic: asArray(rc.by_epic).map((b) => ({
            epicId: b.epic_id, met: b.met, total: b.total,
        })),
    };

    const pauseSrc = derived.pause || {};
    const pause = {
        pipelineStatus: pauseSrc.pipeline_status != null ? pauseSrc.pipeline_status : null,
        pipelinePaused: Boolean(pauseSrc.pipeline_paused),
        pausedEpicIds: pauseSrc.paused_epic_ids || [],
        suppressedStepIds: pauseSrc.suppressed_step_ids || [],
    };

    const serialSrc = derived.serial || {};
    const serial = {
        executionMode: serialSrc.execution_mode || 'parallel',
        serial: Boolean(serialSrc.serial),
        epicOrder: serialSrc.epic_order || [],
        closedEpicIds: serialSrc.closed_epic_ids || [],
        liveEpicId: serialSrc.live_epic_id != null ? serialSrc.live_epic_id : null,
        waitingEpicIds: serialSrc.waiting_epic_ids || [],
        heldStepIds: serialSrc.held_step_ids || [],
    };

    return {
        rows,
        violations,
        // req #3381 item 2's "the time axis... arrives in the payload" was
        // WRONG when written — `derive_plan2`'s return carries no
        // `time_axis` key — so the axis is still computed HERE, client-side,
        // exactly as `orderedPlan` computed it. Code review 2026-08-09
        // additionally measured that the composed read's light requirement
        // projection dropped `started_at`/`completed_at` (which
        // `planTimeAxis` reads per-requirement), collapsing the axis to two
        // dead slots on the real live payload — a visible regression of req
        // #3201, not graceful degradation. Fixed the same day by widening
        // `_REQUIREMENT_COLUMNS` in `Lambda-Rest/pipeline_compose.py` (two
        // more DATETIME columns on a read already fetching every linked
        // requirement, zero extra gateway round trips) rather than deferring
        // it — the gap was shipping-a-known-regression, not a design choice
        // for a later requirement to make.
        // `now` places an EMPTY step on today or in the future (req #3618 —
        // `pipelinePlanTime.js` rule 3).
        timeAxis: planTimeAxis(rows, payload.requirements || [], now),
        // Batch does not exist in 2.0 (module header) — present as empty so
        // every consumer that destructures `plan.batches`/
        // `batchLetterByStepId` (planRenderRows, PipelinePlanTable's banner
        // logic) runs unchanged and draws no banners, exactly as the live
        // plan already does today (memory/pipeline-2-visualizer-design.md § 1
        // measured zero batches drawing on production before this
        // requirement even ran).
        batches: [],
        batchLetterByStepId: new Map(),
        eligibleStepIds: new Set(derived.eligible_step_ids || []),
        // req #3597 — every launch candidate, in launch PRIORITY order (gate-open
        // first, then display order). An array, not a Set: the order IS the fact.
        launchCandidateStepIds: derived.launch_candidate_step_ids || [],
        // req #3649 — THE launch order, one entry per announceable
        // (step, requirement), as the engine consumes it. An array: the
        // order IS the fact.
        launchQueue: asArray(derived.launch_queue).map((e) => ({
            stepId: e.step_id, requirementId: e.requirement_id,
        })),
        // req #3649 — the plan's own lock and the epics locked in their own
        // right, for the band chips and the header control. A step's
        // effective lock is already on its row (`effectiveLocked`/`lockedBy`).
        locked: isFlagOn(payload.pipeline?.locked, false),
        lockedEpicIds: new Set(asArray(payload.epics)
            .filter((e) => isFlagOn(e.locked, false)).map((e) => e.id)),
        cycleDetected: Boolean(derived.cycle_detected),
        cycleStepIds: derived.cycle_step_ids || [],
        duplicateStepIds: derived.duplicate_step_ids || [],
        unresolvedReqIds: derived.unresolved_req_ids || [],
        outOfScopeDepIds: derived.out_of_scope_dep_ids || [],
        requirementCounts,
        pause,
        serial,
    };
}

/**
 * The `model`-shaped object `PipelinePlanVisualizer.jsx` still reads directly
 * (`model.requirements` for the autonomy/model/effort hover card,
 * `model.machines` for by-machine colouring) — narrower than 1.0's
 * `PipelineModel`, because 2.0's composed payload carries nothing else `model`
 * was ever asked for (no retired middle tier, and `steps`/`epics`/
 * `stepRequirements`/`stepDeps` are already folded into `plan.rows` above).
 *
 * @param {Object} payload
 * @param {Object[]} [machines]
 * @param {?Map<number, string>} [sessionStatus]  buildSessionStatusIndex output
 * @returns {{pipeline: ?Object, requirements: Object[], machines: Object[], epics: Object[]}}
 */
export function buildPlanModel(payload, machines = [], sessionStatus = null) {
    const requirements = asArray(payload && payload.requirements);
    return {
        pipeline: (payload && payload.pipeline) || null,
        // req #3584 — `session_status` for the Session colour key. Attached only
        // when the index exists (both session reads settled): a requirement it
        // does not name then has genuinely never had a session. With no index
        // the rows pass through untouched and the scale paints unknown.
        requirements: sessionStatus
            ? requirements.map((r) => ({
                ...r, session_status: sessionStatus.get(Number(r.id)) ?? 'no_session',
            }))
            : requirements,
        machines: asArray(machines),
        // req #3586 — the epic picker of the visualizer's add-step dialog. The
        // payload's own `epics[]`, so an epic with no steps yet is offered too.
        epics: asArray(payload && payload.epics),
    };
}
