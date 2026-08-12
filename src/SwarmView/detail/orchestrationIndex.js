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
// no replacement existed for 1.0: no `pipeline_steps` row carried an `epic_fk`.
// The epic derivation went rather than being re-pointed — an accepted, visible
// reduction, not a defect. See `utils/pipelineMembership.js`'s header for the
// identical reasoning applied to the browse toggle.
//
// ## The chain — TWO HOPS UNDER 2.0, NOT ONE (req #3356)
//
// Pipeline 1.0 is eradicated, so this index reads the plan-layer tables. A
// 2.0 step has NO `pipeline_fk` AT ALL: its plan comes through its epic, which
// is CONTAINMENT rather than a second pointer (`pipeline_steps.epic_fk` is NOT
// NULL, and `epics.pipeline_fk` names the plan). So the walk gained a
// hop and this module gained an `epics` input:
//
//   pipeline_step_requirements (requirement_fk) -> pipeline_steps (step_fk)
//     -> epics (epic_fk) -> pipelines (pipeline_fk)
//
// A step whose epic is missing from the read resolves to NO plan, exactly as a
// 1.0 step with a null `pipeline_fk` did — the seat is dropped rather than
// invented, because a requirement pinned to a plan that was never read is worse
// than a box that says "No pipeline".
//
// `pipelines.pipeline_status` uses the SAME vocabulary as 1.0's
// (`draft|active|paused|completed|aborted`, verified in `DarwinSQL/schema.sql`),
// so `isOpenPipeline` and `rankPipeline` below are unchanged — not adapted, not
// re-derived.
//
// ## Tie-break: active first, then lowest id
//
// Kept for symmetry with `_resolve_attribution_2_0`'s rule
// (darwin-mcp/services/requirements.py — the 2.0 successor to `_resolve_pipeline`,
// which req #3356 deletes along with the rest of the 1.0 resolver). It applies
// the same active-first-then-lowest-id rule over the 2.0 tables.
//
// UNDER 2.0 THE MULTI-SEAT CASE IS STRUCTURALLY IMPOSSIBLE:
// `pipeline_step_requirements` has `PRIMARY KEY (requirement_fk)` alone — one
// step per requirement, the req #3336 stage-2 gate ruling — so a requirement
// cannot be seated twice and the tie-break can never fire on live data. It stays
// as DEFENCE, not as a live case: this module folds whatever rows the wire hands
// it, and a duplicate arriving from a stale cache, a partial read or a future
// schema change must resolve deterministically rather than by array order. Do
// not delete it on the grounds that the constraint makes it unreachable.

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
 * @param {Object[]} args.epics             epics rows (id, pipeline_fk)
 * @param {Object[]} args.steps             pipeline_steps rows (id, epic_fk)
 * @param {Object[]} args.stepRequirements  pipeline_step_requirements rows
 * @returns {Object} OrchestrationIndex
 */
