// @vitest-environment node
//
// req #3393 — the Pipeline 2.0 list-page summary model. Pure functions, no
// DOM needed.

import { describe, it, expect } from 'vitest';
import {
    pipelineSummaries, pipelineRequirementCounts, orderPipelines, frontSortOrder,
    reorderPipelines, isClosedPipeline, allActiveRequirements,
} from '../pipelinesViewModel';

const pipelines = [{ id: 7 }, { id: 8 }];
const initiatives = [
    { id: 40, pipeline_fk: 7 },
    { id: 41, pipeline_fk: 8 },
];
const epics = [
    { id: 500, initiative_fk: 40 },
    { id: 501, initiative_fk: 40 },
    { id: 502, initiative_fk: 41 },
];

describe('pipelineSummaries', () => {
    // req #3750 — an epic has no state, so the summary is a COUNT only: no
    // done/open tally.
    it('counts epics per pipeline via initiative_fk -> pipeline_fk', () => {
        const out = pipelineSummaries({ pipelines, epics, initiatives });
        expect(out.get(7)).toEqual({ total: 2, initiatives: 1, initiativeDeps: 0 });
        expect(out.get(8)).toEqual({ total: 1, initiatives: 1, initiativeDeps: 0 });
    });

    it('seeds an entry for every pipeline, even one with no epics', () => {
        const out = pipelineSummaries({ pipelines: [...pipelines, { id: 9 }], epics, initiatives });
        expect(out.get(9)).toEqual({ total: 0, initiatives: 0, initiativeDeps: 0 });
    });

    it('drops an epic whose initiative is unresolved rather than crashing', () => {
        const out = pipelineSummaries({
            pipelines, epics: [...epics, { id: 999, initiative_fk: 12345 }], initiatives,
        });
        expect(out.get(7)).toEqual({ total: 2, initiatives: 1, initiativeDeps: 0 });
        expect(out.get(8)).toEqual({ total: 1, initiatives: 1, initiativeDeps: 0 });
    });
});

describe('pipelineRequirementCounts', () => {
    const epicRequirements = [
        { epic_fk: 500, requirement_fk: 900 },
        { epic_fk: 501, requirement_fk: 901 },
    ];
    const requirements = [
        { id: 900, requirement_status: 'met' },
        { id: 901, requirement_status: 'development' },
    ];

    it('counts met vs total from stored requirement_status, no derivation', () => {
        const out = pipelineRequirementCounts({
            pipelines, epics, initiatives, epicRequirements, requirements });
        expect(out.get(7)).toEqual({ met: 1, closed: 1, total: 2 });
        expect(out.get(8)).toEqual({ met: 0, closed: 0, total: 0 });
    });

    // req #3804 — "requirements closed" is every terminal status.
    it('counts deferred and wontfix as closed, but not as met', () => {
        const out = pipelineRequirementCounts({
            pipelines, epics, initiatives, epicRequirements,
            requirements: [{ id: 900, requirement_status: 'deferred' },
                           { id: 901, requirement_status: 'wontfix' }],
        });
        expect(out.get(7)).toEqual({ met: 0, closed: 2, total: 2 });
    });

    it('seeds {met:0,total:0} for a plan with no linked requirements', () => {
        const out = pipelineRequirementCounts({
            pipelines, epics, initiatives, epicRequirements: [], requirements });
        expect(out.get(7)).toEqual({ met: 0, closed: 0, total: 0 });
    });

    it('treats an unresolved requirement id as not-met rather than throwing', () => {
        const out = pipelineRequirementCounts({
            pipelines, epics, initiatives,
            epicRequirements: [{ epic_fk: 500, requirement_fk: 99999 }],
            requirements,
        });
        expect(out.get(7)).toEqual({ met: 0, closed: 0, total: 1 });
    });
});

// req #3804 — hand-sorted cards and closed plans.
describe('orderPipelines', () => {
    it('puts unpositioned (new, MCP-made) plans first, then sort_order, newest first among equals', () => {
        const rows = [{ id: 1, sort_order: 2 }, { id: 2, sort_order: null }, { id: 3, sort_order: 0 },
            { id: 4 }, { id: 5, sort_order: '1' }];
        expect(orderPipelines(rows).map((p) => p.id)).toEqual([4, 2, 3, 5, 1]);
    });
});

