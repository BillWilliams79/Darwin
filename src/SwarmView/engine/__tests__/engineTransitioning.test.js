// While the switch and what answers it disagree, the plan overlay reads fast,
// so the reader sees the engine come up or go down (req #3762).

import { describe, expect, it } from 'vitest';

import { engineTransitioning, recordOfThisRun } from '../usePlanEngineOverlay';

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
