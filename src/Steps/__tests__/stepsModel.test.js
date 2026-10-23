// @vitest-environment node
//
// req #3393 — the row model behind /swarm/steps. Pure functions,
// no DOM needed.

import { describe, it, expect } from 'vitest';
import {
    isTrackingRequirement2,
    gatingRequirementIds2,
    dropBlockers2,
    buildStepRows,
} from '../stepsModel';

describe('isTrackingRequirement2', () => {
    it('is false for a missing/null/empty tracking value', () => {
        expect(isTrackingRequirement2(null)).toBe(false);
        expect(isTrackingRequirement2(undefined)).toBe(false);
        expect(isTrackingRequirement2({ tracking: null })).toBe(false);
        expect(isTrackingRequirement2({ tracking: '' })).toBe(false);
    });

    it('reads a boolean, a numeric string, and an int the same way', () => {
        expect(isTrackingRequirement2({ tracking: true })).toBe(true);
        expect(isTrackingRequirement2({ tracking: false })).toBe(false);
        expect(isTrackingRequirement2({ tracking: 1 })).toBe(true);
        expect(isTrackingRequirement2({ tracking: '1' })).toBe(true);
        expect(isTrackingRequirement2({ tracking: 0 })).toBe(false);
    });
});

describe('gatingRequirementIds2', () => {
    const requirements = [
        { id: 1, tracking: 0 },
        { id: 2, tracking: 1 },
        { id: 3, tracking: 0 },
    ];

    it('filters out tracking containers', () => {
        expect(gatingRequirementIds2([1, 2, 3], requirements)).toEqual([1, 3]);
    });

    it('treats an unresolved id as gating (the recoverable direction)', () => {
        expect(gatingRequirementIds2([1, 99], requirements)).toEqual([1, 99]);
    });

    it('returns empty for an empty or all-container link set', () => {
        expect(gatingRequirementIds2([], requirements)).toEqual([]);
        expect(gatingRequirementIds2([2], requirements)).toEqual([]);
    });
});

describe('dropBlockers2', () => {
    const deps = [
        { id: 1, step_fk: 20, dep_step_fk: 10 },
        { id: 2, step_fk: 21, dep_step_fk: 10 },
        { id: 3, step_fk: 22, dep_step_fk: 11 },
    ];

    it('names every step that depends on the given step, sorted and de-duplicated', () => {
        expect(dropBlockers2(10, deps)).toEqual([20, 21]);
    });

    it('returns empty for a step nothing depends on', () => {
        expect(dropBlockers2(99, deps)).toEqual([]);
    });

    it('counts a self-dependency, matching InnoDB RESTRICT evaluation', () => {
        expect(dropBlockers2(10, [{ id: 1, step_fk: 10, dep_step_fk: 10 }])).toEqual([10]);
    });
});

describe('buildStepRows', () => {
    const steps = [
        { id: 100, initiative_fk: 1, title: 'Gated', run: 'auto', not_before: null },
        { id: 101, initiative_fk: 1, title: 'Free', run: 'manual', not_before: null },
        { id: 102, initiative_fk: 2, title: 'Done', run: 'auto', not_before: null },
    ];
    const stepRequirements = [
        { step_fk: 100, requirement_fk: 1 },
        { step_fk: 100, requirement_fk: 2 },  // container
    ];
    const stepDeps = [
        { id: 1, step_fk: 101, dep_step_fk: 100 },
    ];
    const requirements = [
        { id: 1, tracking: 0 },
        { id: 2, tracking: 1 },
    ];
    const initiatives = [
        { id: 1, title: 'Initiative One', pipeline_fk: 9 },
        { id: 2, title: 'Initiative Two', pipeline_fk: 9 },
    ];

    it('splits a step\'s links into gating and tracking', () => {
        const rows = buildStepRows({ steps, stepRequirements, stepDeps, requirements, initiatives });
        const gated = rows.find(r => r.id === 100);
        expect(gated.gatingReqIds).toEqual([1]);
        expect(gated.trackingReqIds).toEqual([2]);
        expect(gated.reqIds).toEqual([1, 2]);
    });

    it('carries the initiative label and pipeline_fk through', () => {
        const rows = buildStepRows({ steps, stepRequirements, stepDeps, requirements, initiatives });
        const row = rows.find(r => r.id === 100);
        expect(row.initiativeTitle).toBe('Initiative One');
        expect(row.pipelineFk).toBe(9);
    });

    it('resolves the pipeline label through the initiative (req #3750)', () => {
        const pipelines = [{ id: 9, title: 'Plan Nine' }];
        const rows = buildStepRows({
            steps, stepRequirements, stepDeps, requirements, initiatives, pipelines });
        expect(rows.find(r => r.id === 100).pipelineTitle).toBe('Plan Nine');
        // No pipelines read supplied → no label, never a throw.
        const bare = buildStepRows({ steps, stepRequirements, stepDeps, requirements, initiatives });
        expect(bare.find(r => r.id === 100).pipelineTitle).toBeNull();
    });

    it('reports blockerStepIds for a step something else depends on', () => {
        const rows = buildStepRows({ steps, stepRequirements, stepDeps, requirements, initiatives });
        expect(rows.find(r => r.id === 100).blockerStepIds).toEqual([101]);
        expect(rows.find(r => r.id === 101).blockerStepIds).toEqual([]);
    });

    it('handles an unresolved initiative gracefully (no throw, null label)', () => {
        const rows = buildStepRows({
            steps: [{ id: 200, initiative_fk: 999, title: 'Orphan', run: 'auto' }],
            stepRequirements: [], stepDeps: [], requirements: [], initiatives,
        });
        expect(rows[0].initiativeTitle).toBeNull();
        expect(rows[0].pipelineFk).toBeNull();
    });
});