describe('frontSortOrder', () => {
    it('is one below the smallest position', () => {
        expect(frontSortOrder([{ sort_order: 3 }, { sort_order: -2 }, { sort_order: null }])).toBe(-3);
    });
    it('is 0 when nothing is positioned', () => {
        expect(frontSortOrder([])).toBe(0);
        expect(frontSortOrder([{ sort_order: null }])).toBe(0);
    });
});

describe('reorderPipelines', () => {
    const ordered = [{ id: 10, sort_order: 0 }, { id: 11, sort_order: 1 },
        { id: 12, sort_order: 2 }, { id: 13, sort_order: 3 }];

    it('moves the dragged plan to the target\'s place and writes only what moved', () => {
        const move = reorderPipelines(ordered, 13, 11);
        expect(move.rows.map((p) => p.id)).toEqual([10, 13, 11, 12]);
        expect(move.writes).toEqual([
            { id: 13, sort_order: 1 }, { id: 11, sort_order: 2 }, { id: 12, sort_order: 3 }]);
    });

    it('renumbers unpositioned and negative plans too', () => {
        const move = reorderPipelines([{ id: 1, sort_order: -1 }, { id: 2, sort_order: 0 },
            { id: 3, sort_order: null }], 3, 2);
        expect(move.writes).toEqual([
            { id: 1, sort_order: 0 }, { id: 3, sort_order: 1 }, { id: 2, sort_order: 2 }]);
    });

    it('is null for a no-op or an unknown id', () => {
        expect(reorderPipelines(ordered, 11, 11)).toBeNull();
        expect(reorderPipelines(ordered, 99, 11)).toBeNull();
    });
});

describe('isClosedPipeline', () => {
    it('reads the flag, not its spelling', () => {
        expect([0, '0', null, undefined, 1, '1', true].map((closed) => isClosedPipeline({ closed })))
            .toEqual([false, false, false, false, true, true, true]);
    });
});

// req #3978 — the Pipelines page's All Active box: the plan's Active box rule
// applied to every plan's seated requirements.
describe('allActiveRequirements', () => {
    const plans = [{ id: 7, sort_order: 1 }, { id: 8, sort_order: 0 }, { id: 9, sort_order: 2, closed: 1 }];
    const inits = [{ id: 40, pipeline_fk: 7 }, { id: 41, pipeline_fk: 8 }, { id: 42, pipeline_fk: 9 }];
    const eps = [{ id: 500, initiative_fk: 40 }, { id: 502, initiative_fk: 41 }, { id: 503, initiative_fk: 42 }];
    const seats = [
        { epic_fk: 500, requirement_fk: 905 }, { epic_fk: 500, requirement_fk: 901 },
        { epic_fk: 502, requirement_fk: 902 }, { epic_fk: 502, requirement_fk: 901 },
        { epic_fk: 503, requirement_fk: 903 }, { epic_fk: 503, requirement_fk: 904 },
        { epic_fk: 999, requirement_fk: 906 },
    ];
    const reqs = [
        { id: 901, title: 'one', requirement_status: 'development', machine_fk: 4 },
        { id: 902, title: 'two', requirement_status: 'development' },
        { id: 903, title: 'three', requirement_status: 'met' },
        { id: 904, title: 'four', requirement_status: 'wontfix' },
        { id: 905, title: 'five', requirement_status: 'development' },
        { id: 906, title: 'unseated', requirement_status: 'development' },
    ];
    const sessions = new Map([
        [901, 'active'], [902, 'review'], [903, 'completing'], [904, 'active'],
        [905, 'paused'], [906, 'active'],
    ]);
    const run = (over = {}) => allActiveRequirements({
        pipelines: plans, initiatives: inits, epics: eps, epicRequirements: seats,
        requirements: reqs, sessionStatus: sessions, ...over,
    });

    it('lists every plan\'s active requirements once, in the page\'s plan order', () => {
        expect(run().map((r) => r.id)).toEqual([902, 901, 903]);
    });

    it('carries the row the Active box draws', () => {
        expect(run().find((r) => r.id === 901)).toEqual({
            id: 901, title: 'one', sessionStatus: 'active', status: 'development', machineFk: 4,
        });
    });

    it('keeps the box rule: no paused session, no wontfix, nothing off a plan', () => {
        const ids = run().map((r) => r.id);
        expect(ids).not.toContain(905);
        expect(ids).not.toContain(904);
        expect(ids).not.toContain(906);
    });

    it('is empty until the session reads have settled', () => {
        expect(run({ sessionStatus: null })).toEqual([]);
    });
});
