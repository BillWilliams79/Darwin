// @vitest-environment jsdom
//
// req #3393 — the Pipeline 2.0 epics editor. Structural sibling of
// Darwin/src/Epics/__tests__/EpicsPage.test.jsx, same DataGrid-stub rationale
// (see that file's header) — copied rather than imported, matching the rest
// of this feature's file-isolation rule.
//
// What is pinned: create/edit send the right body including the REST 'NULL'
// sentinel; the Pipeline select is disabled once editing; the epic_status
// pause chip toggles with a one-field PUT; the closed chip and closed filter;
// delete names the step-cascade consequence; the step_count link navigates to
// the epic-filtered steps2 view.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigations = [];
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal()),
    useNavigate: () => (to) => navigations.push(to),
}));

vi.mock('@mui/x-data-grid', () => ({
    GridToolbar: () => null,
    // `data-testid` forwarded from the real usage (`epics2-grid`), not
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
let epics;
let steps;
let categories;
let loading;

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllPipelines2: () => ({ data: pipelines, isLoading: loading.pipelines }),
        useAllPipeline2Epics: () => ({ data: epics, isLoading: loading.epics }),
        useAllPipeline2Steps: () => ({ data: steps, isLoading: loading.steps }),
        useAllCategories: () => ({ data: categories, isLoading: loading.categories }),
    };
});

const restCalls = [];
// Keyed by exact GET uri -> data to return; unset GETs (and every non-GET)
// fall back to the empty-array default. Lets the two-phase-delete tests
// script a live re-read without a full REST mock.
let restGetResponses = {};
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri, method, body });
        if (method === 'GET' && Object.prototype.hasOwnProperty.call(restGetResponses, uri)) {
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: restGetResponses[uri] });
        }
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import EpicsPage2 from '../EpicsPage2';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

let mountedRoots = [];
let queryClient;

function mount(initialEntries = ['/swarm/epics2']) {
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
const rowIds = () => [...document.body.querySelectorAll('[data-testid^="grid-row-"]')]
    .map(el => Number(el.getAttribute('data-testid').replace('grid-row-', '')));

beforeEach(() => {
    navigations.length = 0;
    restCalls.length = 0;
    restGetResponses = {};
    mountedRoots = [];
    loading = { pipelines: false, epics: false, steps: false, categories: false };
    pipelines = [
        { id: 7, title: 'Plan Seven' },
        { id: 8, title: 'Plan Eight' },
    ];
    epics = [
        { id: 4, pipeline_fk: 7, title: 'Core rebuild', description: null, category_fk: 1,
          epic_status: 'active', closed: 0, sort_order: 0, create_ts: '2026-08-01 00:00:00' },
        { id: 5, pipeline_fk: 7, title: 'Parked work', description: null, category_fk: 1,
          epic_status: 'paused', closed: 0, sort_order: 1, create_ts: '2026-08-01 00:00:00' },
        { id: 6, pipeline_fk: 7, title: 'Retired', description: null, category_fk: 1,
          epic_status: 'active', closed: 1, sort_order: 2, create_ts: '2026-08-01 00:00:00' },
    ];
    steps = [
        { id: 100, epic_fk: 4 },
        { id: 101, epic_fk: 4 },
        { id: 102, epic_fk: 5 },
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

describe('EpicsPage2 rows', () => {
    it('shows open epics by default, ordered by sort_order', () => {
        mount();
        expect(rowIds()).toEqual([4, 5]);
    });

    it('adds closed epics when the Closed chip is toggled on', () => {
        mount();
        click(node('epics2-closed-chip-closed'));
        expect(rowIds()).toEqual([4, 5, 6]);
    });

    it('counts steps filed under each epic', () => {
        mount();
        expect(node('epic2-steps-link-4').textContent).toBe('2');
        expect(node('epic2-steps-link-5').textContent).toBe('1');
    });

    it('resolves the pipeline title for the row', () => {
        mount();
        expect(node('cell-pipeline_title-4').textContent).toBe('Plan Seven');
    });
});

describe('EpicsPage2 — connection to the steps2 view', () => {
    it('navigates to the epic-filtered steps2 view from the Steps cell', () => {
        mount();
        click(node('epic2-steps-link-4'));
        expect(navigations).toEqual(['/swarm/steps2?epic=4']);
    });
});

describe('EpicsPage2 create', () => {
    it('POSTs pipeline_fk, trimmed title and the first open category', async () => {
        mount();
        click(node('epic2-add'));
        type(node('epic2-title-input'), '  New Epic  ');
        click(node('epic2-save'));
        await flush();

        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline2_epics',
            method: 'POST',
            body: {
                pipeline_fk: 7, title: 'New Epic', description: null,
                category_fk: 1, sort_order: null, epic_status: 'active',
            },
        }]);
    });

    it('refuses to submit without a pipeline selected', async () => {
        pipelines = [];
        mount();
        expect(node('epic2-add').disabled).toBe(true);
    });
});

describe('EpicsPage2 edit', () => {
    it('disables the Pipeline select once editing', () => {
        mount();
        click(node('epic2-edit-4'));
        expect(node('epic2-pipeline-select').className).toContain('Mui-disabled');
    });

    it('PUTs every editable column, never pipeline_fk', async () => {
        mount();
        click(node('epic2-edit-4'));
        type(node('epic2-title-input'), 'Renamed');
        click(node('epic2-save'));
        await flush();

        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline2_epics',
            method: 'PUT',
            body: [{
                id: 4, title: 'Renamed', description: 'NULL',
                category_fk: 1, sort_order: 0, epic_status: 'active',
            }],
        }]);
    });

    it("clears sort_order with the REST 'NULL' sentinel", async () => {
        mount();
        click(node('epic2-edit-4'));
        type(node('epic2-sort-order-input'), '');
        click(node('epic2-save'));
        await flush();
        expect(restCalls[0].body[0].sort_order).toBe('NULL');
    });
});

