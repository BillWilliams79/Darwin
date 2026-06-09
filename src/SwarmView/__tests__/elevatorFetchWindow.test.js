import { describe, it, expect } from 'vitest';
import { shiftDay, mondayOf } from '../SwarmVisualizerView';

// req #2777 — the elevator fetch window is quantized to the Monday of the
// centered day's week and widened to ±28 days so that scrolling within the
// fixed 21-day strip (±10 days) never slides the window and never refetches
// per-day. These tests lock the quantization + coverage guarantees.

describe('mondayOf', () => {
    it('returns the same date when the day is already a Monday', () => {
        // 2026-06-08 is a Monday.
        expect(mondayOf('2026-06-08')).toBe('2026-06-08');
    });

    it('snaps each weekday back to its week Monday', () => {
        expect(mondayOf('2026-06-08')).toBe('2026-06-08'); // Mon
        expect(mondayOf('2026-06-09')).toBe('2026-06-08'); // Tue
        expect(mondayOf('2026-06-10')).toBe('2026-06-08'); // Wed
        expect(mondayOf('2026-06-11')).toBe('2026-06-08'); // Thu
        expect(mondayOf('2026-06-12')).toBe('2026-06-08'); // Fri
        expect(mondayOf('2026-06-13')).toBe('2026-06-08'); // Sat
        expect(mondayOf('2026-06-14')).toBe('2026-06-08'); // Sun
    });

    it('rolls Sunday back to the previous Monday (not forward)', () => {
        // 2026-06-07 is a Sunday → its week started Mon 2026-06-01.
        expect(mondayOf('2026-06-07')).toBe('2026-06-01');
    });

    it('is stable for every day within a week (window will not slide)', () => {
        const week = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11',
                      '2026-06-12', '2026-06-13', '2026-06-14'];
        const anchors = new Set(week.map(mondayOf));
        expect(anchors.size).toBe(1);
    });

    it('passes null/empty through unchanged', () => {
        expect(mondayOf('')).toBe('');
        expect(mondayOf(null)).toBe(null);
    });
});

describe('elevator fetch window coverage', () => {
    // The window the elevator branch builds: monday ± 28 days.
    const windowFor = (centerDate) => {
        const monday = mondayOf(centerDate);
        return { start: shiftDay(monday, -28), end: shiftDay(monday, 28) };
    };

    // The fixed strip rendered around a build-center: centeredDateRange(c, 10)
    // spans [c-10, c+10]. While scrolling, the reported center drifts up to
    // ±10 days inside that strip, so relative to the live currentDate the strip
    // can span [currentDate-20, currentDate+20]. The window must always cover it.
    const stripAbsoluteRange = (currentDate) => ({
        lo: shiftDay(currentDate, -20),
        hi: shiftDay(currentDate, 20),
    });

    it('covers the worst-case strip span for every weekday', () => {
        const days = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11',
                      '2026-06-12', '2026-06-13', '2026-06-14'];
        for (const d of days) {
            const w = windowFor(d);
            const strip = stripAbsoluteRange(d);
            expect(w.start <= strip.lo).toBe(true);
            expect(w.end >= strip.hi).toBe(true);
        }
    });

    it('produces an identical window for every day within the same week', () => {
        const days = ['2026-06-08', '2026-06-10', '2026-06-14'];
        const windows = days.map(windowFor);
        for (const w of windows) {
            expect(w).toEqual(windows[0]);
        }
    });
});
