// @vitest-environment node
//
// req #3393 — the completion-guard model behind /swarm/steps2. Pure functions,
// no DOM needed.

import { describe, it, expect } from 'vitest';
import {
    isTrackingRequirement2,
    gatingRequirementIds2,
    completionGuard2,
    dropBlockers2,
    buildStep2Rows,
} from '../steps2Model';

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

describe('completionGuard2', () => {
    it('allows a link-less step', () => {
        const result = completionGuard2({ gatingReqIds: [], completedAt: null });
        expect(result.allowed).toBe(true);
        expect(result.reason).toContain('Open');
    });

    it('allows a step whose only links are tracking containers, naming the exemption', () => {
        const result = completionGuard2({
            gatingReqIds: [], trackingReqIds: [42], completedAt: null,
        });
        expect(result.allowed).toBe(true);
    });

    it('refuses a step with any real gating requirement, naming the ids', () => {
        const result = completionGuard2({ gatingReqIds: [10, 11], trackingReqIds: [] });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('10, 11');
    });

    it('names exempted tracking containers alongside a refusal', () => {
        const result = completionGuard2({ gatingReqIds: [10], trackingReqIds: [42] });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('42');
        expect(result.reason).toContain('exempt');
    });

    it('offers to reopen an already-complete step regardless of gating', () => {
        const result = completionGuard2({ gatingReqIds: [], completedAt: '2026-08-01 00:00:00' });
        expect(result.allowed).toBe(true);
        expect(result.reason).toContain('reopen');
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

describe('buildStep2Rows', () => {
    const steps = [
        { id: 100, epic_fk: 1, title: 'Gated', run: 'auto', completed_at: null, not_before: null },
        { id: 101, epic_fk: 1, title: 'Free', run: 'manual', completed_at: null, not_before: null },
        { id: 102, epic_fk: 2, title: 'Done', run: 'auto', completed_at: '2026-08-01 00:00:00', not_before: null },
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
    const epics = [
        { id: 1, title: 'Epic One', pipeline_fk: 9 },
        { id: 2, title: 'Epic Two', pipeline_fk: 9 },
    ];

    it('splits a step\'s links into gating and tracking', () => {
        const rows = buildStep2Rows({ steps, stepRequirements, stepDeps, requirements, epics });
        const gated = rows.find(r => r.id === 100);
        expect(gated.gatingReqIds).toEqual([1]);
        expect(gated.trackingReqIds).toEqual([2]);
        expect(gated.reqIds).toEqual([1, 2]);
    });

    it('carries the epic label and pipeline_fk through', () => {
        const rows = buildStep2Rows({ steps, stepRequirements, stepDeps, requirements, epics });
        const row = rows.find(r => r.id === 100);
        expect(row.epicTitle).toBe('Epic One');
        expect(row.pipelineFk).toBe(9);
    });

    it('reports blockerStepIds for a step something else depends on', () => {
        const rows = buildStep2Rows({ steps, stepRequirements, stepDeps, requirements, epics });
        expect(rows.find(r => r.id === 100).blockerStepIds).toEqual([101]);
        expect(rows.find(r => r.id === 101).blockerStepIds).toEqual([]);
    });

    it('normalizes completedAt from completed_at', () => {
        const rows = buildStep2Rows({ steps, stepRequirements, stepDeps, requirements, epics });
        expect(rows.find(r => r.id === 102).completedAt).toBe('2026-08-01 00:00:00');
        expect(rows.find(r => r.id === 100).completedAt).toBeNull();
    });

    it('handles an unresolved epic gracefully (no throw, null label)', () => {
        const rows = buildStep2Rows({
            steps: [{ id: 200, epic_fk: 999, title: 'Orphan', run: 'auto', completed_at: null }],
            stepRequirements: [], stepDeps: [], requirements: [], epics,
        });
        expect(rows[0].epicTitle).toBeNull();
        expect(rows[0].pipelineFk).toBeNull();
    });
});
