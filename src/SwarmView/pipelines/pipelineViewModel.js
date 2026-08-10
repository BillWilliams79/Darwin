// pipelineViewModel.js — the adapter between the four bounded list reads and the
// pure engine (req #3114; engine = pipelineModel.js, req #3112).
//
// PURE: plain rows in, plain render rows out. No React, no MUI, no hooks, no
// clock — `now` is always caller-supplied, exactly as the engine requires. Its
// own module so vitest can exercise it without a DOM and so the page components
// stay in React Fast Refresh (the instructionSort.js lesson).
//
// WHY AN ADAPTER AT ALL. The engine's contract is a `PipelineModel` scoped to ONE
// pipeline, while the hooks return whole-table lists (the junction and dep tables
// carry no pipeline_fk, so they cannot be fetched per-pipeline without an N+1 —
// design rule 5's named failure). Everything below is the narrowing, in one
// memoizable place, plus the render-shape assembly the table would otherwise do
// inline where it could not be tested.

import { formatDateTime } from '../../utils/dateFormat';
import {
    aggregateRowCost,
    buildPlanRows,
    displayOrder,
    verifyOrder,
    launchBatches,
    eligibility,
    requirementCounts,
    pauseState,
    serialState,
    STEP_DONE,
    STEP_RUNNING,
    STEP_PENDING,
} from './pipelineModel';
import { planTimeAxis } from './pipelinePlanTime';
import { PIPELINE_STATUS_VALUES } from './pipelineChipStyles';

const asArray = (v) => (Array.isArray(v) ? v : []);

// The requirement projection the plan needs, SHARED by the list page and the
// detail page. Bounded and explicit: `feature_fk` carries the Epic > Feature
// label chain (design rule 10) that `dominantLabels`/`requirementCounts`
// (pipelineModel.js) still resolve down to an EPIC — req #3373 stopped the
// drawing files from reading the FEATURE half of that chain (the Feature
// column, the datacard's feature line), but the fetch itself is unchanged:
// this engine is the 1.0 one, confirmed live and byte-identical by req #3462's
// same-day revert of req #3381's attempt to cut it over, so `epicId` still has
// no other source. Dropping `feature_fk` here would silently null out every
// band's epic. `machine_fk` the Machine column,
// `requirement_status` the derived step state (design rule 1), `tracking` the
// CONTAINER exemption to that derivation (req #3123 — without it a step linking
// a tracking requirement derives Running forever), `title` the link tooltips.
// Nothing about sessions (design rule 9).
//
// The sharing is the point, not tidiness: `useAllRequirements` puts `fields` in
// its cache key, so two pages asking for different projections are two cache
// entries and the second one refetches the whole requirements table. One
// constant means list -> detail navigation reuses the read it already paid for.
//
// `started_at` / `completed_at` (req #3201) carry the plan's TIME AXIS. The
// visualizer's horizontal position is a calendar proxy and its bands stack by
// epic start, and there is no `epics.started_at` column to read — an epic's
// start is DERIVED as a minimum over its requirements (design rule 1), so the
// two stamps have to travel with the projection. They are two DATETIME columns
// on rows already being read; the blob columns req #3078 keeps out of list
// reads are a different thing entirely.
// `ai_model` / `effort` (req #3213) answer HOW the work will be executed, which
// is the half of a requirement the hover card could not answer at all. They join
// `coordination_type`, which was already here, for the same reason `started_at`
// did: two short enum columns on rows this projection is already reading, so the
// card widens an existing whole-table read rather than adding a call.
export const PLAN_REQUIREMENT_FIELDS =
    'id,title,requirement_status,machine_fk,feature_fk,coordination_type,tracking,'
    + 'ai_model,effort,started_at,completed_at';

