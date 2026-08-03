// pipelinePlanLayout.test.js — the Plan visualizer's pure geometry (req #3115)
// against the engine's static Substrate Rebuild fixture (req #3112).
//
// The acceptance criterion is ZERO LABEL OVERLAP in both requirement-list
// layouts and both step-label modes — four combinations, each asserted by rect
// intersection over the label boxes the layout itself exports, not by eyeball.
// Lane assignment, cross-column reservation, column-width containment and
// launch-batch box geometry are the supporting invariants.

import { describe, it, expect } from 'vitest';

import { SUBSTRATE_REBUILD_MODEL, MACHINES } from './substrateRebuildFixture';
import { timedFuzzCorpus, FUZZ_NOW } from './timedFuzzPlans';
import { buildPipelineModel, orderedPlan } from '../pipelineViewModel';
import { semanticLevel, SEMANTIC_OUT_MAX } from '../../konvaSwarmModel';
import {
    computePlanLayout, beadStyle, stepLabelText, BEAD_RADIUS, BEAD_HIT_RADIUS,
    PLAN_VIZ_PALETTE, placeEpicChips, EPIC_CHIP_OPEN_LINK_W,
    STEP_WIDTH_FACTORS, isStepWidth, K_READABLE, PLAN_VIZ_FONT, READABLE_MIN_PX,
    NEXT_HALO_RADIUS, NEXT_HALO_STROKE, NEXT_HALO_DASH, EPIC_CHIP_CHAR_W,
    NEXT_HALO_SCREEN_RADIUS, NEXT_HALO_MAX_OUTER, NEXT_HALO_MAX_MAGNIFY,
    NEXT_HALO_CLEARANCES, nextHaloMagnify, labelsLegible, drawsLabelKind,
    NEXT_MARK_MIN_STROKE_PX, NEXT_MARK_FLOOR_K, NEXT_MARK_SCREEN_RADIUS,
    nextMarkIsDot, nextMarkDotRadius,
    readableDefaultScale, BEAD_RING_W_EMPHASIS, BEAD_OUTER_RADIUS,
    EPIC_CHIP_FONT, EPIC_CHIP_H, EPIC_CHIP_MIN_H, EPIC_CHIP_MIN_CHARS,
    EPIC_CHIP_PAD_W, EPIC_CHIP_MIN_FONT,
    REQ_STATUS_COLORS, REQ_STATUS_ORDER, REQ_STATUS_UNKNOWN_COLOR, reqStatusColor,
    MACHINE_MAC_COLOR, MACHINE_WINDOWS_COLOR, MACHINE_ANY_COLOR,
    MACHINE_FALLBACK_PALETTE, machineEcosystem, buildMachineColorView,
    COLOR_KEY_LABELS, DEFAULT_COLOR_KEY, isColorKey, normalizeColorKey,
    reqIdStyle, reqIdKeyEntries, PLAN_KEY_MAX_W,
    LABEL_MAX_CHARS, reqLabelText, REQ_VIEWS, DEFAULT_REQ_VIEW, isReqView,
    normalizeReqView, reqViewOptions, PLAN_LEVEL_BY_PREF, PLAN_LEVEL_NUMBER,
    DEFAULT_PLAN_LEVEL_PREF, isPlanLevelPref, normalizePlanLevelPref, pinnedLevelOf,
    REQ_LINE_H,
    FOCUS_MAX_RATIO, FOCUS_MIN_RATIO, FOCUS_PAD, STEP_DONE, ZOOM_MAX_RATIO, ZOOM_MIN_RATIO, bandFitRect, epicFocusTransform,
    FOCUS_LABEL_H, epicFocusNeighbours,
    stepFitRect, stepFocusTransform,
    RULER_H, computeRuler, slotTickText, factoryDefaultScale,
    stickyRulerY, rulerScreenBottom,
    EPIC_PALETTE,
    PAUSE_ACTIVE_COLOR, PAUSE_PAUSED_COLOR, pauseBubbleColor, EPIC_PAUSE_BUBBLE_W,
} from '../pipelinePlanLayout';

const NOW = '2026-07-27T03:00:00Z';
const plan = orderedPlan(SUBSTRATE_REBUILD_MODEL, { now: NOW });

const COMBOS = [
    { reqLayout: 'horizontal', stepLabel: 'id' },
    { reqLayout: 'horizontal', stepLabel: 'title' },
    { reqLayout: 'vertical', stepLabel: 'id' },
    { reqLayout: 'vertical', stepLabel: 'title' },
];

const rectsOverlap = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const beadRect = (n) => ({
    x: n.x - BEAD_RADIUS, y: n.y - BEAD_RADIUS,
    w: 2 * BEAD_RADIUS, h: 2 * BEAD_RADIUS,
});

