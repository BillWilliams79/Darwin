// pipelineModel.js — pure ordering & derivation engine for the Swarm Orchestration
// pipelines feature (req #3112, plan step 38 wave 1).
//
// PURE LOGIC ONLY: plain objects in, plain objects out. No imports from query/fetch
// layers, no DB, no Date.now() — every time comparison takes a caller-supplied `now`.
// Pattern: the konvaSwarmModel.js separation (pure model module + __tests__).
//
// The algorithms are faithful ports of the POC archived in req #3080 (generate.py
// display_order()/verify_order(), viz-generate.py batch letters), which earned its
// shape through four same-day ordering regressions on the manual plan page. The 10
// design rules in req #3080 are the contract; the named rules below cite them.
//
// Data contract (fixed by req #3112, mirroring the req #3111 schema tables):
//
// @typedef {Object} PipelineStep      pipeline_steps row
// @property {number} id              stable id — assigned once, never renumbered (rule 4)
// @property {string} title
// @property {('auto'|'manual')} run
// @property {?string} notes
// @property {?string} completed_at   manual stamp — meaningful ONLY for req-less steps
//
// @typedef {Object} StepRequirement  pipeline_step_requirements junction row
// @property {number} step_fk
// @property {number} requirement_fk
//
// @typedef {Object} StepDep          pipeline_step_deps row — exactly one of
// @property {number} step_fk         dep_step_fk / time_at is set; a dual-condition
// @property {?number} dep_step_fk    gate is multiple rows on one step
// @property {?string} time_at        ISO-8601
//
// @typedef {Object} PipelineRequirement  requirements row (the fields this engine reads)
// @property {number} id
// @property {string} requirement_status
// @property {?number} machine_fk
// @property {?number} feature_fk
// @property {(0|1|boolean)} [tracking]   req #3123 — 1 = CONTAINER, not work
// @property {?string} coordination_type  carried for shape completeness; not read here
//
// @typedef {Object} PipelineFeature  features row: {id, title, epic_fk}
// @typedef {Object} PipelineEpic     epics row: {id, title}
// @typedef {Object} PipelineMachine  machines row: {id, title}
//
// @typedef {Object} PipelineModel
// @property {Object} pipeline
// @property {PipelineStep[]} steps            insertion order — NEVER display order
// @property {StepRequirement[]} stepRequirements
// @property {StepDep[]} stepDeps
// @property {PipelineRequirement[]} requirements
// @property {PipelineFeature[]} features
// @property {PipelineEpic[]} epics
// @property {PipelineMachine[]} [machines]
//
// @typedef {Object} PlanRow  self-contained render row built by buildPlanRows()
// @property {number} id
// @property {string} title
// @property {('auto'|'manual')} run
// @property {?string} notes
// @property {?string} completedAt
// @property {StepState} state           DERIVED, never stored (rule 1)
// @property {number[]} reqIds           junction order — the COMPLETE set
// @property {number[]} trackingReqIds   req #3123 — the subset of reqIds that are
//                                       CONTAINERS: they neither gate the step
//                                       (rule 1) nor appear in its /swarm-start
//                                       argument list (rule 8)
// @property {number[]} unresolvedReqIds junction rows whose requirement is missing
//                                       from model.requirements (truncated read /
//                                       data loss) — render LOUDLY; these rows'
//                                       state may be under-derived
// @property {number[]} depIds           step dependencies
// @property {string[]} timeDeps         time gates (ISO-8601)
// @property {?number} epicId            dominant epic (rule 10)
// @property {?string} epic
// @property {?number} featureId         dominant feature
// @property {?string} feature
// @property {{id: number, title: string}[]} epicLabels     full set, for tooltips
// @property {{id: number, title: string}[]} featureLabels  full set, for tooltips
// @property {boolean} labelInherited    req #3119 — the label was BORROWED from a
//                                       dependency rather than derived from this
//                                       step's own requirements (req #3192)
// @property {string[]} machineLabels
// @property {string} machineLabel      joined with ' / ', '—' when no requirements
// @property {StepCost} [cost]          req #3117 — attached by orderedPlan when a
//                                      CostIndex is supplied; absent otherwise
//
// @typedef {('done'|'running'|'pending')} StepState
//
// @typedef {Object} OrderResult
// @property {PlanRow[]} rows            display order
// @property {boolean} cycleDetected     rule-3 cycle contract: detected, reported,
// @property {number[]} cycleStepIds     deterministic fallback to stored order;
//                                       lists steps in OR gated behind the cycle
// @property {number[]} duplicateStepIds ids appearing more than once in the input —
//                                       duplicates collapse to one row; render LOUDLY
//
// @typedef {Object} OrderViolation
// @property {('topology'|'state-banding'|'batch-contiguity'|'cycle'
//            |'duplicate-id'|'dangling-dependency')} invariant
// @property {string} message
// @property {number[]} stepIds
//
// @typedef {Object} LaunchBatch
// @property {string} letter             A = launches first (display order)
// @property {string} key                canonical (epic, REMAINING gate, time gates,
//                                       run, machines) — req #3188
// @property {number[]} stepIds          display order
// @property {?number} epicId            the ONE dominant epic every member shares
// @property {?string} epic
// @property {number[]} gateStepIds      the REMAINING (unsatisfied) step gate — shared
//                                       by every member by construction (req #3188)
// @property {string[]} timeDeps
// @property {('auto'|'manual')} run
// @property {string[]} machineLabels
// @property {number[]} swarmStartArgs   the EXACT requirement-id argument list (rule 8),
//                                       tracking containers excluded
// @property {?string} swarmStartCommand '/swarm-start <req ids>', null when the
//                                       batch has nothing launchable
// @property {?string} noLaunchReason    why there is no command — null when there is
//                                       one. Distinguishes "no links at all" from
//                                       "every link is a container" (req #3123)
//
// @typedef {Object} CondensationProposal  rule 2 — proposal only; UI decides
// @property {number[]} stepIds
// @property {?number} epicId                  the ONE dominant epic every member
// @property {?string} epic                    shares (req #3188)
// @property {number[]} requirementIds         launchable only (rule 8)
// @property {number[]} trackingRequirementIds containers — carried over on a merge,
//                                             never launched (req #3123)
// @property {number[]} depStepIds             the UNION of the members' step gates —
//                                             what the MERGED step must carry
// @property {number[]} remainingDepStepIds    the unsatisfied subset, shared by every
//                                             member by construction (req #3188)
// @property {string[]} timeDeps               union, same reasoning as depStepIds
// @property {('auto'|'manual')} run
// @property {string[]} machineLabels
// @property {string} reason
//
// @typedef {Object} StepCost  shape-compatible with the cost-rollup req (#3117)
// @property {number} wallSecs
// @property {number} tokens

