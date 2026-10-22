// pipelinePlanTime.js — the plan's DERIVED TIME AXIS (req #3201).
//
// PURE: plain rows in, plain time facts out. No React, no clock, no DOM. It is
// its own module because it answers a DATA question ("when was this step last
// worked?" — req #3692; under req #3201 it was "when did it begin?") that
// `pipelinePlanLayout.js` — pure geometry — must not be the place to answer,
// and that `pipelineModel.js` must not answer either: that engine is
// mirrored line for line by `darwin-mcp/services/pipeline_derive.py` under a
// shared conformance corpus, and the orchestration engine has no use for a
// rendering axis. Adding this there would grow the parity surface for a fact
// only a canvas reads.
//
// ── WHY THE AXIS EXISTS ─────────────────────────────────────────────────────
// The visualizer's horizontal position used to be dependency DEPTH alone, so a
// brand-new epic — whose steps have no dep edges, because nothing existed to
// gate them on — landed in column 0 and visually claimed it runs FIRST. The
// live workaround was to attach a dependency edge that does not exist purely to
// push the row rightwards (pipeline 2, step 97 -> 88, 2026-08-01). A layout
// that can only be corrected by lying in the data is the bug.
//
// ── A STEP SITS ON ITS LAST ACTIVITY, AND OPEN WORK SITS ON TODAY (req #3692) ─
// There is no stored step or epic time (design rule 1 — derive, don't store);
// a step's time is derived from its requirements' `started_at`/`completed_at`.
// Req #3201 took the MINIMUM — when the step's work BEGAN. Req #3692 (the
// user's rule) replaced it with the MAXIMUM — the step's LAST ACTIVITY — and put
// every RUNNING step on TODAY, because what a reader opens the plan to see is
// the work that is live, standing together in one vertical stack: "the work
// that is active being oriented together ... is more important than step date
// alignment of any kind". Measured on live pipeline 10 (2026-10-20): under the
// minimum, the Sunday Review epic — three running steps, eleven requirements
// met that day — sat in the 10-19 column because each step's FIRST requirement
// closed on the 19th, while the Drag and Drop epic's running step sat alone in
// 10-20. Under last activity both are in today's column. The layout's
// monotonize step (`computeTimeColumns`) is what makes a step "drag its
// dependents with it": a dependent's column is never earlier than its gate's.
// The map keys keep their req #3201 names (`stepStarts`, `bandStarts`) — they
// are the step's PLACEMENT time, which is no longer its start.
//
// Six decisions, stated in full below, plus a seventh on the enum this file
// exports (FUTURE and UNKNOWN are different answers). A DAY is the reader's
// LOCAL calendar day (`localDayOf`), not the UTC day the stamps are stored in.
// `memory/pipeline-plan-visualizer.md` § "Deriving a start" carried rules 1
// and 2 and the FUTURE/UNKNOWN rule and was deleted with the first generation
// (req #3356), so THIS HEADER IS NOW THEIR SINGLE SOURCE:
//
// 1. **A requirement that completed without ever being stamped `started_at`
//    COUNTS AS ACTIVE ON ITS `completed_at`.** This is not a courtesy. Measured against the whole
//    live requirements table on 2026-08-01: 820 of 960 `met` requirements have
//    `started_at` NULL, and only 2 of the 32 requirements in live pipeline 2's
//    "Pipeline" epic carry one. A literal MIN(started_at) rule classified FIVE
//    of that plan's SIX epics as never-started — including two that are 100%
//    done — and would have banished finished work to the right-hand future.
//    That is the same defect this axis fixes, inverted. `completed_at` is
//    populated, and it is the requirement's last activity by definition.
// 2. **No TERMINAL status ever votes FUTURE**, and the set is IMPORTED from the
//    engine rather than re-listed here. This is the review finding that made
//    the rule derived instead of hand-written: `deferred` is terminal —
//    `deriveStepState` returns `done` for a step whose requirements are all
//    terminal — so listing it as not-yet-started put a GREEN CHECKED BEAD in
//    the not-yet-begun region. Live pipeline 2, step 35 "Messaging Design"
//    (requirement 3108, `deferred`, no stamps) moved from column 18 to the
//    FUTURE slot origin, the only done step among 21 pending ones. Worse, the
//    monotone max propagates: every step downstream of a deferred-only step is
//    dragged into the future regardless of its OWN stamps. Deriving the set
//    from `TERMINAL_REQUIREMENT_STATUSES` makes that class of drift
//    unrepresentable — a status the engine calls finished can never be one this
//    module calls future.
// 3. **An EMPTY step sits on TODAY when the plan has active work, else in the
//    FUTURE (req #3618, the user's rule).** An empty step — no linked
//    requirements — has no stamp of any kind (a step carries no time of its
//    own: req #3752 dropped `pipeline_steps.completed_at`), so it used
//    to be UNKNOWN, and an UNKNOWN step at the head of a chain has nothing
//    upstream to take a time from: it fell into the plan's EARLIEST slot, the
//    far-left edge, days before the work it was just added in front of. It is
//    work that has not happened yet, so it belongs at "now or later": TODAY if
//    any step in the plan is running, FUTURE if none is (rule 6 can still
//    bring it onto today when it hangs off today's work). TODAY is the
//    reader's local day of `now` (`localDayOf`), like every day on this axis.
//    THE COST, accepted by the user when this was ruled: the layout's
//    monotonization drags every DEPENDENT of the empty step to at least its
//    slot, so an empty step added in front of older dated work moves that work
//    to today (or into the future region). The rule applies only when the
//    caller supplies `now`; without it an empty step stays UNKNOWN.
// 4. **A RUNNING step sits on TODAY (req #3692).** Running — the canvas's
//    colour input (`pipelineAdapter.js::visualizerColourInput`), not a step
//    state, since a step has none (req #3750) — means a linked
//    requirement is in flight right now, so the step's last activity IS now,
//    whatever its stamps say — a requirement stamped `started_at` three days
//    ago and still in `development` is today's work. This is what stacks every
//    open step of every epic in one column. Like rule 3 it applies only when
//    the caller supplies `now`; without it a running step falls back to its
//    stamps.
// 5. **A not-yet-started step UPSTREAM of today's work sits on TODAY too
//    (req #3692 review).** Dependencies are a launch priority, not a gate
//    (req #3597), so a step can run — or finish — while one it depends on has
//    not begun. The layout ranks FUTURE above every date when it drags
//    dependents after their gates, so without this rule today's work would be
//    pulled into the not-yet-begun region by its own unstarted gate. Today's
//    work stays on today, and its gate comes with it
//    (`pullFutureGatesToToday`). Seeded from every step on today — running
//    (rule 4) or worked today — not from running steps alone, which left a
//    step finished today in the FUTURE column behind an unstarted gate.
// 6. **Today's work DRAGS ITS NOT-YET-STARTED DEPENDENTS ONTO TODAY (req
//    #3692, the user's review of the first cut).** A FUTURE step downstream of
//    any step on today — running, or worked today — sits on today, transitively
//    (`dragFutureDependentsToToday`). Without it the FUTURE slot sits past
//    every dated column, so live pipeline 10's Drag and Drop steps 326-328,
//    queued behind running step 325, were flung past the whole Sunday Review
//    epic instead of following 325 — "drags its dependents with it". A queued
//    step with NO path from today's work stays FUTURE, so untouched backlog
//    still reads as not-yet-begun, and work hanging off an OLDER day is not
//    dragged into that day: it has not happened then, and only today can
//    still claim it.
//    Rules 5 and 6 are applied TOGETHER, repeatedly, until neither moves
//    anything: a dependent dragged onto today by rule 6 may wait on another
//    unstarted gate, which rule 5 must then pull forward, or the layout would
//    still draw that dependent in FUTURE. It always terminates — each pass only
//    turns FUTURE steps into TODAY, and there are finitely many.

