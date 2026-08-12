// planFixtureEngine.js — TEST SCAFFOLDING. Not production code, not imported by
// anything under `src/` outside this `__tests__/` directory.
//
// ── WHAT THIS IS AND WHY IT EXISTS (req #3356) ─────────────────────────────
// This is Pipeline 1.0's browser-side derivation engine, moved here verbatim
// from `../pipelineModel.js` when req #3356 eradicated Pipeline 1.0 from the
// front end. In production nothing derives a plan in the browser any more:
// `pipeline2_derive.py` runs the derivation ONCE, server-side, and
// `../pipelineAdapter.js` reshapes its output into `PlanRow`s. That is the
// single-source-of-truth the requirement was after, and it is achieved — no
// file under `src/` imports a line of this.
//
// ── WHY IT WAS MOVED RATHER THAN DELETED ───────────────────────────────────
// Two test files guard modules that SURVIVE and that Pipeline 2.0 depends on:
//
//   `pipelinePlanLayout.test.js`  — ~7000 lines over `../pipelinePlanLayout.js`,
//                                   the plan canvas's geometry (columns, epic
//                                   bands, chip placement, clamping, semantic
//                                   zoom). It includes a pseudo-random FUZZ
//                                   corpus (`timedFuzzPlans.js`).
//   `pipelineEpicZoom.test.js`    — `../pipelineEpicZoom.js`, the epic-zoom
//                                   camera.
//
// Both feed those modules a realistic `plan` — rows in display order, with
// state, eligibility, pause and requirement counts — and they build it by
// running a derivation over fixture READ payloads. There is no JS derivation in
// 2.0 to run instead, deliberately: the only 2.0 producer is a Python module the
// browser cannot import. So deleting this outright would have deleted the
// coverage of two modules 2.0 draws every plan with, which is a worse outcome
// than keeping a fixture factory.
//
// It is not a second implementation of anything: 2.0 derivation is
// `pipeline2_derive.py` alone, and nothing compares this against it (req #3356
// deleted the conformance corpus that used to). It is a way of MINTING PLAN ROWS
// for a layout test.
//
// ── HOW TO FINISH THE JOB ──────────────────────────────────────────────────
// The end state is that the two test files above carry their derived rows as
// DATA, the way `pipelineComposedFixture.js` already does — a composed payload
// with an explicit `derived.rows[]`, run through `adaptComposedPipeline`. Then
// this file is deleted in one commit and the last of Pipeline 1.0 goes with it.
// The work is converting ~15 fixture call sites plus the fuzz generator, which
// is why it is not folded into this change.
//
// Precedent: `testOrderedPlan.js` was exactly this file's smaller ancestor,
// created by req #3381 and removed by req #3462's revert.

import {
    PAUSED_STATUS,
    STEP_DONE,
    STEP_PENDING,
    STEP_RUNNING,
    TERMINAL_REQUIREMENT_STATUSES,
    sumReqCost,
} from '../pipelineModel';
import { planTimeAxis } from '../pipelinePlanTime';

// The ONLY status a /swarm-start argument may carry (req #3360). Decided by the
// user 2026-08-07 and NOT open for re-derivation: `authoring`, `approved`,
// `met`, `deferred`, `wontfix` and `development` are ALL excluded from a step's
// launch argument list.
//
// A named set rather than a boolean test, so `tests/swarm/test-pipeline-skill-contract.sh`
// can read the rule BY NAME and pin the /swarm-start skill's prose against it —
// widening the rule is then one edit and the binding test fails until the prose
// follows. The two statuses worth justifying, because they are the ones a later
// session will be tempted to re-admit: `approved` was in every previous copy of
// this list and the user was asked about it specifically and said skip it;
// `development` means a session already took the requirement past readiness, so
// excluding it STRENGTHENS req #3191 (whose whole mechanism is `session-init.sh`
// writing `development` to suppress a relaunch, defeated until now by an
// argument list that never read the column).
export const LAUNCHABLE_REQUIREMENT_STATUSES = ['swarm_ready'];

// Why an id is NOT in a step's launch argument list — published per excluded id
// so no consumer re-derives one.
//
// EACH ENTRY IS ONE FLAT STRING, `"<reqId> <reason>"`, and the shape is forced
// rather than chosen: the server twin's derived block may carry no nested row
// anywhere (req #3078's payload budget, pinned by
// `test_the_derived_block_is_compact_ids_and_enums_only`), and these two must
// stay identical. It is also the form every consumer wants — all of them RENDER
// the exclusion and none reads the status programmatically, and for a status
// exclusion the reason IS the status.
export const EXCLUDED_CONTAINER = 'tracking container';
export const EXCLUDED_UNRESOLVED = 'unresolved — not in the composed read';
export const EXCLUDED_NO_STATUS = 'no status';

// WHY a step or batch has no command, as an ENUM a consumer can BRANCH on —
// `noLaunchReason` is the same decision rendered as a sentence for a human.
// Both come from `launchBlock`, so they cannot disagree.
//
// THE THREE CASES NEED DIFFERENT READER ACTIONS, and the two that predate req
// #3360 need the SAME one. `no-links` and `containers` mean *close the step* —
// there is no work and there never will be. `not-ready` means *the work exists
// and is not ready*, and closing the step there destroys the plan record for
// work nobody has done.
export const BLOCK_NO_LINKS = 'no-links';
export const BLOCK_CONTAINERS = 'containers';
export const BLOCK_NOT_READY = 'not-ready';

// How a plan runs its epics (req #3388). `parallel` is every epic at once — the
// behaviour that existed before this column, which is why it is the DEFAULT and
// why an ABSENT value reads as parallel.
export const MODE_PARALLEL = 'parallel';
export const MODE_SERIAL = 'serial';

const STATE_RANK = { [STEP_DONE]: 0, [STEP_RUNNING]: 1, [STEP_PENDING]: 2 };
const RUN_RANK = { auto: 0, manual: 1 };

// ── Derivation ──────────────────────────────────────────────────────────────

// A TRACKING requirement is a CONTAINER, not work (req #3123, migration
// 20260731124830 → `requirements.tracking`). It HOLDS a plan — or an epic — rather
// than being work performed inside it, so it stays `development` for the entire life
// of what it holds. The flag is a DURABLE SIGNAL read from the row, never a heuristic
// guessed here: choosing it was a schema decision, and inventing one in this file
// would be reinventing the rule instead of codifying it.
//
// MySQL TINYINT arrives as 1/0; a hand-built fixture row may say `true`. An ABSENT
// field is work, which is what every row written before the migration is and what the
// column's DEFAULT 0 says.
//
// NUMERIC coercion, not `Boolean(...)`, and it matters at exactly one input class:
// the STRING "0". `Boolean("0")` is true, so a bare truthiness check would read a
// stringified zero as a CONTAINER and silently stop a real requirement from gating
// its step — a wrong answer in the dangerous direction, and the only input for which
// this function would disagree with the old unconditional derivation. The three
// server-side readers (`services/pipelines.py::_is_tracking`,
// `seed_pipelines_darwin_dev.py::is_tracking`) all coerce through `int()`, so this is
// what keeps the two engines from disagreeing about the same row. Nothing produces a
// string today; the point is that nothing has to.
//
// @param {PipelineRequirement} req
// @returns {boolean}
export function isTrackingRequirement(req) {
    const value = req == null ? null : req.tracking;
    if (value === null || value === undefined || value === '') return false;
    if (typeof value === 'boolean') return value;
    const n = Number(value);
    return Number.isFinite(n) ? n !== 0 : false;
}

// Rule 8, with the status finally read (req #3360). Splits a step's linked ids
// into the ones a /swarm-start may carry and one record per id it may NOT, each
// carrying the REASON.
//
// Before this requirement the split subtracted containers and stopped, so an
// orchestrated launch attempted work that was already finished — measured
// 2026-08-07 on pipeline 79 step 230, `/swarm-start 3329 3330 3331 3332 3333
// 3334` with three of them `met`, while the sync report printed "met —
// /swarm-start has nothing to do with it" for each of the three on the same
// read. The plan layer already knew and emitted the ids anyway.
//
// ORDER IS THE PLAN'S OWN. Both lists come out in junction order — rule 8's
// "the requirement ids ARE the argument list" means the command must be stable
// across cycles, and re-sorting here would make it depend on which ids happened
// to be excluded.
//
// UNRESOLVED IS EXCLUDED, deliberately. A junction row whose requirement is
// missing from the read has no readable status, and "only swarm_ready launches"
// cannot be satisfied by a row nobody read. Fail closed.
//
// @param {number[]} reqIds
// @param {number[]} trackingReqIds
// @param {Map<number, PipelineRequirement>} reqsById
// @returns {{launchReqIds: number[], launchExcluded: string[]}}
function splitLaunchable(reqIds, trackingReqIds, reqsById) {
    const tracking = new Set(trackingReqIds || []);
    const launchReqIds = [];
    const launchExcluded = [];
    const note = (rid, reason) => launchExcluded.push(`${rid} ${reason}`);
    for (const rid of reqIds || []) {
        if (tracking.has(rid)) {
            note(rid, EXCLUDED_CONTAINER);
            continue;
        }
        const req = reqsById.get(rid);
        if (!req) {
            note(rid, EXCLUDED_UNRESOLVED);
            continue;
        }
        const status = req.requirement_status != null ? req.requirement_status : null;
        if (LAUNCHABLE_REQUIREMENT_STATUSES.includes(status)) {
            launchReqIds.push(rid);
        } else {
            // The STATUS IS THE REASON, so it is the phrase rather than a label
            // wrapped around one: a reader seeing `3330 met` needs no glossary.
            note(rid, status || EXCLUDED_NO_STATUS);
        }
    }
    return { launchReqIds, launchExcluded };
}

