// pipelineModel tests (req #3112) — POC parity against the archived req #3080
// generate.py, seeded invariant violations, the four named ordering regressions,
// batch lettering + /swarm-start args, dual-condition gate eligibility, req-less
// step derivation, cross-epic labeling, machine/cost units. Static fixtures only —
// no DB, no fetch.
import { describe, it, expect } from 'vitest';

import {
    STEP_DONE, STEP_RUNNING, STEP_PENDING,
    deriveStepState, buildPlanRows, displayOrder, verifyOrder,
    eligibility, launchBatches, condensationProposals,
    dominantLabels, machineLabels, fmtCost, aggregateStepCost,
    aggregateRowCost, sumReqCost,
} from '../pipelineModel';
import { PLAN_JSON_ROWS, SUBSTRATE_REBUILD_MODEL } from './substrateRebuildFixture';

// Golden orders captured 2026-07-26 by running the ARCHIVED req #3080
// display_order()/verify_order() (Python, verbatim) over the live PLAN-JSON.
// E1: rows exactly as stored. E2: identical input except the req-less step 7
// carries null epic/feature — what dominant-label derivation produces for zero
// linked requirements (topology then forces 7 right before its dependent 21).
// Both golden orders pass the archived verify_order.
const E1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 21, 10, 26, 25, 28, 11, 22, 16, 23, 33,
    12, 13, 14, 19, 38, 34, 39, 40, 41, 43, 42, 17, 18, 31, 20];
// There used to be a SECOND expectation here, E2, identical to E1 except that
// step 7 sorted three places later (…6, 8, 9, 7, 21… instead of …6, 7, 8, 9…).
// It existed because the req-less step 7 derived NO epic — rule 10 attaches
// labels to requirements and step 7 links none — and epic order is a tie-break
// in displayOrder, so the product's own output disagreed with the POC's on the
// one row where the POC read the label straight off the plan.
//
// req #3119 closed that gap: a req-less step now INHERITS its dependencies'
// dominant label (see buildPlanRows), so the full derivation reproduces E1
// exactly and there is one expected order again, not two.

const PLAN_STATE = { done: STEP_DONE, active: STEP_RUNNING, pending: STEP_PENDING };

// PLAN-JSON rows translated to the row shape the engine consumes — the SAME data
// the archived generate.py ran on (epic/feature/state carried verbatim).
function pocRows() {
    return PLAN_JSON_ROWS.map((r) => {
        const toks = r.deps === '-' ? [] : r.deps.split(' ');
        return {
            id: Number(r.step),
            state: PLAN_STATE[r.state],
            run: r.run,
            epic: r.epic,
            feature: r.feature,
            reqIds: r.reqs,
            depIds: toks.filter((t) => !t.startsWith('T:')).map(Number),
            timeDeps: toks.filter((t) => t.startsWith('T:')).map((t) => t.slice(2)),
        };
    });
}

// Synthetic row helper for targeted cases.
function row(id, state, deps = [], opts = {}) {
    return {
        id,
        state,
        run: opts.run || 'auto',
        epic: opts.epic !== undefined ? opts.epic : null,
        feature: opts.feature !== undefined ? opts.feature : null,
        reqIds: opts.reqIds || [],
        depIds: deps,
        timeDeps: opts.timeDeps || [],
        machineLabels: opts.machines || [],
    };
}

const ids = (rows) => rows.map((r) => r.id);

