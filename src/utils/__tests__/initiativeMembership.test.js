// Req #3428 — the initiative filter's pure rules.
// Re-based on Pipeline 2.0 CONTAINMENT by req #3356.
//
// Every one of these is a rule a mounted test could only reach indirectly, and
// most are the "0 is a perfectly good integer" class of bug that renders as a
// plausible-looking page rather than as an error.
//
// The old per-initiative id-lookup helper and its four test cases are GONE with the
// tier they tested: req #3355 dropped the tier's table and the requirement's
// reference to it, so there is no intermediate hop between a requirement and
// its initiative any more. What replaced
// them is the two-table containment join below — an epic names its initiative directly
// (`epics.initiative_fk`, NOT NULL) and the junction seats the requirement on
// the epic.

import { describe, it, expect } from 'vitest';
import {
    initiativeRequirementIds, filterToInitiative,
    firstProjectIndexWithInitiativeWork,
} from '../initiativeMembership';

// `epics` rows as `useAllPipelineEpics(fields: 'id,initiative_fk')` returns
// them. `initiative_fk` is NOT NULL in the schema, so every real row names an initiative.
const EPICS = [
    { id: 501, initiative_fk: 11 },
    { id: 502, initiative_fk: 11 },
    { id: 510, initiative_fk: 9 },
];

// `epic_requirements` — `PRIMARY KEY (requirement_fk)` alone, so a
// requirement appears at most once here: one epic per requirement, anywhere.
const EPIC_REQUIREMENTS = [
    { epic_fk: 501, requirement_fk: 3428 },
    { epic_fk: 501, requirement_fk: 3430 },
    { epic_fk: 502, requirement_fk: 3440 },
    { epic_fk: 510, requirement_fk: 3500 },   // another initiative
];

// Requirement rows as the hook's own narrow projection returns them
// (`id,category_fk`) — no plan columns at all, which is the whole reason
// membership is answered by an id Set rather than off these rows. 3600 is seated
// on NO epic: under containment it is in no initiative.
const REQUIREMENTS = [
    { id: 3428, category_fk: 1209 },
    { id: 3430, category_fk: 1 },
    { id: 3440, category_fk: 862 },
    { id: 3500, category_fk: 1209 },
    { id: 3600, category_fk: 1209 },
];

describe('initiativeRequirementIds', () => {
    it('names the requirements seated on the initiative\'s own epics', () => {
        expect(initiativeRequirementIds(EPICS, EPIC_REQUIREMENTS, 11))
            .toEqual(new Set([3428, 3430, 3440]));
        expect(initiativeRequirementIds(EPICS, EPIC_REQUIREMENTS, 9))
            .toEqual(new Set([3500]));
    });

    it('is empty for an initiative no epic names', () => {
        expect(initiativeRequirementIds(EPICS, EPIC_REQUIREMENTS, 999).size).toBe(0);
    });

    it('a requirement on NO epic is in no initiative — the accepted containment narrowing', () => {
        // 1.0 also counted requirements FILED under an initiative (via the retired
        // middle tier) that no epic carried. 2.0 has no such mechanism, so that population does not
        // exist; req #3357 accepted the same narrowing for the pipelined browse
        // toggle. 3600 is in REQUIREMENTS and in no junction row.
        const ids = initiativeRequirementIds(EPICS, EPIC_REQUIREMENTS, 11);
        expect(ids.has(3600)).toBe(false);
        expect(REQUIREMENTS.some(r => r.id === 3600)).toBe(true);
    });

    it('a junction row naming NO epic belongs to no initiative', () => {
        // `Number(null)` is 0, so an unguarded `Set.has` would sweep in every
        // unseated junction row the moment an epic with id 0 existed.
        const ids = initiativeRequirementIds([{ id: 0, initiative_fk: 11 }],
            [{ epic_fk: null, requirement_fk: 3600 }, { epic_fk: '', requirement_fk: 3601 }], 11);
        expect(ids.size).toBe(0);
    });

    it('an epic row with no id never SEEDS the set', () => {
        // Its own guard, reachable only through a junction row the guard above
        // lets past — so `epic_fk` is present-but-unresolvable here rather than
        // missing. Unguarded, `Number(null)` seeds 0 and `Number(undefined)`
        // seeds NaN, and a Set matches NaN against itself (SameValueZero), so
        // BOTH junction rows below would land in an initiative neither row names.
        const ids = initiativeRequirementIds(
            [{ id: null, initiative_fk: 11 }, { initiative_fk: 11 }],
            [{ epic_fk: 0, requirement_fk: 3600 }, { epic_fk: 'x', requirement_fk: 3601 }], 11);
        expect(ids.size).toBe(0);
    });

    it('a junction row naming no requirement contributes nothing', () => {
        const ids = initiativeRequirementIds(EPICS,
            [{ epic_fk: 501, requirement_fk: null }, { epic_fk: 501 },
                { epic_fk: 501, requirement_fk: '' }], 11);
        expect(ids.size).toBe(0);
    });

    it('an epic naming no initiative is under no initiative', () => {
        // `initiative_fk` is NOT NULL, so this is a projection accident rather than a
        // real row — and the failure it would cause is the same 0-sweeping one.
        const ids = initiativeRequirementIds([{ id: 501, initiative_fk: null }, { id: 502 }],
            [{ epic_fk: 501, requirement_fk: 3428 }], 0);
        expect(ids.size).toBe(0);
    });

    it('matches on VALUE, so string ids off the wire still resolve', () => {
        expect(initiativeRequirementIds(
            [{ id: '501', initiative_fk: '11' }],
            [{ epic_fk: '501', requirement_fk: '3428' }], 11))
            .toEqual(new Set([3428]));
    });

    it('is empty when either plan read has not resolved, or the initiative is null', () => {
        expect(initiativeRequirementIds(undefined, EPIC_REQUIREMENTS, 11).size).toBe(0);
        expect(initiativeRequirementIds(EPICS, undefined, 11).size).toBe(0);
        expect(initiativeRequirementIds(EPICS, EPIC_REQUIREMENTS, null).size).toBe(0);
        expect(initiativeRequirementIds(EPICS, EPIC_REQUIREMENTS, undefined).size).toBe(0);
    });
});

