import { describe, it, expect } from 'vitest';
import { computeStats } from '../index';

describe('computeStats', () => {
    it('computes correct totals', () => {
        const runs = [
            { distance: 10.5, extractedPoints: 1000, strippedPoints: 300, currentPoints: 700 },
            { distance: 5.2, extractedPoints: 500, strippedPoints: 150, currentPoints: 350 },
        ];

        const stats = computeStats(runs);

        expect(stats.totalRuns).toBe(2);
        expect(stats.totalDistance).toBe(15.7);
        expect(stats.totalExtracted).toBe(1500);
        expect(stats.totalStripped).toBe(450);
        expect(stats.totalRemaining).toBe(1050);
        expect(stats.percentReduction).toBe(30);
    });

    it('handles empty runs', () => {
        const stats = computeStats([]);

        expect(stats.totalRuns).toBe(0);
        expect(stats.totalDistance).toBe(0);
        expect(stats.percentReduction).toBe(0);
    });

    it('handles zero extracted points', () => {
        const runs = [{ distance: 0, extractedPoints: 0, strippedPoints: 0, currentPoints: 0 }];
        const stats = computeStats(runs);
        expect(stats.percentReduction).toBe(0);
    });
});
