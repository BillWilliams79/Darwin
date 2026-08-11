// orchestrationIndex.js — the requirement page's Orchestration box, derived (req #3435).
//
// PURE: plain rows in, plain answers out. No React, no MUI, no hooks, no clock —
// its own module so vitest can exercise every derivation without a DOM and so
// `useOrchestrationIndex.js` stays a thin wrapper over the list reads.
//
// The box shows two levels — Pipeline, Step — and exactly ONE of them is
// settable. Seating work on a step is the act that actually places a
// requirement on a plan; the pipeline follows from the step.
//
// req #3357 RETIRED THE EPIC ROW. This module used to answer a third question
// — "which epic does this requirement's feature name" — by walking
// `requirements.feature_fk -> features.epic_fk`. Feature left the frontend and
// no replacement exists for 1.0: no `pipeline_steps` row carries an `epic_fk`
// (only Pipeline 2.0's `pipeline2_steps` does, a disjoint id space unrelated to
// the live 1.0 "Darwin" plan this box reports on). So the epic derivation is
// gone rather than re-pointed — an accepted, visible reduction, not a defect.
// See `utils/pipelineMembership.js`'s header for the identical reasoning
// applied to the browse toggle.
//
// ## The chain that is left
//
// A requirement reaches a plan only by being seated on a `pipeline_steps` row:
//
//   pipeline_step_requirements (requirement_fk) -> pipeline_steps (step_fk)
//     -> pipelines (pipeline_fk)
//
// ## Tie-break: active first, then lowest id
//
// A step could in principle be read from more than one candidate plan in a
// wider index; this one still keeps the tie-break rule for symmetry with
// `_resolve_pipeline`'s rule (darwin-mcp/services/requirements.py, req #3186)
// even though today a step belongs to exactly one plan.

// ── Which plans may be OFFERED, and which may host an offerable step ───────
// "Open" is every lifecycle state a plan can still do work in. `completed` and
// `aborted` are the two that cannot, so they are named as the exclusion rather
// than the three survivors being listed — a future fifth status is far more
// likely to be workable than finished, and an unknown status showing up in the
// list is the safe error.
const CLOSED_PIPELINE_STATUSES = new Set(['completed', 'aborted']);

export const isOpenPipeline = (p) =>
    !!p && !CLOSED_PIPELINE_STATUSES.has(p.pipeline_status);

const asArray = (v) => (Array.isArray(v) ? v : []);

// COERCED, always. Nothing in the gateway promises these stay JSON numbers (a
// future BIGINT serializes as a string), and every id here is used as a Map key
// or compared with `===` — a string '46' and a number 46 index as two different
// steps, and the failure is silent: the box renders "no step" for a requirement
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
 * @param {Object[]} args.steps             pipeline_steps rows (id, pipeline_fk)
 * @param {Object[]} args.stepRequirements  pipeline_step_requirements rows
 * @returns {Object} OrchestrationIndex
 */
