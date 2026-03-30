import { describe, it, expect } from 'vitest';
import { formatCardDateTime } from '../dateFormat';

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
