// Req #3811 — the popup requirement editor's pure half: the draft it starts
// from, when it can save, and the exact POST / PUT bodies.

import { describe, it, expect } from 'vitest';

import { DEFAULT_REQUIREMENT_SPEC } from '../../SwarmView/requirementSpec';
import {
    buildPostBody, buildPutBody, defaultsFormValues, draftDirty, draftProblem, machineOptions,
    newRequirementDraft, savedValues, staleRefs,
} from '../requirementFilerModel';
import { buildOrchestrationIndex } from '../../SwarmView/detail/orchestrationIndex';

const NOW = '2026-10-23T10:00:00.000Z';
const filled = (over = {}) => ({ ...newRequirementDraft(4, 862), title: '  Filer  ', ...over });

describe('requirementFilerModel (req #3811)', () => {
    it('starts from DEFAULT_REQUIREMENT_SPEC, Any machine, work, where the last one was filed', () => {
        const d = newRequirementDraft(4, 862);
        expect(d).toMatchObject({ ...DEFAULT_REQUIREMENT_SPEC, projectId: 4, category_fk: 862,
            machine_fk: null, affected_repos: '', tracking: 0, title: '', description: '' });
        expect(newRequirementDraft()).toMatchObject({ projectId: null, category_fk: null });
    });

    it('needs a title and a category, and never a blank enum', () => {
        expect(draftProblem(newRequirementDraft(4, 862))).toMatch(/title/);
        expect(draftProblem(filled({ category_fk: null }))).toMatch(/category/);
        expect(draftProblem(filled({ effort: '' }))).toMatch(/effort/);
        expect(draftProblem(filled())).toBe(null);
    });

    it('POSTs one object: trimmed, stamped, without blanks or the editor-only project', () => {
        const body = buildPostBody(filled({ requirement_status: 'development' }), NOW);
        expect(Array.isArray(body)).toBe(false);
        expect(body).toEqual({
            title: 'Filer', category_fk: 862, tracking: 0,
            requirement_status: 'development', coordination_type: 'implemented', ai_model: 'opus', effort: 'high',
            started_at: NOW, completed_at: 'NULL', deferred_at: 'NULL',
        });
        const full = buildPostBody(filled({ description: 'd', machine_fk: 3, affected_repos: ' Darwin ', tracking: 1 }), NOW);
        expect(full).toMatchObject({ description: 'd', machine_fk: 3, affected_repos: 'Darwin', tracking: 1 });
        expect(full).not.toHaveProperty('projectId');
        // A blank enum is left out, never sent (req #3432).
        expect(buildPostBody(filled({ ai_model: '' }), NOW)).not.toHaveProperty('ai_model');
    });

    it('PUTs an array of one row carrying only what changed', () => {
        const saved = savedValues(filled({ machine_fk: 3, affected_repos: 'Darwin' }));
        expect(buildPutBody(9, filled({ machine_fk: 3, affected_repos: 'Darwin' }), saved, NOW)).toBe(null);
        expect(buildPutBody(9, filled({ machine_fk: 3, affected_repos: 'Darwin', title: 'New' }), saved, NOW))
            .toEqual([{ id: 9, title: 'New' }]);
        // Clearing machine and repos sends the 'NULL' sentinel.
        expect(buildPutBody(9, filled(), saved, NOW)).toEqual([{ id: 9, machine_fk: 'NULL', affected_repos: 'NULL' }]);
        // A status change re-derives the timestamps (req #3244).
        expect(buildPutBody(9, filled({ machine_fk: 3, affected_repos: 'Darwin', requirement_status: 'met' }), saved, NOW))
            .toEqual([{ id: 9, requirement_status: 'met', started_at: 'NULL', completed_at: NOW, deferred_at: 'NULL' }]);
        // Moving project alone sends nothing; the category it lands in does.
        expect(buildPutBody(9, filled({ machine_fk: 3, affected_repos: 'Darwin', projectId: 5 }), saved, NOW)).toBe(null);
        expect(buildPutBody(9, filled({ machine_fk: 3, affected_repos: 'Darwin', category_fk: 900 }), saved, NOW))
            .toEqual([{ id: 9, category_fk: 900 }]);
        // A blank enum is never sent, even as a change.
        expect(buildPutBody(9, filled({ machine_fk: 3, affected_repos: 'Darwin', effort: '' }), saved, NOW)).toBe(null);
    });

    it('is dirty until saved, then only when something changed', () => {
        const d = filled();
        expect(draftDirty(d, null, null)).toBe(true);
        expect(draftDirty(d, 9, savedValues(d))).toBe(false);
        expect(draftDirty({ ...d, tracking: 1 }, 9, savedValues(d))).toBe(true);
        expect(draftDirty(null, null, null)).toBe(false);
    });

    it('offers open machines in sort order, and keeps a closed pin visible', () => {
        const machines = [
            { id: 1, title: 'Zed', sort_order: null }, { id: 2, title: 'Mac', sort_order: 1 },
            { id: 3, title: 'Old', closed: 1 },
        ];
        expect(machineOptions(machines, null).map(o => o.value)).toEqual([2, 1]);
        expect(machineOptions(machines, 3).at(-1)).toEqual({ value: 3, label: 'Old (closed)' });
        expect(machineOptions(undefined, null)).toEqual([]);
    });
});

