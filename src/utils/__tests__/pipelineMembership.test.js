import { describe, it, expect } from 'vitest';
import { pipelinedRequirementIds, epicSeatedRequirementIds, orchestratedRequirementIds, excludeByIds } from '../pipelineMembership';

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

// ── req #3419 — EPIC association, and the union the browse toggle asks ────────
//
// The measured defect: with the toggle ON, category 1 kept showing 4
// requirements that are plainly part of a plan — #3304 and #3314 (feature 35 ->
// epic 4), #3385 (feature 31 -> epic 7), #3433 (feature 41 -> epic 9) — because
// no pipeline STEP carried them yet. These pin the wider question.

describe('epicSeatedRequirementIds (req #3419)', () => {
    const FEATURES = [
        { id: 35, epic_fk: 4 },
        { id: 31, epic_fk: 7 },
        { id: 41, epic_fk: 9 },
        { id: 99, epic_fk: null },   // a feature that names no epic
    ];

    it('collects requirements whose feature names an epic', () => {
        const ids = epicSeatedRequirementIds([
            { id: 3304, feature_fk: 35 },
            { id: 3385, feature_fk: 31 },
            { id: 3433, feature_fk: 41 },
        ], FEATURES);
        expect(ids).toEqual(new Set([3304, 3385, 3433]));
    });

    it('does NOT count a requirement whose feature names no epic', () => {
        // "Filed under a feature" is not "part of a body of work". A feature
        // with a null epic_fk is categorization, not a plan.
        const ids = epicSeatedRequirementIds([{ id: 3400, feature_fk: 99 }], FEATURES);
        expect(ids.size).toBe(0);
    });

    it('does NOT count a requirement with no feature at all', () => {
        const ids = epicSeatedRequirementIds([
            { id: 3418, feature_fk: null },
            { id: 3420 },
        ], FEATURES);
        expect(ids.size).toBe(0);
    });

    it('ignores a feature_fk that resolves to nothing', () => {
        // A dangling fk must not be read as epic membership — the feature read
        // may simply not have landed, and guessing "orchestrated" would hide
        // work behind a fetch gap. Fail toward showing more.
        const ids = epicSeatedRequirementIds([{ id: 3304, feature_fk: 35 }], []);
        expect(ids.size).toBe(0);
    });

    it('normalizes string ids the way the step answer does', () => {
        const ids = epicSeatedRequirementIds([{ id: '3304', feature_fk: '35' }], FEATURES);
        expect(ids.has(3304)).toBe(true);
    });

    it('never counts the template row', () => {
        // CategoryCard's add-row carries id '' and no feature; Number('') is 0,
        // which must not become a member of anything.
        const ids = epicSeatedRequirementIds([{ id: '', feature_fk: 35 }], FEATURES);
        expect(ids.size).toBe(0);
    });

    it('returns an empty set while either read is in flight', () => {
        expect(epicSeatedRequirementIds(undefined, FEATURES).size).toBe(0);
        expect(epicSeatedRequirementIds([{ id: 3304, feature_fk: 35 }], undefined).size).toBe(0);
    });
});

describe('orchestratedRequirementIds (req #3419)', () => {
    const FEATURES = [{ id: 35, epic_fk: 4 }];
    const JUNCTION = [{ step_fk: 1, requirement_fk: 3419 }];
    const REQS = [
        { id: 3419, feature_fk: 46 },   // step-carried, feature unknown here
        { id: 3304, feature_fk: 35 },   // epic-seated, no step
        { id: 3418, feature_fk: null }, // neither
    ];

    it('is the UNION of step association and epic association', () => {
        const ids = orchestratedRequirementIds(JUNCTION, REQS, FEATURES);
        expect(ids).toEqual(new Set([3419, 3304]));
    });

    it('leaves unplanned work alone — that residue is the point of the toggle', () => {
        const ids = orchestratedRequirementIds(JUNCTION, REQS, FEATURES);
        expect(ids.has(3418)).toBe(false);
    });

    it('is a strict superset of the step answer', () => {
        // Launch eligibility (req #3180) reads the STEP set and must stay
        // narrow; the browse toggle reads this one. Widening the first would
        // withhold launchable work.
        const step = pipelinedRequirementIds(JUNCTION);
        const all = orchestratedRequirementIds(JUNCTION, REQS, FEATURES);
        for (const id of step) expect(all.has(id)).toBe(true);
        expect(all.size).toBeGreaterThan(step.size);
    });

    it('degrades to the step answer when the epic reads have not landed', () => {
        const ids = orchestratedRequirementIds(JUNCTION, undefined, undefined);
        expect(ids).toEqual(new Set([3419]));
    });
});
