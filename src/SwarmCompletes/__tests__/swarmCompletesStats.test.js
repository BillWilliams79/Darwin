import { describe, it, expect } from 'vitest';
import { computeSwarmCompleteStats } from '../SwarmCompletesStatsView';
import { countRowsByAnchor, filterRowsByAnchor } from '../../utils/phaseTelemetry';

const mkRow = (overrides = {}) => ({
    skill_name: 'swarm-complete',
    coordination_type: 'implemented',
    status: 'ok',
    session_count: 1,
    tokens_input: 0,
    tokens_cache_write: 0,
    tokens_cache_read: 0,
    tokens_output: 0,
    wall_seconds: null,
    turn_count: null,
    telemetry: null,
    started_at: null,
    ...overrides,
});

// Build a telemetry blob carrying a TOKEN_TELEMETRY JSON with a `phases` object.
const mkTelemetry = (phases) =>
    `--- TELEMETRY START ---\nnoise\n--- TELEMETRY END ---\nTOKEN_TELEMETRY:\n${JSON.stringify({ phases })}`;

describe('computeSwarmCompleteStats (req #2794)', () => {
    it('returns zeroed shape for empty input', () => {
        const s = computeSwarmCompleteStats([]);
        expect(s.total).toBe(0);
        expect(s.okCount).toBe(0);
        expect(s.successRate).toBe(0);
        expect(s.avgWall).toBeNull();
        expect(s.totalTokens).toBe(0);
        expect(s.avgTokensPerComplete).toBe(0);
        expect(s.cacheHitRate).toBeNull();
        expect(s.avgTurns).toBeNull();
        expect(s.statusHistogram.map(b => b.label)).toEqual(['ok', 'error', 'in_progress']);
        expect(s.statusHistogram.every(b => b.count === 0)).toBe(true);
        expect(s.skillHistogram).toEqual([]);
        expect(s.wallHistogram).toHaveLength(6);
        expect(s.turnsHistogram).toHaveLength(5);
        expect(s.phaseAggregate).toEqual([]);
        expect(s.phaseTokenTotal).toBe(0);
        expect(s.throughput).toEqual([]);
    });

    it('counts status outcomes and computes success rate', () => {
        const rows = [
            mkRow({ status: 'ok' }),
            mkRow({ status: 'ok' }),
            mkRow({ status: 'error' }),
            mkRow({ status: 'in_progress' }),
        ];
        const s = computeSwarmCompleteStats(rows);
        expect(s.total).toBe(4);
        expect(s.okCount).toBe(2);
        expect(s.errorCount).toBe(1);
        expect(s.inProgressCount).toBe(1);
        expect(s.successRate).toBeCloseTo(0.5, 5);
        const statusMap = Object.fromEntries(s.statusHistogram.map(b => [b.label, b.count]));
        expect(statusMap).toEqual({ ok: 2, error: 1, in_progress: 1 });
    });

    it('aggregates the four token columns', () => {
        const rows = [
            mkRow({ tokens_input: 10, tokens_cache_write: 20,
                    tokens_cache_read: 70, tokens_output: 5 }),
            mkRow({ tokens_input: 0, tokens_cache_write: 0,
                    tokens_cache_read: 30, tokens_output: 0 }),
        ];
        const s = computeSwarmCompleteStats(rows);
        expect(s.inputTotal).toBe(10);
        expect(s.cacheWriteTotal).toBe(20);
        expect(s.cacheReadTotal).toBe(100);
        expect(s.outputTotal).toBe(5);
        expect(s.totalTokens).toBe(135);
        expect(s.avgTokensPerComplete).toBeCloseTo(135 / 2, 5);
        // cacheHitRate = cacheRead / (cacheRead + cacheWrite + input) = 100 / (100+20+10)
        expect(s.cacheHitRate).toBeCloseTo(100 / 130, 5);
    });

    it('computes avg wall over rows with non-null wall_seconds and buckets them', () => {
        const rows = [
            mkRow({ wall_seconds: 20 }),    // <30s
            mkRow({ wall_seconds: 90 }),    // 1–2m
            mkRow({ wall_seconds: null }),  // skipped
        ];
        const s = computeSwarmCompleteStats(rows);
        expect(s.avgWall).toBeCloseTo((20 + 90) / 2, 5);
        const wallMap = Object.fromEntries(s.wallHistogram.map(b => [b.label, b.count]));
        expect(wallMap['<30s']).toBe(1);
        expect(wallMap['1–2m']).toBe(1);
    });

    it('computes avg turns and turn-count histogram, skipping null', () => {
        const rows = [
            mkRow({ turn_count: 5 }),    // <10
            mkRow({ turn_count: 25 }),   // 20–30
            mkRow({ turn_count: null }), // skipped
        ];
        const s = computeSwarmCompleteStats(rows);
        expect(s.avgTurns).toBeCloseTo(15, 5);
        const turnMap = Object.fromEntries(s.turnsHistogram.map(b => [b.label, b.count]));
        expect(turnMap['<10']).toBe(1);
        expect(turnMap['20–30']).toBe(1);
    });

    it('tallies skill distribution sorted by count desc', () => {
        const rows = [
            mkRow({ skill_name: 'swarm-complete' }),
            mkRow({ skill_name: 'swarm-complete' }),
            mkRow({ skill_name: 'primary-ai-swarm-complete' }),
        ];
        const s = computeSwarmCompleteStats(rows);
        expect(s.skillHistogram[0]).toEqual({ label: 'swarm-complete', count: 2 });
        expect(s.skillHistogram[1]).toEqual({ label: 'primary-ai-swarm-complete', count: 1 });
    });

    it('aggregates per-phase token cost across completes from telemetry', () => {
        // phase token total = input + output + cache_write + cache_read
        const rowA = mkRow({
            telemetry: mkTelemetry({
                merge:  { input: 10, output: 0, cache_write: 0, cache_read: 90, wall_seconds: 5 },
                deploy: { input: 0,  output: 0, cache_write: 0, cache_read: 50, wall_seconds: 3 },
            }),
        });
        const rowB = mkRow({
            telemetry: mkTelemetry({
                merge: { input: 0, output: 0, cache_write: 0, cache_read: 200, wall_seconds: 7 },
            }),
        });
        const s = computeSwarmCompleteStats([rowA, rowB]);
        // merge appears in both → tokens 100 + 200 = 300, completes 2, wall 12
        // deploy appears in one → tokens 50, completes 1, wall 3
        expect(s.phaseTokenTotal).toBe(350);
        expect(s.phaseAggregate[0]).toMatchObject({
            phase: 'merge', completes: 2, tokens: 300, wall: 12,
        });
        expect(s.phaseAggregate[0].avgTokens).toBeCloseTo(150, 5);
        // pctOfTotal = 300 / 350
        expect(s.phaseAggregate[0].pctOfTotal).toBeCloseTo((300 / 350) * 100, 5);
        expect(s.phaseAggregate[1]).toMatchObject({
            phase: 'deploy', completes: 1, tokens: 50, wall: 3,
        });
        expect(s.phaseAggregate[1].pctOfTotal).toBeCloseTo((50 / 350) * 100, 5);
    });

    it('groups throughput by calendar day of started_at, sorted ascending', () => {
        const rows = [
            mkRow({ started_at: '2026-06-08T16:48:33', tokens_output: 10 }),
            mkRow({ started_at: '2026-06-08T02:42:56', tokens_output: 5 }),
            mkRow({ started_at: '2026-06-07T10:00:00', tokens_output: 1 }),
            mkRow({ started_at: null }),  // skipped
        ];
        const s = computeSwarmCompleteStats(rows);
        expect(s.throughput).toEqual([
            { date: '2026-06-07', count: 1, tokens: 1 },
            { date: '2026-06-08', count: 2, tokens: 15 },
        ]);
    });

    // req #2955 — model/effort histograms (backed by #2949's swarm_completes columns).
    describe('modelHistogram / effortHistogram (req #2955)', () => {
        it('returns all-zero histograms with full label set for empty input', () => {
            const s = computeSwarmCompleteStats([]);
            expect(s.modelHistogram.map(b => b.label)).toEqual(['Haiku', 'Sonnet', 'Opus', 'Fable']);
            expect(s.modelHistogram.every(b => b.count === 0)).toBe(true);
            expect(s.effortHistogram.map(b => b.label)).toEqual(['Low', 'Medium', 'High', 'XHigh', 'Ultracode']);
            expect(s.effortHistogram.every(b => b.count === 0)).toBe(true);
        });

        it('counts rows into their model/effort bucket', () => {
            const rows = [
                mkRow({ ai_model: 'sonnet', effort: 'xhigh' }),
                mkRow({ ai_model: 'sonnet', effort: 'low' }),
                mkRow({ ai_model: 'opus', effort: 'high' }),
            ];
            const s = computeSwarmCompleteStats(rows);
            const models = Object.fromEntries(s.modelHistogram.map(b => [b.label, b.count]));
            const efforts = Object.fromEntries(s.effortHistogram.map(b => [b.label, b.count]));
            expect(models.Sonnet).toBe(2);
            expect(models.Opus).toBe(1);
            expect(models.Haiku).toBe(0);
            expect(efforts.XHigh).toBe(1);
            expect(efforts.Low).toBe(1);
            expect(efforts.High).toBe(1);
        });

        it('normalizes unknown/NULL model to opus and effort to high (documented backfill rule)', () => {
            const rows = [
                mkRow({ ai_model: null, effort: null }),
                mkRow({ ai_model: 'bogus', effort: 'bogus' }),
            ];
            const s = computeSwarmCompleteStats(rows);
            const models = Object.fromEntries(s.modelHistogram.map(b => [b.label, b.count]));
            const efforts = Object.fromEntries(s.effortHistogram.map(b => [b.label, b.count]));
            expect(models.Opus).toBe(2);
            expect(efforts.High).toBe(2);
        });
    });
});