import { STEP_RUNNING, TERMINAL_REQUIREMENT_STATUSES } from './pipelineModel';

// A status positively asserts "this work has not begun" only if the engine
// neither calls it finished nor calls it in flight. Today that is `authoring`,
// `approved` and `swarm_ready` — but it is computed, so a new status is
// classified by what the engine already says about it.
export const isNotYetStarted = (status) =>
    !TERMINAL_REQUIREMENT_STATUSES.includes(status) && status !== 'development';

// The three answers a step's time can have. FUTURE and UNKNOWN are NOT the
// same thing and collapsing them is the mistake this enum exists to prevent:
// FUTURE is a positive claim ("every requirement here is still queued"), so it
// earns the rightmost slot; UNKNOWN is the absence of a claim ("this ran, but
// no stamp survives"), so it must NOT be pushed anywhere — topology alone
// positions it. Treating UNKNOWN as FUTURE would fling a done-but-unstamped
// step past its own dependents.
export const TIME_DATED = 'dated';
export const TIME_FUTURE = 'future';
export const TIME_UNKNOWN = 'unknown';

/**
 * The LAST ACTIVITY of ONE requirement, or null when it has neither stamp: the
 * later of `started_at` and `completed_at` (req #3692).
 *
 * @param {?Object} req  a requirement row from the plan's light projection
 * @returns {?string} ISO-ish datetime string, lexicographically comparable
 */
