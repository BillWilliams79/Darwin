// orchestrationIndex.test.js — req #3435.
//
// The Orchestration box's whole derivation, exercised without a DOM: which plan
// an epic is seated in, which step carries a requirement, what the two dropdowns
// offer, and which feature an assignment writes into.
//
// THE FIXTURE MIRRORS THE LIVE SHAPE rather than an invented one: two open plans
// (one `active`, one `paused`), one `completed` plan, epics seated in one plan,
// in two, in a finished plan only, and in none at all. Every filtering rule in
// `epicOptions` has a row that only it can explain.

import { describe, it, expect } from 'vitest';
import {
    buildOrchestrationIndex,
    emptyOrchestrationIndex,
    epicForFeature,
    epicRowForFeature,
    isOpenPipeline,
    stepOptions,
} from '../orchestrationIndex';

const PIPELINES = [
    { id: 2,  title: 'Darwin',        pipeline_status: 'active',    create_ts: '2026-07-28T05:17:51' },
    { id: 79, title: 'Agent Harness', pipeline_status: 'paused',    create_ts: '2026-08-07T08:54:36' },
    { id: 5,  title: 'Retired plan',  pipeline_status: 'completed', create_ts: '2026-07-01T00:00:00' },
];

const STEPS = [
    { id: 100, pipeline_fk: 2,  title: 'Polish A',   completed_at: null },
    { id: 101, pipeline_fk: 2,  title: 'FP A',       completed_at: null },
    { id: 102, pipeline_fk: 2,  title: 'Polish done', completed_at: '2026-08-01T00:00:00' },
    { id: 103, pipeline_fk: 2,  completed_at: null },          // empty: no reqs, no title
    { id: 200, pipeline_fk: 79, title: 'FP B',       completed_at: null },
    { id: 300, pipeline_fk: 5,  title: 'Retired',    completed_at: null },
];

// Epics: 11 -> plan 2 only. 9 -> plans 2 AND 79 (tie-break exercise).
// 4 -> the completed plan only. 7 -> seated nowhere. 8 -> closed.
const EPICS = [
    { id: 11, title: "Bill's Polish #1", closed: 0, create_ts: '2026-08-09T08:01:32' },
    { id: 9,  title: 'First Principles', closed: 0, create_ts: '2026-08-04T08:09:57' },
    { id: 4,  title: 'Pipeline',         closed: 0, create_ts: '2026-07-28T05:15:14' },
    { id: 7,  title: 'Swarm Backlog',    closed: 0, create_ts: '2026-07-31T10:43:32' },
    { id: 8,  title: 'Done and dusted',  closed: 1, create_ts: '2026-07-20T00:00:00' },
];

const FEATURES = [
    // Epic 11's seats — 46 has no sort_order, 45 has one, so 45 wins.
    { id: 46, epic_fk: 11, closed: 0, sort_order: null, title: 'Seat 46' },
    { id: 45, epic_fk: 11, closed: 0, sort_order: 2, title: 'Seat 45' },
    // Epic 9's only OPEN seat is 31; 30 is closed and must not be written into.
    { id: 30, epic_fk: 9,  closed: 1, sort_order: 1, title: 'FP retired seat' },
    { id: 31, epic_fk: 9,  closed: 0, sort_order: 5, title: 'FP Seat' },
    { id: 40, epic_fk: 4,  closed: 0, sort_order: 1, title: 'Pipeline Seat' },
    // Epic 7 has NO feature at all — assignment to it is impossible.
    { id: 50, epic_fk: 8,  closed: 0, sort_order: 1, title: 'Closed epic seat' },
];

const REQUIREMENTS = [
    { id: 3435, feature_fk: 46 },   // epic 11
    { id: 3436, feature_fk: 45 },   // epic 11 too, on the finished step
    { id: 3400, feature_fk: 31 },   // epic 9
    { id: 3401, feature_fk: 30 },   // epic 9, via a CLOSED seat
    { id: 3300, feature_fk: 40 },   // epic 4
    { id: 3200, feature_fk: null }, // no epic
];

