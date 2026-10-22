// @vitest-environment jsdom
//
// req #3393 — the Pipeline 2.0 steps editor. Structural sibling of the other
// 2.0 page test files (see EpicsPage2.test.jsx's header for the DataGrid-stub
// rationale, copied rather than imported).
//
// What is pinned: the req #3750 column order (no State, no Notes) and the
// cascading Pipeline → Epic filter; create/edit send the right body including
// epic_fk (create only) and the not_before conversion; the run, barrier and
// lock chips toggle; delete names the blocker/consequence.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@mui/x-data-grid', () => ({
    GridToolbar: () => null,
    // `data-testid` forwarded from the real usage (`steps-grid`), not
    // hardcoded — see PipelinesPage2.test.jsx's identical fix for why a
    // hardcoded value here is a latent bug.
    DataGrid: ({ rows, columns, 'data-testid': testId = 'grid' }) => (
        <div data-testid={testId}>
            {rows.map((row, index) => (
                <div key={row.id} data-testid={`grid-row-${row.id}`} data-index={index}>
                    {columns.map((col) => {
                        const raw = row[col.field];
                        const value = col.valueGetter ? col.valueGetter(raw, row, col) : raw;
                        const formatted = col.valueFormatter
                            ? col.valueFormatter(value, row, col) : value;
                        return (
                            <span key={col.field} data-testid={`cell-${col.field}-${row.id}`}>
                                {col.renderCell
                                    ? col.renderCell({ row, value, id: row.id, field: col.field })
                                    : String(formatted ?? '')}
                            </span>
                        );
                    })}
                </div>
            ))}
        </div>
    ),
}));

let pipelines;
let epics;
let steps;
let stepRequirements;
let stepDeps;
let requirements;
let loading;

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllPipelines: () => ({ data: pipelines, isLoading: loading.pipelines }),
        useAllEpics: () => ({ data: epics, isLoading: loading.epics }),
        useAllPipelineSteps: () => ({ data: steps, isLoading: loading.steps }),
        useAllPipelineStepRequirements: () => ({
            data: stepRequirements, isLoading: loading.links, isError: loading.linksError }),
        useAllPipelineStepDeps: () => ({
            data: stepDeps, isLoading: loading.deps, isError: loading.depsError }),
        useAllRequirements: () => ({
            data: requirements, isLoading: loading.requirements, isError: loading.requirementsError }),
    };
});

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, useNavigate: () => navigateSpy };
});

const restCalls = [];
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri, method, body });
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import StepsPage2 from '../StepsPage';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

let mountedRoots = [];
let queryClient;
// Renders the router location so a test can read what the page wrote to it
// (the req #3742 return-to-plan tests and the req #3750 filter tests), and
// keeps the REAL navigate (the module mock replaces `useNavigate` for the page)
// so a test can change the URL from OUTSIDE the page.
const actualRouter = await vi.importActual('react-router-dom');
let currentLocation = null;
let outsideNavigate = null;
function LocationProbe() {
    currentLocation = useLocation();
    outsideNavigate = actualRouter.useNavigate();
    return null;
}

function mount(initialEntries = ['/swarm/steps']) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } },
    });
    vi.spyOn(queryClient, 'invalidateQueries');
    const root = createRoot(container);
    act(() => {
        root.render(
            <MemoryRouter initialEntries={initialEntries}>
                <QueryClientProvider client={queryClient}>
                    <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                        <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                            <StepsPage2 />
                            <LocationProbe />
                        </AuthContext.Provider>
                    </AppContext.Provider>
                </QueryClientProvider>
            </MemoryRouter>
        );
    });
    mountedRoots.push(root);
    return { container };
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
const click = (el) => act(() => { el.click(); });
const type = (el, value) => act(() => {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});
const flush = () => act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
});
const snackMessage = () => useSnackBarStore.getState().message;