// ── The met/total counts preference (req #3225, defaulted ON by req #3241) ──
// ONE key and ONE default, because TWO pages read this preference and only one of
// them owns a control for it: the plan detail header writes it, and the plan LIST
// page reads it on its own next mount to title its cards and table rows. Two
// hand-copied string literals is how the two silently disagree — and the failure
// is invisible, because a page reading the wrong key simply falls back to the
// default and shows a plausible answer.
//
// THE DEFAULT IS 'on' (req #3241). It shipped 'off' on a header-width argument
// that req #3241 settled directly: the header is now `nowrap` with a considered
// elastic member, and the argument never applied to the epic band labels — which
// are drawn on the canvas — at all. The user asked to SEE the numbers; a default
// that hides them behind a control they have to find first is not that.
//
// ── AND THE KEY IS BUMPED, or the flip does not reach the person who asked ──
// `useViewPreference` prefers a STORED value over the default it is handed, and
// `changeView` writes localStorage on every click. So anyone who pressed Counts
// and pressed it again — which is exactly what someone evaluating the feature
// does — holds `'off'` in localStorage, and under the old key that value would
// outrank this default in every future tab, permanently. An open tab is worse
// still: its sessionStorage was seeded with `'off'` at mount and a reload does
// not clear it.
//
// A stored `'off'` under the OLD key is therefore ambiguous — it means either
// "I don't want these" or "this is what the old default gave me" — and the two
// are indistinguishable. The tie-break is age: req #3225 merged and req #3241
// was filed to correct it the same day, so a stored `'off'` is overwhelmingly
// the old default rather than a considered choice. A new key discards the
// ambiguous value and lets the new default actually apply; the control is
// unchanged, so anyone who does want them off is one click from it.
export const REQ_COUNTS_STORAGE_KEY = 'darwin-pipeline-req-counts-v2';
export const DEFAULT_REQ_COUNTS = 'on';

/**
 * Narrow the whole-table reads to ONE pipeline, in the shape req #3112 fixed.
 *
 * `requirements` is narrowed to the linked set on purpose: the engine rebuilds an
 * id index inside dominantLabels() and machineLabels() once PER STEP, so handing
 * it Darwin's entire requirement table would make label derivation O(steps ×
 * requirements) over thousands of irrelevant rows. Features, epics and machines
 * are small dictionaries and pass through whole.
 *
 * @param {Object} args
 * @param {?Object} args.pipeline            the pipelines row (already selected)
 * @param {Object[]} args.steps              ALL pipeline_steps rows
 * @param {Object[]} args.stepRequirements   ALL pipeline_step_requirements rows
 * @param {Object[]} args.stepDeps           ALL pipeline_step_deps rows
 * @param {Object[]} args.requirements       requirements (any superset)
 * @param {Object[]} args.features           features (any superset)
 * @param {Object[]} args.epics              epics (any superset)
 * @param {Object[]} args.machines           machines (any superset)
 * @returns {Object} PipelineModel
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

    const linkedReqIds = new Set(ownStepRequirements.map((j) => j.requirement_fk));
    const ownRequirements = asArray(requirements).filter((r) => linkedReqIds.has(r.id));

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
 * Fold the two cost reads into a CostIndex — req #3117's whole client-side
 * contribution.
 *
 * ONE PASS over two bounded lists, for any number of requirements. This is the
 * shape design rule 5 demands and the POC could not have: it fetched a
 * requirement's sessions per requirement AND a full session row per session
 * (~86 reads, 2–3 minutes, feature shipped disabled behind PLANPAGE_COSTS).
 * The reason it is possible now is entirely server-side — migration
 * 20260727052402's `wall_secs_total` / `output_tokens_total` are stamped on each
 * session status transition, so the totals survive the list projection that
 * drops `phase_tokens` (req #3078).
 *
 * ## Why the index carries session ids and not just per-requirement totals
 *
 * `byRequirement` gives a requirement FULL credit for every session that served
 * it, including one shared with another requirement — correct, because there is
 * no apportionment rule that would not be an invention. But a STEP total summed
 * from those buckets would count a shared session twice, and design rule 2
 * actively proposes folding co-gated requirements into one multi-requirement
 * step. Darwin's own history has the case (session 2429 closed 3056 and 3070).
 * So the index also records which sessions each requirement reached, and
 * `sumReqCost` unions them — full attribution per requirement, no double count
 * per step, from the same single pass.
 *
 * NULL totals (a session predating the backfill) contribute nothing rather than
 * zero — they are unknown, not free. Absent data therefore renders as
 * `fmtCost`'s em-dash instead of as "0m", which would be a claim.
 *
 * @param {Object} args
 * @param {Object[]} args.requirementSessions  requirement_sessions junction rows
 * @param {Object[]} args.sessionCosts         swarm_sessions {id, wall_secs_total,
 *                                             output_tokens_total}
 * @returns {{byRequirement: Object<number, {wallSecs, tokens}>,
 *            sessionIdsByRequirement: Object<number, number[]>,
 *            bySession: Object<number, {wallSecs, tokens}>}} CostIndex
 */
