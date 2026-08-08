import { describe, it, expect } from 'vitest';
import { formatCardDateTime, formatDateTime, formatDate, formatHM12, formatHHMM, getTimeOfDayFraction, periodDateRange, shiftPeriod, currentPeriodStart, formatPeriodLabel, toDateTimeLocalValue, fromDateTimeLocalValue, trimMicroseconds } from '../dateFormat';

describe('trimMicroseconds', () => {
    it('strips the microsecond tail from a MySQL DATETIME(6) string', () => {
        expect(trimMicroseconds('2026-06-12 17:14:08.000000')).toBe('2026-06-12 17:14:08');
    });

    it('strips a nonzero fractional tail', () => {
        expect(trimMicroseconds('2026-06-12 17:14:08.123456')).toBe('2026-06-12 17:14:08');
    });

    it('leaves an already-trimmed value untouched', () => {
        expect(trimMicroseconds('2026-06-12 17:14:08')).toBe('2026-06-12 17:14:08');
    });

    it('passes an ISO T-string through unchanged', () => {
        expect(trimMicroseconds('2026-06-12T17:14:08')).toBe('2026-06-12T17:14:08');
    });

    it('returns the em-dash placeholder for null/empty', () => {
        expect(trimMicroseconds(null)).toBe('—');
        expect(trimMicroseconds('')).toBe('—');
    });
});

// ── naive datetime parsing (req #3120) ──────────────────────────────────────
// A naive datetime with no Z/offset designator is stored/produced as UTC
// everywhere in Darwin, regardless of whether the separator is a space (MySQL
// JSON_OBJECT) or a 'T' (ISO-ish). Every formatter below shares the same
// `toDate` parse helper, so one regression here would silently affect all of
// them — the guard is tested once at each formatter's front door.
//
// Every case below pins an ABSOLUTE expected value, not just T-form/space-form
// equality: the pre-fix bug parsed the T form as the *process's local*
// timezone, so on a host whose local zone happens to be UTC (a bare parity
// check, or a CI/container image defaulting to UTC) the buggy and fixed
// parses are byte-identical and a parity-only assertion would pass against
// either. `test:unit` pins `TZ=America/Los_Angeles` (package.json) so these
// absolute values are meaningful wherever the suite runs; keep both a fixed
// TZ and an absolute expectation if this block is ever extended.
describe('naive datetime parsing — space and T forms agree', () => {
    it('formatDateTime reads the T form as the same absolute UTC instant as the space form', () => {
        expect(formatDateTime('2026-07-24T06:31:38', 'UTC')).toBe('Jul 24, 2026, 6:31 AM');
        expect(formatDateTime('2026-07-24 06:31:38', 'UTC')).toBe('Jul 24, 2026, 6:31 AM');
    });

    it('formatDateTime still respects an explicit offset', () => {
        // 06:31:38+05:00 is 01:31:38 UTC — must NOT be treated as naive UTC.
        expect(formatDateTime('2026-07-24T06:31:38+05:00', 'UTC')).toBe('Jul 24, 2026, 1:31 AM');
        expect(formatDateTime('2026-07-24T06:31:38Z', 'UTC')).toBe('Jul 24, 2026, 6:31 AM');
    });

    it('formatDate reads the T form as the same absolute UTC instant as the space form', () => {
        expect(formatDate('2026-07-24T23:31:38', 'UTC')).toBe('Jul 24, 2026');
        expect(formatDate('2026-07-24 23:31:38', 'UTC')).toBe('Jul 24, 2026');
    });

    it('formatHM12 reads the T form as the same absolute UTC instant as the space form', () => {
        expect(formatHM12('2026-07-24T06:31:38', 'UTC')).toBe('6:31a');
        expect(formatHM12('2026-07-24 06:31:38', 'UTC')).toBe('6:31a');
    });

    it('formatHHMM reads the T form as the same absolute UTC instant as the space form', () => {
        expect(formatHHMM('2026-07-24T06:31:38', 'UTC')).toBe('06:31');
        expect(formatHHMM('2026-07-24 06:31:38', 'UTC')).toBe('06:31');
    });

    it('getTimeOfDayFraction reads the T form as the same absolute UTC instant as the space form', () => {
        expect(getTimeOfDayFraction('2026-07-24T06:31:38', 'UTC')).toBeCloseTo(0.2719675925925926, 12);
        expect(getTimeOfDayFraction('2026-07-24 06:31:38', 'UTC')).toBeCloseTo(0.2719675925925926, 12);
    });
});

