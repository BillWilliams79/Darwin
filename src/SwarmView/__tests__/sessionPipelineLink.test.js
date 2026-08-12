// req #3455 — the plan chip must never offer a link it knows will 404.
//
// WHICH id navigates was a property of PipelineDetail and it flipped twice
// during #3455/#3462/#3463 (measured: `pipeline_fk=79` -> "No pipeline with id
// 79", the same plan being 2.0 id 7). req #3463 settled it by giving each era
// its own route; req #3356 settled it further by eradicating Pipeline 1.0, so
// there is one attribution column left and one route it opens.
//
// THESE TESTS WERE STALE BEFORE THIS CHANGE. Three of them still asserted the
// pre-#3463 contract — that a 2.0-seated session is `unlinked` because the plan
// page "does not serve" 2.0 — and were failing on `main` (measured 2026-08-12,
// 3 failed / 6 passed). They now pin the CURRENT contract; if the resolver ever
// grows a second era back, they are what should fail first.

import { describe, it, expect } from 'vitest';
import { sessionPipelineLink } from '../sessionPipelineLink';

const PIPELINES2 = [{ id: 7, title: 'FP Pipeline - Agent Harness (2.0)' }];

describe('sessionPipelineLink', () => {
    it('links the 2.0 id at the 2.0 route', () => {
        const r = sessionPipelineLink({ pipeline2_fk: 7 }, PIPELINES2);
        expect(r.state).toBe('link');
        expect(r.href).toBe('/swarm/pipeline2/7');
        expect(r.planId).toBe(7);
    });

    it('names the plan from the 2.0 list', () => {
        const r = sessionPipelineLink({ pipeline2_fk: 7 }, PIPELINES2);
        expect(r.label).toBe('FP Pipeline - Agent Harness (2.0)');
        expect(r.title).toMatch(/Open Pipeline 2\.0 plan/);
    });

    it('falls back to an id label when no title resolves', () => {
        expect(sessionPipelineLink({ pipeline2_fk: 999 }, PIPELINES2).label).toBe('#999');
    });

    it('renders nothing for a session outside any plan', () => {
        const r = sessionPipelineLink({ pipeline2_fk: null }, PIPELINES2);
        expect(r.state).toBe('none');
        expect(r.label).toBeNull();
        expect(r.href).toBeNull();
    });

    // req #3356 — a 1.0-only session is a HISTORICAL row whose plan no longer
    // has a page. Reading `pipeline_fk` as a fallback would build a 2.0 link out
    // of a 1.0 id, which is req #3462 exactly: the id spaces are disjoint, so
    // that link opens a DIFFERENT plan. `none` is the honest answer.
    it('ignores a 1.0-only attribution entirely — never bridges the id spaces', () => {
        const r = sessionPipelineLink({ pipeline_fk: 79, pipeline2_fk: null }, PIPELINES2);
        expect(r.state).toBe('none');
        expect(r.href).toBeNull();
        expect(r.planId).toBeNull();
    });

    // A row carrying BOTH is a data defect; the 2.0 column is the one that
    // resolves, and the 1.0 id must not leak into the label or the href.
    it('takes the 2.0 column when a defective row carries both', () => {
        const r = sessionPipelineLink({ pipeline_fk: 79, pipeline2_fk: 7 }, PIPELINES2);
        expect(r.planId).toBe(7);
        expect(r.href).toBe('/swarm/pipeline2/7');
    });

    // Not the era question — a malformed id is unnavigable in any era.
    it('reports an unusable id as unlinked rather than building a path', () => {
        const r = sessionPipelineLink({ pipeline2_fk: '12abc' }, PIPELINES2);
        expect(r.state).toBe('unlinked');
        expect(r.href).toBeNull();
    });

    it('tolerates a missing session or pipeline list', () => {
        expect(sessionPipelineLink(null, null).state).toBe('none');
        expect(sessionPipelineLink({ pipeline2_fk: 7 }, null).label).toBe('#7');
    });
});
