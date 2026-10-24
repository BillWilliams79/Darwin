// @vitest-environment jsdom
//
// req #3393 — the Pipeline 2.0 initiatives editor. Structural sibling of
// Darwin/src/Initiatives/__tests__/InitiativesPage.test.jsx, same DataGrid-stub rationale
// (see that file's header) — copied rather than imported, matching the rest
// of this feature's file-isolation rule.
//
// What is pinned: create/edit send the right body including the REST 'NULL'
// sentinel; the Pipeline select is disabled once editing; the initiative_status
// pause chip toggles with a one-field PUT; the closed chip and closed filter;
// delete names the epic-cascade consequence; the epic_count link navigates to
// the initiative-filtered epics view.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigations = [];
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal()),
    useNavigate: () => (to) => navigations.push(to),
}));

vi.mock('@mui/x-data-grid', () => ({
    GridToolbar: () => null,
    // `data-testid` forwarded from the real usage (`initiatives-grid`), not
    // hardcoded — see PipelinesPage2.test.jsx's identical fix for why a
    // hardcoded value here is a latent bug (found via that file's view-toggle
    // test, the only one that queried a grid's own testid directly).
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
let categories;
let loading;
let initiativeDeps = [];

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllPipelines: () => ({ data: pipelines, isLoading: loading.pipelines }),
        useAllInitiatives: () => ({ data: initiatives, isLoading: loading.initiatives }),
        useAllPipelineEpics: () => ({ data: epics, isLoading: loading.epics }),
        useAllCategories: () => ({ data: categories, isLoading: loading.categories }),
        // req #3823 — initiative-to-initiative edges (none unless a test seeds them).
        useAllInitiativeDeps: () => ({ data: initiativeDeps, isSuccess: true }),
    };
});

const restCalls = [];
// Keyed by exact GET uri -> data to return; unset GETs (and every non-GET)
// fall back to the empty-array default. Lets the two-phase-delete tests
// script a live re-read without a full REST mock.
let restGetResponses = {};
// `${method} ${uri}` -> the `httpStatus` call_rest_api THROWS for it (req #3823:
// a gateway refusal), as the real one does on a non-2xx.
let restFailures = {};
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri, method, body });
        const failure = restFailures[`${method} ${uri}`];
        if (failure) return Promise.reject({ data: null, httpStatus: failure });
        if (method === 'GET' && Object.prototype.hasOwnProperty.call(restGetResponses, uri)) {
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: restGetResponses[uri] });
        }
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import InitiativesPage2 from '../InitiativesPage';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

let mountedRoots = [];
let queryClient;
// Renders the router location so a test can read what the page wrote to it,
// and keeps the REAL navigate (the module mock replaces `useNavigate` for the
// page) so a test can change the URL from OUTSIDE the page — the same probe
// EpicsPage.test.jsx uses for its own filter tests.
const actualRouter = await vi.importActual('react-router-dom');
let currentLocation = null;
let outsideNavigate = null;
function LocationProbe() {
    currentLocation = useLocation();
    outsideNavigate = actualRouter.useNavigate();
    return null;
}