export function buildOrchestrationIndex({ pipelines, epics, steps, stepRequirements } = {}) {
    const pipelinesById = new Map();
    for (const p of asArray(pipelines)) {
        const id = toId(p?.id);
        if (id != null) pipelinesById.set(id, { ...p, id });
    }

    // epic -> pipeline. THE MIDDLE HOP, and the only reason this input exists: a
    // 2.0 step names an epic, never a plan (containment), so without this map a
    // step's plan is unknowable. Kept as a bare id->id Map rather than an
    // `epicsById` of whole rows because nothing here renders an epic — the
    // Orchestration box shows Pipeline and Step, and req #3357 retired its Epic
    // row for reasons this requirement does not reopen.
    const pipelineByEpic = new Map();
    for (const e of asArray(epics)) {
        const eid = toId(e?.id);
        const pid = toId(e?.pipeline_fk);
        if (eid != null && pid != null) pipelineByEpic.set(eid, pid);
    }

    // step -> pipeline (THROUGH the epic), and the step rows themselves: the
    // Step row of the Orchestration box names the step, and `pipeline_steps`'
    // shared projection already carries `title`, so this costs nothing beyond
    // the Map. A step whose epic did not resolve gets no entry — see the header.
    const pipelineByStep = new Map();
    const stepsById = new Map();
    for (const s of asArray(steps)) {
        const sid = toId(s?.id);
        const eid = toId(s?.epic_fk);
        if (sid == null) continue;
        stepsById.set(sid, { ...s, id: sid });
        const pid = eid != null ? pipelineByEpic.get(eid) : null;
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

    // Active first, then lowest id — `_resolve_attribution_2_0`'s rule
    // (darwin-mcp/services/requirements.py). Defence only under 2.0; see the
    // module header for why it cannot fire on live data and stays anyway.
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
    // WHOLE plan. Under 2.0 a requirement seated on two steps is not merely a
    // defect the plan model reports, it is impossible — `PRIMARY KEY
    // (requirement_fk)` — so this fold is defence against malformed input, not
    // a live case.
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
        // EXPORTED because `stepOptions` needs it (req #3356). Under 1.0 that
        // function read `step.pipeline_fk` straight off the row; a 2.0 step has
        // no such column, and re-walking `epic_fk -> pipeline_fk` there would be
        // a second copy of the join this function already ran — the drift shape
        // this module exists to avoid.
        pipelineByStep,
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
 *   * the step's plan — resolved THROUGH ITS EPIC, since a 2.0 step carries no
 *     `pipeline_fk` (req #3356) — is `pipelineId`, when one is known. With no
 *     plan known the list widens to every OPEN plan rather than emptying — a
 *     requirement that is seated nowhere still has to be placeable, or the
 *     control is dead exactly when it is needed. A step whose epic did not
 *     resolve is in NEITHER list: it belongs to no plan this read can name, so
 *     it can neither match a named plan nor be vouched for as open.
 *   * `completed_at` is NULL. `pipeline_steps` carries that column exactly as
 *     `pipeline_steps` did, so this filter is unchanged. A finished step is not
 *     a place to put new work, and seating a requirement on one would contradict
 *     design rule 1 — a stamped `completed_at` is valid only with zero gating
 *     requirements.
 *
 * `currentStepId` is always offered, whatever the filters say, on the same rule
 * the rest of this module follows: a select whose own list denies its value
 * renders blank, which reads as a data bug rather than as a filter.
 *
 * ## Order
 *
 * Step id ascending — the canonical stored order (`pipelineSteps.defaultSort`
 * is `id:asc`, for the same load-bearing reason 1.0's block gave: no sequence
 * column exists, so the auto-increment id IS canonical stored order). True
 * DISPLAY order is derived from the whole dependency graph and would mean loading
 * the entire plan to order one dropdown, which is the fan-out design rule 5
 * forbids.
 *
 * @param {Object} index
 * @param {{pipelineId?: ?number, currentStepId?: ?number}} [options]
 * @returns {Array<{step: Object, label: string}>}
 */
export function stepOptions(index, { pipelineId = null, currentStepId = null } = {}) {
    const { stepsById = new Map(), pipelinesById = new Map(),
        pipelineByStep = new Map() } = index || {};
    const pid = toId(pipelineId);
    const curStep = toId(currentStepId);

    const out = [];
    for (const step of stepsById.values()) {
        if (step.id === curStep) continue;          // appended unconditionally below
        if (step.completed_at) continue;            // open steps only
        // The step's plan, already joined through its epic by
        // `buildOrchestrationIndex`. `undefined` here means the epic hop failed,
        // which both branches below treat as "not offerable".
        const stepPipelineId = pipelineByStep.get(step.id);
        if (pid != null) {
            if (stepPipelineId !== pid) continue;
        } else if (stepPipelineId == null
                   || !isOpenPipeline(pipelinesById.get(stepPipelineId))) {
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
