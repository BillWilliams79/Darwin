// While the switch and what answers it disagree, the plan overlay reads fast,
// so the reader sees the engine come up or go down (req #3762).

import { describe, expect, it } from 'vitest';

import { engineTransitioning, otherRecordReads, recordOfThisRun } from '../usePlanEngineOverlay';

const NOW = new Date('2026-10-23T12:00:00Z');
const engine = (desired, actual, health, desiredAt = '2026-10-23 11:59:00') => ({
    state: { desired_state: desired, actual_state: actual, desired_at: desiredAt }, health,
});

describe('engineTransitioning', () => {
    it('is still coming up until the supervisor runs it and it beats', () => {
        expect(engineTransitioning(engine('on', 'stopped', 'missing'), NOW)).toBe(true);
        expect(engineTransitioning(engine('on', 'starting', 'missing'), NOW)).toBe(true);
        expect(engineTransitioning(engine('on', 'running', 'missing'), NOW)).toBe(true);
        expect(engineTransitioning(engine('on', 'running', 'ok'), NOW)).toBe(false);
        expect(engineTransitioning(engine('on', 'running', 'degraded'), NOW)).toBe(false);
    });

    it('stops waiting for a first beat after the come-up window: silent is missing', () => {
        expect(engineTransitioning(engine('on', 'running', 'missing', '2026-10-23 11:00:00'), NOW)).toBe(false);
    });

    it('is going down until the supervisor reports it stopped', () => {
        expect(engineTransitioning(engine('off', 'stopping', 'ok'), NOW)).toBe(true);
        expect(engineTransitioning(engine('off', 'stopped', 'stopped'), NOW)).toBe(false);
        expect(engineTransitioning(engine('off', 'crashed', 'stopped'), NOW)).toBe(false);
        expect(engineTransitioning(null, NOW)).toBe(false);
    });

    it('stops reading fast when the supervisor never answers', () => {
        expect(engineTransitioning(engine('on', 'stopped', 'missing', '2026-10-23 11:00:00'), NOW)).toBe(false);
        expect(engineTransitioning(engine('off', 'running', 'ok', '2026-10-23 11:00:00'), NOW)).toBe(false);
    });
});

describe('recordOfThisRun', () => {
    const state = { desired_at: '2026-10-23 11:59:00' };
    it('counts only a cycle published since the engine was switched on', () => {
        expect(recordOfThisRun({ cycle_at: '2026-10-23 11:59:30' }, state)).toBe(true);
        expect(recordOfThisRun({ cycle_at: '2026-10-22 18:00:00' }, state)).toBe(false);
        expect(recordOfThisRun({ create_ts: '2026-10-23 11:59:00' }, state)).toBe(true);
        expect(recordOfThisRun(null, state)).toBe(false);
        expect(recordOfThisRun({ cycle_at: '2026-10-22 18:00:00' }, { desired_at: null })).toBe(true);
    });
});

// req #3984 — another engine's next cycle is a new query; while it loads, its
// last record stands, so the prediction does not flash CAPACITY-UNKNOWN red.
describe('otherRecordReads', () => {
    const others = [{ key: 'p:12|i:-|m:2' }, { key: 'p:19|i:-|m:2' }];
    const ok = (data) => ({ isSuccess: true, isError: false, data });
    const pending = { isSuccess: false, isError: false, data: undefined };
    const failed = { isSuccess: false, isError: true, data: undefined };

    it('reads every loaded record as known', () => {
        const last = new Map();
        const r = otherRecordReads([ok({ id: 1 }), ok({ id: 2 })], others, last);
        expect(r).toEqual({ rows: [{ id: 1 }, { id: 2 }], known: true });
    });

    it('keeps an engine\'s last record while its next cycle loads', () => {
        const last = new Map();
        otherRecordReads([ok({ id: 1 }), ok({ id: 2 })], others, last);
        const r = otherRecordReads([pending, ok({ id: 2 })], others, last);
        expect(r).toEqual({ rows: [{ id: 1 }, { id: 2 }], known: true });
        const next = otherRecordReads([ok({ id: 3 }), ok({ id: 2 })], others, last);
        expect(next.rows[0]).toEqual({ id: 3 });
    });

    it('forgets an engine that left, so a rejoin is read afresh', () => {
        const last = new Map();
        otherRecordReads([ok({ id: 1 }), ok({ id: 2 })], others, last);
        otherRecordReads([ok({ id: 2 })], [others[1]], last);
        expect(last.has(others[0].key)).toBe(false);
        expect(otherRecordReads([pending, ok({ id: 2 })], others, last).known).toBe(false);
    });

    it('is unknown for an engine never read yet, or whose read failed', () => {
        expect(otherRecordReads([pending, ok({ id: 2 })], others, new Map()).known).toBe(false);
        const last = new Map();
        otherRecordReads([ok({ id: 1 }), ok({ id: 2 })], others, last);
        expect(otherRecordReads([failed, ok({ id: 2 })], others, last)).toEqual(
            { rows: [null, { id: 2 }], known: false });
    });
});
