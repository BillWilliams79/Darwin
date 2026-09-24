import { describe, it, expect } from 'vitest';
import {
    BUILD_TIMEZONE,
    formatBuiltAt,
    builtAtToInput,
    builtAtFromInput,
    nowUtcSql,
} from '../buildDateTime';
import { formatSimpleDateTime } from '../../utils/dateFormat';

// req #3515 — builds.built_at is stored UTC and displayed in Pacific as a simple
// "Sep 14 7:00 AM". The fixture is the Exemplar project's simulated main-branch
// schedule (project 14, branch 24) exactly as the requirement specifies it: the
// sprint simulator's 7am / 7pm PT slots. Build 38 (6.2.1.0) is NULL.
const EXEMPLAR = [
    { id: 38, version: '6.2.1.0', builtAt: null, label: '' },
    { id: 39, version: '6.2.2.0', builtAt: '2026-09-14 14:00:00', label: 'Sep 14 7:00 AM' },
    { id: 40, version: '6.2.3.0', builtAt: '2026-09-16 02:00:00', label: 'Sep 15 7:00 PM' },
    { id: 41, version: '6.2.4.0', builtAt: '2026-09-16 14:00:00', label: 'Sep 16 7:00 AM' },
    { id: 42, version: '6.2.5.0', builtAt: '2026-09-17 02:00:00', label: 'Sep 16 7:00 PM' },
    { id: 43, version: '6.2.6.0', builtAt: '2026-09-17 14:00:00', label: 'Sep 17 7:00 AM' },
    { id: 44, version: '6.2.7.0', builtAt: '2026-09-18 14:00:00', label: 'Sep 18 7:00 AM' },
    { id: 45, version: '6.2.8.0', builtAt: '2026-09-19 02:00:00', label: 'Sep 18 7:00 PM' },
    { id: 46, version: '6.2.9.0', builtAt: '2026-09-21 02:00:00', label: 'Sep 20 7:00 PM' },
    { id: 47, version: '6.2.10.0', builtAt: '2026-09-21 14:00:00', label: 'Sep 21 7:00 AM' },
    { id: 48, version: '6.2.11.0', builtAt: '2026-09-22 14:00:00', label: 'Sep 22 7:00 AM' },
    { id: 49, version: '6.2.12.0', builtAt: '2026-09-24 02:00:00', label: 'Sep 23 7:00 PM' },
    { id: 50, version: '6.2.13.0', builtAt: '2026-09-24 14:00:00', label: 'Sep 24 7:00 AM' },
    { id: 51, version: '6.2.14.0', builtAt: '2026-09-25 02:00:00', label: 'Sep 24 7:00 PM' },
    { id: 52, version: '6.2.15.0', builtAt: '2026-09-26 02:00:00', label: 'Sep 25 7:00 PM' },
    { id: 53, version: '6.2.16.0', builtAt: '2026-09-27 14:00:00', label: 'Sep 27 7:00 AM' },
];

describe('formatBuiltAt — Pacific simple date/time (req #3515)', () => {
    it('pins the display zone to Pacific', () => {
        expect(BUILD_TIMEZONE).toBe('America/Los_Angeles');
    });

    it.each(EXEMPLAR)('build $id ($version) → "$label"', ({ builtAt, label }) => {
        expect(formatBuiltAt(builtAt)).toBe(label);
    });

    it('reads every wire spelling of the same UTC instant identically', () => {
        // MySQL JSON_OBJECT emits DATETIME with microseconds; MCP emits ISO 'T'.
        for (const v of ['2026-09-14 14:00:00.000000', '2026-09-14T14:00:00',
            '2026-09-14T14:00:00Z', '2026-09-14 14:00']) {
            expect(formatBuiltAt(v)).toBe('Sep 14 7:00 AM');
        }
    });

    it('is blank (not an em-dash) for NULL / empty / unparseable values', () => {
        for (const v of [null, undefined, '', 'not a date']) {
            expect(formatBuiltAt(v)).toBe('');
        }
    });

    it('handles PST (winter) as well as PDT, and midnight/noon', () => {
        expect(formatBuiltAt('2026-12-01 08:00:00')).toBe('Dec 1 12:00 AM');
        expect(formatBuiltAt('2026-12-01 20:30:00')).toBe('Dec 1 12:30 PM');
    });

    it('formatSimpleDateTime honours an explicit zone', () => {
        expect(formatSimpleDateTime('2026-09-14 14:00:00', 'UTC')).toBe('Sep 14 2:00 PM');
    });
});

describe('built_at editor conversions (req #3515)', () => {
    it('UTC → Pacific datetime-local input value', () => {
        expect(builtAtToInput('2026-09-16 02:00:00')).toBe('2026-09-15T19:00');
        expect(builtAtToInput(null)).toBe('');
    });

    it('Pacific datetime-local → UTC DATETIME literal', () => {
        expect(builtAtFromInput('2026-09-15T19:00')).toBe('2026-09-16 02:00:00');
        expect(builtAtFromInput('2026-12-01T00:00')).toBe('2026-12-01 08:00:00');
    });

    it('empty input means NULL', () => {
        expect(builtAtFromInput('')).toBeNull();
    });

    it('round-trips every Exemplar value', () => {
        for (const { builtAt } of EXEMPLAR.filter(e => e.builtAt)) {
            expect(builtAtFromInput(builtAtToInput(builtAt))).toBe(builtAt);
        }
    });

    it('nowUtcSql renders a UTC MySQL literal', () => {
        expect(nowUtcSql(new Date('2026-09-14T14:00:59.999Z'))).toBe('2026-09-14 14:00:59');
    });
});

// Daylight-saving edges (Test Architect gap closure). Pacific has one ambiguous
// hour (Nov 1 01:00-02:00, twice) and one hour that never happens (Mar 8
// 02:00-03:00). The editor must pick SOMETHING deterministic for both, and the
// answer must not depend on the machine's own zone — the conversion is pinned to
// BUILD_TIMEZONE, so these hold whatever TZ vitest runs under.
describe('built_at conversions across daylight-saving changes (req #3515)', () => {
    it('the repeated fall-back hour displays identically for both instants', () => {
        // 08:30 UTC = 1:30 AM PDT; 09:30 UTC = 1:30 AM PST.
        expect(formatBuiltAt('2026-11-01 08:30:00')).toBe('Nov 1 1:30 AM');
        expect(formatBuiltAt('2026-11-01 09:30:00')).toBe('Nov 1 1:30 AM');
        expect(builtAtToInput('2026-11-01 09:30:00')).toBe('2026-11-01T01:30');
    });

    it('an ambiguous wall time resolves to the EARLIER (PDT) instant', () => {
        expect(builtAtFromInput('2026-11-01T01:30')).toBe('2026-11-01 08:30:00');
    });

    it('a wall time inside the spring-forward gap resolves to a real instant', () => {
        // 2:30 AM does not exist on Mar 8; it lands an hour earlier, on 1:30 PST.
        expect(builtAtFromInput('2026-03-08T02:30')).toBe('2026-03-08 09:30:00');
        expect(builtAtFromInput('2026-03-08T03:30')).toBe('2026-03-08 10:30:00');
        expect(formatBuiltAt(builtAtFromInput('2026-03-08T03:30'))).toBe('Mar 8 3:30 AM');
    });
});

export { EXEMPLAR };
