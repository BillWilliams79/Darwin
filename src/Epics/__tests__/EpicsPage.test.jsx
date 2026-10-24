// @vitest-environment jsdom
//
// req #3393 — the Pipeline 2.0 epics editor. Structural sibling of the other
// 2.0 page test files (see InitiativesPage2.test.jsx's header for the DataGrid-stub
// rationale, copied rather than imported).
//
// What is pinned: the req #3750 column order (no State, no Notes) and the
// cascading Pipeline → Initiative filter; create/edit send the right body including
// initiative_fk (create only) and the not_before conversion; the run, barrier and
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
    // `data-testid` forwarded from the real usage (`epics-grid`), not
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
let initiatives;
let epics;
let epicRequirements;
let epicDeps;
let requirements;
let loading;

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllPipelines: () => ({ data: pipelines, isLoading: loading.pipelines }),
        useAllInitiatives: () => ({ data: initiatives, isLoading: loading.initiatives }),
        useAllPipelineEpics: () => ({ data: epics, isLoading: loading.epics }),
        useAllPipelineEpicRequirements: () => ({
            data: epicRequirements, isLoading: loading.links, isError: loading.linksError }),
        useAllPipelineEpicDeps: () => ({
            data: epicDeps, isLoading: loading.deps, isError: loading.depsError }),
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

import EpicsPage2 from '../EpicsPage';
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

