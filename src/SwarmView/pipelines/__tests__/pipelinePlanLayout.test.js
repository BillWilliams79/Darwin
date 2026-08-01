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
import {
    computePlanLayout, beadStyle, stepLabelText, BEAD_RADIUS,
    PLAN_VIZ_PALETTE, STEP_DONE,
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

    it('every arc points forward: a dep always sits left of its dependent', () => {
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

    // With no time axis supplied every epic is undated, so req #3201's band
    // rule falls through to its documented tie-break: epic id ascending, the
    // label-less band last. (The fixture carries no timestamps at all — the
    // timed axis is exercised in its own describe block below.)
    it('stacks bands by epic id when no epic has a derived start', () => {
        const expected = [...new Set(plan.rows.map((r) => (r.epicId != null ? r.epicId : null)))]
            .sort((a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b));
        expect(layout.bands.map((b) => b.epicId)).toEqual(expected);
    });

    // The degenerate axis IS the old axis. Without this, "one code path" is a
    // claim in a comment rather than a property.
    it('degenerates to pure dependency depth with no time axis', () => {
        const byId = new Map(plan.rows.map((r) => [r.id, r]));
        const memo = new Map();
        const depth = (r) => {
            if (memo.has(r.id)) return memo.get(r.id);
            memo.set(r.id, 0);
            const v = 1 + Math.max(-1, ...(r.depIds || [])
                .filter((d) => byId.has(d)).map((d) => depth(byId.get(d))));
            memo.set(r.id, v);
            return v;
        };
        for (const r of plan.rows) {
            expect(layout.nodes.get(r.id).depth).toBe(depth(r));
        }
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

const timedPlan = orderedPlan(buildPipelineModel(TIMED_MODEL),
    { now: '2026-07-28T12:00:00Z' });
const timedLayout = computePlanLayout(timedPlan.rows, timedPlan.batches,
    { timeAxis: timedPlan.timeAxis });
const colOfStep = (layout, id) => layout.nodes.get(id).depth;

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
const timedSubstratePlan = orderedPlan(buildPipelineModel(TIMED_SUBSTRATE), { now: NOW });

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
