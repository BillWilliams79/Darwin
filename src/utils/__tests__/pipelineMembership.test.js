import { describe, it, expect } from 'vitest';
import {
    pipelinedRequirementIds, orchestratedRequirementIds, excludeByIds,
    stepRequirementIds, filterToStepReqIds,
} from '../pipelineMembership';

// req #3180. This module is the browser's ONE answer to "does a pipeline step
// carry this requirement" — both the SwarmStartCard aggregator and the
// requirements-page filter read it. The tests that matter are the ones pinning
// the shape it must survive in real data (a junction with no id column, ids that
// arrive as strings from a REST payload) and the direction it must fail in
// (show more, never hide eligible work).

describe('pipelinedRequirementIds', () => {
    it('collects requirement_fk from junction rows', () => {
        const ids = pipelinedRequirementIds([
            { step_fk: 1, requirement_fk: 3074 },
            { step_fk: 2, requirement_fk: 3172 },
        ]);
        expect(ids).toEqual(new Set([3074, 3172]));
    });

    it('collapses a requirement carried by several steps', () => {
        // Membership is "at least one step" — the Set is the right shape for it.
        const ids = pipelinedRequirementIds([
            { step_fk: 1, requirement_fk: 3074 },
            { step_fk: 9, requirement_fk: 3074 },
        ]);
        expect(ids.size).toBe(1);
        expect(ids.has(3074)).toBe(true);
    });

    it('normalizes string ids so a REST payload matches a numeric row id', () => {
        // Lambda-Rest can hand back either; a Set keyed on '3074' would never
        // match a row whose id is 3074, and the filter would silently no-op.
        const ids = pipelinedRequirementIds([{ step_fk: '1', requirement_fk: '3074' }]);
        expect(ids.has(3074)).toBe(true);
    });

    it('never seeds the set from a row with no requirement_fk', () => {
        // A null in the set makes `has(Number(undefined))`-adjacent lookups
        // unpredictable; drop the row instead.
        const ids = pipelinedRequirementIds([
            { step_fk: 1, requirement_fk: null },
            { step_fk: 2 },
            null,
            { step_fk: 3, requirement_fk: 3074 },
        ]);
        expect(ids).toEqual(new Set([3074]));
    });

    it('returns an empty set for a missing or non-array read', () => {
        // The in-flight state of the junction query. Empty means "nothing known
        // to be pipelined", so nothing is hidden — see the direction test below.
        expect(pipelinedRequirementIds(undefined).size).toBe(0);
        expect(pipelinedRequirementIds(null).size).toBe(0);
        expect(pipelinedRequirementIds({}).size).toBe(0);
    });
});

describe('excludeByIds', () => {
    const rows = [{ id: 3074 }, { id: 3180 }, { id: 3172 }];

    it('drops exactly the requirements a step carries', () => {
        const kept = excludeByIds(rows, new Set([3074, 3172]));
        expect(kept.map(r => r.id)).toEqual([3180]);
    });

    it('returns the input unchanged when disabled', () => {
        // Same reference, so an opted-out caller cannot trip a referential
        // -equality dependency into re-running.
        expect(excludeByIds(rows, new Set([3074]), false)).toBe(rows);
    });

    it('returns the input unchanged when nothing is pipelined', () => {
        expect(excludeByIds(rows, new Set())).toBe(rows);
        expect(excludeByIds(rows, undefined)).toBe(rows);
    });

    it('shows MORE, never less, while the junction read is in flight', () => {
        // The deliberate failure direction: an unresolved (or failed) membership
        // read must not blank a launch surface, and must never hide eligible
        // work behind a fetch error.
        expect(excludeByIds(rows, pipelinedRequirementIds(undefined))).toBe(rows);
    });

    it('matches a numeric set against string row ids', () => {
        const kept = excludeByIds([{ id: '3074' }, { id: '3180' }], new Set([3074]));
        expect(kept.map(r => r.id)).toEqual(['3180']);
    });

    it('passes a non-array through untouched', () => {
        expect(excludeByIds(undefined, new Set([3074]))).toBe(undefined);
    });
});

// ── req #3419's epic-filed union, retired by req #3357 ─────────────────────
//
// req #3419 unioned in requirements epic-filed through the retired middle
// tier's own reference to the epic, but not step-carried. That tier leaving
// the frontend retired the only mechanism that could produce that population
// — see pipelineMembership.js's
// header for the full reasoning — so `orchestratedRequirementIds` is now the
// step answer alone.

describe('orchestratedRequirementIds (req #3357)', () => {
    const JUNCTION = [{ step_fk: 1, requirement_fk: 3419 }];

    it('equals the step answer', () => {
        const ids = orchestratedRequirementIds(JUNCTION);
        expect(ids).toEqual(pipelinedRequirementIds(JUNCTION));
        expect(ids).toEqual(new Set([3419]));
    });

    it('leaves unplanned work alone — that residue is the point of the toggle', () => {
        const ids = orchestratedRequirementIds(JUNCTION);
        expect(ids.has(3418)).toBe(false);
    });

    it('returns an empty set for a missing or non-array read', () => {
        expect(orchestratedRequirementIds(undefined).size).toBe(0);
    });
});

// req #3491 gave both functions a second argument reading a first-generation
// junction, unioned with the first, while the first and second generation ran
// side by side. Req #3356 retired that union along with the first
// generation's table: the second generation's junction was renamed onto the
// vacated name, so a single argument is once again the whole answer, and the
// describe blocks that lived here (testing the union, the de-duplication
// across eras, and the independent-in-flight-read cases) were removed with
// it — the single-junction cases above already cover the surviving behavior.

