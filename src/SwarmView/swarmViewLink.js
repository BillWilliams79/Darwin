// `/swarm?view=<panel>` — the URL contract for the requirements page's view
// toggle (req #3168 R9, req #3302).
//
// ITS OWN MODULE, and it owns BOTH halves of the contract — the vocabulary and
// the reader — for the reason `pipelineStepLink.js` gives: a writer and a reader
// in two files drift on the key, and nothing fails when they do. It carries no
// JSX and no MUI import so vitest can exercise it without a DOM, and so
// `SwarmView.jsx` keeps its single component export and stays inside React Fast
// Refresh (`memory/view-switchable-pages.md` § I, the `instructionSort.js`
// lesson).

/** The page's four panels, in toggle order. */
export const SWARM_VIEWS = ['cards', 'table', 'visualizer', 'trends'];

/** The view a first-time visitor lands on. */
export const DEFAULT_SWARM_VIEW = 'cards';

/** The `localStorage` / `sessionStorage` key `useViewPreference` persists under (R1). */
export const SWARM_VIEW_STORAGE_KEY = 'darwin-swarm-view';

/** The query parameter. `view`, because this page's toggle switches VIEWS (R9). */
export const SWARM_VIEW_PARAM = 'view';

/**
 * The view a link is asking for, or `null` when it is not asking for one.
 *
 * VALIDATED, NEVER TRUSTED. An unknown `?view=xyz` is a typo; returning `null`
 * leaves the reader's stored preference in charge rather than selecting nothing
 * in the `ToggleButtonGroup`.
 *
 * The caller treats the result as a TRANSIENT OVERRIDE and never writes it back:
 * a link asks to see one thing once, and must not redefine the reader's default
 * (the `normalizeView` doctrine — an external condition never overwrites
 * uncommitted user intent).
 *
 * @param {URLSearchParams} searchParams
 * @returns {string|null}
 */
export const readViewParam = (searchParams) => {
    const requested = searchParams?.get?.(SWARM_VIEW_PARAM);
    return SWARM_VIEWS.includes(requested) ? requested : null;
};

/**
 * The `to` for a link that should land on one view of `/swarm`.
 *
 * The writing half of the contract. It names EVERY view it is asked for, the
 * default included — `?view=cards` is not redundant, because `/swarm` alone
 * lands a reader with a stored Table preference on Table, which is the exact gap
 * R9 exists to close. A link that means the PAGE rather than one view of it does
 * not call this; it writes `/swarm`.
 *
 * An unknown view falls back to the bare route rather than emitting a parameter
 * the reader would discard.
 *
 * @param {string} view
 * @returns {string}
 */
export const swarmViewLinkTo = (view) =>
    SWARM_VIEWS.includes(view) ? `/swarm?${SWARM_VIEW_PARAM}=${view}` : '/swarm';

// ── `?epic=` — ONE epic's work, seen as task cards (req #3428) ──────────────
//
// `/swarm?view=cards&epic=<eid>`. The writer is the plan visualizer's epic chip
// (`PipelinePlanVisualizer.jsx`) and the readers are this page plus three
// components under it — five files that must agree on one query-string key
// exactly, which is this module's whole reason for existing. It lives HERE
// rather than in a module of its own because this module already owns `/swarm`'s
// query string: a second one would have to import `SWARM_VIEW_PARAM` back out of
// this one to compose a single URL, which is two owners of one contract.
//
// `view=cards` IS CARRIED EXPLICITLY, for the reason `swarmViewLinkTo` gives
// above: `/swarm` alone opens whichever panel this reader last chose, so a link
// that omitted the view would land a Table-preferring reader on the Table — and
// this link's whole promise is the CARDS. It seeds the same TRANSIENT override,
// so the reader's stored default is never rewritten.
//
// NOT THE ONLY `?epic=` IN THIS CODEBASE, AND THAT IS FINE. `pipelineEpicLink.js`
// owns `?epic=` on `/swarm/pipeline/<pid>`, where it means FOCUS THIS BAND;
// `StepsPage.jsx` owns it on `/swarm/steps` (req #3373), where it means FILTER
// TO THIS EPIC — the target its now-retired browsable-catalog predecessor
// used to own before req #3357 retired it; this owns it on `/swarm` and means
// what StepsPage's means.
// Multiple ROUTES, one meaning each, so no reader ever has to work out which
// sense is in play — and the key is the same word because the noun is the same,
// which is what makes the address bar legible. They deliberately do NOT share a
// reader: merging them would couple their query strings so that changing one
// has to be argued on all of them.