export const STEP_DONE = 'done';
export const STEP_RUNNING = 'running';
export const STEP_PENDING = 'pending';

// Requirement statuses that close a step (rule 1).
export const TERMINAL_REQUIREMENT_STATUSES = ['met', 'deferred', 'wontfix'];

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
// @returns {{epicId: ?number, epic: ?string, featureId: ?number, feature: ?string,
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
        featureId: domFeat ? domFeat.id : null,
        feature: domFeat ? domFeat.title : null,
        epicLabels: epicTally.map(({ id, title }) => ({ id, title })),
        featureLabels: featTally.map(({ id, title }) => ({ id, title })),
    };
}

function indexById(rows) {
    return new Map((rows || []).map((r) => [r.id, r]));
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
        const labels = inheritedLabels(step.id, new Set()) || dominantLabels(step, model);
        const machines = machineLabels(step, model);
        const deps = depsByStep.get(step.id) || { depIds: [], timeDeps: [] };
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
            depIds: deps.depIds,
            timeDeps: deps.timeDeps,
            epicId: labels.epicId,
            epic: labels.epic,
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
// cleanly owned. Partitioning at the KEY rather than at either consumer is what
// makes launchBatches, condensationProposals, displayOrder's batch clustering
// and verifyOrder's contiguity check agree by construction.
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
// dependents under their gate, then epic (first-appearance order), run
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
    const epics = [];
    for (const r of rows) {
        const e = r.epic != null ? r.epic : null;
        if (!epics.includes(e)) epics.push(e);
    }
    const epicIdx = (r) => epics.indexOf(r.epic != null ? r.epic : null);
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

// ── Launch batches & condensation ───────────────────────────────────────────

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

// The requirement ids a step actually LAUNCHES: its links minus its tracking
// containers (req #3123). Rule 8 says a step's requirement ids ARE the
// /swarm-start argument list, so before the flag existed a step linking its
// plan's tracker would have launched a session against the plan itself —
// a container has no work to do and no acceptance criteria to satisfy.
// Now that the signal is durable, the defect is fixable, so it is fixed here.
function launchableReqIds(row) {
    const tracking = new Set(row.trackingReqIds || []);
    return (row.reqIds || []).filter((id) => !tracking.has(id));
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
            // Why there is no command, in the batch rather than at each render
            // surface — "no linked requirements" acquired a SECOND meaning with
            // req #3123 and was flatly false for the new one: a batch can now
            // carry requirement links and still have nothing to launch, because
            // every one of them is a container. Both the table and the
            // visualizer print this field, so they cannot drift apart.
            noLaunchReason: reqIds.length
                ? null
                : (members.some((m) => (m.reqIds || []).length)
                    ? 'every linked requirement is a tracking container — nothing to launch'
                    : 'no linked requirements — nothing to launch'),
        });
    }
    return batches;
}

