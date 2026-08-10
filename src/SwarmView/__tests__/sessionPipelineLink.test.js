// req #3455 — the plan chip must never offer a link it knows will 404.
//
// WHICH id navigates is a property of PipelineDetail, and it flipped once
// during this requirement: that page briefly read the 2.0 composed endpoint
// (measured: pipeline_fk=79 -> "No pipeline with id 79", same plan being 2.0
// id 7) and now resolves against the 1.0 `pipelines` list again. These tests
// pin the CURRENT contract; if the page moves back to pipeline2_*, they are
// what should fail first.

import { describe, it, expect } from 'vitest';
import { sessionPipelineLink } from '../sessionPipelineLink';

const PIPELINES = [
    { id: 79, title: 'FP Pipeline - Agent Harness' },
    { id: 80, title: 'Phase 3' },
];
const PIPELINES2 = [{ id: 7, title: 'FP Pipeline - Agent Harness (2.0)' }];

describe('sessionPipelineLink', () => {
    it('links the 1.0 id, because that is what the plan page resolves', () => {
        const r = sessionPipelineLink({ pipeline_fk: 79, pipeline2_fk: 7 }, PIPELINES, PIPELINES2);
        expect(r.state).toBe('link');
        expect(r.href).toBe('/swarm/pipeline/79');
    });

    it('NEVER puts a 2.0 id in the href while the page reads 1.0', () => {
        const r = sessionPipelineLink({ pipeline_fk: null, pipeline2_fk: 7 }, PIPELINES, PIPELINES2);
        expect(r.state).toBe('unlinked');
        expect(r.href).toBeNull();
    });

    it('still names the plan when it cannot link to it', () => {
        // The attribution is a fact worth showing even with nowhere to go, and
        // a bare "#7" names a row no page in the app lists.
        const r = sessionPipelineLink({ pipeline_fk: null, pipeline2_fk: 7 }, PIPELINES, PIPELINES2);
        expect(r.label).toBe('FP Pipeline - Agent Harness (2.0)');
        expect(r.title).toMatch(/does not serve/i);
    });

    it('prefers the 1.0 title when both eras name the session', () => {
        // The label must describe the plan the href actually opens.
        const r = sessionPipelineLink({ pipeline_fk: 79, pipeline2_fk: 7 }, PIPELINES, PIPELINES2);
        expect(r.label).toBe('FP Pipeline - Agent Harness');
    });

    it('falls back to an id label when no title resolves', () => {
        expect(sessionPipelineLink({ pipeline_fk: 999, pipeline2_fk: null }, PIPELINES).label)
            .toBe('#999');
        expect(sessionPipelineLink({ pipeline_fk: null, pipeline2_fk: 7 }, PIPELINES).label)
            .toBe('#7');
    });

    it('renders nothing for a session outside any plan', () => {
        const r = sessionPipelineLink({ pipeline_fk: null, pipeline2_fk: null }, PIPELINES);
        expect(r.state).toBe('none');
        expect(r.label).toBeNull();
    });

    it('does not bridge eras by title match', () => {
        // Plan titles collide in live data; a wrong bridge opens a DIFFERENT
        // plan, which is worse than opening nothing.
        const r = sessionPipelineLink({ pipeline_fk: null, pipeline2_fk: 7 },
                                      [{ id: 79, title: 'FP Pipeline - Agent Harness (2.0)' }],
                                      PIPELINES2);
        expect(r.href).toBeNull();
    });

    it('tolerates a missing session or pipeline list', () => {
        expect(sessionPipelineLink(null, null).state).toBe('none');
        expect(sessionPipelineLink({ pipeline_fk: 79 }, null).label).toBe('#79');
    });
});
