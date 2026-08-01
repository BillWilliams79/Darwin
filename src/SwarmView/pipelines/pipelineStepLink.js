// pipelineStepLink.js — the addressable-step contract (req #3140).
//
// ONE step of a plan, named by URL: `/swarm/pipeline/<pid>?mode=table&step=<sid>`.
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

export const FOCUS_STEP_PARAM = 'step';

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
 * @returns {?string}
 */
export function stepLinkTo(pipelineId, stepId) {
    const pid = toId(pipelineId);
    const sid = toId(stepId);
    if (pid == null || sid == null) return null;
    return `/swarm/pipeline/${pid}?mode=table&${FOCUS_STEP_PARAM}=${sid}`;
}

// NULLISH AND EMPTY ARE REJECTED BEFORE `Number` SEES THEM, which is the whole
// reason this is a function and not an inline `Number.isInteger(Number(x))`:
// `Number(null)` and `Number('')` are both 0, and 0 is a perfectly good integer.
// A step whose `pipeline_fk` did not resolve would have produced a confident link
// to `/swarm/pipeline/0` — a plan that does not exist, rendering the page's
// not-found alert as though the data were at fault.
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
