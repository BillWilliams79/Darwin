// Requirement ORCHESTRATION membership — req #3180, widened by req #3419.
//
// THE browser's one answer to "is this requirement part of a plan". Two
// different questions live here and they must not be collapsed:
//
//   STEP association (`pipelinedRequirementIds`)
//     A `pipeline_step_requirements` junction row exists — "is this SCHEDULED".
//     This is LAUNCH ELIGIBILITY (req #3180): a step-carried requirement is not
//     eligible for a direct swarm-start, because its launch is the coordinator's
//     to make at the point the plan says so. It is therefore applied
//     UNCONDITIONALLY on the surfaces that OFFER a launch, never as a
//     preference, and it must stay NARROW. The daemon derives the same fact
//     server-side as `requirement.pipelined`
//     (darwin-mcp/services/requirements.py); the two cannot share code — the
//     browser reaches Lambda-Rest, the daemon reaches it from a localhost
//     process — so they are deliberate duplicates of one rule, exactly like
//     pipelineModel.js and pipeline_derive.py.
//
//   EPIC association (`epicRequirementIds`)
//     `requirements.feature_fk` -> `features.epic_fk` — "does this belong to a
//     BODY OF WORK". True of plenty of requirements no step carries yet.
//
//   ORCHESTRATED (`orchestratedRequirementIds`) — the UNION, and THE answer the
//     user-facing browse toggle asks for.
//
// req #3419 — WHY THE UNION EXISTS. req #3180 pointed the browse toggle at STEP
// association alone and wrote that the gap between the two populations "is
// exactly what the filter exists to expose". Measured against production on
// 2026-08-09, that gap is what the control's reader sees as a bug: category 1
// under the default status chips holds 27 requirements, 9 survive the toggle,
// and 4 of those 9 are filed under an epic (#3304 and #3314 -> feature 35 ->
// epic 4, #3385 -> feature 31 -> epic 7, #3433 -> feature 41 -> epic 9). Asked
// to hide orchestrated work, the page kept showing work that is plainly part of
// a plan. That was filed twice (req #3419 is the second), so the control now
// answers the question its label makes.
//
// The two answers stay SEPARATE functions rather than one widened set, because
// they are asked by different rules and only one of them is unconditional:
// LEGALITY reads the step set (`aggregatorRowVisible`'s `offersLaunch` branch),
// VISIBILITY reads the union.
//
// WHAT THE BROWSE TOGGLE COSTS ON THE LAUNCH CHIPS, measured 2026-08-09 against
// production with the toggle at its shipped default (ON, req #3242):
//
//     approved     2 offered -> 0   (#3172, #3176)
//     authoring   42 offered -> 33  (#3178 #3304 #3314 #3315 #3385 #3424 #3425 #3426 #3433)
//     swarm_ready  UNAFFECTED — no swarm_ready requirement was epic-seated
//
// swarm_ready being untouched is the load-bearing part of that table: it is the
// chip the launch workflow actually runs on, so the practical cost is the
// two-row `approved` chip going empty.
//
// Every id there is LEGAL to launch — no step carries it. So the approved chip
// is empty in the default configuration, and that is a real consequence, not an
// oversight. It is kept because the two rules answer opposite questions:
// req #3180's is "offering a launch the coordinator owns is a DEFECT", which is
// about showing something the reader must NOT act on; the toggle's is "I do not
// want plan work on screen", which is a PREFERENCE, and a filter reducing what
// you can act on is what a filter does. The reader reverses it with one click,
// and the aggregator sits inside the same Cards view the requirement asked to
// clean up — exempting it would put the hidden rows straight back on screen a
// card away. If that trade turns out wrong, the change is one condition in
// `aggregatorRowVisible`, not here.

/**
 * Requirement ids at least one pipeline STEP carries.
 *
 * @param {Array<{requirement_fk: number}>} stepRequirements  rows from
 *        `useAllPipelineStepRequirements` (the junction, whole-table read).
 * @returns {Set<number>}
 */
export const pipelinedRequirementIds = (stepRequirements) => {
    const ids = new Set();
    if (!Array.isArray(stepRequirements)) return ids;
    for (const link of stepRequirements) {
        // A junction row with no requirement_fk cannot name a requirement. Skip
        // it rather than seeding the set with null/undefined, which would make
        // `has(r.id)` answer true for any row whose own id was missing.
        if (!link || link.requirement_fk === null || link.requirement_fk === undefined) continue;
        ids.add(Number(link.requirement_fk));
    }
    return ids;
};