export function requirementLastActivity(req) {
    if (!req) return null;
    const s = req.started_at ? String(req.started_at) : null;
    const c = req.completed_at ? String(req.completed_at) : null;
    if (s === null) return c;
    if (c === null) return s;
    return c > s ? c : s;
}

/**
 * The derived time of ONE step from its stamps: `{at, kind}`. Rule 4 (running
 * means TODAY) is applied by `planTimeAxis`, which holds the clock.
 *
 * Resolution order, first hit wins:
 *   1. the MAXIMUM of `requirementLastActivity` over its linked requirements
 *      → dated. Requirement timestamps are the ONLY time source: a step has no
 *      time of its own (req #3752 dropped `pipeline_steps.completed_at`);
 *   2. every classifiable linked requirement is not-yet-started → FUTURE;
 *   3. otherwise UNKNOWN.
 *
 * Tracking CONTAINERS are included deliberately, unlike everywhere the flag is
 * consulted for GATING (req #3123) or for LAUNCH ARGUMENTS (design rule 8).
 * Time is neither: a container's stamps are real facts about when the plan it
 * holds was worked, and a step is not misplaced by knowing them.
 *
 * @param {Object} row                 a PlanRow (needs `reqIds`)
 * @param {Map<number, Object>} reqsById
 * @returns {{at: ?string, kind: string}}
 */
export function stepTime(row, reqsById) {
    const ids = (row && row.reqIds) || [];
    let max = null;
    let sawFuture = false;
    let sawUnclassifiable = false;
    for (const id of ids) {
        const req = reqsById.get(id);
        if (!req) continue;                 // unresolved link — says nothing
        const at = requirementLastActivity(req);
        if (at !== null) {
            if (max === null || at > max) max = at;
        } else if (isNotYetStarted(req.requirement_status)) {
            sawFuture = true;
        } else {
            sawUnclassifiable = true;       // terminal or in flight, but unstamped
        }
    }
    if (max !== null) return { at: max, kind: TIME_DATED };
    if (sawFuture && !sawUnclassifiable) return { at: null, kind: TIME_FUTURE };
    return { at: null, kind: TIME_UNKNOWN };
}

/**
 * The TODAY stamp (rules 3 to 6) for `now`, in the same `YYYY-MM-DDTHH:MM:SS` shape the
 * requirement stamps arrive in, or null when `now` is absent or unparseable.
 */
function nowStamp(now) {
    if (now == null) return null;
    const d = now instanceof Date ? now : new Date(now);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19);
}

/**
 * Rule 3: the start of an EMPTY step (no linked requirements), or null when
 * the row is not empty or no `now` was supplied.
 *
 * @param {Object} row
 * @param {?string} today      nowStamp() output
 * @param {boolean} active     true when any step in the plan is running
 * @returns {?{at: ?string, kind: string}}
 */
export function emptyStepStart(row, today, active) {
    if (!row || ((row.reqIds || []).length > 0) || today == null) return null;
    return active ? { at: today, kind: TIME_DATED } : { at: null, kind: TIME_FUTURE };
}