// Rule 1: STEP STATE IS DERIVED, NEVER STORED-BY-HAND. Any GATING requirement in
// development → running; all terminal (met/deferred/wontfix) → done; else pending.
// No gating requirements: the step's own completed_at stamp decides done vs
// pending — the only place that column means anything.
//
// THE GATING SET EXCLUDES TRACKING CONTAINERS (req #3123). Without that, a plan
// that tracks itself pins a step Running forever: the container never leaves
// `development` because the plan it holds is still running, and the step is
// waiting on the plan that is waiting on the step. Measured on the seeded
// Substrate Rebuild fixture — step 19 links #3083, the plan's own tracker, and
// derived Running where the plan recorded done. It was the single divergence.
//
// ORDER MATTERS: the tracking filter runs BEFORE the empty check, and the empty
// check is the same branch a zero-requirement step takes. So a step whose links
// are ALL containers falls through to its own completed_at stamp — Complete or
// Scheduled, never Running — which is precisely a link-less step's behaviour,
// because a step with nothing to derive from is what it has become.
//
// A MIXED step subtracts the containers and lets the remaining work decide:
// fixture step 19 links #3080 (met), #3083 (tracking), #3105 (met), so its
// gating set is all-terminal and it derives done, reproducing the plan.
//
// @param {PipelineStep} step
// @param {PipelineRequirement[]} linkedReqs
// @returns {StepState}
export function deriveStepState(step, linkedReqs) {
    const reqs = (linkedReqs || []).filter(Boolean);
    const gating = reqs.filter((r) => !isTrackingRequirement(r));
    if (gating.length === 0) {
        return step && step.completed_at ? STEP_DONE : STEP_PENDING;
    }
    if (gating.some((r) => r.requirement_status === 'development')) return STEP_RUNNING;
    if (gating.every((r) => TERMINAL_REQUIREMENT_STATUSES.includes(r.requirement_status))) {
        return STEP_DONE;
    }
    return STEP_PENDING;
}

// Requirement ids linked to a step, in junction order.
function linkedReqIds(stepId, model) {
    return (model.stepRequirements || [])
        .filter((j) => j.step_fk === stepId)
        .map((j) => j.requirement_fk);
}

// Rule 10: ONE EPIC/FEATURE LABEL PER STEP, derived from the linked requirements'
// feature_fk → epic chain. Dominant = the label carried by the most linked
// requirements; ties break to first appearance in the step's requirement order.
// The full sets are exposed for tooltips — a launch unit may legitimately cross
// epics. Requirements without a resolvable feature contribute nothing.
//
// TRACKING CONTAINERS ARE COUNTED HERE, deliberately (req #3123). The exemption
// is about GATING, and a container genuinely belongs to its epic — it is the
// thing that holds the epic's work. Do not "finish" the filter by adding it
// here; that would silently change which epic a step bands under, which is a
// display regression, not a rule. `machineLabels` below DOES filter, and the
// reason it differs is written there: an epic is a taxonomy label, a machine is
// a launch parameter.
//
// @param {PipelineStep} step
// @param {PipelineModel} model
// @returns {{epicId: ?number, epic: ?string, epicSortOrder: ?number,
//            featureId: ?number, feature: ?string,
//            epicLabels: {id: number, title: string}[],
//            featureLabels: {id: number, title: string}[]}}
export function dominantLabels(step, model) {
    const reqsById = indexById(model.requirements);
    const featuresById = indexById(model.features);
    const epicsById = indexById(model.epics);
    const featTally = [];   // [{id, title, count}] in first-appearance order
    const epicTally = [];
    for (const rid of linkedReqIds(step.id, model)) {
        const req = reqsById.get(rid);
        const feature = req && req.feature_fk != null ? featuresById.get(req.feature_fk) : null;
        if (!feature) continue;
        tally(featTally, feature.id, feature.title);
        const epic = feature.epic_fk != null ? epicsById.get(feature.epic_fk) : null;
        if (epic) tally(epicTally, epic.id, epic.title);
    }
    const domFeat = dominant(featTally);
    const domEpic = dominant(epicTally);
    return {
        epicId: domEpic ? domEpic.id : null,
        epic: domEpic ? domEpic.title : null,
        // req #3430. Read from the epics dictionary the label itself came from,
        // not tallied alongside it: the tally answers WHICH epic dominates, and
        // a second copy of the column inside it would be one more place for the
        // two answers to disagree.
        epicSortOrder: domEpic ? epicSortOrderOf(epicsById.get(domEpic.id)) : null,
        featureId: domFeat ? domFeat.id : null,
        feature: domFeat ? domFeat.title : null,
        epicLabels: epicTally.map(({ id, title }) => ({ id, title })),
        featureLabels: featTally.map(({ id, title }) => ({ id, title })),
    };
}

function indexById(rows) {
    return new Map((rows || []).map((r) => [r.id, r]));
}

// The ONE string shape either engine accepts as `epics.sort_order` (req #3430).
//
// A DECIMAL GRAMMAR, not "whatever the language's parser will take", because the
// two parsers take DIFFERENT things and every difference is an epic the browser
// and the daemon place differently. Measured, before this pattern existed:
// `'0x10'`/`'0b101'`/`'0o17'` parse here and not in Python; `'1_0'` parses in
// Python and not here; `'NaN'`/`'inf'`/`'1e400'` parse in Python — and a NaN in
// a sort key compares false against everything, so the ordering stops being
// merely wrong and becomes incoherent.
//
// `^…$` here, `re.fullmatch` in the Python twin — the same grammar written twice
// because the two engines cannot share code (see the module header).
const SORT_ORDER_DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

// req #3430. `epics.sort_order` as a FINITE number or null — never a string,
// never NaN, never undefined. Lambda-Rest hands INT columns back as numbers
// today, but this value is a SORT KEY: `'10' < '9'` is true for strings and
// false for numbers, so one stringly-typed row would silently reorder a plan
// rather than fail. A NULL (or an unparseable value) means UNORDERED, which is
// a real answer here — it sorts last and falls back to first appearance — and
// is deliberately not conflated with 0, a legitimate first position.
// `pipeline_derive.py::_epic_sort_order` is the twin; they move together, and
// the coercion table both must agree on is pinned in `pipelineModel.test.js`
// and `darwin-mcp/tests/unit/test_epic_sort_order.py`.
function epicSortOrderOf(epic) {
    const raw = epic ? epic.sort_order : null;
    // ONLY a number or a string is a candidate, and this is a WHITELIST rather
    // than a guard list on purpose: `Number([])` is 0 and `Number(true)` is 1 in
    // JavaScript, while `float([])` raises and `float(True)` is 1.0 in Python,
    // so every "clever" coercion JS performs is a place the two engines could
    // answer differently. Naming the two types the column can actually arrive as
    // closes the whole class instead of the two members of it anyone thought of.
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    // A blank string is UNORDERED, not zero — `Number('')` and `Number('  ')`
    // are both 0 here — and so is any string outside the shared decimal
    // grammar, whatever this language's own parser would make of it.
    if (typeof raw === 'string' && !SORT_ORDER_DECIMAL.test(raw.trim())) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;   // NaN and ±Infinity are UNORDERED
}

function tally(list, id, title) {
    const hit = list.find((e) => e.id === id);
    if (hit) hit.count += 1;
    else list.push({ id, title, count: 1 });
}

// Strictly-greater comparison → first appearance wins ties.
function dominant(list) {
    let best = null;
    for (const e of list) if (!best || e.count > best.count) best = e;
    return best;
}

// Rule 10 sibling: machine labels from the LAUNCHABLE requirements' machine_fk.
// NULL pin → 'Any'; unknown machine id → '#<id>' (POC behavior); multiple →
// unique labels in requirement order joined with ' / '; nothing launchable → '—'.
//
// TRACKING CONTAINERS ARE EXCLUDED HERE, unlike dominantLabels above, and the
// difference is not an inconsistency (req #3123). An epic is a TAXONOMY label: a
// container genuinely belongs to its epic, so it counts. A machine is a LAUNCH
// PARAMETER — this column answers "where does this step run" — and a container
// runs nowhere, so it has no opinion to contribute.
//
// It is also load-bearing rather than cosmetic: `launchKey` is built from these
// labels, so a container's machine pin would split two steps that are
// launch-identical on everything actually launched. Measured before the fix: two
// pending steps sharing a gate, one linking a container pinned to Mac mini, the
// other pinned to Any — `launchBatches` returned [] and the plan rendered no
// batch letter and no /swarm-start command at all. Reachable only since this
// requirement, because before it a step linking a container derived Running and
// so never entered `pendingGroups`.
//
// @param {PipelineStep} step
// @param {PipelineModel} model
// @returns {{labels: string[], label: string}}
export function machineLabels(step, model) {
    const reqsById = indexById(model.requirements);
    const reqIds = linkedReqIds(step.id, model)
        .filter((rid) => !isTrackingRequirement(reqsById.get(rid)));
    if (reqIds.length === 0) return { labels: [], label: '—' };
    const machinesById = indexById(model.machines);
    const labels = [];
    for (const rid of reqIds) {
        const req = reqsById.get(rid);
        const fk = req && req.machine_fk != null ? req.machine_fk : null;
        const machine = fk != null ? machinesById.get(fk) : null;
        const label = fk == null ? 'Any' : machine ? machine.title : `#${fk}`;
        if (!labels.includes(label)) labels.push(label);
    }
    return { labels, label: labels.join(' / ') };
}

