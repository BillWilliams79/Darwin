import { describe, it, expect } from 'vitest';
import {
    FONT_SIZES, FONT_SIZE_KEYS, DEFAULT_FONT_SIZE,
    CIRCLE_SIZES, CIRCLE_SIZE_KEYS, DEFAULT_CIRCLE_SIZE,
    getFontSize, getCircleSize,
    COORDINATION_LABELS, formatCoordination,
    parseSessionRequirementId, indexSessionsByRequirement,
    SPACE_KEYS, DEFAULT_SPACE, SPACE_MULTIPLIERS, getSpaceMultiplier,
    ZOOM_KEYS, DEFAULT_ZOOM, ZOOM_HOURS, getZoomHours,
    SWARM_CLUSTER_WINDOW_MS, clusterSessionsByStartTime, clusterSessionsBySwarmStart,
    DATA_KEYS, DEFAULT_DATA_KEY, COORDINATION_COLORS,
    COORDINATION_FALLBACK_COLOR, getCoordinationColor,
    PHASE_SEGMENTS, PHASE_UNCLASSIFIED_COLOR, computePhaseSegments,
} from '../timeSeriesSizes';

describe('Font size option A/B/C/D', () => {
    it('exposes four keys in canonical order', () => {
        expect(FONT_SIZE_KEYS).toEqual(['A', 'B', 'C', 'D']);
    });

    it('default is B (user preference 2026-04-18)', () => {
        expect(DEFAULT_FONT_SIZE).toBe('B');
    });

    it('each key maps to a valid rem string', () => {
        for (const k of FONT_SIZE_KEYS) {
            expect(FONT_SIZES[k]).toMatch(/^\d+(\.\d+)?rem$/);
        }
    });

    it('sizes increase monotonically A < B < C < D', () => {
        const numeric = FONT_SIZE_KEYS.map(k => parseFloat(FONT_SIZES[k]));
        for (let i = 1; i < numeric.length; i++) {
            expect(numeric[i]).toBeGreaterThan(numeric[i - 1]);
        }
    });

    it('A = current MUI Tooltip baseline (0.75rem / 12px)', () => {
        expect(FONT_SIZES.A).toBe('0.75rem');
    });

    it('getFontSize returns mapped value for valid key', () => {
        expect(getFontSize('A')).toBe('0.75rem');
        expect(getFontSize('B')).toBe('0.875rem');
        expect(getFontSize('C')).toBe('1rem');
        expect(getFontSize('D')).toBe('1.125rem');
    });

    it('getFontSize falls back to default for unknown key', () => {
        expect(getFontSize('Z')).toBe(FONT_SIZES[DEFAULT_FONT_SIZE]);
        expect(getFontSize(null)).toBe(FONT_SIZES[DEFAULT_FONT_SIZE]);
        expect(getFontSize(undefined)).toBe(FONT_SIZES[DEFAULT_FONT_SIZE]);
    });
});

describe('Circle size option 1/2/3/4', () => {
    it('exposes four keys in canonical order', () => {
        expect(CIRCLE_SIZE_KEYS).toEqual([1, 2, 3, 4]);
    });

    it('default is 3 (user preference 2026-04-18)', () => {
        expect(DEFAULT_CIRCLE_SIZE).toBe(3);
    });

    it('each key maps to a positive integer (pixels)', () => {
        for (const k of CIRCLE_SIZE_KEYS) {
            expect(Number.isInteger(CIRCLE_SIZES[k])).toBe(true);
            expect(CIRCLE_SIZES[k]).toBeGreaterThan(0);
        }
    });

    it('sizes increase monotonically 1 < 2 < 3 < 4', () => {
        const vals = CIRCLE_SIZE_KEYS.map(k => CIRCLE_SIZES[k]);
        for (let i = 1; i < vals.length; i++) {
            expect(vals[i]).toBeGreaterThan(vals[i - 1]);
        }
    });

    it('1 = current bead baseline (12px)', () => {
        expect(CIRCLE_SIZES[1]).toBe(12);
    });

    it('getCircleSize returns mapped value for valid key', () => {
        expect(getCircleSize(1)).toBe(12);
        expect(getCircleSize(2)).toBe(16);
        expect(getCircleSize(3)).toBe(20);
        expect(getCircleSize(4)).toBe(24);
    });

    it('getCircleSize falls back to default for unknown key', () => {
        expect(getCircleSize(99)).toBe(CIRCLE_SIZES[DEFAULT_CIRCLE_SIZE]);
        expect(getCircleSize(null)).toBe(CIRCLE_SIZES[DEFAULT_CIRCLE_SIZE]);
        expect(getCircleSize(undefined)).toBe(CIRCLE_SIZES[DEFAULT_CIRCLE_SIZE]);
    });
});

