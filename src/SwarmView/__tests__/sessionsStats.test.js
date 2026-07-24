import { describe, it, expect } from 'vitest';
import { computeSessionStats } from '../SessionsStatsView';

// A fully-zeroed instrumented session; override the phases you care about.
const mkSession = (overrides = {}) => ({
    swarm_status: 'completed',
    instrumented: 1,
    starting_secs: 0,
    waiting_secs: 0,
    planning_secs: 0,
    implementing_secs: 0,
    review_secs: 0,
    completion_secs: 0,
    paused_secs: 0,
    legacy_secs: 0,
    started_at: null,
    ...overrides,
});

const phaseOf = (stats, key) => stats.phaseAggregate.find(p => p.key === key);

describe('computeSessionStats (req #2825)', () => {
    it('returns zeroed shape for empty input', () => {
        const s = computeSessionStats([]);
        expect(s.total).toBe(0);
        expect(s.instrumentedCount).toBe(0);
        expect(s.legacyCount).toBe(0);
        expect(s.totalTrackedSecs).toBe(0);
        expect(s.avgDuration).toBeNull();
        expect(s.medianDuration).toBeNull();
        expect(s.phaseAggregate).toEqual([]);
        expect(s.durationHistogram).toHaveLength(6);
        expect(s.statusHistogram).toHaveLength(8);
        expect(s.trend).toEqual([]);
        expect(s.groupSplit.map(g => g.group)).toEqual(['agentic', 'human', 'machine']);
    });

    it('excludes legacy sessions from instrumented aggregates but counts them', () => {
        const rows = [
            mkSession({ implementing_secs: 100 }),
            mkSession({ instrumented: 0, legacy_secs: 500 }),
            mkSession({ instrumented: 0, legacy_secs: 250 }),
        ];
        const s = computeSessionStats(rows);
        expect(s.total).toBe(3);
        expect(s.instrumentedCount).toBe(1);
        expect(s.legacyCount).toBe(2);
        expect(s.legacySecs).toBe(750);
        // Only the instrumented session's 100s counts toward tracked time.
        expect(s.totalTrackedSecs).toBe(100);
        expect(s.avgDuration).toBe(100);
    });

    it('aggregates per-phase totals, avg, %, and nonzero session counts', () => {
        const rows = [
            mkSession({ implementing_secs: 60, review_secs: 40 }),
            mkSession({ implementing_secs: 20, review_secs: 0 }),
        ];
        const s = computeSessionStats(rows);
        expect(s.totalTrackedSecs).toBe(120); // 100 + 20
        const impl = phaseOf(s, 'implementing_secs');
        expect(impl.total).toBe(80);
        expect(impl.sessions).toBe(2);
        expect(impl.avg).toBe(40);              // 80 / 2 instrumented
        expect(impl.pctOfTotal).toBeCloseTo((80 / 120) * 100, 5);
        const review = phaseOf(s, 'review_secs');
        expect(review.total).toBe(40);
        expect(review.sessions).toBe(1);        // only one session had review > 0
        expect(review.avg).toBe(20);            // 40 / 2 instrumented (incl. the zero)
    });

    it('computes phase median over nonzero sessions only', () => {
        const rows = [
            mkSession({ planning_secs: 10 }),
            mkSession({ planning_secs: 30 }),
            mkSession({ planning_secs: 0 }),    // excluded from median
        ];
        const s = computeSessionStats(rows);
        const planning = phaseOf(s, 'planning_secs');
        expect(planning.sessions).toBe(2);
        expect(planning.median).toBe(20);        // median(10, 30)
    });

    it('computes the agentic/human/machine split from canonical grouping', () => {
        const rows = [
            mkSession({
                starting_secs: 10,      // machine
                planning_secs: 20,      // agentic
                implementing_secs: 30,  // agentic
                completion_secs: 10,    // agentic
                waiting_secs: 5,        // human
                review_secs: 15,        // human
                paused_secs: 5,         // human
            }),
        ];
        const s = computeSessionStats(rows);
        expect(s.machineSecs).toBe(10);
        expect(s.agenticSecs).toBe(60);          // 20 + 30 + 10
        expect(s.humanSecs).toBe(25);            // 5 + 15 + 5
        expect(s.totalTrackedSecs).toBe(95);
        expect(s.agenticPct).toBeCloseTo((60 / 95) * 100, 5);
        expect(s.humanPct).toBeCloseTo((25 / 95) * 100, 5);
        expect(s.machinePct).toBeCloseTo((10 / 95) * 100, 5);
    });

    it('computes median session duration', () => {
        const rows = [
            mkSession({ implementing_secs: 100 }),
            mkSession({ implementing_secs: 300 }),
            mkSession({ implementing_secs: 200 }),
        ];
        const s = computeSessionStats(rows);
        expect(s.medianDuration).toBe(200);
        expect(s.avgDuration).toBe(200);
    });

    it('buckets sessions into the duration histogram', () => {
        const rows = [
            mkSession({ implementing_secs: 30 }),    // <1m
            mkSession({ implementing_secs: 120 }),   // 1–5m
            mkSession({ implementing_secs: 4000 }),  // 1h+
        ];
        const s = computeSessionStats(rows);
        const hist = Object.fromEntries(s.durationHistogram.map(b => [b.label, b.count]));
        expect(hist['<1m']).toBe(1);
        expect(hist['1–5m']).toBe(1);
        expect(hist['1h+']).toBe(1);
    });

    it('counts status across all rows including legacy', () => {
        const rows = [
            mkSession({ swarm_status: 'completed' }),
            mkSession({ swarm_status: 'active' }),
            mkSession({ instrumented: 0, legacy_secs: 10, swarm_status: 'completed' }),
        ];
        const s = computeSessionStats(rows);
        const status = Object.fromEntries(s.statusHistogram.map(b => [b.label, b.count]));
        expect(status.completed).toBe(2);
        expect(status.active).toBe(1);
    });

    it('builds a per-day trend of average duration', () => {
        const rows = [
            mkSession({ implementing_secs: 100, started_at: '2026-06-01T10:00:00' }),
            mkSession({ implementing_secs: 300, started_at: '2026-06-01T12:00:00' }),
            mkSession({ implementing_secs: 60,  started_at: '2026-06-02T09:00:00' }),
        ];
        const s = computeSessionStats(rows);
        expect(s.trend).toHaveLength(2);
        expect(s.trend[0]).toMatchObject({ date: '2026-06-01', count: 2, avgDuration: 200 });
        expect(s.trend[1]).toMatchObject({ date: '2026-06-02', count: 1, avgDuration: 60 });
    });
});

