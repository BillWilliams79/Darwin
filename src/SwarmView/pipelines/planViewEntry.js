// planViewEntry.js — what a history entry of the plan page ASKS FOR (req #3651).
//
// Every way of arriving at `/swarm/pipeline/:id` is one of THREE transitions,
// and each has exactly one answer about the one-shot focus (`?step=`/`?initiative=`,
// which moves the camera or the table's scroll onto one thing):
//
//   LINK    — an entry whose focus link has not been honoured yet: a bead click
//             into the Table, the requirement page's "view on plan", a pasted
//             URL. The focus fires, once, and the page marks the entry.
//   REWRITE — the page's OWN replace of the entry it is on: that mark, or a
//             manual mode / level / colour pick rewriting the query. Nothing
//             about where the reader is looking changed, so the focus in hand
//             is kept.
//   RETURN  — everything else: browser Back/Forward onto any entry, a reload, an
//             in-app "Back to Plan", a URL with no focus link. NO focus — the
//             camera, the table scroll and every popout come back from memory,
//             which is the whole of what a return must do.
//
// THE DEFECT THIS CLOSES. The focus used to be state re-seeded by an EFFECT on
// the entry key, so on a Back the panel rendered — and mounted — with the
// PREVIOUS entry's `?step=` for as long as that effect took to run. The canvas
// took it as a step link, began flying to the step before it had restored the
// reader's camera, was interrupted at the first tick when the panel resized, and
// SAVED that interrupted camera over the reader's — which the landing then
// faithfully "restored": the plan at its top-left at scale 1 (*"I was at the
// top left and way zoomed in"*). Measured on the dev server before the fix:
// camera `-3383,-219,1.185` → `0,0,1.000` across one Back. The answer is now
// computed DURING RENDER from the entry itself, so no render can carry another
// entry's focus.
//
// Pure, no React — vitest reaches it without a DOM, like `pipelineStepLink.js`.

export const PLAN_ENTRY_LINK = 'link';
export const PLAN_ENTRY_REWRITE = 'rewrite';
export const PLAN_ENTRY_RETURN = 'return';

/** The history-state key marking an entry whose focus link has been honoured.
 * Its value is the `search` it was honoured for, so an entry whose query is
 * later rewritten is not mistaken for marked (req #3637). */
export const PLAN_LINK_CONSUMED_STATE_KEY = 'planLinkConsumed';

/** True when `location`'s own history state marks its current query honoured. */
export function isPlanLinkConsumed(location) {
    const mark = location?.state?.[PLAN_LINK_CONSUMED_STATE_KEY];
    return typeof mark === 'string' && mark === location.search;
}

/**
 * Which of the three transitions arrived at this entry.
 *
 * @param {{consumed: boolean, navigationType: string, hasFocusLink: boolean}} entry
 *   `navigationType` is React Router's (`'POP' | 'PUSH' | 'REPLACE'`).
 */
export function classifyPlanEntry({ consumed, navigationType, hasFocusLink }) {
    if (consumed) return navigationType === 'REPLACE' ? PLAN_ENTRY_REWRITE : PLAN_ENTRY_RETURN;
    return hasFocusLink ? PLAN_ENTRY_LINK : PLAN_ENTRY_RETURN;
}

const NO_FOCUS = Object.freeze({ stepId: null, initiativeId: null });

/**
 * The focus the page hands its panels for this entry.
 *
 * @param {string} kind     from `classifyPlanEntry`
 * @param {{stepId: ?number, initiativeId: ?number}} link  the entry's own `?step=`/`?initiative=`
 * @param {?{stepId: ?number, initiativeId: ?number}} held the focus in hand before it
 */
export function planEntryFocus(kind, link, held) {
    if (kind === PLAN_ENTRY_LINK) return { stepId: link.stepId ?? null, initiativeId: link.initiativeId ?? null };
    if (kind === PLAN_ENTRY_REWRITE && held) return { stepId: held.stepId, initiativeId: held.initiativeId };
    return NO_FOCUS;
}
