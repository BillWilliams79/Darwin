// pipelineModel.js — the plan surfaces' SHARED VOCABULARY and cost arithmetic.
//
// PURE LOGIC ONLY: plain objects in, plain objects out. No imports from
// query/fetch layers, no DB, no Date.now().
//
// ── WHAT req #3356 TOOK OUT OF THIS FILE ───────────────────────────────────
// It was Pipeline 1.0's browser-side ordering & derivation engine (req #3112) —
// `buildPlanRows`, `displayOrder`, `verifyOrder`, `eligibility`,
// `launchBatches`, `deriveStepState`, `dominantLabels`, `machineLabels`,
// `requirementCounts`, `pauseState`, `serialState` and their helpers. Pipeline
// 2.0 derives a plan ONCE, server-side, in `pipeline2_derive.py`, and
// `pipeline2Adapter.js` reshapes that output; nothing in the browser derives a
// plan any more, so all of it went with Pipeline 1.0.
//
// The engine survives as TEST SCAFFOLDING ONLY, at
// `__tests__/planFixtureEngine.js`, where two surviving layout tests use it to
// MINT plan rows. That file's header says what it is and how it goes away; no
// file under `src/` imports it.
//
// ── WHAT IS LEFT, AND WHY IT IS ERA-NEUTRAL ────────────────────────────────
// Three step-state strings, the pause string, the terminal-status set, and the
// two cost functions. None of them derives anything: they are the words the plan
// table, the plan visualizer and the chip-styles module all have to agree on,
// plus arithmetic over a CostIndex that `pipeline2Adapter.js` calls directly.
// Cost is the one fact req #3345 did NOT move into the composed payload, so it
// is still folded in the browser from two bounded reads (req #3117).
//
// ── The PlanRow contract ───────────────────────────────────────────────────
// The shape below is what `pipeline2Adapter.js::buildPlan2Rows` emits and what
// every render surface consumes. It is documented here because this module is
// where the state vocabulary lives; NOTHING here builds one.
//
// @typedef {Object} PlanRow
// @property {number} id
// @property {string} title
// @property {('auto'|'manual')} run
// @property {?string} notes
// @property {?string} completedAt
// @property {StepState} state           DERIVED server-side, never stored (rule 1)
// @property {number[]} reqIds           junction order — the COMPLETE set
// @property {number[]} trackingReqIds   req #3123 — the subset of reqIds that are
//                                       CONTAINERS: they neither gate the step
//                                       (rule 1) nor appear in its /swarm-start
//                                       argument list (rule 8)
// @property {number[]} unresolvedReqIds junction rows whose requirement is missing
//                                       from the read (truncation / data loss) —
//                                       render LOUDLY; these rows' state may be
//                                       under-derived
// @property {number[]} launchReqIds     req #3360 — the EXACT /swarm-start argument
//                                       list for this step
// @property {string[]} launchExcluded   one entry per linked id NOT in
//                                       launchReqIds, pre-rendered as
//                                       `"<reqId> <reason>"` — flat, because the
//                                       derived block carries no nested rows
//                                       (req #3078 payload budget)
// @property {?string} launchBlock       WHY there is no command, as an enum to
//                                       branch on: 'no-links' | 'containers' |
//                                       'not-ready' | null
// @property {?string} swarmStartCommand '/swarm-start <ids>', null when nothing on
//                                       this row is launchable
// @property {?string} noLaunchReason    the human sentence for launchBlock
// @property {number[]} depIds           step dependencies
// @property {string[]} timeDeps         time gates (ISO-8601)
// @property {?number} epicId            2.0 containment: `pipeline2_steps.epic_fk`
// @property {?string} epic
// @property {?number} epicSortOrder     req #3430 — the epic's OWN
//                                       `epics.sort_order`. NULL = unordered,
//                                       which sorts last
// @property {{id: number, title: string}[]} epicLabels
// @property {string[]} machineLabels
// @property {string} machineLabel      joined with ' / ', '—' when no requirements
// @property {StepCost} [cost]          req #3117 — attached by the adapter when a
//                                      CostIndex is supplied
//
// @typedef {('done'|'running'|'pending')} StepState
//
// @typedef {Object} StepCost
// @property {number} wallSecs
// @property {number} tokens

export const STEP_DONE = 'done';
export const STEP_RUNNING = 'running';
export const STEP_PENDING = 'pending';

// The one value `pipeline_status` and `epic_status` share meaning for (req
// #3223): PAUSED IS THE SAME STRING AT BOTH SCOPES, so `pauseState` below
// tests one constant against both columns rather than two.
export const PAUSED_STATUS = 'paused';

// Requirement statuses that close a step (rule 1).
export const TERMINAL_REQUIREMENT_STATUSES = ['met', 'deferred', 'wontfix'];

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
