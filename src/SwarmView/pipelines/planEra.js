// planEra.js — THE era↔route↔entity binding, stated exactly once (req #3463).
//
// ── WHY THIS FILE EXISTS: A PRODUCTION OUTAGE ──────────────────────────────
// req #3381 re-pointed `/swarm/pipeline/:id` at the Pipeline 2.0 composed read
// while every surface that PRODUCES the id it consumes was still 1.0. The two
// id spaces are DISJOINT and nothing in the schema translates between them:
// production `pipelines` held {2, 79, 80}, production `pipeline2_pipelines`
// held {7}, intersection EMPTY. Every link into the plan page 404'd, for every
// plan, until a human noticed (req #3462).
//
// The defect was not in any one file. It was that "which era does this page
// read?" and "which era does this link point at?" were TWO facts, stored apart,
// in different files, edited by different requirements. This module makes them
// ONE fact. A page carries an era; the era decides the entity it reads AND the
// route its links emit. Re-pointing one without the other is no longer
// something a person can do by editing a file — there is nothing to edit twice.
//
// `__tests__/planEra.test.js` § THE GUARD enforces it mechanically: no file in
// `src/` outside this one may contain a plan route as a string. That test is
// the actual guarantee; the paragraphs above only explain it.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT OWN: the `orchestration_claims` column
// pair (`pipeline_fk`/`epic_fk` vs `pipeline2_fk`/`epic2_fk`). That lives in
// `orchestrationHolder.js`, which is the one reader of claims and has its own
// tested per-era functions. Declaring it here as well would state the fact
// twice, which is the defect this module exists to remove — so a fact belongs
// here only when THIS module's own accessors are what consumers call.
//
// ── THE ERAS ARE PARALLEL, NOT SEQUENTIAL ──────────────────────────────────
// Both are LIVE and both are reachable. 1.0 is production and is unaltered;
// 2.0 stands up beside it on its own routes, reading its own tables. Nothing
// here is a migration or a feature flag: there is no state in which a 1.0 route
// answers a 2.0 id, because the route and the table are the same choice.
//
// NO JSX and no React — a pure module vitest exercises without a DOM, and a
// component file with non-component exports drops out of Fast Refresh. The rule
// `pipelineStepLink.js`, `pipelineEpicLink.js` and `pipelinePlace.js` are all
// written to.

/** Pipeline 1.0 — `pipelines`/`pipeline_steps`, the production plan surface. */
export const PLAN_ERA_1 = 1;
/** Pipeline 2.0 — `pipeline2_*`, standing up in parallel (req #3345/#3367). */
export const PLAN_ERA_2 = 2;

// The era a caller gets when it names none. It is 1.0 DELIBERATELY and
// permanently: every pre-#3463 call site meant 1.0, so an omitted argument
// reproduces today's behaviour exactly rather than quietly moving a page to a
// table it was never written against. When 1.0 is retired the default is
// DELETED, not re-pointed — a default that changes era is the same silent
// re-point this module exists to prevent.
export const DEFAULT_PLAN_ERA = PLAN_ERA_1;

