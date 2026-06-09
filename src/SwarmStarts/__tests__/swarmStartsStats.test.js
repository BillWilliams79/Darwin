import { describe, it, expect } from 'vitest';
import { computeSwarmStartStats } from '../SwarmStartsStatsView';

const mkRow = (overrides = {}) => ({
    arguments: '',
    auto_start: 0,
    session_count: 0,
    wall_seconds: null,
    ...overrides,
});

describe('computeSwarmStartStats (req #2686)', () => {
    it('returns zeroed shape for empty input', () => {
        const s = computeSwarmStartStats([]);
        expect(s.total).toBe(0);
        expect(s.totalSessions).toBe(0);
        expect(s.avgSessionsPerInvocation).toBe(0);
        expect(s.avgSecondsPerSession).toBeNull();
        expect(s.autoStartCount).toBe(0);
        expect(s.autoStartRatio).toBe(0);
        // Histograms still have all buckets present with zero counts.
        expect(s.sessionsHistogram.map(b => b.label)).toEqual(['0','1','2','3','4','5','6+']);
        expect(s.sessionsHistogram.every(b => b.count === 0)).toBe(true);
        expect(s.wallHistogram).toHaveLength(6);
        expect(s.wallHistogram.every(b => b.count === 0)).toBe(true);
        expect(s.topPatterns).toEqual([]);
    });

    it('aggregates total sessions and avg-sessions-per-invocation', () => {
        const rows = [
            mkRow({ session_count: 0 }),
            mkRow({ session_count: 3 }),
            mkRow({ session_count: 5 }),
        ];
        const s = computeSwarmStartStats(rows);
        expect(s.total).toBe(3);
        expect(s.totalSessions).toBe(8);
        expect(s.avgSessionsPerInvocation).toBeCloseTo(8 / 3, 5);
    });

    it('computes avg-seconds-per-session as sum(wall)/sum(sessions), skipping rows with null wall or 0 sessions', () => {
        const rows = [
            mkRow({ session_count: 0, wall_seconds: 30 }),   // skipped: 0 sessions
            mkRow({ session_count: 2, wall_seconds: null }), // skipped: null wall
            mkRow({ session_count: 2, wall_seconds: 60 }),   // counts
            mkRow({ session_count: 4, wall_seconds: 120 }),  // counts
        ];
        const s = computeSwarmStartStats(rows);
        // (60 + 120) / (2 + 4) = 30
        expect(s.avgSecondsPerSession).toBeCloseTo(30, 5);
    });

    it('returns null avg-seconds-per-session when no rows qualify', () => {
        const rows = [
            mkRow({ session_count: 0, wall_seconds: 100 }),
            mkRow({ session_count: 2, wall_seconds: null }),
        ];
        const s = computeSwarmStartStats(rows);
        expect(s.avgSecondsPerSession).toBeNull();
    });

    it('buckets session_count into the histogram and collapses 6+', () => {
        const rows = [0, 0, 1, 3, 6, 8, 12].map(n => mkRow({ session_count: n }));
        const s = computeSwarmStartStats(rows);
        const counts = Object.fromEntries(s.sessionsHistogram.map(b => [b.label, b.count]));
        expect(counts['0']).toBe(2);
        expect(counts['1']).toBe(1);
        expect(counts['2']).toBe(0);
        expect(counts['3']).toBe(1);
        expect(counts['6+']).toBe(3);
    });

    it('buckets wall_seconds correctly and skips rows with null wall_seconds', () => {
        const rows = [
            mkRow({ wall_seconds: 5 }),
            mkRow({ wall_seconds: 29 }),
            mkRow({ wall_seconds: 30 }),
            mkRow({ wall_seconds: 90 }),
            mkRow({ wall_seconds: 240 }),
            mkRow({ wall_seconds: 1200 }),
            mkRow({ wall_seconds: null }), // skipped
        ];
        const s = computeSwarmStartStats(rows);
        const counts = Object.fromEntries(s.wallHistogram.map(b => [b.label, b.count]));
        expect(counts['<30s']).toBe(2);
        expect(counts['30–60s']).toBe(1);
        expect(counts['1–2m']).toBe(1);
        expect(counts['2–5m']).toBe(1);
        expect(counts['10m+']).toBe(1);
        expect(counts['5–10m']).toBe(0);
    });

    it('groups patterns by raw arguments string and orders by invocations desc', () => {
        const rows = [
            mkRow({ arguments: 'auto', session_count: 3 }),
            mkRow({ arguments: 'auto', session_count: 2 }),
            mkRow({ arguments: 'auto', session_count: 1 }),
            mkRow({ arguments: 'planned', session_count: 1 }),
            mkRow({ arguments: '',      session_count: 4 }),
            mkRow({ arguments: null,    session_count: 1 }),
        ];
        const s = computeSwarmStartStats(rows);
        expect(s.topPatterns.length).toBeGreaterThan(0);
        expect(s.topPatterns[0]).toMatchObject({ pattern: 'auto', invocations: 3, sessions: 6 });
        const empty = s.topPatterns.find(p => p.pattern === '—');
        expect(empty).toMatchObject({ invocations: 2, sessions: 5 });
        const planned = s.topPatterns.find(p => p.pattern === 'planned');
        expect(planned).toMatchObject({ invocations: 1, sessions: 1 });
    });

    it('computes average wall_seconds per pattern over rows that have it', () => {
        const rows = [
            mkRow({ arguments: 'auto', session_count: 1, wall_seconds: 60 }),
            mkRow({ arguments: 'auto', session_count: 1, wall_seconds: 120 }),
            mkRow({ arguments: 'auto', session_count: 1, wall_seconds: null }),
        ];
        const s = computeSwarmStartStats(rows);
        const auto = s.topPatterns.find(p => p.pattern === 'auto');
        expect(auto.avgWall).toBeCloseTo(90, 5);
    });

    it('counts auto-start ratio', () => {
        const rows = [
            mkRow({ auto_start: 1 }),
            mkRow({ auto_start: 0 }),
            mkRow({ auto_start: 1 }),
            mkRow({ auto_start: 0 }),
        ];
        const s = computeSwarmStartStats(rows);
        expect(s.autoStartCount).toBe(2);
        expect(s.autoStartRatio).toBe(0.5);
    });

    // Req #2747 — largest launch by requirements generated (max session_count).
    it('reports the largest launch (max session_count) with its swarm-start id', () => {
        const rows = [
            mkRow({ id: 10, session_count: 2 }),
            mkRow({ id: 11, session_count: 9 }),
            mkRow({ id: 12, session_count: 5 }),
        ];
        expect(computeSwarmStartStats(rows).maxRequirements).toEqual({ id: 11, count: 9 });
    });

    it('maxRequirements is null for empty input', () => {
        expect(computeSwarmStartStats([]).maxRequirements).toBeNull();
    });

    it('maxRequirements keeps the first row on a tie (strict >)', () => {
        const rows = [
            mkRow({ id: 1, session_count: 4 }),
            mkRow({ id: 2, session_count: 4 }),
        ];
        expect(computeSwarmStartStats(rows).maxRequirements).toEqual({ id: 1, count: 4 });
    });
});
