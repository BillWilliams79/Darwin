// Unit coverage for the swarm-visualizer geometry helpers (req #2844). These
// pure functions were extracted from the retired SVG/DOM TimeSeriesView into
// swarmGeometry.js so the Konva canvas (the only remaining substrate) keeps the
// math it depends on. Tests relocated verbatim from the former
// timeSeriesSizes.test.js / timeSeriesHelpers.test.js render-layer suites.
//
// laneParityFor lives in laneParity.test.js and buildUndoneChips in
// undoneChips.test.js — both already standalone, repointed to swarmGeometry.

import { describe, it, expect } from 'vitest';
import {
    assignSwarmLanes,
    buildCrossDayGhosts,
    buildCrossDayMap,
    computePhantomPlacement,
    isHiddenSwarmStatus,
    coordinationRingColor,
} from '../swarmGeometry';

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

    // ─── topDown=true (req #2400 — Sidewalk) ───────────────────────────────
    // Sidewalk renders the wire at the TOP of each panel. Row 0 is the row
    // closest to the wire, so it must hold the LATEST chip. Assigner emits
    // rows descending by completed_at.
    describe('topDown=true (latest = row 0)', () => {
        it('orders chips by completed_at descending so row 0 = latest', () => {
            const input = [
                mk('a', '2026-04-17 09:00:00'),
                mk('c', '2026-04-17 18:00:00'),
                mk('b', '2026-04-17 12:00:00'),
            ];
            const out = assignSwarmLanes(input, true);
            // c (18:00) is latest → row 0; a (09:00) is earliest → row 2
            expect(out.map(c => c.chipKey)).toEqual(['c', 'b', 'a']);
            expect(out.map(c => c.row)).toEqual([0, 1, 2]);
        });

        it('ties broken deterministically by chipKey in reverse', () => {
            const input = [
                mk('a', '2026-04-17 10:00:00'),
                mk('m', '2026-04-17 10:00:00'),
                mk('z', '2026-04-17 10:00:00'),
            ];
            // When completed_at ties, topDown reverses the chipKey tie-break
            // too so the overall ordering mirrors the primary sort direction.
            expect(assignSwarmLanes(input, true).map(c => c.chipKey))
                .toEqual(['z', 'm', 'a']);
        });

        it('missing completed_at lands at the BOTTOM of the stack (highest row)', () => {
            const input = [
                mk('withStamp', '2026-04-17 10:00:00'),
                mk('blank', null),
            ];
            const out = assignSwarmLanes(input, true);
            // Blank treated as epoch 0 → oldest → furthest from wire.
            expect(out[0].chipKey).toBe('withStamp'); // row 0 (top, near wire)
            expect(out[1].chipKey).toBe('blank');     // row 1 (bottom)
        });

        it('topDown=false (default) is unchanged', () => {
            // Regression guard — Day/Week mode keeps ascending lanes.
            const input = [
                mk('c', '2026-04-17 18:00:00'),
                mk('a', '2026-04-17 09:00:00'),
            ];
            expect(assignSwarmLanes(input).map(c => c.chipKey)).toEqual(['a', 'c']);
            expect(assignSwarmLanes(input, false).map(c => c.chipKey)).toEqual(['a', 'c']);
        });
    });

    // groupKey-based clustering — req #2504. Chips sharing a groupKey (canonical
    // swarm-start time / cluster start) sit in contiguous rows. Within a group,
    // sort by completed_at. Between groups, sort by groupKey.
    describe('groupKey clustering (req #2504)', () => {
        const mk = (id, t, groupKey) => ({ chipKey: id, completed_at: t, groupKey });

        it('chips with the same groupKey are contiguous, sorted by completed_at within', () => {
            // Two swarm-starts: GA at 09:00 and GB at 12:00. Each has 3 chips
            // completed at different times scattered across the day.
            const input = [
                mk('a1', '2026-04-17 11:00:00', '2026-04-17 09:00:00'),
                mk('b1', '2026-04-17 13:00:00', '2026-04-17 12:00:00'),
                mk('a2', '2026-04-17 09:30:00', '2026-04-17 09:00:00'),
                mk('b2', '2026-04-17 18:00:00', '2026-04-17 12:00:00'),
                mk('a3', '2026-04-17 15:00:00', '2026-04-17 09:00:00'),
                mk('b3', '2026-04-17 12:30:00', '2026-04-17 12:00:00'),
            ];
            const out = assignSwarmLanes(input);
            // GA chips contiguous (rows 0-2) sorted by completed_at, then GB (rows 3-5).
            expect(out.map(c => c.chipKey)).toEqual(['a2', 'a1', 'a3', 'b3', 'b1', 'b2']);
        });

        it('topDown reverses both group order AND within-group order', () => {
            const input = [
                mk('a1', '2026-04-17 11:00:00', '2026-04-17 09:00:00'),
                mk('b1', '2026-04-17 13:00:00', '2026-04-17 12:00:00'),
                mk('a2', '2026-04-17 09:30:00', '2026-04-17 09:00:00'),
                mk('b2', '2026-04-17 18:00:00', '2026-04-17 12:00:00'),
            ];
            const out = assignSwarmLanes(input, true);
            // GB first (later groupKey), with b2 first (later completion), then GA.
            expect(out.map(c => c.chipKey)).toEqual(['b2', 'b1', 'a1', 'a2']);
        });

        it('chips without groupKey fall through to completed_at sort (backward compat)', () => {
            // No groupKey on any chip → same behavior as before req #2504.
            const input = [
                { chipKey: 'c', completed_at: '2026-04-17 18:00:00' },
                { chipKey: 'a', completed_at: '2026-04-17 09:00:00' },
                { chipKey: 'b', completed_at: '2026-04-17 12:00:00' },
            ];
            expect(assignSwarmLanes(input).map(c => c.chipKey)).toEqual(['a', 'b', 'c']);
        });

        it('mixed: chips with groupKey cluster, ungrouped chips sort to one end', () => {
            // Empty groupKey ('') sorts BEFORE any real ISO timestamp ASCII-wise,
            // so ungrouped chips land at rows 0..N first (top of the stack in
            // Day/Week, closest to the wire).
            const input = [
                mk('a1', '2026-04-17 11:00:00', '2026-04-17 09:00:00'),
                { chipKey: 'lone1', completed_at: '2026-04-17 14:00:00' },
                mk('a2', '2026-04-17 09:30:00', '2026-04-17 09:00:00'),
                { chipKey: 'lone2', completed_at: '2026-04-17 10:00:00' },
            ];
            const out = assignSwarmLanes(input);
            expect(out.map(c => c.chipKey)).toEqual(['lone2', 'lone1', 'a2', 'a1']);
        });
    });
});

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
// (then split back out for the cross-day render). These lock the mapping so a
// silent rename/typo in the ghost shape is caught.
describe('buildCrossDayGhosts (req #2747)', () => {
    const sampleCrossDays = [
        { sessionId: 4, role: 'middle', groupKey: '2026-05-27T08:00:00Z',
          completedAt: '2026-05-29T09:00:00Z', card: { id: 2709 } },
        { sessionId: 5, role: 'start', pct: 42, groupKey: '2026-05-27T08:00:00Z',
          completedAt: '2026-05-29T10:00:00Z', card: { id: 2716 } },
    ];

    it('returns [] for empty / non-array input', () => {
        expect(buildCrossDayGhosts([])).toEqual([]);
        expect(buildCrossDayGhosts(undefined)).toEqual([]);
        expect(buildCrossDayGhosts(null)).toEqual([]);
    });

    it('maps each entry to a ghost carrying groupKey, end-day completed_at, and the original crossDay', () => {
        const ghosts = buildCrossDayGhosts(sampleCrossDays);
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
        const ghosts = buildCrossDayGhosts(sampleCrossDays);
        const placed = assignSwarmLanes([...sameDay, ...ghosts]);
        const rows = placed.map(c => c.row);
        expect(new Set(rows).size).toBe(rows.length);   // every occupant a unique lane
        const ghostRows = placed.filter(c => c.isCrossDayGhost).map(c => c.row);
        const realRows = new Set(placed.filter(c => !c.isCrossDayGhost).map(c => c.row));
        for (const gr of ghostRows) expect(realRows.has(gr)).toBe(false);
    });

    it('handles a null card without throwing (id falls back to null)', () => {
        const ghosts = buildCrossDayGhosts(
            [{ sessionId: 9, role: 'middle', groupKey: 'g', completedAt: 't' }]);
        expect(ghosts[0].id).toBeNull();
    });
});