const STEP_REQUIREMENTS = [
    { step_fk: 100, requirement_fk: 3435 },  // epic 11 -> plan 2
    { step_fk: 102, requirement_fk: 3436 },  // epic 11 -> plan 2, but step is DONE
    { step_fk: 101, requirement_fk: 3400 },  // epic 9  -> plan 2
    { step_fk: 200, requirement_fk: 3401 },  // epic 9  -> plan 79 as well
    { step_fk: 300, requirement_fk: 3300 },  // epic 4  -> the COMPLETED plan only
];

const build = (over = {}) => buildOrchestrationIndex({
    pipelines: PIPELINES,
    steps: STEPS,
    stepRequirements: STEP_REQUIREMENTS,
    requirements: REQUIREMENTS,
    features: FEATURES,
    epics: EPICS,
    ...over,
});

describe('isOpenPipeline', () => {
    it('excludes only completed and aborted', () => {
        expect(isOpenPipeline({ pipeline_status: 'active' })).toBe(true);
        expect(isOpenPipeline({ pipeline_status: 'draft' })).toBe(true);
        expect(isOpenPipeline({ pipeline_status: 'paused' })).toBe(true);
        expect(isOpenPipeline({ pipeline_status: 'completed' })).toBe(false);
        expect(isOpenPipeline({ pipeline_status: 'aborted' })).toBe(false);
    });

    // A status nobody has invented yet is far more likely to be workable than
    // finished, so the unknown case must fall on the OFFERED side.
    it('treats an unknown status as open', () => {
        expect(isOpenPipeline({ pipeline_status: 'quiesced' })).toBe(true);
    });
});

describe('buildOrchestrationIndex — epic -> pipeline', () => {
    it('seats an epic in the plan its requirements step through', () => {
        const idx = build();
        expect([...idx.epicPipelineIds.get(11)]).toEqual([2]);
        expect([...idx.epicPipelineIds.get(9)].sort()).toEqual([2, 79]);
        expect([...idx.epicPipelineIds.get(4)]).toEqual([5]);
        expect(idx.epicPipelineIds.has(7)).toBe(false);
    });

    // `_resolve_pipeline`'s rule (req #3186): active first, then lowest id.
    it('resolves a multi-plan epic to the ACTIVE plan', () => {
        expect(build().epicPrimaryPipeline.get(9)).toBe(2);
    });

    it('falls back to the lowest id when none is active', () => {
        const idx = build({
            pipelines: PIPELINES.map((p) => ({ ...p, pipeline_status: 'paused' })),
        });
        expect(idx.epicPrimaryPipeline.get(9)).toBe(2);
    });

    // Nothing in the gateway promises these stay JSON numbers, and a string id
    // would index as a different epic — silently rendering "no epic" for a
    // requirement that plainly has one.
    it('coerces string ids from the wire', () => {
        const idx = build({
            requirements: [{ id: '3435', feature_fk: '46' }],
            stepRequirements: [{ step_fk: '100', requirement_fk: '3435' }],
            steps: [{ id: '100', pipeline_fk: '2' }],
            features: [{ id: '46', epic_fk: '11', closed: 0, sort_order: null }],
        });
        expect([...idx.epicPipelineIds.get(11)]).toEqual([2]);
        expect(idx.requirementSeat.get(3435)).toEqual({ pipelineId: 2, stepId: 100 });
    });
});

