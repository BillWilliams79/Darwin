// pipelineStepLink.js — the addressable-step contract (req #3140).
//
// ONE step of a plan, named by URL: `<plan detail route>?mode=table&step=<sid>`.
// The route half comes from `planEra.js` (2.0 by default since req #3356);
// this module owns the `?step=` / `?level=` half.
//
// WHY BOTH HALVES LIVE IN ONE MODULE. The writer is the Steps editor
// (`src/Steps/StepsPage.jsx`) and the reader is the plan page
// (`PipelineDetail.jsx`) — two files in two directories that must agree on a
// query-string key exactly. A builder in one and a `searchParams.get('step')` in
// the other is a contract with no single definition, and the failure mode is a
// link that navigates to the right plan and silently highlights nothing. Putting
// the key in one place makes a rename a compile-time-shaped edit rather than a
// grep.
//
// It is the SAME handshake req #3115 built for a bead click — the visualizer
// calls `onStepFocus(stepId)`, the page switches to the table, the table scrolls
// to and highlights that row. This only adds a way to enter that handshake from
// outside the page. Nothing about `focusStepId` changes.
//
// `mode=table` is carried explicitly rather than left to the stored preference:
// a step is a ROW, and the visualizer has no row to scroll to. Both parameters
// seed the same TRANSIENT override — a link asks to see one thing once and must
// never rewrite the reader's own default view (the `normalizeView` doctrine).
//
// NO JSX and no React: a pure module vitest can exercise without a DOM, and a
// component file with non-component exports drops out of Fast Refresh (the
// instructionSort.js lesson).

// ONE import, and it is the level VOCABULARY (req #3253). `readLevelParam`
// below validates address-bar text against the set of levels the canvas
// actually defines, and a local copy of that set is the drift this file's whole
// design exists to prevent — it owns both halves of a contract precisely so the
// writer and the reader cannot disagree. The module's "no JSX, no React" rule is
// unaffected: `pipelinePlanLayout` is pure arithmetic with one import of its
// own (`pipelineModel`), so this file still runs under vitest with no DOM, which
// its own test suite exercises.
import { isPlanLevelPref } from './pipelinePlanLayout';
// TWO imports now (req #3463). The route itself is no longer this module's to
// spell: `planEra.js` owns the era↔route binding, and a builder here that
// interpolated the plan route directly is exactly what let a 2.0 id reach a
// 1.0 route in production. This module still owns the QUERY-STRING half of the
// contract — which is what it was always for — and asks planEra for the path.
//
// ── THERE IS NO ERA TO CHOOSE (req #3356) ──────────────────────────────────
// These builders briefly took an `era` argument, defaulting to 2.0 while both
// plan surfaces stood: the producer of the ids `stepPlanLinkTo` receives
// (`useOrchestrationIndex`, the requirement page's Orchestration box) was
// already 2.0, so defaulting to 1.0 would have put a 2.0 id on a 1.0 route —
// req #3462, the outage `planEra.js` exists to prevent, arriving through the
// one door it left open.
//
// Pipeline 1.0 is eradicated, so the argument is GONE rather than defaulted. A
// surviving one would be a way to ask for a route that does not exist, which is
// the same failure wearing a parameter.
import { planDetailPath } from './planEra';

export const FOCUS_STEP_PARAM = 'step';

// ── The SAME step, seen on the PLAN instead of in the table (req #3253) ──────
// The requirement page's "view on plan" link used to name the whole EPIC, and
// `?epic=` fits the entire band — which on a large epic IS a zoomed-out view.
// The link means "show me where this requirement lives", so it names the STEP.
//
// A step is a bead as well as a row, so this is the SAME `?step=` parameter with
// `mode=plan` instead of `mode=table` — deliberately not a third landing mode.
// Both panels now consume `focusStepId`: the table scrolls to and highlights the
// row, the visualizer centres and zooms the camera on the bead.
export const FOCUS_LEVEL_PARAM = 'level';
// L2 — `PLAN_LEVEL_BY_PREF['2'] === 'mid'`. Written as the PREF value the page
// already speaks rather than the canvas's 'mid', because that is what the
// receiving `levelPref` state holds and what `normalizePlanLevelPref` validates.
// A step fit lands well past `SEMANTIC_IN_MIN`, so without the pin the canvas
// would auto-derive L3 and draw every requirement TITLE — an unreadable wall of
// prose at the exact moment the reader wanted to find one bead.
export const STEP_PLAN_LINK_LEVEL = '2';

