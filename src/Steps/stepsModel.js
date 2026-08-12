// stepsModel.js — the pure page model behind /swarm/steps (req #3140).
//
// PURE: plain rows in, plain rows out. No React, no MUI, no hooks, no clock. Its
// own module so vitest can exercise it without a DOM and so StepsPage stays in
// React Fast Refresh (the instructionSort.js lesson).
//
// ## It does not derive step state. It ASKS.
//
// A step's state is derived, never stored (req #3080 design rule 1), and Darwin
// already has exactly two implementations of that derivation on purpose:
// `pipelineModel.js` for the browser and `pipeline_derive.py` for the daemon,
// kept honest by a shared 29-case conformance corpus. A third one here — even a
// three-line one — would be a third thing to keep in step, and the failure mode
// is an editor page that disagrees with the plan it edits about whether a step
// is Running. So this module runs the REAL engine: `buildPipelineModel` narrows
// the whole-table reads to one plan, `buildPlanRows` derives, and everything
// below only decorates the result.
//
// COST: pure CPU over rows the app has already fetched, and no gateway read of
// its own — the six lists are the same ones `/swarm/pipelines` and
// `/swarm/pipeline/:id` use, so arriving from either paints from cache (design
// rule 5, and memory/detail-page-interlinking.md's composition rule). The work
// grows with the number of steps, never with the number of requests.
//
// It deliberately does NOT call `orderedPlan`: display order, launch batches,
// eligibility and the time axis are the PLAN's concerns. This page is a grid the
// user sorts by clicking a header, and a topologically-ordered editor that
// silently re-sorts itself when a requirement closes would be a worse editor.

import {
    buildPipelineModel,
} from '../SwarmView/pipelines/pipelineViewModel';
import {
    buildPlanRows,
    isTrackingRequirement,
    STEP_DONE,
    STEP_RUNNING,
    STEP_PENDING,
} from '../SwarmView/pipelines/pipelineModel';

const asArray = (v) => (Array.isArray(v) ? v : []);

export { STEP_DONE, STEP_RUNNING, STEP_PENDING };

/**
 * The steps whose dependency row references `stepId` — design rule 4's blockers.
 *
 * ## This is a PREVIEW of the database's answer, not the enforcement
 *
 * The enforcement is `pipeline_step_deps.dep_step_fk ON DELETE RESTRICT`, and
 * since `deleteStep` is a single statement that constraint is reached with
 * nothing else attempted — a blocked delete is an atomic 409 with the plan
 * untouched. So this function's whole job is to turn that 409 into a sentence
 * naming the steps responsible, from data the page already has.
 *
 * That makes MATCHING THE DATABASE the only correctness criterion here. It is not
 * a safety check that may err on the strict side; a disagreement in either
 * direction is a wrong message. Which is why a SELF-DEPENDENCY counts: InnoDB
 * evaluates the RESTRICT even against a dep row that is itself inside the same
 * cascade (measured and recorded in darwin-mcp/tests/conftest.py — it is why a
 * multi-step sweep needs two phases), so `(step_fk=X, dep_step_fk=X)` really does
 * refuse the delete of X. Excluding it here would have been right when this check
 * WAS the enforcement — the step would have been permanently undeletable through
 * the page — and is wrong now that the database refuses anyway: the user would
 * get a bare gateway code where a named refusal was available. No current write
 * surface can create such a row (`set_step_deps` rejects self-deps loudly), so
 * this is about the two answers agreeing, not about an input in flight.
 *
 * Sorted and de-duplicated so the message is stable: two dependency rows on one
 * step (a step gate plus a wall-clock gate) must not name it twice.
 *
 * @param {number} stepId
 * @param {Object[]} stepDeps  pipeline_step_deps rows
 * @returns {number[]}
 */
export function dropBlockers(stepId, stepDeps) {
    const blockers = new Set();
    for (const dep of asArray(stepDeps)) {
        if (!dep) continue;
        // A WALL-CLOCK row references no step and can never block a delete. The
        // test is on the ROW rather than only on the comparison because
        // `dep_step_fk` is null on those rows: a nullish `stepId` reaching here
        // would equal every one of them and refuse a legal delete, naming steps
        // that merely carry a time gate.
        if (dep.dep_step_fk == null || dep.dep_step_fk !== stepId) continue;
        blockers.add(dep.step_fk);
    }
    return [...blockers].sort((a, b) => a - b);
}

