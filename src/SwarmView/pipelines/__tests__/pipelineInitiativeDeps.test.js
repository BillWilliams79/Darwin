// pipelineInitiativeDeps.test.js — initiative-to-initiative dependencies in the
// browser (req #3823): the reshape of the composed read, the editor's diff and
// choices, the list pages' counts, and where the canvas draws an edge.
import { describe, expect, it } from 'vitest';

import {
    INITIATIVE_DEP_GUTTER_X0, INITIATIVE_DEP_STUB_X,
    dependencyChoices, initiativeDepConnectors, initiativeDepCounts, initiativeDepDiff,
    initiativeDepEdges, initiativeDepEdit, initiativeGates, initiativeWaitText,
} from '../pipelineInitiativeDeps';
import { adaptComposedPipeline } from '../pipelineAdapter';

// Plan 7: A (10) holds open work, B (20) waits for A, C (30) waits for B.
const ROWS = [
    { id: 1, initiative_fk: 20, dep_initiative_fk: 10 },
    { id: 2, initiative_fk: 30, dep_initiative_fk: 20 },
];
const INITIATIVES = [
    { id: 10, pipeline_fk: 7, title: 'A' },
    { id: 20, pipeline_fk: 7, title: 'B' },
    { id: 30, pipeline_fk: 7, title: 'C' },
    { id: 40, pipeline_fk: 8, title: 'Other plan' },
];
const DERIVED = {
    initiative_rows: [
        { id: 10, dep_initiative_ids: [], holds_open_work: true, initiative_blocked_by: [] },
        { id: 20, dep_initiative_ids: [10], holds_open_work: true, initiative_blocked_by: [10] },
        { id: 30, dep_initiative_ids: [20], holds_open_work: true, initiative_blocked_by: [10, 20] },
    ],
};

describe('reading the composed read', () => {
    it('turns rows into edges: from waits for to', () => {
        expect(initiativeDepEdges(ROWS)).toEqual([
            { id: 1, from: 20, to: 10 }, { id: 2, from: 30, to: 20 }]);
        expect(initiativeDepEdges(null)).toEqual([]);
    });

    it("keeps the server's gate per initiative, and none for a gateway that predates it", () => {
        const gates = initiativeGates(DERIVED);
        expect(gates.get(20)).toEqual({ depIds: [10], holdsOpenWork: true, blockedBy: [10] });
        expect(initiativeGates({}).size).toBe(0);
    });

    it('the adapter carries rows, edges, gates and each epic row its hold', () => {
        const plan = adaptComposedPipeline({
            pipeline: { id: 7 }, initiatives: INITIATIVES.slice(0, 3),
            initiative_deps: ROWS, epics: [{ id: 2, initiative_fk: 20, title: 'b' }],
            epic_requirements: [], epic_deps: [], requirements: [],
            derived: { ...DERIVED, rows: [{ id: 2, initiative_id: 20, req_ids: [],
                initiative_blocked_by: [10] }],
            violations: [{ invariant: 'initiative-cycle', message: 'm', epic_ids: [],
                initiative_ids: [20, 10, 20] }] },
        });
        expect(plan.initiativeDeps).toHaveLength(2);
        expect(plan.initiativeDepRows).toBe(plan.initiativeDepRows);
        expect(plan.initiativeGates.get(30).blockedBy).toEqual([10, 20]);
        expect(plan.rows[0].initiativeBlockedBy).toEqual([10]);
        expect(plan.violations[0].initiativeIds).toEqual([20, 10, 20]);
    });
});

