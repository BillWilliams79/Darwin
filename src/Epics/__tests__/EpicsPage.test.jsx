// @vitest-environment jsdom
//
// Req #3139 — the Epics editor.
//
// The DataGrid is STUBBED (see the mock below): jsdom gives every element a
// zero-size box, so the real grid virtualizes down to no cells at all and a
// suite built on it asserts against an empty table. The stub renders each row
// through the SAME column contract the real grid uses — `valueGetter(value,
// row)` then `valueFormatter(value, row)` then `renderCell({ row, value })`,
// v7 argument order — so a column that mis-uses that signature still fails
// here. What the stub deliberately does NOT prove is grid behaviour itself
// (sorting by header click, pagination, quick filter); none of that is this
// requirement's code.
//
// What IS pinned is the wiring the requirement is about:
//   - the Features count cell navigates to the epic-filtered features view,
//     which is the "connects to the existing epic editor" clause
//   - create / edit send the right body to the right endpoint, including the
//     REST 'NULL' sentinel that a JSON null cannot express on a PUT
//   - the closed chip toggles the flag rather than opening a dialog
//   - delete is gated on confirm and invalidates the FEATURES cache too,
//     because features.epic_fk is ON DELETE SET NULL
//   - the closed filter and the sort_order-nulls-last ordering

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigations = [];
// Spread the real module rather than replacing it: a narrow `{ useNavigate }`
// mock turns any future router import in the page into an undefined-export
// crash that says nothing about the actual failure.
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal()),
    useNavigate: () => (to) => navigations.push(to),
}));

// Mirrors the real column contract closely enough to catch a signature error.
vi.mock('@mui/x-data-grid', () => ({
    GridToolbar: () => null,
    DataGrid: ({ rows, columns }) => (
        <div data-testid="grid">
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

let epics;
let features;
let categories;
let loading;
// req #3224 — live orchestration reservations and the machines that name them.
// Mocked alongside the other three so this file's REST-call assertions stay
// exact: an unmocked hook would fire two real GETs through the mocked client
// and land in every `restCalls` comparison below.
let orchestrationClaims;
let machines;

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllEpics: () => ({ data: epics, isLoading: loading.epics }),
        useAllFeatures: () => ({ data: features, isLoading: loading.features }),
        useAllCategories: () => ({ data: categories, isLoading: loading.categories }),
        useOrchestrationClaims: () => ({ data: orchestrationClaims }),
        useMachines: () => ({ data: machines }),
    };
});

const restCalls = [];
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri, method, body });
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import EpicsPage from '../EpicsPage';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

let mountedRoots = [];
let queryClient;

// `initialEntries` defaults to a bare route — req #3234's `?id=<id>` deep-link
// tests pass `['/swarm/epics?id=<id>']`. `useSearchParams` (req #3234) needs a
// real Router in the tree; `useNavigate` stays mocked above regardless.
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
                            <EpicsPage />
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

// Let the awaited REST call and the state updates that follow it settle.
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

const rowIds = () => [...document.body.querySelectorAll('[data-testid^="grid-row-"]')]
    .map(el => Number(el.getAttribute('data-testid').replace('grid-row-', '')));

beforeEach(() => {
    navigations.length = 0;
    restCalls.length = 0;
    mountedRoots = [];
    loading = { epics: false, features: false, categories: false };
    epics = [
        { id: 4, title: 'Pipeline', description: 'Plans as data.\n\nSecond para.', category_fk: 1, closed: 0, sort_order: 4, create_ts: '2026-07-28 05:15:14' },
        { id: 2, title: 'Application Backlog', description: null, category_fk: 1, closed: 0, sort_order: 1, create_ts: '2026-07-28 05:15:14' },
        { id: 9, title: 'Unordered', description: null, category_fk: 577, closed: 0, sort_order: null, create_ts: '2026-07-31 02:38:14' },
        { id: 7, title: 'Retired', description: null, category_fk: 1, closed: 1, sort_order: 2, create_ts: '2026-07-31 10:43:32' },
    ];
    orchestrationClaims = [];
    machines = [{ id: 4, title: 'Mac mini', hostname: 'mac-mini' }];
    features = [
        { id: 10, title: 'f1', epic_fk: 4 },
        { id: 11, title: 'f2', epic_fk: 4 },
        { id: 12, title: 'f3', epic_fk: null },
        { id: 13, title: 'f4', epic_fk: 2 },
    ];
    // sort_order is deliberately OUT of fetch order: 'Mapping' arrives second
    // but sorts first, so the create-default assertion below proves the page
    // respects the user's ordering rather than whatever MySQL returned first.
    categories = [
        { id: 1, category_name: 'Darwin', color: '#123456', closed: 0, sort_order: 5 },
        { id: 577, category_name: 'Mapping', color: null, closed: 0, sort_order: 1 },
        { id: 900, category_name: 'Archived', color: null, closed: 1, sort_order: 0 },
    ];
    useSnackBarStore.setState({ open: false, message: '' });
});