/**
 * The GATING subset of a link set — design rule 1's input, in one place.
 *
 * Used by `buildStepEditorRows` for the grid and by the page's LIVE re-read
 * before a stamp, so the displayed guard and the enforced guard cannot be two
 * different rules.
 *
 * TRACKING CONTAINERS ARE EXEMPT (req #3123): a container is not work and never
 * gates a step, so a step whose only links are containers falls through to its
 * own `completed_at` exactly as a link-less step does. Counting them would make
 * such a step permanently un-completable — the exemption's own new bug.
 *
 * An UNRESOLVED id — one the requirements read did not return — gates, because
 * `isTrackingRequirement(undefined)` is false. Nothing was read that said it is a
 * container, and refusing a stamp is the recoverable direction.
 *
 * @param {number[]} reqIds
 * @param {Object[]} requirements  any superset
 * @returns {number[]}
 */
export function gatingRequirementIds(reqIds, requirements) {
    const byId = new Map(asArray(requirements).map((r) => [r.id, r]));
    return asArray(reqIds).filter((rid) => !isTrackingRequirement(byId.get(rid)));
}

/**
 * Whether `completed_at` may be stamped on this row — design rule 1, client-side.
 *
 * The browser writes straight to Lambda-Rest, so the rule the MCP's
 * `complete_pipeline_step` enforces in Python is unenforced unless the client
 * enforces it. A requirement-backed step's state is DERIVED from its
 * requirements; a stored stamp could only ever agree with them by luck, and the
 * plan table would keep rendering the derived answer while the column quietly
 * said something else.
 *
 * THIS FUNCTION IS THE FAST PATH, NOT THE ENFORCEMENT. It answers from whatever
 * link set the caller's row was built from, which is a ≤30s cache. What actually
 * decides is StepsPage's `completeFlow`, which re-reads the step's links live
 * before any stamp and calls this again on the result. Use it to render, and to
 * refuse early; never as the last word before a write.
 *
 * ## It is deliberately STRICTER than `deriveStepState` on an unresolved id
 *
 * `buildPlanRows` filters unresolved ids out with `.filter(Boolean)` before
 * `deriveStepState` sees them, so a step whose only link is an unreadable
 * requirement DERIVES from its own stamp — while this guard counts that id and
 * refuses. The two disagree on purpose, because they answer different questions:
 * the engine asks *what does the data say this step is*, and the safest answer
 * for a row it cannot read is to fall back to the stored column. This asks *may a
 * human overwrite that column*, and the honest answer while a link is unreadable
 * is no. Such a step renders Scheduled and refuses the stamp until the read
 * recovers — visibly stuck rather than invisibly wrong.
 *
 * @param {Object} row  a step editor row
 * @returns {{allowed: boolean, reason: string}}
 */
