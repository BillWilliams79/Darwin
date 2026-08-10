// orchestrationIndex.js — the requirement page's Orchestration box, derived (req #3435).
//
// PURE: plain rows in, plain answers out. No React, no MUI, no hooks, no clock —
// its own module so vitest can exercise every derivation without a DOM and so
// `useOrchestrationIndex.js` stays a thin wrapper over six list reads.
//
// The box shows three levels — Pipeline, Epic, Step — and exactly ONE of them is
// settable. Which one has moved as the design settled: the pipeline never could
// be (no column), the epic was briefly, and the STEP is the one now, because
// seating work on a step is the act that actually places a requirement on a plan.
//
// ## What it answers, and why one index rather than two resolvers
//
// The box has to name THIS requirement's plan and epic, and then offer every
// OTHER epic it could be assigned to, filtered by a chosen plan. Its two
// predecessors (`useEpicPipelineLocation`, req #3235 — five serial hops for one
// epic; `useRequirementStepLocation`, req #3253 — three serial hops for one
// requirement) each answered a single-row question with a targeted chain. A
// dropdown asks the SAME question about every epic at once, which is exactly
// the fan-out those chains were shaped to avoid — so the shape flips: six
// bounded LIST reads, folded here in one pass, and the single-row answers fall
// out of the same fold for free.
//
// ## The chain, and why it is this long
//
// Pipeline 1.0 stores no `epic_fk` anywhere. An epic reaches a plan only
// transitively:
//
//   epics <- features (epic_fk) <- requirements (feature_fk)
//         <- pipeline_step_requirements (requirement_fk)
//         -> pipeline_steps (step_fk) -> pipelines (pipeline_fk)
//
// Pipeline 2.0 removes the middle of that (a step carries `epic_fk` directly),
// which is why this module is deliberately one file with one entry point: when
// the frontend adopts 2.0, `buildOrchestrationIndex` is what gets rewritten,
// and nothing above it has to know the chain existed.
//
// ## Tie-break: active first, then lowest id
//
// An epic seated in more than one plan resolves to the `active` one, else the
// lowest id — `_resolve_pipeline`'s rule (darwin-mcp/services/requirements.py,
// req #3186), reused here rather than a third copy invented for the browser.

// ── Which plans may be OFFERED, and which may host an offerable epic ─────────
// "Open" is every lifecycle state a plan can still do work in. `completed` and
// `aborted` are the two that cannot, so they are named as the exclusion rather
// than the three survivors being listed — a future fifth status is far more
// likely to be workable than finished, and an unknown status showing up in the
// list is the safe error.
const CLOSED_PIPELINE_STATUSES = new Set(['completed', 'aborted']);

export const isOpenPipeline = (p) =>
    !!p && !CLOSED_PIPELINE_STATUSES.has(p.pipeline_status);

// ── A ROW THAT DID NOT COME BACK IS NOT A CLOSED PLAN ───────────────────────
// `isOpenPipeline(undefined)` is false, and reading an ABSENT row as "finished"
// is the opposite of the rule stated above — it drops an epic that is seated
// only in that plan out of the list entirely. Reachable without any error at
// all: `pipelines` and `pipeline_steps` are independent cache entries under a
// 30s staleTime, so a plan created between the two fetches has steps here and
// no row yet. `pipelineOptions` already answers this condition by INVENTING a
// row; this is the same answer for the same question.
const seatKeepsEpicOfferable = (pipelinesById, pipelineId) =>
    !pipelinesById.has(pipelineId) || isOpenPipeline(pipelinesById.get(pipelineId));

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

// Newest first, id descending as the tie-break — `create_ts` has one-second
// resolution and two epics authored in one scripted pass share it exactly (the
// live data already has the case: epics 3 and 4 both stamp 2026-07-28T05:15:14).
// Without the tie-break their relative order would follow whatever order the
// gateway returned, which is not stable between reads.
const byRecency = (a, b) => {
    const at = a.create_ts || '';
    const bt = b.create_ts || '';
    if (at !== bt) return at < bt ? 1 : -1;
    return b.id - a.id;
};

