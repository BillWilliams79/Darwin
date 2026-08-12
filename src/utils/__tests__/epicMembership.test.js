// Req #3428 — the epic filter's pure rules.
// Re-based on Pipeline 2.0 CONTAINMENT by req #3356.
//
// Every one of these is a rule a mounted test could only reach indirectly, and
// most are the "0 is a perfectly good integer" class of bug that renders as a
// plausible-looking page rather than as an error.
//
// `featureIdsForEpic` and its four cases are GONE with the tier they tested:
// req #3355 dropped `features` and `requirements.feature_fk`, so there is no
// intermediate hop between a requirement and its epic any more. What replaced
// them is the two-table containment join below — a step names its epic directly
// (`pipeline2_steps.epic_fk`, NOT NULL) and the junction seats the requirement on
// the step.

import { describe, it, expect } from 'vitest';
import {
    epicRequirementIds, filterToEpic,
    effectiveHidePipelined, firstProjectIndexWithEpicWork,
} from '../epicMembership';

// `pipeline2_steps` rows as `useAllPipeline2Steps(fields: 'id,epic_fk')` returns
// them. `epic_fk` is NOT NULL in the schema, so every real row names an epic.
const STEPS = [
    { id: 501, epic_fk: 11 },
    { id: 502, epic_fk: 11 },
    { id: 510, epic_fk: 9 },
];

// `pipeline2_step_requirements` — `PRIMARY KEY (requirement_fk)` alone, so a
// requirement appears at most once here: one step per requirement, anywhere.
const STEP_REQUIREMENTS = [
    { step_fk: 501, requirement_fk: 3428 },
    { step_fk: 501, requirement_fk: 3430 },
    { step_fk: 502, requirement_fk: 3440 },
    { step_fk: 510, requirement_fk: 3500 },   // another epic
];

// Requirement rows as the hook's own narrow projection returns them
// (`id,category_fk`) — no plan columns at all, which is the whole reason
// membership is answered by an id Set rather than off these rows. 3600 is seated
// on NO step: under containment it is in no epic.
const REQUIREMENTS = [
    { id: 3428, category_fk: 1209 },
    { id: 3430, category_fk: 1 },
    { id: 3440, category_fk: 862 },
    { id: 3500, category_fk: 1209 },
    { id: 3600, category_fk: 1209 },
];

describe('epicRequirementIds', () => {
    it('names the requirements seated on the epic\'s own steps', () => {
        expect(epicRequirementIds(STEPS, STEP_REQUIREMENTS, 11))
            .toEqual(new Set([3428, 3430, 3440]));
        expect(epicRequirementIds(STEPS, STEP_REQUIREMENTS, 9))
            .toEqual(new Set([3500]));
    });

    it('is empty for an epic no step names', () => {
        expect(epicRequirementIds(STEPS, STEP_REQUIREMENTS, 999).size).toBe(0);
    });

    it('a requirement on NO step is in no epic — the accepted containment narrowing', () => {
        // 1.0 also counted requirements FILED under an epic (`feature_fk`) that
        // no step carried. 2.0 has no such mechanism, so that population does not
        // exist; req #3357 accepted the same narrowing for the pipelined browse
        // toggle. 3600 is in REQUIREMENTS and in no junction row.
        const ids = epicRequirementIds(STEPS, STEP_REQUIREMENTS, 11);
        expect(ids.has(3600)).toBe(false);
        expect(REQUIREMENTS.some(r => r.id === 3600)).toBe(true);
    });

    it('a junction row naming NO step belongs to no epic', () => {
        // `Number(null)` is 0, so an unguarded `Set.has` would sweep in every
        // unseated junction row the moment a step with id 0 existed.
        const ids = epicRequirementIds([{ id: 0, epic_fk: 11 }],
            [{ step_fk: null, requirement_fk: 3600 }, { step_fk: '', requirement_fk: 3601 }], 11);
        expect(ids.size).toBe(0);
    });

    it('a step row with no id never SEEDS the set', () => {
        // Its own guard, reachable only through a junction row the guard above
        // lets past — so `step_fk` is present-but-unresolvable here rather than
        // missing. Unguarded, `Number(null)` seeds 0 and `Number(undefined)`
        // seeds NaN, and a Set matches NaN against itself (SameValueZero), so
        // BOTH junction rows below would land in an epic neither row names.
        const ids = epicRequirementIds(
            [{ id: null, epic_fk: 11 }, { epic_fk: 11 }],
            [{ step_fk: 0, requirement_fk: 3600 }, { step_fk: 'x', requirement_fk: 3601 }], 11);
        expect(ids.size).toBe(0);
    });

    it('a junction row naming no requirement contributes nothing', () => {
        const ids = epicRequirementIds(STEPS,
            [{ step_fk: 501, requirement_fk: null }, { step_fk: 501 },
                { step_fk: 501, requirement_fk: '' }], 11);
        expect(ids.size).toBe(0);
    });

    it('a step naming no epic is under no epic', () => {
        // `epic_fk` is NOT NULL, so this is a projection accident rather than a
        // real row — and the failure it would cause is the same 0-sweeping one.
        const ids = epicRequirementIds([{ id: 501, epic_fk: null }, { id: 502 }],
            [{ step_fk: 501, requirement_fk: 3428 }], 0);
        expect(ids.size).toBe(0);
    });

    it('matches on VALUE, so string ids off the wire still resolve', () => {
        expect(epicRequirementIds(
            [{ id: '501', epic_fk: '11' }],
            [{ step_fk: '501', requirement_fk: '3428' }], 11))
            .toEqual(new Set([3428]));
    });

    it('is empty when either plan read has not resolved, or the epic is null', () => {
        expect(epicRequirementIds(undefined, STEP_REQUIREMENTS, 11).size).toBe(0);
        expect(epicRequirementIds(STEPS, undefined, 11).size).toBe(0);
        expect(epicRequirementIds(STEPS, STEP_REQUIREMENTS, null).size).toBe(0);
        expect(epicRequirementIds(STEPS, STEP_REQUIREMENTS, undefined).size).toBe(0);
    });
});

