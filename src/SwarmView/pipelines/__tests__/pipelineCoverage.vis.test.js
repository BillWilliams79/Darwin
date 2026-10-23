// pipelineCoverage.vis.test.js — two stated visualizer behaviours whose tests
// went with the files req #3356 deleted (`pipelineModel.test.js`,
// `pipelineViewModel.test.js`), restated against the model the canvas draws
// today: the adapter's `buildPlanRows` over a composed read (req #3783).

import { describe, it, expect } from 'vitest';

import { buildPlanRows } from '../pipelineAdapter';
import { composedFixture } from './pipelineComposedFixture';

const payload = () => composedFixture({
    initiatives: [
        { id: 5, title: 'Shipped', pipeline_fk: 2, sort_order: 1 },
        { id: 6, title: 'In flight', pipeline_fk: 2, sort_order: 2 },
    ],
    epics: [
        { id: 70, initiative_fk: 5, title: 'Design', run: 'auto', notes: null, not_before: null },
        { id: 71, initiative_fk: 5, title: 'Build', run: 'auto', notes: null, not_before: null },
        { id: 72, initiative_fk: 6, title: 'Release', run: 'manual', notes: null, not_before: null },
    ],
    requirements: [
        { id: 3001, requirement_status: 'met' },
        { id: 3002, requirement_status: 'swarm_ready' },
    ],
    epicRequirements: [
        { epic_fk: 70, requirement_fk: 3001 },
        { epic_fk: 72, requirement_fk: 3002 },
    ],
    epicDeps: [{ id: 1, epic_fk: 71, dep_epic_fk: 70 }],
});

describe('VIS-001 — every epic renders under exactly one initiative', () => {
    // COVERS: VIS-001
    it('gives each row one initiative id and one label, and it is the epic\'s own', () => {
        const rows = buildPlanRows(payload(), []);
        expect(rows.map((r) => r.id)).toEqual([70, 71, 72]);
        const owner = { 70: 5, 71: 5, 72: 6 };
        for (const row of rows) {
            expect(row.initiativeId).toBe(owner[row.id]);
            expect(row.initiativeLabels).toHaveLength(1);
            expect(row.initiativeLabels[0].id).toBe(owner[row.id]);
            expect(row.labelInherited).toBe(false);
        }
    });
});

describe('VIS-004 — no retired grouping tier appears in the render model', () => {
    // COVERS: VIS-004
    it('carries no feature-tier field on any row', () => {
        for (const row of buildPlanRows(payload(), [])) {
            for (const key of Object.keys(row)) {
                expect(key.toLowerCase()).not.toMatch(/feature/);
            }
        }
    });
});
