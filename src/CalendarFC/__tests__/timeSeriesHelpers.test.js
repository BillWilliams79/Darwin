import { describe, it, expect } from 'vitest';
import { trimTo35 } from '../../utils/stringFormat';
import { getTimeOfDayFraction, toLocaleDateString, formatHHMM, formatHM12, localDateStr } from '../../utils/dateFormat';
import {
    countChipsForDate,
    indexChipsByDate,
    indexMaxStackByDate,
    indexSwarmExtraChipsByDate,
    centeredDateRange,
    extendDates,
    pruneDates,
    elevatorPanelHeight,
    endOfWeek,
    cappedCenteredRange,
    assignSwarmLanes,
    buildCrossDayGhosts,
} from '../TimeSeriesView';
import { getSpaceMultiplier } from '../timeSeriesSizes';

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

describe('indexMaxStackByDate (Elevator per-panel sizing)', () => {
    const TZ = 'UTC';
    const D1 = '2026-04-17';
    const D2 = '2026-04-18';

    it('returns empty Map for invalid / empty input', () => {
        expect(indexMaxStackByDate(null, [], TZ, 'bead').size).toBe(0);
        expect(indexMaxStackByDate([], [], TZ, 'swarm').size).toBe(0);
    });

    it('swarm mode: maxRow = chips − 1 per date (one lane per chip)', () => {
        const reqs = [
            { id: 1, completed_at: `${D1} 09:00:00` },
            { id: 2, completed_at: `${D1} 10:00:00` },
            { id: 3, completed_at: `${D2} 11:00:00` },
        ];
        const sessions = [
            { id: 10, source_ref: 'requirement:1', started_at: `${D1} 08:00:00` },
            { id: 11, source_ref: 'requirement:1', started_at: `${D1} 08:30:00` },
            { id: 12, source_ref: 'requirement:2', started_at: `${D1} 09:30:00` },
        ];
        const map = indexMaxStackByDate(reqs, sessions, TZ, 'swarm');
        expect(map.get(D1)).toBe(2);    // 3 chips → rows 0,1,2 → maxRow 2
        expect(map.get(D2)).toBe(0);    // 1 bare-req chip → row 0
    });

    it('bead mode: well-separated chips collapse to row 0 (no stacking)', () => {
        const reqs = [
            { id: 1, completed_at: `${D1} 00:00:00` },   // leftPct ≈ 0
            { id: 2, completed_at: `${D1} 08:00:00` },   // ≈ 33.3
            { id: 3, completed_at: `${D1} 16:00:00` },   // ≈ 66.6
            { id: 4, completed_at: `${D1} 23:00:00` },   // ≈ 95.8
        ];
        const map = indexMaxStackByDate(reqs, [], TZ, 'bead');
        expect(map.get(D1)).toBe(0);
    });

    it('bead mode: chips within minGapPct cluster and stack', () => {
        // Same-minute requirements → identical leftPct → guaranteed to cluster.
        const reqs = [
            { id: 1, completed_at: `${D1} 09:00:00` },
            { id: 2, completed_at: `${D1} 09:00:01` },
            { id: 3, completed_at: `${D1} 09:00:02` },
        ];
        const map = indexMaxStackByDate(reqs, [], TZ, 'bead');
        expect(map.get(D1)).toBe(2);    // 3 clustered chips → rows 0,1,2
    });

    it('bead mode vs swarm mode: bead can be much shorter than swarm for the same data', () => {
        // 10 requirements spread evenly through the day — bead clusters them
        // into row 0 only; swarm gives each its own lane.
        const reqs = Array.from({ length: 10 }, (_, i) => ({
            id: i + 1,
            completed_at: `${D1} ${String(2 + i * 2).padStart(2, '0')}:00:00`,
        }));
        const beadMap = indexMaxStackByDate(reqs, [], TZ, 'bead');
        const swarmMap = indexMaxStackByDate(reqs, [], TZ, 'swarm');
        expect(beadMap.get(D1)).toBeLessThan(swarmMap.get(D1));
        expect(swarmMap.get(D1)).toBe(9);   // 10 chips → rows 0..9
    });

    it('bead mode: ignores requirements with null completed_at', () => {
        const reqs = [
            { id: 1, completed_at: `${D1} 09:00:00` },
            { id: 2, completed_at: null },
            { id: 3, completed_at: undefined },
        ];
        const map = indexMaxStackByDate(reqs, [], TZ, 'bead');
        expect(map.get(D1)).toBe(0);
        expect(map.size).toBe(1);
    });

    // req #2797 — swarm panels also stack in-progress phantom + undone chips.
    it('swarm mode: counts in-progress phantom lanes on the start-day panel', () => {
        // One completed req on D1 (1 chip) + one in-progress session whose
        // swarm-start fired on D1 (1 phantom). Stack should be 2 chips → maxRow 1,
        // not 0 as the completed-only count would give.
        const reqs = [{ id: 1, completed_at: `${D1} 09:00:00` }];
        const sessions = [
            { id: 10, source_ref: 'requirement:1', started_at: `${D1} 08:00:00` },
            { id: 99, source_ref: 'requirement:2', started_at: `${D1} 07:00:00`, swarm_status: 'active' },
        ];
        const extras = {
            swarmStarts: [{ id: 500, started_at: `${D1} 07:00:00` }],
            swarmStartSessions: [{ swarm_start_fk: 500, session_fk: 99 }],
            // req 2 has no completed_at → phantom is rendered (not the real chip).
            requirementById: new Map([['2', { id: 2 }]]),
            today: D2,   // today differs from D1 so the start-day branch is exercised
        };
        const withExtras = indexMaxStackByDate(reqs, sessions, TZ, 'swarm', extras);
        expect(withExtras.get(D1)).toBe(1);   // completed(1) + phantom(1) = 2 → maxRow 1
        const withoutExtras = indexMaxStackByDate(reqs, sessions, TZ, 'swarm');
        expect(withoutExtras.get(D1)).toBe(0);   // backward-compat: completed-only
    });

    it('swarm mode: clamps an in-progress phantom onto today\'s panel too', () => {
        // Session started on D1, today is D2. The phantom appears on BOTH D1
        // (start day) and D2 (clamped to today).
        const reqs = [];
        const sessions = [
            { id: 99, source_ref: 'requirement:2', started_at: `${D1} 07:00:00`, swarm_status: 'active' },
        ];
        const extras = {
            swarmStarts: [{ id: 500, started_at: `${D1} 07:00:00` }],
            swarmStartSessions: [{ swarm_start_fk: 500, session_fk: 99 }],
            requirementById: new Map([['2', { id: 2 }]]),
            today: D2,
        };
        const map = indexMaxStackByDate(reqs, sessions, TZ, 'swarm', extras);
        expect(map.get(D1)).toBe(0);   // 1 phantom → maxRow 0
        expect(map.get(D2)).toBe(0);   // 1 clamped phantom on today → maxRow 0
    });

    it('swarm mode: hidden-status sessions and completed reqs do NOT add phantom lanes', () => {
        const reqs = [{ id: 1, completed_at: `${D1} 09:00:00` }];
        const sessions = [
            { id: 91, source_ref: 'requirement:2', started_at: `${D1} 07:00:00`, swarm_status: 'paused' },     // hidden
            { id: 92, source_ref: 'requirement:1', started_at: `${D1} 07:30:00`, swarm_status: 'active' },     // req completed → real chip
            { id: 93, source_ref: 'requirement:1', started_at: `${D1} 06:00:00` },                             // completed-req session (counted by indexChipsByDate)
        ];
        const extras = {
            swarmStarts: [{ id: 500, started_at: `${D1} 07:00:00` }],
            swarmStartSessions: [
                { swarm_start_fk: 500, session_fk: 91 },
                { swarm_start_fk: 500, session_fk: 92 },
            ],
            requirementById: new Map([['1', { id: 1, completed_at: `${D1} 09:00:00` }], ['2', { id: 2 }]]),
            today: D2,
        };
        // req 1 has 2 linked sessions (92,93) → 2 completed chips → maxRow 1.
        // No phantom added: 91 is paused (hidden), 92's req is completed.
        const map = indexMaxStackByDate(reqs, sessions, TZ, 'swarm', extras);
        expect(map.get(D1)).toBe(1);
    });

    it('swarm mode: counts undone tombstone lanes on the undone_at day', () => {
        const reqs = [{ id: 1, completed_at: `${D1} 09:00:00` }];
        const extras = {
            swarmUndos: [
                { id: 1, undone_at: `${D1} 12:00:00` },
                { id: 2, undone_at: `${D1} 13:00:00` },
                { id: 3, undone_at: `${D2} 10:00:00` },
            ],
            today: D2,
        };
        const map = indexMaxStackByDate(reqs, [], TZ, 'swarm', extras);
        expect(map.get(D1)).toBe(2);   // completed(1) + undone(2) = 3 → maxRow 2
        expect(map.get(D2)).toBe(0);   // undone(1) only → maxRow 0
    });
});

