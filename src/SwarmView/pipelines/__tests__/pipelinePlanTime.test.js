// pipelinePlanTime.test.js — the derived START rules behind the Plan
// visualizer's time axis (req #3201).
//
// These are the DECISIONS the requirement asked to be made explicitly rather
// than left to whatever the data happened to do, so each one is pinned here:
// which requirements count as started, what "not started" positively means,
// and the difference between FUTURE (a claim) and UNKNOWN (no claim).

import { describe, it, expect } from 'vitest';

import {
    requirementStart, stepStart, planTimeAxis, isNotYetStarted,
    TIME_DATED, TIME_FUTURE, TIME_UNKNOWN,
} from '../pipelinePlanTime';
import { TERMINAL_REQUIREMENT_STATUSES } from '../pipelineModel';

const req = (o) => ({
    id: 1, title: 't', requirement_status: 'met', feature_fk: null,
    machine_fk: null, coordination_type: 'implemented', tracking: 0,
    started_at: null, completed_at: null, ...o,
});
const row = (o) => ({ id: 1, reqIds: [], completedAt: null, epicId: 1, ...o });
const index = (reqs) => new Map(reqs.map((r) => [r.id, r]));

describe('requirementStart', () => {
    it('prefers started_at', () => {
        expect(requirementStart(req({ started_at: 'A', completed_at: 'B' }))).toBe('A');
    });

    // THE decision this requirement asked for. 820 of 960 live `met`
    // requirements have no `started_at` at all; treating them as never-started
    // banishes finished work to the right-hand future, which is the defect the
    // axis exists to fix, inverted.
    it('falls back to completed_at — terminal-without-a-start COUNTS as started', () => {
        expect(requirementStart(req({ completed_at: 'B' }))).toBe('B');
    });

    it('is null when neither stamp exists', () => {
        expect(requirementStart(req({}))).toBe(null);
        expect(requirementStart(null)).toBe(null);
    });
});

describe('stepStart', () => {
    it('takes the MINIMUM over the step\'s requirements', () => {
        const reqs = [
            req({ id: 1, completed_at: '2026-07-26T00:00:00' }),
            req({ id: 2, started_at: '2026-07-24T00:00:00' }),
        ];
        expect(stepStart(row({ reqIds: [1, 2] }), index(reqs)))
            .toEqual({ at: '2026-07-24T00:00:00', kind: TIME_DATED });
    });

    it('falls back to the STEP\'s own completed_at — the req-less gate step', () => {
        expect(stepStart(row({ reqIds: [], completedAt: '2026-07-25T00:00:00' }), new Map()))
            .toEqual({ at: '2026-07-25T00:00:00', kind: TIME_DATED });
    });

    it('is FUTURE when every requirement is positively not-yet-started', () => {
        const reqs = [
            req({ id: 1, requirement_status: 'authoring' }),
            req({ id: 2, requirement_status: 'approved' }),
            req({ id: 3, requirement_status: 'swarm_ready' }),
        ];
        expect(stepStart(row({ reqIds: [1, 2, 3] }), index(reqs)).kind).toBe(TIME_FUTURE);
    });

    // THE review finding. `deferred` is TERMINAL — deriveStepState returns
    // `done` for a step whose requirements are all terminal — so calling it
    // not-yet-started put a green checked bead in the not-yet-begun region and,
    // because the monotone max propagates FUTURE downstream, dragged that
    // step's whole subtree with it. Live case: pipeline 2 step 35 "Messaging
    // Design", requirement 3108, deferred with no stamps.
    it.each(TERMINAL_REQUIREMENT_STATUSES)(
        'never calls a step FUTURE on a terminal requirement (%s)', (status) => {
            const reqs = [req({ id: 1, requirement_status: status })];
            expect(stepStart(row({ reqIds: [1] }), index(reqs)).kind).toBe(TIME_UNKNOWN);
        });

    it('classifies not-yet-started from the ENGINE\'s terminal set, not a local list', () => {
        for (const s of TERMINAL_REQUIREMENT_STATUSES) expect(isNotYetStarted(s)).toBe(false);
        expect(isNotYetStarted('development')).toBe(false);
        for (const s of ['authoring', 'approved', 'swarm_ready']) {
            expect(isNotYetStarted(s)).toBe(true);
        }
    });

    it('is UNKNOWN, not FUTURE, when a met requirement lost both stamps', () => {
        const reqs = [
            req({ id: 1, requirement_status: 'met' }),
            req({ id: 2, requirement_status: 'authoring' }),
        ];
        expect(stepStart(row({ reqIds: [1, 2] }), index(reqs)).kind).toBe(TIME_UNKNOWN);
    });

    it('ignores links whose requirement is missing from the read', () => {
        expect(stepStart(row({ reqIds: [999] }), new Map()).kind).toBe(TIME_UNKNOWN);
    });
});

describe('planTimeAxis', () => {
    it('gives every band the MINIMUM start of its own steps, null when none started', () => {
        const reqs = [
            req({ id: 1, completed_at: '2026-07-26T00:00:00' }),
            req({ id: 2, completed_at: '2026-07-24T00:00:00' }),
            req({ id: 3, requirement_status: 'authoring' }),
        ];
        const rows = [
            row({ id: 10, epicId: 5, reqIds: [1] }),
            row({ id: 11, epicId: 5, reqIds: [2] }),
            row({ id: 12, epicId: 6, reqIds: [3] }),
            row({ id: 13, epicId: null, reqIds: [] }),
        ];
        const { stepStarts, bandStarts, bandKinds } = planTimeAxis(rows, reqs);
        expect(bandStarts.get(5)).toBe('2026-07-24T00:00:00');
        expect(bandStarts.get(6)).toBe(null);
        expect(bandStarts.get(null)).toBe(null);
        expect(stepStarts.get(12).kind).toBe(TIME_FUTURE);
        expect(stepStarts.get(13).kind).toBe(TIME_UNKNOWN);
        expect(bandKinds.get(5)).toBe(TIME_DATED);
        expect(bandKinds.get(6)).toBe(TIME_FUTURE);
        expect(bandKinds.get(null)).toBe(TIME_UNKNOWN);
    });

    // A NULL start used to mean both "has not begun" and "began, but nobody
    // stamped it", which sorted an ACTIVE epic into the backlog tier.
    it('separates an unstamped-but-active epic from a never-started one', () => {
        const reqs = [
            req({ id: 1, requirement_status: 'development' }),   // in flight, unstamped
            req({ id: 2, requirement_status: 'authoring' }),     // untouched backlog
        ];
        const rows = [
            row({ id: 1, epicId: 7, reqIds: [1] }),
            row({ id: 2, epicId: 6, reqIds: [2] }),
        ];
        const { bandStarts, bandKinds } = planTimeAxis(rows, reqs);
        expect(bandStarts.get(7)).toBe(null);
        expect(bandStarts.get(6)).toBe(null);
        expect(bandKinds.get(7)).toBe(TIME_UNKNOWN);
        expect(bandKinds.get(6)).toBe(TIME_FUTURE);
    });

    it('tolerates junk input rather than throwing on a mid-fetch render', () => {
        const { stepStarts, bandStarts } = planTimeAxis(null, null);
        expect(stepStarts.size).toBe(0);
        expect(bandStarts.size).toBe(0);
    });
});
