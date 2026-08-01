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
import { buildPipelineModel, orderedPlan } from '../pipelineViewModel';
import { semanticLevel } from '../../konvaSwarmModel';
import {
    computePlanLayout, beadStyle, stepLabelText, BEAD_RADIUS,
    PLAN_VIZ_PALETTE, placeEpicChips,
    STEP_WIDTH_FACTORS, isStepWidth, K_READABLE, PLAN_VIZ_FONT, READABLE_MIN_PX,
    NEXT_HALO_RADIUS, NEXT_HALO_STROKE, EPIC_CHIP_CHAR_W,
    EPIC_CHIP_FONT, EPIC_CHIP_H,
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

describe('floating epic chips (req #3168)', () => {
    const layout = computePlanLayout(plan.rows, plan.batches,
        { reqLayout: 'vertical', stepLabel: 'title' });
    const VIEWPORT = { w: 1500, h: 900 };
    const chipsAt = (transform, keepOut = null) => placeEpicChips({
        bands: layout.bands, transform, viewport: VIEWPORT,
        worldWidth: layout.width, keepOut,
    });

    it('draws one chip per band at the default view', () => {
        const chips = chipsAt({ x: 0, y: 0, k: K_READABLE });
        expect(chips.length).toBeGreaterThan(0);
        expect(new Set(chips.map((c) => c.key)).size).toBe(chips.length);
        for (const c of chips) {
            expect(layout.bands.some((b) => b.epic === c.text)).toBe(true);
        }
    });

    // The chip is a fixed SCREEN height clamped into a header reserved in WORLD
    // units, so below some k the header is shorter than the chip and neighbouring
    // bands' chips land on each other.
    //
    // MEASURED, not assumed: the Substrate fixture does NOT reach this. Its four
    // bands are 160–604 world px tall and 294+ apart, and by the k at which that
    // spacing falls under the chip's 24px the chips are already suppressed by the
    // width test (a 3000px world is 150 screen px at k=0.05 and no chip fits).
    // Zero collisions were found under the OLD rule over k ∈ [0.05, 2.5] × four
    // pans, so a fixture-only assertion here would be vacuous.
    //
    // The reachable shape is MANY SHORT bands — a plan of one-lane steps, ~150
    // world px per band — zoomed out. Under the old rule that collides 70 times
    // over k ∈ [0.05, 0.5]; the fixture is asserted alongside it so the ordinary
    // case is covered too.
    // Shaped like a real band since req #3168 gave the epic its own lane:
    // `epicLaneH` is the clear strip the chip is confined to, `headerH` the whole
    // reservation. A synthetic band that omits `epicLaneH` exercises the fallback
    // rather than the shipped geometry.
    const SHORT_BANDS = Array.from({ length: 6 }, (_, i) => ({
        key: i, epicId: i + 1, epic: `Epic number ${i + 1}`, color: '#8ce99a',
        y: 8 + i * 158, height: 150, headerH: 83, epicLaneH: 62,
    }));
    const assertNoChipOverlap = (chips, where) => {
        for (let i = 0; i < chips.length; i++) {
            for (let j = i + 1; j < chips.length; j++) {
                if (rectsOverlap(chips[i], chips[j])) {
                    throw new Error(`epic chips overlap ${where}: `
                        + `${chips[i].text} vs ${chips[j].text}`);
                }
            }
        }
    };

    it('never overlaps another chip on the fixture, at any zoom or pan', () => {
        for (const k of [0.12, 0.2, 0.28, 0.4, 0.55, 0.8, 1, 1.6, 2.4]) {
            for (const y of [0, -200, -900, -2400, 300]) {
                for (const x of [0, -300, -1200, 400]) {
                    assertNoChipOverlap(chipsAt({ x, y, k }), `at k=${k} x=${x} y=${y}`);
                }
            }
        }
    });

    it('never overlaps another chip on SHORT bands zoomed out — the reachable case', () => {
        let drawn = 0;
        for (let k = 0.05; k <= 0.5; k += 0.01) {
            const chips = placeEpicChips({
                bands: SHORT_BANDS, transform: { x: 0, y: 0, k },
                viewport: VIEWPORT, worldWidth: 3000,
            });
            drawn += chips.length;
            assertNoChipOverlap(chips, `on short bands at k=${k.toFixed(2)}`);
        }
        // The sweep has to actually DRAW chips, or it proves nothing: a
        // displacement pass that hid everything would pass the loop above.
        // 255 chips are drawn over the sweep; the floor is set well under that so
        // it fails on a collapse rather than on a nudge.
        expect(drawn).toBeGreaterThan(150);
    });

    // The chip is measured against ONE metric, and the component must not carry
    // its own. It did — a 7.3px/char leftover from the pre-req-#3119 12px chip,
    // against a chip that has rendered at 15px since — which under-measured every
    // name by ~22% and quietly defeated both the keep-out and this file's sweeps,
    // because the tests read the same wrong number (review finding).
    it('measures the chip with the layout module\'s own epic metric', () => {
        expect(EPIC_CHIP_CHAR_W).toBeCloseTo(9.15, 6);   // CHW_EPIC, font 15
        const [chip] = placeEpicChips({
            bands: [{ key: 1, epicId: 1, epic: 'X'.repeat(20), color: '#fff',
                y: 8, height: 400, headerH: 46 }],
            transform: { x: 0, y: 0, k: 1 }, viewport: VIEWPORT, worldWidth: 3000,
        });
        expect(chip.w).toBeCloseTo(20 * EPIC_CHIP_CHAR_W + 18, 6);
    });

    // THE COLLISION THAT IS REAL ON THE FIXTURE. Measured under the old rule:
    // 280 chip-under-legend hits over k ∈ [0.05, 2.5] × four pans × a 420px
    // legend — the band's clamped x lands in the top-right corner whenever the
    // world is narrow on screen or panned right, and the legend drew over the
    // epic name. Unlike the chip-vs-chip case above, this one needs no
    // constructed geometry.
    it('never overlaps the legend it shares the top-right corner with', () => {
        // The legend's real geometry: `top: 8, right: 10` in the panel, with a
        // width that depends on which keys are showing.
        for (const legendW of [220, 420, 700]) {
            const keepOut = { x: VIEWPORT.w - 10 - legendW, y: 8, w: legendW, h: 30 };
            for (const k of [0.07, 0.2, 0.5, 0.8, 1.5]) {
                for (const y of [0, -150, -900]) {
                    // x=1200 is where the old rule was measured colliding most:
                    // a right-panned band's visible sliver starts under the
                    // legend, and the chip clamped into it went with it.
                    for (const x of [0, -400, 600, 1200]) {
                        for (const chip of chipsAt({ x, y, k }, keepOut)) {
                            expect(rectsOverlap(chip, keepOut),
                                `chip "${chip.text}" under the legend `
                                + `at k=${k} x=${x} y=${y}`)
                                .toBe(false);
                        }
                    }
                }
            }
        }
    });

    // THE DIRECTIVE (user, 2026-08-01): "the epic must not overwrite or ride in
    // the same swim lane as the top most steps — give the epic its own swim lane
    // to eliminate collision."
    //
    // The reservation is world geometry and the chip is screen geometry, so this
    // is asserted where the collision actually happens: the layout's own label
    // rects PROJECTED INTO SCREEN SPACE against the placed chips. That is the
    // only frame in which the two are comparable, and asserting it in world units
    // is exactly the mistake that let the old 46px header look sufficient.
    //
    // Measured before the fix, on the fixture at the page's OWN default scale
    // (k=0.8): every band's chip overlapped a lane-0 step label. The header
    // reserved ~25 world px above that label, i.e. 20 screen px, against a 24px
    // chip.
    it('never touches a step, requirement or title label — at any zoom', () => {
        for (const k of [0.2, 0.3, 0.39, 0.5, 0.8, 1, 1.5, 2.5]) {
            for (const y of [0, -120, -600, -1400]) {
                const chips = chipsAt({ x: 0, y, k });
                const content = layout.labels.filter((l) => l.stepId != null);
                for (const chip of chips) {
                    for (const l of content) {
                        const screen = {
                            x: 0 + l.x * k, y: y + l.y * k,
                            w: l.w * k, h: l.h * k,
                        };
                        if (rectsOverlap(chip, screen)) {
                            throw new Error(
                                `epic "${chip.text}" collides with ${l.kind} label of step `
                                + `${l.stepId} at k=${k} y=${y}`);
                        }
                    }
                }
            }
        }
    });

    it('stays inside its own epic lane, scaling down rather than overflowing', () => {
        for (const k of [0.15, 0.25, 0.39, 0.6, 1, 2]) {
            for (const chip of chipsAt({ x: 0, y: 0, k })) {
                const band = layout.bands.find((b) => b.epic === chip.text);
                const laneTop = 0 + band.y * k;
                const laneBottom = 0 + (band.y + band.headerH) * k;
                expect(chip.y, `k=${k} ${chip.text} above its lane`)
                    .toBeGreaterThanOrEqual(Math.min(laneTop, 2) - 0.01);
                expect(chip.y + chip.h, `k=${k} ${chip.text} past its lane`)
                    .toBeLessThanOrEqual(laneBottom + 0.01);
                // Scaled, never clipped: the drawn font matches the measured box.
                expect(chip.fontSize / chip.h)
                    .toBeCloseTo(EPIC_CHIP_FONT / EPIC_CHIP_H, 6);
            }
        }
    });

    it('keeps every chip wholly inside the panel', () => {
        for (const k of [0.15, 0.5, 1, 2]) {
            for (const x of [0, -600, -2000, 500]) {
                for (const chip of chipsAt({ x, y: -400, k })) {
                    expect(chip.x).toBeGreaterThanOrEqual(0);
                    expect(chip.y).toBeGreaterThanOrEqual(0);
                    expect(chip.x + chip.w).toBeLessThanOrEqual(VIEWPORT.w);
                    expect(chip.y + chip.h).toBeLessThanOrEqual(VIEWPORT.h);
                }
            }
        }
    });

    it('renders nothing for a band panned off either axis', () => {
        expect(chipsAt({ x: 0, y: -100000, k: 1 })).toEqual([]);
        expect(chipsAt({ x: 100000, y: 0, k: 1 })).toEqual([]);
    });

    it('is inert on a degenerate transform or an unmeasured panel', () => {
        expect(placeEpicChips({ bands: layout.bands, transform: { x: 0, y: 0, k: 0 },
            viewport: VIEWPORT, worldWidth: layout.width })).toEqual([]);
        expect(placeEpicChips({ bands: layout.bands, transform: { x: 0, y: 0, k: 1 },
            viewport: { w: 0, h: 0 }, worldWidth: layout.width })).toEqual([]);
        expect(placeEpicChips()).toEqual([]);
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

describe('the KEY is a keep-out, and it may not cost the epic labels (req #3168)', () => {
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
        for (const size of KEY_SIZES) {
            const keepOut = { x: VIEWPORT.w - 10 - size.w, y: 8, w: size.w, h: size.h };
            for (const k of [0.07, 0.2, 0.5, 0.8, 1.5]) {
                for (const y of [0, -150, -900]) {
                    for (const x of [0, -400, 600, 1200]) {
                        const chips = placeEpicChips({
                            bands: layout.bands, transform: { x, y, k },
                            viewport: VIEWPORT, worldWidth: layout.width, keepOut,
                        });
                        for (const chip of chips) {
                            expect(rectsOverlap(chip, keepOut),
                                `chip "${chip.text}" under the ${size.label} key `
                                + `at k=${k} x=${x} y=${y}`).toBe(false);
                        }
                    }
                }
            }
        }
    });

    it('DROPS NO CHIP the small key drew — the growth costs the epics nothing', () => {
        // The claim the constraint actually makes: a bigger key steals space
        // from the epic labels. Measured as a DIFFERENCE against the key this
        // replaces (the ~420×30 bead legend), band for band, so a regression is
        // named rather than inferred from a total.
        const OLD = { w: 420, h: 30 };
        let compared = 0;
        for (const size of KEY_SIZES) {
            for (const k of [0.2, 0.5, 0.8, 1.5]) {
                for (const y of [0, -150, -900]) {
                    for (const x of [0, -400, 600]) {
                        const t = { x, y, k };
                        const before = placeEpicChips({
                            bands: layout.bands, transform: t, viewport: VIEWPORT,
                            worldWidth: layout.width,
                            keepOut: { x: VIEWPORT.w - 10 - OLD.w, y: 8, ...OLD },
                        });
                        const after = placeEpicChips({
                            bands: layout.bands, transform: t, viewport: VIEWPORT,
                            worldWidth: layout.width,
                            keepOut: { x: VIEWPORT.w - 10 - size.w, y: 8,
                                w: size.w, h: size.h },
                        });
                        const lost = before.map((c) => c.key)
                            .filter((key) => !after.some((c) => c.key === key));
                        expect(lost,
                            `${size.label} key drops epic chip(s) at k=${k} x=${x} y=${y}`)
                            .toEqual([]);
                        compared += before.length;
                    }
                }
            }
        }
        // The sweep has to have drawn chips, or it proves nothing.
        expect(compared, 'the sweep compared real chips').toBeGreaterThan(100);
    });

    it('the WIDTH cap is what buys that — height is free and width is not', () => {
        // The boundary is asserted from BOTH sides, so the cap is a measured
        // number rather than a comfortable one. MEASURED over
        // k ∈ {0.2…2} × 4 pans × 6 x-offsets, 233 chips: zero lost at width ≤ 420
        // at EVERY height from 30 to 180; one lost at 500, 8-10 at 600, 15-20 at
        // 700. The mechanism is that `placeEpicChips` displaces horizontally
        // only — a chip may never move to another band's line — so a keep-out's
        // height costs nothing and its width costs everything.
        const OLD = { w: 420, h: 30 };
        const sweep = (w, h) => {
            let lost = 0;
            for (const k of [0.2, 0.35, 0.5, 0.8, 1.2, 1.5, 2]) {
                for (const y of [0, -150, -500, -900]) {
                    for (const x of [0, -400, -1000, 300, 600, 740]) {
                        const t = { x, y, k };
                        const args = {
                            bands: layout.bands, transform: t, viewport: VIEWPORT,
                            worldWidth: layout.width,
                        };
                        const before = placeEpicChips({ ...args,
                            keepOut: { x: VIEWPORT.w - 10 - OLD.w, y: 8, ...OLD } });
                        const after = placeEpicChips({ ...args,
                            keepOut: { x: VIEWPORT.w - 10 - w, y: 8, w, h } });
                        lost += before.filter(
                            (c) => !after.some((d) => d.key === c.key)).length;
                    }
                }
            }
            return lost;
        };
        // Height is free at the cap — still true, and it is what lets the key
        // stack one row per channel.
        for (const h of [30, 60, 100, 140, 180]) {
            expect(sweep(PLAN_KEY_MAX_W, h), `height ${h} at the cap`)
                .toBeLessThanOrEqual(sweep(PLAN_KEY_MAX_W, 30));
        }
        // …and the cap is NOT vacuous: a key MUCH wider than it really does drop
        // epic names, which is the finding that put a pixel cap on this element
        // instead of a percentage. (The 2026-08-01 raise from 420 to 470 sits
        // inside a flat stretch of that curve — see PLAN_KEY_MAX_W — so the cap
        // is asserted where it still bites rather than where it no longer does.)
        expect(sweep(900, 30), 'a 900px key must still cost chips')
            .toBeGreaterThan(0);
        expect(sweep(1100, 30)).toBeGreaterThanOrEqual(sweep(900, 30));
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
        // before the cap.
        expect([at('horizontal', 'compact'), at('horizontal', 'medium'),
            at('horizontal', 'wide')]).toEqual([35, 35, 35]);
        // `vertical` columns are TITLE_COL_MIN, so the stagger budget binds and
        // the ceiling is inert below Width L. These are the numbers the geometry
        // gives after the 2026-08-01 width retune (+10% / +10% / +20%).
        expect([at('vertical', 'compact'), at('vertical', 'medium'),
            at('vertical', 'wide')]).toEqual([27, 29, 35]);
        // Showing requirement TITLES costs the step label nothing.
        expect([at('titles', 'compact'), at('titles', 'medium'),
            at('titles', 'wide')]).toEqual([27, 29, 35]);
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
        // and the run-widened marks reach the 35-character ceiling at Width L.
        // Measured: 21 of 55 marks qualify on this fixture.
        expect([at('title', 'compact'), at('title', 'medium'), at('title', 'wide')])
            .toEqual([[18, 33], [19, 35], [23, 35]]);
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
            .toBe('Bounded reads');
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
const timedSubstratePlan = orderedPlan(buildPipelineModel(TIMED_SUBSTRATE), { now: NOW });
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
                const tr = epicFocusTransform(lay, band, size, kBase);
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

    it('centres the band and leaves at least FOCUS_PAD on all four sides', () => {
        const size = { w: 1200, h: 700 };
        const kBase = size.w / layout.width;
        for (const band of layout.bands) {
            const tr = epicFocusTransform(layout, band, size, kBase);
            expect(tr, band.epic).toBeTruthy();
            const s = onScreen(band, tr);
            // Centred: equal slack on both axes, so the margin is never spent
            // entirely on one side.
            expect(s.left + s.right).toBeCloseTo(size.w, 6);
            expect(s.top + s.bottom).toBeCloseTo(size.h, 6);
            // Margin on ALL FOUR sides. `>=` rather than `≈` because the
            // non-binding axis (and any band clamped by the ceiling) gets more.
            expect(s.left, `${band.epic} left`).toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
            expect(s.top, `${band.epic} top`).toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
            expect(size.w - s.right, `${band.epic} right`)
                .toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
            expect(size.h - s.bottom, `${band.epic} bottom`)
                .toBeGreaterThanOrEqual(FOCUS_PAD - 1e-6);
        }
    });

    it('fits as tightly as it can — the binding axis is flush against the margin', () => {
        const size = { w: 1200, h: 700 };
        const kBase = size.w / layout.width;
        // The widest band is not ceiling-clamped, so its fit is the honest one:
        // one axis must land exactly on the pad, or the zoom was not tight.
        const band = bandOf('Swarm Substrate Rebuild');
        const tr = epicFocusTransform(layout, band, size, kBase);
        const s = onScreen(band, tr);
        const slackX = s.left - FOCUS_PAD;
        const slackY = s.top - FOCUS_PAD;
        expect(Math.min(slackX, slackY)).toBeCloseTo(0, 6);
    });

    it('clamps a one-step epic to the ceiling instead of zooming absurdly far', () => {
        const size = { w: 1200, h: 700 };
        const kBase = size.w / layout.width;
        const band = bandOf('Primary and Swarm Agentic Integration');
        expect(band.stepIds).toHaveLength(1);
        const tr = epicFocusTransform(layout, band, size, kBase);
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
                const tr = epicFocusTransform(layout, band, size, kBase);
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
        const tr = epicFocusTransform(layout, band, size, kBase);
        expect(tr.k).toBeCloseTo(kBase * FOCUS_MIN_RATIO, 9);
        // The clamp is doing work — the unclamped fit really was tighter.
        const r = bandFitRect(layout, band);
        expect(Math.max(size.h * 0.5, size.h - 2 * FOCUS_PAD) / r.h)
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
            const tr = epicFocusTransform(layout, band, { w, h: 600 }, w / layout.width);
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
        expect(epicFocusTransform(layout, band, { w: 0, h: 0 }, kBase)).toBeNull();
        expect(epicFocusTransform(layout, band, undefined, kBase)).toBeNull();
        expect(epicFocusTransform(layout, band, { w: 800, h: 600 }, 0)).toBeNull();
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