export function completionGuard(row) {
    const gating = asArray(row && row.gatingReqIds);
    if (!gating.length) {
        return {
            allowed: true,
            reason: row && row.completedAt
                ? 'Complete — click to reopen this step'
                : 'Scheduled — click to mark this step complete',
        };
    }
    const tracking = asArray(row.trackingReqIds);
    // The verbs agree with the noun. A `${n === 1 ? '' : 's'}` that switches only
    // the noun produced "1 tracking container 3083 are exempt and were not
    // counted" — and the singular is the common case, so it was the wording most
    // readers would have seen.
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
 * Every step in every plan, decorated for the editor grid.
 *
 * Steps are grouped by `pipeline_fk` and derived one plan at a time, because the
 * engine's contract is a model scoped to ONE pipeline — the junction and dep
 * tables carry no pipeline_fk, so there is no other way to narrow them. A step
 * whose pipeline is missing from the pipelines read is still derived, against a
 * synthetic `{id: <fk>}`: an unresolved plan is a fetch problem, and dropping the
 * step would hide it from the one page that could fix it.
 *
 * `unrenderedStepIds` is the honesty channel. Any step the grouping could not
 * place — a null or non-integer `pipeline_fk` — comes back here rather than
 * vanishing, and the page says so. Silence about a dropped row on an editor page
 * is how a plan loses a step nobody can see.
 *
 * @param {Object} args  the six bounded list reads plus the three dictionaries
 * @returns {{rows: Object[], unrenderedStepIds: number[]}}
 */
export function buildStepEditorRows({
    pipelines,
    steps,
    stepRequirements,
    stepDeps,
    requirements,
    features,
    epics,
    machines,
} = {}) {
    const allSteps = asArray(steps);
    const pipelineById = new Map(asArray(pipelines).map((p) => [p.id, p]));

    // Grouped in ENCOUNTER order so the grid's default (unsorted) order follows
    // `sort=id:asc` from the read — the order the plan pages already see.
    const byPipeline = new Map();
    const unrenderedStepIds = [];
    for (const step of allSteps) {
        if (!step) continue;
        const fk = step.pipeline_fk;
        if (!Number.isInteger(fk)) {
            if (step.id != null) unrenderedStepIds.push(step.id);
            continue;
        }
        if (!byPipeline.has(fk)) byPipeline.set(fk, []);
        byPipeline.get(fk).push(step);
    }

    const rows = [];
    for (const [fk, ownSteps] of byPipeline) {
        const pipeline = pipelineById.get(fk) || null;
        const planRows = buildPlanRows(buildPipelineModel({
            // A synthetic row when the plan itself did not resolve — the engine
            // only ever reads `pipeline.id`, and every other column it would want
            // belongs to the pipelines page, not to a step.
            pipeline: pipeline || { id: fk },
            steps: ownSteps,
            stepRequirements,
            stepDeps,
            requirements,
            features,
            epics,
            machines,
        }));
        for (const planRow of planRows) {
            rows.push({
                ...planRow,
                pipelineId: fk,
                pipelineTitle: pipeline ? pipeline.title : null,
                pipelineStatus: pipeline ? pipeline.pipeline_status : null,
                // Design rule 1's input, through the SAME function the page's live
                // pre-stamp re-read uses — so what the chip shows and what the
                // write path enforces are one rule, not two that agree today.
                gatingReqIds: gatingRequirementIds(planRow.reqIds, requirements),
                blockerStepIds: dropBlockers(planRow.id, stepDeps),
            });
        }
    }

    return { rows, unrenderedStepIds };
}

/**
 * The grid's visible rows.
 *
 * `null` means "every value, including ones that do not exist yet" — the
 * ChipFilter contract (memory/chip-filter-pattern.md). An EMPTY array is a legal
 * selection meaning "show nothing" and is never auto-corrected back to all: a
 * user who deselects every chip gets an empty view, which is honest feedback that
 * the filter is doing something.
 *
 * `epicIds` (req #3373) — the plan visualizer's epic chip ↗ control lands here:
 * `row.epicId` is the SAME dominant-epic field the plan pages band by, so a
 * step spanning no epic (`epicId === null`) never matches a real filter value.
 * `StepsPage` keeps supplying `features` to the engine specifically so this
 * stays true (req #3357 code review) — a first cut of that retirement dropped
 * the read and left this filter, and the plan visualizer's already-shipped
 * epic chip that lands on it, permanently empty.
 *
 * @param {Object[]} rows
 * @param {{pipelineIds: ?number[], states: ?string[], epicIds: ?number[]}} filters
 * @returns {Object[]}
 */
export function filterStepRows(rows, { pipelineIds = null, states = null, epicIds = null } = {}) {
    return asArray(rows).filter((row) => {
        if (pipelineIds != null && !pipelineIds.includes(row.pipelineId)) return false;
        if (states != null && !states.includes(row.state)) return false;
        if (epicIds != null && !epicIds.includes(row.epicId)) return false;
        return true;
    });
}

/**
 * Complete / Running / Scheduled counts for the accounting line.
 *
 * Called on the FULL row set, never the filtered one (view-switchable-pages
 * § V7 — accounting describes the data, not the current view). The page prints
 * "N of M steps" beside it, which is where the filter's effect is stated.
 *
 * @param {Object[]} rows
 * @returns {{total: number, done: number, running: number, pending: number}}
 */
export function stepsAccounting(rows) {
    const out = { total: 0, done: 0, running: 0, pending: 0 };
    for (const row of asArray(rows)) {
        out.total += 1;
        if (row.state === STEP_DONE) out.done += 1;
        else if (row.state === STEP_RUNNING) out.running += 1;
        else out.pending += 1;
    }
    return out;
}