export function buildCostIndex({ requirementSessions, sessionCosts } = {}) {
    const bySession = {};
    for (const s of asArray(sessionCosts)) {
        if (s == null || s.id == null) continue;
        const wall = Number(s.wall_secs_total);
        const tok = Number(s.output_tokens_total);
        const hasWall = s.wall_secs_total != null && Number.isFinite(wall);
        const hasTok = s.output_tokens_total != null && Number.isFinite(tok);
        // A session whose totals are BOTH unknown is not indexed at all, so a
        // requirement reaching only such sessions stays absent from
        // byRequirement and renders as a dash rather than a computed zero.
        if (!hasWall && !hasTok) continue;
        bySession[Number(s.id)] = {
            wallSecs: hasWall ? wall : 0, tokens: hasTok ? tok : 0,
        };
    }

    const byRequirement = {};
    const sessionIdsByRequirement = {};
    for (const link of asArray(requirementSessions)) {
        if (link == null) continue;
        const cost = bySession[link.session_fk];
        if (!cost) continue;
        const rid = link.requirement_fk;
        // COERCED, and the de-dup is why. The object-key lookups above are
        // type-tolerant (JS coerces a key to string), but `includes` and `Set.has`
        // use SameValueZero — so a junction row carrying '2429' next to one
        // carrying 2429 would index fine and then de-dup as two distinct
        // sessions, silently restoring the double count this index exists to
        // prevent. Lambda-Rest's JSON_OBJECT renders INT as a number today; this
        // makes the structure type-consistent regardless.
        const sid = Number(link.session_fk);
        if (!Number.isFinite(sid)) continue;
        const seen = sessionIdsByRequirement[rid]
            || (sessionIdsByRequirement[rid] = []);
        // The junction's PK is (requirement_fk, session_fk), so a duplicate pair
        // cannot exist in the table — but the read is data, not a proof, and a
        // repeated pair would double a requirement's own total.
        if (seen.includes(sid)) continue;
        seen.push(sid);
        const bucket = byRequirement[rid] || (byRequirement[rid] = {
            wallSecs: 0, tokens: 0,
        });
        bucket.wallSecs += cost.wallSecs;
        bucket.tokens += cost.tokens;
    }

    return { byRequirement, sessionIdsByRequirement, bySession };
}

