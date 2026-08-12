// Epic membership — req #3428, re-based on Pipeline 2.0 CONTAINMENT by req #3356.
//
// THE browser's one answer to "is this requirement part of this epic", plus the
// three page-level questions that fall out of it. Every surface the epic filter
// touches (the Cards view's rows, the SwarmStart aggregator's rows AND its chip
// badges, which categories render, which project tab opens) reads them from
// here, for the reason `pipelineMembership.js` gives about the question IT
// answers: a second implementation is how two surfaces that must agree start
// disagreeing, and the failure is silent — a chip badge reading 6 over 4 rows
// looks like a rendering glitch, not a filter bug.
//
// WHICH QUESTION THIS ANSWERS: EPIC association, derived through Pipeline 2.0's
// CONTAINMENT chain — `pipeline2_steps.epic_fk` (NOT NULL: a step's epic is
// DIRECT, there is no intermediate tier to walk) and the
// `pipeline2_step_requirements` junction (`PRIMARY KEY (requirement_fk)` alone,
// so a requirement sits on at most one step anywhere). That is the "does this
// belong to a body of work" question `pipelineMembership.js`' own header
// explicitly says it is NOT answering (it answers STEP association — "is this
// scheduled"). The two populations differ, both are legitimate, and they are
// deliberately two modules so no caller reaches the wrong one by autocomplete.
//
// WHAT REPLACED WHAT, AND WHY IT HAD TO. Until req #3356 the chain was
// `requirement.feature_fk -> feature.epic_fk`, and `featureIdsForEpic` walked
// the middle tier. Req #3355 DROPPED both halves of it from production — the
// `features` table and the `requirements.feature_fk` column — so that walk had
// no data left to walk and the read behind it (`fields=id,feature_fk,…`) named a
// column the gateway no longer has. This is not a redesign of a working filter;
// it is the same question re-derived from the only structure that still answers
// it.
//
// DERIVED, NEVER STORED. There is no `requirements.epic_fk` column and this must
// not become one: the chain is two mutable links (a step may be moved between
// epics, a requirement re-seated onto another step), so a stored copy is wrong
// the moment either moves. Same rule the plan layer states as design rule 1.
//
// THE ID SPACE MOVED WITH THE CHAIN, and a reader chasing a stale link needs to
// know it: `epicId` here is a `pipeline2_epics.id`, NOT the 1.0 `epics.id` this
// module took before #3356. The two tables are independent auto-increments, so
// the same integer names different epics in each. Nothing writes a stale link
// today — the 1.0 plan visualizer's epic chip derives its id through the very
// `feature_fk` chain #3355 dropped, so `PlanRow.epicId` is permanently null and
// its `?epic=` control does not render at all (`pipelineModel.js`
// `dominantLabels`). The `?epic=` reader is therefore ahead of its writer, on
// purpose: the 2.0 surface that revives the link is the one whose ids these are.
//
// No React, no MUI: a pure module vitest exercises with no DOM.

/**
 * The step ids that sit under one epic.
 *
 * Module-local rather than exported, and that is the shape change #3356 makes:
 * 1.0's middle tier was a PUBLIC fact (a feature is a thing a page could show),
 * while this is one half of a two-table join nobody outside this file asks for.
 * Its guards are covered through `epicRequirementIds`, which is the only caller
 * there will be.
 *
 * @param {?Array<{id: number, epic_fk: number}>} steps rows from `useAllPipeline2Steps`
 * @param {?number} epicId
 * @returns {Set<number>} empty when `epicId` is null or nothing matches
 */
const stepIdsForEpic = (steps, epicId) => {
    const ids = new Set();
    if (epicId === null || epicId === undefined) return ids;
    if (!Array.isArray(steps)) return ids;
    const target = Number(epicId);
    for (const s of steps) {
        if (!s || s.epic_fk === null || s.epic_fk === undefined || s.epic_fk === '') continue;
        if (Number(s.epic_fk) !== target) continue;
        // A step row with no id cannot name a step. Seeding the set with
        // null/undefined would make the `step_fk` test below answer true for
        // every junction row whose own `step_fk` is unset.
        if (s.id === null || s.id === undefined || s.id === '') continue;
        ids.add(Number(s.id));
    }
    return ids;
};