describe('the editor', () => {
    it('adds what is new and removes what was dropped, by row', () => {
        const own = [{ id: 1, initiative_fk: 30, dep_initiative_fk: 20 },
            { id: 5, initiative_fk: 30, dep_initiative_fk: 10 }];
        expect(initiativeDepDiff(own, [20, 40])).toEqual({ add: [40], remove: [own[1]] });
        expect(initiativeDepDiff([], [])).toEqual({ add: [], remove: [] });
    });

    it('applies only the reader\'s own change to the rows as they are now', () => {
        // Seen [20]; the reader added 40 and dropped 20. Meanwhile 10 arrived.
        const now = [{ id: 1, initiative_fk: 30, dep_initiative_fk: 20 },
            { id: 9, initiative_fk: 30, dep_initiative_fk: 10 }];
        expect(initiativeDepEdit(now, [20], [40])).toEqual({ add: [40], remove: [now[0]] });
        // Nothing changed by the reader: nothing written, whatever arrived.
        expect(initiativeDepEdit(now, [20], [20])).toEqual({ add: [], remove: [] });
    });

    it("offers the plan's other initiatives and greys out one that would close a cycle", () => {
        const choices = dependencyChoices(INITIATIVES, 10, initiativeDepEdges(ROWS));
        // Not itself, not another plan's.
        expect(choices.map((c) => c.id)).toEqual([20, 30]);
        // B and C already wait for A (C through B): either edge closes a loop.
        expect(choices.every((c) => c.disabled)).toBe(true);
        expect(choices[1].reason).toMatch(/C already waits for this initiative/);
        // C may wait for A directly; that closes nothing.
        expect(dependencyChoices(INITIATIVES, 30, initiativeDepEdges(ROWS))
            .find((c) => c.id === 10).disabled).toBe(false);
    });
});

describe('the list pages', () => {
    it('counts edges per plan and names each side per initiative', () => {
        const { byPipeline, byInitiative } = initiativeDepCounts(ROWS, INITIATIVES);
        expect(byPipeline.get(7)).toBe(2);
        expect(byPipeline.has(8)).toBe(false);
        expect(byInitiative.get(20)).toEqual({ dependsOn: [10], dependents: [30] });
    });
});

describe('the plan canvas', () => {
    const gates = initiativeGates(DERIVED);
    const title = (id) => INITIATIVES.find((i) => i.id === id)?.title ?? null;

    it('says what a held initiative is waiting on, and what a free one came after', () => {
        expect(initiativeWaitText(gates.get(30), title)).toBe('waiting on A, B');
        expect(initiativeWaitText({ depIds: [10], blockedBy: [] }, title)).toBe('after A');
        expect(initiativeWaitText(gates.get(10), title)).toBeNull();
        expect(initiativeWaitText(undefined, title)).toBeNull();
    });

    it('draws each edge as a gutter bracket from the band waited on to the band that waits', () => {
        const bands = [
            { initiativeId: 10, y: 100, headerH: 108 },
            { initiativeId: 20, y: 400, headerH: 108 },
            { initiativeId: 30, y: 700, headerH: 44 },
        ];
        const [ab, bc] = initiativeDepConnectors(bands, initiativeDepEdges(ROWS), gates);
        expect(ab).toMatchObject({ from: 20, to: 10, held: true, yTo: 154, yFrom: 454,
            x: INITIATIVE_DEP_GUTTER_X0 });
        // Its own lane, still left of the stub and the first card column.
        expect(bc.x).toBeGreaterThan(ab.x);
        expect(bc.x).toBeLessThan(INITIATIVE_DEP_STUB_X);
        expect(bc.yFrom).toBe(722);
    });

    it('marks an edge released once the initiative waited on holds no work and waits for nothing', () => {
        const free = initiativeGates({ initiative_rows: [
            { id: 10, dep_initiative_ids: [], holds_open_work: false, initiative_blocked_by: [] },
            { id: 20, dep_initiative_ids: [10], holds_open_work: true, initiative_blocked_by: [] },
        ] });
        const [c] = initiativeDepConnectors(
            [{ initiativeId: 10, y: 0, headerH: 100 }, { initiativeId: 20, y: 200, headerH: 100 }],
            [{ from: 20, to: 10 }], free);
        expect(c.held).toBe(false);
    });

    it('draws no edge whose band is not on the plan', () => {
        expect(initiativeDepConnectors([{ initiativeId: 10, y: 0, headerH: 100 }],
            initiativeDepEdges(ROWS), gates)).toEqual([]);
    });
});