function mount(initialEntries = ['/swarm/initiatives']) {
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
                            <InitiativesPage2 />
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
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
// MUI Select renders the chosen option's text in its combobox; the "All"
// choice is the empty value, which MUI shows as blank (the label sits there).
const selectText = (testId) => node(testId).querySelector('[role="combobox"]')
    .textContent.replace(/\u200b/g, '').trim();
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
const rowIds = () => [...document.body.querySelectorAll('[data-testid^="grid-row-"]')]
    .map(el => Number(el.getAttribute('data-testid').replace('grid-row-', '')));

beforeEach(() => {
    navigations.length = 0;
    restCalls.length = 0;
    restGetResponses = {};
    restFailures = {};
    initiativeDeps = [];
    mountedRoots = [];
    loading = { pipelines: false, initiatives: false, epics: false, categories: false };
    pipelines = [
        { id: 7, title: 'Plan Seven' },
        { id: 8, title: 'Plan Eight' },
    ];
    initiatives = [
        { id: 4, pipeline_fk: 7, title: 'Core rebuild', description: null, category_fk: 1,
          initiative_status: 'active', closed: 0, sort_order: 0, create_ts: '2026-08-01 00:00:00' },
        { id: 5, pipeline_fk: 7, title: 'Parked work', description: null, category_fk: 1,
          initiative_status: 'paused', locked: 1, closed: 0, sort_order: 1,
          create_ts: '2026-08-01 00:00:00' },
        { id: 6, pipeline_fk: 7, title: 'Retired', description: null, category_fk: 1,
          initiative_status: 'active', closed: 1, sort_order: 2, create_ts: '2026-08-01 00:00:00' },
    ];
    epics = [
        { id: 100, initiative_fk: 4 },
        { id: 101, initiative_fk: 4 },
        { id: 102, initiative_fk: 5 },
    ];
    categories = [
        { id: 1, category_name: 'Darwin', color: '#123456', closed: 0, sort_order: 5 },
    ];
    useSnackBarStore.setState({ open: false, message: '' });
});

afterEach(() => {
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('InitiativesPage2 rows', () => {
    it('shows open initiatives by default, ordered by sort_order', () => {
        mount();
        expect(rowIds()).toEqual([4, 5]);
    });

    it('adds closed initiatives when the Closed chip is toggled on', () => {
        mount();
        click(node('initiatives-closed-chip-closed'));
        expect(rowIds()).toEqual([4, 5, 6]);
    });

    it('counts epics filed under each initiative', () => {
        mount();
        expect(node('initiative-epics-link-4').textContent).toBe('2');
        expect(node('initiative-epics-link-5').textContent).toBe('1');
    });

    it('resolves the pipeline title for the row', () => {
        mount();
        expect(node('cell-pipeline_title-4').textContent).toBe('Plan Seven');
    });
});

// req #3864 — the title bar's Pipeline selector, EpicsPage's contract without
// its Initiative half.
describe('InitiativesPage pipeline filter (req #3864)', () => {
    beforeEach(() => {
        initiatives.push({ id: 9, pipeline_fk: 8, title: 'Other plan work', description: null,
            category_fk: 1, initiative_status: 'active', closed: 0, sort_order: 0,
            create_ts: '2026-08-01 00:00:00' });
    });

    it('shows every pipeline\'s initiatives by default', () => {
        mount();
        expect(rowIds()).toEqual([4, 9, 5]);
        expect(selectText('initiatives-pipeline-filter')).toBe('');
    });

    it('pre-selects the pipeline from a ?pipeline= deep link', () => {
        mount(['/swarm/initiatives?pipeline=8']);
        expect(rowIds()).toEqual([9]);
        expect(selectText('initiatives-pipeline-filter')).toBe('Plan Eight');
        expect(node('initiatives-accounting').textContent).toBe('1 of 4 initiatives');
    });

    it('ignores a deep link naming a pipeline that does not exist', () => {
        mount(['/swarm/initiatives?pipeline=999']);
        expect(rowIds()).toEqual([4, 9, 5]);
        expect(selectText('initiatives-pipeline-filter')).toBe('');
    });

    it('choosing a pipeline narrows the rows and writes the URL, keeping router state', async () => {
        mount([{ pathname: '/swarm/initiatives', state: { from: 'pipeline', pipelineId: 7 } }]);
        await pickOption('initiatives-pipeline-filter', 'Plan Seven');
        expect(rowIds()).toEqual([4, 5]);
        expect(currentLocation.search).toBe('?pipeline=7');
        expect(currentLocation.state).toEqual({ from: 'pipeline', pipelineId: 7 });
        await pickOption('initiatives-pipeline-filter', 'All pipelines');
        expect(rowIds()).toEqual([4, 9, 5]);
        expect(currentLocation.search).toBe('');
    });

    it('composes with the closed filter', async () => {
        mount(['/swarm/initiatives?pipeline=7']);
        click(node('initiatives-closed-chip-closed'));
        expect(rowIds()).toEqual([4, 5, 6]);
    });

    it('re-filters when a link changes the URL while the page is open', async () => {
        mount(['/swarm/initiatives?pipeline=7']);
        act(() => { outsideNavigate('/swarm/initiatives?pipeline=8'); });
        await flush();
        expect(rowIds()).toEqual([9]);
        expect(selectText('initiatives-pipeline-filter')).toBe('Plan Eight');
    });

    it('New Initiative defaults to the chosen pipeline', async () => {
        restGetResponses = {
            'http://test.local/darwin/initiatives?pipeline_fk=8&fields=id,sort_order':
                [{ id: 9, sort_order: 0 }],
        };
        mount(['/swarm/initiatives?pipeline=8']);
        click(node('initiative-add'));
        expect(selectText('initiative-pipeline-select')).toBe('Plan Eight');
        type(node('initiative-title-input'), 'Filed under eight');
        click(node('initiative-save'));
        await flush();
        const post = restCalls.find(c => c.method === 'POST');
        expect(post.body).toMatchObject({ pipeline_fk: 8, sort_order: 1 });
    });
});

describe('InitiativesPage — connection to the epics view', () => {
    it('navigates to the initiative-filtered epics view from the Epics cell', () => {
        mount();
        click(node('initiative-epics-link-4'));
        expect(navigations).toEqual(['/swarm/epics?initiative=4']);
    });
});

describe('InitiativesPage2 create', () => {
    it('POSTs pipeline_fk, trimmed title and the first open category', async () => {
        // req #3861 — a blank sort order APPENDS to the plan's hard order: one
        // past the plan's highest, read just before the POST.
        restGetResponses = {
            'http://test.local/darwin/initiatives?pipeline_fk=7&fields=id,sort_order':
                [{ id: 4, sort_order: 0 }, { id: 5, sort_order: 3 }],
        };
        mount();
        click(node('initiative-add'));
        type(node('initiative-title-input'), '  New Initiative  ');
        click(node('initiative-save'));
        await flush();

        expect(restCalls.filter((c) => c.method !== 'GET')).toEqual([{
            uri: 'http://test.local/darwin/initiatives',
            method: 'POST',
            body: {
                pipeline_fk: 7, title: 'New Initiative', description: null,
                category_fk: 1, sort_order: 4, initiative_status: 'active',
            },
        }]);
    });

    it('keeps a typed sort order and reads nothing for it', async () => {
        mount();
        click(node('initiative-add'));
        type(node('initiative-title-input'), 'Placed');
        type(node('initiative-sort-order-input'), '2');
        click(node('initiative-save'));
        await flush();
        expect(restCalls.map((c) => c.method)).toEqual(['POST']);
        expect(restCalls[0].body.sort_order).toBe(2);
    });

    it('refuses to submit without a pipeline selected', async () => {
        pipelines = [];
        mount();
        expect(node('initiative-add').disabled).toBe(true);
    });
});

describe('InitiativesPage2 edit', () => {
    // req #3800 — a greyed-out Pipeline select captioned with an MCP tool name
    // read as "the name cannot be edited". The name leads; the plan is text.
    it('leads with the editable name and shows the plan as text once editing', () => {
        mount();
        click(node('initiative-edit-4'));
        const dialog = node('initiative-edit-dialog');
        expect(dialog.querySelector('input:not([type="hidden"]), textarea'))
            .toBe(node('initiative-title-input'));
        expect(node('initiative-title-input').disabled).toBe(false);
        expect(node('initiative-pipeline-select')).toBeNull();
        expect(node('initiative-pipeline-readonly').textContent).toContain('Plan Seven');
        expect(dialog.textContent).not.toMatch(/MCP/);
    });

    it('PUTs every editable column, never pipeline_fk', async () => {
        mount();
        click(node('initiative-edit-4'));
        type(node('initiative-title-input'), 'Renamed');
        click(node('initiative-save'));
        await flush();

        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/initiatives',
            method: 'PUT',
            body: [{
                id: 4, title: 'Renamed', description: 'NULL',
                category_fk: 1, sort_order: 0, initiative_status: 'active',
            }],
        }]);
    });

    it('never clears sort_order — a blank keeps the initiative\'s place (req #3861)', async () => {
        mount();
        click(node('initiative-edit-4'));
        type(node('initiative-sort-order-input'), '');
        click(node('initiative-save'));
        await flush();
        expect(restCalls[0].body[0]).not.toHaveProperty('sort_order');
    });
});