// --- Per-phase TOKEN cost aggregation (req #2839) ---------------------------
// phase_tokens shape on a session: { "<phase>": {input,cache_write,cache_read,output} }
// where <phase> mirrors the *_secs keys with the suffix stripped.
const tok = (i, cw, cr, o) => ({ input: i, cache_write: cw, cache_read: cr, output: o });

describe('computeSessionStats token cost (req #2839)', () => {
    it('zeroes token aggregates for empty input', () => {
        const s = computeSessionStats([]);
        expect(s.totalTokens).toBe(0);
        expect(s.tokenInstrumentedCount).toBe(0);
        expect(s.agenticTokens).toBe(0);
        expect(s.humanTokens).toBe(0);
        expect(s.machineTokens).toBe(0);
    });

    it('sums per-phase token cost (all four types) into the phase aggregate', () => {
        const rows = [
            mkSession({
                implementing_secs: 60,
                phase_tokens: { implementing: tok(10, 20, 30, 40), review: tok(1, 1, 1, 1) },
            }),
            mkSession({
                implementing_secs: 20,
                phase_tokens: { implementing: tok(0, 0, 0, 5) },
            }),
        ];
        const s = computeSessionStats(rows);
        const impl = phaseOf(s, 'implementing_secs');
        // (10+20+30+40) + (0+0+0+5) = 105
        expect(impl.tokens).toBe(105);
        const review = phaseOf(s, 'review_secs');
        expect(review.tokens).toBe(4);
        expect(s.tokenInstrumentedCount).toBe(2);
        expect(s.totalTokens).toBe(109);
    });

    it('computes per-phase avg token cost per session and % of total tokens', () => {
        const rows = [
            mkSession({ implementing_secs: 10, review_secs: 5,
                        phase_tokens: { implementing: tok(0, 0, 0, 60), review: tok(0, 0, 0, 40) } }),
            mkSession({ implementing_secs: 10,
                        phase_tokens: { implementing: tok(0, 0, 0, 40) } }),
        ];
        const s = computeSessionStats(rows);
        const impl = phaseOf(s, 'implementing_secs');
        // tokens 100 over 2 token-instrumented sessions → avg 50; share 100/140
        expect(impl.tokens).toBe(100);
        expect(impl.avgTokens).toBe(50);
        expect(impl.pctOfTokens).toBeCloseTo((100 / 140) * 100, 5);
        const review = phaseOf(s, 'review_secs');
        expect(review.avgTokens).toBe(20);       // 40 / 2
        expect(review.pctOfTokens).toBeCloseTo((40 / 140) * 100, 5);
    });

    it('groups token cost agentic/human/machine like the timing split', () => {
        const rows = [
            mkSession({
                starting_secs: 1, planning_secs: 1, implementing_secs: 1,
                completion_secs: 1, review_secs: 1,
                phase_tokens: {
                    starting: tok(0, 0, 0, 100),      // machine 100
                    planning: tok(0, 0, 0, 10),       // agentic
                    implementing: tok(0, 0, 0, 20),   // agentic
                    completion: tok(0, 0, 0, 5),      // agentic
                    review: tok(0, 0, 0, 7),          // human
                },
            }),
        ];
        const s = computeSessionStats(rows);
        expect(s.machineTokens).toBe(100);
        expect(s.agenticTokens).toBe(35);   // 10+20+5
        expect(s.humanTokens).toBe(7);
        expect(s.totalTokens).toBe(142);
    });

    it('parses a phase_tokens JSON string (MCP may return the column as text)', () => {
        const rows = [
            mkSession({
                implementing_secs: 30,
                phase_tokens: JSON.stringify({ implementing: tok(5, 5, 5, 5) }),
            }),
        ];
        const s = computeSessionStats(rows);
        expect(phaseOf(s, 'implementing_secs').tokens).toBe(20);
        expect(s.tokenInstrumentedCount).toBe(1);
    });

    it('treats NULL phase_tokens as no token data (0 cost, not counted)', () => {
        const rows = [
            mkSession({ implementing_secs: 100 }),                 // no phase_tokens
            mkSession({ implementing_secs: 50, phase_tokens: null }),
        ];
        const s = computeSessionStats(rows);
        expect(s.totalTokens).toBe(0);
        expect(s.tokenInstrumentedCount).toBe(0);
        expect(phaseOf(s, 'implementing_secs').tokens).toBe(0);
    });
});