describe('POC parity — the archived generate.py output is the contract', () => {
    it('reproduces E1 over the PLAN-JSON rows exactly as stored', () => {
        const result = displayOrder(pocRows());
        expect(ids(result.rows)).toEqual(E1);
        expect(result.cycleDetected).toBe(false);
        expect(verifyOrder(result.rows)).toEqual([]);
    });

    // The stronger form of the parity contract: derivation from the TABLE-SHAPED
    // fixture — junction rows, requirement statuses, feature→epic chains — must
    // land on the same order as the POC reading the PLAN-JSON's own columns.
    // Same expectation as E1, deliberately: two orders would mean the product
    // and its own acceptance fixture disagree about the plan.
    it('reproduces E1 over the table-shaped fixture via full derivation', () => {
        const rows = buildPlanRows(SUBSTRATE_REBUILD_MODEL);
        const result = displayOrder(rows);
        expect(ids(result.rows)).toEqual(E1);
        expect(result.cycleDetected).toBe(false);
        expect(verifyOrder(result.rows)).toEqual([]);
    });

    it('derives every fixture step state equal to the PLAN-JSON state', () => {
        const byId = new Map(buildPlanRows(SUBSTRATE_REBUILD_MODEL).map((r) => [r.id, r]));
        for (const planRow of PLAN_JSON_ROWS) {
            expect(byId.get(Number(planRow.step)).state,
                `step ${planRow.step}`).toBe(PLAN_STATE[planRow.state]);
        }
    });

    it('derives every fixture epic/feature label equal to the PLAN-JSON labels, '
       + 'the req-less step 7 included', () => {
        const byId = new Map(buildPlanRows(SUBSTRATE_REBUILD_MODEL).map((r) => [r.id, r]));
        for (const planRow of PLAN_JSON_ROWS) {
            const derived = byId.get(Number(planRow.step));
            expect(derived.epic, `step ${planRow.step}`).toBe(planRow.epic);
            expect(derived.feature, `step ${planRow.step}`).toBe(planRow.feature);
        }
    });

    // The mechanism behind that, stated on its own so a regression names itself:
    // step 7 links no requirement, so it has nothing of its own to derive from
    // and borrows from step 6 — which is what the plan itself records for it.
    it('a req-less step inherits its dependency label, and claims no label set', () => {
        const byId = new Map(buildPlanRows(SUBSTRATE_REBUILD_MODEL).map((r) => [r.id, r]));
        const seven = byId.get(7);
        expect(seven.reqIds).toEqual([]);
        expect(seven.depIds).toEqual([6]);
        expect(seven.epic).toBe(byId.get(6).epic);
        expect(seven.feature).toBe(byId.get(6).feature);
        // Borrowed, not spanned: the label SETS stay empty, so the "spans more
        // than one epic" tooltip never fires on an inherited label.
        expect(seven.epicLabels).toEqual([]);
        expect(seven.featureLabels).toEqual([]);
    });

    it('a step with its OWN requirements never inherits from a dependency', () => {
        const byId = new Map(buildPlanRows(SUBSTRATE_REBUILD_MODEL).map((r) => [r.id, r]));
        // Step 19 spans epics by design (rule 10) and gates step 38, which sits
        // under a different epic; 38 must keep its own, not 19's.
        expect(byId.get(38).depIds).toEqual([19]);
        expect(byId.get(38).epic).toBe('Swarm Orchestration Feature');
        expect(byId.get(38).epicLabels.length).toBeGreaterThan(0);
    });

    it('joins dependencies faithfully (spot checks)', () => {
        const byId = new Map(buildPlanRows(SUBSTRATE_REBUILD_MODEL).map((r) => [r.id, r]));
        expect(byId.get(12).depIds).toEqual([11, 22, 28]);
        expect(byId.get(25).depIds).toEqual([10, 26]);
        expect(byId.get(1).depIds).toEqual([]);
        expect(byId.get(38).reqIds).toEqual([3110, 3111, 3112]);
    });
});

describe('deriveStepState — rule 1, state is derived never stored', () => {
    const step = { id: 1, completed_at: null };
    const req = (status) => ({ id: 9, requirement_status: status });

    it('any linked requirement in development → running (even amid terminals)', () => {
        expect(deriveStepState(step, [req('met'), req('development')])).toBe(STEP_RUNNING);
        expect(deriveStepState(step, [req('development')])).toBe(STEP_RUNNING);
    });

    it('all terminal (met/deferred/wontfix mix) → done', () => {
        expect(deriveStepState(step, [req('met'), req('deferred'), req('wontfix')]))
            .toBe(STEP_DONE);
    });

    it('otherwise → pending (approved/swarm_ready/authoring, or mixed with met)', () => {
        expect(deriveStepState(step, [req('approved')])).toBe(STEP_PENDING);
        expect(deriveStepState(step, [req('swarm_ready'), req('authoring')])).toBe(STEP_PENDING);
        expect(deriveStepState(step, [req('met'), req('approved')])).toBe(STEP_PENDING);
    });

    it('zero linked requirements: completed_at decides (req-less step derivation)', () => {
        expect(deriveStepState({ id: 7, completed_at: '2026-07-26T01:30:00' }, []))
            .toBe(STEP_DONE);
        expect(deriveStepState({ id: 7, completed_at: null }, [])).toBe(STEP_PENDING);
    });

    it('fixture step 7 (the real req-less baseline record) derives done', () => {
        const byId = new Map(buildPlanRows(SUBSTRATE_REBUILD_MODEL).map((r) => [r.id, r]));
        expect(byId.get(7).state).toBe(STEP_DONE);
        expect(byId.get(7).machineLabel).toBe('—');
    });
});

