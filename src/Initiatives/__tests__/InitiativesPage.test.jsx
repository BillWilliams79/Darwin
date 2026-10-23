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
// delete names the step-cascade consequence; the step_count link navigates to
// the initiative-filtered steps view.

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
let steps;
let categories;
let loading;

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllPipelines: () => ({ data: pipelines, isLoading: loading.pipelines }),
        useAllInitiatives: () => ({ data: initiatives, isLoading: loading.initiatives }),
        useAllPipelineSteps: () => ({ data: steps, isLoading: loading.steps }),
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

import InitiativesPage2 from '../InitiativesPage';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

let mountedRoots = [];
let queryClient;

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
    loading = { pipelines: false, initiatives: false, steps: false, categories: false };
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
    steps = [
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

    it('counts steps filed under each initiative', () => {
        mount();
        expect(node('initiative-steps-link-4').textContent).toBe('2');
        expect(node('initiative-steps-link-5').textContent).toBe('1');
    });

    it('resolves the pipeline title for the row', () => {
        mount();
        expect(node('cell-pipeline_title-4').textContent).toBe('Plan Seven');
    });
});

describe('InitiativesPage — connection to the steps view', () => {
    it('navigates to the initiative-filtered steps view from the Steps cell', () => {
        mount();
        click(node('initiative-steps-link-4'));
        expect(navigations).toEqual(['/swarm/steps?initiative=4']);
    });
});

describe('InitiativesPage2 create', () => {
    it('POSTs pipeline_fk, trimmed title and the first open category', async () => {
        mount();
        click(node('initiative-add'));
        type(node('initiative-title-input'), '  New Initiative  ');
        click(node('initiative-save'));
        await flush();

        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/initiatives',
            method: 'POST',
            body: {
                pipeline_fk: 7, title: 'New Initiative', description: null,
                category_fk: 1, sort_order: null, initiative_status: 'active',
            },
        }]);
    });

    it('refuses to submit without a pipeline selected', async () => {
        pipelines = [];
        mount();
        expect(node('initiative-add').disabled).toBe(true);
    });
});

describe('InitiativesPage2 edit', () => {
    it('disables the Pipeline select once editing', () => {
        mount();
        click(node('initiative-edit-4'));
        expect(node('initiative-pipeline-select').className).toContain('Mui-disabled');
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

    it("clears sort_order with the REST 'NULL' sentinel", async () => {
        mount();
        click(node('initiative-edit-4'));
        type(node('initiative-sort-order-input'), '');
        click(node('initiative-save'));
        await flush();
        expect(restCalls[0].body[0].sort_order).toBe('NULL');
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

    it('names the step-cascade consequence in the confirmation', () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        mount();
        click(node('initiative-delete-4'));
        expect(confirmSpy.mock.calls[0][0]).toContain('2 steps will be deleted');
    });

    it('DELETEs by id and invalidates the steps cache', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mount();
        click(node('initiative-delete-4'));
        await flush();

        // Two-phase delete (code review, req #3393): first reads this initiative's
        // own step ids so any intra/cross-initiative dependency edges can be sorted
        // before the initiative DELETE — see initiativesApi.js's `deleteInitiative` header.
        // The mock returns an empty step list, so no dep-edge reads/clears
        // follow; that branch has its own coverage below.
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline_steps?initiative_fk=4&fields=id,locked',
            method: 'GET',
            body: '',
        }, {
            // req #3649 — the initiative's own lock (and, when it names a plan, the
            // plan's) is read BEFORE any write.
            uri: 'http://test.local/darwin/initiatives?id=4&fields=id,pipeline_fk,locked',
            method: 'GET',
            body: '',
        }, {
            uri: 'http://test.local/darwin/initiatives',
            method: 'DELETE',
            body: { id: 4 },
        }]);
        const keys = queryClient.invalidateQueries.mock.calls.map(c => c[0].queryKey);
        expect(keys.map(k => k[0])).toContain('initiatives');
        expect(keys.map(k => k[0])).toContain('pipeline_steps');
    });

    it('clears an intra-initiative dependency edge, then deletes (two-phase delete)', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        // Initiative 4 owns steps 100 and 101 (see the `steps` fixture above); 101
        // depends on 100, both inside initiative 4 — the InnoDB RESTRICT-vs-cascade
        // false refusal `deleteInitiative`'s header describes.
        restGetResponses['http://test.local/darwin/pipeline_steps?initiative_fk=4&fields=id,locked'] =
            [{ id: 100 }, { id: 101 }];
        restGetResponses['http://test.local/darwin/pipeline_step_deps?dep_step_fk=(100,101)'
            + '&fields=id,step_fk,dep_step_fk'] = [{ id: 900, step_fk: 101, dep_step_fk: 100 }];
        mount();
        click(node('initiative-delete-4'));
        await flush();

        expect(restCalls.map(c => ({ uri: c.uri, method: c.method }))).toEqual([
            { uri: 'http://test.local/darwin/pipeline_steps?initiative_fk=4&fields=id,locked', method: 'GET' },
            { uri: 'http://test.local/darwin/initiatives?id=4&fields=id,pipeline_fk,locked', method: 'GET' },
            {
                uri: 'http://test.local/darwin/pipeline_step_deps?dep_step_fk=(100,101)'
                    + '&fields=id,step_fk,dep_step_fk',
                method: 'GET',
            },
            { uri: 'http://test.local/darwin/pipeline_step_deps', method: 'DELETE' },
            { uri: 'http://test.local/darwin/initiatives', method: 'DELETE' },
        ]);
        expect(restCalls[3].body).toEqual({ id: 900 });
        expect(restCalls[4].body).toEqual({ id: 4 });
        expect(useSnackBarStore.getState().open).toBe(false);
    });

    it('refuses when a step outside the initiative depends on one of its steps', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        // Step 102 belongs to initiative 5 (see the `steps` fixture above) and
        // depends on step 100, which belongs to initiative 4 — a real cross-initiative
        // edge, not the false-refusal case above.
        restGetResponses['http://test.local/darwin/pipeline_steps?initiative_fk=4&fields=id,locked'] =
            [{ id: 100 }, { id: 101 }];
        restGetResponses['http://test.local/darwin/pipeline_step_deps?dep_step_fk=(100,101)'
            + '&fields=id,step_fk,dep_step_fk'] = [{ id: 901, step_fk: 102, dep_step_fk: 100 }];
        mount();
        click(node('initiative-delete-4'));
        await flush();

        expect(restCalls.some(c => c.method === 'DELETE')).toBe(false);
        expect(useSnackBarStore.getState().open).toBe(true);
        expect(useSnackBarStore.getState().message).toContain('409');
    });

    it('refuses BEFORE any write when a step under the initiative is locked (req #3649)', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        restGetResponses['http://test.local/darwin/pipeline_steps?initiative_fk=4&fields=id,locked'] =
            [{ id: 100, locked: 1 }, { id: 101, locked: 0 }];
        restGetResponses['http://test.local/darwin/pipeline_step_deps?dep_step_fk=(100,101)'
            + '&fields=id,step_fk,dep_step_fk'] = [{ id: 900, step_fk: 101, dep_step_fk: 100 }];
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
