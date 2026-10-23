// Initiative membership — req #3428, re-based on Pipeline 2.0 CONTAINMENT by req #3356.
//
// THE browser's one answer to "is this requirement part of this initiative", plus the
// three page-level questions that fall out of it. Every surface the initiative filter
// touches (the Cards view's rows, the SwarmStart aggregator's rows AND its chip
// badges, which categories render, which project tab opens) reads them from
// here, for the reason `pipelineMembership.js` gives about the question IT
// answers: a second implementation is how two surfaces that must agree start
// disagreeing, and the failure is silent — a chip badge reading 6 over 4 rows
// looks like a rendering glitch, not a filter bug.
//
// WHICH QUESTION THIS ANSWERS: INITIATIVE association, derived through Pipeline 2.0's
// CONTAINMENT chain — `epics.initiative_fk` (NOT NULL: an epic's initiative is
// DIRECT, there is no intermediate tier to walk) and the
// `epic_requirements` junction (`PRIMARY KEY (requirement_fk)` alone,
// so a requirement sits on at most one epic anywhere). That is the "does this
// belong to a body of work" question `pipelineMembership.js`' own header
// explicitly says it is NOT answering (it answers EPIC association — "is this
// scheduled"). The two populations differ, both are legitimate, and they are
// deliberately two modules so no caller reaches the wrong one by autocomplete.
//
// WHAT REPLACED WHAT, AND WHY IT HAD TO. Until req #3356 the chain went
// through the requirement's own reference to the retired middle tier, and
// this module's now-deleted per-initiative id-lookup helper walked it. Req #3355
// DROPPED both halves of it from
// production — the tier's table and the requirement's reference to it — so
// that walk had no data left to walk and the read behind it named a column
// the gateway no longer has. This is not a redesign of a working filter;
// it is the same question re-derived from the only structure that still answers
// it.
//
// DERIVED, NEVER STORED. There is no `requirements.initiative_fk` column and this must
// not become one: the chain is two mutable links (an epic may be moved between
// initiatives, a requirement re-seated onto another epic), so a stored copy is wrong
// the moment either moves. Same rule the plan layer states as design rule 1.
//
// THE ID SPACE MOVED WITH THE CHAIN, and a reader chasing a stale link needs to
// know it: `initiativeId` here is a `initiatives.id`, NOT the 1.0 `initiatives.id` this
// module took before #3356. The two tables are independent auto-increments, so
// the same integer names different initiatives in each. Nothing writes a stale link
// today — the 1.0 plan visualizer's initiative chip derives its id through the very
// chain #3355 dropped, so `PlanRow.initiativeId` is permanently null and
// its `?initiative=` control does not render at all (`pipelineModel.js`
// `dominantLabels`). The `?initiative=` reader is therefore ahead of its writer, on
// purpose: the 2.0 surface that revives the link is the one whose ids these are.
//
// No React, no MUI: a pure module vitest exercises with no DOM.

/**
 * The epic ids that sit under one initiative.
 *
 * Module-local rather than exported, and that is the shape change #3356 makes:
 * 1.0's middle tier was a PUBLIC fact (a feature is a thing a page could show),
 * while this is one half of a two-table join nobody outside this file asks for.
 * Its guards are covered through `initiativeRequirementIds`, which is the only caller
 * there will be.
 *
 * @param {?Array<{id: number, initiative_fk: number}>} epics rows from `useAllPipelineEpics`
 * @param {?number} initiativeId
 * @returns {Set<number>} empty when `initiativeId` is null or nothing matches
 */
const epicIdsForInitiative = (epics, initiativeId) => {
    const ids = new Set();
    if (initiativeId === null || initiativeId === undefined) return ids;
    if (!Array.isArray(epics)) return ids;
    const target = Number(initiativeId);
    for (const s of epics) {
        if (!s || s.initiative_fk === null || s.initiative_fk === undefined || s.initiative_fk === '') continue;
        if (Number(s.initiative_fk) !== target) continue;
        // An epic row with no id cannot name an epic. Seeding the set with
        // null/undefined would make the `epic_fk` test below answer true for
        // every junction row whose own `epic_fk` is unset.
        if (s.id === null || s.id === undefined || s.id === '') continue;
        ids.add(Number(s.id));
    }
    return ids;
};

