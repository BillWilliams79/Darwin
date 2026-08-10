// @vitest-environment jsdom
//
// Req #3435 — the Orchestration box on the requirement detail page.
//
// It replaces the read-only Epic box (reqs #3234/#3235/#3253) with THREE rows —
// Pipeline, Epic, Step, top to bottom — each carrying a button that opens the
// visualizer AT THAT LEVEL and a value beside it. Only the STEP is a selector;
// Pipeline and Epic are read-only text (setting those from here is req #3453,
// authoring/discuss).
//
// The assertions that matter are the ones a regression would make invisible:
//   - the assignment writes `requirements.feature_fk` (Pipeline 1.0 has no
//     `requirements.epic_fk`, so a write to the wrong column looks identical
//     from the UI until the plan view disagrees);
//   - picking a step WRITES `pipeline_step_requirements` — the junction that
//     actually places a requirement on a plan, and the one StepsPage refuses to
//     touch. A write to the wrong table or in the wrong order looks identical
//     from the UI until the plan view disagrees;
//   - the step list is scoped to THIS plan and THIS epic, so a pick can never
//     move the requirement to another epic — which is what keeps the three rows
//     consistent without a second write;
//   - the STEP row reads "No step" when nothing seats the requirement, which is
//     how seated-vs-unseated stays legible — that is the distinction the sync
//     report splits into UNSEATED-REQS and ORPHANS, and it decides whether a
//     launch is the coordinator's to make;
//   - each of the three buttons lands at ITS OWN level (plan / band / bead), not
//     all three at the plan;
//   - the box carries no `via feature "…"` caption — the prose the requirement
//     asked to be removed, and prose is easy to reintroduce.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `RouterLink` is what the two icon buttons render as, so the mock has to supply
// a real anchor — an undefined `Link` would make the buttons throw at render and
// the failure would look like a data problem. `vi.mock` factories are HOISTED
// above the imports, so the module-scope `React` binding is not initialised when
// this runs: the factory imports react itself and uses `createElement`.
vi.mock('react-router-dom', async () => {
    const react = await import('react');
    return {
        useParams: () => ({ id: '3435' }),
        useNavigate: () => () => {},
        useLocation: () => ({ state: {} }),
        Link: react.forwardRef(({ to, children, ...rest }, ref) =>
            react.createElement('a', { href: to, ref, ...rest }, children)),
    };
});

const PIPELINES = [
    { id: 2,  title: 'Darwin',        pipeline_status: 'active', create_ts: '2026-07-28T05:17:51' },
    { id: 79, title: 'Agent Harness', pipeline_status: 'active', create_ts: '2026-08-07T08:54:36' },
];
const STEPS = [
    { id: 100, pipeline_fk: 2,  title: 'Orchestration Box', completed_at: null },
    { id: 104, pipeline_fk: 2,  title: 'Polish Round 2',    completed_at: null },
    { id: 105, pipeline_fk: 2,  title: 'Polish Shipped',
      completed_at: '2026-08-01T00:00:00' },   // DONE — never offerable
    { id: 101, pipeline_fk: 2,  title: 'Plan Layer',        completed_at: null },
    { id: 200, pipeline_fk: 79, title: 'Agent Boot',        completed_at: null },
    { id: 300, pipeline_fk: 2,  completed_at: null },   // no title, no reqs
];
const EPICS = [
    { id: 11, title: "Bill's Polish #1", closed: 0, create_ts: '2026-08-09T08:01:32' },
    { id: 12, title: 'Pipeline 2.5',     closed: 0, create_ts: '2026-08-08T10:00:00' },
    { id: 9,  title: 'First Principles', closed: 0, create_ts: '2026-08-04T08:09:57' },
];
const FEATURES = [
    // Epic 11 holds TWO seats — the case that must expand.
    { id: 45, epic_fk: 11, closed: 0, sort_order: 2,    title: 'Polish backlog' },
    { id: 46, epic_fk: 11, closed: 0, sort_order: null, title: "Bill's Polish #1 Seat" },
    // Epics 12 and 9 hold one each — the case that must NOT expand.
    { id: 47, epic_fk: 12, closed: 0, sort_order: null, title: 'Pipeline 2.5 Seat' },
    { id: 31, epic_fk: 9,  closed: 0, sort_order: 5,    title: 'FP Seat' },
];
// MUTABLE: some cases need a requirement seated on NO step, and the seat is what
// decides whether the pipeline row reports a plan or reports it "(via epic)".
let stepRequirements = [];
const DEFAULT_STEP_REQUIREMENTS = [
    { step_fk: 100, requirement_fk: 3435 },  // this requirement -> epic 11 -> plan 2
    { step_fk: 104, requirement_fk: 3437 },  // epic 11 -> plan 2, another open step
    { step_fk: 105, requirement_fk: 3438 },  // epic 11 -> plan 2, but DONE
    { step_fk: 101, requirement_fk: 3401 },  // epic 12 -> plan 2
    { step_fk: 200, requirement_fk: 3400 },  // epic 9  -> plan 79
];
// The chained read the index makes: requirements that carry a feature_fk.
let seatedRequirements = [];
const DEFAULT_SEATED_REQUIREMENTS = [
    { id: 3435, feature_fk: 46 },
    { id: 3437, feature_fk: 45 },   // epic 11 as well
    { id: 3438, feature_fk: 45 },   // epic 11, on the finished step
    { id: 3401, feature_fk: 47 },
    { id: 3400, feature_fk: 31 },
];