describe('verifyOrder — each invariant caught on a seeded bad input', () => {
    it('invariant 1 (topology): a row before its dependency is caught', () => {
        const a = row(1, STEP_DONE);
        const b = row(2, STEP_DONE, [1]);
        const violations = verifyOrder([b, a]);
        expect(violations.some((v) => v.invariant === 'topology'
            && v.stepIds[0] === 2 && v.stepIds[1] === 1)).toBe(true);
    });

    it('invariant 2 (state banding): running below pending is caught', () => {
        const violations = verifyOrder([row(1, STEP_PENDING), row(2, STEP_RUNNING)]);
        expect(violations.some((v) => v.invariant === 'state-banding'
            && v.stepIds[0] === 2)).toBe(true);
    });

    // Design rule 3 orders its criteria "topological, THEN state bands", so
    // topology WINS. When a step's own gate sits in a later band, no ordering
    // satisfies both and dependency-first is the only correct answer — reporting
    // it was the checker being stricter than the rule, and it fired on every
    // render of the live plan (step 19 Running gates step 38 Complete).
    it('invariant 2: a band inversion FORCED by a dependency is not a violation', () => {
        const gate = row(19, STEP_RUNNING);
        const dependent = row(38, STEP_DONE, [19]);
        const violations = verifyOrder([gate, dependent]);
        expect(violations.filter((v) => v.invariant === 'state-banding')).toEqual([]);
        // ...and the order is topologically sound, so nothing else fires either.
        expect(violations).toEqual([]);
    });

    it('invariant 2: transitively forced inversions are accepted too', () => {
        const violations = verifyOrder([
            row(1, STEP_RUNNING),
            row(2, STEP_DONE, [1]),
            row(3, STEP_DONE, [2]),
        ]);
        expect(violations).toEqual([]);
    });

    it('invariant 2: an inversion the order did NOT have to make is still caught', () => {
        // Same shape, minus the dependency — step 38 could have rendered first,
        // so the sink is a real ordering defect. This is the 4th regression the
        // invariant was built for: state losing to stream grouping.
        const violations = verifyOrder([row(19, STEP_RUNNING), row(38, STEP_DONE)]);
        const banding = violations.filter((v) => v.invariant === 'state-banding');
        expect(banding).toHaveLength(1);
        expect(banding[0].stepIds).toEqual([38, 19]);
    });

    it('invariant 2: depending on ONE running row does not excuse sinking below another',
        () => {
            // 38 must follow 19 (dependency). It need not follow 20, and does.
            const violations = verifyOrder([
                row(19, STEP_RUNNING),
                row(20, STEP_RUNNING),
                row(38, STEP_DONE, [19]),
            ]);
            const banding = violations.filter((v) => v.invariant === 'state-banding');
            expect(banding).toHaveLength(1);
            expect(banding[0].stepIds).toEqual([38, 20]);
        });

    it('invariant 3 (batch contiguity): a split launch batch is caught', () => {
        const a = row(3, STEP_PENDING, [1]);
        const x = row(4, STEP_PENDING, [2]);
        const b = row(5, STEP_PENDING, [1]);
        const violations = verifyOrder([a, x, b]);
        expect(violations.some((v) => v.invariant === 'batch-contiguity'
            && v.stepIds.includes(3) && v.stepIds.includes(5))).toBe(true);
    });

    it('violations are structured objects the UI can render loudly', () => {
        const [v] = verifyOrder([row(2, STEP_DONE, [1]), row(1, STEP_DONE)]);
        expect(v).toMatchObject({ invariant: 'topology', stepIds: [2, 1] });
        expect(typeof v.message).toBe('string');
        expect(v.message.length).toBeGreaterThan(0);
    });

    it('a clean order returns exactly []', () => {
        expect(verifyOrder([row(1, STEP_DONE), row(2, STEP_RUNNING, [1])])).toEqual([]);
    });
});

describe('cycle handling — detect, report, deterministic fallback (rule 3)', () => {
    it('displayOrder falls back to stored order and flags the cycle', () => {
        const stored = [row(1, STEP_PENDING, [2]), row(2, STEP_PENDING, [1]),
            row(3, STEP_DONE)];
        const result = displayOrder(stored);
        expect(result.cycleDetected).toBe(true);
        expect(result.cycleStepIds).toEqual([1, 2]);
        // done row places first; the unplaceable remainder appends in stored order
        expect(ids(result.rows)).toEqual([3, 1, 2]);
    });

    it('verifyOrder reports the cycle as a structured violation', () => {
        const result = displayOrder([row(1, STEP_PENDING, [2]), row(2, STEP_PENDING, [1])]);
        const violations = verifyOrder(result.rows);
        expect(violations.some((v) => v.invariant === 'cycle'
            && v.stepIds.includes(1) && v.stepIds.includes(2))).toBe(true);
        // and the fallback order necessarily breaks topology — loudly reported too
        expect(violations.some((v) => v.invariant === 'topology')).toBe(true);
    });
});

