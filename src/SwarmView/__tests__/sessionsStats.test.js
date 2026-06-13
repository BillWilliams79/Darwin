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