// The reservation invariant, checked from layout OUTPUT: a straight (same-lane)
// arc may cross only beads that are part of its own chain — a transitive
// dependent of the tail AND dependency of the head (e.g. 13 on the 12→14 arc,
// where 14 gates on both). Anything else on the wire is the failure the
// cross-column reservation exists to prevent.
function assertStraightArcsClear(layout, rows) {
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const reachMemo = new Map();
    const reach = (id) => {
        if (reachMemo.has(id)) return reachMemo.get(id);
        const out = new Set();
        reachMemo.set(id, out); // cycle guard
        for (const d of (rowById.get(id)?.depIds || [])) {
            out.add(d);
            for (const dd of reach(d)) out.add(dd);
        }
        return out;
    };
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
    const layout = computePlanLayout(plan.rows, plan.batches);

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
    const layout = computePlanLayout(plan.rows, plan.batches);

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
        const l = computePlanLayout(rows, []);
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
    const layout = computePlanLayout(rows, []);
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

describe('zero label overlap — all four layout/label combinations', () => {
    for (const opts of COMBOS) {
        const name = `${opts.reqLayout} reqs × ${opts.stepLabel} labels`;
        it(`no two labels intersect (${name})`, () => {
            const layout = computePlanLayout(plan.rows, plan.batches, opts);
            assertNoLabelOverlap(layout, name);
        });

        it(`no label intersects any bead (${name})`, () => {
            const layout = computePlanLayout(plan.rows, plan.batches, opts);
            const beads = [...layout.nodes.values()].map(beadRect);
            for (const label of layout.labels) {
                for (const bead of beads) {
                    expect(rectsOverlap(label, bead)).toBe(false);
                }
            }
        });

        // Column containment is now KIND-DEPENDENT (req #3119). Requirement ids
        // still live strictly inside their column. The two STAGGERED kinds —
        // the title slot, and the step label in title mode — are placed one line
        // off on odd columns precisely so they may reach into their neighbours,
        // which is what buys a readable title without a 5800px-wide world. Their
        // guarantee is not "inside the slab" but "reaches no further than a
        // bounded fraction of one neighbour", which combined with the parity
        // offset is what makes the no-two-labels-intersect test above pass.
        it(`req labels stay inside their column slab (${name})`, () => {
            const layout = computePlanLayout(plan.rows, plan.batches, opts);
            for (const label of layout.labels) {
                if (label.stepId == null || label.kind !== 'req') continue;
                const n = layout.nodes.get(label.stepId);
                const left = layout.colX[n.depth] - layout.colW[n.depth] / 2;
                const right = layout.colX[n.depth] + layout.colW[n.depth] / 2;
                expect(label.x).toBeGreaterThanOrEqual(left - 0.01);
                expect(label.x + label.w).toBeLessThanOrEqual(right + 0.01);
            }
        });

        // Assert the PAIRWISE property the module actually promises, not the
        // per-label budget it is derived from. The first version of this test
        // asserted "each label fits its budget and is centred on its column",
        // which is exactly the placement rule — so it agreed with a budget that
        // admitted a 40px overlap and could never have contradicted it (found in
        // review). A per-label invariant that implies nothing about pairs is not
        // coverage for a pairwise guarantee.
        it(`no two same-line staggered labels overlap, at any column width (${name})`, () => {
            const check = (rows, batches, label) => {
                const layout = computePlanLayout(rows, batches, opts);
                const staggered = layout.labels.filter((l) => l.stepId != null
                    && (l.kind === 'title'
                        || (l.kind === 'step' && opts.stepLabel === 'title')));
                for (let i = 0; i < staggered.length; i++) {
                    for (let j = i + 1; j < staggered.length; j++) {
                        const a = staggered[i];
                        const b = staggered[j];
                        // Same line ⇒ same y. Different lines cannot collide.
                        if (Math.abs(a.y - b.y) > 0.01) continue;
                        const overlap = a.x < b.x + b.w && b.x < a.x + a.w;
                        if (overlap) {
                            throw new Error(`${label}: staggered labels overlap on one line — `
                                + `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
                        }
                    }
                }
            };
            check(plan.rows, plan.batches, `fixture (${name})`);
            // The fixture's columns happen to be near-uniform. The failure mode
            // needs WIDE outer columns around a NARROW shared one, so construct
            // it: one chain (⇒ one lane, ⇒ same line for d and d+2) whose ends
            // carry many requirement ids and whose middle carries one.
            const wide = [5001, 5002, 5003, 5004, 5005].map((id, i) => ({
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
            check(wide, [], `wide-outer-columns (${name})`);
        });

        // ── The two invariants req #3213's hover regions RIDE ON ────────────
        // The renderer now draws a transparent hit Rect at each step/title/
        // batch label's own rect, pushed ABOVE both the bead hit circles and
        // the dashed batch boxes. Neither of the clearances that makes that
        // safe was asserted anywhere (review finding): the sweep above checks
        // labels against the BEAD at radius 10, but ownership is decided at the
        // HIT circle's 15. Both were measured clean when they shipped; what
        // these two tests buy is that they stay that way.
        it(`no label rect reaches into another step's bead hit circle (${name})`, () => {
            const layout = computePlanLayout(plan.rows, plan.batches, opts);
            // Rect × CIRCLE, not rect × bbox: the corner of a bounding box is
            // 4.4px outside the circle it encloses, which is the whole margin
            // being asserted.
            const hits = (label, n) => {
                const cx = Math.max(label.x, Math.min(n.x, label.x + label.w));
                const cy = Math.max(label.y, Math.min(n.y, label.y + label.h));
                return Math.hypot(n.x - cx, n.y - cy) < BEAD_HIT_RADIUS;
            };
            for (const label of layout.labels) {
                // Only the kinds that carry a hit region. A 'req' label is a
                // listening Text and has always been drawn over its own column.
                if (!['step', 'title', 'batch'].includes(label.kind)) continue;
                for (const [stepId, n] of layout.nodes) {
                    // Its OWN bead may share a pixel of the ring — same step,
                    // same card, so the reading cannot be wrong.
                    if (label.stepId === stepId) continue;
                    if (hits(label, n)) {
                        throw new Error(`${name}: ${label.kind} label `
                            + `${JSON.stringify(label)} intrudes on step ${stepId}'s `
                            + `hit circle at (${n.x}, ${n.y})`);
                    }
                }
            }
        });

    }

    it('emits one req label per linked requirement, none prefixed with #', () => {
        const layout = computePlanLayout(plan.rows, plan.batches);
        for (const r of plan.rows) {
            const reqLabels = layout.labels
                .filter((l) => l.kind === 'req' && l.stepId === r.id);
            expect(reqLabels.map((l) => l.reqId)).toEqual(r.reqIds);
        }
        // The no-'#' directive governs GENERATED labels (step ids, req ids,
        // batch text) — step TITLES are stored plan content and render verbatim.
        for (const l of layout.labels) {
            if (l.kind === 'title' || l.kind === 'epic') continue;
            expect(l.text.includes('#')).toBe(false);
        }
    });

    it('reserves the title slot only when the step label is not already the title', () => {
        const withIds = computePlanLayout(plan.rows, plan.batches, { stepLabel: 'id' });
        const withTitles = computePlanLayout(plan.rows, plan.batches, { stepLabel: 'title' });
        expect(withIds.labels.some((l) => l.kind === 'title')).toBe(true);
        expect(withTitles.labels.some((l) => l.kind === 'title')).toBe(false);
    });
});

describe('launch-batch box geometry', () => {
    it('draws ZERO boxes for the Substrate Rebuild plan (its nearest pair differs in run mode)', () => {
        expect(plan.batches).toEqual([]);
        const layout = computePlanLayout(plan.rows, plan.batches);
        expect(layout.batchBoxes).toEqual([]);
    });

    // A genuine batch — and since req #3188 its two members share an epic,
    // because the engine's launch key includes the dominant epic and can no
    // longer group across two. The same-gate MANUAL step is the non-member, and
    // it sits in a second band so the plan still renders more than one.
    // Epic titles are deliberately LONG: the review found the batch letter
    // colliding with a long epic label when both lived in the band header, and
    // that collision is what the label-overlap combinations below still guard.
    const CROSS_EPIC_READS = {
        steps: [
            { id: 1, pipeline_fk: 1, title: 'gate', run: 'auto', notes: null,
                completed_at: '2026-07-01T00:00:00' },
            { id: 2, pipeline_fk: 1, title: 'batch mate A', run: 'auto', notes: null,
                completed_at: null },
            { id: 3, pipeline_fk: 1, title: 'batch mate B', run: 'auto', notes: null,
                completed_at: null },
            { id: 4, pipeline_fk: 1, title: 'same gate, manual', run: 'manual', notes: null,
                completed_at: null },
        ],
        stepRequirements: [
            { step_fk: 2, requirement_fk: 900 },
            { step_fk: 3, requirement_fk: 901 },
            { step_fk: 4, requirement_fk: 902 },
        ],
        stepDeps: [
            { id: 1, step_fk: 2, dep_step_fk: 1, time_at: null },
            { id: 2, step_fk: 3, dep_step_fk: 1, time_at: null },
            { id: 3, step_fk: 4, dep_step_fk: 1, time_at: null },
        ],
        requirements: [
            { id: 900, requirement_status: 'approved', machine_fk: 2, feature_fk: 101 },
            { id: 901, requirement_status: 'approved', machine_fk: 2, feature_fk: 101 },
            { id: 902, requirement_status: 'approved', machine_fk: 2, feature_fk: 102 },
        ],
        features: [
            { id: 101, title: 'Wave One', epic_fk: 11 },
            { id: 102, title: 'Wave Two', epic_fk: 12 },
        ],
        epics: [
            { id: 11, title: 'Swarm Orchestration Substrate Rebuild Epic One' },
            { id: 12, title: 'Primary and Swarm Agentic Integration Epic Two' },
        ],
        machines: MACHINES,
    };
    const crossPlan = orderedPlan(
        buildPipelineModel({
            pipeline: { id: 1, title: 'x', pipeline_status: 'active', machine_fk: 2 },
            ...CROSS_EPIC_READS,
        }),
        { now: NOW });

    it('boxes every member and excludes non-members', () => {
        expect(crossPlan.batches).toHaveLength(1);
        const layout = computePlanLayout(crossPlan.rows, crossPlan.batches);
        const inSomeBox = (n) => layout.batchBoxes.some((box) =>
            n.x > box.x && n.x < box.x + box.width
            && n.y > box.y && n.y < box.y + box.height);

        const m2 = layout.nodes.get(2);
        const m3 = layout.nodes.get(3);
        const outsider = layout.nodes.get(4);
        // Since req #3188 an ENGINE-PRODUCED batch always sits in one band —
        // bands key on `epicId` and so does the launch key — so one segment,
        // one letter. The non-member is in another band entirely and must stay
        // outside the box regardless.
        expect(m2.bandIndex).toBe(m3.bandIndex);
        expect(outsider.bandIndex).not.toBe(m2.bandIndex);
        expect(layout.batchBoxes).toHaveLength(1);
        // EVERY segment carries the letter (req #3188). One label for a
        // batch that draws two side-by-side boxes leaves the second reading
        // as an anonymous batch of its own.
        expect(layout.labels.filter((l) => l.kind === 'batch'))
            .toHaveLength(layout.batchBoxes.length);
        expect(inSomeBox(m2)).toBe(true);
        expect(inSomeBox(m3)).toBe(true);
        expect(inSomeBox(outsider)).toBe(false);
        expect(layout.labels.filter((l) => l.kind === 'batch')).toHaveLength(1);
    });

    // ── D2's acceptance, in geometry (req #3213) ────────────────────────────
    // "Verify the batch card is still reachable by hovering the box itself."
    // The step / title / batch label hit regions are drawn ABOVE the dashed
    // rectangle, so the rectangle only stays reachable while they leave some of
    // its face uncovered — and nothing asserted that. Grid-sampled rather than
    // computed as a rectangle union: the union routine would be more code than
    // the property it checks. Run over the batched plan, because the Substrate
    // fixture deliberately produces ZERO boxes (see the first test above) and
    // this test would be silently vacuous on it.
    it('keeps a hoverable interior in every batch box, in all four combinations', () => {
        for (const opts of COMBOS) {
            const layout = computePlanLayout(crossPlan.rows, crossPlan.batches, opts);
            expect(layout.batchBoxes.length).toBeGreaterThan(0);
            const covers = layout.labels.filter(
                (l) => l.kind === 'step' || l.kind === 'title' || l.kind === 'batch');
            for (const box of layout.batchBoxes) {
                let free = 0;
                let total = 0;
                for (let i = 0; i < 40; i++) {
                    for (let j = 0; j < 40; j++) {
                        const px = box.x + (box.width * (i + 0.5)) / 40;
                        const py = box.y + (box.height * (j + 0.5)) / 40;
                        total++;
                        if (!covers.some((l) => px >= l.x && px <= l.x + l.w
                            && py >= l.y && py <= l.y + l.h)) free++;
                    }
                }
                // A deliberately loose floor — measured 81-89% free on the live
                // plan. It fails on a REGRESSION, not on a nudge.
                expect(free / total,
                    `batch ${box.letter} interior covered (${opts.reqLayout} × ${opts.stepLabel})`)
                    .toBeGreaterThan(0.5);
            }
        }
    });

    it('segments a MULTI-COLUMN batch per column rather than drawing one wide rect', () => {
        // REQ #3188 REGRESSION. Batch-mates used to share a raw dep set and
        // therefore a depth, so one column per batch was sound; keying on the
        // REMAINING gate makes "gated by a Complete step" and "not gated at all"
        // one launch unit at DIFFERENT depths. A single-column box then left a
        // member outside itself and enclosed whatever unrelated bead sat in the
        // column it did cover.
        const reads = {
            steps: [
                { id: 1, pipeline_fk: 1, title: 'closed gate', run: 'auto', notes: null,
                    completed_at: null },
                { id: 2, pipeline_fk: 1, title: 'behind the closed gate', run: 'auto',
                    notes: null, completed_at: null },
                { id: 3, pipeline_fk: 1, title: 'no gate at all', run: 'auto',
                    notes: null, completed_at: null },
            ],
            stepRequirements: [
                { step_fk: 1, requirement_fk: 950 },
                { step_fk: 2, requirement_fk: 951 },
                { step_fk: 3, requirement_fk: 952 },
            ],
            stepDeps: [{ id: 1, step_fk: 2, dep_step_fk: 1, time_at: null }],
            requirements: [
                { id: 950, requirement_status: 'met', machine_fk: 2, feature_fk: 301 },
                { id: 951, requirement_status: 'approved', machine_fk: 2, feature_fk: 301 },
                { id: 952, requirement_status: 'approved', machine_fk: 2, feature_fk: 301 },
            ],
            features: [{ id: 301, title: 'F1', epic_fk: 31 }],
            epics: [{ id: 31, title: 'Epic A' }],
            machines: MACHINES,
        };
        const p = orderedPlan(buildPipelineModel({
            pipeline: { id: 1, title: 'x', pipeline_status: 'active', machine_fk: 2 },
            ...reads,
        }), { now: NOW });
        expect(p.batches).toHaveLength(1);
        expect(p.batches[0].stepIds.slice().sort()).toEqual([2, 3]);

        const layout = computePlanLayout(p.rows, p.batches);
        const m2 = layout.nodes.get(2);
        const m3 = layout.nodes.get(3);
        const outsider = layout.nodes.get(1);
        expect(m2.depth).not.toBe(m3.depth);
        expect(layout.batchBoxes).toHaveLength(2);
        // EVERY segment carries the letter (req #3188). One label for a
        // batch that draws two side-by-side boxes leaves the second reading
        // as an anonymous batch of its own.
        expect(layout.labels.filter((l) => l.kind === 'batch'))
            .toHaveLength(layout.batchBoxes.length);

        const encloses = (box, n) => n.x > box.x && n.x < box.x + box.width
            && n.y > box.y && n.y < box.y + box.height;
        // Every member is inside SOME segment…
        for (const member of [m2, m3]) {
            expect(layout.batchBoxes.some((box) => encloses(box, member)),
                `member ${member.id} must be boxed`).toBe(true);
        }
        // …and the Complete step sharing step 3's column is inside NONE.
        for (const box of layout.batchBoxes) {
            expect(encloses(box, outsider), 'the gate must stay outside').toBe(false);
        }
    });

    it('segments a cross-band batch per band rather than drawing one tall rect', () => {
        // THE GEOMETRY IS TESTED DIRECTLY, with a HAND-BUILT batch, because the
        // engine can no longer produce this input: req #3188 put the dominant
        // epic in the launch key, and bands key on the same field. That makes
        // this branch defensive rather than reachable — computePlanLayout takes
        // rows and batches as arguments and cannot know they were derived
        // together, so a stale or hand-assembled batch must still not enclose a
        // band it has no member in (the original review finding). Deleting the
        // segmentation instead would trade a tested defence for an untested
        // assumption about every caller, forever.
        const batch = { letter: 'A', stepIds: [2, 4], swarmStartArgs: [900, 902] };
        const layout = computePlanLayout(crossPlan.rows, [batch]);
        const m2 = layout.nodes.get(2);
        const m4 = layout.nodes.get(4);
        expect(m2.bandIndex).not.toBe(m4.bandIndex);
        expect(layout.batchBoxes).toHaveLength(2);
        // EVERY segment carries the letter (req #3188). One label for a
        // batch that draws two side-by-side boxes leaves the second reading
        // as an anonymous batch of its own.
        expect(layout.labels.filter((l) => l.kind === 'batch'))
            .toHaveLength(layout.batchBoxes.length);
        expect(layout.batchBoxes.map((b) => b.stepIds)).toEqual([[2], [4]]);
        // The non-member sharing band 2's neighbourhood is never swallowed.
        const outsider = layout.nodes.get(3);
        for (const box of layout.batchBoxes) {
            const inside = outsider.x > box.x && outsider.x < box.x + box.width
                && outsider.y > box.y && outsider.y < box.y + box.height;
            expect(inside).toBe(false);
        }
    });

    it('never encloses a bead from an unrelated band between two members', () => {
        // Review dataset: members in the first and third bands, a NON-member in
        // the band between them, all sharing the gate. The POC's single tall
        // rect read step 3 as launching in batch A; segments must not.
        //
        // The batch is HAND-BUILT for the same reason as the segmentation test
        // above: since req #3188 the engine's launch key carries the dominant
        // epic, so it can no longer emit a batch whose members sit in different
        // bands. The geometry still has to survive one.
        const reads = {
            steps: [
                { id: 1, pipeline_fk: 1, title: 'gate', run: 'auto', notes: null,
                    completed_at: '2026-07-01T00:00:00' },
                { id: 2, pipeline_fk: 1, title: 'mate A', run: 'auto', notes: null,
                    completed_at: null },
                { id: 3, pipeline_fk: 1, title: 'not a mate', run: 'manual', notes: null,
                    completed_at: null },
                { id: 4, pipeline_fk: 1, title: 'mate B', run: 'auto', notes: null,
                    completed_at: null },
            ],
            stepRequirements: [
                { step_fk: 2, requirement_fk: 900 },
                { step_fk: 3, requirement_fk: 901 },
                { step_fk: 4, requirement_fk: 902 },
            ],
            stepDeps: [
                { id: 1, step_fk: 2, dep_step_fk: 1, time_at: null },
                { id: 2, step_fk: 3, dep_step_fk: 1, time_at: null },
                { id: 3, step_fk: 4, dep_step_fk: 1, time_at: null },
            ],
            requirements: [
                { id: 900, requirement_status: 'approved', machine_fk: 2, feature_fk: 201 },
                { id: 901, requirement_status: 'approved', machine_fk: 2, feature_fk: 202 },
                { id: 902, requirement_status: 'approved', machine_fk: 2, feature_fk: 203 },
            ],
            features: [
                { id: 201, title: 'F1', epic_fk: 21 },
                { id: 202, title: 'F2', epic_fk: 22 },
                { id: 203, title: 'F3', epic_fk: 23 },
            ],
            epics: [
                { id: 21, title: 'Epic A' }, { id: 22, title: 'Epic B' },
                { id: 23, title: 'Epic C' },
            ],
            machines: MACHINES,
        };
        const p = orderedPlan(
            buildPipelineModel({
                pipeline: { id: 1, title: 'x', pipeline_status: 'active', machine_fk: 2 },
                ...reads,
            }),
            { now: NOW });
        // Each of the three steps derives its own epic, so the engine correctly
        // proposes NO batch at all — the input this geometry has to survive is
        // constructed, not derived.
        expect(p.batches).toEqual([]);
        const batch = { letter: 'A', stepIds: [2, 4], swarmStartArgs: [900, 902] };
        const layout = computePlanLayout(p.rows, [batch]);
        expect(layout.batchBoxes).toHaveLength(2);
        const outsider = layout.nodes.get(3);
        for (const box of layout.batchBoxes) {
            const inside = outsider.x > box.x && outsider.x < box.x + box.width
                && outsider.y > box.y && outsider.y < box.y + box.height;
            expect(inside).toBe(false);
        }
    });

    for (const opts of COMBOS) {
        const name = `batch plan, ${opts.reqLayout} reqs × ${opts.stepLabel} labels`;
        it(`zero label overlap with batch letters and long epic titles (${name})`, () => {
            const layout = computePlanLayout(crossPlan.rows, crossPlan.batches, opts);
            assertNoLabelOverlap(layout, name);
        });
    }

    // ── req #3225 — epic label counts on TOP of long titles + batch letters ──
    // `crossPlan`'s two epics (47/48 chars) are already close to the worst
    // realistic case; double-digit counts push them further. THE ACCEPTANCE
    // CRITERION ITSELF: the zero-overlap invariant must still hold once labels
    // grow by a count suffix — wider labels COVERED BY the invariant, never
    // drawn around it.
    it('appends "met/total" to the band whose epic the map names', () => {
        const [firstBand] = crossPlan.rows
            .map((r) => r.epicId).filter((id) => id != null);
        const epicCounts = new Map([[firstBand, { met: 3, total: 7 }]]);
        const layout = computePlanLayout(crossPlan.rows, crossPlan.batches,
            { reqLayout: 'vertical', stepLabel: 'title', epicCounts });
        const band = layout.bands.find((b) => b.epicId === firstBand);
        expect(band.epicLabel).toBe(`${band.epic} 3/7`);
        // THE SAME STRING measures the zero-overlap label rect — not a second,
        // unchecked rectangle drawn beside the name.
        const label = layout.labels.find((l) => l.kind === 'epic' && l.epicId === firstBand);
        expect(label.text).toBe(band.epicLabel);
        // + EPIC_PAUSE_BUBBLE_W (req #3226) — grown onto this rect the same
        // way the count suffix is: the zero-overlap invariant sweeps
        // `layout.labels`, so anything the chip actually reserves belongs here.
        expect(label.w).toBeCloseTo(
            band.epicLabel.length * EPIC_CHIP_CHAR_W + EPIC_PAUSE_BUBBLE_W, 6);
    });

    it('accepts a plain object as well as a Map, matching the reqTitles convention', () => {
        const [firstBand] = crossPlan.rows
            .map((r) => r.epicId).filter((id) => id != null);
        const layout = computePlanLayout(crossPlan.rows, crossPlan.batches, {
            epicCounts: { [firstBand]: { met: 2, total: 4 } },
        });
        const band = layout.bands.find((b) => b.epicId === firstBand);
        expect(band.epicLabel).toBe(`${band.epic} 2/4`);
    });

    const WIDE_COUNTS = new Map([[11, { met: 99, total: 100 }], [12, { met: 0, total: 100 }]]);
    for (const opts of COMBOS) {
        const name = `${opts.reqLayout} reqs × ${opts.stepLabel} labels, counts on`;
        it(`zero label overlap with long epic titles AND count suffixes (${name})`, () => {
            const withCounts = computePlanLayout(crossPlan.rows, crossPlan.batches,
                { ...opts, epicCounts: WIDE_COUNTS });
            assertNoLabelOverlap(withCounts, name);
            const beads = [...withCounts.nodes.values()].map(beadRect);
            for (const label of withCounts.labels) {
                for (const bead of beads) {
                    expect(rectsOverlap(label, bead)).toBe(false);
                }
            }
        });
    }

    // Verification-round regression: two batches at the same depth in ONE band.
    // The first packing pass let a batch's mates spread around the other
    // batch's lanes, so its box enclosed all of them. The contiguous-run
    // allocation must keep every box to exactly its own members.
    it('keeps two same-depth batches in one band strictly apart', () => {
        const mk = (id, depIds, reqIds) => ({
            id, title: `s${id}`, run: 'auto', state: 'pending', reqIds,
            depIds, timeDeps: [], epicId: 1, epic: 'E1',
            epicLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
        });
        const rows = [
            mk(1, [], []),
            mk(2, [], []),
            mk(6, [2], [906]), mk(7, [2], [907]), mk(8, [2], [908]),
            mk(3, [1, 2], [903]), mk(4, [1, 2], [904]),
        ];
        const batches = [
            { letter: 'A', stepIds: [6, 7, 8] },
            { letter: 'B', stepIds: [3, 4] },
        ];
        const layout = computePlanLayout(rows, batches);
        for (const box of layout.batchBoxes) {
            const members = new Set(box.stepIds);
            for (const n of layout.nodes.values()) {
                if (members.has(n.id)) continue;
                const inside = n.x > box.x && n.x < box.x + box.width
                    && n.y > box.y && n.y < box.y + box.height;
                if (inside) {
                    throw new Error(`batch ${box.letter} box encloses `
                        + `non-member step ${n.id}`);
                }
            }
            // And every member really is inside its own box.
            for (const id of members) {
                const n = layout.nodes.get(id);
                if (!n) continue;
                expect(n.x > box.x && n.x < box.x + box.width
                    && n.y > box.y && n.y < box.y + box.height).toBe(true);
            }
        }
        assertNoLabelOverlap(layout, 'two same-depth batches');
        assertStraightArcsClear(layout, rows);
    });
});

// ── req #3256 — the batch letter's corridor, and the dead lane in its box ────
// Both halves were MEASURED on the live plan (pipeline 2, 2026-08-02) before
// anything moved: a `batch A` letter parked in the band header dropped a 689px
// dashed leader to a box near the bottom of a 27-lane band, and that box spanned
// lanes 7/9/10/11 with an empty row at 8 whose only occupant sat one column to
// the left. This fixture reproduces the SHAPE rather than the plan: a gate step
// plus four batch-mates at two depths in a many-lane band, with neighbouring
// steps in the same column able to take a lane between the mates.
// The bound on how far a batch letter may climb looking for clear space,
// DERIVED here from published band geometry exactly as the module derives it —
// the bead row of the lane above the box. A retyped constant would agree with a
// changed layout by accident, and there is no fixed number to retype anyway:
// the room above a box is one lane pitch, and a lane pitch grows with the
// requirement stack its lane carries (req #3119).
// The batch letter climbs to the first clear slot above its box and may not
// leave the band doing it — its floor is the band's own reserved letter strip,
// where the fallback would put it. There is no tighter bound to assert and
// deliberately so: see the ceiling's comment in the module.
const letterCeilingY = (layout, box) => layout.bands[box.bandIndex].y + 26;
const letterCeiling = (layout, box, label) => label.y >= letterCeilingY(layout, box);

// The two bead invariants the Substrate fixture asserts, re-run over a given
// layout. The batch letter MOVED in req #3256 and the module-level versions of
// these only ever see a fixture that produces zero batch boxes, so a letter
// landing on a bead — which is exactly what a first cut of that move did, on
// every congested column — was invisible to them.
// Same kind filter and same own-bead exemption as the module-level version, so
// the two cannot say different things about one layout.
function assertNoLabelOnBead(layout, name) {
    for (const l of layout.labels) {
        if (!['step', 'title', 'batch'].includes(l.kind)) continue;
        for (const [stepId, n] of layout.nodes) {
            if (l.stepId === stepId) continue;
            const cx = Math.max(l.x, Math.min(n.x, l.x + l.w));
            const cy = Math.max(l.y, Math.min(n.y, l.y + l.h));
            const d = Math.hypot(n.x - cx, n.y - cy);
            if (d < BEAD_HIT_RADIUS) {
                throw new Error(`label on bead (${name}): ${l.kind} label `
                    + `${JSON.stringify(l)} reaches step ${stepId}'s hit circle at `
                    + `(${n.x}, ${n.y}) — distance ${d.toFixed(1)} < ${BEAD_HIT_RADIUS}`);
            }
        }
    }
}

describe('batch letters and box lane spans (req #3256)', () => {
    // Mates land at two depths because req #3188 keys the launch on the
    // REMAINING gate: step 20/21 gate on the complete root, 22/23 on a complete
    // step one column deeper, so all four share an empty remaining gate and one
    // launch key while sitting in two columns. Eight complete fillers hanging
    // off the same root are what force the dep-adjacent lane INSERTION path —
    // each finds its anchor lane taken and opens a fractional lane below it,
    // which is what lands inside the batch's reserved run.
    //
    // AGAINST req #3229's RUN, not the one it replaced. That requirement made
    // the run per (letter, column) and published `runIntervals` so nothing else
    // enters one — but it enforces the interval AT ITS OWN COLUMN, which is the
    // cell question. The fractional lane these fillers open is at another
    // column, so it clears every check #3229 added and still becomes a lane row
    // between two mates at the band-wide renumber. Measured on the 400-plan
    // corpus with #3229 merged and nothing else: 1084 of 3848 boxes spanning a
    // row no member occupies, zero of them enclosing a foreign bead.
    const denseReads = (() => {
        const steps = [];
        const stepDeps = [];
        const stepRequirements = [];
        const requirements = [];
        let rid = 9000;
        const mk = (id, title, deps, status) => {
            steps.push({ id, pipeline_fk: 1, title, run: 'auto', notes: null,
                completed_at: null });
            for (const d of deps) {
                stepDeps.push({ id: id * 100 + d, step_fk: id, dep_step_fk: d,
                    time_at: null });
            }
            for (let k = 0; k < 3; k++) {
                rid += 1;
                stepRequirements.push({ id: id * 50 + k, step_fk: id, requirement_fk: rid });
                requirements.push({
                    id: rid, title: `A fairly long requirement title ${rid}`,
                    requirement_status: status, feature_fk: 701, tracking: 0,
                    machine_fk: 2, started_at: null,
                    completed_at: status === 'met' ? '2026-07-01T00:00:00Z' : null,
                });
            }
        };
        mk(1, 'The root gate step with a long name', [], 'met');
        for (let i = 2; i <= 9; i++) mk(i, `Filler step number ${i} with a long name`, [1], 'met');
        mk(10, 'Satisfied gate for the batch', [1], 'met');
        mk(20, 'Batch mate one long title here', [1], 'swarm_ready');
        mk(21, 'Batch mate two long title here', [1], 'swarm_ready');
        mk(22, 'Batch mate three long title here', [10], 'swarm_ready');
        mk(23, 'Batch mate four long title here', [10], 'swarm_ready');
        for (let i = 30; i <= 36; i++) mk(i, `Deep filler ${i} with a long name`, [10], 'met');
        return {
            steps,
            stepDeps,
            stepRequirements,
            requirements,
            features: [{ id: 701, title: 'Dense Feature', epic_fk: 71 }],
            epics: [{ id: 71, title: 'A Dense Epic With A Long Title' }],
            machines: MACHINES,
        };
    })();

    const densePlan = orderedPlan(buildPipelineModel({
        pipeline: { id: 1, title: 'dense', pipeline_status: 'active', machine_fk: 2 },
        ...denseReads,
    }), { now: NOW });

    it('groups all four mates into one batch across two depths', () => {
        expect(densePlan.batches).toHaveLength(1);
        expect(densePlan.batches[0].stepIds.slice().sort((a, b) => a - b))
            .toEqual([20, 21, 22, 23]);
    });

    it('gives the band more lanes than the batch, so the run must survive them', () => {
        const layout = computePlanLayout(densePlan.rows, densePlan.batches);
        const band = layout.bands[layout.nodes.get(20).bandIndex];
        expect(band.sub).toBeGreaterThan(8);
    });

    for (const opts of COMBOS) {
        const name = `${opts.reqLayout} reqs × ${opts.stepLabel} labels`;

        // DELIVERABLE 2. A dashed box is a claim about which steps launch
        // together; a lane row inside it that no member occupies reads as a
        // fifth, nameless member and is what produced the doubled first-to-
        // second gap in the reported screenshot.
        it(`encloses no lane its own members do not occupy (${name})`, () => {
            const layout = computePlanLayout(densePlan.rows, densePlan.batches, opts);
            expect(layout.batchBoxes.length).toBeGreaterThan(0);
            for (const box of layout.batchBoxes) {
                const lanes = box.stepIds.map((id) => layout.nodes.get(id).lane)
                    .sort((a, b) => a - b);
                const span = lanes[lanes.length - 1] - lanes[0] + 1;
                expect(span,
                    `batch ${box.letter} box spans ${span} lane rows for `
                    + `${lanes.length} members (lanes ${lanes.join(',')})`)
                    .toBe(lanes.length);
            }
        });

        // DELIVERABLE 1. No leader at all here — the letter is its box's
        // caption, inside the box's x-range and a few pixels above it, which is
        // the whole point of taking it off the band header. Under the old
        // placement the SAME fixture drew leaders of 1629–2191px.
        it(`anchors every batch letter to its own box (${name})`, () => {
            const layout = computePlanLayout(densePlan.rows, densePlan.batches, opts);
            const letters = layout.labels.filter((x) => x.kind === 'batch');
            expect(letters).toHaveLength(layout.batchBoxes.length);
            letters.forEach((l, i) => {
                const box = layout.batchBoxes[i];
                expect(l.leader, `batch ${l.letter} still needs a leader`).toBeNull();
                expect(l.x).toBeGreaterThanOrEqual(box.x);
                expect(l.x + l.w).toBeLessThanOrEqual(box.x + box.width);
                expect(box.y - (l.y + l.h), `batch ${l.letter} rise above its box`)
                    .toBeGreaterThanOrEqual(0);
                expect(letterCeiling(layout, box, l)).toBe(true);
            });
        });

        // The invariant this module exists to prove, on the fixture the two
        // fixes above were tuned against — moving text near a box top is
        // exactly how the epic-label × batch-letter collision shipped once.
        it(`holds zero label overlap and no label-on-bead, dense fixture (${name})`, () => {
            const layout = computePlanLayout(densePlan.rows, densePlan.batches, opts);
            assertNoLabelOverlap(layout, `dense batch fixture (${name})`);
            assertNoLabelOnBead(layout, `dense batch fixture (${name})`);
        });
    }

    // ── The CONGESTED column, where the letter cannot sit ON its box ─────────
    // Three complete chains push the batch onto a deep lane, and the step
    // directly above it in the SAME column carries a requirement stack whose
    // marks cover both ends of the box. The letter has to climb through that
    // stack, and the drop-line — which the common case above no longer draws —
    // is what keeps it and its box one thing. Measured here: 42–87px, against
    // the 407–689px the header-strip placement drew on the live plan.
    //
    // This is where the letter runs out of room, so it is where the BEAD sweep
    // is load-bearing. A first cut of req #3256 clashed against labels only, and
    // since a requirement mark sits 14px under its bead, displacing off one put
    // the letter's top edge exactly on that bead's centre — in every congested
    // case. Hence the bead assertion below as well as the overlap one.
    //
    // NOT the header-strip fallback: that branch places the letter AT the
    // ceiling, and these rows all land above it. It has no test and no measured
    // input reaches it — 0 of 3848 boxes in the sweep below, 0 of 78,692 in an
    // independent adversarial sweep at review. It is kept as the module's
    // totality guarantee (the reserved strip is free by construction), on the
    // same reasoning the cross-band segmentation defence above is kept.
    const congestedPlan = (nReq) => {
        const steps = [];
        const stepDeps = [];
        const stepRequirements = [];
        const requirements = [];
        let rid = 8000;
        const mk = (id, title, deps, status) => {
            steps.push({ id, pipeline_fk: 1, title, run: 'auto', notes: null,
                completed_at: null });
            for (const d of deps) {
                stepDeps.push({ id: id * 100 + d, step_fk: id, dep_step_fk: d, time_at: null });
            }
            for (let k = 0; k < nReq; k++) {
                rid += 1;
                stepRequirements.push({ id: id * 50 + k, step_fk: id, requirement_fk: rid });
                requirements.push({
                    id: rid, title: `Requirement title ${rid} that is quite long indeed`,
                    requirement_status: status, feature_fk: 801, tracking: 0,
                    machine_fk: 2, started_at: null,
                    completed_at: status === 'met' ? '2026-07-01T00:00:00Z' : null,
                });
            }
        };
        mk(1, 'Root gate step', [], 'met');
        for (let i = 0; i < 3; i++) {
            mk(10 + i, `Mid step ${i} with a long name`, [1], 'met');
            mk(40 + i, `Deep step ${i} with a long name`, [10 + i], 'met');
        }
        mk(30, 'Satisfied batch gate', [1], 'met');
        mk(20, 'Batch mate one', [30], 'swarm_ready');
        mk(21, 'Batch mate two', [30], 'swarm_ready');
        return orderedPlan(buildPipelineModel({
            pipeline: { id: 1, title: 'congested', pipeline_status: 'active', machine_fk: 2 },
            steps,
            stepDeps,
            stepRequirements,
            requirements,
            features: [{ id: 801, title: 'Congested Feature', epic_fk: 81 }],
            epics: [{ id: 81, title: 'A Congested Epic' }],
            machines: MACHINES,
        }), { now: NOW });
    };

    // The stack grows by one line per requirement and the letter's climb grows
    // with it — which is exactly why the ceiling is DERIVED from the band's
    // laneY and not a constant. A 96px window held at three requirements and
    // dropped the letter back to the band header — a 455px leader — at four.
    for (const nReq of [1, 2, 3, 4]) {
        it(`draws a drop-line joining letter to box, ${nReq} req(s) above`, () => {
            const p = congestedPlan(nReq);
            expect(p.batches).toHaveLength(1);
            const layout = computePlanLayout(p.rows, p.batches,
                { reqLayout: 'horizontal', stepLabel: 'id' });
            const letters = layout.labels.filter((x) => x.kind === 'batch');
            expect(letters).toHaveLength(layout.batchBoxes.length);
            let withLeader = 0;
            letters.forEach((l, i) => {
                const box = layout.batchBoxes[i];
                expect(Math.min(...box.stepIds.map((id) => layout.nodes.get(id).lane)),
                    'the batch must be pushed off lane 0 for this to test anything')
                    .toBeGreaterThan(0);
                expect(letterCeiling(layout, box, l),
                    `batch ${l.letter} climbed past the lane above's bead row`).toBe(true);
                expect(l.x).toBeGreaterThanOrEqual(box.x);
                expect(l.x + l.w).toBeLessThanOrEqual(box.x + box.width);
                if (l.leader) {
                    withLeader++;
                    expect(l.leader.y2).toBe(box.y);
                    expect(l.leader.y1).toBeGreaterThan(l.y);
                    expect(l.leader.y2 - l.leader.y1).toBeLessThanOrEqual(
                        box.y - letterCeilingY(layout, box));
                }
            });
            expect(withLeader, 'this fixture exists to exercise the leader branch')
                .toBeGreaterThan(0);
            assertNoLabelOverlap(layout, `congested column, ${nReq} req(s)`);
            assertNoLabelOnBead(layout, `congested column, ${nReq} req(s)`);
        });
    }

    // ── The sweep the two fixtures above cannot be ──────────────────────────
    // Both fixtures are shapes somebody REASONED their way to, and the module's
    // failure mode is precisely that a shape nobody reasoned about breaks a
    // constant. So the same four properties run over generated plans too, from
    // a FIXED seed — deterministic, no snapshot, and a counter-example arrives
    // as a plan this file can print rather than as a flake.
    //
    // SIZED AGAINST A MEASURED DEFECT RATE, not by feel: the label-on-bead bug
    // this suite was extended for showed up on 1.3% of letters, so a 200-box
    // sweep would have let a regression through about one run in fifteen. 300
    // plans is ~1500 boxes and still well under a second.
    it('holds every batch property over seeded random plans', () => {
        let seed = 12345;
        const rnd = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };
        const STATUSES = ['met', 'development', 'approved', 'swarm_ready', 'authoring'];
        let boxes = 0;
        for (let it = 0; it < 300; it++) {
            const nSteps = 6 + Math.floor(rnd() * 22);
            const nEpics = 1 + Math.floor(rnd() * 3);
            const steps = [];
            const stepDeps = [];
            const stepRequirements = [];
            const requirements = [];
            const features = [];
            const epics = [];
            for (let e = 1; e <= nEpics; e++) {
                epics.push({ id: e, title: `Epic ${e} with a longish title` });
                features.push({ id: 100 + e, title: `Feature ${e}`, epic_fk: e });
            }
            let rid = 5000;
            for (let s = 1; s <= nSteps; s++) {
                steps.push({ id: s, pipeline_fk: 1, run: 'auto', notes: null,
                    completed_at: null, title: `Step ${s} with a moderately long name` });
                const nd = Math.floor(rnd() * 3);
                for (let k = 0; k < nd; k++) {
                    const d = 1 + Math.floor(rnd() * (s - 1));
                    if (d >= 1 && d < s) {
                        stepDeps.push({ id: s * 100 + k, step_fk: s, dep_step_fk: d,
                            time_at: null });
                    }
                }
                const st = STATUSES[Math.floor(rnd() * STATUSES.length)];
                const nr = 1 + Math.floor(rnd() * 4);
                const f = 101 + Math.floor(rnd() * nEpics);
                for (let k = 0; k < nr; k++) {
                    rid += 1;
                    stepRequirements.push({ id: s * 50 + k, step_fk: s, requirement_fk: rid });
                    requirements.push({ id: rid, requirement_status: st, feature_fk: f,
                        tracking: 0, machine_fk: null,
                        title: `Requirement title ${rid} of some length`,
                        started_at: st === 'development' ? '2026-07-20T00:00:00Z' : null,
                        completed_at: st === 'met' ? '2026-07-01T00:00:00Z' : null });
                }
            }
            const p = orderedPlan(buildPipelineModel({
                pipeline: { id: 1, title: 'fuzz', pipeline_status: 'active' },
                steps, stepRequirements, stepDeps, requirements, features, epics,
                machines: [],
            }), { now: NOW });
            if (!p.batches.length) continue;
            for (const opts of COMBOS) {
                const where = `seed plan ${it} (${opts.reqLayout} × ${opts.stepLabel})`;
                const layout = computePlanLayout(p.rows, p.batches, opts);
                assertNoLabelOverlap(layout, where);
                assertNoLabelOnBead(layout, where);
                const letters = layout.labels.filter((l) => l.kind === 'batch');
                expect(letters).toHaveLength(layout.batchBoxes.length);
                layout.batchBoxes.forEach((box, i) => {
                    boxes++;
                    const lanes = box.stepIds.map((id) => layout.nodes.get(id).lane)
                        .sort((a, b) => a - b);
                    expect(lanes[lanes.length - 1] - lanes[0] + 1,
                        `${where}: batch ${box.letter} box spans a lane no member occupies `
                        + `(lanes ${lanes.join(',')})`).toBe(lanes.length);
                    const l = letters[i];
                    expect(letterCeiling(layout, box, l),
                        `${where}: batch ${l.letter} climbed past the lane above`).toBe(true);
                    expect(l.x).toBeGreaterThanOrEqual(box.x);
                    expect(l.x + l.w).toBeLessThanOrEqual(box.x + box.width);
                });
            }
        }
        // Guards the sweep against silently generating nothing to look at.
        expect(boxes).toBeGreaterThan(1000);
        // The 5s default was never right for this one — "well under a second"
        // above was measured on an idle machine, and 300 seeded plans × the
        // full property set runs 1.1–3.9s in practice, so it timed out
        // intermittently under any parallel load (observed on an unmodified
        // tree, before req #3271 added to this file). A budget matched to the
        // work it actually does, rather than a flake nobody owns.
    }, 30000);
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

describe('empty plan', () => {
    it('returns an explicit empty layout rather than NaN geometry', () => {
        const layout = computePlanLayout([], []);
        expect(layout.empty).toBe(true);
        expect(layout.nodes.size).toBe(0);
        expect(layout.labels).toEqual([]);
    });
});

// ── req #3168 ──────────────────────────────────────────────────────────────

describe('step width option (req #3168)', () => {
    const WIDTHS = Object.keys(STEP_WIDTH_FACTORS);

    it('compact is the IDENTITY — an unchanged reader gets the unchanged plan', () => {
        for (const opts of COMBOS) {
            const before = computePlanLayout(plan.rows, plan.batches, opts);
            const after = computePlanLayout(plan.rows, plan.batches,
                { ...opts, stepWidth: 'compact' });
            expect(after.colW).toEqual(before.colW);
            expect(after.width).toBe(before.width);
        }
    });

    it('every wider setting widens EVERY column, monotonically', () => {
        const at = (w) => computePlanLayout(plan.rows, plan.batches, { stepWidth: w }).colW;
        const compact = at('compact');
        const medium = at('medium');
        const wide = at('wide');
        expect(medium).toHaveLength(compact.length);
        for (let d = 0; d < compact.length; d++) {
            expect(medium[d]).toBeGreaterThan(compact[d]);
            expect(wide[d]).toBeGreaterThan(medium[d]);
            // RATIO against compact's own factor, not against 1. `compact` has
            // not been the identity since the 2026-08-01 retune ("shift widths
            // S/M/L all by 10% higher except L by 20%") — comparing a
            // compact-relative ratio to an absolute factor only ever passed
            // because the anchor happened to be 1.
            expect(medium[d] / compact[d]).toBeCloseTo(
                STEP_WIDTH_FACTORS.medium / STEP_WIDTH_FACTORS.compact, 6);
            expect(wide[d] / compact[d]).toBeCloseTo(
                STEP_WIDTH_FACTORS.wide / STEP_WIDTH_FACTORS.compact, 6);
        }
    });

    // The load-bearing claim: the width option must not be able to break the
    // zero-overlap contract the module exists to prove. It is a UNIFORM scale on
    // the column widths, and both the label character budget and the stagger
    // reach are linear in those, so the proof is scale-invariant — but "should
    // be" is not a test, and a future factor below 1 would break it silently.
    for (const stepWidth of WIDTHS) {
        for (const opts of COMBOS) {
            const name = `${opts.reqLayout} × ${opts.stepLabel} × ${stepWidth}`;
            it(`holds zero label overlap, no label-on-bead and column containment (${name})`,
                () => {
                    const layout = computePlanLayout(plan.rows, plan.batches,
                        { ...opts, stepWidth });
                    assertNoLabelOverlap(layout, name);
                    const beads = [...layout.nodes.values()].map(beadRect);
                    for (const label of layout.labels) {
                        for (const bead of beads) {
                            expect(rectsOverlap(label, bead)).toBe(false);
                        }
                    }
                    for (const label of layout.labels) {
                        if (label.stepId == null || label.kind !== 'req') continue;
                        const n = layout.nodes.get(label.stepId);
                        const left = layout.colX[n.depth] - layout.colW[n.depth] / 2;
                        const right = layout.colX[n.depth] + layout.colW[n.depth] / 2;
                        expect(label.x).toBeGreaterThanOrEqual(left - 0.01);
                        expect(label.x + label.w).toBeLessThanOrEqual(right + 0.01);
                    }
                    assertStraightArcsClear(layout, plan.rows);
                });
        }
    }

    it('an unknown width falls back to compact rather than producing NaN geometry', () => {
        const compact = computePlanLayout(plan.rows, plan.batches, { stepWidth: 'compact' });
        // Including the INHERITED Object.prototype keys. The setting is read from
        // localStorage, so these are reachable strings, and a plain truthiness
        // lookup returns the inherited FUNCTION — every column width becomes NaN
        // and the canvas renders blank with no error (review finding).
        for (const bogus of ['enormous', 'toString', 'constructor', 'valueOf',
            '', null, undefined, 0]) {
            const layout = computePlanLayout(plan.rows, plan.batches, { stepWidth: bogus });
            expect(layout.colW, `stepWidth=${String(bogus)}`).toEqual(compact.colW);
            expect(Number.isFinite(layout.width)).toBe(true);
        }
        expect(isStepWidth('toString')).toBe(false);
        expect(isStepWidth('wide')).toBe(true);
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
        const layout = computePlanLayout(plan.rows, plan.batches,
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
    const layout = computePlanLayout(plan.rows, plan.batches,
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
            + (band.epicId != null ? EPIC_CHIP_OPEN_LINK_W : 0)
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
    // and it scales with zoom, which is why a constant offset would be wrong at
    // every zoom but one.
    it('clamps below the PINNED RULER at every zoom, reading req #3254\'s own '
        + 'rulerScreenBottom rather than a guessed offset', () => {
        const band = layout.bands.reduce((a, b) => (b.height > a.height ? b : a));
        for (const k of [0.5, 1, 2, 4]) {
            const t = { x: 0, y: -(band.y * k) - 400 * k, k };
            const inset = rulerScreenBottom(t);
            // The strip is pinned, so its bottom edge is a function of zoom —
            // the premise that makes a hand-picked constant wrong.
            expect(inset).toBeCloseTo(RULER_H * k, 6);
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
            + EPIC_CHIP_OPEN_LINK_W + EPIC_PAUSE_BUBBLE_W, 6);
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
    const layout = computePlanLayout(plan.rows, plan.batches,
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
        let checked = 0;
        for (let k = kZoomFloor; k <= kWhole; k += (kWhole - kZoomFloor) / 12) {
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
                + (band.epicId != null ? EPIC_CHIP_OPEN_LINK_W : 0)
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
        const withCounts = computePlanLayout(plan.rows, plan.batches,
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
        const layout = computePlanLayout(plan.rows, plan.batches,
            { epicCounts: new Map([[999999, { met: 1, total: 1 }]]) });
        for (const band of layout.bands) {
            expect(band.epicLabel).toBe(band.epic);
        }
    });

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
        const layout = computePlanLayout(p.rows, p.batches,
            { epicCounts: new Map([[1, { met: 1, total: 1 }]]) });
        const noEpicBand = layout.bands.find((b) => b.epicId == null);
        expect(noEpicBand.epicLabel).toBe(noEpicBand.epic);
    });

    it('placeEpicChips draws the epicLabel text and measures its width, not the bare name', () => {
        const baseLayout = computePlanLayout(plan.rows, plan.batches,
            { reqLayout: 'vertical', stepLabel: 'title' });
        const epicCounts = new Map(baseLayout.bands
            .filter((b) => b.epicId != null)
            .map((b) => [b.epicId, { met: 9, total: 99 }]));
        const withCounts = computePlanLayout(plan.rows, plan.batches,
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
            + EPIC_CHIP_OPEN_LINK_W + EPIC_PAUSE_BUBBLE_W, 6);
    });

    it('the toggle is a pure display transform: the ONLY thing that changes '
        + 'with epicCounts is band.epicLabel and the label/chip rects built from it', () => {
        const without = computePlanLayout(plan.rows, plan.batches,
            { reqLayout: 'vertical', stepLabel: 'title' });
        const withCounts = computePlanLayout(plan.rows, plan.batches, {
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

    // The halo is a MARK ON THE CANVAS, so it owes the same clearance every
    // other mark does — and the bead-vs-label invariant above measures the BEAD's
    // 10px radius, not the ring drawn outside it. The first version of this halo
    // was BEAD_R + 7 with a 2.5px stroke (outer 18.25) and crossed both the step
    // label's box and the first requirement id, with nothing to catch it (review
    // finding). Asserted here so the radius can never be nudged back up in
    // isolation.
    it('clears every label box in all four layout combinations', () => {
        const outer = NEXT_HALO_RADIUS + NEXT_HALO_STROKE / 2;
        for (const opts of COMBOS) {
            const layout = computePlanLayout(plan.rows, plan.batches, opts);
            for (const label of layout.labels) {
                if (label.stepId == null) continue;
                const n = layout.nodes.get(label.stepId);
                const halo = { x: n.x - outer, y: n.y - outer, w: 2 * outer, h: 2 * outer };
                expect(rectsOverlap(label, halo),
                    `${opts.reqLayout}/${opts.stepLabel}: halo on ${label.kind} `
                    + `label of step ${label.stepId}`).toBe(false);
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
            expect(nextHaloMagnify(k), `k=${k}`).toBe(1);
        }
        // Non-vacuity: the sweep must actually contain legible scales.
        expect(K_SWEEP.filter(labelsLegible).length).toBeGreaterThan(5);
    });

    // Zooming IN never changes the mark either. Only the zoomed-OUT half of the
    // range, where the mark had shrunk below its target, is touched at all.
    it('is exactly 1 once the mark already meets its target on screen', () => {
        for (const k of K_SWEEP.filter((v) => v >= 1)) {
            expect(nextHaloMagnify(k), `k=${k}`).toBe(1);
        }
    });

    // THE REGRESSION PIN THE REQUIREMENT ASKED FOR. If this ever reverts to
    // world units, every one of these products collapses to `constant × k` and
    // the case fails at the first k in the sweep.
    it('holds the halo SCREEN-constant across a k sweep, until the cap bites', () => {
        for (const k of [...K_SWEEP, 0.45, 0.6, 0.75].sort((a, b) => a - b)) {
            const m = nextHaloMagnify(k);
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
            const m = nextHaloMagnify(k);
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
            const gapPx = (innerAt(nextHaloMagnify(k)) - BEAD_OUTER_RADIUS) * k;
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
        expect((innerAt(nextHaloMagnify(kFitWide)) - BEAD_OUTER_RADIUS) * kFitWide,
            'gap px at fit-to-width, 1440px panel').toBeGreaterThan(4);
        // And the world gap never closes at any k, magnified or not.
        let prevGap = null;
        for (const k of [...K_SWEEP].sort((a, b) => b - a)) {
            const gap = innerAt(nextHaloMagnify(k)) - BEAD_OUTER_RADIUS;
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
        // timed fuzz corpus — which is the only source here that draws launch
        // -unit boxes in quantity (the substrate plan draws none).
        const layouts = [
            ...COMBOS.map((opts) => ({
                label: `${opts.reqLayout}/${opts.stepLabel}`,
                layout: computePlanLayout(plan.rows, plan.batches, opts),
            })),
            // BOTH requirement layouts. `horizontal` is the default, and its
            // box bottom is BATCH_BOX_DROP_H = 30 — three world px of slack.
            // `vertical` is BATCH_BOX_DROP_V = 28, which is the clearance the
            // ceiling is actually SET BY, leaving exactly the designed 1px. A
            // sweep that ran only the default asserted 934 times against the
            // looser constant and never touched the binding one (review finding).
            ...[...timedFuzzCorpus()].flatMap(({ seed, reads }) => {
                const p = orderedPlan(buildPipelineModel(reads), { now: FUZZ_NOW });
                return ['horizontal', 'vertical'].map((reqLayout) => ({
                    label: `fuzz seed ${seed} ${reqLayout}`,
                    layout: computePlanLayout(p.rows, p.batches,
                        { reqLayout, timeAxis: p.timeAxis }),
                }));
            }),
        ];
        // Violations are COLLECTED and asserted once, not `expect`ed per pair:
        // this sweeps ~10^5 comparisons and vitest's per-expect overhead is what
        // pushed the case past its timeout.
        const bad = [];
        const seen = { boxes: 0, bands: 0, laneZero: 0, letters: 0, letterPairs: 0 };
        // Per requirement layout, because `vertical` is the one carrying the
        // BINDING clearance (BATCH_BOX_DROP_V = 28, 1px of margin) and a total
        // cannot tell a both-layout sweep from a horizontal-only one: the
        // horizontal-only version drew 467 boxes, comfortably over any total
        // threshold that a both-layout count of 934 would also clear.
        const boxesByLayout = { horizontal: 0, vertical: 0 };
        let minLetterD2 = Infinity;
        let minLetterAt = 'none';
        for (const { label: where, layout } of layouts) {
            seen.boxes += layout.batchBoxes.length;
            seen.bands += layout.bands.length;
            for (const key of Object.keys(boxesByLayout)) {
                if (where.includes(key)) boxesByLayout[key] += layout.batchBoxes.length;
            }
            // Its own launch-unit box, on all four sides.
            for (const box of layout.batchBoxes) {
                for (const id of box.stepIds) {
                    const n = layout.nodes.get(id);
                    const at = `${where} step ${id}`;
                    if (n.y - worstOuter <= box.y) bad.push(`${at}: box top`);
                    if (n.y + worstOuter >= box.y + box.height) bad.push(`${at}: box bottom`);
                    if (n.x - worstOuter <= box.x) bad.push(`${at}: box left`);
                    if (n.x + worstOuter >= box.x + box.width) bad.push(`${at}: box right`);
                }
            }
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
            // The launch-unit LETTER — text, and the one thing a per-bead
            // clearance cannot bound, because the letter a halo crosses belongs
            // to a NEIGHBOURING column's box. Measured at 4 crossings in 467
            // letters before `beadRectsOf` was widened to the halo's reach.
            //
            // Stated as a measured MINIMUM DISTANCE rather than as "no pair
            // intersects". After the fix no pair comes close, so an
            // intersection counter reads zero for two different reasons — fixed,
            // or never compared — and cannot tell them apart. A minimum shrinks
            // visibly when the geometry moves. Squared distances: this is the
            // hot loop of the case.
            const beads = [...layout.nodes.values()];
            for (const l of layout.labels.filter((x) => x.kind === 'batch')) {
                seen.letters += 1;
                for (const n of beads) {
                    seen.letterPairs += 1;
                    const dx = Math.max(l.x - n.x, 0, n.x - (l.x + l.w));
                    const dy = Math.max(l.y - n.y, 0, n.y - (l.y + l.h));
                    const d2 = dx * dx + dy * dy;
                    if (d2 < minLetterD2) {
                        minLetterD2 = d2;
                        minLetterAt = `${where}: letter ${l.letter} × bead ${n.id}`;
                    }
                }
            }
        }
        expect(bad.slice(0, 12)).toEqual([]);
        // No bead's halo reaches ANY launch-unit letter. MEASURED at its
        // tightest: 30.82 world px, seed 127 / letter A / bead 4 — the same
        // letter-and-bead the review found at 19.34, i.e. inside the 23..27
        // annulus — against a reach of 27, so 3.8px of margin. The MINIMUM is
        // the whole assertion: a letter far outside the ring and a letter
        // wholly inside it are both safe, and only the first is reachable here.
        expect(Math.sqrt(minLetterD2), `nearest letter: ${minLetterAt}`)
            .toBeGreaterThan(worstOuter);
        // Non-vacuity, per FURNITURE KIND — a total says nothing about whether
        // each kind was actually compared against.
        // Thresholds sit just under the MEASURED counts, not orders of
        // magnitude below them: a guard at 20 against an actual 1624 catches
        // total collapse and nothing else.
        expect(boxesByLayout.horizontal, 'boxes swept, horizontal reqs')
            .toBeGreaterThan(400);
        expect(boxesByLayout.vertical, 'boxes swept, vertical reqs — the BINDING clearance')
            .toBeGreaterThan(400);
        expect(seen.boxes, 'launch-unit boxes swept').toBeGreaterThan(900);
        expect(seen.bands, 'epic bands swept').toBeGreaterThan(1500);
        expect(seen.laneZero, 'lane-0 beads compared to a chip strip')
            .toBeGreaterThan(6000);
        expect(seen.letters, 'launch-unit letters swept').toBeGreaterThan(900);
        expect(seen.letterPairs, 'letter × bead pairs measured').toBeGreaterThan(15000);
    }, 20000);

    // Kept separate because it is O(beads²): the substrate fixture in all four
    // combinations is enough to pin it, and the corpus above already covers the
    // furniture that varies with the plan's SHAPE.
    it('never reaches another bead, or another bead\'s hit circle', () => {
        const worstOuter = outerAt(NEXT_HALO_MAX_MAGNIFY);
        let pairs = 0;
        for (const opts of COMBOS) {
            const pts = [...computePlanLayout(plan.rows, plan.batches, opts)
                .nodes.values()];
            for (let i = 0; i < pts.length; i += 1) {
                for (let j = i + 1; j < pts.length; j += 1) {
                    pairs += 1;
                    const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
                    expect(d, `${opts.reqLayout}/${opts.stepLabel}: bead pair`)
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
        expect(Object.keys(NEXT_HALO_CLEARANCES).length).toBeGreaterThanOrEqual(7);
        expect(NEXT_HALO_MAX_MAGNIFY).toBeGreaterThan(1.8);
    });

    it('is monotone — zooming out never shrinks the mark', () => {
        const ms = K_SWEEP.map((k) => nextHaloMagnify(k));
        for (let i = 1; i < ms.length; i += 1) {
            expect(ms[i], `k=${K_SWEEP[i]}`).toBeLessThanOrEqual(ms[i - 1]);
        }
    });

    it('falls back to 1 on a scale that is not a usable number', () => {
        for (const k of [0, -1, NaN, Infinity, -Infinity, undefined, null]) {
            expect(nextHaloMagnify(k), `k=${k}`).toBe(1);
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
        // NOT "where the plan OPENS", which is what this said and what #3271's
        // source comments said (corrected in review of req #3280). `resetView`
        // lands on `kDefault` = 0.8 — `recenterModeRef` initialises to
        // 'readable' — so the landing view is ratio 1, level 'mid'. These are
        // the scales one wheel-click OUT of it, which is where the defect was;
        // nothing about the assertions below depended on the difference.
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
            const m = nextHaloMagnify(k);
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
    // boolean across a module boundary. It is now arithmetic: the labels turn on
    // at `K_READABLE` and the magnification turns off at `K_READABLE`, so no
    // caller can put a grown halo under a drawn label — including a reader who
    // PINS L3 at Overview, which is exactly what a level-derived predicate could
    // not protect against.
    // ASKED THROUGH THE PREDICATE THE RENDERER ACTUALLY USES, over every
    // (kind × level × k) it can be asked at — pinned levels included, which is
    // the combination a level-derived gate could not protect and the reason
    // `drawsLabelKind` moved into this module (req #3280). A `&& labelsLegible`
    // deleted from it reddens here rather than shipping a halo drawn through a
    // step name.
    it('never magnifies at a scale where a label is drawn', () => {
        const KINDS = ['step', 'req', 'title'];
        const LEVELS = ['out', 'mid', 'in'];
        const bad = [];
        let drawn = 0;
        for (const k of REACHABLE) {
            for (const level of LEVELS) {
                for (const kind of KINDS) {
                    if (!drawsLabelKind(kind, level, k)) continue;
                    drawn += 1;
                    if (nextHaloMagnify(k) !== 1) {
                        bad.push(`${kind} drawn at ${level}, k=${k.toFixed(4)},`
                            + ` m=${nextHaloMagnify(k)}`);
                    }
                }
            }
        }
        expect(bad.slice(0, 8)).toEqual([]);
        // Non-vacuity, both ways: the sweep must contain combinations that DRAW
        // and scales that MAGNIFY, or the loop above is asserting about nothing.
        expect(drawn, 'kind × level × k combinations that draw')
            .toBeGreaterThan(500);
        expect(REACHABLE.filter((k) => nextHaloMagnify(k) > 1).length)
            .toBeGreaterThan(20);
        // The ungated kinds keep drawing everywhere, at every level and scale —
        // the halo's clearances are what bound it against THEM, and a predicate
        // that started gating them would silently change what those clearances
        // are protecting.
        for (const k of [LIVE_ZOOM_FLOOR, 0.4, K_READABLE, 6]) {
            for (const level of LEVELS) {
                expect(drawsLabelKind('batch', level, k), `batch at ${level}`).toBe(true);
                expect(drawsLabelKind('slot', level, k), `slot at ${level}`).toBe(true);
            }
        }
    });

    // The LEVEL half is untouched — the ladder still decides which kinds a view
    // is for, and req #3280 only added a second condition. At a legible scale
    // the predicate is exactly what it was before this requirement.
    it('leaves the ladder itself alone at a legible scale', () => {
        for (const k of [K_READABLE, 1, 2, 6.4]) {
            expect(['step', 'req', 'title'].filter((x) => drawsLabelKind(x, 'out', k)))
                .toEqual([]);
            expect(['step', 'req', 'title'].filter((x) => drawsLabelKind(x, 'mid', k)))
                .toEqual(['step', 'req']);
            expect(['step', 'req', 'title'].filter((x) => drawsLabelKind(x, 'in', k)))
                .toEqual(['step', 'req', 'title']);
        }
        // And below it, every gated kind goes dark at every level.
        for (const k of [LIVE_ZOOM_FLOOR, 0.2, 0.4, 0.799]) {
            for (const level of ['out', 'mid', 'in']) {
                expect(['step', 'req', 'title'].filter((x) => drawsLabelKind(x, level, k)),
                    `level ${level} at k=${k}`).toEqual([]);
            }
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
            const ra = NEXT_HALO_RADIUS * nextHaloMagnify(a) * a;
            const rb = NEXT_HALO_RADIUS * nextHaloMagnify(b) * b;
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
            radius: NEXT_HALO_RADIUS * nextHaloMagnify(k) * k,
            stroke: NEXT_HALO_STROKE * nextHaloMagnify(k) * k,
            dash: NEXT_HALO_DASH[0] * nextHaloMagnify(k) * k,
            gap: (innerAt(nextHaloMagnify(k)) - BEAD_OUTER_RADIUS) * k,
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
            const m = nextHaloMagnify(k);
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
        expect(NEXT_HALO_RADIUS * nextHaloMagnify(K_READABLE) * K_READABLE)
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
        expect(nextHaloMagnify(K_READABLE)).toBe(1);
        expect(nextHaloMagnify(K_READABLE - 1e-9)).toBeCloseTo(1, 8);
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

    // THE LANDING VIEW IS ALWAYS LEGIBLE, at every plan size — so this gate can
    // never make a plan OPEN without its labels, and the E2E's level assertions
    // (which all read the default camera) are unmoved by it.
    //
    // ASKED OF `readableDefaultScale`, the function the renderer calls (req
    // #3280 review). The first draft rebuilt `Math.max(kFit, K_READABLE)` here
    // and asserted the result was `>= K_READABLE` — which is `max(a,b) >= b`,
    // an identity that stays green if the component is changed to land on
    // `kFit` and every plan wider than its panel opens with no labels at all.
    // That is exactly the claim in this case's title, so the identity version
    // asserted nothing. Hoisting the formula is what made it reachable.
    it('never withholds the labels at the view a plan opens in', () => {
        let bindingCases = 0;
        for (const worldW of [200, 800, 3620.2, 12000]) {
            for (const panelW of [800, 1200, 1440, 1800, 2560]) {
                const kFit = panelW / worldW;
                const where = `world ${worldW} panel ${panelW}`;
                expect(labelsLegible(readableDefaultScale(kFit)), where).toBe(true);
                // The plans where the floor is what saves it — i.e. where a
                // renderer landing on `kFit` WOULD open illegibly. Counted, so
                // the sweep cannot pass by containing only plans that are
                // legible at fit-to-width anyway.
                if (!labelsLegible(kFit)) bindingCases += 1;
            }
        }
        expect(bindingCases, 'plans whose fit-to-width is NOT legible')
            .toBeGreaterThan(4);
        // Ratio 1 at the landing scale, on every plan — the ladder's own
        // definition of the view a reader lands on.
        expect(semanticLevel(1)).toBe('mid');
        // The guard, which is the other half of "always": a non-finite kFit
        // resolves to the floor instead of propagating NaN into every downstream
        // scale (`labelsLegible(NaN)` is false, so a NaN default would open a
        // plan with no labels and no error anywhere).
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
        const strokePx = (k) => NEXT_HALO_STROKE * nextHaloMagnify(k) * k;
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
        // every holding one, so "below k ≈ 0.3" is the whole of the shortfall.
        expect(Math.max(...fails)).toBeLessThan(Math.min(...holds));
        expect(Math.min(...holds)).toBeGreaterThan(0.29);
        expect(Math.min(...holds)).toBeLessThan(0.31);
        // THE PROOF that no ceiling under NEXT_HALO_MAX_OUTER could have closed
        // it: at the zoom floor the halo's ENTIRE outer edge is under three
        // screen px, so the ring is smaller than the stroke it would need. This
        // is the one assertion here that is about the geometry rather than about
        // `m`, and it is why the remainder is a follow-on and not a retune.
        expect(NEXT_HALO_MAX_OUTER * LIVE_ZOOM_FLOOR,
            'the halo\'s entire outer edge, in screen px, at the zoom floor')
            .toBeLessThan(3);
        expect(strokePx(LIVE_ZOOM_FLOOR), 'stroke px at the zoom floor')
            .toBeLessThan(0.4);
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
        const strokePx = (k) => NEXT_HALO_STROKE * nextHaloMagnify(k) * k;

        it('the dot band IS the band the ring cannot reach — found by '
            + 'SEARCHING the swept range, not by restating the closed form '
            + '(same discipline as the sibling case above)', () => {
            const unreadable = new Set(
                REACHABLE.filter((k) => strokePx(k) < NEXT_MARK_MIN_STROKE_PX));
            const dotted = new Set(REACHABLE.filter((k) => nextMarkIsDot(k)));
            expect(unreadable.size, 'ring-unreadable samples').toBeGreaterThan(10);
            expect(dotted.size, 'dot-drawn samples').toBe(unreadable.size);
            for (const k of unreadable) expect(dotted.has(k), `k=${k}`).toBe(true);
        });

        it('is derived from the ring\'s own acceptance floor, not chosen', () => {
            expect(NEXT_MARK_FLOOR_K).toBeCloseTo(
                NEXT_MARK_MIN_STROKE_PX / (NEXT_HALO_STROKE * NEXT_HALO_MAX_MAGNIFY), 10);
            expect(NEXT_MARK_FLOOR_K).toBeGreaterThan(0.29);
            expect(NEXT_MARK_FLOOR_K).toBeLessThan(0.31);
            // The formula only means what it claims to on the CAPPED branch
            // (`strokePx(k) = STROKE × MAX_MAGNIFY × k` there) — true only
            // while the floor itself sits below where the magnification caps
            // (`K_READABLE / NEXT_HALO_MAX_MAGNIFY`). If a future change moved
            // `K_READABLE` low enough to violate this, the floor would stop
            // meaning "where the ring drops under the acceptance stroke".
            expect(NEXT_MARK_FLOOR_K).toBeLessThan(K_READABLE / NEXT_HALO_MAX_MAGNIFY);
        });

        it('draws the ring at and above the floor, the dot only below it — '
            + 'the k >= 0.3 band this requirement must not move', () => {
            const atOrAbove = REACHABLE.filter((k) => k >= NEXT_MARK_FLOOR_K);
            const below = REACHABLE.filter((k) => k < NEXT_MARK_FLOOR_K);
            expect(atOrAbove.length).toBeGreaterThan(0);
            expect(below.length).toBeGreaterThan(0);
            for (const k of atOrAbove) expect(nextMarkIsDot(k), `k=${k}`).toBe(false);
            for (const k of below) expect(nextMarkIsDot(k), `k=${k}`).toBe(true);
            // The exact boundary itself stays on the ring — `nextMarkIsDot` is
            // a strict `<`, so a camera parked exactly at the floor is not a
            // special case needing its own branch.
            expect(nextMarkIsDot(NEXT_MARK_FLOOR_K)).toBe(false);
        });

        it('holds the dot at a FIXED screen radius across the whole '
            + 'reachable deep-zoom-out range, including the live zoom floor', () => {
            const below = REACHABLE.filter((k) => nextMarkIsDot(k));
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
            const below = REACHABLE.filter((k) => nextMarkIsDot(k));
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
            expect(nextMarkIsDot(NaN)).toBe(false);
            expect(nextMarkIsDot(0)).toBe(false);
            expect(nextMarkIsDot(-1)).toBe(false);
        });
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
        const layout = computePlanLayout(plan.rows, plan.batches,
            { pauseInfo: { pipelinePaused: true, pausedEpicIds: [] } });
        expect(layout.bands.length).toBeGreaterThan(0);
        expect(layout.bands.every((b) => b.paused === true)).toBe(true);
    });

    it('computePlanLayout: a band is paused when ITS OWN epic is paused, '
        + 'neighbours untouched', () => {
        const layout = computePlanLayout(plan.rows, plan.batches,
            { pauseInfo: { pipelinePaused: false, pausedEpicIds: [1] } });
        for (const band of layout.bands) {
            expect(band.paused).toBe(band.epicId === 1);
        }
    });

    it('defaults every band to unpaused when pauseInfo is omitted', () => {
        const layout = computePlanLayout(plan.rows, plan.batches);
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
            + EPIC_CHIP_OPEN_LINK_W + EPIC_PAUSE_BUBBLE_W, 6);
    });

    // "its rectangle belongs in the same label set the zero-overlap invariant
    // is already asserted against" — the requirement's own words. The chip's
    // OWN width (above) is what `placeEpicChips` displaces around; THIS rect
    // (`layout.labels`, kind 'epic') is what `assertNoLabelOverlap` actually
    // sweeps, and req #3225 set the precedent that the two must grow together.
    it('the kind:"epic" label rect ALSO carries the bubble reservation', () => {
        const layout = computePlanLayout(plan.rows, plan.batches);
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
        // MEASURED 2026-08-01: 6.13:1 (swarm_ready, the lowest) to 12.49:1
        // (development). The floor is WCAG AA for normal text; the ids render at
        // 13.75px, which is normal text.
        for (const status of REQ_STATUS_ORDER) {
            const ratio = contrast(REQ_STATUS_COLORS[status], PANEL);
            expect(ratio, `${status} (${REQ_STATUS_COLORS[status]}) on ${PANEL}`)
                .toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(REQ_STATUS_UNKNOWN_COLOR, PANEL)).toBeGreaterThanOrEqual(4);
    });

    it('is separable — no two statuses read as the same colour', () => {
        // MEASURED minimum 25.9 (approved vs wontfix). The floor is set at 20:
        // low enough not to fail on a nudge, high enough that a scale collapsing
        // two statuses into one hue cannot pass.
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

    it('AGREES with the panel\'s own state hues where the two mean the same thing', () => {
        // The rule that keeps one meaning to one colour: a requirement in
        // `development` and a step deriving Running are the same fact at two
        // levels, so they are the same amber; likewise `met` and Complete.
        expect(REQ_STATUS_COLORS.development).toBe(PLAN_VIZ_PALETTE.runningRing);
        expect(REQ_STATUS_COLORS.met).toBe(PLAN_VIZ_PALETTE.doneRing);
        // And the converse: no OTHER status may borrow a reserved state hue,
        // which is why Darwin's chip palette is not carried verbatim (its
        // `authoring` is a yellow and its `development` a green — on this panel
        // those read as Running and Complete).
        const reserved = [PLAN_VIZ_PALETTE.runningFill, PLAN_VIZ_PALETTE.runningRing,
            PLAN_VIZ_PALETTE.doneFill, PLAN_VIZ_PALETTE.doneRing];
        for (const status of REQ_STATUS_ORDER) {
            if (status === 'development' || status === 'met') continue;
            expect(reserved, `${status} must not borrow a state hue`)
                .not.toContain(REQ_STATUS_COLORS[status]);
        }
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

describe('the TRI-STATE colour key (req #3168, directive 3)', () => {
    it('has exactly three positions and defaults to state', () => {
        expect(Object.keys(COLOR_KEY_LABELS).sort())
            .toEqual(['machine', 'none', 'state']);
        expect(DEFAULT_COLOR_KEY).toBe('state');
        for (const v of ['state', 'machine', 'none']) expect(isColorKey(v)).toBe(true);
    });

    it('survives a pre-existing stored preference — state and machine still mean themselves',
        () => {
            // The values a reader's browser already holds from before the third
            // position existed. Normalizing them to anything else would silently
            // change an existing plan's appearance.
            expect(normalizeColorKey('state')).toBe('state');
            expect(normalizeColorKey('machine')).toBe('machine');
        });

    it('survives a garbage or localStorage-injected value, INHERITED KEYS INCLUDED', () => {
        // The `isStepWidth` hazard, on a value that ends up as a Konva `fill`.
        for (const bogus of ['constructor', 'toString', 'valueOf', '__proto__',
            'hasOwnProperty', 'STATE', 'none ', '', null, undefined, 0, {}, []]) {
            expect(isColorKey(bogus), `isColorKey(${String(bogus)})`).toBe(false);
            expect(normalizeColorKey(bogus), `normalizeColorKey(${String(bogus)})`)
                .toBe(DEFAULT_COLOR_KEY);
        }
    });

    it('resolves the id style per key — and NEUTRAL is near-white, not black', () => {
        expect(reqIdStyle({ colorKey: 'state', status: 'development' }))
            .toEqual({ fill: REQ_STATUS_COLORS.development, bold: true });
        expect(reqIdStyle({ colorKey: 'machine', machineColor: MACHINE_MAC_COLOR }))
            .toEqual({ fill: MACHINE_MAC_COLOR, bold: true });
        // THE LIGHT-MODE FINDING, pinned rather than commented: this panel is a
        // FIXED dark surface in both app themes (PLAN_VIZ_PALETTE is not
        // theme-derived and the container paints `panel` unconditionally), so
        // "white, or black in white mode" has exactly one reachable answer here.
        expect(reqIdStyle({ colorKey: 'none' }))
            .toEqual({ fill: PLAN_VIZ_PALETTE.text, bold: false });
        expect(luminance(PLAN_VIZ_PALETTE.text))
            .toBeGreaterThan(luminance(PLAN_VIZ_PALETTE.panel));
        // A hostile key falls to the default rather than painting nothing.
        expect(reqIdStyle({ colorKey: 'constructor', status: 'met' }).fill)
            .toBe(REQ_STATUS_COLORS.met);
        expect(reqIdStyle().fill).toBe(REQ_STATUS_UNKNOWN_COLOR);
    });

    it('builds a key that lists only the statuses the plan CONTAINS, in lifecycle order',
        () => {
            const { title, entries } = reqIdKeyEntries({
                colorKey: 'state',
                statuses: ['met', 'swarm_ready', 'met', 'development'],
            });
            expect(title).toBe('Requirement id = status');
            expect(entries.map((e) => e.key)).toEqual(['swarm_ready', 'development', 'met']);
            expect(entries.map((e) => e.label))
                .toEqual(['swarm-ready', 'development', 'met']);
            expect(entries.map((e) => e.color)).toEqual([
                REQ_STATUS_COLORS.swarm_ready,
                REQ_STATUS_COLORS.development,
                REQ_STATUS_COLORS.met,
            ]);
        });

    it('names an unrecognised status rather than hiding it', () => {
        const { entries } = reqIdKeyEntries({
            colorKey: 'state', statuses: ['met', 'brand_new_status', null],
        });
        expect(entries.map((e) => e.key)).toEqual(['met', 'unknown']);
        expect(entries[1].color).toBe(REQ_STATUS_UNKNOWN_COLOR);
    });

    it('switches wholesale to the machine key, and says so on none', () => {
        const machineLegend = [{ key: 2, color: MACHINE_MAC_COLOR, label: 'Mac mini' }];
        expect(reqIdKeyEntries({ colorKey: 'machine', machineLegend }))
            .toEqual({ title: 'Requirement id = machine', entries: machineLegend });
        const off = reqIdKeyEntries({ colorKey: 'none', statuses: ['met'] });
        expect(off.entries).toHaveLength(1);
        expect(off.entries[0].color).toBe(PLAN_VIZ_PALETTE.text);
        expect(off.entries[0].label).toBe('no colour key');
        // And a hostile key does not produce an empty, meaningless legend.
        expect(reqIdKeyEntries({ colorKey: 'toString', statuses: ['met'] }).title)
            .toBe('Requirement id = status');
        expect(reqIdKeyEntries()).toEqual({ title: 'Requirement id = status', entries: [] });
    });
});

describe("the KEY is a keep-out: what it costs the epic labels (req #3168, re-measured #3257)", () => {
    const layout = computePlanLayout(plan.rows, plan.batches,
        { reqLayout: 'vertical', stepLabel: 'title' });
    const VIEWPORT = { w: 1500, h: 900 };

    // The complete key (directive 2) is TALLER than the bead legend it replaces
    // — one row per CHANNEL, plus a heading and the size/motion footer — and no
    // wider, because the component caps it at PLAN_KEY_MAX_W. These sizes
    // bracket what it can actually be at that cap: collapsed (a heading and a
    // button), the ordinary expanded key, and the worst case (a machine key on a
    // many-machine plan, wrapped over several rows).
    const KEY_SIZES = [
        { w: 90, h: 26, label: 'collapsed' },
        { w: 300, h: 76, label: 'expanded, state key' },
        { w: PLAN_KEY_MAX_W, h: 96, label: 'expanded, wrapped to the cap' },
        { w: PLAN_KEY_MAX_W, h: 180, label: 'worst case — many machines, at the cap' },
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

    // ── WHAT THE KEY COSTS, RE-MEASURED (req #3257) ────────────────────────
    // THE OLD INVARIANT IS FALSE AND IS NOT CARRIED FORWARD. Until #3257 this
    // block asserted "the key's WIDTH is its entire cost to the epic labels; its
    // HEIGHT is free", and the mechanism was displacement: a chip that met the
    // key slid sideways, so a taller key only changed WHICH chips moved. Under
    // clip-or-drop a taller key exposes more band rows to it, and those chips
    // have nowhere to go.
    //
    // RE-MEASURED AGAIN once req #3255 moved the key to BOTTOM-CENTER — which
    // changed both the magnitude and WHICH AXIS IS STEEPER, so the top-right
    // numbers could not simply be carried over.
    //
    // MEASURED 2026-08-02 on the Substrate fixture (1500×900 panel), over
    // k ∈ {0.2, 0.35, 0.5, 0.8, 1.2, 1.5, 2} × y ∈ {0, −150, −500, −900} ×
    // x ∈ 0…1400 step 50 — 1566 chips drawn with no key at all:
    //
    //   at w=470:   h  30    60   100   140   180
    //               dropped  11    22    44    55    77
    //
    //   at h=30:    w  90   300   420   470   600   900  1100
    //               dropped   3     7    10    11    13    19    23
    //
    // TWO FINDINGS, both of which contradict the pre-#3255 shape of this block:
    //
    //  1. THE MOVE MADE THE KEY ~17× CHEAPER (187 → 11 dropped at 470×30). A
    //     name is pinned to its band's LEFT edge, and the bottom-center key no
    //     longer sits where those names land.
    //  2. HEIGHT IS NOW THE STEEPER AXIS, the reverse of the top-right era: the
    //     range costs 66 names in height against 20 in width. A bottom-anchored
    //     box grows UPWARD into more band rows, while its width only ever spans
    //     the middle of the panel where few chip x-positions fall.
    //
    // `PLAN_KEY_MAX_W` therefore now caps the CHEAPER dimension. That is not a
    // bug introduced here — the cap predates the move and the key is far cheaper
    // overall — but it does mean the cap is no longer the defence it was named
    // for, and the honest guard for a bottom-center key would be on HEIGHT.
    // Recorded rather than silently re-asserted; changing the cap belongs to
    // req #3255's own surface, not to this one.
    const costOf = (w, h) => {
        let dropped = 0;
        for (const k of [0.2, 0.35, 0.5, 0.8, 1.2, 1.5, 2]) {
            for (const y of [0, -150, -500, -900]) {
                for (let x = 0; x <= 1400; x += 50) {
                    const args = { bands: layout.bands, transform: { x, y, k },
                        viewport: VIEWPORT, worldWidth: layout.width };
                    const bare = placeEpicChips(args);
                    const withKey = placeEpicChips({ ...args,
                        keepOut: { x: (VIEWPORT.w - w) / 2,
                            y: VIEWPORT.h - 12 - h, w, h } });
                    dropped += bare.filter(
                        (c) => !withKey.some((d) => d.key === c.key)).length;
                }
            }
        }
        return dropped;
    };

    it('costs epic names in BOTH dimensions, monotonically — the pre-#3257 '
        + '"height is free" invariant no longer holds', () => {
        const byHeight = [30, 60, 100, 140, 180].map((h) => costOf(PLAN_KEY_MAX_W, h));
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

        const WIDTHS = [90, 300, 420, PLAN_KEY_MAX_W, 600, 900, 1100];
        const byWidth = WIDTHS.map((w) => costOf(w, 30));
        for (let i = 1; i < byWidth.length; i++) {
            expect(byWidth[i], `width ${WIDTHS[i]} vs ${WIDTHS[i - 1]}`)
                .toBeGreaterThanOrEqual(byWidth[i - 1]);
        }
        // The curve is a real curve and not a constant: the widest key costs
        // an order of magnitude more names than the collapsed one.
        expect(byWidth[byWidth.length - 1],
            'a 1100px key vs a collapsed one').toBeGreaterThan(5 * byWidth[0]);
    });

    it('HEIGHT is the steeper axis now that the key sits bottom-center — so '
        + 'PLAN_KEY_MAX_W caps the cheaper dimension', () => {
        const base = costOf(PLAN_KEY_MAX_W, 30);
        const tallCost = costOf(PLAN_KEY_MAX_W, 180) - base;
        const wideCost = costOf(900, 30) - base;
        expect(tallCost, 'growing the key to its worst-case height').toBeGreaterThan(0);
        expect(wideCost, 'a 900px key must still cost names').toBeGreaterThan(0);
        // THE INVERSION, pinned so it cannot revert silently. Under the
        // top-right key width was steeper (155 vs 69); bottom-center reverses it
        // (66 vs 20). If a future move puts width back on top, this fails and
        // the comment above gets re-measured rather than quietly rotting.
        expect(tallCost, 'height must cost more than width for a BOTTOM-anchored '
            + 'key — if this fails, the key moved again and the table above is stale')
            .toBeGreaterThan(wideCost);
    });

    it('the bottom-center move made the key far cheaper than the top-right one', () => {
        // The #3255 move is worth a number, not just a note: at the cap, a
        // top-right key dropped 187 names over this sweep and a bottom-center
        // one drops 11. Asserted as an order of magnitude so it tracks the
        // finding rather than a specific fixture count.
        const topRight = (() => {
            let dropped = 0;
            for (const k of [0.2, 0.35, 0.5, 0.8, 1.2, 1.5, 2]) {
                for (const y of [0, -150, -500, -900]) {
                    for (let x = 0; x <= 1400; x += 50) {
                        const args = { bands: layout.bands, transform: { x, y, k },
                            viewport: VIEWPORT, worldWidth: layout.width };
                        const bare = placeEpicChips(args);
                        const withKey = placeEpicChips({ ...args,
                            keepOut: { x: VIEWPORT.w - 10 - PLAN_KEY_MAX_W, y: 8,
                                w: PLAN_KEY_MAX_W, h: 30 } });
                        dropped += bare.filter(
                            (c) => !withKey.some((d) => d.key === c.key)).length;
                    }
                }
            }
            return dropped;
        })();
        expect(topRight, 'the old top-right key cost real names').toBeGreaterThan(100);
        expect(costOf(PLAN_KEY_MAX_W, 30) * 5,
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
    const layout = computePlanLayout(plan.rows, plan.batches,
        { reqTitles: FIXTURE_TITLES, ...opts });
    const pick = (kind) => layout.labels.filter((l) => l.kind === kind)
        .map((l) => l.text.length);
    return { layout, step: pick('step'), req: pick('req') };
};

describe('the 35-character ceiling (req #3168, directive B)', () => {
    it('never draws a step label longer than the ceiling, in any combination', () => {
        for (const view of Object.keys(REQ_VIEWS)) {
            for (const stepWidth of Object.keys(STEP_WIDTH_FACTORS)) {
                const { step } = drawn({ ...reqViewOptions(view),
                    stepLabel: 'title', stepWidth });
                expect(Math.max(...step), `${view} x ${stepWidth}`)
                    .toBeLessThanOrEqual(LABEL_MAX_CHARS);
            }
        }
    });

    // THE TABLE THE USER GETS TO PICK FROM. Pinned as exact numbers because the
    // whole point of the directive was that the number is a measured fact rather
    // than a promise — if a future edit moves any of these, the user is being
    // given a different deal and should be told.
    it('draws the MEASURED number of characters per mode and width', () => {
        const at = (view, stepWidth) => {
            const { step } = drawn({ ...reqViewOptions(view),
                stepLabel: 'title', stepWidth });
            return Math.max(...step);
        };
        // `horizontal` columns are sized by the requirement-id STRING, which is
        // wide enough that the ceiling is what binds — it drew 42 / 45 / 50
        // before the cap (35, then 40 after the req #3242 bump).
        expect([at('horizontal', 'compact'), at('horizontal', 'medium'),
            at('horizontal', 'wide')]).toEqual([40, 40, 40]);
        // `vertical` columns are TITLE_COL_MIN, so the stagger budget binds and
        // the ceiling is inert below Width L. These are the numbers the geometry
        // gives after the 2026-08-01 width retune (+10% / +10% / +20%). Width L
        // was ALSO ceiling-bound at the old 35 (its true budget is 36) — raising
        // the ceiling to 40 (req #3242) let that one extra character through.
        expect([at('vertical', 'compact'), at('vertical', 'medium'),
            at('vertical', 'wide')]).toEqual([27, 29, 36]);
        // Showing requirement TITLES costs the step label nothing.
        expect([at('titles', 'compact'), at('titles', 'medium'),
            at('titles', 'wide')]).toEqual([27, 29, 36]);
    });

    it('the ceiling did not move a single column', () => {
        // The claim the user actually made ("I do not want any other spacing to
        // have to change"): capping the TEXT must not touch the geometry. A
        // layout with no title labels at all shares its columns with one that
        // has them, at every width.
        for (const stepWidth of Object.keys(STEP_WIDTH_FACTORS)) {
            const ids = computePlanLayout(plan.rows, plan.batches,
                { reqLayout: 'vertical', stepLabel: 'id', stepWidth });
            const titled = computePlanLayout(plan.rows, plan.batches,
                { reqLayout: 'vertical', stepLabel: 'id', stepWidth,
                    reqTitles: FIXTURE_TITLES });
            expect(titled.colW).toEqual(ids.colW);
            expect(titled.width).toBe(ids.width);
            expect(titled.height).toBe(ids.height);
        }
    });
});

describe('requirement marks: id or TITLE (req #3168, directive E)', () => {
    it('SHOWING TITLES COSTS EXACTLY ONE LINE PER LANE, AND NO WIDTH', () => {
        // The frozen-geometry directive stands on the HORIZONTAL axis: a title
        // may never widen a column or the world, because that was the user's
        // explicit refusal. The swim-lane directive that followed asks for
        // vertical separation, and that is not free — an odd column's marks drop
        // one line, so each lane must own that line.
        //
        // Pinned as an EXACT identity rather than a bound: one REQ_LINE_H per
        // lane in the plan, no more, and it must be the ONLY thing that moved.
        for (const stepLabel of ['id', 'title']) {
            for (const stepWidth of Object.keys(STEP_WIDTH_FACTORS)) {
                const base = computePlanLayout(plan.rows, plan.batches,
                    { ...reqViewOptions('vertical'), stepLabel, stepWidth,
                        reqTitles: FIXTURE_TITLES });
                const titled = computePlanLayout(plan.rows, plan.batches,
                    { ...reqViewOptions('titles'), stepLabel, stepWidth,
                        reqTitles: FIXTURE_TITLES });
                const where = `${stepLabel} x ${stepWidth}`;
                // Horizontal: untouched, to the pixel.
                expect(titled.colW, where).toEqual(base.colW);
                expect(titled.width, where).toBe(base.width);
                expect([...titled.nodes.values()].map((n) => n.x), where)
                    .toEqual([...base.nodes.values()].map((n) => n.x));
                // Vertical: one line per lane, and nothing else.
                const lanes = base.bands.reduce((sum, b) => sum + b.sub, 0);
                expect(titled.height - base.height, where).toBe(lanes * REQ_LINE_H);
                expect(titled.bands.map((b) => b.sub), where)
                    .toEqual(base.bands.map((b) => b.sub));
            }
        }
    });

    // The number the user has to live with, measured rather than hoped for.
    it('draws the MEASURED title length the frozen column affords', () => {
        const at = (stepLabel, stepWidth) => {
            const { req } = drawn({ ...reqViewOptions('titles'), stepLabel, stepWidth });
            return [Math.min(...req), Math.max(...req)];
        };
        // The swim-lane directive (2026-08-01) moved these numbers UP without
        // widening a single column: a lone title inside a run of 1-req steps
        // draws on its own line and may reach into its neighbours, so the MAX
        // rises while the MIN — a mark in a stack, still column-bound — does not.
        //
        // With `Step: Title` the column already carries TITLE_COL_MIN (144·f),
        // and the run-widened marks reach the ceiling at Width L — 35 chars,
        // now 40 after the req #3242 bump (the id prefix `reqLabelText` adds
        // eats into the same ceiling, which is why it moved). Measured: 21 of
        // 55 marks qualify on this fixture.
        expect([at('title', 'compact'), at('title', 'medium'), at('title', 'wide')])
            .toEqual([[18, 33], [19, 35], [23, 40]]);
        // With `Step: ID` the column is only as wide as the ids need, so both
        // ends are lower. This is why the pair of controls interacts.
        expect([at('id', 'compact'), at('id', 'medium'), at('id', 'wide')])
            .toEqual([[8, 20], [9, 22], [11, 26]]);
    });

    it('keeps every requirement mark inside its column slab — the frozen contract', () => {
        // Every position the CONTROL offers, PLUS the one it withholds. The
        // withheld combination is in this loop deliberately: the module's claim
        // is that it renders `horizontal` + titles correctly rather than
        // trusting callers not to ask, and an unasserted branch is where that
        // claim went wrong once already — the per-mark budget divided the column
        // by N and forgot the (N−1) mono separators `texts.join(' ')` draws, so
        // a 3-requirement step's marks sat 14.4px outside their own slab while
        // every individual truncation looked right.
        const combos = [...Object.keys(REQ_VIEWS).map((v) => reqViewOptions(v)),
            { reqLayout: 'horizontal', reqLabel: 'title' }];
        for (const view of combos) {
            for (const stepLabel of ['id', 'title']) {
                for (const stepWidth of Object.keys(STEP_WIDTH_FACTORS)) {
                    const layout = computePlanLayout(plan.rows, plan.batches, {
                        ...view, stepLabel, stepWidth,
                        reqTitles: FIXTURE_TITLES,
                    });
                    // Since the swim-lane directive (2026-08-01) containment is
                    // KIND-DEPENDENT here, exactly as it already was for step
                    // labels. A lone requirement title inside a run of 1-req
                    // steps is STAGGERED — its column's neighbours draw on the
                    // other line — so it may reach a bounded distance into them.
                    // Its guarantee is not "inside the slab" but "no further than
                    // STAGGER_REACH of one neighbour", and the pairwise property
                    // that follows from it is asserted by the zero-overlap test
                    // below. Everything else is still slab-contained.
                    const marksOf = new Map();
                    for (const l of layout.labels) {
                        if (l.kind === 'req') marksOf.set(l.stepId, (marksOf.get(l.stepId) || 0) + 1);
                    }
                    for (const label of layout.labels) {
                        if (label.kind !== 'req') continue;
                        const n = layout.nodes.get(label.stepId);
                        const half = layout.colW[n.depth] / 2;
                        const staggered = view.reqLabel === 'title'
                            && view.reqLayout !== 'horizontal'
                            && marksOf.get(label.stepId) === 1;
                        // The reach a staggered mark is allowed, per side: the
                        // same STAGGER_REACH 0.4 of the NARROWER neighbour that
                        // bounds a staggered step label.
                        const reach = staggered
                            ? 0.4 * Math.min(
                                n.depth > 0 ? layout.colW[n.depth - 1] : 66,
                                n.depth < layout.colW.length - 1
                                    ? layout.colW[n.depth + 1] : 54)
                            : 0;
                        const left = layout.colX[n.depth] - half - reach;
                        const right = layout.colX[n.depth] + half + reach;
                        const where = `${view.reqLayout}+${view.reqLabel}`
                            + `/${stepLabel}/${stepWidth} step ${label.stepId}`;
                        expect(label.x, where).toBeGreaterThanOrEqual(left - 0.01);
                        expect(label.x + label.w, where).toBeLessThanOrEqual(right + 0.01);
                    }
                }
            }
        }
    });

    it('holds zero label overlap and no label-on-bead with titles showing', () => {
        for (const stepLabel of ['id', 'title']) {
            for (const stepWidth of Object.keys(STEP_WIDTH_FACTORS)) {
                const name = `titles x ${stepLabel} x ${stepWidth}`;
                const layout = computePlanLayout(plan.rows, plan.batches, {
                    ...reqViewOptions('titles'), stepLabel, stepWidth,
                    reqTitles: FIXTURE_TITLES,
                });
                assertNoLabelOverlap(layout, name);
                const beads = [...layout.nodes.values()].map(beadRect);
                for (const label of layout.labels) {
                    for (const bead of beads) {
                        expect(rectsOverlap(label, bead), name).toBe(false);
                    }
                }
                assertStraightArcsClear(layout, plan.rows);
            }
        }
    });

    // req #3242 — zero overlap is not the same claim as legible. Reported
    // against the LIVE plan (req #3242 user screenshot): step 1 "Session
    // Drain" (5 requirements) chains into step 3 (1 requirement, staggers)
    // chains into step 4 (1 requirement, also staggers) — this fixture's own
    // steps 1/3/4, the historical Substrate rows this exact live chain grew
    // out of. Both single-req steps are adjacent-column stagger candidates,
    // and with REAL (non-uniform) title lengths — FIXTURE_TITLES's shared
    // LONG_TITLE always hits the truncation ceiling and can never expose this
    // — they landed on lines 1px apart while overlapping ~60px horizontally:
    // inside the zero-overlap contract, unreadable regardless. The fix
    // (REQ_LINE_H +25%, generic — not special-cased to this pair) is measured
    // here against the real title strings, not asserted from the previous
    // finding's own numbers.
    it('leaves real breathing room between adjacent staggered marks, not just zero overlap', () => {
        const REAL_TITLES = new Map([
            [3050, 'darwin-mcp rearchitecture: Lambda-Rest as single DB gateway (clean-sheet REST transport)'],
            [3056, 'Views show autonomy'],
            [3063, 'Instruction Edit In Place'],
            [3064, 'Aggregator Card Polish'],
            [3068, 'Instructions need proper English titles, not kebab-case slugs'],
            [3072, 'Swarm substrate Phase 0+1 — eliminate shared-clone git corruption class (de-symlink, Primary-only sync, remove worker-to-Primary writes, full git audit)'],
            [3041, 'Make the DarwinAI-Config base clone handled commonly with all sub-repos: hygiene preconditions must be ff-only SYNC, never SAVE. No operation may commit/push the live base clone except the primary\'s own /save-primary-claude.'],
        ]);
        const gapBetween = (a, b) => {
            const dx = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
            const dy = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
            return Math.max(dx, dy);
        };
        for (const stepWidth of Object.keys(STEP_WIDTH_FACTORS)) {
            const layout = computePlanLayout(plan.rows, plan.batches, {
                ...reqViewOptions('titles'), stepLabel: 'title', stepWidth,
                reqTitles: REAL_TITLES,
            });
            const chainLabels = layout.labels.filter(
                (l) => l.kind === 'req' && [1, 3, 4].includes(l.stepId));
            let minGap = Infinity;
            for (let i = 0; i < chainLabels.length; i++) {
                for (let j = i + 1; j < chainLabels.length; j++) {
                    if (chainLabels[i].stepId === chainLabels[j].stepId) continue;
                    minGap = Math.min(minGap, gapBetween(chainLabels[i], chainLabels[j]));
                }
            }
            // MEASURED after the req #3242 REQ_LINE_H bump: 4.8px at every
            // width (the tightest pair is always step 3 vs step 4, whose
            // stagger offset is a fixed REQ_LINE_H-derived constant,
            // independent of column width). Was 1.0px before the bump — this
            // is the regression guard: a future change that quietly narrows
            // the stagger offset again fails here rather than shipping.
            expect(minGap, `stepWidth=${stepWidth}`).toBeCloseTo(4.8, 1);
            expect(minGap, `stepWidth=${stepWidth} — must never regress to the old 1px`)
                .toBeGreaterThan(3);
        }
    });

    it('falls back to the ID when a title is missing, blank or unresolvable', () => {
        expect(reqLabelText(3001, { reqLabel: 'id', reqTitles: FIXTURE_TITLES }))
            .toBe('3001');
        expect(reqLabelText(3001, { reqLabel: 'title' })).toBe('3001');
        expect(reqLabelText(3001, { reqLabel: 'title', reqTitles: new Map() }))
            .toBe('3001');
        expect(reqLabelText(3001, { reqLabel: 'title', reqTitles: { 3001: '' } }))
            .toBe('3001');
        // A blank mark under a bead reads as a rendering fault; the id is always
        // true, so it is the honest fallback.
        expect(reqLabelText(3001, { reqLabel: 'title', reqTitles: { 3001: 'Bounded reads' } }))
            .toBe('3001 - Bounded reads');
        // Plain-object lookups go through Object.hasOwn — an inherited key must
        // not resolve to a function whose source would be drawn on the canvas.
        expect(reqLabelText('constructor', { reqLabel: 'title', reqTitles: {} }))
            .toBe('constructor');
        expect(reqLabelText(1, { reqLabel: 'title', reqTitles: { 1: LONG_TITLE },
            maxChars: 10 })).toHaveLength(10);
        // Never past the ceiling, whatever room the caller claims to have.
        expect(reqLabelText(1, { reqLabel: 'title', reqTitles: { 1: LONG_TITLE },
            maxChars: 500 })).toHaveLength(LABEL_MAX_CHARS);
    });

    it('flags stored PROSE so the no-# audit keys on what a label IS', () => {
        // PIPE-07 excludes stored plan content from its generated-label sweep. It
        // used to infer that from `kind === 'title'`; a requirement mark that can
        // be EITHER a generated id or a stored name breaks that inference, so the
        // module states it.
        const ids = computePlanLayout(plan.rows, plan.batches,
            { ...reqViewOptions('vertical'), stepLabel: 'id', reqTitles: FIXTURE_TITLES });
        for (const l of ids.labels.filter((x) => x.kind === 'req')) {
            expect(l.prose).toBe(false);
        }
        const titled = computePlanLayout(plan.rows, plan.batches,
            { ...reqViewOptions('titles'), stepLabel: 'title',
                reqTitles: FIXTURE_TITLES });
        for (const l of titled.labels.filter((x) => x.kind === 'req')) {
            expect(l.prose).toBe(true);
        }
        // The step label is prose only when it IS the stored title.
        expect(titled.labels.filter((l) => l.kind === 'step').every((l) => l.prose))
            .toBe(true);
        expect(ids.labels.filter((l) => l.kind === 'step').every((l) => l.prose))
            .toBe(false);
        // Every generated mark stays generated.
        for (const l of titled.labels) {
            if (l.kind === 'batch' || l.kind === 'epic') expect(l.prose).toBeFalsy();
        }
    });
});

describe('the requirement-view control (req #3168, directive E)', () => {
    it('offers exactly three positions, and titles only in the vertical stack', () => {
        expect(Object.keys(REQ_VIEWS)).toEqual(['horizontal', 'vertical', 'titles']);
        expect(reqViewOptions('horizontal')).toMatchObject(
            { reqLayout: 'horizontal', reqLabel: 'id' });
        expect(reqViewOptions('vertical')).toMatchObject(
            { reqLayout: 'vertical', reqLabel: 'id' });
        // THE CONSTRAINT, not an accident: in `horizontal` N requirements share
        // one line inside one frozen column, so a title would be a stub.
        expect(reqViewOptions('titles')).toMatchObject(
            { reqLayout: 'vertical', reqLabel: 'title' });
        expect(Object.values(REQ_VIEWS).some(
            (v) => v.reqLayout === 'horizontal' && v.reqLabel === 'title')).toBe(false);
    });

    it('measures the stub that justifies that constraint', () => {
        // Not asserted from the rule — MEASURED from the layout, so the
        // constraint is evidence rather than an opinion.
        const layout = computePlanLayout(plan.rows, plan.batches, {
            reqLayout: 'horizontal', reqLabel: 'title', stepLabel: 'title',
            reqTitles: FIXTURE_TITLES,
        });
        const byStep = new Map();
        for (const l of layout.labels.filter((x) => x.kind === 'req')) {
            if (!byStep.has(l.stepId)) byStep.set(l.stepId, []);
            byStep.get(l.stepId).push(l.text.length);
        }
        const multi = [...byStep.values()].filter((v) => v.length > 1);
        expect(multi.length, 'the fixture has multi-requirement steps').toBeGreaterThan(0);
        const worst = Math.min(...multi.map((v) => Math.min(...v)));
        expect(worst, 'a title in horizontal mode collapses to a stub')
            .toBeLessThanOrEqual(8);
        // MEASURED at width S, by requirement count: 2 → 7 characters, 3+ → 4,
        // which is `reqLabelText`'s own floor (three characters and an ellipsis)
        // and the same length as the bare id it replaced. Pinned so the evidence
        // behind the constraint is a number the suite defends, not a sentence.
        const byN = new Map();
        for (const v of byStep.values()) {
            byN.set(v.length, Math.min(byN.get(v.length) ?? Infinity, ...v));
        }
        // The 2026-08-01 width retune (+10%/+10%/+20%) lifted these by a
        // character or two; the POINT is unchanged and is what the numbers still
        // show — a 3-or-more-requirement step gets a 4-to-5 character stub, i.e.
        // no more than the bare id it would replace.
        expect(byN.get(2), 'a 2-requirement step').toBe(8);
        for (const n of [...byN.keys()].filter((k) => k >= 3)) {
            expect(byN.get(n), `a ${n}-requirement step`).toBeLessThanOrEqual(5);
        }
    });

    it('normalizes a legacy or hostile stored preference', () => {
        expect(DEFAULT_REQ_VIEW).toBe('vertical');
        // The two values a browser may already hold must mean themselves.
        expect(normalizeReqView('horizontal')).toBe('horizontal');
        expect(normalizeReqView('vertical')).toBe('vertical');
        expect(normalizeReqView('titles')).toBe('titles');
        for (const bogus of ['constructor', 'toString', '__proto__', 'valueOf',
            'TITLES', '', null, undefined, 0, {}]) {
            expect(isReqView(bogus), `isReqView(${String(bogus)})`).toBe(false);
            expect(normalizeReqView(bogus)).toBe(DEFAULT_REQ_VIEW);
        }
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
const timedLayout = computePlanLayout(timedPlan.rows, timedPlan.batches,
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
    const layout = computePlanLayout(plan.rows, plan.batches,
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
            top: FOCUS_PAD + (n.above ? FOCUS_LABEL_H + RULER_H * tr.k : 0),
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
        const lay = computePlanLayout(plan.rows, plan.batches, combo);

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
        const size = { w: 1600, h: 150 };
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
        expect(bandFitRect(computePlanLayout([], []), band)).toBeNull();
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
                nodes.set(id, { depth: d, x: colX[d], y: y + h / 2 });
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
    it('reserves enough for a FULL-SIZE neighbour chip, margins included', () => {
        const lay = synth([130, 1276, 400], 12);
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
        const layout = computePlanLayout(plan.rows, plan.batches,
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
            const padTop = FOCUS_PAD + (nb.above ? FOCUS_LABEL_H + RULER_H * tr.k : 0);
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
        const layout = computePlanLayout(plan.rows, plan.batches,
            { reqLayout: 'vertical', stepLabel: 'title' });
        const size = { w: 1400, h: 800 };
        const kBase = size.w / layout.width;
        for (const id of layout.nodes.keys()) {
            sameTransform(stepFocusTransform(layout, id, size, kBase, kBase * FOCUS_MIN_RATIO),
                unreservedTransform(stepFitRect(layout, id), size, kBase), `step ${id}`);
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
    const layout = computePlanLayout(plan.rows, plan.batches,
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
        expect(stepTr.k / kBase).toBeCloseTo(FOCUS_MAX_RATIO, 9);
    });

    it('centres the step and leaves at least FOCUS_PAD on all four sides', () => {
        const size = { w: 1200, h: 700 };
        const kBase = size.w / layout.width;
        for (const id of stepIds) {
            const r = stepFitRect(layout, id);
            const tr = stepFocusTransform(layout, id, size, kBase, kBase * FOCUS_MIN_RATIO);
            const left = tr.x + r.x * tr.k;
            const top = tr.y + r.y * tr.k;
            const right = tr.x + (r.x + r.w) * tr.k;
            const bottom = tr.y + (r.y + r.h) * tr.k;
            expect(left + right).toBeCloseTo(size.w, 6);
            expect(top + bottom).toBeCloseTo(size.h, 6);
            expect(left, `step ${id} left`).toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
            expect(top, `step ${id} top`).toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
            expect(size.w - right, `step ${id} right`).toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
            expect(size.h - bottom, `step ${id} bottom`).toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
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
        // One clamp, or the two desync from `scaleExtent` independently. A step
        // rect is always tighter than the ceiling on this fixture, so every step
        // lands exactly on it — which is only true if both read FOCUS_MAX_RATIO.
        const size = { w: 1200, h: 700 };
        const kBase = size.w / layout.width;
        for (const id of stepIds) {
            expect(stepFocusTransform(layout, id, size, kBase, kBase * FOCUS_MIN_RATIO).k / kBase)
                .toBeCloseTo(FOCUS_MAX_RATIO, 9);
        }
    });

    it('returns null rather than NaN geometry on degenerate input', () => {
        const id = stepIds[0];
        const kBase = 0.5;
        expect(stepFitRect(layout, 999999)).toBeNull();
        expect(stepFitRect(layout, null)).toBeNull();
        expect(stepFitRect(layout, undefined)).toBeNull();
        expect(stepFitRect(computePlanLayout([], []), id)).toBeNull();
        expect(stepFitRect(null, id)).toBeNull();
        expect(stepFocusTransform(layout, 999999, { w: 800, h: 600 }, kBase, kBase * FOCUS_MIN_RATIO)).toBeNull();
        expect(stepFocusTransform(layout, id, { w: 0, h: 0 }, kBase, kBase * FOCUS_MIN_RATIO)).toBeNull();
        expect(stepFocusTransform(layout, id, undefined, kBase, kBase * FOCUS_MIN_RATIO)).toBeNull();
        expect(stepFocusTransform(layout, id, { w: 800, h: 600 }, 0, 0.1)).toBeNull();
    });
});

describe('reset = factory default scale (req #3216 D1)', () => {
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
            layout: computePlanLayout(p.rows, p.batches, { timeAxis: p.timeAxis }),
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
        const layout = computePlanLayout(timedSubstratePlan.rows,
            timedSubstratePlan.batches, { timeAxis: timedSubstratePlan.timeAxis });
        expect(layout.empty).toBe(false);
        expect(layout.slots.length).toBeGreaterThan(2);
        expect(layout.bands.length).toBeGreaterThan(1);
        expect(layout.labels.filter((l) => l.kind === 'slot').length)
            .toBeGreaterThan(1);
    });

    for (const combo of COMBOS) {
        const name = `${combo.reqLayout}/${combo.stepLabel}`;
        const layout = computePlanLayout(timedSubstratePlan.rows, timedSubstratePlan.batches,
            { ...combo, timeAxis: timedSubstratePlan.timeAxis });

        it(`no two labels intersect (${name})`, () => {
            assertNoLabelOverlap(layout, name);
        });

        it(`no label intersects any bead (${name})`, () => {
            for (const label of layout.labels) {
                for (const n of layout.nodes.values()) {
                    if (rectsOverlap(label, beadRect(n))) {
                        throw new Error(`label ${JSON.stringify(label)} overlaps bead ${n.id}`);
                    }
                }
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
        const L = computePlanLayout(p.rows, p.batches, { timeAxis: p.timeAxis });
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
        const L = computePlanLayout(p.rows, p.batches, { timeAxis: p.timeAxis });
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
            const layout = computePlanLayout(timedPlan.rows, timedPlan.batches,
                { ...opts, timeAxis: timedPlan.timeAxis });
            assertNoLabelOverlap(layout, `${opts.reqLayout} × ${opts.stepLabel} + ruler`);
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
            heights.add(computePlanLayout(timedPlan.rows, timedPlan.batches,
                { ...opts, timeAxis: timedPlan.timeAxis }).ruler.h);
            heights.add(computePlanLayout(plan.rows, plan.batches, opts).ruler.h);
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
        const untimed = computePlanLayout(plan.rows, plan.batches);
        expect(untimed.ruler.slots).toHaveLength(1);
        expect(untimed.ruler.slots[0].kind).toBe('unknown');
        expect(untimed.ruler.slots[0].label).toBe('undated');
        expect(untimed.ruler.slots[0].showLabel).toBe(true);
        expect(untimed.ruler.futureX).toBeNull();
        assertNoLabelOverlap(untimed, 'untimed plan with ruler');
    });

    it('returns an INERT ruler for the empty plan rather than omitting it', () => {
        const empty = computePlanLayout([], []);
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

    it('covers the live epic count with no positional wraparound collision', () => {
        // MEASURED 2026-08-01: pipeline 2 ("Darwin", the live plan) carries 7
        // active epics. The palette must be at least that long, or the
        // positional cycle (see below) hands two on-screen bands the same
        // colour — the exact regression this requirement was filed over (six
        // entries against seven epics, two sharing a hue).
        expect(EPIC_PALETTE.length).toBeGreaterThanOrEqual(7);
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
        const layout = computePlanLayout(rows, []);
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
// rows), the timed Substrate, the cross-epic plan — satisfies it. The shape that
// breaks it is a plan with SEVERAL launch batches whose mates sit at DIFFERENT
// dependency depths, which is a graph nobody hand-writes and which req #3188
// made reachable when it regrouped batches on the REMAINING gate instead of a
// shared dep set.
//
// So the corpus, not another fixture: 150 deterministic plans (see
// `timedFuzzPlans.js` for the generator's shape argument), each laid out WITH
// and WITHOUT a time axis. Deterministic means a failure names a seed and that
// seed is a permanent repro — `makeTimedPlan(<seed>)` is the whole reproducer.
//
// The BEFORE measurement, kept because it is what the corpus is sized for: the
// shipped 400 plans collide on seeds 89, 303 and 358 against the pre-fix module.
// The original 150-plan cut collided on seed 115 at `(0, 2, 3)` between steps 13
// and 11 — batch A's run allocated at column 0 and consumed at column 2, batch
// B's run allocated in between — WITH and WITHOUT the axis (columns 5 and 2),
// which is how the "the time axis causes it" reading was refuted.
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

    it('the corpus is non-vacuous, and carries the hazard shape', () => {
        // The precondition guard req #3207 added, for exactly the reason it
        // added it: 16 plan-scale tests once asserted over an empty array in
        // total silence, and shipped that way. A fuzz corpus is MORE exposed to
        // that, not less — a generator that quietly stopped producing batches
        // would leave three green tests asserting nothing about the defect they
        // were written for. So the shape is asserted, not just the row count:
        // the MULTI-COLUMN BATCH is the thing the fix is about.
        let rows = 0;
        let batches = 0;
        let multiColumnBatches = 0;
        let hazardPlans = 0;
        let dated = 0;
        for (const { reads } of corpus) {
            const plan = orderedPlan(buildPipelineModel(reads), { now: FUZZ_NOW });
            const layout = computePlanLayout(plan.rows, plan.batches,
                { timeAxis: plan.timeAxis });
            rows += plan.rows.length;
            batches += plan.batches.length;
            let wide = 0;
            for (const b of plan.batches) {
                const cells = new Set(b.stepIds
                    .map((id) => layout.nodes.get(id)).filter(Boolean)
                    .map((n) => `${n.bandIndex}|${n.depth}`));
                if (cells.size >= 2) wide += 1;
            }
            multiColumnBatches += wide;
            // A multi-column batch sharing its plan with another batch — the
            // precise shape that produced the collision.
            if (wide >= 1 && plan.batches.length >= 2) hazardPlans += 1;
            dated += [...plan.timeAxis.stepStarts.values()]
                .filter((s) => s && s.kind === 'dated').length;
        }
        expect(corpus).toHaveLength(400);
        expect(rows).toBeGreaterThan(5000);
        expect(batches).toBeGreaterThan(200);
        expect(multiColumnBatches).toBeGreaterThan(100);
        expect(hazardPlans).toBeGreaterThan(20);
        expect(dated).toBeGreaterThan(2000);
    });

    it('never stacks two beads on one (band, column, lane) cell — with a time axis', () => {
        const failures = [];
        for (const { seed, reads } of corpus) {
            const plan = orderedPlan(buildPipelineModel(reads), { now: FUZZ_NOW });
            const layout = computePlanLayout(plan.rows, plan.batches,
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
            const layout = computePlanLayout(plan.rows, plan.batches);
            expect(layout.nodes.size).toBe(plan.rows.length);
            for (const c of cellCollisions(layout)) failures.push(`seed ${seed} — ${c}`);
        }
        expect(failures).toEqual([]);
    });

    // The user-visible consequence of a shared cell, asserted independently of
    // the cell arithmetic: two coincident beads and two labels drawn on top of
    // each other. Run over all four view combinations, because label geometry —
    // unlike lane assignment — depends on both of them.
    describe.each(COMBOS)('$reqLayout reqs × $stepLabel labels', (opts) => {
        it('gives every bead its own position, and draws no label over another', () => {
            for (const { seed, reads } of corpus) {
                const plan = orderedPlan(buildPipelineModel(reads), { now: FUZZ_NOW });
                const layout = computePlanLayout(plan.rows, plan.batches,
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
});

// ── The batch box encloses ONLY its members (req #3229) ─────────────────────
// A companion to the cell invariant above, and the reason it is here rather
// than folded in: the two break through the SAME mechanism (a batch lane run
// allocated in raw values over a lane space that is fractional until the
// ordinal renumber) but they are different promises to the reader. A shared
// cell draws two beads on top of each other; a run that is contiguous when
// allocated and NOT contiguous after renumbering draws a launch-unit box
// around a step that is not in the launch unit.
//
// THE FIVE-STEP CASE IS HAND-BUILT ON PURPOSE. The corpus below is what proved
// the fix, but this shape needs no fuzzing at all — which is exactly why it
// must not be corpus-only. Steps 5 and 6 are batch A and take raw lanes 0 and
// 1; step 7 then finds its dep's lane occupied, mints the midpoint 0.5 through
// dep-adjacent insertion, and `{0, 0.5, 1}` renumbers to `{0, 1, 2}` — leaving
// the non-member ordinally BETWEEN the two mates, inside their box.
describe('launch-batch boxes enclose only their members (req #3229)', () => {
    const mk = (id, depIds) => ({
        id, title: `s${id}`, run: 'auto', state: 'pending', reqIds: [],
        depIds, timeDeps: [], epicId: 1, epic: 'E1',
        epicLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
    });

    const enclosedNonMembers = (layout) => {
        const out = [];
        for (const box of layout.batchBoxes) {
            const members = new Set(box.batchStepIds);
            for (const n of layout.nodes.values()) {
                if (members.has(n.id)) continue;
                if (n.x > box.x && n.x < box.x + box.width
                    && n.y > box.y && n.y < box.y + box.height) {
                    out.push(`batch ${box.letter} encloses step ${n.id}`);
                }
            }
        }
        return out;
    };

    it('keeps an inserted lane out of a batch run — five steps, no fuzzing', () => {
        const rows = [mk(1, []), mk(2, []), mk(5, [1]), mk(6, [2]), mk(7, [1])];
        const layout = computePlanLayout(rows, [{ letter: 'A', stepIds: [5, 6] }]);
        // The precondition: the box has to actually be drawn, or this asserts
        // nothing. Two mates in one column is one segment.
        expect(layout.batchBoxes.length).toBeGreaterThan(0);
        expect(enclosedNonMembers(layout)).toEqual([]);
    });

    // THE OTHER SIDE OF THE SAME DEFECT, and the one the corpus does NOT reach
    // — found in the second code-review round, measured at 7 cases per 40,000
    // layouts with none inside the shipped 400. `runIntervals` stops a later
    // step entering a published run; this is a run being allocated AROUND a
    // bead that is already sitting there. Batch B has a single mate at column
    // 2, so it publishes no interval, and step 6 takes a fractional lane off
    // its dep chain; batch C is then dep-anchored to a fractional `start` and
    // its two lanes straddle it. Checking only `start + k` never looks between
    // them. Ordinals come out `7@l0, 6@l1, 8@l2` — box C around a non-member.
    it('never allocates a run AROUND a bead already inside it', () => {
        const rows = [mk(1, []), mk(2, []), mk(3, []), mk(4, [1]), mk(5, [1]),
            mk(6, [5]), mk(7, [4]), mk(8, [4]), mk(10, [6])];
        const layout = computePlanLayout(rows, [
            { letter: 'B', stepIds: [6, 10] },
            { letter: 'C', stepIds: [7, 8] },
        ]);
        // Precondition: batch C must actually draw a box at step 6's column,
        // or the assertion below is about nothing.
        const n6 = layout.nodes.get(6);
        expect(layout.batchBoxes.some((b) => b.letter === 'C' && b.depth === n6.depth))
            .toBe(true);
        expect(enclosedNonMembers(layout)).toEqual([]);
    });

    describe.each([{ axis: true }, { axis: false }])('over the corpus, axis=$axis',
        ({ axis }) => {
            it('never draws a launch-unit box around a non-member', () => {
                const failures = [];
                let boxes = 0;
                for (const { seed, reads } of timedFuzzCorpus()) {
                    const plan = orderedPlan(buildPipelineModel(reads), { now: FUZZ_NOW });
                    const layout = computePlanLayout(plan.rows, plan.batches,
                        axis ? { timeAxis: plan.timeAxis } : {});
                    boxes += layout.batchBoxes.length;
                    for (const f of enclosedNonMembers(layout)) {
                        failures.push(`seed ${seed} — ${f}`);
                    }
                }
                // Non-vacuity: the corpus must actually DRAW boxes.
                expect(boxes).toBeGreaterThan(200);
                expect(failures).toEqual([]);
            });
        });
});
