// @vitest-environment node
//
// req #3393 — the Pipeline 2.0 list-page summary model. Pure functions, no
// DOM needed.

import { describe, it, expect } from 'vitest';
import { pipelineSummaries, pipelineRequirementCounts } from '../pipelinesViewModel';

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
        expect(out.get(7)).toEqual({ total: 2 });
        expect(out.get(8)).toEqual({ total: 1 });
    });

    it('seeds an entry for every pipeline, even one with no epics', () => {
        const out = pipelineSummaries({ pipelines: [...pipelines, { id: 9 }], epics, initiatives });
        expect(out.get(9)).toEqual({ total: 0 });
    });

    it('drops an epic whose initiative is unresolved rather than crashing', () => {
        const out = pipelineSummaries({
            pipelines, epics: [...epics, { id: 999, initiative_fk: 12345 }], initiatives,
        });
        expect(out.get(7)).toEqual({ total: 2 });
        expect(out.get(8)).toEqual({ total: 1 });
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
        expect(out.get(7)).toEqual({ met: 1, total: 2 });
        expect(out.get(8)).toEqual({ met: 0, total: 0 });
    });

    it('seeds {met:0,total:0} for a plan with no linked requirements', () => {
        const out = pipelineRequirementCounts({
            pipelines, epics, initiatives, epicRequirements: [], requirements });
        expect(out.get(7)).toEqual({ met: 0, total: 0 });
    });

    it('treats an unresolved requirement id as not-met rather than throwing', () => {
        const out = pipelineRequirementCounts({
            pipelines, epics, initiatives,
            epicRequirements: [{ epic_fk: 500, requirement_fk: 99999 }],
            requirements,
        });
        expect(out.get(7)).toEqual({ met: 0, total: 1 });
    });
});
