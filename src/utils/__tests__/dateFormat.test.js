import { describe, it, expect } from 'vitest';
import { formatCardDateTime, periodDateRange, shiftPeriod, currentPeriodStart, formatPeriodLabel } from '../dateFormat';

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