/**
 * The REQUIREMENT ids that belong to one epic.
 *
 * The shape every consumer wants, and the reason this module exists rather than
 * a predicate each surface applies to its own rows: three of the four consumers
 * (`useRequirementsByStatus`, `useRequirementsDone`, the counts projection) read
 * requirements through queries that carry NO plan columns at all, and widening
 * three shared projections to teach them about epics would put columns on the
 * wire for every reader of those caches forever. An id Set answers all four from
 * TWO narrow whole-table reads instead — `usePipelinedRequirementIds`' design,
 * for the same reason it was chosen there.
 *
 * CONTAINMENT IS THE WHOLE POPULATION NOW, AND THAT IS A DELIBERATE NARROWING.
 * 1.0's epic membership also included requirements FILED UNDER an epic that no
 * step carried — `feature_fk` could place a requirement in an epic without
 * scheduling it. 2.0 has no such mechanism and no such population: a requirement
 * is in an epic ONLY by being seated on one of that epic's steps. This is the
 * SAME narrowing req #3357 already accepted for the separate "pipelined" browse
 * toggle (see `pipelineMembership.js`' header), accepted here for consistency
 * rather than re-argued. The requirements it drops are the ones the plan does
 * not sequence, so an epic page under this rule shows exactly the work that epic
 * is going to run.
 *
 * A requirement whose junction row names no step is in NO epic, and a step row
 * with no id names no step. Both guarded explicitly rather than left to
 * `Set.has(Number(null))`, because `Number(null)` is 0 and a step with id 0 would
 * then sweep in every unseated requirement there is.
 *
 * @param {?Array<{id: number, epic_fk: number}>} steps rows from `useAllPipeline2Steps`
 * @param {?Array<{step_fk: number, requirement_fk: number}>} stepRequirements rows
 *        from `useAllPipeline2StepRequirements` (the junction, whole-table read)
 * @param {?number} epicId
 * @returns {Set<number>}
 */
export const epicRequirementIds = (steps, stepRequirements, epicId) => {
    const out = new Set();
    const stepIds = stepIdsForEpic(steps, epicId);
    if (stepIds.size === 0) return out;
    if (!Array.isArray(stepRequirements)) return out;
    for (const link of stepRequirements) {
        if (!link) continue;
        const rid = link.requirement_fk;
        if (rid === null || rid === undefined || rid === '') continue;
        const sid = link.step_fk;
        if (sid === null || sid === undefined || sid === '') continue;
        if (!stepIds.has(Number(sid))) continue;
        out.add(Number(rid));
    }
    return out;
};

/**
 * Keep only the epic's requirements.
 *
 * `epicReqIds == null` means NO FILTER IS ACTIVE and returns the input UNCHANGED
 * (same reference), so an ordinary page pays nothing and cannot trip a
 * referential-equality dependency — `excludePipelined`'s contract, same reason.
 *
 * AN EMPTY SET IS A REAL ANSWER, NOT "no filter". While the reads behind it
 * are in flight the set is empty and this returns an EMPTY LIST — the opposite
 * of `excludePipelined`'s in-flight direction, deliberately. That one DROPS rows,
 * so "unknown" must mean "keep" or a failed fetch would hide eligible work. This
 * one SELECTS rows, so "unknown" must mean "none yet": the alternative — show
 * everything until the plan rows land — renders the whole unfiltered page for a
 * beat underneath a pill claiming it is filtered, which is the page lying about
 * what it is showing.
 *
 * @param {?Array<{id: number}>} rows
 * @param {?Set<number>} epicReqIds
 */
