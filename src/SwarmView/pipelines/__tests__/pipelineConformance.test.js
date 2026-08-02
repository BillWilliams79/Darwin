// The JAVASCRIPT half of the shared pipeline-derivation conformance harness
// (req #3184).
//
// `darwin-mcp/tests/conformance/pipeline_conformance.json` is a language-neutral
// corpus in the WIRE (snake_case) shape `darwin://pipeline/{id}` returns. This
// file runs it against `pipelineModel.js`;
// `darwin-mcp/tests/unit/test_pipeline_conformance.py` runs the SAME corpus
// against `services/pipeline_derive.py`. Two implementations agreeing is
// evidence only because both runners exist — either one alone is a change
// detector, not a cross-check.
//
// WHY THERE ARE TWO IMPLEMENTATIONS. This page reaches Lambda-Rest directly
// through API Gateway (`src/Context/AppContext.jsx` -> `call_rest_api`), while
// `darwin-mcp` is a localhost daemon the browser cannot reach. There is no one
// place both consumers can read a derivation from short of moving it into
// Lambda-Rest — a different requirement with a different blast radius. The
// user's ruling (2026-07-31) was to keep both and control the drift with a
// shared harness. This is that harness. The corpus `_header` carries the full
// rationale, the drift-triage procedure, and the ONE deliberate divergence
// (machine TITLES here versus raw `machine_fk` on the server).
//
// TRIAGE IN ONE LINE. If this suite is red and the pytest one is green, this
// engine moved. If both are red, the corpus moved. If only
// `machines-sharing-a-title` fails, read the divergence note before touching
// anything. Full procedure: the corpus's `_header.drift_triage`.
//
// NOTHING HERE MAY DERIVE. The adapters below rename keys and count array
// lengths. Any real logic that creeps in is a third implementation wearing a
// helpful disguise, and it would hide exactly the drift this file exists to
// find.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import {
    buildPlanRows, displayOrder, verifyOrder, eligibility, launchBatches,
    requirementCounts, pauseState,
} from '../pipelineModel';
import { SUBSTRATE_REBUILD_MODEL } from './substrateRebuildFixture';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// `Darwin/` is ALWAYS a subdirectory of the DarwinAI-Config checkout (CLAUDE.md
// § Repository Layout), in the primary clone and in every swarm session alike,
// so a relative path resolves in both. `package.json`'s `test:e2e` already
// reaches across the same boundary (`bash ../scripts/run-e2e.sh`), so this is
// the repo's existing assumption rather than a new one this file invents.
const CORPUS_PATH = path.resolve(
    HERE, '../../../../../darwin-mcp/tests/conformance/pipeline_conformance.json');

// A MISSING CORPUS IS A HARD FAILURE, NOT A SKIP — a deliberate choice.
//
// A skipped suite reports green. Green is what a reader acts on, and "the drift
// check silently did not run" is indistinguishable from "the two engines agree"
// at exactly the moment that distinction matters most. The usual argument for
// skipping is a repo-only CI checkout, and Darwin HAS NO standalone CI: there
// is not one workflow file in the repository (verified 2026-07-31), and the
// only way these tests run is from a full DarwinAI-Config checkout, where the
// corpus is present by construction. So the scenario a skip would protect does
// not exist, and the cost of pretending it does is a silent hole in a drift
// control. If Darwin ever gains its own CI, the fix is to vendor or fetch the
// corpus — not to soften this into a skip.
function loadCorpus() {
    let raw;
    try {
        raw = fs.readFileSync(CORPUS_PATH, 'utf8');
    } catch (err) {
        throw new Error(
            `Pipeline conformance corpus not found at:\n  ${CORPUS_PATH}\n\n`
            + 'This file is the SHARED contract between pipelineModel.js and\n'
            + 'darwin-mcp/services/pipeline_derive.py (req #3184). Without it there\n'
            + 'is no drift control between the two implementations, so this suite\n'
            + 'FAILS rather than skipping — a silent skip would report green while\n'
            + 'the check that matters never ran.\n\n'
            + 'Expected layout: Darwin/ is a subdirectory of the DarwinAI-Config\n'
            + 'checkout, and the corpus lives at\n'
            + '  <DarwinAI-Config>/darwin-mcp/tests/conformance/pipeline_conformance.json\n\n'
            + `Underlying error: ${err.message}`);
    }
    return JSON.parse(raw);
}

const CORPUS = loadCorpus();
const CASES = CORPUS.cases;
const byName = (name) => CASES.find((c) => c.name === name);

// ── Adapters ────────────────────────────────────────────────────────────────