describe('the four named POC ordering regressions (req #3080 rule 3)', () => {
    it('regression 1 — insertion-order leaks: stored order never drives display', () => {
        const reversed = [...buildPlanRows(SUBSTRATE_REBUILD_MODEL)].reverse();
        const result = displayOrder(reversed);
        expect(result.cycleDetected).toBe(false);
        // invariant-clean despite hostile storage order…
        expect(verifyOrder(result.rows)).toEqual([]);
        // …and visibly NOT the storage order
        expect(ids(result.rows)).not.toEqual(ids(reversed));
    });

    it('regression 2 — interleaved batch clusters: batch-mates stay contiguous ' +
       'even when epic/run tie-breaks would split them', () => {
        // gate(1) done; A(10, epic X) and B(12, epic Y) share (deps, run, machines)
        // = one batch; C(11, epic X, manual) shares the gate but not the run mode.
        // Naive (anchor, epic, run, id) ordering yields A, C, B — the POC failure.
        const gate = row(1, STEP_DONE, [], { epic: 'X' });
        const a = row(10, STEP_PENDING, [1], { epic: 'X', reqIds: [101] });
        const c = row(11, STEP_PENDING, [1], { epic: 'X', run: 'manual', reqIds: [102] });
        const b = row(12, STEP_PENDING, [1], { epic: 'Y', reqIds: [103] });
        const result = displayOrder([gate, a, c, b]);
        expect(ids(result.rows)).toEqual([1, 10, 12, 11]);
        expect(verifyOrder(result.rows)).toEqual([]);
        const batches = launchBatches(result.rows);
        expect(batches).toHaveLength(1);
        expect(batches[0].stepIds).toEqual([10, 12]);
    });

    it('regression 3 — whole-stream grouping must never outrank state: running ' +
       'rows never sink below the scheduled tail', () => {
        // A deep pending stream stored first + running rows on a later stream.
        const stored = [
            row(30, STEP_PENDING),
            row(31, STEP_PENDING, [30]),
            row(32, STEP_PENDING, [31]),
            row(1, STEP_DONE),
            row(20, STEP_RUNNING, [1]),
            row(21, STEP_RUNNING, [20]),
        ];
        const result = displayOrder(stored);
        expect(verifyOrder(result.rows)).toEqual([]);
        const posn = new Map(ids(result.rows).map((id, i) => [id, i]));
        for (const running of [20, 21]) {
            for (const pending of [30, 31, 32]) {
                expect(posn.get(running), `running ${running} above pending ${pending}`)
                    .toBeLessThan(posn.get(pending));
            }
        }
    });

    it('regression 4 — absolute state bands: done > running > pending regardless ' +
       'of storage position', () => {
        const stored = [row(1, STEP_PENDING), row(2, STEP_RUNNING), row(3, STEP_DONE)];
        const result = displayOrder(stored);
        expect(ids(result.rows)).toEqual([3, 2, 1]);
        expect(verifyOrder(result.rows)).toEqual([]);
    });
});

describe('launchBatches — rules 2 + 8, the launch unit is explicit', () => {
    it('letters batches in display order with the exact /swarm-start args', () => {
        const stored = [
            row(1, STEP_DONE),
            row(2, STEP_DONE, [1]),
            // batch on gate 2 (deeper stream → launches first)
            row(10, STEP_PENDING, [2], { reqIds: [3115, 3116], machines: ['Mac mini'] }),
            row(11, STEP_PENDING, [2], { reqIds: [3117], machines: ['Mac mini'] }),
            // batch on gate 1
            row(20, STEP_PENDING, [1], { reqIds: [3113], machines: ['Mac mini'] }),
            row(21, STEP_PENDING, [1], { reqIds: [3114], machines: ['Mac mini'] }),
        ];
        const result = displayOrder(stored);
        expect(verifyOrder(result.rows)).toEqual([]);
        const batches = launchBatches(result.rows);
        expect(batches).toHaveLength(2);
        expect(batches[0].letter).toBe('A');
        expect(batches[0].stepIds).toEqual([10, 11]);
        expect(batches[0].gateStepIds).toEqual([2]);
        expect(batches[0].swarmStartArgs).toEqual([3115, 3116, 3117]);
        expect(batches[0].swarmStartCommand).toBe('/swarm-start 3115 3116 3117');
        expect(batches[1].letter).toBe('B');
        expect(batches[1].stepIds).toEqual([20, 21]);
        expect(batches[1].swarmStartCommand).toBe('/swarm-start 3113 3114');
    });

    it('run mode, machine set, and time gates all split batches', () => {
        const stored = [
            row(1, STEP_DONE),
            row(10, STEP_PENDING, [1], { reqIds: [1] }),
            row(11, STEP_PENDING, [1], { reqIds: [2], run: 'manual' }),          // run splits
            row(12, STEP_PENDING, [1], { reqIds: [3], machines: ['WSL'] }),      // machine splits
            row(13, STEP_PENDING, [1], { reqIds: [4], timeDeps: ['2026-08-01T00:00:00Z'] }),
        ];
        expect(launchBatches(displayOrder(stored).rows)).toEqual([]);
    });

    it('a batch may cross epics — grouping ignores labels (rule 10)', () => {
        const stored = [
            row(1, STEP_DONE),
            row(10, STEP_PENDING, [1], { epic: 'Substrate', reqIds: [7] }),
            row(11, STEP_PENDING, [1], { epic: 'Application', reqIds: [8] }),
        ];
        const batches = launchBatches(displayOrder(stored).rows);
        expect(batches).toHaveLength(1);
        expect(batches[0].stepIds).toEqual([10, 11]);
        expect(batches[0].swarmStartArgs).toEqual([7, 8]);
    });
});