/**
 * Run the engine end to end over a model: derive → order → SELF-CHECK → batch →
 * mark eligibility → attach cost → derive the time axis.
 *
 * The verifyOrder() call is on the RENDERED order, which is design rule 3's whole
 * point: the renderer checks its own output and the caller renders any violation
 * loudly. `violations` is the only green light — an empty array.
 *
 * Cost is attached HERE, onto `row.cost`, rather than computed in a cell
 * renderer: the plan table and the plan visualizer are two surfaces over one
 * plan, and a number they each derive independently is a number that can
 * disagree. It is attached AFTER ordering and verification and is never an
 * ordering input — cost must not be able to move a row.
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

    // Junction rows whose requirement is missing from the read. Design rule 5
    // says the page renders from bounded reads; a bounded read that TRUNCATED
    // would under-derive step state in total silence, so it is surfaced with the
    // ordering violations rather than shrugged off.
    const unresolvedReqIds = [];
    for (const r of rows) {
        for (const id of r.unresolvedReqIds || []) {
            if (!unresolvedReqIds.includes(id)) unresolvedReqIds.push(id);
        }
    }

    // req #3226 — pause suppression (req #3223's enforcement half, rendered
    // here). Mutates each row with `launchSuppressed`/`suppressedBy`, the same
    // "freshly built rows this call owns" discipline `row.cost` relies on
    // below, so it runs first and the cost loop's own comment still describes
    // every mutation these rows carry.
    const pause = pauseState(model || {}, rows);

    // req #3388 — serial turn-taking, IMMEDIATELY AFTER pause and before
    // anything reads `suppressedBy`. It appends `turn` to the same list pause
    // just wrote, so calling it later (or not at all) leaves the browser
    // showing a step as launchable while the engine is holding it — the two
    // surfaces disagreeing about the live plan, which is the exact failure the
    // shared conformance corpus exists to prevent. The corpus pins
    // `serialState` itself; THIS line is what puts it on the browser's path.
    const serial = serialState(model || {}, rows);

    // MUTATED IN PLACE deliberately: `rows` are the freshly built PlanRows this
    // call owns (buildPlanRows returns new objects every time), never the caller's
    // input, so there is nothing outside this function to surprise.
    for (const r of rows) r.cost = aggregateRowCost(r, costIndex);

    // The visualizer's TIME AXIS (req #3201). Derived here rather than in the
    // canvas for the same reason cost is: the plan table and the plan
    // visualizer are two surfaces over one plan, and a fact they each derive
    // independently is a fact that can disagree. Like cost, and for the same
    // reason, it is computed AFTER ordering and is never an ordering input —
    // display order stays topological-then-state-banded (rule 3), and only the
    // canvas's column origins and band stacking read this.
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
        // req #3225 — pure CPU over `model.requirements`/`model.features`,
        // both already in hand. No extra read, same as cost/timeAxis above.
        requirementCounts: requirementCounts(model || {}),
        // req #3226 — see the mutation above; carried here too so a consumer
        // that only has `plan` (not the rows) can still read the plan-wide
        // and epic-wide pause facts.
        pause,
        // req #3388 — the mode, the epic order, which epics are closed, whose
        // turn it is and what that holds. Carried beside `pause` for the same
        // reason: a consumer with only `plan` and not the rows still needs the
        // plan-wide answer.
        serial,
    };
}

/**
 * The flat render list the plan table maps over: ONE ENTRY PER STEP ROW,
 * pre-decorated with everything the cell renderers need.
 *
 * ONE ROW KIND (req #3371). This list used to interleave full-width
 * launch banners with the step rows — a banner immediately before the first
 * member of each launch group, carrying that group's letter, members, gate, run
 * mode, machines and the exact `/swarm-start` argument list. In Pipeline 2.0 the
 * STEP is the launch unit, so all of that is a property of ONE row and renders
 * on it: `kind`, the per-row launch-group letter and the emitted/by-letter
 * bookkeeping are gone with the banner, and the plan table renders the command
 * in the step's own Requirement(s) cell.
 *
 * Epic "render once per contiguous group" therefore has nothing to skip over
 * any more — it used to be computed over STEP rows only, so a banner between
 * two rows of the same epic could not restart the group. The FEATURE tier
 * (req #3373) is gone with it: Feature was never drawn anywhere but this
 * "once per contiguous group" pass, so removing the second tier is the whole
 * of the change.
 *
 * Grouping compares the epic ID, not its title. Two distinct epics that happen
 * to share a title would otherwise merge into one visual group and the
 * second's label would be suppressed — and the seeded plan already has the
 * near-miss (epic 9003 and feature 9012 are both titled "Swarm Orchestration
 * Feature"). The engine exposes the id, so there is no reason to compare
 * display strings.
 *
 * @param {Object} plan  `orderedPlan`'s return — req #3462 reverted the
 *   Pipeline 2.0 composed-read path (`adaptComposedPipeline2`) off the detail
 *   page after a production outage, so `orderedPlan` is this function's only
 *   caller again; the shape (`rows`, `eligibleStepIds`) is what's read, not
 *   the producer, so this keeps working unchanged if that path returns.
 * @returns {Array<{row: Object, showEpic: boolean, eligible: boolean}>}
 */