// The ONLY translation: wire (snake_case) model keys -> the camelCase keys
// pipelineModel.js consumes. Row fields inside these arrays are already
// snake_case on both sides — they mirror the req #3111 table columns.
function toJsModel(m) {
    return {
        pipeline: m.pipeline,
        steps: m.steps || [],
        stepRequirements: m.step_requirements || [],
        stepDeps: m.step_deps || [],
        requirements: m.requirements || [],
        features: m.features || [],
        epics: m.epics || [],
        machines: m.machines || [],
    };
}

const labelIds = (entries) => (entries || []).map((e) => e.id);

// Build the neutral observation the corpus is written against. Mirrors
// `darwin-mcp/tests/conformance/observe.py::observe` call for call, so a
// divergence between the two engines shows up as a diff you can read instead of
// as a structural mismatch between two differently-shaped harnesses.
function observe(wireModel, now) {
    const model = toJsModel(wireModel);
    const rows = buildPlanRows(model);
    const ordered = displayOrder(rows);
    const outRows = ordered.rows;
    const violations = verifyOrder(outRows);
    const batches = launchBatches(outRows);

    const byId = new Map(outRows.map((r) => [r.id, r]));

    // req #3226 — the visibility half landed, so pause joins the corpus.
    // Called like every other predicate here: BEFORE the per-row loop below,
    // because it writes `launchSuppressed`/`suppressedBy` onto `outRows` in
    // place, mirroring `observe.py`'s own call ordering.
    const pause = pauseState(model, outRows);

    const observedRows = {};
    for (const row of outRows) {
        observedRows[String(row.id)] = {
            state: row.state,
            epic_id: row.epicId,
            feature_id: row.featureId,
            // A RENAME since req #3192, which is the point: this adapter used to
            // RECONSTRUCT the flag from "has a dominant label AND both label sets
            // are empty" because `buildPlanRows` computed `inherited` and then
            // dropped it. The reconstruction was exact and still wrong to have —
            // the one place either adapter did anything beyond renaming a key, in
            // the harness whose whole job is to not be a third implementation.
            label_inherited: row.labelInherited,
            epic_label_ids: labelIds(row.epicLabels),
            feature_label_ids: labelIds(row.featureLabels),
            req_ids: [...(row.reqIds || [])],
            tracking_req_ids: [...(row.trackingReqIds || [])],
            unresolved_req_ids: [...(row.unresolvedReqIds || [])],
            dep_ids: [...(row.depIds || [])],
            time_deps: [...(row.timeDeps || [])],
            // COUNT, never the identities: this engine keys machines by TITLE and
            // the server by raw `machine_fk`. See the corpus header's
            // `machine_identity_the_one_deliberate_divergence`.
            machine_bucket_count: (row.machineLabels || []).length,
            eligible: eligibility(row, byId, now == null ? undefined : now),
            launch_suppressed: row.launchSuppressed,
            suppressed_by: [...(row.suppressedBy || [])],
        };
    }

    const observedBatches = batches.map((b) => ({
        letter: b.letter,
        step_ids: [...b.stepIds],
        // req #3188 — the ONE dominant epic every member shares. Asserted, not
        // merely produced: "no batch spans more than one epic" is the fix's
        // first acceptance criterion, and a partition nothing observes can
        // regress in silence. Both engines key the epic on its ID, so this is a
        // plain comparison rather than another bucket count.
        epic_id: b.epicId,
        // The REMAINING (unsatisfied) gate since req #3188, not the raw dep set.
        gate_step_ids: [...b.gateStepIds],
        time_deps: [...b.timeDeps],
        run: b.run,
        swarm_start_req_ids: [...b.swarmStartArgs],
        no_launch_reason: b.noLaunchReason,
        machine_bucket_count: (b.machineLabels || []).length,
    }));

    // {invariant, stepIds} only. The batch-contiguity MESSAGE embeds the launch
    // key, which legitimately differs between the two engines; comparing messages
    // would report the known machine-identity divergence as a fresh failure on
    // every case that happens to have a batch.
    const observedViolations = violations.map((v) => ({
        invariant: v.invariant,
        step_ids: [...v.stepIds],
    }));

    const unresolved = [];
    for (const row of outRows) {
        for (const rid of row.unresolvedReqIds || []) {
            if (!unresolved.includes(rid)) unresolved.push(rid);
        }
    }

    // req #3225 — rename onto the wire (snake_case) shape `pipeline_derive.py`
    // speaks natively; nothing here derives anything `requirementCounts`
    // did not already compute.
    const counts = requirementCounts(model);
    const observedCounts = {
        overall: counts.overall,
        by_epic: counts.byEpic.map((c) => ({
            epic_id: c.epicId, met: c.met, total: c.total,
        })),
    };

    return {
        display_order: outRows.map((r) => r.id),
        rows: observedRows,
        batches: observedBatches,
        violations: observedViolations,
        cycle_detected: ordered.cycleDetected,
        cycle_step_ids: [...ordered.cycleStepIds],
        duplicate_step_ids: [...ordered.duplicateStepIds],
        unresolved_req_ids: unresolved,
        requirement_counts: observedCounts,
        // req #3226 — `pipeline_status` is dropped (a verbatim wire field, not
        // a derived answer); the three that remain are what this corpus
        // cross-checks.
        pause: {
            pipeline_paused: pause.pipelinePaused,
            paused_epic_ids: [...pause.pausedEpicIds],
            suppressed_step_ids: [...pause.suppressedStepIds],
        },
    };
}