// Join the model tables into self-contained PlanRows, in steps-array order
// (insertion history — callers MUST reorder via displayOrder before rendering).
// Junction rows pointing at requirements missing from model.requirements are
// kept in reqIds (and label their machine 'Any') but contribute nothing to
// state or epic/feature labels.
//
// @param {PipelineModel} model
// @returns {PlanRow[]}
export function buildPlanRows(model) {
    const reqsById = indexById(model.requirements);
    const depsByStep = new Map();
    for (const d of model.stepDeps || []) {
        if (!depsByStep.has(d.step_fk)) depsByStep.set(d.step_fk, { depIds: [], timeDeps: [] });
        const bucket = depsByStep.get(d.step_fk);
        if (d.dep_step_fk != null) bucket.depIds.push(d.dep_step_fk);
        else if (d.time_at != null) bucket.timeDeps.push(d.time_at);
    }
    // Rule 10 attaches labels to REQUIREMENTS, so a step that links none derives
    // no epic at all. For a gate or a baseline — the whole reason `completed_at`
    // exists — that is technically true and visually wrong: the plan's step 7,
    // "Green Baseline", recorded the regression baseline for the substrate work
    // it gates, and banding it under "No epic" put a lone bead in a band of its
    // own between the epics it belongs between.
    //
    // So a req-less step INHERITS the dominant label of its dependencies, walking
    // back until it finds one. That keeps rule 10 intact where the rule has an
    // opinion — nothing is stored, and a step with requirements still derives
    // from them and only them — while giving a step whose whole job is to gate
    // other work the label of the work it gates. Ambiguity resolves the same way
    // it does everywhere else here: the first dependency, in dep order.
    const labelCache = new Map();
    const inheritedLabels = (stepId, seen) => {
        if (labelCache.has(stepId)) return labelCache.get(stepId);
        if (seen.has(stepId)) return null;   // cycle guard
        seen.add(stepId);
        const step = (model.steps || []).find((s) => s.id === stepId);
        if (!step) return null;
        const own = dominantLabels(step, model);
        if (own.epicId != null || own.featureId != null) {
            labelCache.set(stepId, own);
            return own;
        }
        for (const depId of (depsByStep.get(stepId) || { depIds: [] }).depIds) {
            const up = inheritedLabels(depId, seen);
            if (up && (up.epicId != null || up.featureId != null)) {
                // Inherited, so the FULL label sets stay empty: those drive the
                // "spans more than one epic" tooltip, and this step spans
                // nothing — it borrowed one label from upstream.
                const borrowed = { ...up, epicLabels: [], featureLabels: [], inherited: true };
                labelCache.set(stepId, borrowed);
                return borrowed;
            }
        }
        labelCache.set(stepId, own);
        return own;
    };

    return (model.steps || []).map((step) => {
        const reqIds = linkedReqIds(step.id, model);
        const linked = reqIds.map((rid) => reqsById.get(rid)).filter(Boolean);
        const unresolvedReqIds = reqIds.filter((rid) => !reqsById.has(rid));
        // req #3123. `reqIds` deliberately stays COMPLETE — the plan table links
        // every requirement a step carries, and cost aggregation must sum the
        // sessions of all of them. What the container flag changes is which ids
        // GATE (deriveStepState, above) and which get LAUNCHED (rule 8, in
        // launchBatches), so the tracking set is published beside the full one
        // rather than subtracted from it. An unresolved id is not a container:
        // nothing was read that said so.
        const trackingReqIds = reqIds.filter(
            (rid) => isTrackingRequirement(reqsById.get(rid)));
        // req #3360. Computed HERE, where reqsById is already in hand, and
        // published on the row rather than recomputed at each call site: the
        // launch argument list and the reasons an id is missing from it are two
        // halves of one answer, and deriving them apart is how they disagree.
        const { launchReqIds, launchExcluded } = splitLaunchable(
            reqIds, trackingReqIds, reqsById);
        const labels = inheritedLabels(step.id, new Set()) || dominantLabels(step, model);
        const machines = machineLabels(step, model);
        const deps = depsByStep.get(step.id) || { depIds: [], timeDeps: [] };
        // The one-row "group" `launchBlock`/`noLaunchReasonFor` share below —
        // every field either function reads, `launchExcluded` included.
        const launchOnlyMember = { reqIds, trackingReqIds, launchReqIds, launchExcluded };
        return {
            id: step.id,
            title: step.title,
            run: step.run || 'auto',
            notes: step.notes != null ? step.notes : null,
            completedAt: step.completed_at != null ? step.completed_at : null,
            state: deriveStepState(step, linked),
            reqIds,
            trackingReqIds,
            unresolvedReqIds,
            launchReqIds,
            launchExcluded,
            // req #3360, then req #3371/#3375: per ROW as well as per batch — a
            // solo step never forms a batch, and since #3371 the STEP is the
            // launch unit, so the plan table's row is the ONLY place these three
            // render. `launchBatches` (below) computes the identical trio for a
            // 2+-member GROUP; here the "group" is this row alone, which is what
            // makes `noLaunchReasonFor`/`launchBlock` reusable unchanged — both
            // take a `members` array, and `launchOnlyMember` below carries every
            // field either one reads, `launchExcluded` included (code review,
            // req #3375: the first cut omitted it from the literal passed to
            // `noLaunchReasonFor`, so a partially-excluded row's reason rendered
            // "nothing launchable — only swarm_ready launches: " with the list
            // silently dropped — measured live on pipeline 79, 15 of 63 rows).
            launchBlock: launchBlock([launchOnlyMember]),
            swarmStartCommand: launchReqIds.length
                ? `/swarm-start ${launchReqIds.join(' ')}` : null,
            noLaunchReason: launchReqIds.length
                ? null : noLaunchReasonFor([launchOnlyMember]),
            depIds: deps.depIds,
            timeDeps: deps.timeDeps,
            epicId: labels.epicId,
            epic: labels.epic,
            // req #3430. Travels with the label, which is what makes an
            // INHERITED label carry the right order for free: a gate step that
            // borrows its epic from a dependency borrows that epic's position
            // too, and would otherwise band correctly and sort as unordered.
            epicSortOrder: labels.epicSortOrder != null ? labels.epicSortOrder : null,
            featureId: labels.featureId,
            feature: labels.feature,
            epicLabels: labels.epicLabels,
            featureLabels: labels.featureLabels,
            // req #3192. The inheritance clause above already knows this; dropping
            // it here forced the conformance adapter to RECONSTRUCT the flag from
            // "has a dominant label AND both label sets are empty" — exact, but the
            // one place either adapter did anything beyond renaming a key, and a
            // drift-control harness that computes is a third implementation.
            // `pipeline_derive.py` publishes the same field as `label_inherited`.
            labelInherited: Boolean(labels.inherited),
            machineLabels: machines.labels,
            machineLabel: machines.label,
        };
    });
}

// ── Ordering ────────────────────────────────────────────────────────────────

function depIdsOf(row) {
    return row.depIds || [];
}