// --- Token economics: type totals, trend, leaderboard, efficiency (req #2845) -
describe('computeSessionStats token economics (req #2845)', () => {
    it('zeroes token economics for empty input', () => {
        const s = computeSessionStats([]);
        expect(s.tokenTypeTotals).toEqual({ input: 0, cache_write: 0, cache_read: 0, output: 0 });
        expect(s.avgTokensPerSession).toBeNull();
        expect(s.medianTokensPerSession).toBeNull();
        expect(s.tokensPerSecond).toBeNull();
        expect(s.cacheReadShare).toBeNull();
        expect(s.tokenTrend).toEqual([]);
        expect(s.topCostSessions).toEqual([]);
        expect(s.tokenTrackedSecs).toBe(0);
    });

    it('sums the four token types across all instrumented sessions', () => {
        const rows = [
            mkSession({ implementing_secs: 10, phase_tokens: { implementing: tok(10, 20, 30, 40) } }),
            mkSession({ review_secs: 5, phase_tokens: { review: tok(1, 2, 3, 4) } }),
            mkSession({ implementing_secs: 5 }), // no token data — contributes nothing
        ];
        const s = computeSessionStats(rows);
        expect(s.tokenTypeTotals).toEqual({ input: 11, cache_write: 22, cache_read: 33, output: 44 });
        // type totals sum to totalTokens
        const typeSum = s.tokenTypeTotals.input + s.tokenTypeTotals.cache_write
            + s.tokenTypeTotals.cache_read + s.tokenTypeTotals.output;
        expect(typeSum).toBe(s.totalTokens);
    });

    it('computes avg/median token cost per session over token-instrumented rows only', () => {
        const rows = [
            mkSession({ implementing_secs: 10, phase_tokens: { implementing: tok(0, 0, 0, 100) } }),
            mkSession({ implementing_secs: 10, phase_tokens: { implementing: tok(0, 0, 0, 200) } }),
            mkSession({ implementing_secs: 10, phase_tokens: { implementing: tok(0, 0, 0, 300) } }),
            mkSession({ implementing_secs: 10 }), // excluded from token avg/median
        ];
        const s = computeSessionStats(rows);
        expect(s.tokenInstrumentedCount).toBe(3);
        expect(s.totalTokens).toBe(600);
        expect(s.avgTokensPerSession).toBe(200);   // 600 / 3
        expect(s.medianTokensPerSession).toBe(200); // median(100,200,300)
    });

    it('computes tokens/sec over token-instrumented duration only', () => {
        const rows = [
            mkSession({ implementing_secs: 100, phase_tokens: { implementing: tok(0, 0, 0, 1000) } }),
            mkSession({ implementing_secs: 50 }), // no tokens → not in tokenTrackedSecs
        ];
        const s = computeSessionStats(rows);
        expect(s.tokenTrackedSecs).toBe(100);
        expect(s.tokensPerSecond).toBe(10); // 1000 / 100
    });

    it('computes cache read share = cache_read / (cache_read + input)', () => {
        const rows = [
            mkSession({ implementing_secs: 10, phase_tokens: { implementing: tok(25, 0, 75, 0) } }),
        ];
        const s = computeSessionStats(rows);
        // 75 / (75 + 25) = 75%
        expect(s.cacheReadShare).toBeCloseTo(75, 5);
    });

    it('ranks the biggest-cost sessions descending and caps at 10', () => {
        const rows = Array.from({ length: 12 }, (_, i) =>
            mkSession({ id: i + 1, implementing_secs: 10,
                        phase_tokens: { implementing: tok(0, 0, 0, (i + 1) * 100) } }));
        const s = computeSessionStats(rows);
        expect(s.topCostSessions).toHaveLength(10);
        expect(s.topCostSessions[0]).toMatchObject({ id: 12, tokens: 1200 });
        expect(s.topCostSessions[9]).toMatchObject({ id: 3, tokens: 300 });
        // ids 1 and 2 (smallest cost) are trimmed
        expect(s.topCostSessions.some(t => t.id === 1)).toBe(false);
    });

    it('labels leaderboard rows by title, then task_name, then #id', () => {
        const rows = [
            mkSession({ id: 1, implementing_secs: 5, title: 'Nice Title', task_name: 'tn',
                        phase_tokens: { implementing: tok(0, 0, 0, 30) } }),
            mkSession({ id: 2, implementing_secs: 5, task_name: 'only-task',
                        phase_tokens: { implementing: tok(0, 0, 0, 20) } }),
            mkSession({ id: 3, implementing_secs: 5,
                        phase_tokens: { implementing: tok(0, 0, 0, 10) } }),
        ];
        const s = computeSessionStats(rows);
        const byId = Object.fromEntries(s.topCostSessions.map(t => [t.id, t.label]));
        expect(byId[1]).toBe('Nice Title');
        expect(byId[2]).toBe('only-task');
        expect(byId[3]).toBe('#3');
    });

    it('treats an empty {} phase_tokens as no token data', () => {
        const rows = [
            mkSession({ implementing_secs: 100, phase_tokens: {} }),
            mkSession({ implementing_secs: 50, phase_tokens: { implementing: tok(0, 0, 0, 40) } }),
        ];
        const s = computeSessionStats(rows);
        // only the second session counts as token-instrumented
        expect(s.tokenInstrumentedCount).toBe(1);
        expect(s.totalTokens).toBe(40);
        expect(s.avgTokensPerSession).toBe(40);     // not diluted by the {} session
        expect(s.topCostSessions).toHaveLength(1);
    });

    it('counts only token sessions toward token cost on a mixed day', () => {
        const rows = [
            mkSession({ implementing_secs: 10, started_at: '2026-06-05T10:00:00',
                        phase_tokens: { implementing: tok(0, 0, 0, 300) } }),
            mkSession({ implementing_secs: 10, started_at: '2026-06-05T11:00:00' }), // no tokens
        ];
        const s = computeSessionStats(rows);
        expect(s.tokenTrend).toEqual([{ date: '2026-06-05', tokens: 300 }]);
    });

    it('carries per-day token cost on the merged trend (null on token-less days)', () => {
        const rows = [
            mkSession({ implementing_secs: 10, started_at: '2026-06-01T10:00:00',
                        phase_tokens: { implementing: tok(0, 0, 0, 120) } }),
            mkSession({ implementing_secs: 10, started_at: '2026-06-02T09:00:00' }), // no tokens
        ];
        const s = computeSessionStats(rows);
        expect(s.trend).toHaveLength(2);
        expect(s.trend[0]).toMatchObject({ date: '2026-06-01', tokens: 120 });
        expect(s.trend[1].tokens).toBeNull();   // token-less day skips the line
    });

    it('builds a per-day token trend over days that carry token cost', () => {
        const rows = [
            mkSession({ implementing_secs: 10, started_at: '2026-06-01T10:00:00',
                        phase_tokens: { implementing: tok(0, 0, 0, 100) } }),
            mkSession({ implementing_secs: 10, started_at: '2026-06-01T12:00:00',
                        phase_tokens: { implementing: tok(0, 0, 0, 50) } }),
            mkSession({ implementing_secs: 10, started_at: '2026-06-02T09:00:00' }), // no tokens
        ];
        const s = computeSessionStats(rows);
        expect(s.tokenTrend).toHaveLength(1); // only 2026-06-01 carries token cost
        expect(s.tokenTrend[0]).toMatchObject({ date: '2026-06-01', tokens: 150 });
    });
});

