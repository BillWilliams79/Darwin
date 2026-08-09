// routeTrail.js — "which page was I on immediately before this one" (req #3431).
//
// ── THE ONE QUESTION IT ANSWERS, AND WHY NOTHING ELSE CAN ──────────────────
// Req #3431 makes `/swarm/pipelines` resume the plan the reader last had open.
// That redirect has exactly one way to go wrong, and it is fatal to the page:
// if it also fires when the reader arrives FROM a plan — clicking Pipelines in
// the nav rail, or pressing Back — they are bounced straight back to the plan
// and the list becomes unreachable. The discriminator is the route they came
// from, and a page that is not mounted cannot observe one.
//
// So this is fed from `App.jsx`, the only component mounted across every
// navigation. It is not a general-purpose history: two slots, no stack, no
// subscribers. A third consumer would be the moment to reconsider the shape;
// one consumer does not justify one.
//
// ── MODULE STATE, NOT A STORE, NOT A CONTEXT ───────────────────────────────
// Nothing RENDERS from this. The resume gate reads it once, inside an effect,
// at the moment it decides. A Zustand store would re-render every subscriber on
// every navigation in the app to serve a value nobody draws, and a context would
// re-render the entire tree under `App` for the same nothing. `viewportMemory.js`
// makes the same call for the same reason: a side channel with no renderer is a
// module.
//
// ── DELIBERATELY NOT PERSISTED ─────────────────────────────────────────────
// "The route I came from" is a fact about THIS page load and is meaningless
// after one — a reload has no previous route, and that is the correct answer
// rather than a missing one, because a reload of `/swarm/pipelines` really is
// an arrival from nowhere. The DURABLE half of the feature lives in
// `SwarmView/pipelines/pipelinePlace.js`, in localStorage, which is where the
// requirement asked for it. Persisting this too would make a reload inherit an
// answer from a session that had ended.
//
// No React and no JSX, so vitest exercises it without a DOM — the same rule
// `viewportMemory.js` and `pipelineStepLink.js` are written to.

let currentPath = null;
let previousPath = null;

/**
 * Record that the app is now showing `pathname`.
 *
 * IDEMPOTENT ON THE SAME PATH, which is load-bearing rather than an
 * optimisation. `App` re-runs its effect on any location change, and a query
 * string edit or a `navigate` to the path already showing would otherwise
 * shuffle the current path into the previous slot — leaving `previousRoute()`
 * saying "you came from a plan" when the reader came from the same plan they
 * are still on. The pipelines page rewrites nothing in its own URL today, but a
 * caller that did would silently break the resume gate rather than this file.
 *
 * @param {?string} pathname `location.pathname` — the PATH only, never the
 *                  search string. The consumer asks "was that a plan page", a
 *                  question about the route, and including `?mode=` would make
 *                  two views of one plan look like two different pages.
 */
export function noteRoute(pathname) {
    if (typeof pathname !== 'string' || pathname === '') return;
    if (pathname === currentPath) return;
    previousPath = currentPath;
    currentPath = pathname;
}

/**
 * The path the reader was on immediately before reaching `pathname`, or null.
 *
 * ── IT TAKES THE CALLER'S OWN PATH, AND THAT IS THE WHOLE DESIGN ───────────
 * A bare `previousRoute()` reads correctly and is WRONG HALF THE TIME here,
 * because React runs a child's effects BEFORE its parent's. The shell records
 * the trail; the page consumes it. On a fresh page load both mount together and
 * the page's effect wins the race, so nothing has been recorded yet and the
 * previous slot is empty. On an in-app navigation the page's effect may run
 * either before the shell has moved the trail on (the transition's first
 * commit) or after (any later commit, e.g. one gated on data arriving) — so the
 * route the reader came from sits in `currentPath` in the first case and in
 * `previousPath` in the second.
 *
 * Asking with your own path collapses both: if the trail has already advanced
 * to you, the answer is behind you; if it has not, the answer is where the
 * trail still is. Deterministic in every ordering, with no effect-ordering
 * assumption for a future edit to break silently.
 *
 * Null means "arrived from nowhere" — a fresh open, a reload, a bookmark, a
 * link from outside the app. That is precisely the case req #3431's resume
 * exists to serve, and callers must not read it as "be careful".
 *
 * @param {?string} pathname the caller's own `location.pathname`
 * @returns {?string}
 */
export function cameFrom(pathname) {
    return currentPath === pathname ? previousPath : currentPath;
}

/**
 * Forget both slots.
 *
 * The escape hatch for a test that needs a cold module, and for nothing else —
 * exported rather than left to `vi.resetModules()` because a consumer's test
 * would otherwise have to reset this module's registry entry along with its
 * own, which silently un-mocks whatever else it had stubbed.
 */
export function resetRouteTrail() {
    currentPath = null;
    previousPath = null;
}