describe('formatCardDateTime', () => {
    // Use a fixed timezone to avoid test-environment dependence
    const tz = 'America/Los_Angeles';

    it('formats MySQL datetime with weekday, date, and time', () => {
        // 2024-06-15 19:30:00 UTC → 12:30 PM PDT (June = PDT, UTC-7)
        const result = formatCardDateTime('2024-06-15 19:30:00', tz);
        expect(result).toBe('Sat, Jun 15, 2024 @ 12:30pm');
    });

    it('shows no leading zero on single-digit hour', () => {
        // 2024-06-15 09:05:00 UTC → 2:05 AM PDT
        const result = formatCardDateTime('2024-06-15 09:05:00', tz);
        expect(result).toBe('Sat, Jun 15, 2024 @ 2:05am');
    });

    it('shows leading zero on minutes', () => {
        // 2024-06-15 14:03:00 UTC → 7:03 AM PDT
        const result = formatCardDateTime('2024-06-15 14:03:00', tz);
        expect(result).toBe('Sat, Jun 15, 2024 @ 7:03am');
    });

    it('handles PST (winter) correctly', () => {
        // 2024-01-15 20:00:00 UTC → 12:00 PM PST (January = PST, UTC-8)
        const result = formatCardDateTime('2024-01-15 20:00:00', tz);
        expect(result).toBe('Mon, Jan 15, 2024 @ 12:00pm');
    });

    it('handles ISO format with Z suffix', () => {
        const result = formatCardDateTime('2024-06-15T19:30:00Z', tz);
        expect(result).toBe('Sat, Jun 15, 2024 @ 12:30pm');
    });

    it('returns em dash for null input', () => {
        expect(formatCardDateTime(null, tz)).toBe('—');
    });

    it('returns em dash for empty string', () => {
        expect(formatCardDateTime('', tz)).toBe('—');
    });

    it('returns em dash for invalid date', () => {
        expect(formatCardDateTime('not-a-date', tz)).toBe('—');
    });

    it('falls back to browser default when timezone is null', () => {
        const result = formatCardDateTime('2024-06-15 19:30:00', null);
        // Should not throw; exact output depends on environment TZ
        expect(typeof result).toBe('string');
        expect(result).not.toBe('—');
    });
});

// ── toDateTimeLocalValue ────────────────────────────────────────────────────

describe('toDateTimeLocalValue', () => {
    const tz = 'America/Los_Angeles';

    it('converts MySQL UTC datetime to local YYYY-MM-DDTHH:MM (PDT, UTC-7)', () => {
        // 2024-06-15 19:30:00 UTC → 12:30 PM PDT
        expect(toDateTimeLocalValue('2024-06-15 19:30:00', tz)).toBe('2024-06-15T12:30');
    });

    it('converts MySQL UTC datetime (PST, UTC-8)', () => {
        // 2024-01-15 20:00:00 UTC → 12:00 PM PST
        expect(toDateTimeLocalValue('2024-01-15 20:00:00', tz)).toBe('2024-01-15T12:00');
    });

    it('handles ISO format with Z suffix', () => {
        expect(toDateTimeLocalValue('2024-06-15T19:30:00Z', tz)).toBe('2024-06-15T12:30');
    });

    it('returns empty string for null', () => {
        expect(toDateTimeLocalValue(null, tz)).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(toDateTimeLocalValue('', tz)).toBe('');
    });

    it('handles midnight UTC (pads hours to 2 digits)', () => {
        // 2024-06-15 07:00:00 UTC → midnight PDT (00:00)
        expect(toDateTimeLocalValue('2024-06-15 07:00:00', tz)).toBe('2024-06-15T00:00');
    });

    it('works without timezone (falls back to undefined)', () => {
        const result = toDateTimeLocalValue('2024-06-15 19:30:00', null);
        // Should return a valid YYYY-MM-DDTHH:MM string, exact value depends on env TZ
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });
});

// ── fromDateTimeLocalValue ──────────────────────────────────────────────────

describe('fromDateTimeLocalValue', () => {
    const tz = 'America/Los_Angeles';

    it('converts PDT local datetime to MySQL UTC string', () => {
        // 2024-06-15T12:30 PDT (UTC-7) → 2024-06-15 19:30:00 UTC
        expect(fromDateTimeLocalValue('2024-06-15T12:30', tz)).toBe('2024-06-15 19:30:00');
    });

    it('converts PST local datetime to MySQL UTC string', () => {
        // 2024-01-15T12:00 PST (UTC-8) → 2024-01-15 20:00:00 UTC
        expect(fromDateTimeLocalValue('2024-01-15T12:00', tz)).toBe('2024-01-15 20:00:00');
    });

    it('returns null for null input', () => {
        expect(fromDateTimeLocalValue(null, tz)).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(fromDateTimeLocalValue('', tz)).toBeNull();
    });

    it('roundtrips with toDateTimeLocalValue (PDT)', () => {
        const original = '2024-06-15 19:30:00';
        const local = toDateTimeLocalValue(original, tz);
        const restored = fromDateTimeLocalValue(local, tz);
        expect(restored).toBe(original);
    });

    it('roundtrips with toDateTimeLocalValue (PST)', () => {
        const original = '2024-01-15 20:00:00';
        const local = toDateTimeLocalValue(original, tz);
        const restored = fromDateTimeLocalValue(local, tz);
        expect(restored).toBe(original);
    });

    it('roundtrips across DST boundary (spring forward)', () => {
        // 2024-03-10 10:00:00 UTC → 2:00 AM PST (clocks spring forward at 2am)
        const original = '2024-03-10 10:00:00';
        const local = toDateTimeLocalValue(original, tz);
        const restored = fromDateTimeLocalValue(local, tz);
        expect(restored).toBe(original);
    });
});