describe('condensationProposals — rule 2 proposals, UI decides', () => {
    it('proposes merging same-(gate, run, machine) pending steps', () => {
        const rows = [
            row(1, STEP_DONE),
            row(10, STEP_PENDING, [1], { reqIds: [7], machines: ['Mac mini'] }),
            row(11, STEP_PENDING, [1], { reqIds: [8], machines: ['Mac mini'] }),
            row(12, STEP_PENDING, [1], { reqIds: [9], run: 'manual' }),
        ];
        const proposals = condensationProposals(rows);
        expect(proposals).toHaveLength(1);
        expect(proposals[0]).toMatchObject({
            stepIds: [10, 11],
            requirementIds: [7, 8],
            depStepIds: [1],
            run: 'auto',
            machineLabels: ['Mac mini'],
        });
        expect(proposals[0].reason).toContain('design rule 2');
    });

    it('proposes nothing when every pending step has a distinct launch key', () => {
        expect(condensationProposals([
            row(10, STEP_PENDING, [1], { reqIds: [7] }),
            row(11, STEP_PENDING, [2], { reqIds: [8] }),
        ])).toEqual([]);
    });
});

describe('eligibility — computed, never stored; caller-supplied now', () => {
    const done = row(1, STEP_DONE);

    it('pending + all step-deps done + no time gates → eligible', () => {
        expect(eligibility(row(2, STEP_PENDING, [1]), [done], '2026-07-26T00:00:00Z'))
            .toBe(true);
        expect(eligibility(row(2, STEP_PENDING), [], undefined)).toBe(true);
    });

    it('dual-condition gate (step dep + time dep): both must hold', () => {
        const gated = row(2, STEP_PENDING, [1], { timeDeps: ['2026-08-01T00:00:00Z'] });
        // time not yet passed
        expect(eligibility(gated, [done], '2026-07-31T23:59:59Z')).toBe(false);
        // time passed (boundary inclusive)
        expect(eligibility(gated, [done], '2026-08-01T00:00:00Z')).toBe(true);
        expect(eligibility(gated, [done], '2026-08-02T00:00:00Z')).toBe(true);
        // step dep unmet even though time passed
        const notDone = row(1, STEP_RUNNING);
        expect(eligibility(gated, [notDone], '2026-08-02T00:00:00Z')).toBe(false);
    });

    it('time gates without a caller-supplied now are never satisfied (pure module)', () => {
        const gated = row(2, STEP_PENDING, [], { timeDeps: ['2026-08-01T00:00:00Z'] });
        expect(eligibility(gated, [], undefined)).toBe(false);
    });

    it('non-pending rows and unknown deps are never eligible', () => {
        expect(eligibility(row(2, STEP_RUNNING, [1]), [done], 0)).toBe(false);
        expect(eligibility(row(2, STEP_DONE), [], 0)).toBe(false);
        expect(eligibility(row(2, STEP_PENDING, [99]), [done], 0)).toBe(false);
    });

    it('accepts Date and epoch-ms forms of now', () => {
        const gated = row(2, STEP_PENDING, [], { timeDeps: ['2026-08-01T00:00:00Z'] });
        expect(eligibility(gated, [], new Date('2026-08-02T00:00:00Z'))).toBe(true);
        expect(eligibility(gated, [], Date.parse('2026-08-02T00:00:00Z'))).toBe(true);
    });

    it('fixture: steps 17 and 34 are the eligible frontier of the live plan', () => {
        const rows = buildPlanRows(SUBSTRATE_REBUILD_MODEL);
        const eligibleIds = rows
            .filter((r) => eligibility(r, rows, '2026-07-26T12:00:00Z'))
            .map((r) => r.id);
        // 17 gates on 12/13/14 (all done); every other pending row waits on a
        // pending/running step. 34 is active, not pending — not eligible.
        expect(eligibleIds).toEqual([17]);
    });
});