// ── req #3503 — the SAME module, narrowed to ONE step ──────────────────────
//
// `pipelinedRequirementIds` above answers "is this on ANY step"; these answer
// "is this on step X". Same junction, one hop, no `pipeline_steps` read — which
// is the whole difference from the epic answer in `epicMembership.js`.

describe('stepRequirementIds', () => {
    // The junction as `useAllPipelineStepRequirements` returns it.
    // `PRIMARY KEY (requirement_fk)` alone, so a requirement appears at most once.
    const JUNCTION = [
        { step_fk: 186, requirement_fk: 3503 },
        { step_fk: 186, requirement_fk: 3504 },
        { step_fk: 187, requirement_fk: 3505 },
    ];

    it('collects only the named step\'s requirements', () => {
        expect(stepRequirementIds(JUNCTION, 186)).toEqual(new Set([3503, 3504]));
        expect(stepRequirementIds(JUNCTION, 187)).toEqual(new Set([3505]));
    });

    it('normalizes string ids so a REST payload matches a numeric row id', () => {
        // Lambda-Rest can hand back either, on either column.
        expect(stepRequirementIds([{ step_fk: '186', requirement_fk: '3503' }], 186))
            .toEqual(new Set([3503]));
        expect(stepRequirementIds(JUNCTION, '186')).toEqual(new Set([3503, 3504]));
    });

    it('is empty for a step nothing is seated on — not an error', () => {
        expect(stepRequirementIds(JUNCTION, 99999).size).toBe(0);
    });

    it('is EMPTY, never everything, when no step is named', () => {
        // "No filter" is `null` passed to `filterToStepReqIds`, not an unresolved
        // id here. Conflating them would make an in-flight id read as the whole
        // table.
        expect(stepRequirementIds(JUNCTION, null).size).toBe(0);
        expect(stepRequirementIds(JUNCTION, undefined).size).toBe(0);
        expect(stepRequirementIds(JUNCTION, '').size).toBe(0);
    });

    it('never matches a row with no step_fk against a step id of 0', () => {
        // `Number(null)` is 0 — a perfectly good integer and a perfectly bad
        // step id. Both columns are guarded before Number sees them.
        expect(stepRequirementIds([
            { step_fk: null, requirement_fk: 1 },
            { step_fk: '', requirement_fk: 2 },
            { requirement_fk: 3 },
        ], 0).size).toBe(0);
    });

    it('never seeds the set from a row with no requirement_fk', () => {
        expect(stepRequirementIds([
            { step_fk: 186, requirement_fk: null },
            { step_fk: 186 },
            null,
            { step_fk: 186, requirement_fk: 3503 },
        ], 186)).toEqual(new Set([3503]));
    });

    it('returns an empty set for a missing or non-array read', () => {
        expect(stepRequirementIds(undefined, 186).size).toBe(0);
        expect(stepRequirementIds(null, 186).size).toBe(0);
        expect(stepRequirementIds({}, 186).size).toBe(0);
    });
});

describe('filterToStepReqIds', () => {
    const rows = [{ id: 3503 }, { id: 3504 }, { id: 3505 }];

    it('keeps only rows in the set, matching on id alone', () => {
        // ID-ONLY IS THE POINT: none of the consuming projections carries a plan
        // column, and this is what lets them be filtered anyway.
        expect(filterToStepReqIds(rows, new Set([3503, 3505])).map(r => r.id))
            .toEqual([3503, 3505]);
    });

    it('returns the input UNCHANGED, by reference, when no filter is active', () => {
        expect(filterToStepReqIds(rows, null)).toBe(rows);
        expect(filterToStepReqIds(rows, undefined)).toBe(rows);
    });

    it('an EMPTY SET is a real answer and yields no rows — not "no filter"', () => {
        // The in-flight direction, and the OPPOSITE of `excludeByIds` above:
        // that one DROPS the ids it is given, so unknown must mean "keep"; this
        // one SELECTS them, so unknown must mean "none yet". Showing everything
        // until the junction lands renders the unfiltered page under a pill
        // claiming it is filtered.
        expect(filterToStepReqIds(rows, new Set())).toEqual([]);
    });

    it('drops the template row, whose id is the empty string', () => {
        expect(filterToStepReqIds([{ id: '' }, { id: 3503 }], new Set([3503])).map(r => r.id))
            .toEqual([3503]);
    });

    it('matches a numeric set against string row ids', () => {
        expect(filterToStepReqIds([{ id: '3503' }, { id: '3504' }], new Set([3503])).map(r => r.id))
            .toEqual(['3503']);
    });

    it('passes a non-array through untouched', () => {
        expect(filterToStepReqIds(undefined, new Set([3503]))).toBe(undefined);
    });

    it('composes with filterToEpic as an INTERSECTION, in either order', () => {
        // Both filters can be engaged at once, and the cards apply them in
        // series. Neither is a mode of the other, so the survivors must be the
        // rows both sets hold.
        const epicSet = new Set([3503, 3504]);
        const stepSet = new Set([3504, 3505]);
        const kept = filterToStepReqIds(
            rows.filter(r => epicSet.has(r.id)), stepSet);
        expect(kept.map(r => r.id)).toEqual([3504]);
    });
});
