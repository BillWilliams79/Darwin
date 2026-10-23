// initiativeZoomFixture.js — the plan the initiative name's two-state zoom is pinned
// against (req #3297; re-pointed at the STEP by req #3371).
//
// Built rather than borrowed: the Substrate Rebuild fixture has a single
// eligible step and no interesting band shape, and this feature is entirely
// about WHICH step a band launches next. Used by `pipelineInitiativeZoom.test.js`
// (the selection and the cycle).
//
// What it deliberately contains, and why each piece is there:
//
//   band 0, initiative 11  — SIX steps across two columns, several of them eligible,
//                      so "earliest in display order" has something to choose
//                      between and a suppression test has a second candidate to
//                      fall through to. Steps 4 and 5 have no gate at all;
//                      2 and 3 are gated by an already-Complete step (so they
//                      are eligible too, one column further right); 6 and 7 are
//                      gated by the still-pending step 5, so they are NOT.
//   band 1, initiative 12  — ONE step, eligible. The single-candidate case.
//   band 2, no initiative  — the completed gate step (its one requirement is `met`
//                      and carries no initiative label — a step has no completion
//                      stamp, req #3750/#3752), and the only band with NOTHING
//                      eligible: requirement item 6's honest no-op. `band.key`
//                      is null here, which is the `initiativeCycleKey` case that has
//                      to be a string.
//
// Derived facts, so a reader does not have to run it: display order is
// 1 · 4 · 5 · 2 · 3 · 6 · 7 · 8, eligible is {4, 5, 2, 3, 8}, so band 11's next
// launch step is 4, band 12's is 8, and the "No initiative" band's is null.

import { MACHINES } from './substrateRebuildFixture';

export const INITIATIVE_ZOOM_READS = {
    steps: [
        { id: 1, pipeline_fk: 1, title: 'done gate', run: 'auto', notes: null },
        { id: 2, pipeline_fk: 1, title: 'A one', run: 'auto', notes: null },
        { id: 3, pipeline_fk: 1, title: 'A two', run: 'auto', notes: null },
        { id: 4, pipeline_fk: 1, title: 'A ungated', run: 'auto', notes: null },
        { id: 5, pipeline_fk: 1, title: 'A ungated too', run: 'auto', notes: null },
        { id: 6, pipeline_fk: 1, title: 'B one', run: 'auto', notes: null },
        { id: 7, pipeline_fk: 1, title: 'B two', run: 'auto', notes: null },
        { id: 8, pipeline_fk: 1, title: 'lonely', run: 'auto', notes: null },
    ],
    stepRequirements: [
        { step_fk: 1, requirement_fk: 907 },
        { step_fk: 2, requirement_fk: 900 }, { step_fk: 3, requirement_fk: 901 },
        { step_fk: 4, requirement_fk: 903 }, { step_fk: 5, requirement_fk: 904 },
        { step_fk: 6, requirement_fk: 905 }, { step_fk: 7, requirement_fk: 906 },
        { step_fk: 8, requirement_fk: 902 },
    ],
    stepDeps: [
        { id: 1, step_fk: 2, dep_step_fk: 1, time_at: null },
        { id: 2, step_fk: 3, dep_step_fk: 1, time_at: null },
        // 4 and 5 have no gate at all, so they place one column left of 2 and
        // 3 — which is what spreads this band's eligible work over two columns.
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
        { id: 907, requirement_status: 'met', machine_fk: 2, feature_fk: null },
    ],
    features: [
        { id: 101, title: 'Wave One', initiative_fk: 11 },
        { id: 102, title: 'Wave Two', initiative_fk: 12 },
    ],
    initiatives: [
        { id: 11, title: 'Initiative One' },
        { id: 12, title: 'Initiative Two' },
    ],
    machines: MACHINES,
};

export const INITIATIVE_ZOOM_PIPELINE = {
    id: 1, title: 'x', pipeline_status: 'active', machine_fk: 2,
};

export const INITIATIVE_ZOOM_NOW = '2026-07-27T03:00:00Z';