describe('formatCoordination (autonomy label)', () => {
    it('maps known values to Title Case', () => {
        expect(formatCoordination('discuss')).toBe('Discuss Req');
        expect(formatCoordination('planned')).toBe('Planned');
        expect(formatCoordination('implemented')).toBe('Implemented');
        expect(formatCoordination('deployed')).toBe('Deployed');
    });

    it('returns em-dash for null/undefined/empty', () => {
        expect(formatCoordination(null)).toBe('—');
        expect(formatCoordination(undefined)).toBe('—');
        expect(formatCoordination('')).toBe('—');
    });

    it('falls through raw value for unexpected strings (forward-compat)', () => {
        expect(formatCoordination('exploratory')).toBe('exploratory');
    });

    it('has a label for every documented coordination_type', () => {
        // Same set documented in CLAUDE.md § Darwin MCP Server.
        expect(Object.keys(COORDINATION_LABELS).sort()).toEqual(['deployed', 'discuss', 'implemented', 'planned']);
    });
});

describe('parseSessionRequirementId', () => {
    it('extracts numeric id from "requirement:<n>"', () => {
        expect(parseSessionRequirementId('requirement:2251')).toBe('2251');
        expect(parseSessionRequirementId('requirement:1')).toBe('1');
    });

    it('returns null for unrecognised or empty source_ref', () => {
        expect(parseSessionRequirementId(null)).toBe(null);
        expect(parseSessionRequirementId(undefined)).toBe(null);
        expect(parseSessionRequirementId('')).toBe(null);
        expect(parseSessionRequirementId('project:42')).toBe(null);
        expect(parseSessionRequirementId('requirement:abc')).toBe(null);
        expect(parseSessionRequirementId('requirement:')).toBe(null);
        expect(parseSessionRequirementId(12345)).toBe(null); // non-string
    });
});

describe('indexSessionsByRequirement', () => {
    const mk = (id, sourceRef, startedAt) =>
        ({ id, source_ref: sourceRef, started_at: startedAt });

    it('returns an empty Map for non-array / empty input', () => {
        expect(indexSessionsByRequirement(null).size).toBe(0);
        expect(indexSessionsByRequirement(undefined).size).toBe(0);
        expect(indexSessionsByRequirement([]).size).toBe(0);
    });

    it('groups sessions by the requirement id parsed from source_ref', () => {
        const idx = indexSessionsByRequirement([
            mk(10, 'requirement:100', '2026-04-17 08:00:00'),
            mk(11, 'requirement:100', '2026-04-17 09:00:00'),
            mk(12, 'requirement:200', '2026-04-17 10:00:00'),
        ]);
        expect(idx.size).toBe(2);
        expect(idx.get('100').map(s => s.id)).toEqual([10, 11]);
        expect(idx.get('200').map(s => s.id)).toEqual([12]);
    });

    it('skips sessions with no / bad source_ref silently', () => {
        const idx = indexSessionsByRequirement([
            mk(1, 'requirement:42', '2026-04-17 08:00:00'),
            mk(2, null, '2026-04-17 09:00:00'),
            mk(3, 'project:7', '2026-04-17 10:00:00'),
            mk(4, '', '2026-04-17 11:00:00'),
        ]);
        expect(idx.size).toBe(1);
        expect(idx.get('42').map(s => s.id)).toEqual([1]);
    });

    it('sorts each requirement\'s sessions by started_at ascending', () => {
        const idx = indexSessionsByRequirement([
            mk(1, 'requirement:5', '2026-04-17 15:00:00'),
            mk(2, 'requirement:5', '2026-04-17 07:00:00'),
            mk(3, 'requirement:5', '2026-04-17 11:00:00'),
        ]);
        expect(idx.get('5').map(s => s.id)).toEqual([2, 3, 1]);
    });
});