function mount(initialEntries = ['/swarm/epics']) {
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
                            <EpicsPage2 />
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
        pipelines: false, initiatives: false, epics: false, links: false, linksError: false,
        deps: false, depsError: false, requirements: false, requirementsError: false,
    };
    pipelines = [
        { id: 8, title: 'Side plan' },
        { id: 7, title: 'Main plan' },
    ];
    initiatives = [
        { id: 4, title: 'Core rebuild', pipeline_fk: 7 },
        { id: 5, title: 'Surface polish', pipeline_fk: 7 },
        { id: 6, title: 'Side quest', pipeline_fk: 8 },
    ];
    epics = [
        { id: 100, initiative_fk: 4, title: 'Free epic', run: 'auto', notes: null,
          not_before: null },
        { id: 101, initiative_fk: 4, title: 'Gated epic', run: 'manual', notes: 'Some notes',
          not_before: null, checkpoint: 0, locked: 1 },
        { id: 102, initiative_fk: 5, title: 'Done epic', run: 'auto', notes: null,
          not_before: '2026-08-01 12:00:00' },
        { id: 103, initiative_fk: 5, title: 'Blocked epic', run: 'auto', notes: null,
          not_before: null },
        { id: 104, initiative_fk: 6, title: 'Side epic', run: 'auto', notes: null,
          not_before: null },
    ];
    epicRequirements = [
        { epic_fk: 101, requirement_fk: 900 },
    ];
    epicDeps = [
        { id: 1, epic_fk: 102, dep_epic_fk: 103 },
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

describe('EpicsPage2 rows', () => {
    it('renders the req #3750 column order — no State, Notes or Gate', () => {
        mount();
        const fields = [...node('grid-row-100').children].map(
            el => el.dataset.testid.replace(/^cell-/, '').replace(/-100$/, ''));
        expect(fields).toEqual([
            'id', 'planInitiative', 'title', 'locked', 'run', 'checkpoint', 'reqCount',
            'not_before', 'actions',
        ]);
    });

    it('names pipeline and initiative in one chip', () => {
        mount();
        expect(node('epic-plan-link-100').textContent).toBe('Main planCore rebuild');
        expect(node('epic-plan-link-104').textContent).toBe('Side planSide quest');
    });

    it('opens the plan focused on the initiative band from the combo chip', () => {
        mount();
        click(node('epic-plan-link-102'));
        expect(navigateSpy).toHaveBeenCalledWith('/swarm/pipeline/7?mode=plan&initiative=5');
    });

    it('pre-selects the initiative filter from a ?initiative= deep link, and implies its pipeline', () => {
        mount(['/swarm/epics?initiative=5']);
        expect(visibleRowIds()).toEqual([102, 103]);
        expect(selectText('epics-initiative-filter')).toBe('Surface polish');
        expect(selectText('epics-pipeline-filter')).toBe('Main plan');
    });

    it('pre-selects the pipeline filter from a ?pipeline= deep link', () => {
        mount(['/swarm/epics?pipeline=8']);
        expect(visibleRowIds()).toEqual([104]);
        expect(selectText('epics-initiative-filter')).toBe('');
    });

    it('ignores a deep link naming an initiative that does not exist', () => {
        mount(['/swarm/epics?initiative=999']);
        expect(visibleRowIds()).toEqual([100, 101, 102, 103, 104]);
        expect(selectText('epics-initiative-filter')).toBe('');
    });

    it('counts the shown epics against the whole set', () => {
        mount(['/swarm/epics?initiative=5']);
        expect(node('epics-accounting').textContent).toBe('2 of 5 epics');
    });
});

describe('EpicsPage2 pipeline → initiative cascade', () => {
    it('choosing a pipeline narrows rows and the initiative list', async () => {
        mount();
        await pickOption('epics-pipeline-filter', 'Main plan');
        expect(visibleRowIds()).toEqual([100, 101, 102, 103]);
        expect(optionTexts('epics-initiative-filter')).toEqual(
            ['All initiatives', 'Core rebuild', 'Surface polish']);
    });

    it('choosing an initiative selects its pipeline', async () => {
        mount();
        await pickOption('epics-initiative-filter', 'Side quest');
        expect(visibleRowIds()).toEqual([104]);
        expect(selectText('epics-pipeline-filter')).toBe('Side plan');
    });

    it('choosing a different pipeline clears an initiative outside it', async () => {
        mount(['/swarm/epics?initiative=4']);
        await pickOption('epics-pipeline-filter', 'Side plan');
        expect(selectText('epics-initiative-filter')).toBe('');
        expect(visibleRowIds()).toEqual([104]);
    });

    it('All initiatives keeps the chosen pipeline', async () => {
        mount(['/swarm/epics?initiative=4']);
        await pickOption('epics-initiative-filter', 'All initiatives');
        expect(selectText('epics-pipeline-filter')).toBe('Main plan');
        expect(visibleRowIds()).toEqual([100, 101, 102, 103]);
    });

    it('All pipelines clears the initiative and shows every epic', async () => {
        mount(['/swarm/epics?initiative=4']);
        await pickOption('epics-pipeline-filter', 'All pipelines');
        expect(selectText('epics-initiative-filter')).toBe('');
        expect(visibleRowIds()).toEqual([100, 101, 102, 103, 104]);
    });

    it('writes the choice to the URL and keeps the router state (Back to Plan)', async () => {
        mount([{ pathname: '/swarm/epics', search: '?initiative=4',
            state: { from: 'pipeline', pipelineId: 7, mode: 'plan' } }]);
        expect(node('epics-back-to-plan')).not.toBeNull();
        await pickOption('epics-initiative-filter', 'Surface polish');
        expect(currentLocation.search).toBe('?initiative=5&pipeline=7');
        expect(currentLocation.state).toEqual({ from: 'pipeline', pipelineId: 7, mode: 'plan' });
        expect(node('epics-back-to-plan')).not.toBeNull();
        await pickOption('epics-pipeline-filter', 'All pipelines');
        expect(currentLocation.search).toBe('');
    });

    it('re-filters when a link changes the URL while the page is open', async () => {
        mount(['/swarm/epics?initiative=4']);
        expect(visibleRowIds()).toEqual([100, 101]);
        // A link elsewhere (the plan visualizer's initiative chip) navigating here
        // again, to another initiative, while the page stays mounted.
        act(() => { outsideNavigate('/swarm/epics?initiative=5'); });
        await flush();
        expect(visibleRowIds()).toEqual([102, 103]);
        expect(selectText('epics-pipeline-filter')).toBe('Main plan');
        act(() => { outsideNavigate('/swarm/epics?pipeline=8'); });
        await flush();
        expect(visibleRowIds()).toEqual([104]);
    });

    it('New Epic defaults to the first initiative of the chosen pipeline', async () => {
        mount(['/swarm/epics?pipeline=8']);
        click(node('epic-add'));
        type(node('epic-title-input'), 'Another');
        click(node('epic-save'));
        await flush();
        expect(restCalls[0].body.initiative_fk).toBe(6);
    });
});

describe('EpicsPage2 create', () => {
    it('POSTs initiative_fk, trimmed title, run and a null not_before', async () => {
        mount();
        click(node('epic-add'));
        type(node('epic-title-input'), '  New Epic  ');
        click(node('epic-save'));
        await flush();

        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/epics',
            method: 'POST',
            body: {
                initiative_fk: 4, title: 'New Epic', notes: null, run: 'auto',
                not_before: null, checkpoint: 1,
            },
        }]);
    });

    it('refuses the REST NULL sentinel as a title', async () => {
        mount();
        click(node('epic-add'));
        type(node('epic-title-input'), 'NULL');
        click(node('epic-save'));
        await flush();
        expect(restCalls).toEqual([]);
        expect(snackMessage()).toContain('sentinel');
    });
});