describe('indexSwarmExtraChipsByDate (req #2797 phantom + undone per-day counts)', () => {
    const TZ = 'UTC';
    const D1 = '2026-04-17';
    const D2 = '2026-04-18';

    it('returns an empty Map when no swarm extras are supplied', () => {
        expect(indexSwarmExtraChipsByDate({ timezone: TZ }).size).toBe(0);
    });

    it('buckets a start-day phantom and a clamped today phantom from one session', () => {
        const out = indexSwarmExtraChipsByDate({
            swarmStarts: [{ id: 500, started_at: `${D1} 07:00:00` }],
            swarmStartSessions: [{ swarm_start_fk: 500, session_fk: 99 }],
            sessions: [{ id: 99, source_ref: 'requirement:2', swarm_status: 'active' }],
            requirementById: new Map([['2', { id: 2 }]]),
            timezone: TZ,
            today: D2,
        });
        expect(out.get(D1)).toBe(1);   // start day
        expect(out.get(D2)).toBe(1);   // clamped to today
    });

    it('does not double-count when the start day IS today', () => {
        const out = indexSwarmExtraChipsByDate({
            swarmStarts: [{ id: 500, started_at: `${D1} 07:00:00` }],
            swarmStartSessions: [{ swarm_start_fk: 500, session_fk: 99 }],
            sessions: [{ id: 99, source_ref: 'requirement:2', swarm_status: 'active' }],
            requirementById: new Map([['2', { id: 2 }]]),
            timezone: TZ,
            today: D1,
        });
        expect(out.get(D1)).toBe(1);   // single lane, no clamped duplicate
    });

    it('skips hidden-status sessions and completed-requirement sessions', () => {
        const out = indexSwarmExtraChipsByDate({
            swarmStarts: [{ id: 500, started_at: `${D1} 07:00:00` }],
            swarmStartSessions: [
                { swarm_start_fk: 500, session_fk: 91 },   // paused → hidden
                { swarm_start_fk: 500, session_fk: 92 },   // req completed → real chip
            ],
            sessions: [
                { id: 91, source_ref: 'requirement:2', swarm_status: 'paused' },
                { id: 92, source_ref: 'requirement:1', swarm_status: 'active' },
            ],
            requirementById: new Map([
                ['1', { id: 1, completed_at: `${D1} 09:00:00` }],
                ['2', { id: 2 }],
            ]),
            timezone: TZ,
            today: D1,
        });
        expect(out.size).toBe(0);
    });

    it('counts one undone chip per undone_at day', () => {
        const out = indexSwarmExtraChipsByDate({
            swarmUndos: [
                { id: 1, undone_at: `${D1} 12:00:00` },
                { id: 2, undone_at: `${D2} 10:00:00` },
                { id: 3, undone_at: null },   // ignored
            ],
            timezone: TZ,
        });
        expect(out.get(D1)).toBe(1);
        expect(out.get(D2)).toBe(1);
        expect(out.size).toBe(2);
    });
});