// req #3742 — the page's own `?id=` link opens the initiative's editor, and a save
// refreshes every plan's composed read (the plan canvas opens the same editor
// over itself, so nothing navigates back to a plan from here).
describe('InitiativesPage2 ?id= deep link (req #3742)', () => {
    const cancel = () => click([...document.body.querySelectorAll('button')]
        .find((b) => b.textContent === 'Cancel'));

    it('opens the initiative\'s editor', () => {
        mount(['/swarm/initiatives?id=4']);
        expect(node('initiative-edit-dialog')).not.toBeNull();
        expect(node('initiative-title-input').value).toBe('Core rebuild');
    });

    it('Save writes, and refreshes every plan\'s composed read', async () => {
        mount(['/swarm/initiatives?id=4']);
        type(node('initiative-title-input'), 'Renamed');
        click(node('initiative-save'));
        await flush();
        expect(restCalls[0].body[0]).toMatchObject({ id: 4, title: 'Renamed' });
        expect(queryClient.invalidateQueries)
            .toHaveBeenCalledWith({ queryKey: ['pipeline_compose'] });
    });

    it('closes onto the grid — it navigates nowhere', () => {
        mount(['/swarm/initiatives?id=4']);
        cancel();
        expect(navigations).toEqual([]);
    });
});

