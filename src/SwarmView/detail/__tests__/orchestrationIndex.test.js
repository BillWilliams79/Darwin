// orchestrationIndex.test.js — req #3435, narrowed by req #3357.
//
// The Orchestration box's whole derivation, exercised without a DOM: which plan
// and step carry a requirement, and what the Step dropdown offers.
//
// req #3357 retired the Epic row and its derivation (`epicByFeature`,
// `epicByStep`, `epicPrimaryPipeline`, `epicForFeature`, `epicRowForFeature`,
// and `stepOptions`'s `epicId` scoping) — Feature left the frontend and no
// replacement existed for 1.0. See `orchestrationIndex.js`'s header.
//
// req #3356 RE-BASED THE WHOLE INDEX ON PIPELINE 2.0, and the fixture below
// carries the one structural difference: a 2.0 step has NO `pipeline_fk`. Its
// plan comes through `epic_fk -> pipeline2_epics.pipeline_fk`, so there is an
// EPICS fixture now and the join is two hops. Everything else — the open/closed
// status vocabulary, `completed_at`, the id-ascending order — is unchanged,
// which is why the assertions are.
//
// THE FIXTURE MIRRORS THE LIVE SHAPE rather than an invented one: two open plans
// (one `active`, one `paused`), one `completed` plan. Every filtering rule in
// `stepOptions` has a row that only it can explain.

import { describe, it, expect } from 'vitest';
import {
    buildOrchestrationIndex,
    emptyOrchestrationIndex,
    isOpenPipeline,
    stepOptions,
} from '../orchestrationIndex';

const PIPELINES = [
    { id: 2,  title: 'Darwin',        pipeline_status: 'active',    create_ts: '2026-07-28T05:17:51' },
    { id: 79, title: 'Agent Harness', pipeline_status: 'paused',    create_ts: '2026-08-07T08:54:36' },
    { id: 5,  title: 'Retired plan',  pipeline_status: 'completed', create_ts: '2026-07-01T00:00:00' },
];

// The MIDDLE HOP. One epic per plan is enough for every rule under test; the
// plan-scoping cases turn on which PLAN a step reaches, not on which epic.
const EPICS = [
    { id: 20, pipeline_fk: 2 },
    { id: 79 * 10, pipeline_fk: 79 },
    { id: 50, pipeline_fk: 5 },
];

const STEPS = [
    { id: 100, epic_fk: 20,  title: 'Polish A',   completed_at: null },
    { id: 101, epic_fk: 20,  title: 'FP A',       completed_at: null },
    { id: 102, epic_fk: 20,  title: 'Polish done', completed_at: '2026-08-01T00:00:00' },
    { id: 103, epic_fk: 20,  completed_at: null },          // empty: no reqs, no title
    { id: 200, epic_fk: 790, title: 'FP B',       completed_at: null },
    { id: 300, epic_fk: 50,  title: 'Retired',    completed_at: null },
];

const STEP_REQUIREMENTS = [
    { step_fk: 100, requirement_fk: 3435 },
    { step_fk: 102, requirement_fk: 3436 },  // step is DONE
    { step_fk: 101, requirement_fk: 3400 },
    { step_fk: 200, requirement_fk: 3401 },  // paused plan
    { step_fk: 300, requirement_fk: 3300 },  // the COMPLETED plan only
];

const build = (over = {}) => buildOrchestrationIndex({
    pipelines: PIPELINES,
    epics: EPICS,
    steps: STEPS,
    stepRequirements: STEP_REQUIREMENTS,
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

    // Nothing in the gateway promises these stay JSON numbers, and a string id
    // would index as a different step — silently rendering "no seat" for a
    // requirement that plainly has one.
    it('coerces string ids from the wire', () => {
        const idx = build({
            stepRequirements: [{ step_fk: '100', requirement_fk: '3435' }],
            steps: [{ id: '100', epic_fk: '20' }],
            epics: [{ id: '20', pipeline_fk: '2' }],
            pipelines: [{ id: '2', title: 'Darwin', pipeline_status: 'active' }],
        });
        expect(idx.requirementSeat.get(3435)).toEqual({ pipelineId: 2, stepId: 100 });
    });

    // THE EPIC IS THE ONLY ROUTE FROM A STEP TO A PLAN under 2.0. A step whose
    // epic is missing from the read reaches no plan, so it seats nothing —
    // dropped rather than invented, because pinning a requirement to a plan that
    // was never read is worse than reporting no seat at all.
    it('drops a seat whose step names an epic the read does not carry', () => {
        const idx = build({ steps: [{ id: 100, epic_fk: 999, completed_at: null }] });
        expect(idx.requirementSeat.has(3435)).toBe(false);
    });

    it('drops a seat whose step names no epic at all', () => {
        const idx = build({ steps: [{ id: 100, epic_fk: null, completed_at: null }] });
        expect(idx.requirementSeat.has(3435)).toBe(false);
    });
});