describe('computeSessionStats model split (req #2909)', () => {
    it('returns empty modelAggregate for empty input', () => {
        expect(computeSessionStats([]).modelAggregate).toEqual([]);
    });

    it('counts sessions per model, normalizing null/unknown to opus', () => {
        const rows = [
            mkSession({ ai_model: 'sonnet' }),
            mkSession({ ai_model: 'sonnet' }),
            mkSession({ ai_model: 'haiku' }),
            mkSession({ ai_model: null }),      // pre-#2909 → opus
            mkSession({ ai_model: 'bogus' }),   // unknown → opus
        ];
        const s = computeSessionStats(rows);
        const byModel = Object.fromEntries(s.modelAggregate.map(m => [m.model, m]));
        expect(byModel.sonnet.count).toBe(2);
        expect(byModel.haiku.count).toBe(1);
        expect(byModel.opus.count).toBe(2);
        expect(byModel.fable).toBeUndefined(); // zero-count models dropped
    });

    it('accrues time and token totals per model from instrumented rows only', () => {
        const rows = [
            mkSession({ ai_model: 'fable', implementing_secs: 100,
                        phase_tokens: { implementing: tok(0, 0, 0, 40) } }),
            mkSession({ ai_model: 'fable', implementing_secs: 50 }),
            mkSession({ ai_model: 'fable', instrumented: 0, legacy_secs: 999 }),
        ];
        const s = computeSessionStats(rows);
        const fable = s.modelAggregate.find(m => m.model === 'fable');
        expect(fable.count).toBe(3);      // legacy still counted
        expect(fable.secs).toBe(150);     // legacy time excluded
        expect(fable.tokens).toBe(40);
    });

    it('carries capitalized label + palette color per model', () => {
        const s = computeSessionStats([mkSession({ ai_model: 'haiku' })]);
        expect(s.modelAggregate).toEqual([
            { model: 'haiku', label: 'Haiku', color: '#e57373', count: 1, secs: 0, tokens: 0 },
        ]);
    });
});