describe('filterToEpic', () => {
    const rows = [{ id: 3428 }, { id: 3500 }, { id: 3440 }];

    it('keeps only rows in the set, matching on id alone', () => {
        // ID-ONLY IS THE POINT: three of the four consuming projections carry no
        // plan columns at all, and this is what lets them be filtered anyway.
        expect(filterToEpic(rows, new Set([3428, 3440])).map(r => r.id))
            .toEqual([3428, 3440]);
    });

    it('returns the input UNCHANGED, by reference, when no filter is active', () => {
        expect(filterToEpic(rows, null)).toBe(rows);
        expect(filterToEpic(rows, undefined)).toBe(rows);
    });

    it('an EMPTY SET is a real answer and yields no rows — not "no filter"', () => {
        // The in-flight direction, and the opposite of `excludePipelined`'s:
        // showing everything until the plan rows land renders the unfiltered page
        // under a pill claiming it is filtered.
        expect(filterToEpic(rows, new Set())).toEqual([]);
    });

    it('drops the template row, whose id is the empty string', () => {
        expect(filterToEpic([{ id: '' }, { id: 3428 }], new Set([3428])).map(r => r.id))
            .toEqual([3428]);
    });
});

describe('effectiveHidePipelined', () => {
    it('an epic filter forces the pipeline toggle off, whatever is stored', () => {
        // The store DEFAULTS to true (req #3242), and under containment an epic's
        // requirements are step-seated BY DEFINITION (req #3356) — so without this
        // the epic page arrives empty, always.
        expect(effectiveHidePipelined(true, true)).toBe(false);
        expect(effectiveHidePipelined(false, true)).toBe(false);
    });

    it('leaves the stored value alone with no filter active', () => {
        expect(effectiveHidePipelined(true, false)).toBe(true);
        expect(effectiveHidePipelined(false, false)).toBe(false);
    });
});

describe('firstProjectIndexWithEpicWork', () => {
    const PROJECTS = [{ id: 7 }, { id: 1 }, { id: 859 }];
    const CATEGORIES = [
        { id: 1, project_fk: 1 },
        { id: 862, project_fk: 1 },
        { id: 1209, project_fk: 1 },
        { id: 99, project_fk: 7 },
    ];
    const epicIds = new Set([3428, 3430, 3440]);

    it('takes the id Set as given and asks nothing about how it was derived', () => {
        // Era-independent: `category_fk` is a requirement's own column in both
        // eras, so req #3356 moved nothing here.
        expect(firstProjectIndexWithEpicWork(PROJECTS, CATEGORIES, REQUIREMENTS, epicIds)).toBe(1);
    });

    it('prefers the earlier tab when two projects both hold work', () => {
        const reqs = [...REQUIREMENTS, { id: 3428, category_fk: 99 }];
        expect(firstProjectIndexWithEpicWork(PROJECTS, CATEGORIES, reqs, epicIds)).toBe(0);
    });

    it('is null when nothing matches — leave the reader on the tab they chose', () => {
        expect(firstProjectIndexWithEpicWork(PROJECTS, CATEGORIES, REQUIREMENTS, new Set())).toBeNull();
        expect(firstProjectIndexWithEpicWork(PROJECTS, CATEGORIES, REQUIREMENTS, null)).toBeNull();
    });

    it('is null while any input is still unresolved', () => {
        expect(firstProjectIndexWithEpicWork(undefined, CATEGORIES, REQUIREMENTS, epicIds)).toBeNull();
        expect(firstProjectIndexWithEpicWork(PROJECTS, undefined, REQUIREMENTS, epicIds)).toBeNull();
        expect(firstProjectIndexWithEpicWork(PROJECTS, CATEGORIES, undefined, epicIds)).toBeNull();
        expect(firstProjectIndexWithEpicWork([], CATEGORIES, REQUIREMENTS, epicIds)).toBeNull();
    });

    it('ignores work in a category this page does not render', () => {
        // The categories read is `closed: 0`, so a closed category resolves to no
        // project here. Selecting its project would move the reader to a tab that
        // shows nothing — the exact outcome the seed exists to prevent.
        const closedOnly = [{ id: 3428, category_fk: 4242 }];
        expect(firstProjectIndexWithEpicWork(PROJECTS, CATEGORIES, closedOnly, epicIds)).toBeNull();
    });
});

// The whole pipeline, end to end, on one fixture — the two plan reads producing
// the Set, the Set filtering a surface's rows, and the Set choosing a tab. Each
// function above is pinned alone; this is the only place their COMPOSITION is,
// and composition is where a signature change like req #3356's does its damage.
describe('the containment chain, composed', () => {
    it('derives, filters and lands from one pair of plan reads', () => {
        const ids = epicRequirementIds(STEPS, STEP_REQUIREMENTS, 11);
        expect(filterToEpic(REQUIREMENTS, ids).map(r => r.id)).toEqual([3428, 3430, 3440]);
        expect(firstProjectIndexWithEpicWork(
            [{ id: 7 }, { id: 1 }], [{ id: 1209, project_fk: 1 }], REQUIREMENTS, ids)).toBe(1);
    });
});
