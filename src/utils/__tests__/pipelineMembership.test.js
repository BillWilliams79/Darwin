import { describe, it, expect } from 'vitest';
import { pipelinedRequirementIds, orchestratedRequirementIds, excludeByIds } from '../pipelineMembership';

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
// req #3419 unioned in requirements epic-filed via `feature_fk -> epic_fk`
// but not step-carried. Feature leaving the frontend retired the only
// mechanism that could produce that population — see pipelineMembership.js's
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

// ── req #3491 — the second (2.0) junction argument ───────────────────────────
//
// A requirement seated on a Pipeline 2.0 step has NO row at all in the 1.0
// junction, so the union has to see it through the second argument alone —
// not merely "pass an empty second array and get the same answer as before".

describe('pipelinedRequirementIds — the 2.0 junction (req #3491)', () => {
    const JUNCTION_1_0 = [{ step_fk: 1, requirement_fk: 101 }];
    const JUNCTION_2_0 = [{ step_fk: 304, requirement_fk: 105 }];

    it('sees a 2.0-only seating with no 1.0 row at all', () => {
        const ids = pipelinedRequirementIds([], JUNCTION_2_0);
        expect(ids).toEqual(new Set([105]));
    });

    it('unions both eras rather than picking one', () => {
        const ids = pipelinedRequirementIds(JUNCTION_1_0, JUNCTION_2_0);
        expect(ids).toEqual(new Set([101, 105]));
    });

    it('de-duplicates a requirement seated in both eras at once', () => {
        const bothEras = [{ step_fk: 1, requirement_fk: 101 }];
        const ids = pipelinedRequirementIds(JUNCTION_1_0, bothEras);
        expect(ids.size).toBe(1);
        expect(ids.has(101)).toBe(true);
    });

    it('the 1.0 read still in flight (undefined) does not lose a landed 2.0 answer', () => {
        // A real intermediate state on every page load: the two junction
        // reads land independently. "Show more, never less" has to hold
        // per-era, not only once both have resolved.
        const ids = pipelinedRequirementIds(undefined, JUNCTION_2_0);
        expect(ids).toEqual(new Set([105]));
    });

    it('the 2.0 read still in flight (undefined) does not lose a landed 1.0 answer', () => {
        const ids = pipelinedRequirementIds(JUNCTION_1_0, undefined);
        expect(ids).toEqual(new Set([101]));
    });

    it('a missing second argument behaves exactly as the 1-arg call always did', () => {
        expect(pipelinedRequirementIds(JUNCTION_1_0)).toEqual(new Set([101]));
    });

    it('tolerates null/{} for the second argument same as the first', () => {
        expect(pipelinedRequirementIds(JUNCTION_1_0, null)).toEqual(new Set([101]));
        expect(pipelinedRequirementIds(JUNCTION_1_0, {})).toEqual(new Set([101]));
    });

    it('normalizes string ids on the 2.0 side too', () => {
        const ids = pipelinedRequirementIds([], [{ step_fk: '304', requirement_fk: '105' }]);
        expect(ids.has(105)).toBe(true);
    });

    it('drops a 2.0 row with no requirement_fk, same as the 1.0 rule', () => {
        const ids = pipelinedRequirementIds([], [{ step_fk: 304, requirement_fk: null }]);
        expect(ids.size).toBe(0);
    });
});

describe('orchestratedRequirementIds — the 2.0 junction (req #3491)', () => {
    it('is the same union as pipelinedRequirementIds', () => {
        const j1 = [{ step_fk: 1, requirement_fk: 101 }];
        const j2 = [{ step_fk: 304, requirement_fk: 105 }];
        expect(orchestratedRequirementIds(j1, j2)).toEqual(pipelinedRequirementIds(j1, j2));
        expect(orchestratedRequirementIds(j1, j2)).toEqual(new Set([101, 105]));
    });
});