describe('buildOrchestrationIndex — requirement seat', () => {
    it('names the step and the plan carrying a requirement', () => {
        expect(build().requirementSeat.get(3435)).toEqual({ pipelineId: 2, stepId: 100 });
    });

    it('has no seat for an unseated requirement', () => {
        expect(build().requirementSeat.has(3200)).toBe(false);
    });

    // A step from the LOSING plan paired with the winning plan's id links to a
    // step that is not on that plan, which the visualizer correctly refuses to
    // focus. Lowest step id WITHIN the chosen plan.
    it('pairs the step with the plan that won the tie-break', () => {
        const idx = build({
            stepRequirements: [
                { step_fk: 200, requirement_fk: 3435 },   // paused plan 79
                { step_fk: 101, requirement_fk: 3435 },   // active plan 2
                { step_fk: 100, requirement_fk: 3435 },   // active plan 2, lower id
            ],
        });
        expect(idx.requirementSeat.get(3435)).toEqual({ pipelineId: 2, stepId: 100 });
    });
});

describe('epicForFeature', () => {
    it('resolves through the feature seat', () => {
        expect(epicForFeature(build(), 46)).toBe(11);
        expect(epicForFeature(build(), '31')).toBe(9);
    });

    it('is null for no feature and for an unknown one', () => {
        expect(epicForFeature(build(), null)).toBe(null);
        expect(epicForFeature(build(), 9999)).toBe(null);
    });
});

const labels = (entries) => entries.map((e) => e.label);
const stepIds = (entries) => entries.map((e) => e.step.id);

describe('buildOrchestrationIndex — a step\'s epic', () => {
    // No step carries `epic_fk`; its epic is the DOMINANT epic of its
    // requirements — design rule 10, the same answer the plan table's Epic column
    // shows. A per-page rule would make the two disagree.
    it('derives the dominant epic of a step from its requirements', () => {
        const idx = build();
        expect(idx.epicByStep.get(100)).toBe(11);
        expect(idx.epicByStep.get(101)).toBe(9);
        expect(idx.epicByStep.get(300)).toBe(4);
    });

    it('leaves a step with no requirements undetermined, not zero', () => {
        expect(build().epicByStep.has(103)).toBe(false);
    });

    it('breaks a dominance tie on the LOWEST epic id, deterministically', () => {
        const idx = build({
            stepRequirements: [
                { step_fk: 100, requirement_fk: 3435 },   // epic 11
                { step_fk: 100, requirement_fk: 3400 },   // epic 9
            ],
        });
        expect(idx.epicByStep.get(100)).toBe(9);
    });

    it('takes the majority when there is one', () => {
        const idx = build({
            stepRequirements: [
                { step_fk: 100, requirement_fk: 3435 },   // epic 11
                { step_fk: 100, requirement_fk: 3436 },   // epic 11
                { step_fk: 100, requirement_fk: 3400 },   // epic 9
            ],
        });
        expect(idx.epicByStep.get(100)).toBe(11);
    });
});