describe('filterToInitiative', () => {
    const rows = [{ id: 3428 }, { id: 3500 }, { id: 3440 }];

    it('keeps only rows in the set, matching on id alone', () => {
        // ID-ONLY IS THE POINT: three of the four consuming projections carry no
        // plan columns at all, and this is what lets them be filtered anyway.
        expect(filterToInitiative(rows, new Set([3428, 3440])).map(r => r.id))
            .toEqual([3428, 3440]);
    });

    it('returns the input UNCHANGED, by reference, when no filter is active', () => {
        expect(filterToInitiative(rows, null)).toBe(rows);
        expect(filterToInitiative(rows, undefined)).toBe(rows);
    });

    it('an EMPTY SET is a real answer and yields no rows — not "no filter"', () => {
        // The in-flight direction, and the opposite of `excludePipelined`'s:
        // showing everything until the plan rows land renders the unfiltered page
        // under a pill claiming it is filtered.
        expect(filterToInitiative(rows, new Set())).toEqual([]);
    });

    it('drops the template row, whose id is the empty string', () => {
        expect(filterToInitiative([{ id: '' }, { id: 3428 }], new Set([3428])).map(r => r.id))
            .toEqual([3428]);
    });
});

describe('firstProjectIndexWithInitiativeWork', () => {
    const PROJECTS = [{ id: 7 }, { id: 1 }, { id: 859 }];
    const CATEGORIES = [
        { id: 1, project_fk: 1 },
        { id: 862, project_fk: 1 },
        { id: 1209, project_fk: 1 },
        { id: 99, project_fk: 7 },
    ];
    const initiativeIds = new Set([3428, 3430, 3440]);

    it('takes the id Set as given and asks nothing about how it was derived', () => {
        // Era-independent: `category_fk` is a requirement's own column in both
        // eras, so req #3356 moved nothing here.
        expect(firstProjectIndexWithInitiativeWork(PROJECTS, CATEGORIES, REQUIREMENTS, initiativeIds)).toBe(1);
    });

    it('prefers the earlier tab when two projects both hold work', () => {
        const reqs = [...REQUIREMENTS, { id: 3428, category_fk: 99 }];
        expect(firstProjectIndexWithInitiativeWork(PROJECTS, CATEGORIES, reqs, initiativeIds)).toBe(0);
    });

    it('is null when nothing matches — leave the reader on the tab they chose', () => {
        expect(firstProjectIndexWithInitiativeWork(PROJECTS, CATEGORIES, REQUIREMENTS, new Set())).toBeNull();
        expect(firstProjectIndexWithInitiativeWork(PROJECTS, CATEGORIES, REQUIREMENTS, null)).toBeNull();
    });

    it('is null while any input is still unresolved', () => {
        expect(firstProjectIndexWithInitiativeWork(undefined, CATEGORIES, REQUIREMENTS, initiativeIds)).toBeNull();
        expect(firstProjectIndexWithInitiativeWork(PROJECTS, undefined, REQUIREMENTS, initiativeIds)).toBeNull();
        expect(firstProjectIndexWithInitiativeWork(PROJECTS, CATEGORIES, undefined, initiativeIds)).toBeNull();
        expect(firstProjectIndexWithInitiativeWork([], CATEGORIES, REQUIREMENTS, initiativeIds)).toBeNull();
    });

    it('ignores work in a category this page does not render', () => {
        // The categories read is `closed: 0`, so a closed category resolves to no
        // project here. Selecting its project would move the reader to a tab that
        // shows nothing — the exact outcome the seed exists to prevent.
        const closedOnly = [{ id: 3428, category_fk: 4242 }];
        expect(firstProjectIndexWithInitiativeWork(PROJECTS, CATEGORIES, closedOnly, initiativeIds)).toBeNull();
    });
});

// The whole pipeline, end to end, on one fixture — the two plan reads producing
// the Set, the Set filtering a surface's rows, and the Set choosing a tab. Each
// function above is pinned alone; this is the only place their COMPOSITION is,
// and composition is where a signature change like req #3356's does its damage.
describe('the containment chain, composed', () => {
    it('derives, filters and lands from one pair of plan reads', () => {
        const ids = initiativeRequirementIds(EPICS, EPIC_REQUIREMENTS, 11);
        expect(filterToInitiative(REQUIREMENTS, ids).map(r => r.id)).toEqual([3428, 3430, 3440]);
        expect(firstProjectIndexWithInitiativeWork(
            [{ id: 7 }, { id: 1 }], [{ id: 1209, project_fk: 1 }], REQUIREMENTS, ids)).toBe(1);
    });
});