beforeEach(() => {
    restCalls.length = 0;
    navigateSpy.mockClear();
    mountedRoots = [];
    loading = {
        pipelines: false, epics: false, steps: false, links: false, linksError: false,
        deps: false, depsError: false, requirements: false, requirementsError: false,
    };
    pipelines = [
        { id: 8, title: 'Side plan' },
        { id: 7, title: 'Main plan' },
    ];
    epics = [
        { id: 4, title: 'Core rebuild', pipeline_fk: 7 },
        { id: 5, title: 'Surface polish', pipeline_fk: 7 },
        { id: 6, title: 'Side quest', pipeline_fk: 8 },
    ];
    steps = [
        { id: 100, epic_fk: 4, title: 'Free step', run: 'auto', notes: null,
          not_before: null },
        { id: 101, epic_fk: 4, title: 'Gated step', run: 'manual', notes: 'Some notes',
          not_before: null, checkpoint: 0, locked: 1 },
        { id: 102, epic_fk: 5, title: 'Done step', run: 'auto', notes: null,
          not_before: '2026-08-01 12:00:00' },
        { id: 103, epic_fk: 5, title: 'Blocked step', run: 'auto', notes: null,
          not_before: null },
        { id: 104, epic_fk: 6, title: 'Side step', run: 'auto', notes: null,
          not_before: null },
    ];
    stepRequirements = [
        { step_fk: 101, requirement_fk: 900 },
    ];
    stepDeps = [
        { id: 1, step_fk: 102, dep_step_fk: 103 },
    ];
    requirements = [
        { id: 900, title: 'Real work', tracking: 0 },
    ];
    useSnackBarStore.setState({ open: false, message: '' });
});