describe('InitiativesPage2 pause toggle', () => {
    it('pauses an active initiative with a one-field PUT', async () => {
        mount();
        click(node('initiative-pause-chip-4'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/initiatives',
            method: 'PUT',
            body: [{ id: 4, initiative_status: 'paused' }],
        }]);
    });

    it('unpauses a paused initiative', async () => {
        mount();
        click(node('initiative-pause-chip-5'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 5, initiative_status: 'active' }]);
    });
});

// req #3649 — the lock chip flips `locked` with a one-field PUT.
describe('InitiativesPage2 lock toggle', () => {
    it('locks an open initiative', async () => {
        mount();
        expect(node('initiative-lock-chip-4').textContent).toBe('Open');
        click(node('initiative-lock-chip-4'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/initiatives',
            method: 'PUT',
            body: [{ id: 4, locked: 1 }],
        }]);
    });

    it('unlocks a locked initiative', async () => {
        mount();
        expect(node('initiative-lock-chip-5').textContent).toBe('Locked');
        click(node('initiative-lock-chip-5'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 5, locked: 0 }]);
    });
});

describe('InitiativesPage2 closed toggle', () => {
    it('closes an open initiative', async () => {
        mount();
        click(node('initiative-toggle-closed-4'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/initiatives',
            method: 'PUT',
            body: [{ id: 4, closed: 1 }],
        }]);
    });
});