describe('buildCrossDayMap (multi-day session pass-through, req #2798)', () => {
    const TZ = 'UTC';
    const D1 = '2026-04-15';
    const D2 = '2026-04-16';
    const D3 = '2026-04-17';
    const CATS = [{ id: 1, category_name: 'Swarm', color: '#43A047' }];

    it('returns an empty map for empty dates', () => {
        expect(buildCrossDayMap([], { timezone: TZ }).size).toBe(0);
        expect(buildCrossDayMap(null, { timezone: TZ }).size).toBe(0);
    });

    it('completed span: start on D1, middle on D2, NO entry on the completion day', () => {
        const map = buildCrossDayMap([D1, D2, D3], {
            requirements: [{ id: 1, completed_at: `${D3} 09:00:00`, title: 'X', category_fk: 1 }],
            sessions: [{ id: 10, source_ref: 'requirement:1', started_at: `${D1} 08:00:00` }],
            categoryList: CATS, timezone: TZ, startXPct: () => 25,
        });
        expect(map.get(D1)).toHaveLength(1);
        expect(map.get(D1)[0].role).toBe('start');
        expect(map.get(D1)[0].pct).toBe(25);
        expect(map.get(D1)[0].inProgress).toBe(false);
        expect(map.get(D1)[0].card.categoryName).toBe('Swarm');
        expect(map.get(D2)[0].role).toBe('middle');
        expect(map.has(D3)).toBe(false);   // completion bubble terminates the line
    });

    it('in-progress span: swarm-start linked session, end day = today (no end entry)', () => {
        const map = buildCrossDayMap([D1, D2, D3], {
            requirements: [],   // open requirement is NOT in the completed-only list
            sessions: [{ id: 99, source_ref: 'requirement:2', started_at: `${D1} 07:00:00`, swarm_status: 'active' }],
            swarmStarts: [{ id: 500, started_at: `${D1} 07:00:00` }],
            swarmStartSessions: [{ swarm_start_fk: 500, session_fk: 99 }],
            requirementById: new Map([['2', { id: 2, title: 'Open' }]]),
            categoryList: CATS, timezone: TZ, startXPct: () => 40, today: D3,
        });
        expect(map.get(D1)[0].role).toBe('start');
        expect(map.get(D1)[0].inProgress).toBe(true);
        expect(map.get(D2)[0].role).toBe('middle');
        expect(map.get(D2)[0].inProgress).toBe(true);
        expect(map.has(D3)).toBe(false);   // today's bubble is the phantom, not a line
    });

    it('skips single-day sessions (start day === end day)', () => {
        const map = buildCrossDayMap([D1], {
            requirements: [{ id: 1, completed_at: `${D1} 10:00:00` }],
            sessions: [{ id: 10, source_ref: 'requirement:1', started_at: `${D1} 08:00:00` }],
            categoryList: CATS, timezone: TZ, startXPct: () => 20,
        });
        expect(map.size).toBe(0);
    });

    it('skips hidden-status in-progress sessions (paused/completed)', () => {
        const map = buildCrossDayMap([D1, D2, D3], {
            requirements: [],
            sessions: [{ id: 99, source_ref: 'requirement:2', started_at: `${D1} 07:00:00`, swarm_status: 'paused' }],
            swarmStarts: [{ id: 500, started_at: `${D1} 07:00:00` }],
            swarmStartSessions: [{ swarm_start_fk: 500, session_fk: 99 }],
            requirementById: new Map([['2', { id: 2 }]]),
            categoryList: CATS, timezone: TZ, startXPct: () => 40, today: D3,
        });
        expect(map.size).toBe(0);
    });

    it('partial window: start day off-strip still draws middle lines on loaded days', () => {
        const map = buildCrossDayMap([D2, D3], {
            requirements: [{ id: 1, completed_at: `${D3} 09:00:00` }],
            sessions: [{ id: 10, source_ref: 'requirement:1', started_at: `${D1} 08:00:00` }],
            categoryList: CATS, timezone: TZ, startXPct: () => 20,
        });
        expect(map.has(D1)).toBe(false);    // not a loaded date
        expect(map.get(D2)[0].role).toBe('middle');
        expect(map.has(D3)).toBe(false);    // completion day
    });

    it('drops the start entry when startXPct returns null but keeps middle lines', () => {
        const map = buildCrossDayMap([D1, D2, D3], {
            requirements: [{ id: 1, completed_at: `${D3} 09:00:00` }],
            sessions: [{ id: 10, source_ref: 'requirement:1', started_at: `${D1} 08:00:00` }],
            categoryList: CATS, timezone: TZ, startXPct: () => null,
        });
        expect(map.has(D1)).toBe(false);    // start bar off-window → skipped
        expect(map.get(D2)[0].role).toBe('middle');
    });

    it('skips a completed span whose completion day is off-window (dangling-line guard)', () => {
        const map = buildCrossDayMap([D1, D2], {
            requirements: [{ id: 1, completed_at: `${D3} 09:00:00` }],
            sessions: [{ id: 10, source_ref: 'requirement:1', started_at: `${D1} 08:00:00` }],
            categoryList: CATS, timezone: TZ, startXPct: () => 20,
        });
        expect(map.size).toBe(0);
    });

    it('start card carries swarmStartId + swarmStart so the start day draws the anchor glyph (req #2862)', () => {
        // The renderer (KonvaSwarmCanvas) reads cd.card.swarmStartId /
        // cd.card.swarmStart to draw the swarm-start tick+dot on the start day of
        // a multi-day span. Lock that contract: when the cluster maps are
        // supplied, the 'start' entry's card must surface both.
        const ssRow = { id: 500, started_at: `${D1} 07:00:00`, session_count: 1 };
        const map = buildCrossDayMap([D1, D2, D3], {
            requirements: [{ id: 1, completed_at: `${D3} 09:00:00`, title: 'X', category_fk: 1 }],
            sessions: [{ id: 10, source_ref: 'requirement:1', started_at: `${D1} 08:00:00` }],
            categoryList: CATS, timezone: TZ, startXPct: () => 25,
            swarmStartIdById: new Map([['10', 500]]),
            swarmStartById: new Map([['10', ssRow]]),
        });
        const start = map.get(D1)[0];
        expect(start.role).toBe('start');
        expect(start.card.swarmStartId).toBe(500);
        expect(start.card.swarmStart).toEqual(ssRow);
    });

    it('keys the cross-day decision on the canonical swarm_start anchor, not session.started_at (req #2878)', () => {
        // Primary-fix regression: a primary session's row is stamped at closeout,
        // so session.started_at lands on the COMPLETION day (D2 00:19) while the
        // swarm_start birth record sits on the PRIOR day (D1 23:11) — they straddle
        // midnight. Before the fix, startDay was computed from session.started_at
        // (D2) → startDay === endDay (D2) → the span was dropped and the swarm-start
        // glyph rendered nowhere. The canonical anchor (D1) must drive the decision.
        const ssRow = { id: 600, started_at: `${D1} 23:11:00`, session_count: 1 };
        const map = buildCrossDayMap([D1, D2], {
            requirements: [{ id: 1, completed_at: `${D2} 00:19:00`, title: 'X', category_fk: 1 }],
            // session row stamped at closeout — SAME day as completion
            sessions: [{ id: 10, source_ref: 'requirement:1', started_at: `${D2} 00:19:00` }],
            categoryList: CATS, timezone: TZ, startXPct: () => 96,
            canonicalStartById: new Map([['10', `${D1} 23:11:00`]]),
            swarmStartIdById: new Map([['10', 600]]),
            swarmStartById: new Map([['10', ssRow]]),
        });
        // Glyph emitted on the prior day, terminated by the bead on the completion day.
        expect(map.get(D1)).toHaveLength(1);
        expect(map.get(D1)[0].role).toBe('start');
        expect(map.get(D1)[0].pct).toBe(96);
        expect(map.get(D1)[0].card.swarmStartId).toBe(600);
        expect(map.has(D2)).toBe(false);   // completion bubble terminates the line
    });

    it('draws one line for a session linked to multiple swarm-starts', () => {
        const map = buildCrossDayMap([D1, D2, D3], {
            requirements: [],
            sessions: [{ id: 99, source_ref: 'requirement:2', started_at: `${D1} 07:00:00`, swarm_status: 'active' }],
            swarmStarts: [
                { id: 500, started_at: `${D1} 07:00:00` },
                { id: 501, started_at: `${D1} 07:05:00` },
            ],
            swarmStartSessions: [
                { swarm_start_fk: 500, session_fk: 99 },
                { swarm_start_fk: 501, session_fk: 99 },
            ],
            requirementById: new Map([['2', { id: 2 }]]),
            categoryList: CATS, timezone: TZ, startXPct: () => 40, today: D3,
        });
        expect(map.get(D1)).toHaveLength(1);   // de-duped, not two lines
        expect(map.get(D2)).toHaveLength(1);
    });
});