function idCmp(a, b) {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

// The step gate that is still UNSATISFIED: the deps whose row is not done
// (req #3188). A dep missing from the row set counts as unsatisfied — the safe
// direction, and verifyOrder reports it as `dangling-dependency` separately.
//
// @param {PlanRow} row
// @param {Map<number, PlanRow>} byId
// @returns {number[]}  in the row's own dep order
export function remainingGate(row, byId) {
    return depIdsOf(row).filter((d) => {
        const dep = byId.get(d);
        return !dep || dep.state !== STEP_DONE;
    });
}

// Canonical launch-unit identity: identical (dominant epic, REMAINING step gate,
// time gates, run mode, machine set) — the batch key of rules 2 and 8. Machine
// set comes from the requirement-derived labels.
//
// EPIC IS A TERM IN THE KEY (req #3188). Rule 10 gives a step exactly ONE
// dominant epic, and req #3184's concurrency model makes epic -> orchestrator a
// function: one epic, one Primary, and two orchestrators can never select the
// same requirement for launch. A batch spanning two epics therefore hands one
// epic's requirements to the other epic's Primary, and the losing epic's work
// silently leaves its owner's slice. Measured on live pipeline 2 (2026-08-01,
// 68 steps): ONE group held steps 55/57/59/60 (epic 6, Mapping Aggregator Card)
// together with 70/71/72/73/74/85 (epic 7, Swarm Backlog) — ten steps, two
// epics, rendered to the user as a single condensation suggestion.
//
// Rule 10's "a launch unit may legitimately cross epics" is about a step that
// ALREADY spans epics — which is what the dominant-label tiebreak exists to
// resolve — and is not licence to MANUFACTURE one out of steps that are each
// cleanly owned. Partitioning at the KEY rather than at each consumer is what
// makes launchBatches, displayOrder's batch clustering and verifyOrder's
// contiguity check agree by construction. (A fourth consumer, the condensation
// advisory, was deleted by req #3303 — see below.)
//
// The epic ID, not the title — unlike machineLabels, whose title/id split is the
// one deliberate divergence from pipeline_derive.py. Both engines carry the id,
// so keying on it adds no second divergence, and two epics sharing a title stay
// correctly apart.
//
// THE GATE TERM IS THE REMAINING GATE, NOT THE RAW DEP SET (req #3188). Two
// pending steps whose gates differ only in deps that are already done become
// eligible at the SAME INSTANT and can genuinely launch together; keying on the
// raw set hashed them apart and emitted two /swarm-start commands where the
// batching model says one. The remaining gate is a function of PLAN STATE ALONE,
// so this module stays pure and the same plan always renders the same way.
//
// TIME GATES STAY RAW, deliberately. Deciding whether a time gate has passed
// needs a clock, and a clock in the batch key would make the partition — and
// therefore display order and the batch-contiguity invariant — a function of
// wall time: the same unmutated plan would render differently at two instants,
// which is a worse instability than the one this fix removes. A time gate is
// also a scheduled gate the plan author wrote; two steps carrying different ones
// are different launch units by intent until both pass.
function launchKey(row, byId) {
    const epic = row.epicId != null ? row.epicId : '';
    const deps = [...new Set(remainingGate(row, byId))].sort(idCmp).join(',');
    const times = [...(row.timeDeps || [])].sort().join(',');
    const machines = [...(row.machineLabels || [])].sort().join(',');
    return `${epic}|${deps}|${times}|${row.run || 'auto'}|${machines}`;
}

// Pending launch groups keyed by launchKey; only groups of >=2 form a batch.
// The row set is needed to resolve the remaining gate, so it is indexed here
// once rather than by every caller — every caller already passes the FULL row
// set, which is what makes the key self-contained.
function pendingGroups(rows) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const groups = new Map();
    for (const r of rows) {
        if (r.state !== STEP_PENDING) continue;
        const k = launchKey(r, byId);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
    }
    return groups;
}

