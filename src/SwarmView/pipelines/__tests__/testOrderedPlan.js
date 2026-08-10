// testOrderedPlan.js — a TEST-ONLY reconstruction of `orderedPlan`, deleted
// from `pipelineViewModel.js` by req #3381 (zero production callers left once
// `PipelineDetail.jsx` switched to the 2.0 composed read, which arrives
// pre-derived — nothing in the browser composes the 1.0 engine's pieces
// together any more).
//
// The 1.0 ENGINE PIECES it composed stay very much alive — `StepsPage.jsx`,
// `PipelinesPage.jsx`, and the conformance corpus against
// `darwin-mcp/services/pipeline_derive.py`, which the Primary AI's own 1.0
// orchestration still reads — so several test files still need a realistic
// `plan`-shaped fixture (order + batches + eligibility + pause + requirement
// counts) to exercise `planRenderRows`, `pipelinePlanLayout.js` and
// `pipelineEpicZoom.js` against. This is the composition `orderedPlan` used
// to be, kept as test scaffolding rather than production code — not a third
// derivation, since every step it calls is the SAME production function.

import {
    buildPlanRows, displayOrder, verifyOrder, launchBatches, eligibility,
    pauseState, serialState, aggregateRowCost, requirementCounts,
} from '../pipelineModel';
import { planTimeAxis } from '../pipelinePlanTime';

export function buildTestOrderedPlan(model, { now, costIndex = null } = {}) {
    const planRows = buildPlanRows(model || {});
    const { rows, cycleDetected, cycleStepIds, duplicateStepIds } = displayOrder(planRows);
    const violations = verifyOrder(rows);
    const batches = launchBatches(rows);

    const batchLetterByStepId = new Map();
    for (const b of batches) {
        for (const id of b.stepIds) batchLetterByStepId.set(id, b.letter);
    }

    const byId = new Map(rows.map((r) => [r.id, r]));
    const eligibleStepIds = new Set(
        rows.filter((r) => eligibility(r, byId, now)).map((r) => r.id));

    const unresolvedReqIds = [];
    for (const r of rows) {
        for (const id of r.unresolvedReqIds || []) {
            if (!unresolvedReqIds.includes(id)) unresolvedReqIds.push(id);
        }
    }

    const pause = pauseState(model || {}, rows);
    const serial = serialState(model || {}, rows);
    for (const r of rows) r.cost = aggregateRowCost(r, costIndex);
    const timeAxis = planTimeAxis(rows, (model && model.requirements) || []);

    return {
        rows,
        violations,
        timeAxis,
        batches,
        batchLetterByStepId,
        eligibleStepIds,
        cycleDetected,
        cycleStepIds,
        duplicateStepIds,
        unresolvedReqIds,
        requirementCounts: requirementCounts(model || {}),
        pause,
        serial,
    };
}