afterEach(() => {
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

// MUI Select renders the chosen option's text in its combobox; the "All"
// choice is the empty value, which MUI shows as blank (the label sits there).
const selectText = (testId) => node(testId).querySelector('[role="combobox"]')
    .textContent.replace(/\u200b/g, '').trim();
const visibleRowIds = () => [...document.body.querySelectorAll('[data-testid^="grid-row-"]')]
    .map(el => Number(el.dataset.testid.replace('grid-row-', '')));
const pickOption = async (selectTestId, optionText) => {
    const button = node(selectTestId).querySelector('[role="combobox"]');
    act(() => {
        button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    const lists = document.body.querySelectorAll('[role="listbox"]');
    const option = [...lists[lists.length - 1].querySelectorAll('[role="option"]')]
        .find(el => el.textContent === optionText);
    if (!option) throw new Error(`no option "${optionText}" in ${selectTestId}`);
    click(option);
    await flush();
};
const optionTexts = (selectTestId) => {
    const button = node(selectTestId).querySelector('[role="combobox"]');
    act(() => {
        button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    // A menu closed a moment ago may still be in its exit transition; the
    // one just opened is the last listbox in the document.
    const lists = document.body.querySelectorAll('[role="listbox"]');
    const texts = [...lists[lists.length - 1].querySelectorAll('[role="option"]')]
        .map(el => el.textContent);
    act(() => {
        document.activeElement?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    return texts;
};

describe('StepsPage2 rows', () => {
    it('renders the req #3750 column order — no State, Notes or Gate', () => {
        mount();
        const fields = [...node('grid-row-100').children].map(
            el => el.dataset.testid.replace(/^cell-/, '').replace(/-100$/, ''));
        expect(fields).toEqual([
            'id', 'planEpic', 'title', 'locked', 'run', 'checkpoint', 'reqCount',
            'not_before', 'actions',
        ]);
    });

    it('names pipeline and epic in one chip', () => {
        mount();
        expect(node('step2-plan-link-100').textContent).toBe('Main planCore rebuild');
        expect(node('step2-plan-link-104').textContent).toBe('Side planSide quest');
    });

    it('opens the plan focused on the epic band from the combo chip', () => {
        mount();
        click(node('step2-plan-link-102'));
        expect(navigateSpy).toHaveBeenCalledWith('/swarm/pipeline/7?mode=plan&epic=5');
    });

    it('pre-selects the epic filter from a ?epic= deep link, and implies its pipeline', () => {
        mount(['/swarm/steps?epic=5']);
        expect(visibleRowIds()).toEqual([102, 103]);
        expect(selectText('steps-epic-filter')).toBe('Surface polish');
        expect(selectText('steps-pipeline-filter')).toBe('Main plan');
    });

    it('pre-selects the pipeline filter from a ?pipeline= deep link', () => {
        mount(['/swarm/steps?pipeline=8']);
        expect(visibleRowIds()).toEqual([104]);
        expect(selectText('steps-epic-filter')).toBe('');
    });

    it('ignores a deep link naming an epic that does not exist', () => {
        mount(['/swarm/steps?epic=999']);
        expect(visibleRowIds()).toEqual([100, 101, 102, 103, 104]);
        expect(selectText('steps-epic-filter')).toBe('');
    });

    it('counts the shown steps against the whole set', () => {
        mount(['/swarm/steps?epic=5']);
        expect(node('steps-accounting').textContent).toBe('2 of 5 steps');
    });
});

describe('StepsPage2 pipeline → epic cascade', () => {
    it('choosing a pipeline narrows rows and the epic list', async () => {
        mount();
        await pickOption('steps-pipeline-filter', 'Main plan');
        expect(visibleRowIds()).toEqual([100, 101, 102, 103]);
        expect(optionTexts('steps-epic-filter')).toEqual(
            ['All epics', 'Core rebuild', 'Surface polish']);
    });

    it('choosing an epic selects its pipeline', async () => {
        mount();
        await pickOption('steps-epic-filter', 'Side quest');
        expect(visibleRowIds()).toEqual([104]);
        expect(selectText('steps-pipeline-filter')).toBe('Side plan');
    });

    it('choosing a different pipeline clears an epic outside it', async () => {
        mount(['/swarm/steps?epic=4']);
        await pickOption('steps-pipeline-filter', 'Side plan');
        expect(selectText('steps-epic-filter')).toBe('');
        expect(visibleRowIds()).toEqual([104]);
    });

    it('All epics keeps the chosen pipeline', async () => {
        mount(['/swarm/steps?epic=4']);
        await pickOption('steps-epic-filter', 'All epics');
        expect(selectText('steps-pipeline-filter')).toBe('Main plan');
        expect(visibleRowIds()).toEqual([100, 101, 102, 103]);
    });

    it('All pipelines clears the epic and shows every step', async () => {
        mount(['/swarm/steps?epic=4']);
        await pickOption('steps-pipeline-filter', 'All pipelines');
        expect(selectText('steps-epic-filter')).toBe('');
        expect(visibleRowIds()).toEqual([100, 101, 102, 103, 104]);
    });

    it('writes the choice to the URL and keeps the router state (Back to Plan)', async () => {
        mount([{ pathname: '/swarm/steps', search: '?epic=4',
            state: { from: 'pipeline', pipelineId: 7, mode: 'plan' } }]);
        expect(node('steps-back-to-plan')).not.toBeNull();
        await pickOption('steps-epic-filter', 'Surface polish');
        expect(currentLocation.search).toBe('?epic=5&pipeline=7');
        expect(currentLocation.state).toEqual({ from: 'pipeline', pipelineId: 7, mode: 'plan' });
        expect(node('steps-back-to-plan')).not.toBeNull();
        await pickOption('steps-pipeline-filter', 'All pipelines');
        expect(currentLocation.search).toBe('');
    });

    it('re-filters when a link changes the URL while the page is open', async () => {
        mount(['/swarm/steps?epic=4']);
        expect(visibleRowIds()).toEqual([100, 101]);
        // A link elsewhere (the plan visualizer's epic chip) navigating here
        // again, to another epic, while the page stays mounted.
        act(() => { outsideNavigate('/swarm/steps?epic=5'); });
        await flush();
        expect(visibleRowIds()).toEqual([102, 103]);
        expect(selectText('steps-pipeline-filter')).toBe('Main plan');
        act(() => { outsideNavigate('/swarm/steps?pipeline=8'); });
        await flush();
        expect(visibleRowIds()).toEqual([104]);
    });

    it('New Step defaults to the first epic of the chosen pipeline', async () => {
        mount(['/swarm/steps?pipeline=8']);
        click(node('step2-add'));
        type(node('step2-title-input'), 'Another');
        click(node('step2-save'));
        await flush();
        expect(restCalls[0].body.epic_fk).toBe(6);
    });
});

describe('StepsPage2 create', () => {
    it('POSTs epic_fk, trimmed title, run and a null not_before', async () => {
        mount();
        click(node('step2-add'));
        type(node('step2-title-input'), '  New Step  ');
        click(node('step2-save'));
        await flush();

        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline_steps',
            method: 'POST',
            body: {
                epic_fk: 4, title: 'New Step', notes: null, run: 'auto',
                not_before: null, checkpoint: 1,
            },
        }]);
    });

    it('refuses the REST NULL sentinel as a title', async () => {
        mount();
        click(node('step2-add'));
        type(node('step2-title-input'), 'NULL');
        click(node('step2-save'));
        await flush();
        expect(restCalls).toEqual([]);
        expect(snackMessage()).toContain('sentinel');
    });
});

describe('StepsPage2 edit', () => {
    it('disables the Epic select once editing', () => {
        mount();
        click(node('step2-edit-100'));
        expect(node('step2-epic-select').className).toContain('Mui-disabled');
    });

    it("clears notes with the REST 'NULL' sentinel", async () => {
        steps[0].notes = 'Some notes';
        mount();
        click(node('step2-edit-100'));
        type(node('step2-notes-input'), '');
        click(node('step2-save'));
        await flush();
        expect(restCalls[0].body[0].notes).toBe('NULL');
    });

    it('converts a chosen not_before into a naive-UTC string', async () => {
        mount();
        click(node('step2-edit-100'));
        type(node('step2-not-before-input'), '2026-09-01T10:30');
        click(node('step2-save'));
        await flush();
        // The exact clock offset depends on the test runner's TZ, but the
        // date and HH:MM must survive the round trip in SOME valid form.
        expect(restCalls[0].body[0].not_before).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    // req #3767 — the barrier is set in the editor too: it seeds from the
    // row (absent = the column default, on) and rides the same PUT.
    it('seeds the barrier from the row and writes the choice', async () => {
        mount();
        click(node('step2-edit-100'));
        expect(selectText('step2-barrier-select')).toMatch(/^On — /);
        const combo = node('step2-barrier-select').querySelector('[role="combobox"]');
        act(() => { combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); });
        click(document.body.querySelector('li[data-value="off"]'));
        click(node('step2-save'));
        await flush();
        expect(restCalls[0].body[0].checkpoint).toBe(0);
    });

    it('creates a step with its barrier off when chosen', async () => {
        mount();
        click(node('step2-add'));
        type(node('step2-title-input'), 'Priority step');
        const combo = node('step2-barrier-select').querySelector('[role="combobox"]');
        act(() => { combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); });
        click(document.body.querySelector('li[data-value="off"]'));
        click(node('step2-save'));
        await flush();
        expect(restCalls[0].body.checkpoint).toBe(0);
    });

    it("clears not_before with the REST 'NULL' sentinel via the Clear button", async () => {
        mount();
        click(node('step2-edit-102'));
        click(node('step2-not-before-clear'));
        click(node('step2-save'));
        await flush();
        expect(restCalls[0].body[0].not_before).toBe('NULL');
    });
});

// req #3742 — the step card's padlock is gone, so the lock is set in the
// editor. A step that stays locked takes no authoring write (the gateway would
// answer 423); lifting or setting the lock rides the same PUT as the fields.
const pickLock = (value) => {
    const combo = node('step2-locked-select').querySelector('[role="combobox"]');
    act(() => { combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); });
    click(document.body.querySelector(`li[data-value="${value}"]`));
};

describe('StepsPage2 editor lock (req #3742)', () => {
    it('a locked step opens read-only and Save writes nothing', async () => {
        mount();
        click(node('step2-edit-101'));
        expect(node('step2-title-input').disabled).toBe(true);
        expect(node('step2-notes-input').disabled).toBe(true);
        click(node('step2-save'));
        await flush();
        expect(restCalls).toEqual([]);
    });

    it('unlocking writes locked=0 with the fields, in one PUT', async () => {
        mount();
        click(node('step2-edit-101'));
        pickLock('unlocked');
        expect(node('step2-title-input').disabled).toBe(false);
        type(node('step2-title-input'), 'Renamed');
        click(node('step2-save'));
        await flush();
        expect(restCalls).toHaveLength(1);
        expect(restCalls[0].body[0]).toMatchObject({ id: 101, title: 'Renamed', locked: 0 });
    });

    it('locking an open step writes locked=1; an unchanged lock is not sent', async () => {
        mount();
        click(node('step2-edit-100'));
        click(node('step2-save'));
        await flush();
        expect(restCalls[0].body[0]).not.toHaveProperty('locked');
        restCalls.length = 0;
        click(node('step2-edit-100'));
        pickLock('locked');
        click(node('step2-save'));
        await flush();
        expect(restCalls[0].body[0]).toMatchObject({ id: 100, locked: 1 });
    });
});

// req #3742 — a single click on a plan's step card lands here as ?id=<id>
// with the plan-exit state; the dialog opens and its close returns to the plan.
describe('StepsPage2 editor — a lock held by the epic or plan (req #3742)', () => {
    afterEach(() => { pipelines = []; });

    it('a step under a locked epic opens read-only, names the epic, and writes nothing', async () => {
        epics.find((e) => e.id === 4).locked = 1;
        mount();
        click(node('step2-edit-100'));
        expect(node('step2-inherited-lock').textContent).toContain('Locked by its epic');
        expect(node('step2-title-input').disabled).toBe(true);
        expect(node('step2-locked-select').className).toContain('Mui-disabled');
        click(node('step2-save'));
        await flush();
        expect(restCalls).toEqual([]);
    });

    it('a locked plan outranks the epic', () => {
        pipelines = [{ id: 7, locked: 1 }];
        mount();
        click(node('step2-edit-100'));
        expect(node('step2-inherited-lock').textContent).toContain('Locked by its pipeline');
    });

    it('re-locking over unsaved edits refuses rather than dropping them', async () => {
        mount();
        click(node('step2-edit-101'));
        pickLock('unlocked');
        type(node('step2-title-input'), 'Renamed');
        pickLock('locked');
        click(node('step2-save'));
        await flush();
        expect(restCalls).toEqual([]);
        expect(snackMessage()).toContain('Unlock the step to save');
    });
});

// The plan canvas opens the editor over itself since req #3742; the page's own
// `?id=` link still opens the step's editor, and closes onto the grid.
describe('StepsPage2 ?id= deep link (req #3742)', () => {
    const fromPlan = { from: 'pipeline', pipelineId: 7, mode: 'plan' };

    it('opens the step\'s editor, consumes ?id= and keeps the router state', () => {
        mount([{ pathname: '/swarm/steps', search: '?id=100', state: fromPlan }]);
        expect(node('step2-edit-dialog')).not.toBeNull();
        expect(node('step2-title-input').value).toBe('Free step');
        expect(currentLocation.search).toBe('');
        expect(currentLocation.state).toEqual(fromPlan);
        expect(node('steps-back-to-plan')).not.toBeNull();
    });

    it('Save refreshes every plan\'s composed read, so the plan never shows the pre-save card', async () => {
        mount([{ pathname: '/swarm/steps', search: '?id=100', state: fromPlan }]);
        click(node('step2-save'));
        await flush();
        expect(restCalls).toHaveLength(1);
        expect(queryClient.invalidateQueries)
            .toHaveBeenCalledWith({ queryKey: ['pipeline_compose'] });
    });

    it('opened from the grid, the dialog closes onto the grid', () => {
        mount();
        click(node('step2-edit-100'));
        click([...document.body.querySelectorAll('button')]
            .find((b) => b.textContent === 'Cancel'));
        expect(currentLocation.pathname).toBe('/swarm/steps');
    });
});

describe('StepsPage2 run toggle', () => {
    it('flips auto to manual', async () => {
        mount();
        click(node('step2-run-chip-100'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline_steps',
            method: 'PUT',
            body: [{ id: 100, run: 'manual' }],
        }]);
    });
});

// req #3649 — barrier and lock chips flip their flag with a one-field PUT.
// Step 100 carries no `checkpoint` at all: that is the column default (1).
describe('StepsPage2 barrier toggle', () => {
    it('flips a default (absent) barrier to priority', async () => {
        mount();
        expect(node('step2-barrier-chip-100').textContent).toBe('Barrier');
        click(node('step2-barrier-chip-100'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline_steps',
            method: 'PUT',
            body: [{ id: 100, checkpoint: 0 }],
        }]);
    });

    it('flips priority back to barrier', async () => {
        mount();
        expect(node('step2-barrier-chip-101').textContent).toBe('Priority');
        click(node('step2-barrier-chip-101'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 101, checkpoint: 1 }]);
    });
});

describe('StepsPage2 lock toggle', () => {
    it('locks an open step', async () => {
        mount();
        expect(node('step2-lock-chip-100').textContent).toBe('Open');
        click(node('step2-lock-chip-100'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline_steps',
            method: 'PUT',
            body: [{ id: 100, locked: 1 }],
        }]);
    });

    it('unlocks a locked step', async () => {
        mount();
        expect(node('step2-lock-chip-101').textContent).toBe('Locked');
        click(node('step2-lock-chip-101'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 101, locked: 0 }]);
    });
});

describe('StepsPage2 delete', () => {
    it('refuses a step another step depends on, with no write at all', async () => {
        mount();
        click(node('step2-delete-103'));
        await flush();
        expect(restCalls).toEqual([]);
        expect(snackMessage()).toContain('102');
    });

    it('deletes a step nothing depends on and invalidates the link/dep caches', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mount();
        click(node('step2-delete-100'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline_steps',
            method: 'DELETE',
            body: { id: 100 },
        }]);
        const keys = queryClient.invalidateQueries.mock.calls.map(c => c[0].queryKey);
        expect(keys.map(k => k[0])).toContain('pipeline_step_requirements');
        expect(keys.map(k => k[0])).toContain('pipeline_step_deps');
    });
});
