// Requirement ORCHESTRATION membership — req #3180, widened by req #3419,
// narrowed back by req #3357.
//
// THE browser's one answer to "is this requirement part of a plan":
//
//   EPIC association (`pipelinedRequirementIds`)
//     A `epic_requirements` junction row exists — "is this SCHEDULED".
//     This is LAUNCH ELIGIBILITY (req #3180): an epic-carried requirement is not
//     eligible for a direct swarm-start, because its launch is the coordinator's
//     to make at the point the plan says so. The daemon derives the same fact
//     server-side as `requirement.pipelined`
//     (darwin-mcp/services/requirements.py); the two cannot share code — the
//     browser reaches Lambda-Rest, the daemon reaches it from a localhost
//     process — so they are deliberate duplicates of one rule, exactly like
//     pipelineModel.js and pipeline_derive.py.
//
//     req #3502 — NO BROWSE SURFACE APPLIES THIS ANYMORE. It used to be applied
//     unconditionally by the aggregator card, on the grounds that a card
//     offering a row is an offer to launch it. It is not: the LAUNCHER is
//     `/swarm-start`, its auto-discovery still excludes epic-carried work, and
//     that gate is where eligibility belongs. What the card's copy actually did
//     was make the reader's orchestrated toggle mean two different things on two
//     surfaces of one page. Nothing in `Darwin/src` reads this function today
//     except `orchestratedRequirementIds` below; it stays a named export because
//     the fact is real and the daemon-side duplicate is what it documents.
//
//   ORCHESTRATED (`orchestratedRequirementIds`) — THE answer the user-facing
//     browse toggle asks for.
//
// req #3419 ADDED a second population — requirements "filed under a BODY OF
// WORK" through the retired middle tier's own reference to the initiative, true of
// plenty of requirements no epic carried yet — and unioned it with the epic set so the
// toggle would not miss initiative-filed-but-unseated work.
//
// req #3357 RETIRES IT, because Feature (the only mechanism that could file a
// requirement into an initiative without also seating it on an epic) leaves the
// frontend entirely, and re-deriving the same fact off an epic's initiative is not
// possible for 1.0: no 1.0 `epics` row carries an `initiative_fk` — only
// Pipeline 2.0's `epics` does, a disjoint id space unrelated to the
// live 1.0 "Darwin" plan this toggle filters. So `orchestratedRequirementIds`
// COLLAPSES to `pipelinedRequirementIds` — every requirement this toggle can
// still call "part of a plan" is one an epic actually carries. The #3419 gap
// (an initiative-filed, unseated requirement staying visible under the toggle) is
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
//     swarm_ready  UNAFFECTED — no swarm_ready requirement was initiative-seated
//
// Every id in that table was LEGAL to launch — no epic carried it — which is
// why req #3180's rule (the aggregator's deleted `offersLaunch` branch) was
// always `pipelinedRequirementIds` alone and never the union: "offering a
// launch the coordinator owns is a DEFECT" is about showing something the
// reader must NOT act on, a narrower question than the browse toggle's
// preference. Req #3502 resolved that distinction the other way for the
// BROWSER — a browse card showing a row is not an offer, and the launcher does
// its own gating — so the two questions no longer have two call sites here.

/**
 * Requirement ids at least one pipeline EPIC carries.
 *
 * req #3491 widened this to also read a second, first-generation junction
 * while both eras ran side by side; req #3356 retired that union along with
 * the first generation itself — `useAllPipeline2EpicRequirements` (the hook
 * that fed the second argument) no longer exists in `useDataQueries.js`, so
 * a caller still passing one would be reading `undefined`, harmlessly, but
 * for the wrong reason. Collapsed back to one argument. Mirrors the backend's
 * own single-junction read
 * (`darwin-mcp/services/requirements.py::_pipelined_requirement_ids`), which
 * this deliberately duplicates rather than shares: the browser reaches
 * Lambda-Rest, the daemon reaches it from a localhost process.
 *
 * @param {Array<{requirement_fk: number}>} epicRequirements  rows from
 *        `useAllPipelineEpicRequirements` (the junction, whole-table read).
 *        The 1.0 junction fed this until req #3356; the ROW SHAPE is
 *        identical, so only the caller moved.
 * @returns {Set<number>}
 */