describe('computeSessionStats effort split (req #2916)', () => {
    it('returns empty effortAggregate for empty input', () => {
        expect(computeSessionStats([]).effortAggregate).toEqual([]);
    });

    it('counts sessions per effort, normalizing null/unknown to high (the backfill rule)', () => {
        const rows = [
            mkSession({ effort: 'xhigh' }),
            mkSession({ effort: 'xhigh' }),
            mkSession({ effort: 'ultracode' }),
            mkSession({ effort: null }),      // pre-#2916 → high
            mkSession({ effort: 'max' }),     // unknown → high
        ];
        const s = computeSessionStats(rows);
        const byEffort = Object.fromEntries(s.effortAggregate.map(e => [e.effort, e]));
        expect(byEffort.xhigh.count).toBe(2);
        expect(byEffort.ultracode.count).toBe(1);
        expect(byEffort.high.count).toBe(2);
        expect(byEffort.low).toBeUndefined(); // zero-count efforts dropped
    });

    it('accrues time and token totals per effort from instrumented rows only', () => {
        const rows = [
            mkSession({ effort: 'ultracode', implementing_secs: 100,
                        phase_tokens: { implementing: tok(0, 0, 0, 40) } }),
            mkSession({ effort: 'ultracode', implementing_secs: 50 }),
            mkSession({ effort: 'ultracode', instrumented: 0, legacy_secs: 999 }),
        ];
        const s = computeSessionStats(rows);
        const ultra = s.effortAggregate.find(e => e.effort === 'ultracode');
        expect(ultra.count).toBe(3);      // legacy still counted
        expect(ultra.secs).toBe(150);     // legacy time excluded
        expect(ultra.tokens).toBe(40);
    });

    it('carries capitalized label + palette color per effort', () => {
        const s = computeSessionStats([mkSession({ effort: 'xhigh' })]);
        expect(s.effortAggregate).toEqual([
            { effort: 'xhigh', label: 'XHigh', color: '#81c784', count: 1, secs: 0, tokens: 0 },
        ]);
    });
});
