// Epic membership — req #3428.
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
// WHICH QUESTION THIS ANSWERS: EPIC association, derived through
// `requirement.feature_fk -> feature.epic_fk`. That is the "does this belong to
// a body of work" question `pipelineMembership.js`' own header explicitly says
// it is NOT answering (it answers STEP association — "is this scheduled"). The
// two populations differ, both are legitimate, and they are deliberately two
// modules so no caller reaches the wrong one by autocomplete.
//
// DERIVED, NEVER STORED. There is no `requirements.epic_fk` column and this must
// not become one: the chain is two mutable links, so a stored copy is wrong the
// moment a requirement is re-featured or a feature re-parented. Same rule the
// plan layer states as design rule 1.
//
// No React, no MUI: a pure module vitest exercises with no DOM.

/**
 * The feature ids that sit under one epic.
 *
 * @param {?Array<{id: number, epic_fk: ?number}>} features rows from `useAllFeatures`
 * @param {?number} epicId
 * @returns {Set<number>} empty when `epicId` is null or nothing matches
 */
export const featureIdsForEpic = (features, epicId) => {
    const ids = new Set();
    if (epicId === null || epicId === undefined) return ids;
    if (!Array.isArray(features)) return ids;
    const target = Number(epicId);
    for (const f of features) {
        if (!f || f.epic_fk === null || f.epic_fk === undefined) continue;
        if (Number(f.epic_fk) !== target) continue;
        // A feature row with no id cannot name a feature. Seeding the set with
        // null/undefined would make the `feature_fk` test below answer true for
        // every requirement whose own `feature_fk` is unset — i.e. most of them.
        if (f.id === null || f.id === undefined) continue;
        ids.add(Number(f.id));
    }
    return ids;
};

/**
 * The REQUIREMENT ids that belong to one epic.
 *
 * The shape every consumer wants, and the reason this module exists rather than
 * a predicate each surface applies to its own rows: three of the four consumers
 * (`useRequirementsByStatus`, `useRequirementsDone`, the counts projection) read
 * requirements through queries that do NOT carry `feature_fk`, and widening
 * three shared projections to teach them about epics would put a column on the
 * wire for every reader of those caches forever. An id Set answers all four from
 * ONE narrow read instead — `usePipelinedRequirementIds`' design, for the same
 * reason it was chosen there.
 *
 * A requirement with no `feature_fk` is in NO epic. Guarded explicitly rather
 * than left to `Set.has(Number(null))`, because `Number(null)` is 0 and a
 * feature with id 0 would then sweep in every unfiled requirement there is.
 *
 * @param {?Array<{id: number, epic_fk: ?number}>} features
 * @param {?Array<{id: number, feature_fk: ?number}>} requirements
 * @param {?number} epicId
 * @returns {Set<number>}
 */
export const epicRequirementIds = (features, requirements, epicId) => {
    const out = new Set();
    const featureIds = featureIdsForEpic(features, epicId);
    if (featureIds.size === 0) return out;
    if (!Array.isArray(requirements)) return out;
    for (const r of requirements) {
        if (!r || r.id === null || r.id === undefined || r.id === '') continue;
        const fk = r.feature_fk;
        if (fk === null || fk === undefined || fk === '') continue;
        if (!featureIds.has(Number(fk))) continue;
        out.add(Number(r.id));
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
 * AN EMPTY SET IS A REAL ANSWER, NOT "no filter". While the two reads behind it
 * are in flight the set is empty and this returns an EMPTY LIST — the opposite
 * of `excludePipelined`'s in-flight direction, deliberately. That one DROPS rows,
 * so "unknown" must mean "keep" or a failed fetch would hide eligible work. This
 * one SELECTS rows, so "unknown" must mean "none yet": the alternative — show
 * everything until the features land — renders the whole unfiltered page for a
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
 * construction — so leaving the stored value in charge would deliver an epic
 * page with nothing on it. The store is never WRITTEN here: an external
 * condition does not overwrite uncommitted user intent (`normalizeView`'s
 * doctrine), so dismissing the pill restores exactly what the reader had.
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
