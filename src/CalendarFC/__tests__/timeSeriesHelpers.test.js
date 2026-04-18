import { describe, it, expect } from 'vitest';
import { trimTo35 } from '../../utils/stringFormat';
import { getTimeOfDayFraction, toLocaleDateString, formatHHMM, formatHM12 } from '../../utils/dateFormat';

describe('trimTo35', () => {
    it('returns empty for null/undefined/empty', () => {
        expect(trimTo35(null)).toBe('');
        expect(trimTo35(undefined)).toBe('');
        expect(trimTo35('')).toBe('');
    });

    it('returns original string when under 35 chars', () => {
        expect(trimTo35('hello')).toBe('hello');
        expect(trimTo35('a'.repeat(34))).toBe('a'.repeat(34));
    });

    it('returns original at exactly 35 chars', () => {
        const s = 'a'.repeat(35);
        expect(trimTo35(s)).toBe(s);
    });

    it('truncates to 34 chars + ellipsis when over 35', () => {
        const s = 'a'.repeat(40);
        const result = trimTo35(s);
        expect(result).toBe('a'.repeat(34) + '…');
        expect(result.length).toBe(35);
    });

    it('handles numeric input by stringifying', () => {
        expect(trimTo35(12345)).toBe('12345');
    });
});

describe('getTimeOfDayFraction', () => {
    it('returns null for invalid input', () => {
        expect(getTimeOfDayFraction(null)).toBe(null);
        expect(getTimeOfDayFraction(undefined)).toBe(null);
        expect(getTimeOfDayFraction('not-a-date')).toBe(null);
    });

    it('noon UTC in UTC tz = 0.5', () => {
        const frac = getTimeOfDayFraction('2026-04-17 12:00:00', 'UTC');
        expect(frac).toBeCloseTo(0.5, 5);
    });

    it('midnight UTC in UTC tz = 0', () => {
        const frac = getTimeOfDayFraction('2026-04-17 00:00:00', 'UTC');
        expect(frac).toBeCloseTo(0, 5);
    });

    it('06:00 UTC in UTC tz = 0.25', () => {
        const frac = getTimeOfDayFraction('2026-04-17 06:00:00', 'UTC');
        expect(frac).toBeCloseTo(0.25, 5);
    });

    it('23:59:00 UTC = ~0.99931', () => {
        // 23*3600 + 59*60 = 86340 / 86400 = 0.999306
        const frac = getTimeOfDayFraction('2026-04-17 23:59:00', 'UTC');
        expect(frac).toBeCloseTo(0.999306, 5);
    });

    it('timezone shifts the fraction', () => {
        // 2026-04-17 12:00 UTC → 05:00 in America/Los_Angeles (PDT, UTC-7)
        const frac = getTimeOfDayFraction('2026-04-17 12:00:00', 'America/Los_Angeles');
        expect(frac).toBeCloseTo(5 / 24, 5);
    });

    it('honours seconds', () => {
        // 12:00:30 → (12*3600 + 30) / 86400 = 0.500347
        const frac = getTimeOfDayFraction('2026-04-17 12:00:30', 'UTC');
        expect(frac).toBeCloseTo(0.500347, 5);
    });
});

describe('formatHHMM (TimeSeries chip labels)', () => {
    it('returns empty for invalid input', () => {
        expect(formatHHMM(null)).toBe('');
        expect(formatHHMM('not-a-date')).toBe('');
    });

    it('formats UTC noon in UTC as 12:00', () => {
        expect(formatHHMM('2026-04-17 12:00:00', 'UTC')).toBe('12:00');
    });

    it('formats midnight UTC in UTC as 00:00', () => {
        expect(formatHHMM('2026-04-17 00:00:00', 'UTC')).toBe('00:00');
    });

    it('shifts noon UTC → 05:00 in PDT', () => {
        expect(formatHHMM('2026-04-17 12:00:00', 'America/Los_Angeles')).toBe('05:00');
    });

    it('zero-pads single-digit minutes', () => {
        expect(formatHHMM('2026-04-17 09:05:00', 'UTC')).toBe('09:05');
    });
});

describe('formatHM12 (AM/PM chip labels)', () => {
    it('returns empty for invalid input', () => {
        expect(formatHM12(null)).toBe('');
        expect(formatHM12('not-a-date')).toBe('');
    });

    it('noon UTC in UTC → 12:00p', () => {
        expect(formatHM12('2026-04-17 12:00:00', 'UTC')).toBe('12:00p');
    });

    it('midnight UTC in UTC → 12:00a', () => {
        expect(formatHM12('2026-04-17 00:00:00', 'UTC')).toBe('12:00a');
    });

    it('7:45pm UTC in UTC', () => {
        expect(formatHM12('2026-04-17 19:45:00', 'UTC')).toBe('7:45p');
    });

    it('shifts noon UTC → 5:00a in PDT', () => {
        expect(formatHM12('2026-04-17 12:00:00', 'America/Los_Angeles')).toBe('5:00a');
    });

    it('zero-pads minutes', () => {
        expect(formatHM12('2026-04-17 09:05:00', 'UTC')).toBe('9:05a');
    });
});

describe('toLocaleDateString (TimeSeries day-bucket filter)', () => {
    it('keeps same-day UTC event on same day in UTC tz', () => {
        expect(toLocaleDateString('2026-04-17 12:00:00', 'UTC')).toBe('2026-04-17');
    });

    it('shifts late-evening UTC event back a day in PDT', () => {
        // 2026-04-18 02:00 UTC → 2026-04-17 19:00 PDT → still April 17 in LA tz.
        expect(toLocaleDateString('2026-04-18 02:00:00', 'America/Los_Angeles')).toBe('2026-04-17');
    });
});