/**
 * The route a step's location ON THE PLAN links to (req #3253).
 *
 * Same validation and same null-rather-than-a-dead-link rule as `stepLinkTo`;
 * the only differences are the mode and the pinned level.
 *
 * @param {?number} pipelineId
 * @param {?number} stepId
 * @param {number} [era] the era `pipelineId` was READ from (req #3463).
 *        Defaults to 2.0 since req #3356 — see the module header.
 * @returns {?string}
 */
export function stepPlanLinkTo(pipelineId, stepId) {
    const sid = toId(stepId);
    if (sid == null) return null;
    return planDetailPath(pipelineId,
        `mode=plan&${FOCUS_STEP_PARAM}=${sid}`
        + `&${FOCUS_LEVEL_PARAM}=${STEP_PLAN_LINK_LEVEL}`);
}

/**
 * The semantic-level preference a `?level=` parameter names, or null.
 *
 * VALIDATED against the level vocabulary itself, never trusted — and null on
 * anything unrecognised rather than `normalizePlanLevelPref`'s 'auto', because
 * the two answers differ: 'auto' would PIN the reader to auto and silently
 * discard the level they have stored, while null leaves their stored preference
 * in charge. That is the same rule `?mode=xyz` already follows.
 *
 * @param {{get: function(string): ?string}} searchParams
 * @returns {?string} 'auto' | '1' | '2' | '3'
 */
export function readLevelParam(searchParams) {
    const raw = searchParams && typeof searchParams.get === 'function'
        ? searchParams.get(FOCUS_LEVEL_PARAM) : null;
    return isPlanLevelPref(raw) ? String(raw) : null;
}

/**
 * The route a step row links to.
 *
 * Returns null when either id is unusable, so a caller renders a plain number
 * instead of a link that would navigate to `/swarm/pipeline/undefined`. A step
 * whose `pipeline_fk` did not resolve is a real state on the editor page — the
 * pipelines read can fail independently of the steps read.
 *
 * @param {?number} pipelineId
 * @param {?number} stepId
 * @param {number} [era] the era `pipelineId` was READ from (req #3463).
 *        Defaults to 2.0 since req #3356 — see the module header.
 * @returns {?string}
 */
export function stepLinkTo(pipelineId, stepId) {
    const sid = toId(stepId);
    if (sid == null) return null;
    return planDetailPath(pipelineId, `mode=table&${FOCUS_STEP_PARAM}=${sid}`);
}

// NULLISH AND EMPTY ARE REJECTED BEFORE `Number` SEES THEM, which is the whole
// reason this is a function and not an inline `Number.isInteger(Number(x))`:
// `Number(null)` and `Number('')` are both 0, and 0 is a perfectly good integer.
// A step whose `pipeline_fk` did not resolve would have produced a confident link
// to plan 0 — a plan that does not exist, rendering the page's not-found alert
// as though the data were at fault.
//
// It survives for the STEP id only (req #3463). The PIPELINE id is normalized
// by `planEra.js::normalizePlanId`, which is this same guard hoisted to the
// module that owns the route — the two must stay identical, and the way to
// guarantee that is for there to be one of them on the path-building side.
function toId(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
}

/**
 * The step id a `?step=` parameter names, or null.
 *
 * VALIDATED, never trusted. The value is user-editable address-bar text handed
 * to a `[data-testid="pipeline-step-row-<id>"]` selector and compared against
 * `row.id`; `Number('12abc')` is NaN and `Number('')` is 0, and both would
 * produce a focus id that matches no row while suppressing nothing. An id that
 * names no step in this plan is not an error — the plan simply renders with
 * nothing highlighted, exactly as it does with no parameter at all.
 *
 * Accepts anything with a `.get(key)` — a URLSearchParams, or React Router's
 * wrapper around one — so the reader can be tested without a router.
 *
 * @param {{get: function(string): ?string}} searchParams
 * @returns {?number}
 */
export function readFocusStepParam(searchParams) {
    const raw = searchParams && typeof searchParams.get === 'function'
        ? searchParams.get(FOCUS_STEP_PARAM) : null;
    if (raw == null || String(raw).trim() === '') return null;
    const id = Number(raw);
    return Number.isInteger(id) ? id : null;
}