const snackMessage = () => useSnackBarStore.getState().message;

afterEach(() => {
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('EpicsPage rows', () => {
    it('shows open epics by default, ordered by sort_order with NULLs last', () => {
        mount();
        expect(rowIds()).toEqual([2, 4, 9]);
    });

    it('adds the closed epics when the Closed chip is toggled on', () => {
        mount();
        click(node('epics-closed-chip-closed'));
        expect(rowIds()).toEqual([2, 7, 4, 9]);
    });

    it('shows nothing — not everything — when every filter chip is off', () => {
        mount();
        click(node('epics-closed-chip-open'));
        expect(rowIds()).toEqual([]);
        expect(node('epics-accounting').textContent).toContain('0 of 4');
    });

    it('counts the features filed under each epic, unfiled ones excluded', () => {
        mount();
        expect(node('epic-features-link-4').textContent).toBe('2');
        expect(node('epic-features-link-2').textContent).toBe('1');
        expect(node('epic-features-link-9').textContent).toBe('0');
    });

    it('collapses a multi-paragraph description to one line', () => {
        mount();
        expect(node('cell-description-4').textContent).toBe('Plans as data. Second para.');
        expect(node('cell-description-2').textContent).toBe('—');
    });

    it('resolves the category name for the row', () => {
        mount();
        expect(node('cell-category_name-4').textContent).toContain('Darwin');
        expect(node('cell-category_name-9').textContent).toContain('Mapping');
    });

    // The three reads land independently. Painting the grid off the epics read
    // alone shows every Features count as 0 and lets a delete be confirmed
    // WITHOUT the "its N features will be unfiled" clause — a wrong number is
    // not a loading state.
    it('holds the grid until the features read lands, not just the epics one', () => {
        loading = { epics: false, features: true, categories: false };
        mount();
        expect(node('epics-datagrid')).toBeNull();
    });

    it('holds the grid until the category labels land', () => {
        loading = { epics: false, features: false, categories: true };
        mount();
        expect(node('epics-datagrid')).toBeNull();
    });
});

describe('EpicsPage — connection to the features view', () => {
    it('navigates to the epic-filtered features view from the Features cell', () => {
        mount();
        click(node('epic-features-link-4'));
        expect(navigations).toEqual(['/swarm/features?epic=4']);
    });

    it('navigates even when the epic has no features yet', () => {
        mount();
        click(node('epic-features-link-9'));
        expect(navigations).toEqual(['/swarm/features?epic=9']);
    });
});

// req #3224 — the Darwin UI names the holder of every reserved scope. Here that
// is the epic's OWN reservation; a whole-plan orchestrator also owns this epic's
// steps, but knowing which plans an epic is seated in costs three more
// whole-table reads, so the plan surfaces answer that case and this one answers
// exactly what it can answer.
describe('EpicsPage — orchestration holder (req #3224)', () => {
    it('shows nothing when no reservation covers the epic', () => {
        mount();
        // An em-dash, not an empty chip: "nobody is orchestrating this" is a
        // real answer and it has to be legible as one.
        expect(node('epic-holder-4')).toBeNull();
        expect(node('cell-orchestrated_by-4').textContent).toBe('—');
    });

    it('names the machine and how long it has been held', () => {
        orchestrationClaims = [{
            id: 1, pipeline_fk: 2, epic_fk: 4, machine_fk: 4,
            terminal_pid: 41234, engine_pid: 55012, polls: 12,
            claimed_at: '2026-08-01 10:00:00',
            update_ts: new Date(Date.now() - 30_000).toISOString().slice(0, 19).replace('T', ' '),
        }];
        mount();
        const chip = node('epic-holder-4');
        expect(chip).not.toBeNull();
        expect(chip.textContent).toContain('Mac mini');
        // ...and only that epic. A reservation is scoped, not global.
        expect(node('epic-holder-2')).toBeNull();
    });

    it('marks a reservation whose orchestrator stopped heartbeating as stale', () => {
        orchestrationClaims = [{
            id: 1, pipeline_fk: 2, epic_fk: 4, machine_fk: 4,
            terminal_pid: 41234, engine_pid: 55012, polls: 12,
            claimed_at: '2026-08-01 10:00:00',
            update_ts: '2026-08-01 10:00:00',        // long past the threshold
        }];
        mount();
        // A stale claim is the most interesting row on this surface — it is a
        // scope blocked by an orchestrator that died — so it is FLAGGED, never
        // hidden and never shown as live.
        expect(node('epic-holder-4').textContent).toContain('stale');
    });
});

describe('EpicsPage create', () => {
    // The default category is the first OPEN one BY SORT ORDER (id 577), not
    // the first row the read returned (id 1) and not the closed id 900, which
    // sorts ahead of both.
    it('POSTs the trimmed title with a null description and the first open category', async () => {
        mount();
        click(node('epic-add'));
        type(node('epic-title-input'), '  New Epic  ');
        click(node('epic-save'));
        await flush();

        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/epics',
            method: 'POST',
            body: { title: 'New Epic', description: null, category_fk: 577, sort_order: null },
        }]);
    });

    it('never pre-selects a CLOSED category, even one that sorts first', () => {
        mount();
        click(node('epic-add'));
        // Reached through the same dialog the save reads from, so this pins the
        // rendered choice rather than the payload alone.
        expect(node('epic-category-select').textContent).toContain('Mapping');
    });

    it('sends a real integer sort_order when one is given', async () => {
        mount();
        click(node('epic-add'));
        type(node('epic-title-input'), 'Ordered');
        type(node('epic-sort-order-input'), '12');
        click(node('epic-save'));
        await flush();

        expect(restCalls[0].body.sort_order).toBe(12);
    });

    it('refuses to submit a blank title', async () => {
        mount();
        click(node('epic-add'));
        type(node('epic-title-input'), '   ');
        expect(node('epic-save').disabled).toBe(true);
        click(node('epic-save'));
        await flush();
        expect(restCalls).toEqual([]);
    });
});