describe('Zoom option W/X/Y/Z — window-hours per view span', () => {
    it('exposes four keys in canonical order', () => {
        expect(ZOOM_KEYS).toEqual(['W', 'X', 'Y', 'Z']);
    });

    it('default is X (current baseline)', () => {
        expect(DEFAULT_ZOOM).toBe('X');
    });

    it('matches the user-approved hours table', () => {
        expect(ZOOM_HOURS).toEqual({
            W: { '24h': 12, '36h': 18 },
            X: { '24h': 24, '36h': 36 },
            Y: { '24h': 36, '36h': 48 },
            Z: { '24h': 48, '36h': 72 },
        });
    });

    it('visible hours increase monotonically from W through Z for each beadWindow', () => {
        for (const w of ['24h', '36h']) {
            const hours = ZOOM_KEYS.map(k => ZOOM_HOURS[k][w]);
            for (let i = 1; i < hours.length; i++) {
                expect(hours[i]).toBeGreaterThan(hours[i - 1]);
            }
        }
    });

    it('getZoomHours returns mapped value', () => {
        expect(getZoomHours('X', '24h')).toBe(24);
        expect(getZoomHours('Z', '36h')).toBe(72);
    });

    it('getZoomHours falls back to defaults for unknown key', () => {
        expect(getZoomHours('Q', '24h')).toBe(ZOOM_HOURS[DEFAULT_ZOOM]['24h']);
        expect(getZoomHours('X', 'bogus')).toBe(ZOOM_HOURS['X']['24h']);
    });
});

describe('Space option 1/2/3/4 — bubble whitespace multiplier', () => {
    it('exposes four keys in canonical order', () => {
        expect(SPACE_KEYS).toEqual([1, 2, 3, 4]);
    });

    it('default is 2 (user preference 2026-04-18)', () => {
        expect(DEFAULT_SPACE).toBe(2);
    });

    it('level 1 is the baseline multiplier 1.0', () => {
        expect(SPACE_MULTIPLIERS[1]).toBe(1);
    });

    it('multiplier increases monotonically 1 < 2 < 3 < 4', () => {
        const vals = SPACE_KEYS.map(k => SPACE_MULTIPLIERS[k]);
        for (let i = 1; i < vals.length; i++) {
            expect(vals[i]).toBeGreaterThan(vals[i - 1]);
        }
    });

    it('getSpaceMultiplier returns mapped value for valid key', () => {
        for (const k of SPACE_KEYS) {
            expect(getSpaceMultiplier(k)).toBe(SPACE_MULTIPLIERS[k]);
        }
    });

    it('getSpaceMultiplier falls back to default for unknown key', () => {
        expect(getSpaceMultiplier(null)).toBe(SPACE_MULTIPLIERS[DEFAULT_SPACE]);
        expect(getSpaceMultiplier(undefined)).toBe(SPACE_MULTIPLIERS[DEFAULT_SPACE]);
        expect(getSpaceMultiplier(99)).toBe(SPACE_MULTIPLIERS[DEFAULT_SPACE]);
    });
});

