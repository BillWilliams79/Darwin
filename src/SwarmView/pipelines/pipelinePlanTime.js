// pipelinePlanTime.js — the plan's DERIVED TIME AXIS (req #3201).
//
// PURE: plain rows in, plain time facts out. No React, no clock, no DOM. It is
// its own module because it answers a DATA question ("when did this step's work
// begin?") that `pipelinePlanLayout.js` — pure geometry — must not be the place
// to answer, and that `pipelineModel.js` must not answer either: that engine is
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
// ── THERE IS NO STORED START ────────────────────────────────────────────────
// `epics` has no `started_at` and never will (design rule 1 — derive, don't
// store). `requirements.started_at` exists, so an epic's start is a MINIMUM
// over its requirements. Two decisions the raw column forces, both stated in
// full below (the third — FUTURE and UNKNOWN are different answers — is on the
// enum this file exports). `memory/pipeline-plan-visualizer.md` § "Deriving a
// start" carried the same three and was deleted with the first generation
// (req #3356), so THIS HEADER IS NOW THEIR SINGLE SOURCE:
//
// 1. **A requirement that completed without ever being stamped `started_at`
//    COUNTS AS STARTED.** This is not a courtesy. Measured against the whole
//    live requirements table on 2026-08-01: 820 of 960 `met` requirements have
//    `started_at` NULL, and only 2 of the 32 requirements in live pipeline 2's
//    "Pipeline" epic carry one. A literal MIN(started_at) rule classified FIVE
//    of that plan's SIX epics as never-started — including two that are 100%
//    done — and would have banished finished work to the right-hand future.
//    That is the same defect this axis fixes, inverted. `completed_at` is
//    populated, and it is a strict upper bound on a start: work that finished
//    demonstrably began no later than it finished.
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
//    requirements and no `completed_at` — has no stamp of any kind, so it used
//    to be UNKNOWN, and an UNKNOWN step at the head of a chain has nothing
//    upstream to take a time from: it fell into the plan's EARLIEST slot, the
//    far-left edge, days before the work it was just added in front of. It is
//    work that has not happened yet, so it belongs at "now or later": TODAY if
//    any step in the plan is running, FUTURE if none is. TODAY is the UTC day
//    of `now`, because the stamps this axis compares are UTC.
//    THE COST, accepted by the user when this was ruled: the layout's
//    monotonization drags every DEPENDENT of the empty step to at least its
//    slot, so an empty step added in front of older dated work moves that work
//    to today (or into the future region). The rule applies only when the
//    caller supplies `now`; without it an empty step stays UNKNOWN.

import { STEP_RUNNING, TERMINAL_REQUIREMENT_STATUSES } from './pipelineModel';

// A status positively asserts "this work has not begun" only if the engine
// neither calls it finished nor calls it in flight. Today that is `authoring`,
// `approved` and `swarm_ready` — but it is computed, so a new status is
// classified by what the engine already says about it.
export const isNotYetStarted = (status) =>
    !TERMINAL_REQUIREMENT_STATUSES.includes(status) && status !== 'development';

// The three answers a step's start can have. FUTURE and UNKNOWN are NOT the
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
 * The effective start of ONE requirement, or null when it has neither stamp.
 *
 * @param {?Object} req  a requirement row from the plan's light projection
 * @returns {?string} ISO-ish datetime string, lexicographically comparable
 */
export function requirementStart(req) {
    if (!req) return null;
    if (req.started_at) return String(req.started_at);
    if (req.completed_at) return String(req.completed_at);
    return null;
}

/**
 * The derived start of ONE step: `{at, kind}`.
 *
 * Resolution order, first hit wins:
 *   1. the MINIMUM `requirementStart` over its linked requirements → dated;
 *   2. the step's own `completedAt` → dated. This is the req-less GATE step
 *      (the "Green Baseline" shape) whose whole existence is its stamp;
 *   3. every classifiable linked requirement is not-yet-started → FUTURE;
 *   4. otherwise UNKNOWN.
 *
 * Tracking CONTAINERS are included deliberately, unlike everywhere the flag is
 * consulted for GATING (req #3123) or for LAUNCH ARGUMENTS (design rule 8).
 * Time is neither: a container's stamps are real facts about when the plan it
 * holds began, and a step is not misplaced by knowing them.
 *
 * @param {Object} row                 a PlanRow (needs `reqIds`, `completedAt`)
 * @param {Map<number, Object>} reqsById
 * @returns {{at: ?string, kind: string}}
 */
export function stepStart(row, reqsById) {
    const ids = (row && row.reqIds) || [];
    let min = null;
    let sawFuture = false;
    let sawUnclassifiable = false;
    for (const id of ids) {
        const req = reqsById.get(id);
        if (!req) continue;                 // unresolved link — says nothing
        const at = requirementStart(req);
        if (at !== null) {
            if (min === null || at < min) min = at;
        } else if (isNotYetStarted(req.requirement_status)) {
            sawFuture = true;
        } else {
            sawUnclassifiable = true;       // terminal or in flight, but unstamped
        }
    }
    if (min !== null) return { at: min, kind: TIME_DATED };
    if (row && row.completedAt) return { at: String(row.completedAt), kind: TIME_DATED };
    if (sawFuture && !sawUnclassifiable) return { at: null, kind: TIME_FUTURE };
    return { at: null, kind: TIME_UNKNOWN };
}

/**
 * Rule 3's TODAY stamp for `now`, in the same `YYYY-MM-DDTHH:MM:SS` shape the
 * requirement stamps arrive in, or null when `now` is absent or unparseable.
 */
function nowStamp(now) {
    if (now == null) return null;
    const d = now instanceof Date ? now : new Date(now);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19);
}

/**
 * Rule 3: the start of an EMPTY step (no linked requirements, no
 * `completedAt`), or null when the row is not empty or no `now` was supplied.
 *
 * @param {Object} row
 * @param {?string} today      nowStamp() output
 * @param {boolean} active     true when any step in the plan is running
 * @returns {?{at: ?string, kind: string}}
 */
export function emptyStepStart(row, today, active) {
    if (!row || row.completedAt || ((row.reqIds || []).length > 0) || today == null) return null;
    return active ? { at: today, kind: TIME_DATED } : { at: null, kind: TIME_FUTURE };
}

/**
 * The whole axis: a start for every step, and a start for every epic band.
 *
 * BAND START IS THE RAW MINIMUM, not the monotonized one the layout computes.
 * An epic's own first start is a fact about that epic; letting another epic's
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
 * @param {?(Date|string)} [now]   the render clock, for rule 3 (empty steps)
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
        const start = emptyStepStart(row, today, active) || stepStart(row, reqsById);
        stepStarts.set(row.id, start);
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
