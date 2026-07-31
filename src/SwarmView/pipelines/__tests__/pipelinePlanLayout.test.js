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
    PLAN_VIZ_PALETTE,
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

    // A genuine batch, with the two members' requirements under DIFFERENT
    // epics: the batch renders one box SEGMENT per band (a single tall rect
    // would also enclose whatever band lies between — review finding), and the
    // same-gate manual step (not a batch-mate) stays outside every segment.
    // Epic titles are deliberately LONG: the review found the batch letter
    // colliding with a long epic label when both lived in the band header.
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
            { id: 901, requirement_status: 'approved', machine_fk: 2, feature_fk: 102 },
            { id: 902, requirement_status: 'approved', machine_fk: 2, feature_fk: 101 },
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

    it('boxes every member via per-band segments and excludes non-members', () => {
        expect(crossPlan.batches).toHaveLength(1);
        const layout = computePlanLayout(crossPlan.rows, crossPlan.batches);
        const inSomeBox = (n) => layout.batchBoxes.some((box) =>
            n.x > box.x && n.x < box.x + box.width
            && n.y > box.y && n.y < box.y + box.height);

        const m2 = layout.nodes.get(2);
        const m3 = layout.nodes.get(3);
        const outsider = layout.nodes.get(4);
        // Cross-band batch → one segment per member band, one letter overall.
        expect(m2.bandIndex).not.toBe(m3.bandIndex);
        expect(layout.batchBoxes).toHaveLength(2);
        expect(layout.batchBoxes.filter((b) => b.topSegment)).toHaveLength(1);
        expect(inSomeBox(m2)).toBe(true);
        expect(inSomeBox(m3)).toBe(true);
        expect(inSomeBox(outsider)).toBe(false);
        expect(layout.labels.filter((l) => l.kind === 'batch')).toHaveLength(1);
    });

    it('never encloses a bead from an unrelated band between two members', () => {
        // Review dataset: members in the first and third bands, a NON-member in
        // the band between them, all sharing the gate. The POC's single tall
        // rect read step 3 as launching in batch A; segments must not.
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
        expect(p.batches).toHaveLength(1);
        expect(p.batches[0].stepIds.sort()).toEqual([2, 4]);
        const layout = computePlanLayout(p.rows, p.batches);
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