describe('EpicsPage2 edit', () => {
    // req #3800 — a greyed-out parent selector opening the dialog read as "the
    // name cannot be edited". The name leads, enabled; the initiative is text.
    it('leads with the editable name and shows the initiative as text once editing', () => {
        mount();
        click(node('epic-edit-100'));
        const dialog = node('epic-edit-dialog');
        expect(dialog.querySelector('input:not([type="hidden"]), textarea'))
            .toBe(node('epic-title-input'));
        expect(node('epic-title-input').disabled).toBe(false);
        expect(node('epic-initiative-select')).toBeNull();
        expect(node('epic-initiative-readonly').textContent).toContain('Core rebuild');
        expect(dialog.textContent).not.toMatch(/MCP/);
    });

    it("clears notes with the REST 'NULL' sentinel", async () => {
        epics[0].notes = 'Some notes';
        mount();
        click(node('epic-edit-100'));
        type(node('epic-notes-input'), '');
        click(node('epic-save'));
        await flush();
        expect(restCalls[0].body[0].notes).toBe('NULL');
    });

    it('converts a chosen not_before into a naive-UTC string', async () => {
        mount();
        click(node('epic-edit-100'));
        type(node('epic-not-before-input'), '2026-09-01T10:30');
        click(node('epic-save'));
        await flush();
        // The exact clock offset depends on the test runner's TZ, but the
        // date and HH:MM must survive the round trip in SOME valid form.
        expect(restCalls[0].body[0].not_before).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    // req #3767 — the barrier is set in the editor too: it seeds from the
    // row (absent = the column default, on) and rides the same PUT.
    it('seeds the barrier from the row and writes the choice', async () => {
        mount();
        click(node('epic-edit-100'));
        expect(selectText('epic-barrier-select')).toMatch(/^On — /);
        const combo = node('epic-barrier-select').querySelector('[role="combobox"]');
        act(() => { combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); });
        click(document.body.querySelector('li[data-value="off"]'));
        click(node('epic-save'));
        await flush();
        expect(restCalls[0].body[0].checkpoint).toBe(0);
    });

    it('creates an epic with its barrier off when chosen', async () => {
        mount();
        click(node('epic-add'));
        type(node('epic-title-input'), 'Priority epic');
        const combo = node('epic-barrier-select').querySelector('[role="combobox"]');
        act(() => { combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); });
        click(document.body.querySelector('li[data-value="off"]'));
        click(node('epic-save'));
        await flush();
        expect(restCalls[0].body.checkpoint).toBe(0);
    });

    it("clears not_before with the REST 'NULL' sentinel via the Clear button", async () => {
        mount();
        click(node('epic-edit-102'));
        click(node('epic-not-before-clear'));
        click(node('epic-save'));
        await flush();
        expect(restCalls[0].body[0].not_before).toBe('NULL');
    });
});

// req #3742 — the epic card's padlock is gone, so the lock is set in the
// editor. An epic that stays locked takes no authoring write (the gateway would
// answer 423); lifting or setting the lock rides the same PUT as the fields.
const pickLock = (value) => {
    const combo = node('epic-locked-select').querySelector('[role="combobox"]');
    act(() => { combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); });
    click(document.body.querySelector(`li[data-value="${value}"]`));
};

describe('EpicsPage2 editor lock (req #3742)', () => {
    it('a locked epic opens read-only and Save writes nothing', async () => {
        mount();
        click(node('epic-edit-101'));
        expect(node('epic-title-input').disabled).toBe(true);
        expect(node('epic-notes-input').disabled).toBe(true);
        click(node('epic-save'));
        await flush();
        expect(restCalls).toEqual([]);
    });

    it('unlocking writes locked=0 with the fields, in one PUT', async () => {
        mount();
        click(node('epic-edit-101'));
        pickLock('unlocked');
        expect(node('epic-title-input').disabled).toBe(false);
        type(node('epic-title-input'), 'Renamed');
        click(node('epic-save'));
        await flush();
        expect(restCalls).toHaveLength(1);
        expect(restCalls[0].body[0]).toMatchObject({ id: 101, title: 'Renamed', locked: 0 });
    });

    it('locking an open epic writes locked=1; an unchanged lock is not sent', async () => {
        mount();
        click(node('epic-edit-100'));
        click(node('epic-save'));
        await flush();
        expect(restCalls[0].body[0]).not.toHaveProperty('locked');
        restCalls.length = 0;
        click(node('epic-edit-100'));
        pickLock('locked');
        click(node('epic-save'));
        await flush();
        expect(restCalls[0].body[0]).toMatchObject({ id: 100, locked: 1 });
    });
});

