// req #3455 — the plan chip must never offer a link it knows will 404.
//
// WHICH id navigates was a property of PipelineDetail and it flipped twice
// during #3455/#3462/#3463 (measured: one era's `pipeline_fk=79` gave "No
// pipeline with id 79" while the same plan existed in the other era as id 7).
// req #3463 settled it by giving each era its own route; req #3356 settled it
// permanently by ERADICATING the older era — its tables were dropped and the
// survivor's were renamed into the vacated names — so `swarm_sessions` carries
// ONE plan attribution column and there is ONE route it opens.
//
// WHAT WENT FROM THIS FILE, AND WHY IT IS NOT A LOST ASSERTION. Two cases here
// existed only to pin ERA ARBITRATION — "ignore a 1.0-only stamp" and "take the
// 2.0 column when a row carries both". Both constructed a session object with
// BOTH era columns set, and the schema rename collapsed each of those literals
// into a DUPLICATE OBJECT KEY (`{ pipeline_fk: 79, pipeline_fk: 7 }`), where JS
// silently keeps the last. They therefore stopped testing arbitration the moment
// the rename landed, and there is no arbitration left to test: one column cannot
// disagree with itself. They are DELETED rather than repaired into restatements
// of the two cases below.

import { describe, it, expect } from 'vitest';
import { sessionPipelineLink } from '../sessionPipelineLink';

const PIPELINES = [{ id: 7, title: 'FP Pipeline - Agent Harness (2.0)' }];

describe('sessionPipelineLink', () => {
    it('links the seated plan id at the plan route', () => {
        const r = sessionPipelineLink({ pipeline_fk: 7 }, PIPELINES);
        expect(r.state).toBe('link');
        expect(r.href).toBe('/swarm/pipeline/7');
        expect(r.planId).toBe(7);
    });

    it('names the plan from the pipelines list', () => {
        const r = sessionPipelineLink({ pipeline_fk: 7 }, PIPELINES);
        expect(r.label).toBe('FP Pipeline - Agent Harness (2.0)');
        // No era in the words either: `Open Pipeline 2.0 plan …` named a
        // distinction the reader can no longer draw.
        expect(r.title).toBe('Open plan FP Pipeline - Agent Harness (2.0)');
    });

    it('falls back to an id label when no title resolves', () => {
        expect(sessionPipelineLink({ pipeline_fk: 999 }, PIPELINES).label).toBe('#999');
    });

    // KEPT THROUGH THE ERA COLLAPSE. NULL is a real answer — work outside any
    // plan — and it is also what a historical row stamped only in the dropped
    // era now reports, so this is the file's only coverage of "no plan
    // attribution reports none".
    it('renders nothing for a session outside any plan', () => {
        const r = sessionPipelineLink({ pipeline_fk: null }, PIPELINES);
        expect(r.state).toBe('none');
        expect(r.label).toBeNull();
        expect(r.href).toBeNull();
        expect(r.planId).toBeNull();
    });

    // Never the era question — a malformed id is unnavigable however many eras
    // there are, so this survives the collapse unchanged.
    it('reports an unusable id as unlinked rather than building a path', () => {
        const r = sessionPipelineLink({ pipeline_fk: '12abc' }, PIPELINES);
        expect(r.state).toBe('unlinked');
        expect(r.href).toBeNull();
    });

    it('tolerates a missing session or pipeline list', () => {
        expect(sessionPipelineLink(null, null).state).toBe('none');
        expect(sessionPipelineLink({ pipeline_fk: 7 }, null).label).toBe('#7');
    });

    // The resolver reports no `era` field at all now. Pinned so a future second
    // plan surface has to re-open this file deliberately rather than growing an
    // era back by accident on one caller.
    it('reports no era field — there is one plan surface', () => {
        expect(Object.keys(sessionPipelineLink({ pipeline_fk: 7 }, PIPELINES)))
            .toEqual(['state', 'planId', 'label', 'title', 'href']);
    });
});
