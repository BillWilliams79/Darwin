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

// Req #2811 — token / turn / throughput analytics brought to parity with completes.
describe('computeSwarmStartStats — token/turn/throughput (req #2811)', () => {
    it('zeroed shape exposes the new fields for empty input', () => {
        const s = computeSwarmStartStats([]);
        expect(s.inputTotal).toBe(0);
        expect(s.cacheWriteTotal).toBe(0);
        expect(s.cacheReadTotal).toBe(0);
        expect(s.outputTotal).toBe(0);
        expect(s.totalTokens).toBe(0);
        expect(s.avgTokensPerInvocation).toBe(0);
        expect(s.cacheHitRate).toBeNull();
        expect(s.avgTurns).toBeNull();
        expect(s.turnsHistogram.map(b => b.label)).toEqual(['<10','10–20','20–30','30–50','50+']);
        expect(s.turnsHistogram.every(b => b.count === 0)).toBe(true);
        expect(s.throughput).toEqual([]);
    });

    it('sums the four token columns and averages per invocation', () => {
        const rows = [
            mkRow({ tokens_input: 100, tokens_cache_write: 200, tokens_cache_read: 300, tokens_output: 400 }),
            mkRow({ tokens_input: 0,   tokens_cache_write: 0,   tokens_cache_read: 700, tokens_output: 300 }),
        ];
        const s = computeSwarmStartStats(rows);
        expect(s.inputTotal).toBe(100);
        expect(s.cacheWriteTotal).toBe(200);
        expect(s.cacheReadTotal).toBe(1000);
        expect(s.outputTotal).toBe(700);
        expect(s.totalTokens).toBe(2000);
        expect(s.avgTokensPerInvocation).toBe(1000);
    });

    it('treats missing token columns as zero', () => {
        const s = computeSwarmStartStats([mkRow({})]);
        expect(s.totalTokens).toBe(0);
        expect(s.avgTokensPerInvocation).toBe(0);
        expect(s.cacheHitRate).toBeNull();
    });

    it('computes cache hit rate as cacheRead / (cacheRead + cacheWrite + input)', () => {
        const rows = [
            mkRow({ tokens_input: 100, tokens_cache_write: 100, tokens_cache_read: 800, tokens_output: 50 }),
        ];
        const s = computeSwarmStartStats(rows);
        // 800 / (800 + 100 + 100) = 0.8; output is excluded from the denominator.
        expect(s.cacheHitRate).toBeCloseTo(0.8, 5);
    });

    it('buckets turn_count and skips null turns; averages over present rows', () => {
        const rows = [
            mkRow({ turn_count: 5 }),
            mkRow({ turn_count: 12 }),
            mkRow({ turn_count: 25 }),
            mkRow({ turn_count: 40 }),
            mkRow({ turn_count: 60 }),
            mkRow({ turn_count: null }), // skipped
        ];
        const s = computeSwarmStartStats(rows);
        const counts = Object.fromEntries(s.turnsHistogram.map(b => [b.label, b.count]));
        expect(counts['<10']).toBe(1);
        expect(counts['10–20']).toBe(1);
        expect(counts['20–30']).toBe(1);
        expect(counts['30–50']).toBe(1);
        expect(counts['50+']).toBe(1);
        // avg over the 5 non-null rows: (5+12+25+40+60)/5 = 28.4
        expect(s.avgTurns).toBeCloseTo(28.4, 5);
    });

    it('returns null avgTurns when every row has null turn_count', () => {
        const s = computeSwarmStartStats([mkRow({ turn_count: null }), mkRow({ turn_count: null })]);
        expect(s.avgTurns).toBeNull();
    });

    it('builds a throughput series by calendar day, sorted ascending, with token totals', () => {
        const rows = [
            mkRow({ started_at: '2026-06-10T08:00:00', tokens_output: 100 }),
            mkRow({ started_at: '2026-06-10T20:00:00', tokens_output: 50  }),
            mkRow({ started_at: '2026-06-09T12:00:00', tokens_output: 200 }),
            mkRow({ started_at: null, tokens_output: 999 }), // skipped — no date
        ];
        const s = computeSwarmStartStats(rows);
        expect(s.throughput).toEqual([
            { date: '2026-06-09', count: 1, tokens: 200 },
            { date: '2026-06-10', count: 2, tokens: 150 },
        ]);
    });

    it('adds per-pattern avgTokens to topPatterns', () => {
        const rows = [
            mkRow({ arguments: 'auto', tokens_output: 100 }),
            mkRow({ arguments: 'auto', tokens_output: 300 }),
            mkRow({ arguments: 'planned', tokens_output: 50 }),
        ];
        const s = computeSwarmStartStats(rows);
        const auto = s.topPatterns.find(p => p.pattern === 'auto');
        const planned = s.topPatterns.find(p => p.pattern === 'planned');
        expect(auto.avgTokens).toBe(200);  // (100 + 300) / 2
        expect(planned.avgTokens).toBe(50);
    });
});