// Regeneration path for a divergence case's hand-authored `expect_js` block:
//   cd Darwin && PIPELINE_CONFORMANCE_DUMP=<case name> npx vitest run src/SwarmView/pipelines
// Prints this engine's observation so it can be reviewed and pasted into the
// corpus. It is never written automatically — `regenerate.py` owns `expect` and
// deliberately never touches `expect_js`, because a divergence that a script can
// silently refresh has stopped being a decision anyone made.
const DUMP = process.env.PIPELINE_CONFORMANCE_DUMP;
if (DUMP) {
    const target = byName(DUMP);
    if (!target) {
        throw new Error(`PIPELINE_CONFORMANCE_DUMP=${DUMP} names no case in the corpus`);
    }
    // eslint-disable-next-line no-console
    console.log('\n--- expect_js for ' + DUMP + ' ---\n'
        + JSON.stringify(observe(target.model, target.now), null, 2));
}

// ── The corpus, case by case ────────────────────────────────────────────────

describe('pipeline conformance corpus', () => {
    it('loaded a well-formed corpus with at least one independently anchored case', () => {
        expect(CASES.length).toBeGreaterThan(0);
        const names = CASES.map((c) => c.name);
        expect(new Set(names).size).toBe(names.length);
        // A corpus whose expectations are ALL generated from one implementation
        // has outsourced its judgement to the code it is meant to judge.
        expect(CASES.some((c) => c.provenance === 'golden')).toBe(true);
    });

    it('the header cannot overstate its own provenance', () => {
        // THIS TEST EXISTS BECAUSE THE HEADER ONCE DID OVERSTATE IT. Every case
        // was labelled `hand` — meaning "reasoned from the rule FIRST, so it
        // carries authority independent of the Python engine" — when in truth
        // every expectation was emitted by regenerate.py and then reviewed,
        // which is the definition of `generated-reviewed`. A reader would have
        // concluded 25 of 25 cases were independent of pipeline_derive.py; the
        // honest number is 1. Pinning the claim to the fact is the only thing
        // that stops that recurring, and its incentive is the right way round:
        // the only way to satisfy it is to tell the truth. A minimum RATIO is
        // deliberately NOT enforced — see the pytest runner for why.
        const actual = {};
        for (const c of CASES) actual[c.provenance] = (actual[c.provenance] || 0) + 1;
        expect(CORPUS._header.provenance.tally).toEqual(actual);
    });

    it('a `hand` claim stays small enough for a reader to check', () => {
        // `hand` asserts the COMPLETE expected block was predicted before the
        // generator ran, and nobody predicts a 34-step display order by eye. The
        // cap is an admitted proxy — it cannot tell a real prediction from a
        // confident-sounding one — but it makes the strongest label unavailable
        // to exactly the cases where it would be least believable.
        const limit = CORPUS._header.provenance.hand_case_step_limit;
        const oversized = CASES
            .filter((c) => c.provenance === 'hand' && c.model.steps.length > limit)
            .map((c) => `${c.name} (${c.model.steps.length} steps)`);
        expect(oversized, `hand claims larger than ${limit} steps are not checkable`)
            .toEqual([]);
    });

    for (const testCase of CASES) {
        // `expect_js` exists only where the two engines LEGITIMATELY differ, and
        // it is hand-authored. Its absence means this engine must produce the
        // same answer the Python one does — which is the normal case and the
        // whole point.
        const expected = testCase.expect_js || testCase.expect;
        const divergent = Boolean(testCase.expect_js);

        it(`${testCase.name}${divergent ? ' [recorded divergence]' : ''}`, () => {
            const observed = observe(testCase.model, testCase.now);

            // Field by field first — a whole-payload assert on the 34-row case
            // prints an unreadable wall and buries which invariant actually moved.
            expect(observed.display_order, 'display order').toEqual(expected.display_order);
            expect(observed.batches, 'launch batches').toEqual(expected.batches);
            expect(observed.violations, 'order violations').toEqual(expected.violations);
            expect(observed.cycle_detected).toEqual(expected.cycle_detected);
            expect(observed.cycle_step_ids).toEqual(expected.cycle_step_ids);
            expect(observed.duplicate_step_ids).toEqual(expected.duplicate_step_ids);
            expect(observed.unresolved_req_ids).toEqual(expected.unresolved_req_ids);
            expect(Object.keys(observed.rows).sort()).toEqual(
                Object.keys(expected.rows).sort());
            for (const stepId of Object.keys(expected.rows)) {
                expect(observed.rows[stepId], `step ${stepId}`).toEqual(expected.rows[stepId]);
            }
            expect(observed).toEqual(expected);
        });
    }
});