describe('EpicsPage2 pause toggle', () => {
    it('pauses an active epic with a one-field PUT', async () => {
        mount();
        click(node('epic2-pause-chip-4'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline2_epics',
            method: 'PUT',
            body: [{ id: 4, epic_status: 'paused' }],
        }]);
    });

    it('unpauses a paused epic', async () => {
        mount();
        click(node('epic2-pause-chip-5'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 5, epic_status: 'active' }]);
    });
});

describe('EpicsPage2 closed toggle', () => {
    it('closes an open epic', async () => {
        mount();
        click(node('epic2-toggle-closed-4'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline2_epics',
            method: 'PUT',
            body: [{ id: 4, closed: 1 }],
        }]);
    });
});

describe('EpicsPage2 delete', () => {
    it('does nothing when the confirmation is declined', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        mount();
        click(node('epic2-delete-4'));
        await flush();
        expect(restCalls).toEqual([]);
    });

    it('names the step-cascade consequence in the confirmation', () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        mount();
        click(node('epic2-delete-4'));
        expect(confirmSpy.mock.calls[0][0]).toContain('2 steps will be deleted');
    });

    it('DELETEs by id and invalidates the steps cache', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mount();
        click(node('epic2-delete-4'));
        await flush();

        // Two-phase delete (code review, req #3393): first reads this epic's
        // own step ids so any intra/cross-epic dependency edges can be sorted
        // before the epic DELETE — see epics2Api.js's `deleteEpic2` header.
        // The mock returns an empty step list, so no dep-edge reads/clears
        // follow; that branch has its own coverage below.
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline2_steps?epic_fk=4&fields=id',
            method: 'GET',
            body: '',
        }, {
            uri: 'http://test.local/darwin/pipeline2_epics',
            method: 'DELETE',
            body: { id: 4 },
        }]);
        const keys = queryClient.invalidateQueries.mock.calls.map(c => c[0].queryKey);
        expect(keys.map(k => k[0])).toContain('pipeline2_epics');
        expect(keys.map(k => k[0])).toContain('pipeline2_steps');
    });

    it('clears an intra-epic dependency edge, then deletes (two-phase delete)', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        // Epic 4 owns steps 100 and 101 (see the `steps` fixture above); 101
        // depends on 100, both inside epic 4 — the InnoDB RESTRICT-vs-cascade
        // false refusal `deleteEpic2`'s header describes.
        restGetResponses['http://test.local/darwin/pipeline2_steps?epic_fk=4&fields=id'] =
            [{ id: 100 }, { id: 101 }];
        restGetResponses['http://test.local/darwin/pipeline2_step_deps?dep_step_fk=(100,101)'
            + '&fields=id,step_fk,dep_step_fk'] = [{ id: 900, step_fk: 101, dep_step_fk: 100 }];
        mount();
        click(node('epic2-delete-4'));
        await flush();

        expect(restCalls.map(c => ({ uri: c.uri, method: c.method }))).toEqual([
            { uri: 'http://test.local/darwin/pipeline2_steps?epic_fk=4&fields=id', method: 'GET' },
            {
                uri: 'http://test.local/darwin/pipeline2_step_deps?dep_step_fk=(100,101)'
                    + '&fields=id,step_fk,dep_step_fk',
                method: 'GET',
            },
            { uri: 'http://test.local/darwin/pipeline2_step_deps', method: 'DELETE' },
            { uri: 'http://test.local/darwin/pipeline2_epics', method: 'DELETE' },
        ]);
        expect(restCalls[2].body).toEqual({ id: 900 });
        expect(restCalls[3].body).toEqual({ id: 4 });
        expect(useSnackBarStore.getState().open).toBe(false);
    });

    it('refuses when a step outside the epic depends on one of its steps', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        // Step 102 belongs to epic 5 (see the `steps` fixture above) and
        // depends on step 100, which belongs to epic 4 — a real cross-epic
        // edge, not the false-refusal case above.
        restGetResponses['http://test.local/darwin/pipeline2_steps?epic_fk=4&fields=id'] =
            [{ id: 100 }, { id: 101 }];
        restGetResponses['http://test.local/darwin/pipeline2_step_deps?dep_step_fk=(100,101)'
            + '&fields=id,step_fk,dep_step_fk'] = [{ id: 901, step_fk: 102, dep_step_fk: 100 }];
        mount();
        click(node('epic2-delete-4'));
        await flush();

        expect(restCalls.some(c => c.method === 'DELETE')).toBe(false);
        expect(useSnackBarStore.getState().open).toBe(true);
        expect(useSnackBarStore.getState().message).toContain('409');
    });
});
