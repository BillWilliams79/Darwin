// pipelineEpicLink.js — the addressable-epic contract (req #3235).
//
// ONE epic's location on a plan, named by URL: `<plan detail route>?mode=plan&epic=<eid>`.
// The route half comes from `planEra.js` (2.0 by default since req #3356); this
// module owns the `?epic=` half.
//
// Mirrors `pipelineStepLink.js` (req #3140) — same shape, same reasons: the
// writer (the requirement page's epic box, `RequirementDetail.jsx`) and the
// reader (`PipelineDetail.jsx` / `PipelinePlanVisualizer.jsx`) are files that
// must agree on a query-string key exactly, so the key lives in one module
// rather than as a string literal grep would have to find on both ends.
//
// `mode=plan` is carried explicitly, the same way a step link carries
// `mode=table`: an epic band only exists in the Plan visualizer, so a link
// that omitted the mode would land on whichever panel the reader's stored
// preference happens to be and show nothing. It seeds the SAME transient
// override `?step=`/`?mode=` already use — a link asks to see one thing once,
// and must never rewrite what the reader chose as their default view.
//
// NO JSX and no React: a pure module vitest can exercise without a DOM, and a
// component file with non-component exports drops out of Fast Refresh.

// The route is `planEra.js`'s, not this module's (req #3463) — see
// `pipelineStepLink.js`'s identical import for why. This file still owns the
// `?epic=` half of the contract, which is what it was always for.
//
// ── THIS MODULE'S DEFAULT IS NOT `DEFAULT_PLAN_ERA` ANY MORE (req #3356) ────
// `planEra.js`'s module-level `DEFAULT_PLAN_ERA` is still `PLAN_ERA_1`, and it
// is deliberately NOT what these builders use. That constant means "the era a
// caller meant before there were two", which is the right reading for a legacy
// router state; it is the wrong reading for a NEW link, because every producer
// of the ids these functions receive is 2.0 now (`useOrchestrationIndex` walks
// the `pipeline2_*` tables). Defaulting to 1.0 here would render a 2.0 id
// against a 1.0 route — which is req #3462, the production outage `planEra.js`
// exists to prevent, arriving through the one door it left open.
//
// The `era` PARAMETER stays: a caller that genuinely holds a 1.0 id says so
// (`Steps/StepsPage.jsx` does). Retiring `DEFAULT_PLAN_ERA` itself, and the 1.0
// binding with it, is a separate step — `planEra.js` is untouched here.
import { PLAN_ERA_2, planDetailPath } from './planEra';

export const FOCUS_EPIC_PARAM = 'epic';

/**
 * The route an epic's plan location links to.
 *
 * Returns null when either id is unusable, so a caller renders no link at all
 * rather than one that navigates to `/swarm/pipeline/undefined` — the same
 * "omit rather than render a dead link" rule the epic box already applies to
 * an epic seated in no pipeline at all.
 *
 * @param {?number} pipelineId
 * @param {?number} epicId
 * @param {number} [era] the era `pipelineId` was READ from (req #3463).
 * Defaults to 2.0 since req #3356 — see the module header.
 * @returns {?string}
 */
export function epicLinkTo(pipelineId, epicId, era = PLAN_ERA_2) {
    const eid = toId(epicId);
    if (eid == null) return null;
    return planDetailPath(era, pipelineId, `mode=plan&${FOCUS_EPIC_PARAM}=${eid}`);
}

/**
 * The plan itself, with no band or bead singled out (req #3435).
 *
 * The requirement page's Orchestration box names a PIPELINE on its first row,
 * and that row's button has to lead somewhere even when nothing narrower is
 * addressable — the reader picked a plan this requirement is not seated in, or
 * it is seated in one whose step has not resolved. `mode=plan` is carried for
 * the same reason `epicLinkTo` carries it: the destination is the visualizer,
 * and omitting the mode lands on whichever panel the reader's stored preference
 * happens to be.
 *
 * @param {?number} pipelineId
 * @param {number} [era] the era `pipelineId` was READ from (req #3463).
 * Defaults to 2.0 since req #3356 — see the module header.
 * @returns {?string}
 */
export function planLinkTo(pipelineId, era = PLAN_ERA_2) {
    return planDetailPath(era, pipelineId, 'mode=plan');
}

// NULLISH AND EMPTY ARE REJECTED BEFORE `Number` SEES THEM — see
// pipelineStepLink.js's identical guard for why 0 is a legitimate id and
// `Number(null)`/`Number('')` are not. It survives for the EPIC id only; the
// PIPELINE id is normalized by `planEra.js::normalizePlanId` (req #3463).
function toId(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
}

/**
 * The epic id a `?epic=` parameter names, or null.
 *
 * VALIDATED, never trusted, exactly like `readFocusStepParam`. An id that
 * names no band in this plan is not an error — the visualizer simply renders
 * with nothing focused, the same as with no parameter at all.
 *
 * @param {{get: function(string): ?string}} searchParams
 * @returns {?number}
 */
export function readFocusEpicParam(searchParams) {
    const raw = searchParams && typeof searchParams.get === 'function'
        ? searchParams.get(FOCUS_EPIC_PARAM) : null;
    if (raw == null || String(raw).trim() === '') return null;
    const id = Number(raw);
    return Number.isInteger(id) ? id : null;
}