// ─── clusterSessionsByStartTime (req #2341 — Visualizer start-time alignment) ────
describe('clusterSessionsByStartTime', () => {
    const mk = (id, startedAt) => ({ id, started_at: startedAt });

    it('returns empty maps for null / undefined / empty / non-array input', () => {
        for (const v of [null, undefined, [], 'nope', 42]) {
            const { canonical, clusterSize } = clusterSessionsByStartTime(v);
            expect(canonical.size).toBe(0);
            expect(clusterSize.size).toBe(0);
        }
    });

    it('exposes a 3-minute default window constant', () => {
        expect(SWARM_CLUSTER_WINDOW_MS).toBe(3 * 60 * 1000);
    });

    it('single session → singleton cluster, canonical = own started_at, size = 1', () => {
        const { canonical, clusterSize } = clusterSessionsByStartTime([
            mk(10, '2026-04-17T09:00:00Z'),
        ]);
        expect(canonical.get('10')).toBe('2026-04-17T09:00:00Z');
        expect(clusterSize.get('10')).toBe(1);
    });

    it('two sessions within 3 min → same cluster, canonical = earliest, size = 2', () => {
        const { canonical, clusterSize } = clusterSessionsByStartTime([
            mk(1, '2026-04-17T09:00:00Z'),
            mk(2, '2026-04-17T09:02:30Z'),
        ]);
        expect(canonical.get('1')).toBe('2026-04-17T09:00:00Z');
        expect(canonical.get('2')).toBe('2026-04-17T09:00:00Z');
        expect(clusterSize.get('1')).toBe(2);
        expect(clusterSize.get('2')).toBe(2);
    });

    it('two sessions > 3 min apart → two singleton clusters', () => {
        const { canonical, clusterSize } = clusterSessionsByStartTime([
            mk(1, '2026-04-17T09:00:00Z'),
            mk(2, '2026-04-17T09:04:00Z'),
        ]);
        expect(canonical.get('1')).toBe('2026-04-17T09:00:00Z');
        expect(canonical.get('2')).toBe('2026-04-17T09:04:00Z');
        expect(clusterSize.get('1')).toBe(1);
        expect(clusterSize.get('2')).toBe(1);
    });

    it('transitive chain (0, +2, +4 min) collapses into one cluster', () => {
        const { canonical, clusterSize } = clusterSessionsByStartTime([
            mk(1, '2026-04-17T09:00:00Z'),
            mk(2, '2026-04-17T09:02:00Z'),
            mk(3, '2026-04-17T09:04:00Z'),
        ]);
        expect(canonical.get('1')).toBe('2026-04-17T09:00:00Z');
        expect(canonical.get('2')).toBe('2026-04-17T09:00:00Z');
        expect(canonical.get('3')).toBe('2026-04-17T09:00:00Z');
        expect(clusterSize.get('1')).toBe(3);
        expect(clusterSize.get('2')).toBe(3);
        expect(clusterSize.get('3')).toBe(3);
    });

    it('unsorted input still clusters correctly', () => {
        const { canonical, clusterSize } = clusterSessionsByStartTime([
            mk(3, '2026-04-17T09:04:00Z'),
            mk(1, '2026-04-17T09:00:00Z'),
            mk(2, '2026-04-17T09:02:00Z'),
        ]);
        expect(canonical.get('1')).toBe('2026-04-17T09:00:00Z');
        expect(canonical.get('2')).toBe('2026-04-17T09:00:00Z');
        expect(canonical.get('3')).toBe('2026-04-17T09:00:00Z');
        expect(clusterSize.get('1')).toBe(3);
    });

    it('sessions with null / missing started_at are excluded', () => {
        const { canonical, clusterSize } = clusterSessionsByStartTime([
            mk(1, '2026-04-17T09:00:00Z'),
            mk(2, null),
            mk(3, undefined),
            mk(4, ''),
            mk(5, '2026-04-17T09:01:00Z'),
        ]);
        expect(canonical.has('2')).toBe(false);
        expect(canonical.has('3')).toBe(false);
        expect(canonical.has('4')).toBe(false);
        expect(canonical.get('1')).toBe('2026-04-17T09:00:00Z');
        expect(canonical.get('5')).toBe('2026-04-17T09:00:00Z');
        expect(clusterSize.get('1')).toBe(2);
    });

    it('sessions with invalid started_at are excluded', () => {
        const { canonical, clusterSize } = clusterSessionsByStartTime([
            mk(1, '2026-04-17T09:00:00Z'),
            mk(2, 'not-a-date'),
        ]);
        expect(canonical.has('2')).toBe(false);
        expect(clusterSize.get('1')).toBe(1);
    });

    it('threshold override splits a pair that the default would have merged', () => {
        const sessions = [
            mk(1, '2026-04-17T09:00:00Z'),
            mk(2, '2026-04-17T09:02:30Z'),
        ];
        const tight = clusterSessionsByStartTime(sessions, 60 * 1000); // 1 min
        expect(tight.canonical.get('1')).toBe('2026-04-17T09:00:00Z');
        expect(tight.canonical.get('2')).toBe('2026-04-17T09:02:30Z');
        expect(tight.clusterSize.get('1')).toBe(1);
        expect(tight.clusterSize.get('2')).toBe(1);
    });

    it('string ids are supported and keyed consistently as strings', () => {
        const { canonical, clusterSize } = clusterSessionsByStartTime([
            { id: 'abc', started_at: '2026-04-17T09:00:00Z' },
            { id: 42,    started_at: '2026-04-17T09:01:00Z' },
        ]);
        expect(canonical.get('abc')).toBe('2026-04-17T09:00:00Z');
        expect(canonical.get('42')).toBe('2026-04-17T09:00:00Z');
        expect(clusterSize.get('abc')).toBe(2);
        expect(clusterSize.get('42')).toBe(2);
    });

    it('malformed entries (null, missing id) are skipped silently', () => {
        const { canonical, clusterSize } = clusterSessionsByStartTime([
            null,
            { started_at: '2026-04-17T09:00:00Z' }, // no id
            mk(7, '2026-04-17T09:01:00Z'),
        ]);
        expect(canonical.size).toBe(1);
        expect(clusterSize.get('7')).toBe(1);
    });
});


