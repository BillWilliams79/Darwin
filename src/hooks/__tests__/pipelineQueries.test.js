// Req #3114 — Swarm Orchestration pipelines data layer: key shapes + hook
// exports. Mirrors the devopsQueriesParity / machinesQueries pattern for the
// newest four factory entities, plus the hand-written epics hooks that sit with
// the features hooks in useDataQueries.js.
//
// Beyond shape, two things here are LOAD-BEARING and pinned deliberately:
//   * pipeline_steps must sort id:asc — displayOrder()'s deterministic final
//     tie-break is the row's position in the input array, so "canonical stored
//     order" has to be requested, not hoped for;
//   * pipeline_step_requirements must never project an `id` column — it is a
//     composite-PK junction and has none.

import { describe, it, expect } from 'vitest';
import {
    pipelines,
    pipelineSteps,
    pipelineStepRequirements,
    pipelineStepDeps,
} from '../factory/devopsQueries';
import {
    pipelineKeys,
    pipelineStepKeys,
    pipelineStepRequirementKeys,
    pipelineStepDepKeys,
    epicKeys,
} from '../useQueryKeys';
import {
    useAllPipelines,
    useAllPipelineSteps,
    useAllPipelineStepRequirements,
    useAllPipelineStepDeps,
    useAllEpics,
    useEpicById,
    ALL_ROWS,
} from '../useDataQueries';

describe('pipeline key shapes', () => {
    it('pipelineKeys.all(creator) → ["pipelines", creator]', () => {
        expect(pipelineKeys.all('alice')).toEqual(['pipelines', 'alice']);
    });
    it('pipelineKeys.byId(creator, id) → ["pipelines", creator, { id }]', () => {
        expect(pipelineKeys.byId('alice', 7)).toEqual(['pipelines', 'alice', { id: 7 }]);
    });
    it('byId is prefix-compatible with all() for invalidation', () => {
        const allKey = pipelineKeys.all('alice');
        expect(pipelineKeys.byId('alice', 7).slice(0, allKey.length)).toEqual(allKey);
    });
    it('pipelineStepKeys.all(creator) → ["pipeline_steps", creator]', () => {
        expect(pipelineStepKeys.all('alice')).toEqual(['pipeline_steps', 'alice']);
    });
    it('pipelineStepRequirementKeys.all(creator) → ["pipeline_step_requirements", creator]', () => {
        expect(pipelineStepRequirementKeys.all('alice'))
            .toEqual(['pipeline_step_requirements', 'alice']);
    });
    it('pipelineStepDepKeys.all(creator) → ["pipeline_step_deps", creator]', () => {
        expect(pipelineStepDepKeys.all('alice')).toEqual(['pipeline_step_deps', 'alice']);
    });
});

describe('epic key shapes', () => {
    it('all(creator) → ["epics", creator]', () => {
        expect(epicKeys.all('alice')).toEqual(['epics', 'alice']);
    });
    it('byId(creator, id) → ["epics", creator, { id }]', () => {
        expect(epicKeys.byId('alice', 4)).toEqual(['epics', 'alice', { id: 4 }]);
    });
    it('byId is prefix-compatible with all() for invalidation', () => {
        const allKey = epicKeys.all('alice');
        expect(epicKeys.byId('alice', 4).slice(0, allKey.length)).toEqual(allKey);
    });
});

describe('hook exports', () => {
    it('every pipeline hook is a function', () => {
        for (const hook of [useAllPipelines, useAllPipelineSteps,
            useAllPipelineStepRequirements, useAllPipelineStepDeps]) {
            expect(typeof hook).toBe('function');
        }
    });
    it('every epic hook is a function', () => {
        expect(typeof useAllEpics).toBe('function');
        expect(typeof useEpicById).toBe('function');
    });
});

describe('projection + sort contracts', () => {
    it('pipeline_steps is read in canonical stored order (id ascending)', () => {
        // Not cosmetic: pipelineModel.displayOrder() uses input-array position as
        // its final deterministic tie-break, so an unordered read could re-order
        // the plan between renders.
        expect(pipelineSteps.config.defaultSort).toBe('id:asc');
    });

    it('pipelines lists newest first', () => {
        expect(pipelines.config.defaultSort).toBe('id:desc');
    });

    it('pipeline_step_requirements never asks for an id column', () => {
        // Composite PK (step_fk, requirement_fk) — the table has no id, and
        // requesting one makes Lambda-Rest 400 the whole read.
        expect(pipelineStepRequirements.config.defaultFields).toBe('step_fk,requirement_fk');
    });

    it('pipeline_step_deps projects both condition kinds', () => {
        // Exactly one of dep_step_fk / time_at is set per row; a dual-condition
        // gate is two rows on one step, so both columns must come back.
        expect(pipelineStepDeps.config.defaultFields).toContain('dep_step_fk');
        expect(pipelineStepDeps.config.defaultFields).toContain('time_at');
    });

    it('pipeline_steps projects no state and no seq column', () => {
        // Rules 1 and 3: neither exists in the schema. A projection naming one
        // would 400 the read AND signal that someone re-introduced stored state.
        expect(pipelineSteps.config.defaultFields).not.toMatch(/\bstate\b|\bstatus\b|\bseq\b|sort_order/);
    });

    it('pipeline reads carry no session columns', () => {
        // Design rule 9: requirement-centric views carry NO session data.
        const projections = [
            pipelines.config.defaultFields,
            pipelineSteps.config.defaultFields,
            pipelineStepRequirements.config.defaultFields,
            pipelineStepDeps.config.defaultFields,
        ].join(',');
        expect(projections).not.toMatch(/session/);
    });

    it('every pipeline block carries the fields-in-key collision guard', () => {
        // Req #2213 / #3015: without it, two callers with different projections
        // share one cache entry and the narrower fetch can win — silently, as a
        // blank column. It has to be in place BEFORE the second caller exists.
        for (const block of [pipelines, pipelineSteps, pipelineStepRequirements,
            pipelineStepDeps]) {
            expect(block.config.fieldsInKey).toBe(true);
        }
    });
});

describe('ALL_ROWS — the unfiltered-read sentinel', () => {
    it('survives the JSON.stringify a query-key hash performs', () => {
        // `undefined` does NOT: JSON.stringify drops undefined-valued properties,
        // so { fields, closed: undefined } and { fields } hash IDENTICALLY and two
        // reads with different URLs would silently share one cache entry. This is
        // the whole reason the sentinel is a string.
        expect(JSON.stringify({ fields: 'f', closed: ALL_ROWS }))
            .not.toBe(JSON.stringify({ fields: 'f' }));
        expect(JSON.stringify({ fields: 'f', closed: undefined }))
            .toBe(JSON.stringify({ fields: 'f' }));
    });

    it('is distinguishable from the closed=0 default', () => {
        expect(JSON.stringify({ closed: ALL_ROWS })).not.toBe(JSON.stringify({ closed: 0 }));
    });
});
