// req #3825 — a step card's START and END time, derived from its requirements
// and their swarm sessions, and formatted `hh:mmAM/PM` in the reader's zone.

import { describe, it, expect } from 'vitest';

import {
    buildFirstStartIndex, stepStartAt, stepEndAt, stepWorkBegun, formatClock,
    formatEndClock, localDaysBetween,
} from '../planStepTimes';
import { buildPlanRows } from '../pipelineAdapter';

const reqs = (...rows) => new Map(rows.map((r) => [r.id, r]));

// The expected clock for a UTC stamp, computed with the same local getters the
// code uses, so the suite holds in any TZ the runner has.
const localClock = (utc) => {
    const d = new Date(`${utc}Z`);
    const h = d.getHours();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h % 12 === 0 ? 12 : h % 12)}:${pad(d.getMinutes())}${h < 12 ? 'AM' : 'PM'}`;
};

describe('buildFirstStartIndex', () => {
    it('maps each requirement to its EARLIEST linked session start', () => {
        const idx = buildFirstStartIndex({
            requirementSessions: [
                { requirement_fk: 1, session_fk: 10 },
                { requirement_fk: 1, session_fk: 11 },
                { requirement_fk: 2, session_fk: 12 },
                { requirement_fk: 3, session_fk: 99 },   // no such session
            ],
            sessions: [
                { id: 10, started_at: '2026-10-23T15:00:00' },
                { id: 11, started_at: '2026-10-23T09:30:00' },
                { id: 12, started_at: null },
            ],
        });
        expect(idx.get(1)).toBe('2026-10-23T09:30:00');
        expect(idx.has(2)).toBe(false);
        expect(idx.has(3)).toBe(false);
    });

    it('coerces string ids from the wire', () => {
        const idx = buildFirstStartIndex({
            requirementSessions: [{ requirement_fk: '7', session_fk: '70' }],
            sessions: [{ id: 70, started_at: '2026-10-23T01:02:03' }],
        });
        expect(idx.get(7)).toBe('2026-10-23T01:02:03');
    });

    it('survives absent input', () => {
        expect(buildFirstStartIndex().size).toBe(0);
    });
});

describe('stepStartAt', () => {
    it('is the earliest first-session start over the gating requirements', () => {
        const first = new Map([[1, '2026-10-23T12:00:00'], [2, '2026-10-23T08:00:00']]);
        expect(stepStartAt([1, 2], reqs({ id: 1 }, { id: 2 }), first))
            .toBe('2026-10-23T08:00:00');
    });

    it('falls back to the requirement\'s own started_at when no session is linked', () => {
        const byId = reqs({ id: 1, started_at: '2026-10-23T07:00:00' }, { id: 2 });
        expect(stepStartAt([1, 2], byId, new Map())).toBe('2026-10-23T07:00:00');
        expect(stepStartAt([1, 2], byId, null)).toBe('2026-10-23T07:00:00');
    });

    it('prefers the session over the requirement stamp (met clears started_at)', () => {
        const byId = reqs({ id: 1, started_at: '2026-10-23T11:00:00' });
        expect(stepStartAt([1], byId, new Map([[1, '2026-10-22T10:00:00']])))
            .toBe('2026-10-22T10:00:00');
    });

    it('compares instants, not strings, across the two reads\' stamp formats', () => {
        // The session read (generic GET, JSON_OBJECT) and the composed read
        // (isoformat) format the same kind of stamp differently.
        const byId = reqs({ id: 1 }, { id: 2, started_at: '2026-10-23T09:00:00' });
        const first = new Map([[1, '2026-10-23 15:00:00.000000']]);
        expect(stepStartAt([1, 2], byId, first)).toBe('2026-10-23T09:00:00');
        const idx = buildFirstStartIndex({
            requirementSessions: [{ requirement_fk: 1, session_fk: 10 },
                { requirement_fk: 1, session_fk: 11 }],
            sessions: [{ id: 10, started_at: '2026-10-23 15:00:00.000000' },
                { id: 11, started_at: '2026-10-23T09:30:00' }],
        });
        expect(idx.get(1)).toBe('2026-10-23T09:30:00');
    });

    it('ignores a session that started after its requirement closed (Primary closeout)', () => {
        // Production step 160: req 3097 completed 18:56:50, its only session
        // (the Primary's closeout record) started 18:57:20.
        const byId = reqs({ id: 3097, requirement_status: 'met',
            completed_at: '2026-07-27 18:56:50' });
        expect(stepStartAt([3097], byId, new Map([[3097, '2026-07-27 18:57:20.000000']])))
            .toBeNull();
        // A real earlier launch on the same requirement still wins the index.
        const idx = buildFirstStartIndex({
            requirementSessions: [{ requirement_fk: 3097, session_fk: 1 },
                { requirement_fk: 3097, session_fk: 2 }],
            sessions: [{ id: 1, started_at: '2026-07-27 17:10:00.000000' },
                { id: 2, started_at: '2026-07-27 18:57:20.000000' }],
        });
        expect(stepStartAt([3097], byId, idx)).toBe('2026-07-27 17:10:00.000000');
        // A deferral closes it the same way.
        const deferred = reqs({ id: 9, requirement_status: 'deferred',
            deferred_at: '2026-07-27T10:00:00' });
        expect(stepStartAt([9], deferred, new Map([[9, '2026-07-27T11:00:00']]))).toBeNull();
    });

    it('takes the FIRST launch of a relaunched requirement', () => {
        const idx = buildFirstStartIndex({
            requirementSessions: [{ requirement_fk: 3699, session_fk: 2992 },
                { requirement_fk: 3699, session_fk: 3007 }],
            sessions: [{ id: 2992, started_at: '2026-10-20 19:26:30.000000' },
                { id: 3007, started_at: '2026-10-21 05:59:58.000000' }],
        });
        const byId = reqs({ id: 3699, requirement_status: 'met',
            completed_at: '2026-10-21T08:36:55' });
        expect(stepStartAt([3699], byId, idx)).toBe('2026-10-20 19:26:30.000000');
    });

    it('is null when nothing has started', () => {
        expect(stepStartAt([1], reqs({ id: 1 }), new Map())).toBeNull();
        expect(stepStartAt([], reqs(), new Map())).toBeNull();
    });
});

describe('stepEndAt', () => {
    const byId = reqs(
        { id: 1, requirement_status: 'met', completed_at: '2026-10-23T10:00:00' },
        { id: 2, requirement_status: 'met', completed_at: '2026-10-23T14:15:00' },
    );

    it('is the LATEST completion once no gating work is open', () => {
        expect(stepEndAt([1, 2], [], byId)).toBe('2026-10-23T14:15:00');
    });

    it('is null while any gating work is open', () => {
        expect(stepEndAt([1, 2], [2], byId)).toBeNull();
    });

    it('is null for a step holding no gating work', () => {
        expect(stepEndAt([], [], byId)).toBeNull();
    });

    it('counts a deferral\'s deferred_at as the moment it closed', () => {
        const mixed = reqs(
            { id: 1, requirement_status: 'met', completed_at: '2026-10-23T10:00:00' },
            { id: 2, requirement_status: 'deferred', deferred_at: '2026-10-23T14:00:00' },
        );
        expect(stepEndAt([1, 2], [], mixed)).toBe('2026-10-23T14:00:00');
        expect(stepEndAt([2], [], mixed)).toBe('2026-10-23T14:00:00');
    });

    it('is null when the closed work carries no closing stamp', () => {
        expect(stepEndAt([3], [], reqs({ id: 3, requirement_status: 'deferred' }))).toBeNull();
    });
});

describe('stepWorkBegun', () => {
    it('is true once any gating requirement is in flight or closed', () => {
        expect(stepWorkBegun([1], reqs({ id: 1, requirement_status: 'development' }))).toBe(true);
        expect(stepWorkBegun([1], reqs({ id: 1, requirement_status: 'met' }))).toBe(true);
        expect(stepWorkBegun([1, 2], reqs(
            { id: 1, requirement_status: 'swarm_ready' },
            { id: 2, requirement_status: 'wontfix' }))).toBe(true);
    });

    it('is false for queued or empty steps', () => {
        expect(stepWorkBegun([1], reqs({ id: 1, requirement_status: 'swarm_ready' }))).toBe(false);
        expect(stepWorkBegun([], reqs())).toBe(false);
    });
});

describe('formatClock', () => {
    it('renders hh:mmAM/PM in local time from a zone-less UTC stamp', () => {
        for (const utc of ['2026-10-23T00:05:00', '2026-10-23T09:07:00',
            '2026-10-23T12:40:00', '2026-10-23T23:59:00']) {
            expect(formatClock(utc)).toBe(localClock(utc));
        }
    });

    it('always pads to two-digit hours and minutes with no space', () => {
        expect(formatClock('2026-10-23T10:50:14')).toMatch(/^(0[1-9]|1[0-2]):[0-5]\d(AM|PM)$/);
    });

    it('maps midnight and noon to 12', () => {
        expect(formatClock(new Date(2026, 9, 23, 0, 3))).toBe('12:03AM');
        expect(formatClock(new Date(2026, 9, 23, 12, 3))).toBe('12:03PM');
        expect(formatClock(new Date(2026, 9, 23, 13, 3))).toBe('01:03PM');
    });

    it('accepts a space separator and an explicit zone', () => {
        expect(formatClock('2026-10-23 09:07:00')).toBe(localClock('2026-10-23T09:07:00'));
        expect(formatClock('2026-10-23T09:07:00Z')).toBe(localClock('2026-10-23T09:07:00'));
    });

    it('reads the generic GET\'s space-and-microseconds stamps', () => {
        expect(formatClock('2026-10-23 09:07:00.000000')).toBe(localClock('2026-10-23T09:07:00'));
    });

    it('is null for no stamp or garbage', () => {
        expect(formatClock(null)).toBeNull();
        expect(formatClock('')).toBeNull();
        expect(formatClock('not a time')).toBeNull();
    });
});

describe('buildPlanRows carries the step times (req #3825)', () => {
    const payload = {
        steps: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }, { id: 3, title: 'c' }],
        initiatives: [],
        requirements: [
            { id: 10, requirement_status: 'met', completed_at: '2026-10-23T16:00:00' },
            { id: 11, requirement_status: 'met', completed_at: '2026-10-23T17:30:00' },
            { id: 12, requirement_status: 'development', started_at: '2026-10-23T18:00:00' },
            { id: 13, requirement_status: 'development', started_at: '2026-10-01T00:00:00',
              tracking: 1 },
            { id: 14, requirement_status: 'swarm_ready' },
        ],
        derived: {
            rows: [
                { id: 1, req_ids: [10, 11], open_req_ids: [] },
                // The tracking container is not gating work: neither its start
                // nor its status moves the step's times.
                { id: 2, req_ids: [12, 13], tracking_req_ids: [13], open_req_ids: [12] },
                { id: 3, req_ids: [14], open_req_ids: [14] },
            ],
        },
    };
    const firstStarts = new Map([[10, '2026-10-23T15:00:00'], [11, '2026-10-23T15:20:00']]);
    const rows = buildPlanRows(payload, [], firstStarts);
    const byId = new Map(rows.map((r) => [r.id, r]));

    it('a finished step has its first swarm start and its last completion', () => {
        expect(byId.get(1)).toMatchObject({
            startedAt: '2026-10-23T15:00:00', endedAt: '2026-10-23T17:30:00',
            stampsReserved: true,
        });
    });

    it('a running step has a start and no end', () => {
        expect(byId.get(2)).toMatchObject({
            startedAt: '2026-10-23T18:00:00', endedAt: null, stampsReserved: true,
        });
    });

    it('a queued step has neither, and reserves no time line', () => {
        expect(byId.get(3)).toMatchObject({
            startedAt: null, endedAt: null, stampsReserved: false,
        });
    });

    it('without the session index the finished step keeps its end', () => {
        const bare = buildPlanRows(payload, []);
        expect(bare[0]).toMatchObject({ startedAt: null, endedAt: '2026-10-23T17:30:00' });
    });
});

describe('formatEndClock — an end on a later day says so', () => {
    const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi);
    it('is the bare clock on the start\'s own day', () => {
        expect(formatEndClock(at(2026, 9, 23, 9, 0), at(2026, 9, 23, 23, 59))).toBe('11:59PM');
    });
    it('adds +1d past midnight, even when under 24 hours', () => {
        expect(formatEndClock(at(2026, 9, 22, 23, 23), at(2026, 9, 23, 1, 53))).toBe('01:53AM+1d');
        expect(formatEndClock(at(2026, 9, 22, 1, 23), at(2026, 9, 23, 1, 11))).toBe('01:11AM+1d');
    });
    it('counts whole local days', () => {
        expect(formatEndClock(at(2026, 9, 14, 8, 0), at(2026, 9, 23, 9, 30))).toBe('09:30AM+9d');
        expect(localDaysBetween(at(2026, 9, 23, 0, 0), at(2026, 9, 23, 23, 0))).toBe(0);
    });
    it('needs a start to add anything, and an end to say anything', () => {
        expect(formatEndClock(null, at(2026, 9, 23, 9, 30))).toBe('09:30AM');
        expect(formatEndClock(at(2026, 9, 23, 9, 30), null)).toBeNull();
    });
});