export const pipelinedRequirementIds = (epicRequirements) => {
    const ids = new Set();
    if (!Array.isArray(epicRequirements)) return ids;
    for (const link of epicRequirements) {
        // A junction row with no requirement_fk cannot name a requirement. Skip
        // it rather than seeding the set with null/undefined, which would make
        // `has(r.id)` answer true for any row whose own id was missing.
        if (!link || link.requirement_fk === null || link.requirement_fk === undefined) continue;
        ids.add(Number(link.requirement_fk));
    }
    return ids;
};

/**
 * The requirement ids ONE epic carries — req #3503.
 *
 * Belongs here rather than in `initiativeMembership.js` because EPIC association is
 * this module's own stated domain. The narrowing is the whole point: everything
 * above answers "is this on ANY epic", and this answers "is this on epic X".
 *
 * ONE HOP, WHERE THE INITIATIVE ANSWER TAKES TWO. `initiativeRequirementIds` needs a `epics`
 * argument to resolve `initiative_fk -> id` before it can read the junction; an epic id
 * IS the junction's own `epic_fk`, so no second read exists to make. That is why
 * the hook behind this (`useEpicRequirementIds`) fetches one bounded list where
 * the initiative hook fetches two.
 *
 * A null/undefined `epicId` returns an EMPTY set, not every id: the caller that
 * means "no filter" passes null to `filterToEpicReqIds` instead, and conflating
 * the two here would make an unresolved id read as "the whole table".
 *
 * @param {?Array<{epic_fk: number, requirement_fk: number}>} epicRequirements rows
 *        from `useAllPipelineEpicRequirements` (the junction, whole-table read)
 * @param {?number} epicId
 * @returns {Set<number>}
 */
export const epicRequirementIds = (epicRequirements, epicId) => {
    const ids = new Set();
    if (epicId === null || epicId === undefined || epicId === '') return ids;
    if (!Array.isArray(epicRequirements)) return ids;
    const target = Number(epicId);
    for (const link of epicRequirements) {
        if (!link) continue;
        // Both guarded explicitly rather than left to `Number(null)`, which is 0
        // — a perfectly good integer that would match a `epicId` of 0 and seed
        // the set with a null requirement id.
        const sid = link.epic_fk;
        if (sid === null || sid === undefined || sid === '') continue;
        if (Number(sid) !== target) continue;
        const rid = link.requirement_fk;
        if (rid === null || rid === undefined || rid === '') continue;
        ids.add(Number(rid));
    }
    return ids;
};

/**
 * Keep only the epic's requirements — req #3503.
 *
 * Identical semantics to `initiativeMembership.js`' `filterToInitiative`, and a deliberate
 * duplicate rather than an import: that module is the INITIATIVE answer, and a caller
 * reaching across for its filter is one autocomplete away from reaching for its
 * derivation too. `excludeByIds` above is not this function — it DROPS the ids it
 * is given, this KEEPS them, and the two resolve their unknown states in opposite
 * directions on purpose.
 *
 * `epicReqIds == null` means NO FILTER IS ACTIVE and returns the input UNCHANGED
 * (same reference), so an ordinary page pays nothing and cannot trip a
 * referential-equality dependency.
 *
 * AN EMPTY SET IS A REAL ANSWER, NOT "no filter". While the junction read is in
 * flight the set is empty and this returns an EMPTY LIST — `filterToInitiative`'s
 * direction, for its reason: this SELECTS rows, so "unknown" must mean "none
 * yet". Showing the whole unfiltered page for a beat underneath a pill claiming
 * it is filtered is the page lying about what it is showing.
 *
 * @param {?Array<{id: number}>} rows
 * @param {?Set<number>} epicReqIds
 */
export const filterToEpicReqIds = (rows, epicReqIds) => {
    if (!epicReqIds) return rows;
    if (!Array.isArray(rows)) return rows;
    return rows.filter(r => r && epicReqIds.has(Number(r.id)));
};

/**
 * THE browse answer: a requirement is ORCHESTRATED when a pipeline epic
 * carries it. Req #3357 retired the second population this used to union in
 * (initiative-filed-but-unseated, through the retired middle tier's own reference
 * to the initiative) — see the module header; req #3491's later, first-generation-junction union
 * is retired the same way (see `pipelinedRequirementIds`). Kept as its own
 * named export, distinct from `pipelinedRequirementIds`, so both stay one
 * call site each even though they answer identically today.
 *
 * @param {Array} epicRequirements  the junction rows
 * @returns {Set<number>}
 */
export const orchestratedRequirementIds = (epicRequirements) =>
    pipelinedRequirementIds(epicRequirements);

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
