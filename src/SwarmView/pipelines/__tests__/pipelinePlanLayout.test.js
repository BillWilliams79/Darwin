// pipelinePlanLayout.test.js — the Plan visualizer's pure geometry (req #3115)
// against the engine's static Substrate Rebuild fixture (req #3112).
//
// The acceptance criterion is ZERO LABEL OVERLAP plus CARD CONTAINMENT — every
// piece of text inside the card that owns it — in both step-label modes, each
// asserted by rect intersection over the boxes the layout itself exports, not by
// eyeball. Since req #3498 that is TWO combinations, not four: `reqLayout` left
// with the horizontal requirement row. Lane assignment, cross-column
// reservation and arc/card clearance are the supporting invariants.

import { describe, it, expect } from 'vitest';

import { SUBSTRATE_REBUILD_MODEL, MACHINES, EPICS } from './substrateRebuildFixture';
import { timedFuzzCorpus, FUZZ_NOW } from './timedFuzzPlans';
import { EPIC_ZOOM_READS, EPIC_ZOOM_PIPELINE, EPIC_ZOOM_NOW } from './epicZoomFixture';
// req #3356 — plan fixtures are minted by `planFixtureEngine.js`, this
// directory's TEST-ONLY copy of Pipeline 1.0's derivation engine (see its header
// for why it exists and how it is retired). `../pipelinePlanLayout.js` is
// era-neutral: it takes `PlanRow`s and returns geometry, so a fixture built by
// the retired engine exercises it exactly as one built by
// `adaptComposedPipeline` would.
import { buildPipelineModel, orderedPlan } from './planFixtureEngine';
import { semanticLevel, SEMANTIC_OUT_MAX } from '../../konvaSwarmModel';
import {
    computePlanLayout, beadStyle, stepLabelText, BEAD_RADIUS, BEAD_HIT_RADIUS,
    PLAN_VIZ_PALETTE, placeEpicChips, EPIC_CHIP_OPEN_LINK_W, EPIC_CHIP_CARDS_LINK_W,
    K_READABLE, PLAN_VIZ_FONT, READABLE_MIN_PX,
    CARD_W, CARD_GAP_X, CARD_GAP_Y, CARD_PAD_X, CARD_PAD_Y, CARD_TEXT_W,
    CARD_LINE_H, CARD_SUBTITLE_H, CARD_RULE_BAND, CARD_TITLE_CHARS, CARD_ID_CHARS,
    CARD_FRAME_W, CARD_FRAME_X, CARD_STATE_BAR_W, CARD_BAR_GAP,
    CARD_BADGE_W, CARD_BADGE_GAP, CARD_BADGE_H, CARD_BADGE_FONT, badgeWidthFor,
    CARD_STEP_LINK_W, CARD_FONT,
    STEP_WIDTH_SCALES, cardGeometryFor,
    STEPS_ACROSS_OPTIONS, STEPS_ACROSS_LOOSE_FILL, stepsAcrossScale,
    zoomAboutViewportCentre, zoomAboutPoint, snapZoomScale, columnsAcross,
    SNAP_COLUMNS_STEP,
    CARD_TEXT_CHARS, CARD_SEP_CHARS, CARD_CHECK_W,
    REQ_MAX_LINES, wrapReqText, REQ_ROW_GAP, reqBlockHeight, REQ_TEXT_H,
    CHW_LABEL, CHW_REQ, CHW_TITLE, CARD_TYPE_SCALE, NAME_MAX_LINES,
    cardHeight, cardTitleH, cardChars, MIN_CARD_H,
    PLAN_PALETTES, PLAN_PALETTE_KEYS, DEFAULT_PLAN_PALETTE, planPalette,
    isPlanPalette,
    NEXT_HALO_RADIUS, NEXT_HALO_STROKE, NEXT_HALO_DASH, EPIC_CHIP_CHAR_W,
    NEXT_HALO_SCREEN_RADIUS, NEXT_HALO_MAX_OUTER, NEXT_HALO_MAX_MAGNIFY,
    NEXT_HALO_CLEARANCES, nextHaloMagnify, labelsLegible, drawsLabelKind,
    NEXT_MARK_MIN_STROKE_PX, NEXT_MARK_FLOOR_K, NEXT_MARK_SCREEN_RADIUS,
    nextMarkIsDot, nextMarkDotRadius, clusterNextMarks,
    NEXT_MARK_COUNT_FONT_PX,
    readableDefaultScale, BEAD_RING_W_EMPHASIS, BEAD_OUTER_RADIUS,
    EPIC_CHIP_FONT, EPIC_CHIP_H, EPIC_CHIP_MIN_H, EPIC_CHIP_MIN_CHARS,
    EPIC_CHIP_PAD_W, EPIC_CHIP_MIN_FONT,
    EPIC_LANE_CLEAR_K,
    REQ_STATUS_COLORS, REQ_STATUS_ORDER, REQ_STATUS_UNKNOWN_COLOR, reqStatusColor,
    MACHINE_MAC_COLOR, MACHINE_WINDOWS_COLOR, MACHINE_ANY_COLOR,
    MACHINE_FALLBACK_PALETTE, machineEcosystem, buildMachineColorView,
    AUTONOMY_COLORS, AUTONOMY_ORDER, AUTONOMY_UNKNOWN_COLOR, autonomyColor,
    REQ_COLOR_SCALES, REQ_COLOR_KEYS, reqColorScale, buildReqColorViews,
    DEFAULT_COLOR_KEY, isColorKey, normalizeColorKey,
    reqIdStyle, reqIdKeyEntries, PLAN_KEY_MAX_H,
    reqLabelText, REQ_VIEWS, DEFAULT_REQ_VIEW, isReqView,
    normalizeReqView, reqViewOptions, PLAN_LEVEL_BY_PREF, PLAN_LEVEL_NUMBER,
    DEFAULT_PLAN_LEVEL_PREF, isPlanLevelPref, normalizePlanLevelPref, pinnedLevelOf,
    planLevelFor,
    REQ_LINE_H,
    FOCUS_MAX_RATIO, FOCUS_MIN_RATIO, FOCUS_PAD, STEP_DONE, ZOOM_MAX_RATIO, ZOOM_MIN_RATIO, bandFitRect, epicFocusTransform,
    FOCUS_LABEL_H, epicFocusNeighbours,
    stepFitRect, stepFocusTransform, stepsFitRect, stepsFocusTransform,
    STEP_FOCUS_STEPS_ACROSS, placedStepCount, centreTransform,
    RULER_H, computeRuler, slotTickText, factoryDefaultScale,
    stickyRulerY, rulerScreenBottom, rulerScreenMag,
    EPIC_PALETTE,
    PAUSE_ACTIVE_COLOR, PAUSE_PAUSED_COLOR, pauseBubbleColor, EPIC_PAUSE_BUBBLE_W,
    COLOR_CHANNELS, KEY_GROUP_TITLES,
    reqSortRank, sortReqIdsByColorKey,
} from '../pipelinePlanLayout';
import { epicWorkStepIds } from '../pipelineEpicZoom';

const NOW = '2026-07-27T03:00:00Z';
const plan = orderedPlan(SUBSTRATE_REBUILD_MODEL, { now: NOW });

// req #3498 — TWO combinations, not four. `reqLayout` left with the horizontal
// requirement row (a card stacks its requirements), so what remains is the two
// things the card's TITLE AREA can say. `reqLabel` is swept separately where it
// matters, because it changes the text in a row and never the geometry.
const COMBOS = [
    { stepLabel: 'id' },
    { stepLabel: 'title' },
];

const rectsOverlap = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const beadRect = (n) => ({
    x: n.x - BEAD_RADIUS, y: n.y - BEAD_RADIUS,
    w: 2 * BEAD_RADIUS, h: 2 * BEAD_RADIUS,
});

// req #3498 — the step's mark at L2/L3. The layout hands the box out directly,
// so this is a projection and never a second derivation of it.
const cardRect = (n) => ({ x: n.left, y: n.top, w: n.w, h: n.h });

// A title longer than any card can draw, on EVERY requirement — so the
// truncation path is the one under test rather than an incidental short string.
const REQ_TITLES = new Map(SUBSTRATE_REBUILD_MODEL.requirements.map(
    (r) => [r.id, 'A requirement title far longer than the card can ever draw']));

// The transitive dependency closure over a row set, memoized — the test-side
// mirror of the layout module's own `reach`, and the ONLY copy in this file
// (req #3512 review). THREE byte-identical closures had accumulated — two
// already here, plus one req #3512's own first draft pasted in — and a
// predicate that decides what counts as "in chain" is exactly the thing that
// must not be able to drift between the assertions that share it — they answer
// the same question for straight arcs, for arc/card crossings and for the
// corpus ratchet, so three of them silently disagreeing is the failure mode.
// If you need it again, call this; do not paste a fourth.
function mkReach(rows) {
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const memo = new Map();
    const reach = (id) => {
        if (memo.has(id)) return memo.get(id);
        const out = new Set();
        memo.set(id, out); // cycle guard
        for (const d of (rowById.get(id)?.depIds || [])) {
            out.add(d);
            for (const dd of reach(d)) out.add(dd);
        }
        return out;
    };
    return reach;
}

// The reservation invariant, checked from layout OUTPUT: a straight (same-lane)
// arc may cross only beads that are part of its own chain — a transitive
// dependent of the tail AND dependency of the head (e.g. 13 on the 12→14 arc,
// where 14 gates on both). Anything else on the wire is the failure the
// cross-column reservation exists to prevent.
function assertStraightArcsClear(layout, rows) {
    const reach = mkReach(rows);
    for (const arc of layout.arcs.filter((a) => a.straight)) {
        const a = layout.nodes.get(arc.fromId);
        const b = layout.nodes.get(arc.toId);
        expect(a.y).toBe(b.y);
        for (const n of layout.nodes.values()) {
            if (n.id === a.id || n.id === b.id) continue;
            const onWire = n.bandIndex === a.bandIndex
                && n.y === a.y && n.x > a.x && n.x < b.x;
            if (!onWire) continue;
            const inChain = reach(n.id).has(a.id) && reach(b.id).has(n.id);
            if (!inChain) {
                throw new Error(`straight arc ${a.id}→${b.id} passes through `
                    + `unrelated bead ${n.id}`);
            }
        }
    }
}

// ── ARC HORIZONTAL RUNS OVER AN UNRELATED BEAD (req #3512) ─────────────────
// The same question `assertStraightArcsClear` asks, widened to EVERY route and
// answered with a COUNT rather than a throw — because the answer is not zero
// today and pretending otherwise would make the sweep below unrunnable. An arc
// whose source-lane corridor is blocked falls back to an early bend onto a
// destination lane whose corridor nothing checks; that hole predates req #3512.
//
// Returns `{ crossings, arcs, onRun }`. `onRun` counts every bead sitting on
// some arc's horizontal run INCLUDING the legitimate in-chain ones, so it stays
// positive even if crossings reach zero — which is what makes it usable as a
// wiring check that does not fail the day the metric is fixed.
//
// TWO DELIBERATE APPROXIMATIONS, both conservative:
//  · the run is taken as the whole span `x1 < x < x2` for every route, while a
//    late arc's horizontal actually ends at `x2 - bend` and an early arc's
//    begins at `x1 + bend`. This OVER-counts and never under-counts, so a
//    ceiling asserted against it cannot be satisfied by a real crossing hiding
//    in the bend.
//  · a cross-band arc scores zero because the scan is restricted to the SOURCE
//    band — NOT because it has no horizontal run. It does: `sameBand` is false,
//    so it always takes the early shape, whose trailing `L` runs at `y2`, the
//    DESTINATION node's y, inside the DESTINATION band's lanes. Nothing here
//    looks there. Measured on this corpus: 782 such overdraws (779 before req
//    #3512, so 3 are attributable to it, against 20 → 14 in-band). A
//    PRE-EXISTING GAP IN THE METRIC, ~56x larger than the class it counts —
//    read the ceilings below as "in-band crossings", never as "all of them".
function arcCrossings(layout, rows) {
    const reach = mkReach(rows);
    let crossings = 0;
    let onRun = 0;
    for (const arc of layout.arcs) {
        // Where the arc actually RUNS horizontally: its source lane when
        // straight or late-bending, its destination lane when early.
        const hy = arc.straight || arc.route === 'late' ? arc.y1 : arc.y2;
        const from = layout.nodes.get(arc.fromId);
        for (const node of layout.nodes.values()) {
            if (node.id === arc.fromId || node.id === arc.toId) continue;
            if (node.bandIndex !== from.bandIndex) continue;
            if (node.y !== hy) continue;
            if (!(node.x > arc.x1 && node.x < arc.x2)) continue;
            onRun += 1;
            // In-chain beads are legitimate — the run reads as one line through
            // its own members (the 12→14 arc over 13).
            if (reach(node.id).has(arc.fromId)
                && reach(arc.toId).has(node.id)) continue;
            crossings += 1;
        }
    }
    return { crossings, arcs: layout.arcs.length, onRun };
}

function assertNoLabelOverlap(layout, name) {
    const labels = layout.labels;
    for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
            if (rectsOverlap(labels[i], labels[j])) {
                throw new Error(`label overlap (${name}): `
                    + `${JSON.stringify(labels[i])} vs ${JSON.stringify(labels[j])}`);
            }
        }
    }
}

describe('placement fundamentals (Substrate Rebuild fixture)', () => {
    const layout = computePlanLayout(plan.rows);

    it('places every row exactly once', () => {
        expect(layout.nodes.size).toBe(plan.rows.length);
        for (const r of plan.rows) expect(layout.nodes.get(r.id)).toBeTruthy();
    });

    it('assigns dependency-depth columns: a dep always sits left of its dependent', () => {
        for (const r of plan.rows) {
            const n = layout.nodes.get(r.id);
            for (const d of r.depIds) {
                const dn = layout.nodes.get(d);
                expect(dn.depth).toBeLessThan(n.depth);
                expect(dn.x).toBeLessThan(n.x);
            }
        }
    });

    it('never stacks two beads on the same (band, depth, lane) cell', () => {
        const seen = new Set();
        for (const n of layout.nodes.values()) {
            const cell = `${n.bandIndex}|${n.depth}|${n.lane}`;
            expect(seen.has(cell)).toBe(false);
            seen.add(cell);
        }
    });

    it('gives beads distinct positions — no two coincide', () => {
        const seen = new Set();
        for (const n of layout.nodes.values()) {
            const pos = `${n.x}|${n.y}`;
            expect(seen.has(pos)).toBe(false);
            seen.add(pos);
        }
    });

    it('groups bands by dominant epic in first-appearance order over display order', () => {
        const expected = [];
        for (const r of plan.rows) {
            const key = r.epicId != null ? r.epicId : null;
            if (!expected.includes(key)) expected.push(key);
        }
        expect(layout.bands.map((b) => b.epicId)).toEqual(expected);
    });
});

describe('chain lanes with cross-column reservation', () => {
    const layout = computePlanLayout(plan.rows);

    it('keeps every straight (same-lane) arc clear of unrelated beads', () => {
        assertStraightArcsClear(layout, plan.rows);
    });

    // Regression for the review finding that killed the POC's post-hoc
    // reservation: step 8's only dependency lives in ANOTHER band, so 8 grabs
    // lane 0 at depth 1 before the 1→5 chain (depth 0 → 2) wants to run
    // through that cell. The corridor check must push 5 onto its other dep's
    // lane instead of drawing the 1→5 wire through bead 8.
    it('does not inherit a lane whose corridor holds an unrelated bead', () => {
        const mk = (id, depIds, epicId, epic) => ({
            id, title: `s${id}`, run: 'auto', state: 'pending', reqIds: [],
            depIds, timeDeps: [], epicId, epic,
            epicLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
        });
        const rows = [
            mk(1, [], 1, 'E1'),
            mk(3, [], 1, 'E1'),
            mk(4, [3], 1, 'E1'),
            mk(5, [1, 4], 1, 'E1'),
            mk(8, [9], 1, 'E1'),
            mk(9, [], 2, 'E2'),
        ];
        const l = computePlanLayout(rows);
        assertStraightArcsClear(l, rows);
    });

    it('continues a chain along its dependency lane when the lane is free', () => {
        // Same-band chain inside "Swarm Substrate Rebuild": 10 → 26 → 25 (25
        // gates on both). Each link should inherit its dependency's lane.
        const n10 = layout.nodes.get(10);
        const n26 = layout.nodes.get(26);
        const n25 = layout.nodes.get(25);
        expect(n26.lane).toBe(n10.lane);
        expect(n25.lane).toBe(n26.lane);
    });

    it('the req-less step bands with the epic it inherits, and its chain holds', () => {
        // This assertion used to read the other way: step 7 links no
        // requirements, derived no epic, and sat alone in a 'No epic' band —
        // which put a single bead in a band of its own between the two epics it
        // belongs between, and broke the 6 → 7 chain because lane inheritance is
        // same-band by design. req #3119: a req-less step inherits its
        // dependencies' label, so both the band and the chain now hold.
        const n6 = layout.nodes.get(6);
        const n7 = layout.nodes.get(7);
        const band6 = layout.bands[n6.bandIndex];
        const band7 = layout.bands[n7.bandIndex];
        expect(band7.epicId).toBe(band6.epicId);
        expect(band7.epic).toBe('Swarm Substrate Rebuild');
        expect(n7.lane).toBe(n6.lane);
        // No 'No epic' band survives on this fixture at all.
        expect(layout.bands.filter((b) => b.epicId == null)).toEqual([]);
    });
});

describe('corridor-aware lanes and adaptive arc routing (epic #6 shape)', () => {
    // The live plan that forced both rules (user directive, 2026-07-30): four
    // roots, two d1 siblings off root 47, a penultimate step gating on five of
    // them, a capstone gating on the penultimate alone. The POC layout parked
    // 50 under 49 and drew every convergent arc through the main chain's beads.
    const mk = (id, depIds) => ({
        id, title: `s${id}`, run: 'auto', state: 'pending', reqIds: [],
        depIds, timeDeps: [], epicId: 6, epic: 'Mapping Aggregator Card',
        epicLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
    });
    const rows = [
        mk(47, []), mk(48, [47]), mk(49, []), mk(50, [47]),
        mk(51, []), mk(52, []), mk(53, [48, 49, 50, 51, 52]), mk(54, [53]),
    ];
    const layout = computePlanLayout(rows);
    const n = (id) => layout.nodes.get(id);

    it('keeps the main chain straight on one lane', () => {
        expect(n(48).lane).toBe(n(47).lane);
        expect(n(53).lane).toBe(n(48).lane);
        expect(n(54).lane).toBe(n(53).lane);
    });

    it('slots the second d1 sibling ADJACENT to its parent chain via lane insertion', () => {
        // 50 may not share a lane with 48 (cell clash) nor with 49/51/52 —
        // each of those still owes an arc PAST column 1 to step 53, and parking
        // 50 on any of their lanes puts its bead on that arc's horizontal run.
        // Nor may it be banished below them: dep-adjacent insertion opens a
        // fresh lane directly under the parent, pushing the unrelated roots
        // down one row each.
        expect(n(50).lane).not.toBe(n(48).lane);
        for (const feeder of [49, 51, 52]) {
            expect(n(50).lane).not.toBe(n(feeder).lane);
            expect(n(50).lane).toBeLessThan(n(feeder).lane);
        }
        expect(n(50).lane).toBe(n(47).lane + 1);
    });

    it('routes the convergent arcs LATE, on their own source lanes', () => {
        const arcFrom = (fromId, toId) => layout.arcs.find(
            (a) => a.fromId === fromId && a.toId === toId);
        for (const feeder of [49, 51, 52]) {
            const arc = arcFrom(feeder, 53);
            expect(arc.route).toBe('late');
            expect(arc.y1).toBe(n(feeder).y); // horizontal runs at the SOURCE lane
        }
    });

    it('no arc horizontal run passes through an unrelated bead', () => {
        for (const arc of layout.arcs) {
            const hy = arc.straight || arc.route === 'late' ? arc.y1 : arc.y2;
            for (const row of rows) {
                if (row.id === arc.fromId || row.id === arc.toId) continue;
                const node = n(row.id);
                if (node.y !== hy) continue;
                const onRun = node.x > arc.x1 && node.x < arc.x2;
                expect(onRun).toBe(false);
            }
        }
    });
});

// ── A CHAIN DOES NOT FRAGMENT AROUND AN UNRELATED SIBLING (req #3512) ───────
// The live shape, reproduced from the composed read of pipeline 7's "Technical
// Debt" epic on 2026-08-14 and rebuilt here with the same seven columns:
//
//     root ──┬── p1 ── p2 ── p3 ── p4          one linear chain
//            └────────────────── w1 ── w2      one unrelated parallel chain
//
// THE TIME AXIS IS THE TRIGGER AND THE FIXTURE CARRIES ONE. `w1`'s only
// dependency is `root`, so topology alone would seat it at column 1 — a date
// moves it to column 4, which puts the `root → w1` arc across column 2, where
// `p2` wants to sit. Without an axis the defect does not reproduce at all
// (measured: two lanes both before and after the fix), so a fixture without one
// would assert the right thing about the wrong configuration — and an axis is
// what the page always renders with.
//
// BEFORE the fix: `p2`/`p3`/`p4` were refused lane 0 and pushed onto a THIRD
// lane below the `w1` chain, disconnected from `p1` directly above them.
describe('a dependent step stays in its chain\'s lane (req #3512)', () => {
    const DAY = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
        '2026-08-14', '2026-08-15'];
    const mk = (id, depIds) => ({
        id, title: `s${id}`, run: 'auto', state: 'pending', reqIds: [],
        depIds, timeDeps: [], epicId: 21, epic: 'Technical Debt',
        epicLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
    });
    //         root  p1  p2  p3  p4        w1  w2
    const rows = [mk(1, []), mk(2, [1]), mk(3, [2]), mk(4, [3]), mk(5, [4]),
        mk(6, [1]), mk(7, [6])];
    // One dated day per column, so `w1` (6) lands in the same slot as `p4` (5).
    const timeAxis = {
        stepStarts: new Map([
            [1, { at: DAY[0], kind: 'dated' }], [2, { at: DAY[1], kind: 'dated' }],
            [3, { at: DAY[2], kind: 'dated' }], [4, { at: DAY[3], kind: 'dated' }],
            [5, { at: DAY[4], kind: 'dated' }], [6, { at: DAY[4], kind: 'dated' }],
            [7, { at: DAY[5], kind: 'dated' }],
        ]),
        bandStarts: new Map(),
        bandKinds: new Map(),
    };
    const layout = computePlanLayout(rows, { timeAxis });
    const n = (id) => layout.nodes.get(id);

    it('puts the unrelated chain in a column the shared root must arc past', () => {
        // The precondition, asserted rather than assumed: if the axis ever
        // stopped pushing `w1` right, every assertion below would still pass
        // while testing nothing. `w1` at column 4 is what makes the `root → w1`
        // arc cross `p2`'s column at all.
        expect([1, 2, 3, 4, 5, 6, 7].map((id) => n(id).depth))
            .toEqual([0, 1, 2, 3, 4, 4, 5]);
    });

    it('renders the linear chain as ONE continuous lane', () => {
        for (const id of [2, 3, 4, 5]) {
            expect(n(id).lane, `step ${id} left the chain's lane`).toBe(n(1).lane);
            expect(n(id).y, `step ${id} left the chain's line`).toBe(n(1).y);
        }
    });

    it('takes TWO lanes for two chains, not three', () => {
        const band = layout.bands[n(1).bandIndex];
        expect(band.sub).toBe(2);
        expect(n(6).lane).toBe(1);
        expect(n(7).lane).toBe(1);
    });

    it('still keeps every arc off an unrelated bead', () => {
        assertStraightArcsClear(layout, rows);
        // The full-route count, not just the straight ones: the whole point of
        // granting p2 lane 0 is that the root's arc to w1 now has to get past
        // it, so this shape is where a relaxation would show up as spaghetti.
        expect(arcCrossings(layout, rows).crossings).toBe(0);
        // NON-VACUITY, and `onRun > 0` is the WRONG guard here — measured: it
        // is 0 on this fixture, because every straight arc joins ADJACENT
        // columns and no bead can sit strictly inside one. What proves the
        // predicate had something to find is the root → w1 arc: it spans three
        // columns and its x-range CONTAINS p2 and p3, so if it ran at the
        // chain's y (early bend onto lane 0, or a straight arc) both would be
        // counted. It clears them by height, not by falling outside the span.
        const rootToW1 = layout.arcs.find((a) => a.fromId === 1 && a.toId === 6);
        expect(rootToW1, 'the root → w1 arc is missing').toBeTruthy();
        for (const id of [3, 4]) {
            expect(n(id).x > rootToW1.x1 && n(id).x < rootToW1.x2,
                `step ${id} is not inside the root → w1 arc's span`).toBe(true);
        }
        const hy = rootToW1.straight || rootToW1.route === 'late'
            ? rootToW1.y1 : rootToW1.y2;
        expect(hy, 'the root → w1 run is at the chain\'s own height')
            .not.toBe(n(3).y);
    });

    it('never stacks two beads on one cell', () => {
        const seen = new Set();
        for (const node of layout.nodes.values()) {
            const cell = `${node.bandIndex}|${node.depth}|${node.lane}`;
            expect(seen.has(cell), `cell ${cell} taken twice`).toBe(false);
            seen.add(cell);
        }
    });
});

describe('zero label overlap — every layout/label combination', () => {
    // The wide-outer-columns fixture: one chain (⇒ one lane) whose ends carry
    // many requirements and whose middle carries one. It was built to expose a
    // STAGGER failure — wide outer columns squeezing a narrow shared one — and it
    // is kept now that columns are uniform, because it is still the shape that
    // produces the tallest height difference between neighbouring cards in a
    // lane, which is what the centre-alignment rule has to survive.
    const wideChain = [5001, 5002, 5003, 5004, 5005].map((id, i) => ({
        id,
        title: 'A step title long enough to want the whole budget',
        run: 'auto',
        notes: null,
        state: 'pending',
        reqIds: (i === 0 || i === 4)
            ? [3001, 3002, 3003, 3004, 3005] : [3001],
        depIds: i === 0 ? [] : [5000 + i],
        timeDeps: [],
        epicId: 1,
        epic: 'E',
        featureId: 1,
        feature: 'F',
        epicLabels: [{ id: 1, title: 'E' }],
        featureLabels: [{ id: 1, title: 'F' }],
        machineLabels: [],
        machineLabel: '',
    }));

    for (const opts of COMBOS) {
        const name = `${opts.stepLabel} labels`;
        it(`no two labels intersect (${name})`, () => {
            assertNoLabelOverlap(computePlanLayout(plan.rows, opts), name);
            assertNoLabelOverlap(computePlanLayout(wideChain, opts),
                `wide-outer-columns (${name})`);
        });

        // ── THIS REPLACES "no label intersects any bead" (req #3498) ────────
        // That test asserted the two marks never touched, because the bead was
        // drawn at the CENTRE of a cluster of free-floating text and could
        // collide with any of it. Neither half of that is true now: the labels
        // are inside the card, and the bead is drawn only at L1 — the one level
        // that draws no labels at all.
        //
        // What is still worth pinning is CONTAINMENT. The bead sits at the
        // card's midpoint, so it must fit inside the box the card would occupy;
        // a bead poking out of its own card would overlap a neighbour's arc
        // leader at L1 and the band furniture at every level.
        it(`the bead sits inside its own card (${name})`, () => {
            const layout = computePlanLayout(plan.rows, opts);
            for (const n of layout.nodes.values()) {
                const bead = beadRect(n);
                const card = cardRect(n);
                expect(bead.x).toBeGreaterThanOrEqual(card.x);
                expect(bead.x + bead.w).toBeLessThanOrEqual(card.x + card.w);
                expect(bead.y).toBeGreaterThanOrEqual(card.y);
                expect(bead.y + bead.h).toBeLessThanOrEqual(card.y + card.h);
            }
        });

        // ── THIS REPLACES "req labels stay inside their column slab" ────────
        // The card is the containment boundary now, and it is STRICTLY TIGHTER
        // than the column: a column is a card plus the gutter, so a label inside
        // its card is inside its column too. It also covers EVERY kind rather
        // than only `req` — the old test could not, because two kinds
        // (the title slot, and the step label in title mode) deliberately
        // overflowed their column under the stagger. Nothing overflows now.
        it(`every label sits inside the card that owns it (${name})`, () => {
            for (const rows of [plan.rows, wideChain]) {
                const layout = computePlanLayout(rows, opts);
                for (const label of layout.labels) {
                    if (label.stepId == null) continue;
                    const n = layout.nodes.get(label.stepId);
                    expect(label.x).toBeGreaterThanOrEqual(n.left - 0.01);
                    expect(label.x + label.w).toBeLessThanOrEqual(n.right + 0.01);
                    expect(label.y).toBeGreaterThanOrEqual(n.top - 0.01);
                    expect(label.y + label.h).toBeLessThanOrEqual(n.bottom + 0.01);
                }
            }
        });
    }
});

describe('bead vocabulary (POC roles)', () => {
    const rowById = new Map(plan.rows.map((r) => [r.id, r]));

    it('done = green fill + check, running = amber + pulse, pending = hollow', () => {
        const done = beadStyle(rowById.get(1), false);
        expect(done.fill).toBe(PLAN_VIZ_PALETTE.doneFill);
        expect(done.check).toBe(true);
        expect(done.pulse).toBe(false);

        const running = beadStyle(rowById.get(38), false);
        expect(running.fill).toBe(PLAN_VIZ_PALETTE.runningFill);
        expect(running.pulse).toBe(true);

        const pending = beadStyle(rowById.get(39), false);
        expect(pending.fill).toBe(PLAN_VIZ_PALETTE.pendingFill);
        expect(pending.check).toBe(false);
    });

    it('manual ring is magenta; the eligible ring beats it', () => {
        const manual = rowById.get(17); // manual run in the fixture
        expect(manual.run).toBe('manual');
        expect(beadStyle(manual, false).ring).toBe(PLAN_VIZ_PALETTE.manualRing);
        expect(beadStyle(manual, true).ring).toBe(PLAN_VIZ_PALETTE.eligibleRing);
        expect(beadStyle(manual, true).ringWidth).toBe(2.5);
    });

    it('the engine, not the layout, decides eligibility — step 17 qualifies (deps 12, 13, 14 all done)', () => {
        expect(plan.eligibleStepIds.has(17)).toBe(true);
    });
});

describe('step labels', () => {
    it('id mode renders the bare id — no # (production directive)', () => {
        expect(stepLabelText({ id: 42, title: 'anything' }, 'id')).toBe('42');
    });

    it('title mode truncates long titles with an ellipsis', () => {
        const long = 'x'.repeat(80);
        const label = stepLabelText({ id: 1, title: long }, 'title');
        expect(label.length).toBeLessThanOrEqual(60);
        expect(label.endsWith('…')).toBe(true);
    });
});

// ── THE SIGNATURE CHANGE THAT COULD NOT FAIL SILENTLY (req #3371) ──────────
// `computePlanLayout(rows, batches, opts)` was the signature through nine
// requirements and ~100 call sites, and the middle argument was deleted. A
// stale caller does not throw — it hands an array in as `opts`, every option
// falls back to its default, and the plan renders CORRECTLY but in the wrong
// requirement layout, with the wrong step width and no time axis. This case is
// why that is a stack trace instead.
describe('the removed second positional argument', () => {
    // COVERS: VIS-003
    it('refuses an array where the options bag belongs, loudly', () => {
        expect(() => computePlanLayout(plan.rows, [])).toThrow(TypeError);
        expect(() => computePlanLayout(plan.rows, [{ letter: 'A', stepIds: [1] }]))
            .toThrow(/second argument/i);
    });

    it('still accepts the shapes a real caller passes', () => {
        expect(() => computePlanLayout(plan.rows)).not.toThrow();
        expect(() => computePlanLayout(plan.rows, {})).not.toThrow();
        expect(() => computePlanLayout(plan.rows, undefined)).not.toThrow();
        // req #3498 — the layout used to echo `stepWidth` back on its result,
        // and this asserted the round trip. The option is gone, so what is
        // pinned instead is that the options bag still round-trips the two
        // settings that ARE left.
        expect(computePlanLayout(plan.rows, { stepLabel: 'title' }).stepLabel)
            .toBe('title');
        expect(computePlanLayout(plan.rows, { reqLabel: 'title' }).reqLabel)
            .toBe('title');
    });
});

describe('empty plan', () => {
    it('returns an explicit empty layout rather than NaN geometry', () => {
        const layout = computePlanLayout([]);
        expect(layout.empty).toBe(true);
        expect(layout.nodes.size).toBe(0);
        expect(layout.labels).toEqual([]);
    });
});

// ── req #3168 ──────────────────────────────────────────────────────────────

describe('the card is a fixed, uniform box (req #3498)', () => {
    it('every column is exactly one card plus the gutter', () => {
        for (const opts of COMBOS) {
            const layout = computePlanLayout(plan.rows, opts);
            for (const w of layout.colW) expect(w).toBe(CARD_W + CARD_GAP_X);
        }
    });

    it('the width is the LINE budget the user chose (the directive)', () => {
        // The primary number moved from a 40-character TITLE to a 28-character
        // LINE on 2026-08-13 — see `CARD_TEXT_CHARS` for the arithmetic that
        // forced it (on-screen type is viewport / (columns x chars-per-line),
        // and the world font cancels). The title budget is DERIVED from it now.
        expect(CARD_TEXT_CHARS).toBe(28);
        expect(CARD_TITLE_CHARS).toBe(CARD_TEXT_CHARS - CARD_ID_CHARS - CARD_SEP_CHARS);
        // The prefix is what `reqLabelText` actually writes — a bare 4-digit id
        // and the three-character " - ". No '#': ids render bare on this
        // surface, so counting one cost the reader a title character.
        expect(CARD_TITLE_CHARS).toBeGreaterThan(0);
        expect(reqLabelText(3498, {
            reqLabel: 'title',
            reqTitles: new Map([[3498, 'x'.repeat(80)]]),
        })).toBe(`3498 - ${'x'.repeat(CARD_TITLE_CHARS - 1)}\u2026`);
        // The text column fits what the width was BOUGHT for, measured at the
        // requirement row's own glyph width — `cardChars` is the function the
        // layout truncates with, so a padding change that quietly ate the
        // budget fails here rather than showing up as a shorter title.
        expect(cardChars(CHW_REQ)).toBe(CARD_TEXT_CHARS);
        // Every card metric moves by ONE factor — a half-applied type scale is
        // what this pins, not the value 1.4 itself.
        expect(CHW_REQ / CHW_LABEL).toBeCloseTo(8.4 / 10.05, 9);
        expect(CHW_TITLE / CHW_REQ).toBeCloseTo(5.8 / 8.4, 9);
        // The text column is the FRAME's, not the node box's: the state bar
        // stands outside the frame (user directive, 2026-08-13) and the box
        // spans both, so the bar costs the card width rather than the text.
        expect(CARD_TEXT_W).toBe(CARD_FRAME_W - 2 * CARD_PAD_X);
        expect(CARD_FRAME_W).toBe(CARD_W - CARD_STATE_BAR_W - CARD_BAR_GAP);
        expect(CARD_FRAME_X).toBe(CARD_STATE_BAR_W + CARD_BAR_GAP);
    });

    it('every card in the plan is the same width, whatever it contains', () => {
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        const widths = new Set([...layout.nodes.values()].map((n) => n.w));
        expect([...widths]).toEqual([CARD_W]);
    });

    it('height is the title area, the rule and the requirement block — nothing else', () => {
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        for (const row of plan.rows) {
            const n = layout.nodes.get(row.id);
            const rows = layout.labels.filter(
                (l) => l.kind === 'req' && l.stepId === row.id);
            const block = reqBlockHeight(rows.map((l) => l.lines));
            const [name] = layout.labels.filter(
                (l) => l.kind === 'step' && l.stepId === row.id);
            expect(n.h, `step ${row.id}`)
                .toBe(cardHeight(block, 'title', name.lines.length));
            // The title area the renderer places the rule from is published on
            // the node, because a wrapped name makes it vary per card.
            expect(n.titleH, `step ${row.id}`)
                .toBe(cardTitleH('title', name.lines.length));
        }
        // ONE MORE LINE costs `REQ_LINE_H`; ONE MORE ROW costs a line PLUS the
        // between-rows gap. The two are different quantities since the user's
        // 2026-08-13 directive — see REQ_ROW_GAP.
        expect(reqBlockHeight([['a'], ['b'], ['c']])
            - reqBlockHeight([['a'], ['b']])).toBeCloseTo(REQ_LINE_H + REQ_ROW_GAP, 6);
        expect(reqBlockHeight([['a', 'b']]) - reqBlockHeight([['a']]))
            .toBeCloseTo(REQ_LINE_H, 6);
        // A step with NO requirements still gets a card — it is a step, it has a
        // name, and its emptiness is a fact worth seeing.
        expect(reqBlockHeight([])).toBe(0);
        expect(cardHeight(0, 'title')).toBeGreaterThan(0);
    });

    it('doubles the air BETWEEN requirements without loosening a wrapped row', () => {
        // The directive: *"double white space between requirement titles"*. A
        // requirement row's text box is 14px, so the air between two ROWS goes
        // 9.5 -> 19 while the air between the two LINES OF ONE ROW stays 9.5 —
        // they are one sentence and must keep reading as one.
        expect(REQ_ROW_GAP).toBeCloseTo(REQ_LINE_H - REQ_TEXT_H, 6);
        const layout = computePlanLayout(plan.rows, {
            ...reqViewOptions('titles'), stepLabel: 'title',
            reqTitles: FIXTURE_TITLES,
        });
        const wrapped = layout.labels.filter(
            (l) => l.kind === 'req' && l.lines.length === REQ_MAX_LINES);
        expect(wrapped.length, 'the fixture has wrapped rows').toBeGreaterThan(0);
        for (const row of plan.rows) {
            const rows = layout.labels.filter(
                (l) => l.kind === 'req' && l.stepId === row.id);
            for (let i = 1; i < rows.length; i++) {
                const airBetweenRows = rows[i].y - (rows[i - 1].y + rows[i - 1].h);
                expect(airBetweenRows, `step ${row.id} row ${i}`)
                    .toBeCloseTo(2 * (REQ_LINE_H - REQ_TEXT_H), 6);
            }
        }
    });

    it('reserves the L3 step-title line in ID mode and not in TITLE mode', () => {
        // The one thing that keeps a LEVEL change a pure transform: the room for
        // the L3 line is spent at every level, so nothing moves when it appears.
        expect(cardTitleH('id') - cardTitleH('title')).toBeCloseTo(CARD_SUBTITLE_H, 6);
        expect(cardTitleH('title')).toBeCloseTo(CARD_PAD_Y + CARD_LINE_H, 6);
    });

    it('the box is the same at every level — a level change never relayouts', () => {
        // `computePlanLayout` takes no level at all, which is the structural
        // form of that guarantee; this pins it so a future option cannot quietly
        // introduce one.
        const a = computePlanLayout(plan.rows, { stepLabel: 'title' });
        const b = computePlanLayout(plan.rows, { stepLabel: 'title' });
        expect([...b.nodes.values()].map(cardRect))
            .toEqual([...a.nodes.values()].map(cardRect));
        expect(b.height).toBe(a.height);
    });

    it('no two cards overlap, anywhere in the plan', () => {
        for (const opts of COMBOS) {
            const layout = computePlanLayout(plan.rows, opts);
            const cards = [...layout.nodes.values()].map(cardRect);
            for (let i = 0; i < cards.length; i++) {
                for (let j = i + 1; j < cards.length; j++) {
                    expect(rectsOverlap(cards[i], cards[j]),
                        `cards overlap: ${JSON.stringify(cards[i])} vs `
                        + `${JSON.stringify(cards[j])}`).toBe(false);
                }
            }
        }
    });

    it('every label sits INSIDE the card that owns it', () => {
        // This REPLACES the old column-containment invariant. It is strictly
        // stronger: a column is wider than a card by the gutter, so a label
        // inside its card is inside its column too, and the card is the thing a
        // reader sees the text clipped to.
        for (const opts of COMBOS) {
            for (const reqLabel of ['id', 'title']) {
                const layout = computePlanLayout(plan.rows,
                    { ...opts, reqLabel, reqTitles: REQ_TITLES });
                for (const label of layout.labels) {
                    if (label.stepId == null) continue;
                    const n = layout.nodes.get(label.stepId);
                    expect(label.x).toBeGreaterThanOrEqual(n.left - 0.01);
                    expect(label.x + label.w).toBeLessThanOrEqual(n.right + 0.01);
                    expect(label.y).toBeGreaterThanOrEqual(n.top - 0.01);
                    expect(label.y + label.h).toBeLessThanOrEqual(n.bottom + 0.01);
                }
            }
        }
    });

    it('cards in one lane share a midpoint, so a same-lane link is straight', () => {
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        const byLane = new Map();
        for (const n of layout.nodes.values()) {
            const key = `${n.bandIndex}:${n.lane}`;
            if (!byLane.has(key)) byLane.set(key, new Set());
            byLane.get(key).add(n.y);
        }
        for (const [key, ys] of byLane) {
            expect([...ys], `lane ${key} has more than one midpoint`).toHaveLength(1);
        }
    });

    it('arcs leave and land on the cards\' edge midpoints (the directive)', () => {
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        expect(layout.arcs.length).toBeGreaterThan(0);
        for (const arc of layout.arcs) {
            const a = layout.nodes.get(arc.fromId);
            const b = layout.nodes.get(arc.toId);
            expect(arc.x1).toBeCloseTo(a.right + 1, 6);
            expect(arc.y1).toBeCloseTo(a.y, 6);
            expect(arc.x2).toBeCloseTo(b.left - 1, 6);
            expect(arc.y2).toBeCloseTo(b.y, 6);
        }
    });

    it('leaves the gutter an arc needs to turn in', () => {
        // The fan-out budget: a card fills its column, so `CARD_GAP_X` is the
        // ENTIRE horizontal room a dependency arc has between two adjacent
        // columns. Pinned because shrinking it for tidiness would silently turn
        // every branch into a vertical kink.
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        const adjacent = layout.arcs.filter((arc) => {
            const a = layout.nodes.get(arc.fromId);
            const b = layout.nodes.get(arc.toId);
            return b.depth - a.depth === 1;
        });
        expect(adjacent.length).toBeGreaterThan(0);
        for (const arc of adjacent) {
            expect(arc.x2 - arc.x1).toBeCloseTo(CARD_GAP_X - 2, 6);
        }
    });

    it('the state bar stands OUTSIDE the frame, and no text reaches it', () => {
        // User directive, 2026-08-13: the colour bar renders outside the frame,
        // on the LEFT, so it does not crowd the lettering. Three things have to
        // hold together or it reads as a thick border instead of a mark:
        // the frame is inset by the bar's strip, no label starts before the
        // frame's padding, and the node's box still spans BOTH so the arcs and
        // the columns are unaffected.
        for (const opts of COMBOS) {
            const layout = computePlanLayout(plan.rows, opts);
            for (const n of layout.nodes.values()) {
                // `toBeCloseTo`: `CARD_FRAME_W` is `CARD_W` less the bar and
                // the gap, so re-adding them round-trips with float drift.
                expect(n.w).toBeCloseTo(CARD_FRAME_X + CARD_FRAME_W, 6);
            }
            for (const label of layout.labels) {
                if (label.stepId == null) continue;
                const n = layout.nodes.get(label.stepId);
                const frameLeft = n.left + CARD_FRAME_X;
                const where = `${opts.stepLabel}: ${label.kind} of ${label.stepId}`;
                // Clear of the bar AND of the frame's own padding.
                expect(label.x, where)
                    .toBeGreaterThanOrEqual(frameLeft + CARD_PAD_X - 0.01);
                // …and inside the frame's right edge, not the box's.
                expect(label.x + label.w, where)
                    .toBeLessThanOrEqual(frameLeft + CARD_FRAME_W - CARD_PAD_X + 0.01);
            }
        }
    });

    it('publishes the FRAME box, and it is not the node box (req #3498)', () => {
        // THE DEFECT THIS PINS, reported by eye: the next-step halo still drew
        // around the whole node box after the state bar moved outside the frame,
        // so a dashed "up next" outline sat a bar's width wider than the card it
        // was marking. The hover and activate regions had the same bug — three
        // consumers, each re-deriving the frame from `left`/`w`, each silently
        // wrong the moment the frame stopped starting at `left`.
        //
        // The fix is ONE published answer, and this is what stops the next
        // consumer re-deriving it: a test that would fail if `frameLeft` went
        // back to meaning `left`.
        for (const opts of COMBOS) {
            const layout = computePlanLayout(plan.rows, opts);
            for (const n of layout.nodes.values()) {
                expect(n.frameLeft).toBeCloseTo(n.left + CARD_FRAME_X, 6);
                expect(n.frameW).toBe(CARD_FRAME_W);
                // The frame is strictly INSIDE the node box, on the left only —
                // its right edge is the box's, because the bar is on the left.
                expect(n.frameLeft).toBeGreaterThan(n.left);
                expect(n.frameLeft + n.frameW).toBeCloseTo(n.right, 6);
                // And the bar's strip is exactly what separates them.
                expect(n.frameLeft - n.left)
                    .toBeCloseTo(CARD_STATE_BAR_W + CARD_BAR_GAP, 6);
            }
        }
    });

    it('every label sits inside the FRAME, which is tighter than the box', () => {
        // The containment that actually matters now. A label inside the node box
        // could still be drawn over the state bar; inside the frame it cannot.
        for (const opts of COMBOS) {
            for (const reqLabel of ['id', 'title']) {
                const layout = computePlanLayout(plan.rows,
                    { ...opts, reqLabel, reqTitles: REQ_TITLES });
                for (const label of layout.labels) {
                    if (label.stepId == null) continue;
                    const n = layout.nodes.get(label.stepId);
                    const where = `${opts.stepLabel}/${reqLabel}: ${label.kind}`;
                    expect(label.x, where).toBeGreaterThanOrEqual(n.frameLeft - 0.01);
                    expect(label.x + label.w, where)
                        .toBeLessThanOrEqual(n.frameLeft + n.frameW + 0.01);
                }
            }
        }
    });

    it('the requirement count badge is a CIRCLE for one digit, a stadium beyond (req #3503)', () => {
        // req #3503 moved the count from dim caption-adjacent text (reported
        // by eye as "too small" at `CARD_FONT.title`) to a badge. The RESERVE
        // (`CARD_BADGE_W`) is fixed, sized for two digits — a review round 2
        // finding found the first cut's THREE-digit reserve left a visible
        // gap of unused space to a typical 1-digit badge's left, and a
        // review round 1 finding before that found the DRAWN badge was
        // always the full reserve width regardless of digit count, which
        // stretched a 1-digit count into an oval instead of the circle the
        // source pill draws. The drawn width is `badgeWidthFor`, called per
        // row — almost always at or under the reserve, but not CAPPED by
        // it: a step carrying 100+ requirements (outside anything this
        // fixture has) would draw wider than `CARD_BADGE_W`, encroaching on
        // the gap before the title rather than clipping.
        expect(CARD_BADGE_W).toBe(badgeWidthFor(2));
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        const counts = layout.labels.filter((x) => x.kind === 'badge');
        expect(counts.length, 'the fixture has badges').toBeGreaterThan(0);
        for (const l of counts) {
            expect(l.w).toBeCloseTo(badgeWidthFor(l.text.length), 6);
            expect(l.h).toBe(CARD_BADGE_H);
            // A single digit draws as an exact CIRCLE: width equals height,
            // so the renderer's `cornerRadius={h/2}` closes it into a ring
            // rather than a stadium.
            if (l.text.length === 1) expect(l.w).toBeCloseTo(CARD_BADGE_H, 6);
        }
        // Non-vacuous: this fixture's counts stay within the 2-digit reserve
        // the constant above is sized for, or the "almost always" claim in
        // this test's own comment would be untested.
        expect(counts.every((l) => l.w <= CARD_BADGE_W + 1e-6)).toBe(true);
    });

    it('CARD_BADGE_FONT is CARD_FONT.label, mirrored by value not import (req #3503)', () => {
        // `CARD_BADGE_FONT` is declared ABOVE `PLAN_VIZ_FONT`/`CARD_FONT` in
        // pipelinePlanLayout.js (a forward reference there would be a TDZ
        // crash, not a lint nit — see its own comment) and so is a
        // hand-copied literal rather than a derived one. This is the guard
        // that stops it quietly drifting from the title size it is supposed
        // to match, the way `STEP_FOCUS_CONTEXT`'s history (elsewhere in
        // this same requirement) shows a by-value copy can.
        expect(CARD_BADGE_FONT).toBe(CARD_FONT.label);
    });

    it('no arc is drawn through a card that is not one of its endpoints', () => {
        // ── THE REGRESSION THIS PINS (req #3498, review finding) ────────────
        // The cross-lane bend was `colW * 0.9`, calibrated when a column was
        // mostly air around a 20px bead. Against a 407px card that is 447px of
        // descent into 90px of actual free space, so the curve finished its dive
        // INSIDE the next column's card — which paints an opaque panel over it.
        // Measured before the fix: 2 crossings became 9. The bend is
        // `CARD_GAP_X` now, so the descent completes in the gutter.
        //
        // Sampled along each path rather than asserted from the control points:
        // what matters is where the curve GOES, not what the string says.
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        const cubic = (p0, p1, p2, p3, t) => {
            const u = 1 - t;
            return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
        };
        const nums = (d) => (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        const crossings = [];
        for (const arc of layout.arcs) {
            const pts = [];
            if (arc.straight) {
                for (let i = 0; i <= 40; i++) {
                    const t = i / 40;
                    pts.push([arc.x1 + (arc.x2 - arc.x1) * t, arc.y1]);
                }
            } else {
                // M x,y [L x,y] C c1 c2 x,y [L x,y] — walk the emitted numbers.
                const v = nums(arc.path);
                const isLate = arc.route === 'late';
                const [mx, my] = [v[0], v[1]];
                const seg = isLate
                    ? { a: [v[2], v[3]], c1: [v[4], v[5]], c2: [v[6], v[7]], b: [v[8], v[9]] }
                    : { a: [mx, my], c1: [v[2], v[3]], c2: [v[4], v[5]], b: [v[6], v[7]] };
                if (isLate) {
                    for (let i = 0; i <= 20; i++) {
                        pts.push([mx + (seg.a[0] - mx) * (i / 20), my]);
                    }
                }
                for (let i = 0; i <= 40; i++) {
                    const t = i / 40;
                    pts.push([
                        cubic(seg.a[0], seg.c1[0], seg.c2[0], seg.b[0], t),
                        cubic(seg.a[1], seg.c1[1], seg.c2[1], seg.b[1], t),
                    ]);
                }
                if (!isLate) {
                    const tail = [v[8], v[9]];
                    for (let i = 0; i <= 20; i++) {
                        pts.push([seg.b[0] + (tail[0] - seg.b[0]) * (i / 20), tail[1]]);
                    }
                }
            }
            for (const n of layout.nodes.values()) {
                if (n.id === arc.fromId || n.id === arc.toId) continue;
                for (const [px, py] of pts) {
                    if (px > n.left && px < n.right && py > n.top && py < n.bottom) {
                        crossings.push(`${arc.fromId}->${arc.toId} (${arc.route}) `
                            + `crosses card ${n.id}`);
                        break;
                    }
                }
            }
        }
        // TWO are LEGAL and are the same two `assertStraightArcsClear` permits:
        // a straight same-lane arc may pass through a bead that is IN ITS OWN
        // CHAIN (a transitive dependent of the tail and dependency of the head),
        // because the chain reads as one line through its own members.
        const reach = mkReach(plan.rows);
        const illegal = crossings.filter((c) => {
            const m = c.match(/^(\d+)->(\d+) \(\w+\) crosses card (\d+)$/);
            const [, from, to, mid] = m.map(Number);
            return !(reach(mid).has(from) && reach(to).has(mid));
        });
        expect(illegal, illegal.join('\n')).toEqual([]);
    });

    it('a lane is its tallest card plus the respectful gap', () => {
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        for (const band of layout.bands) {
            for (let l = 0; l < band.sub; l++) {
                const pitch = band.laneY[l + 1] - band.laneY[l];
                expect(pitch).toBeCloseTo((band.laneCardH.get(l)
                    || cardHeight(0, 'title')) + CARD_GAP_Y, 6);
            }
        }
    });

    it('takes no stepWidth and no reqLayout — both retired with their controls', () => {
        // A stale caller passing either gets the SAME layout, not a different
        // one: the options are ignored, so nothing silently renders a geometry
        // that no control can produce. `stepWidth` (a STRING — 'wide'/'medium',
        // the S/M/L content multiplier) is a different key from req #3503's
        // `stepWidthLevel` (a NUMBER, 1-4) below, so this claim is unaffected
        // by that requirement reusing the axis under a different name.
        const plainLayout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        for (const stale of [{ stepWidth: 'wide' }, { reqLayout: 'horizontal' },
            { stepWidth: 'medium', reqLayout: 'horizontal' }]) {
            const layout = computePlanLayout(plan.rows,
                { stepLabel: 'title', ...stale });
            expect(layout.colW).toEqual(plainLayout.colW);
            expect(layout.width).toBe(plainLayout.width);
            expect(layout.height).toBe(plainLayout.height);
        }
    });
});

describe('Step Width — the card scales, four rungs (req #3503)', () => {
    it('cardGeometryFor(1) is exactly the scale-1 exported constants', () => {
        // The three constants every OTHER piece of code in this file (and
        // every pixel-exact test above) still reads directly are this
        // function evaluated once, at the default rung — not a parallel
        // number that happens to agree today.
        const g = cardGeometryFor(1);
        expect(g.cardW).toBe(CARD_W);
        expect(g.cardFrameW).toBe(CARD_FRAME_W);
        expect(g.cardTextW).toBe(CARD_TEXT_W);
    });

    it('STEP_WIDTH_SCALES is the linear ladder the toolbar promises: 1, 1.25, 1.5, 1.75', () => {
        expect(STEP_WIDTH_SCALES).toEqual([1, 1.25, 1.5, 1.75]);
    });

    it('a wider rung grows ONLY the text room — padding, state bar and gap stay fixed', () => {
        const base = cardGeometryFor(1);
        for (let level = 2; level <= STEP_WIDTH_SCALES.length; level += 1) {
            const wide = cardGeometryFor(STEP_WIDTH_SCALES[level - 1]);
            const where = `level ${level}`;
            expect(wide.cardW, where).toBeGreaterThan(base.cardW);
            expect(wide.cardTextW, where).toBeGreaterThan(base.cardTextW);
            // The chrome — total width minus text room — is IDENTICAL at
            // every rung: `2*CARD_PAD_X + CARD_STATE_BAR_W + CARD_BAR_GAP`.
            const baseChrome = base.cardW - base.cardTextW;
            const wideChrome = wide.cardW - wide.cardTextW;
            expect(wideChrome, where).toBeCloseTo(baseChrome, 6);
        }
    });

    it('computePlanLayout at a wider rung produces wider, self-consistent cards', () => {
        const base = computePlanLayout(plan.rows, { stepLabel: 'title' });
        for (let level = 1; level <= STEP_WIDTH_SCALES.length; level += 1) {
            const layout = computePlanLayout(plan.rows,
                { stepLabel: 'title', stepWidthLevel: level });
            const g = cardGeometryFor(STEP_WIDTH_SCALES[level - 1]);
            const where = `level ${level}`;
            // Every column is STILL exactly one (now possibly wider) card
            // plus the fixed gutter — the req #3498 invariant, at whichever
            // rung.
            for (const w of layout.colW) {
                expect(w, where).toBe(g.cardW + CARD_GAP_X);
            }
            // Every node's own w/frameW agrees with the SAME geometry.
            for (const n of layout.nodes.values()) {
                expect(n.w, where).toBe(g.cardW);
                expect(n.frameW, where).toBe(g.cardFrameW);
                expect(n.right - n.left, where).toBeCloseTo(g.cardW, 6);
            }
            if (level === 1) {
                expect(layout.colW).toEqual(base.colW);
            } else {
                expect(layout.colW[0]).toBeGreaterThan(base.colW[0]);
            }
            // `colPitch` (req #3503 review) is the SAME number as `colW`'s own
            // entries, exported as a scalar because a caller wanting "the"
            // pitch — every `stepsAcrossScale`/`columnsAcross` call site that
            // holds a live layout — must not reach for `colW` itself and get
            // an array where a number belongs.
            expect(layout.colPitch, where).toBe(g.cardW + CARD_GAP_X);
        }
    });

    it('the steps-across ladder and the single-step focus both read the SCALED pitch, not the frozen scale-1 one (req #3503 review)', () => {
        // Regression guard: `stepsAcrossScale`/`stepsFocusTransform` used the
        // fixed `CARD_W + CARD_GAP_X` regardless of Step Width, so "5 across"
        // measured 3.27 columns at rung 4 while its own button still claimed
        // 5 — wrong at every rung but the default, which is exactly why a
        // dedicated test outlives the fix (the same lesson the step-link
        // regression test above already states).
        const size = { w: 1730, h: 900 };
        for (let level = 1; level <= STEP_WIDTH_SCALES.length; level += 1) {
            const layout = computePlanLayout(plan.rows,
                { stepLabel: 'title', stepWidthLevel: level });
            const where = `level ${level}`;

            // The ladder: N columns at the SCALED pitch really do span the
            // viewport at the scale the ladder reports.
            const k = stepsAcrossScale(5, size.w, layout.colPitch);
            expect(5 * layout.colPitch * k, where).toBeCloseTo(size.w, 6);
            // The frozen scale-1 pitch would have reported a DIFFERENT scale
            // at every rung but 1 — proving the fix actually changed the
            // number rather than happening to agree with it.
            const kFrozen = stepsAcrossScale(5, size.w, CARD_W + CARD_GAP_X);
            if (level === 1) {
                expect(k, where).toBeCloseTo(kFrozen, 9);
            } else {
                expect(k, where).toBeLessThan(kFrozen);
            }

            // The single-step focus: `stepFocusTransform` must resolve to
            // the SAME scale the ladder reports for `STEP_FOCUS_STEPS_ACROSS`
            // at this rung, not the scale-1 one.
            const stepId = [...layout.nodes.keys()][0];
            const kBase = size.w / layout.width;
            const kFloor = kBase * ZOOM_MIN_RATIO;
            const tr = stepFocusTransform(layout, stepId, size, kBase, kFloor);
            const want = stepsAcrossScale(STEP_FOCUS_STEPS_ACROSS, size.w, layout.colPitch);
            expect(tr, where).toBeTruthy();
            expect(tr.k, where).toBeCloseTo(want, 9);
        }
    });

    it('the step-link button stays flush with the RIGHT edge at every rung (req #3503 review)', () => {
        // Regression guard: the first cut positioned this off `CARD_FRAME_X +
        // CARD_FRAME_W` (fixed, scale-1 constants) instead of the scaled
        // frame the rest of the card actually drew at, so it drifted off the
        // true right edge at any level but 1 — invisible at the default rung,
        // which is exactly why a dedicated test outlives the fix.
        for (let level = 1; level <= STEP_WIDTH_SCALES.length; level += 1) {
            const layout = computePlanLayout(plan.rows,
                { stepLabel: 'title', stepWidthLevel: level });
            for (const row of plan.rows) {
                const n = layout.nodes.get(row.id);
                const [link] = layout.labels.filter(
                    (l) => l.kind === 'step-link' && l.stepId === row.id);
                expect(link.x + link.w, `level ${level} step ${row.id}`)
                    .toBeCloseTo(n.right - CARD_PAD_X - CARD_CHECK_W, 6);
            }
        }
    });

    it('an out-of-range level falls back to the default rung, not a crash', () => {
        const fallback = computePlanLayout(plan.rows, { stepLabel: 'title' });
        for (const bad of [0, 5, -1, NaN, undefined]) {
            const layout = computePlanLayout(plan.rows,
                { stepLabel: 'title', stepWidthLevel: bad });
            expect(layout.colW, `level ${bad}`).toEqual(fallback.colW);
        }
    });
});

describe('readable default scale (req #3168)', () => {
    it('K_READABLE keeps the smallest REQUIRED text at the legibility floor', () => {
        expect(PLAN_VIZ_FONT.req * K_READABLE).toBeCloseTo(READABLE_MIN_PX, 6);
        // The step label is the other thing a reader must resolve, and it is
        // larger — so a scale chosen for the ids covers it.
        expect(PLAN_VIZ_FONT.label).toBeGreaterThan(PLAN_VIZ_FONT.req);
    });

    it('the live-scale plan is the case that needed it: fit-to-width is illegible', () => {
        // The fixture is 34 steps. Fit-to-width across a 1600px panel puts the
        // requirement ids below the floor, which is the defect the requirement
        // names — assert the premise rather than trusting the anecdote.
        const layout = computePlanLayout(plan.rows,
            { reqLayout: 'vertical', stepLabel: 'title' });
        const kFit = 1600 / layout.width;
        expect(PLAN_VIZ_FONT.req * kFit).toBeLessThan(READABLE_MIN_PX);
        expect(Math.max(kFit, K_READABLE)).toBe(K_READABLE);
    });
});

// ── The epic name, pinned to its own band (req #3119 → #3168 → req #3257) ──
// ONE RULE (user directive 2026-08-02): the name is drawn at the TOP-LEFT
// CORNER OF THE INTERSECTION of its band's rectangle with the visible content
// area, carrying the same margin it would have from the band's own top-left
// corner — and it never escapes that rectangle on any edge.
//
// The suite is organised as the requirement states it: the three sweeps that
// hold at every zoom and pan first, then one test per clause, then the two
// obstacles that may still bind (the on-screen key, the band's own epic lane),
// then the guarantee req #3210 used to buy with a special case and this rule
// has to keep on its own.
describe('epic name pinned to its band, clamped to the viewport (req #3257)', () => {
    const layout = computePlanLayout(plan.rows,
        { reqLayout: 'vertical', stepLabel: 'title' });
    const VIEWPORT = { w: 1500, h: 900 };

    // The module's own `CHIP_MARGIN_X` / `CHIP_MARGIN_Y` — private to it, and
    // restated here BECAUSE they are the contract: "the same margin it would
    // have from the band's own top-left corner" is the requirement's own
    // wording, and a silent change to either is a change to the rule.
    const MX = 6;
    const MY = 2;

    const chipsAt = (transform, keepOut = null, overrides = {}) => placeEpicChips({
        bands: layout.bands, transform, viewport: VIEWPORT,
        worldWidth: layout.width, keepOut, ...overrides,
    });

    // THE BAND'S RECTANGLE, in screen px — the same rect the canvas draws
    // (`x={2}`, `width={layout.width - 4}` in PipelinePlanVisualizer's band
    // Rects). Everything below is asserted against THIS, because "inside its
    // own rectangle" is the whole requirement.
    const bandRect = (band, t, worldWidth = layout.width) => ({
        x: t.x + 2 * t.k,
        y: t.y + band.y * t.k,
        w: (worldWidth - 4) * t.k,
        h: band.height * t.k,
    });
    const contentArea = (topInset = 0) => ({
        x: 0, y: topInset, w: VIEWPORT.w, h: VIEWPORT.h - topInset,
    });
    const contains = (outer, inner, eps = 0.01) =>
        inner.x >= outer.x - eps && inner.y >= outer.y - eps
        && inner.x + inner.w <= outer.x + outer.w + eps
        && inner.y + inner.h <= outer.y + outer.h + eps;

    // The chip's own measured box, from the module's PUBLISHED constants. Used
    // to say what "there was room for a name" means without guessing — and it
    // doubles as a check that the exported metrics really are the ones the
    // placement reads.
    //
    // req #3272 — there is NO "too little lane" answer any more. The floor is on
    // the FONT and the box is derived from it, so the chip shrinks into its lane
    // and then STOPS at `EPIC_CHIP_MIN_H`; a lane shorter than that gets the
    // chip drawn over it rather than no chip at all.
    const chipMetrics = (band, k) => {
        const laneH = (band.epicLaneH ?? band.headerH) * k;
        const h = Math.max(EPIC_CHIP_MIN_H, Math.min(EPIC_CHIP_H, laneH - 2 * MY));
        const scale = h / EPIC_CHIP_H;
        const text = band.epicLabel || band.epic;
        const w = text.length * EPIC_CHIP_CHAR_W * scale + EPIC_CHIP_PAD_W * scale
            + (band.epicId != null ? EPIC_CHIP_OPEN_LINK_W + EPIC_CHIP_CARDS_LINK_W : 0)
            + EPIC_PAUSE_BUBBLE_W;
        return { w, h };
    };

    // WHETHER THE BAND CAN STILL HOLD ITS OWN NAME at this zoom (req #3272).
    // Above this line every #3257 clause is untouched and the chip is contained
    // in its rectangle on both axes; below it the floored chip is taller than
    // the band is on screen, and the name deliberately overflows DOWNWARD. The
    // predicate is the same one the module's `max(top + MY, …)` turns on.
    const bandHoldsChip = (band, k) =>
        chipMetrics(band, k).h + 2 * MY <= band.height * k + 0.01;
    // Horizontal containment is unconditional at every zoom — the whole of
    // #3257 is that a name never moves sideways out of its own rectangle, and
    // req #3272 changed nothing on that axis.
    const containsX = (outer, inner, eps = 0.01) =>
        inner.x >= outer.x - eps && inner.x + inner.w <= outer.x + outer.w + eps;

    // A SWEEP IN BOTH AXES: every zoom the panel can reach, crossed with pans
    // that actually traverse the plan at that zoom rather than a fixed handful
    // of offsets that stop being interesting once k changes.
    const SWEEP_K = [0.05, 0.1, 0.2, 0.39, 0.55, 0.8, 1, 1.4, 2, 2.5];
    const sweep = function* () {
        for (const k of SWEEP_K) {
            const spanY = layout.height * k + VIEWPORT.h;
            const spanX = layout.width * k + VIEWPORT.w;
            for (let i = 0; i <= 6; i++) {
                for (let j = 0; j <= 4; j++) {
                    yield {
                        x: VIEWPORT.w - (spanX * j) / 4,
                        y: VIEWPORT.h - (spanY * i) / 6,
                        k,
                    };
                }
            }
        }
    };

    it('draws one chip per band at the default view, each naming its own band', () => {
        const chips = chipsAt({ x: 0, y: 0, k: K_READABLE });
        expect(chips.length).toBeGreaterThan(0);
        expect(new Set(chips.map((c) => c.key)).size).toBe(chips.length);
        for (const c of chips) {
            expect(layout.bands.some((b) => b.epic === c.text)).toBe(true);
        }
    });

    // ── (a) CONTAINED IN ITS OWN RECTANGLE — the requirement's core claim,
    // RE-STATED PER AXIS by req #3272. Horizontally it is unconditional and
    // always was. Vertically it now holds exactly while the band can still hold
    // the floored chip; below that the name overflows DOWNWARD, deliberately,
    // and the one thing that never happens is a name starting ABOVE its own
    // band's top — that is the position a reader attributes to the band before
    // it, which is worse than either symptom #3272 fixes.
    it('every chip is inside its own band\'s rectangle, at every zoom and pan — '
        + 'on both axes while the band can hold it, on the x axis always', () => {
        let drawn = 0;
        let overflowed = 0;
        for (const t of sweep()) {
            for (const chip of chipsAt(t)) {
                drawn++;
                const r = bandRect(chip.band, t);
                expect(containsX(r, chip),
                    `"${chip.text}" escaped its own rectangle SIDEWAYS at `
                    + `k=${t.k} x=${t.x.toFixed(0)} y=${t.y.toFixed(0)}`)
                    .toBe(true);
                // NEVER ABOVE ITS OWN BAND'S TOP — at any zoom, floored or not.
                expect(chip.y, `"${chip.text}" started above its own band at `
                    + `k=${t.k} y=${t.y.toFixed(0)}`)
                    .toBeGreaterThanOrEqual(r.y - 0.01);
                if (bandHoldsChip(chip.band, t.k)) {
                    expect(contains(r, chip),
                        `"${chip.text}" escaped its own rectangle at `
                        + `k=${t.k} x=${t.x.toFixed(0)} y=${t.y.toFixed(0)} — `
                        + 'and the band had room for it')
                        .toBe(true);
                } else if (chip.y + chip.h > r.y + r.h + 0.01) {
                    overflowed++;
                }
            }
        }
        // A rule that drew nothing would pass the loop above.
        expect(drawn).toBeGreaterThan(200);
        // The floored regime was REACHED — without this the per-axis split
        // above is a distinction the sweep never exercises. It is the fixture's
        // shortest band (197 world px, so the floored chip exceeds it below
        // k≈0.1) carrying the fixture's LONGEST name (37 chars, 297px wide at
        // the floor). Note the second half of that: until the band's own right
        // edge became a CLIP rather than a DROP, this name was refused
        // horizontally at exactly those zooms and the branch was unreachable
        // here — the two halves of req #3272 are one behaviour, and the vertical
        // half is only observable because the horizontal one stopped hiding it.
        expect(overflowed,
            'no chip ever overflowed its band, so the floor was never binding')
            .toBeGreaterThan(0);
    });

    // ── (a) CONTAINED IN THE VISIBLE CONTENT AREA — and the exact, named
    // exceptions, which are clauses 3 and 4 themselves: a name leaves WITH its
    // rectangle, so for the last chip's-worth of that rectangle's life its box
    // legitimately hangs over the panel edge and the overlay's `overflow:
    // hidden` cuts it off. Asserted as an IMPLICATION rather than waived —
    // every excursion has to be explained by its own band being that close to
    // gone on that side.
    it('every chip is inside the visible content area on the ENTERING sides, '
        + 'and leaves it only where its own rectangle is pushing it off', () => {
        // Transforms that put a band ON ITS WAY OUT over the top / the left, so
        // the two permitted excursions are actually exercised rather than
        // permitted in the abstract (a sweep alone never reaches them: the
        // window is a chip's width or height wide).
        const LEAVING = [];
        for (const band of layout.bands) {
            for (const k of [0.5, 1, 2]) {
                for (const d of [2, 8, 16, 26, 40]) {
                    // the band's BOTTOM edge d px below the content area's top
                    LEAVING.push({ x: 0, y: d - (band.y + band.height) * k, k });
                    // the band's RIGHT edge d px right of the content area's left
                    LEAVING.push({ x: d - (layout.width - 2) * k, y: 0, k });
                }
            }
        }
        let offTop = 0;
        let offLeft = 0;
        for (const t of [...sweep(), ...LEAVING]) {
            for (const chip of chipsAt(t)) {
                const r = bandRect(chip.band, t);
                const [left, right] = [r.x, r.x + r.w];
                const [top, bottom] = [r.y, r.y + r.h];
                // THE ENTERING SIDES ARE HARD CONTAINMENT. A band arriving from
                // the bottom or the right is not being pushed anywhere, so a box
                // past those edges is one the reader simply cannot see.
                expect(chip.x + chip.w, `"${chip.text}" hangs off the RIGHT at `
                    + `k=${t.k} x=${t.x.toFixed(0)} — nothing is pushing it there`)
                    .toBeLessThanOrEqual(VIEWPORT.w + 0.01);
                expect(chip.y + chip.h, `"${chip.text}" hangs off the BOTTOM at `
                    + `k=${t.k} y=${t.y.toFixed(0)} — nothing is pushing it there`)
                    .toBeLessThanOrEqual(VIEWPORT.h + 0.01);
                // THE LEAVING SIDES may overhang, but only where the band's own
                // far edge is within a chip of the content area's near edge —
                // clauses 3 and 4 themselves, asserted as an implication rather
                // than waived.
                if (chip.x < -0.01) {
                    offLeft++;
                    expect(right, `"${chip.text}" hangs off the LEFT at k=${t.k} `
                        + 'but its rectangle is not leaving that way')
                        .toBeLessThan(chip.w + 2 * MX + 0.01);
                }
                if (chip.y < -0.01) {
                    offTop++;
                    expect(bottom, `"${chip.text}" hangs off the TOP at k=${t.k} `
                        + 'but its rectangle is not leaving that way')
                        .toBeLessThan(chip.h + 2 * MY + 0.01);
                }
            }
        }
        // Both permitted excursions were REACHED. Without this the two
        // implications above hold vacuously and the test proves nothing.
        expect(offTop, 'no chip was ever pushed off the top').toBeGreaterThan(0);
        expect(offLeft, 'no chip was ever pushed off the left').toBeGreaterThan(0);
    });

    it('stops emitting a name once it is WHOLLY outside the content area — the '
        + 'last frame of the push-off is not drawn at all', () => {
        // The push-off's final margin: `x + w` is `right - MX` and `y + h` is
        // `bottom - MY`, so a rectangle with 1-6px left on screen would emit a
        // box entirely off the panel. Asserted at the boundary from both sides
        // so the guard is a measured edge, not a comfortable one.
        const band = layout.bands[0];
        const k = 1;
        for (const [axis, transformAt, edgeOf] of [
            ['top',
                (d) => ({ x: 0, y: d - (band.y + band.height) * k, k }),
                (chip) => chip.y + chip.h],
            ['left',
                (d) => ({ x: d - (layout.width - 2) * k, y: 0, k }),
                (chip) => chip.x + chip.w],
        ]) {
            let lastDrawn = null;
            for (let d = 40; d >= 1; d -= 1) {
                const chip = chipsAt(transformAt(d)).find((c) => c.band === band);
                if (chip) {
                    expect(edgeOf(chip), `a wholly-invisible chip was emitted on the `
                        + `${axis} at d=${d}`).toBeGreaterThan(0);
                    lastDrawn = d;
                } else if (lastDrawn !== null) {
                    // Once it stops being drawn it never comes back as the band
                    // continues to leave.
                    expect(d).toBeLessThan(lastDrawn);
                }
            }
            expect(lastDrawn, `the ${axis} sweep never drew a chip at all`)
                .not.toBeNull();
        }
    });

    // ── (b) EXACTLY ONE CHIP PER VISIBLE BAND ──────────────────────────────
    // Stated as a biconditional: a band with a name has one, and a band with
    // none fails one of the module's two DOCUMENTED refusals — its rectangle
    // misses the content area, or the rectangle cannot hold a chip at all (too
    // little epic lane for a legible one, or narrower than the name). Anything
    // else silently missing is the defect this requirement exists to fix.
    it('every band whose rectangle can hold a name returns exactly one chip, '
        + 'and every band without one is refused for a stated reason', () => {
        let named = 0;
        for (const t of sweep()) {
            const chips = chipsAt(t);
            expect(new Set(chips.map((c) => c.key)).size).toBe(chips.length);
            for (const band of layout.bands) {
                const r = bandRect(band, t);
                const onScreen = r.x + r.w > 0 && r.x < VIEWPORT.w
                    && r.y + r.h > 0 && r.y < VIEWPORT.h;
                const m = chipMetrics(band, t.k);
                // "ROOM FOR A NAME" is a property of the INTERSECTION, computed
                // here from the rectangle and the panel rather than from the
                // module's own arithmetic — the placement is proved below to
                // draw whenever this holds, on both axes.
                const iw = Math.min(r.x + r.w, VIEWPORT.w) - Math.max(r.x, 0);
                const ih = Math.min(r.y + r.h, VIEWPORT.h) - Math.max(r.y, 0);
                const roomy = onScreen
                    && iw >= m.w + 2 * MX && ih >= m.h + 2 * MY;
                const chip = chips.find((c) => c.band === band);
                if (roomy) {
                    named++;
                    expect(chip, `"${band.epic}" has ${iw.toFixed(0)}×${ih.toFixed(0)}px `
                        + `of rectangle in view — room for its ${m.w.toFixed(0)}×`
                        + `${m.h.toFixed(0)}px name — but was not drawn at k=${t.k} `
                        + `x=${t.x.toFixed(0)} y=${t.y.toFixed(0)}`)
                        .toBeTruthy();
                    expect(chip.w).toBeCloseTo(m.w, 6);
                    expect(chip.h).toBeCloseTo(m.h, 6);
                } else if (chip) {
                    // The converse: nothing is drawn for a band that is not on
                    // screen at all.
                    expect(onScreen, `"${band.epic}" drew a chip while off screen `
                        + `at k=${t.k}`).toBe(true);
                }
            }
        }
        expect(named).toBeGreaterThan(200);
    });

    // ── (c) NO CHIP-ON-CHIP OVERLAP ────────────────────────────────────────
    // Was impossible BY CONSTRUCTION under #3257 alone — bands never overlap in
    // world Y, the chip was sized to its own band's epic lane and clamped inside
    // its own rectangle, so two chips would have had to share a rectangle to
    // touch. **REQ #3272 ENDED THAT PREMISE** by flooring the chip's height, and
    // the guarantee is now carried by an explicit VERTICAL de-collision pass.
    // The same sweeps therefore matter MORE than they did, not less: on the
    // fixture AND on the many-short-bands shape that was the only geometry ever
    // measured colliding (70 hits over k ∈ [0.05, 0.5] under the pre-#3168 rule)
    // — and which, under a floored chip, is the shape the pass exists for.
    const SHORT_BANDS = Array.from({ length: 6 }, (_, i) => ({
        key: i, epicId: i + 1, epic: `Epic number ${i + 1}`, color: '#8ce99a',
        y: 8 + i * 158, height: 150, headerH: 83, epicLaneH: 62,
    }));
    const assertNoChipOverlap = (chips, where) => {
        for (let i = 0; i < chips.length; i++) {
            for (let j = i + 1; j < chips.length; j++) {
                expect(rectsOverlap(chips[i], chips[j]),
                    `epic chips overlap ${where}: ${chips[i].text} vs ${chips[j].text}`)
                    .toBe(false);
            }
        }
    };

    it('never overlaps another chip on the fixture, at any zoom or pan', () => {
        for (const t of sweep()) {
            assertNoChipOverlap(chipsAt(t),
                `at k=${t.k} x=${t.x.toFixed(0)} y=${t.y.toFixed(0)}`);
        }
    });

    it('never overlaps another chip on SHORT bands zoomed out — the one shape '
        + 'chip-on-chip was ever measured on', () => {
        let drawn = 0;
        for (let k = 0.05; k <= 0.5; k += 0.01) {
            for (const y of [0, -200, -600, 300]) {
                const chips = placeEpicChips({
                    bands: SHORT_BANDS, transform: { x: 0, y, k },
                    viewport: VIEWPORT, worldWidth: 3000,
                });
                drawn += chips.length;
                assertNoChipOverlap(chips, `on short bands at k=${k.toFixed(2)} y=${y}`);
                for (const chip of chips) {
                    const r = bandRect(chip.band, { x: 0, y, k }, 3000);
                    // SIDEWAYS containment is unconditional; vertical holds
                    // while the band can hold the floored chip (req #3272).
                    expect(containsX(r, chip),
                        `"${chip.text}" escaped its rectangle SIDEWAYS at `
                        + `k=${k.toFixed(2)}`).toBe(true);
                    expect(chip.y, `"${chip.text}" started above its own band `
                        + `at k=${k.toFixed(2)}`).toBeGreaterThanOrEqual(r.y - 0.01);
                    if (bandHoldsChip(chip.band, k)) {
                        expect(contains(r, chip),
                            `"${chip.text}" escaped its rectangle at `
                            + `k=${k.toFixed(2)} — and the band had room for it`)
                            .toBe(true);
                    }
                }
            }
        }
        // A pass that hid everything would satisfy the loop above. 374 chips are
        // drawn over this sweep; the floor is set well under that so it fails on
        // a collapse rather than on a nudge.
        expect(drawn).toBeGreaterThan(250);
    });

    // ── CLAUSE 1 — band fully in view ──────────────────────────────────────
    it('sits in its OWN rectangle\'s top-left corner when the band is fully in '
        + 'view, so two bands at different x have their names at different x', () => {
        const t = { x: 40, y: 0, k: K_READABLE };
        const left = t.x + 2 * t.k;
        for (const chip of chipsAt(t)) {
            expect(chip.x).toBeCloseTo(left + MX, 6);
            expect(chip.y).toBeCloseTo(t.y + chip.band.y * t.k + MY, 6);
        }
        // Same bands, world shifted right: every name moves WITH its rectangle
        // rather than staying in a shared column at the plan's screen edge.
        const shifted = chipsAt({ ...t, x: t.x + 120 });
        for (const chip of shifted) {
            expect(chip.x).toBeCloseTo(left + 120 + MX, 6);
        }
    });

    // ── CLAUSE 2 — the band's top edge scrolls above the content area ───────
    it('stops at the top of the visible content area and STAYS there while the '
        + 'band does, however deep the pan', () => {
        const band = layout.bands.reduce((a, b) => (b.height > a.height ? b : a));
        // Four screens deep into the tallest band — the case the requirement
        // names ("panned four screens deep into a tall band"). The fixture's
        // tallest band is 641 world px, so k has to carry it past 4 × 900
        // screen px; the assertion below is what makes this the test it claims
        // to be rather than a shallow pan dressed up as a deep one.
        const k = 6;
        expect(band.height * k).toBeGreaterThan(4 * VIEWPORT.h);
        const seen = new Set();
        for (const depth of [10, 200, VIEWPORT.h, 2 * VIEWPORT.h]) {
            const t = { x: 0, y: -(band.y * k) - depth, k };
            const chip = chipsAt(t).find((c) => c.band === band);
            expect(chip, `no name ${depth}px into "${band.epic}"`).toBeTruthy();
            expect(chip.y).toBeCloseTo(MY, 6);
            seen.add(chip.x);
        }
        // It does not drift sideways as the pan deepens either.
        expect(seen.size).toBe(1);
    });

    // THE #3254 HANDSHAKE, asserted rather than assumed. That requirement pins
    // the time ruler to the viewport top and exposes `rulerScreenBottom(t)` as
    // the ONE number this one clamps below; the component passes it as
    // `topInset`. Read from the SAME transform, so the two cannot disagree —
    // and it moves with zoom, which is why a hand-picked offset would be wrong
    // at every zoom but one.
    it('clamps below the PINNED RULER at every zoom, reading req #3254\'s own '
        + 'rulerScreenBottom rather than a guessed offset', () => {
        const band = layout.bands.reduce((a, b) => (b.height > a.height ? b : a));
        // ── THE PAN IS A FRACTION OF THE BAND, NOT 400px (req #3498) ────────
        // A fixed 400 was only ever meaningful against a band tall enough to
        // spare it. Lane RE-USE made the tallest band 675px (it was multiples of
        // that), so 400 scrolls 59% of it off and the chip is then pushed above
        // the ruler BY ITS OWN BAND'S BOTTOM — which is `placeEpicChips`' second
        // clause working exactly as designed ("the name leaves WITH its band"),
        // not the clamp failing. Panning a quarter of the way in keeps the case
        // this test is about — band partly scrolled off, chip parked at the
        // ruler — and cannot go false the next time the packing improves.
        const panIn = band.height * 0.25;
        for (const k of [0.2, 0.5, 1, 2, 4]) {
            const t = { x: 0, y: -(band.y * k) - panIn * k, k };
            const inset = rulerScreenBottom(t);
            // The strip's screen height is `RULER_H · max(k, 1)` since req
            // #3365 gave its vertical axis to SCREEN space: world-scaled at and
            // above k = 1, constant below it. k = 0.2 is in the range the plan
            // actually opens in (0.2077 on plan 7), and it is the case the old
            // `RULER_H · k` got wrong — 7.5px reported for a 36px strip.
            expect(inset).toBeCloseTo(RULER_H * Math.max(k, 1), 6);
            const chip = chipsAt(t, null, { topInset: inset })
                .find((c) => c.band === band);
            expect(chip, `no name below the ruler at k=${k}`).toBeTruthy();
            expect(chip.y, `name slid UNDER the pinned ruler at k=${k}`)
                .toBeGreaterThanOrEqual(inset);
            expect(chip.y).toBeCloseTo(inset + MY, 6);
        }
    });

    it('stops just BELOW pinned header chrome, never underneath it', () => {
        const band = layout.bands.reduce((a, b) => (b.height > a.height ? b : a));
        const k = 6;
        const t = { x: 0, y: -(band.y * k) - 600, k };
        for (const topInset of [0, 48, 120]) {
            const chip = chipsAt(t, null, { topInset }).find((c) => c.band === band);
            expect(chip, `no name below ${topInset}px of chrome`).toBeTruthy();
            expect(chip.y).toBeCloseTo(topInset + MY, 6);
        }
    });

    // ── CLAUSE 3 — the band's bottom edge reaches the clamp line ────────────
    it('is pushed off the top by its OWN rectangle as that rectangle leaves — '
        + 'it does not linger, and it never jumps to another band', () => {
        const band = layout.bands[1];
        const k = 1;
        const topInset = 40;
        const bottomOf = (yPan) => yPan + (band.y + band.height) * k;
        // Walk the band's BOTTOM edge down onto the clamp line.
        let prevY = Infinity;
        let lastSeenBottom = null;
        for (let bottom = topInset + 120; bottom >= topInset - 30; bottom -= 3) {
            const t = { x: 0, y: bottom - (band.y + band.height) * k, k };
            const chip = chipsAt(t, null, { topInset }).find((c) => c.band === band);
            if (bottom > topInset) {
                expect(chip, `no name with ${(bottom - topInset).toFixed(0)}px of `
                    + '"' + band.epic + '" still below the clamp line').toBeTruthy();
            }
            if (!chip) {
                // Gone — and only once its rectangle is gone.
                expect(bottomOf(t.y)).toBeLessThanOrEqual(topInset + 0.01);
                continue;
            }
            lastSeenBottom = bottom;
            // Monotone: it only ever moves UP as the band does, never back down
            // and never stalls at the clamp while the band slides past it.
            expect(chip.y).toBeLessThanOrEqual(prevY + 0.01);
            prevY = chip.y;
            // Still inside its own rectangle, never another band's.
            expect(contains(bandRect(band, t), chip)).toBe(true);
            expect(chip.y + chip.h).toBeLessThanOrEqual(bottomOf(t.y) + 0.01);
        }
        // It genuinely left the screen rather than the loop running out.
        expect(lastSeenBottom).not.toBeNull();
        expect(prevY).toBeLessThan(topInset);
    });

    // ── CLAUSE 4 — the band's left edge scrolls off the left ────────────────
    it('stays just inside the content area\'s left edge with the same margin, '
        + 'and never leaves the rectangle on the right', () => {
        const k = 1;
        for (const x of [-50, -400, -2000]) {
            const t = { x, y: 0, k };
            const chips = chipsAt(t);
            expect(chips.length).toBeGreaterThan(0);
            for (const chip of chips) {
                expect(chip.x, `left-clamped name at x=${x}`).toBeCloseTo(MX, 6);
            }
        }
        // Symmetrically: pan so the band's RIGHT edge is 120px from the content
        // area's left — less than any name is wide — and every name is pushed
        // off the left WITH the rectangle instead of staying at the margin.
        const nearlyGone = { x: -(layout.width * k) + 122, y: 0, k };
        const leaving = chipsAt(nearlyGone);
        expect(leaving.length).toBeGreaterThan(0);
        let pushedOff = 0;
        for (const chip of leaving) {
            const r = bandRect(chip.band, nearlyGone);
            expect(chip.x + chip.w).toBeLessThanOrEqual(r.x + r.w - MX + 0.01);
            expect(contains(r, chip)).toBe(true);
            if (chip.x < 0) pushedOff++;
        }
        expect(pushedOff, 'no name was actually pushed off the left edge')
            .toBe(leaving.length);
    });

    // ── THE ONE OBSTACLE THAT MAY STILL BIND ───────────────────────────────
    // The on-screen key. Resolved by CLIPPING or DROPPING, never by sliding the
    // name out of its own rectangle — which is the defect req #3257 names.
    it('clips or drops against the key, and NEVER displaces sideways to dodge it', () => {
        for (const legendW of [220, 420, 700]) {
            // The key's REAL geometry since req #3255 — bottom-center, the
            // same formula PipelinePlanVisualizer.jsx computes. A suite that
            // kept the old top-right shape would assert against a keep-out
            // production no longer produces.
            const keepOut = { x: (VIEWPORT.w - legendW) / 2,
                y: VIEWPORT.h - 12 - 30, w: legendW, h: 30 };
            for (const t of sweep()) {
                const bare = new Map(chipsAt(t).map((c) => [c.key, c]));
                for (const chip of chipsAt(t, keepOut)) {
                    expect(rectsOverlap(chip, keepOut),
                        `"${chip.text}" under the key at k=${t.k}`).toBe(false);
                    // Same x as it would have had with no key at all: the key
                    // takes width off the chip, it never moves it.
                    const unobstructed = bare.get(chip.key);
                    expect(unobstructed).toBeTruthy();
                    expect(chip.x).toBeCloseTo(unobstructed.x, 6);
                    expect(chip.y).toBeCloseTo(unobstructed.y, 6);
                    expect(chip.w).toBeLessThanOrEqual(unobstructed.w + 0.01);
                    // A narrower chip is always a CLIPPED one. (The converse is
                    // not asserted: `unobstructed` can itself already be clipped
                    // by the panel edge, in which case the key changes nothing.)
                    if (chip.w < unobstructed.w - 1e-9) expect(chip.clipped).toBe(true);
                    if (chip.clipped) {
                        // The floor is stated in CHARACTERS OF THE NAME, and in
                        // the same scaled units the chip's own width is measured
                        // in: a box clipped to its padding and the pause dot
                        // would show the dot and none of the name.
                        const scale = chip.h / EPIC_CHIP_H;
                        expect(chip.w).toBeGreaterThanOrEqual(
                            EPIC_CHIP_PAD_W * scale + EPIC_PAUSE_BUBBLE_W
                            + EPIC_CHIP_MIN_CHARS * EPIC_CHIP_CHAR_W * scale - 1e-9);
                    }
                    // The clip never moves a name out of its rectangle
                    // SIDEWAYS — the axis the key acts on, and the whole of
                    // #3257's claim here. Vertical containment is req #3272's
                    // conditional one and is asserted in (a).
                    expect(containsX(bandRect(chip.band, t), chip)).toBe(true);
                }
            }
        }
    });

    it('drops rather than draws an unreadable sliver when the key leaves too '
        + 'little room', () => {
        // A key spanning nearly the whole panel and TALL ENOUGH TO REACH EVERY
        // BAND'S CHIP ROW — the height matters, or the test asserts a refusal
        // against chips that were never candidates for it.
        const keepOut = { x: 4, y: 0, w: VIEWPORT.w - 8, h: VIEWPORT.h };
        const t = { x: 0, y: 0, k: 1 };
        const bare = chipsAt(t);
        expect(bare.length).toBeGreaterThan(0);
        const withKey = chipsAt(t, keepOut);
        // WITNESS THE DROP. Without this the loop below asserts nothing: it
        // would pass just as well on a chip the key never touched.
        expect(withKey.length,
            'the key left no honest room, so every name must be dropped')
            .toBe(0);
        for (const chip of withKey) {
            expect(rectsOverlap(chip, keepOut)).toBe(false);
        }
    });

    // ── THE BAND'S OWN EPIC LANE ───────────────────────────────────────────
    // The per-band SCALE SHRINK survives #3257 unchanged and is BOUNDED by
    // req #3272: the chip is sized to the reserved strip above lane 0 so it
    // never rides in the top steps' lane — until the lane is shorter than the
    // FONT FLOOR's box, at which point it deliberately draws over them rather
    // than being dropped. `EPIC_CHIP_MIN_H` is where the two regimes meet.
    const laneHoldsChip = (band, k) =>
        (band.epicLaneH ?? band.headerH) * k - 2 * MY >= EPIC_CHIP_MIN_H - 0.01;

    it('stays inside its own epic lane while the lane can hold the floored chip, '
        + 'scaling down to the floor and no further', () => {
        let inLane = 0;
        let overLane = 0;
        for (const t of sweep()) {
            for (const chip of chipsAt(t)) {
                const band = chip.band;
                const top = t.y + band.y * t.k;
                if (top < 0) continue;   // clamped — clause 2, tested above
                const laneBottom = t.y + (band.y + band.epicLaneH) * t.k;
                expect(chip.y, `${chip.text} above its lane at k=${t.k}`)
                    .toBeGreaterThanOrEqual(top - 0.01);
                if (laneHoldsChip(band, t.k)) {
                    inLane++;
                    expect(chip.y + chip.h, `${chip.text} past its lane at k=${t.k}`)
                        .toBeLessThanOrEqual(laneBottom + 0.01);
                } else {
                    overLane++;
                    // The reversal, stated positively: below the floor the chip
                    // is DRAWN — at the floor's own size — instead of dropped.
                    expect(chip.h).toBeCloseTo(EPIC_CHIP_MIN_H, 6);
                }
                // Scaled, never clipped: the drawn font matches the measured box.
                expect(chip.fontSize / chip.h)
                    .toBeCloseTo(EPIC_CHIP_FONT / EPIC_CHIP_H, 6);
            }
        }
        // BOTH regimes were reached, or the split above proves nothing.
        expect(inLane, 'no chip ever fitted its lane').toBeGreaterThan(100);
        expect(overLane, 'no chip was ever held up by the font floor')
            .toBeGreaterThan(0);
    });

    it('never touches a step, requirement or title label while its lane can '
        + 'hold it — the lane is what buys that', () => {
        const content = layout.labels.filter((l) => l.stepId != null);
        let checked = 0;
        for (const k of [0.2, 0.3, 0.39, 0.5, 0.8, 1, 1.5, 2.5]) {
            for (const y of [0, -120, -600, -1400]) {
                const t = { x: 0, y, k };
                for (const chip of chipsAt(t)) {
                    if (t.y + chip.band.y * k < 0) continue;  // clamped, see below
                    if (!laneHoldsChip(chip.band, k)) continue;   // req #3272
                    checked++;
                    for (const l of content) {
                        const screen = { x: l.x * k, y: y + l.y * k, w: l.w * k, h: l.h * k };
                        expect(rectsOverlap(chip, screen),
                            `epic "${chip.text}" collides with ${l.kind} label of `
                            + `step ${l.stepId} at k=${k} y=${y}`).toBe(false);
                    }
                }
            }
        }
        expect(checked, 'the lane-clearance sweep checked real chips')
            .toBeGreaterThan(20);
    });

    // THE OTHER HALF OF THAT, ASSERTED SO IT READS AS THE DECISION IT IS
    // (req #3272). Below the font floor the name DOES cross the first row of
    // step labels, and it is drawn anyway — on the chip's 60%-opaque panel, by
    // the same rule #3257 already applied to beads, arcs and step labels. A
    // name present and slightly overlapping beats a name absent, which is the
    // user's whole point; the old behaviour here was to draw NOTHING.
    it('DRAWS OVER the first row of step labels below the font floor, rather '
        + 'than dropping the name — the reversal req #3272 asked for', () => {
        const content = layout.labels.filter((l) => l.stepId != null);
        let drawnOverLabels = 0;
        let namedBelowTheFloor = 0;
        for (const k of [0.12, 0.15, 0.2, 0.25]) {
            const t = { x: 0, y: 0, k };
            for (const chip of chipsAt(t)) {
                if (laneHoldsChip(chip.band, k)) continue;
                namedBelowTheFloor++;
                for (const l of content) {
                    const screen = { x: l.x * k, y: l.y * k, w: l.w * k, h: l.h * k };
                    if (rectsOverlap(chip, screen)) { drawnOverLabels++; break; }
                }
            }
        }
        expect(namedBelowTheFloor,
            'no band was named at a zoom where its lane cannot hold the chip — '
            + 'which is the pre-#3272 behaviour this requirement removed')
            .toBeGreaterThan(0);
        expect(drawnOverLabels,
            'the overlap the epic lane exists to prevent was never actually '
            + 'paid for, so this test is not witnessing the reversal')
            .toBeGreaterThan(0);
    });

    // ── WHERE THE OVERLAP STARTS, PINNED (req #3374 P5) ─────────────────────
    // The two tests above prove the overlap with lane 0's step labels exists
    // somewhere below the font floor; THIS test does not re-touch that content
    // — it pins the exact `k` the floor itself kicks in at (below which the
    // chip is provably floored and provably escapes its lane; at/above which
    // it is provably neither), so a future change to `EPIC_CHIP_MIN_H`,
    // `CHIP_MARGIN_Y` or the epic lane's own height moves this number rather
    // than silently invalidating it. The two combine: this is WHERE, the
    // tests above are THAT. DERIVED, not chosen — the same discipline
    // `NEXT_MARK_FLOOR_K` follows a few hundred lines below.
    it('pins the exact k where the floored chip starts escaping its own epic '
        + 'lane (0.2 since req #3365) — the boundary the sibling tests prove overlaps content',
        () => {
            const epicLaneH = layout.bands[0].epicLaneH ?? layout.bands[0].headerH;
            const kBoundary = (EPIC_CHIP_MIN_H + 2 * MY) / epicLaneH;
            // MEASURED 2026-08-10: 21.6 / 62 = 0.34838709...
            // MOVED BY req #3365, which is this test working as designed — its
            // own comment above promises a change to the lane's height "moves
            // this number rather than silently invalidating it". The lane went
            // 62 -> 108 world px (BAND_HEADER 83 -> 129) because the old
            // boundary sat ABOVE the scale the live plan lands in (k = 0.2077),
            // so the epic name was drawn over lane 0's step labels in the
            // DEFAULT view rather than only at an extreme zoom-out — reported
            // by the user as "it needs to have a separate swim lane so it
            // doesn't overlap steps/requirements".
            // 21.6 / 108 = 0.2 exactly, which is `EPIC_LANE_CLEAR_K`.
            expect(kBoundary).toBeCloseTo(EPIC_LANE_CLEAR_K, 6);
            for (const band of layout.bands) {
                expect(band.epicLaneH ?? band.headerH, `band ${band.key}'s own lane`)
                    .toBe(epicLaneH);
            }

            // BELOW the boundary: `laneHoldsChip` says the lane cannot hold the
            // floored chip, on EVERY band alike, and the real `placeEpicChips`
            // output confirms it — the floor from req #3272 has already kicked
            // in ('never touches ... while its lane can hold it' above is what
            // ties that floor to the actual overlap with lane 0's content).
            const below = kBoundary - 0.005;
            for (const band of layout.bands) expect(laneHoldsChip(band, below)).toBe(false);
            const chipBelow = chipsAt({ x: 0, y: 0, k: below })
                .find((c) => c.band === layout.bands[0]);
            expect(chipBelow, `no chip for the boundary band at k=${below}`).toBeTruthy();
            expect(chipBelow.h).toBeCloseTo(EPIC_CHIP_MIN_H, 6);

            // AT OR ABOVE the boundary: every band's lane holds its own
            // (unfloored) chip, and the real chip stays inside it — the
            // guarantee 'stays inside its own epic lane ...' above proves for
            // every `laneHoldsChip` band, pinned here at the closest point to
            // the boundary the guarantee is exercised at.
            const above = kBoundary + 0.005;
            for (const band of layout.bands) expect(laneHoldsChip(band, above)).toBe(true);
            const chipAbove = chipsAt({ x: 0, y: 0, k: above })
                .find((c) => c.band === layout.bands[0]);
            expect(chipAbove, `no chip for the boundary band at k=${above}`).toBeTruthy();
            const laneBottomAbove = layout.bands[0].y * above + epicLaneH * above;
            expect(chipAbove.y + chipAbove.h).toBeLessThanOrEqual(laneBottomAbove + 0.01);
        });

    // The DELIBERATE consequence of the rule, stated so it reads as a decision
    // rather than as an oversight: once the band's top has scrolled past, the
    // clamped name sits over that band's own content and DRAWS OVER IT on its
    // 60%-opaque panel. The requirement says so in as many words — the
    // alternative is the name wandering out of its rectangle, or vanishing.
    it('draws OVER its own band\'s content once clamped, rather than moving out '
        + 'of its rectangle to avoid it', () => {
        const band = layout.bands.reduce((a, b) => (b.height > a.height ? b : a));
        const k = 1;
        const t = { x: 0, y: -(band.y * k) - 400, k };
        const chip = chipsAt(t).find((c) => c.band === band);
        expect(chip).toBeTruthy();
        expect(chip.x).toBeCloseTo(t.x + 2 * k + MX, 6);
        expect(chip.y).toBeCloseTo(MY, 6);
    });

    // ── REQ #3210'S GUARANTEE, RE-VERIFIED ─────────────────────────────────
    // Its neighbour-only sticky pass is gone, subsumed by clause 2 applying to
    // every band. What it bought — a reader who has focused one epic can still
    // see its neighbours in the stack — has to still hold under the new rule,
    // and is checked here against the REAL production trigger
    // (`epicFocusTransform`, req #3204), swept over every band.
    it('a focused band\'s neighbours are still named, under the real focus '
        + 'transform, for every band in the stack', () => {
        const kFit = VIEWPORT.w / layout.width;
        const kDefault = Math.max(kFit, K_READABLE);
        expect(layout.bands.length).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < layout.bands.length; i++) {
            const band = layout.bands[i];
            const t = epicFocusTransform(layout, band, VIEWPORT, kDefault, kDefault * FOCUS_MIN_RATIO);
            expect(t, `band ${i} ("${band.epic}") produced no focus transform`)
                .toBeTruthy();
            const chips = chipsAt(t);
            expect(chips.some((c) => c.band === band),
                `focused band ${i} ("${band.epic}") drew no name for itself`).toBe(true);
            for (const j of [i - 1, i + 1]) {
                if (j < 0 || j >= layout.bands.length) continue;
                const neighbour = layout.bands[j];
                expect(chips.some((c) => c.band === neighbour),
                    `focusing band ${i} ("${band.epic}") left its neighbour `
                    + `"${neighbour.epic}" unnamed`).toBe(true);
            }
        }
    });

    // ── The metrics the requirement froze ──────────────────────────────────
    it('leaves the epic label font and its width metric exactly as they were', () => {
        expect(EPIC_CHIP_FONT).toBe(15);
        expect(EPIC_CHIP_CHAR_W).toBeCloseTo(9.15, 6);   // CHW_EPIC, font 15
        expect(EPIC_CHIP_H).toBe(24);
    });

    it('measures the chip with the layout module\'s own published metrics', () => {
        const [chip] = placeEpicChips({
            bands: [{ key: 1, epicId: 1, epic: 'X'.repeat(20), color: '#fff',
                y: 8, height: 400, headerH: 46 }],
            transform: { x: 0, y: 0, k: 1 }, viewport: VIEWPORT, worldWidth: 3000,
        });
        // The ↗ control's flat footprint is now reserved on EVERY chip (req
        // #3257), not only the sticky ones #3210 added it for: the measured box
        // is what keeps the name inside its own rectangle and clear of the key,
        // so 24 unmeasured px is 24 px that hangs past the edge it was clamped to.
        expect(chip.w).toBeCloseTo(
            20 * EPIC_CHIP_CHAR_W + EPIC_CHIP_PAD_W
            + EPIC_CHIP_OPEN_LINK_W + EPIC_CHIP_CARDS_LINK_W + EPIC_PAUSE_BUBBLE_W, 6);
        expect(chip.clipped).toBe(false);
    });

    it('omits the ↗ reservation on the "No epic" band, which has no ↗ to draw', () => {
        const [chip] = placeEpicChips({
            bands: [{ key: null, epicId: null, epic: 'X'.repeat(20), color: '#fff',
                y: 8, height: 400, headerH: 46 }],
            transform: { x: 0, y: 0, k: 1 }, viewport: VIEWPORT, worldWidth: 3000,
        });
        expect(chip.key).toBe('none');
        expect(chip.w).toBeCloseTo(
            20 * EPIC_CHIP_CHAR_W + EPIC_CHIP_PAD_W + EPIC_PAUSE_BUBBLE_W, 6);
    });

    // ── LEAVING SLIDES OFF; ENTERING WAITS (or is clipped) ─────────────────
    it('withholds a name from a band ENTERING from the bottom until it fits, '
        + 'rather than emitting a box below the panel', () => {
        const band = layout.bands[0];
        const k = 1;
        // Walk the band's TOP edge up from below the panel. `h` comes from the
        // lane, so read it off a chip rather than assuming EPIC_CHIP_H.
        const settled = chipsAt({ x: 0, y: -(band.y * k), k })
            .find((c) => c.band === band);
        const h = settled.h;
        let firstSeen = null;
        for (let top = VIEWPORT.h; top >= VIEWPORT.h - 60; top -= 1) {
            const t = { x: 0, y: top - band.y * k, k };
            const chip = chipsAt(t).find((c) => c.band === band);
            if (!chip) continue;
            // Whenever it IS drawn, it is wholly on screen.
            expect(chip.y + chip.h).toBeLessThanOrEqual(VIEWPORT.h + 0.01);
            if (firstSeen === null) firstSeen = top;
        }
        // It appears exactly when its own box fits below the band's top edge,
        // not a pixel earlier and not late.
        expect(firstSeen).toBeCloseTo(VIEWPORT.h - MY - h, 0);
    });

    it('CLIPS the name of a band ENTERING from the right rather than dropping '
        + 'it — width is clippable, height is not', () => {
        const k = 1;
        // The band's LEFT edge 140px from the panel's right edge: less than any
        // name on this fixture is wide, comfortably more than the floor.
        const t = { x: (VIEWPORT.w - 140) - 2 * k, y: 0, k };
        const chips = chipsAt(t);
        expect(chips.length).toBeGreaterThan(0);
        for (const chip of chips) {
            expect(chip.clipped, `"${chip.text}" was not clipped at the panel edge`)
                .toBe(true);
            expect(chip.x + chip.w).toBeLessThanOrEqual(VIEWPORT.w + 0.01);
            expect(chip.x).toBeCloseTo(VIEWPORT.w - 140 + MX, 6);
        }
    });

    it('renders nothing for a band panned off either axis', () => {
        expect(chipsAt({ x: 0, y: -100000, k: 1 })).toEqual([]);
        expect(chipsAt({ x: 100000, y: 0, k: 1 })).toEqual([]);
        expect(chipsAt({ x: -100000, y: 0, k: 1 })).toEqual([]);
    });

    it('is inert on a degenerate transform, an unmeasured panel or world, or '
        + 'chrome taller than the panel', () => {
        expect(placeEpicChips({ bands: layout.bands, transform: { x: 0, y: 0, k: 0 },
            viewport: VIEWPORT, worldWidth: layout.width })).toEqual([]);
        expect(placeEpicChips({ bands: layout.bands, transform: { x: 0, y: 0, k: 1 },
            viewport: { w: 0, h: 0 }, worldWidth: layout.width })).toEqual([]);
        // No `worldWidth` means no right edge: every comparison against NaN is
        // false, so without this guard the function emitted chips at `x: NaN`
        // and the renderer turned them into `left: NaN`.
        expect(placeEpicChips({ bands: layout.bands, transform: { x: 0, y: 0, k: 1 },
            viewport: VIEWPORT })).toEqual([]);
        expect(chipsAt({ x: 0, y: 0, k: 1 }, null, { topInset: VIEWPORT.h + 10 }))
            .toEqual([]);
        // A nonsense inset is bounded, not honoured.
        expect(chipsAt({ x: 0, y: 0, k: 1 }, null, { topInset: -500 }).length)
            .toBe(chipsAt({ x: 0, y: 0, k: 1 }).length);
        expect(placeEpicChips()).toEqual([]);
    });
});

// ── THE LEGIBILITY FLOOR IS ON THE FONT (req #3272) ─────────────────────────
// The two symptoms this replaces were two branches of the SAME four lines, and
// both were deliberate: a floor on the BOX (`EPIC_CHIP_MIN_H = 11`) yielding a
// 6.9px font at the floor, and a `continue` one line above it that dropped the
// name outright when the lane could not hold an 11px box. A screenshot of
// production on 2026-08-02 shows the whole plan with NO epic labels at all.
//
// The floor is now on the FONT and the box is DERIVED from it. This block
// asserts the four things the requirement asked for and the two it forbade.
describe('the epic name holds a legible minimum font (req #3272)', () => {
    const layout = computePlanLayout(plan.rows,
        { reqLayout: 'vertical', stepLabel: 'title' });
    const VIEWPORT = { w: 1500, h: 900 };
    const MX = 6;
    const MY = 2;

    const chipsAt = (transform, overrides = {}) => placeEpicChips({
        bands: layout.bands, transform, viewport: VIEWPORT,
        worldWidth: layout.width, ...overrides,
    });

    // THE ZOOM RANGE THE READER CAN ACTUALLY REACH, computed exactly as
    // PipelinePlanVisualizer computes it (`kZoomFloor`, `kDefault`) rather than
    // guessed — "zoomed fully out" is a real number on this surface and the
    // acceptance criterion is stated at it.
    const kFit = VIEWPORT.w / layout.width;
    const kDefault = Math.max(kFit, K_READABLE);
    const kZoomFloor = Math.min(kFit, kDefault) * ZOOM_MIN_RATIO;
    const kCeiling = kDefault * ZOOM_MAX_RATIO;

    // The many-short-bands shape — the ONLY geometry that reaches the regime the
    // floor creates (a chip taller than its band on screen). The fixture cannot:
    // its shortest band is 197 world px and carries its longest name, so #3257's
    // horizontal refusal drops that chip before the floor can overflow it.
    const SHORT_BANDS = Array.from({ length: 8 }, (_, i) => ({
        key: i, epicId: i + 1, epic: `Epic ${i + 1}`, color: '#8ce99a',
        y: 8 + i * 158, height: 150, headerH: 83, epicLaneH: 62,
    }));
    const shortChipsAt = (transform, overrides = {}) => placeEpicChips({
        bands: SHORT_BANDS, transform, viewport: VIEWPORT, worldWidth: 3000,
        ...overrides,
    });

    // ── THE FLOOR ITSELF ───────────────────────────────────────────────────
    it('states the floor on the FONT and DERIVES the box from it — the inverse '
        + 'of the pre-#3272 constants', () => {
        expect(EPIC_CHIP_MIN_FONT).toBe(11);
        // 17.6px. A CONSEQUENCE of the font floor at the chip's own 24/15
        // ratio, not a number anybody picked — that inversion IS the fix.
        expect(EPIC_CHIP_MIN_H)
            .toBeCloseTo(EPIC_CHIP_H * (EPIC_CHIP_MIN_FONT / EPIC_CHIP_FONT), 9);
        expect(EPIC_CHIP_MIN_H).toBeCloseTo(17.6, 6);
        // The number the OLD floor produced, pinned so the improvement is a
        // measurement rather than a claim: a box floored at 11px drew the name
        // at 15 × 11/24 ≈ 6.875px.
        expect(EPIC_CHIP_FONT * (11 / EPIC_CHIP_H)).toBeCloseTo(6.875, 3);
        // …and it is the same 11px `READABLE_MIN_PX` already uses for the
        // plan's smallest REQUIRED text, so the surface has one legibility
        // floor and not two.
        expect(EPIC_CHIP_MIN_FONT).toBe(READABLE_MIN_PX);
    });

    it('never renders a name below the font floor, at any zoom or pan, on '
        + 'either geometry', () => {
        let drawn = 0;
        let atTheFloor = 0;
        for (let k = 0.02; k <= kCeiling; k *= 1.15) {
            const spanY = layout.height * k + VIEWPORT.h;
            const spanX = layout.width * k + VIEWPORT.w;
            for (let i = 0; i <= 4; i++) {
                for (let j = 0; j <= 3; j++) {
                    const t = { x: VIEWPORT.w - (spanX * j) / 3,
                        y: VIEWPORT.h - (spanY * i) / 4, k };
                    for (const chip of [...chipsAt(t), ...shortChipsAt(t)]) {
                        drawn++;
                        expect(chip.fontSize,
                            `"${chip.text}" rendered at ${chip.fontSize.toFixed(2)}px `
                            + `at k=${k.toFixed(3)}`)
                            .toBeGreaterThanOrEqual(EPIC_CHIP_MIN_FONT - 1e-9);
                        expect(chip.h).toBeGreaterThanOrEqual(EPIC_CHIP_MIN_H - 1e-9);
                        // The box and the font are ONE decision — the renderer
                        // draws at `fontSize` inside `h`, so a pair that drifted
                        // would be a clamp decided against a box that is not on
                        // screen.
                        expect(chip.fontSize / chip.h)
                            .toBeCloseTo(EPIC_CHIP_FONT / EPIC_CHIP_H, 9);
                        if (chip.fontSize <= EPIC_CHIP_MIN_FONT + 1e-9) atTheFloor++;
                    }
                }
            }
        }
        expect(drawn, 'the sweep drew real chips').toBeGreaterThan(300);
        // The floor was REACHED, not merely never crossed — a sweep that only
        // visited zooms where the chip is full size proves nothing.
        expect(atTheFloor, 'no chip was ever held at the floor').toBeGreaterThan(50);
    });

    // ── THE DROP IS GONE ───────────────────────────────────────────────────
    it('names EVERY band whose rectangle is on screen at every zoom the reader '
        + 'can reach down to fully-out — the screenshot this requirement is '
        + 'about had none at all', () => {
        // "Zoomed out" = every zoom at which the whole plan fits the panel, from
        // the behavior's own floor up. The plan is wholly visible there, so
        // "any pixel on screen" is every band, and the criterion is exact.
        const kWhole = Math.min(kFit, VIEWPORT.h / layout.height);
        expect(kZoomFloor).toBeLessThan(kWhole);
        // ── THE GUARANTEE HOLDS ALL THE WAY DOWN AGAIN (req #3498) ──────────
        // It did not, briefly. The card made this fixture's world ~3x wider
        // while its height barely moved, so fit-to-WIDTH — and with it the zoom
        // floor — fell by the same factor, the whole plan came to 66 SCREEN
        // PIXELS at `kZoomFloor`, and the shortest of four bands could not hold
        // the floored chip (21.6px). `placeEpicChips` named 3 of 4, and this
        // test was re-stated to start one sample above the floor with the gap
        // pinned separately.
        //
        // LANE RE-USE gave it back. Packing branches into free lanes instead of
        // opening a new one for each took the tallest band from 17 lanes to 12,
        // and the plan's height with it, so every band now has room for its name
        // at every zoom the reader can reach — including the floor. The loop
        // starts AT `kZoomFloor` again, which is the stronger claim and the one
        // req #3272 originally made.
        const step = (kWhole - kZoomFloor) / 12;
        let checked = 0;
        for (let k = kZoomFloor; k <= kWhole; k += step) {
            const chips = chipsAt({ x: 0, y: 0, k });
            expect(chips.length,
                `only ${chips.length} of ${layout.bands.length} epic names at `
                + `k=${k.toFixed(3)} — the plan fits the panel here, so every `
                + 'band has pixels on screen')
                .toBe(layout.bands.length);
            expect(new Set(chips.map((c) => c.key)).size).toBe(chips.length);
            for (const band of layout.bands) {
                expect(chips.some((c) => c.band === band),
                    `"${band.epic}" unnamed at k=${k.toFixed(3)}`).toBe(true);
            }
            checked++;
        }
        expect(checked).toBeGreaterThan(10);
    });

    it('names EVERY band at the absolute zoom floor too — the limitation that '
        + 'briefly existed here is GONE (req #3498)', () => {
        // Kept as its own case rather than folded into the sweep above, because
        // the floor is the sample that failed while the card was widest and the
        // packing loosest. If a future change re-opens that gap, this names the
        // exact scale it re-opened at.
        const chips = chipsAt({ x: 0, y: 0, k: kZoomFloor });
        expect(chips.length).toBe(layout.bands.length);
        const shortest = [...layout.bands].sort((a2, b2) => a2.height - b2.height)[0];
        expect(chips.some((c) => c.band === shortest)).toBe(true);
    });

    it('draws the chip a lane can no longer hold instead of dropping it — the '
        + 'reversal, on the geometry that reaches it', () => {
        // Eight 150px bands: below k≈0.144 the floored chip is taller than the
        // band it belongs to, which is exactly where the pre-#3272 code drew
        // nothing at all (its own drop fired at 62·k − 4 < 11, i.e. k < 0.242).
        let namedBelowTheOldDrop = 0;
        let overflowedItsBand = 0;
        for (let k = 0.06; k <= 0.24; k += 0.005) {
            const t = { x: 0, y: 0, k };
            for (const chip of shortChipsAt(t)) {
                namedBelowTheOldDrop++;
                const bandBottom = (chip.band.y + chip.band.height) * k;
                if (chip.y + chip.h > bandBottom + 0.01) overflowedItsBand++;
            }
        }
        expect(namedBelowTheOldDrop,
            'nothing was named below the old drop line, so the drop is still there')
            .toBeGreaterThan(100);
        expect(overflowedItsBand,
            'no chip was ever taller than its own band, so this geometry does '
            + 'not reach the regime the floor creates and proves nothing')
            .toBeGreaterThan(0);
    });

    // ── WHAT THE REVERSAL MAY NOT COST ─────────────────────────────────────
    it('never lets two epic names overlap, at any zoom or pan, on either '
        + 'geometry — the de-collision pass, since the geometry no longer '
        + 'guarantees it', () => {
        const assertClear = (chips, where) => {
            for (let i = 0; i < chips.length; i++) {
                for (let j = i + 1; j < chips.length; j++) {
                    expect(rectsOverlap(chips[i], chips[j]),
                        `"${chips[i].text}" over "${chips[j].text}" ${where}`)
                        .toBe(false);
                }
            }
        };
        let drawn = 0;
        for (let k = 0.05; k <= 2.5; k *= 1.12) {
            for (const y of [0, -80, -300, -900, -1600, 200, 600]) {
                for (const x of [0, -300, 400]) {
                    const t = { x, y, k };
                    const a = chipsAt(t);
                    const b = shortChipsAt(t);
                    drawn += a.length + b.length;
                    assertClear(a, `on the fixture at k=${k.toFixed(3)} y=${y} x=${x}`);
                    assertClear(b, `on short bands at k=${k.toFixed(3)} y=${y} x=${x}`);
                }
            }
        }
        expect(drawn, 'the sweep drew real chips').toBeGreaterThan(1000);
    });

    it('de-collides VERTICALLY ONLY — a pushed name keeps the x it would have '
        + 'had alone, and never rises above its own band', () => {
        // #3257's rule is that a name never moves SIDEWAYS out of its
        // rectangle, and #3272's pass must not become the displacement search
        // that requirement deleted. Compared against each band placed ALONE,
        // where no push can happen by construction.
        let pushed = 0;
        for (let k = 0.06; k <= 0.3; k += 0.01) {
            const t = { x: 0, y: 0, k };
            const together = shortChipsAt(t);
            for (const chip of together) {
                const [alone] = placeEpicChips({
                    bands: [chip.band], transform: t, viewport: VIEWPORT,
                    worldWidth: 3000,
                });
                expect(alone, `"${chip.text}" is only drawable in company`).toBeTruthy();
                expect(chip.x, `"${chip.text}" moved sideways at k=${k.toFixed(2)}`)
                    .toBeCloseTo(alone.x, 6);
                expect(chip.w).toBeCloseTo(alone.w, 6);
                expect(chip.h).toBeCloseTo(alone.h, 6);
                // The push is DOWNWARD only.
                expect(chip.y).toBeGreaterThanOrEqual(alone.y - 1e-9);
                if (chip.y > alone.y + 1e-9) pushed++;
                // …and a name never starts above its own band's top, pushed or
                // not: that position reads as the band BEFORE it.
                expect(chip.y).toBeGreaterThanOrEqual(chip.band.y * k - 0.01);
            }
        }
        expect(pushed, 'the de-collision pass never actually moved anything')
            .toBeGreaterThan(0);
    });

    it('keeps the chip\'s POSITION independent of the on-screen key — the push '
        + 'is computed before the clip, so the key still only takes width', () => {
        // The ordering inside `placeEpicChips` is load-bearing: a stack that
        // reserved room only for chips the key had spared would move every name
        // below a dropped one, breaking #3257's "the key never moves a name".
        const keepOut = { x: 500, y: 700, w: 500, h: 180 };
        let compared = 0;
        for (let k = 0.06; k <= 1.2; k *= 1.2) {
            for (const y of [0, -200, -700]) {
                const t = { x: 0, y, k };
                const bare = new Map(shortChipsAt(t).map((c) => [c.key, c]));
                for (const chip of shortChipsAt(t, { keepOut })) {
                    const was = bare.get(chip.key);
                    expect(was, 'the key CREATED a chip').toBeTruthy();
                    expect(chip.x).toBeCloseTo(was.x, 9);
                    expect(chip.y, `"${chip.text}" moved vertically because of the key`)
                        .toBeCloseTo(was.y, 9);
                    expect(chip.w).toBeLessThanOrEqual(was.w + 1e-9);
                    compared++;
                }
            }
        }
        expect(compared).toBeGreaterThan(50);
    });

    // ── L3 IS UNTOUCHED ────────────────────────────────────────────────────
    it('is geometrically identical to the pre-#3272 rule wherever the lane can '
        + 'still hold the chip — which is all of L2 and L3', () => {
        // The pre-#3272 arithmetic, restated here so "unchanged" is a
        // comparison and not an assurance: `h = min(labelH, laneH − 2·MY)`,
        // `y = min(iy0 + MY, bottom − MY − h)`, with no floor and no pass.
        const before = (band, t) => {
            const laneH = Math.max(0, (band.epicLaneH ?? band.headerH) * t.k);
            if (laneH - 2 * MY < 11) return null;          // the old drop
            const h = Math.min(EPIC_CHIP_H, laneH - 2 * MY);
            const scale = h / EPIC_CHIP_H;
            const top = t.y + band.y * t.k;
            const bottom = t.y + (band.y + band.height) * t.k;
            const left = t.x + 2 * t.k;
            const right = t.x + (layout.width - 2) * t.k;
            const ix0 = Math.max(left, 0);
            const iy0 = Math.max(top, 0);
            if (Math.min(right, VIEWPORT.w) <= ix0
                || Math.min(bottom, VIEWPORT.h) <= iy0) return null;
            const text = band.epicLabel || band.epic;
            const w = text.length * EPIC_CHIP_CHAR_W * scale
                + EPIC_CHIP_PAD_W * scale
                + (band.epicId != null ? EPIC_CHIP_OPEN_LINK_W + EPIC_CHIP_CARDS_LINK_W : 0)
                + EPIC_PAUSE_BUBBLE_W;
            const x = Math.min(ix0 + MX, right - MX - w);
            const y = Math.min(iy0 + MY, bottom - MY - h);
            if (x < left + MX - 0.01) return null;
            if (x + w > VIEWPORT.w) return null;           // pre-clip candidates only
            if (y + h > VIEWPORT.h + 0.01) return null;
            if (x + w <= 0 || y + h <= 0) return null;
            return { x, y, w, h, fontSize: EPIC_CHIP_FONT * scale };
        };
        // Every k at which the lane still holds the floored chip: 62·k − 4 ≥
        // 17.6, i.e. k ≥ 0.348. L2 begins well below that and L3 is above it.
        let compared = 0;
        for (const k of [0.35, 0.4, 0.5, 0.7, K_READABLE, 1, 1.5, 2, 3, 5]) {
            for (const y of [0, -200, -900, -1500]) {
                for (const x of [0, -600, 300]) {
                    const t = { x, y, k };
                    for (const chip of chipsAt(t)) {
                        const old = before(chip.band, t);
                        if (!old) continue;
                        expect(chip.x, `x moved at k=${k}`).toBeCloseTo(old.x, 6);
                        expect(chip.y, `y moved at k=${k}`).toBeCloseTo(old.y, 6);
                        expect(chip.w, `w moved at k=${k}`).toBeCloseTo(old.w, 6);
                        expect(chip.h, `h moved at k=${k}`).toBeCloseTo(old.h, 6);
                        expect(chip.fontSize).toBeCloseTo(old.fontSize, 6);
                        compared++;
                    }
                }
            }
        }
        expect(compared, 'nothing was compared against the pre-#3272 geometry')
            .toBeGreaterThan(50);
    });

    // ── THE HORIZONTAL HALF (review finding, req #3272) ────────────────────
    // `wFull` scales with `h`, so flooring the height WIDENS every floored chip
    // by 20–60%. The "rectangle narrower than its own name" test was a DROP, so
    // the fix re-created the vanishing name on the x axis at zooms the reader
    // can reach. The band's own right edge is now a CLIP, like the panel edge
    // and the key, under the same `EPIC_CHIP_MIN_CHARS` floor.
    it('CLIPS a name too wide for its own band\'s rectangle rather than dropping '
        + 'it — the vanishing name must not come back on the other axis', () => {
        // The measured case: a 29-character epic name, a 900px-wide world, a
        // 900px panel. `kZoomFloor` there is 0.25, and the pre-fix code refused
        // this name from 0.25 up to 0.29 — i.e. at FULL ZOOM OUT that plan
        // showed no epic name at all, which is the 2026-08-02 screenshot.
        const NARROW = { w: 900, h: 900 };
        const band = { key: 1, epicId: 1, epic: 'Orchestration runtime & pause',
            color: '#8ce99a', y: 8, height: 300, headerH: 83, epicLaneH: 62 };
        for (let k = 0.25; k <= 0.30; k += 0.01) {
            const [chip] = placeEpicChips({
                bands: [band], transform: { x: 0, y: 0, k }, viewport: NARROW,
                worldWidth: 900,
            });
            expect(chip, `"${band.epic}" vanished at k=${k.toFixed(2)}`)
                .toBeTruthy();
            expect(chip.fontSize).toBeGreaterThanOrEqual(EPIC_CHIP_MIN_FONT - 1e-9);
            // Clipped, never MOVED: still at its rectangle's own left margin,
            // and cut off at its rectangle's right edge — #3257's rule.
            const left = 2 * k;
            const right = (900 - 2) * k;
            expect(chip.x).toBeCloseTo(left + MX, 6);
            expect(chip.x + chip.w).toBeLessThanOrEqual(right - MX + 0.01);
            if (chip.clipped) {
                const scale = chip.h / EPIC_CHIP_H;
                expect(chip.w).toBeGreaterThanOrEqual(
                    EPIC_CHIP_PAD_W * scale + EPIC_PAUSE_BUBBLE_W
                    + EPIC_CHIP_MIN_CHARS * EPIC_CHIP_CHAR_W * scale - 1e-9);
            }
        }
        // …and the clip is INERT wherever the name already fitted: at a zoom
        // with room to spare nothing is cut.
        const [roomy] = placeEpicChips({
            bands: [band], transform: { x: 0, y: 0, k: 1 }, viewport: NARROW,
            worldWidth: 900,
        });
        expect(roomy.clipped).toBe(false);
    });

    // ── THE PUSH IS BOUNDED BY THE BAND (review finding, req #3272) ────────
    // An unbounded push accumulates: MEASURED at a 900px panel's own zoom floor,
    // the worst name landed five whole bands below the band it names — and the
    // chip is a click target that zooms to its epic, so it also becomes the
    // wrong control over another epic's beads.
    it('never draws a name whose top-left corner is outside its own band, '
        + 'however many short bands are stacked above it', () => {
        const MANY = Array.from({ length: 24 }, (_, i) => ({
            key: i, epicId: i + 1, epic: `Epic ${i + 1}`, color: '#8ce99a',
            y: 8 + i * 185, height: 177, headerH: 83, epicLaneH: 62,
        }));
        let drawn = 0;
        let atTheBound = 0;
        for (const vw of [900, 1200, 1500, 1900]) {
            const VIEW = { w: vw, h: 900 };
            const kFloorHere = Math.min(vw / 3620, Math.max(vw / 3620, K_READABLE))
                * ZOOM_MIN_RATIO;
            for (let k = kFloorHere; k <= 0.4; k *= 1.15) {
                for (const y of [0, -60, -240]) {
                    const t = { x: 0, y, k };
                    const chips = placeEpicChips({ bands: MANY, transform: t,
                        viewport: VIEW, worldWidth: 3620 });
                    for (const chip of chips) {
                        drawn++;
                        const top = t.y + chip.band.y * k;
                        const bottom = t.y + (chip.band.y + chip.band.height) * k;
                        expect(chip.y, `"${chip.text}" starts above its own band `
                            + `at k=${k.toFixed(3)} vw=${vw}`)
                            .toBeGreaterThanOrEqual(top - 0.01);
                        // `max(bottom, top + MY)` and not the tidier `bottom`:
                        // a band under `CHIP_MARGIN_Y` tall ON SCREEN has no
                        // room even for the margin, so its NATURAL position is
                        // already fractionally past its own bottom edge. The
                        // push never causes that (measured: 1.84px, only on
                        // bands under 0.1px high) and the bound admits it, so
                        // this is the invariant that actually holds.
                        expect(chip.y, `"${chip.text}" drifted ${
                            (chip.y - bottom).toFixed(1)}px BELOW its own band at `
                            + `k=${k.toFixed(3)} vw=${vw} — a name over somebody `
                            + 'else\'s epic')
                            .toBeLessThanOrEqual(Math.max(bottom, top + MY) + 0.02);
                        if (chip.y > bottom - 1) atTheBound++;
                    }
                    // …and the bound never costs the zero-overlap guarantee.
                    for (let i = 0; i < chips.length; i++) {
                        for (let j = i + 1; j < chips.length; j++) {
                            expect(rectsOverlap(chips[i], chips[j])).toBe(false);
                        }
                    }
                }
            }
        }
        expect(drawn, 'the sweep drew real chips').toBeGreaterThan(500);
        expect(atTheBound, 'the bound was never actually reached, so this test '
            + 'is not exercising it').toBeGreaterThan(0);
    });

    // THE ACCEPTANCE CRITERION, ON THE PLAN IT NAMES. Measured against the LIVE
    // pipeline 2 read on 2026-08-02 — 139 steps, 5822 × 8535 world px, seven
    // bands of 616 / 197 / 4550 / 1040 / 616 / 885 / 522 world px. Fully zoomed
    // out (each panel's own `kZoomFloor`) EVERY band is named, at the floor's
    // 11px, at every panel width. The bound costs NOTHING here: drift only
    // accumulates across CONSECUTIVE bands too short to pay for their own name,
    // and the live plan's one short band has tall neighbours.
    //
    // The band heights are the fixture, not the numbers: a live read cannot run
    // in vitest, so what is frozen here is the SHAPE that was measured.
    const LIVE_PIPELINE_2 = [
        ['Application Backlog', 616.3], ['Primary AI/Swarm Session adopt Agent Harness', 197],
        ['Pipeline', 4550], ['Swarm Cloned Git', 1040], ['Mapping Aggregator Card', 615.8],
        ['Swarm Backlog', 885], ['Agent Polish', 522.5],
    ].reduce((acc, [name, h], i) => {
        acc.bands.push({ key: i, epicId: i + 1, epic: name, color: '#8ce99a',
            y: acc.y, height: h, headerH: 101, epicLaneH: 62 });
        acc.y += h;
        return acc;
    }, { bands: [], y: 44 }).bands;
    const LIVE_WORLD_W = 5822;

    it('names every band of the LIVE plan at full zoom out, on every panel width '
        + '— the requirement\'s own acceptance criterion', () => {
        for (const vw of [1200, 1500, 1900, 2400]) {
            const VIEW = { w: vw, h: 900 };
            const kFit = vw / LIVE_WORLD_W;
            const k = Math.min(kFit, Math.max(kFit, K_READABLE)) * ZOOM_MIN_RATIO;
            const chips = placeEpicChips({
                bands: LIVE_PIPELINE_2, transform: { x: 0, y: 0, k },
                viewport: VIEW, worldWidth: LIVE_WORLD_W,
            });
            const onScreen = LIVE_PIPELINE_2.filter(
                (b) => b.y * k < VIEW.h && (b.y + b.height) * k > 0);
            expect(onScreen.length,
                `the plan does not fit a ${vw}px panel at its own zoom floor`)
                .toBe(LIVE_PIPELINE_2.length);
            expect(chips.length,
                `only ${chips.length} of ${onScreen.length} epic names at full `
                + `zoom out on a ${vw}px panel`)
                .toBe(onScreen.length);
            for (const chip of chips) {
                expect(chip.fontSize).toBeCloseTo(EPIC_CHIP_MIN_FONT, 6);
            }
        }
    });

    // WHAT THE BOUND COSTS WHERE IT DOES BITE, measured rather than waved at, so
    // the trade is on the record: 24 bands ALL at `MIN_LANE_PITCH`'s 177 world
    // px, at the module's own 185px PITCH (`height + BAND_GAP` — a review
    // finding: abutting them understated the budget by 8px per band and cost one
    // extra name at 1500px) — a shape no live plan has — at each panel's own
    // zoom floor. Bands that short cannot each carry a 19.6px name without
    // either overlapping (forbidden) or drifting off their own band (worse), so
    // something must give and this is which:
    //
    //     panel   band / pitch on screen   named       vs. pre-#3272
    //      900px      11.0 / 11.5px        14 / 24         0 / 24
    //     1200px      14.7 / 15.3px        18 / 24         0 / 24
    //     1500px      18.3 / 19.2px        24 / 24         0 / 24
    //     1900px      23.2 / 24.3px        24 / 24         0 / 24
    it('degrades by DROPPING names, never by misattributing them, on a plan of '
        + 'uniformly minimum-height bands', () => {
        const MANY = Array.from({ length: 24 }, (_, i) => ({
            key: i, epicId: i + 1, epic: `Epic ${i + 1}`, color: '#8ce99a',
            y: 8 + i * 185, height: 177, headerH: 83, epicLaneH: 62,
        }));
        const EXPECTED = { 900: 14, 1200: 18, 1500: 24, 1900: 24 };
        for (const vw of [900, 1200, 1500, 1900]) {
            const VIEW = { w: vw, h: 900 };
            const kFit = vw / 3620;
            const k = Math.min(kFit, Math.max(kFit, K_READABLE)) * ZOOM_MIN_RATIO;
            const chips = placeEpicChips({ bands: MANY, transform: { x: 0, y: 0, k },
                viewport: VIEW, worldWidth: 3620 });
            expect(chips.length, `the ${vw}px column of the table above is stale`)
                .toBe(EXPECTED[vw]);
            // Whatever survives is correct: in its own band, and clear of every
            // other name.
            for (const chip of chips) {
                expect(chip.y).toBeGreaterThanOrEqual(chip.band.y * k - 0.01);
                expect(chip.y).toBeLessThanOrEqual(
                    (chip.band.y + chip.band.height) * k + 0.02);
            }
        }
    });

    // ── DEGENERATE INPUT MUST NOT POISON THE PASS (review finding) ─────────
    it('refuses a band with a non-finite rectangle instead of carrying NaN into '
        + 'the next band\'s de-collision', () => {
        const good = Array.from({ length: 4 }, (_, i) => ({
            key: i, epicId: i + 1, epic: `Epic ${i + 1}`, color: '#8ce99a',
            y: 8 + i * 158, height: 150, headerH: 83, epicLaneH: 62,
        }));
        const t = { x: 0, y: 0, k: 0.1 };
        const args = { transform: t, viewport: VIEWPORT, worldWidth: 3000 };
        const control = placeEpicChips({ bands: good, ...args });
        const poisoned = placeEpicChips({
            bands: [{ ...good[0], height: undefined }, ...good.slice(1)], ...args,
        });
        // The bad band draws nothing…
        expect(poisoned.some((c) => c.key === 0)).toBe(false);
        // …and every SURVIVING chip sits exactly where it does when the bad band
        // is simply absent — the NaN never reached `stackBottom`.
        const without = placeEpicChips({ bands: good.slice(1), ...args });
        expect(poisoned.map((c) => [c.key, +c.y.toFixed(6)]))
            .toEqual(without.map((c) => [c.key, +c.y.toFixed(6)]));
        expect(control.length).toBeGreaterThan(without.length);
    });

    // ── BAND ORDER IS ENFORCED, NOT ASSUMED (review finding) ───────────────
    it('places a shuffled band list exactly as it places a sorted one — the '
        + 'pass no longer depends on the caller\'s ordering', () => {
        const bands = Array.from({ length: 6 }, (_, i) => ({
            key: i, epicId: i + 1, epic: `Epic ${i + 1}`, color: '#8ce99a',
            y: 8 + i * 158, height: 150, headerH: 83, epicLaneH: 62,
        }));
        const shuffled = [bands[3], bands[0], bands[5], bands[1], bands[4], bands[2]];
        for (const k of [0.08, 0.1, 0.15, 0.3, 1]) {
            const args = { transform: { x: 0, y: 0, k }, viewport: VIEWPORT,
                worldWidth: 3000 };
            const byKey = (cs) => new Map(cs.map((c) => [c.key,
                [+c.x.toFixed(6), +c.y.toFixed(6), +c.w.toFixed(6)]]));
            expect(byKey(placeEpicChips({ bands: shuffled, ...args })),
                `a shuffled band list placed differently at k=${k}`)
                .toEqual(byKey(placeEpicChips({ bands, ...args })));
        }
    });

    // ── THE PINNED RULER, IN THE FLOORED REGIME ────────────────────────────
    // A chip taller than the visible sliver of its band cannot be both below
    // req #3254's pinned ruler and inside its own band — the two constraints
    // are contradictory there. It follows the band, so the name crosses under
    // the ruler for the last frames of that band's exit. Bounded and stated,
    // rather than fixed by making the name LINGER at the clamp line, which is
    // exactly what #3257 clause 3 forbids.
    it('may cross under the pinned ruler only while its own band is leaving, '
        + 'and never by more than its own height', () => {
        let crossed = 0;
        for (const topInset of [30, 60]) {
            for (let k = 0.08; k <= 0.3; k += 0.01) {
                for (let y = -400; y <= 100; y += 7) {
                    for (const chip of shortChipsAt({ x: 0, y, k }, { topInset })) {
                        if (chip.y >= topInset - 0.01) continue;
                        crossed++;
                        // Bounded by the chip's own height — past that the
                        // wholly-outside guard drops it.
                        expect(topInset - chip.y).toBeLessThan(chip.h + 0.01);
                        // NEVER WHOLLY HIDDEN. The bound above allows a chip
                        // exactly flush with the ruler's underside; this says a
                        // sliver of every drawn name is always below it, so
                        // "drawn and invisible" stays the state this module
                        // refuses to emit.
                        expect(chip.y + chip.h,
                            `"${chip.text}" is entirely under the ruler at `
                            + `k=${k.toFixed(2)} y=${y}`)
                            .toBeGreaterThan(topInset);
                        // …and it only happens while the band itself is leaving
                        // over the top.
                        expect(y + chip.band.y * k).toBeLessThan(topInset);
                    }
                }
            }
        }
        expect(crossed, 'the sweep never reached the case this test describes')
            .toBeGreaterThan(0);
    });

    // ── THE OTHER FLOOR IS A DIFFERENT RULE, AND IS UNTOUCHED ──────────────
    it('still DROPS a chip clipped past the readable-characters floor — that '
        + 'floor is stated in characters and req #3272 leaves it alone', () => {
        // A key spanning nearly the whole panel and tall enough to reach every
        // chip row: nothing survives with three characters of name left.
        const keepOut = { x: 4, y: 0, w: VIEWPORT.w - 8, h: VIEWPORT.h };
        for (const k of [0.1, 0.3, 1]) {
            const bare = chipsAt({ x: 0, y: 0, k });
            expect(bare.length, `nothing to drop at k=${k}`).toBeGreaterThan(0);
            expect(chipsAt({ x: 0, y: 0, k }, { keepOut }).length,
                `a chip survived a key that left no room at k=${k}`).toBe(0);
        }
        // And a partial clip still keeps at least the floor's worth of name.
        const key = { x: 700, y: 0, w: 800, h: VIEWPORT.h };
        for (const chip of chipsAt({ x: 0, y: 0, k: 0.2 }, { keepOut: key })) {
            if (!chip.clipped) continue;
            const scale = chip.h / EPIC_CHIP_H;
            expect(chip.w).toBeGreaterThanOrEqual(
                EPIC_CHIP_PAD_W * scale + EPIC_PAUSE_BUBBLE_W
                + EPIC_CHIP_MIN_CHARS * EPIC_CHIP_CHAR_W * scale - 1e-9);
        }
    });
});

describe('epic band label counts, behind a toggle (req #3225)', () => {
    const VIEWPORT = { w: 1500, h: 900 };

    it('omitting epicCounts leaves every band label exactly as it reads today', () => {
        const withCounts = computePlanLayout(plan.rows,
            { reqLayout: 'vertical', stepLabel: 'title' });
        for (const band of withCounts.bands) {
            expect(band.epicLabel).toBe(band.epic);
        }
        const epicLabels = withCounts.labels.filter((l) => l.kind === 'epic');
        for (const label of epicLabels) {
            const band = withCounts.bands.find((b) => b.epicId === label.epicId);
            expect(label.text).toBe(band.epic);
            expect(label.w).toBeCloseTo(
                band.epic.length * EPIC_CHIP_CHAR_W + EPIC_PAUSE_BUBBLE_W, 6);
        }
    });

    it('leaves a band untouched when the map carries no entry for its epic', () => {
        const layout = computePlanLayout(plan.rows,
            { epicCounts: new Map([[999999, { met: 1, total: 1 }]]) });
        for (const band of layout.bands) {
            expect(band.epicLabel).toBe(band.epic);
        }
    });

    // Restored after req #3371 deleted it as collateral of removing the batch
    // box describe block it happened to sit in — the branch it tests
    // (`epicBandLabelText`'s `Object.hasOwn` path) is unrelated to batches.
    it('accepts a plain object as well as a Map, matching the reqTitles convention', () => {
        const [firstEpicId] = plan.rows.map((r) => r.epicId).filter((id) => id != null);
        const layout = computePlanLayout(plan.rows,
            { epicCounts: { [firstEpicId]: { met: 2, total: 4 } } });
        const band = layout.bands.find((b) => b.epicId === firstEpicId);
        expect(band.epicLabel).toBe(`${band.epic} 2/4`);
    });

    // Restored after req #3371 for the same reason — the zero-overlap
    // invariant with count suffixes on the fixture's longest title (epic 4,
    // "Primary and Swarm Agentic Integration", 38 chars) is unrelated to
    // batches and lost its only coverage when that describe block went.
    {
        const WIDE_COUNTS = new Map(
            EPICS.map((e) => [e.id, { met: 99, total: 100 }]));
        for (const opts of COMBOS) {
            const name = `${opts.stepLabel} labels, counts on`;
            it(`zero label overlap with long epic titles AND count suffixes (${name})`, () => {
                const withCounts = computePlanLayout(plan.rows,
                    { ...opts, epicCounts: WIDE_COUNTS });
                assertNoLabelOverlap(withCounts, name);
                // req #3498 — was "no label touches any bead". The card is the
                // containment boundary now, and it is the stronger claim: a
                // count suffix that pushed text out of its own card would fail
                // here, where a bead-clearance check could not see it.
                for (const label of withCounts.labels) {
                    if (label.stepId == null) continue;
                    const n = withCounts.nodes.get(label.stepId);
                    expect(label.x).toBeGreaterThanOrEqual(n.left - 0.01);
                    expect(label.x + label.w).toBeLessThanOrEqual(n.right + 0.01);
                    expect(label.y).toBeGreaterThanOrEqual(n.top - 0.01);
                    expect(label.y + label.h).toBeLessThanOrEqual(n.bottom + 0.01);
                }
            });
        }
    }

    it('never suffixes the "No epic" band, even with a non-empty counts map', () => {
        // A bead with no epic has no requirement set to count against — a
        // stray "0/0" would claim an answer that does not exist.
        const reads = {
            steps: [{ id: 1, pipeline_fk: 1, title: 'req-less', run: 'auto',
                notes: null, completed_at: '2026-07-01T00:00:00' }],
            stepRequirements: [], stepDeps: [], requirements: [],
            features: [], epics: [], machines: MACHINES,
        };
        const p = orderedPlan(buildPipelineModel({
            pipeline: { id: 1, title: 'x', pipeline_status: 'active' }, ...reads,
        }), { now: NOW });
        expect(p.rows[0].epicId).toBeNull();
        const layout = computePlanLayout(p.rows,
            { epicCounts: new Map([[1, { met: 1, total: 1 }]]) });
        const noEpicBand = layout.bands.find((b) => b.epicId == null);
        expect(noEpicBand.epicLabel).toBe(noEpicBand.epic);
    });

    it('placeEpicChips draws the epicLabel text and measures its width, not the bare name', () => {
        const baseLayout = computePlanLayout(plan.rows,
            { reqLayout: 'vertical', stepLabel: 'title' });
        const epicCounts = new Map(baseLayout.bands
            .filter((b) => b.epicId != null)
            .map((b) => [b.epicId, { met: 9, total: 99 }]));
        const withCounts = computePlanLayout(plan.rows,
            { reqLayout: 'vertical', stepLabel: 'title', epicCounts });
        const chips = placeEpicChips({
            bands: withCounts.bands, transform: { x: 0, y: 0, k: K_READABLE },
            viewport: VIEWPORT, worldWidth: withCounts.width,
        });
        expect(chips.length).toBeGreaterThan(0);
        for (const chip of chips) {
            const band = withCounts.bands.find((b) => b.key === chip.key
                || (b.key == null && chip.key === 'none'));
            expect(chip.text).toBe(band.epicLabel);
            if (band.epicId != null) expect(chip.text).toMatch(/ 9\/99$/);
        }
    });

    // placeEpicChips is also called directly, in tests and potentially by other
    // callers, against hand-built band objects that predate this field — the
    // fallback to `band.epic` must hold so those callers see no behaviour change.
    it('placeEpicChips falls back to band.epic when a hand-built band omits epicLabel', () => {
        const [chip] = placeEpicChips({
            bands: [{ key: 1, epicId: 1, epic: 'X'.repeat(20), color: '#fff',
                y: 8, height: 400, headerH: 46 }],
            transform: { x: 0, y: 0, k: 1 }, viewport: VIEWPORT, worldWidth: 3000,
        });
        expect(chip.text).toBe('X'.repeat(20));
        // + EPIC_CHIP_OPEN_LINK_W since req #3257 — the ↗ control's flat
        // footprint is reserved on every chip now that the measured box is what
        // keeps the name inside its own rectangle.
        expect(chip.w).toBeCloseTo(20 * EPIC_CHIP_CHAR_W + 18
            + EPIC_CHIP_OPEN_LINK_W + EPIC_CHIP_CARDS_LINK_W + EPIC_PAUSE_BUBBLE_W, 6);
    });

    it('the toggle is a pure display transform: the ONLY thing that changes '
        + 'with epicCounts is band.epicLabel and the label/chip rects built from it', () => {
        const without = computePlanLayout(plan.rows,
            { reqLayout: 'vertical', stepLabel: 'title' });
        const withCounts = computePlanLayout(plan.rows, {
            reqLayout: 'vertical', stepLabel: 'title',
            epicCounts: new Map(without.bands
                .filter((b) => b.epicId != null)
                .map((b) => [b.epicId, { met: 1, total: 2 }])),
        });
        // Geometry — bead positions, column widths, world size — is untouched.
        expect(withCounts.width).toBe(without.width);
        expect(withCounts.colW).toEqual(without.colW);
        expect([...withCounts.nodes.values()].map((n) => [n.x, n.y]))
            .toEqual([...without.nodes.values()].map((n) => [n.x, n.y]));
        expect(withCounts.bands.map((b) => ({ ...b, epicLabel: undefined })))
            .toEqual(without.bands.map((b) => ({ ...b, epicLabel: undefined })));
    });
});

describe('next-step highlight (req #3168)', () => {
    const rowById = new Map(plan.rows.map((r) => [r.id, r]));

    it('marks an eligible step for the halo and a non-eligible one not', () => {
        expect(beadStyle(rowById.get(17), true).next).toBe(true);
        expect(beadStyle(rowById.get(17), false).next).toBe(false);
        expect(beadStyle(rowById.get(1), false).next).toBe(false);
    });

    // ── WHAT THIS TEST BECAME (req #3498) ───────────────────────────────────
    // It used to assert the halo CIRCLE cleared every label box, because the
    // halo was drawn around a bead sitting in the middle of a cluster of
    // free-floating text — the first version (BEAD_R + 7, outer 18.25) crossed
    // both the step label and the first requirement id, with nothing to catch
    // it. That clearance is not available any more and does not need to be: the
    // labels are INSIDE the card, the bead is at the card's midpoint, and the
    // renderer draws the circle only where no card is painted (L1, which draws
    // no labels either).
    //
    // The guarantee that replaces it is CONTAINMENT the other way round: where
    // the card IS drawn, the halo is the card's own outline, so it encloses
    // every label of its step instead of dodging them. Asserted from the same
    // constants the renderer uses, so a radius nudged back up cannot silently
    // re-introduce a mark that crosses text.
    it('the circle halo fits inside its card, so it can never cross a label', () => {
        const outer = NEXT_HALO_RADIUS + NEXT_HALO_STROKE / 2;
        for (const opts of COMBOS) {
            const layout = computePlanLayout(plan.rows, opts);
            for (const n of layout.nodes.values()) {
                const halo = { x: n.x - outer, y: n.y - outer, w: 2 * outer, h: 2 * outer };
                const where = `${opts.stepLabel}: halo of step ${n.id}`;
                expect(halo.x, where).toBeGreaterThanOrEqual(n.left);
                expect(halo.x + halo.w, where).toBeLessThanOrEqual(n.right);
                expect(halo.y, where).toBeGreaterThanOrEqual(n.top);
                expect(halo.y + halo.h, where).toBeLessThanOrEqual(n.bottom);
            }
        }
    });

    it('the card-shaped halo encloses every label of its own step', () => {
        // The renderer inflates the card box by `NEXT_HALO_STROKE` on each side
        // (see the `next-halo` Rect in PipelinePlanVisualizer.jsx). That box
        // must contain the card's text, or the mark meant to say "this one runs
        // next" would be cutting through the name of the step it points at.
        for (const opts of COMBOS) {
            const layout = computePlanLayout(plan.rows, opts);
            for (const label of layout.labels) {
                if (label.stepId == null) continue;
                const n = layout.nodes.get(label.stepId);
                const where = `${opts.stepLabel}: ${label.kind} of step ${label.stepId}`;
                expect(label.x, where).toBeGreaterThanOrEqual(n.left - NEXT_HALO_STROKE);
                expect(label.x + label.w, where)
                    .toBeLessThanOrEqual(n.right + NEXT_HALO_STROKE);
                expect(label.y, where).toBeGreaterThanOrEqual(n.top - NEXT_HALO_STROKE);
                expect(label.y + label.h, where)
                    .toBeLessThanOrEqual(n.bottom + NEXT_HALO_STROKE);
            }
        }
    });

    it('the halo is a SEPARATE mark from the running pulse', () => {
        const running = beadStyle(rowById.get(38), false);
        expect(running.pulse).toBe(true);
        expect(running.next).toBe(false);
        const runningAndNext = beadStyle(rowById.get(38), true);
        expect(runningAndNext.pulse).toBe(true);
        expect(runningAndNext.next).toBe(true);
    });

    // req #3226 — the halo's colour carries the suppression fact ALONGSIDE the
    // ring's eligibility fact, never replacing it: a paused scope's eligible
    // step must not read as "about to run".
    it('haloColor is the eligible green by default, red when suppressed', () => {
        const eligible = beadStyle(rowById.get(17), true);
        expect(eligible.haloColor).toBe(PLAN_VIZ_PALETTE.eligibleRing);
        const suppressed = beadStyle(rowById.get(17), true, true);
        expect(suppressed.haloColor).toBe(PAUSE_PAUSED_COLOR);
        // The RING is untouched by suppression — eligibility itself never
        // changes under pause, only whether it will launch on its own.
        expect(suppressed.ring).toBe(eligible.ring);
        expect(suppressed.ringWidth).toBe(eligible.ringWidth);
    });

    it('suppressed with no `next` (not eligible) is inert — nothing draws the halo', () => {
        const style = beadStyle(rowById.get(1), false, true);
        expect(style.next).toBe(false);
    });
});

// ── The halo has to SURVIVE Overview (req #3271) ────────────────────────────
// Everything above pins the halo's WORLD geometry. None of it could see the
// bug: the mark is drawn inside a group scaled by `k`, and Konva scales stroke
// width and dash pitch along with the radius, so at the live plan's Overview
// (measured: kDefault 0.8, therefore k < 0.4 by the level ladder's own
// definition of 'out') a 2px stroke with 3px dashes rendered at 0.8px and 1.2px
// — emitted, and invisible. These cases pin the SCREEN-side behaviour, which is
// the half no world-unit assertion can reach.
describe('one mark per cluster — the merged next-step dot (req #3498)', () => {
    const at = (x, y, id, suppressed = false) => ({ id, x, y, suppressed });

    it('merges marks whose dots would overlap, and leaves the rest alone', () => {
        // Radius 10 ⇒ circles touch at 20 apart.
        const out = clusterNextMarks([
            at(0, 0, 1), at(0, 15, 2),        // 15 < 20 → one mark
            at(0, 500, 3),                    // far away → its own
        ], 10);
        expect(out).toHaveLength(2);
        expect(out[0].ids).toEqual([1, 2]);
        expect(out[0].y).toBe(7.5);           // the plain mean, not a member
        expect(out[1].ids).toEqual([3]);
    });

    it('is SINGLE-LINKAGE — a chain of near neighbours is one blob on screen', () => {
        // A–B and B–C touch; A–C do not. On screen that is one shape, so it
        // must be one mark. A pairwise rule would emit three overlapping ones.
        const out = clusterNextMarks([at(0, 0, 1), at(0, 15, 2), at(0, 30, 3)], 10);
        expect(out).toHaveLength(1);
        expect(out[0].ids).toEqual([1, 2, 3]);
    });

    it('reads as HELD when any member is suppressed', () => {
        const out = clusterNextMarks([at(0, 0, 1), at(0, 15, 2, true)], 10);
        expect(out[0].suppressed).toBe(true);
        expect(clusterNextMarks([at(0, 0, 1), at(0, 15, 2)], 10)[0].suppressed)
            .toBe(false);
    });

    it('merges nothing when the mark has no extent, and survives junk input', () => {
        expect(clusterNextMarks([at(0, 0, 1), at(0, 1, 2)], 0)).toHaveLength(2);
        expect(clusterNextMarks([], 10)).toEqual([]);
        expect(clusterNextMarks(null, 10)).toEqual([]);
        expect(clusterNextMarks([at(NaN, 0, 1), at(0, 0, 2)], 10)).toHaveLength(1);
    });

    it('THE MEASURED CASE: six eligible steps 97.5px apart under a 112.6px dot', () => {
        // The live defect, as a fixture. The dot's world radius at plan 7's
        // landing scale exceeds the lane pitch, so every one of these overlaps
        // its neighbour — six marks drew as one red capsule with no way to tell
        // how many steps were under it.
        const six = [0, 1, 2, 3, 4, 5].map((i) => at(9000, 3126 + i * 97.5, 120 + i));
        const merged = clusterNextMarks(six, 112.6);
        expect(merged).toHaveLength(1);
        expect(merged[0].ids).toHaveLength(6);
        // …and the renderer draws that 6 on it. The count is what makes the
        // merge honest rather than a hidden truncation.
        expect(merged[0].y).toBeCloseTo(3126 + 2.5 * 97.5, 6);
    });

    it('the count is sized in SCREEN px, like the dot it rides', () => {
        // A world-sized glyph is a fraction of a pixel at exactly the scale this
        // mark exists for, so the renderer divides by k — the same compensation
        // `nextMarkDotRadius` already applies to the radius.
        expect(NEXT_MARK_COUNT_FONT_PX).toBeGreaterThan(0);
        expect(NEXT_MARK_COUNT_FONT_PX)
            .toBeLessThan(2 * NEXT_MARK_SCREEN_RADIUS);
    });
});

describe('the next-step halo survives Overview (req #3271)', () => {
    // A k sweep spanning everything the zoom behavior can reach: the scale
    // extent is [kFloor, kDefault × 8] and kDefault is at least K_READABLE.
    const K_SWEEP = [0.05, 0.1, 0.15, 0.2, 0.3, 0.35, 0.4, 0.5, 0.7,
        0.9, 1, 1.2, 1.9, 2.5, 4, 6.4, 10];
    const outerAt = (m) => (NEXT_HALO_RADIUS + NEXT_HALO_STROKE / 2) * m;
    const innerAt = (m) => (NEXT_HALO_RADIUS - NEXT_HALO_STROKE / 2) * m;

    // The halo's ceiling is measured against the bead's own ring, so that width
    // has to be the one `beadStyle` HANDS THE CANVAS, not a second copy of it.
    // (Asserting `BEAD_OUTER_RADIUS === BEAD_RADIUS + BEAD_RING_W_EMPHASIS / 2`
    // as well would restate the line that defines it; the literal 2.5 is already
    // pinned independently above.)
    it('reads the bead ring width from the style the canvas is given', () => {
        const eligibleRow = plan.rows.find((r) => r.id === 17);
        expect(beadStyle(eligibleRow, true).ringWidth).toBe(BEAD_RING_W_EMPHASIS);
    });

    // THE GUARANTEE, and the reason the label-clearance case above stays the
    // binding one: wherever a step or requirement label is drawn, the halo is
    // byte-identical to what it was before this existed.
    //
    // ASKED THROUGH `labelsLegible`, not through a boolean the caller hands in
    // (req #3280). The old version passed `true` and asserted 1, which proved
    // the function's first line and nothing about the canvas — the visualizer
    // could have passed `false` at a level that draws labels and this stayed
    // green. Reading the SAME predicate the renderer gates the labels on is what
    // makes this a claim about what is on screen.
    it('is exactly 1 at every k where the labels are drawn', () => {
        for (const k of K_SWEEP.filter(labelsLegible)) {
            expect(nextHaloMagnify(k, false), `k=${k}`).toBe(1);
        }
        // Non-vacuity: the sweep must actually contain legible scales.
        expect(K_SWEEP.filter(labelsLegible).length).toBeGreaterThan(5);
    });

    // Zooming IN never changes the mark either. Only the zoomed-OUT half of the
    // range, where the mark had shrunk below its target, is touched at all.
    it('is exactly 1 once the mark already meets its target on screen', () => {
        for (const k of K_SWEEP.filter((v) => v >= 1)) {
            expect(nextHaloMagnify(k, false), `k=${k}`).toBe(1);
        }
    });

    // THE REGRESSION PIN THE REQUIREMENT ASKED FOR. If this ever reverts to
    // world units, every one of these products collapses to `constant × k` and
    // the case fails at the first k in the sweep.
    it('holds the halo SCREEN-constant across a k sweep, until the cap bites', () => {
        for (const k of [...K_SWEEP, 0.45, 0.6, 0.75].sort((a, b) => a - b)) {
            const m = nextHaloMagnify(k, false);
            if (m >= NEXT_HALO_MAX_MAGNIFY || m === 1) continue;
            // ALL THREE ARE THE SAME IDENTITY times a different constant, and
            // saying so is the correction (review finding on this block: the
            // previous comment claimed the stroke and dash products were
            // "load-bearing" against the radius one being an identity, which is
            // not true — each reduces to
            // `NEXT_HALO_SCREEN_RADIUS / NEXT_HALO_RADIUS === K_READABLE`).
            // They are kept as a REGRESSION PIN on the shape rather than as a
            // proof: if the mark ever stops scaling by ONE factor — a stroke
            // counter-scaled on its own is the specific fix #3271 rejected —
            // the three stop agreeing and this reddens. The claim that the
            // freeze scale is derived is asserted directly, once, below.
            expect(NEXT_HALO_RADIUS * m * k, `radius px at k=${k}`)
                .toBeCloseTo(NEXT_HALO_SCREEN_RADIUS, 10);
            expect(NEXT_HALO_STROKE * m * k, `stroke px at k=${k}`)
                .toBeCloseTo(NEXT_HALO_STROKE * K_READABLE, 10);
            for (const [i, d] of NEXT_HALO_DASH.entries()) {
                expect(d * m * k, `dash[${i}] px at k=${k}`)
                    .toBeCloseTo(d * K_READABLE, 10);
            }
        }
        // The sweep must actually EXERCISE the screen-constant branch, or the
        // loop above passes by skipping everything (review-proofing).
        const exercised = [...K_SWEEP, 0.45, 0.6, 0.75].filter((k) => {
            const m = nextHaloMagnify(k, false);
            return m > 1 && m < NEXT_HALO_MAX_MAGNIFY;
        });
        expect(exercised.length).toBeGreaterThan(2);
    });

    // ONE factor for the whole mark, so the shape is invariant: the halo can
    // only move OUTWARD from a bead that does not grow with it, which is what
    // keeps the two rings two marks. A fix that counter-scaled the stroke alone
    // would close this gap instead of opening it.
    //
    // IN SCREEN PIXELS, because that is the only place the defect lived. The
    // world-unit version of this case (`11.5m ≥ 11.25` for every `m ≥ 1`)
    // cannot fail and says nothing — a review finding on the first draft of
    // this very block.
    it('never merges with the bead ring — the gap only opens, on SCREEN', () => {
        // Below k = 0.5 the world gap of 0.25 is itself sub-pixel, so the
        // magnification is the ONLY thing that separates the two rings there.
        // Bounded below by the live plan's own reachable zoom floor
        // (`min(kFit, kDefault) × ZOOM_MIN_RATIO` = 0.0829 on a 1200px panel) —
        // the sweep runs further out than the camera can actually go.
        const LIVE_ZOOM_FLOOR = (1200 / 3620.2) * ZOOM_MIN_RATIO;   // 0.0829
        // The floor is IN the swept set, not merely its lower bound — a bound
        // that filters everything below 0.1 does not test the floor it names.
        // 0.9 rather than 1, because the floor measures 0.97px and rounding that
        // up to a rule the code does not meet is how a green suite starts lying.
        const swept = [LIVE_ZOOM_FLOOR,
            ...K_SWEEP.filter((v) => v < 0.5 && v > LIVE_ZOOM_FLOOR)];
        for (const k of swept) {
            const gapPx = (innerAt(nextHaloMagnify(k, false)) - BEAD_OUTER_RADIUS) * k;
            const unfixedPx = (innerAt(1) - BEAD_OUTER_RADIUS) * k;
            expect(unfixedPx, `world-constant gap px at k=${k}`).toBeLessThan(0.2);
            expect(gapPx, `gap px at k=${k}`).toBeGreaterThan(0.9);
            // The magnification is pinned at its ceiling across this whole band,
            // so the ratio is one number restated per k — it pins the ceiling
            // being REACHED, and the per-k pixel assertions carry the rest.
            //
            // A LOWER BOUND, not the exact 47. Pinning the number made this case
            // a second and stricter opinion about how far the ceiling may move
            // than `takes its ceiling` holds: a retune to 1.9 turns 47 into 42.4
            // and reddens this for no reason a reader could see, and a ceiling
            // above 2.5 puts k = 0.4 into the screen-constant branch and breaks
            // it from the other side (review finding). 30 holds for any
            // magnification at or above 1.65, and still says the thing worth
            // saying — the two rings are tens of times further apart than the
            // mark this requirement replaced.
            expect(gapPx / unfixedPx, `gap ratio at k=${k}`).toBeGreaterThan(30);
        }
        // At fit-to-width on a 1440px panel the gap is comfortably supra-pixel —
        // that is the claim this case exists to make, distinct from the floor.
        // (Called "the opening view" until req #3280's review; the plan actually
        // lands on `kDefault` = 0.8, one wheel-click in from here. See the
        // `turns the measured Overview scales` case below.)
        const kFitWide = 1440 / 3620.2;
        expect((innerAt(nextHaloMagnify(kFitWide, false)) - BEAD_OUTER_RADIUS) * kFitWide,
            'gap px at fit-to-width, 1440px panel').toBeGreaterThan(4);
        // And the world gap never closes at any k, magnified or not.
        let prevGap = null;
        for (const k of [...K_SWEEP].sort((a, b) => b - a)) {
            const gap = innerAt(nextHaloMagnify(k, false)) - BEAD_OUTER_RADIUS;
            expect(gap, `k=${k}`).toBeGreaterThan(0);
            if (prevGap !== null) expect(gap, `k=${k}`).toBeGreaterThanOrEqual(prevGap);
            prevGap = gap;
        }
    });

    // WHAT STOPS IT GROWING, measured against the furniture ITSELF rather than
    // against the constants the ceiling is derived from. Review found the first
    // two ceilings by doing exactly this by hand: "never reaches another bead"
    // cleared beads and crossed the epic chip's strip and its own launch-unit
    // box on all four sides, through the whole of Overview.
    //
    // THIS COVERS THE RING ONLY (req #3299). Below `NEXT_MARK_FLOOR_K` the
    // component draws the deep-zoom-out DOT instead — deliberately NOT bound
    // by this clearance list, since it is sized in screen space rather than
    // world space (see the "different MARK" block in pipelinePlanLayout.js).
    // It is k-INDEPENDENT BY CONSTRUCTION — it bounds the ring's worst-case
    // WORLD envelope (`outerAt(NEXT_HALO_MAX_MAGNIFY)`), which is why it can
    // claim "at any k" with no `k` sweep anywhere in it. The dot has no world
    // envelope, so it is out of this case's reach by design, not by where a
    // sweep happens to fall.
    it('crosses no world furniture, at any k the zoom can reach', () => {
        const worstOuter = outerAt(NEXT_HALO_MAX_MAGNIFY);
        // The substrate fixture in all four label/layout combinations, PLUS the
        // timed fuzz corpus — 400 deterministic plans, which is what keeps the
        // sweep over PLAN SHAPES rather than over one fixture's.
        const layouts = [
            ...COMBOS.map((opts) => ({
                label: `${opts.stepLabel}`,
                layout: computePlanLayout(plan.rows, opts),
            })),
            // BOTH requirement layouts, still. They used to differ in the
            // clearance they exercised — the launch-unit box's bottom edge was
            // 30 world px under `horizontal` reqs and 28 (the ceiling's own
            // binding constraint) under `vertical`, so a sweep that ran only
            // the default never touched the binding one (review finding). Req
            // #3371 deleted that box, and the binding clearance is now the epic
            // chip strip, which does not vary with the requirement layout —
            // but the lane pitches and column widths still do, so both layouts
            // stay swept.
            ...[...timedFuzzCorpus()].flatMap(({ seed, reads }) => {
                const p = orderedPlan(buildPipelineModel(reads), { now: FUZZ_NOW });
                // ONE configuration, not two (req #3498). This mapped over
                // ['horizontal','vertical'] with a comment claiming the lane
                // pitches and column widths still varied between them — both
                // untrue now: columns are uniform and `lanePitch` never read
                // `reqLayout`. It computed the 400-plan corpus twice with
                // identical inputs while looking like coverage.
                return [null].map(() => ({
                    label: `fuzz seed ${seed}`,
                    layout: computePlanLayout(p.rows,
                        { timeAxis: p.timeAxis }),
                }));
            }),
        ];
        // Violations are COLLECTED and asserted once, not `expect`ed per pair:
        // this sweeps ~10^5 comparisons and vitest's per-expect overhead is what
        // pushed the case past its timeout.
        const bad = [];
        const seen = { bands: 0, laneZero: 0 };
        // THE LAUNCH-UNIT BOX'S FOUR EDGES USED TO BE SWEPT HERE, and they were
        // the binding clearance. Req #3371 deleted the box, so what is left is
        // the epic chip strip — which IS the binding clearance now — plus the
        // bead pairs in the case below.
        for (const { label: where, layout } of layouts) {
            seen.bands += layout.bands.length;
            // The epic chip's strip, which is the room above a LANE-0 bead.
            // Tested UNCONDITIONALLY for every lane-0 bead: the first version
            // skipped on the PASSING condition, so its `expect` could only ever
            // throw and 136 rows sailed past without one comparison running.
            for (const band of layout.bands) {
                const chipBottom = band.y + (band.epicLaneH ?? band.headerH);
                for (const stepId of band.stepIds) {
                    const n = layout.nodes.get(stepId);
                    if (!n || n.lane !== 0) continue;
                    seen.laneZero += 1;
                    if (n.y - worstOuter <= chipBottom) {
                        bad.push(`${where} step ${stepId}: epic chip strip`);
                    }
                }
            }
        }
        expect(bad.slice(0, 12)).toEqual([]);
        // Non-vacuity, per FURNITURE KIND — a total says nothing about whether
        // each kind was actually compared against.
        // Thresholds sit just under the MEASURED counts, not orders of
        // magnitude below them: a guard at 20 against an actual 812 catches
        // total collapse and nothing else.
        //
        // HALVED at req #3498, and the halving is the POINT: this sweep used to
        // run the corpus twice with identical inputs (once per `reqLayout`, an
        // option the layout no longer reads), so the counts it was calibrated
        // against — 1624 bands, 6000+ lane-0 beads — were double-counting one
        // configuration. The corpus, the plans and the furniture compared are
        // unchanged; only the duplicate pass is gone.
        expect(seen.bands, 'epic bands swept').toBeGreaterThan(750);
        expect(seen.laneZero, 'lane-0 beads compared to a chip strip')
            .toBeGreaterThan(3000);
    }, 20000);

    // Kept separate because it is O(beads²): the substrate fixture in all four
    // combinations is enough to pin it, and the corpus above already covers the
    // furniture that varies with the plan's SHAPE.
    it('never reaches another bead, or another bead\'s hit circle', () => {
        const worstOuter = outerAt(NEXT_HALO_MAX_MAGNIFY);
        let pairs = 0;
        for (const opts of COMBOS) {
            const pts = [...computePlanLayout(plan.rows, opts)
                .nodes.values()];
            for (let i = 0; i < pts.length; i += 1) {
                for (let j = i + 1; j < pts.length; j += 1) {
                    pairs += 1;
                    const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
                    expect(d, `${opts.stepLabel}: bead pair`)
                        .toBeGreaterThan(worstOuter + BEAD_HIT_RADIUS);
                }
            }
        }
        expect(pairs, 'bead pairs swept').toBeGreaterThan(100);
    });

    // THE CEILING IS THE SMALLEST OF THE CLEARANCES, and every one of them is
    // derived. A retuned constant anywhere in the module moves this number
    // rather than silently invalidating it.
    // THE TWO ASSERTIONS HERE THAT CAN ACTUALLY FAIL, and they are the pair
    // that would have caught both wrong ceilings: a DELETED clearance (the list
    // shrinking back toward the one-constraint answers), and a new TIGHT
    // clearance silently strangling the fix — 2.37 was the first ceiling tried
    // and it is below this floor. Re-deriving `MAX_OUTER` from
    // `min(clearances) - 1` here would only restate the three lines above it in
    // the source, so it is deliberately not asserted.
    it('takes its ceiling from the tightest clearance, derived not typed', () => {
        // FOUR since req #3371 removed the launch-unit box's three entries.
        // The floor is what it has always been: a list shrinking back toward a
        // one-constraint answer is the failure both wrong ceilings had.
        expect(Object.keys(NEXT_HALO_CLEARANCES).length).toBeGreaterThanOrEqual(4);
        expect(NEXT_HALO_MAX_MAGNIFY).toBeGreaterThan(1.8);
    });

    // req #3375 addition (code review of req #3331, 2026-08-07): the two
    // tests above and the ring→dot crossover test below all pin these
    // quantities by DERIVATION — self-consistent with the constants they are
    // built from, but silent if every input constant drifted together and
    // landed on a different plateau. This test pins the CEILING and its
    // downstream FLOOR by the VALUE the "with the box gone" rows cite —
    // memory/pipeline-2-visualizer-design.md § 2.2, which tabulates both the
    // ceiling and the derived floor (that section is where those figures live
    // now; pipeline-plan-visualizer.md, which stated them first, was deleted
    // at req #3356) — so a retune that is internally consistent but
    // lands away from the measured/documented numbers is still caught.
    // (Not a VIS-005 marker: this is the halo ceiling/floor cascade, unrelated
    // to the epic-scoped state-banding self-check VIS-005 names — see
    // TEST_PLAN.md for why VIS-005 is registered untestable, not covered here.)
    it('the raised ceiling and its downstream floor are MEASURED, not only '
        + 'self-consistent (req #3375, ONE ADDITION)', () => {
        // 33, not 30, since req #3365: `epicChipStrip` is the BINDING entry and
        // it is `MIN_CARD_H / 2` (it was `STEP_LABEL_RISE + BEAD_LANE_OFFSET` before req #3498 — the same 34, re-derived from the card), which grew by 3 when the
        // step label was lifted to clear a neighbour's bead hit circle. The
        // ceiling being DERIVED is the point — more room above a lane-0 bead is
        // more room the halo may use, without anyone re-tuning it.
        expect(NEXT_HALO_MAX_OUTER).toBeCloseTo(33, 6);
        expect(NEXT_HALO_MAX_MAGNIFY).toBeCloseTo(33 / 13.5, 10); // 2.444...x
        // `NEXT_MARK_SCREEN_RADIUS / NEXT_HALO_MAX_OUTER` — the two terms that
        // cancel in the invariant asserted below, which is exactly why a moving
        // ceiling moves this floor and leaves the SCREEN radius alone.
        expect(NEXT_MARK_FLOOR_K).toBeCloseTo(8.1 / 33, 6);
        // The flat-band lower edge (K_READABLE / M) — moves down with the same
        // ceiling, so the ring holds its full size over a wider range.
        expect(K_READABLE / NEXT_HALO_MAX_MAGNIFY).toBeCloseTo(0.8 / (33 / 13.5), 6);
        // NEXT_MARK_SCREEN_RADIUS is invariant across the ceiling move (the
        // OUTER and FLOOR_K terms cancel) — pinned here at the value the
        // design record calls out as the reason this is a note and not a
        // redesign.
        expect(NEXT_MARK_SCREEN_RADIUS).toBeCloseTo(8.1, 6);
    });

    it('is monotone — zooming out never shrinks the mark', () => {
        const ms = K_SWEEP.map((k) => nextHaloMagnify(k, false));
        for (let i = 1; i < ms.length; i += 1) {
            expect(ms[i], `k=${K_SWEEP[i]}`).toBeLessThanOrEqual(ms[i - 1]);
        }
    });

    it('falls back to 1 on a scale that is not a usable number', () => {
        for (const k of [0, -1, NaN, Infinity, -Infinity, undefined, null]) {
            expect(nextHaloMagnify(k, false), `k=${k}`).toBe(1);
        }
    });

    // THE MEASUREMENT THIS REQUIREMENT WAS FILED ON, as an assertion. Live
    // pipeline 2 renders 136 rows into a 3620px world, so kFit is 0.33–0.40 on
    // a 1200–1440px panel and kDefault is K_READABLE (0.8) — which puts the
    // plan's OPENING view at 'out', with k at or below the 0.4 ceiling the
    // level ladder gives that level. Before this fix the halo drew a 0.80px
    // stroke there; a sub-pixel dashed outline whose inner edge sat 0.1px from
    // the bead's own ring.
    it('turns the measured Overview scales into a mark that can be seen', () => {
        // The three scales that matter on the live plan: fit-to-width on a
        // 1200px and a 1440px panel (both level 'out'), and the ceiling of
        // 'out' itself.
        //
        // WHERE THE PLAN OPENS, again — after two corrections in opposite
        // directions. This originally said so; reviewing req #3280 found it
        // false, because `resetView` then landed on `kDefault` = 0.8 (ratio 1,
        // level 'mid') and these were the scales one wheel-click OUT of it. Req
        // #3312 moved the landing onto `factoryDefaultScale`, which is `<= kFit`
        // — the first two cases below. Nothing about the assertions ever
        // depended on the difference, which is why they survived both.
        const LIVE_WORLD_W = 3620.2;
        const kOutCeiling = K_READABLE * 0.5;            // 0.4, 'out' by definition
        const cases = [1200 / LIVE_WORLD_W, 1440 / LIVE_WORLD_W, kOutCeiling];
        for (const k of cases) {
            // No label is drawn at any of them — which is WHY the mark is free
            // to grow there, and is now asserted rather than assumed (req #3280
            // made the two the same question).
            expect(labelsLegible(k), `labels legible at k=${k}`).toBe(false);
            // What it used to be, at that same k: a sub-pixel dashed outline
            // whose inner edge sat a tenth of a pixel from the bead's own ring.
            expect(NEXT_HALO_STROKE * k, `old stroke px at k=${k}`).toBeLessThan(0.81);
            expect((innerAt(1) - BEAD_OUTER_RADIUS) * k, `old gap px at k=${k}`)
                .toBeLessThan(0.11);
            // What it is now — a dashed ring, clear of the bead.
            const m = nextHaloMagnify(k, false);
            expect(NEXT_HALO_STROKE * m * k, `stroke px at k=${k}`).toBeGreaterThan(1.3);
            expect(NEXT_HALO_RADIUS * m * k, `radius px at k=${k}`).toBeGreaterThan(8);
            expect(NEXT_HALO_DASH[0] * m * k, `dash px at k=${k}`).toBeGreaterThan(1.9);
            expect((innerAt(m) - BEAD_OUTER_RADIUS) * k, `gap px at k=${k}`)
                .toBeGreaterThan(3.5);
            // ...and enough circumference for the dashes to READ as dashes,
            // which is the whole reason the mark is dashed at all.
            const cycles = (2 * Math.PI * NEXT_HALO_RADIUS * m * k)
                / (NEXT_HALO_DASH[0] + NEXT_HALO_DASH[1]);
            expect(cycles, `dash cycles at k=${k}`).toBeGreaterThan(6);
        }
    });
});

// ── …AND IT HAS TO SURVIVE THE CROSSING TOO (req #3280) ─────────────────────
// #3271 fixed L1 under an instruction not to touch L2, and what that left is two
// defects rather than one: the sub-pixel mark it was filed to remove was still
// reachable — the whole band from k = 0.400 up to K_READABLE, i.e. everything
// between fit-to-width and the scale the plan LANDS on — and the mark HALVED
// crossing into it. Both come from the same place — the halo's bound was
// the LABEL PREDICATE, which is binary on a level derived from a RATIO, while
// legibility is ABSOLUTE. These cases pin the two questions being asked of ONE
// absolute scale.
describe('the next-step halo survives the level CROSSINGS (req #3280)', () => {
    const innerAt = (m) => (NEXT_HALO_RADIUS - NEXT_HALO_STROKE / 2) * m;
    // Live pipeline 2: 136 rows into a 3620.2px world, so `kFit` is 0.33–0.40 on
    // a 1200–1440px panel and `kDefault = max(kFit, K_READABLE)` is 0.8.
    const LIVE_WORLD_W = 3620.2;
    const LIVE_K_DEFAULT = K_READABLE;
    const LIVE_ZOOM_FLOOR = (1200 / LIVE_WORLD_W) * ZOOM_MIN_RATIO;
    // Every k the camera can reach on that plan, at a resolution fine enough to
    // see a one-wheel-click step: 600 samples over [floor, kDefault × 8].
    const REACHABLE = Array.from({ length: 601 }, (_, i) =>
        LIVE_ZOOM_FLOOR + (i / 600) * (LIVE_K_DEFAULT * ZOOM_MAX_RATIO - LIVE_ZOOM_FLOOR));

    // THE INVARIANT THE WHOLE FIX RESTS ON, and the one #3271 held by handing a
    // boolean across a module boundary. #3280 made it arithmetic — the labels
    // turned on at `K_READABLE` and the magnification off at `K_READABLE`, so no
    // caller could put a grown halo under a drawn label.
    //
    // REQ #3324 VOIDED THE ARITHMETIC AND THE ARGUMENT IS BACK. A PINNED level
    // draws its labels at every scale, so `k` alone no longer implies anything
    // about them — which is precisely the case #3280's own comment claimed a
    // level-derived predicate could not protect against, and it was right: the
    // protection is the ARGUMENT, and the arithmetic was only ever protecting
    // Auto. So the sweep asks over every level a MODE can produce, and asks the
    // magnification the way the renderer asks it.
    it('never magnifies at a scale where a label is drawn', () => {
        const KINDS = ['step', 'req', 'title'];
        const LEVELS = ['out', 'mid', 'in'];
        const bad = [];
        let drawn = 0;
        let pinnedBelowLegible = 0;
        for (const k of REACHABLE) {
            const ratio = k / LIVE_K_DEFAULT;
            // The FOUR MODES at this scale: three pins, and Auto's own answer.
            const modes = [
                ...LEVELS.map((lvl) => [`pin ${lvl}`, planLevelFor(lvl, ratio, k)]),
                ['auto', planLevelFor(null, ratio, k)],
            ];
            for (const [mode, level] of modes) {
                for (const kind of KINDS) {
                    if (!drawsLabelKind(kind, level)) continue;
                    drawn += 1;
                    // EXACTLY THE RENDERER'S CALL — `drawsKind('step')` is what
                    // `PipelinePlanVisualizer` hands both marks.
                    const labelsDrawn = drawsLabelKind('step', level);
                    const m = nextHaloMagnify(k, labelsDrawn);
                    if (m !== 1) {
                        bad.push(`${kind} drawn at ${mode}, k=${k.toFixed(4)}, m=${m}`);
                    }
                    // The DOT is bounded by the same question (req #3324): it
                    // holds a fixed SCREEN size, so in world units it is the
                    // largest this mark ever gets.
                    if (nextMarkIsDot(k, labelsDrawn)) {
                        bad.push(`${kind} drawn at ${mode}, k=${k.toFixed(4)}, dot`);
                    }
                    if (mode !== 'auto' && !labelsLegible(k)) pinnedBelowLegible += 1;
                }
            }
        }
        expect(bad.slice(0, 8)).toEqual([]);
        // Non-vacuity, three ways: the sweep must contain combinations that DRAW,
        // scales that would MAGNIFY, and — the case this argument exists for —
        // pinned levels drawing BELOW the legibility floor. Without the third,
        // deleting the argument would leave this sweep green.
        expect(drawn, 'kind × mode × k combinations that draw')
            .toBeGreaterThan(500);
        expect(REACHABLE.filter((k) => nextHaloMagnify(k, false) > 1).length)
            .toBeGreaterThan(20);
        expect(pinnedBelowLegible, 'pinned kinds drawn below K_READABLE')
            .toBeGreaterThan(20);
        // The ungated kinds keep drawing everywhere, at every level and scale —
        // the halo's clearances are what bound it against THEM, and a predicate
        // that started gating them would silently change what those clearances
        // are protecting.
        for (const level of LEVELS) {
            expect(drawsLabelKind('slot', level), `slot at ${level}`).toBe(true);
        }
    });

    // AND AUTO'S HALF IS STILL PURE ARITHMETIC (req #3324). The step #3280
    // deleted came from a boolean turning over during a WHEEL; that cannot
    // happen while the flag is a no-op everywhere Auto can reach, so this asserts
    // the no-op directly rather than inferring it from the docstring: wherever
    // AUTO draws a label, the UNFLAGGED magnification is already 1.
    it('is a no-op on the AUTO branch, so #3280\'s continuous meet stands', () => {
        let autoDraws = 0;
        for (const k of REACHABLE) {
            const level = planLevelFor(null, k / LIVE_K_DEFAULT, k);
            if (!drawsLabelKind('step', level)) continue;
            autoDraws += 1;
            expect(nextHaloMagnify(k, false), `unflagged m at k=${k.toFixed(4)}`).toBe(1);
            expect(nextMarkIsDot(k, false), `unflagged dot at k=${k.toFixed(4)}`).toBe(false);
        }
        expect(autoDraws, 'scales where AUTO draws the step label')
            .toBeGreaterThan(100);
    });

    // The LEVEL half is now the WHOLE of `drawsLabelKind` (req #3324) — one
    // condition, and it is the level. A pin therefore draws its own kinds at
    // every scale, and the legibility floor that used to be ANDed in here lives
    // on `planLevelFor`'s AUTO branch (asserted in its own describe below).
    it('is the ladder and nothing else, at every scale', () => {
        expect(['step', 'req', 'title'].filter((x) => drawsLabelKind(x, 'out')))
            .toEqual([]);
        expect(['step', 'req', 'title'].filter((x) => drawsLabelKind(x, 'mid')))
            .toEqual(['step', 'req']);
        expect(['step', 'req', 'title'].filter((x) => drawsLabelKind(x, 'in')))
            .toEqual(['step', 'req', 'title']);
        // THE REGRESSION, AS ONE ASSERTION: a pinned level draws the same set
        // deep in the old dead band as it does at the readable scale. This is
        // what "still broken" meant — all four chips drew one canvas here.
        for (const k of [LIVE_ZOOM_FLOOR, 0.2, 0.4, 0.799]) {
            expect(labelsLegible(k), `k=${k} is below the floor`).toBe(false);
            expect(['step', 'req', 'title']
                .filter((x) => drawsLabelKind(x, planLevelFor('mid', 1, k))),
            `pinned L2 at k=${k}`).toEqual(['step', 'req']);
            expect(['step', 'req', 'title']
                .filter((x) => drawsLabelKind(x, planLevelFor('in', 1, k))),
            `pinned L3 at k=${k}`).toEqual(['step', 'req', 'title']);
        }
    });

    // DEFECT 2, DIRECTLY. The L1/L2 boundary is `SEMANTIC_OUT_MAX × kDefault` —
    // 0.400 on the live plan — and one wheel-click either side of it took the
    // mark from 9.98px of radius to 4.99px. Stated as a bound on the STEP
    // between ADJACENT samples across the whole reachable range, so it catches a
    // discontinuity wherever one is introduced, not only at the boundary that
    // happened to have one.
    //
    // THE BOUND IS THE SAMPLE SPACING, not a tuned tolerance. The apparent
    // radius is `12.5 × m(k) × k`, and on each of the three branches its
    // log-slope in `k` is 0 or 1 — the mark either holds still or tracks the
    // zoom — so `|Δr| / r` can never exceed `Δk / k`. A tolerance chosen by hand
    // would have to be loose enough for the steepest branch and would then be
    // blind to a jump smaller than that; this one shrinks with the sweep.
    // Measured against the defect: the old mark HALVED at the boundary — 100%
    // of the smaller radius — where the bound there is 2.6%.
    //
    // THE `1e-9` IS NOT SLACK TO BE TIGHTENED. On two of the three branches
    // (`r = 25k` below the cap and `r = 12.5k` above K_READABLE) the apparent
    // radius tracks `k` exactly, so `rel` EQUALS `bound` and the case passes
    // only on that epsilon. That is the case at its most sensitive, not a fudge:
    // removing the epsilon reddens a correct implementation.
    it('changes size continuously — no crossing halves the mark', () => {
        const jumps = [];
        for (let i = 1; i < REACHABLE.length; i += 1) {
            const [a, b] = [REACHABLE[i - 1], REACHABLE[i]];
            const ra = NEXT_HALO_RADIUS * nextHaloMagnify(a, false) * a;
            const rb = NEXT_HALO_RADIUS * nextHaloMagnify(b, false) * b;
            const rel = Math.abs(rb - ra) / Math.min(ra, rb);
            const bound = (b - a) / a;
            if (rel > bound + 1e-9) {
                jumps.push(`k=${a.toFixed(4)}→${b.toFixed(4)}: ${ra}→${rb}`
                    + ` (${(rel * 100).toFixed(1)}% > ${(bound * 100).toFixed(1)}%)`);
            }
        }
        expect(jumps.slice(0, 8)).toEqual([]);
        // The sweep straddles the boundary the defect was at, or it is asserting
        // continuity over a range that never crosses anything.
        const kBoundary = SEMANTIC_OUT_MAX * LIVE_K_DEFAULT;
        expect(REACHABLE.some((k) => k < kBoundary)).toBe(true);
        expect(REACHABLE.some((k) => k > kBoundary && k < K_READABLE)).toBe(true);
        expect(REACHABLE.some((k) => k > K_READABLE)).toBe(true);
    });

    // The SAME continuity, asserted where the defect was measured rather than
    // over a sweep: the boundary itself, sampled one wheel-click apart. d3-zoom's
    // wheel factor is 2^(-deltaY/500) and the requirement's own table is a
    // 0.399/0.400 pair, so a tighter pair than any gesture can produce.
    it('crosses the measured L1/L2 boundary with no visible change', () => {
        const kBoundary = SEMANTIC_OUT_MAX * LIVE_K_DEFAULT;           // 0.400
        expect(kBoundary).toBeCloseTo(0.4, 10);
        expect(semanticLevel(0.399 / LIVE_K_DEFAULT)).toBe('out');
        expect(semanticLevel(0.400 / LIVE_K_DEFAULT)).toBe('mid');
        const px = (k) => ({
            radius: NEXT_HALO_RADIUS * nextHaloMagnify(k, false) * k,
            stroke: NEXT_HALO_STROKE * nextHaloMagnify(k, false) * k,
            dash: NEXT_HALO_DASH[0] * nextHaloMagnify(k, false) * k,
            gap: (innerAt(nextHaloMagnify(k, false)) - BEAD_OUTER_RADIUS) * k,
        });
        const below = px(0.399);
        const above = px(0.400);
        for (const key of Object.keys(below)) {
            expect(above[key] / below[key], `${key} across the boundary`)
                .toBeCloseTo(1, 2);
        }
        // And the requirement's own MEASURED row for the L2 side, which is what
        // it was filed on: 5.00px radius / 0.80px stroke / 1.20px dash / 0.10px
        // gap. Every one of them is now the L1 side's number instead.
        expect(above.radius).toBeCloseTo(10.0, 2);
        expect(above.stroke).toBeCloseTo(1.6, 2);
        expect(above.dash).toBeCloseTo(2.4, 2);
        expect(above.gap).toBeGreaterThan(4.5);
    });

    // DEFECT 1. The bottom of L2 — everything from the boundary up to the scale
    // the labels arrive at — is where the 0.80px stroke lived, and it is the
    // band #3271 was forbidden from touching. It is now flat: one apparent size
    // for the whole band, which is the size the mark has at the TOP of it.
    it('holds one apparent mark from the L1/L2 boundary to the labels', () => {
        const kBoundary = SEMANTIC_OUT_MAX * LIVE_K_DEFAULT;
        const band = REACHABLE.filter((k) => k >= kBoundary && k < K_READABLE);
        expect(band.length, 'the band is swept').toBeGreaterThan(5);
        for (const k of band) {
            const m = nextHaloMagnify(k, false);
            expect(NEXT_HALO_RADIUS * m * k, `radius px at k=${k}`)
                .toBeCloseTo(NEXT_HALO_SCREEN_RADIUS, 6);
            expect(NEXT_HALO_STROKE * m * k, `stroke px at k=${k}`)
                .toBeCloseTo(NEXT_HALO_STROKE * K_READABLE, 6);
            // The acceptance number, stated as itself.
            expect(NEXT_HALO_STROKE * m * k, `stroke px at k=${k}`)
                .toBeGreaterThanOrEqual(1.2);
            // ...and no label is drawn anywhere in it, so nothing is crossed.
            expect(labelsLegible(k), `labels at k=${k}`).toBe(false);
        }
        // The band's TOP is where the unmagnified mark takes over, at the same
        // size — the identity that makes the two branches meet.
        expect(NEXT_HALO_RADIUS * nextHaloMagnify(K_READABLE, false) * K_READABLE)
            .toBeCloseTo(NEXT_HALO_SCREEN_RADIUS, 10);
    });

    // The freeze scale is DERIVED from the legibility scale, not typed beside
    // it. A hand-tuned NEXT_HALO_SCREEN_RADIUS is precisely what put a step at
    // the top of the band, so the two are pinned to each other rather than to
    // their values.
    it('freezes at exactly the scale the labels turn on', () => {
        expect(NEXT_HALO_SCREEN_RADIUS).toBeCloseTo(NEXT_HALO_RADIUS * K_READABLE, 10);
        expect(labelsLegible(K_READABLE)).toBe(true);
        expect(labelsLegible(K_READABLE - 1e-9)).toBe(false);
        expect(nextHaloMagnify(K_READABLE, false)).toBe(1);
        expect(nextHaloMagnify(K_READABLE - 1e-9, false)).toBeCloseTo(1, 8);
    });

    // The predicate is measured on the SMALLEST required text and the module's
    // own 11px floor — no new number entered the module for this.
    it('is the 11px floor applied to the requirement ids, not a new constant', () => {
        expect(PLAN_VIZ_FONT.req * K_READABLE).toBeCloseTo(READABLE_MIN_PX, 10);
        // The step label is the bigger of the two gated kinds, so the same gate
        // never hides text the reader could have read while showing text they
        // could not.
        expect(PLAN_VIZ_FONT.label).toBeGreaterThan(PLAN_VIZ_FONT.req);
        expect(PLAN_VIZ_FONT.label * K_READABLE).toBeGreaterThan(READABLE_MIN_PX);
        for (const k of [0, -1, NaN, Infinity, -Infinity, undefined, null, '0.9']) {
            expect(labelsLegible(k), `k=${k}`).toBe(false);
        }
    });

    // THE READABLE SCALE IS ALWAYS LEGIBLE, at every plan size — which is the
    // whole of what `readableDefaultScale` promises, and what keeps this gate
    // and that floor one number rather than two that have to agree.
    //
    // **THIS IS NO LONGER A CLAIM ABOUT THE VIEW A PLAN OPENS IN**, and it was
    // titled as one until req #3312. The landing moved onto
    // `factoryDefaultScale` so that opening a plan and clicking Reset produce
    // the same viewport, and on a plan too tall to fit at `K_READABLE` that
    // landing IS below this gate — bare beads, no labels, exactly what Reset
    // has produced on those plans since req #3216. Every assertion below is
    // kept verbatim, because each one is a real property of
    // `readableDefaultScale` (still the ladder's anchor and the focus clamps'
    // base) — only the sentence they were sold under was retired. Re-titled
    // rather than deleted: the arithmetic is what a future reader needs, and
    // the retired claim is what stops them re-deriving it.
    //
    // ASKED OF `readableDefaultScale`, the function the renderer calls (req
    // #3280 review). The first draft rebuilt `Math.max(kFit, K_READABLE)` here
    // and asserted the result was `>= K_READABLE` — which is `max(a,b) >= b`,
    // an identity that asserted nothing. Hoisting the formula is what made it
    // reachable.
    it('never withholds the labels at the readable scale', () => {
        let bindingCases = 0;
        for (const worldW of [200, 800, 3620.2, 12000]) {
            for (const panelW of [800, 1200, 1440, 1800, 2560]) {
                const kFit = panelW / worldW;
                const where = `world ${worldW} panel ${panelW}`;
                expect(labelsLegible(readableDefaultScale(kFit)), where).toBe(true);
                // The plans where the floor is what raises it — i.e. where
                // `kFit` itself is NOT legible. Counted, so the sweep cannot
                // pass by containing only plans that are legible at
                // fit-to-width anyway.
                if (!labelsLegible(kFit)) bindingCases += 1;
            }
        }
        expect(bindingCases, 'plans whose fit-to-width is NOT legible')
            .toBeGreaterThan(4);
        // Ratio 1 is this scale, and the ladder is anchored on it — req #3168's
        // choice, kept by req #3312 even though the landing moved off it (see
        // the `curK / kDefault` comment in PipelinePlanVisualizer.jsx).
        expect(semanticLevel(1)).toBe('mid');
        // The guard, which is the other half of "always": a non-finite kFit
        // resolves to the floor instead of propagating NaN into every downstream
        // scale — and `kDefault` feeds `scaleExtent` and both focus clamps, so a
        // NaN here blanks the canvas with no error anywhere.
        for (const bad of [NaN, Infinity, undefined, null, '1.2']) {
            expect(readableDefaultScale(bad), `kFit=${bad}`).toBe(K_READABLE);
            expect(labelsLegible(readableDefaultScale(bad))).toBe(true);
        }
        // And it is fit-to-width whenever fit-to-width is already legible —
        // a floor, never an override (the req #3168 contract).
        expect(readableDefaultScale(2.5)).toBe(2.5);
        expect(readableDefaultScale(0.4)).toBe(K_READABLE);
    });

    // WHAT THIS COULD NOT REACH, as an assertion rather than as a note. The
    // clearance ceiling caps the halo's OUTER edge at NEXT_HALO_MAX_OUTER world
    // px; at the reachable zoom floor that whole edge is under three SCREEN px,
    // so a >= 1.2px stroke is not something a bigger ring can buy there — the
    // ring is smaller than the stroke it would need. The band needs a different
    // MARK, which is a design decision and a follow-on requirement, and this
    // case exists so the arithmetic is checked rather than remembered.
    it('cannot reach the deep zoom-out band, and says where it stops', () => {
        const strokePx = (k) => NEXT_HALO_STROKE * nextHaloMagnify(k, false) * k;
        // WHERE IT STOPS, found by SEARCHING the swept range rather than by
        // restating the algebra (review finding: the first draft computed
        // `1.2 / (STROKE × MAX_MAGNIFY)` and then asserted the predicate that
        // expression solves, which on the capped branch reduces to `k >= kHolds`
        // — the definition). A search over the samples can disagree with the
        // closed form, and if the branch structure ever changes it will.
        const holds = REACHABLE.filter((k) => strokePx(k) >= 1.2);
        const fails = REACHABLE.filter((k) => strokePx(k) < 1.2);
        expect(holds.length, 'scales that meet the acceptance stroke')
            .toBeGreaterThan(500);
        expect(fails.length, 'scales that do not — the band this cannot reach')
            .toBeGreaterThan(10);
        // It is a clean split, not a scatter: every failing sample is below
        // every holding one, so "below k ≈ 0.27" is the whole of the shortfall.
        //
        // THE SPLIT MOVED WITH THE CEILING (req #3371), and it moved because
        // the ceiling is DERIVED. Removing the launch-unit rectangle's three
        // entries from `NEXT_HALO_CLEARANCES` took `NEXT_HALO_MAX_MAGNIFY` from
        // 2.0x to 2.222x, and the acceptance stroke is met 10% further out as a
        // result: the band pinned here was k ≈ 0.30 and is now k ≈ 0.27. The
        // window is deliberately still narrow — a WIDE window would pass
        // whatever the ceiling became, which is the opposite of pinning it.
        expect(Math.max(...fails)).toBeLessThan(Math.min(...holds));
        // RE-PINNED at req #3365: the ceiling rose again (30 -> 33, the step
        // label's lift) and the split fell with it, k ~ 0.27 -> ~ 0.245. Same
        // mechanism, same narrow window — the window tracks the derivation
        // rather than replacing it.
        expect(Math.min(...holds)).toBeGreaterThan(0.24);
        expect(Math.min(...holds)).toBeLessThan(0.26);
        // THE PROOF that no ceiling under NEXT_HALO_MAX_OUTER could have closed
        // it: at the zoom floor the halo's ENTIRE outer edge is under three
        // screen px, so the ring is smaller than the stroke it would need. This
        // is the one assertion here that is about the geometry rather than about
        // `m`, and it is why the remainder is a follow-on and not a retune.
        expect(NEXT_HALO_MAX_OUTER * LIVE_ZOOM_FLOOR,
            'the halo\'s entire outer edge, in screen px, at the zoom floor')
            .toBeLessThan(3);
        // 0.405 at req #3365's ceiling, up from 0.365 — a tenth of a screen
        // pixel more of a stroke that is hopeless either way, which is the
        // claim. Loosened to 0.5 rather than re-pinned tight: this assertion is
        // about the ring being UNUSABLE down there, and a window narrow enough
        // to track the ceiling would fail for a reason that has nothing to do
        // with what it is testing.
        expect(strokePx(LIVE_ZOOM_FLOOR), 'stroke px at the zoom floor')
            .toBeLessThan(0.5);
        // Unchanged by this requirement, not regressed by it: below the ceiling
        // the mark was `4k` before and is `4k` now.
        for (const k of [LIVE_ZOOM_FLOOR, 0.15, 0.2, 0.25]) {
            expect(strokePx(k)).toBeCloseTo(
                NEXT_HALO_STROKE * NEXT_HALO_MAX_MAGNIFY * k, 10);
        }
    });

    // ── The follow-on: a different MARK below the band above (req #3299) ────
    // The case above proved WHERE the ring stops reading; this proves the
    // fix — a fixed-screen-size dot below that same floor, on the SAME
    // REACHABLE sweep and the SAME live-plan zoom floor, so both halves of the
    // story are measured against one sweep rather than two.
    describe('the deep-zoom-out DOT covers what the ring cannot (req #3299)', () => {
        const strokePx = (k) => NEXT_HALO_STROKE * nextHaloMagnify(k, false) * k;

        it('the dot band IS the band the ring cannot reach — found by '
            + 'SEARCHING the swept range, not by restating the closed form '
            + '(same discipline as the sibling case above)', () => {
            const unreadable = new Set(
                REACHABLE.filter((k) => strokePx(k) < NEXT_MARK_MIN_STROKE_PX));
            const dotted = new Set(REACHABLE.filter((k) => nextMarkIsDot(k, false)));
            expect(unreadable.size, 'ring-unreadable samples').toBeGreaterThan(10);
            expect(dotted.size, 'dot-drawn samples').toBe(unreadable.size);
            for (const k of unreadable) expect(dotted.has(k), `k=${k}`).toBe(true);
        });

        it('is derived from the ring\'s own acceptance floor, not chosen', () => {
            expect(NEXT_MARK_FLOOR_K).toBeCloseTo(
                NEXT_MARK_MIN_STROKE_PX / (NEXT_HALO_STROKE * NEXT_HALO_MAX_MAGNIFY), 10);
            // ~0.245 since req #3365 raised the magnification ceiling again
            // (30 -> 33) — see the sibling case above for why the number moved
            // and why the window stays tight around whatever the derivation
            // currently yields.
            expect(NEXT_MARK_FLOOR_K).toBeGreaterThan(0.24);
            expect(NEXT_MARK_FLOOR_K).toBeLessThan(0.26);
            // The formula only means what it claims to on the CAPPED branch
            // (`strokePx(k) = STROKE × MAX_MAGNIFY × k` there) — true only
            // while the floor itself sits below where the magnification caps
            // (`K_READABLE / NEXT_HALO_MAX_MAGNIFY`). If a future change moved
            // `K_READABLE` low enough to violate this, the floor would stop
            // meaning "where the ring drops under the acceptance stroke".
            expect(NEXT_MARK_FLOOR_K).toBeLessThan(K_READABLE / NEXT_HALO_MAX_MAGNIFY);
        });

        it('draws the ring at and above the floor, the dot only below it — '
            + 'the band req #3299 must not move', () => {
            const atOrAbove = REACHABLE.filter((k) => k >= NEXT_MARK_FLOOR_K);
            const below = REACHABLE.filter((k) => k < NEXT_MARK_FLOOR_K);
            expect(atOrAbove.length).toBeGreaterThan(0);
            expect(below.length).toBeGreaterThan(0);
            for (const k of atOrAbove) expect(nextMarkIsDot(k, false), `k=${k}`).toBe(false);
            for (const k of below) expect(nextMarkIsDot(k, false), `k=${k}`).toBe(true);
            // The exact boundary itself stays on the ring — `nextMarkIsDot` is
            // a strict `<`, so a camera parked exactly at the floor is not a
            // special case needing its own branch.
            expect(nextMarkIsDot(NEXT_MARK_FLOOR_K, false)).toBe(false);
        });

        it('holds the dot at a FIXED screen radius across the whole '
            + 'reachable deep-zoom-out range, including the live zoom floor', () => {
            const below = REACHABLE.filter((k) => nextMarkIsDot(k, false));
            expect(below.length, 'reachable samples below the floor')
                .toBeGreaterThan(10);
            for (const k of [...below, LIVE_ZOOM_FLOOR]) {
                expect(nextMarkDotRadius(k) * k, `dot screen radius at k=${k}`)
                    .toBeCloseTo(NEXT_MARK_SCREEN_RADIUS, 10);
            }
        });

        it('meets the ring\'s own outer edge AT the floor — no size jump '
            + 'crossing it, the same join `NEXT_HALO_SCREEN_RADIUS` makes at '
            + '`K_READABLE`', () => {
            const ringOuterAt = (k) => NEXT_HALO_MAX_OUTER * k; // capped branch
            expect(NEXT_MARK_SCREEN_RADIUS)
                .toBeCloseTo(ringOuterAt(NEXT_MARK_FLOOR_K), 10);
            // And therefore continuous across a fine sweep straddling it, not
            // just at the one named point — the gap shrinks WITH eps rather
            // than sitting under one fixed tolerance regardless of it, which
            // is what actually distinguishes "continuous" from "close enough
            // at the scale I happened to check".
            for (const eps of [0.01, 0.001, 0.0001]) {
                const above = ringOuterAt(NEXT_MARK_FLOOR_K + eps);
                const below = nextMarkDotRadius(NEXT_MARK_FLOOR_K - eps)
                    * (NEXT_MARK_FLOOR_K - eps);
                expect(Math.abs(above - below), `eps=${eps}`)
                    .toBeLessThan(NEXT_HALO_MAX_OUTER * eps * 1.01);
            }
        });

        it('never merges with the bead\'s own ring — clears it by at least '
            + 'the acceptance stroke at every k it draws at, including the '
            + 'top of its own band where the bead is largest', () => {
            const below = REACHABLE.filter((k) => nextMarkIsDot(k, false));
            expect(below.length).toBeGreaterThan(10);
            // The true worst case is the supremum of the dot's domain
            // (k -> NEXT_MARK_FLOOR_K from below, where the bead is largest)
            // — added explicitly rather than trusting a sample grid to land
            // on it, since `REACHABLE`'s nearest sample (k ~= 0.2934) is not
            // actually the tightest point.
            for (const k of [...below, LIVE_ZOOM_FLOOR, NEXT_MARK_FLOOR_K - 1e-9]) {
                const fringe = nextMarkDotRadius(k) * k - BEAD_OUTER_RADIUS * k;
                expect(fringe, `clearance to the bead at k=${k}`)
                    .toBeGreaterThanOrEqual(NEXT_MARK_MIN_STROKE_PX);
            }
        });

        it('is comfortably readable at the live zoom floor, where the ring '
            + 'was proved unreadable', () => {
            // The ring's entire outer edge was under 3 screen px there (the
            // sibling case above). The dot clears the ring's own acceptance
            // floor by a wide margin at the SAME k.
            expect(NEXT_MARK_SCREEN_RADIUS).toBeGreaterThan(NEXT_MARK_MIN_STROKE_PX);
            expect(nextMarkDotRadius(LIVE_ZOOM_FLOOR) * LIVE_ZOOM_FLOOR)
                .toBeCloseTo(NEXT_MARK_SCREEN_RADIUS, 10);
        });

        it('nextMarkDotRadius does not divide by zero on a bad k', () => {
            for (const bad of [NaN, 0, -1, Infinity]) {
                expect(Number.isFinite(nextMarkDotRadius(bad)), `k=${bad}`).toBe(true);
            }
            expect(nextMarkIsDot(NaN, false)).toBe(false);
            expect(nextMarkIsDot(0, false)).toBe(false);
            expect(nextMarkIsDot(-1, false)).toBe(false);
        });
    });
});

// `labelsDrawn` is REQUIRED on both functions (req #3374 P4) — a forgotten
// argument used to default to `false`, the permissive answer, and magnify a
// halo over its own drawn labels in silence. A second caller that forgets it
// now throws instead of drawing wrong.
describe('labelsDrawn is required, not defaulted (req #3374 P4)', () => {
    it('nextHaloMagnify throws when labelsDrawn is omitted or not a boolean', () => {
        expect(() => nextHaloMagnify(0.5)).toThrow(/labelsDrawn/);
        for (const bad of [undefined, null, 0, 1, 'false', 'true']) {
            expect(() => nextHaloMagnify(0.5, bad), `bad=${String(bad)}`).toThrow(/labelsDrawn/);
        }
        expect(() => nextHaloMagnify(0.5, false)).not.toThrow();
        expect(() => nextHaloMagnify(0.5, true)).not.toThrow();
    });

    it('nextMarkIsDot throws when labelsDrawn is omitted or not a boolean', () => {
        expect(() => nextMarkIsDot(0.1)).toThrow(/labelsDrawn/);
        for (const bad of [undefined, null, 0, 1, 'false', 'true']) {
            expect(() => nextMarkIsDot(0.1, bad), `bad=${String(bad)}`).toThrow(/labelsDrawn/);
        }
        expect(() => nextMarkIsDot(0.1, false)).not.toThrow();
        expect(() => nextMarkIsDot(0.1, true)).not.toThrow();
    });
});

describe('the pause status bubble (req #3226)', () => {
    const VIEWPORT = { w: 1500, h: 900 };

    it('pauseBubbleColor resolves the two measured swatches, never a third', () => {
        expect(pauseBubbleColor(false)).toBe(PAUSE_ACTIVE_COLOR);
        expect(pauseBubbleColor(true)).toBe(PAUSE_PAUSED_COLOR);
    });

    it('is legible on the panel — both swatches clear 4.5:1', () => {
        // MEASURED 2026-08-01: active 8.22:1, paused 5.41:1.
        expect(contrast(PAUSE_ACTIVE_COLOR, PLAN_VIZ_PALETTE.panel))
            .toBeGreaterThanOrEqual(4.5);
        expect(contrast(PAUSE_PAUSED_COLOR, PLAN_VIZ_PALETTE.panel))
            .toBeGreaterThanOrEqual(4.5);
    });

    it('does not collide with the reserved STEP-state hues (rule: one meaning, '
        + 'one colour)', () => {
        const reserved = [PLAN_VIZ_PALETTE.runningFill, PLAN_VIZ_PALETTE.runningRing,
            PLAN_VIZ_PALETTE.doneFill, PLAN_VIZ_PALETTE.doneRing];
        expect(reserved).not.toContain(PAUSE_ACTIVE_COLOR);
        expect(reserved).not.toContain(PAUSE_PAUSED_COLOR);
    });

    it('computePlanLayout: a band is paused when the WHOLE PLAN is paused — '
        + 'including the "No epic" band', () => {
        const layout = computePlanLayout(plan.rows,
            { pauseInfo: { pipelinePaused: true, pausedEpicIds: [] } });
        expect(layout.bands.length).toBeGreaterThan(0);
        expect(layout.bands.every((b) => b.paused === true)).toBe(true);
    });

    it('computePlanLayout: a band is paused when ITS OWN epic is paused, '
        + 'neighbours untouched', () => {
        const layout = computePlanLayout(plan.rows,
            { pauseInfo: { pipelinePaused: false, pausedEpicIds: [1] } });
        for (const band of layout.bands) {
            expect(band.paused).toBe(band.epicId === 1);
        }
    });

    it('defaults every band to unpaused when pauseInfo is omitted', () => {
        const layout = computePlanLayout(plan.rows);
        expect(layout.bands.every((b) => b.paused === false)).toBe(true);
    });

    it('placeEpicChips reserves EPIC_PAUSE_BUBBLE_W on every chip, '
        + 'unconditionally — the requirement\'s own "a bubble is width the '
        + 'label did not have before"', () => {
        const withBubble = placeEpicChips({
            bands: [{ key: 1, epicId: 1, epic: 'X'.repeat(20), color: '#fff',
                y: 8, height: 400, headerH: 46 }],
            transform: { x: 0, y: 0, k: 1 }, viewport: VIEWPORT, worldWidth: 3000,
        });
        // + EPIC_CHIP_OPEN_LINK_W since req #3257 (see the fallback test above).
        expect(withBubble[0].w).toBeCloseTo(20 * EPIC_CHIP_CHAR_W + 18
            + EPIC_CHIP_OPEN_LINK_W + EPIC_CHIP_CARDS_LINK_W + EPIC_PAUSE_BUBBLE_W, 6);
    });

    // "its rectangle belongs in the same label set the zero-overlap invariant
    // is already asserted against" — the requirement's own words. The chip's
    // OWN width (above) is what `placeEpicChips` displaces around; THIS rect
    // (`layout.labels`, kind 'epic') is what `assertNoLabelOverlap` actually
    // sweeps, and req #3225 set the precedent that the two must grow together.
    it('the kind:"epic" label rect ALSO carries the bubble reservation', () => {
        const layout = computePlanLayout(plan.rows);
        const epicLabels = layout.labels.filter((l) => l.kind === 'epic');
        expect(epicLabels.length).toBeGreaterThan(0);
        for (const label of epicLabels) {
            const band = layout.bands.find((b) => b.epicId === label.epicId);
            const bandText = band.epicLabel || band.epic;
            expect(label.w).toBeCloseTo(
                bandText.length * EPIC_CHIP_CHAR_W + EPIC_PAUSE_BUBBLE_W, 6);
        }
    });
});

describe('the dependency-arc stroke (req #3366)', () => {
    it('clears the 3:1 WCAG AA floor for graphical marks against the panel', () => {
        // MEASURED 2026-08-10: prior `#3d5a86` ~1.75:1 (the "too light"
        // complaint this brightened); `PLAN_VIZ_PALETTE.arc` ~3.80:1.
        expect(contrast(PLAN_VIZ_PALETTE.arc, PLAN_VIZ_PALETTE.panel))
            .toBeGreaterThanOrEqual(3);
    });
});

// ── The channel table matches the rendered key (req #3374 P3) ──────────────
// `COLOR_CHANNELS` is the header table in the module docblock, as data.
// `PipelinePlanVisualizer` reads its two `KeyGroup` titles from
// `KEY_GROUP_TITLES` rather than a hand-typed literal, so this test — which
// touches neither Konva nor React — is enough to catch the table and the
// on-screen key drifting apart: either one changing what it renders shows up
// here as soon as it changes what this module exports.
describe('the channel table and the on-screen key (req #3374 P3)', () => {
    it('keys only the channels marked inKey, in first-seen order', () => {
        expect(KEY_GROUP_TITLES).toEqual(['step', 'requirement']);
    });

    it('every inKey channel names a level KEY_GROUP_TITLES actually carries', () => {
        for (const c of COLOR_CHANNELS) {
            if (c.inKey) expect(KEY_GROUP_TITLES).toContain(c.level);
        }
    });

    it('epic identity is the one channel excluded from the key', () => {
        const epic = COLOR_CHANNELS.find((c) => c.level === 'epic');
        expect(epic).toBeDefined();
        expect(epic.inKey).toBe(false);
        expect(KEY_GROUP_TITLES).not.toContain('epic');
    });
});

// ── The colour language (req #3168, user directives 2026-08-01) ─────────────
//
// Colour resolution lives in the pure module precisely so it can be MEASURED
// here rather than eyeballed on a canvas. The two properties that matter are
// legibility on the panel and separability from each other; both are computed
// from the hex values, so a "nicer" hue that quietly collapses the scale fails
// the suite instead of shipping.

// sRGB relative luminance and WCAG contrast — the same arithmetic the machine
// pairing's recorded 5.78:1 / 3.8:1 came from.
const srgbLin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const channels = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    /* eslint-disable no-bitwise */
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    /* eslint-enable no-bitwise */
};
const luminance = (hex) => {
    const [r, g, b] = channels(hex).map(srgbLin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
};
// CIE76 ΔE — crude by modern standards and entirely adequate for "are these two
// swatches the same colour to a reader glancing at 13.75px type".
const toLab = (hex) => {
    const [r, g, b] = channels(hex).map((c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
const deltaE = (a, b) => {
    const A = toLab(a);
    const B = toLab(b);
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};
// HSL hue (degrees) and saturation (0-1) — standard colorsys-equivalent
// arithmetic, needed for the epic-palette guard below: WCAG contrast alone
// cannot tell "dark and vivid" from "dark and dirty", which is exactly the axis
// saturation measures.
const hueSat = (hex) => {
    const [r, g, b] = channels(hex).map((c) => c / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0 };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return { h, s };
};

describe('requirement-status colour scale (req #3168, directive 1)', () => {
    const PANEL = PLAN_VIZ_PALETTE.panel;

    it('covers every requirement status the schema defines, and nothing else', () => {
        // The vocabulary from root CLAUDE.md § Requirement statuses. A status
        // added server-side without a colour here would fall to the dim unknown
        // swatch, which is visible but wrong — so the set is pinned.
        expect(REQ_STATUS_ORDER).toEqual([
            'authoring', 'approved', 'swarm_ready', 'development',
            'met', 'deferred', 'wontfix',
        ]);
        expect(Object.keys(REQ_STATUS_COLORS).sort())
            .toEqual([...REQ_STATUS_ORDER].sort());
    });

    it('is legible on the panel — every swatch clears 4.5:1', () => {
        // MEASURED 2026-08-12: 4.78:1 (approved, the lowest) to 12.49:1
        // (development). The floor is WCAG AA for normal text; the ids render at
        // 13.75px, which is normal text. The low moved down from 6.13:1
        // (swarm_ready) when req #3365 gave `authoring` and `approved` the
        // autonomy scale's stop hues — those two now sit at 4.87 and 4.78, the
        // tightest margin on this scale and the reason this test is the one
        // that would catch a further darkening of either.
        for (const status of REQ_STATUS_ORDER) {
            const ratio = contrast(REQ_STATUS_COLORS[status], PANEL);
            expect(ratio, `${status} (${REQ_STATUS_COLORS[status]}) on ${PANEL}`)
                .toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(REQ_STATUS_UNKNOWN_COLOR, PANEL)).toBeGreaterThanOrEqual(4);
    });

    it('is separable — no two statuses read as the same colour', () => {
        // MEASURED minimum 37.8 (development vs deferred), 2026-08-12 — up
        // from 25.9 (approved vs wontfix) because req #3365 moved `approved`
        // off the pale blue that was its nearest neighbour. The floor stays at
        // 20: low enough not to fail on a nudge, high enough that a scale
        // collapsing two statuses into one hue cannot pass.
        let worst = { pair: null, d: Infinity };
        for (let i = 0; i < REQ_STATUS_ORDER.length; i++) {
            for (let j = i + 1; j < REQ_STATUS_ORDER.length; j++) {
                const a = REQ_STATUS_ORDER[i];
                const b = REQ_STATUS_ORDER[j];
                const d = deltaE(REQ_STATUS_COLORS[a], REQ_STATUS_COLORS[b]);
                if (d < worst.d) worst = { pair: `${a}/${b}`, d };
            }
        }
        expect(worst.d, `closest pair ${worst.pair}`).toBeGreaterThanOrEqual(20);
    });

    it('AGREES with the panel\'s own state hues where the two mean the same thing (req #3503)', () => {
        // The rule that keeps one meaning to one colour: a requirement in
        // `development` and a step deriving Running are the same fact at two
        // levels, so they are the same amber. `met` USED to agree with the
        // bead's own Complete hue (`doneRing`) the same way — req #3503
        // supersedes that: `met` now agrees with the AUTONOMY scale's
        // `deployed` instead (asserted in the "SHARES" test below, alongside
        // `authoring`/`approved`), a DIFFERENT green making a DIFFERENT
        // claim — "this shipped", not "this bead is done" — so it is no
        // longer one of the two state-hue agreements this test is about.
        expect(REQ_STATUS_COLORS.development).toBe(PLAN_VIZ_PALETTE.runningRing);
        // And the converse: no OTHER status may borrow a reserved state hue,
        // which is why Darwin's chip palette is not carried verbatim (its
        // `authoring` is a yellow and its `development` a green — on this panel
        // those read as Running and Complete). `met` is EXEMPTED here for a
        // different reason than `development` is: it borrows an AUTONOMY hue,
        // not a bead-state one, and happens not to collide with either —
        // checked directly in "SHARES", not by exclusion from this loop.
        const reserved = [PLAN_VIZ_PALETTE.runningFill, PLAN_VIZ_PALETTE.runningRing,
            PLAN_VIZ_PALETTE.doneFill, PLAN_VIZ_PALETTE.doneRing];
        for (const status of REQ_STATUS_ORDER) {
            if (status === 'development') continue;
            expect(reserved, `${status} must not borrow a state hue`)
                .not.toContain(REQ_STATUS_COLORS[status]);
        }
    });

    it('SHARES the autonomy scale\'s hues for the statuses it tracks (req #3365, extended req #3503)', () => {
        // req #3365 user directive: "authoring and approved should be the
        // colors like Discuss and Planned". req #3503 extends it: "same for
        // authoring and approved [as development], they should track too" —
        // and separately, "[met] should be... the color used for... Deployed".
        // Asserted as IDENTITY, not as proximity, because the whole point is
        // that these are the SAME values as their autonomy counterparts
        // rather than copies that drift the next time either scale is
        // touched — see REQ_STATUS_COLORS' own comment for the mechanism
        // (a patch assignment, not a hex literal, because `AUTONOMY_COLORS`
        // is declared later in the file).
        expect(REQ_STATUS_COLORS.authoring).toBe(AUTONOMY_COLORS.discuss);
        expect(REQ_STATUS_COLORS.approved).toBe(AUTONOMY_COLORS.planned);
        expect(REQ_STATUS_COLORS.met).toBe(AUTONOMY_COLORS.deployed);
        // `swarm_ready` and `development` stay their own, unrelated-scale
        // colours — the first two statuses req #3365 named as unchanged, and
        // req #3503 named no reason to touch. `development` is still pinned
        // here as a LITERAL (not `PLAN_VIZ_PALETTE.runningRing`) so this test
        // also catches its OWN colour moving, not just whether it still
        // agrees with whatever `runningRing` happens to be — the "AGREES"
        // test above is what checks the agreement itself.
        expect(REQ_STATUS_COLORS.swarm_ready).toBe('#4d9bff');
        expect(REQ_STATUS_COLORS.development).toBe('#ffd769');
    });

    it('falls back to the dim unknown swatch, INCLUDING inherited keys', () => {
        for (const status of REQ_STATUS_ORDER) {
            expect(reqStatusColor(status)).toBe(REQ_STATUS_COLORS[status]);
        }
        // Same hazard class as `isStepWidth`: a bracket lookup for an inherited
        // key returns a FUNCTION, and a function handed to Konva as a `fill`
        // paints nothing with no error anywhere.
        for (const bogus of ['constructor', 'toString', 'valueOf', 'hasOwnProperty',
            'closed', '', null, undefined, 0]) {
            expect(reqStatusColor(bogus), `status=${String(bogus)}`)
                .toBe(REQ_STATUS_UNKNOWN_COLOR);
        }
    });
});

describe('requirement mark stack order (req #3363, driven by the colour key req #3503)', () => {
    it('State sorts Authoring→Met — REQ_STATUS_ORDER itself, purple to green', () => {
        const statuses = {
            1: 'authoring', 2: 'approved', 3: 'swarm_ready', 4: 'development',
            5: 'met', 6: 'deferred', 7: 'wontfix',
        };
        const ids = [7, 6, 5, 4, 3, 2, 1];
        expect(sortReqIdsByColorKey(ids,
            { colorKey: 'state', statusOf: (id) => statuses[id] }))
            .toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('Autonomy sorts Discuss→Deployed — AUTONOMY_ORDER itself', () => {
        const autonomy = { 1: 'deployed', 2: 'implemented', 3: 'planned', 4: 'discuss' };
        const ids = [1, 2, 3, 4];
        expect(sortReqIdsByColorKey(ids,
            { colorKey: 'autonomy', autonomyOf: (id) => autonomy[id] }))
            .toEqual([4, 3, 2, 1]);
    });

    it('Machine sorts by its own ascending id — the legend\'s own order, unpinned last', () => {
        const machine = { 1: 30, 2: 10, 3: null, 4: 20 };
        const ids = [1, 2, 3, 4];
        expect(sortReqIdsByColorKey(ids,
            { colorKey: 'machine', machineOf: (id) => machine[id] }))
            .toEqual([2, 4, 1, 3]);
    });

    it('none falls back to State\'s ladder — there is no colour to sort by', () => {
        const statuses = { 1: 'met', 2: 'authoring' };
        expect(sortReqIdsByColorKey([1, 2],
            { colorKey: 'none', statusOf: (id) => statuses[id] }))
            .toEqual([2, 1]);
        // A colorKey the registry does not recognise normalizes to the default
        // ('state'), the same discipline `normalizeColorKey` applies everywhere
        // else it reads a persisted preference.
        expect(sortReqIdsByColorKey([1, 2],
            { colorKey: 'bogus', statusOf: (id) => statuses[id] }))
            .toEqual([2, 1]);
    });

    it('is stable within a rank — ties keep the caller\'s order', () => {
        // development (rank 3) now leads met (rank 4) under the State ladder
        // — the reverse of the retired met-first order — so the two
        // development ids surface first, each pair keeping the caller's order.
        const statuses = { 10: 'development', 11: 'met', 12: 'development', 13: 'met' };
        expect(sortReqIdsByColorKey([10, 11, 12, 13],
            { colorKey: 'state', statusOf: (id) => statuses[id] }))
            .toEqual([10, 12, 11, 13]);
    });

    it('sinks an unresolved value below every recognised member of the active ladder', () => {
        // wontfix (rank 6) is the LOWEST recognised State rank, so id 1 must
        // still lead both unresolved ids — an equals-input assertion here
        // would pass against a no-op sort and prove nothing.
        const statuses = { 1: 'wontfix', 2: 'bogus-status' };
        expect(sortReqIdsByColorKey([2, 3, 1],
            { colorKey: 'state', statusOf: (id) => statuses[id] }))
            .toEqual([1, 2, 3]);
        // No lookup at all — every id is equally unresolved, so the input
        // order survives untouched (the default accessors `reqIdSummary` — and
        // any caller that omits one — hand this function).
        expect(sortReqIdsByColorKey([3, 1, 2], { colorKey: 'state' })).toEqual([3, 1, 2]);
    });

    it('tolerates a non-array input the way every other reqIds consumer does', () => {
        expect(sortReqIdsByColorKey(null, { colorKey: 'state', statusOf: () => 'met' }))
            .toEqual([]);
        expect(sortReqIdsByColorKey(undefined, { colorKey: 'state', statusOf: () => 'met' }))
            .toEqual([]);
    });

    it('reqSortRank alone reproduces the whole State ladder, in order', () => {
        const ranks = REQ_STATUS_ORDER.map((status) =>
            reqSortRank(1, { colorKey: 'state', statusOf: () => status }));
        expect(ranks).toEqual(REQ_STATUS_ORDER.map((_, i) => i));
    });

    // The reordering itself happens ONE LEVEL UP, in `PipelinePlanVisualizer`'s
    // `rows` memo, which hands `computePlanLayout` a row whose `reqIds` is
    // ALREADY sorted (`sortReqIdsByColorKey` above is the whole of that logic).
    // What closes the loop is proving this module is a faithful PASS-THROUGH —
    // that it stacks/lists the 'req' marks in exactly the order `reqIds`
    // arrives in, never re-deriving an order of its own — in both req layouts.
    it('draws the "req" marks in the exact order reqIds arrives in — vertical', () => {
        const row = {
            id: 1, title: 's1', run: 'auto', state: 'pending',
            reqIds: [30, 10, 20], depIds: [], timeDeps: [],
            epicId: null, epic: null, epicLabels: [], featureLabels: [],
            machineLabels: [], machineLabel: '—',
        };
        const layout = computePlanLayout([row], { reqLayout: 'vertical' });
        const marks = layout.labels
            .filter((l) => l.kind === 'req' && l.stepId === 1)
            .sort((a, b) => a.y - b.y);
        expect(marks.map((m) => m.reqId)).toEqual([30, 10, 20]);
    });

    // ── THE 'horizontal' TWIN IS GONE, AND ASSERTED IN ITS PLACE ────────────
    // It passed `{ reqLayout: 'horizontal' }` — ignored since req #3498 — so it
    // was byte-identical to the vertical test above, and it sorted by `.x` where
    // every row now shares one `.x`, i.e. it passed only because `Array#sort` is
    // stable. It asserted nothing. What is worth asserting instead is the
    // property the card actually gives: the rows are one column, ordered
    // top-to-bottom, and a retired option cannot change that.
    it('stacks the rows in ONE left-aligned column, whatever a stale caller asks for', () => {
        const row = {
            id: 1, title: 's1', run: 'auto', state: 'pending',
            reqIds: [30, 10, 20], depIds: [], timeDeps: [],
            epicId: null, epic: null, epicLabels: [], featureLabels: [],
            machineLabels: [], machineLabel: '—',
        };
        const layout = computePlanLayout([row], { reqLayout: 'horizontal' });
        const marks = layout.labels
            .filter((l) => l.kind === 'req' && l.stepId === 1)
            .sort((a, b) => a.y - b.y);
        expect(marks.map((m) => m.reqId)).toEqual([30, 10, 20]);
        expect(new Set(marks.map((m) => m.x)).size).toBe(1);
        for (let i = 1; i < marks.length; i++) {
            expect(marks[i].y - marks[i - 1].y)
                .toBeCloseTo(REQ_LINE_H + REQ_ROW_GAP, 6);
        }
    });
});

describe('machine colour view (moved to the pure module, req #3168)', () => {
    it('resolves each ecosystem from the machine record, not from list position', () => {
        expect(machineEcosystem({ platform: 'darwin' })).toBe('mac');
        expect(machineEcosystem({ platform: 'win32' })).toBe('windows');
        expect(machineEcosystem({ title: 'WSL box' })).toBe('windows');
        expect(machineEcosystem({ hostname: 'some-mac-mini' })).toBe('mac');
        expect(machineEcosystem({ platform: 'linux' })).toBeNull();
        expect(machineEcosystem(undefined)).toBeNull();
    });

    it('gives a machine the SAME colour whatever else the plan uses', () => {
        const mac = { id: 2, title: 'Mac mini', platform: 'darwin' };
        const wsl = { id: 3, title: 'WSL', platform: 'win32' };
        const linux = { id: 9, title: 'Box', platform: 'linux' };
        const twoMachine = buildMachineColorView({
            requirements: [{ id: 1, machine_fk: 2 }, { id: 2, machine_fk: 3 }],
            machines: [mac, wsl],
        });
        const threeMachine = buildMachineColorView({
            requirements: [{ id: 1, machine_fk: 2 }, { id: 2, machine_fk: 3 },
                { id: 3, machine_fk: 9 }],
            machines: [mac, wsl, linux],
        });
        expect(twoMachine.colorOf(1)).toBe(MACHINE_MAC_COLOR);
        expect(threeMachine.colorOf(1)).toBe(MACHINE_MAC_COLOR);
        expect(twoMachine.colorOf(2)).toBe(MACHINE_WINDOWS_COLOR);
        expect(threeMachine.colorOf(2)).toBe(MACHINE_WINDOWS_COLOR);
        // A machine outside the pairing takes a hue that is neither.
        expect(threeMachine.colorOf(3)).toBe(MACHINE_FALLBACK_PALETTE[0]);
        expect(threeMachine.colorOf(3)).not.toBe(MACHINE_MAC_COLOR);
        expect(threeMachine.colorOf(3)).not.toBe(MACHINE_WINDOWS_COLOR);
    });

    it('reads an unpinned requirement, and an unknown one, as Any', () => {
        const view = buildMachineColorView({
            requirements: [{ id: 1, machine_fk: null }],
            machines: [{ id: 2, title: 'Mac mini', platform: 'darwin' }],
        });
        expect(view.colorOf(1)).toBe(MACHINE_ANY_COLOR);
        expect(view.colorOf(999)).toBe(MACHINE_ANY_COLOR);
        expect(view.legend).toEqual([
            { key: 'any', color: MACHINE_ANY_COLOR, label: 'Any' },
        ]);
    });

    it('keys the key on machines the plan USES, titled, lowest id first', () => {
        const view = buildMachineColorView({
            requirements: [{ id: 1, machine_fk: 3 }, { id: 2, machine_fk: 2 }],
            machines: [{ id: 2, title: 'Mac mini', platform: 'darwin' },
                { id: 3, title: 'WSL', platform: 'win32' },
                { id: 4, title: 'Unused', platform: 'linux' }],
        });
        expect(view.legend.map((e) => e.label)).toEqual(['Mac mini', 'WSL']);
        // An id with no machine row still gets a nameable entry rather than
        // dropping out of the key.
        const orphan = buildMachineColorView({
            requirements: [{ id: 1, machine_fk: 77 }], machines: [],
        });
        expect(orphan.legend).toEqual([
            { key: 77, color: MACHINE_FALLBACK_PALETTE[0], label: 'Machine 77' },
        ]);
    });

    it('is inert on an empty or absent model', () => {
        const view = buildMachineColorView();
        expect(view.legend).toEqual([]);
        expect(view.colorOf(1)).toBe(MACHINE_ANY_COLOR);
    });
});

describe('the AUTONOMY colour scale (req #3422)', () => {
    const PANEL = PLAN_VIZ_PALETTE.panel;

    it('covers every coordination_type the schema defines, and nothing else', () => {
        // The vocabulary from root CLAUDE.md § Requirement coordination_type. A
        // value added server-side without a colour here falls to the dim unknown
        // swatch — visible, but no longer on the ladder — so the set is pinned.
        expect(AUTONOMY_ORDER)
            .toEqual(['discuss', 'planned', 'implemented', 'deployed']);
        expect(Object.keys(AUTONOMY_COLORS).sort())
            .toEqual([...AUTONOMY_ORDER].sort());
    });

    it('is legible on the panel — every swatch clears 4.5:1', () => {
        // MEASURED 2026-08-09: 4.78:1 (planned, the lowest) to 8.73:1
        // (deployed). Same floor and same reason as the status scale: WCAG AA
        // for normal text, and the ids render at 13.75px.
        //
        // `planned` SITS CLOSE TO THE FLOOR ON PURPOSE — it is the wine the
        // stoplight directive asked for as a burgundy, and a burgundy is a
        // dark-ink-on-white colour: a true one (#800020) measures 1.59:1 here.
        // The darkest wine available on this panel is the ~4.6:1 band, so the
        // floor is what is holding the hue up, and a future "make it darker"
        // must move this assertion knowingly or not at all. (The constraint
        // travelled with the colour when the ramp shifted a rung, and survived
        // the nudge toward violet that raised it 4.62 -> 4.78.)
        for (const ct of AUTONOMY_ORDER) {
            const ratio = contrast(AUTONOMY_COLORS[ct], PANEL);
            expect(ratio, `${ct} (${AUTONOMY_COLORS[ct]}) on ${PANEL}`)
                .toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(AUTONOMY_UNKNOWN_COLOR, PANEL)).toBeGreaterThanOrEqual(4);
    });

    it('is separable — no two coordination types read as the same colour', () => {
        // MEASURED minimum 45.9 (planned vs implemented), against the same floor
        // of 20 the status scale is held to. The pair that used to be closest —
        // discuss vs planned, the two reds — is 61.4 since planned was nudged
        // toward the violet, so the scale's tightest step is now an ordinary
        // neighbouring pair rather than a near-collision.
        let worst = { pair: null, d: Infinity };
        for (let i = 0; i < AUTONOMY_ORDER.length; i++) {
            for (let j = i + 1; j < AUTONOMY_ORDER.length; j++) {
                const a = AUTONOMY_ORDER[i];
                const b = AUTONOMY_ORDER[j];
                const d = deltaE(AUTONOMY_COLORS[a], AUTONOMY_COLORS[b]);
                if (d < worst.d) worst = { pair: `${a}/${b}`, d };
            }
        }
        expect(worst.d, `closest pair ${worst.pair}`).toBeGreaterThanOrEqual(20);
    });

    it('BORROWS NO STATE HUE — an autonomy colour may not read as a step state', () => {
        // Asserted by DISTANCE rather than by inequality, because "not the same
        // hex" would happily pass a near-identical green — and since the
        // stoplight directive (2026-08-09) `deployed` IS a green, so this is the
        // assertion actually holding it apart from Complete rather than a
        // formality.
        //
        // MEASURED nearest: 26.4 (deployed #39d353 vs doneRing #7ee08a). That is
        // the widest gap any recognisable green achieves against this panel's
        // Complete green — #00c853 reaches 25.9 and every other candidate
        // measured 9-19 — so the floor of 25 is close to the ceiling of what is
        // available, deliberately. A greener `deployed` fails here, which is the
        // point: the user accepted this collision knowing it was one, and the
        // test is what stops it widening by accident.
        //
        // Darwin's own coordination palette is still refused for its OTHER half:
        // CalendarFC COORDINATION_COLORS paints `implemented` yellow, which on
        // this panel is Running.
        const reserved = {
            runningFill: PLAN_VIZ_PALETTE.runningFill,
            runningRing: PLAN_VIZ_PALETTE.runningRing,
            doneFill: PLAN_VIZ_PALETTE.doneFill,
            doneRing: PLAN_VIZ_PALETTE.doneRing,
        };
        for (const ct of AUTONOMY_ORDER) {
            for (const [name, hex] of Object.entries(reserved)) {
                expect(deltaE(AUTONOMY_COLORS[ct], hex),
                    `${ct} (${AUTONOMY_COLORS[ct]}) vs ${name} (${hex})`)
                    .toBeGreaterThanOrEqual(25);
            }
        }
    });

    it('falls back to the dim unknown swatch, INCLUDING inherited keys', () => {
        for (const ct of AUTONOMY_ORDER) {
            expect(autonomyColor(ct)).toBe(AUTONOMY_COLORS[ct]);
        }
        for (const bogus of ['constructor', 'toString', 'valueOf', 'hasOwnProperty',
            'DEPLOYED', '', null, undefined, 0]) {
            expect(autonomyColor(bogus), `coordination_type=${String(bogus)}`)
                .toBe(AUTONOMY_UNKNOWN_COLOR);
        }
    });
});

describe('the SCALE REGISTRY (req #3422)', () => {
    it('describes every scale COMPLETELY — no consumer has to know one by name', () => {
        // The registration system's whole claim: one entry is everything the
        // toolbar, the canvas and the key need. A scale added with a field
        // missing renders a blank chip or an untitled key, which is exactly the
        // failure this asserts away.
        // ORDER IS THE TOOLBAR'S ORDER and it is the user's (req #3365):
        // State, Autonomy, Machine. Asserted here rather than in a component
        // test because the registry is the ONE place it is stated — the
        // toolbar and the on-screen key both map this array and neither sorts.
        expect(REQ_COLOR_SCALES.map((s) => s.key))
            .toEqual(['state', 'autonomy', 'machine']);
        for (const s of REQ_COLOR_SCALES) {
            for (const field of ['key', 'chipLabel', 'chipTip', 'chipName', 'keyTitle']) {
                expect(typeof s[field], `${s.key}.${field}`).toBe('string');
                expect(s[field].length, `${s.key}.${field}`).toBeGreaterThan(0);
            }
            expect(typeof s.build, `${s.key}.build`).toBe('function');
            // WCAG 2.5.3 "Label in Name" — MUI's Tooltip makes the accessible
            // name load-bearing, so a speech user asking for the visible word
            // must reach the chip they can see.
            expect(s.chipName.startsWith(s.chipLabel),
                `${s.key}: chipName must start with chipLabel`).toBe(true);
            // Every chip teaches the neutral position, which is reachable only
            // by clicking the pressed chip and is discoverable from no chip's
            // label.
            expect(s.chipTip, `${s.key}.chipTip`).toContain('click again for none');
        }
        // `none` is NOT a registry entry — it is the absence of a scale.
        expect(reqColorScale('none')).toBeUndefined();
        expect(reqColorScale('state').keyTitle).toBe('Requirement id = status');
    });

    it('is the SOURCE of the key positions, not a parallel copy', () => {
        expect(REQ_COLOR_KEYS).toEqual(['state', 'autonomy', 'machine', 'none']);
        // The stored preference's whole vocabulary is the registry plus `none` —
        // there is no second list to keep in step (the `COLOR_KEY_LABELS` object
        // that used to be one is gone; nothing rendered it).
        for (const s of REQ_COLOR_SCALES) expect(isColorKey(s.key)).toBe(true);
        expect(isColorKey('none')).toBe(true);
        expect(REQ_COLOR_KEYS).toHaveLength(REQ_COLOR_SCALES.length + 1);
    });

    it('builds every scale from ONE pass over the plan\'s own rows', () => {
        const requirements = [
            { id: 1, requirement_status: 'met', machine_fk: 2, coordination_type: 'deployed' },
            { id: 2, requirement_status: 'development', machine_fk: null,
                coordination_type: 'discuss' },
            // Present in the model, NOT drawn by the plan — so it colours if
            // asked, and contributes no key entry.
            { id: 3, requirement_status: 'wontfix', machine_fk: 3,
                coordination_type: 'planned' },
        ];
        const machines = [{ id: 2, title: 'Mac mini', platform: 'darwin' },
            { id: 3, title: 'WSL', platform: 'win32' }];
        const views = buildReqColorViews({
            requirements, machines, presentReqIds: new Set([1, 2]),
        });
        // Read from the ACTIVE theme, never from the Signal constants: the
        // default moved to Aurora at req #3365 and a test naming those constants
        // would be asserting a palette the canvas no longer draws.
        const PAL = planPalette(DEFAULT_PLAN_PALETTE);
        expect(Object.keys(views)).toEqual(['state', 'autonomy', 'machine']);
        expect(views.state.colorOf(1)).toBe(PAL.status.met);
        expect(views.state.colorOf(3)).toBe(PAL.status.wontfix);
        expect(views.state.legend.map((e) => e.key)).toEqual(['development', 'met']);
        // The MACHINE scale is NOT themed — its colours are keyed on a machine's
        // PLATFORM and named from the machine record, which is a fact about the
        // fleet rather than an aesthetic. Asserted here so a future theme cannot
        // quietly absorb it.
        expect(views.machine.colorOf(1)).toBe(MACHINE_MAC_COLOR);
        expect(views.machine.colorOf(2)).toBe(MACHINE_ANY_COLOR);
        expect(views.autonomy.colorOf(1)).toBe(PAL.autonomy.deployed);
        expect(views.autonomy.colorOf(2)).toBe(PAL.autonomy.discuss);
        // LADDER ORDER, not the order the requirements arrived in.
        expect(views.autonomy.legend.map((e) => e.key)).toEqual(['discuss', 'deployed']);
        expect(views.autonomy.legend.map((e) => e.color))
            .toEqual([PAL.autonomy.discuss, PAL.autonomy.deployed]);
    });

    it('names a value it does not know, and a requirement it never received', () => {
        const views = buildReqColorViews({
            requirements: [{ id: 1, requirement_status: 'met', coordination_type: 'met' }],
            presentReqIds: new Set([1, 99]),
        });
        // A drawn id with no requirement row is UNKNOWN, not absent — the same
        // rule the status scale has always followed.
        expect(views.autonomy.legend.map((e) => e.key)).toEqual(['unknown']);
        expect(views.autonomy.legend[0].color).toBe(AUTONOMY_UNKNOWN_COLOR);
        expect(views.state.legend.map((e) => e.key)).toEqual(['met', 'unknown']);
        expect(views.state.colorOf(99)).toBe(REQ_STATUS_UNKNOWN_COLOR);
    });

    it('lists every value when no plan filter is given, and is inert on nothing', () => {
        const views = buildReqColorViews({
            requirements: [{ id: 1, coordination_type: 'planned' },
                { id: 2, coordination_type: 'implemented' }],
        });
        expect(views.autonomy.legend.map((e) => e.key)).toEqual(['planned', 'implemented']);
        const empty = buildReqColorViews();
        expect(empty.autonomy.legend).toEqual([]);
        expect(empty.machine.legend).toEqual([]);
        expect(empty.autonomy.colorOf(1)).toBe(AUTONOMY_UNKNOWN_COLOR);
    });

    it('does NOT filter the machine key by what the plan draws', () => {
        // Deliberate asymmetry, asserted so it cannot be "fixed" silently: a
        // machine's key entry is named from the machine record and its colour is
        // keyed on the PLATFORM, so the entry set must not change as the level
        // ladder hides and shows marks.
        const views = buildReqColorViews({
            requirements: [{ id: 1, machine_fk: 2 }, { id: 2, machine_fk: 3 }],
            machines: [{ id: 2, title: 'Mac mini', platform: 'darwin' },
                { id: 3, title: 'WSL', platform: 'win32' }],
            presentReqIds: new Set([1]),
        });
        expect(views.machine.legend.map((e) => e.label)).toEqual(['Mac mini', 'WSL']);
    });
});

describe('the colour key — N scales plus NONE (req #3168 directive 3, req #3422)', () => {
    // The key renders what the CANVAS draws, so it is asserted against the
    // ACTIVE theme rather than against the module constants (req #3365 moved
    // the default off them).
    const ACTIVE = planPalette(DEFAULT_PLAN_PALETTE);
    const views = buildReqColorViews({
        requirements: [
            { id: 1, requirement_status: 'development', machine_fk: 2,
                coordination_type: 'implemented' },
            { id: 2, requirement_status: 'met', machine_fk: null,
                coordination_type: 'deployed' },
            { id: 3, requirement_status: 'swarm_ready', machine_fk: null,
                coordination_type: 'discuss' },
        ],
        machines: [{ id: 2, title: 'Mac mini', platform: 'darwin' }],
        presentReqIds: new Set([1, 2, 3]),
    });

    it('has one position per registered scale plus none, and defaults to state', () => {
        expect([...REQ_COLOR_KEYS].sort())
            .toEqual(['autonomy', 'machine', 'none', 'state']);
        expect(DEFAULT_COLOR_KEY).toBe('state');
        for (const v of REQ_COLOR_KEYS) expect(isColorKey(v)).toBe(true);
    });

    it('survives a pre-existing stored preference — state and machine still mean themselves',
        () => {
            // The values a reader's browser already holds from before the
            // neutral position and the autonomy scale existed. Normalizing them
            // to anything else would silently change an existing plan's
            // appearance.
            expect(normalizeColorKey('state')).toBe('state');
            expect(normalizeColorKey('machine')).toBe('machine');
            expect(normalizeColorKey('none')).toBe('none');
        });

    it('survives a garbage or localStorage-injected value, INHERITED KEYS INCLUDED', () => {
        // The `isStepWidth` hazard, on a value that ends up as a Konva `fill`.
        for (const bogus of ['constructor', 'toString', 'valueOf', '__proto__',
            'hasOwnProperty', 'STATE', 'none ', 'Autonomy', '', null, undefined, 0, {}, []]) {
            expect(isColorKey(bogus), `isColorKey(${String(bogus)})`).toBe(false);
            expect(normalizeColorKey(bogus), `normalizeColorKey(${String(bogus)})`)
                .toBe(DEFAULT_COLOR_KEY);
        }
    });

    it('resolves the id style per key — and NEUTRAL is near-white, not black', () => {
        expect(reqIdStyle({ colorKey: 'state', views, reqId: 1 }))
            .toEqual({ fill: ACTIVE.status.development, bold: true });
        expect(reqIdStyle({ colorKey: 'machine', views, reqId: 1 }))
            .toEqual({ fill: MACHINE_MAC_COLOR, bold: true });
        expect(reqIdStyle({ colorKey: 'autonomy', views, reqId: 2 }))
            .toEqual({ fill: ACTIVE.autonomy.deployed, bold: true });
        // THE LIGHT-MODE FINDING, pinned rather than commented: this panel is a
        // FIXED dark surface in both app themes (PLAN_VIZ_PALETTE is not
        // theme-derived and the container paints `panel` unconditionally), so
        // "white, or black in white mode" has exactly one reachable answer here.
        expect(reqIdStyle({ colorKey: 'none', views, reqId: 1 }))
            .toEqual({ fill: PLAN_VIZ_PALETTE.text, bold: false });
        expect(luminance(PLAN_VIZ_PALETTE.text))
            .toBeGreaterThan(luminance(PLAN_VIZ_PALETTE.panel));
        // A hostile key falls to the default rather than painting nothing.
        expect(reqIdStyle({ colorKey: 'constructor', views, reqId: 2 }).fill)
            .toBe(ACTIVE.status.met);
        // …and so does a call with no views at all: an undefined `fill` is
        // painted by Konva as nothing, with no error anywhere.
        expect(reqIdStyle().fill).toBe(REQ_STATUS_UNKNOWN_COLOR);
        expect(reqIdStyle({ colorKey: 'autonomy' }).fill).toBe(REQ_STATUS_UNKNOWN_COLOR);
    });

    it('builds a key that lists only the values the plan CONTAINS, in scale order', () => {
        const state = reqIdKeyEntries({ colorKey: 'state', views });
        expect(state.title).toBe('Requirement id = status');
        expect(state.entries.map((e) => e.key))
            .toEqual(['swarm_ready', 'development', 'met']);
        expect(state.entries.map((e) => e.label))
            .toEqual(['swarm-ready', 'development', 'met']);
        expect(state.entries.map((e) => e.color)).toEqual([
            ACTIVE.status.swarm_ready,
            ACTIVE.status.development,
            ACTIVE.status.met,
        ]);
    });

    it('switches wholesale to the machine and autonomy keys, and says so on none', () => {
        expect(reqIdKeyEntries({ colorKey: 'machine', views })).toEqual({
            title: 'Requirement id = machine', entries: views.machine.legend,
        });
        const autonomy = reqIdKeyEntries({ colorKey: 'autonomy', views });
        expect(autonomy.title).toBe('Requirement id = autonomy');
        expect(autonomy.entries.map((e) => e.label))
            .toEqual(['discuss', 'implemented', 'deployed']);
        const off = reqIdKeyEntries({ colorKey: 'none', views });
        expect(off.entries).toHaveLength(1);
        expect(off.entries[0].color).toBe(PLAN_VIZ_PALETTE.text);
        expect(off.entries[0].label).toBe('no colour key');
        // And a hostile key does not produce an empty, meaningless legend.
        expect(reqIdKeyEntries({ colorKey: 'toString', views }).title)
            .toBe('Requirement id = status');
        expect(reqIdKeyEntries()).toEqual({ title: 'Requirement id = status', entries: [] });
    });

    it('draws the key from the SAME view the canvas paints from', () => {
        // The one invariant that makes a key a key: every entry's colour is the
        // colour a mark under that scale actually receives. Asserted across
        // every registered scale, so a new one cannot ship with a key that
        // disagrees with the canvas.
        for (const scale of REQ_COLOR_SCALES) {
            const { entries } = reqIdKeyEntries({ colorKey: scale.key, views });
            const painted = new Set([1, 2, 3].map(
                (id) => reqIdStyle({ colorKey: scale.key, views, reqId: id }).fill));
            for (const e of entries) {
                expect(painted, `${scale.key}: key entry ${e.key} is painted somewhere`)
                    .toContain(e.color);
            }
            expect(entries.length, `${scale.key}: the key covers every painted colour`)
                .toBe(painted.size);
        }
    });
});

describe("the KEY is a keep-out: what it costs the epic labels (req #3168, re-measured #3257)", () => {
    const layout = computePlanLayout(plan.rows,
        { reqLayout: 'vertical', stepLabel: 'title' });
    const VIEWPORT = { w: 1500, h: 900 };

    // The complete key (directive 2) is capped on HEIGHT, not width, since req
    // #3374 P6 — see `PLAN_KEY_MAX_H`. These sizes bracket what it can actually
    // be: collapsed (just the toggle button — the default state since req
    // #3309, and the panel's own `minWidth`/`minHeight` floor), the ordinary
    // expanded key, at the height cap with a typical width, and the worst case
    // (a machine key on a many-machine plan — WIDE, since #3371/#3373 left the
    // key's two groups with no way to grow taller than the cap, only wider).
    const KEY_SIZES = [
        { w: 32, h: 28, label: 'collapsed (default since req #3309)' },
        { w: 300, h: 76, label: 'expanded, state key' },
        { w: 300, h: PLAN_KEY_MAX_H, label: 'expanded, at the height cap' },
        { w: 900, h: PLAN_KEY_MAX_H, label: 'worst case — many machines, wide, at the height cap' },
    ];

    it('never lets a chip land under the key, at any key size, zoom or pan', () => {
        let checked = 0;
        for (const size of KEY_SIZES) {
            const keepOut = { x: (VIEWPORT.w - size.w) / 2,
                y: VIEWPORT.h - 12 - size.h, w: size.w, h: size.h };
            for (const k of [0.07, 0.2, 0.5, 0.8, 1.5]) {
                for (const y of [0, -150, -900]) {
                    for (const x of [0, -400, 600, 1200]) {
                        const chips = placeEpicChips({
                            bands: layout.bands, transform: { x, y, k },
                            viewport: VIEWPORT, worldWidth: layout.width, keepOut,
                        });
                        for (const chip of chips) {
                            checked++;
                            expect(rectsOverlap(chip, keepOut),
                                `chip "${chip.text}" under the ${size.label} key `
                                + `at k=${k} x=${x} y=${y}`).toBe(false);
                        }
                    }
                }
            }
        }
        // A pass that drew nothing would satisfy the loop above. 311 chips are
        // checked; the floor is well under that so it fails on a collapse.
        expect(checked, 'the sweep checked real chips').toBeGreaterThan(200);
    });

    it('costs names by CLIPPING or DROPPING them, NEVER by moving them out of '
        + 'their own rectangles', () => {
        // The mechanism, asserted rather than described (req #3257). Under
        // #3168 a chip that met the key slid sideways; a name now belongs to its
        // band's rectangle, so the key may only take WIDTH off it or take it
        // away entirely. Every surviving chip must therefore sit at exactly the
        // x it would have had with no key at all.
        let checked = 0;
        for (const size of KEY_SIZES) {
            const keepOut = { x: (VIEWPORT.w - size.w) / 2,
                y: VIEWPORT.h - 12 - size.h, w: size.w, h: size.h };
            for (const k of [0.2, 0.5, 0.8, 1.5]) {
                for (const y of [0, -150, -900]) {
                    for (const x of [0, -400, 600, 1200]) {
                        const args = { bands: layout.bands, transform: { x, y, k },
                            viewport: VIEWPORT, worldWidth: layout.width };
                        const bare = new Map(
                            placeEpicChips(args).map((c) => [c.key, c]));
                        for (const chip of placeEpicChips({ ...args, keepOut })) {
                            checked++;
                            const was = bare.get(chip.key);
                            expect(was, `the ${size.label} key CREATED a chip`).toBeTruthy();
                            expect(chip.x, `"${chip.text}" moved sideways to dodge the `
                                + `${size.label} key at k=${k} x=${x} y=${y}`)
                                .toBeCloseTo(was.x, 6);
                            expect(chip.y).toBeCloseTo(was.y, 6);
                            expect(chip.w).toBeLessThanOrEqual(was.w + 1e-9);
                        }
                    }
                }
            }
        }
        expect(checked, 'the sweep checked real chips').toBeGreaterThan(200);
    });

    // ── WHAT THE KEY COSTS, RE-MEASURED (req #3257, then req #3374 P6) ─────
    // THE OLD INVARIANT IS FALSE AND IS NOT CARRIED FORWARD. Until #3257 this
    // block asserted "the key's WIDTH is its entire cost to the epic labels; its
    // HEIGHT is free", and the mechanism was displacement: a chip that met the
    // key slid sideways, so a taller key only changed WHICH chips moved. Under
    // clip-or-drop a taller key exposes more band rows to it, and those chips
    // have nowhere to go.
    //
    // RE-MEASURED AGAIN once req #3255 moved the key to BOTTOM-CENTER, and
    // AGAIN by req #3374 P6 once #3371/#3373 emptied the key's launch-unit and
    // epic-band rows — each move changed the magnitude, and the #3255 move
    // changed WHICH AXIS IS STEEPER, so the numbers could not simply be carried
    // forward either time. MEASURED 2026-08-10 on the Substrate fixture
    // (1500×900 panel), over k ∈ {0.2, 0.35, 0.5, 0.8, 1.2, 1.5, 2} ×
    // y ∈ {0, −150, −500, −900} × x ∈ 0…1400 step 50, on the OLD table's own
    // w/h ranges so this and the pre-P6 numbers stay comparable:
    //
    //   at w=470:   h  30    60   100   140   180
    //               dropped  33    33    44    66    77
    //
    //   at h=30:    w  90   300   420   470   600   900  1100
    //               dropped   9    21    30    33    39    57    69
    //
    // RE-MEASURED 2026-08-12 (req #3365). Two things moved and only one of them
    // is the key: every band gained 46px of header so the epic name could have
    // its own lane, AND the pan sweep above stopped being four hard-coded
    // offsets and became a function of the world's height. The second is why
    // these numbers are not comparable to the rows above — a denser sweep over
    // a taller world visits more (k, y) pairs — so the table is REPLACED rather
    // than appended to, and what carries forward is the SHAPE, not the counts:
    //
    //   at w=470:   h  30    60   100   140   180
    //               dropped  11    11    55    66   110
    //
    //   at h=30:    w  90   300   420   470   600   900  1100
    //               dropped   3     7    10    11    13    19    23
    //
    // Height is still the steeper axis by a wide margin — 99 dropped across the
    // 150px height range against 8 across the 810px width range from the same
    // base, which is ~67x steeper per pixel (it was ~5x under the old sweep).
    // `PLAN_KEY_MAX_H` still caps the steeper axis, which is the decision these
    // three tests exist to protect.
    //
    // The absolute counts moved from the 2026-08-02 table (11→33, 23→69 — a
    // different fixture shape, a shorter key) but the SLOPE — what "steeper
    // axis" actually means — still favours height: 44 dropped over the 150px
    // height range (≈0.29/px) against 60 over the 1010px width range
    // (≈0.06/px), roughly 5x steeper per pixel. `PLAN_KEY_MAX_H` (renamed from
    // `PLAN_KEY_MAX_W`) caps that steeper axis now; width is deliberately
    // uncapped. Full derivation of the cap's own value in
    // `pipelinePlanLayout.js` above `PLAN_KEY_MAX_H`.
    // ONE sweep, two key positions. `topRight` below used to run its own
    // hand-written pan list while `costOf` ran a derived one, so the
    // comparison between them measured the two SWEEPS as much as the two
    // key placements — and it broke the moment req #3365 changed one of
    // them. The keep-out rect is the only thing that varies now.
    const sweepDrops = (keepOutOf) => {
        let dropped = 0;
        for (const k of [0.2, 0.35, 0.5, 0.8, 1.2, 1.5, 2]) {
            // ── THE PAN SWEEP IS DERIVED FROM THE WORLD (req #3365) ─────────
            // It was the fixed list [0, -150, -500, -900]. That list is only
            // meaningful relative to the world's HEIGHT, and req #3365 made
            // every band 46px taller to give the epic name its own lane — which
            // moved the band tops out from under the key at every sampled pan
            // and took this whole sweep to ZERO drops. A cost curve that reads
            // zero everywhere is not a cheaper key, it is a sweep that stopped
            // looking, and all three assertions below would have "passed" as
            // vacuous had they not been written as strict inequalities.
            // Sampling the world's own extent keeps the measurement pinned to
            // the geometry rather than to four numbers that were true of one
            // fixture on one day.
            // …and then, at req #3365 again, from the BAND TOPS rather than
            // from a uniform grid over that extent. Deriving the STEP was still
            // deriving a grid: this pass made every band taller a second time
            // (`REQ_LINE_H` 18.75 → 23.5 and the lane pitch with it), the grid
            // stepped over the band boundaries, and the sweep went to zero
            // drops AGAIN. The key sits at the viewport BOTTOM, so what this
            // measurement is actually about is a band top landing down there —
            // so that is what the pan list now produces, directly: each band's
            // top placed at a handful of screen heights, the lowest of them
            // inside the key's own strip. It cannot go vacuous on a geometry
            // change, because it is stated in terms of the two things whose
            // collision it counts.
            // Spanning the WHOLE viewport height, not just the bottom strip.
            // A list biased toward where the key currently sits would make the
            // sibling test below (bottom-center vs top-right) a comparison of
            // the sweep rather than of the two key positions.
            const spots = [VIEWPORT.h - 30, VIEWPORT.h - 90, VIEWPORT.h * 0.7,
                VIEWPORT.h * 0.5, VIEWPORT.h * 0.25, 30];
            const pans = layout.bands.flatMap(
                (band) => spots.map((spot) => Math.round(spot - band.y * k)));
            for (const y of pans) {
                for (let x = 0; x <= 1400; x += 100) {
                    const args = { bands: layout.bands, transform: { x, y, k },
                        viewport: VIEWPORT, worldWidth: layout.width };
                    const bare = placeEpicChips(args);
                    const withKey = placeEpicChips({ ...args,
                        keepOut: keepOutOf() });
                    dropped += bare.filter(
                        (c) => !withKey.some((d) => d.key === c.key)).length;
                }
            }
        }
        return dropped;
    };
    // The key where it actually sits (req #3255): bottom-centre, 12px up.
    const costOf = (w, h) => sweepDrops(() => ({
        x: (VIEWPORT.w - w) / 2, y: VIEWPORT.h - 12 - h, w, h,
    }));

    it('costs epic names in BOTH dimensions, monotonically — the pre-#3257 '
        + '"height is free" invariant no longer holds', () => {
        // 470 is no longer a cap (req #3374 P6 uncapped width) — it is kept
        // here only as the fixed reference width the measured table above
        // used, so this sweep stays comparable to it.
        const byHeight = [30, 60, 100, 140, 180].map((h) => costOf(470, h));
        for (let i = 1; i < byHeight.length; i++) {
            expect(byHeight[i], `height ${[30, 60, 100, 140, 180][i]} vs the one below`)
                .toBeGreaterThanOrEqual(byHeight[i - 1]);
        }
        // The falsification itself, asserted so nobody can quietly restore the
        // old claim: growing the key from one row to the worst case DOES cost.
        expect(byHeight[byHeight.length - 1],
            'a tall key must cost MORE names than a short one — "height is free" '
            + 'was true only of the displacement pass #3257 deleted')
            .toBeGreaterThan(byHeight[0]);

        const WIDTHS = [90, 300, 420, 470, 600, 900, 1100];
        const byWidth = WIDTHS.map((w) => costOf(w, 30));
        for (let i = 1; i < byWidth.length; i++) {
            expect(byWidth[i], `width ${WIDTHS[i]} vs ${WIDTHS[i - 1]}`)
                .toBeGreaterThanOrEqual(byWidth[i - 1]);
        }
        // The curve is a real curve and not a constant: the widest key costs
        // several times more names than the narrowest one.
        expect(byWidth[byWidth.length - 1],
            'a 1100px key vs a 90px one').toBeGreaterThan(5 * byWidth[0]);
    });

    it('HEIGHT is the steeper axis now that the key sits bottom-center — so '
        + 'PLAN_KEY_MAX_H rightly caps it, not width', () => {
        const base = costOf(470, 30);
        const tallCost = costOf(470, 180) - base;
        const wideCost = costOf(900, 30) - base;
        expect(tallCost, 'growing the key to a worst-case height').toBeGreaterThan(0);
        expect(wideCost, 'a 900px key must still cost names').toBeGreaterThan(0);
        // THE INVERSION, pinned so it cannot revert silently. Under the
        // top-right key width was steeper; bottom-center reverses it, and
        // req #3374 P6 moved the cap to match. If a future move puts width
        // back on top, this fails and the comment above gets re-measured
        // rather than quietly rotting.
        expect(tallCost, 'height must cost more than width for a BOTTOM-anchored '
            + 'key — if this fails, the key moved again and the table above is stale')
            .toBeGreaterThan(wideCost);
    });

    it('the actual PLAN_KEY_MAX_H cap costs little — the flat part of the '
        + 'height curve, not the steep part past it', () => {
        // The cap's own derivation (see `PLAN_KEY_MAX_H` in
        // pipelinePlanLayout.js): content is ~78px, so the curve is flat up to
        // there and only starts climbing past it. 110 should sit close to that
        // floor, not out on the steep part a much taller key would reach.
        //
        // MEASURED 2026-08-10: 21 at h=78, 28 at h=110 (the cap), 49 at h=180
        // — a real bound (review finding, req #3374 P7: the first draft of
        // this test asserted `atCap - atFloor < wellPast - atFloor`, which is
        // the SAME inequality as `atCap < wellPast` with `atFloor` subtracted
        // from both sides — algebraically guaranteed by the line above it and
        // therefore not a claim about "little" at all). The cap's own extra
        // cost (7) must stay a minority of the steep segment's extra cost
        // (28) for "little" to mean something.
        const atFloor = costOf(300, 78);
        const atCap = costOf(300, PLAN_KEY_MAX_H);
        const wellPast = costOf(300, 180);
        expect(atCap, 'the cap must not already be on the steep part of the curve')
            .toBeLessThan(wellPast);
        // ── IT DRIFTED, AND THEN CAME BACK (req #3498) ──────────────────────
        // Worth recording because the intermediate state was real and was very
        // nearly shipped with the bound loosened to hide it. The card widened
        // the world ~3x and made every band taller, and this ratio went from a
        // comfortable **7/28 (a quarter)** to **27/51 (just past half)** — the
        // cap was no longer on the flat part, and `PLAN_KEY_MAX_H` (derived at
        // req #3374 P6) genuinely did not fit the new geometry.
        //
        // LANE RE-USE resolved it without anybody touching the key: packing
        // branches into free lanes took the tallest band from 17 lanes to 12,
        // so a bottom-anchored key of unchanged height once again overlaps few
        // band tops across the pan sweep. The MINORITY bound is restored as the
        // original claim, not as a relaxed one.
        expect(atCap - atFloor,
            'the cap\'s own cost over the real content height must be a MINORITY '
            + 'of what the steep segment past it costs, not merely less')
            .toBeLessThanOrEqual(0.5 * (wellPast - atFloor));
    });

    it('the bottom-center move made the key far cheaper than the top-right one', () => {
        // The #3255 move is worth a number, not just a note. Asserted as an
        // order of magnitude so it tracks the finding rather than a specific
        // fixture count that will drift as the fixture does.
        // SAME sweep as `costOf` — see `sweepDrops`. Only the rect differs.
        const topRight = sweepDrops(
            () => ({ x: VIEWPORT.w - 10 - 470, y: 8, w: 470, h: 30 }));
        expect(topRight, 'the old top-right key cost real names').toBeGreaterThan(50);
        expect(costOf(470, 30) * 3,
            'the bottom-center key must be far cheaper than the top-right one')
            .toBeLessThan(topRight);
    });
});

// ── The 35-character ceiling, on FROZEN geometry (user directives 2026-08-01) ─
//
// "let's go with all three levels of zoom showing 35 chars", then "if 35 is too
// much, pick a lower number. I do not want any other spacing to have to change
// for this." The second sentence is the binding one: 35 is a CEILING, the text
// is fitted to the room that already exists, and nothing about the layout moves.

// The requirement titles the fixture does not carry. Deliberately longer than
// any cap, so every drawn length IS the cap and the table below is exact.
const LONG_TITLE = 'A requirement title that is definitely longer than any cap here';
const FIXTURE_TITLES = new Map(
    SUBSTRATE_REBUILD_MODEL.requirements.map((r) => [r.id, LONG_TITLE]));

const drawn = (opts) => {
    const layout = computePlanLayout(plan.rows,
        { reqTitles: FIXTURE_TITLES, ...opts });
    const pick = (kind) => layout.labels.filter((l) => l.kind === kind)
        .map((l) => l.text.length);
    return { layout, step: pick('step'), req: pick('req') };
};

describe('the character budget IS the card (req #3498, was the 35-char ceiling)', () => {
    // WHAT REPLACED WHAT. Directive B (2026-08-01) capped the drawn text at a
    // ceiling and froze the geometry — *"if 35 is too much, pick a lower number.
    // I do not want any other spacing to have to change for this"* — because the
    // room a label had was assembled from its column and a bounded reach into the
    // neighbours, and no cap could be derived from anything. The card gives every
    // string ONE room, so the cap and the room are the same number and the table
    // of measured per-mode/per-width lengths has no columns left to vary over.
    it('never draws a label wider than the card can hold, in any combination', () => {
        for (const view of Object.keys(REQ_VIEWS)) {
            for (const stepLabel of ['id', 'title']) {
                const { layout } = drawn({ ...reqViewOptions(view), stepLabel });
                for (const l of layout.labels) {
                    if (l.stepId == null) continue;
                    const n = layout.nodes.get(l.stepId);
                    expect(l.w, `${view} x ${stepLabel} (${l.kind})`)
                        .toBeLessThanOrEqual(n.w);
                }
            }
        }
    });

    // THE DEAL THE USER GETS, still pinned as an exact number — the point of
    // directive B was that the length is a measured fact and not a promise, and
    // that survives the card. What changed is that there is now ONE number
    // instead of a 3x3 table, because there is one width.
    it('draws the MEASURED number of characters, and it is the same everywhere', () => {
        const at = (view, stepLabel) => {
            const { step } = drawn({ ...reqViewOptions(view), stepLabel });
            return [Math.min(...step), Math.max(...step)];
        };
        // The step name is drawn at `PLAN_VIZ_FONT.label` (16.5), which is wider
        // per character than the requirement rows, so it fits fewer of them than
        // the 46 the width was bought for.
        // The ✓'s room AND the link button's come off the RIGHT of the step
        // label's budget; the badge's comes off the LEFT (req #3503) — all
        // three drawn on the title area's own line.
        // The step NAME wraps too since 2026-08-13 — at a 28-character line it
        // would otherwise truncate to nineteen — so what is pinned is the
        // per-LINE budget, which is what a reader actually sees on one row.
        const stepBudget = cardChars(CHW_LABEL,
            CARD_CHECK_W + CARD_STEP_LINK_W + CARD_BADGE_W + CARD_BADGE_GAP);
        for (const view of Object.keys(REQ_VIEWS)) {
            const layout = computePlanLayout(plan.rows,
                { ...reqViewOptions(view), stepLabel: 'title',
                    reqTitles: FIXTURE_TITLES });
            for (const l of layout.labels.filter((x) => x.kind === 'step')) {
                for (const line of l.lines) {
                    expect(line.length, `${view}: "${line}"`)
                        .toBeLessThanOrEqual(stepBudget);
                }
                expect(l.lines.length).toBeLessThanOrEqual(NAME_MAX_LINES);
            }
        }
        // Requirement rows get the full budget, at the row font — no ✓ on
        // those lines, so nothing is reserved out of them.
        expect(cardChars(CHW_REQ)).toBe(CARD_TEXT_CHARS);
        // An ID label is the step id, whatever the budget — nothing to truncate.
        expect(at('vertical', 'id')[1]).toBeLessThanOrEqual(String(
            Math.max(...plan.rows.map((r) => r.id))).length);
    });

    it('the text budget did not move a single column', () => {
        // The claim directive B actually made, and on the HORIZONTAL axis it is
        // now true by CONSTRUCTION rather than by measurement: the columns are
        // uniform and no text is consulted to size them.
        //
        // The VERTICAL axis is a different matter since the second line landed
        // (req #3498, 2026-08-13) — see the row-wrapping suite. Width was the
        // axis the directive was about; height is what the card spends to keep
        // a title readable, and it is measured rather than assumed.
        const ids = computePlanLayout(plan.rows, { stepLabel: 'id' });
        const titled = computePlanLayout(plan.rows,
            { stepLabel: 'id', reqLabel: 'title', reqTitles: FIXTURE_TITLES });
        expect(titled.colW).toEqual(ids.colW);
        expect(titled.width).toBe(ids.width);
        expect(titled.height).toBeGreaterThan(ids.height);
    });
});

describe('requirement rows: id or TITLE (req #3168 directive E, req #3498)', () => {
    it('SHOWING TITLES COSTS NO WIDTH — and buys its height by the LINE', () => {
        // The frozen-geometry directive stood on the HORIZONTAL axis, and there
        // it is absolute: a title can never widen a column or the world.
        //
        // The VERTICAL story is the part that moved. It used to cost 634.5px on
        // this fixture — 27 extra lines of swim-lane offset, room spent on
        // CLEARANCE rather than on text. The card deleted all of that, and then
        // the user's 2026-08-13 directive spent height back on something a
        // reader gets to see: a SECOND LINE per row before the title truncates.
        // So the cost is a row-count fact now, not a collision-avoidance one,
        // and this asserts it as exactly that.
        for (const stepLabel of ['id', 'title']) {
            const base = computePlanLayout(plan.rows,
                { ...reqViewOptions('vertical'), stepLabel,
                    reqTitles: FIXTURE_TITLES });
            const titled = computePlanLayout(plan.rows,
                { ...reqViewOptions('titles'), stepLabel,
                    reqTitles: FIXTURE_TITLES });
            expect(titled.colW, stepLabel).toEqual(base.colW);
            expect(titled.width, stepLabel).toBe(base.width);
            expect([...titled.nodes.values()].map((n) => n.w), stepLabel)
                .toEqual([...base.nodes.values()].map((n) => n.w));
            expect(titled.bands.map((b) => b.sub), stepLabel)
                .toEqual(base.bands.map((b) => b.sub));
            // Every extra pixel is a WHOLE LINE, on a card whose rows wrapped.
            for (const r of plan.rows) {
                const b = base.nodes.get(r.id);
                const t = titled.nodes.get(r.id);
                const extra = t.h - b.h;
                // Whole LINES, and nothing else: the between-rows gaps are the
                // same in both layouts (same row count), so every extra pixel
                // is a second line somebody's title needed.
                const inLines = extra / REQ_LINE_H;
                expect(inLines - Math.round(inLines), `step ${r.id}`)
                    .toBeCloseTo(0, 6);
                // …and never more than one extra line per requirement.
                expect(Math.round(inLines), `step ${r.id}`)
                    .toBeLessThanOrEqual(
                        (REQ_MAX_LINES - 1) * (r.reqIds || []).length);
            }
        }
    });

    // The number the user has to live with, measured rather than hoped for.
    it('draws the MEASURED title length the card affords', () => {
        const at = (stepLabel) => {
            const { req } = drawn({ ...reqViewOptions('titles'), stepLabel });
            return [Math.min(...req), Math.max(...req)];
        };
        // ONE PAIR OF NUMBERS, not the 3x3 table the width control used to
        // produce, and the MAX is the card's own budget: *"req# plus 40 chars"*.
        // The MIN is a title that ran out of TITLE before it ran out of card —
        // every requirement in this fixture gets the same long string, so the
        // two ends coincide and both are the budget.
        // TWO lines of it now (req #3498, 2026-08-13). `label.text` joins the
        // wrapped lines with a space, so the drawn length is the budget twice
        // over, less the joint — which is exactly what the second line buys.
        const budget = cardChars(CHW_REQ);
        const [lo, hi] = at('title');
        expect(hi).toBeGreaterThan(budget);
        expect(hi).toBeLessThanOrEqual(budget * REQ_MAX_LINES);
        expect(lo).toBe(hi);        // every fixture title is equally long
        // Independent of what the TITLE AREA says, which is the whole point of
        // a fixed width: the two controls no longer interact.
        expect(at('id')).toEqual(at('title'));
    });

    it('keeps every requirement row inside its own card', () => {
        for (const view of Object.keys(REQ_VIEWS)) {
            for (const stepLabel of ['id', 'title']) {
                const layout = computePlanLayout(plan.rows, {
                    ...reqViewOptions(view), stepLabel,
                    reqTitles: FIXTURE_TITLES,
                });
                for (const l of layout.labels) {
                    if (l.kind !== 'req') continue;
                    const n = layout.nodes.get(l.stepId);
                    const where = `${view} x ${stepLabel} (req ${l.reqId})`;
                    expect(l.x, where).toBeGreaterThanOrEqual(n.left - 0.01);
                    expect(l.x + l.w, where).toBeLessThanOrEqual(n.right + 0.01);
                    expect(l.y, where).toBeGreaterThanOrEqual(n.top - 0.01);
                    expect(l.y + l.h, where).toBeLessThanOrEqual(n.bottom + 0.01);
                }
            }
        }
    });

    it('lists the rows top to bottom, IN ORDER, each one starting where the '
        + 'one above it ended (the directive)', () => {
        for (const view of ['vertical', 'titles']) {
            const layout = computePlanLayout(plan.rows, {
                ...reqViewOptions(view), stepLabel: 'title',
                reqTitles: FIXTURE_TITLES,
            });
            for (const row of plan.rows) {
                const ids = row.reqIds || [];
                if (ids.length < 2) continue;
                const rows = layout.labels.filter(
                    (l) => l.kind === 'req' && l.stepId === row.id);
                // Emitted in the row's own `reqIds` order — this module never
                // re-sorts them (that is `sortReqIdsByColorKey`'s job, and its
                // caller's choice).
                expect(rows.map((l) => l.reqId), view).toEqual(ids);
                for (let i = 1; i < rows.length; i++) {
                    // A row occupies as many lines as it wrapped to, and the
                    // next one starts immediately below — no gaps, no overlaps,
                    // whatever the mix of one- and two-line rows.
                    const lines = rows[i - 1].lines.length;
                    expect(rows[i].y - rows[i - 1].y, `${view} step ${row.id}`)
                        .toBeCloseTo(lines * REQ_LINE_H + REQ_ROW_GAP, 6);
                    expect(rows[i].x, view).toBe(rows[0].x);  // one left margin
                }
                // And they start BELOW the rule, never in the title area. The
                // title area's height is the NODE's (`titleH`), because the step
                // name may have wrapped onto a second line.
                const ruleY = layout.nodes.get(row.id).top
                    + layout.nodes.get(row.id).titleH + CARD_RULE_BAND;
                expect(rows[0].y, view).toBeCloseTo(ruleY, 6);
                // The card is tall enough for every line it reserved.
                const last = rows[rows.length - 1];
                expect(last.y + last.h, `${view} step ${row.id}`)
                    .toBeLessThanOrEqual(layout.nodes.get(row.id).bottom);
            }
        }
    });

    it('wraps a row onto a SECOND line before it truncates (user directive)', () => {
        const budget = cardChars(CHW_REQ);
        // A title that overflows one line but fits two: no ellipsis anywhere,
        // and the break lands on a word boundary rather than mid-word. SIZED
        // FROM THE BUDGET, not from a word count — the budget moved from 47 to
        // 28 and a hand-counted fixture silently became a three-line case.
        const words = Math.floor((budget * 2) / 5) - 1;   // 'word ' is 5 chars
        const fits = 'word '.repeat(words).trim();
        const lines = wrapReqText(fits, budget);
        expect(lines).toHaveLength(2);
        expect(lines.join(' ')).toBe(fits);
        expect(lines.some((l) => l.includes('\u2026'))).toBe(false);
        for (const l of lines) expect(l.length).toBeLessThanOrEqual(budget);

        // Short enough for one line: still one line, untouched.
        expect(wrapReqText('short', budget)).toEqual(['short']);

        // Longer than two lines: the LAST line is the only one that may carry
        // the ellipsis, and it carries one because text really was dropped.
        const long = 'word '.repeat(60).trim();
        const cut = wrapReqText(long, budget);
        expect(cut).toHaveLength(REQ_MAX_LINES);
        expect(cut[0]).not.toContain('\u2026');
        expect(cut[REQ_MAX_LINES - 1]).toContain('\u2026');

        // An identifier longer than the line breaks HARD rather than being
        // dropped — a requirement title contains things like
        // `--dangerously-skip-permissions`, and refusing to break them would
        // leave the line short and the text lost.
        const ident = 'x'.repeat(budget + 12);
        const hard = wrapReqText(ident, budget);
        expect(hard[0].length).toBe(budget);
        expect(hard).toHaveLength(2);
    });

    it('reserves the wrapped rows at EVERY level — the level never relayouts', () => {
        // The layout takes no level at all, so the reserved second line is the
        // same box whatever is drawn in it. This pins that the ROW BOX, not just
        // the card, is level-independent: at L2 the renderer draws the bare id
        // on the first of the reserved lines.
        const layout = computePlanLayout(plan.rows, {
            ...reqViewOptions('titles'), stepLabel: 'title',
            reqTitles: FIXTURE_TITLES,
        });
        const two = layout.labels.filter(
            (l) => l.kind === 'req' && l.lines.length === REQ_MAX_LINES);
        expect(two.length, 'the fixture has wrapped rows').toBeGreaterThan(0);
        for (const l of two) {
            expect(l.h).toBeCloseTo(REQ_TEXT_H + (REQ_MAX_LINES - 1) * REQ_LINE_H, 6);
            // The id the renderer draws at L2 fits the first line on its own.
            expect(l.idW).toBeLessThanOrEqual(l.w);
        }
    });

    it('packs ids at ONE line\'s pitch at L1/L2 — no gap left by a title that wrapped (req #3503)', () => {
        // Review finding: the id-only display used the TITLE-wrapped `y`,
        // which left a wrapped row's bare id sitting atop mostly empty space
        // repeated down the card — "bring all the numbers into a nice
        // vertical line up with no white space". `idY` is the fix, and this
        // pins both halves of the claim: it is TIGHTLY packed (exactly one
        // line's pitch apart, regardless of how many lines the row's title
        // wrapped to), and it never sits BELOW its own title-wrapped `y` —
        // the property that makes it a subset of space the zero-overlap
        // sweep already proved empty, not a second geometry needing its own
        // full pairwise sweep.
        const layout = computePlanLayout(plan.rows, {
            ...reqViewOptions('titles'), stepLabel: 'title',
            reqTitles: FIXTURE_TITLES,
        });
        const pitch = REQ_LINE_H + REQ_ROW_GAP;
        for (const row of plan.rows) {
            const rows = layout.labels.filter(
                (l) => l.kind === 'req' && l.stepId === row.id);
            for (let i = 0; i < rows.length; i += 1) {
                const where = `step ${row.id} req[${i}]`;
                // Never below its own title-wrapped position.
                expect(rows[i].idY, where).toBeLessThanOrEqual(rows[i].y + 1e-6);
                if (i > 0) {
                    expect(rows[i].idY - rows[i - 1].idY, where)
                        .toBeCloseTo(pitch, 6);
                }
            }
        }
    });

    it('puts the TOTAL requirement count in a badge LEFT of the title (req #3503)', () => {
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        for (const row of plan.rows) {
            const [badge] = layout.labels.filter(
                (l) => l.kind === 'badge' && l.stepId === row.id);
            expect(badge, `step ${row.id} has a badge`).toBeTruthy();
            // TOTAL, not met/total — a step's progress is already on the card as
            // coloured rows, and met/total is the EPIC chip's vocabulary. No
            // parens now — the pill's own shape says "this is a count".
            expect(badge.text).toBe(String((row.reqIds || []).length));
            const n = layout.nodes.get(row.id);
            // RIGHT-aligned against the reserve's own right edge — flush with
            // the gap before the title — not left-aligned at the column's
            // text start: the drawn badge is usually narrower than the
            // reserve (`badgeWidthFor`, req #3503 review), and the slack
            // that frees opens on the badge's OWN left, never moving the
            // title. The right edge is what stays constant across cards.
            const columnTextLeft = n.left + CARD_FRAME_X + CARD_PAD_X;
            expect(badge.x + badge.w).toBeCloseTo(columnTextLeft + CARD_BADGE_W, 6);
            expect(badge.x).toBeGreaterThanOrEqual(columnTextLeft - 1e-6);
            expect(badge.y).toBeGreaterThanOrEqual(n.top + CARD_PAD_Y);
            expect(badge.y + badge.h).toBeLessThanOrEqual(n.top + cardTitleH('title'));
        }
        // It rides the CARD, so it draws where the card does and nowhere else.
        expect(drawsLabelKind('badge', 'out')).toBe(false);
        expect(drawsLabelKind('badge', 'mid')).toBe(true);
        expect(drawsLabelKind('badge', 'in')).toBe(true);
    });

    it('puts a "view in table" link button RIGHT of the title, clear of the ✓ (req #3503)', () => {
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        for (const row of plan.rows) {
            const [link] = layout.labels.filter(
                (l) => l.kind === 'step-link' && l.stepId === row.id);
            expect(link, `step ${row.id} has a link button`).toBeTruthy();
            expect(link.text).toBe('↗');
            const n = layout.nodes.get(row.id);
            // Right-aligned, clear of the ✓, inside the title area.
            expect(link.x + link.w)
                .toBeCloseTo(n.right - CARD_PAD_X - CARD_CHECK_W, 6);
            expect(link.y + link.h).toBeLessThanOrEqual(n.top + cardTitleH('title'));
        }
        // It rides the CARD too, same rule as the badge.
        expect(drawsLabelKind('step-link', 'out')).toBe(false);
        expect(drawsLabelKind('step-link', 'mid')).toBe(true);
        expect(drawsLabelKind('step-link', 'in')).toBe(true);
    });

    it('ONLY the title line shifts for the badge — req rows and the L3 line do not (req #3503)', () => {
        // The asymmetry the whole layout depends on: the badge answers for
        // the title's own row, not for the column. Pin it directly against
        // the column's own unshifted left edge — not against a requirement
        // row, which may not exist for a step with none — rather than
        // leaving it to be implied by the zero-overlap sweep passing. That
        // sweep is satisfied whether the shift is on the title alone, on
        // every row, or nowhere at all, as long as nothing collides.
        for (const stepLabel of ['title', 'id']) {
            const layout = computePlanLayout(plan.rows,
                { stepLabel, reqTitles: REQ_TITLES });
            for (const row of plan.rows) {
                const n = layout.nodes.get(row.id);
                const columnTextLeft = n.left + CARD_FRAME_X + CARD_PAD_X;
                const [step] = layout.labels.filter(
                    (l) => l.kind === 'step' && l.stepId === row.id);
                const where = `step ${row.id} (${stepLabel})`;
                expect(step.x - columnTextLeft, where)
                    .toBeCloseTo(CARD_BADGE_W + CARD_BADGE_GAP, 6);
                for (const req of layout.labels.filter(
                    (l) => l.kind === 'req' && l.stepId === row.id)) {
                    expect(req.x, where).toBeCloseTo(columnTextLeft, 6);
                }
                // The reserved L3 own-title line only draws off `title` mode
                // (the step label already IS the title there); it shares the
                // column's own `textLeft`, not the shifted title's.
                if (stepLabel === 'id') {
                    for (const l3 of layout.labels.filter(
                        (l) => l.kind === 'title' && l.stepId === row.id)) {
                        expect(l3.x, where).toBeCloseTo(columnTextLeft, 6);
                    }
                }
            }
        }
    });

    it('the title budget and the right-hand reserve agree — no overlap by construction (req #3503)', () => {
        // `assertNoLabelOverlap` catches a violation for THESE fixtures, but a
        // change to any of the four title-row reserve constants would surface
        // there as a confusing pairwise-overlap failure rather than as "the
        // budget and the reserve disagree". Name the actual invariant: the
        // widest possible title line (`nameBudget` characters at `CHW_LABEL`,
        // from `titleTextLeft`) never reaches the link button's own left edge.
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        for (const row of plan.rows) {
            const [step] = layout.labels.filter(
                (l) => l.kind === 'step' && l.stepId === row.id);
            const [link] = layout.labels.filter(
                (l) => l.kind === 'step-link' && l.stepId === row.id);
            const widestLineLen = Math.max(...step.lines.map((l) => l.length));
            expect(step.x + widestLineLen * CHW_LABEL, `step ${row.id}`)
                .toBeLessThanOrEqual(link.x + 1e-6);
        }
    });

    it('leaves real breathing room between rows, not just zero overlap', () => {
        // `REQ_LINE_H` is a 14px box on a 23.5px line, so the whitespace between
        // two rows is 9.5px. Pinned because "they do not overlap" was satisfied
        // by a 1px gap once already (req #3242 finding) and read as broken.
        const layout = computePlanLayout(plan.rows, {
            ...reqViewOptions('titles'), stepLabel: 'title',
            reqTitles: FIXTURE_TITLES,
        });
        const rows = layout.labels.filter((l) => l.kind === 'req');
        for (const a of rows) {
            for (const b of rows) {
                if (a === b || a.stepId !== b.stepId) continue;
                if (Math.abs(a.y - b.y) < 0.01) continue;
                expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(REQ_LINE_H - 0.01);
            }
        }
    });

    it('falls back to the ID when a title is missing, blank or unresolvable', () => {
        const titles = new Map([[1, ''], [2, null]]);
        expect(reqLabelText(1, { reqLabel: 'title', reqTitles: titles })).toBe('1');
        expect(reqLabelText(2, { reqLabel: 'title', reqTitles: titles })).toBe('2');
        expect(reqLabelText(3, { reqLabel: 'title', reqTitles: titles })).toBe('3');
        // A plain object whose key resolves to an INHERITED function is the
        // localStorage-shaped hazard the house rule exists for: `String(fn)`
        // would draw a function body onto the canvas.
        expect(reqLabelText('constructor', { reqLabel: 'title', reqTitles: {} }))
            .toBe('constructor');
    });
});

describe('the requirement-view control (req #3168 directive E, req #3498)', () => {
    it('offers exactly TWO positions — the row says the id, or the title', () => {
        // It had three. `horizontal` — every requirement of a step on one line,
        // sharing the column N ways — is gone, because a card lists its
        // requirements top to bottom and there is no second arrangement left to
        // choose between. `reqLayout` went with it: the remaining distinction is
        // purely what the row SAYS.
        expect(Object.keys(REQ_VIEWS)).toEqual(['vertical', 'titles']);
        expect(reqViewOptions('vertical')).toMatchObject({ reqLabel: 'id' });
        expect(reqViewOptions('titles')).toMatchObject({ reqLabel: 'title' });
        expect(Object.values(REQ_VIEWS).some(
            (v) => 'reqLayout' in v), 'no view names a layout any more').toBe(false);
    });

    it('drops a stored `horizontal` to the default rather than rendering it', () => {
        // THE ONE BEHAVIOURAL DIFFERENCE from the three-value control, and it is
        // deliberate: a reader holding the retired value gets the default,
        // because the alternative is rendering a layout that no longer exists.
        expect(isReqView('horizontal')).toBe(false);
        expect(normalizeReqView('horizontal')).toBe(DEFAULT_REQ_VIEW);
    });

    it('normalizes a legacy or hostile stored preference', () => {
        expect(DEFAULT_REQ_VIEW).toBe('vertical');
        expect(normalizeReqView('vertical')).toBe('vertical');
        expect(normalizeReqView('titles')).toBe('titles');
        for (const bogus of ['constructor', 'toString', '__proto__', 'valueOf',
            'TITLES', 'horizontal', '', null, undefined, 0, {}]) {
            expect(isReqView(bogus), `isReqView(${String(bogus)})`).toBe(false);
            expect(normalizeReqView(bogus)).toBe(DEFAULT_REQ_VIEW);
        }
    });
});

describe('steps-across zoom (req #3498, user directive 2026-08-13)', () => {
    const COL = CARD_W + CARD_GAP_X;

    it('offers 10 through 2 on evens, widest first', () => {
        expect(STEPS_ACROSS_OPTIONS).toEqual([10, 8, 6, 4, 2]);
    });

    it('fits exactly that many COLUMNS across, gutters included', () => {
        // A step is a COLUMN, not a card: fitting `n` cards and forgetting the
        // gutters lands every option one card too wide.
        for (const n of [10, 8, 6, 4]) {
            const k = stepsAcrossScale(n, 1730);
            expect(n * COL * k, `${n} across`).toBeCloseTo(1730, 6);
        }
    });

    it('leaves 2 loose — the exception the directive names', () => {
        // *"with tight white space except when 2 is selected"*. Two columns
        // filling a 1730px viewport puts one card at ~690px and its text at
        // ~37px, which is past reading. 2 fits its pair into a fraction and
        // leaves the rest as air.
        const k = stepsAcrossScale(2, 1730);
        expect(2 * COL * k).toBeCloseTo(1730 * STEPS_ACROSS_LOOSE_FILL, 6);
        expect(2 * COL * k).toBeLessThan(1730);
        // …and it is still the CLOSEST look the ladder offers.
        expect(k).toBeGreaterThan(stepsAcrossScale(4, 1730));
    });

    it('every option is monotonic — more steps across is always further out', () => {
        const ks = STEPS_ACROSS_OPTIONS.map((n) => stepsAcrossScale(n, 1730));
        for (let i = 1; i < ks.length; i++) {
            expect(ks[i], `${STEPS_ACROSS_OPTIONS[i]} vs ${STEPS_ACROSS_OPTIONS[i - 1]}`)
                .toBeGreaterThan(ks[i - 1]);
        }
    });

    it('refuses a viewport or a count that cannot produce a scale', () => {
        for (const bad of [0, -1, null, undefined, NaN, 'x']) {
            expect(stepsAcrossScale(bad, 1730), `n=${String(bad)}`).toBeNull();
            expect(stepsAcrossScale(6, bad), `w=${String(bad)}`).toBeNull();
        }
    });

    it('holds the viewport CENTRE still while it changes scale', () => {
        const size = { w: 1730, h: 900 };
        const t = { x: -4000, y: -700, k: 0.4 };
        // The world point under the centre before the zoom…
        const cx = (size.w / 2 - t.x) / t.k;
        const cy = (size.h / 2 - t.y) / t.k;
        for (const n of STEPS_ACROSS_OPTIONS) {
            const next = zoomAboutViewportCentre(t, size, stepsAcrossScale(n, size.w));
            // …is under the centre after it.
            expect((size.w / 2 - next.x) / next.k, `${n} across, x`).toBeCloseTo(cx, 6);
            expect((size.h / 2 - next.y) / next.k, `${n} across, y`).toBeCloseTo(cy, 6);
        }
    });

    it('refuses a transform or a size it cannot anchor', () => {
        const size = { w: 1730, h: 900 };
        const t = { x: 0, y: 0, k: 1 };
        expect(zoomAboutViewportCentre(null, size, 1)).toBeNull();
        expect(zoomAboutViewportCentre(t, null, 1)).toBeNull();
        expect(zoomAboutViewportCentre({ ...t, k: 0 }, size, 1)).toBeNull();
        expect(zoomAboutViewportCentre(t, size, 0)).toBeNull();
        expect(zoomAboutViewportCentre(t, { w: 0, h: 900 }, 1)).toBeNull();
    });
});

describe('snap zoom — the wheel walks the same ladder (req #3498)', () => {
    const VW = 1730;
    const rung = (n) => stepsAcrossScale(n, VW);

    it('steps by two, and lands on the BUTTONS\' own scales', () => {
        // The point of the feature: wheeling to 8 across and pressing "8" give
        // the same scale, not two that look alike.
        expect(SNAP_COLUMNS_STEP).toBe(2);
        expect(snapZoomScale(rung(8), VW, +1)).toBe(rung(10));
        expect(snapZoomScale(rung(8), VW, -1)).toBe(rung(6));
        expect(snapZoomScale(rung(6), VW, -1)).toBe(rung(4));
    });

    it('does not stick on the rung it is already standing on', () => {
        // Landing exactly on a rung is the NORMAL case — it is where the last
        // notch put you — so a naive floor/ceil would re-select it forever.
        for (const n of [4, 6, 8, 10]) {
            const inK = snapZoomScale(rung(n), VW, -1);
            const outK = snapZoomScale(rung(n), VW, +1);
            expect(inK, `in from ${n}`).not.toBe(rung(n));
            expect(outK, `out from ${n}`).not.toBe(rung(n));
            // …and it moved the RIGHT WAY: zooming in is a larger scale.
            expect(inK, `in from ${n} is closer`).toBeGreaterThan(rung(n));
            expect(outK, `out from ${n} is further`).toBeLessThan(rung(n));
        }
    });

    it('continues PAST the buttons\' widest option', () => {
        // The toolbar stops at 10 because a toolbar has to stop somewhere; the
        // ladder does not. The zoom extent is what actually bounds it.
        expect(snapZoomScale(rung(10), VW, +1)).toBe(rung(12));
        expect(snapZoomScale(rung(12), VW, +1)).toBe(rung(14));
    });

    it('handles the LOOSE rung at 2 in both directions', () => {
        // Rung 2 is not tight, so the column count there reads 2.5. Zooming out
        // must still find 4, and zooming in must find the floor and report that
        // there is nowhere left to go rather than returning the current scale.
        expect(columnsAcross(rung(2), VW)).toBeCloseTo(2 / STEPS_ACROSS_LOOSE_FILL, 6);
        expect(snapZoomScale(rung(2), VW, +1)).toBe(rung(4));
        expect(snapZoomScale(rung(2), VW, -1)).toBeNull();
    });

    it('snaps a scale BETWEEN rungs to the next one in the direction asked', () => {
        // The state after a smooth zoom, or after toggling snap on mid-view.
        const between = rung(7);            // 7 across — not a rung
        expect(snapZoomScale(between, VW, -1)).toBe(rung(6));
        expect(snapZoomScale(between, VW, +1)).toBe(rung(8));
    });

    it('refuses junk rather than driving the camera to NaN', () => {
        for (const bad of [0, -1, null, undefined, NaN]) {
            expect(snapZoomScale(bad, VW, -1), `k=${String(bad)}`).toBeNull();
            expect(snapZoomScale(rung(6), bad, -1), `w=${String(bad)}`).toBeNull();
        }
        // `dir` has its own list: -1 is the zoom-IN direction, not junk.
        for (const bad of [0, null, undefined, NaN, 'up']) {
            expect(snapZoomScale(rung(6), VW, bad), `dir=${String(bad)}`).toBeNull();
        }
        expect(columnsAcross(0, VW)).toBeNull();
        expect(columnsAcross(1, 0)).toBeNull();
    });

    it('the wheel anchors on the POINTER, the buttons on the centre', () => {
        const size = { w: VW, h: 900 };
        const t = { x: -3000, y: -500, k: 0.4 };
        const at = { x: 300, y: 120 };
        const next = zoomAboutPoint(t, at, rung(6));
        // The world point under the cursor is under the cursor afterwards.
        expect((at.x - next.x) / next.k).toBeCloseTo((at.x - t.x) / t.k, 6);
        expect((at.y - next.y) / next.k).toBeCloseTo((at.y - t.y) / t.k, 6);
        // …and the centre helper is that same function at the centre pixel.
        expect(zoomAboutViewportCentre(t, size, rung(6)))
            .toEqual(zoomAboutPoint(t, { x: size.w / 2, y: size.h / 2 }, rung(6)));
    });
});

describe('the semantic-level selector (req #3168, directive C)', () => {
    it('maps the shared control\'s 1|2|3 onto this canvas\'s own vocabulary', () => {
        expect(pinnedLevelOf('1')).toBe('out');
        expect(pinnedLevelOf('2')).toBe('mid');
        expect(pinnedLevelOf('3')).toBe('in');
        expect(pinnedLevelOf(2)).toBe('mid');       // a number, not a string
        // Auto is a POSITION, and it resolves to "no pin" rather than to a level.
        expect(pinnedLevelOf('auto')).toBeNull();
        expect(DEFAULT_PLAN_LEVEL_PREF).toBe('auto');
        // …and the reverse map the control needs to soft-mark the live level.
        expect(PLAN_LEVEL_NUMBER).toEqual({ out: 1, mid: 2, in: 3 });
        for (const [pref, level] of Object.entries(PLAN_LEVEL_BY_PREF)) {
            if (level == null) continue;
            expect(PLAN_LEVEL_NUMBER[level]).toBe(Number(pref));
        }
    });

    it('survives a garbage or localStorage-injected value', () => {
        for (const bogus of ['constructor', 'toString', '__proto__', 'hasOwnProperty',
            '4', '0', 'AUTO', '', null, undefined, {}, []]) {
            expect(isPlanLevelPref(bogus), `isPlanLevelPref(${String(bogus)})`).toBe(false);
            expect(normalizePlanLevelPref(bogus)).toBe(DEFAULT_PLAN_LEVEL_PREF);
            expect(pinnedLevelOf(bogus)).toBeNull();
        }
    });
});

// ── THE FOUR MODES (req #3324) ──────────────────────────────────────────────
// `planLevelFor` replaced the pin's camera move (`levelPinTransform`, req
// #3310), which stood here and is deleted: the reader's ruling is that a pinned
// level is a fixed rule set for what is DISPLAYED, so honouring it needs no
// camera at all. The live plan's numbers, because both defects were reported
// against it — world width 3620.2 in a 1600px panel gives `kFit = 0.442`, so
// `kDefault = max(kFit, K_READABLE) = K_READABLE` and the whole band below the
// legibility floor is reachable: one Reset click lands there.
describe('the four modes (req #3324)', () => {
    const kDefault = K_READABLE;                       // the live plan's anchor
    const kFloor = (1600 / 3620.2) * ZOOM_MIN_RATIO;   // its reachable minimum
    const K_SPAN = Array.from({ length: 241 }, (_, i) =>
        kFloor + (i / 240) * (kDefault * ZOOM_MAX_RATIO - kFloor));

    // THE REQUIREMENT, AS ONE ASSERTION. "The buttons are sticky and keep the
    // formatting selected applied to the visualizer regardless of the size of the
    // viewport [or] the zoom level."
    it('honours a pin at EVERY reachable scale and every ratio', () => {
        for (const pinned of ['out', 'mid', 'in']) {
            for (const k of K_SPAN) {
                // The ratio is swept independently of `k` on purpose: it carries
                // the VIEWPORT's contribution (`kFit` -> `kDefault` moves with
                // the panel width), so a pin that ignores both arguments is the
                // only thing that can pass this. 0.1 and 40 are far outside
                // anything the zoom extent allows, which is the point.
                for (const ratio of [0.1, 0.24, 0.5, 1, 1.9, 8, 40, NaN]) {
                    expect(planLevelFor(pinned, ratio, k),
                        `pin ${pinned} at ratio=${ratio}, k=${k.toFixed(4)}`)
                        .toBe(pinned);
                }
            }
        }
    });

    // "Auto — algorithm changes the display settings between L1, L2 and L3 based
    // on the resolution." Both halves of that algorithm, and BOTH are Auto's
    // alone: the ladder's ratio bands, and the absolute floor below which the
    // level's own text cannot be rendered.
    it('runs the ladder on AUTO, and demotes what the scale cannot render', () => {
        // Legible: the ladder decides, exactly as it did before req #3280.
        for (const [ratio, level] of [[0.25, 'out'], [0.49, 'out'], [0.5, 'mid'],
            [1, 'mid'], [1.89, 'mid'], [1.9, 'in'], [8, 'in']]) {
            expect(planLevelFor(null, ratio, K_READABLE), `ratio ${ratio}`).toBe(level);
            expect(planLevelFor(null, ratio, 6.4), `ratio ${ratio} zoomed in`).toBe(level);
        }
        // Illegible: 'out' whatever the ladder says — which is EXACTLY the old
        // `&& labelsLegible(k)` for all three gated kinds, and the reason the
        // demotion could replace it without changing one pixel of Auto.
        for (const k of [kFloor, 0.2, 0.4, K_READABLE - 1e-9]) {
            expect(labelsLegible(k), `k=${k} below the floor`).toBe(false);
            for (const ratio of [0.1, 0.5, 1, 1.9, 8]) {
                expect(planLevelFor(null, ratio, k),
                    `auto at ratio=${ratio}, k=${k}`).toBe('out');
            }
        }
        // The boundary belongs to legible, like `labelsLegible`'s own.
        expect(planLevelFor(null, 1, K_READABLE)).toBe('mid');
    });

    // A garbage `k` cannot silently promote a level: `labelsLegible` rejects a
    // non-finite scale, and the pinned branch never reads it at all.
    it('resolves to a real level from any input', () => {
        for (const k of [NaN, undefined, null, 0, -1, Infinity]) {
            expect(['out', 'mid', 'in']).toContain(planLevelFor(null, 1, k));
            expect(planLevelFor('in', 1, k)).toBe('in');
        }
        // `pinnedLevelOf` is what the canvas feeds this, so the two compose into
        // the four modes the control actually offers.
        for (const pref of ['auto', '1', '2', '3']) {
            const level = planLevelFor(pinnedLevelOf(pref), 1, K_READABLE);
            expect(['out', 'mid', 'in'], `pref ${pref}`).toContain(level);
        }
        expect(planLevelFor(pinnedLevelOf('2'), 0.1, kFloor)).toBe('mid');
        expect(planLevelFor(pinnedLevelOf('auto'), 0.1, kFloor)).toBe('out');
    });
});


// ── The TIME AXIS (req #3201) ───────────────────────────────────────────────
// A purpose-built model rather than the Substrate fixture, because the shapes
// under test are shapes that fixture does not contain: an epic that has never
// started at all, an UNGATED step whose work began late (the live step-97
// shape, which is the acceptance case a per-band origin cannot satisfy), a
// dependency that crosses an epic boundary, and a dependency edge that runs
// BACKWARD in time. Every requirement here carries `completed_at` and no
// `started_at`, which is what the live table overwhelmingly looks like.
const TIMED_MODEL = {
    pipeline: { id: 500, title: 'Time axis' },
    epics: [
        { id: 1, title: 'Shipped' },
        { id: 2, title: 'In flight' },
        { id: 3, title: 'Backlog' },
    ],
    features: [
        { id: 11, title: 'F-shipped', epic_fk: 1 },
        { id: 12, title: 'F-flight', epic_fk: 2 },
        { id: 13, title: 'F-backlog', epic_fk: 3 },
    ],
    machines: [],
    steps: [
        { id: 1, pipeline_fk: 500, title: 'Ship A', run: 'auto', completed_at: null },
        { id: 2, pipeline_fk: 500, title: 'Ship B', run: 'auto', completed_at: null },
        { id: 3, pipeline_fk: 500, title: 'Flight A', run: 'auto', completed_at: null },
        // The step-97 shape: no dep edges at all, work begun on the LATEST day.
        { id: 4, pipeline_fk: 500, title: 'Flight late, ungated', run: 'auto', completed_at: null },
        { id: 5, pipeline_fk: 500, title: 'Backlog A', run: 'auto', completed_at: null },
        { id: 6, pipeline_fk: 500, title: 'Backlog B', run: 'auto', completed_at: null },
        // Backward in time: its own work completed on day 1, but it is gated on
        // step 3, whose work began on day 3.
        { id: 7, pipeline_fk: 500, title: 'Ship C, late gate', run: 'auto', completed_at: null },
    ],
    stepDeps: [
        { id: 1, step_fk: 2, dep_step_fk: 1, time_at: null },
        { id: 2, step_fk: 3, dep_step_fk: 2, time_at: null },   // crosses epic 1 -> 2
        { id: 3, step_fk: 6, dep_step_fk: 5, time_at: null },
        { id: 4, step_fk: 7, dep_step_fk: 3, time_at: null },   // backward in time
    ],
    stepRequirements: [
        { step_fk: 1, requirement_fk: 101 },
        { step_fk: 2, requirement_fk: 102 },
        { step_fk: 3, requirement_fk: 103 },
        { step_fk: 4, requirement_fk: 104 },
        { step_fk: 5, requirement_fk: 105 },
        { step_fk: 6, requirement_fk: 106 },
        { step_fk: 7, requirement_fk: 107 },
    ],
    requirements: [
        // `met` with NO started_at — 820 of 960 live `met` rows look like this.
        {
            id: 101, title: 'r101', requirement_status: 'met', feature_fk: 11,
            machine_fk: null, coordination_type: 'implemented', tracking: 0,
            started_at: null, completed_at: '2026-07-25T09:00:00',
        },
        {
            id: 102, title: 'r102', requirement_status: 'met', feature_fk: 11,
            machine_fk: null, coordination_type: 'implemented', tracking: 0,
            started_at: null, completed_at: '2026-07-26T09:00:00',
        },
        {
            id: 103, title: 'r103', requirement_status: 'development', feature_fk: 12,
            machine_fk: null, coordination_type: 'implemented', tracking: 0,
            started_at: '2026-07-27T09:00:00', completed_at: null,
        },
        {
            id: 104, title: 'r104', requirement_status: 'development', feature_fk: 12,
            machine_fk: null, coordination_type: 'implemented', tracking: 0,
            started_at: '2026-07-28T09:00:00', completed_at: null,
        },
        {
            id: 105, title: 'r105', requirement_status: 'authoring', feature_fk: 13,
            machine_fk: null, coordination_type: 'implemented', tracking: 0,
            started_at: null, completed_at: null,
        },
        {
            id: 106, title: 'r106', requirement_status: 'approved', feature_fk: 13,
            machine_fk: null, coordination_type: 'implemented', tracking: 0,
            started_at: null, completed_at: null,
        },
        {
            id: 107, title: 'r107', requirement_status: 'met', feature_fk: 11,
            machine_fk: null, coordination_type: 'implemented', tracking: 0,
            started_at: null, completed_at: '2026-07-25T10:00:00',
        },
    ],
};

// The zero-overlap contract is metric-derived, and req #3201 changed the thing
// the metrics are indexed by (columns are time positions now, so a plan has
// MORE of them and they are sparser). Re-running the four-combination invariant
// under a real-scale timed axis is what keeps that contract from rotting
// silently — the Substrate fixture's 34 steps, with timestamps synthesized from
// each requirement's status so the plan spreads over several day slots and
// acquires backward-in-time edges of its own.
const TIMED_SUBSTRATE = {
    ...SUBSTRATE_REBUILD_MODEL,
    requirements: SUBSTRATE_REBUILD_MODEL.requirements.map((r) => {
        const day = `2026-07-${String(21 + (r.id % 6)).padStart(2, '0')}`;
        if (r.requirement_status === 'met' || r.requirement_status === 'wontfix') {
            return { ...r, started_at: null, completed_at: `${day}T08:00:00` };
        }
        if (r.requirement_status === 'development') {
            return { ...r, started_at: `${day}T08:00:00`, completed_at: null };
        }
        return { ...r, started_at: null, completed_at: null };
    }),
};

const timedPlan = orderedPlan(buildPipelineModel(TIMED_MODEL),
    { now: '2026-07-28T12:00:00Z' });
const timedLayout = computePlanLayout(timedPlan.rows,
    { timeAxis: timedPlan.timeAxis });
// NO `buildPipelineModel` here, and that is the whole point of this line.
// SUBSTRATE_REBUILD_MODEL is a MODEL, not a raw payload — line 34 feeds it to
// `orderedPlan` directly — and its steps carry no `pipeline_fk`, so rebuilding
// it filtered all 34 rows away and every plan-scale test below ran on an EMPTY
// plan, asserting nothing. Shipped that way with req #3201; found in the #3207
// review, which is when it mattered: these are the tests that prove the ruler
// did not break the zero-overlap contract at scale.
const timedSubstratePlan = orderedPlan(TIMED_SUBSTRATE, { now: NOW });
const colOfStep = (layout, id) => layout.nodes.get(id).depth;

// ── Epic focus (req #3204) ──────────────────────────────────────────────────
// The click sets the viewport ONCE and retains nothing, so the whole feature is
// falsifiable right here: two pure functions from (layout, band, viewport) to a
// rectangle and a transform. What the component adds is only the decision to
// route that transform through the d3-zoom behavior, which is a browser
// property and is asserted in the E2E (PIPE-13).
describe('epic focus geometry', () => {
    const layout = computePlanLayout(plan.rows,
        { reqLayout: 'horizontal', stepLabel: 'id' });
    const bandOf = (epic) => {
        const b = layout.bands.find((x) => x.epic === epic);
        expect(b, `the fixture has a "${epic}" band`).toBeTruthy();
        return b;
    };
    const depthsOf = (band) =>
        band.stepIds.map((id) => layout.nodes.get(id).depth).sort((a, b) => a - b);

    // The band's screen-space rectangle under a transform — what the user sees.
    const onScreen = (band, tr) => {
        const r = bandFitRect(layout, band);
        return {
            left: tr.x + r.x * tr.k,
            top: tr.y + r.y * tr.k,
            right: tr.x + (r.x + r.w) * tr.k,
            bottom: tr.y + (r.y + r.h) * tr.k,
        };
    };

    // What the transform OWES each vertical side (req #3274), recomputed here
    // from the published constants rather than read back out of the module's
    // internals: FOCUS_PAD everywhere, plus a label strip on each side that has
    // a neighbour, plus the pinned ruler's scaled height on the top one.
    const reserve = (band, tr) => {
        const n = epicFocusNeighbours(layout, band);
        return {
            // `max(k, 1)`: the strip is screen-sized below k = 1 since req
            // #3365, so the reserve it costs no longer shrinks with zoom.
            top: FOCUS_PAD + (n.above
                ? FOCUS_LABEL_H + RULER_H * Math.max(tr.k, 1) : 0),
            bottom: FOCUS_PAD + (n.below ? FOCUS_LABEL_H : 0),
        };
    };

    it('the rect is the band\'s own vertical extent, header strip included', () => {
        for (const band of layout.bands) {
            const r = bandFitRect(layout, band);
            expect(r).toBeTruthy();
            expect(r.y).toBe(band.y);
            expect(r.h).toBe(band.height);
        }
    });

    // THE load-bearing case, and the one the first cut of this feature got
    // wrong. A step label is CENTRED on its column and sized to
    // `staggerBudget()` — its own column plus 40% of the narrower neighbour on
    // each side — so a label in the band's outermost column legitimately draws
    // OUTSIDE the column extent. Fitting to columns alone clipped it.
    //
    // Parameterised over all FOUR view combinations, because the bug was
    // invisible in the two this suite used to test and worst in the pair
    // PipelineDetail actually defaults to (vertical + title). Measured before
    // the fix, at 1600×820: "Application Backlog" lost 10.6px off the right edge
    // in horizontal+id, and the default view was down to 7.6px of its 44.
    describe.each(COMBOS)('drawn content fits, in $reqLayout + $stepLabel', (combo) => {
        const lay = computePlanLayout(plan.rows, combo);

        // Everything this band's steps actually DRAW: beads and every label
        // carrying one of its step ids. Deliberately recomputed here from the
        // layout's own output rather than reusing bandFitRect — a test that
        // asks the implementation what it drew cannot catch it drawing the
        // wrong thing.
        const drawn = (band) => {
            const ids = new Set(band.stepIds);
            let left = Infinity;
            let right = -Infinity;
            for (const id of ids) {
                const n = lay.nodes.get(id);
                left = Math.min(left, n.x - BEAD_RADIUS);
                right = Math.max(right, n.x + BEAD_RADIUS);
            }
            for (const l of lay.labels) {
                if (l.stepId == null || !ids.has(l.stepId)) continue;
                left = Math.min(left, l.x);
                right = Math.max(right, l.x + (l.w || 0));
            }
            return { left, right };
        };

        it('leaves FOCUS_PAD clear of every mark the band draws', () => {
            const size = { w: 1600, h: 820 };
            const kBase = size.w / lay.width;
            for (const band of lay.bands) {
                const tr = epicFocusTransform(lay, band, size, kBase, kBase * FOCUS_MIN_RATIO);
                expect(tr, band.epic).toBeTruthy();
                const d = drawn(band);
                expect(tr.x + d.left * tr.k, `${band.epic} left`)
                    .toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
                expect(size.w - (tr.x + d.right * tr.k), `${band.epic} right`)
                    .toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
                expect(tr.y + band.y * tr.k, `${band.epic} top`)
                    .toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
                expect(size.h - (tr.y + (band.y + band.height) * tr.k), `${band.epic} bottom`)
                    .toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
            }
        });

        it('contains the band\'s drawn extent inside the fit rectangle', () => {
            for (const band of lay.bands) {
                const r = bandFitRect(lay, band);
                const d = drawn(band);
                expect(r.x, `${band.epic} left`).toBeLessThanOrEqual(d.left + 1e-6);
                expect(r.x + r.w, `${band.epic} right`)
                    .toBeGreaterThanOrEqual(d.right - 1e-6);
            }
        });
    });

    it('spans non-contiguous columns rather than skipping the gap', () => {
        // "Application Backlog" is the fixture's non-contiguous epic: its steps
        // sit at depths 0, 1 and then 11–13, with nothing between. The fit must
        // cover the whole span — there is no honest view that omits the middle.
        const band = bandOf('Application Backlog');
        const depths = depthsOf(band);
        expect(depths[0]).toBe(0);
        expect(depths.at(-1)).toBeGreaterThan(depths[0] + depths.length);
        const r = bandFitRect(layout, band);
        const dMin = depths[0];
        const dMax = depths.at(-1);
        // At LEAST the columns — labels may push it wider, never narrower.
        expect(r.x).toBeLessThanOrEqual(layout.colX[dMin] - layout.colW[dMin] / 2 + 1e-6);
        expect(r.x + r.w)
            .toBeGreaterThanOrEqual(layout.colX[dMax] + layout.colW[dMax] / 2 - 1e-6);
    });

    it('reads only stepIds and node depth — no assumption about band ORDER', () => {
        // Req #3201 reorders the bands. Reversing `layout.bands` must not move
        // a single rectangle.
        const before = layout.bands.map((b) => bandFitRect(layout, b));
        const after = [...layout.bands].reverse().map((b) => bandFitRect(layout, b));
        expect(after.reverse()).toEqual(before);
    });

    it('does NOT widen to the whole plan — a narrow epic fits its own columns', () => {
        const orch = bandFitRect(layout, bandOf('Swarm Orchestration Feature'));
        expect(orch.w).toBeLessThan(layout.width / 2);
        expect(orch.x).toBeGreaterThan(layout.width / 2);
    });

    it('centres the band inside its reserve and leaves at least FOCUS_PAD on all four sides', () => {
        const size = { w: 1200, h: 700 };
        const kBase = size.w / layout.width;
        for (const band of layout.bands) {
            const tr = epicFocusTransform(layout, band, size, kBase, kBase * FOCUS_MIN_RATIO);
            expect(tr, band.epic).toBeTruthy();
            const s = onScreen(band, tr);
            const pad = reserve(band, tr);
            // Horizontally still plain centring — req #3274 changed the
            // vertical axis and nothing else.
            expect(s.left + s.right).toBeCloseTo(size.w, 6);
            // Vertically, the slack is split evenly INSIDE the reserved window
            // `[pad.top, h − pad.bottom]` rather than across the whole panel, so
            // an asymmetric reserve lands where the neighbour actually is. Where
            // the two reserves are equal this reduces to the old `s.top +
            // s.bottom ≈ h`, which is what the no-neighbour bands below assert.
            expect(s.top - pad.top, `${band.epic} slack`)
                .toBeCloseTo((size.h - pad.bottom) - s.bottom, 6);
            // Margin on ALL FOUR sides. `>=` rather than `≈` because the
            // non-binding axis (and any band clamped by the ceiling) gets more.
            expect(s.left, `${band.epic} left`).toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
            expect(s.top, `${band.epic} top`).toBeGreaterThanOrEqual(pad.top - 1e-6);
            expect(size.w - s.right, `${band.epic} right`)
                .toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
            expect(size.h - s.bottom, `${band.epic} bottom`)
                .toBeGreaterThanOrEqual(pad.bottom - 1e-6);
        }
    });

    it('fits as tightly as it can — the binding axis is flush against the margin', () => {
        const size = { w: 1200, h: 700 };
        const kBase = size.w / layout.width;
        // The widest band is not ceiling-clamped, so its fit is the honest one:
        // one axis must land exactly on the pad, or the zoom was not tight.
        const band = bandOf('Swarm Substrate Rebuild');
        const tr = epicFocusTransform(layout, band, size, kBase, kBase * FOCUS_MIN_RATIO);
        const s = onScreen(band, tr);
        const slackX = s.left - FOCUS_PAD;
        const slackY = s.top - reserve(band, tr).top;
        expect(Math.min(slackX, slackY)).toBeCloseTo(0, 6);
    });

    it('clamps a one-step epic to the ceiling instead of zooming absurdly far', () => {
        const size = { w: 1200, h: 700 };
        const kBase = size.w / layout.width;
        const band = bandOf('Primary and Swarm Agentic Integration');
        expect(band.stepIds).toHaveLength(1);
        const tr = epicFocusTransform(layout, band, size, kBase, kBase * FOCUS_MIN_RATIO);
        expect(tr.k / kBase).toBeCloseTo(FOCUS_MAX_RATIO, 9);
        // Unclamped this would have been far tighter — the clamp is doing work,
        // not merely agreeing with the fit.
        const r = bandFitRect(layout, band);
        expect((size.w - 2 * FOCUS_PAD) / r.w).toBeGreaterThan(kBase * FOCUS_MAX_RATIO);
    });

    it('the ceiling lands on the Detail semantic level', () => {
        // Req #3204 point 5: confirm the level the fit lands on is the one a
        // reader wants for "focus on this epic", rather than accepting whatever
        // falls out. semanticLevel() reads the ratio to kBase, which is exactly
        // what FOCUS_MAX_RATIO is expressed in.
        expect(semanticLevel(FOCUS_MAX_RATIO)).toBe('in');
    });

    it('never leaves d3-zoom\'s scaleExtent, at any viewport', () => {
        // `zoom.transform` does NOT constrain what it is handed — unlike
        // scaleTo/translateBy it never calls `constrain`, so nothing re-clamps
        // this at write time. The next WHEEL gesture does clamp against
        // scaleExtent, so an out-of-extent k would look correct until the user's
        // first scroll and then jump. That is what makes this clamp
        // load-bearing rather than defensive, and why it reads the same
        // constants the component hands to scaleExtent.
        expect(FOCUS_MIN_RATIO).toBe(ZOOM_MIN_RATIO);
        expect(FOCUS_MAX_RATIO).toBeLessThanOrEqual(ZOOM_MAX_RATIO);
        for (const size of [{ w: 1200, h: 700 }, { w: 420, h: 2000 },
            { w: 3200, h: 900 }, { w: 200, h: 95 }, { w: 60, h: 40 }]) {
            const kBase = size.w / layout.width;
            for (const band of layout.bands) {
                const tr = epicFocusTransform(layout, band, size, kBase, kBase * FOCUS_MIN_RATIO);
                expect(tr, `${band.epic} @ ${size.w}×${size.h}`).toBeTruthy();
                expect(tr.k).toBeGreaterThanOrEqual(kBase * ZOOM_MIN_RATIO - 1e-9);
                expect(tr.k).toBeLessThanOrEqual(kBase * ZOOM_MAX_RATIO);
                expect(Number.isFinite(tr.x) && Number.isFinite(tr.y)).toBe(true);
            }
        }
    });

    it('the floor engages when a band cannot fit even at the extent minimum', () => {
        // A wide but very short panel: the height fit demands less than the
        // extent's minimum, so the floor takes over and the band overflows
        // vertically rather than the transform leaving the extent d3-zoom will
        // enforce on the next wheel event.
        // 6400, not 1600 (req #3498). The floor is `kBase x FOCUS_MIN_RATIO`
        // and `kBase` is fit-to-WIDTH, so a world 2.3x wider — a card is 407px
        // where a bead was 20 — lowers the floor by the same factor and the
        // height fit stopped being the tighter of the two at this panel. A wider
        // panel restores the case the test exists to cover: the floor engaging,
        // not a particular pixel size.
        const size = { w: 6400, h: 150 };
        const kBase = size.w / layout.width;
        const band = bandOf('Swarm Substrate Rebuild');
        const tr = epicFocusTransform(layout, band, size, kBase, kBase * FOCUS_MIN_RATIO);
        expect(tr.k).toBeCloseTo(kBase * FOCUS_MIN_RATIO, 9);
        // The clamp is doing work — the unclamped fit really was tighter. Stated
        // against the req #3274 reserve, which is what the fit now solves: the
        // label strips come off the available height, and the pinned ruler joins
        // the rect on the fitted side.
        const r = bandFitRect(layout, band);
        const n = epicFocusNeighbours(layout, band);
        const availH = Math.max(size.h * 0.5, size.h - 2 * FOCUS_PAD
            - (n.above ? FOCUS_LABEL_H : 0) - (n.below ? FOCUS_LABEL_H : 0));
        expect(availH / (r.h + (n.above ? RULER_H : 0)))
            .toBeLessThan(kBase * FOCUS_MIN_RATIO);
    });

    it('the pad fallback is continuous — no cliff at 2 × FOCUS_PAD', () => {
        // `w > 2*PAD ? w - 2*PAD : w` reads reasonably and hides a step change:
        // at w=88 it yields 88, at w=89 it yields 1, so one pixel of growth
        // zooms out ~88×. Unreachable in production (the panel has minHeight
        // 480) but a trap for the next caller, so the maths is continuous.
        const band = bandOf('Swarm Substrate Rebuild');
        let prev = null;
        for (let w = 2 * FOCUS_PAD - 4; w <= 2 * FOCUS_PAD + 4; w++) {
            const tr = epicFocusTransform(layout, band, { w, h: 600 }, w / layout.width, (w / layout.width) * FOCUS_MIN_RATIO);
            expect(tr).toBeTruthy();
            if (prev != null) expect(Math.abs(tr.k / prev - 1)).toBeLessThan(0.5);
            prev = tr.k;
        }
    });

    it('returns null rather than NaN geometry on degenerate input', () => {
        const band = layout.bands[0];
        const kBase = 0.5;
        expect(bandFitRect(computePlanLayout([]), band)).toBeNull();
        expect(bandFitRect(layout, { ...band, stepIds: [] })).toBeNull();
        expect(bandFitRect(layout, { ...band, stepIds: [999999] })).toBeNull();
        expect(bandFitRect(layout, { ...band, height: 0 })).toBeNull();
        expect(bandFitRect(layout, null)).toBeNull();
        // No viewport yet (the container has not measured) — nothing to fit to.
        expect(epicFocusTransform(layout, band, { w: 0, h: 0 }, kBase, kBase * FOCUS_MIN_RATIO)).toBeNull();
        expect(epicFocusTransform(layout, band, undefined, kBase, kBase * FOCUS_MIN_RATIO)).toBeNull();
        expect(epicFocusTransform(layout, band, { w: 800, h: 600 }, 0, 0.1)).toBeNull();
    });

    // ── The neighbour flags, on the REAL fixture ────────────────────────────
    it('knows which vertical sides have a neighbouring band (req #3274)', () => {
        const first = layout.bands[0];
        const last = layout.bands[layout.bands.length - 1];
        expect(layout.bands.length).toBeGreaterThan(2);
        expect(epicFocusNeighbours(layout, first)).toEqual({ above: false, below: true });
        expect(epicFocusNeighbours(layout, last)).toEqual({ above: true, below: false });
        for (const band of layout.bands.slice(1, -1)) {
            expect(epicFocusNeighbours(layout, band), band.epic)
                .toEqual({ above: true, below: true });
        }
        // Decided from world Y, never from array position — req #3201 reorders
        // the bands and `bandFitRect` keeps the same discipline.
        const shuffled = { ...layout, bands: [...layout.bands].reverse() };
        for (const band of layout.bands) {
            expect(epicFocusNeighbours(shuffled, band), band.epic)
                .toEqual(epicFocusNeighbours(layout, band));
        }
        // Degenerate inputs answer "nothing to reserve for" rather than throwing.
        expect(epicFocusNeighbours(null, first)).toEqual({ above: false, below: false });
        expect(epicFocusNeighbours(layout, null)).toEqual({ above: false, below: false });
        expect(epicFocusNeighbours({ bands: [first] }, first))
            .toEqual({ above: false, below: false });
        // …AND A BAND IS NEVER ITS OWN NEIGHBOUR, at any height (review
        // finding). The 1e-6 tolerance alone let a band shorter than the
        // tolerance satisfy `b.y + b.height <= top + 1e-6` against its own row
        // and report `{above: true}`; the strict-side terms are what close it,
        // and this is the window they close — `height === 0` was already
        // filtered, so only `(0, 1e-6]` was ever reachable.
        const slivers = [5e-7, 1e-6, 1e-9];
        for (const height of slivers) {
            const sliver = { epic: 'Sliver', y: 100, height, stepIds: [] };
            expect(epicFocusNeighbours({ bands: [sliver] }, sliver), `h=${height}`)
                .toEqual({ above: false, below: false });
            // …and a real band above it is still seen, so the fix did not close
            // the window by refusing to answer at all.
            const over = { epic: 'Over', y: 0, height: 90, stepIds: [] };
            expect(epicFocusNeighbours({ bands: [over, sliver] }, sliver), `h=${height}`)
                .toEqual({ above: true, below: false });
        }
    });
});

// ── Room for the neighbours' names (req #3274) ──────────────────────────────
// Clicking an epic name fits that epic to the viewport (req #3204), and on a
// LARGE epic the fit left the bands above and below `FOCUS_PAD` and nothing
// else — a number that knew nothing about what an epic label needs on screen.
// The reserve is now derived from the chip's own metrics, charged only on a
// side that HAS a neighbour, and the pinned time ruler is charged on top of it
// above (req #3254 pins it; req #3257 stops every name below it).
//
// The two shapes this requirement is about are not in the Substrate fixture —
// the live plan's 4550px `Pipeline` band, and a plan narrow enough that the
// vertical fit lands at a scale where the ruler alone swallows the top strip —
// so both are built by hand here. `bandFitRect` reads only `nodes`/`colX`/
// `colW`/`labels` and `epicFocusNeighbours` reads only `bands`, so a synthetic
// layout drives the real functions rather than a re-implementation of them.
describe('epic focus reserves room for the neighbours\' names (req #3274)', () => {
    const COL_W = 180;
    const GAP = 8;

    const synth = (heights, cols, colWidth = COL_W) => {
        const colX = [];
        const colW = [];
        for (let d = 0; d < cols; d++) {
            colW.push(colWidth);
            colX.push(colWidth / 2 + d * colWidth);
        }
        const nodes = new Map();
        const bands = [];
        // Bands start below the ruler's own unconditional world reservation,
        // exactly as `computePlanLayout` places them.
        let y = RULER_H + GAP;
        let id = 1;
        heights.forEach((h, i) => {
            const stepIds = [];
            for (let d = 0; d < cols; d++) {
                // req #3498 — a node is a BOX. `stepFitRect` measures the
                // card, so a synthetic node carrying only `{depth, x, y}`
                // produces no rect at all and every focus transform built on it
                // returns null. The fixture owes `computePlanLayout`'s shape.
                //
                // The card is sized to THIS FIXTURE'S column rather than to the
                // real `CARD_W`: these bands are hand-measured against a 180px
                // column, and a 407px card in it would put every box outside the
                // world the focus transforms are computed against. What is
                // reproduced is the RELATIONSHIP the layout guarantees — a card
                // fills its column bar the gutter — which is what `stepFitRect`
                // actually reads.
                const cw = colWidth - CARD_GAP_X;
                const top = y + h / 2 - MIN_CARD_H / 2;
                nodes.set(id, {
                    id, depth: d, lane: 0, bandIndex: i,
                    x: colX[d], y: y + h / 2,
                    w: cw, h: MIN_CARD_H,
                    left: colX[d] - cw / 2, right: colX[d] + cw / 2,
                    top, bottom: top + MIN_CARD_H,
                });
                stepIds.push(id);
                id += 1;
            }
            bands.push({
                epic: `Epic ${i + 1}`, epicId: i + 1, epicLabel: `Epic ${i + 1}`,
                y, height: h, headerH: 83, epicLaneH: 62, stepIds,
            });
            y += h + GAP;
        });
        return {
            nodes, colX, colW, labels: [], bands,
            width: cols * colWidth, height: y,
        };
    };

    // The fit this requirement replaced: FOCUS_PAD on all four sides, nothing
    // else. Kept here so "fitted slightly smaller" is a measurement against the
    // old behaviour rather than a claim.
    const unreservedK = (rect, size, kBase) => {
        const availW = Math.max(size.w * 0.5, size.w - 2 * FOCUS_PAD);
        const availH = Math.max(size.h * 0.5, size.h - 2 * FOCUS_PAD);
        return Math.min(
            Math.max(Math.min(availW / rect.w, availH / rect.h), kBase * FOCUS_MIN_RATIO),
            kBase * FOCUS_MAX_RATIO,
        );
    };
    const unreservedTransform = (rect, size, kBase) => {
        const k = unreservedK(rect, size, kBase);
        return {
            x: size.w / 2 - (rect.x + rect.w / 2) * k,
            y: size.h / 2 - (rect.y + rect.h / 2) * k,
            k,
        };
    };

    // What the component draws, through the component's own arguments — the
    // pinned ruler's bottom edge is the top of the content area (req #3257).
    const chipsAt = (lay, tr, size) => placeEpicChips({
        bands: lay.bands, transform: tr, viewport: size, worldWidth: lay.width,
        topInset: rulerScreenBottom(tr),
    });
    const chipOf = (chips, epic) => chips.find((c) => c.text === epic);

    // "Fully on screen" for a name: inside the panel AND below the pinned ruler,
    // because a name drawn under the ruler is a name the reader cannot read.
    const fullyVisible = (chip, tr, size) => !!chip
        && chip.y >= rulerScreenBottom(tr) - 1e-6
        && chip.y + chip.h <= size.h + 1e-6;

    // ── THE REPORTED CASE ───────────────────────────────────────────────────
    // Pipeline 2's band heights, read 2026-08-02 and quoted in the requirement:
    // seven bands, the third of them 4550 world px tall and spanning the width.
    describe('a LARGE epic — tall and wide, the live `Pipeline` band', () => {
        const LIVE_HEIGHTS = [616, 197, 4550, 1040, 616, 885, 522];
        const lay = synth(LIVE_HEIGHTS, 16);
        const big = lay.bands[2];
        const size = { w: 1400, h: 800 };
        const kBase = size.w / lay.width;

        it('leaves a full label strip above and below the focused band', () => {
            const tr = epicFocusTransform(lay, big, size, kBase, kBase * FOCUS_MIN_RATIO);
            const rect = bandFitRect(lay, big);
            const top = tr.y + rect.y * tr.k;
            const bottom = tr.y + (rect.y + rect.h) * tr.k;
            // The fit is the honest one — neither clamp is doing the work here,
            // so what is measured below is the reserve and not the ceiling.
            expect(tr.k).toBeGreaterThan(kBase * FOCUS_MIN_RATIO);
            expect(tr.k).toBeLessThan(kBase * FOCUS_MAX_RATIO);
            // ABOVE: the pad, the label strip, and the ruler that sits over it.
            expect(top - rulerScreenBottom(tr))
                .toBeGreaterThanOrEqual(FOCUS_PAD + FOCUS_LABEL_H - 1e-6);
            // BELOW: the pad and the label strip; nothing is pinned down there.
            expect(size.h - bottom)
                .toBeGreaterThanOrEqual(FOCUS_PAD + FOCUS_LABEL_H - 1e-6);
            // And the strip is big enough for the chip that goes in it, which is
            // the thing the reserve is derived from. Asserted against what
            // `placeEpicChips` actually emits rather than against the constant
            // the reserve was computed from — a chip that grew past its own
            // reservation is exactly the rot this pair exists to catch.
            for (const chip of chipsAt(lay, tr, size)) {
                expect(chip.h, `${chip.text} fits its strip`)
                    .toBeLessThanOrEqual(FOCUS_LABEL_H);
            }
        });

        it('renders BOTH neighbours\' names, fully on screen and clear of the ruler', () => {
            const tr = epicFocusTransform(lay, big, size, kBase, kBase * FOCUS_MIN_RATIO);
            const chips = chipsAt(lay, tr, size);
            for (const epic of ['Epic 2', 'Epic 4']) {
                const chip = chipOf(chips, epic);
                expect(chip, `${epic} has a name on screen`).toBeTruthy();
                expect(fullyVisible(chip, tr, size), `${epic} fully visible`).toBe(true);
            }
        });

        it('IS fitted slightly smaller than the unreserved fit — the trade, stated', () => {
            const rect = bandFitRect(lay, big);
            const tr = epicFocusTransform(lay, big, size, kBase, kBase * FOCUS_MIN_RATIO);
            const kOld = unreservedK(rect, size, kBase);
            expect(tr.k).toBeLessThan(kOld);
            // "Slightly": orientation costs under a sixth of the magnification.
            expect(tr.k / kOld).toBeGreaterThan(0.83);
        });
    });

    // ── THE REPORTED CASE, AT THE PANEL THE READER ACTUALLY HAS ─────────────
    // The block above fits the live band heights into an 800px panel and passes
    // — but it hands `epicFocusTransform` no floor, so it clamps against
    // `kBase * FOCUS_MIN_RATIO`, and on the LIVE plan that is not the floor the
    // page has. `kDefault = max(kFit, K_READABLE)` (req #3168) and the zoom
    // behaviour is configured with `min(kFit, kDefault) * ZOOM_MIN_RATIO`, so on
    // any plan wide enough for the readable default to bind the two differ —
    // measured on pipeline 2 at 1600px: 0.200 against 0.0687.
    //
    // THAT DIFFERENCE, NOT THE PAD, IS WHAT KEPT THE `Pipeline` BAND BROKEN. At
    // 0.200 the band is 910 screen px in an 820px panel: it overflows both
    // reserves, both neighbours leave the viewport, and no pad on either side
    // could have helped. This block is the requirement's first acceptance
    // criterion, stated against the real numbers.
    describe('the live `Pipeline` band, at the live scale floor', () => {
        // A SNAPSHOT OF THE LIVE PLAN'S SHAPE, not a claim about today's plan.
        // Pipeline 2's seven band heights and world width as measured on
        // 2026-08-02; the plan grows every day, and by the end of this session
        // it had already reached 6614 × 9941 with 41 columns. Nothing here is
        // re-derived from live data on purpose — a fixture that tracked a
        // moving plan would change what it tests without anyone editing it.
        //
        // What must not rot is the REGIME, and it is stated rather than
        // implied: a band several times taller than the panel, on a world wide
        // enough for `K_READABLE` to beat fit-to-width, which is where the two
        // floors diverge. The assertions below pin that regime directly (the
        // ratio between the floors, and the band overflowing at the old one),
        // so a snapshot that drifts fails loudly instead of quietly testing
        // nothing. Today's plan is comfortably deeper into the same regime.
        const LIVE_HEIGHTS = [616, 197, 4550, 1040, 616, 885, 522];
        const LIVE_W = 5822;
        const COLS = 16;
        const lay = synth(LIVE_HEIGHTS, COLS, LIVE_W / COLS);
        const big = lay.bands[2];              // the 4550px `Pipeline` band
        // `calc(100vh - 260px)` on a 1080-tall window, at a realistic desktop
        // width — the panel the requester was looking at.
        const size = { w: 1600, h: 820 };
        const kFit = size.w / lay.width;
        const kBase = Math.max(kFit, K_READABLE);       // the page's kDefault
        const kFloor = Math.min(kFit, kBase) * ZOOM_MIN_RATIO;  // its kZoomFloor

        it('REFUSES to fit at all when no floor is handed in', () => {
            // The floor is required, and this is why (second review): made
            // optional, it fell back to `kBase * FOCUS_MIN_RATIO` — the
            // expression this requirement exists to retire — so dropping
            // `kZoomFloor` from the visualizer's call sites silently restored
            // the defect with the whole suite, E2E included, still green. The
            // E2E's fixture plan is small enough that the floor never binds on
            // it, so nothing there could ever have noticed. Refusing turns the
            // same slip into a camera that does not move, which PIPE-14 fails
            // on. Both focus targets, because both take the parameter.
            expect(epicFocusTransform(lay, big, size, kBase)).toBeNull();
            expect(epicFocusTransform(lay, big, size, kBase, 0)).toBeNull();
            expect(epicFocusTransform(lay, big, size, kBase, -1)).toBeNull();
            expect(epicFocusTransform(lay, big, size, kBase, NaN)).toBeNull();
            const stepId = big.stepIds[0];
            expect(stepFocusTransform(lay, stepId, size, kBase)).toBeNull();
            expect(stepFocusTransform(lay, stepId, size, kBase, 0)).toBeNull();
            // …and a real floor still fits, so the guard refuses the omission
            // rather than the function.
            expect(epicFocusTransform(lay, big, size, kBase, kFloor)).toBeTruthy();
            expect(stepFocusTransform(lay, stepId, size, kBase, kFloor)).toBeTruthy();
        });

        it('the two floors really do differ here — the premise, measured', () => {
            expect(kBase).toBeGreaterThan(kFit);              // readable binds
            expect(kFloor).toBeLessThan(kBase * FOCUS_MIN_RATIO);
            expect(kBase * FOCUS_MIN_RATIO / kFloor).toBeGreaterThan(2.5);
        });

        it('the RE-DERIVED floor overflows the panel and loses both names', () => {
            // Exactly what shipped before this requirement: no floor handed in.
            const tr = epicFocusTransform(lay, big, size, kBase, kBase * FOCUS_MIN_RATIO);
            expect(tr.k).toBeCloseTo(kBase * FOCUS_MIN_RATIO, 9);
            const rect = bandFitRect(lay, big);
            expect(rect.h * tr.k).toBeGreaterThan(size.h);    // taller than the panel
            const chips = chipsAt(lay, tr, size);
            expect(chipOf(chips, 'Epic 2')).toBeFalsy();
            expect(chipOf(chips, 'Epic 4')).toBeFalsy();
        });

        it('the BEHAVIOUR\'S floor fits it, and both neighbours are named', () => {
            const tr = epicFocusTransform(lay, big, size, kBase, kFloor);
            const rect = bandFitRect(lay, big);
            // Neither clamp binds now — this is the honest fit.
            expect(tr.k).toBeGreaterThan(kFloor);
            expect(tr.k).toBeLessThan(kBase * FOCUS_MAX_RATIO);
            expect(rect.h * tr.k).toBeLessThan(size.h);
            const top = tr.y + rect.y * tr.k;
            const bottom = tr.y + (rect.y + rect.h) * tr.k;
            expect(top - rulerScreenBottom(tr))
                .toBeGreaterThanOrEqual(FOCUS_PAD + FOCUS_LABEL_H - 1e-6);
            expect(size.h - bottom)
                .toBeGreaterThanOrEqual(FOCUS_PAD + FOCUS_LABEL_H - 1e-6);
            const chips = chipsAt(lay, tr, size);
            for (const epic of ['Epic 2', 'Epic 4']) {
                expect(fullyVisible(chipOf(chips, epic), tr, size), epic).toBe(true);
            }
            // …and it is still inside the extent d3-zoom will enforce, so the
            // reader's first wheel gesture does not jump.
            expect(tr.k).toBeGreaterThanOrEqual(kFloor - 1e-9);
            expect(tr.k).toBeLessThanOrEqual(kBase * ZOOM_MAX_RATIO);
        });

        it('every band of the live plan names both its neighbours at this panel', () => {
            for (let i = 1; i < lay.bands.length - 1; i++) {
                const band = lay.bands[i];
                const tr = epicFocusTransform(lay, band, size, kBase, kFloor);
                const chips = chipsAt(lay, tr, size);
                for (const j of [i - 1, i + 1]) {
                    const epic = lay.bands[j].epic;
                    expect(fullyVisible(chipOf(chips, epic), tr, size),
                        `${band.epic} → ${epic}`).toBe(true);
                }
            }
        });
    });

    // ── THE RESERVE IS THE FULL CHIP, NOT THE FLOORED ONE ───────────────────
    // `FOCUS_LABEL_H` is `EPIC_CHIP_H + 2 · CHIP_MARGIN_Y`, and the block's
    // headline decision is that it is the FULL chip rather than the
    // `EPIC_CHIP_MIN_H` one a zoomed-out band actually draws. Pinned at a scale
    // where the neighbour's chip renders at full size, against the margin the
    // chip itself reports rather than against a hard-coded 2 (review finding:
    // the LARGE-epic case fits at k = 0.14, where every chip is already floored
    // and the assertion had ~10px of slack).
    //
    // ── AND AT A SCALE WHERE THE NEIGHBOUR'S BAND CLEARS THE RULER ──────────
    // The fixture narrowed and shortened at req #3365 (from `[130, 1276, 400]`
    // over 12 columns) for a reason that is a real property of the surface, not
    // a test convenience. The strip is screen-sized below k = 1, so it covers
    // `RULER_H / k` WORLD px while the layout reserves a fixed `8 + RULER_H`
    // above the first band — meaning below **k = 36/44 ≈ 0.818** the top band's
    // own top edge is behind the strip, and its name anchors on the strip's
    // bottom (the `topInset` clamp) instead of on its band. That is the clamp
    // doing its job and the name stays FULLY VISIBLE — the next test pins that
    // case directly — but it is not the case THIS test is about, and the old
    // fixture fitted at k = 0.486. NOTHING here can be reserved to change it:
    // `padTop` moves the world and the strip together, so the gap between the
    // band's top and the strip's bottom is invariant under the reserve.
    it('reserves enough for a FULL-SIZE neighbour chip, margins included', () => {
        const lay = synth([130, 300, 400], 6);
        const mid = lay.bands[1];
        const size = { w: 1400, h: 800 };
        const kBase = size.w / lay.width;
        const tr = epicFocusTransform(lay, mid, size, kBase, kBase * FOCUS_MIN_RATIO);
        // The band above is small enough to sit ENTIRELY inside the reserved
        // strip, so its chip anchors on its own band's top corner and the
        // margin below is the chip's own, not a clamp against the panel.
        const above = lay.bands[0];
        const aboveTop = tr.y + above.y * tr.k;
        expect(aboveTop).toBeGreaterThan(rulerScreenBottom(tr));
        expect(tr.y + (above.y + above.height) * tr.k)
            .toBeLessThan(tr.y + mid.y * tr.k);
        const chip = chipOf(chipsAt(lay, tr, size), 'Epic 1');
        expect(chip).toBeTruthy();
        // FULL SIZE — this is the scale regime the constant is chosen for.
        expect(chip.h).toBeCloseTo(EPIC_CHIP_H, 6);
        const marginY = chip.y - aboveTop;
        expect(marginY).toBeGreaterThan(0);
        // The whole box the name occupies inside its band fits the reserve.
        // A reserve derived from EPIC_CHIP_MIN_H (21.6) fails this by 6.4px.
        expect(chip.h + 2 * marginY).toBeLessThanOrEqual(FOCUS_LABEL_H + 1e-6);
    });

    it('below k ≈ 0.818 the top band goes BEHIND the strip and its name clamps '
        + 'to the strip instead — still fully visible (req #3365)', () => {
        // The regime the test above deliberately steps out of, pinned here so
        // it is a KNOWN outcome rather than an untested corner. req #3274's
        // guarantee is that the neighbour's name is visible and unobstructed;
        // it never promised the name sits inside its own band's top corner at
        // every zoom, and with a screen-sized ruler it cannot.
        const lay = synth([130, 1276, 400], 12);
        const mid = lay.bands[1];
        const size = { w: 1400, h: 800 };
        const kBase = size.w / lay.width;
        const tr = epicFocusTransform(lay, mid, size, kBase, kBase * FOCUS_MIN_RATIO);
        // 44 = the layout's own reservation above the first band, `8 + ruler.h`
        // (module-private; the bands' `y` is what publishes it — `lay.bands[0].y`
        // IS that number, so this reads it rather than restating it).
        expect(tr.k).toBeLessThan(RULER_H / lay.bands[0].y);
        const above = lay.bands[0];
        const aboveTop = tr.y + above.y * tr.k;
        const inset = rulerScreenBottom(tr);
        // The band's top really is behind the strip — the premise.
        expect(aboveTop).toBeLessThan(inset);
        const chip = chipOf(chipsAt(lay, tr, size), 'Epic 1');
        expect(chip).toBeTruthy();
        // …and the name is nonetheless whole, below the strip, inside the panel.
        // `chipsAt` passes `rulerScreenBottom(tr)` as `topInset` itself — the
        // same number the component passes — so this is the real clamp.
        expect(chip.y).toBeGreaterThanOrEqual(inset);
        expect(chip.y + chip.h).toBeLessThanOrEqual(size.h);
    });

    // ── THE CASE THE OLD FIT ACTUALLY LOST ──────────────────────────────────
    // A plan only a few columns wide fits vertically at a scale above 1, and the
    // ruler's height scales with it: at the unreserved fit the band ABOVE ends
    // higher on screen than the ruler's own bottom edge, so its name has no
    // pixel of content area to sit in and `placeEpicChips` emits nothing for it.
    // This is the reserve earning its keep, measured both ways.
    describe('a narrow plan, where the pinned ruler alone swallowed the top strip', () => {
        const lay = synth([400, 400, 400], 4);
        const mid = lay.bands[1];
        const size = { w: 1400, h: 800 };
        const kBase = size.w / lay.width;
        const rect = bandFitRect(lay, mid);

        it('the unreserved fit drops the name of the band ABOVE', () => {
            const old = unreservedTransform(rect, size, kBase);
            expect(old.k).toBeGreaterThan(1);
            expect(chipOf(chipsAt(lay, old, size), 'Epic 1')).toBeFalsy();
        });

        it('the reserved fit renders it, fully clear of the ruler', () => {
            const tr = epicFocusTransform(lay, mid, size, kBase, kBase * FOCUS_MIN_RATIO);
            const chip = chipOf(chipsAt(lay, tr, size), 'Epic 1');
            expect(chip).toBeTruthy();
            expect(fullyVisible(chip, tr, size)).toBe(true);
            // …and the band below keeps its name too.
            const under = chipOf(chipsAt(lay, tr, size), 'Epic 3');
            expect(under).toBeTruthy();
            expect(fullyVisible(under, tr, size)).toBe(true);
        });
    });

    // ── THE EDGES OF THE PLAN ───────────────────────────────────────────────
    it('a TOP-of-plan epic does not waste the reserved strip on the missing side', () => {
        // Eight columns, so the VERTICAL axis binds and the pads are what the
        // band's screen position is actually flush against.
        const lay = synth([1200, 900, 900], 8);
        const first = lay.bands[0];
        const size = { w: 1400, h: 800 };
        const kBase = size.w / lay.width;
        const tr = epicFocusTransform(lay, first, size, kBase, kBase * FOCUS_MIN_RATIO);
        const rect = bandFitRect(lay, first);
        const top = tr.y + rect.y * tr.k;
        const bottom = tr.y + (rect.y + rect.h) * tr.k;
        // Nothing above it to name, so the top side gets the plain pad — flush,
        // not merely "at least".
        expect(top).toBeCloseTo(FOCUS_PAD, 6);
        // The band below still gets its strip, and its name.
        expect(size.h - bottom).toBeGreaterThanOrEqual(FOCUS_PAD + FOCUS_LABEL_H - 1e-6);
        expect(fullyVisible(chipOf(chipsAt(lay, tr, size), 'Epic 2'), tr, size)).toBe(true);
        // And the strip that is not reserved is not lost: the band is fitted
        // LARGER than it would be if both sides were charged for a neighbour.
        const bothSides = synth([1200, 900, 900], 8);
        bothSides.bands.unshift({
            ...bothSides.bands[0], epic: 'Epic 0', epicId: 0, epicLabel: 'Epic 0',
            y: 0, height: RULER_H, stepIds: [],
        });
        expect(tr.k).toBeGreaterThan(epicFocusTransform(bothSides, first, size, kBase, kBase * FOCUS_MIN_RATIO).k);
    });

    it('a BOTTOM-of-plan epic likewise, with the reserve above it only', () => {
        const lay = synth([900, 900, 1200], 8);
        const last = lay.bands[2];
        const size = { w: 1400, h: 800 };
        const kBase = size.w / lay.width;
        const tr = epicFocusTransform(lay, last, size, kBase, kBase * FOCUS_MIN_RATIO);
        const rect = bandFitRect(lay, last);
        const bottom = tr.y + (rect.y + rect.h) * tr.k;
        // Nothing below it to name — flush against the plain pad.
        expect(size.h - bottom).toBeCloseTo(FOCUS_PAD, 6);
        expect(tr.y + rect.y * tr.k - rulerScreenBottom(tr))
            .toBeGreaterThanOrEqual(FOCUS_PAD + FOCUS_LABEL_H - 1e-6);
        expect(fullyVisible(chipOf(chipsAt(lay, tr, size), 'Epic 2'), tr, size)).toBe(true);
    });

    // ── THE SMALL EPIC IS UNTOUCHED ─────────────────────────────────────────
    it('a ONE-STEP epic still lands at the focus ceiling, on the Detail level', () => {
        const layout = computePlanLayout(plan.rows,
            { reqLayout: 'horizontal', stepLabel: 'id' });
        const band = layout.bands.find((b) => b.stepIds.length === 1);
        expect(band, 'the fixture has a one-step band').toBeTruthy();
        const size = { w: 1200, h: 700 };
        const kBase = size.w / layout.width;
        const tr = epicFocusTransform(layout, band, size, kBase, kBase * FOCUS_MIN_RATIO);
        expect(tr.k / kBase).toBeCloseTo(FOCUS_MAX_RATIO, 9);
        expect(semanticLevel(tr.k / kBase)).toBe('in');
        // The reserve moves the band inside the viewport; it never moves the
        // scale a ceiling-clamped fit lands on.
        const rect = bandFitRect(layout, band);
        expect(tr.k).toBeCloseTo(unreservedK(rect, size, kBase), 9);
    });

    // ── THE CONTINUITY GUARD, OVER THE NEW PAD SUM ──────────────────────────
    it('a viewport smaller than twice the pad stays finite and continuous', () => {
        const lay = synth([600, 600, 600], 8);
        const mid = lay.bands[1];
        const rect = bandFitRect(lay, mid);
        const size = { w: 1400 };
        const kBase = size.w / lay.width;
        let prevK = null;
        let prevTop = null;
        // Straight through 2 × FOCUS_PAD and through the full reserved sum,
        // which is where a conditional would put its cliff. In HALF-pixel steps
        // so a discontinuity has nowhere to hide between samples.
        for (let h = 2 * FOCUS_PAD - 8; h <= 2 * FOCUS_PAD + 2 * FOCUS_LABEL_H + 8; h += 0.5) {
            const tr = epicFocusTransform(lay, mid, { ...size, h }, kBase, kBase * FOCUS_MIN_RATIO);
            const where = `h=${h}`;
            expect(tr, where).toBeTruthy();
            expect(Number.isFinite(tr.x) && Number.isFinite(tr.y) && Number.isFinite(tr.k),
                `${where} finite`).toBe(true);
            expect(tr.k, `${where} in extent`)
                .toBeGreaterThanOrEqual(kBase * ZOOM_MIN_RATIO - 1e-9);
            expect(tr.k, `${where} in extent`).toBeLessThanOrEqual(kBase * ZOOM_MAX_RATIO);
            // ── AND THE PLACEMENT, NOT ONLY THE SCALE (review finding) ──────
            // `k` does not read `availY` at all, so a sweep that asserts only
            // `k` cannot see the guard OR the ratio split — both survived a
            // mutation run against the earlier version of this test. This is
            // the regime where the two differ from the shipped code, and the
            // claim they exist for is that the band never leaves the panel.
            const top = tr.y + rect.y * tr.k;
            const bottom = tr.y + (rect.y + rect.h) * tr.k;
            expect(top, `${where} band starts inside the panel`).toBeLessThan(h);
            expect(bottom, `${where} band ends inside the panel`).toBeGreaterThan(0);
            // ── PINNED TO THE VALUE, not merely to a property ───────────────
            // "The band still overlaps the panel" was too weak to see either
            // variant: in this regime the band is ~146px tall in a viewport of
            // at most 152, so it straddles the panel however the reserve is
            // apportioned — a second mutation run put `y: padTop` 50px out and
            // every assertion above still held. So the apportionment itself is
            // re-derived here, independently of the module.
            const nb = epicFocusNeighbours(lay, mid);
            const padTop = FOCUS_PAD + (nb.above
                ? FOCUS_LABEL_H + RULER_H * Math.max(tr.k, 1) : 0);
            const padBottom = FOCUS_PAD + (nb.below ? FOCUS_LABEL_H : 0);
            const availY = Math.max(h * 0.5, h - padTop - padBottom);
            expect(top, `${where} placement`).toBeCloseTo(
                (h - availY) * (padTop / (padTop + padBottom))
                + (availY - rect.h * tr.k) / 2, 9);
            if (prevK != null) {
                expect(Math.abs(tr.k / prevK - 1), `${where} scale cliff`).toBeLessThan(0.5);
                expect(Math.abs(top - prevTop), `${where} placement cliff`).toBeLessThan(2);
            }
            prevK = tr.k;
            prevTop = top;
        }
    });

    it('never leaves d3-zoom\'s scale extent, at any viewport or plan shape', () => {
        for (const heights of [[4550], [616, 4550, 522], [400, 400, 400], [177]]) {
            for (const cols of [2, 16]) {
                const lay = synth(heights, cols);
                for (const size of [{ w: 1200, h: 700 }, { w: 420, h: 2000 },
                    { w: 3200, h: 900 }, { w: 200, h: 95 }, { w: 60, h: 40 }]) {
                    const kBase = size.w / lay.width;
                    for (const band of lay.bands) {
                        const tr = epicFocusTransform(lay, band, size, kBase, kBase * FOCUS_MIN_RATIO);
                        const where = `${band.epic} ${heights}×${cols} @ ${size.w}×${size.h}`;
                        expect(tr, where).toBeTruthy();
                        expect(tr.k, where).toBeGreaterThanOrEqual(kBase * ZOOM_MIN_RATIO - 1e-9);
                        expect(tr.k, where).toBeLessThanOrEqual(kBase * ZOOM_MAX_RATIO);
                        expect(Number.isFinite(tr.x) && Number.isFinite(tr.y), where).toBe(true);
                    }
                }
            }
        }
    });

    // ── STEP FOCUS IS NOT PART OF THIS ──────────────────────────────────────
    // With no neighbours to reserve for, every line of the new arithmetic
    // REDUCES to the old — algebraically, which is not the same as bit for bit:
    // the reserved form reaches the same `y` by a different association of the
    // same terms, and floating point is not associative. Hence a 10-digit
    // comparison rather than `toEqual`; the residual is one ULP (~1e-13 px).
    const sameTransform = (got, want, where) => {
        expect(got, where).toBeTruthy();
        expect(got.k, `${where} k`).toBeCloseTo(want.k, 10);
        expect(got.x, `${where} x`).toBeCloseTo(want.x, 10);
        expect(got.y, `${where} y`).toBeCloseTo(want.y, 10);
    };

    it('leaves STEP focus unchanged — it reserves nothing and never did', () => {
        // A SET of steps, not one: req #3498 re-pointed the SINGLE-card case at
        // a stated scale rather than a fit, so the fit this describe block is
        // about is now only reachable with two or more. The claim is unchanged —
        // a step target reserves no neighbour label strip — and the multi-step
        // path is where it is still falsifiable.
        //
        // req #3503 — no proportional inflation either, since then: the raw
        // rect goes straight into `fitTransform`, which is exactly what
        // `unreservedTransform` computes over the bare rect.
        const layout = computePlanLayout(plan.rows,
            { reqLayout: 'vertical', stepLabel: 'title' });
        const size = { w: 1400, h: 800 };
        const kBase = size.w / layout.width;
        const ids = [...layout.nodes.keys()];
        for (let i = 0; i + 1 < ids.length; i += 1) {
            const pair = [ids[i], ids[i + 1]];
            const rect = stepsFitRect(layout, pair);
            sameTransform(
                stepsFocusTransform(layout, pair, size, kBase, kBase * FOCUS_MIN_RATIO),
                unreservedTransform(rect, size, kBase),
                `steps ${pair.join(',')}`);
        }
        // And the single card reserves nothing either — it is exactly centred
        // on both axes, which is the same claim stated for the path that no
        // longer goes through `fitTransform` at all.
        for (const id of ids) {
            const r = stepFitRect(layout, id);
            const tr = stepFocusTransform(layout, id, size, kBase, kBase * FOCUS_MIN_RATIO);
            expect(tr.x + r.x * tr.k + tr.x + (r.x + r.w) * tr.k, `step ${id} x`)
                .toBeCloseTo(size.w, 6);
            expect(tr.y + r.y * tr.k + tr.y + (r.y + r.h) * tr.k, `step ${id} y`)
                .toBeCloseTo(size.h, 6);
        }
    });

    // ── AND A BAND WITH NO NEIGHBOURS AT ALL ────────────────────────────────
    it('a single-band plan is fitted exactly as it was before this requirement', () => {
        const lay = synth([900], 12);
        const size = { w: 1400, h: 800 };
        const kBase = size.w / lay.width;
        sameTransform(epicFocusTransform(lay, lay.bands[0], size, kBase, kBase * FOCUS_MIN_RATIO),
            unreservedTransform(bandFitRect(lay, lay.bands[0]), size, kBase), 'lone band');
    });
});

// ── Step focus (req #3253) ──────────────────────────────────────────────────
// The requirement page's "view on plan" link lands on ONE STEP rather than
// fitting its whole epic, because on a large epic the epic fit IS a zoomed-out
// view. Same two-pure-functions shape as the epic focus above, and the same
// division of labour: everything here is falsifiable arithmetic, and the
// component adds only the decision to route the transform through d3-zoom.
describe('step focus geometry (req #3253)', () => {
    const layout = computePlanLayout(plan.rows,
        { reqLayout: 'vertical', stepLabel: 'title' });
    const stepIds = [...layout.nodes.keys()];

    // Everything ONE step actually draws — recomputed from the layout's own
    // output rather than by calling stepFitRect, for the reason the band case
    // spells out: a test that asks the implementation what it drew cannot catch
    // it drawing the wrong thing.
    const drawn = (id) => {
        const n = layout.nodes.get(id);
        let left = n.x - BEAD_RADIUS;
        let right = n.x + BEAD_RADIUS;
        let top = n.y - BEAD_RADIUS;
        let bottom = n.y + BEAD_RADIUS;
        for (const l of layout.labels) {
            if (l.stepId !== id) continue;
            left = Math.min(left, l.x);
            right = Math.max(right, l.x + (l.w || 0));
            top = Math.min(top, l.y);
            bottom = Math.max(bottom, l.y + (l.h || 0));
        }
        return { left, right, top, bottom };
    };

    it('contains everything the step draws — label above, req marks below', () => {
        // THE case a bead-only fit gets wrong. A step's requirement marks stack
        // BELOW its bead and its title sits ABOVE it, so centring on the bead
        // alone pushes the requirement ids — the thing the reader followed the
        // link to see — off a tight viewport.
        for (const id of stepIds) {
            const r = stepFitRect(layout, id);
            expect(r, `step ${id}`).toBeTruthy();
            const d = drawn(id);
            expect(r.x, `step ${id} left`).toBeLessThanOrEqual(d.left + 1e-6);
            expect(r.x + r.w, `step ${id} right`).toBeGreaterThanOrEqual(d.right - 1e-6);
            expect(r.y, `step ${id} top`).toBeLessThanOrEqual(d.top + 1e-6);
            expect(r.y + r.h, `step ${id} bottom`).toBeGreaterThanOrEqual(d.bottom - 1e-6);
        }
    });

    it('covers the step\'s own column', () => {
        for (const id of stepIds) {
            const n = layout.nodes.get(id);
            const r = stepFitRect(layout, id);
            expect(r.x).toBeLessThanOrEqual(layout.colX[n.depth] - layout.colW[n.depth] / 2 + 1e-6);
            expect(r.x + r.w)
                .toBeGreaterThanOrEqual(layout.colX[n.depth] + layout.colW[n.depth] / 2 - 1e-6);
        }
    });

    it('IS ZOOMED IN — a step rect is a small fraction of its own band\'s', () => {
        // The whole point of the requirement. Every step sits inside some band,
        // and fitting the step must ask for materially more magnification than
        // fitting that band, or nothing has changed for the reader.
        const size = { w: 1400, h: 800 };
        const kBase = size.w / layout.width;
        for (const band of layout.bands) {
            const bandTr = epicFocusTransform(layout, band, size, kBase, kBase * FOCUS_MIN_RATIO);
            for (const id of band.stepIds) {
                const stepTr = stepFocusTransform(layout, id, size, kBase, kBase * FOCUS_MIN_RATIO);
                expect(stepTr, `step ${id}`).toBeTruthy();
                expect(stepTr.k, `step ${id} in ${band.epic}`)
                    .toBeGreaterThanOrEqual(bandTr.k - 1e-9);
            }
        }
        // And on the fixture's LARGEST band — the case the requirement names —
        // it is not merely "no worse": it is the ceiling against a band that is
        // nowhere near it.
        const big = layout.bands.reduce((a, b) => (b.stepIds.length > a.stepIds.length ? b : a));
        const bandTr = epicFocusTransform(layout, big, size, kBase, kBase * FOCUS_MIN_RATIO);
        const stepTr = stepFocusTransform(layout, big.stepIds[0], size, kBase, kBase * FOCUS_MIN_RATIO);
        expect(stepTr.k / bandTr.k).toBeGreaterThan(2);
        // The ceiling used to be what a single card landed on; req #3498 states
        // its scale instead. Pinned to the STATED number — five columns spanning
        // the viewport — rather than to whatever the fit would have produced.
        expect(stepTr.k).toBeCloseTo(stepsAcrossScale(STEP_FOCUS_STEPS_ACROSS, size.w), 9);
    });

    // A SET of two OR MORE is now a TIGHT fit — no proportional context
    // margin at all (req #3503; see `stepsFocusTransform`'s own doc comment
    // for why a margin proportional to the CONTENT can never converge on
    // "as tight as the viewport allows"). So the multi-step transform is
    // exactly `fitTransform` over the RAW rect: assert the two agree, using
    // fitTransform's own documented formula
    // (`min(availW/rect.w, availH/rect.h)`, no neighbours/ruler reserve on a
    // step target) re-derived independently rather than calling the
    // production function twice.
    it('is a TIGHT fit on a set of two — no inflation, no separate margin (req #3503)', () => {
        const pair = [stepIds[0], stepIds[1]];
        const rect = stepsFitRect(layout, pair);
        const size = { w: 900, h: 640 };
        const availW = Math.max(size.w * 0.5, size.w - 2 * FOCUS_PAD);
        const availH = Math.max(size.h * 0.5, size.h - 2 * FOCUS_PAD);
        const kFitRaw = Math.min(availW / rect.w, availH / rect.h);
        const kBase = kFitRaw / 2;
        const kFloor = kBase * 1e-9;
        expect(kBase * FOCUS_MAX_RATIO).toBeGreaterThan(kFitRaw);
        const tr = stepsFocusTransform(layout, pair, size, kBase, kFloor);
        expect(tr).toBeTruthy();
        expect(tr.k).toBeCloseTo(kFitRaw, 6);
    });

    // AND THE OUTPUT THE REQUIREMENT IS ACTUALLY ABOUT: framing N open-step
    // COLUMNS shows close to N, not some multiple of N that grows with N (the
    // defect a proportional margin could never fix — see the doc comment on
    // `stepsFocusTransform`). The ONLY slack over the raw column span is
    // `fitTransform`'s own fixed `FOCUS_PAD` margin, so on the WIDTH-bound
    // axis the ratio is `size.w / (size.w - 2*FOCUS_PAD)` — independent of
    // how many columns are requested, unlike the retired proportional margin
    // whose ratio grew with the set.
    //
    // THE CEILING-BOUND TRAP: at this describe block's usual
    // `kBase = size.w / layout.width`, the fixture's bands sit on the
    // `FOCUS_MAX_RATIO` ceiling (see 'shares the epic focus's clamp' below),
    // where a small clustered set is magnified to the ceiling regardless of
    // any margin and this ratio is not observable. The component's REAL
    // `kBase` is `readableDefaultScale(kFit)` (its `kDefault`), which is what
    // actually puts a wide-enough set in the fit-bound regime this test is
    // about.
    it('frames N open-step columns at close to N, not a multiple that grows with N (req #3503)', () => {
        const size = { w: 1730, h: 900 };
        const kFit = size.w / layout.width;
        const kBase = readableDefaultScale(kFit);
        const band = layout.bands.find((b) => b.epic === 'Swarm Orchestration Feature');
        expect(band, 'fixture band').toBeTruthy();
        const ids = epicWorkStepIds(plan.rows, layout, band);
        const rect = stepsFitRect(layout, ids);
        const columnsRequested = rect.w / (CARD_W + CARD_GAP_X);
        const tr = stepsFocusTransform(layout, ids, size, kBase, kBase * FOCUS_MIN_RATIO);
        expect(tr).toBeTruthy();
        // The ratio below is only the WIDTH-bound identity — assert that
        // premise directly (the fixture band's single row makes it true;
        // a taller band would have height bind instead and this formula
        // would not apply, even though it would not be ceiling-bound either).
        const availW = Math.max(size.w * 0.5, size.w - 2 * FOCUS_PAD);
        const availH = Math.max(size.h * 0.5, size.h - 2 * FOCUS_PAD);
        expect(availW / rect.w, 'width must be the binding axis')
            .toBeLessThanOrEqual(availH / rect.h);
        const columnsInView = size.w / tr.k / (CARD_W + CARD_GAP_X);
        const expectedRatio = size.w / (size.w - 2 * FOCUS_PAD);
        expect(columnsInView / columnsRequested).toBeCloseTo(expectedRatio, 6);
    });

    it('centres a SET of steps and leaves at least FOCUS_PAD on all four sides', () => {
        const size = { w: 1200, h: 700 };
        const kBase = size.w / layout.width;
        for (let i = 0; i + 1 < stepIds.length; i += 1) {
            const pair = [stepIds[i], stepIds[i + 1]];
            const r = stepsFitRect(layout, pair);
            const tr = stepsFocusTransform(layout, pair, size, kBase, kBase * FOCUS_MIN_RATIO);
            const left = tr.x + r.x * tr.k;
            const top = tr.y + r.y * tr.k;
            const right = tr.x + (r.x + r.w) * tr.k;
            const bottom = tr.y + (r.y + r.h) * tr.k;
            const where = `steps ${pair.join(',')}`;
            expect(left + right).toBeCloseTo(size.w, 6);
            expect(top + bottom).toBeCloseTo(size.h, 6);
            expect(left, `${where} left`).toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
            expect(top, `${where} top`).toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
            expect(size.w - right, `${where} right`).toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
            expect(size.h - bottom, `${where} bottom`).toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
        }
    });

    it('never leaves d3-zoom\'s scaleExtent, at any viewport', () => {
        // THE ACCEPTANCE CRITERION "the first wheel gesture after landing does
        // not jump". `zoom.transform` applies what it is handed verbatim, and
        // the next wheel event clamps against scaleExtent — so an out-of-extent
        // k here would look correct until the reader's first scroll.
        for (const size of [{ w: 1200, h: 700 }, { w: 420, h: 2000 },
            { w: 3200, h: 900 }, { w: 200, h: 95 }, { w: 60, h: 40 }]) {
            const kBase = size.w / layout.width;
            for (const id of stepIds) {
                const tr = stepFocusTransform(layout, id, size, kBase, kBase * FOCUS_MIN_RATIO);
                expect(tr, `step ${id} @ ${size.w}×${size.h}`).toBeTruthy();
                expect(tr.k).toBeGreaterThanOrEqual(kBase * ZOOM_MIN_RATIO - 1e-9);
                expect(tr.k).toBeLessThanOrEqual(kBase * ZOOM_MAX_RATIO);
                expect(Number.isFinite(tr.x) && Number.isFinite(tr.y)).toBe(true);
            }
        }
    });

    it('shares the epic focus\'s clamp rather than a second copy of it', () => {
        // One clamp, or the two desync from `scaleExtent` independently. No pair
        // may exceed the ceiling, and the TIGHT pairs — adjacent steps, whose
        // rect is small enough for the fit to want more than the ceiling allows
        // — must land exactly on it, which is only true if both read
        // FOCUS_MAX_RATIO. A pair spanning distant columns is fit-bound instead
        // and lands below; that is the ceiling not binding, not a second clamp.
        // (The single card is off this path since req #3498 and has its own
        // clamp test below.)
        const size = { w: 1200, h: 700 };
        const kBase = size.w / layout.width;
        let onCeiling = 0;
        for (let i = 0; i + 1 < stepIds.length; i += 1) {
            const pair = [stepIds[i], stepIds[i + 1]];
            const ratio = stepsFocusTransform(layout, pair, size, kBase,
                kBase * FOCUS_MIN_RATIO).k / kBase;
            expect(ratio, `steps ${pair.join(',')}`)
                .toBeLessThanOrEqual(FOCUS_MAX_RATIO + 1e-9);
            if (Math.abs(ratio - FOCUS_MAX_RATIO) < 1e-9) onCeiling += 1;
        }
        // Non-vacuous: the ceiling really is what binds on most of them.
        expect(onCeiling).toBeGreaterThan(stepIds.length / 2);
    });

    it('returns null rather than NaN geometry on degenerate input', () => {
        const id = stepIds[0];
        const kBase = 0.5;
        expect(stepFitRect(layout, 999999)).toBeNull();
        expect(stepFitRect(layout, null)).toBeNull();
        expect(stepFitRect(layout, undefined)).toBeNull();
        expect(stepFitRect(computePlanLayout([]), id)).toBeNull();
        expect(stepFitRect(null, id)).toBeNull();
        expect(stepFocusTransform(layout, 999999, { w: 800, h: 600 }, kBase, kBase * FOCUS_MIN_RATIO)).toBeNull();
        expect(stepFocusTransform(layout, id, { w: 0, h: 0 }, kBase, kBase * FOCUS_MIN_RATIO)).toBeNull();
        expect(stepFocusTransform(layout, id, undefined, kBase, kBase * FOCUS_MIN_RATIO)).toBeNull();
        expect(stepFocusTransform(layout, id, { w: 800, h: 600 }, 0, 0.1)).toBeNull();
    });
});

// ── A SINGLE CARD IS FRAMED AT FIVE COLUMNS (req #3498) ─────────────────────
// User directive, 2026-08-13: *"when zooming into a single step card ... the
// viewport will center on the card vertically and horizontally and provide a
// 5 card width viewport ... anytime we click and the zoom is to a single card"*.
//
// The rule sits in `stepsFocusTransform` rather than in the single-id wrapper,
// so it must hold for BOTH ways of arriving at one card. That is what most of
// this block is: the same three assertions from each entry point.
describe('single-card focus (req #3498)', () => {
    const layout = computePlanLayout(plan.rows,
        { reqLayout: 'vertical', stepLabel: 'title' });
    const stepIds = [...layout.nodes.keys()];
    const SIZES = [{ w: 1730, h: 900 }, { w: 1200, h: 700 }, { w: 900, h: 1400 }];

    // The card's own centre, read off the NODE rather than off `stepFitRect` —
    // the directive is about the card, and a test that asked the fit rect where
    // the card is could not catch the rect drifting off it.
    const cardCentre = (id) => {
        const n = layout.nodes.get(id);
        return { x: n.x, y: (n.top + n.bottom) / 2 };
    };

    it('puts exactly five columns across the viewport', () => {
        for (const size of SIZES) {
            const kBase = size.w / layout.width;
            const want = stepsAcrossScale(STEP_FOCUS_STEPS_ACROSS, size.w);
            for (const id of stepIds) {
                const tr = stepFocusTransform(layout, id, size, kBase, kBase * ZOOM_MIN_RATIO);
                expect(tr, `step ${id} @ ${size.w}`).toBeTruthy();
                expect(tr.k, `step ${id} @ ${size.w}`).toBeCloseTo(want, 9);
                // Stated as the reader would check it: five column pitches span
                // the panel. Independent of `stepsAcrossScale`'s own arithmetic.
                expect(STEP_FOCUS_STEPS_ACROSS * (CARD_W + CARD_GAP_X) * tr.k,
                    `${STEP_FOCUS_STEPS_ACROSS} columns @ ${size.w}`).toBeCloseTo(size.w, 6);
            }
        }
    });

    it('centres the CARD — not its label rect — on both axes', () => {
        for (const size of SIZES) {
            const kBase = size.w / layout.width;
            for (const id of stepIds) {
                const tr = stepFocusTransform(layout, id, size, kBase, kBase * ZOOM_MIN_RATIO);
                const c = cardCentre(id);
                expect(tr.x + c.x * tr.k, `step ${id} cx @ ${size.w}`)
                    .toBeCloseTo(size.w / 2, 6);
                expect(tr.y + c.y * tr.k, `step ${id} cy @ ${size.w}`)
                    .toBeCloseTo(size.h / 2, 6);
            }
        }
    });

    it('the whole card is on screen at that scale', () => {
        // Five columns across means one card occupies a fifth of the width, so
        // horizontal containment is arithmetic. The VERTICAL side is the one
        // worth asserting: a tall card in a short panel is the case a stated
        // scale could get wrong where a fit could not.
        for (const size of SIZES) {
            const kBase = size.w / layout.width;
            for (const id of stepIds) {
                const n = layout.nodes.get(id);
                const tr = stepFocusTransform(layout, id, size, kBase, kBase * ZOOM_MIN_RATIO);
                const where = `step ${id} @ ${size.w}×${size.h}`;
                expect(tr.x + n.left * tr.k, `${where} left`).toBeGreaterThan(0);
                expect(tr.x + n.right * tr.k, `${where} right`).toBeLessThan(size.w);
                expect(tr.y + n.top * tr.k, `${where} top`).toBeGreaterThan(0);
                expect(tr.y + n.bottom * tr.k, `${where} bottom`).toBeLessThan(size.h);
            }
        }
    });

    it('BOTH entry points take the rule — the ?step= link and a one-step epic', () => {
        // `stepFocusTransform` is the requirement editor's deep link;
        // `stepsFocusTransform` with one id is an epic whose second click
        // resolves to a single step. They must be the same camera, or the rule
        // covers one road to the card and silently misses the other.
        const size = { w: 1400, h: 800 };
        const kBase = size.w / layout.width;
        for (const id of stepIds) {
            const a = stepFocusTransform(layout, id, size, kBase, kBase * ZOOM_MIN_RATIO);
            const b = stepsFocusTransform(layout, [id], size, kBase, kBase * ZOOM_MIN_RATIO);
            expect(b, `step ${id}`).toEqual(a);
        }
    });

    it('counts PLACED steps, not ids — an unlaid sibling does not buy a fit', () => {
        // `stepsFitRect` skips ids that resolve to nothing (req #3365), so a
        // two-id set with one unlaid step frames exactly one card and must be
        // framed as one. Counting the input would give that reader a fit, and
        // the two differ for a reason invisible on screen.
        const size = { w: 1400, h: 800 };
        const kBase = size.w / layout.width;
        const id = stepIds[0];
        const solo = stepFocusTransform(layout, id, size, kBase, kBase * ZOOM_MIN_RATIO);
        expect(placedStepCount(layout, [id, 999999])).toBe(1);
        expect(stepsFocusTransform(layout, [id, 999999], size, kBase, kBase * ZOOM_MIN_RATIO))
            .toEqual(solo);
        // Duplicates collapse for the same reason — a set is a set.
        expect(placedStepCount(layout, [id, id, id])).toBe(1);
        expect(stepsFocusTransform(layout, [id, id], size, kBase, kBase * ZOOM_MIN_RATIO))
            .toEqual(solo);
        // Two REAL steps are two, and take the fit.
        expect(placedStepCount(layout, [stepIds[0], stepIds[1]])).toBe(2);
        expect(placedStepCount(layout, [])).toBe(0);
        expect(placedStepCount(null, [id])).toBe(0);
        expect(placedStepCount(layout, null)).toBe(0);
    });

    it('a single card is a STATED scale, not fitted — no margin of any kind applies', () => {
        // Since req #3498 a single step never reaches `fitTransform` at all
        // (req #3503 removed the last vestige of a margin from the multi-step
        // fit too — see `stepsFocusTransform`'s doc comment), so the proof is
        // that a step with 1 requirement and a step with many — two very
        // different rect heights — land on the SAME scale.
        const size = { w: 1400, h: 800 };
        const kBase = size.w / layout.width;
        const heights = stepIds.map((id) => stepFitRect(layout, id).h);
        expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights) * 1.2);
        const ks = stepIds.map((id) =>
            stepFocusTransform(layout, id, size, kBase, kBase * ZOOM_MIN_RATIO).k);
        for (const k of ks) expect(k).toBeCloseTo(ks[0], 12);
    });

    it('never leaves d3-zoom\'s scaleExtent — the clamp is the hard one', () => {
        // The aesthetic FOCUS_MAX_RATIO ceiling is deliberately NOT applied
        // here, so the only thing standing between a stated scale and a first
        // wheel event that snaps the camera is this clamp. Extreme viewports
        // make it bind in both directions.
        for (const size of [{ w: 1200, h: 700 }, { w: 420, h: 2000 },
            { w: 3200, h: 900 }, { w: 200, h: 95 }, { w: 60, h: 40 }]) {
            const kBase = size.w / layout.width;
            for (const id of stepIds) {
                const tr = stepFocusTransform(layout, id, size, kBase, kBase * ZOOM_MIN_RATIO);
                const where = `step ${id} @ ${size.w}×${size.h}`;
                expect(tr, where).toBeTruthy();
                expect(tr.k, where).toBeGreaterThanOrEqual(kBase * ZOOM_MIN_RATIO - 1e-9);
                expect(tr.k, where).toBeLessThanOrEqual(kBase * ZOOM_MAX_RATIO + 1e-9);
                expect(Number.isFinite(tr.x) && Number.isFinite(tr.y), where).toBe(true);
            }
        }
    });

    it('centreTransform returns null rather than NaN geometry', () => {
        const rect = { x: 0, y: 0, w: 100, h: 100 };
        const size = { w: 800, h: 600 };
        expect(centreTransform(null, size, 1, 1, 0.1)).toBeNull();
        expect(centreTransform(rect, { w: 0, h: 600 }, 1, 1, 0.1)).toBeNull();
        expect(centreTransform(rect, undefined, 1, 1, 0.1)).toBeNull();
        expect(centreTransform(rect, size, 0, 1, 0.1)).toBeNull();
        expect(centreTransform(rect, size, NaN, 1, 0.1)).toBeNull();
        expect(centreTransform(rect, size, 1, 0, 0.1)).toBeNull();
        expect(centreTransform(rect, size, 1, 1, 0)).toBeNull();
        // And the ordinary case really does centre.
        const tr = centreTransform(rect, size, 2, 4, 0.1);
        expect(tr.k).toBe(2);
        expect(tr.x + 50 * 2).toBeCloseTo(400, 9);
        expect(tr.y + 50 * 2).toBeCloseTo(300, 9);
    });

    it('a card is still framed when the viewport is too small for a scale', () => {
        // The fall-through. `stepsAcrossScale` needs a width; without one the
        // single-card path produces nothing and the FIT must still run, so the
        // reader gets a camera rather than a click that does nothing.
        const kBase = 0.5;
        expect(stepFocusTransform(layout, stepIds[0], { w: 0, h: 600 }, kBase, 0.1)).toBeNull();
        expect(stepFocusTransform(layout, stepIds[0], { w: 800, h: 600 }, kBase, 0.1)).toBeTruthy();
    });
});

describe('the base view = factory default scale (req #3216 D1, req #3312)', () => {
    const kFit = 0.8;
    // The caller's own configured floor, passed in rather than re-derived
    // (review finding) — see the function's own comment for why. Computed
    // here exactly as PipelinePlanVisualizer computes `kZoomFloor`, so these
    // tests exercise the real contract between the two.
    const kFloor = kFit * ZOOM_MIN_RATIO;

    it('kFit wins when the plan already fits vertically at that scale', () => {
        // width-bound: at kFit the world is 500 tall against a 900px viewport,
        // so nothing about the vertical axis needs correcting.
        const k = factoryDefaultScale({ height: 500 }, { w: 1000, h: 900 }, kFit, kFloor);
        expect(k).toBe(kFit);
    });

    it('zooms out further than kFit on a plan too TALL to fit at it — the D1 bug', () => {
        // height-bound: at kFit (0.8) a 2000-tall world needs 1600px of
        // viewport and only 900 are on offer — the exact shape of "reset
        // lands somewhere the user still has to zoom out from".
        const size = { w: 1000, h: 900 };
        const layout = { height: 2000 };
        const k = factoryDefaultScale(layout, size, kFit, kFloor);
        expect(k).toBeLessThan(kFit);
        // THE ACCEPTANCE BAR ITSELF: the whole vertical extent fits at k.
        expect(k * layout.height).toBeLessThanOrEqual(size.h + 1e-9);
    });

    it('never goes below the caller\'s own configured floor', () => {
        // Absurdly tall — the vertical fit alone would ask for a k far below
        // what the caller's own scaleExtent permits. The floor wins, matching
        // what a user's own scroll-to-zoom-out is already capped at, rather
        // than writing a transform the next wheel event would snap away from
        // (see the function's own comment).
        const size = { w: 1000, h: 900 };
        const layout = { height: 400_000 };
        const k = factoryDefaultScale(layout, size, kFit, kFloor);
        expect(k).toBe(kFloor);
        // Confirms the floor really is the binding constraint here, not a
        // coincidence — the raw vertical fit is well below it.
        expect(size.h / layout.height).toBeLessThan(kFloor);
    });

    it('honours a floor the caller derives from something other than kFit * ZOOM_MIN_RATIO', () => {
        // The whole point of taking the floor as a parameter: this function
        // must not assume any particular relationship between kFit and the
        // floor, because the caller's own `Math.min(kFit, kDefault)` collapse
        // is a fact about `kDefault`'s CURRENT formula, not a law this
        // function may lean on. An arbitrary floor above kFit clamps the
        // result up to it, whatever the vertical fit would have asked for.
        const size = { w: 1000, h: 900 };
        const layout = { height: 400_000 };
        const oddFloor = kFit * 1.5;
        expect(factoryDefaultScale(layout, size, kFit, oddFloor)).toBe(oddFloor);
    });

    it('falls back to kFit when the viewport or the plan has not measured yet', () => {
        expect(factoryDefaultScale({ height: 500 }, { w: 0, h: 0 }, kFit, kFloor)).toBe(kFit);
        expect(factoryDefaultScale({ height: 500 }, undefined, kFit, kFloor)).toBe(kFit);
        expect(factoryDefaultScale({ height: 0 }, { w: 1000, h: 900 }, kFit, kFloor)).toBe(kFit);
        expect(factoryDefaultScale(null, { w: 1000, h: 900 }, kFit, kFloor)).toBe(kFit);
    });

    // ── THE LANDING VIEW IS THIS SCALE (req #3312) ──────────────────────────
    // The ask, as arithmetic: "replace the default view with the same viewport
    // you derive with the reset button". In the renderer that is structural —
    // `resetView` applies ONE expression and both the landing effect and the
    // header's Reset nonce call it, so there is no second number for a test to
    // catch drifting. What IS reachable from here, and worth pinning, is what
    // the reader consequently sees: on the plan this was filed against, a view
    // the readable default could not give them.
    //
    // MEASURED GEOMETRY, not synthetic: the module's own Substrate Rebuild
    // fixture through `computePlanLayout`, which is a real 34-step plan laying
    // out to 2540.88 × 1356. The panel sizes are the real ones the page can
    // present (the panel's own `minHeight: 480` up to a tall display). Every
    // number below is READ from the layout rather than restated, so a change to
    // the row pitch moves the fixture and the cases with it.
    describe('is the view a plan opens in (req #3312)', () => {
        const world = computePlanLayout(plan.rows);
        // Exactly as PipelinePlanVisualizer derives them, so these cases
        // exercise the real contract between the three numbers rather than a
        // convenient floor.
        const scales = (size) => {
            const kFitHere = size.w / world.width;
            const kDefaultHere = readableDefaultScale(kFitHere);
            const floorHere = Math.min(kFitHere, kDefaultHere) * ZOOM_MIN_RATIO;
            return {
                kFitHere,
                kDefaultHere,
                floorHere,
                kLand: factoryDefaultScale(world, size, kFitHere, floorHere),
            };
        };

        for (const [panelW, panelH] of [[1200, 480], [1440, 720], [1800, 900]]) {
            it(`shows the whole plan on open — ${panelW}x${panelH}`, () => {
                const size = { w: panelW, h: panelH };
                const { kFitHere, kDefaultHere, floorHere, kLand } = scales(size);

                // THE ACCEPTANCE BAR: the whole vertical extent is on screen at
                // the scale the plan opens at. The floor is not binding on any
                // of these panels — asserted, so a case cannot pass by clamping
                // instead of fitting.
                expect(kLand, 'floor is not what produced this').toBeGreaterThan(floorHere);
                expect(kLand * world.height).toBeLessThanOrEqual(size.h + 1e-9);

                // AND IT IS STRICTLY FURTHER OUT THAN THE VIEW IT REPLACED.
                // `kDefault` is 0.8 on all three panels; at that scale this world
                // is 1084.8px tall with its origin in the panel's top-left
                // corner, which is where "zoomed into the top epic's name" came
                // from. Asserted rather than described, so the case still means
                // something if the fixture grows.
                expect(kLand).toBeLessThan(kDefaultHere);
                expect(kDefaultHere * world.height,
                    'the replaced view did NOT fit vertically').toBeGreaterThan(size.h);
                // Width was never the binding axis here — the plan fits across
                // at `kFit` on every one of these panels and still did not fit
                // DOWN, which is the whole shape of the defect.
                expect(kLand).toBeLessThanOrEqual(kFitHere);
            });
        }

        // THE COST, asserted rather than described — a reader meets it on open
        // and the memory doc claims it. On a plan this tall the landing is below
        // the legibility gate, so the page opens as bare beads: precisely what
        // the header's Reset has produced on plans this size since req #3216,
        // and what was asked for. Stated here so a future change that quietly
        // re-raises the landing has to come through this case.
        it('opens below the label gate on a plan too tall to fit legibly', () => {
            const { kDefaultHere, kLand } = scales({ w: 1440, h: 900 });
            expect(labelsLegible(kLand)).toBe(false);
            // The scale it replaced was legible — the trade, in one line.
            expect(labelsLegible(kDefaultHere)).toBe(true);
        });

        // A SMALL PLAN IS UNTOUCHED. Where the world already fits both axes at
        // fit-to-width, the landing is `kFit` — the same view #3168 gave it,
        // labels and all — so this requirement costs nothing on plans that were
        // never the problem.
        it('is unchanged on a plan that already fits at a legible scale', () => {
            const layout = { width: 900, height: 400 };
            const size = { w: 1440, h: 900 };
            const kFitHere = size.w / layout.width;          // 1.6
            const kDefaultHere = readableDefaultScale(kFitHere);
            const floorHere = Math.min(kFitHere, kDefaultHere) * ZOOM_MIN_RATIO;
            const kLand = factoryDefaultScale(layout, size, kFitHere, floorHere);
            expect(kLand).toBe(kFitHere);
            expect(kLand).toBe(kDefaultHere);
            expect(labelsLegible(kLand)).toBe(true);
        });
    });
});

describe('time axis — vertical band order (req #3201)', () => {
    it('stacks bands by derived epic start, never-started last', () => {
        expect(timedLayout.bands.map((b) => b.epic))
            .toEqual(['Shipped', 'In flight', 'Backlog']);
    });

    it('derives an epic start from completed_at when started_at was never stamped', () => {
        expect(timedPlan.timeAxis.bandStarts.get(1)).toBe('2026-07-25T09:00:00');
        expect(timedPlan.timeAxis.bandStarts.get(2)).toBe('2026-07-27T09:00:00');
        expect(timedPlan.timeAxis.bandStarts.get(3)).toBe(null);
    });
});

describe('epic bands stack by `epics.sort_order` (req #3430)', () => {
    // The user sets an epic order and the order the user sets is the order the
    // user sees (ruling 2026-08-09). THIS is the surface that ruling is about:
    // the band stack is what a person reads off the Pipeline Visualizer as "the
    // order of the epics", and `displayOrder`'s own epic tie-break never reaches
    // it — the stack is sorted here, from `epics.sort_order` off the row.
    //
    // Built on TIMED_MODEL on purpose: its derived-start order is Shipped, In
    // flight, Backlog (asserted directly above), so every `sort_order` below is
    // deliberately fighting a rule that already has a confident answer.
    const stackOf = (epics, extra = {}) => {
        const model = { ...TIMED_MODEL, epics, ...extra };
        const ordered = orderedPlan(buildPipelineModel(model),
            { now: '2026-07-28T12:00:00Z' });
        const layout = computePlanLayout(ordered.rows,
            { timeAxis: ordered.timeAxis });
        return layout.bands.map((b) => b.epic);
    };

    it('the user order wins outright over the derived start', () => {
        expect(stackOf([
            { id: 1, title: 'Shipped', sort_order: 3 },
            { id: 2, title: 'In flight', sort_order: 2 },
            { id: 3, title: 'Backlog', sort_order: 1 },
        ])).toEqual(['Backlog', 'In flight', 'Shipped']);
    });

    it('an unordered epic falls back to derived start, BELOW every ordered one', () => {
        // Backlog has never started — it sorts LAST under req #3201 and FIRST
        // here, which is the whole point: one explicit position outranks the
        // derived rule, and the epics the user said nothing about keep it.
        expect(stackOf([
            { id: 1, title: 'Shipped' },
            { id: 2, title: 'In flight' },
            { id: 3, title: 'Backlog', sort_order: 1 },
        ])).toEqual(['Backlog', 'Shipped', 'In flight']);
    });

    it('NULL is unordered, not zeroth', () => {
        expect(stackOf([
            { id: 1, title: 'Shipped', sort_order: null },
            { id: 2, title: 'In flight', sort_order: null },
            { id: 3, title: 'Backlog', sort_order: 1 },
        ])).toEqual(['Backlog', 'Shipped', 'In flight']);
    });

    it('equal values fall through to the derived start rather than tying', () => {
        expect(stackOf([
            { id: 1, title: 'Shipped', sort_order: 7 },
            { id: 2, title: 'In flight', sort_order: 7 },
            { id: 3, title: 'Backlog', sort_order: 7 },
        ])).toEqual(['Shipped', 'In flight', 'Backlog']);
    });

    it('the label-less "No epic" band is still last of all', () => {
        // It can never carry a `sort_order`, so it lands among the unordered —
        // and the req #3201 tie-break that put it last still applies there.
        const stack = stackOf([
            { id: 1, title: 'Shipped', sort_order: 3 },
            { id: 2, title: 'In flight', sort_order: 2 },
            { id: 3, title: 'Backlog', sort_order: 1 },
        ], {
            steps: [...TIMED_MODEL.steps, {
                id: 8, pipeline_fk: 500, title: 'Unlabelled', run: 'auto',
                completed_at: null,
            }],
        });
        expect(stack).toEqual(['Backlog', 'In flight', 'Shipped', 'No epic']);
    });

    it('a stringly-typed column still stacks numerically', () => {
        expect(stackOf([
            { id: 1, title: 'Shipped', sort_order: '10' },
            { id: 2, title: 'In flight', sort_order: '9' },
            { id: 3, title: 'Backlog', sort_order: '  ' },
        ])).toEqual(['In flight', 'Shipped', 'Backlog']);
    });
});

describe('a band is a plain column read — no re-tallying in this module (req #3372 item 1)', () => {
    // Bands are keyed on `row.epicId` alone, whatever it holds — this module
    // never re-derives it from a requirement -> feature -> epic walk (that
    // tally is upstream, out of this module's scope by req #3372's own
    // boundary: "you own the DRAWING ... consume its output"). Two steps
    // carrying the SAME `epicId` band together regardless of how many
    // requirements either has; two with DIFFERENT ids never merge.
    const mk = (id, epicId, epic, reqIds = []) => ({
        id, title: `s${id}`, run: 'auto', state: 'pending', reqIds,
        depIds: [], timeDeps: [], epicId, epic,
        epicLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
    });

    it('groups purely by epicId, independent of the requirement count behind it', () => {
        // The two epic-6 rows deliberately carry DIFFERENT non-empty reqIds
        // sets — if this module were re-tallying instead of reading the
        // column, a requirement-count-driven grouping would split them.
        const rows = [
            mk(1, 6, 'Mapping', [101, 102]), mk(2, 6, 'Mapping', [103]),
            mk(3, 7, 'Backlog', [104, 105, 106]),
        ];
        const layout = computePlanLayout(rows);
        expect(layout.bands.map((b) => b.epicId).sort((a, b) => a - b)).toEqual([6, 7]);
        expect(layout.nodes.get(1).bandIndex).toBe(layout.nodes.get(2).bandIndex);
        expect(layout.nodes.get(3).bandIndex).not.toBe(layout.nodes.get(1).bandIndex);
    });

    // COVERS: VIS-002
    it('epic grouping wins over a global topological sort — a cross-epic dep '
        + 'pointing "backward" through band order does not reorder the bands '
        + '(req #3375)', () => {
        // Step 1 (epic 6, the FIRST band) depends on step 2 (epic 7, the
        // SECOND band) — the opposite direction a global topological sort
        // would want (it would need epic 7's step rendered before epic 6's).
        // "Display order is a tree walk: epic order first, then the
        // dependency graph WITHIN each epic" means this edge affects arc
        // ROUTING (tested elsewhere as legal/cross-epic) and nothing about
        // which band either step is in or which band comes first.
        const rows = [
            { ...mk(1, 6, 'Mapping'), depIds: [2] },
            mk(2, 7, 'Backlog'),
        ];
        const layout = computePlanLayout(rows);
        expect(layout.bands.map((b) => b.epicId)).toEqual([6, 7]);
        expect(layout.nodes.get(1).bandIndex).toBe(0);
        expect(layout.nodes.get(2).bandIndex).toBe(1);
    });

    it('a null epicId still bands on its own — the "No epic" case is not assumed unreachable', () => {
        // Req #3372's body instructs deleting this branch on the premise that
        // `epic_fk` is NOT NULL upstream. MEASURED against the live code path
        // (2026-08-10): req #3462 reverted req #3381's composed-read cutover
        // the same day this requirement was worked, so the only live consumer
        // of this module (`PipelineDetail.jsx`, via `pipelineModel.js`) still
        // derives `epicId` by a requirement -> feature -> epic tally that CAN
        // return null (a step with no linked requirement and nothing to
        // inherit from). Deleting the null-band branch here would misrender —
        // or throw on — that still-live case, so it is kept deliberately. See
        // req #3372's completion report / follow-on for the structural fix.
        const rows = [mk(1, 6, 'Mapping'), mk(2, null, 'No epic')];
        const layout = computePlanLayout(rows);
        expect(layout.bands).toHaveLength(2);
        expect(layout.bands.some((b) => b.epicId == null)).toBe(true);
        expect(layout.nodes.get(1).bandIndex).not.toBe(layout.nodes.get(2).bandIndex);
    });
});

describe('cross-epic dependency edges stay legal — sameBand keeps routing, reports nothing '
    + '(req #3372 item 3, gate-delta F1)', () => {
    // Gate-delta F1 (stage-2 review pass, 2026-08-08) supersedes item 3's
    // original "convert sameBand into a reported violation" instruction: a
    // cross-epic arc is LEGAL and `sameBand` stays a pure boolean routing
    // input — no assertion, no reported violation. This fixture is the
    // POSITIVE case the delta calls for: proof the layout draws a normal
    // 'early' arc across a band boundary rather than warning, crashing, or
    // dropping it.
    const mk = (id, epicId, depIds = []) => ({
        id, title: `s${id}`, run: 'auto', state: 'pending', reqIds: [],
        depIds, timeDeps: [], epicId, epic: `epic-${epicId}`,
        epicLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
    });
    const rows = [mk(1, 6), mk(2, 7, [1])];
    const layout = computePlanLayout(rows);
    const arc = layout.arcs.find((a) => a.fromId === 1 && a.toId === 2);

    it('routes the cross-band arc as an ordinary "early" shape', () => {
        expect(arc).toBeTruthy();
        expect(arc.route).toBe('early');
    });

    it('draws it like any other arc — no violation, warning or side-channel field', () => {
        expect(arc.path).toBeTruthy();
        expect(layout.arcs.length).toBe(1);
        expect(Object.keys(arc).sort()).toEqual(
            ['fromId', 'toId', 'straight', 'route', 'x1', 'y1', 'x2', 'y2', 'path'].sort());
        expect(layout.violations).toBeUndefined();
    });
});

describe('time axis — horizontal position (req #3201)', () => {
    it('every arc still points forward — no step renders left of a dependency', () => {
        for (const r of timedPlan.rows) {
            for (const d of r.depIds) {
                expect(colOfStep(timedLayout, d)).toBeLessThan(colOfStep(timedLayout, r.id));
                expect(timedLayout.nodes.get(d).x).toBeLessThan(timedLayout.nodes.get(r.id).x);
            }
        }
    });

    it('renders a NEVER-STARTED epic right of every started epic, with no dep edge', () => {
        const started = timedPlan.rows
            .filter((r) => r.epicId !== 3).map((r) => colOfStep(timedLayout, r.id));
        const never = timedPlan.rows
            .filter((r) => r.epicId === 3).map((r) => colOfStep(timedLayout, r.id));
        expect(Math.min(...never)).toBeGreaterThan(Math.max(...started));
        // …and it got there without borrowing anybody's dependency edge.
        for (const r of timedPlan.rows.filter((x) => x.epicId === 3)) {
            for (const d of r.depIds) expect(timedPlan.rows.find((x) => x.id === d).epicId).toBe(3);
        }
    });

    it('puts an UNGATED late step right of the epic that finished before it', () => {
        // The live step-97 case: step 4 has NO dependencies at all, and must
        // still render right of everything whose work happened earlier. This is
        // what removes the need for a synthetic dep edge.
        const late = colOfStep(timedLayout, 4);
        for (const id of [1, 2, 3]) expect(colOfStep(timedLayout, id)).toBeLessThan(late);
        expect(timedPlan.rows.find((r) => r.id === 4).depIds).toEqual([]);
    });

    it('monotonizes a BACKWARD-IN-TIME edge rather than drawing the arc backwards', () => {
        // Step 7's own work completed on day 1, but it is gated on step 3
        // (day 3). Its column follows the gate, not the stamp.
        expect(colOfStep(timedLayout, 7)).toBeGreaterThan(colOfStep(timedLayout, 3));
        expect(timedLayout.slotOf.get(7)).toBe(timedLayout.slotOf.get(3));
    });

    it('orders the slots chronologically, with the future slot last', () => {
        expect(timedLayout.slots.map((s) => s.day)).toEqual([
            '2026-07-25', '2026-07-26', '2026-07-27', '2026-07-28', null,
        ]);
        expect(timedLayout.slots[timedLayout.slots.length - 1].kind).toBe('future');
        for (let i = 1; i < timedLayout.slots.length; i++) {
            expect(timedLayout.slots[i].origin)
                .toBeGreaterThan(timedLayout.slots[i - 1].origin);
        }
    });

    it('starts every slot strictly right of the last column any earlier slot reaches', () => {
        // The property the whole design rests on, asserted from OUTPUT: it is
        // what makes "unstarted renders right of started" true in general, not
        // just for this fixture's epics.
        const maxColInSlot = timedLayout.slots.map(() => -1);
        for (const r of timedPlan.rows) {
            const k = timedLayout.slotOf.get(r.id);
            const c = colOfStep(timedLayout, r.id);
            if (c > maxColInSlot[k]) maxColInSlot[k] = c;
        }
        for (let k = 1; k < timedLayout.slots.length; k++) {
            expect(timedLayout.slots[k].origin).toBeGreaterThan(maxColInSlot[k - 1]);
        }
    });
});

// ── Review regressions (req #3201) ─────────────────────────────────────────
// Three shapes the first cut of the axis got wrong. Each one is asserted from
// LAYOUT OUTPUT, not from the classifier, because the classifier being right is
// only half the claim — the column is what the user sees.
describe('time axis — review regressions', () => {
    const build = (rows, reqs) => {
        const model = {
            pipeline: { id: 900, title: 'r' },
            epics: [{ id: 1, title: 'E' }, { id: 2, title: 'F' }],
            features: [{ id: 21, title: 'fe', epic_fk: 1 }, { id: 22, title: 'ff', epic_fk: 2 }],
            machines: [],
            steps: rows.map((r) => ({
                id: r.id, pipeline_fk: 900, title: `s${r.id}`, run: 'auto',
                completed_at: r.completedAt || null,
            })),
            stepDeps: rows.flatMap((r) => (r.depIds || []).map((d, i) => ({
                id: r.id * 100 + i, step_fk: r.id, dep_step_fk: d, time_at: null,
            }))),
            stepRequirements: rows.flatMap((r) => (r.reqIds || [])
                .map((q) => ({ step_fk: r.id, requirement_fk: q }))),
            requirements: reqs,
        };
        const p = orderedPlan(buildPipelineModel(model), { now: '2026-07-10T00:00:00Z' });
        return {
            plan: p,
            layout: computePlanLayout(p.rows, { timeAxis: p.timeAxis }),
        };
    };
    const r = (o) => ({
        id: 1, title: 't', requirement_status: 'met', feature_fk: 21, machine_fk: null,
        coordination_type: 'implemented', tracking: 0, started_at: null,
        completed_at: null, ...o,
    });

    // Critical: `deferred` is TERMINAL, so the engine derives `done` from it.
    // Calling it not-yet-started put a done step in the future zone AND, since
    // the monotone max propagates FUTURE, dragged its whole subtree there —
    // step 2 finished 07-01 rendered right of step 3 which finished 07-02.
    it('keeps a DONE step derived from a deferred requirement out of the future zone', () => {
        const { plan, layout } = build(
            [
                { id: 1, depIds: [], reqIds: [1] },
                { id: 2, depIds: [1], reqIds: [2] },
                { id: 3, depIds: [], reqIds: [3] },
            ],
            [
                r({ id: 1, requirement_status: 'deferred' }),
                r({ id: 2, completed_at: '2026-07-01T00:00:00' }),
                r({ id: 3, completed_at: '2026-07-02T00:00:00' }),
            ],
        );
        for (const row of plan.rows) expect(row.state).toBe(STEP_DONE);
        expect(layout.slots.some((s) => s.kind === 'future')).toBe(false);
        // Step 2 finished BEFORE step 3, so it may not render to its right.
        expect(layout.nodes.get(2).depth).toBeLessThan(layout.nodes.get(3).depth);
    });

    // Warning: UNKNOWN means "no claim", so it must not be handed the leftmost
    // column — that is the claim "earliest of all". The un-run manual gate here
    // used to render LEFT of finished work.
    it('does not push an UNKNOWN step left of dated work', () => {
        const { layout } = build(
            [
                { id: 1, depIds: [], reqIds: [1] },
                { id: 2, depIds: [], reqIds: [] },   // req-less, not complete
            ],
            [r({ id: 1, completed_at: '2026-07-01T00:00:00' })],
        );
        expect(layout.nodes.get(2).depth).not.toBeLessThan(layout.nodes.get(1).depth);
        expect(layout.slots.some((s) => s.kind === 'unknown')).toBe(false);
    });

    // Warning: a NULL start meant both "not begun" and "begun but unstamped",
    // so a pure BACKLOG epic could stack above an ACTIVE one on an id tie-break.
    it('stacks an unstamped ACTIVE epic above a never-started backlog epic', () => {
        const { layout } = build(
            [
                { id: 1, depIds: [], reqIds: [1] },   // epic 2 — in flight, unstamped
                { id: 2, depIds: [], reqIds: [2] },   // epic 1 — untouched backlog
            ],
            [
                r({ id: 1, requirement_status: 'development', feature_fk: 22 }),
                r({ id: 2, requirement_status: 'authoring', feature_fk: 21 }),
            ],
        );
        expect(layout.bands.map((b) => b.epic)).toEqual(['F', 'E']);
    });
});

describe('time axis — the zero-overlap contract still holds at plan scale', () => {
    // THE GUARD ON THE GUARD. Every assertion below is a for-all over
    // `layout.labels`, and a for-all over nothing passes. This block ran on an
    // empty plan from req #3201 until the #3207 review caught it, so the
    // preconditions are asserted rather than assumed: PLAN SCALE is the point of
    // these tests, and "plan scale" is a claim about the data, not the code.
    it('runs on a real, multi-slot, multi-band plan — not on an empty one', () => {
        expect(timedSubstratePlan.rows.length)
            .toBe(SUBSTRATE_REBUILD_MODEL.steps.length);
        const layout = computePlanLayout(timedSubstratePlan.rows, { timeAxis: timedSubstratePlan.timeAxis });
        expect(layout.empty).toBe(false);
        expect(layout.slots.length).toBeGreaterThan(2);
        expect(layout.bands.length).toBeGreaterThan(1);
        expect(layout.labels.filter((l) => l.kind === 'slot').length)
            .toBeGreaterThan(1);
    });

    for (const combo of COMBOS) {
        const name = `${combo.stepLabel}`;
        const layout = computePlanLayout(timedSubstratePlan.rows,
            { ...combo, timeAxis: timedSubstratePlan.timeAxis });

        it(`no two labels intersect (${name})`, () => {
            assertNoLabelOverlap(layout, name);
        });

        // req #3498 — was "no label intersects any bead". On a TIMED plan the
        // columns are time slots, so this is where a card in a crowded day would
        // show up as text escaping its own box.
        it(`every label sits inside its own card (${name})`, () => {
            for (const label of layout.labels) {
                if (label.stepId == null) continue;
                const n = layout.nodes.get(label.stepId);
                const where = `${label.kind} of step ${label.stepId}`;
                expect(label.x, where).toBeGreaterThanOrEqual(n.left - 0.01);
                expect(label.x + label.w, where).toBeLessThanOrEqual(n.right + 0.01);
                expect(label.y, where).toBeGreaterThanOrEqual(n.top - 0.01);
                expect(label.y + label.h, where).toBeLessThanOrEqual(n.bottom + 0.01);
            }
        });

        it(`every arc points forward (${name})`, () => {
            for (const r of timedSubstratePlan.rows) {
                for (const d of r.depIds) {
                    expect(layout.nodes.get(d).depth).toBeLessThan(layout.nodes.get(r.id).depth);
                }
            }
        });

        it(`never stacks two beads on one (band, column, lane) cell (${name})`, () => {
            const seen = new Set();
            for (const n of layout.nodes.values()) {
                const cell = `${n.bandIndex}|${n.depth}|${n.lane}`;
                expect(seen.has(cell)).toBe(false);
                seen.add(cell);
            }
        });
    }
});

// ── The TIME RULER (req #3207) ─────────────────────────────────────────────
// #3201 ordered the columns by date and drew nothing; this is the strip that
// makes them READABLE as dates. Two claims are load-bearing and both are
// asserted from layout OUTPUT rather than from the inputs:
//
//   1. the ruler's rects are ordinary `layout.labels` entries, so the
//      zero-overlap contract in all four reqLayout × stepLabel combinations
//      already covers them — no second, untested class of text;
//   2. the reserved height is UNCONDITIONAL, so no level, plan shape or label
//      mode relayouts the plan and zoom stays a pure transform.
describe('time ruler (req #3207)', () => {
    const rulerLabels = (layout) => layout.labels.filter((l) => l.kind === 'slot');

    it('emits one ruler slot per axis slot, in the same order', () => {
        expect(timedLayout.ruler.slots.map((s) => s.key))
            .toEqual(timedLayout.slots.map((s) => s.key));
        expect(timedLayout.ruler.slots.map((s) => s.origin))
            .toEqual(timedLayout.slots.map((s) => s.origin));
    });

    it('gives every slot a strictly increasing, gapless x-extent covering the world', () => {
        const rs = timedLayout.ruler.slots;
        expect(rs[0].x).toBeLessThanOrEqual(timedLayout.colX[0]);
        for (let i = 1; i < rs.length; i++) {
            expect(rs[i].x).toBeGreaterThan(rs[i - 1].x);
            // A slot ends exactly where the next begins: the columns BETWEEN
            // two origins belong to the earlier slot, so a region bounded by
            // its own origin column would draw a five-column day one column
            // wide.
            expect(rs[i - 1].x + rs[i - 1].w).toBeCloseTo(rs[i].x, 6);
        }
        const last = rs[rs.length - 1];
        expect(last.x + last.w).toBeLessThanOrEqual(timedLayout.width);
    });

    it('puts every step inside the x-extent of its OWN slot', () => {
        // The one claim a reader makes from the strip: this bead is under this
        // date. It is a property of two independently-derived numbers (the
        // slot's origin column and the step's column), so it is worth checking.
        for (const r of timedPlan.rows) {
            const s = timedLayout.ruler.slots[timedLayout.slotOf.get(r.id)];
            const n = timedLayout.nodes.get(r.id);
            expect(n.x).toBeGreaterThanOrEqual(s.x);
            expect(n.x).toBeLessThanOrEqual(s.x + s.w);
        }
    });

    it('labels the dated slots as calendar days and the future slot as future', () => {
        const texts = timedLayout.ruler.slots.map((s) => s.label);
        expect(texts).toEqual([
            "Jul 25 '26", 'Jul 26', 'Jul 27', 'Jul 28', 'future',
        ]);
        expect(timedLayout.ruler.futureX)
            .toBe(timedLayout.ruler.slots[timedLayout.ruler.slots.length - 1].x);
    });

    it('carries the calendar GAP so adjacent columns two days apart can say so', () => {
        // Slots are dense in COLUMNS and sparse in TIME. Every gap here is 1
        // (consecutive days); the gapped case gets its own plan below.
        const gaps = timedLayout.ruler.slots.filter((s) => s.kind === 'dated')
            .map((s) => s.gapDays);
        expect(gaps).toEqual([null, 1, 1, 1]);
    });

    it('measures a real gap in DAYS, not in slots', () => {
        const gapped = {
            ...TIMED_MODEL,
            requirements: TIMED_MODEL.requirements.map((r) => (r.id === 102
                // 102 was 07-26. Push it past the plan's last day (07-28) to
                // 07-31, so the ruler's final two dated slots are ADJACENT
                // columns three calendar days apart — the sparse-in-time,
                // dense-in-columns case the requirement names.
                ? { ...r, completed_at: '2026-07-31T09:00:00' } : r)),
        };
        const p = orderedPlan(buildPipelineModel(gapped), { now: '2026-08-01T12:00:00Z' });
        const L = computePlanLayout(p.rows, { timeAxis: p.timeAxis });
        const days = L.ruler.slots.filter((s) => s.kind === 'dated');
        const gap = days.find((s) => s.day === '2026-07-31');
        expect(gap).toBeDefined();
        // Its predecessor on the AXIS is 07-28, not 07-30: the distance is
        // measured in calendar days between the two slots that are actually
        // adjacent, which is the whole point — a slot-count would say 1.
        expect(days[days.indexOf(gap) - 1].day).toBe('2026-07-28');
        expect(gap.gapDays).toBe(3);
        // …and the FIRST dated slot has no predecessor to have skipped
        // anything, so it reports null rather than a fabricated 0.
        expect(days[0].gapDays).toBeNull();
    });

    it('disambiguates a year boundary rather than drawing two identical dates', () => {
        const spanning = {
            ...TIMED_MODEL,
            requirements: TIMED_MODEL.requirements.map((r) => {
                if (r.id === 101) return { ...r, completed_at: '2025-07-25T09:00:00' };
                if (r.id === 107) return { ...r, completed_at: '2025-07-25T10:00:00' };
                if (r.id === 102) return { ...r, completed_at: '2026-07-25T09:00:00' };
                return r;
            }),
        };
        const p = orderedPlan(buildPipelineModel(spanning), { now: '2026-07-28T12:00:00Z' });
        const L = computePlanLayout(p.rows, { timeAxis: p.timeAxis });
        const days = L.ruler.slots.filter((s) => s.kind === 'dated');
        expect(days[0].label).toBe("Jul 25 '25");
        // The same calendar day one year on must NOT render as a second bare
        // 'Jul 25' — two identical labels on one axis is the lie the ruler
        // exists to prevent.
        const y26 = days.find((s) => s.day === '2026-07-25');
        expect(y26.label).toBe("Jul 25 '26");
        expect(new Set(days.map((s) => s.label)).size).toBe(days.length);
    });

    it('degrades by THINNING labels, never by overlapping them', () => {
        // A 200-slot axis on columns too narrow to carry 200 dates. The greedy
        // pass must drop labels; what it may never do is emit two that meet.
        const slots = Array.from({ length: 200 }, (_, i) => ({
            key: `1:2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
            kind: 'dated',
            day: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
            origin: i,
        }));
        const colW = slots.map(() => 22);
        const colX = [];
        { let acc = 66; for (const w of colW) { colX.push(acc + w / 2); acc += w; } }
        const ruler = computeRuler(slots, colX, colW, 66 + 200 * 22 + 54);
        const shown = ruler.slots.filter((s) => s.showLabel);
        expect(shown.length).toBeGreaterThan(0);
        expect(shown.length).toBeLessThan(slots.length);   // it really thinned
        for (let i = 1; i < shown.length; i++) {
            expect(shown[i].labelX)
                .toBeGreaterThanOrEqual(shown[i - 1].labelX + shown[i - 1].labelW);
        }
    });

    it('always labels the FUTURE tick, displacing a date if it has to', () => {
        // The boundary a plan is opened to find. Built so the future slot's
        // origin sits a few px past a dated one — the exact case the greedy
        // left-to-right pass would otherwise drop.
        const slots = [
            { key: '1:2026-01-01', kind: 'dated', day: '2026-01-01', origin: 0 },
            { key: '1:2026-01-02', kind: 'dated', day: '2026-01-02', origin: 1 },
            { key: '2:future', kind: 'future', day: null, origin: 2 },
        ];
        const colW = [200, 8, 200];
        const colX = [];
        { let acc = 66; for (const w of colW) { colX.push(acc + w / 2); acc += w; } }
        const ruler = computeRuler(slots, colX, colW, 66 + 408 + 54);
        const fut = ruler.slots[2];
        expect(fut.showLabel).toBe(true);
        // …and nothing it displaced is still drawn on top of it.
        for (const s of ruler.slots) {
            if (s === fut || !s.showLabel) continue;
            const meets = s.labelX < fut.labelX + fut.labelW
                && fut.labelX < s.labelX + s.labelW;
            expect(meets).toBe(false);
        }
    });

    it('keeps the last tick inside the world it is measured against', () => {
        for (const l of rulerLabels(timedLayout)) {
            expect(l.x).toBeGreaterThanOrEqual(0);
            expect(l.x + l.w).toBeLessThanOrEqual(timedLayout.width);
        }
    });

    it('puts the ruler text in `labels`, so the overlap contract covers it', () => {
        // The requirement's own acceptance constraint. Not a separate class of
        // text with its own private checks.
        expect(rulerLabels(timedLayout).length)
            .toBe(timedLayout.ruler.slots.filter((s) => s.showLabel).length);
        for (const l of rulerLabels(timedLayout)) {
            expect(l.h).toBeGreaterThan(0);
            expect(l.w).toBeGreaterThan(0);
            expect(l.prose).toBe(false);   // generated from a date, not stored prose
        }
        assertNoLabelOverlap(timedLayout, 'timed plan with ruler');
    });

    it('never lets a ruler tick reach a band, a bead or any other label', () => {
        for (const opts of COMBOS) {
            const layout = computePlanLayout(timedPlan.rows,
                { ...opts, timeAxis: timedPlan.timeAxis });
            assertNoLabelOverlap(layout, `${opts.stepLabel} + ruler`);
            for (const l of rulerLabels(layout)) {
                // Above every band, by construction: the reservation is what
                // the first band's y is offset by.
                expect(l.y + l.h).toBeLessThanOrEqual(layout.bands[0].y);
                for (const n of layout.nodes.values()) {
                    expect(rectsOverlap(l, beadRect(n))).toBe(false);
                }
            }
        }
    });

    it('reserves its height UNCONDITIONALLY — a level or mode change never relayouts', () => {
        // Zoom is a pure transform (pipelinePlanLayout deviation 2). The ruler
        // takes the same room in every combination, on a timed plan and on an
        // untimed one, so nothing a reader can toggle moves a bead because of
        // the strip.
        const heights = new Set();
        for (const opts of COMBOS) {
            heights.add(computePlanLayout(timedPlan.rows,
                { ...opts, timeAxis: timedPlan.timeAxis }).ruler.h);
            heights.add(computePlanLayout(plan.rows, opts).ruler.h);
        }
        expect(heights.size).toBe(1);
        expect([...heights][0]).toBe(RULER_H);
        // …and it is genuinely charged: the first band sits below it.
        expect(timedLayout.bands[0].y).toBeGreaterThanOrEqual(RULER_H);
    });

    it('degenerates honestly with no time axis: one slot, labelled undated', () => {
        // The no-timeAxis path is a real path (computeTimeColumns' degenerate
        // case), and a plan with no dates must not render a blank strip that
        // reads as a rendering fault.
        const untimed = computePlanLayout(plan.rows);
        expect(untimed.ruler.slots).toHaveLength(1);
        expect(untimed.ruler.slots[0].kind).toBe('unknown');
        expect(untimed.ruler.slots[0].label).toBe('undated');
        expect(untimed.ruler.slots[0].showLabel).toBe(true);
        expect(untimed.ruler.futureX).toBeNull();
        assertNoLabelOverlap(untimed, 'untimed plan with ruler');
    });

    it('returns an INERT ruler for the empty plan rather than omitting it', () => {
        const empty = computePlanLayout([]);
        expect(empty.ruler).toEqual({ h: RULER_H, slots: [], futureX: null });
    });

    it('renders a tick with no # — the production directive covers generated text', () => {
        for (const l of rulerLabels(timedLayout)) expect(l.text).not.toContain('#');
    });
});

// ── The sticky ruler pin (req #3254) ────────────────────────────────────────
// The ruler used to be plain world content — attached to the top of the
// timeline, so panning down scrolled it away with the rest of the plan.
// `stickyRulerY`/`rulerScreenBottom` are the pure pin primitives the canvas
// now anchors the ruler's Group to instead of `t.y` directly — same shape as
// `computeDayHeaders`' `Math.max(axisH, screenY)`, simplified to the one-strip
// case (nothing pushes it, nothing for it to drop behind).
describe('sticky ruler pin (req #3254)', () => {
    it('draws at the natural position while the world has not scrolled past the top', () => {
        expect(stickyRulerY({ x: 0, y: 0, k: 1 })).toBe(0);
        expect(stickyRulerY({ x: 0, y: 40, k: 1 })).toBe(40);
        expect(stickyRulerY({ x: 0, y: 200, k: 2.5 })).toBe(200);
    });

    it('clamps flush to the viewport top once the natural position scrolls past it', () => {
        expect(stickyRulerY({ x: 0, y: -1, k: 1 })).toBe(0);
        expect(stickyRulerY({ x: 0, y: -600, k: 1 })).toBe(0);
        expect(stickyRulerY({ x: 0, y: -3000, k: 3 })).toBe(0);
    });

    it('degrades safely on a missing or malformed transform', () => {
        expect(stickyRulerY(null)).toBe(0);
        expect(stickyRulerY(undefined)).toBe(0);
        expect(stickyRulerY({})).toBe(0);
    });

    it("rulerScreenBottom is the pinned Y plus the strip's own scaled height", () => {
        // Scrolled past — pinned to 0, so the bottom edge is exactly RULER_H
        // scaled by k, the number req #3257 clamps epic names below.
        expect(rulerScreenBottom({ x: 0, y: -400, k: 1 })).toBe(RULER_H);
        expect(rulerScreenBottom({ x: 0, y: -400, k: 2 })).toBe(RULER_H * 2);
        // Not yet scrolled past — natural position adds to the strip height.
        expect(rulerScreenBottom({ x: 0, y: 50, k: 1 })).toBe(50 + RULER_H);
    });

    it('accepts a custom ruler height, defaulting to RULER_H', () => {
        expect(rulerScreenBottom({ x: 0, y: -400, k: 1 }, 20)).toBe(20);
        expect(rulerScreenBottom({ x: 0, y: 0, k: 1 })).toBe(RULER_H);
    });

    it('degrades safely on a missing or zero/negative k', () => {
        expect(rulerScreenBottom(null)).toBe(RULER_H);
        expect(rulerScreenBottom({ x: 0, y: 0, k: 0 })).toBe(RULER_H);
        expect(rulerScreenBottom({ x: 0, y: 0, k: -1 })).toBe(RULER_H);
    });
});

// ── The strip's vertical axis is SCREEN space (req #3365) ──────────────────
//
// The user directive: *"as the pipeline is moved to see the lower epics, the
// pipeline visualized will scroll up and go below the time part which is still
// transparent and this causes clutter."* The strip HAD an opaque plate; what it
// did not have was a plate as tall as its own type, because req #3365's first
// pass pinned the date glyphs to a fixed screen size and left every other mark
// in the strip scaling with `t.k`. `rulerScreenMag` is the one counter-scale
// they now all share.
describe('screen-sized ruler strip (req #3365)', () => {
    it('magnifies below k = 1 and never shrinks the strip above it', () => {
        expect(rulerScreenMag({ x: 0, y: 0, k: 0.2 })).toBeCloseTo(5, 9);
        expect(rulerScreenMag({ x: 0, y: 0, k: 0.5 })).toBeCloseTo(2, 9);
        // CLAMPED AT 1. Past k = 1 the world scale already exceeds the screen
        // size wanted, and dividing would start shrinking the strip below
        // RULER_H — a second extreme in place of the one being removed.
        expect(rulerScreenMag({ x: 0, y: 0, k: 1 })).toBe(1);
        expect(rulerScreenMag({ x: 0, y: 0, k: 4 })).toBe(1);
    });

    it('degrades safely on a missing or zero/negative k', () => {
        for (const t of [null, undefined, {}, { k: 0 }, { k: -3 }, { k: NaN }]) {
            expect(rulerScreenMag(t), String(JSON.stringify(t))).toBe(1);
        }
    });

    it('holds the strip at a CONSTANT screen height across every zoom-out', () => {
        // The defect stated as an invariant: the plate the renderer draws is
        // `RULER_H · rulerScreenMag(t)` in the `t.k`-scaled sticky Group, so its
        // rendered height is that product times `k`. Below k = 1 it must not
        // move at all — a strip that thins with zoom is a strip its own text
        // outgrows, which is what let plan content show through it.
        for (const k of [0.1, 0.15, 0.2077, 0.5, 0.99]) {
            const t = { x: 0, y: -900, k };
            const screenH = RULER_H * rulerScreenMag(t) * k;
            expect(screenH, `k=${k}`).toBeCloseTo(RULER_H, 9);
        }
        // And above it, the old world-scaled behaviour is untouched.
        for (const k of [1, 2, 4]) {
            const t = { x: 0, y: -900, k };
            expect(RULER_H * rulerScreenMag(t) * k, `k=${k}`)
                .toBeCloseTo(RULER_H * k, 9);
        }
    });

    it('never reports a strip SHORTER than the type it backs', () => {
        // The actual failure, measured: at plan 7's landing scale the plate was
        // `RULER_H · k` = 7.48px of screen under `PLAN_VIZ_FONT.slot` = 13px of
        // text, so two thirds of every date hung over live beads. The label's
        // own baseline sits `RULER_LABEL_Y` into the strip, and both are now
        // counter-scaled, so the whole line clears the plate at every zoom.
        const RULER_LABEL_Y = 12;   // module-private; the renderer reads it via
                                    // `label.y`, which is what this stands in for
        for (const k of [0.1, 0.2077, 0.5, 1, 3]) {
            const t = { x: 0, y: -900, k };
            const mag = rulerScreenMag(t);
            const plateBottom = RULER_H * mag * k;
            const textBottom = (RULER_LABEL_Y * mag + PLAN_VIZ_FONT.slot * mag) * k;
            expect(textBottom, `type escaped the plate at k=${k}`)
                .toBeLessThanOrEqual(plateBottom + 1e-9);
        }
    });

    it('is the SAME number rulerScreenBottom reports, not a parallel copy', () => {
        // Three call sites share this derivation (plate, type, and the inset
        // req #3257 clamps epic names below). A literal in any of them would
        // let the strip and its own reported edge disagree.
        for (const k of [0.2, 1, 2.5]) {
            const t = { x: 0, y: -750, k };
            expect(rulerScreenBottom(t))
                .toBeCloseTo(stickyRulerY(t) + RULER_H * rulerScreenMag(t) * k, 9);
        }
    });
});

// ── The epic band palette (req #3219, "no brown, no muddy tones on dark") ───
//
// DIRT NEVER COMES BACK. Two dimensions, per the requirement: every entry must
// clear a contrast floor against the ACTUAL panel (read from PLAN_VIZ_PALETTE,
// never a second hardcoded copy) and a saturation floor, with BOTH floors
// raised for the warm hue range where dirt lives (orange through yellow — and,
// per brown's own hue, the red-orange approach to it).
//
// THE THRESHOLDS, measured against the colours being kept and the colours being
// removed (2026-08-01):
//   general contrast >= 2.7 — below every kept colour's floor (pink 2.94, the
//     tightest) and above both roundly-rejected values (old indigo 2.23, brown
//     1.85).
//   general saturation >= 0.55 — below every kept colour's floor (pink 0.78,
//     the tightest) and above both rejected values (old indigo 0.50, brown
//     0.26).
//   warm range: hue in [10, 70) — covers brown (14.2) and orange (21.8-30.4)
//     without reaching pink's 336.4 or any of the cool hues.
//   warm contrast >= 6.5, warm saturation >= 0.85 — the raised floor. The
//     load-bearing case is the OLD orange (#f57c00): it clears the general
//     floor easily (6.39, 1.00) and would pass a one-dimensional guard, which
//     is exactly the "clears the floor and still reads muddy" failure the
//     requirement names. The new orange (7.75, 1.00) clears the raised floor
//     with margin; brown fails it far more decisively than the general floor
//     alone (0.26 saturation against an 0.85 requirement).
const EPIC_PANEL = PLAN_VIZ_PALETTE.panel;
const EPIC_GENERAL_MIN_CONTRAST = 2.7;
const EPIC_GENERAL_MIN_SAT = 0.55;
const EPIC_WARM_HUE_MIN = 10;
const EPIC_WARM_HUE_MAX = 70;
const EPIC_WARM_MIN_CONTRAST = 6.5;
const EPIC_WARM_MIN_SAT = 0.85;

// Returns null if `hex` clears the guard, else a human-readable reason naming
// the value and the numbers it failed on — a bare assertion failure teaches
// nobody, per the requirement's own instruction.
function epicPaletteViolation(hex, label) {
    // `channels()` decodes only 6-digit `#rrggbb` — a shorthand, an 8-digit
    // alpha hex or an rgb() string would silently measure the WRONG bytes
    // (e.g. `#7c4dffcc` decodes as `#4dffcc`, a different colour) rather than
    // failing, so an out-of-format entry is rejected here before it is ever
    // measured.
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return `${label} ${hex}: unsupported colour format`;
    const c = contrast(hex, EPIC_PANEL);
    const { h, s } = hueSat(hex);
    const warm = h >= EPIC_WARM_HUE_MIN && h < EPIC_WARM_HUE_MAX;
    const minC = warm ? EPIC_WARM_MIN_CONTRAST : EPIC_GENERAL_MIN_CONTRAST;
    const minS = warm ? EPIC_WARM_MIN_SAT : EPIC_GENERAL_MIN_SAT;
    const fails = [];
    if (c < minC) fails.push(`contrast ${c.toFixed(2)} below the ${warm ? 'warm' : 'general'} floor of ${minC}`);
    if (s < minS) fails.push(`saturation ${s.toFixed(2)} below the ${warm ? 'warm' : 'general'} floor of ${minS}`);
    if (fails.length === 0) return null;
    const tag = warm ? `warm hue at ${h.toFixed(1)}°` : `hue ${h.toFixed(1)}°`;
    return `${label} ${hex}: ${tag}, ${fails.join(', ')}`;
}

// ── EVERY THEME IS HELD TO THE SAME FLOORS (req #3365) ─────────────────────
//
// The point of sweeping the REGISTRY rather than the default is that a theme is
// a way for a colour to reach the panel WITHOUT passing the assertions written
// for the constants above. `PLAN_PALETTES` is the loop's subject, so a fourth
// theme is covered the day it is added and cannot ship a swatch nobody measured.
describe('palette themes (req #3365)', () => {
    const PANEL = PLAN_VIZ_PALETTE.panel;

    it('offers the three themes, default first and unchanged', () => {
        // The ORDER is a narrative — the original, then calmer, then more
        // modern — and it is deliberately NOT where the default comes from.
        expect(PLAN_PALETTE_KEYS).toEqual(['stoplight', 'slate', 'aurora']);
        // AURORA, chosen by the user after seeing all three on the live plan
        // (req #3365). Named explicitly in the module, so reordering the
        // registry cannot repaint the plan as a side effect.
        expect(DEFAULT_PLAN_PALETTE).toBe('aurora');
        expect(planPalette(DEFAULT_PLAN_PALETTE).key).toBe('aurora');
        // `stoplight` is still the module's own constants BY IDENTITY — not a
        // copy that could drift from the values documented beside them — even
        // though it is no longer what the canvas draws.
        const signal = planPalette('stoplight');
        expect(signal.epic).toBe(EPIC_PALETTE);
        expect(signal.status).toBe(REQ_STATUS_COLORS);
        expect(signal.autonomy).toBe(AUTONOMY_COLORS);
    });

    it('AURORA tracks its OWN autonomy colours where the user directed — the LIVE theme (req #3503)', () => {
        // `stoplight`'s identical tracking (the test above) is INERT: no
        // caller anywhere ever supplies a `palette` other than the default,
        // so 'stoplight' never renders and its own tracking was invisible —
        // measured, the user reported the SAME mismatch this test pins a
        // second time before it was caught. This is the fix, on the theme
        // that actually renders. See CLAUDE.md's Reasoned Non-Delivery
        // exemplar list for the incident this test exists to close out.
        const aurora = planPalette('aurora');
        expect(aurora.status.authoring).toBe(aurora.autonomy.discuss);
        expect(aurora.status.approved).toBe(aurora.autonomy.planned);
        expect(aurora.status.met).toBe(aurora.autonomy.deployed);
        // `swarm_ready`/`deferred`/`wontfix` stay aurora's OWN literal
        // values — pinned here so this test also catches one of THEM moving,
        // not just whether the tracked three still agree with autonomy.
        expect(aurora.status.swarm_ready).toBe('#22d3ee');
        expect(aurora.status.deferred).toBe('#fcd34d');
        expect(aurora.status.wontfix).toBe('#94a3b8');
        // `development` is DELIBERATELY UNTRACKED here (see the source
        // comment on `auroraPalette` for why: tracking it to
        // `PLAN_VIZ_PALETTE.runningRing` collides with aurora's own
        // `deferred` under the ΔE 20 floor). Pinned so a future patch that
        // adds the tracking does so having read this test, not by accident.
        expect(aurora.status.development).toBe('#5eead4');
    });

    it('resolves an unknown, stale or hostile key to the default', () => {
        // It comes from localStorage. Same discipline as `normalizeColorKey`.
        for (const bogus of ['', 'nope', null, undefined, 0, 'constructor',
            'toString', 'STOPLIGHT']) {
            expect(planPalette(bogus), String(bogus)).toBe(PLAN_PALETTES[0]);
        }
        for (const k of PLAN_PALETTE_KEYS) expect(isPlanPalette(k)).toBe(true);
        expect(isPlanPalette('nope')).toBe(false);
    });

    it('describes every theme completely — no consumer knows one by name', () => {
        for (const p of PLAN_PALETTES) {
            for (const f of ['key', 'label', 'tip']) {
                expect(typeof p[f], `${p.key}.${f}`).toBe('string');
                expect(p[f].length, `${p.key}.${f}`).toBeGreaterThan(0);
            }
            expect(p.epic, `${p.key}.epic`).toHaveLength(4);
            // A theme picks HUES; it never re-opens a domain. Missing a member
            // would paint a real status with the unknown swatch and look like a
            // data problem.
            expect(Object.keys(p.status).sort()).toEqual([...REQ_STATUS_ORDER].sort());
            expect(Object.keys(p.autonomy).sort()).toEqual([...AUTONOMY_ORDER].sort());
        }
    });

    it('is legible on the panel in every theme — every swatch clears 4.5:1', () => {
        // MEASURED minimum 4.78:1 (Signal's `approved`, the tightest swatch on
        // the surface and unchanged by this requirement).
        for (const p of PLAN_PALETTES) {
            for (const [scale, hexes] of Object.entries({
                epic: p.epic,
                status: Object.values(p.status),
                autonomy: Object.values(p.autonomy),
            })) {
                for (const hex of hexes) {
                    expect(contrast(hex, PANEL), `${p.key}.${scale} ${hex}`)
                        .toBeGreaterThanOrEqual(4.5);
                }
            }
        }
    });

    it('is separable in every theme — no two entries of a scale read alike', () => {
        // The SAME floor of 20 the default scales are held to, and it is what
        // killed the first cut of `slate`: a single-hue lightness ramp measured
        // 8.9 across seven statuses, because ΔE 20 × 6 gaps does not fit in the
        // lightness a dark panel leaves above the contrast floor. MEASURED
        // minimum across all three themes: 20.4 (Slate autonomy).
        for (const p of PLAN_PALETTES) {
            for (const [scale, hexes] of Object.entries({
                epic: p.epic,
                status: Object.values(p.status),
                autonomy: Object.values(p.autonomy),
            })) {
                let worst = { pair: null, d: Infinity };
                for (let i = 0; i < hexes.length; i++) {
                    for (let j = i + 1; j < hexes.length; j++) {
                        const d = deltaE(hexes[i], hexes[j]);
                        if (d < worst.d) worst = { pair: `${hexes[i]}/${hexes[j]}`, d };
                    }
                }
                expect(worst.d, `${p.key}.${scale} closest pair ${worst.pair}`)
                    .toBeGreaterThanOrEqual(20);
            }
        }
    });

    it('makes Slate the RESTRAINED one, measured rather than asserted', () => {
        // The directive asked for "a more boring business version". Boring is
        // CHROMA here, not hue count — see the registry's own note on why a
        // single-hue ramp does not fit on a dark panel. Measured with THIS
        // file's own `hueSat` (HSL), the same metric the epic-palette guard
        // below uses, so the two cannot disagree about what saturation means:
        // Signal 0.851, Slate 0.350, Aurora 0.828. Signal moved from 0.836
        // (was 0.84 here) when req #3503 pushed `discuss`/`planned`/
        // `authoring`/`approved`/`met` toward more saturated stops — Slate
        // and Aurora are their own fixed swatches, not derived from
        // `AUTONOMY_COLORS`/`REQ_STATUS_COLORS`, so neither moved.
        const meanSat = (p) => {
            const all = [...p.epic, ...Object.values(p.status),
                ...Object.values(p.autonomy)];
            return all.reduce((a, h) => a + hueSat(h).s, 0) / all.length;
        };
        const slate = meanSat(planPalette('slate'));
        const signal = meanSat(planPalette('stoplight'));
        expect(slate, 'Slate must be calmer than the default').toBeLessThan(signal);
        expect(slate).toBeCloseTo(0.35, 2);
        expect(signal).toBeCloseTo(0.85, 2);
        // Aurora is NOT the restrained one and must not quietly become it —
        // "modern" here means light and vivid, which is a different axis.
        expect(meanSat(planPalette('aurora')))
            .toBeGreaterThan(meanSat(planPalette('slate')) * 2);
    });

    it('repaints the epic bands, and nothing else about the geometry', () => {
        // A theme is INK. If it moved a column or a band the plan would reflow
        // on a colour change, which is the one thing a palette must never do.
        const base = computePlanLayout(plan.rows, { palette: 'stoplight' });
        for (const key of PLAN_PALETTE_KEYS) {
            const themed = computePlanLayout(plan.rows, { palette: key });
            expect(themed.colW, key).toEqual(base.colW);
            expect(themed.width, key).toBe(base.width);
            expect(themed.height, key).toBe(base.height);
            expect(themed.bands.map((b) => b.y), key)
                .toEqual(base.bands.map((b) => b.y));
            // …and it DOES repaint, or the control would be inert.
            const pal = planPalette(key);
            expect(themed.bands.map((b) => b.color), key)
                .toEqual(base.bands.map((b, i) => pal.epic[i % pal.epic.length]));
        }
    });

    it('paints the requirement scales from the theme, not from the constants', () => {
        const requirements = [
            { id: 1, requirement_status: 'met', coordination_type: 'deployed' },
            { id: 2, requirement_status: 'development', coordination_type: 'discuss' },
        ];
        for (const key of PLAN_PALETTE_KEYS) {
            const pal = planPalette(key);
            const views = buildReqColorViews({
                requirements, machines: [], presentReqIds: new Set([1, 2]), palette: key,
            });
            expect(views.state.colorOf(1), key).toBe(pal.status.met);
            expect(views.autonomy.colorOf(2), key).toBe(pal.autonomy.discuss);
        }
        // No palette named at all resolves to the DEFAULT — which since req
        // #3365 is Aurora, not the module constants. Pinned because "the
        // default" and "the constants above" stopped being the same thing, and
        // a caller that omits the option must get what the canvas draws.
        const bare = buildReqColorViews({
            requirements, machines: [], presentReqIds: new Set([1, 2]),
        });
        expect(bare.state.colorOf(1)).toBe(planPalette(DEFAULT_PLAN_PALETTE).status.met);
    });
});

describe('epic band palette — no brown, no muddy tones (req #3219)', () => {
    it('has no browns and no muddy tones — every entry clears the two-dimensional guard, '
        + 'at whatever length the palette ends up', () => {
        const violations = EPIC_PALETTE
            .map((hex, i) => epicPaletteViolation(hex, `entry ${i}`))
            .filter(Boolean);
        expect(violations).toEqual([]);
    });

    it('is separable — no two entries read as the same colour', () => {
        // Same discipline and floor as the requirement-status scale above: 20
        // is low enough not to fail on a nudge, high enough that a palette
        // collapsing two entries into one hue cannot pass.
        let worst = { pair: null, d: Infinity };
        for (let i = 0; i < EPIC_PALETTE.length; i++) {
            for (let j = i + 1; j < EPIC_PALETTE.length; j++) {
                const d = deltaE(EPIC_PALETTE[i], EPIC_PALETTE[j]);
                if (d < worst.d) worst = { pair: `${i}/${j}`, d };
            }
        }
        expect(worst.d, `closest pair ${worst.pair}`).toBeGreaterThanOrEqual(20);
    });

    it('is FOUR entries that repeat, and the repeat is deliberate', () => {
        // This assertion used to be `length >= 7`, on the reasoning that the
        // palette must cover the live epic count so no two on-screen bands ever
        // share a hue. req #3365 REVERSED that trade on the user's directive:
        // seven mutually-distinguishable entries forced two of them into the
        // dark end of the wheel, where an epic's NAME — drawn in its band's
        // colour — was hard to read. Four bright entries that repeat beat seven
        // where two are unreadable.
        //
        // It is safe to repeat because colour on this surface is BAND POSITION,
        // never epic identity (the ONE FACT, ONE CHANNEL rule) — an epic gets
        // `EPIC_PALETTE[i % length]` for its position `i` in the sorted band
        // list, and nothing anywhere looks a colour up to find an epic.
        expect(EPIC_PALETTE).toHaveLength(4);
        // The cycle, asserted directly rather than inferred from the modulo:
        // band 4 wears band 0's colour and that is the intended behaviour.
        expect(EPIC_PALETTE[4 % EPIC_PALETTE.length]).toBe(EPIC_PALETTE[0]);
    });

    it('rejects the specific values this requirement removed, proving the guard has teeth',
        () => {
            // Brown fails on BOTH dimensions, decisively.
            expect(epicPaletteViolation('#5d4037', 'brown'))
                .toMatch(/contrast .* below .*, saturation .* below/);
            // The old indigo — "low separation from the panel" — fails BOTH
            // general floors too (contrast 2.23 < 2.7 AND saturation 0.50 <
            // 0.55); pinned exact so a change that quietly dropped the
            // saturation floor would still be caught here.
            expect(epicPaletteViolation('#3949ab', 'old indigo')).toBe(
                'old indigo #3949ab: hue 231.6°, contrast 2.23 below the general floor of 2.7, '
                + 'saturation 0.50 below the general floor of 0.55');
            // The old orange is the case that motivates the warm floor at all:
            // it clears the GENERAL floor (a one-dimensional guard would pass
            // it) and fails only the raised warm-hue contrast requirement.
            expect(epicPaletteViolation('#f57c00', 'old orange'))
                .toBe('old orange #f57c00: warm hue at 30.4°, contrast 6.39 below the warm floor of 6.5');
            expect(epicPaletteViolation('#f57c00', 'x')).not.toBeNull();
        });

    it('assigns band colour by POSITION AFTER THE SORT, not by discovery order or epic '
        + 'identity — the documented, deliberate choice (req #3219)', () => {
        const mk = (id, epicId, epic) => ({
            id, title: `s${id}`, run: 'auto', state: 'pending', reqIds: [],
            depIds: [], timeDeps: [], epicId, epic,
            epicLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
        });
        const n = EPIC_PALETTE.length + 2; // headroom over the palette length,
        // so the wrap below is exercised at whatever length EPIC_PALETTE is,
        // rather than the test pinning that length to a literal.
        //
        // Rows are discovered in DESCENDING epic id (n, n-1, …, 1). With no
        // `timeAxis` every band ties into the same tier (bandTierOf), so the
        // sort falls through to epic id ASCENDING — the OPPOSITE of discovery
        // order. That inversion is the point: colour is assigned via
        // `bandKeys.forEach((key, i) => ... EPIC_PALETTE[i % len])` AFTER
        // `bandKeys.sort(...)` runs (pipelinePlanLayout.js, "Colour AFTER the
        // sort"). If that assignment were moved back above the sort — coloured
        // at discovery time instead — epic id n (discovered first) would take
        // EPIC_PALETTE[0]. The real code path instead hands EPIC_PALETTE[0] to
        // epic id 1, which sorts first despite being discovered LAST. Asserting
        // `bands[].epicId` is ascending is what proves the sort actually ran;
        // asserting `bands[].color` against `EPIC_PALETTE[i % len]` on THAT
        // (sorted, not discovery) order is what proves colour follows it.
        const rows = Array.from({ length: n }, (_, i) => mk(i + 1, n - i, `E${n - i}`));
        const layout = computePlanLayout(rows);
        expect(layout.bands.map((b) => b.epicId))
            .toEqual(Array.from({ length: n }, (_, i) => i + 1));
        expect(layout.bands.map((b) => b.color)).toEqual(
            Array.from({ length: n }, (_, i) => EPIC_PALETTE[i % EPIC_PALETTE.length]));
        // The wrap is real, at whatever length the palette is: the band at
        // index EPIC_PALETTE.length reuses band 0's colour though they are
        // different epics.
        const wrapIdx = EPIC_PALETTE.length;
        expect(layout.bands[wrapIdx].color).toBe(layout.bands[0].color);
        expect(layout.bands[wrapIdx].epicId).not.toBe(layout.bands[0].epicId);
    });
});

// ── The cell invariant, over a fuzz corpus (req #3229) ──────────────────────
// "Never two beads on one `(band, column, lane)` cell" is this module's oldest
// invariant, it has an assertion in the plan-scale block above, and it was still
// violated in the field. Every fixture this suite owns — Substrate (34 real
// rows), the timed Substrate, the cross-epic plan — satisfies it, which is why
// a CORPUS rather than another fixture: 400 deterministic plans (see
// `timedFuzzPlans.js` for the generator's shape argument), each laid out WITH
// and WITHOUT a time axis. Deterministic means a failure names a seed and that
// seed is a permanent repro — `makeTimedPlan(<seed>)` is the whole reproducer.
//
// THE COVERAGE IS KEPT DELIBERATELY, AND IT IS WHY THIS BLOCK SURVIVED REQ
// #3371. The mechanism that used to violate the invariant was the launch-unit
// LANE RUN — mates of one launch sitting at different dependency depths, a
// graph nobody hand-writes — and req #3371 deleted the run along with the
// rectangle it existed to keep honest. Deleting this sweep with it would have
// traded a real defect class for a smaller test suite: the cell invariant is
// this surface's OLDEST promise, it is now carried by the ordinary lane
// allocation alone, and losing its coverage while deleting the run's coverage
// is exactly what req #3229 was filed to prevent.
//
// The BEFORE measurement, kept because it is what the corpus is sized for: the
// shipped 400 plans collide on seeds 89, 303 and 358 against the pre-fix
// module. The original 150-plan cut collided on seed 115 at `(0, 2, 3)` between
// steps 13 and 11 — WITH and WITHOUT the axis (columns 5 and 2), which is how
// the "the time axis causes it" reading was refuted.
describe('cell invariant over a timed fuzz corpus (req #3229)', () => {
    const corpus = timedFuzzCorpus();

    const cellCollisions = (layout) => {
        const seen = new Map();
        const out = [];
        for (const n of layout.nodes.values()) {
            const cell = `${n.bandIndex}|${n.depth}|${n.lane}`;
            if (seen.has(cell)) out.push(`${cell}: steps ${seen.get(cell)} and ${n.id}`);
            seen.set(cell, n.id);
        }
        return out;
    };

    it('the corpus is non-vacuous, and carries the shapes the allocator branches on', () => {
        // The precondition guard req #3207 added, for exactly the reason it
        // added it: 16 plan-scale tests once asserted over an empty array in
        // total silence, and shipped that way. A fuzz corpus is MORE exposed to
        // that, not less — a generator that quietly stopped producing the shape
        // under test would leave the sweeps below green and vacuous.
        //
        // WHAT THE SHAPE ASSERTIONS ARE NOW (req #3371). They used to count
        // MULTI-COLUMN LAUNCH GROUPS, because the lane run those produced was
        // the mechanism that broke the cell invariant. That run is deleted, so
        // the shape that still exercises the allocator is a band DEEP ENOUGH to
        // make lanes contend: `sub >= 2` means at least two lanes were assigned,
        // and `sub >= 3` is where the dep-adjacent INSERTION path (fractional
        // lanes, renumbered ordinally at band close) does its work. MEASURED on
        // the shipped corpus: 6332 rows, 804 bands, 566 multi-lane, 331 deep,
        // 290 of 400 plans carrying a deep band, deepest 11 lanes, 4111 dated
        // steps. Thresholds sit just under those, so a generator that collapsed
        // fails rather than passes quietly.
        let rows = 0;
        let bands = 0;
        let multiLaneBands = 0;
        let deepBands = 0;
        let plansWithDeepBand = 0;
        let dated = 0;
        for (const { reads } of corpus) {
            const plan = orderedPlan(buildPipelineModel(reads), { now: FUZZ_NOW });
            const layout = computePlanLayout(plan.rows,
                { timeAxis: plan.timeAxis });
            rows += plan.rows.length;
            bands += layout.bands.length;
            let deep = false;
            for (const band of layout.bands) {
                if (band.sub >= 2) multiLaneBands += 1;
                if (band.sub >= 3) { deepBands += 1; deep = true; }
            }
            if (deep) plansWithDeepBand += 1;
            dated += [...plan.timeAxis.stepStarts.values()]
                .filter((s) => s && s.kind === 'dated').length;
        }
        expect(corpus).toHaveLength(400);
        expect(rows).toBeGreaterThan(5000);
        expect(bands).toBeGreaterThan(700);
        expect(multiLaneBands).toBeGreaterThan(400);
        expect(deepBands).toBeGreaterThan(250);
        expect(plansWithDeepBand).toBeGreaterThan(200);
        expect(dated).toBeGreaterThan(2000);
    });

    it('never stacks two beads on one (band, column, lane) cell — with a time axis', () => {
        const failures = [];
        for (const { seed, reads } of corpus) {
            const plan = orderedPlan(buildPipelineModel(reads), { now: FUZZ_NOW });
            const layout = computePlanLayout(plan.rows,
                { timeAxis: plan.timeAxis });
            expect(layout.nodes.size).toBe(plan.rows.length);
            for (const c of cellCollisions(layout)) failures.push(`seed ${seed} — ${c}`);
        }
        expect(failures).toEqual([]);
    });

    it('never stacks two beads on one (band, column, lane) cell — without one', () => {
        const failures = [];
        for (const { seed, reads } of corpus) {
            const plan = orderedPlan(buildPipelineModel(reads), { now: FUZZ_NOW });
            const layout = computePlanLayout(plan.rows);
            expect(layout.nodes.size).toBe(plan.rows.length);
            for (const c of cellCollisions(layout)) failures.push(`seed ${seed} — ${c}`);
        }
        expect(failures).toEqual([]);
    });

    // ── THE RATCHET ON LANES AND SPAGHETTI (req #3512) ──────────────────────
    // Lane assignment and arc cleanliness trade against each other: any rule
    // that hands a step a lane it would otherwise have been refused risks
    // putting its bead on somebody's horizontal run, and any rule that refuses
    // more lanes buys cleanliness with vertical sprawl. The epic #6 case above
    // pins the arc side on ONE eight-step shape; nothing swept either side
    // across the corpus, so req #3512 could relax a lane rule with no
    // mechanical evidence about what it cost.
    //
    // EVERY NUMBER IS A CEILING AT THE MEASURED VALUE, not an aspiration. The
    // crossing count is NOT zero today and this test does not pretend it is —
    // an arc whose source-lane corridor is blocked falls back to an early bend
    // onto the destination lane, whose corridor nothing checks. That hole is
    // pre-existing and out of req #3512's scope; what matters is that it cannot
    // grow silently.
    //
    // A SUM IS NOT ENOUGH, and this is the review finding that put the second
    // pair of assertions here. Totals hide `+3 on one plan, −9 on another`, and
    // that is exactly the shape this change has: on a 24,000-plan adversarial
    // sweep the aggregate fell 5,938 → 5,659 while 600 plans GAINED a crossing
    // and 746 lost one. On the shipped corpus below no plan gained one — but
    // only a per-plan bound can keep saying so. So the distribution is pinned
    // as well as the mass.
    //
    // MEASURED over the shipped 400 plans, before → after req #3512:
    //   total lanes        1897 → 1877 (with axis)   2122 → 2122 (without)
    //   arc crossings        17 →   11 (with axis)      3 →    3 (without)
    //   worst single plan     3 →    3 (with axis)      1 →    1 (without)
    // The worst plan is FLAT while the total fell — which is the distribution
    // saying what the aggregate cannot: the eleven remaining crossings did not
    // pile onto one plan, and the six that went away came off several. A change
    // that improves any figure should LOWER these constants in the same commit;
    // a change that raises one has to say why in review.
    it('packs no more lanes, and draws no more spaghetti, than the measured ceiling', () => {
        const tally = {
            bands: 0, lanesAxis: 0, lanesPlain: 0,
            crossAxis: 0, crossPlain: 0, worstAxis: 0, worstPlain: 0,
            arcs: 0, onRun: 0,
        };
        for (const { reads } of corpus) {
            const plan = orderedPlan(buildPipelineModel(reads), { now: FUZZ_NOW });
            const withAxis = computePlanLayout(plan.rows, { timeAxis: plan.timeAxis });
            const plain = computePlanLayout(plan.rows);
            for (const band of withAxis.bands) {
                tally.lanesAxis += band.sub;
                tally.bands += 1;
            }
            for (const band of plain.bands) tally.lanesPlain += band.sub;
            const a = arcCrossings(withAxis, plan.rows);
            const p = arcCrossings(plain, plan.rows);
            tally.crossAxis += a.crossings;
            tally.crossPlain += p.crossings;
            tally.worstAxis = Math.max(tally.worstAxis, a.crossings);
            tally.worstPlain = Math.max(tally.worstPlain, p.crossings);
            tally.arcs += a.arcs + p.arcs;
            tally.onRun += a.onRun + p.onRun;
        }
        // NON-VACUITY, and deliberately NOT "crossings > 0". Driving crossings
        // to zero is a legitimate goal this comment invites, and a wiring guard
        // that fails on success would point at the wrong cause on the day
        // somebody achieves it. `arcs` proves the sweep reached the arc list;
        // `onRun` proves the geometry predicate matched real beads — it counts
        // the LEGITIMATE in-chain runs too, so it stays positive at zero
        // crossings.
        expect(tally.bands, 'bands swept').toBe(804);
        expect(tally.lanesAxis, 'lanes swept with an axis').toBeGreaterThan(1000);
        expect(tally.arcs, 'arcs swept — is the corpus still producing edges?')
            .toBeGreaterThan(5000);
        expect(tally.onRun,
            'no bead sat on any arc run — is the geometry predicate still wired up?')
            .toBeGreaterThan(100);

        expect(tally.lanesAxis, 'total lanes, with a time axis').toBeLessThanOrEqual(1877);
        expect(tally.lanesPlain, 'total lanes, no time axis').toBeLessThanOrEqual(2122);
        expect(tally.crossAxis, 'arc runs over an unrelated bead, with a time axis')
            .toBeLessThanOrEqual(11);
        expect(tally.crossPlain, 'arc runs over an unrelated bead, no time axis')
            .toBeLessThanOrEqual(3);
        expect(tally.worstAxis, 'worst single plan, with a time axis')
            .toBeLessThanOrEqual(3);
        expect(tally.worstPlain, 'worst single plan, no time axis')
            .toBeLessThanOrEqual(1);
    }, 60000);

    // The user-visible consequence of a shared cell, asserted independently of
    // the cell arithmetic: two coincident beads and two labels drawn on top of
    // each other. Run over all four view combinations, because label geometry —
    // unlike lane assignment — depends on both of them.
    describe.each(COMBOS)('$reqLayout reqs × $stepLabel labels', (opts) => {
        it('gives every bead its own position, and draws no label over another', () => {
            for (const { seed, reads } of corpus) {
                const plan = orderedPlan(buildPipelineModel(reads), { now: FUZZ_NOW });
                const layout = computePlanLayout(plan.rows,
                    { ...opts, timeAxis: plan.timeAxis });
                const seen = new Map();
                for (const n of layout.nodes.values()) {
                    const pos = `${n.x}|${n.y}`;
                    expect(seen.has(pos),
                        `seed ${seed}: steps ${seen.get(pos)} and ${n.id} coincide at ${pos}`)
                        .toBe(false);
                    seen.set(pos, n.id);
                }
                assertNoLabelOverlap(layout, `seed ${seed}`);
            }
        });
    });

    // req #3362 review finding M2: `COMBOS` never sets `reqLabel`, so it
    // defaults to 'id' and the swim-lane offset sweep (`staggerReqs`, gated on
    // `reqLabel === 'title'`) never runs anywhere in this corpus — the fuzz
    // sweep above is blind to the whole mechanism this requirement added.
    // Setting `reqLabel: 'title'` alone is ALSO not enough: with no
    // `reqTitles`, `reqLabelText` falls back to the bare id (4 characters),
    // which is narrow enough that adjacent marks never overlap horizontally
    // even when they land on the same line — so this needs BOTH title mode
    // AND long synthetic titles (the same `LONG_TITLE` fixture the Substrate
    // suite above uses) to actually exercise the geometry that changed. This
    // is what caught the un-chained tie-branch bug (a 1,1,2,2 same-lane count
    // sequence overlapping) that the id-mode sweep could not see.
    it('title mode with long titles: zero label overlap, over the whole corpus', () => {
        for (const { seed, reads } of corpus) {
            const plan = orderedPlan(buildPipelineModel(reads), { now: FUZZ_NOW });
            const reqTitles = new Map();
            for (const r of plan.rows) {
                for (const id of r.reqIds || []) reqTitles.set(id, LONG_TITLE);
            }
            const layout = computePlanLayout(plan.rows,
                { reqLayout: 'vertical', reqLabel: 'title', stepLabel: 'id',
                    timeAxis: plan.timeAxis, reqTitles });
            assertNoLabelOverlap(layout, `seed ${seed}`);
        }
    });
});

// ── req #3365 — THE EPIC LANE IS A DERIVED RESERVATION ──────────────────────
// `BAND_HEADER` is a literal inside the module (its own comment gives the
// temporal-dead-zone reason it cannot be the expression), so the derivation
// lives HERE. This fails if anyone edits the chip's font, its floor scale or
// its margin without re-deriving the lane that has to hold it — the exact
// silent desync the previous hand-set 83 allowed, and which put the epic name
// on top of lane 0's step labels at every scale plan 7 actually opens in.
describe('epic lane reservation (req #3365)', () => {
    const CHIP_MARGIN_Y = 2;   // module-private; the only literal this needs

    // The boundary itself is pinned by 'pins the exact k where the floored chip
    // starts escaping its own epic lane' above, which was already written to
    // move with the lane — this suite adds the SYMPTOM the user reported,
    // which that test does not speak to: the scale the live plan opens in.
    it('holds at the scale plan 7 lands in, which the old 62px lane did not', () => {
        const plan = orderedPlan(buildPipelineModel(SUBSTRATE_REBUILD_MODEL));
        const layout = computePlanLayout(plan.rows);
        const chipBox = EPIC_CHIP_MIN_H + 2 * CHIP_MARGIN_Y;
        // Measured landing scale on the live 71-step plan.
        const LANDING_K = 0.2077;
        for (const band of layout.bands) {
            expect(chipBox).toBeLessThanOrEqual(band.epicLaneH * LANDING_K);
        }
        // And the old reservation genuinely failed there — so this pair of
        // assertions is not vacuous.
        const OLD_EPIC_LANE_H = 62;
        expect(chipBox).toBeGreaterThan(OLD_EPIC_LANE_H * LANDING_K);
    });
});
