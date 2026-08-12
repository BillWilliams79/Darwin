// planEra.js — THE route↔entity binding for the plan surface, stated exactly
// once (req #3463; collapsed to one era by req #3356).
//
// ── WHY THIS FILE EXISTS: A PRODUCTION OUTAGE ──────────────────────────────
// req #3381 re-pointed `/swarm/pipeline/:id` at the Pipeline 2.0 composed read
// while every surface that PRODUCES the id it consumes was still 1.0. The two
// id spaces were DISJOINT and nothing in the schema translated between them:
// production's 1.0 plan table held {2, 79, 80} and its 2.0 one held {7},
// intersection EMPTY. Every link into the plan page 404'd, for every plan, until
// a human noticed (req #3462). (The table names of that era are deliberately not
// spelled here — both were renamed or dropped by req #3356, so naming them would
// date the paragraph without making it clearer.)
//
// The defect was not in any one file. It was that "which table does this page
// read?" and "which route do this page's links point at?" were TWO facts,
// stored apart, in different files, edited by different requirements. This
// module makes them ONE fact. Re-pointing one without the other is no longer
// something a person can do by editing a file — there is nothing to edit twice.
//
// `__tests__/planEra.test.js` § THE GUARD enforces it mechanically: no file in
// `src/` outside this one may contain a plan route as a string. That test is
// the actual guarantee; the paragraphs above only explain it.
//
// ── THERE IS ONE ERA NOW, AND THE FILE STAYS (req #3356) ───────────────────
// This module used to hold a two-row BINDINGS table keyed by era, and every
// accessor below took an `era` argument. Pipeline 1.0 is eradicated — migration
// 20260812175325 dropped its tables and 20260812184333 renamed the 2.0 tables
// into the vacated names — so there is one route, one entity, one namespace,
// and the era parameter is gone from every function here and every call site.
//
// THE FILE IS NOT DELETED ALONG WITH THE ERAS, and that is deliberate. Its
// value was never the branching; it is that the route strings live in exactly
// one place, which is what THE GUARD tests. Inlining `/swarm/pipeline/${id}`
// back into a dozen call sites because there is only one era left would discard
// the guarantee and keep the outage's cause. A future second plan surface
// re-opens this file, and it should re-open it knowing that.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT OWN: the `orchestration_claims` scope
// columns. Those live in `orchestrationHolder.js`, which is the one reader of
// claims. Declaring them here as well would state a fact twice, which is the
// defect this module exists to remove — so a fact belongs here only when THIS
// module's own accessors are what consumers call.
//
// NO JSX and no React — a pure module vitest exercises without a DOM, and a
// component file with non-component exports drops out of Fast Refresh. The rule
// `pipelineStepLink.js`, `pipelineEpicLink.js` and `pipelinePlace.js` are all
// written to.

// ── THE BINDING ────────────────────────────────────────────────────────────
// Every fact about where the plan surface lives, in one frozen record. A new
// fact goes HERE and is read through the accessors below.
//
// `detailBase` and `listPath` are the ONLY string forms of these routes in
// `src/`. `routePath` is the same route as React Router declares it (no leading
// slash, `:id` placeholder) so `index.jsx` cannot drift from the builders.
const BINDING = Object.freeze({
    listPath: '/swarm/pipelines',
    detailBase: '/swarm/pipeline',
    listRoutePath: 'swarm/pipelines',
    detailRoutePath: 'swarm/pipeline/:id',
    // The Lambda-Rest entity behind the plan header. Named here because the
    // not-found alert reports it (req #3463 Guard B): "id 79 is not in
    // `pipelines`" is actionable, "No pipeline with id 79" is not.
    planEntity: 'pipelines',
    // The web-storage namespace for PER-PLAN state (camera, scroll offsets).
    // The key is `<prefix><namespace>-<planId>`.
    //
    // This was `pipeline2-plan` until req #3356 dropped the era marker.
    // Deliberately NOT `pipeline-plan` — that was the FIRST generation's own
    // namespace (see `git log`), so reusing it would not orphan anything; it
    // would silently ADOPT a first-generation era's stored camera/scroll
    // state for any plan id that happened to exist in both eras (id
    // collision, not migration — a stale camera for the WRONG plan, not a
    // missing one). `plan-view` has never been used by either era. The
    // rename ORPHANS existing per-plan cameras and scroll offsets rather than
    // migrating them, which is the same call `PIPELINE_PLACE_SCHEMA_VERSION`
    // makes and for the same reason — see `pipelinePlace.js`, which documents
    // the cost and the prune that collects what is left behind.
    storageNamespace: 'plan-view',
});