describe('stepOptions', () => {
    it('offers the open steps of the given plan and epic', () => {
        // Plan 2, epic 11: step 100 (epic 11, open) and step 103 (no epic yet).
        // 102 is epic 11 but DONE; 101 is epic 9; 200 is another plan.
        expect(stepIds(stepOptions(build(), { pipelineId: 2, epicId: 11 })))
            .toEqual([100, 103]);
    });

    // A finished step is not a place to put new work, and seating a requirement
    // on one would contradict design rule 1 — a stamped `completed_at` is valid
    // only with zero gating requirements.
    it('never offers a completed step', () => {
        expect(stepIds(stepOptions(build(), { pipelineId: 2, epicId: 11 })))
            .not.toContain(102);
        expect(stepIds(stepOptions(build(), {}))).not.toContain(102);
    });

    // A step created empty belongs to no epic yet. Excluding it would make it
    // unreachable from every requirement — and it is the natural first target.
    it('offers an epic-less step under every epic', () => {
        expect(stepIds(stepOptions(build(), { pipelineId: 2, epicId: 11 }))).toContain(103);
        expect(stepIds(stepOptions(build(), { pipelineId: 2, epicId: 9 }))).toContain(103);
    });

    it('excludes steps of another plan', () => {
        expect(stepIds(stepOptions(build(), { pipelineId: 2, epicId: 9 })))
            .not.toContain(200);
    });

    it('drops the epic filter when the requirement has no epic', () => {
        expect(stepIds(stepOptions(build(), { pipelineId: 2 }))).toEqual([100, 101, 103]);
    });

    // With no plan known the list widens to every OPEN plan rather than
    // emptying: a requirement seated nowhere and with no epic still has to be
    // placeable, or the control is dead exactly when it is needed.
    it('widens to every open plan when no plan is known', () => {
        // Plan 5 is `completed`, so step 300 stays out.
        expect(stepIds(stepOptions(build(), {}))).toEqual([100, 101, 103, 200]);
    });

    // A select whose own list denies its value renders blank, which reads as a
    // data bug rather than as a filter.
    it('always offers the current step, first, whatever the filters say', () => {
        // Step 200 is on another plan AND another epic.
        expect(stepIds(stepOptions(build(),
            { pipelineId: 2, epicId: 11, currentStepId: 200 })))
            .toEqual([200, 100, 103]);
        // ...including a completed one the reader is already seated on.
        expect(stepIds(stepOptions(build(),
            { pipelineId: 2, epicId: 11, currentStepId: 102 })))
            .toEqual([102, 100, 103]);
    });

    it('never lists the current step twice', () => {
        const ids = stepIds(stepOptions(build(),
            { pipelineId: 2, epicId: 11, currentStepId: 100 }));
        expect(ids).toEqual([100, 103]);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('invents a row for a current step missing from the read', () => {
        const [first] = stepOptions(build(), { currentStepId: 9999 });
        expect(first).toMatchObject({ label: 'Step 9999' });
        expect(first.step.id).toBe(9999);
    });

    it('labels by title, falling back to the id', () => {
        const entries = stepOptions(build(), { pipelineId: 2, epicId: 11 });
        expect(labels(entries)).toEqual(['Polish A', 'Step 103']);
    });

    // Step id ascending is the canonical stored order (`pipelineSteps` sorts
    // `id:asc`, and that is load-bearing for the plan engine's tie-breaks). True
    // display order would mean loading the whole plan to order one dropdown.
    it('orders by step id ascending', () => {
        const idx = build({
            steps: [...STEPS].reverse(),
        });
        expect(stepIds(stepOptions(idx, { pipelineId: 2 }))).toEqual([100, 101, 103]);
    });

    // The chained `requirements` read failing empties `epicByStep`, so every step
    // reads as "no epic yet" and passes the filter. Widening is the safe
    // direction — more steps offered, never silently fewer.
    it('widens rather than empties when the epic map is unavailable', () => {
        const blind = build({ requirements: [] });
        expect(stepIds(stepOptions(blind, { pipelineId: 2, epicId: 11 })))
            .toEqual([100, 101, 103]);
    });
});

describe('epicRowForFeature', () => {
    it('names the epic a feature sits under', () => {
        expect(epicRowForFeature(build(), 46)).toMatchObject({ id: 11 });
        expect(epicRowForFeature(build(), null)).toBe(null);
    });

    it('invents a row for an epic missing from the read', () => {
        const idx = build({ epics: [] });
        expect(epicRowForFeature(idx, 46)).toMatchObject({ id: 11, title: 'Epic 11' });
    });
});

describe('emptyOrchestrationIndex', () => {
    // Consumers read `.get(...)` on every map on the very first render, before
    // any read has landed.
    it('answers every lookup without throwing', () => {
        const idx = emptyOrchestrationIndex();
        expect(idx.requirementSeat.get(1)).toBeUndefined();
        expect(idx.epicsById.get(1)).toBeUndefined();
        expect(idx.epicPipelineIds.get(1)).toBeUndefined();
        expect(idx.epicByStep.get(1)).toBeUndefined();
        expect(epicForFeature(idx, 46)).toBe(null);
        expect(epicRowForFeature(idx, 46)).toBe(null);
        expect(stepOptions(idx)).toEqual([]);
    });
});