/** The query parameter. `epic`, because the filter names an EPIC. */
export const SWARM_EPIC_PARAM = 'epic';

/** The view an epic link lands on. Named so the writer and this file agree. */
export const SWARM_EPIC_VIEW = 'cards';

/**
 * The route an epic's task cards live at.
 *
 * Returns null when the id is unusable, so a caller renders no control at all
 * rather than one that navigates to `/swarm?epic=undefined` and filters every
 * requirement away under a pill reading "Epic: undefined". A plan's "No epic"
 * band has no id and is exactly this case — the same omit-rather-than-render-a-
 * dead-link rule `pipelineEpicLink.js` applies.
 *
 * @param {?number} epicId
 * @returns {?string}
 */
export const swarmEpicLinkTo = (epicId) => {
    const eid = toEpicId(epicId);
    if (eid == null) return null;
    return `/swarm?${SWARM_VIEW_PARAM}=${SWARM_EPIC_VIEW}&${SWARM_EPIC_PARAM}=${eid}`;
};

/**
 * The epic id a `?epic=` parameter names, or null.
 *
 * VALIDATED, NEVER TRUSTED — the same rule `readViewParam` follows, and with
 * more at stake: this value decides which requirements a page shows, and
 * `Number('')` is 0 while `Number('1.5')` is 1.5, either of which would filter
 * every row away under a pill naming an epic that does not exist. An id that
 * names a REAL-SHAPED epic which simply has no row is not an error: the page
 * filters to an empty set and the pill falls back to the raw id — the same
 * behavior `pipelineEpicLink.js`'s reader follows.
 *
 * @param {{get: function(string): ?string}} searchParams
 * @returns {?number}
 */
export const readEpicParam = (searchParams) =>
    toEpicId(searchParams?.get?.(SWARM_EPIC_PARAM));

/**
 * The same params with the epic filter removed — where dismissing the pill goes.
 *
 * A NEW `URLSearchParams` rather than a mutation of the caller's: React Router
 * hands back a live object, and mutating it in place changes the current
 * location's params while re-rendering nothing.
 *
 * @param {URLSearchParams} searchParams
 * @returns {URLSearchParams}
 */
export const withoutEpicParam = (searchParams) => {
    const next = new URLSearchParams(searchParams || undefined);
    next.delete(SWARM_EPIC_PARAM);
    return next;
};

// NULLISH AND EMPTY ARE REJECTED BEFORE `Number` SEES THEM — `pipelineStepLink`'s
// identical guard, for the identical reason: `Number(null)` and `Number('')` are
// both 0, which is a perfectly good integer and a perfectly bad epic id.
const toEpicId = (value) => {
    if (value == null || String(value).trim() === '') return null;
    const n = Number(String(value).trim());
    return Number.isInteger(n) && n > 0 ? n : null;
};