describe('EpicsPage sort order validation', () => {
    // The dangerous case: "invalid" and "empty" both look like a missing number,
    // but only one of them should reach the wire as a clear-the-column.
    // Both refusals assert the MESSAGE as well as the silence: "sent nothing and
    // said nothing" is a sibling of the defect being fixed, and `restCalls === []`
    // alone cannot tell the two apart.
    it('refuses a fractional sort order instead of silently clearing the column', async () => {
        mount();
        click(node('epic-edit-4'));
        type(node('epic-sort-order-input'), '4.5');
        click(node('epic-save'));
        await flush();
        expect(restCalls).toEqual([]);
        expect(snackMessage()).toContain('whole number');
    });

    it('refuses a value wider than the SMALLINT column', async () => {
        mount();
        click(node('epic-edit-4'));
        type(node('epic-sort-order-input'), '40000');
        click(node('epic-save'));
        await flush();
        expect(restCalls).toEqual([]);
        expect(snackMessage()).toContain('32767');
    });

    it('sends 0 as a real position, never as a clear', async () => {
        // `0` is falsy and a legitimate sort_order (a live category uses it) —
        // the one value most likely to be lost by an `|| REST_NULL` shortcut.
        mount();
        click(node('epic-edit-4'));
        type(node('epic-sort-order-input'), '0');
        click(node('epic-save'));
        await flush();
        expect(restCalls[0].body[0].sort_order).toBe(0);
    });

    it('accepts a negative whole number', async () => {
        mount();
        click(node('epic-edit-4'));
        type(node('epic-sort-order-input'), '-3');
        click(node('epic-save'));
        await flush();
        expect(restCalls[0].body[0].sort_order).toBe(-3);
    });
});