// req #3742 — a single click on a plan's epic card lands here as ?id=<id>
// with the plan-exit state; the dialog opens and its close returns to the plan.
describe('EpicsPage2 editor — a lock held by the initiative or plan (req #3742)', () => {
    afterEach(() => { pipelines = []; });

    it('an epic under a locked initiative opens read-only, names the initiative, and writes nothing', async () => {
        initiatives.find((e) => e.id === 4).locked = 1;
        mount();
        click(node('epic-edit-100'));
        expect(node('epic-inherited-lock').textContent).toContain('Locked by its initiative');
        expect(node('epic-title-input').disabled).toBe(true);
        expect(node('epic-locked-select').className).toContain('Mui-disabled');
        click(node('epic-save'));
        await flush();
        expect(restCalls).toEqual([]);
    });

    it('a locked plan outranks the initiative', () => {
        pipelines = [{ id: 7, locked: 1 }];
        mount();
        click(node('epic-edit-100'));
        expect(node('epic-inherited-lock').textContent).toContain('Locked by its pipeline');
    });

    it('re-locking over unsaved edits refuses rather than dropping them', async () => {
        mount();
        click(node('epic-edit-101'));
        pickLock('unlocked');
        type(node('epic-title-input'), 'Renamed');
        pickLock('locked');
        click(node('epic-save'));
        await flush();
        expect(restCalls).toEqual([]);
        expect(snackMessage()).toContain('Unlock the epic to save');
    });
});

// The plan canvas opens the editor over itself since req #3742; the page's own
// `?id=` link still opens the epic's editor, and closes onto the grid.
describe('EpicsPage2 ?id= deep link (req #3742)', () => {
    const fromPlan = { from: 'pipeline', pipelineId: 7, mode: 'plan' };

    it('opens the epic\'s editor, consumes ?id= and keeps the router state', () => {
        mount([{ pathname: '/swarm/epics', search: '?id=100', state: fromPlan }]);
        expect(node('epic-edit-dialog')).not.toBeNull();
        expect(node('epic-title-input').value).toBe('Free epic');
        expect(currentLocation.search).toBe('');
        expect(currentLocation.state).toEqual(fromPlan);
        expect(node('epics-back-to-plan')).not.toBeNull();
    });

    it('Save refreshes every plan\'s composed read, so the plan never shows the pre-save card', async () => {
        mount([{ pathname: '/swarm/epics', search: '?id=100', state: fromPlan }]);
        click(node('epic-save'));
        await flush();
        expect(restCalls).toHaveLength(1);
        expect(queryClient.invalidateQueries)
            .toHaveBeenCalledWith({ queryKey: ['pipeline_compose'] });
    });

    it('opened from the grid, the dialog closes onto the grid', () => {
        mount();
        click(node('epic-edit-100'));
        click([...document.body.querySelectorAll('button')]
            .find((b) => b.textContent === 'Cancel'));
        expect(currentLocation.pathname).toBe('/swarm/epics');
    });
});

describe('EpicsPage2 run toggle', () => {
    it('flips auto to manual', async () => {
        mount();
        click(node('epic-run-chip-100'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/epics',
            method: 'PUT',
            body: [{ id: 100, run: 'manual' }],
        }]);
    });
});

// req #3649 — barrier and lock chips flip their flag with a one-field PUT.
// Epic 100 carries no `checkpoint` at all: that is the column default (1).
describe('EpicsPage2 barrier toggle', () => {
    it('flips a default (absent) barrier to priority', async () => {
        mount();
        expect(node('epic-barrier-chip-100').textContent).toBe('Barrier');
        click(node('epic-barrier-chip-100'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/epics',
            method: 'PUT',
            body: [{ id: 100, checkpoint: 0 }],
        }]);
    });

    it('flips priority back to barrier', async () => {
        mount();
        expect(node('epic-barrier-chip-101').textContent).toBe('Priority');
        click(node('epic-barrier-chip-101'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 101, checkpoint: 1 }]);
    });
});

describe('EpicsPage2 lock toggle', () => {
    it('locks an open epic', async () => {
        mount();
        expect(node('epic-lock-chip-100').textContent).toBe('Open');
        click(node('epic-lock-chip-100'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/epics',
            method: 'PUT',
            body: [{ id: 100, locked: 1 }],
        }]);
    });

    it('unlocks a locked epic', async () => {
        mount();
        expect(node('epic-lock-chip-101').textContent).toBe('Locked');
        click(node('epic-lock-chip-101'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 101, locked: 0 }]);
    });
});

describe('EpicsPage2 delete', () => {
    it('refuses an epic another epic depends on, with no write at all', async () => {
        mount();
        click(node('epic-delete-103'));
        await flush();
        expect(restCalls).toEqual([]);
        expect(snackMessage()).toContain('102');
    });

    it('deletes an epic nothing depends on and invalidates the link/dep caches', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mount();
        click(node('epic-delete-100'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/epics',
            method: 'DELETE',
            body: { id: 100 },
        }]);
        const keys = queryClient.invalidateQueries.mock.calls.map(c => c[0].queryKey);
        expect(keys.map(k => k[0])).toContain('epic_requirements');
        expect(keys.map(k => k[0])).toContain('epic_deps');
    });
});
