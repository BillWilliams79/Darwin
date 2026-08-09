// Req #3428 — the epic filter's pure rules.
//
// Every one of these is a rule a mounted test could only reach indirectly, and
// most are the "0 is a perfectly good integer" class of bug that renders as a
// plausible-looking page rather than as an error.

import { describe, it, expect } from 'vitest';
import {
    featureIdsForEpic, epicRequirementIds, filterToEpic,
    effectiveHidePipelined, firstProjectIndexWithEpicWork,
} from '../epicMembership';

const FEATURES = [
    { id: 46, epic_fk: 11 },
    { id: 47, epic_fk: 11 },
    { id: 50, epic_fk: 9 },
    { id: 51, epic_fk: null },
];

const REQUIREMENTS = [
    { id: 3428, feature_fk: 46, category_fk: 1209 },
    { id: 3430, feature_fk: 46, category_fk: 1 },
    { id: 3440, feature_fk: 47, category_fk: 862 },
    { id: 3500, feature_fk: 50, category_fk: 1209 },   // another epic
    { id: 3600, feature_fk: null, category_fk: 1209 }, // unfiled
];

describe('featureIdsForEpic', () => {
    it('collects only the features under the named epic', () => {
        expect(featureIdsForEpic(FEATURES, 11)).toEqual(new Set([46, 47]));
        expect(featureIdsForEpic(FEATURES, 9)).toEqual(new Set([50]));
    });

    it('is empty for a null epic, a missing epic, and a missing features read', () => {
        expect(featureIdsForEpic(FEATURES, null).size).toBe(0);
        expect(featureIdsForEpic(FEATURES, undefined).size).toBe(0);
        expect(featureIdsForEpic(FEATURES, 999).size).toBe(0);
        expect(featureIdsForEpic(undefined, 11).size).toBe(0);
    });

    it('never seeds the set from a feature row with no id', () => {
        // Left unguarded this puts `NaN`/0 in the set, and the membership test
        // below then answers true for requirements with no feature at all.
        const ids = featureIdsForEpic([{ id: null, epic_fk: 11 }, { epic_fk: 11 }], 11);
        expect(ids.size).toBe(0);
    });
});

describe('epicRequirementIds', () => {
    it('names the requirements reachable through the epic\'s features', () => {
        expect(epicRequirementIds(FEATURES, REQUIREMENTS, 11))
            .toEqual(new Set([3428, 3430, 3440]));
    });

    it('a requirement with no feature belongs to NO epic', () => {
        // `Number(null)` is 0, so an unguarded `Set.has` would sweep in every
        // unfiled requirement the moment a feature with id 0 existed.
        const ids = epicRequirementIds([{ id: 0, epic_fk: 11 }],
            [{ id: 3600, feature_fk: null }, { id: 3601, feature_fk: '' }], 11);
        expect(ids.size).toBe(0);
    });

    it('is empty when either read has not resolved, or the epic is null', () => {
        expect(epicRequirementIds(undefined, REQUIREMENTS, 11).size).toBe(0);
        expect(epicRequirementIds(FEATURES, undefined, 11).size).toBe(0);
        expect(epicRequirementIds(FEATURES, REQUIREMENTS, null).size).toBe(0);
    });
});

describe('filterToEpic', () => {
    const rows = [{ id: 3428 }, { id: 3500 }, { id: 3440 }];

    it('keeps only rows in the set, matching on id alone', () => {
        // ID-ONLY IS THE POINT: three of the four consuming projections carry no
        // `feature_fk`, and this is what lets them be filtered anyway.
        expect(filterToEpic(rows, new Set([3428, 3440])).map(r => r.id))
            .toEqual([3428, 3440]);
    });

    it('returns the input UNCHANGED, by reference, when no filter is active', () => {
        expect(filterToEpic(rows, null)).toBe(rows);
        expect(filterToEpic(rows, undefined)).toBe(rows);
    });

    it('an EMPTY SET is a real answer and yields no rows — not "no filter"', () => {
        // The in-flight direction, and the opposite of `excludePipelined`'s:
        // showing everything until the features land renders the unfiltered page
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
        // The store DEFAULTS to true (req #3242), and an epic's requirements are
        // seated in pipeline steps by construction — so without this the epic
        // page arrives empty.
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

    it('returns the first project IN TAB ORDER that holds any of the work', () => {
        expect(firstProjectIndexWithEpicWork(PROJECTS, CATEGORIES, REQUIREMENTS, epicIds)).toBe(1);
    });

    it('prefers the earlier tab when two projects both hold work', () => {
        const reqs = [...REQUIREMENTS, { id: 3428, feature_fk: 46, category_fk: 99 }];
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
        const closedOnly = [{ id: 3428, feature_fk: 46, category_fk: 4242 }];
        expect(firstProjectIndexWithEpicWork(PROJECTS, CATEGORIES, closedOnly, epicIds)).toBeNull();
    });
});