describe('EpicsPage edit', () => {
    it('PUTs an array carrying the id and every editable column', async () => {
        mount();
        click(node('epic-edit-4'));
        type(node('epic-title-input'), 'Pipeline v2');
        click(node('epic-save'));
        await flush();

        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/epics',
            method: 'PUT',
            body: [{
                id: 4,
                title: 'Pipeline v2',
                description: 'Plans as data.\n\nSecond para.',
                category_fk: 1,
                sort_order: 4,
            }],
        }]);
    });

    it("clears an emptied description with the REST 'NULL' sentinel, not a JSON null", async () => {
        mount();
        click(node('epic-edit-4'));
        type(node('epic-description-input'), '');
        click(node('epic-save'));
        await flush();

        expect(restCalls[0].body[0].description).toBe('NULL');
    });

    it("clears an emptied sort order with the same sentinel", async () => {
        mount();
        click(node('epic-edit-4'));
        type(node('epic-sort-order-input'), '');
        click(node('epic-save'));
        await flush();

        expect(restCalls[0].body[0].sort_order).toBe('NULL');
    });

    it('opens the dialog pre-filled from the row it was launched on', () => {
        mount();
        click(node('epic-edit-2'));
        expect(node('epic-title-input').value).toBe('Application Backlog');
        expect(node('epic-description-input').value).toBe('');
        expect(node('epic-sort-order-input').value).toBe('1');
    });
});

describe('EpicsPage closed toggle', () => {
    it('closes an open epic with a one-field PUT', async () => {
        mount();
        click(node('epic-toggle-closed-4'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/epics',
            method: 'PUT',
            body: [{ id: 4, closed: 1 }],
        }]);
    });

    it('re-opens a closed epic', async () => {
        mount();
        click(node('epics-closed-chip-closed'));
        click(node('epic-toggle-closed-7'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 7, closed: 0 }]);
    });
});

describe('EpicsPage delete', () => {
    it('does nothing when the confirmation is declined', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        mount();
        click(node('epic-delete-4'));
        await flush();
        expect(restCalls).toEqual([]);
    });

    it('names the unfiling consequence in the confirmation', () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        mount();
        click(node('epic-delete-4'));
        expect(confirmSpy.mock.calls[0][0]).toContain('2 features will be unfiled');
    });

    it('DELETEs by id and invalidates every cache the SET NULL touches', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mount();
        click(node('epic-delete-4'));
        await flush();

        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/epics',
            method: 'DELETE',
            body: { id: 4 },
        }]);
        const keys = queryClient.invalidateQueries.mock.calls.map(c => c[0].queryKey);
        expect(keys.map(k => k[0])).toContain('epics');
        expect(keys.map(k => k[0])).toContain('features');
        // The WHOLE key, not just its first element. req #3186's
        // swarm_sessions.epic_fk is ON DELETE SET NULL too, and the only
        // component that renders it reads through the byId key
        // ['swarm_sessions', {id}] — a SIBLING of the list key
        // ['swarm_sessions', creatorFk], not a descendant. Asserting
        // `queryKey[0] === 'swarm_sessions'` is satisfied by the list key, which
        // misses the detail row entirely; only the bare entity root reaches it.
        expect(keys).toContainEqual(['swarm_sessions']);
    });
});

// req #3234 — the requirement detail page's Epic linkage box links here via
// `?id=<id>`. This flat grid + dialog page has no per-row route, so "landing
// on" a specific epic means auto-opening the same edit dialog the Edit icon
// opens — the page's own presentation of one epic's full detail.
describe('EpicsPage — ?id=<id> deep-link (req #3234)', () => {
    it('opens the edit dialog for the epic named in the id param once epics have loaded', async () => {
        mount(['/swarm/epics?id=2']);
        await flush();

        expect(node('epic-edit-dialog').className).toContain('MuiDialog');
        expect(node('epic-title-input').value).toBe('Application Backlog');
    });

    it('does not keep re-opening (and resetting) the form on later renders', async () => {
        mount(['/swarm/epics?id=2']);
        await flush();
        expect(node('epic-title-input').value).toBe('Application Backlog');

        // The param is cleared and the ref guards against re-firing — if either
        // failed, a later render would call `openEdit` again and stomp this.
        type(node('epic-title-input'), 'Renamed');
        await flush();
        await flush();
        expect(node('epic-title-input').value).toBe('Renamed');
    });

    it('ignores an id with no matching row — the grid still renders normally', async () => {
        mount(['/swarm/epics?id=999']);
        await flush();

        expect(node('epic-title-input')).toBeNull();
        expect(rowIds()).toEqual([2, 4, 9]);
    });

    it('does not open the dialog while categories are still loading', async () => {
        loading = { epics: false, features: false, categories: true };
        mount(['/swarm/epics?id=2']);
        await flush();

        expect(node('epic-title-input')).toBeNull();
    });
});
