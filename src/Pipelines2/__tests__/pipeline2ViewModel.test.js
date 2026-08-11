// @vitest-environment node
//
// req #3393 — the Pipeline 2.0 list-page summary model. Pure functions, no
// DOM needed.

import { describe, it, expect } from 'vitest';
import { pipeline2Summaries, pipeline2RequirementCounts } from '../pipeline2ViewModel';

const pipelines = [{ id: 7 }, { id: 8 }];
const epics = [
    { id: 40, pipeline_fk: 7 },
    { id: 41, pipeline_fk: 8 },
];
const steps = [
    { id: 500, epic_fk: 40, completed_at: '2026-08-01 00:00:00' },
    { id: 501, epic_fk: 40, completed_at: null },
    { id: 502, epic_fk: 41, completed_at: null },
];

describe('pipeline2Summaries', () => {
    it('tallies done/open per pipeline via epic_fk -> pipeline_fk', () => {
        const out = pipeline2Summaries({ pipelines, steps, epics });
        expect(out.get(7)).toEqual({ total: 2, done: 1, open: 1 });
        expect(out.get(8)).toEqual({ total: 1, done: 0, open: 1 });
    });

    it('seeds an entry for every pipeline, even one with no steps', () => {
        const out = pipeline2Summaries({ pipelines: [...pipelines, { id: 9 }], steps, epics });
        expect(out.get(9)).toEqual({ total: 0, done: 0, open: 0 });
    });

    it('drops a step whose epic is unresolved rather than crashing', () => {
        const out = pipeline2Summaries({
            pipelines, steps: [...steps, { id: 999, epic_fk: 12345, completed_at: null }], epics,
        });
        expect(out.get(7)).toEqual({ total: 2, done: 1, open: 1 });
        expect(out.get(8)).toEqual({ total: 1, done: 0, open: 1 });
    });
});

describe('pipeline2RequirementCounts', () => {
    const stepRequirements = [
        { step_fk: 500, requirement_fk: 900 },
        { step_fk: 501, requirement_fk: 901 },
    ];
    const requirements = [
        { id: 900, requirement_status: 'met' },
        { id: 901, requirement_status: 'development' },
    ];

    it('counts met vs total from stored requirement_status, no derivation', () => {
        const out = pipeline2RequirementCounts({
            pipelines, steps, epics, stepRequirements, requirements });
        expect(out.get(7)).toEqual({ met: 1, total: 2 });
        expect(out.get(8)).toEqual({ met: 0, total: 0 });
    });

    it('seeds {met:0,total:0} for a plan with no linked requirements', () => {
        const out = pipeline2RequirementCounts({
            pipelines, steps, epics, stepRequirements: [], requirements });
        expect(out.get(7)).toEqual({ met: 0, total: 0 });
    });

    it('treats an unresolved requirement id as not-met rather than throwing', () => {
        const out = pipeline2RequirementCounts({
            pipelines, steps, epics,
            stepRequirements: [{ step_fk: 500, requirement_fk: 99999 }],
            requirements,
        });
        expect(out.get(7)).toEqual({ met: 0, total: 1 });
    });
});