// Req #2811 — Phase Cost Leaderboard parsed from each start's TOKEN_TELEMETRY blob.
const telemetryWith = (phases) =>
    `--- TELEMETRY START ---\nstatus=ok\n--- TELEMETRY END ---\n` +
    `TOKEN_TELEMETRY:\n${JSON.stringify({ schema_version: 2, phases }, null, 2)}\n`;

// Req #2819 — leaderboard is now average-based: per-phase avgTokens + avgWall,
// and % of Total is the avgTokens share (denominator = Σ avgTokens over ALL phases).
describe('computeSwarmStartStats — phase cost leaderboard (req #2811, avg-based req #2819)', () => {
    it('empty input exposes phaseAggregate/[] and phaseAvgTokenTotal 0', () => {
        const s = computeSwarmStartStats([]);
        expect(s.phaseAggregate).toEqual([]);
        expect(s.phaseAvgTokenTotal).toBe(0);
    });

    it('rows without telemetry produce an empty leaderboard', () => {
        const s = computeSwarmStartStats([mkRow({}), mkRow({ telemetry: 'no json here' })]);
        expect(s.phaseAggregate).toEqual([]);
        expect(s.phaseAvgTokenTotal).toBe(0);
    });

    it('aggregates per-phase avg tokens + avg wall across rows, sorted by avgTokens desc', () => {
        const rows = [
            mkRow({ telemetry: telemetryWith({
                swarm_start: { input: 10, output: 5, cache_write: 0, cache_read: 5, wall_seconds: 3 },
                phase_A0:    { input: 0,  output: 0, cache_write: 100, cache_read: 0, wall_seconds: 1 },
            }) }),
            mkRow({ telemetry: telemetryWith({
                swarm_start: { input: 0, output: 0, cache_write: 0, cache_read: 20, wall_seconds: 2 },
            }) }),
        ];
        const s = computeSwarmStartStats(rows);
        // swarm_start: row1 total 20 + row2 total 20 = 40 over 2 invocations → avg 20; wall 3+2=5 → avg 2.5.
        // phase_A0: 100 over 1 invocation → avg 100; wall 1 → avg 1.
        const ss = s.phaseAggregate.find(p => p.phase === 'swarm_start');
        const a0 = s.phaseAggregate.find(p => p.phase === 'phase_A0');
        expect(ss).toMatchObject({ invocations: 2, avgTokens: 20 });
        expect(ss.avgWall).toBeCloseTo(2.5, 5);
        expect(a0).toMatchObject({ invocations: 1, avgTokens: 100, avgWall: 1 });
        // No raw totals exposed on the leaderboard rows any more.
        expect(ss.tokens).toBeUndefined();
        expect(ss.wall).toBeUndefined();
        // Sorted by avgTokens desc → phase_A0 (100) before swarm_start (20).
        expect(s.phaseAggregate[0].phase).toBe('phase_A0');
        // phaseAvgTokenTotal = 100 + 20 = 120; pctOfTotal reflects the avg share.
        expect(s.phaseAvgTokenTotal).toBe(120);
        expect(a0.pctOfTotal).toBeCloseTo((100 / 120) * 100, 5);
    });

    it('limits the leaderboard to the top 12 phases by avgTokens', () => {
        const phases = {};
        for (let i = 0; i < 20; i++) {
            phases[`phase_${i}`] = { input: i + 1, output: 0, cache_write: 0, cache_read: 0, wall_seconds: 0 };
        }
        const s = computeSwarmStartStats([mkRow({ telemetry: telemetryWith(phases) })]);
        expect(s.phaseAggregate).toHaveLength(12);
        // Highest-avg phase first (phase_19 → 20 tokens over 1 invocation = avg 20).
        expect(s.phaseAggregate[0].phase).toBe('phase_19');
        // phaseAvgTokenTotal counts ALL 20 phases, not just the top 12. One invocation
        // each → avgTokens == tokens, so the denominator is Σ(1..20).
        const allSum = Array.from({ length: 20 }, (_, i) => i + 1).reduce((a, b) => a + b, 0);
        expect(s.phaseAvgTokenTotal).toBe(allSum);
    });
});