describe('dominantLabels + machineLabels — rule 10 derivation', () => {
    it('fixture step 19: dominant label wins 2:1, full set keeps the cross-epic ' +
       'member for tooltips', () => {
        const step19 = SUBSTRATE_REBUILD_MODEL.steps.find((s) => s.id === 19);
        const labels = dominantLabels(step19, SUBSTRATE_REBUILD_MODEL);
        expect(labels.epic).toBe('Swarm Orchestration Feature');
        expect(labels.feature).toBe('Swarm Orchestration Feature');
        expect(labels.epicLabels.map((e) => e.title))
            .toEqual(['Swarm Orchestration Feature', 'Swarm Substrate Rebuild']);
        expect(labels.featureLabels.map((f) => f.title))
            .toEqual(['Swarm Orchestration Feature', 'Swarm Lifecycle']);
    });

    it('ties break to first appearance in the step requirement order', () => {
        const model = {
            steps: [{ id: 1, title: 't', run: 'auto', notes: null, completed_at: null }],
            stepRequirements: [
                { step_fk: 1, requirement_fk: 11 },
                { step_fk: 1, requirement_fk: 12 },
            ],
            stepDeps: [],
            requirements: [
                { id: 11, requirement_status: 'approved', machine_fk: null, feature_fk: 5 },
                { id: 12, requirement_status: 'approved', machine_fk: null, feature_fk: 6 },
            ],
            features: [
                { id: 5, title: 'First', epic_fk: 1 },
                { id: 6, title: 'Second', epic_fk: 2 },
            ],
            epics: [{ id: 1, title: 'EpicOne' }, { id: 2, title: 'EpicTwo' }],
        };
        const labels = dominantLabels(model.steps[0], model);
        expect(labels.feature).toBe('First');
        expect(labels.epic).toBe('EpicOne');
    });

    it('req-less step has no labels', () => {
        const step7 = SUBSTRATE_REBUILD_MODEL.steps.find((s) => s.id === 7);
        const labels = dominantLabels(step7, SUBSTRATE_REBUILD_MODEL);
        expect(labels).toMatchObject({
            epicId: null, epic: null, featureId: null, feature: null,
        });
        expect(labels.epicLabels).toEqual([]);
    });

    it('machineLabels: NULL → Any, unknown id → #id, uniques joined, no reqs → —', () => {
        const model = {
            steps: [
                { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 },
            ],
            stepRequirements: [
                { step_fk: 1, requirement_fk: 11 },
                { step_fk: 1, requirement_fk: 12 },
                { step_fk: 1, requirement_fk: 13 },
                { step_fk: 2, requirement_fk: 14 },
                { step_fk: 3, requirement_fk: 15 },
                { step_fk: 3, requirement_fk: 16 },
            ],
            stepDeps: [],
            requirements: [
                { id: 11, machine_fk: 2 },
                { id: 12, machine_fk: 3 },
                { id: 13, machine_fk: null },
                { id: 14, machine_fk: 9 },
                { id: 15, machine_fk: 2 },
                { id: 16, machine_fk: 2 },
            ],
            features: [],
            epics: [],
            machines: [{ id: 2, title: 'Mac mini' }, { id: 3, title: 'WSL' }],
        };
        expect(machineLabels(model.steps[0], model))
            .toEqual({ labels: ['Mac mini', 'WSL', 'Any'], label: 'Mac mini / WSL / Any' });
        expect(machineLabels(model.steps[1], model))
            .toEqual({ labels: ['#9'], label: '#9' });
        expect(machineLabels(model.steps[2], model))
            .toEqual({ labels: ['Mac mini'], label: 'Mac mini' });
        expect(machineLabels(model.steps[3], model)).toEqual({ labels: [], label: '—' });
    });

    it('fixture machine columns: WSL rows, Any row, Mac mini rows', () => {
        const byId = new Map(buildPlanRows(SUBSTRATE_REBUILD_MODEL).map((r) => [r.id, r]));
        expect(byId.get(8).machineLabel).toBe('WSL');
        expect(byId.get(20).machineLabel).toBe('Any');
        expect(byId.get(1).machineLabel).toBe('Mac mini');
    });
});