function cmpKey(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

// Rule 3: DISPLAY ORDER = TOPOLOGICAL, THEN STATE BANDS, THEN STREAMS — faithful
// port of the archived POC display_order() (req #3080). A row never renders
// before its dependency (selection loop only picks rows whose deps are placed).
// State bands are absolute: done > running > pending — a running row may NEVER
// render below a pending row. Within a band: execution streams (roots = not-done
// rows whose deps are all done, ranked active first then deepest continuation of
// finished work), anchor (position of latest placed dependency) clustering
// dependents under their gate, then epic (`epics.sort_order`, then first
// appearance for the unordered — req #3430), run
// (auto before manual), numeric id. Bands, streams, topology and clustering never
// derive from storage order — but storage position IS the POC's deterministic
// FINAL tie-break (done band, root ranking, epic first-appearance), so callers
// must supply rows in the canonical stored order (the steps-table order; the
// pipelines read contract must ORDER BY a stable column). Same input order in,
// same display order out.
//
// Two hardenings over the POC, both inert when no launch batch exists (the POC
// merely DETECTED batch interleaving via verify_order; this port prevents it):
//   1. batch-mates share their batch's minimum stream rank (two roots with an
//      identical gate must not be split by an unrelated root between them);
//   2. the sort key clusters batch-mates through a shared representative
//      (epic, run, id) group key before per-row tie-breaks.
//
// Cycle contract (rule 3): detect, report, deterministic fallback — the
// unplaceable remainder is appended in stored order and flagged.
//
// @param {PlanRow[]} rows  canonical stored order (steps-table order)
// @returns {OrderResult}
export function displayOrder(rows) {
    const duplicateStepIds = [];
    {
        const seenIds = new Set();
        for (const r of rows) {
            if (seenIds.has(r.id)) {
                if (!duplicateStepIds.includes(r.id)) duplicateStepIds.push(r.id);
            } else {
                seenIds.add(r.id);
            }
        }
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const idx = new Map(rows.map((r, i) => [r.id, i]));
    // req #3430 — THE EPIC TIE-BREAK IS `epics.sort_order` FIRST, first
    // appearance second. The user sets an order; the order the user sets is the
    // order the user sees (ruling 2026-08-09). An epic with NO `sort_order` is
    // UNORDERED rather than zeroth: it sorts after every ordered epic and keeps
    // first appearance among its own kind, so a plan nobody has ordered renders
    // exactly as it did before this requirement.
    //
    // The KEY is still the epic TITLE, unchanged — this is a grouping tie-break,
    // and two epics sharing a title have always grouped together here. What that
    // costs, stated rather than discovered: the group takes the `sort_order` of
    // whichever of them appears first. Deterministic, identical in both engines,
    // and reachable only by a duplicate title that no live plan has.
    //
    // RE-COERCED here rather than trusted: `buildPlanRows` always puts a number
    // or null on the row, but this function is EXPORTED and takes rows a caller
    // may have hand-built. `epicSortOrderOf` is the one definition, and the
    // Python twin re-coerces at exactly this point for exactly this reason.
    // THE LIMIT, measured and stated so it is not rediscovered as a defect:
    // this term sits BELOW state banding, so it decides only among rows that
    // already tie on (band, stream, anchor). On live pipeline 79 that is ZERO
    // of 73 rows — which is why the epic order a person SEES is delivered by
    // `pipelinePlanLayout.js`'s band stack, which sorts epics directly, and why
    // the plan TABLE still reads state-first. Corpus case
    // `epic-sort-order-does-not-outrank-a-state-band` pins it.
    const epicKeys = [];
    const epicOrderByKey = new Map();
    for (const r of rows) {
        const e = r.epic != null ? r.epic : null;
        if (!epicOrderByKey.has(e)) {
            epicKeys.push(e);
            epicOrderByKey.set(e, epicSortOrderOf({ sort_order: r.epicSortOrder }));
        }
    }
    const epicRank = new Map(epicKeys
        .map((key, appearance) => ({ key, appearance, order: epicOrderByKey.get(key) }))
        .sort((a, b) => {
            if ((a.order === null) !== (b.order === null)) return a.order === null ? 1 : -1;
            if (a.order !== null && a.order !== b.order) return a.order - b.order;
            return a.appearance - b.appearance;
        })
        .map((e, rank) => [e.key, rank]));
    const epicIdx = (r) => epicRank.get(r.epic != null ? r.epic : null);
    const knownDeps = (r) => depIdsOf(r).filter((d) => byId.has(d));

    const depthMemo = new Map();
    const depth = (r) => {
        if (depthMemo.has(r.id)) return depthMemo.get(r.id);
        depthMemo.set(r.id, 0); // cycle guard
        const v = 1 + Math.max(-1, ...knownDeps(r).map((d) => depth(byId.get(d))));
        depthMemo.set(r.id, v);
        return v;
    };
    rows.forEach(depth);

    const done = new Set(rows.filter((r) => r.state === STEP_DONE).map((r) => r.id));
    const roots = rows
        .filter((r) => r.state !== STEP_DONE && depIdsOf(r).every((d) => done.has(d)))
        .sort((a, b) =>
            (STATE_RANK[a.state] - STATE_RANK[b.state]) ||
            (depthMemo.get(b.id) - depthMemo.get(a.id)) ||
            (idx.get(a.id) - idx.get(b.id)));
    const rootRank = new Map(roots.map((r, i) => [r.id, i]));

    const groups = pendingGroups(rows);
    const batchOf = new Map();
    for (const [k, members] of groups) {
        if (members.length >= 2) for (const m of members) batchOf.set(m.id, k);
    }

    const streamMemo = new Map();
    const baseStream = (r) => {
        if (streamMemo.has(r.id)) return streamMemo.get(r.id);
        streamMemo.set(r.id, roots.length); // cycle guard (POC recursion is cycle-free
        let v;                              // here because streams only descend placed rows)
        if (rootRank.has(r.id)) {
            v = rootRank.get(r.id);
        } else {
            const ranks = knownDeps(r)
                .map((d) => byId.get(d))
                .filter((a) => a.state !== STEP_DONE)
                .map(stream);
            v = ranks.length ? Math.min(...ranks) : roots.length;
        }
        streamMemo.set(r.id, v);
        return v;
    };
    const stream = (r) => {
        const k = batchOf.get(r.id);
        if (k === undefined) return baseStream(r);
        return Math.min(...groups.get(k).map(baseStream));
    };

    const numId = (r) => {
        const n = Number(r.id);
        return Number.isFinite(n) ? n : idx.get(r.id);
    };
    const keyTail = (r) => [epicIdx(r), RUN_RANK[r.run || 'auto'] || 0, numId(r)];
    const groupTail = new Map(); // batch key -> min member tail (the representative)
    for (const [k, members] of groups) {
        if (members.length < 2) continue;
        groupTail.set(k, members.map(keyTail).reduce((a, b) => (cmpKey(a, b) <= 0 ? a : b)));
    }

    const remaining = new Map(rows.map((r) => [r.id, r]));
    const out = [];
    const pos = new Map();
    let cycleDetected = false;
    let cycleStepIds = [];
    const sortKey = (r) => {
        if (r.state === STEP_DONE) {
            return [0, 0, 0, epicIdx(r), 0, idx.get(r.id), epicIdx(r), 0, idx.get(r.id)];
        }
        const anchor = Math.max(-1,
            ...depIdsOf(r).filter((d) => pos.has(d)).map((d) => pos.get(d)));
        const band = r.state === STEP_RUNNING ? 1 : 2;
        const tail = keyTail(r);
        const group = groupTail.get(batchOf.get(r.id)) || tail;
        return [band, stream(r), anchor, ...group, ...tail];
    };
    while (remaining.size) {
        const avail = [...remaining.values()]
            .filter((r) => depIdsOf(r).every((d) => !remaining.has(d)));
        if (avail.length === 0) {
            // Dependency cycle: deterministic fallback to stored order, flagged.
            const rest = [...remaining.values()].sort((a, b) => idx.get(a.id) - idx.get(b.id));
            cycleDetected = true;
            cycleStepIds = rest.map((r) => r.id);
            out.push(...rest);
            break;
        }
        let pick = null;
        let pickKey = null;
        for (const r of avail) {
            const k = sortKey(r);
            if (!pick || cmpKey(k, pickKey) < 0) {
                pick = r;
                pickKey = k;
            }
        }
        pos.set(pick.id, out.length);
        out.push(pick);
        remaining.delete(pick.id);
    }
    return { rows: out, cycleDetected, cycleStepIds, duplicateStepIds };
}

// Rule 3 self-check: the three ordering invariants (+ explicit cycle,
// duplicate-id and dangling-dependency detection), returned as structured
// violations — NEVER thrown. CONTRACT: callers render violations LOUDLY and
// never silently ship a bad order; an empty array is the only green light.
//
// Known inherent conflict: a running/done row that depends on a not-done row
// (a step started before its gate finished) makes state banding and topology
// jointly unsatisfiable — the violations then report a real PLAN-DATA anomaly,
// not an engine bug, and clear when the plan data is corrected. Rare greedy-pass
// edge cases can also surface a batch-contiguity violation on clean data — those
// too must render loudly, exactly per this contract.
//
// Duplicate-id detection only fires when verifying rows that still CONTAIN the
// duplicates; on displayOrder output (already collapsed) read
// OrderResult.duplicateStepIds instead.
//
// @param {PlanRow[]} rows  display order (displayOrder(...).rows)
// @returns {OrderViolation[]}
export function verifyOrder(rows) {
    const violations = [];
    const posn = new Map(rows.map((r, i) => [r.id, i]));

    // Duplicate ids collapse rows in every Map-keyed pass — loudest failure first.
    {
        const seenIds = new Set();
        const dupIds = [];
        for (const r of rows) {
            if (seenIds.has(r.id)) {
                if (!dupIds.includes(r.id)) dupIds.push(r.id);
            } else {
                seenIds.add(r.id);
            }
        }
        if (dupIds.length) {
            violations.push({
                invariant: 'duplicate-id',
                stepIds: dupIds,
                message: `duplicate step ids ${dupIds.join(', ')} — rows collapse silently; ` +
                    'the rendered plan is missing steps',
            });
        }
    }

    // A dependency pointing outside the row set is data loss or an id-type
    // mismatch — the FK guarantees every dep exists within the pipeline.
    for (const r of rows) {
        for (const d of depIdsOf(r)) {
            if (!posn.has(d)) {
                violations.push({
                    invariant: 'dangling-dependency',
                    stepIds: [r.id, d],
                    message: `step ${r.id} depends on step ${d}, which is not in the rendered rows`,
                });
            }
        }
    }

    // Cycle: peel rows whose known deps are all peeled; the remainder is in —
    // or gated behind — a dependency cycle.
    const peeled = new Set();
    let progress = true;
    while (progress) {
        progress = false;
        for (const r of rows) {
            if (peeled.has(r.id)) continue;
            if (depIdsOf(r).every((d) => !posn.has(d) || peeled.has(d))) {
                peeled.add(r.id);
                progress = true;
            }
        }
    }
    const stuck = rows.filter((r) => !peeled.has(r.id)).map((r) => r.id);
    if (stuck.length > 0) {
        violations.push({
            invariant: 'cycle',
            stepIds: stuck,
            message: `dependency cycle: steps ${stuck.join(', ')} are in or gated behind a cycle; ` +
                'display fell back to stored order',
        });
    }

    // Invariant 1: topology — a row never renders before a dependency.
    for (const r of rows) {
        for (const d of depIdsOf(r)) {
            if (posn.has(d) && posn.get(d) > posn.get(r.id)) {
                violations.push({
                    invariant: 'topology',
                    stepIds: [r.id, d],
                    message: `step ${r.id} renders before its dependency ${d}`,
                });
            }
        }
    }

    // Invariant 2: state banding — done > running > pending — SUBORDINATE TO
    // TOPOLOGY.
    //
    // Design rule 3 orders the criteria: "topological, THEN state bands, then
    // streams". Topology wins, and displayOrder implements exactly that — it only
    // ever emits a row whose dependencies are already out. So when a step's GATE
    // is in a later band than the step itself, NO ordering satisfies both rules
    // and the one displayOrder picks (dependency first) is the right one.
    //
    // Checking banding as if it were absolute reported that forced case as a
    // failure. The instance that produced this relaxation was step 19 deriving
    // Running while GATING step 38, which is Complete — the banner said "treat
    // the sequence as untrustworthy" about the only sequence that was actually
    // available. That particular instance is GONE since req #3123: step 19 was
    // Running only because it links the plan's own tracking requirement (#3083),
    // and deriveStepState now exempts containers, so step 19 derives done.
    //
    // The relaxation stays, and not out of caution — it is independently
    // correct. A step legitimately starts before its gate finishes (a gate
    // passed WITH exceptions, playbook case 5), and whenever that happens
    // banding and topology remain jointly unsatisfiable no matter what any
    // requirement's flag says.
    //
    // So a band inversion is a violation only when it was AVOIDABLE: the
    // lower-band row does not depend, transitively, on the higher-band row it
    // renders below. That keeps the regression this invariant was built for —
    // two Running rows sinking below an UNRELATED Scheduled tail, which no
    // dependency forced — while no longer crying wolf about the forced case.
    const closure = new Map();
    const dependsOn = (id) => {
        if (closure.has(id)) return closure.get(id);
        const out = new Set();
        closure.set(id, out);   // cycle guard; the cycle invariant above reports it
        const row = rows.find((r) => r.id === id);
        for (const d of depIdsOf(row || {})) {
            if (!posn.has(d)) continue;
            out.add(d);
            for (const dd of dependsOn(d)) out.add(dd);
        }
        return out;
    };
    const bandOf = (r) => (STATE_RANK[r.state] != null ? STATE_RANK[r.state] : 2);
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const band = bandOf(r);
        // The earlier rows this one outranks by band but does NOT depend on.
        const avoidable = [];
        for (let j = 0; j < i; j++) {
            const p = rows[j];
            if (bandOf(p) > band && !dependsOn(r.id).has(p.id)) avoidable.push(p);
        }
        if (avoidable.length) {
            const worst = avoidable[avoidable.length - 1];
            violations.push({
                invariant: 'state-banding',
                stepIds: [r.id, worst.id],
                message: `${r.state} step ${r.id} renders below ${worst.state} step `
                    + `${worst.id}, which it does not depend on — `
                    + 'done>running>pending banding broken',
            });
        }
    }

    // Invariant 3: launch-batch contiguity — batch-mates render as one block,
    // SUBORDINATE TO TOPOLOGY on exactly the terms banding is (req #3192).
    //
    // The relaxation above was applied to ONE of the two invariants that needs
    // it. A Running step gating on a Scheduled one splits any batch the Scheduled
    // one belongs to — forced by the very conflict invariant 2 excuses — and this
    // one reported it anyway. That is the crying-wolf failure mode design rule 7
    // exists to avoid, on the loud stdout channel pipeline_engine.py emits
    // VIOLATION edges over.
    //
    // The split is FORCED when some interposed row is TRAPPED between two
    // members: it must render below one and above another, so no ordering makes
    // the batch contiguous. One trapped row is enough — it sits between two
    // members in every legal order, whatever the other interlopers do. Trapped
    // means pinned from both sides:
    //   * below member A — Z transitively DEPENDS on A. (Banding cannot pin this
    //     side: members are pending, the lowest band there is.)
    //   * above member B — B depends on Z (topology), OR Z outranks B by band and
    //     B is not a dependency of Z (banding, with the same escape invariant 2
    //     uses where topology overrules it).
    //
    // Deliberately NOT a search for a contiguous ordering. The test is SOUND —
    // everything it excuses really is forced — and admits it is not complete: a
    // split with no single trapped row still reports, the safe direction for an
    // invariant whose job is to catch the avoidable case.
    const splitIsForced = (members) => {
        const memberIds = new Set(members.map((m) => m.id));
        const positions = members.map((m) => posn.get(m.id));
        const lo = Math.min(...positions);
        const hi = Math.max(...positions);
        for (let i = lo + 1; i < hi; i++) {
            const z = rows[i];
            if (memberIds.has(z.id)) continue;
            const zDeps = dependsOn(z.id);
            let belowAMember = false;
            for (let j = lo; j < i && !belowAMember; j++) {
                if (memberIds.has(rows[j].id) && zDeps.has(rows[j].id)) belowAMember = true;
            }
            if (!belowAMember) continue;
            for (let j = i + 1; j <= hi; j++) {
                const below = rows[j];
                if (!memberIds.has(below.id)) continue;
                if (dependsOn(below.id).has(z.id)) return true;
                if (bandOf(z) < bandOf(below) && !zDeps.has(below.id)) return true;
            }
        }
        return false;
    };
    for (const [key, members] of pendingGroups(rows)) {
        if (members.length < 2) continue;
        const positions = members.map((m) => posn.get(m.id));
        if (Math.max(...positions) - Math.min(...positions) === members.length - 1) continue;
        if (splitIsForced(members)) continue;
        violations.push({
            invariant: 'batch-contiguity',
            stepIds: members.map((m) => m.id),
            message: `launch batch (${key}) not contiguous at rows ${positions.join(', ')}`,
        });
    }
    return violations;
}

// ── Eligibility ─────────────────────────────────────────────────────────────

// THE CANONICAL TIME-GATE GRAMMAR, spelled out rather than delegated (req #3192).
//
//   YYYY-MM-DD                       date only -> UTC midnight
//   YYYY-MM-DD(T| )HH:MM[:SS[.fff]]  naive -> UTC (Darwin timestamps ARE naive UTC)
//   ...Z | ...z | ...±HH:MM          explicit designator/offset
//
// NOTHING ELSE PARSES, and that is the feature. `Date.parse` and Python's
// `datetime.fromisoformat` both accept a grammar their implementers may widen:
// fromisoformat's changed in 3.11, so `20260730T000000` and `2026-07-30T00:00:00+0000`
// parse under the daemon's venv (3.13) and raise under a bare 3.9 — the SAME source
// giving different ELIGIBILITY answers on different machines. Date.parse is worse:
// its fallback path is explicitly implementation-defined and swallows `2026/07/30`
// and `30 Jul 2026`. Measured across 23 formats x 4 clocks (req #3184 review), the
// two engines disagreed on 12 combinations IN BOTH DIRECTIONS.
//
// A time gate decides whether work LAUNCHES. An unparseable gate one side reads as
// passed starts work early, so this parse must not be a moving target: never
// reintroduce `Date.parse`/`fromisoformat` here. `pipeline_derive.py::_to_epoch`
// carries the identical regex and the identical component arithmetic.
//
// Out-of-range and non-calendar values (month 13, Feb 30, hour 24) are REJECTED,
// not rolled over — `Date.UTC` would silently roll them into a different instant.
//
// A bare number is EPOCH MILLISECONDS here, the unit `Date.getTime()` speaks;
// `_to_epoch` reads one as epoch SECONDS, the unit `datetime.timestamp()` speaks.
// A raw number carries no unit, each engine reads it in its own, and both are
// internally consistent — the one recorded divergence in this parse. It never
// reaches production (`time_at` is a TIMESTAMP; both callers pass a clock
// object), and `darwin-mcp/tests/conformance/timestamp_differential.py` reports
// it every run so it cannot become folklore.
const TIMESTAMP_RE =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|z|[+-]\d{2}:\d{2})?)?$/;