// Rule 2: A STEP IS A SWARM-START (LAUNCH UNIT). Pending steps sharing an
// identical (epic, remaining gate, run, machine) tuple are proposed for
// condensation into ONE multi-requirement step. Proposal objects only — the UI
// decides presentation. Order: first appearance in the given rows.
//
// THIS LIVES IN THE VIEWER AND NOT IN `pipeline_derive.py` — a decision, not an
// oversight (req #3188, extending req #3184's ruling). It is an advisory with no
// server consumer: the Pipeline Engine acts on eligibility and launch batches,
// never on a suggestion. Porting it would be speculative code, which is exactly
// the cost a second implementation cannot carry. What COULD have drifted — the
// pendingGroups/launchKey partition it shares with launchBatches — is not
// viewer-only: it is already dual-implemented and pinned by the shared
// conformance corpus through launch_batches, so a proposal inherits the epic
// partition and the remaining-gate key by construction rather than by a copy
// somebody has to remember to update.
//
// @param {PlanRow[]} rows  any order
// @returns {CondensationProposal[]}
export function condensationProposals(rows) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const proposals = [];
    for (const [, members] of pendingGroups(rows)) {
        if (members.length < 2) continue;
        const first = members[0];
        const labels = [];
        for (const m of members) {
            for (const l of m.machineLabels || []) if (!labels.includes(l)) labels.push(l);
        }
        // UNION, not members[0]'s copy. Under the remaining-gate key (req #3188)
        // members may hold DIFFERENT raw dep sets that merely agree on what is
        // still unsatisfied, and a caller acting on this proposal builds the
        // merged step from these ids: taking one member's set would silently
        // drop another member's already-satisfied dep edge and erase the plan's
        // record of what gated that work. The union is identical to the old
        // value whenever the members' raw sets agree, which is every case the
        // previous key could produce.
        const depStepIds = [...new Set(members.flatMap(depIdsOf))].sort(idCmp);
        const timeDeps = [...new Set(members.flatMap((m) => m.timeDeps || []))].sort();
        const remaining = [...new Set(remainingGate(first, byId))].sort(idCmp);
        const gate = remaining.length
            ? `steps ${remaining.join(', ')}` : 'no remaining step gate';
        proposals.push({
            stepIds: members.map((m) => m.id),
            epicId: first.epicId != null ? first.epicId : null,
            epic: first.epic != null ? first.epic : null,
            // Tracking containers excluded for the same reason as in
            // launchBatches: a condensed step's requirement set is what the
            // merged /swarm-start would launch. They are reported SEPARATELY
            // rather than dropped, because a caller that acts on this proposal
            // builds the merged step from these ids — and silently losing a
            // container link would delete a real row from the plan.
            requirementIds: members.flatMap(launchableReqIds),
            trackingRequirementIds: [...new Set(
                members.flatMap((m) => m.trackingReqIds || []))],
            depStepIds,
            remainingDepStepIds: remaining,
            timeDeps,
            run: first.run || 'auto',
            machineLabels: labels,
            reason: `steps ${members.map((m) => m.id).join(', ')} share the same ` +
                `remaining gate (${gate}), epic (${first.epic || 'none'}), run mode ` +
                `'${first.run || 'auto'}' and machine set — candidates to condense ` +
                'into one multi-requirement step (design rule 2)',
        });
    }
    return proposals;
}