export function planRenderRows(plan) {
    const { rows = [], eligibleStepIds = new Set() } = plan || {};
    const out = [];
    let prevEpic;

    for (const row of rows) {
        const epic = row.epicId != null ? row.epicId : null;
        out.push({
            row,
            showEpic: epic !== prevEpic,
            eligible: eligibleStepIds.has(row.id),
        });
        prevEpic = epic;
    }
    return out;
}

/**
 * Done / Running / Scheduled counts for a set of plan rows — the list page's
 * mini-summary and the detail header's accounting line.
 *
 * @param {Object[]} rows  PlanRows in any order
 * @returns {{total: number, done: number, running: number, pending: number}}
 */
export function pipelineSummary(rows) {
    const summary = { total: 0, done: 0, running: 0, pending: 0 };
    for (const r of asArray(rows)) {
        summary.total += 1;
        if (r.state === STEP_DONE) summary.done += 1;
        else if (r.state === STEP_RUNNING) summary.running += 1;
        else summary.pending += 1;
    }
    return summary;
}

/**
 * Per-pipeline summaries for the LIST page, in one pass over the whole-table
 * reads. Design rule 5 in miniature: N pipelines are summarized from the same
 * four lists the detail page uses, never from N per-pipeline fetches.
 *
 * @param {Object} args  same lists as buildPipelineModel, plus `pipelines`
 * @returns {Map<number, {total, done, running, pending}>}
 */
export function pipelineSummaries({ pipelines, steps, stepRequirements, requirements } = {}) {
    const out = new Map();
    for (const p of asArray(pipelines)) {
        const model = buildPipelineModel({
            pipeline: p,
            steps,
            stepRequirements,
            stepDeps: [],
            requirements,
            features: [],
            epics: [],
            machines: [],
        });
        out.set(p.id, pipelineSummary(buildPlanRows(model)));
    }
    return out;
}

/**
 * Per-pipeline requirement met/total counts for the LIST page (req #3225),
 * mirroring `pipelineSummaries` — one pass over the same shared reads, never a
 * per-pipeline fetch (design rule 5). Only the plan-wide `overall` bucket is
 * needed here: the list page names a PLAN, never an epic.
 *
 * @param {Object} args  same lists as buildPipelineModel, plus `pipelines`
 * @returns {Map<number, {met: number, total: number}>}
 */
export function pipelineRequirementCounts({ pipelines, steps, stepRequirements,
    requirements } = {}) {
    const out = new Map();
    for (const p of asArray(pipelines)) {
        const model = buildPipelineModel({
            pipeline: p,
            steps,
            stepRequirements,
            stepDeps: [],
            requirements,
            features: [],
            epics: [],
            machines: [],
        });
        out.set(p.id, requirementCounts(model).overall);
    }
    return out;
}

/**
 * Statuses hidden by the current multi-select filter that would otherwise show
 * at least one pipeline (req #3220) — what the list page's empty state names so
 * a user who filtered a page to nothing is told WHY rather than shown a blank
 * view. A status the filter excludes but that has zero matching pipelines is
 * left out: naming it would not explain anything the user can see.
 *
 * @param {Object[]} pipelines     the FULL (unfiltered) pipelines list
 * @param {string[]} statusFilter  the currently-selected pipeline_status values
 * @returns {{status: string, count: number}[]} in PIPELINE_STATUS_VALUES order
 */
