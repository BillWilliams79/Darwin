// pipelineModel tests (req #3112) — POC parity against the archived req #3080
// generate.py, seeded invariant violations, the four named ordering regressions,
// batch lettering + /swarm-start args, dual-condition gate eligibility, req-less
// step derivation, cross-epic labeling, machine/cost units. Static fixtures only —
// no DB, no fetch.
import { describe, it, expect } from 'vitest';

import {
    STEP_DONE, STEP_RUNNING, STEP_PENDING,
    deriveStepState, buildPlanRows, displayOrder, verifyOrder,
    eligibility, launchBatches,
    dominantLabels, machineLabels, fmtCost, aggregateStepCost,
    aggregateRowCost, sumReqCost, requirementCounts, isTrackingRequirement,
    pauseState, PAUSED_STATUS,
    LAUNCHABLE_REQUIREMENT_STATUSES, EXCLUDED_CONTAINER, EXCLUDED_UNRESOLVED,
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
        // req #3188 — the launch key's epic term is the epic ID, not the title,
        // so a targeted case that means to exercise the epic partition must set
        // `epicId`. `epic` alone is a display label here: buildPlanRows always
        // emits both, and the POC-parity fixtures below carry titles only
        // because the archived plan had no epic ids to carry.
        epicId: opts.epicId !== undefined ? opts.epicId : null,
        epic: opts.epic !== undefined ? opts.epic : null,
        feature: opts.feature !== undefined ? opts.feature : null,
        reqIds: opts.reqIds || [],
        trackingReqIds: opts.trackingReqIds || [],
        // req #3360 — `launchableReqIds` READS this field rather than
        // recomputing it, because `buildPlanRows` is the one place with the
        // requirement rows in hand. A hand-built row must therefore carry it,
        // exactly as it already carries `state` and `epicId` rather than
        // deriving them. DEFAULTS TO `reqIds` minus the containers, which is
        // what `buildPlanRows` produces for the all-`swarm_ready` step every
        // batching test here means to describe; a case that means to exercise
        // the STATUS filter sets the two apart explicitly.
        launchReqIds: opts.launchReqIds !== undefined
            ? opts.launchReqIds
            : (opts.reqIds || []).filter(
                (rid) => !(opts.trackingReqIds || []).includes(rid)),
        launchExcluded: opts.launchExcluded !== undefined
            ? opts.launchExcluded
            : (opts.trackingReqIds || []).map(
                (rid) => `${rid} ${EXCLUDED_CONTAINER}`),
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

describe('the tracking exemption — a container is not work (req #3123)', () => {
    const step = { id: 1, completed_at: null };
    const stamped = { id: 1, completed_at: '2026-07-26T01:30:00' };
    const work = (status, id = 9) => ({ id, requirement_status: status });
    const container = (status, id = 8) => ({ id, requirement_status: status, tracking: 1 });

    it('a container in development does NOT make a step running', () => {
        // The whole bug: before the flag, this returned STEP_RUNNING and the
        // step stayed there for the life of the plan.
        expect(deriveStepState(step, [work('met'), container('development')]))
            .toBe(STEP_DONE);
    });

    it('an ALL-container step derives from its own completed_at, exactly like a '
        + 'req-less step — never running', () => {
        expect(deriveStepState(step, [container('development')])).toBe(STEP_PENDING);
        expect(deriveStepState(stamped, [container('development')])).toBe(STEP_DONE);
        // Same two answers a step with no links at all gives, which is the point:
        // subtracting the containers leaves nothing to derive from.
        expect(deriveStepState(step, [])).toBe(STEP_PENDING);
        expect(deriveStepState(stamped, [])).toBe(STEP_DONE);
    });

    it('a container never blocks a done, and never rescues a pending', () => {
        expect(deriveStepState(step, [work('met'), container('met')])).toBe(STEP_DONE);
        expect(deriveStepState(step, [work('approved'), container('met')]))
            .toBe(STEP_PENDING);
        // A container's own status is irrelevant in every direction.
        expect(deriveStepState(step, [work('met'), container('approved')]))
            .toBe(STEP_DONE);
    });

    it('the flag coerces NUMERICALLY, matching the Python readers — "0" is WORK, '
        + 'not a container', () => {
        // Boolean("0") is true, so a bare truthiness check would read a
        // stringified zero as a container and stop a real requirement from
        // gating its step. That is the one input class where this function could
        // disagree with the pre-#3123 derivation, and with the Python engines
        // (_is_tracking / is_tracking, both int()-based).
        for (const t of [1, true, '1', 2, '2']) {
            expect(deriveStepState(step, [{ id: 8, requirement_status: 'development', tracking: t }]))
                .toBe(STEP_PENDING);
        }
        for (const t of [0, false, null, undefined, '', '0', 'false', ' ', 'x']) {
            expect(deriveStepState(step, [{ id: 8, requirement_status: 'development', tracking: t }]))
                .toBe(STEP_RUNNING);
        }
    });

    it('a container has no opinion about the MACHINE a step runs on — it runs '
        + 'nowhere, and the machine set is a LAUNCH parameter', () => {
        const model = {
            steps: [{ id: 1, completed_at: null }],
            stepRequirements: [
                { step_fk: 1, requirement_fk: 500 },
                { step_fk: 1, requirement_fk: 600 },
            ],
            stepDeps: [],
            requirements: [
                { id: 500, requirement_status: 'swarm_ready', machine_fk: null },
                { id: 600, requirement_status: 'development', machine_fk: 3, tracking: 1 },
            ],
            features: [], epics: [], machines: [{ id: 3, title: 'WSL' }],
        };
        expect(machineLabels(model.steps[0], model).labels).toEqual(['Any']);
        const [row] = buildPlanRows(model);
        expect(row.machineLabel).toBe('Any');
    });

    it('regression: a container\'s machine pin must not split a launch batch', () => {
        // Before the machineLabels filter, these two launch-identical steps had
        // different launchKeys — the batch vanished, and with it the letter and
        // the /swarm-start command. Reachable only since the exemption, because a
        // step linking a container used to derive Running and never reach
        // pendingGroups at all.
        const model = {
            steps: [
                { id: 1, completed_at: '2026-07-26T01:30:00' },
                { id: 2, completed_at: null },
                { id: 3, completed_at: null },
            ],
            stepRequirements: [
                { step_fk: 2, requirement_fk: 500 },
                { step_fk: 2, requirement_fk: 600 },
                { step_fk: 3, requirement_fk: 501 },
            ],
            stepDeps: [
                { step_fk: 2, dep_step_fk: 1, time_at: null },
                { step_fk: 3, dep_step_fk: 1, time_at: null },
            ],
            requirements: [
                { id: 500, requirement_status: 'swarm_ready', machine_fk: null },
                { id: 501, requirement_status: 'swarm_ready', machine_fk: null },
                { id: 600, requirement_status: 'development', machine_fk: 3, tracking: 1 },
            ],
            features: [], epics: [], machines: [{ id: 3, title: 'WSL' }],
        };
        const ordered = displayOrder(buildPlanRows(model));
        const [batch] = launchBatches(ordered.rows);
        expect(batch).toBeDefined();
        expect(batch.stepIds).toEqual([2, 3]);
        expect(batch.swarmStartArgs).toEqual([500, 501]);
        expect(batch.machineLabels).toEqual(['Any']);
    });

    it('fixture step 19 — the recorded divergence — now derives done, and it is '
        + 'the MIXED case: two work reqs met, one container in development', () => {
        const rows = buildPlanRows(SUBSTRATE_REBUILD_MODEL);
        const byId = new Map(rows.map((r) => [r.id, r]));
        const step19 = byId.get(19);
        expect(step19.reqIds).toEqual([3080, 3083, 3105]);
        expect(step19.trackingReqIds).toEqual([3083]);
        // The container really is still in development — the fixture is not
        // fudged to make the arithmetic work.
        const req3083 = SUBSTRATE_REBUILD_MODEL.requirements.find((r) => r.id === 3083);
        expect(req3083.requirement_status).toBe('development');
        expect(step19.state).toBe(STEP_DONE);
    });

    it('every fixture step still reproduces its PLAN-JSON state — 100%, with the '
        + 'container carrying its REAL status', () => {
        const byId = new Map(buildPlanRows(SUBSTRATE_REBUILD_MODEL).map((r) => [r.id, r]));
        const diverged = PLAN_JSON_ROWS
            .filter((r) => byId.get(Number(r.step)).state !== PLAN_STATE[r.state])
            .map((r) => r.step);
        expect(diverged).toEqual([]);
    });

    it('reqIds stays COMPLETE so the table links and the cost rollup see every '
        + 'requirement; only trackingReqIds marks the containers', () => {
        const byId = new Map(buildPlanRows(SUBSTRATE_REBUILD_MODEL).map((r) => [r.id, r]));
        // Cost must still union #3083's sessions — the work happened.
        expect(byId.get(19).reqIds).toContain(3083);
        // And no other fixture step claims a container.
        const withTracking = [...byId.values()]
            .filter((r) => r.trackingReqIds.length).map((r) => r.id);
        expect(withTracking).toEqual([19]);
    });

    it('rule 8: a container is never a /swarm-start argument', () => {
        // Two pending steps sharing a gate, one of which links a container.
        const rows = [
            row(1, STEP_DONE),
            row(2, STEP_PENDING, [1], { reqIds: [100, 200], trackingReqIds: [200] }),
            row(3, STEP_PENDING, [1], { reqIds: [300], trackingReqIds: [] }),
        ];
        const [batch] = launchBatches(displayOrder(rows).rows);
        expect(batch.swarmStartArgs).toEqual([100, 300]);
        expect(batch.swarmStartCommand).toBe('/swarm-start 100 300');
    });

    it('rule 8: a batch whose ONLY requirements are containers emits no command, '
        + 'never an argument-less one', () => {
        const rows = [
            row(1, STEP_DONE),
            row(2, STEP_PENDING, [1], { reqIds: [200], trackingReqIds: [200] }),
            row(3, STEP_PENDING, [1], { reqIds: [201], trackingReqIds: [201] }),
        ];
        const [batch] = launchBatches(displayOrder(rows).rows);
        expect(batch.swarmStartArgs).toEqual([]);
        expect(batch.swarmStartCommand).toBeNull();
    });

    it('rule 10 is NOT filtered: a container still contributes its epic/feature '
        + 'and machine labels', () => {
        const byId = new Map(buildPlanRows(SUBSTRATE_REBUILD_MODEL).map((r) => [r.id, r]));
        const step19 = byId.get(19);
        // #3080 and #3083 both sit under feature 112 (Swarm Orchestration
        // Feature); dropping the container would take the count 2 -> 1 and let
        // #3105's cross-epic label tie and win on first appearance.
        expect(step19.epic).toBe('Swarm Orchestration Feature');
        expect(step19.epicLabels.map((e) => e.title))
            .toEqual(['Swarm Orchestration Feature', 'Swarm Substrate Rebuild']);
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
        // Step 2 is PENDING, not done, and that is load-bearing since req #3188:
        // the key's gate term is the REMAINING gate, so with step 2 also closed
        // both pairs would have an empty gate and correctly become ONE batch —
        // and this test would have stopped testing lettering across two.
        const stored = [
            row(1, STEP_DONE),
            row(2, STEP_PENDING, [1]),
            // batch behind the still-OPEN gate 2 (deeper stream → launches first)
            row(10, STEP_PENDING, [2], { reqIds: [3115, 3116], machines: ['Mac mini'] }),
            row(11, STEP_PENDING, [2], { reqIds: [3117], machines: ['Mac mini'] }),
            // batch whose gate 1 is already closed → remaining gate empty
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
        expect(batches[1].gateStepIds).toEqual([]);
        expect(batches[1].swarmStartCommand).toBe('/swarm-start 3113 3114');
    });

    it('groups two steps whose gates differ ONLY in already-done deps (req #3188)', () => {
        // DEFECT 2. Step 10's gate is step 1, which is Complete; step 11 has no
        // gate at all. Their REMAINING gates are both empty, so they become
        // eligible at the same instant and are one launch unit — under the raw
        // dep set they hashed apart and the engine emitted two /swarm-start
        // commands where the batching model says one.
        const stored = [
            row(1, STEP_DONE),
            row(10, STEP_PENDING, [1], { reqIds: [7], epicId: 1 }),
            row(11, STEP_PENDING, [], { reqIds: [8], epicId: 1 }),
        ];
        const batches = launchBatches(displayOrder(stored).rows);
        expect(batches).toHaveLength(1);
        expect(batches[0].stepIds.slice().sort()).toEqual([10, 11]);
        expect(batches[0].gateStepIds).toEqual([]);
        expect(batches[0].swarmStartArgs.slice().sort()).toEqual([7, 8]);
    });

    it('still splits when the remaining gates differ (req #3188)', () => {
        // The other direction, in the same terms: step 1 is Complete and step 2
        // is not, so step 10 has an empty remaining gate and step 11 does not.
        // The fix WIDENS the grouping; it does not dissolve it.
        const stored = [
            row(1, STEP_DONE),
            row(2, STEP_PENDING),
            row(10, STEP_PENDING, [1], { reqIds: [7], epicId: 1 }),
            row(11, STEP_PENDING, [2], { reqIds: [8], epicId: 1 }),
        ];
        expect(launchBatches(displayOrder(stored).rows)).toEqual([]);
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

    it('never MANUFACTURES a cross-epic batch — the group partitions by epic '
       + '(req #3188)', () => {
        // THIS TEST USED TO ASSERT THE OPPOSITE, citing rule 10's "a launch unit
        // may legitimately cross epics". That permission is about a step that
        // ALREADY spans epics — what the dominant-label tiebreak exists to
        // resolve — and never licensed MERGING two cleanly-owned steps into one.
        // Req #3184 made epic -> orchestrator a function: one epic, one Primary,
        // and "two orchestrators can never select the same requirement for
        // launch". A merged row hands one epic's requirements to the other
        // epic's Primary, and the losing epic's work leaves its owner's slice
        // silently. Measured live on pipeline 2 (2026-08-01): one group held
        // four epic-6 steps together with six epic-7 steps.
        const stored = [
            row(1, STEP_DONE),
            row(10, STEP_PENDING, [1], { epicId: 1, epic: 'Substrate', reqIds: [7] }),
            row(11, STEP_PENDING, [1], { epicId: 2, epic: 'Application', reqIds: [8] }),
        ];
        expect(launchBatches(displayOrder(stored).rows)).toEqual([]);
    });

    it('partitions a shared key into one batch PER epic, keeping the same-epic '
       + 'subsets (req #3188)', () => {
        // The fix PARTITIONS; it does not suppress. On the live nine-step
        // group that means two good batches, not zero.
        const stored = [
            row(1, STEP_DONE),
            row(10, STEP_PENDING, [1], { epicId: 1, epic: 'Substrate', reqIds: [7] }),
            row(11, STEP_PENDING, [1], { epicId: 1, epic: 'Substrate', reqIds: [8] }),
            row(12, STEP_PENDING, [1], { epicId: 2, epic: 'Application', reqIds: [9] }),
            row(13, STEP_PENDING, [1], { epicId: 2, epic: 'Application', reqIds: [10] }),
        ];
        const batches = launchBatches(displayOrder(stored).rows);
        expect(batches).toHaveLength(2);
        expect(batches.map((b) => b.stepIds)).toEqual([[10, 11], [12, 13]]);
        expect(batches.map((b) => b.epicId)).toEqual([1, 2]);
        expect(batches.map((b) => b.swarmStartArgs)).toEqual([[7, 8], [9, 10]]);
    });

    it('a step that ALREADY spans epics keys under its DOMINANT one (rule 10)', () => {
        // Rule 10's permission, preserved: step 12 links requirements from both
        // epics, derives epic 1 as dominant, and joins epic 1's batch. The
        // partition is by DOMINANT label — it does not refuse anything
        // multi-epic, which would have been the over-correction.
        const model = {
            steps: [
                { id: 10, title: 'a', run: 'auto', completed_at: null },
                { id: 11, title: 'b', run: 'auto', completed_at: null },
                { id: 12, title: 'spans both', run: 'auto', completed_at: null },
            ],
            stepRequirements: [
                { step_fk: 10, requirement_fk: 70 },
                { step_fk: 11, requirement_fk: 71 },
                { step_fk: 12, requirement_fk: 72 },
                { step_fk: 12, requirement_fk: 73 },
                { step_fk: 12, requirement_fk: 74 },
            ],
            stepDeps: [],
            requirements: [
                { id: 70, requirement_status: 'swarm_ready', feature_fk: 1, machine_fk: null },
                { id: 71, requirement_status: 'swarm_ready', feature_fk: 1, machine_fk: null },
                { id: 72, requirement_status: 'swarm_ready', feature_fk: 1, machine_fk: null },
                { id: 73, requirement_status: 'swarm_ready', feature_fk: 1, machine_fk: null },
                { id: 74, requirement_status: 'swarm_ready', feature_fk: 2, machine_fk: null },
            ],
            features: [{ id: 1, title: 'F1', epic_fk: 1 }, { id: 2, title: 'F2', epic_fk: 2 }],
            epics: [{ id: 1, title: 'E1' }, { id: 2, title: 'E2' }],
            machines: [],
        };
        const rows = buildPlanRows(model);
        const spanning = rows.find((r) => r.id === 12);
        expect(spanning.epicId).toBe(1);
        expect(spanning.epicLabels.map((e) => e.id)).toEqual([1, 2]);
        const batches = launchBatches(displayOrder(rows).rows);
        expect(batches).toHaveLength(1);
        expect(batches[0].stepIds).toEqual([10, 11, 12]);
        expect(batches[0].epicId).toBe(1);
    });
});

// These four cases were written against the condensation advisory req #3303
// DELETED. Every one of them was really testing the pendingGroups/launchKey
// PARTITION the advisory only read, so they are RE-POINTED at `launchBatches`
// rather than deleted with it — the partition is what the advisory shared with
// the launch machinery, and it is still the thing that must not regress.
describe('launch-unit partition — the shared pendingGroups/launchKey machinery', () => {
    it('groups same-(gate, run, machine) pending steps into one batch', () => {
        const rows = [
            row(1, STEP_DONE),
            row(10, STEP_PENDING, [1], { reqIds: [7], machines: ['Mac mini'] }),
            row(11, STEP_PENDING, [1], { reqIds: [8], machines: ['Mac mini'] }),
            row(12, STEP_PENDING, [1], { reqIds: [9], run: 'manual' }),
        ];
        const batches = launchBatches(displayOrder(rows).rows);
        expect(batches).toHaveLength(1);
        expect(batches[0]).toMatchObject({
            stepIds: [10, 11],
            swarmStartArgs: [7, 8],
            gateStepIds: [],
            run: 'auto',
            machineLabels: ['Mac mini'],
        });
    });

    it('groups nothing when every pending step has a distinct launch key', () => {
        expect(launchBatches(displayOrder([
            row(10, STEP_PENDING, [1], { reqIds: [7] }),
            row(11, STEP_PENDING, [2], { reqIds: [8] }),
        ]).rows)).toEqual([]);
    });

    it('NEVER groups across more than one dominant epic, and keeps the '
       + 'same-epic subsets instead (req #3188)', () => {
        // The live defect, reduced: one group held four epic-6 steps and six
        // epic-7 steps. Launching it would have handed one epic's requirements
        // to the other epic's Primary. The required behaviour is to PARTITION,
        // not to suppress — the bad group becomes two good ones.
        const rows = [
            row(1, STEP_DONE),
            row(55, STEP_PENDING, [1], { epicId: 6, epic: 'Mapping', reqIds: [3201] }),
            row(57, STEP_PENDING, [1], { epicId: 6, epic: 'Mapping', reqIds: [3202] }),
            row(70, STEP_PENDING, [1], { epicId: 7, epic: 'Backlog', reqIds: [3203] }),
            row(71, STEP_PENDING, [1], { epicId: 7, epic: 'Backlog', reqIds: [3204] }),
        ];
        const batches = launchBatches(displayOrder(rows).rows);
        expect(batches).toHaveLength(2);
        expect(batches.map((b) => b.stepIds)).toEqual([[55, 57], [70, 71]]);
        expect(batches.map((b) => b.epicId)).toEqual([6, 7]);
        expect(batches.map((b) => b.swarmStartArgs))
            .toEqual([[3201, 3202], [3203, 3204]]);
    });

    it('no batch over the Substrate Rebuild fixture resolves more than one '
       + 'dominant epic — the invariant, over real plan data (req #3188)', () => {
        // Pinned rather than observed once. The fixture's own shape is not the
        // point: the assertion is a PROPERTY of every batch the engine can emit
        // from it, and it is stated over the full model rather than over a
        // constructed pair, so a future change to the fixture cannot quietly
        // stop exercising it.
        //
        // Two model variants, because the stock fixture's nearest pair differs
        // in run mode and yields no batch at all: flipping step 43 to auto
        // produces the first genuine batch in the Substrate data.
        const variants = [
            SUBSTRATE_REBUILD_MODEL,
            {
                ...SUBSTRATE_REBUILD_MODEL,
                steps: SUBSTRATE_REBUILD_MODEL.steps.map(
                    (s) => (s.id === 43 ? { ...s, run: 'auto' } : s)),
            },
        ];
        let seen = 0;
        for (const model of variants) {
            const rows = buildPlanRows(model);
            const byId = new Map(rows.map((r) => [r.id, r]));
            for (const batch of launchBatches(displayOrder(rows).rows)) {
                seen += 1;
                const epics = new Set(batch.stepIds.map((id) => byId.get(id).epicId));
                expect(epics.size, `batch ${batch.letter}`).toBe(1);
                expect([...epics][0]).toBe(batch.epicId);
            }
        }
        // A vacuous pass is not a pass: at least one batch must have existed.
        expect(seen).toBeGreaterThan(0);
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
        // 27 batches split on MACHINE, not on gate. Since req #3188 the key's
        // gate term is the REMAINING gate, and all 27 gate steps are Complete —
        // so keying the split on the gate would collapse every pair into one
        // 54-member batch and this test would letter one batch, not 27. The
        // subject here is the lettering, so the split moves to the term that
        // still distinguishes them.
        const stored = [];
        for (let g = 1; g <= 27; g++) {
            stored.push(row(g, STEP_DONE));
        }
        for (let g = 1; g <= 27; g++) {
            stored.push(row(100 + g * 2, STEP_PENDING, [g],
                { reqIds: [1000 + g], machines: [`M${g}`] }));
            stored.push(row(101 + g * 2, STEP_PENDING, [g],
                { reqIds: [2000 + g], machines: [`M${g}`] }));
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
        });
        const posn = new Map(ids(result.rows).map((id, i) => [id, i]));
        expect(Math.abs(posn.get(41) - posn.get(43))).toBe(1);

        // req #3360, ON THE REAL FIXTURE AND WITHOUT EDITING IT. #3118 and
        // #3108 are both `approved` here — the fixture header says pending rows
        // were given `approved/swarm_ready` interchangeably, because before this
        // requirement the two behaved identically. They no longer do, and the
        // batch forms exactly as before while carrying NO command.
        expect(batches[0].swarmStartArgs).toEqual([]);
        expect(batches[0].swarmStartCommand).toBeNull();
        expect(batches[0].noLaunchReason)
            .toBe('nothing launchable — only swarm_ready launches: '
                + '3118 approved, 3108 approved');
        expect(batches[0].launchExcluded).toEqual(['3118 approved', '3108 approved']);

        // And the SAME plan with those two moved to `swarm_ready` derives the
        // exact command this test was written for — which is what keeps the
        // lettering/gate/machine assertions above tied to a real launch.
        const ready = SUBSTRATE_REBUILD_MODEL.requirements.map(
            (r) => ([3118, 3108].includes(r.id)
                ? { ...r, requirement_status: 'swarm_ready' } : r));
        const readyBatches = launchBatches(displayOrder(buildPlanRows(
            { ...SUBSTRATE_REBUILD_MODEL, steps, requirements: ready })).rows);
        expect(readyBatches[0].swarmStartArgs).toEqual([3118, 3108]);
        expect(readyBatches[0].swarmStartCommand).toBe('/swarm-start 3118 3108');
        expect(readyBatches[0].noLaunchReason).toBeNull();
        expect(readyBatches[0].launchExcluded).toEqual([]);
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

describe('requirementCounts — met/total, per epic and for the whole plan (req #3225, req #3269)', () => {
    const model = (requirements, features = [], epics = []) => ({ requirements, features, epics });

    it('counts met over total, excluding nothing but tracking containers', () => {
        const m = model([
            { id: 1, requirement_status: 'met', feature_fk: 101 },
            { id: 2, requirement_status: 'development', feature_fk: 101 },
            { id: 3, requirement_status: 'approved', feature_fk: 101 },
        ], [{ id: 101, title: 'F', epic_fk: 1 }], [{ id: 1, title: 'E' }]);
        expect(requirementCounts(m)).toEqual({
            overall: { met: 1, total: 3 },
            byEpic: [{ epicId: 1, met: 1, total: 3 }],
        });
    });

    it('excludes a TRACKING requirement from both the numerator and the denominator', () => {
        // req #3123's container exemption, applied to the ratio: a container
        // carries no acceptance criteria of its own, so counting it either way
        // would make a self-tracking plan read as permanently short of — or
        // trivially at — 100%.
        const m = model([
            { id: 1, requirement_status: 'met', feature_fk: 101 },
            // met AND tracking — if tracking exclusion ran second, or not at
            // all, this would inflate the numerator too.
            { id: 2, requirement_status: 'met', tracking: 1, feature_fk: 101 },
        ], [{ id: 101, title: 'F', epic_fk: 1 }], [{ id: 1, title: 'E' }]);
        expect(requirementCounts(m)).toEqual({
            overall: { met: 1, total: 1 },
            byEpic: [{ epicId: 1, met: 1, total: 1 }],
        });
    });

    it('a stringified tracking zero is WORK, matching isTrackingRequirement elsewhere', () => {
        const m = model([
            { id: 1, requirement_status: 'met', tracking: '0', feature_fk: 101 },
        ], [{ id: 101, title: 'F', epic_fk: 1 }], [{ id: 1, title: 'E' }]);
        expect(requirementCounts(m).overall).toEqual({ met: 1, total: 1 });
    });

    it('wontfix and deferred count toward the numerator, exactly like met '
        + '(req #3269, correcting req #3225)', () => {
        // Both sit in TERMINAL_REQUIREMENT_STATUSES — the same set that
        // already makes a step derive `done` — so an epic whose only
        // non-met requirement is deferred/wontfix must read N/N, not one
        // short.
        const m = model([
            { id: 1, requirement_status: 'met', feature_fk: 101 },
            { id: 2, requirement_status: 'wontfix', feature_fk: 101 },
            { id: 3, requirement_status: 'deferred', feature_fk: 101 },
        ], [{ id: 101, title: 'F', epic_fk: 1 }], [{ id: 1, title: 'E' }]);
        expect(requirementCounts(m)).toEqual({
            overall: { met: 3, total: 3 },
            byEpic: [{ epicId: 1, met: 3, total: 3 }],
        });
    });

    it('authoring/approved/swarm_ready/development stay outstanding', () => {
        const m = model([
            { id: 1, requirement_status: 'met', feature_fk: 101 },
            { id: 2, requirement_status: 'authoring', feature_fk: 101 },
            { id: 3, requirement_status: 'approved', feature_fk: 101 },
            { id: 4, requirement_status: 'swarm_ready', feature_fk: 101 },
            { id: 5, requirement_status: 'development', feature_fk: 101 },
        ], [{ id: 101, title: 'F', epic_fk: 1 }], [{ id: 1, title: 'E' }]);
        expect(requirementCounts(m)).toEqual({
            overall: { met: 1, total: 5 },
            byEpic: [{ epicId: 1, met: 1, total: 5 }],
        });
    });

    it('groups by the REQUIREMENT\'S OWN feature->epic chain, not a step\'s dominant epic', () => {
        // Two epics, one requirement apiece — no steps are involved at all,
        // which is the point: the count is a property of the requirement,
        // independent of which step (if any) links it.
        const m = model([
            { id: 1, requirement_status: 'met', feature_fk: 101 },
            { id: 2, requirement_status: 'development', feature_fk: 102 },
        ], [
            { id: 101, title: 'F1', epic_fk: 11 },
            { id: 102, title: 'F2', epic_fk: 12 },
        ], [{ id: 11, title: 'E1' }, { id: 12, title: 'E2' }]);
        expect(requirementCounts(m)).toEqual({
            overall: { met: 1, total: 2 },
            byEpic: [
                { epicId: 11, met: 1, total: 1 },
                { epicId: 12, met: 0, total: 1 },
            ],
        });
    });

    it('a requirement with no resolvable feature/epic counts toward overall only', () => {
        const m = model([
            { id: 1, requirement_status: 'met', feature_fk: null },
            { id: 2, requirement_status: 'met', feature_fk: 999 }, // unknown feature
        ], [{ id: 101, title: 'F', epic_fk: 1 }], [{ id: 1, title: 'E' }]);
        expect(requirementCounts(m)).toEqual({ overall: { met: 2, total: 2 }, byEpic: [] });
    });

    it('byEpic sorts by epic id ascending, independent of requirement or feature order', () => {
        const m = model([
            { id: 1, requirement_status: 'met', feature_fk: 202 },
            { id: 2, requirement_status: 'met', feature_fk: 201 },
        ], [
            { id: 202, title: 'F2', epic_fk: 22 },
            { id: 201, title: 'F1', epic_fk: 21 },
        ], [{ id: 21, title: 'E1' }, { id: 22, title: 'E2' }]);
        expect(requirementCounts(m).byEpic.map((b) => b.epicId)).toEqual([21, 22]);
    });

    it('tolerates an absent requirements/features list rather than throwing', () => {
        expect(requirementCounts({})).toEqual({ overall: { met: 0, total: 0 }, byEpic: [] });
        expect(requirementCounts({ requirements: [null, undefined] }))
            .toEqual({ overall: { met: 0, total: 0 }, byEpic: [] });
    });

    it('on the Substrate Rebuild fixture: excludes exactly the one tracking '
        + 'requirement (#3083) and matches an independent reduce', () => {
        const reqs = SUBSTRATE_REBUILD_MODEL.requirements;
        const trackingIds = reqs.filter(isTrackingRequirement).map((r) => r.id);
        expect(trackingIds).toEqual([3083]);
        const observed = requirementCounts(SUBSTRATE_REBUILD_MODEL);
        const nonTracking = reqs.filter((r) => !trackingIds.includes(r.id));
        expect(observed.overall.total).toBe(nonTracking.length);
        // Literal set, not the imported constant — this must stay an INDEPENDENT
        // reduce, so a regression that silently grows or shrinks
        // TERMINAL_REQUIREMENT_STATUSES still fails this assertion.
        expect(observed.overall.met).toBe(
            nonTracking.filter((r) => ['met', 'deferred', 'wontfix']
                .includes(r.requirement_status)).length);
        // #3083 is `development` and would have moved the numerator toward
        // zero-relative-to-itself either way, but it must not appear in ANY
        // epic bucket at all — this is the one requirement excluded outright.
        const featuresById = new Map(SUBSTRATE_REBUILD_MODEL.features.map((f) => [f.id, f]));
        const trackingEpicId = featuresById.get(
            reqs.find((r) => r.id === 3083).feature_fk)?.epic_fk;
        const trackingBucket = observed.byEpic.find((b) => b.epicId === trackingEpicId);
        const expectedBucketTotal = nonTracking.filter((r) => {
            const f = r.feature_fk != null ? featuresById.get(r.feature_fk) : null;
            return f && f.epic_fk === trackingEpicId;
        }).length;
        expect(trackingBucket.total).toBe(expectedBucketTotal);
    });
});

describe('pauseState — plan-paused OR dominant-epic-paused suppresses launch (req #3226)', () => {
    const rows = (...epicIds) => epicIds.map((epicId, i) => ({ id: i + 1, epicId }));

    it('an unpaused plan with no paused epics suppresses nothing', () => {
        const model = { pipeline: { pipeline_status: 'active' }, epics: [{ id: 1 }] };
        const r = rows(1, null);
        const pause = pauseState(model, r);
        expect(pause).toEqual({
            pipelineStatus: 'active', pipelinePaused: false,
            pausedEpicIds: [], suppressedStepIds: [],
        });
        expect(r.every((row) => row.launchSuppressed === false)).toBe(true);
        expect(r.every((row) => row.suppressedBy.length === 0)).toBe(true);
    });

    it('a paused PLAN suppresses every row, including the "No epic" band', () => {
        const model = { pipeline: { pipeline_status: PAUSED_STATUS }, epics: [] };
        const r = rows(1, 2, null);
        const pause = pauseState(model, r);
        expect(pause.pipelinePaused).toBe(true);
        expect(pause.suppressedStepIds).toEqual([1, 2, 3]);
        expect(r.every((row) => row.launchSuppressed)).toBe(true);
        expect(r.every((row) => row.suppressedBy.length > 0)).toBe(true);
        expect(r[0].suppressedBy).toEqual(['pipeline']);
    });

    it('a paused EPIC suppresses only ITS rows, leaving neighbour epics untouched', () => {
        const model = {
            pipeline: { pipeline_status: 'active' },
            epics: [{ id: 1, epic_status: PAUSED_STATUS }, { id: 2, epic_status: 'active' }],
        };
        const r = rows(1, 2, null);
        const pause = pauseState(model, r);
        expect(pause.pipelinePaused).toBe(false);
        expect(pause.pausedEpicIds).toEqual([1]);
        expect(pause.suppressedStepIds).toEqual([1]);
        expect(r[0].launchSuppressed).toBe(true);
        expect(r[0].suppressedBy).toEqual(['epic']);
        expect(r[1].launchSuppressed).toBe(false);
        expect(r[2].launchSuppressed).toBe(false);
    });

    it('BOTH reasons are named, not a winner, when plan and epic are both paused', () => {
        const model = {
            pipeline: { pipeline_status: PAUSED_STATUS },
            epics: [{ id: 1, epic_status: PAUSED_STATUS }],
        };
        const r = rows(1);
        pauseState(model, r);
        expect(r[0].suppressedBy).toEqual(['pipeline', 'epic']);
    });

    it('a missing epic_status reads as active — the column default', () => {
        const model = { pipeline: { pipeline_status: 'active' }, epics: [{ id: 1 }] };
        const r = rows(1);
        pauseState(model, r);
        expect(r[0].launchSuppressed).toBe(false);
    });

    it('pausedEpicIds is sorted ascending regardless of epic array order', () => {
        const model = {
            pipeline: { pipeline_status: 'active' },
            epics: [
                { id: 22, epic_status: PAUSED_STATUS },
                { id: 11, epic_status: PAUSED_STATUS },
            ],
        };
        expect(pauseState(model, rows(22, 11)).pausedEpicIds).toEqual([11, 22]);
    });

    it('pausedEpicIds is scoped to THIS plan — a paused epic no row here links '
        + 'is not reported (model.epics is the whole dictionary, unlike the '
        + "server's already-scoped composed read)", () => {
        const model = {
            pipeline: { pipeline_status: 'active' },
            epics: [
                { id: 1, epic_status: PAUSED_STATUS },
                { id: 99, epic_status: PAUSED_STATUS }, // no row links this plan
            ],
        };
        const pause = pauseState(model, rows(1, null));
        expect(pause.pausedEpicIds).toEqual([1]);
    });

    it('tolerates an absent pipeline/epics/rows rather than throwing', () => {
        expect(pauseState({}, [])).toEqual({
            pipelineStatus: undefined, pipelinePaused: false,
            pausedEpicIds: [], suppressedStepIds: [],
        });
        expect(() => pauseState({}, undefined)).not.toThrow();
    });
});

// ── req #3192 — the canonical time-gate grammar ──────────────────────────────

describe('time gates parse an explicit canonical grammar', () => {
    // `toEpochMs` is private, so these go through `eligibility`, which is the
    // observable behaviour anyway: a gate either passes or it does not.
    const gate = (timeAt, now) => eligibility(
        { id: 1, state: STEP_PENDING, depIds: [], timeDeps: [timeAt] },
        [{ id: 1, state: STEP_PENDING, depIds: [], timeDeps: [timeAt] }],
        now);
    const AFTER = '2026-07-31T00:00:00';

    it('accepts every canonical spelling of the same instant', () => {
        // Naive is UTC, never local — reading a no-offset datetime as local time
        // would shift every gate by the machine's offset, and a gate seven hours
        // early is a gate that is already satisfied.
        for (const t of ['2026-07-30', '2026-07-30T00:00', '2026-07-30T00:00:00',
            '2026-07-30 00:00:00', '2026-07-30T00:00:00Z', '2026-07-30T00:00:00z',
            '2026-07-30T00:00:00+00:00', '2026-07-30T05:00:00+05:00',
            '2026-07-29T19:00:00-05:00', '2026-07-30T00:00:00.123']) {
            expect(gate(t, AFTER), `${t} must pass a later clock`).toBe(true);
            expect(gate(t, '2026-07-29T00:00:00'), `${t} must not pass an earlier clock`)
                .toBe(false);
        }
    });

    it('rejects every spelling the two engines used to disagree on', () => {
        // The req #3184 review probed 23 formats x 4 clocks and found 12
        // disagreements IN BOTH DIRECTIONS: Date.parse took the first three,
        // fromisoformat took the last four. Both engines now reject all of them,
        // which is the safe direction — an unparseable gate read as PASSED
        // launches work early.
        for (const t of ['2026/07/30 00:00:00', '30 Jul 2026', '2026-07-30T24:00:00',
            ' 2026-07-30T00:00:00 ', '20260730T000000', '2026-07-30T00:00:00Z ',
            '2026-07-30T00:00:00+0000']) {
            expect(gate(t, AFTER), `${t} is not canonical and must not pass`).toBe(false);
        }
    });

    it('rejects out-of-range and non-calendar values instead of rolling them over', () => {
        // Date.UTC and the UTC setters ROLL OVER: Feb 30 becomes March 2 and hour
        // 24 becomes the next midnight — a gate silently moved to a different
        // instant, on a plan nobody would look at twice.
        for (const t of ['2026-02-30T00:00:00', '2026-13-01T00:00:00',
            '2026-07-32T00:00:00', '2026-07-30T00:60:00', '2026-07-30T00:00:60',
            '0000-01-01T00:00:00', '2026-07-30T00:00:00+99:00', '2026-7-30',
            '2026-07-30T00:00:00.1234567', '', 'not-a-time']) {
            expect(gate(t, AFTER), `${t} must not parse`).toBe(false);
        }
    });

    it('rejects the classes where the two parsers nearly drifted apart', () => {
        // Found by the req #3192 review: Python's `$` also matches before ONE
        // trailing newline, and a `str` pattern's `\d` spans every Unicode Nd
        // digit, so `_to_epoch` accepted these while this engine did not —
        // measured as py=PASSED / js=not-eligible, the permissive side being the
        // one that LAUNCHES. The Python regex now carries `\Z` and `re.ASCII`;
        // this is the JS half of that pin.
        for (const t of ['2026-07-30T00:00:00\n', '2026-07-30\n', '2026-07-30T00:00:00Z\n',
            '\u0662\u0660\u0662\u0666-\u0660\u0667-\u0663\u0660',
            '\uff12\uff10\uff12\uff16-\uff10\uff17-\uff13\uff10',
            '2026-07-30T\u0660\u0660:00:00', '2026-07-30T00:00:00+\u0660\u0665:00']) {
            expect(gate(t, AFTER), `${JSON.stringify(t)} must not parse`).toBe(false);
        }
    });

    it('a non-finite clock or gate is not a passed gate', () => {
        // Every comparison against NaN is false, so an unguarded NaN would read
        // as EVERY GATE PASSED rather than as no answer.
        expect(gate('2099-01-01T00:00:00', NaN)).toBe(false);
        expect(gate('2099-01-01T00:00:00', Infinity)).toBe(false);
        expect(gate(NaN, AFTER)).toBe(false);
        expect(gate(Infinity, AFTER)).toBe(false);
    });

    it('an unreadable CLOCK is not a passed gate either', () => {
        expect(gate('2026-07-30T00:00:00', '31 Jul 2026')).toBe(false);
        expect(gate('2026-07-30T00:00:00', undefined)).toBe(false);
    });

    it('takes a Date or an epoch, and refuses anything else', () => {
        expect(gate('2026-07-30T00:00:00', new Date(Date.UTC(2026, 6, 31)))).toBe(true);
        expect(gate('2026-07-30T00:00:00', Date.UTC(2026, 6, 31))).toBe(true);
        expect(gate('2026-07-30T00:00:00', new Date('nonsense'))).toBe(false);
        expect(gate('2026-07-30T00:00:00', { at: 'now' })).toBe(false);
        expect(gate(true, AFTER)).toBe(false);
    });
});

// ── req #3192 — batch-contiguity is subordinate to topology ──────────────────

describe('batch-contiguity reports only an AVOIDABLE split', () => {
    // Rows fed to verifyOrder directly: these are statements about the INVARIANT,
    // not about the order displayOrder happens to produce.
    const row = (id, state, depIds = [], machine = 'M') => ({
        id, state, depIds, timeDeps: [], epicId: 1, run: 'auto', machineLabels: [machine],
    });
    const contiguity = (rows) => verifyOrder(rows).filter((v) => v.invariant === 'batch-contiguity');

    it('excuses a split whose interloper is TRAPPED between two members', () => {
        // Step 2 depends on member 1 and outranks member 3 by band, so it sits
        // between the two in every legal order. Design rule 3 orders its criteria
        // — topological, THEN state bands — so dependency-first is correct here
        // and reporting it is the crying-wolf failure mode rule 7 exists to avoid.
        expect(contiguity([
            row(1, STEP_PENDING), row(2, STEP_RUNNING, [1], 'OTHER'), row(3, STEP_PENDING),
        ])).toEqual([]);
    });

    it('still reports when the interloper could have moved', () => {
        // Same shape, Scheduled interloper: [1, 3, 2] keeps the batch together and
        // breaks no rule. THIS is the regression the invariant was built for, and
        // the relaxation must not swallow it.
        expect(contiguity([
            row(1, STEP_PENDING), row(2, STEP_PENDING, [1], 'OTHER'), row(3, STEP_PENDING),
        ]).map((v) => v.stepIds)).toEqual([[1, 3]]);
    });

    it('one trapped interloper excuses the whole split', () => {
        // Step 4 is trapped between members 1 and 5; step 3 is not. Reporting
        // because of step 3 would report a split no ordering can remove.
        expect(contiguity([
            row(1, STEP_PENDING), row(3, STEP_PENDING, [], 'OTHER'),
            row(4, STEP_RUNNING, [1], 'OTHER'), row(5, STEP_PENDING),
        ])).toEqual([]);
    });

    it('needs BOTH sides pinned — a dependency alone is not a trap', () => {
        // Step 2 must follow member 1, but nothing holds it above member 3.
        // Testing only half the trap would excuse every split containing any
        // dependency at all.
        expect(contiguity([
            row(1, STEP_PENDING), row(2, STEP_PENDING, [1], 'OTHER'), row(3, STEP_PENDING),
        ])).not.toEqual([]);
    });

    it('a contiguous batch never reports, trapped rows or not', () => {
        expect(contiguity([
            row(1, STEP_RUNNING, [], 'OTHER'), row(2, STEP_PENDING), row(3, STEP_PENDING),
        ])).toEqual([]);
    });
});

// ── req #3192 — labelInherited is published, not reconstructed ───────────────

describe('PlanRow.labelInherited', () => {
    it('is true exactly on a step that BORROWED its label from a dependency', () => {
        // Fixture step 7 ("Green Baseline") links no requirements, so rule 10
        // gives it no label of its own and req #3119's inheritance clause lends it
        // the label of the work it gates. Every step that derives its own label
        // must read false, or the conformance harness's rename is a lie.
        const rows = buildPlanRows(SUBSTRATE_REBUILD_MODEL);
        const inherited = rows.filter((r) => r.labelInherited).map((r) => r.id);
        expect(inherited).toEqual([7]);
        const row7 = rows.find((r) => r.id === 7);
        expect(row7.epicId).not.toBeNull();
        // The borrowed label deliberately carries EMPTY label sets: those drive
        // the "spans more than one epic" tooltip and this step spans nothing.
        expect(row7.epicLabels).toEqual([]);
        expect(row7.featureLabels).toEqual([]);
    });

    it('is a boolean on every row, never undefined', () => {
        // The conformance corpus compares for FULL equality, so an undefined here
        // would fail as a missing field rather than as a wrong answer.
        for (const r of buildPlanRows(SUBSTRATE_REBUILD_MODEL)) {
            expect(typeof r.labelInherited, `step ${r.id}`).toBe('boolean');
        }
    });
});