/**
 * Rule 4: TODAY for a RUNNING step, or null when the row is not running or no
 * `now` was supplied.
 *
 * @param {Object} row
 * @param {?string} today      nowStamp() output
 * @returns {?{at: string, kind: string}}
 */
export function runningStepTime(row, today) {
    if (!row || row.state !== STEP_RUNNING || today == null) return null;
    return { at: today, kind: TIME_DATED };
}

/**
 * Rule 5: every not-yet-started (FUTURE) step UPSTREAM of today's work — a
 * running step, or a step whose time is on today's local day — is placed on
 * TODAY, transitively. Dependencies are a launch priority, not a gate
 * (req #3597), so work can run or finish while a step it depends on has not
 * begun — and the layout's monotonize step ranks FUTURE above every date, so
 * without this today's work would be dragged into the not-yet-begun region by
 * its own unstarted gate. Mutates `stepStarts`.
 *
 * @param {Object[]} rows                 PlanRows (needs `depIds`)
 * @param {Map<number, Object>} stepStarts
 * @param {?string} today                 nowStamp() output
 * @returns {boolean} true when any step moved
 */
export function pullFutureGatesToToday(rows, stepStarts, today) {
    if (today == null) return false;
    const todayDay = localDayOf(today);
    const onToday = (t) => t && t.kind === TIME_DATED && localDayOf(t.at) === todayDay;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const seen = new Set();
    const stack = rows.filter((r) => r && (r.state === STEP_RUNNING || onToday(stepStarts.get(r.id))))
        .map((r) => r.id);
    let changed = false;
    while (stack.length) {
        const row = byId.get(stack.pop());
        for (const d of (row && row.depIds) || []) {
            if (seen.has(d) || !byId.has(d)) continue;
            seen.add(d);
            const t = stepStarts.get(d);
            if (t && t.kind === TIME_FUTURE) {
                stepStarts.set(d, { at: today, kind: TIME_DATED });
                changed = true;
            }
            stack.push(d);
        }
    }
    return changed;
}

/**
 * Rule 6: every FUTURE step DOWNSTREAM of a step on today's local day is placed
 * on TODAY, transitively. Runs after rules 4 and 5, so a running step and the
 * gates rule 5 pulled forward both count as today. Mutates `stepStarts`.
 *
 * @param {Object[]} rows                 PlanRows (needs `depIds`)
 * @param {Map<number, Object>} stepStarts
 * @param {?string} today                 nowStamp() output
 * @returns {boolean} true when any step moved
 */
export function dragFutureDependentsToToday(rows, stepStarts, today) {
    if (today == null) return false;
    const todayDay = localDayOf(today);
    const dependents = new Map();
    for (const r of rows) {
        for (const d of (r && r.depIds) || []) {
            if (!dependents.has(d)) dependents.set(d, []);
            dependents.get(d).push(r.id);
        }
    }
    const onToday = (t) => t && t.kind === TIME_DATED && localDayOf(t.at) === todayDay;
    const stack = rows.filter((r) => r && onToday(stepStarts.get(r.id))).map((r) => r.id);
    if (stack.length === 0) return false;
    const seen = new Set(stack);
    let changed = false;
    while (stack.length) {
        for (const id of dependents.get(stack.pop()) || []) {
            if (seen.has(id)) continue;
            seen.add(id);
            // EVERY dependent is walked through, not just the FUTURE ones: the
            // layout's monotonize step already moves an older-dated dependent
            // of today's work onto today, so its own queued dependents follow.
            const t = stepStarts.get(id);
            if (t && t.kind === TIME_FUTURE) {
                stepStarts.set(id, { at: today, kind: TIME_DATED });
                changed = true;
            }
            stack.push(id);
        }
    }
    return changed;
}