// Req #3812 — the defaults every requirement filed from the popup starts with.
describe('requirement filer defaults (req #3812)', () => {
    it('a never-set field falls back to the standard spec; a set one wins', () => {
        expect(defaultsFormValues({})).toMatchObject({ ...DEFAULT_REQUIREMENT_SPEC, projectId: null, seatStepId: null });
        expect(defaultsFormValues({ effort: 'low', ai_model: '' })).toMatchObject({ effort: 'low', ai_model: 'opus' });
    });

    it('a default place replaces the last-filed place; without one the last place stands', () => {
        expect(newRequirementDraft(1, 10, {})).toMatchObject({ projectId: 1, category_fk: 10, defaultsUnchecked: [] });
        expect(newRequirementDraft(1, 10, { projectId: 4, category_fk: 862 }))
            .toMatchObject({ projectId: 4, category_fk: 862, defaultsUnchecked: ['category'] });
    });

    it('applies the seat and marks every reference default for a live check, which holds Save', () => {
        const d = newRequirementDraft(null, null,
            { projectId: 4, category_fk: 862, machine_fk: 2, seatPipelineId: 2, seatInitiativeId: 30, seatStepId: 300 });
        expect(d).toMatchObject({ machine_fk: 2, seatPipelineId: 2, seatInitiativeId: 30, seatStepId: 300 });
        expect(d.defaultsUnchecked).toEqual(['category', 'machine', 'seat']);
        expect(draftProblem({ ...d, title: 'x' })).toBe('Checking defaults…');
        expect(draftProblem({ ...d, title: 'x', defaultsUnchecked: [] })).toBe(null);
    });

    it('the seat is never in a requirement body, but a changed seat is something to save', () => {
        const d = { ...newRequirementDraft(4, 862), title: 'x', seatStepId: 300, defaultsUnchecked: [] };
        expect(buildPostBody(d, NOW)).not.toHaveProperty('seatStepId');
        const saved = { ...savedValues(d), seatStepId: null };
        expect(buildPutBody(1, d, saved, NOW)).toBe(null);
        expect(draftDirty(d, 1, saved)).toBe(true);
        expect(draftDirty(d, 1, savedValues(d))).toBe(false);
    });

    it('staleRefs: closed or missing references, unknown until each read lands', () => {
        const index = buildOrchestrationIndex({
            pipelines: [{ id: 2, pipeline_status: 'active' }, { id: 5, pipeline_status: 'completed' }],
            initiatives: [{ id: 30, pipeline_fk: 2 }, { id: 31, pipeline_fk: 2, closed: 1 }, { id: 50, pipeline_fk: 5 }],
            steps: [{ id: 300, initiative_fk: 30 }, { id: 310, initiative_fk: 31 }, { id: 500, initiative_fk: 50 }],
            stepRequirements: [],
        });
        const data = { projects: [{ id: 4 }], categories: [{ id: 862 }],
            machines: [{ id: 2 }, { id: 3, closed: 1 }], index };
        expect(staleRefs({ projectId: 4, category_fk: 862, machine_fk: 2, seatStepId: 300 }, data))
            .toEqual({ project: null, category: null, machine: null, seat: null });
        expect(staleRefs({ projectId: 9, category_fk: 862, machine_fk: 3, seatStepId: 310 }, data)).toEqual({
            project: 'closed or deleted', category: 'its project is closed or deleted',
            machine: 'closed', seat: 'its epic is closed or deleted' });
        expect(staleRefs({ projectId: 4, category_fk: 1, machine_fk: 8, seatStepId: 500 }, data)).toEqual({
            project: null, category: 'closed or deleted', machine: 'no longer exists',
            seat: 'its pipeline is completed or deleted' });
        expect(staleRefs({ seatStepId: 999 }, data).seat).toBe('no longer exists');
        // A scope with no step.
        expect(staleRefs({ seatPipelineId: 2, seatInitiativeId: 30 }, data).seat).toBe(null);
        expect(staleRefs({ seatPipelineId: 5 }, data).seat).toBe('its pipeline is completed or deleted');
        expect(staleRefs({ seatPipelineId: 2, seatInitiativeId: 31 }, data).seat).toBe('its epic is closed or deleted');
        // A project with no category still waits for the project read.
        expect(staleRefs({ projectId: 4, category_fk: null }, {}).category).toBe(undefined);
        expect(staleRefs({ projectId: 9, category_fk: null }, data)).toMatchObject({ project: 'closed or deleted', category: null });
        // Not yet read: unknown, never valid.
        expect(staleRefs({ projectId: 4, category_fk: 862, machine_fk: 2, seatStepId: 300 }, {}))
            .toEqual({ project: undefined, category: undefined, machine: undefined, seat: undefined });
    });
});