export function buildOrchestrationIndex({ pipelines, steps, stepRequirements } = {}) {
    const pipelinesById = new Map();
    for (const p of asArray(pipelines)) {
        const id = toId(p?.id);
        if (id != null) pipelinesById.set(id, { ...p, id });
    }

    // step -> pipeline, and the step rows themselves: the Step row of the
    // Orchestration box names the step, and `pipeline_steps`' shared projection
    // already carries `title`, so this costs nothing beyond the Map.
    const pipelineByStep = new Map();
    const stepsById = new Map();
    for (const s of asArray(steps)) {
        const sid = toId(s?.id);
        const pid = toId(s?.pipeline_fk);
        if (sid == null) continue;
        stepsById.set(sid, { ...s, id: sid });
        if (pid != null) pipelineByStep.set(sid, pid);
    }

    // Which step of which plan carries each requirement.
    const requirementSeats = new Map();  // reqId  -> Array<{stepId, pipelineId}>
    for (const link of asArray(stepRequirements)) {
        const sid = toId(link?.step_fk);
        const rid = toId(link?.requirement_fk);
        if (sid == null || rid == null) continue;
        const pid = pipelineByStep.get(sid);
        if (pid == null) continue;

        const seats = requirementSeats.get(rid) || [];
        seats.push({ stepId: sid, pipelineId: pid });
        requirementSeats.set(rid, seats);
    }

    // Active first, then lowest id — `_resolve_pipeline`'s rule (req #3186).
    const rankPipeline = (pid) => {
        const p = pipelinesById.get(pid);
        return (p && p.pipeline_status === 'active') ? 0 : 1;
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

    // THIS requirement's seat. Lowest step id within the chosen plan, for the
    // reason that requirement recorded: true display order is derived from the
    // WHOLE plan, and a requirement seated on two steps of one plan is already
    // a defect the plan model reports.
    const requirementSeat = new Map();
    for (const [rid, seats] of requirementSeats) {
        const pid = pickPipeline(new Set(seats.map((s) => s.pipelineId)));
        if (pid == null) continue;
        const stepIds = seats.filter((s) => s.pipelineId === pid)
            .map((s) => s.stepId).sort((a, b) => a - b);
        requirementSeat.set(rid, { pipelineId: pid, stepId: stepIds[0] ?? null });
    }

    return {
        pipelinesById,
        stepsById,
        requirementSeat,
    };
}

/** An empty index, so consumers never branch on null while the reads are in flight. */
export function emptyOrchestrationIndex() {
    return buildOrchestrationIndex({});
}

/**
 * The steps the Step row may offer — the ONE settable level of the box.
 *
 * ## Scope: this requirement's own plan, open steps only
 *
 * "Only the current pipeline's steps that are open." Concretely:
 *
 *   * the step's `pipeline_fk` is `pipelineId`, when one is known. With no plan
 *     known the list widens to every OPEN plan rather than emptying — a
 *     requirement that is seated nowhere still has to be placeable, or the
 *     control is dead exactly when it is needed.
 *   * `completed_at` is NULL. A finished step is not a place to put new work, and
 *     seating a requirement on one would contradict design rule 1 — a stamped
 *     `completed_at` is valid only with zero gating requirements.
 *
 * `currentStepId` is always offered, whatever the filters say, on the same rule
 * the rest of this module follows: a select whose own list denies its value
 * renders blank, which reads as a data bug rather than as a filter.
 *
 * ## Order
 *
 * Step id ascending — the canonical stored order (`pipelineSteps.defaultSort` is
 * `id:asc`, and that sort is load-bearing for the plan engine's tie-breaks). True
 * DISPLAY order is derived from the whole dependency graph and would mean loading
 * the entire plan to order one dropdown, which is the fan-out design rule 5
 * forbids.
 *
 * @param {Object} index
 * @param {{pipelineId?: ?number, currentStepId?: ?number}} [options]
 * @returns {Array<{step: Object, label: string}>}
 */
export function stepOptions(index, { pipelineId = null, currentStepId = null } = {}) {
    const { stepsById = new Map(), pipelinesById = new Map() } = index || {};
    const pid = toId(pipelineId);
    const curStep = toId(currentStepId);

    const out = [];
    for (const step of stepsById.values()) {
        if (step.id === curStep) continue;          // appended unconditionally below
        if (step.completed_at) continue;            // open steps only
        if (pid != null) {
            if (toId(step.pipeline_fk) !== pid) continue;
        } else if (!isOpenPipeline(pipelinesById.get(toId(step.pipeline_fk)))) {
            continue;
        }
        out.push(step);
    }
    out.sort((a, b) => a.id - b.id);

    if (curStep != null) {
        // Prepended, not sorted in: it is the value the control is DISPLAYING,
        // and a reader opening the menu should find it without hunting.
        out.unshift(stepsById.get(curStep) || { id: curStep });
    }
    return out.map((step) => ({ step, label: step.title || `Step ${step.id}` }));
}