// ── periodDateRange ─────────────────────────────────────────────────────────

describe('periodDateRange', () => {
    it('returns null for null dateStr', () => {
        expect(periodDateRange(null, 'week')).toEqual({ start: null, end: null });
    });

    it('week: returns 7-day range from start date', () => {
        expect(periodDateRange('2026-04-06', 'week')).toEqual({
            start: '2026-04-06', end: '2026-04-12',
        });
    });

    it('week: handles cross-month boundary', () => {
        expect(periodDateRange('2026-03-29', 'week')).toEqual({
            start: '2026-03-29', end: '2026-04-04',
        });
    });

    it('week: handles cross-year boundary', () => {
        expect(periodDateRange('2025-12-28', 'week')).toEqual({
            start: '2025-12-28', end: '2026-01-03',
        });
    });

    it('month: returns full month range', () => {
        expect(periodDateRange('2026-04-01', 'month')).toEqual({
            start: '2026-04-01', end: '2026-04-30',
        });
    });

    it('month: handles February (non-leap year)', () => {
        expect(periodDateRange('2025-02-01', 'month')).toEqual({
            start: '2025-02-01', end: '2025-02-28',
        });
    });

    it('month: handles February (leap year)', () => {
        expect(periodDateRange('2028-02-01', 'month')).toEqual({
            start: '2028-02-01', end: '2028-02-29',
        });
    });

    it('month: handles December', () => {
        expect(periodDateRange('2026-12-01', 'month')).toEqual({
            start: '2026-12-01', end: '2026-12-31',
        });
    });
});

// ── shiftPeriod ─────────────────────────────────────────────────────────────

describe('shiftPeriod', () => {
    it('week: shifts forward by 7 days', () => {
        expect(shiftPeriod('2026-04-06', 'week', 1)).toBe('2026-04-13');
    });

    it('week: shifts backward by 7 days', () => {
        expect(shiftPeriod('2026-04-06', 'week', -1)).toBe('2026-03-30');
    });

    it('month: shifts forward by 1 month', () => {
        expect(shiftPeriod('2026-04-01', 'month', 1)).toBe('2026-05-01');
    });

    it('month: shifts backward by 1 month', () => {
        expect(shiftPeriod('2026-04-01', 'month', -1)).toBe('2026-03-01');
    });

    it('month: shifts Dec forward to Jan next year', () => {
        expect(shiftPeriod('2026-12-01', 'month', 1)).toBe('2027-01-01');
    });

    it('month: shifts Jan backward to Dec prev year', () => {
        expect(shiftPeriod('2026-01-01', 'month', -1)).toBe('2025-12-01');
    });
});

// ── currentPeriodStart ──────────────────────────────────────────────────────

describe('currentPeriodStart', () => {
    it('week: returns a Sunday (day 0)', () => {
        const result = currentPeriodStart('week');
        const d = new Date(result + 'T12:00:00');
        expect(d.getDay()).toBe(0); // Sunday
    });

    it('month: returns the 1st of the current month', () => {
        const result = currentPeriodStart('month');
        expect(result).toMatch(/^\d{4}-\d{2}-01$/);
        const now = new Date();
        const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        expect(result).toBe(expected);
    });
});

// ── formatPeriodLabel ───────────────────────────────────────────────────────

describe('formatPeriodLabel', () => {
    it('returns empty string for null dateStr', () => {
        expect(formatPeriodLabel(null, 'week')).toBe('');
    });

    it('month: formats as full month name + year', () => {
        expect(formatPeriodLabel('2026-04-01', 'month')).toBe('April 2026');
    });

    it('week: same-month range', () => {
        expect(formatPeriodLabel('2026-04-06', 'week')).toBe('Apr 6 – 12, 2026');
    });

    it('week: cross-month range', () => {
        expect(formatPeriodLabel('2026-03-29', 'week')).toBe('Mar 29 – Apr 4, 2026');
    });

    it('week: cross-year range', () => {
        expect(formatPeriodLabel('2025-12-28', 'week')).toBe('Dec 28, 2025 – Jan 3, 2026');
    });
});
