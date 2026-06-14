import { describe, it, expect } from 'vitest';
import { laneParityFor } from '../swarmGeometry';

// req #2828 — alternating day-lane backgrounds. laneParityFor keys the lane tint
// off the date so adjacent calendar days ALWAYS alternate and a given day keeps
// its shade as the windowed elevator scrolls.
describe('laneParityFor (req #2828)', () => {
    it('alternates on every consecutive calendar day', () => {
        const days = [
            '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11',
            '2026-06-12', '2026-06-13', '2026-06-14',
        ];
        const parities = days.map(laneParityFor);
        // Each day differs from its neighbor — no two adjacent lanes share a tint.
        for (let i = 1; i < parities.length; i++) {
            expect(parities[i]).not.toBe(parities[i - 1]);
        }
    });

    it('is stable for the same date (elevator scroll keeps a day on one tint)', () => {
        expect(laneParityFor('2026-06-12')).toBe(laneParityFor('2026-06-12'));
    });

    it('only ever returns "even" or "odd"', () => {
        for (const d of ['2026-01-01', '2026-12-31', '2025-02-28', '2030-06-15']) {
            expect(['even', 'odd']).toContain(laneParityFor(d));
        }
    });

    it('crosses month and year boundaries without breaking alternation', () => {
        expect(laneParityFor('2026-06-30')).not.toBe(laneParityFor('2026-07-01'));
        expect(laneParityFor('2026-12-31')).not.toBe(laneParityFor('2027-01-01'));
    });

    it('falls back to "even" for empty / invalid input', () => {
        expect(laneParityFor('')).toBe('even');
        expect(laneParityFor(null)).toBe('even');
        expect(laneParityFor(undefined)).toBe('even');
        expect(laneParityFor('not-a-date')).toBe('even');
    });
});