let queryErrors = {};
const q = (name, data) => ({
    data,
    isLoading: false,
    isError: !!queryErrors[name],
    isPending: false,
    isSuccess: !queryErrors[name],
});

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useMachines: () => q('machines', []),
        useAllCategories: () => q('categories', [{ id: 1, category_name: 'Swarm' }]),
        useAllPipelines: () => q('pipelines', PIPELINES),
        useAllPipelineSteps: () => q('steps', STEPS),
        useAllPipelineStepRequirements: () => q('links', stepRequirements),
        useAllEpics: () => q('epics', EPICS),
        useAllFeatures: () => q('features', FEATURES),
    };
});

let requirementRow;
// A FLAG, not `mockImplementationOnce`. The page PUTs for its own reasons (a
// description blur fires one whenever focus leaves the field, which opening a
// menu does), so a one-shot override is consumed by whichever write happens to
// go first — and the test would then assert a rollback that never ran.
//
// It REJECTS, because `call_rest_api` THROWS `{data, httpStatus}` on any non-2xx
// (RestApi.jsx). A mock that resolved a 500 would leave the real failure path
// untested and hide a `.catch(() => null)` that strips the status code.
let putStatus = 200;
const putBodies = [];
// Every `pipeline_step_requirements` write, in order — the seat is a junction
// row, not a column, so POST/DELETE ORDER is the thing under test.
const seatCalls = [];
let seatStatus = { POST: 200, DELETE: 200 };
vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        if (uri.includes('/pipeline_step_requirements') && method !== 'GET') {
            seatCalls.push({ method, body });
            const st = seatStatus[method] ?? 200;
            return st >= 200 && st < 300
                ? Promise.resolve({ httpStatus: { httpStatus: st }, data: [] })
                : Promise.reject({ httpStatus: { httpStatus: st }, data: [] });
        }
        if (method === 'PUT') {
            putBodies.push(body);
            return putStatus >= 200 && putStatus < 300
                ? Promise.resolve({ httpStatus: { httpStatus: putStatus }, data: [] })
                : Promise.reject({ httpStatus: { httpStatus: putStatus }, data: [] });
        }
        if (method === 'GET' && uri.includes('/requirements?id=')) {
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [requirementRow] });
        }
        // The index's chained `requirements?feature_fk=(…)` read.
        if (method === 'GET' && uri.includes('/requirements?feature_fk=')) {
            return queryErrors.chained
                ? Promise.reject({ httpStatus: { httpStatus: 500 }, data: [] })
                : Promise.resolve({ httpStatus: { httpStatus: 200 }, data: seatedRequirements });
        }
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

const snackMessages = [];
vi.mock('../../../stores/useSnackBarStore', () => ({
    useSnackBarStore: (selector) => selector({
        // Mirrors the real store: a status on the error object is appended to the
        // caller's text, so a handler that swallows the status fails a test.
        showError: (error, errorText) => snackMessages.push(
            errorText === undefined ? error
                : `${errorText}${error?.httpStatus?.httpStatus ? ` ${error.httpStatus.httpStatus}` : ''}`),
        close: () => {},
        open: false,
        message: '',
    }),
}));

