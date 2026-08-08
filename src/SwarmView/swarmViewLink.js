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
