import { describe, it, expect } from 'vitest';
import { trimTo35 } from '../../utils/stringFormat';
import { getTimeOfDayFraction, toLocaleDateString, formatHHMM, formatHM12, localDateStr } from '../../utils/dateFormat';
import { countChipsForDate, indexChipsByDate } from '../TimeSeriesView';

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

describe('localDateStr (browser-local YYYY-MM-DD)', () => {
    it('returns YYYY-MM-DD format', () => {
        expect(localDateStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('uses the browser local calendar, not UTC', () => {
        // Construct a Date that is explicitly 23:30 local on Apr 17.
        // toISOString() would report Apr 18 if browser is west of UTC — localDateStr must not.
        const d = new Date(2026, 3, 17, 23, 30, 0);   // month is 0-indexed: 3 = April
        expect(localDateStr(d)).toBe('2026-04-17');
    });

    it('pads single-digit months and days to two chars', () => {
        const d = new Date(2026, 0, 5, 12, 0, 0);
        expect(localDateStr(d)).toBe('2026-01-05');
    });

    it('handles the end-of-year boundary correctly', () => {
        const d = new Date(2026, 11, 31, 23, 59, 59);
        expect(localDateStr(d)).toBe('2026-12-31');
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

describe('countChipsForDate (Sidewalk uniform-height precomputation)', () => {
    const TZ = 'UTC';
    const DAY = '2026-04-17';
    const OTHER = '2026-04-18';

    it('returns 0 for empty / invalid input', () => {
        expect(countChipsForDate([], [], DAY, TZ, 'swarm')).toBe(0);
        expect(countChipsForDate(null, [], DAY, TZ, 'swarm')).toBe(0);
        expect(countChipsForDate([{ id: 1, completed_at: `${DAY} 12:00:00` }], [], null, TZ, 'bead'))
            .toBe(0);
    });

    it('skips requirements with no completed_at', () => {
        const reqs = [
            { id: 1, completed_at: null },
            { id: 2, completed_at: `${DAY} 10:00:00` },
        ];
        expect(countChipsForDate(reqs, [], DAY, TZ, 'bead')).toBe(1);
    });

    it('filters out requirements whose completed_at lands on a different day', () => {
        const reqs = [
            { id: 1, completed_at: `${DAY} 09:00:00` },
            { id: 2, completed_at: `${OTHER} 09:00:00` },
            { id: 3, completed_at: `${DAY} 23:00:00` },
        ];
        expect(countChipsForDate(reqs, [], DAY, TZ, 'bead')).toBe(2);
        expect(countChipsForDate(reqs, [], OTHER, TZ, 'bead')).toBe(1);
    });

    it('bead mode: one chip per same-day requirement (sessions ignored)', () => {
        const reqs = [
            { id: 1, completed_at: `${DAY} 09:00:00` },
            { id: 2, completed_at: `${DAY} 10:00:00` },
            { id: 3, completed_at: `${DAY} 11:00:00` },
        ];
        const sessions = [
            { id: 10, source_ref: 'requirement:1', started_at: `${DAY} 08:00:00` },
            { id: 11, source_ref: 'requirement:1', started_at: `${DAY} 08:30:00` },
        ];
        expect(countChipsForDate(reqs, sessions, DAY, TZ, 'bead')).toBe(3);
    });

    it('swarm mode: one chip per (requirement, session) pair', () => {
        const reqs = [
            { id: 1, completed_at: `${DAY} 09:00:00` },
            { id: 2, completed_at: `${DAY} 10:00:00` },
        ];
        const sessions = [
            { id: 10, source_ref: 'requirement:1', started_at: `${DAY} 08:00:00` },
            { id: 11, source_ref: 'requirement:1', started_at: `${DAY} 08:30:00` },
            { id: 20, source_ref: 'requirement:2', started_at: `${DAY} 09:30:00` },
        ];
        // req 1 has 2 sessions + req 2 has 1 session → 3 chips
        expect(countChipsForDate(reqs, sessions, DAY, TZ, 'swarm')).toBe(3);
    });

    it('swarm mode: bare-requirement fallback when no linked session', () => {
        const reqs = [
            { id: 1, completed_at: `${DAY} 09:00:00` },   // no sessions
            { id: 2, completed_at: `${DAY} 10:00:00` },   // 2 sessions
        ];
        const sessions = [
            { id: 20, source_ref: 'requirement:2', started_at: `${DAY} 09:00:00` },
            { id: 21, source_ref: 'requirement:2', started_at: `${DAY} 09:15:00` },
        ];
        // req 1 = 1 bare chip, req 2 = 2 session chips → 3 chips
        expect(countChipsForDate(reqs, sessions, DAY, TZ, 'swarm')).toBe(3);
    });

    it('swarm mode: sessions whose requirement falls on a different day do not count', () => {
        const reqs = [
            { id: 1, completed_at: `${OTHER} 09:00:00` },
        ];
        const sessions = [
            { id: 10, source_ref: 'requirement:1', started_at: `${DAY} 08:00:00` },
            { id: 11, source_ref: 'requirement:1', started_at: `${DAY} 08:30:00` },
        ];
        expect(countChipsForDate(reqs, sessions, DAY, TZ, 'swarm')).toBe(0);
    });
});

describe('indexChipsByDate (Sidewalk single-pass bucket)', () => {
    const TZ = 'UTC';
    const D1 = '2026-04-17';
    const D2 = '2026-04-18';

    it('returns empty Map for invalid / empty input', () => {
        expect(indexChipsByDate(null, [], TZ, 'swarm').size).toBe(0);
        expect(indexChipsByDate([], [], TZ, 'bead').size).toBe(0);
    });

    it('bead mode: one count per same-day requirement, grouped by date', () => {
        const reqs = [
            { id: 1, completed_at: `${D1} 09:00:00` },
            { id: 2, completed_at: `${D1} 10:00:00` },
            { id: 3, completed_at: `${D2} 11:00:00` },
            { id: 4, completed_at: null },
        ];
        const map = indexChipsByDate(reqs, [], TZ, 'bead');
        expect(map.get(D1)).toBe(2);
        expect(map.get(D2)).toBe(1);
        expect(map.size).toBe(2);
    });

    it('swarm mode: sessions bucket under their requirement\'s completed_at date', () => {
        const reqs = [
            { id: 1, completed_at: `${D1} 09:00:00` },    // 2 sessions
            { id: 2, completed_at: `${D2} 10:00:00` },    // 0 sessions → bare-req fallback
        ];
        const sessions = [
            { id: 10, source_ref: 'requirement:1', started_at: `${D1} 08:00:00` },
            { id: 11, source_ref: 'requirement:1', started_at: `${D1} 08:30:00` },
        ];
        const map = indexChipsByDate(reqs, sessions, TZ, 'swarm');
        expect(map.get(D1)).toBe(2);    // 2 (req,session) chips on D1
        expect(map.get(D2)).toBe(1);    // 1 bare-req chip on D2
    });

    it('produces the same per-date counts as countChipsForDate', () => {
        const reqs = [
            { id: 1, completed_at: `${D1} 09:00:00` },
            { id: 2, completed_at: `${D1} 10:00:00` },
            { id: 3, completed_at: `${D2} 11:00:00` },
        ];
        const sessions = [
            { id: 10, source_ref: 'requirement:1', started_at: `${D1} 08:00:00` },
            { id: 11, source_ref: 'requirement:2', started_at: `${D1} 09:00:00` },
            { id: 12, source_ref: 'requirement:3', started_at: `${D2} 10:00:00` },
        ];
        for (const vizKey of ['bead', 'swarm']) {
            const map = indexChipsByDate(reqs, sessions, TZ, vizKey);
            for (const d of [D1, D2]) {
                expect(map.get(d) || 0).toBe(countChipsForDate(reqs, sessions, d, TZ, vizKey));
            }
        }
    });
});