export function hiddenPipelineStatusCounts(pipelines, statusFilter) {
    const selected = asArray(statusFilter);
    const counts = {};
    for (const p of asArray(pipelines)) {
        if (!p || !p.pipeline_status) continue;
        counts[p.pipeline_status] = (counts[p.pipeline_status] || 0) + 1;
    }
    return PIPELINE_STATUS_VALUES
        .filter((status) => !selected.includes(status) && counts[status])
        .map((status) => ({ status, count: counts[status] }));
}

/**
 * The list page's empty-state sentence. "No pipelines yet" is a claim about the
 * DATA and is false whenever a status filter is what emptied the view — this
 * names the hidden statuses and their counts instead (req #3220 acceptance).
 *
 * @param {{status: string, count: number}[]} hiddenStatusCounts
 * @returns {string}
 */
export function pipelinesEmptyMessage(hiddenStatusCounts) {
    const hidden = asArray(hiddenStatusCounts);
    if (!hidden.length) return 'No pipelines yet.';
    const named = hidden.map(({ status, count }) => `${status} (${count})`).join(', ');
    return `No pipelines match this filter — hidden: ${named}.`;
}

// ── The no-'#' directive ────────────────────────────────────────────────────
//
// "NO '#' prefix on requirement ids anywhere" (req #3080 POC polish review,
// carried by memory/swarm-orchestration.md § Production visualizer directives).
//
// SCOPE, stated precisely because it is easy to over-apply: it governs labels
// this UI GENERATES — requirement id links, machine labels, step ids, gate and
// launch text. It does NOT govern the plan's own prose. A step title like
// "Clone canary 2 (Mac mini, #3077 R13)" and a notes field like "dispositioned
// into #3061 scope" are stored PLAN CONTENT, and rewriting them at render time
// would be falsifying the user's own record to satisfy a styling rule. They
// render verbatim.
//
// The engine's machineLabels() degrades an unresolvable machine id to the POC's
// `#<id>` form, so it is the one generated label that needs stripping.