describe('extendDates (Sidewalk infinite scroll)', () => {
    const BASE = centeredDateRange('2026-04-17', 2);   // [04-15..04-19], 5 panels

    it('returns the original (or empty) for invalid input', () => {
        expect(extendDates(null, 'left', 5)).toEqual([]);
        expect(extendDates(undefined, 'right', 5)).toEqual([]);
        expect(extendDates([], 'left', 5)).toEqual([]);
        expect(extendDates(BASE, 'left', 0)).toBe(BASE);
        expect(extendDates(BASE, 'left', -3)).toBe(BASE);
        expect(extendDates(BASE, 'sideways', 5)).toBe(BASE);
    });

    it('left extension prepends N earlier days, in chronological order', () => {
        const next = extendDates(BASE, 'left', 3);
        expect(next.length).toBe(BASE.length + 3);
        expect(next.slice(0, 3)).toEqual(['2026-04-12', '2026-04-13', '2026-04-14']);
        // Original entries follow, untouched.
        expect(next.slice(3)).toEqual(BASE);
    });

    it('right extension appends N later days, in chronological order', () => {
        const next = extendDates(BASE, 'right', 3);
        expect(next.length).toBe(BASE.length + 3);
        expect(next.slice(0, BASE.length)).toEqual(BASE);
        expect(next.slice(BASE.length)).toEqual(['2026-04-20', '2026-04-21', '2026-04-22']);
    });

    it('produces a contiguous date string sequence with no gaps or duplicates', () => {
        const next = extendDates(extendDates(BASE, 'left', 5), 'right', 5);
        const set = new Set(next);
        expect(set.size).toBe(next.length);
        for (let i = 1; i < next.length; i++) {
            const prev = new Date(next[i - 1] + 'T12:00:00');
            const cur  = new Date(next[i]     + 'T12:00:00');
            expect(Math.round((cur - prev) / 86400000)).toBe(1);
        }
    });

    it('handles month / year boundaries', () => {
        const eom = extendDates(['2026-12-30', '2026-12-31'], 'right', 3);
        expect(eom).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);

        const bom = extendDates(['2026-03-01', '2026-03-02'], 'left', 3);
        expect(bom).toEqual(['2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    });

    it('does not mutate the input array', () => {
        const original = [...BASE];
        extendDates(BASE, 'left', 4);
        extendDates(BASE, 'right', 4);
        expect(BASE).toEqual(original);
    });
});

describe('pruneDates (Sidewalk infinite scroll)', () => {
    const TEN = centeredDateRange('2026-04-17', 4); // 9 entries 04-13..04-21
    const NINE_DATES = TEN;

    it('returns input untouched when length ≤ max', () => {
        expect(pruneDates(NINE_DATES, 9, 'left')).toEqual({ dates: NINE_DATES, removedCount: 0 });
        expect(pruneDates(NINE_DATES, 100, 'right')).toEqual({ dates: NINE_DATES, removedCount: 0 });
    });

    it('returns empty / original for invalid input', () => {
        expect(pruneDates(null, 5, 'left')).toEqual({ dates: [], removedCount: 0 });
        expect(pruneDates(undefined, 5, 'left')).toEqual({ dates: [], removedCount: 0 });
        expect(pruneDates([], 5, 'left')).toEqual({ dates: [], removedCount: 0 });
        expect(pruneDates(NINE_DATES, NaN, 'left')).toEqual({ dates: NINE_DATES, removedCount: 0 });
        expect(pruneDates(NINE_DATES, 3, 'middle')).toEqual({ dates: NINE_DATES, removedCount: 0 });
    });

    it('left prune drops entries from the start', () => {
        const { dates: pruned, removedCount } = pruneDates(NINE_DATES, 5, 'left');
        expect(removedCount).toBe(4);
        expect(pruned.length).toBe(5);
        // Last 5 of the original
        expect(pruned).toEqual(NINE_DATES.slice(4));
    });

    it('right prune drops entries from the end', () => {
        const { dates: pruned, removedCount } = pruneDates(NINE_DATES, 5, 'right');
        expect(removedCount).toBe(4);
        expect(pruned.length).toBe(5);
        // First 5 of the original
        expect(pruned).toEqual(NINE_DATES.slice(0, 5));
    });

    it('does not mutate the input array', () => {
        const original = [...NINE_DATES];
        pruneDates(NINE_DATES, 5, 'left');
        pruneDates(NINE_DATES, 5, 'right');
        expect(NINE_DATES).toEqual(original);
    });

    it('extension + prune is the bounded steady-state for one-directional scroll (elevator + sidewalk share this)', () => {
        // Simulate ten right-extensions of 10 panels each, capped at 60.
        // Both Sidewalk (req #2396) and Elevator (req #2779) drive the same
        // extendDates/pruneDates pair with EXTEND_BY=10, MAX_PANELS=60.
        let dates = centeredDateRange('2026-04-17', 10);   // 21 panels
        for (let i = 0; i < 10; i++) {
            const extended = extendDates(dates, 'right', 10);
            dates = pruneDates(extended, 60, 'left').dates;
        }
        expect(dates.length).toBe(60);
        // After 10 extensions of 10, the latest day is 100 days past 2026-04-27
        // (the original last day). The last entry should be that latest day.
        // Use shiftDate inline to check.
        const lastEntry = dates[dates.length - 1];
        const expectedLast = new Date('2026-04-27T12:00:00');
        expectedLast.setDate(expectedLast.getDate() + 100);
        const y = expectedLast.getFullYear();
        const m = String(expectedLast.getMonth() + 1).padStart(2, '0');
        const day = String(expectedLast.getDate()).padStart(2, '0');
        expect(lastEntry).toBe(`${y}-${m}-${day}`);
    });
});

describe('elevatorPanelHeight (req #2779 — shared by panelHeights memo + maybeExtend)', () => {
    // Reference implementation of the formula the helper must match. Kept inline
    // (not imported) so a drift in either the helper OR the renderer is caught.
    const expected = (maxStackRow, circleDiameter, spaceKey) => {
        const BASE = 140, bubbleOffset = 20, chromeBottom = 46;
        const dateClearance = Math.ceil(circleDiameter / 2) + 4;
        const rowSpacing = Math.max(16, Math.round((circleDiameter + 4) * getSpaceMultiplier(spaceKey)));
        return Math.max(
            BASE,
            Math.max(0, maxStackRow) * rowSpacing + bubbleOffset + circleDiameter + chromeBottom + dateClearance,
        );
    };

    it('matches the reference formula across a grid of inputs', () => {
        for (const rows of [0, 1, 3, 8, 20]) {
            for (const cd of [10, 16, 24]) {
                for (const sk of [1, 2, 3, 4]) {
                    expect(elevatorPanelHeight(rows, cd, sk)).toBe(expected(rows, cd, sk));
                }
            }
        }
    });

    it('never returns less than the 140px base floor (light days stay short, not tiny)', () => {
        expect(elevatorPanelHeight(0, 16, 2)).toBe(140);
        // A single-chip day (row 0) is still floored at base.
        expect(elevatorPanelHeight(0, 24, 4)).toBe(140);
    });

    it('is monotonic non-decreasing in maxStackRow (busier days are never shorter)', () => {
        let prev = -Infinity;
        for (const rows of [0, 1, 2, 5, 10, 30]) {
            const h = elevatorPanelHeight(rows, 16, 2);
            expect(h).toBeGreaterThanOrEqual(prev);
            prev = h;
        }
    });

    it('clamps a negative maxStackRow to 0 (defensive — base floor)', () => {
        // Callers always pass `map.get(d) || 0`, so the input is a number; the
        // Math.max(0, …) guard just keeps a stray negative from underflowing.
        expect(elevatorPanelHeight(-5, 16, 2)).toBe(140);
    });

    it('unknown spaceKey falls back to the default multiplier (matches getSpaceMultiplier)', () => {
        expect(elevatorPanelHeight(5, 16, 99)).toBe(expected(5, 16, 99));
        expect(elevatorPanelHeight(5, 16, 99)).toBe(elevatorPanelHeight(5, 16, 2));
    });
});

describe('endOfWeek (req #2779 — elevator future cap = this week\'s Sunday)', () => {
    it('returns the Sunday of the ISO week for every weekday', () => {
        // Week of Mon 2026-06-08 .. Sun 2026-06-14.
        for (const d of ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11',
                         '2026-06-12', '2026-06-13', '2026-06-14']) {
            expect(endOfWeek(d)).toBe('2026-06-14');
        }
    });

    it('a Sunday is its own end-of-week', () => {
        expect(endOfWeek('2026-06-14')).toBe('2026-06-14');
    });

    it('handles a week that spans a month/year boundary', () => {
        // Thu 2026-12-31 is in the Mon 2026-12-28 .. Sun 2027-01-03 week.
        expect(endOfWeek('2026-12-31')).toBe('2027-01-03');
    });

    it('passes empty through (degenerate)', () => {
        expect(endOfWeek('')).toBe('');
    });
});

describe('cappedCenteredRange (req #2779 — initial/rebuild strip never crosses the cap)', () => {
    it('with no cap, equals the uncapped centered range', () => {
        expect(cappedCenteredRange('2026-06-10', 10, null)).toEqual(centeredDateRange('2026-06-10', 10));
    });

    it('drops every day after the cap, keeps the cap itself and all earlier days', () => {
        // Center Wed 2026-06-10, cap = Sun 2026-06-14. Range is 06-00..06-20;
        // future side must stop at 06-14.
        const out = cappedCenteredRange('2026-06-10', 10, '2026-06-14');
        expect(out[out.length - 1]).toBe('2026-06-14');
        expect(out.every(d => d <= '2026-06-14')).toBe(true);
        // Past side is untouched: 10 days before center are present.
        expect(out[0]).toBe('2026-05-31');
        // Contiguous, no gaps.
        for (let i = 1; i < out.length; i++) {
            const prev = new Date(out[i - 1] + 'T12:00:00');
            const cur  = new Date(out[i]     + 'T12:00:00');
            expect(Math.round((cur - prev) / 86400000)).toBe(1);
        }
    });

    it('when the center is the cap, the cap is the last entry (only past below it)', () => {
        const out = cappedCenteredRange('2026-06-14', 10, '2026-06-14');
        expect(out[out.length - 1]).toBe('2026-06-14');
        expect(out.length).toBe(11);   // center + 10 past, zero future
    });

    it('when the whole range is past the cap, falls back to a single capped day (never empty)', () => {
        // Center two weeks ahead of the cap — every generated day is after it.
        const out = cappedCenteredRange('2026-06-30', 10, '2026-06-14');
        expect(out).toEqual(['2026-06-14']);
    });
});

// Req #2747 — cross-day pass-through lines must share the intermediate day's
// lane assignment with same-day chips so a dashed long-tail line never lands on
// a lane already held by a bubble that closed that day. BeadRow models this by
// adding "ghost" occupants (one per cross-day session) to the SAME
// assignSwarmLanes call as the day's real chips. These tests lock the invariant
// at the assigner level: every occupant — real or ghost — gets a unique row,
// and cluster-mates (shared groupKey) stay contiguous.
describe('assignSwarmLanes — cross-day ghost occupants (req #2747)', () => {
    // Shape mirrors the reported May 28 collision: three reqs CLOSED that day
    // (2708/2714/2715) plus three long-tail sessions (2709/2716/2720, closed
    // May 29) passing THROUGH as ghosts — all in one swarm-start cluster.
    const GROUP = '2026-05-27T08:00:00Z';
    const sameDay = [
        { chipKey: '2708-s1', groupKey: GROUP, completed_at: '2026-05-28T10:00:00Z' },
        { chipKey: '2714-s2', groupKey: GROUP, completed_at: '2026-05-28T11:00:00Z' },
        { chipKey: '2715-s3', groupKey: GROUP, completed_at: '2026-05-28T12:00:00Z' },
    ];
    const ghosts = [
        { chipKey: 'xdghost-4-middle-0', groupKey: GROUP, completed_at: '2026-05-29T09:00:00Z', isCrossDayGhost: true },
        { chipKey: 'xdghost-5-middle-1', groupKey: GROUP, completed_at: '2026-05-29T10:00:00Z', isCrossDayGhost: true },
        { chipKey: 'xdghost-6-middle-2', groupKey: GROUP, completed_at: '2026-05-29T11:00:00Z', isCrossDayGhost: true },
    ];

    it('assigns a unique row to every occupant — no bubble/line shares a lane', () => {
        const placed = assignSwarmLanes([...sameDay, ...ghosts]);
        const rows = placed.map(c => c.row);
        expect(new Set(rows).size).toBe(rows.length);          // all distinct
        expect([...rows].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]); // dense 0..N-1
    });

    it('no same-day chip and ghost ever resolve to the same row', () => {
        const placed = assignSwarmLanes([...sameDay, ...ghosts]);
        const realRows = new Set(placed.filter(c => !c.isCrossDayGhost).map(c => c.row));
        const ghostRows = placed.filter(c => c.isCrossDayGhost).map(c => c.row);
        for (const gr of ghostRows) expect(realRows.has(gr)).toBe(false);
    });

    it('keeps cluster-mates (shared groupKey) contiguous in the lane stack', () => {
        // A second, earlier cluster should occupy a contiguous block that does
        // not interleave with the GROUP cluster.
        const otherGroup = '2026-05-26T08:00:00Z';
        const other = [
            { chipKey: '2700-s9', groupKey: otherGroup, completed_at: '2026-05-28T08:00:00Z' },
        ];
        const placed = assignSwarmLanes([...sameDay, ...ghosts, ...other]);
        const groupRows = placed.filter(c => c.groupKey === GROUP).map(c => c.row).sort((a, b) => a - b);
        // Contiguous run (max-min === count-1, no gaps from the other cluster).
        expect(groupRows[groupRows.length - 1] - groupRows[0]).toBe(groupRows.length - 1);
    });
});

// Req #2747 — buildCrossDayGhosts is the field-mapping step that turns the
// parent's crossDayMap entries into ghost lane-occupants fed to assignSwarmLanes
// (then split back out for the cross-day SVG). These lock the mapping so a
// silent rename/typo in the ghost shape is caught.
describe('buildCrossDayGhosts (req #2747)', () => {
    const sampleCrossDays = [
        { sessionId: 4, role: 'middle', groupKey: '2026-05-27T08:00:00Z',
          completedAt: '2026-05-29T09:00:00Z', card: { id: 2709 } },
        { sessionId: 5, role: 'start', pct: 42, groupKey: '2026-05-27T08:00:00Z',
          completedAt: '2026-05-29T10:00:00Z', card: { id: 2716 } },
    ];

    it('returns [] when vizKey is not swarm', () => {
        expect(buildCrossDayGhosts(sampleCrossDays, 'bead')).toEqual([]);
    });

    it('returns [] for empty / non-array input', () => {
        expect(buildCrossDayGhosts([], 'swarm')).toEqual([]);
        expect(buildCrossDayGhosts(undefined, 'swarm')).toEqual([]);
        expect(buildCrossDayGhosts(null, 'swarm')).toEqual([]);
    });

    it('maps each entry to a ghost carrying groupKey, end-day completed_at, and the original crossDay', () => {
        const ghosts = buildCrossDayGhosts(sampleCrossDays, 'swarm');
        expect(ghosts).toHaveLength(2);
        expect(ghosts[0]).toEqual({
            chipKey: 'xdghost-4-middle-0',
            id: 2709,
            groupKey: '2026-05-27T08:00:00Z',
            completed_at: '2026-05-29T09:00:00Z',
            isCrossDayGhost: true,
            crossDay: sampleCrossDays[0],
        });
        // groupKey + completed_at must match what assignSwarmLanes sorts on so
        // ghosts seat contiguously with their cluster's same-day chips.
        expect(ghosts[1].chipKey).toBe('xdghost-5-start-1');
        expect(ghosts[1].id).toBe(2716);
        expect(ghosts.every(g => g.isCrossDayGhost === true)).toBe(true);
    });

    it('feeds assignSwarmLanes so ghosts get distinct rows from same-day chips', () => {
        const sameDay = [{ chipKey: '2708-s1', groupKey: '2026-05-27T08:00:00Z',
                           completed_at: '2026-05-28T10:00:00Z' }];
        const ghosts = buildCrossDayGhosts(sampleCrossDays, 'swarm');
        const placed = assignSwarmLanes([...sameDay, ...ghosts]);
        const rows = placed.map(c => c.row);
        expect(new Set(rows).size).toBe(rows.length);   // every occupant a unique lane
        const ghostRows = placed.filter(c => c.isCrossDayGhost).map(c => c.row);
        const realRows = new Set(placed.filter(c => !c.isCrossDayGhost).map(c => c.row));
        for (const gr of ghostRows) expect(realRows.has(gr)).toBe(false);
    });

    it('handles a null card without throwing (id falls back to null)', () => {
        const ghosts = buildCrossDayGhosts(
            [{ sessionId: 9, role: 'middle', groupKey: 'g', completedAt: 't' }], 'swarm');
        expect(ghosts[0].id).toBeNull();
    });
});
