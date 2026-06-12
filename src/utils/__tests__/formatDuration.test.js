import { describe, it, expect } from 'vitest';
import { formatDuration } from '../formatDuration';

describe('formatDuration', () => {
    it('returns "0s" for zero', () => {
        expect(formatDuration(0)).toBe('0s');
    });

    it('returns seconds for sub-minute values', () => {
        expect(formatDuration(45)).toBe('45s');
        expect(formatDuration(1)).toBe('1s');
        expect(formatDuration(59)).toBe('59s');
    });

    it('returns minutes and seconds', () => {
        expect(formatDuration(90)).toBe('1m 30s');
        expect(formatDuration(61)).toBe('1m 1s');
        expect(formatDuration(120)).toBe('2m');
    });

    it('returns hours and minutes', () => {
        expect(formatDuration(3600)).toBe('1h');
        expect(formatDuration(3661)).toBe('1h 1m');
        expect(formatDuration(7200)).toBe('2h');
        expect(formatDuration(7260)).toBe('2h 1m');
    });

    it('drops seconds when hours are present', () => {
        // 1h 0m 30s → "1h" (seconds dropped, minutes=0 also dropped)
        expect(formatDuration(3630)).toBe('1h');
        // 1h 5m 30s → "1h 5m" (seconds dropped, minutes kept)
        expect(formatDuration(3930)).toBe('1h 5m');
    });

    it('returns dash for null and undefined', () => {
        expect(formatDuration(null)).toBe('—');
        expect(formatDuration(undefined)).toBe('—');
    });

    it('returns dash for negative values', () => {
        expect(formatDuration(-1)).toBe('—');
        expect(formatDuration(-100)).toBe('—');
    });

    it('returns dash for NaN', () => {
        expect(formatDuration(NaN)).toBe('—');
        expect(formatDuration('abc')).toBe('—');
    });

    it('handles string numeric input', () => {
        expect(formatDuration('90')).toBe('1m 30s');
    });
});