const stripHash = (s) => String(s).replace(/^#/, '');

/**
 * Machine title for an id, matching the engine's machineLabels() vocabulary so a
 * pipeline header and a plan row never disagree: NULL pin reads "Any", an
 * unknown id degrades to its own id rather than to a blank.
 */
export function machineTitle(machineFk, machines) {
    if (machineFk == null) return 'Any';
    const hit = asArray(machines).find((m) => m.id === machineFk);
    return hit && hit.title ? hit.title : String(machineFk);
}

/**
 * A plan row's Machine cell text: unique labels joined with ' / ', an em-dash
 * when the step links no requirements, and never a '#'.
 */
export function rowMachineLabel(row) {
    const labels = asArray(row && row.machineLabels).map(stripHash);
    return labels.length ? labels.join(' / ') : '—';
}

// A second machine formatter lived here until req #3371 — same rules, reading
// a launch group's own `machineLabels` for the banner row. The step row's cell
// already goes through `rowMachineLabel` above, and with the banner gone there
// was one carrier and one caller, so the duplicate is deleted rather than
// renamed: a helper nothing calls is worse than the three lines it saved.

// ── Time gates ──────────────────────────────────────────────────────────────
//
// ONE formatter, used by BOTH the Depends-on cell and the launch line on a step
// row. They are the same instant and must not read two different ways — the old
// launch banner shipped the raw wire value (`2026-07-24 06:31:38.000000`, UTC,
// microseconds and all) while the cell showed a localized one.
//
// `dateFormat.formatDateTime` now normalizes BOTH the MySQL space-separated
// naive form and the ISO-ish `T` form to UTC (req #3120 fixed the asymmetry
// that used to live here), so no local normalization is needed.
/**
 * A wall-clock dependency, rendered the way every other timestamp in the app is.
 *
 * @param {string} timeAt   ISO-8601 or MySQL naive datetime
 * @param {?string} timezone
 * @returns {string}
 */
export function formatTimeGate(timeAt, timezone) {
    if (!timeAt) return '';
    return formatDateTime(timeAt, timezone);
}

/**
 * All of a step's wall-clock gates, formatted.
 *
 * Returned as an ARRAY, never pre-joined: a formatted datetime contains both
 * spaces and commas, so any single-character delimiter is ambiguous inside it —
 * and a step may legitimately carry several time conditions (migration 076
 * leaves `time_at` rows out of the UNIQUE key precisely so it can). The caller
 * gives each its own line or chip.
 */
export function formatTimeGates(timeDeps, timezone) {
    return asArray(timeDeps).map((t) => formatTimeGate(t, timezone)).filter(Boolean);
}

// `pipeline_steps.title` is VARCHAR(256) while `notes` is TEXT, so a long step
// summary that was written to both columns arrives TRUNCATED in one and whole in
// the other — which is exactly what the seeded fixture does (12 of its 34 rows
// end in a literal ellipsis). Printing both would show the same sentence twice,
// once cut short.
const ELLIPSIS = /\s*(?:…|\.\.\.)\s*$/;

/**
 * What the "What this step does" cell should print.
 *
 * `notes` is the evidence/findings/disposition field and is normally ADDITIONAL
 * to the title — but when it is merely the untruncated title, the honest render
 * is the complete sentence, once. Nothing is ever rewritten: this only chooses
 * which stored string to show.
 *
 * @param {Object} row  a PlanRow
 * @returns {{text: string, notes: ?string}}
 */
export function stepProse(row) {
    const title = (row && row.title ? row.title : '').trim();
    const notes = row && row.notes ? String(row.notes).trim() : '';
    if (!notes) return { text: title, notes: null };
    const stem = title.replace(ELLIPSIS, '');
    // Notes restates the title (possibly completing a truncation) — show notes
    // alone, since it is the superset.
    if (stem && notes.startsWith(stem)) return { text: notes, notes: null };
    return { text: title, notes };
}

/**
 * The step's NAME, for the Name column (req #3119).
 *
 * A title is a name — "Session Drain", "Bounded MCP Reads" — not the opening
 * clause of the description. The darwin_dev fixture used to load
 * `short_title(summary)` here, so a "name" could be 256 characters of truncated
 * prose; the seed generator now loads the plan's own short title instead.
 *
 * Rows written before that fix (or by any other producer) can still carry a
 * paragraph, and this column must not become a second copy of the description.
 * So a name that is clearly prose is CUT for display — the full string stays one
 * hover away, and the description column still prints it in full. The cut is
 * presentational only; nothing stored is rewritten.
 *
 * @param {Object} row  a PlanRow
 * @returns {{text: string, full: string, truncated: boolean}}
 */
export const STEP_NAME_MAX = 48;

export function stepName(row, max = STEP_NAME_MAX) {
    const full = (row && row.title ? String(row.title) : '').trim();
    if (!full) return { text: '—', full: '', truncated: false };
    if (full.length <= max) return { text: full, full, truncated: false };
    // Cut at a word boundary so a name never ends mid-token, matching the
    // generator's own short_title().
    const cut = full.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    return { text: `${space > 0 ? cut.slice(0, space) : cut}…`, full, truncated: true };
}

/**
 * What the "What this step does" cell should print, now that Name is its own
 * column (req #3119): the DESCRIPTION, never the name repeated.
 *
 * `notes` is the full summary prose. When a row has no notes at all there is no
 * description to show, and the title is the only thing written about the step —
 * printing it beats printing an em-dash, so it falls back.
 *
 * It does NOT re-print the title alongside the notes, even when the notes are a
 * short supplementary remark rather than a full description: the Name column
 * carries the title on the same row, earlier in the row, and repeating it
 * here is what the Name column was added to stop.
 *
 * @param {Object} row  a PlanRow
 * @returns {string}
 */
export function stepDescription(row) {
    const notes = row && row.notes ? String(row.notes).trim() : '';
    if (!notes) return (row && row.title ? String(row.title) : '').trim();
    return notes;
}

export { STEP_DONE, STEP_RUNNING, STEP_PENDING };
