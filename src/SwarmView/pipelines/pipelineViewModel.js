// pipelineViewModel.js — the plan pages' RENDER HELPERS (req #3114).
//
// PURE: plain rows in, plain strings/shapes out. No React, no MUI, no hooks, no
// clock. Its own module so vitest can exercise it without a DOM and so the page
// components stay in React Fast Refresh (the instructionSort.js lesson).
//
// ── WHAT req #3356 TOOK OUT OF THIS FILE ───────────────────────────────────
// It was ALSO the adapter between Pipeline 1.0's seven bounded list reads and
// the browser-side derivation engine: `PLAN_REQUIREMENT_FIELDS` (that fetch's
// requirement projection), `buildPipelineModel` (narrowing whole-table reads to
// one plan), `orderedPlan` (running the engine end to end), and
// `pipelineSummary`/`pipelineSummaries`/`pipelineRequirementCounts` (the 1.0
// list page's per-plan rollups). All of it is gone with Pipeline 1.0: the
// derivation now runs ONCE, server-side, in `pipeline2_derive.py`, and
// `pipelineAdapter.js` reshapes its output. Nothing in the browser composes an
// engine any more.
//
// What is left is the half that was never about the fetch — the formatters and
// small render shapes the plan TABLE, the plan VISUALIZER and the 2.0 list page
// all read. They are era-neutral by nature: they take a `PlanRow` and return a
// string, and a `PlanRow` is a `PlanRow` whoever built it.

import { formatDateTime } from '../../utils/dateFormat';
import { STEP_DONE, STEP_RUNNING, STEP_PENDING } from './pipelineModel';
import { PIPELINE_STATUS_VALUES } from './pipelineChipStyles';

const asArray = (v) => (Array.isArray(v) ? v : []);

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
 * @param {Object} plan  `adaptComposedPipeline`'s return. req #3462 reverted
 *   the composed-read path off the detail page after a production outage and
 *   `orderedPlan` was this function's only caller for a while; req #3356 deleted
 *   `orderedPlan` with Pipeline 1.0, leaving the composed path as the one
 *   producer. Only the SHAPE (`rows`, `eligibleStepIds`) is read, never the
 *   producer, which is why neither swap touched a line of this function.
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
// `pipelineAdapter.js::machineLabelsFor` degrades an unresolvable machine id to
// the POC's `#<id>` form, so it is the one generated label that needs stripping.

const stripHash = (s) => String(s).replace(/^#/, '');

/**
 * Machine title for an id, matching `pipelineAdapter.js::machineLabelsFor`'s
 * vocabulary so a pipeline header and a plan row never disagree: NULL pin reads
 * "Any", an unknown id degrades to its own id rather than to a blank.
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
 * SUPERSEDED AND CURRENTLY UNCALLED. req #3119 gave the step NAME its own
 * column, and `stepDescription` below is what the description cell has called
 * since; this pairs a title with its notes, which no cell does any more. Kept
 * rather than deleted because it is era-neutral (a `PlanRow` in, two strings
 * out) and because the ellipsis-completion rule it encodes is a real property of
 * the data — `pipeline_steps.title` is VARCHAR(256) against a TEXT `notes`, so
 * a summary written to both still arrives truncated in one. Retiring it is a
 * separate call from retiring Pipeline 1.0.
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