export const filterToEpic = (rows, epicReqIds) => {
    if (!epicReqIds) return rows;
    if (!Array.isArray(rows)) return rows;
    return rows.filter(r => r && epicReqIds.has(Number(r.id)));
};

/**
 * Whether the pipeline-membership filter is applying right now.
 *
 * ONE predicate with two consumers — the header control's visibility in
 * `SwarmView` and the row predicate in `CategoryCard` — because those two
 * disagreeing is a toggle that is on screen and not applying, or applying and
 * not on screen. Both are the defect req #3242's own comment describes.
 *
 * An epic filter FORCES IT OFF. `hidePipelinedRequirements` defaults to `true`
 * (req #3242, and the v8→v9 migration makes that true for existing browsers as
 * well), while an epic's requirements are seated in pipeline steps by
 * construction — under #3356's containment rule that is no longer merely usual,
 * it is the DEFINITION of membership, so leaving the stored value in charge
 * would deliver an epic page with nothing on it, always. The store is never
 * WRITTEN here: an external condition does not overwrite uncommitted user intent
 * (`normalizeView`'s doctrine), so dismissing the pill restores exactly what the
 * reader had.
 *
 * @param {boolean} storedValue `useShowClosedStore.hidePipelinedRequirements`
 * @param {boolean} epicFilterActive
 * @returns {boolean}
 */
export const effectiveHidePipelined = (storedValue, epicFilterActive) =>
    epicFilterActive ? false : !!storedValue;

/**
 * The index of the first project (in tab order) holding any of the epic's work.
 *
 * WHY THE PAGE NEEDS THIS AT ALL: an epic's requirements sit in categories, and
 * categories sit in projects, so an epic link lands the reader on whichever
 * project they last worked in — routinely one with none of that epic in it. The
 * feature would then be invisible on arrival, which is the one outcome worth
 * designing out.
 *
 * ERA-INDEPENDENT, and unchanged by req #3356: it takes the id Set as an
 * argument and never asks how it was derived. Its `requirements` argument is the
 * narrow `id,category_fk` read `useEpicRequirementIds` keeps alongside the two
 * plan reads — `category_fk` is a requirement's own column in both eras, so
 * nothing here moved.
 *
 * Returns null when nothing matches (leave the reader where they are — moving
 * them to an arbitrary tab would be worse than the tab they chose) and when any
 * input has not resolved yet.
 *
 * @param {?Array<{id: number}>} projects in tab order
 * @param {?Array<{id: number, project_fk: ?number}>} categories
 * @param {?Array<{id: number, category_fk: ?number}>} requirements
 * @param {?Set<number>} epicReqIds
 * @returns {?number}
 */
export const firstProjectIndexWithEpicWork = (projects, categories, requirements, epicReqIds) => {
    if (!Array.isArray(projects) || projects.length === 0) return null;
    if (!Array.isArray(categories) || !Array.isArray(requirements)) return null;
    if (!epicReqIds || epicReqIds.size === 0) return null;

    const projectByCategory = new Map();
    for (const c of categories) {
        if (!c || c.id === null || c.id === undefined) continue;
        projectByCategory.set(Number(c.id), c.project_fk === null || c.project_fk === undefined
            ? null : Number(c.project_fk));
    }

    const projectsWithWork = new Set();
    for (const r of requirements) {
        if (!r || !epicReqIds.has(Number(r.id))) continue;
        if (r.category_fk === null || r.category_fk === undefined) continue;
        const projectId = projectByCategory.get(Number(r.category_fk));
        // A requirement in a CLOSED category resolves to no project here, because
        // the categories read this page makes is `closed: 0`. Skipping it is
        // correct: that category renders on no tab, so selecting its project
        // would move the reader to a tab that shows nothing.
        if (projectId === null || projectId === undefined) continue;
        projectsWithWork.add(projectId);
    }
    if (projectsWithWork.size === 0) return null;

    const index = projects.findIndex(p => p && projectsWithWork.has(Number(p.id)));
    return index >= 0 ? index : null;
};
