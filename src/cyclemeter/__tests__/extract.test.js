import { describe, it, expect } from 'vitest';
import { applyRideTrim } from '../extract';

function makeCoords(timeOffsets) {
    return timeOffsets.map(t => ({
        latitude: 37.22 + t * 0.0001,
        longitude: -121.87,
        timeOffset: t,
    }));
}

describe('applyRideTrim', () => {
    it('passes all coordinates through when both values are -1 (no trim)', () => {
        const coords = makeCoords([0.5, 10, 50, 100, 200]);
        const { trimmed, trimmedCount } = applyRideTrim(coords, -1, -1);

        expect(trimmed).toBe(coords); // same reference, no copy
        expect(trimmedCount).toBe(0);
    });

    it('trims coordinates after runTimeEnd', () => {
        const coords = makeCoords([0.61, 27.5, 52.5, 106.5, 133.7, 163.5, 229.5, 814.5]);
        const { trimmed, trimmedCount } = applyRideTrim(coords, -1, 133.7);

        expect(trimmed.length).toBe(5);
        expect(trimmedCount).toBe(3);
        expect(trimmed.every(c => c.timeOffset <= 133.7)).toBe(true);
    });

    it('trims coordinates before runTimeBegin', () => {
        const coords = makeCoords([0.5, 10, 50, 100, 200, 300]);
        const { trimmed, trimmedCount } = applyRideTrim(coords, 50, -1);

        expect(trimmed.length).toBe(4);
        expect(trimmedCount).toBe(2);
        expect(trimmed.every(c => c.timeOffset >= 50)).toBe(true);
    });

    it('trims both beginning and end when both are set', () => {
        const coords = makeCoords([0.5, 10, 50, 100, 200, 300]);
        const { trimmed, trimmedCount } = applyRideTrim(coords, 50, 200);

        expect(trimmed.length).toBe(3);
        expect(trimmedCount).toBe(3);
        expect(trimmed.map(c => c.timeOffset)).toEqual([50, 100, 200]);
    });

    it('includes coordinates exactly at trim boundaries (inclusive)', () => {
        const coords = makeCoords([10, 50, 100, 150, 200]);
        const { trimmed, trimmedCount } = applyRideTrim(coords, 50, 150);

        expect(trimmed.length).toBe(3);
        expect(trimmed.map(c => c.timeOffset)).toEqual([50, 100, 150]);
        expect(trimmedCount).toBe(2);
    });

    it('handles empty coordinates array', () => {
        const { trimmed, trimmedCount } = applyRideTrim([], -1, 133.7);

        expect(trimmed.length).toBe(0);
        expect(trimmedCount).toBe(0);
    });

    it('returns empty when all coordinates fall outside trim window', () => {
        const coords = makeCoords([200, 300, 400]);
        const { trimmed, trimmedCount } = applyRideTrim(coords, -1, 100);

        expect(trimmed.length).toBe(0);
        expect(trimmedCount).toBe(3);
    });

    it('treats runTimeBegin=0 as no begin trim', () => {
        const coords = makeCoords([0.5, 10, 50, 100]);
        const { trimmed, trimmedCount } = applyRideTrim(coords, 0, -1);

        expect(trimmed).toBe(coords); // same reference
        expect(trimmedCount).toBe(0);
    });
});
