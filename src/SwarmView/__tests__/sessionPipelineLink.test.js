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
import { buildOrchestrationIndex } from '../detail/orchestrationIndex';

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
            .toEqual(['state', 'planId', 'label', 'title', 'href', 'initiativeLabel', 'epicLabel']);
    });
});

// req #3724 — the sessions table's pill names plan › initiative › epic.
describe('sessionPipelineLink — initiative and epic placement', () => {
    const INDEX = buildOrchestrationIndex({
        pipelines: [{ id: 7, title: 'Plan A', pipeline_status: 'orchestrating' },
                    { id: 8, title: 'Plan B', pipeline_status: 'orchestrating' }],
        initiatives: [{ id: 30, pipeline_fk: 7, title: 'Initiative One' },
                { id: 31, pipeline_fk: 7, title: 'Initiative Two' },
                { id: 40, pipeline_fk: 8, title: 'Other Initiative' }],
        epics: [{ id: 300, initiative_fk: 30, title: 'Epic Alpha' },
                { id: 310, initiative_fk: 31, title: 'Epic Beta' },
                { id: 400, initiative_fk: 40, title: 'Epic Elsewhere' }],
        epicRequirements: [{ epic_fk: 300, requirement_fk: 1001 },
                           { epic_fk: 310, requirement_fk: 1002 },
                           { epic_fk: 400, requirement_fk: 1003 }],
    });
    const PL = [{ id: 7, title: 'Plan A' }, { id: 8, title: 'Plan B' }];

    it('names the stamped initiative and the requirement seat epic', () => {
        const r = sessionPipelineLink({ pipeline_fk: 7, initiative_fk: 30 }, PL,
            { index: INDEX, requirementId: '1001' });
        expect(r.label).toBe('Plan A');
        expect(r.initiativeLabel).toBe('Initiative One');
        expect(r.epicLabel).toBe('Epic Alpha');
        expect(r.title).toBe('Open plan Plan A — Initiative: Initiative One · Epic: Epic Alpha');
    });

    it('falls back to the seat initiative when the session carries no initiative stamp', () => {
        const r = sessionPipelineLink({ pipeline_fk: 7, initiative_fk: null }, PL,
            { index: INDEX, requirementId: 1002 });
        expect(r.initiativeLabel).toBe('Initiative Two');
        expect(r.epicLabel).toBe('Epic Beta');
    });

    it('omits an epic seated in a different plan', () => {
        const r = sessionPipelineLink({ pipeline_fk: 7, initiative_fk: 30 }, PL,
            { index: INDEX, requirementId: 1003 });
        expect(r.initiativeLabel).toBe('Initiative One');
        expect(r.epicLabel).toBeNull();
    });

    it('omits an epic seated under a different initiative than the stamped one', () => {
        const r = sessionPipelineLink({ pipeline_fk: 7, initiative_fk: 30 }, PL,
            { index: INDEX, requirementId: 1002 });
        expect(r.initiativeLabel).toBe('Initiative One');
        expect(r.epicLabel).toBeNull();
    });

    it('falls back to id labels for unread initiative rows', () => {
        const r = sessionPipelineLink({ pipeline_fk: 7, initiative_fk: 99 }, PL,
            { index: INDEX, requirementId: null });
        expect(r.initiativeLabel).toBe('Initiative #99');
        expect(r.epicLabel).toBeNull();
    });

    it('reports no placement without an index — plan fields unchanged', () => {
        const r = sessionPipelineLink({ pipeline_fk: 7, initiative_fk: 30 }, PL);
        expect(r.initiativeLabel).toBeNull();
        expect(r.epicLabel).toBeNull();
        expect(r.title).toBe('Open plan Plan A');
    });
});