describe('code-review hardenings (2026-07-26)', () => {
    it('naive Darwin timestamps (no timezone designator) are UTC — time gates ' +
       'must not shift by the machine offset', () => {
        // "2026-08-01T00:00:00" is the shape Lambda-Rest actually returns.
        const gated = row(2, STEP_PENDING, [], { timeDeps: ['2026-08-01T00:00:00'] });
        expect(eligibility(gated, [], '2026-07-31T23:59:59Z')).toBe(false);
        expect(eligibility(gated, [], '2026-08-01T00:00:00Z')).toBe(true);
        // naive `now` strings normalize the same way
        expect(eligibility(gated, [], '2026-08-01T00:00:00')).toBe(true);
        // explicit offsets still honored
        expect(eligibility(gated, [], '2026-08-01T02:00:00+03:00')).toBe(false);
        // MySQL's space-separated naive form is the same UTC value
        const spaceGated = row(2, STEP_PENDING, [], { timeDeps: ['2026-08-01 00:00:00'] });
        expect(eligibility(spaceGated, [], '2026-08-01T00:00:00Z')).toBe(true);
        expect(eligibility(spaceGated, [], '2026-07-31T23:59:59Z')).toBe(false);
    });

    it('duplicate step ids are reported loudly, never silently collapsed', () => {
        const stored = [row(5, STEP_DONE), row(5, STEP_PENDING), row(7, STEP_RUNNING)];
        const result = displayOrder(stored);
        expect(result.duplicateStepIds).toEqual([5]);
        const violations = verifyOrder(stored);
        expect(violations.some((v) => v.invariant === 'duplicate-id'
            && v.stepIds.includes(5))).toBe(true);
        // clean input reports none
        expect(displayOrder([row(1, STEP_DONE)]).duplicateStepIds).toEqual([]);
        // and duplicates never masquerade as an empty-stepIds cycle violation
        expect(violations.filter((v) => v.invariant === 'cycle')).toEqual([]);
    });

    it('dependencies pointing outside the row set are reported as dangling', () => {
        const violations = verifyOrder([row(2, STEP_PENDING, [99])]);
        expect(violations.some((v) => v.invariant === 'dangling-dependency'
            && v.stepIds[0] === 2 && v.stepIds[1] === 99)).toBe(true);
    });

    it('junction rows whose requirement is missing from the model are surfaced ' +
       'on the row, not silently under-derived', () => {
        const model = {
            steps: [{ id: 1, title: 't', run: 'auto', notes: null, completed_at: null }],
            stepRequirements: [{ step_fk: 1, requirement_fk: 3110 }],
            stepDeps: [],
            requirements: [],   // 3110 absent — e.g. a truncated bounded list read
            features: [],
            epics: [],
        };
        const [derived] = buildPlanRows(model);
        expect(derived.unresolvedReqIds).toEqual([3110]);
        // fixture rows resolve fully
        for (const r of buildPlanRows(SUBSTRATE_REBUILD_MODEL)) {
            expect(r.unresolvedReqIds).toEqual([]);
        }
    });

    it('an all-req-less batch never emits an argument-less /swarm-start', () => {
        const stored = [
            row(1, STEP_DONE),
            row(10, STEP_PENDING, [1]),
            row(11, STEP_PENDING, [1]),
        ];
        const [batch] = launchBatches(displayOrder(stored).rows);
        expect(batch.stepIds).toEqual([10, 11]);
        expect(batch.swarmStartArgs).toEqual([]);
        expect(batch.swarmStartCommand).toBeNull();
    });

    it('batch letters continue Excel-style past Z (batch 27 → AA)', () => {
        const stored = [];
        for (let g = 1; g <= 27; g++) {
            stored.push(row(g, STEP_DONE));
        }
        for (let g = 1; g <= 27; g++) {
            stored.push(row(100 + g * 2, STEP_PENDING, [g], { reqIds: [1000 + g] }));
            stored.push(row(101 + g * 2, STEP_PENDING, [g], { reqIds: [2000 + g] }));
        }
        const batches = launchBatches(displayOrder(stored).rows);
        expect(batches).toHaveLength(27);
        expect(batches[25].letter).toBe('Z');
        expect(batches[26].letter).toBe('AA');
    });

    it('fixture variant with a real launch batch: hardenings keep batch-mates ' +
       'contiguous and derive the exact /swarm-start', () => {
        // Flip step 43 to run:auto — it then shares (gate 40, auto, Mac mini)
        // with step 41: the first genuine batch in the Substrate Rebuild data.
        const steps = SUBSTRATE_REBUILD_MODEL.steps.map(
            (s) => (s.id === 43 ? { ...s, run: 'auto' } : s));
        const rows = buildPlanRows({ ...SUBSTRATE_REBUILD_MODEL, steps });
        const result = displayOrder(rows);
        expect(result.cycleDetected).toBe(false);
        expect(verifyOrder(result.rows)).toEqual([]);
        const batches = launchBatches(result.rows);
        expect(batches).toHaveLength(1);
        expect(batches[0]).toMatchObject({
            letter: 'A',
            stepIds: [41, 43],
            gateStepIds: [40],
            run: 'auto',
            machineLabels: ['Mac mini'],
            swarmStartArgs: [3118, 3108],
            swarmStartCommand: '/swarm-start 3118 3108',
        });
        const posn = new Map(ids(result.rows).map((id, i) => [id, i]));
        expect(Math.abs(posn.get(41) - posn.get(43))).toBe(1);
        expect(condensationProposals(rows)).toHaveLength(1);
    });
});