function toEpochMs(t) {
    if (t == null) return null;
    if (t instanceof Date) {
        const ms = t.getTime();
        return Number.isNaN(ms) ? null : ms;
    }
    if (typeof t === 'number') return Number.isFinite(t) ? t : null;
    if (typeof t !== 'string') return null;
    const m = TIMESTAMP_RE.exec(t);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = m[4] !== undefined ? Number(m[4]) : 0;
    const minute = m[5] !== undefined ? Number(m[5]) : 0;
    const second = m[6] !== undefined ? Number(m[6]) : 0;
    // Sub-second precision is TRUNCATED to milliseconds on both sides, so a
    // fractional gate cannot land the two engines on different sides of a clock.
    const milli = m[7] !== undefined ? Number(`${m[7]}00`.slice(0, 3)) : 0;
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31
        || hour > 23 || minute > 59 || second > 59) return null;
    // setUTCFullYear, not Date.UTC: the latter maps years 0-99 into 1900-1999.
    const at = new Date(0);
    at.setUTCFullYear(year, month - 1, day);
    at.setUTCHours(hour, minute, second, milli);
    // Round-trip: rejects Feb 30 and friends, which the setters roll over.
    if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1
        || at.getUTCDate() !== day) return null;
    const zone = m[8];
    if (!zone || zone === 'Z' || zone === 'z') return at.getTime();
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) return null;
    const offsetMs = (zone[0] === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60000;
    return at.getTime() - offsetMs;
}

// Rule 5 of memory/pipeline-plan-tracking.md: ELIGIBILITY IS COMPUTED, NEVER
// STORED. A pending row is eligible when every step-dep is done AND every
// time-dep has passed relative to the caller-supplied `now` (Date | epoch ms |
// ISO string). No `now` (or an unparseable time gate) while time-deps exist →
// not eligible: this module never reads the clock itself.
//
// @param {PlanRow} row
// @param {PlanRow[]|Map<number, PlanRow>} rows  the full row set (dep lookup)
// @param {(Date|number|string)} [now]
// @returns {boolean}
export function eligibility(row, rows, now) {
    if (row.state !== STEP_PENDING) return false;
    const byId = rows instanceof Map ? rows : new Map(rows.map((r) => [r.id, r]));
    for (const d of depIdsOf(row)) {
        const dep = byId.get(d);
        if (!dep || dep.state !== STEP_DONE) return false;
    }
    const timeDeps = row.timeDeps || [];
    if (timeDeps.length === 0) return true;
    const nowMs = toEpochMs(now);
    if (nowMs == null) return false;
    return timeDeps.every((t) => {
        const gate = toEpochMs(t);
        return gate != null && gate <= nowMs;
    });
}

// ── Launch batches ──────────────────────────────────────────────────────────

// Excel-style batch letters: A..Z, then AA, AB, …
function batchLetter(i) {
    let n = i + 1;
    let s = '';
    while (n > 0) {
        n -= 1;
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26);
    }
    return s;
}

// The requirement ids a step actually LAUNCHES: rule 8's argument list, minus
// its tracking containers (req #3123) and minus everything that is not
// `swarm_ready` (req #3360).
//
// THE ANSWER IS READ, NOT RECOMPUTED. buildPlanRows owns the split, where the
// requirement rows are in hand; this is the accessor both launchBatches and
// every render surface go through, so the batch command and the per-row list
// cannot disagree about the same step.
//
// IT FAILS CLOSED. A row without the field launches NOTHING rather than falling
// back to the wider set — a silent fallback here would restore exactly the
// defect req #3360 removed, on the one input class (a row built by something
// other than buildPlanRows) nobody would think to test.
function launchableReqIds(row) {
    return [...(row.launchReqIds || [])];
}

// Why each of this step's linked requirements is missing from its command.
function launchExclusionsOf(row) {
    return [...(row.launchExcluded || [])];
}

// The noLaunchReason for a batch whose launchable set is empty. ONE vocabulary,
// EXTENDED (req #3360), never a parallel one: the caller that has to ask "is
// this the container field or the status field?" is the caller that reads the
// wrong one. The first two values predate req #3360 and are unchanged — a
// corpus asserts them, and "every link is a container" and "some links are
// finished work" want different reader actions.
// WHICH of the three no-command cases this is — the enum, not the sentence.
// ASKED OF THE IDS, never by parsing a rendered reason back apart. Null when
// something IS launchable.
function launchBlock(members) {
    if (members.some((m) => launchableReqIds(m).length)) return null;
    if (!members.some((m) => (m.reqIds || []).length)) return BLOCK_NO_LINKS;
    const allContainers = members.every((m) => {
        const tracking = new Set(m.trackingReqIds || []);
        return (m.reqIds || []).every((rid) => tracking.has(rid));
    });
    return allContainers ? BLOCK_CONTAINERS : BLOCK_NOT_READY;
}

// The human sentence for each enum value — chosen BY the enum rather than
// re-decided, so the value a consumer branches on and the sentence it prints
// can never describe different situations.
function noLaunchReasonFor(members) {
    switch (launchBlock(members)) {
    case BLOCK_NO_LINKS:
        return 'no linked requirements — nothing to launch';
    case BLOCK_CONTAINERS:
        return 'every linked requirement is a tracking container — nothing to launch';
    default:
        // NAMED, WITH THE STATUS. A shrinking argument list with no explanation
        // is indistinguishable from a bug (rule 7), and this is the shape where
        // it shrank all the way to nothing.
        return `nothing launchable — only ${LAUNCHABLE_REQUIREMENT_STATUSES.join(', ')} `
            + `launches: ${members.flatMap(launchExclusionsOf).join(', ')}`;
    }
}