// ── `?step=` — ONE step's work, seen as task cards (req #3503) ──────────────
//
// `/swarm?view=cards&step=<sid>`. A PARALLEL, INDEPENDENT sibling of the `?epic=`
// block above, not a generalisation of it. The writer is the plan visualizer's
// requirement-count badge (`PipelinePlanVisualizer.jsx`) and the readers are the
// same five files, which is why it lives here for the same reason: this module
// owns `/swarm`'s query string, and a second owner is how a writer and a reader
// start disagreeing about a key with nothing failing when they do.
//
// WHY A SECOND PARAMETER RATHER THAN A SCOPE-KIND ONE (`?scope=step:12`). The two
// filters are read INDEPENDENTLY and can both be in the address bar at once; a
// single encoded parameter would have to be parsed into a kind and an id by every
// reader, and would make dismissing one pill a rewrite of the other's value. Two
// keys, two readers, two `without…Param` functions — nothing shared, nothing to
// disentangle.
//
// THE DERIVATION UNDERNEATH IS ONE HOP, WHICH IS THE WHOLE DIFFERENCE. An epic
// needs `pipeline_steps.epic_fk` walked before the junction can be read; a step
// IS the junction's own `step_fk`. Same query-string shape, much cheaper answer —
// see `utils/pipelineMembership.js` § `stepRequirementIds`.
//
// `view=cards` IS CARRIED EXPLICITLY for the reason `swarmViewLinkTo` gives:
// `/swarm` alone opens whichever panel this reader last chose, and this link's
// whole promise is the CARDS. It seeds the same TRANSIENT override, so the
// reader's stored default is never rewritten.
//
// NOT THE ONLY `?step=` IN THIS CODEBASE, AND THAT IS FINE. `pipelineStepLink.js`
// owns `?step=` on the plan detail route, where it means FOCUS THIS STEP (a row
// to scroll to, or a bead to zoom on); this owns it on `/swarm` and means FILTER
// TO THIS STEP'S REQUIREMENTS. One route, one meaning each — the same arrangement
// `?epic=` already has across three routes, and the reason both keep the plain
// noun: the address bar stays legible because the word names the same THING even
// where the verb differs.

/** The query parameter. `step`, because the filter names a plan STEP. */
export const SWARM_STEP_PARAM = 'step';

/** The view a step link lands on. Named so the writer and this file agree. */
export const SWARM_STEP_VIEW = 'cards';

/**
 * The route one step's task cards live at.
 *
 * Returns null when the id is unusable, so a caller renders no control at all
 * rather than one that navigates to `/swarm?step=undefined` and filters every
 * requirement away under a pill reading "Step: undefined" — the same
 * omit-rather-than-render-a-dead-link rule `swarmEpicLinkTo` applies. A badge
 * drawn for a step the layout could not resolve is exactly this case.
 *
 * @param {?number} stepId
 * @returns {?string}
 */
export const swarmStepLinkTo = (stepId) => {
    const sid = toStepId(stepId);
    if (sid == null) return null;
    return `/swarm?${SWARM_VIEW_PARAM}=${SWARM_STEP_VIEW}&${SWARM_STEP_PARAM}=${sid}`;
};

/**
 * The step id a `?step=` parameter names, or null.
 *
 * VALIDATED, NEVER TRUSTED — `readEpicParam`'s rule, with the same stake: this
 * value decides which requirements a page shows, and `Number('')` is 0 while
 * `Number('1.5')` is 1.5, either of which would filter every row away under a
 * pill naming a step that does not exist. An id that names a REAL-SHAPED step
 * which simply has no row is not an error: the page filters to an empty set and
 * the pill falls back to the raw id.
 *
 * @param {{get: function(string): ?string}} searchParams
 * @returns {?number}
 */
export const readStepParam = (searchParams) =>
    toStepId(searchParams?.get?.(SWARM_STEP_PARAM));

/**
 * The same params with the step filter removed — where dismissing the pill goes.
 *
 * A NEW `URLSearchParams` rather than a mutation of the caller's, for
 * `withoutEpicParam`'s reason: React Router hands back a live object, and
 * mutating it in place changes the current location's params while re-rendering
 * nothing. It touches `step` ALONE, so dismissing this pill leaves an epic
 * filter — or any other parameter — exactly where it was.
 *
 * @param {URLSearchParams} searchParams
 * @returns {URLSearchParams}
 */
export const withoutStepParam = (searchParams) => {
    const next = new URLSearchParams(searchParams || undefined);
    next.delete(SWARM_STEP_PARAM);
    return next;
};

// Deliberately its own guard rather than a shared `toPositiveId`, matching
// `toEpicId` line for line. The two validate different NOUNS, and a shared
// helper would make relaxing one (a step id that could legitimately be 0, say)
// silently relax the other — which is the whole failure mode this module's
// one-owner-per-contract design exists to avoid.
const toStepId = (value) => {
    if (value == null || String(value).trim() === '') return null;
    const n = Number(String(value).trim());
    return Number.isInteger(n) && n > 0 ? n : null;
};