// ── Named guarantees ────────────────────────────────────────────────────────

describe('pipeline conformance — the anchors', () => {
    it('the corpus copy of the Substrate Rebuild model still matches the fixture', () => {
        // The corpus must be language-neutral, so the 34-row plan is INLINED
        // rather than imported — and an inlined copy drifts. This assertion is
        // what makes that impossible to do quietly. On failure, re-export with
        //   node darwin-mcp/tests/conformance/extract-substrate-model.mjs
        // paste the result over the case's `model`, then re-run regenerate.py
        // --write and REVIEW the expectation diff.
        const m = SUBSTRATE_REBUILD_MODEL;
        expect(byName('substrate-rebuild-34-rows').model).toEqual({
            pipeline: m.pipeline,
            steps: m.steps,
            step_requirements: m.stepRequirements,
            step_deps: m.stepDeps,
            requirements: m.requirements,
            features: m.features,
            epics: m.epics,
            machines: m.machines,
        });
    });

    it('reproduces the archived req #3080 POC display order, 34 of 34 rows', () => {
        // THE anchor. This order predates both engines — captured by running the
        // archived display_order() verbatim over the live req #3083 PLAN-JSON —
        // and it earned its shape through four same-day ordering regressions. It
        // is the tie-break the drift-triage note points at for every rule-3
        // question, so it is spelled out here rather than left implicit inside a
        // generated expectation block.
        const golden = [1, 2, 3, 4, 5, 6, 7, 8, 9, 21, 10, 26, 25, 28, 11, 22, 16,
            23, 33, 12, 13, 14, 19, 38, 34, 39, 40, 41, 43, 42, 17, 18, 31, 20];
        const c = byName('substrate-rebuild-34-rows');
        const observed = observe(c.model, c.now);
        expect(observed.display_order).toEqual(golden);
        expect(Object.keys(observed.rows)).toHaveLength(34);
        expect(observed.violations).toEqual([]);
    });

    it('records BOTH answers for the one deliberate machine-identity divergence', () => {
        // Two machines sharing a title. This engine keys the launch batch on the
        // TITLE and merges the two steps into one batch; the server keys on raw
        // `machine_fk` — because adding `machines` to the composed read would cost
        // an eighth gateway read and break design rule 5's fixed seven — and keeps
        // them apart, so no batch forms at all. Everywhere else the two induce the
        // SAME partition. If this ever starts passing without `expect_js`, one of
        // the engines changed its machine handling and that is a decision to make,
        // not a test to delete.
        const c = byName('machines-sharing-a-title');
        expect(c.expect_js, 'the divergence must keep its recorded JS answer').toBeTruthy();
        const observed = observe(c.model, c.now);
        expect(observed.batches).toHaveLength(1);
        expect(observed.batches[0].step_ids).toEqual([2, 3]);
        expect(c.expect.batches, 'the server keeps them apart').toEqual([]);
    });

    it('requirement_counts excludes tracking and keeps terminal statuses in '
        + 'the denominator (req #3225)', () => {
        // The two decisions the requirement asked to be stated, not guessed:
        // a TRACKING requirement moves neither side of the ratio (even a
        // `met` one), and wontfix/deferred count toward the denominator but
        // never the numerator.
        const c = byName('requirement-counts-tracking-and-terminal-statuses');
        const observed = observe(c.model, c.now).requirement_counts;
        expect(observed.overall).toEqual({ met: 2, total: 5 });
        expect(observed.by_epic).toEqual([
            { epic_id: 21, met: 2, total: 3 },
            { epic_id: 22, met: 0, total: 2 },
        ]);
    });

    it('reads a stringified zero as WORK, not as a tracking container', () => {
        // `Boolean("0")` is true, so a bare truthiness check reads a stringified
        // zero as a CONTAINER and silently stops a real requirement from gating
        // its step — a wrong answer in the dangerous direction, and the one input
        // class where numeric coercion is load-bearing. Each step in this case
        // links one `development` requirement, so Running means "read as work"
        // and Scheduled means "read as container".
        const c = byName('tracking-flag-coercion');
        const rows = observe(c.model, c.now).rows;
        for (const id of ['2', '4', '6', '7', '8', '9', '11']) {
            expect(rows[id].state, `step ${id} must read as work`).toBe('running');
        }
        for (const id of ['1', '3', '5', '10']) {
            expect(rows[id].state, `step ${id} must read as a container`).toBe('pending');
        }
    });
});