// ─── coordinationRingColor — outer autonomy ring (req #2423 / #2755) ───────────
// The shared derivation used by BOTH completed chips and in-progress phantom
// chips. Before req #2755 phantoms hard-coded ringColor:null and never showed
// the ring; this helper guarantees the two paths stay identical.
describe('coordinationRingColor (req #2755 — phantom + completed parity)', () => {
    it('returns null when the Coordination toggle is off (category mode)', () => {
        expect(coordinationRingColor('category', 'deployed')).toBe(null);
        expect(coordinationRingColor('category', null)).toBe(null);
        expect(coordinationRingColor(undefined, 'planned')).toBe(null);
    });

    it('maps coordination_type to its ring color when toggle is on', () => {
        expect(coordinationRingColor('coordination', 'discuss')).toBe('#AB47BC');
        expect(coordinationRingColor('coordination', 'planned')).toBe('#FB8C00');
        expect(coordinationRingColor('coordination', 'implemented')).toBe('#FDD835');
        expect(coordinationRingColor('coordination', 'deployed')).toBe('#43A047');
    });

    it('falls back to red when coordination_type is missing/unknown', () => {
        expect(coordinationRingColor('coordination', null)).toBe('#E53935');
        expect(coordinationRingColor('coordination', undefined)).toBe('#E53935');
        expect(coordinationRingColor('coordination', 'bogus')).toBe('#E53935');
    });
});