// ─── clusterSessionsByStartTime — MySQL-format parsing (req #2398) ─────────────
// Regression guard: before the fix, clusterSessionsByStartTime parsed
// started_at with raw `new Date(...)`, which treats MySQL "YYYY-MM-DD HH:MM:SS"
// as LOCAL time, while every other consumer in the visualizer (positionFor,
// toLocaleDateString, formatCardDateTime) uses toDate() which correctly
// interprets that format as UTC (by appending 'Z'). The mismatch could skew
// cluster membership when two sessions' local-vs-UTC offsets fell across the
// 3-minute cluster threshold, or when DST transitions changed the offset.
describe('clusterSessionsByStartTime — MySQL-format UTC parsing', () => {
    it('treats MySQL-format started_at ("YYYY-MM-DD HH:MM:SS") as UTC', () => {
        // Same UTC instant expressed both ways — must cluster as one.
        const { canonical, clusterSize } = clusterSessionsByStartTime([
            { id: 'mysql', started_at: '2026-04-21 01:55:00' },          // MySQL UTC
            { id: 'iso',   started_at: '2026-04-21T01:55:30.000Z' },     // ISO UTC, 30s later
        ]);
        // 30-second gap < 3-min cluster window → same cluster of size 2.
        expect(clusterSize.get('mysql')).toBe(2);
        expect(clusterSize.get('iso')).toBe(2);
        // Canonical is the earlier one (mysql @ 01:55:00 UTC).
        expect(canonical.get('mysql')).toBe('2026-04-21 01:55:00');
        expect(canonical.get('iso')).toBe('2026-04-21 01:55:00');
    });

    it('splits MySQL-format sessions > 3 min apart in UTC', () => {
        const { clusterSize } = clusterSessionsByStartTime([
            { id: 'a', started_at: '2026-04-21 01:55:00' },
            { id: 'b', started_at: '2026-04-21 02:00:00' },   // 5 min later UTC
        ]);
        expect(clusterSize.get('a')).toBe(1);
        expect(clusterSize.get('b')).toBe(1);
    });

    it('falls back to Date constructor for non-MySQL strings', () => {
        // Plain ISO, numeric, etc — still parsed correctly.
        const { canonical } = clusterSessionsByStartTime([
            { id: 'a', started_at: '2026-04-21T05:00:00Z' },
            { id: 'b', started_at: '2026-04-21T05:02:00Z' },
        ]);
        expect(canonical.get('a')).toBe('2026-04-21T05:00:00Z');
        expect(canonical.get('b')).toBe('2026-04-21T05:00:00Z');
    });
});

describe('Data selection — Coordination palette (req #2382)', () => {
    it('DATA_KEYS has the two supported modes in canonical order', () => {
        expect(DATA_KEYS).toEqual(['category', 'coordination']);
    });

    it('default data key is category (current design, zero changes)', () => {
        expect(DEFAULT_DATA_KEY).toBe('category');
    });

    it('COORDINATION_COLORS maps the four typed coordination values', () => {
        expect(COORDINATION_COLORS.discuss).toBe('#AB47BC');
        expect(COORDINATION_COLORS.planned).toBe('#FB8C00');
        expect(COORDINATION_COLORS.implemented).toBe('#FDD835');
        expect(COORDINATION_COLORS.deployed).toBe('#43A047');
    });

    it('fallback color is red (no coordination set)', () => {
        expect(COORDINATION_FALLBACK_COLOR).toBe('#E53935');
    });

    it('getCoordinationColor returns the mapped color for every typed value', () => {
        expect(getCoordinationColor('discuss')).toBe('#AB47BC');
        expect(getCoordinationColor('planned')).toBe('#FB8C00');
        expect(getCoordinationColor('implemented')).toBe('#FDD835');
        expect(getCoordinationColor('deployed')).toBe('#43A047');
    });

    it('getCoordinationColor falls back to red for null/undefined/unknown', () => {
        expect(getCoordinationColor(null)).toBe('#E53935');
        expect(getCoordinationColor(undefined)).toBe('#E53935');
        expect(getCoordinationColor('')).toBe('#E53935');
        expect(getCoordinationColor('unknown')).toBe('#E53935');
    });
});

