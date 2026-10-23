// The engine-off prediction is decide()'s answer (req #3762).
//
// `enginePredict.js` transcribes core.py `decide()` for a first cycle so the
// plan overlay can say what would launch with no engine running. This replays
// every cycle of the scenario corpus — the inputs and decide()'s own answer,
// both written by scripts/swarm/engine2/overlay_fixture.py — through the
// browser copy and fails on any difference: a code, a detail, a position, the
// cut, a limit, the verdict or its sentence.

import { describe, expect, it } from 'vitest';

import fixture from './planOverlayFixture.json';
import { epicHold, parseTime, predictRecord, validatePayload } from '../enginePredict';

const LIMIT_KEYS = ['ceiling', 'live', 'reserved', 'free'];

const answerOf = (record) => ({
    role: record.location.role,
    verdict: record.cycle.verdict,
    verdict_detail: record.cycle.verdict_detail,
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, record.limits[k]])),
    in_flight_req_ids: record.limits.in_flight_req_ids,
    queue: record.queue,
    cut: record.cut,
    epics: record.epics,
});

describe('predictRecord — decide() on every cycle of the corpus, as a first cycle', () => {
    it('covers the whole corpus', () => {
        expect(fixture.predictions.length).toBeGreaterThan(50);
        const scenarios = new Set(fixture.predictions.map((p) => p.scenario));
        expect(scenarios.size).toBeGreaterThanOrEqual(25);
    });

    it.each(fixture.predictions.map((p) => [`${p.scenario} #${p.cycle}`, p]))('%s', (_, p) => {
        const { payload, capacity, claims, clock } = p.inputs;
        expect(answerOf(predictRecord(payload, capacity, claims, clock))).toEqual(p.expect);
    });

    it('every hold code a first cycle can produce is produced somewhere', () => {
        const codes = new Set();
        for (const p of fixture.predictions) {
            for (const e of p.expect.epics) codes.add(e.code);
            for (const q of p.expect.queue) codes.add(q.code);
        }
        for (const code of ['ENGINE_HOLD', 'PAUSED', 'SERIAL_TURN', 'BARRIER', 'NOT_BEFORE',
            'NO_WORK', 'MANUAL', 'MACHINE_PIN', 'DEP_PRIORITY', 'CAPACITY', 'ADMITTED']) {
            expect(codes, code).toContain(code);
        }
        // A first cycle has no prior record, so nothing is in flight.
        expect(codes).not.toContain('IN_FLIGHT');
    });
});

describe('the browser\'s inputs for a plan page — the actions\' predictions', () => {
    it.each(fixture.actions.flatMap((a) => a.states.map((s, i) => [`${a.action} #${i}`, s])))(
        '%s', (_, state) => {
            const pipelineId = state.payload.pipeline.id;
            const wouldBe = Math.max(0, ...state.claims.map((c) => c.id)) + 1;
            const claims = {
                own: { claim_id: wouldBe, machine_fk: fixture.this_machine, terminal_pid: null,
                    engine_pid: null, pipeline_id: pipelineId, initiative_id: null },
                live: [...state.claims, { id: wouldBe, pipeline_fk: pipelineId, initiative_fk: null,
                    machine_fk: fixture.this_machine, stale: false }],
                proven: true,
            };
            const capacity = { ceiling: state.ceiling, live: state.live_sessions, reserved_elsewhere: 0 };
            const got = predictRecord(state.payload, capacity, claims, { now: state.clock });
            expect(answerOf(got)).toEqual(state.predicted);
        });
});

describe('the pieces', () => {
    it('parses stamps the way core.py does — naive is UTC', () => {
        expect(parseTime('2026-10-22T08:00:00Z').toISOString()).toBe('2026-10-22T08:00:00.000Z');
        expect(parseTime('2026-10-22 08:00:00').toISOString()).toBe('2026-10-22T08:00:00.000Z');
        expect(parseTime('2026-10-22T08:00:00+00:00').toISOString()).toBe('2026-10-22T08:00:00.000Z');
        expect(parseTime('')).toBeNull();
        expect(parseTime(null)).toBeNull();
        expect(parseTime('not a time')).toBeNull();
    });

    it('takes the first epic-level code in precedence order', () => {
        const row = { suppressed_by: ['initiative', 'turn'], checkpoint_blocked_by: [7],
            launch_req_ids: [1], launch_candidate: true, run: 'manual' };
        expect(epicHold(row, {}, null)).toEqual(['PAUSED', { by: ['initiative'] }]);
        expect(epicHold({ ...row, suppressed_by: ['turn'] }, { live_initiative_id: 4 }, null))
            .toEqual(['SERIAL_TURN', { live_initiative_id: 4 }]);
        expect(epicHold({ ...row, suppressed_by: [] }, {}, null))
            .toEqual(['BARRIER', { barrier_epic_ids: [7] }]);
        expect(epicHold({ ...row, suppressed_by: [], checkpoint_blocked_by: [] }, {}, null))
            .toEqual(['MANUAL', { requirement_ids: [1] }]);
        expect(epicHold({ launch_req_ids: [], no_launch_reason: 'none ready' }, {}, null))
            .toEqual(['NO_WORK', { reason: 'none ready' }]);
        expect(epicHold({ launch_req_ids: [1], launch_candidate: true, run: 'auto' }, {}, null))
            .toEqual([null, null]);
    });

    it('names a payload it cannot trust in the engine\'s own verdicts', () => {
        expect(validatePayload(null, 1, null)).toEqual(['FATAL', 'no plan payload']);
        expect(validatePayload({ _truncated: true }, 1, null))
            .toEqual(['BUDGET-ROWS-TRUNCATED', 'payload carries _truncated']);
        expect(validatePayload({ pipeline: { id: 1 }, epics: [] }, 1, null))
            .toEqual(['NO-DERIVATION', 'the composed read carries no derived block']);
        expect(validatePayload({ pipeline: { id: 1 }, epics: [],
            derived: { withheld: true, withheld_reason: 'derivation_failed', reason: null } }, 1, null))
            .toEqual(['DERIVATION-FAILED', 'derivation_failed: None']);
    });
});