import RequirementDetail from '../RequirementDetail';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

let mountedRoots = [];

function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } },
    });
    const root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <RequirementDetail />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    mountedRoots.push(root);
    return { container };
}

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

const group = (c) => c.querySelector('[data-testid="requirement-orchestration-group"]');
const testid = (c, id) => c.querySelector(`[data-testid="${id}"]`);

// MUI renders a non-native Select's menu in a PORTAL on document.body, and it
// opens on MOUSEDOWN, not on click — a plain .click() leaves it closed and every
// option assertion sees an empty list.
async function openSelect(container, id) {
    const trigger = testid(container, id).querySelector('.MuiSelect-select');
    await act(async () => {
        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    await flush();
    return Array.from(document.querySelectorAll('[role="option"]'));
}

async function chooseOption(container, id, label) {
    const options = await openSelect(container, id);
    const hit = options.find((o) => o.textContent === label);
    if (!hit) throw new Error(`no option "${label}" in [${options.map(o => o.textContent).join(', ')}]`);
    await act(async () => { hit.click(); });
    await flush();
}

async function closeMenu() {
    const backdrop = document.querySelector('.MuiModal-backdrop, .MuiBackdrop-root');
    if (backdrop) {
        await act(async () => { backdrop.click(); });
        await flush();
    }
}

function baseRequirement(overrides = {}) {
    return {
        id: 3435,
        title: 'Rebrand Epic UI element',
        description: '',
        category_fk: 1,
        requirement_status: 'development',
        coordination_type: 'implemented',
        ai_model: 'opus',
        effort: 'high',
        machine_fk: null,
        feature_fk: 46,
        started_at: null, completed_at: null, deferred_at: null,
        create_ts: null, update_ts: null,
        ...overrides,
    };
}

describe('RequirementDetail Orchestration box (req #3435)', { timeout: 30000 }, () => {
    beforeEach(() => {
        putBodies.length = 0;
        seatCalls.length = 0;
        seatStatus = { POST: 200, DELETE: 200 };
        snackMessages.length = 0;
        requirementRow = baseRequirement();
        putStatus = 200;
        queryErrors = {};
        stepRequirements = [...DEFAULT_STEP_REQUIREMENTS];
        seatedRequirements = [...DEFAULT_SEATED_REQUIREMENTS];
        mountedRoots = [];
    });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('is legended Orchestration, not Epic', async () => {
        const { container } = mount();
        await flush();
        expect(group(container).querySelector('legend').textContent).toBe('Orchestration');
        expect(container.querySelector('[data-testid="requirement-epic-linkage-group"]')).toBeNull();
    });

    it('carries the three rows, in plan → epic → step order, and no prose', async () => {
        const { container } = mount();
        await flush();
        const box = group(container);
        const rows = ['orchestration-pipeline-row', 'orchestration-epic-row',
            'orchestration-step-row'];
        for (const r of rows) expect(testid(container, r)).not.toBeNull();
        // Order is the shape of the thing — a plan contains epics contain steps.
        const order = rows.map((r) => Array.prototype.indexOf.call(
            box.children, testid(container, r)));
        expect(order).toEqual([...order].sort((a, b) => a - b));
        // The removed caption, asserted by its own words rather than by a count
        // of children.
        expect(box.textContent).not.toContain('via feature');
        expect(box.textContent).not.toContain('View on plan');
    });

    // Pipeline and Epic are TEXT. An earlier cut shipped the pipeline as a Select
    // that wrote nothing and discarded the reader's choice on navigation, while
    // looking exactly like the one beside it that saves — one control that writes
    // is the whole point of the shape.
    it('renders pipeline and epic as read-only text, not controls', async () => {
        const { container } = mount();
        await flush();
        for (const row of ['orchestration-pipeline-row', 'orchestration-epic-row']) {
            expect(testid(container, row).querySelector('.MuiSelect-select')).toBeNull();
            expect(testid(container, row).querySelector('input')).toBeNull();
        }
        // ...and the step is the one that is.
        expect(testid(container, 'orchestration-step-row')
            .querySelector('.MuiSelect-select')).not.toBeNull();
    });

    it('names the plan, the epic and the step', async () => {
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-pipeline-value').textContent).toBe('Darwin');
        expect(testid(container, 'orchestration-epic-value').textContent)
            .toBe("Bill's Polish #1");
        expect(testid(container, 'orchestration-step-select').textContent)
            .toBe('Orchestration Box');
    });

    it('falls back to the step id when the step has no title', async () => {
        stepRequirements = [{ step_fk: 300, requirement_fk: 3435 }];
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-step-select').textContent).toBe('Step 300');
    });

    // EACH BUTTON LANDS AT ITS OWN LEVEL. `?step=` puts the camera on one bead,
    // `?epic=` fits the whole band — which on a large epic IS a zoomed-out view
    // (req #3253) — and the bare plan link fits everything. Pointing all three at
    // the plan would make two of the buttons decoration.
    it('links each button at its own level of the plan', async () => {
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-pipeline-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan');
        expect(testid(container, 'orchestration-epic-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan&epic=11');
        expect(testid(container, 'orchestration-step-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan&step=100&level=2');
    });

    it('names the epic in the epic button’s accessible name', async () => {
        const { container } = mount();
        await flush();
        // A reader tabbing the box otherwise cannot tell which epic it opens.
        expect(testid(container, 'orchestration-epic-link').getAttribute('aria-label'))
            .toBe("View epic Bill's Polish #1 on the plan visualizer");
    });

    // SEATED-VS-UNSEATED IS NOW STRUCTURAL. The plan still resolves through the
    // epic (req #3235's fallback), and the Step row saying "No step" is what
    // stops that reading as a seat — no parenthetical needed. That distinction is
    // what the sync report splits into UNSEATED-REQS and ORPHANS, and it decides
    // whether a launch is the coordinator's to make.
    it('shows the epic’s plan but NO step when nothing seats the requirement', async () => {
        // Epic 11 still reaches plan 2, but through a SIBLING requirement.
        stepRequirements = [{ step_fk: 100, requirement_fk: 3436 }];
        seatedRequirements = [...DEFAULT_SEATED_REQUIREMENTS, { id: 3436, feature_fk: 46 }];
        const { container } = mount();
        await flush();

        expect(testid(container, 'orchestration-pipeline-value').textContent).toBe('Darwin');
        expect(testid(container, 'orchestration-step-select').textContent).toBe('No step');
        expect(testid(container, 'orchestration-step-link').disabled).toBe(true);
        // The plan button still works — it is the epic's plan, honestly named.
        expect(testid(container, 'orchestration-pipeline-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan');
    });

    it('disables every button — never a dead link — when nothing is linked', async () => {
        requirementRow = baseRequirement({ feature_fk: null });
        stepRequirements = [];   // and seated on no step either
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-pipeline-link').disabled).toBe(true);
        expect(testid(container, 'orchestration-epic-link').disabled).toBe(true);
        expect(testid(container, 'orchestration-step-link').disabled).toBe(true);
        expect(testid(container, 'orchestration-pipeline-value').textContent).toBe('No pipeline');
        expect(testid(container, 'orchestration-epic-value').textContent).toBe('No epic');
        expect(testid(container, 'orchestration-step-select').textContent).toBe('No step');
    });

    // ── The menu ────────────────────────────────────────────────────────────

    // Scoped to THIS plan and THIS epic. That scoping is what keeps the three
    // rows consistent without a second write: a pick can never move the
    // requirement to another epic, so the Epic row above stays true.
    it('offers only this plan and epic’s OPEN steps', async () => {
        const { container } = mount();
        await flush();
        const labels = (await openSelect(container, 'orchestration-step-select'))
            .map((o) => o.textContent);
        // Current step first, then id ascending. 'Polish Shipped' (105) is done,
        // 'Plan Layer' (101) is epic 12, 'Agent Boot' (200) is another plan.
        // 'Step 300' carries no requirements, so it belongs to no epic yet.
        expect(labels).toEqual(['No step', 'Orchestration Box', 'Polish Round 2', 'Step 300']);
        await closeMenu();
    });

    it('never offers a completed step', async () => {
        const { container } = mount();
        await flush();
        const labels = (await openSelect(container, 'orchestration-step-select'))
            .map((o) => o.textContent);
        expect(labels).not.toContain('Polish Shipped');
        await closeMenu();
    });

    // A select whose own list denies its value renders blank, which reads as a
    // data bug rather than as a filter.
    it('offers the current step even when it is finished', async () => {
        stepRequirements = [{ step_fk: 105, requirement_fk: 3435 },
            ...DEFAULT_STEP_REQUIREMENTS.filter((l) => l.requirement_fk !== 3435)];
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-step-select').textContent)
            .toBe('Polish Shipped');
        const labels = (await openSelect(container, 'orchestration-step-select'))
            .map((o) => o.textContent);
        expect(labels[1]).toBe('Polish Shipped');
        await closeMenu();
    });

    // ── The write ───────────────────────────────────────────────────────────

    // INSERT the new link, THEN delete the old. The reverse leaves the
    // requirement silently seated nowhere if the insert fails.
    it('re-seats by inserting the new link before deleting the old', async () => {
        const { container } = mount();
        await flush();

        await chooseOption(container, 'orchestration-step-select', 'Polish Round 2');
        expect(seatCalls).toEqual([
            { method: 'POST',   body: { step_fk: 104, requirement_fk: 3435 } },
            { method: 'DELETE', body: { step_fk: 100, requirement_fk: 3435 } },
        ]);
    });

    it('seats an unseated requirement with an insert alone', async () => {
        stepRequirements = DEFAULT_STEP_REQUIREMENTS.filter((l) => l.requirement_fk !== 3435);
        const { container } = mount();
        await flush();

        expect(testid(container, 'orchestration-step-select').textContent).toBe('No step');
        await chooseOption(container, 'orchestration-step-select', 'Polish Round 2');
        expect(seatCalls).toEqual([
            { method: 'POST', body: { step_fk: 104, requirement_fk: 3435 } },
        ]);
    });

    it('unseats with a delete alone when No step is picked', async () => {
        const { container } = mount();
        await flush();

        await chooseOption(container, 'orchestration-step-select', 'No step');
        expect(seatCalls).toEqual([
            { method: 'DELETE', body: { step_fk: 100, requirement_fk: 3435 } },
        ]);
    });

    it('does not re-save when the current step is re-picked', async () => {
        const { container } = mount();
        await flush();

        await chooseOption(container, 'orchestration-step-select', 'Orchestration Box');
        expect(seatCalls).toEqual([]);
    });

    // A failed INSERT must not have deleted anything — that is the whole reason
    // for the order.
    it('leaves the old seat alone when the insert fails', async () => {
        const { container } = mount();
        await flush();

        seatStatus = { POST: 500, DELETE: 200 };
        await chooseOption(container, 'orchestration-step-select', 'Polish Round 2');
        expect(seatCalls.map((c) => c.method)).toEqual(['POST']);
        expect(snackMessages.join(' ')).toContain('Unable to update step 500');
    });

    // The seat lives in the junction, NOT on the requirement row. A `feature_fk`
    // (or any other requirement column) write here would mean the handler reached
    // for the wrong table — which is exactly what the previous revision of this
    // box did, and what made a wrong value invisible.
    //
    // Filtered rather than asserted empty: the page PUTs its description on blur,
    // and opening a menu blurs the field. That write is not this control's.
    it('writes no requirement column when re-seating', async () => {
        const { container } = mount();
        await flush();

        await chooseOption(container, 'orchestration-step-select', 'Polish Round 2');
        const requirementEdits = putBodies.filter((body) => Array.isArray(body)
            && body.some((row) => Object.keys(row).some((k) => k !== 'id' && k !== 'description')));
        expect(requirementEdits).toEqual([]);
    });

    // ── Degradation ─────────────────────────────────────────────────────────

    // The epic assignment needs `epics` + `features` and nothing else. Folding
    // every read into one error flag let a whole-table read with no bearing on
    // the write disable assignment entirely.
    it('keeps the epic row working when a PLAN-side read fails', async () => {
        queryErrors = { steps: true };
        const { container } = mount();
        await flush();

        expect(testid(container, 'orchestration-pipeline-error')).not.toBeNull();
        // The step row goes with it — a step list scoped by a plan that did not
        // load would be a guess, and the seat itself is unknown.
        expect(testid(container, 'orchestration-step-row')).toBeNull();
        expect(testid(container, 'orchestration-epic-row')).not.toBeNull();
        expect(testid(container, 'orchestration-epic-value').textContent)
            .toBe("Bill's Polish #1");
    });

    // The pipeline row's own facts — which step of which plan seats this
    // requirement, and the ?step= link — never touch the chained requirements
    // read, so a failure there must not replace a fully known row.
    it('keeps the pipeline row when only the CHAINED read fails', async () => {
        queryErrors = { chained: true };
        const { container } = mount();
        await flush();

        expect(testid(container, 'orchestration-pipeline-error')).toBeNull();
        expect(testid(container, 'orchestration-pipeline-value').textContent).toBe('Darwin');
        expect(testid(container, 'orchestration-step-select').textContent)
            .toBe('Orchestration Box');
        expect(testid(container, 'orchestration-step-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan&step=100&level=2');
    });

    // The chained `requirements` read failing empties `epicByStep`, so every step
    // reads as "no epic yet" and passes the filter. Widening is the safe
    // direction — more steps offered, never silently fewer.
    it('widens the step list when the epic map cannot be trusted', async () => {
        queryErrors = { chained: true };
        const { container } = mount();
        await flush();

        const labels = (await openSelect(container, 'orchestration-step-select'))
            .map((o) => o.textContent);
        expect(labels).toContain('Plan Layer');   // epic 12's step, now unfiltered
        await closeMenu();
    });

    it('keeps the pipeline and step rows when the EPIC-side read fails', async () => {
        queryErrors = { epics: true };
        const { container } = mount();
        await flush();

        expect(testid(container, 'orchestration-epic-error')).not.toBeNull();
        expect(testid(container, 'orchestration-pipeline-row')).not.toBeNull();
        expect(testid(container, 'orchestration-step-row')).not.toBeNull();
    });

    it('reports the box unavailable only when BOTH sides fail', async () => {
        queryErrors = { epics: true, steps: true };
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-error')).not.toBeNull();
    });

    // The three icon buttons were given aria-labels; the one control that
    // actually WRITES must have one too, or a screen reader announces its display
    // value as its own name.
    it('names the step select for assistive technology', async () => {
        const { container } = mount();
        await flush();
        // MUI puts `inputProps` on the role="combobox" element, not on the
        // hidden native input — asserting the wrong node passes on a control
        // that has no accessible name at all.
        expect(testid(container, 'orchestration-step-select')
            .querySelector('[role="combobox"]').getAttribute('aria-label')).toBe('Step');
    });

    // ── The row names and their layout ──────────────────────────────────────

    // The names are unconditional: the icons match the nav entries they point at,
    // but they are only unambiguous once you know them.
    it('names every row', async () => {
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-pipeline-label').textContent).toBe('Pipeline');
        expect(testid(container, 'orchestration-epic-label').textContent).toBe('Epic');
        expect(testid(container, 'orchestration-step-label').textContent).toBe('Step');
    });

    // COLUMN ORDER: name, then the view/zoom icon, then the item's title. The
    // icon sits BETWEEN them rather than leading the row, so the names form a
    // left column and the icons a second one.
    it('orders each row name → icon → value', async () => {
        const { container } = mount();
        await flush();

        for (const [level, valueId] of [
            ['pipeline', 'orchestration-pipeline-value'],
            ['epic', 'orchestration-epic-value'],
            ['step', 'orchestration-step-select'],
        ]) {
            const row = testid(container, `orchestration-${level}-row`);
            const kids = Array.prototype.slice.call(row.children);
            const at = (el) => kids.findIndex((k) => k === el || k.contains(el));
            const name = at(testid(container, `orchestration-${level}-label`));
            const icon = at(testid(container, `orchestration-${level}-link`));
            const value = at(testid(container, valueId));
            expect(name).toBeLessThan(icon);
            expect(icon).toBeLessThan(value);
        }
    });

    // The name occupies a FIXED column, so the icons line up at one x whatever
    // the word is — "Pipeline" and "Epic" are very different widths.
    it('gives every row name the same fixed-width column', async () => {
        const { container } = mount();
        await flush();

        const widths = ['pipeline', 'epic', 'step'].map((l) =>
            getComputedStyle(testid(container, `orchestration-${l}-label`)).width);
        expect(new Set(widths).size).toBe(1);
        expect(widths[0]).not.toBe('');
        expect(widths[0]).not.toBe('auto');
    });

});