// ─── clusterSessionsBySwarmStart (req #2504 — real swarm_start data wins) ──────
describe('clusterSessionsBySwarmStart', () => {
    const mkS = (id, startedAt) => ({ id, started_at: startedAt });
    const mkJ = (sessionFk, swarmStartFk) => ({ session_fk: sessionFk, swarm_start_fk: swarmStartFk });
    const mkSS = (id, startedAt, extras = {}) => ({ id, started_at: startedAt, ...extras });

    it('returns empty maps for null / empty session input', () => {
        for (const v of [null, undefined, []]) {
            const r = clusterSessionsBySwarmStart(v, [], []);
            expect(r.canonical.size).toBe(0);
            expect(r.clusterSize.size).toBe(0);
            expect(r.swarmStartIdById.size).toBe(0);
            expect(r.swarmStartById.size).toBe(0);
        }
    });

    it('three sessions linked to one swarm_start cluster on the swarm_start.started_at, regardless of session times', () => {
        const sessions = [
            mkS(1, '2026-05-01T09:01:00Z'),
            mkS(2, '2026-05-01T09:02:30Z'),
            mkS(3, '2026-05-01T09:00:30Z'),
        ];
        const junction = [mkJ(1, 100), mkJ(2, 100), mkJ(3, 100)];
        const starts = [mkSS(100, '2026-05-01T09:00:00Z', { session_count: 3 })];
        const r = clusterSessionsBySwarmStart(sessions, junction, starts);
        // canonical = swarm_start.started_at, NOT the earliest session.
        expect(r.canonical.get('1')).toBe('2026-05-01T09:00:00Z');
        expect(r.canonical.get('2')).toBe('2026-05-01T09:00:00Z');
        expect(r.canonical.get('3')).toBe('2026-05-01T09:00:00Z');
        expect(r.clusterSize.get('1')).toBe(3);
        expect(r.swarmStartIdById.get('1')).toBe(100);
        expect(r.swarmStartById.get('2').session_count).toBe(3);
    });

    it('mixes real-data sessions and unlinked sessions correctly', () => {
        const sessions = [
            mkS(1, '2026-05-01T09:00:00Z'),
            mkS(2, '2026-05-01T09:01:00Z'),
            mkS(3, '2026-05-01T15:00:00Z'),  // unlinked, far from real cluster
        ];
        const junction = [mkJ(1, 100), mkJ(2, 100)];
        const starts = [mkSS(100, '2026-05-01T08:59:00Z')];
        const r = clusterSessionsBySwarmStart(sessions, junction, starts);

        // Real cluster — canonical from swarm_start.
        expect(r.canonical.get('1')).toBe('2026-05-01T08:59:00Z');
        expect(r.canonical.get('2')).toBe('2026-05-01T08:59:00Z');
        expect(r.swarmStartIdById.get('1')).toBe(100);
        expect(r.swarmStartIdById.get('2')).toBe(100);
        expect(r.clusterSize.get('1')).toBe(2);

        // Unlinked — falls through to legacy time-window clustering as a singleton.
        expect(r.canonical.get('3')).toBe('2026-05-01T15:00:00Z');
        expect(r.swarmStartIdById.get('3')).toBe(null);
        expect(r.swarmStartById.get('3')).toBe(null);
        expect(r.clusterSize.get('3')).toBe(1);
    });

    it('junction row pointing at a missing swarm_start falls through to time clustering', () => {
        const sessions = [
            mkS(1, '2026-05-01T09:00:00Z'),
            mkS(2, '2026-05-01T09:01:00Z'),
        ];
        const junction = [mkJ(1, 999), mkJ(2, 999)];   // FK 999 has no row
        const starts = [];
        const r = clusterSessionsBySwarmStart(sessions, junction, starts);
        // Both sessions are <3 min apart → time-window clusters them with canonical = earliest.
        expect(r.canonical.get('1')).toBe('2026-05-01T09:00:00Z');
        expect(r.canonical.get('2')).toBe('2026-05-01T09:00:00Z');
        expect(r.clusterSize.get('1')).toBe(2);
        expect(r.swarmStartIdById.get('1')).toBe(null);
        expect(r.swarmStartIdById.get('2')).toBe(null);
    });

    it('swarm_start row with null started_at is treated as missing — falls through to time clustering', () => {
        const sessions = [
            mkS(1, '2026-05-01T09:00:00Z'),
            mkS(2, '2026-05-01T09:01:00Z'),
        ];
        const junction = [mkJ(1, 100), mkJ(2, 100)];
        const starts = [mkSS(100, null)];
        const r = clusterSessionsBySwarmStart(sessions, junction, starts);
        expect(r.swarmStartIdById.get('1')).toBe(null);
        expect(r.swarmStartIdById.get('2')).toBe(null);
        expect(r.canonical.get('1')).toBe('2026-05-01T09:00:00Z');
        expect(r.clusterSize.get('1')).toBe(2);
    });

    it('with no swarm_starts at all, behaves identically to clusterSessionsByStartTime for canonical/size', () => {
        const sessions = [
            mkS(1, '2026-05-01T09:00:00Z'),
            mkS(2, '2026-05-01T09:02:00Z'),
            mkS(3, '2026-05-01T10:00:00Z'),
        ];
        const r = clusterSessionsBySwarmStart(sessions, [], []);
        const legacy = clusterSessionsByStartTime(sessions);
        for (const sid of ['1', '2', '3']) {
            expect(r.canonical.get(sid)).toBe(legacy.canonical.get(sid));
            expect(r.clusterSize.get(sid)).toBe(legacy.clusterSize.get(sid));
            expect(r.swarmStartIdById.get(sid)).toBe(null);
            expect(r.swarmStartById.get(sid)).toBe(null);
        }
    });

    it('two distinct swarm_starts produce two distinct clusters even when session times overlap', () => {
        // Two real swarm-starts whose member sessions have interleaved started_at —
        // the junction is authoritative and must not merge them.
        const sessions = [
            mkS(1, '2026-05-01T09:00:00Z'),
            mkS(2, '2026-05-01T09:00:30Z'),
            mkS(3, '2026-05-01T09:01:00Z'),
            mkS(4, '2026-05-01T09:01:30Z'),
        ];
        const junction = [mkJ(1, 100), mkJ(3, 100), mkJ(2, 200), mkJ(4, 200)];
        const starts = [
            mkSS(100, '2026-05-01T08:55:00Z'),
            mkSS(200, '2026-05-01T08:50:00Z'),
        ];
        const r = clusterSessionsBySwarmStart(sessions, junction, starts);
        expect(r.canonical.get('1')).toBe('2026-05-01T08:55:00Z');
        expect(r.canonical.get('3')).toBe('2026-05-01T08:55:00Z');
        expect(r.canonical.get('2')).toBe('2026-05-01T08:50:00Z');
        expect(r.canonical.get('4')).toBe('2026-05-01T08:50:00Z');
        expect(r.clusterSize.get('1')).toBe(2);
        expect(r.clusterSize.get('2')).toBe(2);
        expect(r.swarmStartIdById.get('1')).toBe(100);
        expect(r.swarmStartIdById.get('2')).toBe(200);
    });

    it('handles malformed junction rows (null fields) gracefully', () => {
        const sessions = [mkS(1, '2026-05-01T09:00:00Z')];
        const junction = [{ session_fk: null, swarm_start_fk: 100 }, { session_fk: 1, swarm_start_fk: null }, null];
        const starts = [mkSS(100, '2026-05-01T08:59:00Z')];
        const r = clusterSessionsBySwarmStart(sessions, junction, starts);
        // Session 1 has no usable junction → falls through to time clustering.
        expect(r.canonical.get('1')).toBe('2026-05-01T09:00:00Z');
        expect(r.swarmStartIdById.get('1')).toBe(null);
    });
});