// Req #4107 — worker closeouts embed COMPLETE_TOKEN_TELEMETRY; a new-anchor
// blob (req #4095) carries `skill_load` and `invocation_start_source`.
const mkCompleteTelemetry = (source, phases) =>
    `COMPLETE_TOKEN_TELEMETRY:\n${JSON.stringify({ invocation_start_source: source, phases })}`;

describe('computeSwarmCompleteStats — invocation anchor (req #4107)', () => {
    const newRow = mkRow({
        tokens_cache_write: 57000, wall_seconds: 300, turn_count: 12, started_at: '2026-10-31T02:00:00',
        telemetry: mkCompleteTelemetry('skill_invocation', {
            skill_load: { input: 10, output: 200, cache_write: 33000, cache_read: 1000, wall_seconds: 8 },
            swarm_start: { input: 0, output: 300, cache_write: 24000, cache_read: 0, wall_seconds: 292 },
        }),
    });
    const legacyRow = mkRow({
        tokens_cache_write: 24000, wall_seconds: 200, turn_count: 11, started_at: '2026-10-28T02:00:00',
        telemetry: mkCompleteTelemetry('marker_file', {
            swarm_start: { input: 0, output: 300, cache_write: 24000, cache_read: 0, wall_seconds: 200 },
        }),
    });

    it('the leaderboard carries a skill_load row for new-anchor completes', () => {
        const s = computeSwarmCompleteStats([newRow]);
        const load = s.phaseAggregate.find(p => p.phase === 'skill_load');
        expect(load).toBeDefined();
        expect(load.completes).toBe(1);
        expect(s.phaseAggregate.map(p => p.phase)).toContain('swarm_start');
    });

    it('a real closeout row carries the start blob too; the closeout blob wins', () => {
        // Production rows (e.g. #1023): the session's TOKEN_TELEMETRY (legacy
        // anchor, start phases) precedes the closeout's COMPLETE_TOKEN_TELEMETRY.
        const startBlob = `TOKEN_TELEMETRY:\n${JSON.stringify({
            invocation_start_source: 'marker_file',
            phases: { phase_A1_A3: { input: 1, output: 1, cache_write: 1, cache_read: 1 } },
        })}\n`;
        const row = mkRow({ telemetry: startBlob + newRow.telemetry });
        expect(countRowsByAnchor([row])).toEqual({ all: 1, new: 1, legacy: 0 });
        expect(computeSwarmCompleteStats([row]).phaseAggregate.map(p => p.phase).sort())
            .toEqual(['skill_load', 'swarm_start']);
    });

    it('anchor counts read the COMPLETE_TOKEN_TELEMETRY blob', () => {
        expect(countRowsByAnchor([newRow, legacyRow, mkRow()]))
            .toEqual({ all: 3, new: 1, legacy: 2 });
    });

    it('filtering by anchor changes every figure', () => {
        const rows = [newRow, legacyRow];
        const neu = computeSwarmCompleteStats(filterRowsByAnchor(rows, 'new'));
        const old = computeSwarmCompleteStats(filterRowsByAnchor(rows, 'legacy'));
        const all = computeSwarmCompleteStats(filterRowsByAnchor(rows, 'all'));
        expect([all.total, neu.total, old.total]).toEqual([2, 1, 1]);
        expect([neu.avgWall, old.avgWall]).toEqual([300, 200]);
        expect([neu.avgTurns, old.avgTurns]).toEqual([12, 11]);
        expect([neu.avgTokensPerComplete, old.avgTokensPerComplete]).toEqual([57000, 24000]);
        expect(neu.throughput.map(d => d.date)).toEqual(['2026-10-31']);
        expect(old.phaseAggregate.map(p => p.phase)).toEqual(['swarm_start']);
    });
});
