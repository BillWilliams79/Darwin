// epicZoomFixture.js — the plan the epic name's two-state zoom is pinned
// against (req #3297).
//
// Built rather than borrowed: the Substrate Rebuild fixture derives NO launch
// batches at all (`plan.batches` is `[]`, asserted in pipelinePlanLayout.test.js),
// and this feature is entirely about batches. Shared by
// `pipelinePlanLayout.test.js` (the geometry) and `pipelineEpicZoom.test.js`
// (the selection and the cycle) so both halves reason about the SAME plan —
// a fit that frames a batch the selector would never pick proves nothing.
//
// What it deliberately contains, and why each piece is there:
//
//   band 0, epic 11  — TWO batches, so "lowest letter first" has something to
//                      choose between, and batch A spans TWO COLUMNS, so the
//                      geometry has to union its segments rather than fit one.
//                      A's mates share an EMPTY remaining gate at different
//                      depths (step 4 has none, steps 2 and 3 are gated by an
//                      already-Complete step) — the live case req #3188 found;
//                      B's mates are gated by step 5, which is still pending,
//                      so it is a genuinely later batch.
//   band 1, epic 12  — ONE step, no batch. Requirement item 6's "a band with no
//                      lettered batch", which must be an honest no-op.
//   band 2, no epic  — the completed gate step. `band.key` is null here, which
//                      is the `epicCycleKey` case that has to be a string.
//
// Derived facts, so a reader does not have to run it: batches are
// A = [4, 5, 2, 3] and B = [6, 7]; `layout.batchBoxes` is three segments —
// A at depths 0 and 1, B at depth 1 — all in band 0.

import { MACHINES } from './substrateRebuildFixture';

export const EPIC_ZOOM_READS = {
    steps: [
        { id: 1, pipeline_fk: 1, title: 'done gate', run: 'auto', notes: null,
            completed_at: '2026-07-01T00:00:00' },
        { id: 2, pipeline_fk: 1, title: 'A one', run: 'auto', notes: null, completed_at: null },
        { id: 3, pipeline_fk: 1, title: 'A two', run: 'auto', notes: null, completed_at: null },
        { id: 4, pipeline_fk: 1, title: 'A ungated', run: 'auto', notes: null, completed_at: null },
        { id: 5, pipeline_fk: 1, title: 'A ungated too', run: 'auto', notes: null, completed_at: null },
        { id: 6, pipeline_fk: 1, title: 'B one', run: 'auto', notes: null, completed_at: null },
        { id: 7, pipeline_fk: 1, title: 'B two', run: 'auto', notes: null, completed_at: null },
        { id: 8, pipeline_fk: 1, title: 'lonely', run: 'auto', notes: null, completed_at: null },
    ],
    stepRequirements: [
        { step_fk: 2, requirement_fk: 900 }, { step_fk: 3, requirement_fk: 901 },
        { step_fk: 4, requirement_fk: 903 }, { step_fk: 5, requirement_fk: 904 },
        { step_fk: 6, requirement_fk: 905 }, { step_fk: 7, requirement_fk: 906 },
        { step_fk: 8, requirement_fk: 902 },
    ],
    stepDeps: [
        { id: 1, step_fk: 2, dep_step_fk: 1, time_at: null },
        { id: 2, step_fk: 3, dep_step_fk: 1, time_at: null },
        // 4 and 5 have no gate at all — same REMAINING gate as 2 and 3, one
        // column earlier. That is what makes batch A two segments wide.
        { id: 4, step_fk: 6, dep_step_fk: 5, time_at: null },
        { id: 5, step_fk: 7, dep_step_fk: 5, time_at: null },
    ],
    requirements: [
        { id: 900, requirement_status: 'approved', machine_fk: 2, feature_fk: 101 },
        { id: 901, requirement_status: 'approved', machine_fk: 2, feature_fk: 101 },
        { id: 902, requirement_status: 'approved', machine_fk: 2, feature_fk: 102 },
        { id: 903, requirement_status: 'approved', machine_fk: 2, feature_fk: 101 },
        { id: 904, requirement_status: 'approved', machine_fk: 2, feature_fk: 101 },
        { id: 905, requirement_status: 'approved', machine_fk: 2, feature_fk: 101 },
        { id: 906, requirement_status: 'approved', machine_fk: 2, feature_fk: 101 },
    ],
    features: [
        { id: 101, title: 'Wave One', epic_fk: 11 },
        { id: 102, title: 'Wave Two', epic_fk: 12 },
    ],
    epics: [
        { id: 11, title: 'Epic One' },
        { id: 12, title: 'Epic Two' },
    ],
    machines: MACHINES,
};

export const EPIC_ZOOM_PIPELINE = {
    id: 1, title: 'x', pipeline_status: 'active', machine_fk: 2,
};

export const EPIC_ZOOM_NOW = '2026-07-27T03:00:00Z';