// Rules 2 + 8: pending steps sharing an identical (dominant epic, remaining step
// gate + time gates, run, machine set) launch together in ONE /swarm-start.
// Batches of >=2 steps get a letter — A launches first — following display
// order, and each carries the EXACT /swarm-start argument list (requirement ids
// in display order, tracking containers excluded). A batch with nothing
// launchable — req-less gate steps, or steps linked only to containers — has no
// launchable command: swarmStartCommand is null, never an argument-less string.
//
// `gateStepIds` is the REMAINING gate (req #3188), which every member shares by
// construction now that it is the key's gate term. It is also the better answer
// for the banner it renders into: a batch that is eligible NOW reports no step
// gate rather than naming deps that closed long ago, and one that is still
// waiting names exactly what it waits on.
//
// @param {PlanRow[]} orderedRows  display order (letters follow it)
// @returns {LaunchBatch[]}
export function launchBatches(orderedRows) {
    const byId = new Map(orderedRows.map((r) => [r.id, r]));
    const groups = pendingGroups(orderedRows);
    const batches = [];
    const seen = new Set();
    for (const r of orderedRows) {
        if (r.state !== STEP_PENDING) continue;
        const k = launchKey(r, byId);
        const members = groups.get(k);
        if (members.length < 2 || seen.has(k)) continue;
        seen.add(k);
        const reqIds = members.flatMap(launchableReqIds);
        const labels = [];
        for (const m of members) {
            for (const l of m.machineLabels || []) if (!labels.includes(l)) labels.push(l);
        }
        batches.push({
            letter: batchLetter(batches.length),
            key: k,
            stepIds: members.map((m) => m.id),
            epicId: members[0].epicId != null ? members[0].epicId : null,
            epic: members[0].epic != null ? members[0].epic : null,
            gateStepIds: [...new Set(remainingGate(members[0], byId))].sort(idCmp),
            timeDeps: [...(members[0].timeDeps || [])].sort(),
            run: members[0].run || 'auto',
            machineLabels: labels,
            swarmStartArgs: reqIds,
            swarmStartCommand: reqIds.length ? `/swarm-start ${reqIds.join(' ')}` : null,
            // req #3360. Flattened across members in the same member order the
            // command is built in, so a reader can line the two up: these are
            // the ids that WOULD have been in the command and why each is not.
            // Carried even when the command is non-empty — a PARTIAL exclusion
            // is the common case and the one most easily mistaken for a bug.
            launchExcluded: members.flatMap(launchExclusionsOf),
            // req #3360. The enum beside the sentence: noLaunchReason is for a
            // person, this is what a consumer BRANCHES on to choose a remedy.
            launchBlock: launchBlock(members),
            // Why there is no command, in the batch rather than at each render
            // surface — "no linked requirements" acquired a SECOND meaning with
            // req #3123 and was flatly false for the new one: a batch can now
            // carry requirement links and still have nothing to launch, because
            // every one of them is a container. Req #3360 added a THIRD, for the
            // same reason: every link can be real work that is simply not
            // launchable. Both the table and the visualizer print this field, so
            // they cannot drift apart.
            noLaunchReason: reqIds.length ? null : noLaunchReasonFor(members),
        });
    }
    return batches;
}

// THERE IS NO CONDENSATION ADVISORY HERE, AND ITS ABSENCE IS THE DECISION
// (req #3303). It read this same partition and rendered each group of >=2 as
// "N groups of steps could be condensed". It was deleted, not hidden, for two
// reasons that hold every time it could have fired:
//
//   1. BATCHING ALREADY DELIVERS WHAT IT PROPOSED. A step is a launch unit;
//      steps sharing a launch key launch as ONE /swarm-start whether or not they
//      are one row. Merging them changes nothing about execution and costs N
//      titles, N sets of notes, N dep edges and N completion signals.
//   2. IT COULD NOT VERIFY THE CONDITION IT ADVISED. Rule 2 needs the tuple AND
//      that everything on the merged step is safe to run CONCURRENTLY — a step
//      with N requirements is one command spawning N sessions. Concurrency
//      safety is file contention, which is not in the plan data and cannot be
//      derived from it.
//
// So the group this key finds is NORMAL, CORRECT plan structure, and there is
// nothing here to auto-resolve either. Full reasoning: memory/swarm-orchestration.md
// § The launch unit — what a BATCH is.

// Sum a step's cost over its linked requirements. Rule 5: rollups are
// precomputed server-side — this never fans out.
//
// @param {PipelineStep} step
// @param {PipelineModel} model
// @param {?CostIndex} index
// @returns {StepCost}
export function aggregateStepCost(step, model, index) {
    return sumReqCost(linkedReqIds(step.id, model), index);
}

// The PlanRow-side entry point. A row already carries its `reqIds` (junction
// order), so this needs no model — which is what lets orderedPlan() decorate
// every row in one pass and lets BOTH render surfaces (the plan table and the
// plan visualizer) print the same number from the same field.
//
// @param {PlanRow} row
// @param {?CostIndex} index
// @returns {StepCost}
export function aggregateRowCost(row, index) {
    return sumReqCost(row && row.reqIds, index);
}
// ── Requirement counts (req #3225) ──────────────────────────────────────────
//
// Met/total requirement counts, per epic and for the whole plan — DERIVED from
// `model.requirements` alone, the same rows `buildPlanRows` already reads. Zero
// extra cost: no new gateway read, no per-step fan-out, no stored counter.
//
// TRACKING REQUIREMENTS ARE EXCLUDED from both the numerator and the
// denominator (req #3123's container exemption, matching the exclusion
// `deriveStepState` applies to a step's gating set). A container carries no
// acceptance criteria of its own; counting it either way would make a plan
// that TRACKS ITSELF read as permanently short of — or trivially at — 100%.
//
// THE NUMERATOR IS `TERMINAL_REQUIREMENT_STATUSES`, not a bare `=== 'met'`
// compare (req #3269). `wontfix`/`deferred` count toward it exactly like
// `met` does — the same set that already makes a step derive `done` (design
// rule 1), so a step whose requirements are all deferred is already Complete
// and its epic's count must agree rather than reading one short. req #3225's
// original "deferred/wontfix count toward the denominator only" reading made
// the label disagree with the state machine drawn beside it; this is the
// correction, not a new notion of doneness.
//
// GROUPED BY THE REQUIREMENT'S OWN feature_fk -> epic chain, deliberately not
// the step's dominant epic (rule 10's tie-break answers a different question —
// which ONE epic a multi-requirement step bands under for display — while a
// met/total count is a property of the requirement itself, independent of
// which step happens to link it, or whether any step links it at all).
//
// `byEpic` is an ARRAY, not a Map, for the same reason `epicLabels` is: a Map
// is not JSON-stable across the two engines (Python dict keys stringify, a JS
// Map does not survive JSON at all), and the conformance corpus compares this
// output for exact equality. Sorted by epic id ascending for a deterministic
// order — nothing here depends on discovery order the way band colour does.
//
// @param {PipelineModel} model
// @returns {{overall: {met: number, total: number},
//            byEpic: {epicId: number, met: number, total: number}[]}}
export function requirementCounts(model) {
    const featuresById = indexById(model.features);
    const overall = { met: 0, total: 0 };
    const byEpic = new Map();
    for (const req of (model && model.requirements) || []) {
        if (!req || isTrackingRequirement(req)) continue;
        const met = TERMINAL_REQUIREMENT_STATUSES.includes(req.requirement_status);
        overall.total += 1;
        if (met) overall.met += 1;
        const feature = req.feature_fk != null ? featuresById.get(req.feature_fk) : null;
        const epicId = feature && feature.epic_fk != null ? feature.epic_fk : null;
        if (epicId == null) continue;
        const bucket = byEpic.get(epicId) || { epicId, met: 0, total: 0 };
        bucket.total += 1;
        if (met) bucket.met += 1;
        byEpic.set(epicId, bucket);
    }
    return {
        overall,
        byEpic: [...byEpic.values()].sort((a, b) => a.epicId - b.epicId),
    };
}

// ── Pause (req #3223, rendered by req #3226) ────────────────────────────────
//
// A faithful port of `pipeline_derive.py::pause_state` — the enforcement half
// already ships this fact on the composed MCP read, but the browser reaches
// Lambda-Rest directly (never the localhost MCP daemon), so this engine has to
// derive it independently, exactly as `requirementCounts` above already does
// for req #3225's met/total counts.
//
// PAUSE SUPPRESSES LAUNCHING AND NOTHING ELSE, and is deliberately NOT folded
// into `eligibility`: a consumer has to be able to tell eligible-and-suppressed
// from not-eligible, because they read as opposite things (one is "waiting on
// a person", the other "waiting on a gate") and the plan visualizer renders
// them differently.
//
// TWO SCOPES, ONE RULE. A step is suppressed when its PLAN is paused, or when
// its DOMINANT epic (rule 10) is paused — an epic pause binds a whole-plan
// orchestrator too, so the suppression is a property of the STEP and no
// consumer has to know which orchestrator would be asking. `suppressedBy` is a
// list, not a winner, because a reader who unpauses only the plan needs to
// know the epic pause still holds the step.
//
// A missing `epic_status` reads as `active` — the column's own DB default and
// what every pre-migration row carries.
//
// @param {PipelineModel} model
// @param {PlanRow[]} rows   MUTATED IN PLACE with launchSuppressed/suppressedBy,
//                           the same discipline `orderedPlan` already applies
//                           for `row.cost` — these are freshly built rows this
//                           call owns, never a caller's cached object.
// @returns {{pipelineStatus: ?string, pipelinePaused: boolean,
//            pausedEpicIds: number[], suppressedStepIds: number[]}}
export function pauseState(model, rows) {
    const pipeline = (model && model.pipeline) || {};
    const pipelineStatus = pipeline.pipeline_status;
    const pipelinePaused = pipelineStatus === PAUSED_STATUS;

    // `model.epics` is the WHOLE label dictionary in the browser (design rule
    // 5 — `buildPipelineModel` passes it through unfiltered, unlike the
    // server's composed read, which scopes `epics` to this plan already). So
    // a paused epic elsewhere in Darwin must not appear in THIS plan's
    // `pausedEpicIds` — intersect against the epic ids this plan's own rows
    // actually carry, which is what keeps this field matching
    // `pause_state()`'s plan-scoped answer.
    const rowEpicIds = new Set();
    for (const row of rows || []) {
        if (row.epicId != null) rowEpicIds.add(row.epicId);
    }

    const pausedEpicIds = new Set();
    for (const epic of (model && model.epics) || []) {
        if (epic && epic.epic_status === PAUSED_STATUS && epic.id != null
            && rowEpicIds.has(epic.id)) {
            pausedEpicIds.add(epic.id);
        }
    }

    const suppressedStepIds = [];
    for (const row of rows || []) {
        const reasons = [];
        if (pipelinePaused) reasons.push('pipeline');
        if (row.epicId != null && pausedEpicIds.has(row.epicId)) reasons.push('epic');
        row.launchSuppressed = reasons.length > 0;
        row.suppressedBy = reasons;
        if (reasons.length) suppressedStepIds.push(row.id);
    }

    return {
        pipelineStatus,
        pipelinePaused,
        pausedEpicIds: [...pausedEpicIds].sort((a, b) => a - b),
        suppressedStepIds,
    };
}