// A feature's seat order: hand `sort_order` first with NULL sinking to the end,
// then id. The same comparator the machine-pin list and the category list use,
// because "which of these rows is first" has one answer in this app.
const bySeatOrder = (a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.id - b.id;
};

/**
 * Fold the six bounded list reads into everything the Orchestration box needs.
 *
 * Every returned map is keyed by NUMBER. Callers pass ids through `toId`-shaped
 * guards of their own or hand over values that came out of this index.
 *
 * @param {Object} args
 * @param {Object[]} args.pipelines         pipelines rows (id, title, pipeline_status)
 * @param {Object[]} args.steps             pipeline_steps rows (id, pipeline_fk)
 * @param {Object[]} args.stepRequirements  pipeline_step_requirements rows
 * @param {Object[]} args.requirements      requirements rows (id, feature_fk)
 * @param {Object[]} args.features          features rows (id, epic_fk, closed, sort_order)
 * @param {Object[]} args.epics             epics rows (id, title, closed, create_ts)
 * @returns {Object} OrchestrationIndex
 */
export function buildOrchestrationIndex({
    pipelines, steps, stepRequirements, requirements, features, epics,
} = {}) {
    const pipelinesById = new Map();
    for (const p of asArray(pipelines)) {
        const id = toId(p?.id);
        if (id != null) pipelinesById.set(id, { ...p, id });
    }

    const epicsById = new Map();
    for (const e of asArray(epics)) {
        const id = toId(e?.id);
        if (id != null) epicsById.set(id, { ...e, id });
    }

    // features -> epic, and the per-epic seat list the assignment writes into.
    const epicByFeature = new Map();
    const featuresByEpic = new Map();
    for (const f of asArray(features)) {
        const fid = toId(f?.id);
        const eid = toId(f?.epic_fk);
        if (fid == null) continue;
        if (eid == null) continue;
        epicByFeature.set(fid, eid);
        const bucket = featuresByEpic.get(eid) || [];
        bucket.push({ ...f, id: fid });
        featuresByEpic.set(eid, bucket);
    }
    for (const bucket of featuresByEpic.values()) bucket.sort(bySeatOrder);

    // requirement -> epic, through the feature seat.
    const epicByRequirement = new Map();
    for (const r of asArray(requirements)) {
        const rid = toId(r?.id);
        const fid = toId(r?.feature_fk);
        if (rid == null || fid == null) continue;
        const eid = epicByFeature.get(fid);
        if (eid != null) epicByRequirement.set(rid, eid);
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

    // The junction pass does BOTH jobs in one loop: which plans each epic is
    // seated in, and which step of which plan carries each requirement.
    const epicPipelineIds = new Map();   // epicId -> Set<pipelineId>
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

        const eid = epicByRequirement.get(rid);
        if (eid == null) continue;
        const set = epicPipelineIds.get(eid) || new Set();
        set.add(pid);
        epicPipelineIds.set(eid, set);
    }

    // ── A STEP'S EPIC, derived the way the plan table derives it ────────────
    // No step carries `epic_fk` in Pipeline 1.0. A step's epic is the DOMINANT
    // epic of its requirements — design rule 10, and the same answer
    // `pipelineModel.dominantLabels()` puts in the plan table's Epic column. The
    // step picker uses it to scope its list, so a step offered here is a step
    // labelled with that epic over there; a per-page rule would have made the
    // two disagree.
    //
    // Ties break on the LOWEST epic id, deterministically, so a step split evenly
    // between two epics does not change column between reads.
    //
    // A step with NO requirements has no derivable epic and is recorded as
    // `undefined` rather than skipped — `stepOptions` offers those under every
    // epic, because a freshly created step belongs to none yet and excluding it
    // would make it unreachable from every requirement.
    const epicCountsByStep = new Map();
    for (const link of asArray(stepRequirements)) {
        const sid = toId(link?.step_fk);
        const rid = toId(link?.requirement_fk);
        if (sid == null || rid == null) continue;
        const eid = epicByRequirement.get(rid);
        if (eid == null) continue;
        const counts = epicCountsByStep.get(sid) || new Map();
        counts.set(eid, (counts.get(eid) || 0) + 1);
        epicCountsByStep.set(sid, counts);
    }
    const epicByStep = new Map();
    for (const [sid, counts] of epicCountsByStep) {
        let best = null;
        let bestN = -1;
        for (const [eid, n] of counts) {
            if (n > bestN || (n === bestN && eid < best)) { best = eid; bestN = n; }
        }
        if (best != null) epicByStep.set(sid, best);
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

    const epicPrimaryPipeline = new Map();
    for (const [eid, set] of epicPipelineIds) {
        epicPrimaryPipeline.set(eid, pickPipeline(set));
    }

    // THIS requirement's seat. The step must belong to the plan that won the
    // tie-break — pairing a losing plan's step with the winning plan's id links
    // to a step that is not on that plan, which the visualizer would correctly
    // refuse to focus (req #3253's own guard, carried over). Lowest step id
    // within the chosen plan, for the reason that requirement recorded: true
    // display order is derived from the WHOLE plan, and a requirement seated on
    // two steps of one plan is already a defect the plan model reports.
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
        epicByStep,
        epicsById,
        featuresByEpic,
        epicByFeature,
        epicPipelineIds,
        epicPrimaryPipeline,
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
 * ## Scope: this requirement's own plan and epic, open steps only
 *
 * "Only the current pipeline/epic's steps that are open." Concretely:
 *
 *   * the step's `pipeline_fk` is `pipelineId`, when one is known. With no plan
 *     known the list widens to every OPEN plan rather than emptying — a
 *     requirement that is seated nowhere and has no epic still has to be
 *     placeable, or the control is dead exactly when it is needed.
 *   * the step's DOMINANT epic is `epicId` (see `epicByStep`), OR the step has no
 *     requirements at all and so belongs to no epic yet. Offering the second
 *     group is deliberate: a step created empty on the Steps page would otherwise
 *     be invisible from every requirement, and it is the natural target for the
 *     first one.
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
 * ## A failed plan read WIDENS this list, never narrows it
 *
 * `epicByStep` is derived from the chained `requirements` read. If that read
 * fails the map is empty, every step reads as "no epic yet", and the epic filter
 * lets them all through. That is the safe direction — the reader is offered more
 * steps, never silently fewer — which is why this takes no `planKnown` guard
 * where the epic list needed one.
 *
 * @param {Object} index
 * @param {{pipelineId?: ?number, epicId?: ?number, currentStepId?: ?number}} [options]
 * @returns {Array<{step: Object, label: string}>}
 */
export function stepOptions(index, { pipelineId = null, epicId = null,
    currentStepId = null } = {}) {
    const { stepsById = new Map(), epicByStep = new Map(),
        pipelinesById = new Map() } = index || {};
    const pid = toId(pipelineId);
    const eid = toId(epicId);
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
        if (eid != null) {
            const stepEpic = epicByStep.get(step.id);
            // `undefined` — no requirements, so no epic yet — passes.
            if (stepEpic !== undefined && stepEpic !== eid) continue;
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

/**
 * The epic a `feature_fk` sits under, as a row — what the epic Select DISPLAYS.
 *
 * @param {Object} index
 * @param {?number} featureFk
 * @returns {?Object} epics row
 */
export function epicRowForFeature(index, featureFk) {
    const { epicsById = new Map() } = index || {};
    const eid = epicForFeature(index, featureFk);
    if (eid == null) return null;
    return epicsById.get(eid) || { id: eid, title: `Epic ${eid}`, closed: 0, create_ts: null };
}

/**
 * The epic a requirement's `feature_fk` places it under, or null.
 *
 * Reads the requirement's OWN column rather than the index's requirement map:
 * the detail page holds the row it fetched and has just written to, and the
 * whole-table projection behind the index is a cache that lags a PUT by one
 * invalidation. Using the live column means the box updates the instant the
 * assignment lands.
 *
 * @param {Object} index
 * @param {?number} featureFk
 * @returns {?number} epics.id
 */
export function epicForFeature(index, featureFk) {
    const { epicByFeature = new Map() } = index || {};
    const fid = toId(featureFk);
    return fid == null ? null : (epicByFeature.get(fid) ?? null);
}