/** The Lambda-Rest entity that answers the plan reads. */
export function planEntityName() {
    return BINDING.planEntity;
}

/**
 * The web-storage namespace for per-plan state.
 *
 * The camera key is `viewportStorageKey(planStorageNamespace(), planId)` and
 * the two scroll keys append `-table` / `-table-x` to it.
 */
export function planStorageNamespace() {
    return BINDING.storageNamespace;
}

/** The route of the plan LIST. */
export function planListPath() {
    return BINDING.listPath;
}

/**
 * The route of ONE plan, or null when `id` is unusable.
 *
 * NULL RATHER THAN A BEST-EFFORT PATH, so a caller renders a plain number
 * instead of a link to `/swarm/pipeline/undefined` — the "omit rather than
 * render a dead link" rule `pipelineStepLink.js` and `pipelineEpicLink.js`
 * already apply, hoisted here so it is applied once.
 *
 * NULLISH AND EMPTY ARE REJECTED BEFORE `Number` SEES THEM: `Number(null)` and
 * `Number('')` are both 0, and 0 is a perfectly good integer — a step whose
 * `pipeline_fk` did not resolve would otherwise produce a confident link to
 * plan 0, rendering the not-found alert as though the data were at fault.
 *
 * @param {?number|string} id
 * @param {?string} [query] a query string WITHOUT its leading '?', or null
 * @returns {?string}
 */
export function planDetailPath(id, query = null) {
    const planId = normalizePlanId(id);
    if (planId == null) return null;
    return `${BINDING.detailBase}/${planId}${query ? `?${query}` : ''}`;
}

/**
 * The React Router `path` for the list / detail routes.
 *
 * `index.jsx` declares its routes from these rather than from literals, so the
 * matcher and every builder above are the same fact. React Router v6 ranks by
 * SPECIFICITY, so the literal list path and the parameterised detail path
 * cannot shadow each other — the singular/plural split is deliberate.
 */
export function planListRoutePath() {
    return BINDING.listRoutePath;
}
export function planDetailRoutePath() {
    return BINDING.detailRoutePath;
}

/**
 * A RegExp matching the plan detail route and nothing else.
 *
 * DERIVED from the same literal the builder uses, because a builder and a
 * matcher that state the route separately are how a rename breaks the guard
 * while the link keeps working.
 *
 * The LIST path must not match: `/swarm/pipeline` and `/swarm/pipelines` differ
 * by one character and share a prefix. Anchored, and the id segment must be
 * digits — `/swarm/pipeline/2/anything` is not a route this app serves.
 *
 * @returns {RegExp}
 */
export function planDetailPathPattern() {
    return new RegExp(`^${BINDING.detailBase}/\\d+/?$`);
}

/**
 * A plan id as a usable integer, or null.
 *
 * Exported because callers need the SAME normalization the path builder
 * applies — a caller that guards with its own `!= null` and then hands a `''`
 * to `planDetailPath` would render a link and a number that disagree.
 *
 * @param {*} value
 * @returns {?number}
 */
export function normalizePlanId(value) {
    // A WHITELIST OF INPUT TYPES, not merely a nullish guard. The guard this
    // replaces (`pipelineStepLink.js`'s `toId`) rejected `null` and `''`
    // because `Number` turns both into 0 and 0 is a perfectly good id — but
    // `Number([])` is ALSO 0 and `Number(true)` is 1, so an empty array or a
    // boolean out of a partial row produced a confident link to plan 0 or plan
    // 1: real plans, belonging to somebody else's data. Naming the two types an
    // id can legitimately arrive as (a number from a row, a string from a URL
    // or from JSON) closes that class outright rather than one value at a time.
    // The same argument `pipelineAdapter.js::epicSortOrderOf` makes.
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
}