const labels = (entries) => entries.map((e) => e.label);
const stepIds = (entries) => entries.map((e) => e.step.id);

describe('stepOptions', () => {
    it('offers the open steps of the given plan', () => {
        // Plan 2: steps 100, 101, 103 are open; 102 is DONE.
        expect(stepIds(stepOptions(build(), { pipelineId: 2 })))
            .toEqual([100, 101, 103]);
    });

    // A finished step is not a place to put new work, and seating a requirement
    // on one would contradict design rule 1 — a stamped `completed_at` is valid
    // only with zero gating requirements.
    it('never offers a completed step', () => {
        expect(stepIds(stepOptions(build(), { pipelineId: 2 }))).not.toContain(102);
        expect(stepIds(stepOptions(build(), {}))).not.toContain(102);
    });

    it('excludes steps of another plan', () => {
        expect(stepIds(stepOptions(build(), { pipelineId: 2 }))).not.toContain(200);
    });

    // With no plan known the list widens to every OPEN plan rather than
    // emptying: a requirement seated nowhere still has to be placeable, or the
    // control is dead exactly when it is needed.
    it('widens to every open plan when no plan is known', () => {
        // Plan 5 is `completed`, so step 300 stays out.
        expect(stepIds(stepOptions(build(), {}))).toEqual([100, 101, 103, 200]);
    });

    // A select whose own list denies its value renders blank, which reads as a
    // data bug rather than as a filter.
    it('always offers the current step, first, whatever the filters say', () => {
        // Step 200 is on another plan.
        expect(stepIds(stepOptions(build(), { pipelineId: 2, currentStepId: 200 })))
            .toEqual([200, 100, 101, 103]);
        // ...including a completed one the reader is already seated on.
        expect(stepIds(stepOptions(build(), { pipelineId: 2, currentStepId: 102 })))
            .toEqual([102, 100, 101, 103]);
    });

    it('never lists the current step twice', () => {
        const ids = stepIds(stepOptions(build(), { pipelineId: 2, currentStepId: 100 }));
        expect(ids).toEqual([100, 101, 103]);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('invents a row for a current step missing from the read', () => {
        const [first] = stepOptions(build(), { currentStepId: 9999 });
        expect(first).toMatchObject({ label: 'Step 9999' });
        expect(first.step.id).toBe(9999);
    });

    it('labels by title, falling back to the id', () => {
        const entries = stepOptions(build(), { pipelineId: 2 });
        expect(labels(entries)).toEqual(['Polish A', 'FP A', 'Step 103']);
    });

    // Step id ascending is the canonical stored order (`pipelineSteps` sorts
    // `id:asc`, and that is load-bearing for the plan engine's tie-breaks). True
    // display order would mean loading the whole plan to order one dropdown.
    it('orders by step id ascending', () => {
        const idx = build({ steps: [...STEPS].reverse() });
        expect(stepIds(stepOptions(idx, { pipelineId: 2 }))).toEqual([100, 101, 103]);
    });

    // A step with no resolvable plan is in NEITHER list: it cannot match a named
    // plan, and nothing can vouch for its plan being open.
    it('never offers a step whose epic did not resolve', () => {
        const idx = build({ steps: [...STEPS, { id: 400, epic_fk: 999, completed_at: null }] });
        expect(stepIds(stepOptions(idx, { pipelineId: 2 }))).not.toContain(400);
        expect(stepIds(stepOptions(idx, {}))).not.toContain(400);
    });
});

describe('emptyOrchestrationIndex', () => {
    // Consumers read `.get(...)` on every map on the very first render, before
    // any read has landed.
    it('answers every lookup without throwing', () => {
        const idx = emptyOrchestrationIndex();
        expect(idx.requirementSeat.get(1)).toBeUndefined();
        expect(idx.stepsById.get(1)).toBeUndefined();
        expect(idx.pipelineByStep.get(1)).toBeUndefined();
        expect(stepOptions(idx)).toEqual([]);
    });
});