/**
 * The calendar DAY a stamp falls on for the person reading the plan:
 * `YYYY-MM-DD` in the browser's LOCAL time zone, or null for no stamp.
 *
 * Stamps are UTC (`now_utc()` in darwin-mcp, RDS `time_zone = UTC`) and arrive
 * without a zone suffix, so one is added before parsing. Bucketing on the UTC
 * day (the first ten characters) was wrong for the reader (req #3692 review):
 * from 17:00 to midnight Pacific, today's open work landed in a column dated
 * TOMORROW while that afternoon's finished work stayed in today's — the exact
 * split this requirement exists to close. Unparseable input falls back to its
 * own first ten characters rather than throwing.
 *
 * @param {?(string|Date)} at
 * @returns {?string}
 */
export function localDayOf(at) {
    if (at == null || at === '') return null;
    let d;
    if (at instanceof Date) {
        d = at;
    } else {
        const str = String(at).replace(' ', 'T');
        const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(str) ? str : `${str}Z`;
        d = new Date(zoned);
    }
    if (Number.isNaN(d.getTime())) return String(at).slice(0, 10);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The whole axis: a time for every step, and a start for every epic band.
 *
 * BAND START IS THE RAW MINIMUM of its steps' times, not the monotonized one
 * the layout computes. It orders UNORDERED epics only (no `sort_order`).
 * An epic's own earliest step is a fact about that epic; letting another epic's
 * gate push it later would make a band's position in the stack depend on work
 * it does not own. The layout monotonizes only the HORIZONTAL axis, where the
 * forward-arc invariant makes it necessary.
 *
 * The band key matches the layout's: the row's DOMINANT epic id (rule 10), with
 * `null` for a step that resolves no epic at all.
 *
 * `bandKinds` exists because a NULL start was doing two incompatible jobs
 * (review finding). An epic with active, in-flight work whose requirements
 * simply never got stamped has no derived start — and so did an epic that is
 * pure untouched backlog, which sorted them together and let the BACKLOG stack
 * above the ACTIVE epic on an id tie-break. The three tiers separate them:
 *   - `dated`   — at least one step has a real start; sort on it;
 *   - `unknown` — no start, but at least one step is not FUTURE, i.e. there is
 *                 EVIDENCE of work whose timing was not recorded;
 *   - `future`  — every step positively has not begun.
 *
 * @param {Object[]} rows          PlanRows (any order)
 * @param {Object[]} requirements  the plan's requirement rows
 * @param {?(Date|string)} [now]   the render clock, for rules 3 to 6 (empty
 *                                 steps, running steps, today's gates and
 *                                 today's dependents)
 * @returns {{stepStarts: Map<number, {at: ?string, kind: string}>,
 *            bandStarts: Map<?number, ?string>,
 *            bandKinds: Map<?number, string>}}
 */
export function planTimeAxis(rows, requirements, now = null) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const reqsById = new Map(
        (Array.isArray(requirements) ? requirements : []).map((r) => [r.id, r]));
    const today = nowStamp(now);
    const active = safeRows.some((r) => r && r.state === STEP_RUNNING);
    const stepStarts = new Map();
    const bandStarts = new Map();
    const bandKinds = new Map();
    for (const row of safeRows) {
        stepStarts.set(row.id, emptyStepStart(row, today, active)
            || runningStepTime(row, today)
            || stepTime(row, reqsById));
    }
    // Rules 5 and 6 to a fixed point (header) — both run on every pass.
    for (let moved = true; moved;) {
        const pulled = pullFutureGatesToToday(safeRows, stepStarts, today);
        const dragged = dragFutureDependentsToToday(safeRows, stepStarts, today);
        moved = pulled || dragged;
    }
    for (const row of safeRows) {
        const start = stepStarts.get(row.id);
        const key = row.epicId != null ? row.epicId : null;
        if (!bandStarts.has(key)) {
            bandStarts.set(key, null);
            bandKinds.set(key, TIME_FUTURE);
        }
        const prev = bandStarts.get(key);
        if (start.kind === TIME_DATED) {
            if (prev === null || start.at < prev) bandStarts.set(key, start.at);
            bandKinds.set(key, TIME_DATED);
        } else if (start.kind === TIME_UNKNOWN && bandKinds.get(key) === TIME_FUTURE) {
            bandKinds.set(key, TIME_UNKNOWN);
        }
    }
    return { stepStarts, bandStarts, bandKinds };
}
