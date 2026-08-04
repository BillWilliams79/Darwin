// @vitest-environment jsdom
//
// PipelinePlanTable MOUNTS — the smoke test this file did not have (req #3324,
// found during that requirement's own manual UI review).
//
// ── WHY IT EXISTS ───────────────────────────────────────────────────────────
// `PipelinePlanTable.jsx` called `useState` without importing it (introduced
// 2026-08-03 by commit 53442e4, req #3311's `useScrollMemory` wiring; shipped on
// origin/master). Table is the DEFAULT panel of /swarm/pipeline/:id, so the whole
// page threw `useState is not defined` on mount, in BOTH modes — you could not
// reach the Plan visualizer to look at it at all.
//
// THREE THINGS THAT COULD HAVE CAUGHT IT, AND WHY NONE DID:
//   · a component test for this file — there was none, and this is it;
//   · eslint — there is none in this package (`PipelineDetail.jsx` says so in its
//     own import block, where the same absence left a dead import behind);
//   · the build — `npm run build` SUCCEEDS. An unresolved identifier is not a
//     bundler error, it is a runtime `ReferenceError`, so a green build says
//     nothing about it. That is the lesson worth keeping: for this class of
//     defect the only cheap detector is RENDERING the component.
//
// ── WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────
// It renders the real table with a minimal but REALISTIC plan and asserts the
// container paints with its rows. It makes no claim about columns, ordering,
// batch banners, cost or scroll memory — those are `pipelineViewModel`'s and
// `planRenderRows`' own tests, and a smoke test that duplicated them would break
// on every legitimate presentation change and stop being run.
//
// Any hook this component calls without importing it fails HERE, which is the
// whole point: the assertion is that it renders at all.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

import PipelinePlanTable from '../PipelinePlanTable';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ROWS IN THE SHAPE `buildPipelineModel` EMITS, field for field — `depIds` and
// `timeDeps` rather than a plausible `deps`, because the table reads
// `row.depIds.map(...)` unguarded and a fixture that invented the name would
// fail for a reason that has nothing to do with what this test is for. Copied
// from `pipelineModel.js`'s own row literal, so it drifts only when that does.
const PLAN = {
    rows: [
        {
            id: 47, title: 'Session Drain', run: 'auto', notes: null,
            completedAt: null, state: 'running',
            reqIds: [3324], trackingReqIds: [], unresolvedReqIds: [],
            depIds: [], timeDeps: [],
            epicId: 4, epic: 'Orchestration', featureId: 9, feature: 'Engine',
            epicLabels: ['Orchestration'], featureLabels: ['Engine'],
            machines: [], cost: 1.23,
        },
        {
            id: 48, title: 'Pause Enforcement', run: 'manual', notes: null,
            completedAt: null, state: 'pending',
            reqIds: [3223], trackingReqIds: [], unresolvedReqIds: [],
            // A step dependency AND a time gate, so `formatTimeGates` runs too.
            depIds: [47], timeDeps: [{ at: '2026-08-04T12:00:00Z' }],
            epicId: 4, epic: 'Orchestration', featureId: 9, feature: 'Engine',
            epicLabels: ['Orchestration'], featureLabels: ['Engine'],
            machines: [], cost: null,
        },
    ],
    batches: [],
    batchLetterByStepId: new Map(),
    eligibleStepIds: new Set([48]),
    violations: [],
};

const PIPELINE = { id: 2, title: 'Darwin', pipeline_status: 'active' };

let root;
let container;

function render(props = {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <MemoryRouter>
                <PipelinePlanTable plan={PLAN} pipeline={PIPELINE} timezone="UTC"
                                   {...props} />
            </MemoryRouter>
        );
    });
}

// jsdom implements no layout, so `Element.prototype.scrollIntoView` does not
// exist — and the `focusStepId` branch below calls it to bring the focused row
// into view (the req #3115 bead-click handshake). Stubbed rather than avoided:
// skipping that prop would leave the branch unrendered, and an unrendered branch
// is exactly where the missing import this test exists for was hiding.
beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
    root = null;
    container = null;
});

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    document.body.innerHTML = '';
});

describe('PipelinePlanTable mounts (req #3324)', () => {
    it('renders the table, with every hook it calls actually imported', () => {
        render();
        expect(document.querySelector('[data-testid="pipeline-plan-table"]'))
            .not.toBeNull();
        // The rows really painted — otherwise this would pass on an empty shell.
        expect(document.body.textContent).toContain('Session Drain');
        expect(document.body.textContent).toContain('Pause Enforcement');
    });

    // The three optional props, because each one opens a branch — and a hook
    // called inside a branch this test never entered would still be missing.
    it('renders with cost shown, a cost error, and a focused step', () => {
        render({ showCost: true, costError: true, focusStepId: 47 });
        expect(document.querySelector('[data-testid="pipeline-plan-table"]'))
            .not.toBeNull();
        expect(document.body.textContent).toContain('Session Drain');
    });
});