// ── THE BINDING ────────────────────────────────────────────────────────────
// Every fact that differs between the eras, in one table. A new fact goes HERE
// and is read through the accessors below; a `era === 2 ? x : y` ternary spread
// across the codebase is the shape this file replaces.
//
// `detailBase` and `listPath` are the ONLY string forms of these routes in
// `src/`. `routePath` is the same route as React Router declares it (no leading
// slash, `:id` placeholder) so `index.jsx` cannot drift from the builders.
const BINDINGS = Object.freeze({
    [PLAN_ERA_1]: Object.freeze({
        era: PLAN_ERA_1,
        label: '1.0',
        listPath: '/swarm/pipelines',
        detailBase: '/swarm/pipeline',
        listRoutePath: 'swarm/pipelines',
        detailRoutePath: 'swarm/pipeline/:id',
        // The Lambda-Rest entity behind the plan header. Named here because the
        // not-found alert reports it (req #3463 Guard B): "id 79 is not in
        // `pipelines`" is actionable, "No pipeline with id 79" is not.
        planEntity: 'pipelines',
        // The web-storage namespace for this era's PER-PLAN state (camera,
        // scroll offsets). Era-qualified for the same reason the route is: the
        // key is `<prefix><namespace>-<planId>`, so without it 1.0 plan 7 and
        // 2.0 plan 7 share one camera — and the 1.0 list's own prune, which
        // judges liveness against the 1.0 read, deletes the 2.0 plan's state
        // because that read has never heard of it.
        storageNamespace: 'pipeline-plan',
        // `swarm_sessions` carries BOTH pairs, NULL on the era it is not (req
        // #3186 for 1.0, req #3350 for 2.0). `planEraOfSession` READS these
        // rather than naming the columns again — a binding that declared a fact
        // its own consumer then spelled literally would be the duplication this
        // module exists to remove (code review).
        sessionPipelineColumn: 'pipeline_fk',
        sessionEpicColumn: 'epic_fk',
    }),
    [PLAN_ERA_2]: Object.freeze({
        era: PLAN_ERA_2,
        label: '2.0',
        listPath: '/swarm/pipelines2',
        detailBase: '/swarm/pipeline2',
        listRoutePath: 'swarm/pipelines2',
        detailRoutePath: 'swarm/pipeline2/:id',
        planEntity: 'pipeline2_pipelines',
        storageNamespace: 'pipeline2-plan',
        sessionPipelineColumn: 'pipeline2_fk',
        sessionEpicColumn: 'epic2_fk',
    }),
});

/** Every era, in display order. */
export const PLAN_ERAS = Object.freeze([PLAN_ERA_1, PLAN_ERA_2]);

/**
 * Whether `value` names an era this app serves.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isPlanEra(value) {
    return value === PLAN_ERA_1 || value === PLAN_ERA_2;
}

/**
 * The binding for `era`.
 *
 * THROWS on an unknown era rather than falling back, and that is the whole
 * point of the module. A silent fallback is EXACTLY the #3462 failure mode:
 * something asked for an era that did not exist and got 1.0's route pointed at
 * 2.0's data, quietly, in production. An era is always a constant from this
 * file or the return of `planEraOf*` below, so this can only throw for code
 * that is wrong — which the test suite reaches and a reader never does.
 *
 * @param {number} [era]
 * @returns {Readonly<Object>}
 */
export function planEraBinding(era = DEFAULT_PLAN_ERA) {
    // `isPlanEra` FIRST, and it is load-bearing rather than defensive: object
    // keys are STRINGS, so a bare `BINDINGS[era]` resolves `'1'` to era 1 —
    // which would let a stringified era out of web storage or router state sail
    // through here while every `era === PLAN_ERA_1` comparison downstream reads
    // false. Half the app would then agree it was 1.0 and half would not, which
    // is the two-facts-one-question shape this whole module exists to remove.
    const binding = isPlanEra(era) ? BINDINGS[era] : null;
    if (!binding) {
        throw new Error(
            `planEra: unknown plan era ${JSON.stringify(era)} — expected `
            + `${PLAN_ERAS.join(' or ')}. An era is never inferred or defaulted `
            + 'from data; it is chosen at the route (req #3463).');
    }
    return binding;
}

/** `'1.0'` / `'2.0'` — for a label a reader sees, never for a decision. */
export function planEraLabel(era = DEFAULT_PLAN_ERA) {
    return planEraBinding(era).label;
}

/** The Lambda-Rest entity that answers this era's plan reads. */
export function planEntityName(era = DEFAULT_PLAN_ERA) {
    return planEraBinding(era).planEntity;
}

/**
 * The web-storage namespace for this era's per-plan state.
 *
 * The camera key is `viewportStorageKey(planStorageNamespace(era), planId)` and
 * the two scroll keys append `-table` / `-table-x` to it, exactly as they did
 * before there were two eras — the token in the middle is the only thing that
 * moved.
 */
export function planStorageNamespace(era = DEFAULT_PLAN_ERA) {
    return planEraBinding(era).storageNamespace;
}