// req #2823 — phase-duration segmentation of the swarm duration line.
describe('PHASE_SEGMENTS config', () => {
    it('lists the agentic block before the human block', () => {
        const families = PHASE_SEGMENTS.map(p => p.family);
        const firstHuman = families.indexOf('human');
        const lastAgentic = families.lastIndexOf('agentic');
        expect(firstHuman).toBeGreaterThan(lastAgentic);
    });

    it('covers exactly the seven session phase buckets', () => {
        expect(PHASE_SEGMENTS.map(p => p.key)).toEqual([
            'starting_secs', 'planning_secs', 'implementing_secs', 'completion_secs',
            'waiting_secs', 'review_secs', 'paused_secs',
        ]);
    });

    it('gives every phase a distinct hex colour, none equal to unclassified gray', () => {
        const colors = PHASE_SEGMENTS.map(p => p.color);
        expect(new Set(colors).size).toBe(colors.length);
        expect(colors).not.toContain(PHASE_UNCLASSIFIED_COLOR);
        for (const c of colors) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
});

describe('computePhaseSegments (req #2823)', () => {
    const instrumented = {
        instrumented: 1,
        starting_secs: 10, planning_secs: 0, implementing_secs: 60,
        completion_secs: 0, waiting_secs: 0, review_secs: 30, paused_secs: 0,
    };

    it('returns unclassified when session is null', () => {
        expect(computePhaseSegments(null, 0, 100)).toEqual({ classified: false, segments: [] });
    });

    it('returns unclassified when startPct/endPct missing', () => {
        expect(computePhaseSegments(instrumented, null, 100).classified).toBe(false);
        expect(computePhaseSegments(instrumented, 0, null).classified).toBe(false);
    });

    it('returns unclassified for a legacy (instrumented=0) session', () => {
        const legacy = { instrumented: 0, legacy_secs: 500, implementing_secs: 0 };
        expect(computePhaseSegments(legacy, 0, 100)).toEqual({ classified: false, segments: [] });
    });

    it('returns unclassified when every bucket is zero', () => {
        const empty = { instrumented: 1, starting_secs: 0, implementing_secs: 0, review_secs: 0 };
        expect(computePhaseSegments(empty, 0, 100).classified).toBe(false);
    });

    it('accepts instrumented as 1, true, or "1"', () => {
        for (const v of [1, true, '1']) {
            expect(computePhaseSegments({ ...instrumented, instrumented: v }, 0, 100).classified).toBe(true);
        }
    });

    it('emits one segment per NON-ZERO bucket, in PHASE_SEGMENTS order', () => {
        const { classified, segments } = computePhaseSegments(instrumented, 0, 100);
        expect(classified).toBe(true);
        expect(segments.map(s => s.key)).toEqual([
            'starting_secs', 'implementing_secs', 'review_secs',
        ]);
    });

    it('splits the span proportionally to each bucket', () => {
        // 10 / 60 / 30 of 100 total → widths 10 / 60 / 30 across [0,100].
        const { segments } = computePhaseSegments(instrumented, 0, 100);
        expect(segments[0].x1Pct).toBeCloseTo(0);
        expect(segments[0].x2Pct).toBeCloseTo(10);
        expect(segments[1].x1Pct).toBeCloseTo(10);
        expect(segments[1].x2Pct).toBeCloseTo(70);
        expect(segments[2].x1Pct).toBeCloseTo(70);
        expect(segments[2].x2Pct).toBeCloseTo(100);
    });

    it('respects a non-zero start offset and pins the last segment to endPct', () => {
        const { segments } = computePhaseSegments(instrumented, 20, 80);
        expect(segments[0].x1Pct).toBeCloseTo(20);
        expect(segments[segments.length - 1].x2Pct).toBe(80);
    });

    it('carries family + color through onto each segment', () => {
        const { segments } = computePhaseSegments(instrumented, 0, 100);
        const impl = segments.find(s => s.key === 'implementing_secs');
        expect(impl.family).toBe('agentic');
        expect(impl.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        const review = segments.find(s => s.key === 'review_secs');
        expect(review.family).toBe('human');
    });
});