// ── Cost (req #3117) ────────────────────────────────────────────────────────
//
// LIVE since req #3117 — these were stubs fed zeros under #3114. What changed is
// entirely upstream: `swarm_sessions.wall_secs_total` / `output_tokens_total`
// (migration 077) are stamped server-side on every session status transition, so
// a CostIndex can be folded from TWO bounded list reads instead of the
// POC's ~86 per-requirement fetches (design rule 5's named failure — 2–3 minute
// regenerations, feature shipped disabled). Nothing here fetches anything; the
// map arrives as an argument, which is what makes the rule enforceable at this
// layer rather than merely intended.

// POC fmt_cost port: '—' when no data; 'Xh Ym' / 'Ym'; tokens as 'Nk tok' below
// 1M else 'N.NM tok'; time and tokens joined with '\n' (the POC used <br>).
//
// @param {number} wallSecs
// @param {number} tokens
// @returns {string}
export function fmtCost(wallSecs, tokens) {
    const wall = wallSecs || 0;
    const tok = tokens || 0;
    if (wall === 0 && tok === 0) return '—';
    const h = Math.floor(wall / 3600);
    const m = Math.floor((wall % 3600) / 60);
    const t = h ? `${h}h ${m}m` : `${m}m`;
    if (!tok) return t;
    const k = tok < 1_000_000
        ? `${Math.round(tok / 1000)}k tok`
        : `${(tok / 1_000_000).toFixed(1)}M tok`;
    return `${t}\n${k}`;
}

// Sum a cost index over a set of requirement ids, COUNTING EACH SESSION ONCE.
//
// The de-duplication is the whole subtlety, and skipping it over-reports by a
// factor of the sharing. Design rule 2 actively PROPOSES folding requirements
// that share a gate into one multi-requirement step, and Darwin's history
// already contains sessions that closed two requirements together (2429 →
// 3056+3070, 2431 → 3063+3068). Summing such a step per requirement would count
// the same wall clock twice and print roughly double the real cost.
//
// Per-requirement attribution stays FULL: a shared session really did work for
// each requirement, and there is no apportionment rule that would not be an
// invention. What a STEP total needs is the union of the sessions its
// requirements reached — which is why the index carries session ids at all.
//
// Missing entries contribute nothing rather than zero: a requirement with no
// sessions and one whose sessions predate the backfill are both "no cost
// recorded", and both render as fmtCost's dash.
//
// @param {number[]} reqIds
// @param {?CostIndex} index   from buildCostIndex — {bySession, sessionIdsByRequirement}
// @returns {StepCost}
export function sumReqCost(reqIds, index) {
    let wallSecs = 0;
    let tokens = 0;
    if (!index || !index.bySession || !index.sessionIdsByRequirement) {
        return { wallSecs, tokens };
    }
    const counted = new Set();
    for (const rid of Array.isArray(reqIds) ? reqIds : []) {
        // Array.isArray, not `|| []`: a TRUTHY non-iterable (a bare number from
        // a hand-built index) slips past a falsy guard and throws `not
        // iterable` — inside orderedPlan, inside a useMemo, which blanks the
        // entire plan page rather than showing a dash.
        const sids = index.sessionIdsByRequirement[rid];
        for (const sid of Array.isArray(sids) ? sids : []) {
            if (counted.has(sid)) continue;
            counted.add(sid);
            const c = index.bySession[sid];
            if (!c) continue;
            wallSecs += c.wallSecs || 0;
            tokens += c.tokens || 0;
        }
    }
    return { wallSecs, tokens };
}

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