describe('computePhantomPlacement (in-progress phantom placement, req #2649)', () => {
    it('Case A — start and now both in window → solid line from startPct to nowPct', () => {
        // Session opened earlier today, still running. Today's panel.
        const p = computePhantomPlacement(20, 60);
        expect(p).toEqual({ phantomStartPct: 20, phantomLeftPct: 60, startClamped: false });
    });

    it('Case A — start at 0 (panel left edge) is still in-window, treated as solid', () => {
        // startPct=0 is a valid in-window position (midnight on a 24h panel).
        // computePhantomPlacement must not confuse it with null.
        const p = computePhantomPlacement(0, 50);
        expect(p).toEqual({ phantomStartPct: 0, phantomLeftPct: 50, startClamped: false });
    });

    it('Case B — start in window, now null → null (no bubble; cross-day line draws it, req #2798)', () => {
        // Looking at the day the session opened (or an intervening day), but
        // "now" is on a later panel. The in-progress bubble belongs ONLY on
        // today's panel — here the dashed cross-day pass-through line carries the
        // session to the panel edge with no bubble (req #2798 fixed the old
        // "bubble parked at midnight/100%" behaviour).
        expect(computePhantomPlacement(45, null)).toBeNull();
    });

    it('Case C — start null, now in window → dashed line from left edge to nowPct (req #2649 fix)', () => {
        // Today's panel; session opened yesterday and is still in-progress.
        // Pre-#2649 this returned null and the phantom never rendered.
        const p = computePhantomPlacement(null, 35);
        expect(p).toEqual({ phantomStartPct: 0, phantomLeftPct: 35, startClamped: true });
    });

    it('Case C — start undefined treated identically to null', () => {
        const p = computePhantomPlacement(undefined, 35);
        expect(p).toEqual({ phantomStartPct: 0, phantomLeftPct: 35, startClamped: true });
    });

    it('Case D — neither in window → null (phantom not rendered on this panel)', () => {
        // Panel is unrelated to the session — e.g. a session that opened
        // yesterday and is still running, viewed on a panel from last week.
        expect(computePhantomPlacement(null, null)).toBeNull();
        expect(computePhantomPlacement(undefined, undefined)).toBeNull();
    });

    it('nowPct=0 (now at the very left edge) is still treated as in-window', () => {
        // The wall clock just ticked over midnight; nowPct == 0. Still valid,
        // still a Case A (start at startPct, head at 0).
        const p = computePhantomPlacement(30, 0);
        expect(p).toEqual({ phantomStartPct: 30, phantomLeftPct: 0, startClamped: false });
    });
});

