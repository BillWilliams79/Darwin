// pipelineInitiativeLink.js — the addressable-initiative contract (req #3235).
//
// ONE initiative's location on a plan, named by URL: `<plan detail route>?mode=plan&initiative=<eid>`.
// The route half comes from `planEra.js` (2.0 by default since req #3356); this
// module owns the `?initiative=` half.
//
// Mirrors `pipelineEpicLink.js` (req #3140) — same shape, same reasons: the
// writer (the requirement page's initiative box, `RequirementDetail.jsx`) and the
// reader (`PipelineDetail.jsx` / `PipelinePlanVisualizer.jsx`) are files that
// must agree on a query-string key exactly, so the key lives in one module
// rather than as a string literal grep would have to find on both ends.
//
// `mode=plan` is carried explicitly, the same way an epic link carries
// `mode=table`: an initiative band only exists in the Plan visualizer, so a link
// that omitted the mode would land on whichever panel the reader's stored
// preference happens to be and show nothing. It seeds the SAME transient
// override `?epic=`/`?mode=` already use — a link asks to see one thing once,
// and must never rewrite what the reader chose as their default view.
//
// NO JSX and no React: a pure module vitest can exercise without a DOM, and a
// component file with non-component exports drops out of Fast Refresh.

// The route is `planEra.js`'s, not this module's (req #3463) — see
// `pipelineEpicLink.js`'s identical import for why. This file still owns the
// `?initiative=` half of the contract, which is what it was always for.
//
// ── THERE IS NO ERA TO CHOOSE (req #3356) ──────────────────────────────────
// These builders briefly took an `era` argument, defaulting to 2.0 while both
// plan surfaces stood: every producer of the ids they receive was already 2.0
// (`useOrchestrationIndex`), so defaulting to 1.0 would have rendered a 2.0 id
// against a 1.0 route — req #3462, the outage `planEra.js` exists to prevent,
// arriving through the one door it left open.
//
// Pipeline 1.0 is eradicated, so the argument is GONE rather than defaulted. A
// surviving one would be a way to ask for a route that does not exist, which is
// the same failure wearing a parameter.
import { planDetailPath } from './planEra';

export const FOCUS_INITIATIVE_PARAM = 'initiative';

/**
 * The route an initiative's plan location links to.
 *
 * Returns null when either id is unusable, so a caller renders no link at all
 * rather than one that navigates to `/swarm/pipeline/undefined` — the same
 * "omit rather than render a dead link" rule the initiative box already applies to
 * an initiative seated in no pipeline at all.
 *
 * @param {?number} pipelineId
 * @param {?number} initiativeId
 * @param {number} [era] the era `pipelineId` was READ from (req #3463).
 * Defaults to 2.0 since req #3356 — see the module header.
 * @returns {?string}
 */
export function initiativeLinkTo(pipelineId, initiativeId) {
    const eid = toId(initiativeId);
    if (eid == null) return null;
    return planDetailPath(pipelineId, `mode=plan&${FOCUS_INITIATIVE_PARAM}=${eid}`);
}

/**
 * The plan itself, with no band or bead singled out (req #3435).
 *
 * The requirement page's Orchestration box names a PIPELINE on its first row,
 * and that row's button has to lead somewhere even when nothing narrower is
 * addressable — the reader picked a plan this requirement is not seated in, or
 * it is seated in one whose epic has not resolved. `mode=plan` is carried for
 * the same reason `initiativeLinkTo` carries it: the destination is the visualizer,
 * and omitting the mode lands on whichever panel the reader's stored preference
 * happens to be.
 *
 * @param {?number} pipelineId
 * @param {number} [era] the era `pipelineId` was READ from (req #3463).
 * Defaults to 2.0 since req #3356 — see the module header.
 * @returns {?string}
 */
export function planLinkTo(pipelineId) {
    return planDetailPath(pipelineId, 'mode=plan');
}

// NULLISH AND EMPTY ARE REJECTED BEFORE `Number` SEES THEM — see
// pipelineEpicLink.js's identical guard for why 0 is a legitimate id and
// `Number(null)`/`Number('')` are not. It survives for the INITIATIVE id only; the
// PIPELINE id is normalized by `planEra.js::normalizePlanId` (req #3463).
function toId(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
}

/**
 * The initiative id a `?initiative=` parameter names, or null.
 *
 * VALIDATED, never trusted, exactly like `readFocusEpicParam`. An id that
 * names no band in this plan is not an error — the visualizer simply renders
 * with nothing focused, the same as with no parameter at all.
 *
 * @param {{get: function(string): ?string}} searchParams
 * @returns {?number}
 */
export function readFocusInitiativeParam(searchParams) {
    const raw = searchParams && typeof searchParams.get === 'function'
        ? searchParams.get(FOCUS_INITIATIVE_PARAM) : null;
    if (raw == null || String(raw).trim() === '') return null;
    const id = Number(raw);
    return Number.isInteger(id) ? id : null;
}
