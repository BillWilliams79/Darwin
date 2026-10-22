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
// launch lines, cost or scroll memory — those are `pipelineViewModel`'s and
// `planRenderRows`' own tests, and a smoke test that duplicated them would break
// on every legitimate presentation change and stop being run.
//
// Any hook this component calls without importing it fails HERE, which is the
// whole point: the assertion is that it renders at all.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

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
            openReqIds: [3324], state: 'running',
            reqIds: [3324], trackingReqIds: [], unresolvedReqIds: [],
            depIds: [], timeDeps: [],
            epicId: 4, epic: 'Orchestration',
            epicLabels: ['Orchestration'],
            machines: [], cost: 1.23,
        },
        {
            id: 48, title: 'Pause Enforcement', run: 'manual', notes: null,
            openReqIds: [3223, 3224], state: 'pending',
            reqIds: [3223, 3224], trackingReqIds: [], unresolvedReqIds: [],
            // A step dependency AND a time gate, so `formatTimeGates` runs too.
            depIds: [47], timeDeps: [{ at: '2026-08-04T12:00:00Z' }],
            epicId: 4, epic: 'Orchestration',
            epicLabels: ['Orchestration'],
            machines: [], cost: null,
            // req #3371 — design rule 8's artifact, now a property of the row.
            // A PARTIAL exclusion too, which is the common case: two linked
            // requirements, one launchable.
            swarmStartCommand: '/swarm-start 3223',
            launchExcluded: ['3224 not swarm_ready'],
            noLaunchReason: null,
        },
    ],
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

    // req #3371 — THE `/swarm-start` COMMAND DID NOT DISAPPEAR WITH THE BANNER.
    // The full-width launch banner that used to carry design rule 8's argument
    // list is gone; the command is a property of the step's own row now, so the
    // smoke test asserts it is actually painted rather than merely computable.
    // Scoped to SCHEDULED work, which is why the Running row must NOT carry one.
    it('renders a scheduled step\'s exact /swarm-start argument list on its own row', () => {
        render();
        const cmd = document.querySelector('[data-testid="pipeline-launch-command-48"]');
        expect(cmd).not.toBeNull();
        expect(cmd.textContent).toBe('/swarm-start 3223');
        // The ids the command DROPPED, alongside it (req #3360).
        expect(document.querySelector('[data-testid="pipeline-launch-skipped-48"]')
            .textContent).toContain('3224 not swarm_ready');
        // The Running row is already out — no launch line on it.
        expect(document.querySelector('[data-testid="pipeline-launch-command-47"]'))
            .toBeNull();
    });

    // req #3649 — the barrier chip on every row (absent = the column
    // default, a barrier) and the lock chip only on an effectively-locked row.
    // Row 48 becomes a PRIORITY step frozen by its epic's lock; row 47 carries
    // none of the flags, which is the adapter's absent default. A per-test plan,
    // because a locked row also withholds the "+" the tests below rely on.
    it('renders the barrier/priority chip and the inherited lock chip', () => {
        const locked = { ...PLAN, rows: PLAN.rows.map((r) => (r.id === 48
            ? { ...r, checkpoint: false, locked: false, effectiveLocked: true, lockedBy: 'epic' }
            : r)) };
        render({ plan: locked });
        const q = (id) => document.querySelector(`[data-testid="${id}"]`);
        expect(q('pipeline-barrier-chip-47').textContent).toBe('Barrier');
        expect(q('pipeline-barrier-chip-48').textContent).toBe('Priority');
        expect(q('pipeline-lock-chip-48').textContent).toBe('Locked');
        expect(q('pipeline-lock-chip-47')).toBeNull();
    });

    // req #3676 — a step's ids in ORCHESTRATION order (open before complete,
    // deployed first, then FIFO), with the dashed divider before the first
    // complete id, the same order the Plan card stacks them in.
    it('lists a step\'s requirements in orchestration order with a complete divider', () => {
        const ordered = { ...PLAN, rows: PLAN.rows.map((r) => (r.id === 48
            ? { ...r, reqIds: [3656, 3641, 3655, 3646] } : r)) };
        const model = { requirements: [
            { id: 3656, requirement_status: 'met', coordination_type: 'deployed' },
            { id: 3641, requirement_status: 'development', coordination_type: 'implemented' },
            { id: 3655, requirement_status: 'swarm_ready', coordination_type: 'deployed' },
            { id: 3646, requirement_status: 'met', coordination_type: 'implemented' },
        ] };
        render({ plan: ordered, model });
        const cell = document.querySelector('[data-testid="pipeline-req-link-3655"]').parentElement;
        const seq = [...cell.children].map((el) => el.getAttribute('data-testid'))
            .filter(Boolean);
        expect(seq).toEqual([
            'pipeline-req-link-3655', 'pipeline-req-link-3641',
            'pipeline-req-done-rule-48',
            // complete group: deployed 3656 before implemented 3646
            'pipeline-req-link-3656', 'pipeline-req-link-3646',
            'pipeline-step-add-48',
        ]);
        // No divider on a step with no complete work.
        expect(document.querySelector('[data-testid="pipeline-req-done-rule-47"]')).toBeNull();
    });

    // The three optional props, because each one opens a branch — and a hook
    // called inside a branch this test never entered would still be missing.
    it('renders with cost shown, a cost error, and a focused step', () => {
        render({ showCost: true, costError: true, focusStepId: 47 });
        expect(document.querySelector('[data-testid="pipeline-plan-table"]'))
            .not.toBeNull();
        expect(document.body.textContent).toContain('Session Drain');
    });

    // req #3582 — every step row offers "+", and following it lands on the
    // requirement editor's "new" mode carrying the step to seat it on plus the
    // plan provenance Back needs.
    it('a step\'s "+" opens a new requirement draft carrying that step', () => {
        function NewProbe() {
            const location = useLocation();
            return <pre data-testid="new-probe">{JSON.stringify(location.state)}</pre>;
        }
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(
                <MemoryRouter initialEntries={['/plan']}>
                    <Routes>
                        <Route path="/plan" element={
                            <PipelinePlanTable plan={PLAN} pipeline={PIPELINE} timezone="UTC" />} />
                        <Route path="/swarm/requirement/new" element={<NewProbe />} />
                    </Routes>
                </MemoryRouter>
            );
        });
        for (const id of [47, 48]) {
            expect(document.querySelector(`[data-testid="pipeline-step-add-${id}"]`)
                .getAttribute('href')).toBe('/swarm/requirement/new');
        }
        act(() => {
            document.querySelector('[data-testid="pipeline-step-add-48"]')
                .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        });
        expect(JSON.parse(document.querySelector('[data-testid="new-probe"]').textContent))
            .toEqual({ seatStepId: 48, seatStepName: 'Pause Enforcement',
                from: 'pipeline', pipelineId: 2, mode: 'table', backStepId: 48 });
    });

    // req #3750 — a step has no state: one whose work is all finished still
    // offers its "+". Only a lock (req #3649) withholds it.
    it('offers the "+" on a step whose work is all finished', () => {
        const finished = { ...PLAN, rows: PLAN.rows.map((r) => (r.id === 47
            ? { ...r, openReqIds: [], state: 'done' } : r)) };
        render({ plan: finished });
        expect(document.querySelector('[data-testid="pipeline-step-add-47"]')).not.toBeNull();
    });

    it('offers no "+" on an effectively locked step (req #3649)', () => {
        const locked = { ...PLAN, rows: PLAN.rows.map((r) => (r.id === 47
            ? { ...r, effectiveLocked: true, lockedBy: 'step' } : r)) };
        render({ plan: locked });
        expect(document.querySelector('[data-testid="pipeline-step-add-47"]')).toBeNull();
        expect(document.querySelector('[data-testid="pipeline-step-add-48"]')).not.toBeNull();
    });
});