/**
 * Requirement ids whose `feature_fk` resolves to a feature that names an EPIC.
 *
 * A feature with a NULL `epic_fk` is NOT epic association — the requirement is
 * filed, but under nothing a plan is organized around. Requiring the epic is
 * what makes this answerable as "part of a body of work" rather than merely
 * "categorized".
 *
 * CLOSED features count. `features.closed` says the feature is finished, not
 * that its requirements left the epic, and a caller that reads only open
 * features would silently un-orchestrate everything under a completed feature.
 * The hook therefore reads features with `closed: ALL_ROWS`.
 *
 * @param {Array<{id: number|string, feature_fk: number|null}>} requirements
 *        rows carrying `feature_fk` — a WHOLE-TABLE projection, never the
 *        per-surface list. See `useRequirementVisibility` for why.
 * @param {Array<{id: number, epic_fk: number|null}>} features
 * @returns {Set<number>}
 */
export const epicRequirementIds = (requirements, features) => {
    const ids = new Set();
    if (!Array.isArray(requirements) || !Array.isArray(features)) return ids;

    const featureHasEpic = new Set();
    for (const f of features) {
        if (!f || f.id === null || f.id === undefined) continue;
        if (f.epic_fk === null || f.epic_fk === undefined) continue;
        featureHasEpic.add(Number(f.id));
    }
    if (featureHasEpic.size === 0) return ids;

    for (const r of requirements) {
        if (!r || r.id === null || r.id === undefined || r.id === '') continue;
        if (r.feature_fk === null || r.feature_fk === undefined) continue;
        if (!featureHasEpic.has(Number(r.feature_fk))) continue;
        ids.add(Number(r.id));
    }
    return ids;
};

/**
 * THE browse answer: a requirement is ORCHESTRATED when a pipeline step carries
 * it OR it is filed under an epic.
 *
 * @param {Array} stepRequirements  the junction rows
 * @param {Array} requirements      whole-table `id,feature_fk` projection
 * @param {Array} features          whole-table `id,epic_fk` projection
 * @returns {Set<number>}
 */
export const orchestratedRequirementIds = (stepRequirements, requirements, features) => {
    const ids = pipelinedRequirementIds(stepRequirements);
    for (const id of epicRequirementIds(requirements, features)) ids.add(id);
    return ids;
};

/**
 * Drop every row whose id is in `ids`. The ONE filter primitive — both facts
 * above are applied through it, so "which rows survive" has a single reading.
 *
 * `enabled === false` returns the input array UNCHANGED (same reference), so a
 * caller that has not opted in — or whose reads have not resolved — pays nothing
 * and cannot trip a referential-equality dependency.
 *
 * WHILE THE READS ARE IN FLIGHT the set is empty, so nothing is dropped and the
 * surface shows MORE than it eventually will. That direction is the deliberate
 * one: the alternative (treat unknown as orchestrated) would blank a launch
 * surface on every page load and, worse, would hide eligible work behind a fetch
 * failure.
 *
 * @param {Array<{id: number}>} rows
 * @param {Set<number>} ids
 * @param {boolean} [enabled=true]
 */
export const excludeByIds = (rows, ids, enabled = true) => {
    if (!enabled || !Array.isArray(rows)) return rows;
    if (!ids || ids.size === 0) return rows;
    return filterKeepingIdentity(rows, r => !ids.has(Number(r?.id)));
};

/**
 * `Array.prototype.filter` that returns the INPUT ARRAY when it drops nothing.
 *
 * THIS IS LOAD-BEARING, not a micro-optimization. Every consumer of these
 * predicates feeds the result into a `useMemo`/`useEffect` dependency, and
 * several of those effects call `setState` with a new array. A bare `.filter`
 * mints a fresh identity on every render, so the effect re-runs, sets state,
 * re-renders, and filters again — a SYNCHRONOUS render loop that pins the event
 * loop, which means it does not merely fail a test, it wedges the process (no
 * per-test timeout can interrupt it).
 *
 * `excludeByIds` had this property from req #3180 via its `ids.size === 0` fast
 * path, which absorbed identity churn coming from ABOVE it. Req #3419's first
 * cut replaced two of its call sites with a raw `.filter` and reintroduced the
 * loop; this is the primitive that puts it back, in one place, for predicates
 * that are not id-set membership.
 *
 * @param {Array} rows
 * @param {(row: any) => boolean} predicate
 */
export const filterKeepingIdentity = (rows, predicate) => {
    if (!Array.isArray(rows)) return rows;
    const kept = rows.filter(predicate);
    return kept.length === rows.length ? rows : kept;
};
