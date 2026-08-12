// Requirement ORCHESTRATION membership — req #3180, widened by req #3419,
// narrowed back by req #3357.
//
// THE browser's one answer to "is this requirement part of a plan":
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
//   ORCHESTRATED (`orchestratedRequirementIds`) — THE answer the user-facing
//     browse toggle asks for.
//
// req #3419 ADDED a second population — requirements "filed under a BODY OF
// WORK" via `requirements.feature_fk -> features.epic_fk`, true of plenty of
// requirements no step carried yet — and unioned it with the step set so the
// toggle would not miss epic-filed-but-unseated work.
//
// req #3357 RETIRES IT, because Feature (the only mechanism that could file a
// requirement into an epic without also seating it on a step) leaves the
// frontend entirely, and re-deriving the same fact off a step's epic is not
// possible for 1.0: no 1.0 `pipeline_steps` row carries an `epic_fk` — only
// Pipeline 2.0's `pipeline2_steps` does, a disjoint id space unrelated to the
// live 1.0 "Darwin" plan this toggle filters. So `orchestratedRequirementIds`
// COLLAPSES to `pipelinedRequirementIds` — every requirement this toggle can
// still call "part of a plan" is one a step actually carries. The #3419 gap
// (an epic-filed, unseated requirement staying visible under the toggle) is
// an ACCEPTED, TRANSITIONAL regression: the population it was catching only
// existed because Feature did.
//
// WHAT THE BROWSE TOGGLE COST ON THE LAUNCH CHIPS under req #3419, for the
// historical record (measured 2026-08-09 against production, toggle at its
// shipped default ON, req #3242) — NO LONGER TRUE now that the union is gone,
// kept here because the reasoning explains why `pipelinedRequirementIds`
// alone was always the right predicate for LAUNCH LEGALITY specifically:
//
//     approved     2 offered -> 0   (#3172, #3176)
//     authoring   42 offered -> 33  (#3178 #3304 #3314 #3315 #3385 #3424 #3425 #3426 #3433)
//     swarm_ready  UNAFFECTED — no swarm_ready requirement was epic-seated
//
// Every id in that table was LEGAL to launch — no step carried it — which is
// why req #3180's rule (`aggregatorRowVisible`'s `offersLaunch` branch) was
// always `pipelinedRequirementIds` alone and never the union: "offering a
// launch the coordinator owns is a DEFECT" is about showing something the
// reader must NOT act on, a narrower question than the browse toggle's
// preference. That distinction is why the two stayed separate call sites even
// while the browse toggle's own answer has now rejoined it.

/**
 * Requirement ids at least one pipeline STEP carries, EITHER era, unioned.
 *
 * req #3491 — widened to also read the 2.0 junction. Mirrors the backend's own
 * union (`darwin-mcp/services/requirements.py::_pipelined_requirement_ids`),
 * which this deliberately duplicates rather than shares: the browser reaches
 * Lambda-Rest, the daemon reaches it from a localhost process. `stepRequirements2`
 * defaults to `undefined` so every existing 1.0-only call site keeps working
 * unchanged.
 *
 * @param {Array<{requirement_fk: number}>} stepRequirements  rows from
 *        `useAllPipelineStepRequirements` (the 1.0 junction, whole-table read).
 * @param {Array<{requirement_fk: number}>} [stepRequirements2]  rows from
 *        `useAllPipeline2StepRequirements` (the 2.0 junction, whole-table read).
 * @returns {Set<number>}
 */
export const pipelinedRequirementIds = (stepRequirements, stepRequirements2) => {
    const ids = new Set();
    const addAll = (links) => {
        if (!Array.isArray(links)) return;
        for (const link of links) {
            // A junction row with no requirement_fk cannot name a requirement. Skip
            // it rather than seeding the set with null/undefined, which would make
            // `has(r.id)` answer true for any row whose own id was missing.
            if (!link || link.requirement_fk === null || link.requirement_fk === undefined) continue;
            ids.add(Number(link.requirement_fk));
        }
    };
    addAll(stepRequirements);
    addAll(stepRequirements2);
    return ids;
};

/**
 * THE browse answer: a requirement is ORCHESTRATED when a pipeline step
 * carries it, either era. Req #3357 retired the second population this used to
 * union in (epic-filed-but-unseated, via `requirements.feature_fk ->
 * features.epic_fk`) — see the module header. Req #3491 widened it again, this
 * time with the 2.0 junction rather than a re-derivation off Feature. Kept as
 * its own named export, distinct from `pipelinedRequirementIds`, so both stay
 * one call site each even though they answer identically today.
 *
 * @param {Array} stepRequirements  the 1.0 junction rows
 * @param {Array} [stepRequirements2]  the 2.0 junction rows
 * @returns {Set<number>}
 */
export const orchestratedRequirementIds = (stepRequirements, stepRequirements2) =>
    pipelinedRequirementIds(stepRequirements, stepRequirements2);

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
