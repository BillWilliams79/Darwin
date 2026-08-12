// @vitest-environment jsdom
//
// Req #3435 — the Orchestration box on the requirement detail page.
// Narrowed by req #3357: the Epic row is retired. The box carries TWO rows —
// Pipeline, Step — top to bottom, each with a button that opens the visualizer
// AT THAT LEVEL and a value beside it. Only STEP is a selector; Pipeline is
// read-only text.
//
// RE-BASED ON PIPELINE 2.0 BY REQ #3356, and two things about this fixture moved
// as a direct consequence:
//   - a 2.0 step carries `epic_fk`, NOT `pipeline_fk`, so the plan is reached in
//     two hops and there is an EPICS fixture between the steps and the plans;
//   - `pipeline_step_requirements` has `PRIMARY KEY (requirement_fk)` alone
//     (one step per requirement, the req #3336 stage-2 gate ruling), so a MOVE
//     is DELETE-then-POST. Insert-first cannot succeed while the old row exists,
//     which is why the order assertion below is inverted from its 1.0 form and
//     why the failure case is now a failed DELETE rather than a failed POST.
//
// The assertions that matter are the ones a regression would make invisible:
//   - picking a step WRITES `pipeline_step_requirements` — the junction that
//     actually places a requirement on a plan, and the one StepsPage refuses to
//     touch. A write to the wrong table or in the wrong order looks identical
//     from the UI until the plan view disagrees;
//   - the step list is scoped to THIS plan;
//   - the STEP row reads "No step" when nothing seats the requirement, which is
//     how seated-vs-unseated stays legible — that is the distinction the sync
//     report splits into UNSEATED-REQS and ORPHANS, and it decides whether a
//     launch is the coordinator's to make;
//   - each button lands at ITS OWN level (plan / bead), not both at the plan;
//   - the box carries no epic row and no `via feature "…"` caption — a
//     regression here would mean the retired concept quietly came back.

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
// The MIDDLE HOP a 2.0 step's plan is reached through (req #3356).
const EPICS = [
    { id: 20, pipeline_fk: 2 },
    { id: 90, pipeline_fk: 79 },
];
const STEPS = [
    { id: 100, epic_fk: 20, title: 'Orchestration Box', completed_at: null },
    { id: 104, epic_fk: 20, title: 'Polish Round 2',    completed_at: null },
    { id: 105, epic_fk: 20, title: 'Polish Shipped',
      completed_at: '2026-08-01T00:00:00' },   // DONE — never offerable
    { id: 101, epic_fk: 20, title: 'Plan Layer',        completed_at: null },
    { id: 200, epic_fk: 90, title: 'Agent Boot',        completed_at: null },
    { id: 300, epic_fk: 20, completed_at: null },   // no title, no reqs
];
// MUTABLE: some cases need a requirement seated on NO step.
let stepRequirements = [];
const DEFAULT_STEP_REQUIREMENTS = [
    { step_fk: 100, requirement_fk: 3435 },  // this requirement -> plan 2
    { step_fk: 104, requirement_fk: 3437 },
    { step_fk: 105, requirement_fk: 3438 },  // DONE
    { step_fk: 101, requirement_fk: 3401 },
    { step_fk: 200, requirement_fk: 3400 },  // plan 79
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
        useAllEpics: () => q('epics', EPICS),
        useAllPipelineSteps: () => q('steps', STEPS),
        useAllPipelineStepRequirements: () => q('links', stepRequirements),
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
// row, not a column, so DELETE/POST ORDER is the thing under test.
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

    it('carries the two rows, in plan → step order, and no epic row or prose', async () => {
        const { container } = mount();
        await flush();
        const box = group(container);
        const rows = ['orchestration-pipeline-row', 'orchestration-step-row'];
        for (const r of rows) expect(testid(container, r)).not.toBeNull();
        // Order is the shape of the thing — a plan contains steps.
        const order = rows.map((r) => Array.prototype.indexOf.call(
            box.children, testid(container, r)));
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(testid(container, 'orchestration-epic-row')).toBeNull();
        // The removed captions, asserted by their own words rather than by a
        // count of children.
        expect(box.textContent).not.toContain('via feature');
        expect(box.textContent).not.toContain('Epic');
        expect(box.textContent).not.toContain('View on plan');
    });

    // Pipeline is TEXT. An earlier cut shipped it as a Select that wrote nothing
    // and discarded the reader's choice on navigation, while looking exactly
    // like the one beside it that saves — one control that writes is the whole
    // point of the shape.
    it('renders pipeline as read-only text, not a control', async () => {
        const { container } = mount();
        await flush();
        const row = testid(container, 'orchestration-pipeline-row');
        expect(row.querySelector('.MuiSelect-select')).toBeNull();
        expect(row.querySelector('input')).toBeNull();
        // ...and the step is the one that is.
        expect(testid(container, 'orchestration-step-row')
            .querySelector('.MuiSelect-select')).not.toBeNull();
    });

    it('names the plan and the step', async () => {
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-pipeline-value').textContent).toBe('Darwin');
        expect(testid(container, 'orchestration-step-select').textContent)
            .toBe('Orchestration Box');
    });

    it('falls back to the step id when the step has no title', async () => {
        stepRequirements = [{ step_fk: 300, requirement_fk: 3435 }];
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-step-select').textContent).toBe('Step 300');
    });

    // EACH BUTTON LANDS AT ITS OWN LEVEL. `?step=` puts the camera on one bead
    // and the bare plan link fits everything. Pointing both at the plan would
    // make one of the buttons decoration.
    it('links each button at its own level of the plan', async () => {
        const { container } = mount();
        await flush();
        // `/swarm/pipeline/:id` — req #3356 collapsed the plan layer to one era
        // and the surviving visualizer took the unsuffixed route.
        expect(testid(container, 'orchestration-pipeline-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan');
        expect(testid(container, 'orchestration-step-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan&step=100&level=2');
    });

    // SEATED-VS-UNSEATED IS STRUCTURAL. With no step carrying the requirement
    // there is no known plan either — the epic fallback that used to fill this
    // gap left with the Epic row.
    it('shows no pipeline and no step when nothing seats the requirement', async () => {
        stepRequirements = [];
        const { container } = mount();
        await flush();

        expect(testid(container, 'orchestration-pipeline-value').textContent).toBe('No pipeline');
        expect(testid(container, 'orchestration-step-select').textContent).toBe('No step');
        expect(testid(container, 'orchestration-step-link').disabled).toBe(true);
        expect(testid(container, 'orchestration-pipeline-link').disabled).toBe(true);
    });

    it('disables every button — never a dead link — when nothing is linked', async () => {
        stepRequirements = [];
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-pipeline-link').disabled).toBe(true);
        expect(testid(container, 'orchestration-step-link').disabled).toBe(true);
        expect(testid(container, 'orchestration-pipeline-value').textContent).toBe('No pipeline');
        expect(testid(container, 'orchestration-step-select').textContent).toBe('No step');
    });

    // ── The menu ────────────────────────────────────────────────────────────

    // Scoped to THIS plan alone (req #3357 — no epic scoping left).
    it('offers only this plan’s OPEN steps', async () => {
        const { container } = mount();
        await flush();
        const labels = (await openSelect(container, 'orchestration-step-select'))
            .map((o) => o.textContent);
        // Current step first, then id ascending. 'Polish Shipped' (105) is done,
        // 'Agent Boot' (200) is another plan.
        expect(labels).toEqual(['No step', 'Orchestration Box', 'Plan Layer', 'Polish Round 2', 'Step 300']);
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

    // DELETE the old seat, THEN insert the new — req #3356. This is not a
    // preference: `pipeline_step_requirements` keys on `requirement_fk` ALONE,
    // so the INSERT cannot succeed while the old row exists and insert-first
    // would fail 100% of the time on a move. `link_step_requirement`
    // (darwin-mcp) says the same from the server side and names unlink-then-link
    // as the lawful move.
    it('re-seats by deleting the old link before inserting the new', async () => {
        const { container } = mount();
        await flush();

        await chooseOption(container, 'orchestration-step-select', 'Polish Round 2');
        expect(seatCalls).toEqual([
            { method: 'DELETE', body: { step_fk: 100, requirement_fk: 3435 } },
            { method: 'POST',   body: { step_fk: 104, requirement_fk: 3435 } },
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

    // A failed DELETE must not have inserted anything: with the old row still
    // present the INSERT would violate the primary key anyway, and aborting
    // leaves the requirement exactly where it was.
    it('leaves the seat alone when the delete fails', async () => {
        const { container } = mount();
        await flush();

        seatStatus = { POST: 200, DELETE: 500 };
        await chooseOption(container, 'orchestration-step-select', 'Polish Round 2');
        expect(seatCalls.map((c) => c.method)).toEqual(['DELETE']);
        expect(snackMessages.join(' ')).toContain('Unable to update step 500');
    });

    // THE RESIDUAL THE KEY FORCES, pinned so it is a known state rather than a
    // surprise: a POST that fails after a successful DELETE leaves the
    // requirement seated NOWHERE. It is visible — the error is on screen and the
    // box reads "No step" — and a person re-seats it in one pick.
    it('leaves the requirement unseated when the insert fails after the delete', async () => {
        const { container } = mount();
        await flush();

        seatStatus = { POST: 500, DELETE: 200 };
        await chooseOption(container, 'orchestration-step-select', 'Polish Round 2');
        expect(seatCalls.map((c) => c.method)).toEqual(['DELETE', 'POST']);
        expect(snackMessages.join(' ')).toContain('Unable to update step 500');
    });

    // The seat lives in the junction, NOT on the requirement row. A write to any
    // requirement column here would mean the handler reached for the wrong
    // table — which is exactly what an earlier revision of this box did, and
    // what made a wrong value invisible.
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

    it('reports the box unavailable when the plan-side reads fail', async () => {
        queryErrors = { steps: true };
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-error')).not.toBeNull();
        expect(testid(container, 'orchestration-pipeline-row')).toBeNull();
        expect(testid(container, 'orchestration-step-row')).toBeNull();
    });

    // THE EPICS READ IS A PLAN-SIDE READ (req #3356). It is only a JOIN HOP, but
    // losing it makes every step planless — which renders identically to a
    // requirement that is genuinely seated nowhere. Reporting the box
    // unavailable is the honest answer; silently showing "No pipeline" is not.
    it('reports the box unavailable when the EPICS read fails', async () => {
        queryErrors = { epics: true };
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-error')).not.toBeNull();
        expect(testid(container, 'orchestration-pipeline-row')).toBeNull();
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
    // the word is — "Pipeline" and "Step" are different widths.
    it('gives every row name the same fixed-width column', async () => {
        const { container } = mount();
        await flush();

        const widths = ['pipeline', 'step'].map((l) =>
            getComputedStyle(testid(container, `orchestration-${l}-label`)).width);
        expect(new Set(widths).size).toBe(1);
        expect(widths[0]).not.toBe('');
        expect(widths[0]).not.toBe('auto');
    });

});