/**
 * The REQUIREMENT ids that belong to one initiative.
 *
 * The shape every consumer wants, and the reason this module exists rather than
 * a predicate each surface applies to its own rows: three of the four consumers
 * (`useRequirementsByStatus`, `useRequirementsDone`, the counts projection) read
 * requirements through queries that carry NO plan columns at all, and widening
 * three shared projections to teach them about initiatives would put columns on the
 * wire for every reader of those caches forever. An id Set answers all four from
 * TWO narrow whole-table reads instead — `usePipelinedRequirementIds`' design,
 * for the same reason it was chosen there.
 *
 * CONTAINMENT IS THE WHOLE POPULATION NOW, AND THAT IS A DELIBERATE NARROWING.
 * 1.0's initiative membership also included requirements FILED UNDER an initiative that no
 * epic carried — the requirement's own reference to the retired middle tier
 * could place it in an initiative without scheduling it. 2.0 has no such mechanism
 * and no such population: a requirement
 * is in an initiative ONLY by being seated on one of that initiative's epics. This is the
 * SAME narrowing req #3357 already accepted for the separate "pipelined" browse
 * toggle (see `pipelineMembership.js`' header), accepted here for consistency
 * rather than re-argued. The requirements it drops are the ones the plan does
 * not sequence, so an initiative page under this rule shows exactly the work that initiative
 * is going to run.
 *
 * A requirement whose junction row names no epic is in NO initiative, and an epic row
 * with no id names no epic. Both guarded explicitly rather than left to
 * `Set.has(Number(null))`, because `Number(null)` is 0 and an epic with id 0 would
 * then sweep in every unseated requirement there is.
 *
 * @param {?Array<{id: number, initiative_fk: number}>} epics rows from `useAllPipelineEpics`
 * @param {?Array<{epic_fk: number, requirement_fk: number}>} epicRequirements rows
 *        from `useAllPipelineEpicRequirements` (the junction, whole-table read)
 * @param {?number} initiativeId
 * @returns {Set<number>}
 */
export const initiativeRequirementIds = (epics, epicRequirements, initiativeId) => {
    const out = new Set();
    const epicIds = epicIdsForInitiative(epics, initiativeId);
    if (epicIds.size === 0) return out;
    if (!Array.isArray(epicRequirements)) return out;
    for (const link of epicRequirements) {
        if (!link) continue;
        const rid = link.requirement_fk;
        if (rid === null || rid === undefined || rid === '') continue;
        const sid = link.epic_fk;
        if (sid === null || sid === undefined || sid === '') continue;
        if (!epicIds.has(Number(sid))) continue;
        out.add(Number(rid));
    }
    return out;
};

/**
 * Keep only the initiative's requirements.
 *
 * `initiativeReqIds == null` means NO FILTER IS ACTIVE and returns the input UNCHANGED
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
 * @param {?Set<number>} initiativeReqIds
 */
export const filterToInitiative = (rows, initiativeReqIds) => {
    if (!initiativeReqIds) return rows;
    if (!Array.isArray(rows)) return rows;
    return rows.filter(r => r && initiativeReqIds.has(Number(r.id)));
};

/**
 * The index of the first project (in tab order) holding any of the initiative's work.
 *
 * WHY THE PAGE NEEDS THIS AT ALL: an initiative's requirements sit in categories, and
 * categories sit in projects, so an initiative link lands the reader on whichever
 * project they last worked in — routinely one with none of that initiative in it. The
 * feature would then be invisible on arrival, which is the one outcome worth
 * designing out.
 *
 * ERA-INDEPENDENT, and unchanged by req #3356: it takes the id Set as an
 * argument and never asks how it was derived. Its `requirements` argument is the
 * narrow `id,category_fk` read `useInitiativeRequirementIds` keeps alongside the two
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
 * @param {?Set<number>} initiativeReqIds
 * @returns {?number}
 */
export const firstProjectIndexWithInitiativeWork = (projects, categories, requirements, initiativeReqIds) => {
    if (!Array.isArray(projects) || projects.length === 0) return null;
    if (!Array.isArray(categories) || !Array.isArray(requirements)) return null;
    if (!initiativeReqIds || initiativeReqIds.size === 0) return null;

    const projectByCategory = new Map();
    for (const c of categories) {
        if (!c || c.id === null || c.id === undefined) continue;
        projectByCategory.set(Number(c.id), c.project_fk === null || c.project_fk === undefined
            ? null : Number(c.project_fk));
    }

    const projectsWithWork = new Set();
    for (const r of requirements) {
        if (!r || !initiativeReqIds.has(Number(r.id))) continue;
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