describe('InitiativesPage2 delete', () => {
    it('does nothing when the confirmation is declined', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        mount();
        click(node('initiative-delete-4'));
        await flush();
        expect(restCalls).toEqual([]);
    });

    it('names the epic-cascade consequence in the confirmation', () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        mount();
        click(node('initiative-delete-4'));
        expect(confirmSpy.mock.calls[0][0]).toContain('2 epics will be deleted');
    });

    it('DELETEs by id and invalidates the epics cache', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mount();
        click(node('initiative-delete-4'));
        await flush();

        // Two-phase delete (code review, req #3393): first reads this initiative's
        // own epic ids so any intra/cross-initiative dependency edges can be sorted
        // before the initiative DELETE — see initiativesApi.js's `deleteInitiative` header.
        // The mock returns an empty epic list, so no dep-edge reads/clears
        // follow; that branch has its own coverage below.
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/epics?initiative_fk=4&fields=id,locked',
            method: 'GET',
            body: '',
        }, {
            // req #3649 — the initiative's own lock (and, when it names a plan, the
            // plan's) is read BEFORE any write.
            uri: 'http://test.local/darwin/initiatives?id=4&fields=id,pipeline_fk,locked',
            method: 'GET',
            body: '',
        }, {
            // req #3823 — whether another initiative waits for this one.
            uri: 'http://test.local/darwin/initiative_deps?dep_initiative_fk=4&fields=id,initiative_fk',
            method: 'GET',
            body: '',
        }, {
            uri: 'http://test.local/darwin/initiatives',
            method: 'DELETE',
            body: { id: 4 },
        }]);
        const keys = queryClient.invalidateQueries.mock.calls.map(c => c[0].queryKey);
        expect(keys.map(k => k[0])).toContain('initiatives');
        expect(keys.map(k => k[0])).toContain('epics');
    });

    it('clears an intra-initiative dependency edge, then deletes (two-phase delete)', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        // Initiative 4 owns epics 100 and 101 (see the `epics` fixture above); 101
        // depends on 100, both inside initiative 4 — the InnoDB RESTRICT-vs-cascade
        // false refusal `deleteInitiative`'s header describes.
        restGetResponses['http://test.local/darwin/epics?initiative_fk=4&fields=id,locked'] =
            [{ id: 100 }, { id: 101 }];
        restGetResponses['http://test.local/darwin/epic_deps?dep_epic_fk=(100,101)'
            + '&fields=id,epic_fk,dep_epic_fk'] = [{ id: 900, epic_fk: 101, dep_epic_fk: 100 }];
        mount();
        click(node('initiative-delete-4'));
        await flush();

        expect(restCalls.map(c => ({ uri: c.uri, method: c.method }))).toEqual([
            { uri: 'http://test.local/darwin/epics?initiative_fk=4&fields=id,locked', method: 'GET' },
            { uri: 'http://test.local/darwin/initiatives?id=4&fields=id,pipeline_fk,locked', method: 'GET' },
            {
                uri: 'http://test.local/darwin/initiative_deps?dep_initiative_fk=4'
                    + '&fields=id,initiative_fk',
                method: 'GET',
            },
            {
                uri: 'http://test.local/darwin/epic_deps?dep_epic_fk=(100,101)'
                    + '&fields=id,epic_fk,dep_epic_fk',
                method: 'GET',
            },
            { uri: 'http://test.local/darwin/epic_deps', method: 'DELETE' },
            { uri: 'http://test.local/darwin/initiatives', method: 'DELETE' },
        ]);
        expect(restCalls[4].body).toEqual({ id: 900 });
        expect(restCalls[5].body).toEqual({ id: 4 });
        expect(useSnackBarStore.getState().open).toBe(false);
    });

    it('refuses, naming them, while another initiative waits for this one (req #3823)', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        restGetResponses['http://test.local/darwin/initiative_deps?dep_initiative_fk=4'
            + '&fields=id,initiative_fk'] = [{ id: 70, initiative_fk: 5 }];
        mount();
        click(node('initiative-delete-4'));
        await flush();

        expect(restCalls.some(c => c.method === 'DELETE')).toBe(false);
        expect(useSnackBarStore.getState().open).toBe(true);
        expect(useSnackBarStore.getState().message).toContain('initiative 5 depends on it');
    });

    it('refuses when an epic outside the initiative depends on one of its epics', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        // Epic 102 belongs to initiative 5 (see the `epics` fixture above) and
        // depends on epic 100, which belongs to initiative 4 — a real cross-initiative
        // edge, not the false-refusal case above.
        restGetResponses['http://test.local/darwin/epics?initiative_fk=4&fields=id,locked'] =
            [{ id: 100 }, { id: 101 }];
        restGetResponses['http://test.local/darwin/epic_deps?dep_epic_fk=(100,101)'
            + '&fields=id,epic_fk,dep_epic_fk'] = [{ id: 901, epic_fk: 102, dep_epic_fk: 100 }];
        mount();
        click(node('initiative-delete-4'));
        await flush();

        expect(restCalls.some(c => c.method === 'DELETE')).toBe(false);
        expect(useSnackBarStore.getState().open).toBe(true);
        expect(useSnackBarStore.getState().message).toContain('409');
    });

    it('refuses BEFORE any write when an epic under the initiative is locked (req #3649)', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        restGetResponses['http://test.local/darwin/epics?initiative_fk=4&fields=id,locked'] =
            [{ id: 100, locked: 1 }, { id: 101, locked: 0 }];
        restGetResponses['http://test.local/darwin/epic_deps?dep_epic_fk=(100,101)'
            + '&fields=id,epic_fk,dep_epic_fk'] = [{ id: 900, epic_fk: 101, dep_epic_fk: 100 }];
        mount();
        click(node('initiative-delete-4'));
        await flush();
        // The intra-initiative edge would otherwise be deleted first and the initiative
        // delete refused after — a plan stripped of a gate. Nothing is written.
        expect(restCalls.some(c => c.method === 'DELETE')).toBe(false);
        expect(useSnackBarStore.getState().open).toBe(true);
        expect(useSnackBarStore.getState().message).toContain('423');
    });

    it('refuses BEFORE any write when the initiative itself is locked (req #3649)', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        restGetResponses['http://test.local/darwin/initiatives?id=4&fields=id,pipeline_fk,locked'] =
            [{ id: 4, pipeline_fk: 1, locked: 1 }];
        mount();
        click(node('initiative-delete-4'));
        await flush();
        expect(restCalls.some(c => c.method === 'DELETE')).toBe(false);
        expect(useSnackBarStore.getState().message).toContain('423');
    });
});

