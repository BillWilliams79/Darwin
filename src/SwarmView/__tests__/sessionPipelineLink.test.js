// req #3455 — the plan chip must never offer a link it knows will 404.
//
// The measured failure: dev session 2730 carries pipeline_fk=79 (1.0) and
// pipeline2_fk=NULL, /swarm/pipeline/:id reads pipeline2_compose, and
// /swarm/pipeline/79 returned 404 while the same plan exists in 2.0 as id 7.

import { describe, it, expect } from 'vitest';
import { sessionPipelineLink } from '../sessionPipelineLink';

const PIPELINES = [
    { id: 79, title: 'FP Pipeline - Agent Harness' },
    { id: 80, title: 'Phase 3' },
];

describe('sessionPipelineLink', () => {
    it('links a 2.0 id, because that is what the plan route reads', () => {
        const r = sessionPipelineLink({ pipeline_fk: 79, pipeline2_fk: 7 }, PIPELINES);
        expect(r.state).toBe('link');
        expect(r.href).toBe('/swarm/pipeline/7');
    });

    it('NEVER puts a 1.0 id in the href — that is the 404', () => {
        const r = sessionPipelineLink({ pipeline_fk: 79, pipeline2_fk: null }, PIPELINES);
        expect(r.state).toBe('unlinked');
        expect(r.href).toBeNull();
    });

    it('still names the plan when it cannot link to it', () => {
        // The attribution is a fact worth showing even with nowhere to go.
        const r = sessionPipelineLink({ pipeline_fk: 79, pipeline2_fk: null }, PIPELINES);
        expect(r.label).toBe('FP Pipeline - Agent Harness');
        expect(r.title).toMatch(/no page/i);
    });

    it('falls back to an id label when the title is unresolved', () => {
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
        const bothEras = [{ id: 79, title: 'FP Pipeline - Agent Harness' }];
        const r = sessionPipelineLink({ pipeline_fk: 79, pipeline2_fk: null }, bothEras);
        expect(r.href).toBeNull();
    });

    it('tolerates a missing session or pipeline list', () => {
        expect(sessionPipelineLink(null, null).state).toBe('none');
        expect(sessionPipelineLink({ pipeline_fk: 79 }, null).label).toBe('#79');
    });
});