/** The route of this era's plan LIST. */
export function planListPath(era = DEFAULT_PLAN_ERA) {
    return planEraBinding(era).listPath;
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
 * @param {number} era
 * @param {?number|string} id
 * @param {?string} [query] a query string WITHOUT its leading '?', or null
 * @returns {?string}
 */
export function planDetailPath(era, id, query = null) {
    const { detailBase } = planEraBinding(era);
    const planId = normalizePlanId(id);
    if (planId == null) return null;
    return `${detailBase}/${planId}${query ? `?${query}` : ''}`;
}

/**
 * The React Router `path` for this era's list / detail routes.
 *
 * `index.jsx` declares its routes from these rather than from literals, so the
 * matcher and every builder above are the same fact. React Router v6 ranks by
 * SPECIFICITY, so the literal list paths and the parameterised detail paths
 * cannot shadow each other — the singular/plural split is deliberate, and the
 * 2.0 pair repeats it (`swarm/pipelines2` vs `swarm/pipeline2/:id`).
 */
export function planListRoutePath(era = DEFAULT_PLAN_ERA) {
    return planEraBinding(era).listRoutePath;
}
export function planDetailRoutePath(era = DEFAULT_PLAN_ERA) {
    return planEraBinding(era).detailRoutePath;
}

/**
 * A RegExp matching this era's detail route and nothing else.
 *
 * DERIVED from the same literal the builder uses, because a builder and a
 * matcher that state the route separately are how a rename breaks the guard
 * while the link keeps working (`pipelinePlace.js` made this argument for 1.0
 * alone; it is the same argument, now with two routes to keep apart).
 *
 * The LIST path must not match: `/swarm/pipeline` and `/swarm/pipelines` differ
 * by one character and share a prefix. Anchored, and the id segment must be
 * digits — `/swarm/pipeline/2/anything` is not a route this app serves.
 *
 * @param {number} [era]
 * @returns {RegExp}
 */
export function planDetailPathPattern(era = DEFAULT_PLAN_ERA) {
    return new RegExp(`^${planEraBinding(era).detailBase}/\\d+/?$`);
}

/**
 * The era a `swarm_sessions` row's plan attribution belongs to, or null when it
 * carries none.
 *
 * THE COLUMN NAMES THE ERA. `pipeline_fk` (req #3186) is 1.0 and `pipeline2_fk`
 * (req #3350) is 2.0; both are NULL on a row of the other era, and both are
 * NULL on work outside any plan, which is a real answer. Reading the id without
 * reading which column it came from is precisely how a 2.0 id reached a 1.0
 * route — so callers take the id from HERE, never from the row directly.
 *
 * 2.0 is tested FIRST for the same reason `scopeLabel` does
 * (`orchestrationHolder.js`): a row carrying both is a data defect, and
 * attributing it to the newer era surfaces it rather than hiding it under the
 * era being retired.
 *
 * THE COLUMN NAMES COME FROM THE BINDING, not from literals here (code review):
 * a module whose whole purpose is to state each era fact once must not be the
 * first place to state one twice.
 *
 * `epicId` rides along because a session's epic attribution is the SAME pair of
 * columns one level down (`epic_fk` / `epic2_fk`), and a caller that took the
 * pipeline from here and then read `row.epic_fk` itself would be era-correct
 * about the plan and era-blind about the epic.
 *
 * @param {?Object} row a swarm_sessions row
 * @returns {?{era: number, pipelineId: number, epicId: ?number}}
 */
export function planEraOfSession(row) {
    if (!row) return null;
    // 2.0 first — see above.
    for (const era of [PLAN_ERA_2, PLAN_ERA_1]) {
        const { sessionPipelineColumn, sessionEpicColumn } = planEraBinding(era);
        const pipelineId = normalizePlanId(row[sessionPipelineColumn]);
        if (pipelineId != null) {
            return { era, pipelineId, epicId: normalizePlanId(row[sessionEpicColumn]) };
        }
    }
    return null;
}

/**
 * A plan id as a usable integer, or null.
 *
 * Exported because the era-aware callers need the SAME normalization the path
 * builder applies — a caller that guards with its own `!= null` and then hands
 * a `''` to `planDetailPath` would render a link and a number that disagree.
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
    // The same argument `pipeline2Adapter.js::epicSortOrderOf` makes.
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
}