// req #3823 — the editor's "Waits for": the initiatives this one waits for,
// written as initiative_deps rows before anything else, and refused with the
// server's own sentence.
describe('InitiativesPage2 waits for (req #3823)', () => {
    const chooseDependency = async (id) => {
        const combo = node('initiative-deps-select').querySelector('[role="combobox"]');
        act(() => {
            combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        });
        await flush();
        click(node(`initiative-deps-option-${id}`));
    };

    it('lists what each initiative waits for, by name', () => {
        initiativeDeps = [{ id: 70, initiative_fk: 5, dep_initiative_fk: 4 }];
        mount();
        expect(node('initiative-waits-for-5').textContent).toBe('1 · Core rebuild');
        expect(node('initiative-waits-for-4')).toBeNull();
    });

    it('adds the chosen dependency BEFORE writing the initiative', async () => {
        mount();
        click(node('initiative-edit-4'));
        await chooseDependency(5);
        click(node('initiative-save'));
        await flush();
        const writes = restCalls.filter((c) => c.method !== 'GET');
        expect(writes[0]).toEqual({ uri: 'http://test.local/darwin/initiative_deps', method: 'POST',
            body: { initiative_fk: 4, dep_initiative_fk: 5 } });
        expect(writes[1].uri).toBe('http://test.local/darwin/initiatives');
        const keys = queryClient.invalidateQueries.mock.calls.map((c) => c[0].queryKey[0]);
        expect(keys).toContain('initiative_deps');
    });

    it("removes an unchecked dependency by both columns", async () => {
        initiativeDeps = [{ id: 70, initiative_fk: 4, dep_initiative_fk: 5 }];
        mount();
        click(node('initiative-edit-4'));
        await chooseDependency(5);
        click(node('initiative-save'));
        await flush();
        expect(restCalls.find((c) => c.uri.endsWith('/initiative_deps'))).toEqual({
            uri: 'http://test.local/darwin/initiative_deps', method: 'DELETE',
            body: { initiative_fk: 4, dep_initiative_fk: 5 } });
    });

    it("a refused dependency shows the server's reason and writes nothing else", async () => {
        restFailures['POST http://test.local/darwin/initiative_deps'] = {
            httpStatus: 409, httpMessage: 'initiative 4 cannot depend on initiative 5: …',
            httpDetail: { error: 'CONFLICT', constraint: 'initiative-cycle',
                message: 'initiative 4 cannot depend on initiative 5: initiative 5 already '
                    + 'waits for initiative 4 (5 -> 4), so the two would hold each other forever' },
        };
        mount();
        click(node('initiative-edit-4'));
        await chooseDependency(5);
        click(node('initiative-save'));
        await flush();
        expect(restCalls.some((c) => c.method === 'PUT')).toBe(false);
        const { open, message } = useSnackBarStore.getState();
        expect(open).toBe(true);
        expect(message).toContain('hold each other forever');
        expect(message).toContain('409');
        expect(node('initiative-edit-dialog')).not.toBeNull();
    });
});

describe('InitiativesPage2 waits for — a save that did not touch it (req #3823 review)', () => {
    it('writes no dependency at all when the field was left alone', async () => {
        initiativeDeps = [{ id: 70, initiative_fk: 4, dep_initiative_fk: 5 }];
        mount();
        click(node('initiative-edit-4'));
        type(node('initiative-title-input'), 'Renamed');
        click(node('initiative-save'));
        await flush();
        expect(restCalls.some((c) => c.uri.includes('initiative_deps') && c.method !== 'GET'))
            .toBe(false);
    });
});
