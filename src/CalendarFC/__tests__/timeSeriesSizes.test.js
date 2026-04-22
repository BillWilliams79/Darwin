import { describe, it, expect } from 'vitest';
import {
    FONT_SIZES, FONT_SIZE_KEYS, DEFAULT_FONT_SIZE,
    CIRCLE_SIZES, CIRCLE_SIZE_KEYS, DEFAULT_CIRCLE_SIZE,
    getFontSize, getCircleSize,
    COORDINATION_LABELS, formatCoordination,
    parseSessionRequirementId, indexSessionsByRequirement,
    VIZ_KEYS, DEFAULT_VIZ,
    SPACE_KEYS, DEFAULT_SPACE, SPACE_MULTIPLIERS, getSpaceMultiplier,
    ZOOM_KEYS, DEFAULT_ZOOM, ZOOM_HOURS, getZoomHours,
    SWARM_CLUSTER_WINDOW_MS, clusterSessionsByStartTime,
    DATA_KEYS, DEFAULT_DATA_KEY, COORDINATION_COLORS,
    COORDINATION_FALLBACK_COLOR, getCoordinationColor,
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
        expect(Object.keys(COORDINATION_LABELS).sort()).toEqual(['deployed', 'implemented', 'planned']);
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

describe('Visualization option keys', () => {
    it('exposes bead and swarm, bead is default', () => {
        expect(VIZ_KEYS).toEqual(['bead', 'swarm']);
        expect(DEFAULT_VIZ).toBe('bead');
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

// ─── assignSwarmLanes: each chip gets its own row, sorted by completed_at asc.
// Row 0 = earliest met = bottom; higher rows = later met = top. ─────────────────
import { assignSwarmLanes, weekDates, centeredDateRange, swarmStartBarX } from '../TimeSeriesView';

// ─── swarmStartBarX — vertical start-tick x-coordinate selector ──────────────
// Contract (simplified by req #2399):
//   'normal' always returns startPct when startPct is valid. A duration line
//   is drawn from startPct to the bubble in 'normal' mode, so the bar MUST
//   coincide with the line's left end. The close-gap bubble-hug shortcut
//   introduced by req #2336 was reachable ONLY for aligned-cluster chips
//   (the !isAligned close-gap case already switches markerMode to 'left'
//   upstream in drawChips), and for those chips it lied about where the
//   session started — dangling the duration line past the bar.
describe('swarmStartBarX (vertical start-tick positioning)', () => {
    const GAP = 9;          // circleDiameter=12 → gap = 12/2 + 3 = 9

    describe('markerMode=clamped', () => {
        it('returns null (horizontal dashed line already conveys start)', () => {
            expect(swarmStartBarX('clamped', 50, 0, GAP)).toBeNull();
            expect(swarmStartBarX('clamped', 50, null, GAP)).toBeNull();
        });
    });

    describe('markerMode=left', () => {
        it('always renders one gap left of the bubble', () => {
            expect(swarmStartBarX('left', 50, null, GAP)).toBe('calc(50% - 9px)');
            expect(swarmStartBarX('left', 25, 24.5, GAP)).toBe('calc(25% - 9px)');
        });
    });

    describe('markerMode=normal', () => {
        it('renders at startPct for a distant start (cluster alignment, req #2341)', () => {
            // Gap = 50 - 40 = 10% — obviously well clear of the bubble.
            expect(swarmStartBarX('normal', 50, 40, GAP)).toBe('40%');
        });

        it('renders at startPct right at the old 1.5% boundary', () => {
            // Gap = 1.5%. Same answer as anywhere else now that the close-gap
            // bubble-hug shortcut is gone.
            expect(swarmStartBarX('normal', 50, 48.5, GAP)).toBe('48.5%');
        });

        it('renders at startPct for an aligned-cluster close-gap chip (req #2399 fix)', () => {
            // The reqs 2330/2336/2381 reproducer: three swarm sessions started
            // within 7 s of each other on 2026-04-20 (single cluster → every
            // chip has isAligned=true). In Day view (baseHours=36) their
            // start→met gaps landed at 1.01%, 1.37%, and 1.45% — all below
            // the old 1.5% CLOSE_THRESHOLD_PCT. Pre-fix the bar was shoved
            // to leftPct - gap (bubble-hug) while the duration line continued
            // to extend from startPct to the bubble — producing a visible
            // line to the RIGHT of the supposed "start" bar. Post-fix the
            // bar coincides with the line's left end.
            expect(swarmStartBarX('normal', 50, 48.99, GAP)).toBe('48.99%');   // gap 1.01%
            expect(swarmStartBarX('normal', 50, 48.63, GAP)).toBe('48.63%');   // gap 1.37%
            expect(swarmStartBarX('normal', 50, 48.55, GAP)).toBe('48.55%');   // gap 1.45%
        });

        it('renders at startPct even when startPct === leftPct exactly', () => {
            // Zero-gap 'normal' only happens for aligned-cluster chips whose
            // canonical start == their own met time (rare, but possible at
            // coarse time resolution). Bar at startPct is the honest answer;
            // if it overlaps the bubble, the cluster-mates' bars at the same
            // X still convey the alignment.
            expect(swarmStartBarX('normal', 30, 30, GAP)).toBe('30%');
        });

        it('renders at startPct for an aligned-cluster tiny-gap chip (pre-#2399 regression)', () => {
            // Gap = 0.8% — was the req #2336 "bar hides under bubble" case.
            // Req #2399 accepts that tradeoff: the duration line + cluster-
            // mate alignment are more important than eliminating every case
            // where a thin bar partially overlaps a small bubble.
            expect(swarmStartBarX('normal', 65, 64.2, GAP)).toBe('64.2%');
        });
    });

    describe('markerMode=normal with null startPct', () => {
        it('returns null (no session start to mark)', () => {
            expect(swarmStartBarX('normal', 50, null, GAP)).toBeNull();
            expect(swarmStartBarX('normal', 50, undefined, GAP)).toBeNull();
        });
    });

    describe('unknown markerMode', () => {
        it('returns null', () => {
            expect(swarmStartBarX(undefined, 50, 40, GAP)).toBeNull();
            expect(swarmStartBarX('', 50, 40, GAP)).toBeNull();
            expect(swarmStartBarX('bogus', 50, 40, GAP)).toBeNull();
        });
    });

    it('deterministic across repeated calls (no hidden state)', () => {
        const a = swarmStartBarX('normal', 50, 49, GAP);
        const b = swarmStartBarX('normal', 50, 49, GAP);
        const c = swarmStartBarX('normal', 50, 49, GAP);
        expect(a).toBe(b);
        expect(b).toBe(c);
        expect(a).toBe('49%');
    });
});

describe('assignSwarmLanes (Swarm Visualizer lane order)', () => {
    const mk = (chipKey, completed_at) => ({ chipKey, id: chipKey, completed_at });

    it('returns empty array for empty input', () => {
        expect(assignSwarmLanes([])).toEqual([]);
    });

    it('assigns one lane per chip in completed_at ascending order', () => {
        const input = [
            mk('c', '2026-04-17 18:00:00'),
            mk('a', '2026-04-17 09:00:00'),
            mk('b', '2026-04-17 12:00:00'),
        ];
        const out = assignSwarmLanes(input);
        // Sorted ascending by completed_at → a (09:00), b (12:00), c (18:00)
        expect(out.map(c => c.chipKey)).toEqual(['a', 'b', 'c']);
        // Row 0 = earliest (a) = bottom; row 2 = latest (c) = top.
        expect(out.map(c => c.row)).toEqual([0, 1, 2]);
    });

    it('ties broken deterministically by chipKey', () => {
        const input = [
            mk('z', '2026-04-17 10:00:00'),
            mk('a', '2026-04-17 10:00:00'),
            mk('m', '2026-04-17 10:00:00'),
        ];
        expect(assignSwarmLanes(input).map(c => c.chipKey)).toEqual(['a', 'm', 'z']);
    });

    it('handles missing completed_at (treats as epoch 0 → bottom)', () => {
        const input = [
            mk('withStamp', '2026-04-17 10:00:00'),
            mk('blank', null),
        ];
        const out = assignSwarmLanes(input);
        expect(out[0].chipKey).toBe('blank');     // row 0 (bottom)
        expect(out[1].chipKey).toBe('withStamp'); // row 1 (top)
    });

    it('every chip gets a unique row (no lanes share a row)', () => {
        const input = Array.from({ length: 10 }, (_, i) =>
            mk(`s${i}`, `2026-04-17 0${i}:00:00`)
        );
        const out = assignSwarmLanes(input);
        const rows = out.map(c => c.row);
        expect(new Set(rows).size).toBe(10);
        expect(Math.min(...rows)).toBe(0);
        expect(Math.max(...rows)).toBe(9);
    });
});

describe('weekDates (ISO week — Mon first, Sun last)', () => {
    it('returns 7 dates', () => {
        expect(weekDates('2026-04-17').length).toBe(7);
    });

    it('Monday → week starts that Monday', () => {
        // 2026-04-13 is a Monday
        const w = weekDates('2026-04-13');
        expect(w[0]).toBe('2026-04-13');
        expect(w[6]).toBe('2026-04-19'); // Sunday
    });

    it('Sunday → week starts the preceding Monday', () => {
        // 2026-04-19 is a Sunday; Monday of its ISO week is 2026-04-13
        const w = weekDates('2026-04-19');
        expect(w[0]).toBe('2026-04-13');
        expect(w[6]).toBe('2026-04-19');
    });

    it('mid-week Friday resolves correctly', () => {
        // 2026-04-17 is a Friday; Monday = 2026-04-13, Sunday = 2026-04-19
        const w = weekDates('2026-04-17');
        expect(w).toEqual([
            '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16',
            '2026-04-17', '2026-04-18', '2026-04-19',
        ]);
    });

    it('empty / null → empty array', () => {
        expect(weekDates(null)).toEqual([]);
        expect(weekDates(undefined)).toEqual([]);
        expect(weekDates('')).toEqual([]);
    });

    it('week spanning month boundary (Mar 30 Mon → Apr 5 Sun)', () => {
        const w = weekDates('2026-03-31');
        expect(w[0]).toBe('2026-03-30');
        expect(w[6]).toBe('2026-04-05');
    });
});

describe('centeredDateRange (Sidewalk strip)', () => {
    it('returns 2N+1 dates centered on the input', () => {
        const r = centeredDateRange('2026-04-18', 10);
        expect(r.length).toBe(21);
        expect(r[10]).toBe('2026-04-18');          // center is the input
        expect(r[0]).toBe('2026-04-08');
        expect(r[20]).toBe('2026-04-28');
    });

    it('respects halfWidth parameter', () => {
        const r = centeredDateRange('2026-04-18', 3);
        expect(r.length).toBe(7);
        expect(r[0]).toBe('2026-04-15');
        expect(r[3]).toBe('2026-04-18');
        expect(r[6]).toBe('2026-04-21');
    });

    it('handles month boundary cleanly', () => {
        const r = centeredDateRange('2026-05-01', 3);
        expect(r).toEqual([
            '2026-04-28', '2026-04-29', '2026-04-30',
            '2026-05-01',
            '2026-05-02', '2026-05-03', '2026-05-04',
        ]);
    });

    it('empty for null input', () => {
        expect(centeredDateRange(null)).toEqual([]);
        expect(centeredDateRange(undefined)).toEqual([]);
        expect(centeredDateRange('')).toEqual([]);
    });
});

describe('Data selection — Coordination palette (req #2382)', () => {
    it('DATA_KEYS has the two supported modes in canonical order', () => {
        expect(DATA_KEYS).toEqual(['category', 'coordination']);
    });

    it('default data key is category (current design, zero changes)', () => {
        expect(DEFAULT_DATA_KEY).toBe('category');
    });

    it('COORDINATION_COLORS maps the three typed coordination values', () => {
        expect(COORDINATION_COLORS.planned).toBe('#FB8C00');
        expect(COORDINATION_COLORS.implemented).toBe('#FDD835');
        expect(COORDINATION_COLORS.deployed).toBe('#43A047');
    });

    it('fallback color is red (no coordination set)', () => {
        expect(COORDINATION_FALLBACK_COLOR).toBe('#E53935');
    });

    it('getCoordinationColor returns the mapped color for every typed value', () => {
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