/**
 * Which epic's turn it is, and therefore which steps must WAIT for it (req #3388).
 *
 * The browser half of `pipeline_derive.py::serial_state`. That module's
 * docstring carries the full rationale — the order is FIRST APPEARANCE IN
 * DISPLAY ORDER, an epic is CLOSED when every step it owns is `done`, and the
 * live epic is the first one not closed.
 *
 * REQ #3430 REVERSED THIS FUNCTION'S RECORDED OBJECTION TO `epics.sort_order`,
 * without changing a line of it. The objection was that the column measured
 * BACKWARDS on pipeline 79 — which measured stale data nobody was maintaining,
 * not unfitness of the column. It is maintained now and the user has ruled it
 * authoritative, so `displayOrder` orders epics by it. This function still
 * reads FIRST APPEARANCE IN DISPLAY ORDER and therefore inherits that ordering
 * rather than duplicating it: still one source, still no second stored fact.
 *
 * Called AFTER `pauseState`, whose `suppressedBy` list this APPENDS to rather
 * than replacing: a step held by both a pause and a turn must name both, or
 * unpausing it looks like it should start and does not. `turn` stays a distinct
 * reason from `epic`/`pipeline` because they clear differently — a pause needs a
 * person, a turn passes by itself when the epic ahead closes.
 *
 * An epic is BEHIND, LIVE or AHEAD, and only the ones AHEAD are held — a CLOSED
 * epic is never suppressed, because `turn` means "has not had its turn yet",
 * which is false of an epic that has finished. That is the one place serial does
 * NOT copy `pauseState`, whose `epic` reason means "this scope is paused" and is
 * true of its done steps too. Within an epic that IS ahead, suppression is by
 * MEMBERSHIP and not eligibility, exactly as `pauseState` does it.
 *
 * A step with no epic label is never suppressed by turn: it has no turn to wait
 * for, and holding it would deadlock a plan no unpause could rescue.
 */
export function serialState(model, rows) {
    const pipeline = (model && model.pipeline) || {};
    const mode = pipeline.execution_mode || MODE_PARALLEL;
    const serial = mode === MODE_SERIAL;

    // `rows` arrive in DISPLAY order — the caller's contract, and the whole
    // basis of the sequence.
    const epicOrder = [];
    for (const row of rows || []) {
        if (row.epicId != null && !epicOrder.includes(row.epicId)) {
            epicOrder.push(row.epicId);
        }
    }

    const closedEpicIds = epicOrder.filter((epicId) => (rows || [])
        .filter((row) => row.epicId === epicId)
        .every((row) => row.state === STEP_DONE));
    const closed = new Set(closedEpicIds);

    let liveEpicId = null;
    for (const epicId of epicOrder) {
        if (!closed.has(epicId)) { liveEpicId = epicId; break; }
    }

    // AHEAD of the live epic: not closed (behind) and not live.
    const waitingEpicIds = epicOrder.filter(
        (epicId) => !closed.has(epicId) && epicId !== liveEpicId);
    const waiting = new Set(waitingEpicIds);

    const heldStepIds = [];
    if (serial && liveEpicId != null) {
        for (const row of rows || []) {
            if (row.epicId == null || !waiting.has(row.epicId)) continue;
            row.suppressedBy = [...(row.suppressedBy || []), 'turn'];
            row.launchSuppressed = true;
            heldStepIds.push(row.id);
        }
    }

    return {
        executionMode: mode,
        serial,
        // In display order, which IS the running order. Not sorted by id.
        epicOrder,
        closedEpicIds,
        liveEpicId,
        waitingEpicIds,
        heldStepIds,
    };
}

// ── The two composers moved out of `../pipelineViewModel.js` (req #3356) ───
//
// `buildPipelineModel` narrowed Pipeline 1.0's whole-table reads to ONE plan;
// `orderedPlan` ran the engine above end to end. Both are here verbatim for the
// same reason the engine is: they are how the two surviving layout tests mint a
// `plan`. Neither has a production caller.

const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * Narrow whole-table reads to ONE pipeline, in the shape req #3112 fixed.
 *
 * `requirements` is narrowed to the linked set on purpose: the engine rebuilds
 * an id index inside dominantLabels() and machineLabels() once PER STEP, so
 * handing it Darwin's entire requirement table would make label derivation
 * O(steps x requirements) over thousands of irrelevant rows. Features, epics and
 * machines are small dictionaries and pass through whole.
 */
export function buildPipelineModel({
    pipeline,
    steps,
    stepRequirements,
    stepDeps,
    requirements,
    features,
    epics,
    machines,
} = {}) {
    const pipelineId = pipeline ? pipeline.id : null;
    const ownSteps = pipelineId == null
        ? []
        : asArray(steps).filter((s) => s.pipeline_fk === pipelineId);
    const stepIds = new Set(ownSteps.map((s) => s.id));

    const ownStepRequirements = asArray(stepRequirements)
        .filter((j) => stepIds.has(j.step_fk));
    // Dep rows are scoped by their OWNING step only. A dep_step_fk pointing
    // outside this pipeline cannot happen through the UI, and if it ever did,
    // dropping the row here would hide it — verifyOrder's dangling-dependency
    // check is what must surface it, loudly.
    const ownStepDeps = asArray(stepDeps).filter((d) => stepIds.has(d.step_fk));

    const linkedIds = new Set(ownStepRequirements.map((j) => j.requirement_fk));
    const ownRequirements = asArray(requirements).filter((r) => linkedIds.has(r.id));

    return {
        pipeline: pipeline || null,
        steps: ownSteps,
        stepRequirements: ownStepRequirements,
        stepDeps: ownStepDeps,
        requirements: ownRequirements,
        features: asArray(features),
        epics: asArray(epics),
        machines: asArray(machines),
    };
}

/**
 * Run the engine end to end over a model: derive -> order -> SELF-CHECK ->
 * batch -> mark eligibility -> attach cost -> derive the time axis.
 *
 * The verifyOrder() call is on the RENDERED order, which is design rule 3's
 * whole point: the renderer checks its own output. `violations` is the only
 * green light — an empty array.
 *
 * @param {Object} model         from buildPipelineModel
 * @param {Object} [options]
 * @param {(Date|number|string)} [options.now]  clock for time-gate eligibility
 * @param {?Object} [options.costIndex]          from buildCostIndex
 * @returns {Object} plan
 */
export function orderedPlan(model, { now, costIndex = null } = {}) {
    const planRows = buildPlanRows(model || {});
    const { rows, cycleDetected, cycleStepIds, duplicateStepIds } = displayOrder(planRows);
    const violations = verifyOrder(rows);
    const batches = launchBatches(rows);

    const batchLetterByStepId = new Map();
    for (const b of batches) {
        for (const id of b.stepIds) batchLetterByStepId.set(id, b.letter);
    }

    const byId = new Map(rows.map((r) => [r.id, r]));
    const eligibleStepIds = new Set(
        rows.filter((r) => eligibility(r, byId, now)).map((r) => r.id),
    );

    const unresolvedReqIds = [];
    for (const r of rows) {
        for (const id of r.unresolvedReqIds || []) {
            if (!unresolvedReqIds.includes(id)) unresolvedReqIds.push(id);
        }
    }

    // Pause first, then serial: `serialState` APPENDS to the `suppressedBy` list
    // `pauseState` writes, so calling it earlier (or not at all) leaves a step
    // reading as launchable while a turn holds it.
    const pause = pauseState(model || {}, rows);
    const serial = serialState(model || {}, rows);

    // MUTATED IN PLACE deliberately: `rows` are the freshly built PlanRows this
    // call owns (buildPlanRows returns new objects every time), never the
    // caller's input, so there is nothing outside this function to surprise.
    for (const r of rows) r.cost = aggregateRowCost(r, costIndex);

    const timeAxis = planTimeAxis(rows, (model && model.requirements) || []);

    return {
        rows,
        violations,
        timeAxis,
        batches,
        batchLetterByStepId,
        eligibleStepIds,
        cycleDetected,
        cycleStepIds,
        duplicateStepIds,
        unresolvedReqIds,
        requirementCounts: requirementCounts(model || {}),
        pause,
        serial,
    };
}