describe('cost aggregation (req #3117 server-side rollup)', () => {
    it('fmtCost renders dashes when data is absent and h/m + token forms otherwise', () => {
        expect(fmtCost(0, 0)).toBe('—');
        expect(fmtCost(300, 0)).toBe('5m');
        expect(fmtCost(3900, 0)).toBe('1h 5m');
        expect(fmtCost(60, 5000)).toBe('1m\n5k tok');
        expect(fmtCost(0, 5000)).toBe('0m\n5k tok');
        expect(fmtCost(60, 2_500_000)).toBe('1m\n2.5M tok');
    });

    // A CostIndex, as buildCostIndex() produces: per-session totals plus which
    // sessions each requirement reached. Sessions 1 and 2 are private to 3110
    // and 3112; requirement 3111 reached NONE (no sessions, or only unbackfilled
    // ones) and therefore contributes nothing.
    const INDEX = {
        bySession: {
            1: { wallSecs: 600, tokens: 40_000 },
            2: { wallSecs: 300, tokens: 25_000 },
        },
        sessionIdsByRequirement: { 3110: [1], 3112: [2] },
        byRequirement: {
            3110: { wallSecs: 600, tokens: 40_000 },
            3112: { wallSecs: 300, tokens: 25_000 },
        },
    };

    it('aggregateStepCost sums linked requirements; absent data stays dashes', () => {
        const step38 = SUBSTRATE_REBUILD_MODEL.steps.find((s) => s.id === 38);
        expect(aggregateStepCost(step38, SUBSTRATE_REBUILD_MODEL, INDEX))
            .toEqual({ wallSecs: 900, tokens: 65_000 });
        const empty = aggregateStepCost(step38, SUBSTRATE_REBUILD_MODEL, null);
        expect(empty).toEqual({ wallSecs: 0, tokens: 0 });
        expect(fmtCost(empty.wallSecs, empty.tokens)).toBe('—');
    });

    it('a session shared by two requirements OF ONE STEP counts once', () => {
        // Design rule 2 proposes folding co-gated requirements into one
        // multi-requirement step, and Darwin's history already has sessions that
        // closed two requirements together (2429 -> 3056+3070). Summing per
        // requirement would print roughly double the wall clock actually spent.
        const shared = {
            bySession: { 9: { wallSecs: 31_381, tokens: 324_239 } },
            sessionIdsByRequirement: { 3110: [9], 3111: [9], 3112: [9] },
            byRequirement: {
                3110: { wallSecs: 31_381, tokens: 324_239 },
                3111: { wallSecs: 31_381, tokens: 324_239 },
                3112: { wallSecs: 31_381, tokens: 324_239 },
            },
        };
        const step38 = SUBSTRATE_REBUILD_MODEL.steps.find((s) => s.id === 38);
        expect(aggregateStepCost(step38, SUBSTRATE_REBUILD_MODEL, shared))
            .toEqual({ wallSecs: 31_381, tokens: 324_239 });
        // Per-requirement attribution is still FULL — the union is a STEP rule.
        expect(shared.byRequirement[3110]).toEqual({ wallSecs: 31_381, tokens: 324_239 });
    });

    it('aggregateRowCost sums a PlanRow to the same total as aggregateStepCost', () => {
        // The two entry points exist because the table renders from PlanRows and
        // the model-level helper predates them. They MUST agree — a plan whose
        // table and visualizer print different numbers for one step is worse than
        // one that prints none.
        const step38 = SUBSTRATE_REBUILD_MODEL.steps.find((s) => s.id === 38);
        const row38 = buildPlanRows(SUBSTRATE_REBUILD_MODEL).find((r) => r.id === 38);
        expect(aggregateRowCost(row38, INDEX))
            .toEqual(aggregateStepCost(step38, SUBSTRATE_REBUILD_MODEL, INDEX));
        expect(aggregateRowCost(row38, INDEX)).toEqual({ wallSecs: 900, tokens: 65_000 });
    });

    it('a requirement with no rollup entry contributes nothing rather than zeroing the row', () => {
        // "Not measured" and "measured as zero" are different claims. A step whose
        // OTHER requirements have real cost must keep showing it.
        const step38 = SUBSTRATE_REBUILD_MODEL.steps.find((s) => s.id === 38);
        expect(aggregateStepCost(step38, SUBSTRATE_REBUILD_MODEL, {
            bySession: { 4: { wallSecs: 120, tokens: 0 } },
            sessionIdsByRequirement: { 3111: [4] },
            byRequirement: { 3111: { wallSecs: 120, tokens: 0 } },
        })).toEqual({ wallSecs: 120, tokens: 0 });
    });

    it('sumReqCost tolerates missing ids, a null index and partial entries', () => {
        expect(sumReqCost(null, null)).toEqual({ wallSecs: 0, tokens: 0 });
        expect(sumReqCost([1, 2], null)).toEqual({ wallSecs: 0, tokens: 0 });
        // A half-built index (no bySession) is treated as no data, not a crash.
        expect(sumReqCost([1], { sessionIdsByRequirement: { 1: [7] } }))
            .toEqual({ wallSecs: 0, tokens: 0 });
        // A TRUTHY non-iterable slips past a `|| []` guard and throws `not
        // iterable` — inside orderedPlan, inside a useMemo, blanking the whole
        // plan page rather than showing a dash.
        expect(sumReqCost([1], { bySession: {}, sessionIdsByRequirement: { 1: 7 } }))
            .toEqual({ wallSecs: 0, tokens: 0 });
        expect(sumReqCost('not an array', { bySession: {}, sessionIdsByRequirement: {} }))
            .toEqual({ wallSecs: 0, tokens: 0 });
        expect(sumReqCost([1, 2], {
            bySession: { 7: { wallSecs: 60 }, 8: { tokens: 10 } },
            sessionIdsByRequirement: { 1: [7], 2: [8] },
        })).toEqual({ wallSecs: 60, tokens: 10 });
    });

    it('a req-less step costs nothing — there is nothing linked to attribute cost to', () => {
        // Fixture step 7 ("record the regression baseline") links no requirements.
        const row7 = buildPlanRows(SUBSTRATE_REBUILD_MODEL).find((r) => r.id === 7);
        expect(row7.reqIds).toEqual([]);
        const cost = aggregateRowCost(row7, INDEX);
        expect(fmtCost(cost.wallSecs, cost.tokens)).toBe('—');
    });
});
