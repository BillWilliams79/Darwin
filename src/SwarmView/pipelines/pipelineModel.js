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
// @property {number[]} reqIds           junction order
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
// @property {string[]} machineLabels
// @property {string} machineLabel      joined with ' / ', '—' when no requirements
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
// @property {string} key                canonical (dep set, time gates, run, machines)
// @property {number[]} stepIds          display order
// @property {number[]} gateStepIds
// @property {string[]} timeDeps
// @property {('auto'|'manual')} run
// @property {string[]} machineLabels
// @property {number[]} swarmStartArgs   the EXACT requirement-id argument list (rule 8)
// @property {?string} swarmStartCommand '/swarm-start <req ids>', null when the
//                                       batch has no linked requirements
//
// @typedef {Object} CondensationProposal  rule 2 — proposal only; UI decides
// @property {number[]} stepIds
// @property {number[]} requirementIds
// @property {number[]} depStepIds
// @property {string[]} timeDeps
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

// Rule 1: STEP STATE IS DERIVED, NEVER STORED-BY-HAND. Any linked requirement in
// development → running; all terminal (met/deferred/wontfix) → done; else pending.
// Zero linked requirements: the step's own completed_at stamp decides done vs
// pending — the only place that column means anything.
//
// @param {PipelineStep} step
// @param {PipelineRequirement[]} linkedReqs
// @returns {StepState}
export function deriveStepState(step, linkedReqs) {
    const reqs = (linkedReqs || []).filter(Boolean);
    if (reqs.length === 0) {
        return step && step.completed_at ? STEP_DONE : STEP_PENDING;
    }
    if (reqs.some((r) => r.requirement_status === 'development')) return STEP_RUNNING;
    if (reqs.every((r) => TERMINAL_REQUIREMENT_STATUSES.includes(r.requirement_status))) {
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

// Rule 10 sibling: machine labels from the linked requirements' machine_fk.
// NULL pin → 'Any'; unknown machine id → '#<id>' (POC behavior); multiple →
// unique labels in requirement order joined with ' / '; no requirements → '—'.
//
// @param {PipelineStep} step
// @param {PipelineModel} model
// @returns {{labels: string[], label: string}}
export function machineLabels(step, model) {
    const reqIds = linkedReqIds(step.id, model);
    if (reqIds.length === 0) return { labels: [], label: '—' };
    const reqsById = indexById(model.requirements);
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
    return (model.steps || []).map((step) => {
        const reqIds = linkedReqIds(step.id, model);
        const linked = reqIds.map((rid) => reqsById.get(rid)).filter(Boolean);
        const unresolvedReqIds = reqIds.filter((rid) => !reqsById.has(rid));
        const labels = dominantLabels(step, model);
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
            unresolvedReqIds,
            depIds: deps.depIds,
            timeDeps: deps.timeDeps,
            epicId: labels.epicId,
            epic: labels.epic,
            featureId: labels.featureId,
            feature: labels.feature,
            epicLabels: labels.epicLabels,
            featureLabels: labels.featureLabels,
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

// Canonical launch-unit identity: identical (dep set + time gates, run mode,
// machine set) — the batch key of rules 2 and 8. Time gates are part of the
// gate; machine set comes from the requirement-derived labels.
function launchKey(row) {
    const deps = [...new Set(depIdsOf(row))].sort(idCmp).join(',');
    const times = [...(row.timeDeps || [])].sort().join(',');
    const machines = [...(row.machineLabels || [])].sort().join(',');
    return `${deps}|${times}|${row.run || 'auto'}|${machines}`;
}

// Pending launch groups keyed by launchKey; only groups of >=2 form a batch.
function pendingGroups(rows) {
    const groups = new Map();
    for (const r of rows) {
        if (r.state !== STEP_PENDING) continue;
        const k = launchKey(r);
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
// not an engine bug, and clear when the plan data is corrected.
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
    if (peeled.size < rows.length) {
        const stuck = rows.filter((r) => !peeled.has(r.id)).map((r) => r.id);
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

    // Invariant 2: absolute state banding — done > running > pending.
    let lastBand = 0;
    for (const r of rows) {
        const band = STATE_RANK[r.state] != null ? STATE_RANK[r.state] : 2;
        if (band < lastBand) {
            violations.push({
                invariant: 'state-banding',
                stepIds: [r.id],
                message: `${r.state} step ${r.id} renders below a ` +
                    `${lastBand === 2 ? 'pending' : 'running'} row — ` +
                    'done>running>pending banding broken',
            });
        }
        lastBand = band;
    }

    // Invariant 3: launch-batch contiguity — batch-mates render as one block.
    for (const [key, members] of pendingGroups(rows)) {
        if (members.length < 2) continue;
        const positions = members.map((m) => posn.get(m.id));
        if (Math.max(...positions) - Math.min(...positions) !== members.length - 1) {
            violations.push({
                invariant: 'batch-contiguity',
                stepIds: members.map((m) => m.id),
                message: `launch batch (${key}) not contiguous at rows ${positions.join(', ')}`,
            });
        }
    }
    return violations;
}

// ── Eligibility ─────────────────────────────────────────────────────────────

function toEpochMs(t) {
    if (t == null) return null;
    if (t instanceof Date) return t.getTime();
    if (typeof t === 'number') return t;
    // Darwin timestamps are NAIVE UTC ("2026-07-27T01:31:17" — no designator).
    // Date.parse reads a no-offset datetime as LOCAL time, which would shift
    // every time gate by the machine's UTC offset — normalize to UTC explicitly.
    const s = /T\d/.test(t) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(t) ? `${t}Z` : t;
    const parsed = Date.parse(s);
    return Number.isNaN(parsed) ? null : parsed;
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

// Rules 2 + 8: pending steps sharing an identical (dep set + time gates, run,
// machine set) launch together in ONE /swarm-start. Batches of >=2 steps get a
// letter — A launches first — following display order, and each carries the
// EXACT /swarm-start argument list (requirement ids in display order). A batch
// with no linked requirements (req-less gate steps) has no launchable command:
// swarmStartCommand is null, never an argument-less string.
//
// @param {PlanRow[]} orderedRows  display order (letters follow it)
// @returns {LaunchBatch[]}
export function launchBatches(orderedRows) {
    const groups = pendingGroups(orderedRows);
    const batches = [];
    const seen = new Set();
    for (const r of orderedRows) {
        if (r.state !== STEP_PENDING) continue;
        const k = launchKey(r);
        const members = groups.get(k);
        if (members.length < 2 || seen.has(k)) continue;
        seen.add(k);
        const reqIds = members.flatMap((m) => m.reqIds || []);
        const labels = [];
        for (const m of members) {
            for (const l of m.machineLabels || []) if (!labels.includes(l)) labels.push(l);
        }
        batches.push({
            letter: batchLetter(batches.length),
            key: k,
            stepIds: members.map((m) => m.id),
            gateStepIds: [...depIdsOf(members[0])].sort(idCmp),
            timeDeps: [...(members[0].timeDeps || [])].sort(),
            run: members[0].run || 'auto',
            machineLabels: labels,
            swarmStartArgs: reqIds,
            swarmStartCommand: reqIds.length ? `/swarm-start ${reqIds.join(' ')}` : null,
        });
    }
    return batches;
}

// Rule 2: A STEP IS A SWARM-START (LAUNCH UNIT). Pending steps sharing an
// identical (gate, run, machine) tuple are proposed for condensation into ONE
// multi-requirement step. Proposal objects only — the UI decides presentation.
// Order: first appearance in the given rows.
//
// @param {PlanRow[]} rows  any order
// @returns {CondensationProposal[]}
export function condensationProposals(rows) {
    const proposals = [];
    for (const [, members] of pendingGroups(rows)) {
        if (members.length < 2) continue;
        const first = members[0];
        const labels = [];
        for (const m of members) {
            for (const l of m.machineLabels || []) if (!labels.includes(l)) labels.push(l);
        }
        const gate = depIdsOf(first).length
            ? `steps ${[...depIdsOf(first)].sort(idCmp).join(', ')}` : 'no step gate';
        proposals.push({
            stepIds: members.map((m) => m.id),
            requirementIds: members.flatMap((m) => m.reqIds || []),
            depStepIds: [...depIdsOf(first)].sort(idCmp),
            timeDeps: [...(first.timeDeps || [])].sort(),
            run: first.run || 'auto',
            machineLabels: labels,
            reason: `steps ${members.map((m) => m.id).join(', ')} share the same gate ` +
                `(${gate}), run mode '${first.run || 'auto'}' and machine set — ` +
                'candidates to condense into one multi-requirement step (design rule 2)',
        });
    }
    return proposals;
}

// ── Cost stubs (shape-compatible with the cost-rollup req #3117) ────────────

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

// Sum a step's cost over its linked requirements from a caller-supplied rollup
// map {[requirementId]: StepCost}. Rule 5: rollups are precomputed server-side —
// this never fans out. Missing entries contribute zero, so absent data renders
// as fmtCost's dash.
//
// @param {PipelineStep} step
// @param {PipelineModel} model
// @param {?Object<number, StepCost>} costByReq
// @returns {StepCost}
export function aggregateStepCost(step, model, costByReq) {
    let wallSecs = 0;
    let tokens = 0;
    for (const rid of linkedReqIds(step.id, model)) {
        const c = costByReq ? costByReq[rid] : null;
        if (!c) continue;
        wallSecs += c.wallSecs || 0;
        tokens += c.tokens || 0;
    }
    return { wallSecs, tokens };
}