// ─── isHiddenSwarmStatus (req #2650) ─────────────────────────────────────────
// The phantom-chip filter in SwarmVisualizer skips sessions whose status
// indicates they are NOT actively in progress. Pre-#2650 the filter only
// skipped 'completed', so a session a user explicitly paused continued to
// surface as today's "unfinished business". The helper centralises the skip
// list so future statuses can be added in one place.
describe('isHiddenSwarmStatus (phantom-chip skip filter, req #2650)', () => {
    it('hides null / undefined / empty status', () => {
        expect(isHiddenSwarmStatus(null)).toBe(true);
        expect(isHiddenSwarmStatus(undefined)).toBe(true);
        expect(isHiddenSwarmStatus('')).toBe(true);
    });

    it("hides 'completed' (work is drawn as a real chip, not a phantom)", () => {
        expect(isHiddenSwarmStatus('completed')).toBe(true);
    });

    it("hides 'paused' (req #2650 — user paused; not unfinished business today)", () => {
        expect(isHiddenSwarmStatus('paused')).toBe(true);
    });

    it("shows 'active' (the canonical in-progress status)", () => {
        expect(isHiddenSwarmStatus('active')).toBe(false);
    });

    it("shows other in-progress lifecycle statuses (starting, review, completing)", () => {
        expect(isHiddenSwarmStatus('starting')).toBe(false);
        expect(isHiddenSwarmStatus('review')).toBe(false);
        expect(isHiddenSwarmStatus('completing')).toBe(false);
    });

    it('shows unknown / future statuses (blacklist semantics — safer to render)', () => {
        // Forward-compatibility: a new status (e.g. 'queued') defaults to
        // rendering, not hiding. Adding it to the blacklist is a deliberate
        // act when a real "do not phantom this" case appears.
        expect(isHiddenSwarmStatus('queued')).toBe(false);
        expect(isHiddenSwarmStatus('blocked')).toBe(false);
    });
});
