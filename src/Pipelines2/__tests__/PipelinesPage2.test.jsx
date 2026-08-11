// @vitest-environment jsdom
//
// req #3393 — the Pipeline 2.0 pipelines browser/editor. Structural sibling of
// the other 2.0 page test files (see EpicsPage2.test.jsx's header for the
// DataGrid-stub rationale, copied rather than imported).
//
// What is pinned: Cards is the default view and shows status/execution-mode/
// step-count/orchestration-holder chips, a two-state done/open progress bar
// and (when the shared met/total preference is on) the requirement count;
// the status filter hides/shows pipelines and names what it hid when the
// result is empty; the Table view carries the editor controls (execution_mode
// toggle, description dialog) Cards deliberately does not; opening a plan —
// from a card, from the table title, from the table's Open action, or from
// clicking anywhere else in a table row — always navigates to the real 2.0
// visualizer (`/swarm/pipeline2/:id`, req #3463/#3372), and never fires a
// mutation; every editor control stops propagation so it does not ALSO
// navigate the row away.

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
    // `onClick` on the row wrapper mirrors the real DataGrid's `onRowClick` —
    // real DOM/React event bubbling means a cell's own `e.stopPropagation()`
    // (the title link, the Open action, the execution_mode chip, the
    // description button) genuinely prevents this from firing, exactly as it
    // would against the real grid. That is the regression this stub exists to
    // catch: a control without its own stopPropagation would silently also
    // navigate the row away.
    // `data-testid` is forwarded from the real usage (`pipelines2-grid`), not
    // hardcoded — a hardcoded value here is exactly the bug that let one test
    // silently query for an element the mock could never render, and the
    // failure it hid (no cell-level stopPropagation actually being exercised
    // by that assertion) went unnoticed until the toggle test specifically
    // asserted on it.
    DataGrid: ({ rows, columns, onRowClick, 'data-testid': testId = 'grid' }) => (
        <div data-testid={testId}>
            {rows.map((row, index) => (
                <div key={row.id} data-testid={`grid-row-${row.id}`} data-index={index}
                     onClick={() => onRowClick?.({ id: row.id, row })}>
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
let machines;
let epics;
let steps;
let stepRequirements;
let requirements;
let orchestrationClaims;
let loading;

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllPipelines2: () => ({ data: pipelines, isLoading: loading.pipelines }),
        useMachines: () => ({ data: machines, isLoading: loading.machines }),
        useAllPipeline2Epics: () => ({ data: epics, isLoading: loading.epics }),
        useAllPipeline2Steps: () => ({ data: steps, isLoading: loading.steps }),
        useAllPipeline2StepRequirements: () => ({
            data: stepRequirements, isLoading: loading.links }),
        useAllRequirements: () => ({ data: requirements, isLoading: loading.requirements }),
        useOrchestrationClaims: () => ({ data: orchestrationClaims }),
    };
});

vi.mock('../../SwarmView/pipelines/pipelinePlace', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, readPipelinePlace: () => null };
});

const restCalls = [];
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri, method, body });
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import PipelinesPage2 from '../PipelinesPage2';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

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
            <MemoryRouter initialEntries={['/swarm/pipelines2']}>
                <QueryClientProvider client={queryClient}>
                    <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                        <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                            <PipelinesPage2 />
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
// A `data-testid` on a multiline MUI TextField lands on the outer
// `.MuiFormControl-root`, not on either of its two <textarea> elements (a
// visible one plus MUI's hidden auto-sizing shadow, which carries
// `aria-hidden`) — so tests that need the field's `.value` query the visible
// textarea within it directly.
const textareaIn = (testId) =>
    document.body.querySelector(`[data-testid="${testId}"] textarea:not([aria-hidden="true"])`);
const click = (el) => act(() => { el.click(); });
const type = (el, value) => act(() => {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});
// React's onBlur is implemented on the native 'focusout' event (which
// bubbles) rather than 'blur' (which does not) — dispatching a bare 'blur'
// never reaches React's synthetic handler.
const blur = (el) => act(() => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const switchToTable = () => click(node('view-toggle-table'));

beforeEach(() => {
    navigations.length = 0;
    restCalls.length = 0;
    mountedRoots = [];
    // useViewPreference/the status filter both persist to Web Storage, which
    // jsdom keeps ALIVE across tests in one file unless cleared.
    sessionStorage.clear();
    localStorage.clear();
    loading = {
        pipelines: false, machines: false, epics: false, steps: false,
        links: false, requirements: false,
    };
    pipelines = [
        { id: 7, title: 'Plan Seven', description: 'Existing goal.', pipeline_status: 'active',
          execution_mode: 'parallel', machine_fk: 4, started_at: '2026-08-01 00:00:00', completed_at: null },
        { id: 8, title: 'Plan Eight', description: null, pipeline_status: 'draft',
          execution_mode: 'serial', machine_fk: null, started_at: null, completed_at: null },
    ];
    machines = [{ id: 4, title: 'Mac mini' }];
    epics = [
        { id: 40, pipeline_fk: 7, title: 'Epic Seven' },
        { id: 41, pipeline_fk: 8, title: 'Epic Eight' },
    ];
    steps = [
        { id: 500, epic_fk: 40, completed_at: '2026-08-01 00:00:00' },
        { id: 501, epic_fk: 40, completed_at: null },
        { id: 502, epic_fk: 41, completed_at: null },
    ];
    stepRequirements = [
        { step_fk: 500, requirement_fk: 900 },
        { step_fk: 501, requirement_fk: 901 },
    ];
    requirements = [
        { id: 900, requirement_status: 'met' },
        { id: 901, requirement_status: 'development' },
    ];
    orchestrationClaims = [];
    useSnackBarStore.setState({ open: false, message: '' });
});

afterEach(() => {
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('PipelinesPage2 — Cards view (default)', () => {
    it('renders a card per visible pipeline', () => {
        mount();
        expect(node('pipeline2-card-7')).not.toBeNull();
        expect(node('pipeline2-card-8')).not.toBeNull();
    });

    it('shows the done/open two-state summary, never a fabricated third state', () => {
        mount();
        expect(node('pipeline2-card-summary-7').textContent).toBe('1 complete · 1 open');
        expect(node('pipeline2-card-summary-8').textContent).toBe('0 complete · 1 open');
    });

    it('shows the met/total requirement count on the title (default ON, req #3225 parity)', () => {
        mount();
        expect(node('pipeline2-card-7').textContent).toContain('Plan Seven 1/2');
    });

    it('shows the orchestration holder only when a claim covers the plan', () => {
        mount();
        expect(node('pipeline2-card-holder-7')).toBeNull();

        orchestrationClaims = [{
            id: 1, pipeline2_fk: 7, epic2_fk: null, machine_fk: 4,
            claimed_at: '2026-08-10T10:00:00', update_ts: new Date().toISOString().slice(0, 19),
        }];
        mount();
        expect(node('pipeline2-card-holder-7')).not.toBeNull();
        expect(node('pipeline2-card-holder-7').textContent).toContain('Mac mini');
        // Scoped — plan 8 carries no claim.
        expect(node('pipeline2-card-holder-8')).toBeNull();
    });

    it('opens the visualizer when a card is clicked', () => {
        mount();
        // Click a DESCENDANT of the CardActionArea, not the outer Card
        // wrapper — a real click event bubbles from child to parent, never
        // the reverse, so `.click()` on the Card itself never reaches
        // CardActionArea's own onClick.
        click(node('pipeline2-card-summary-7'));
        expect(navigations).toEqual(['/swarm/pipeline2/7']);
    });
});

describe('PipelinesPage2 — status filter', () => {
    it('shows both fixture pipelines by default (active + draft)', () => {
        mount();
        expect(node('pipeline2-card-7')).not.toBeNull();
        expect(node('pipeline2-card-8')).not.toBeNull();
        expect(node('pipelines2-accounting').textContent).toContain('2 of 2');
    });

    it('hides a pipeline when its status chip is toggled off', () => {
        mount();
        click(node('pipelines2-status-chip-draft'));
        expect(node('pipeline2-card-8')).toBeNull();
        expect(node('pipeline2-card-7')).not.toBeNull();
    });

    it('names the hidden statuses in the empty state when every chip is off', () => {
        mount();
        click(node('pipelines2-status-chip-active'));
        click(node('pipelines2-status-chip-draft'));
        click(node('pipelines2-status-chip-paused'));
        expect(node('pipeline2-card-7')).toBeNull();
        expect(node('pipelines2-cards-empty').textContent).toContain('active');
        expect(node('pipelines2-cards-empty').textContent).toContain('draft');
    });
});

describe('PipelinesPage2 — view toggle', () => {
    it('switches from Cards to Table and back', () => {
        mount();
        expect(node('pipelines2-cards-view')).not.toBeNull();
        expect(node('pipelines2-grid')).toBeNull();

        switchToTable();
        expect(node('pipelines2-grid')).not.toBeNull();
        expect(node('pipelines2-cards-view')).toBeNull();

        click(node('view-toggle-cards'));
        expect(node('pipelines2-cards-view')).not.toBeNull();
    });
});

describe('PipelinesPage2 — opening the visualizer, Table view (req #3463/#3372)', () => {
    it('navigates to the 2.0 visualizer from the title', () => {
        mount();
        switchToTable();
        click(node('pipeline2-open-title-7'));
        expect(navigations).toEqual(['/swarm/pipeline2/7']);
    });

    it('navigates to the 2.0 visualizer from the Open action', () => {
        mount();
        switchToTable();
        click(node('pipeline2-open-8'));
        expect(navigations).toEqual(['/swarm/pipeline2/8']);
    });

    it('navigates when any other part of the row is clicked', () => {
        mount();
        switchToTable();
        click(node('grid-row-7'));
        expect(navigations).toEqual(['/swarm/pipeline2/7']);
    });

    it('opening a row never fires a mutation', async () => {
        mount();
        switchToTable();
        click(node('pipeline2-open-title-7'));
        await flush();
        expect(restCalls).toEqual([]);
    });

    it('does NOT navigate away when the execution_mode chip is clicked', async () => {
        mount();
        switchToTable();
        click(node('pipeline2-execmode-chip-7'));
        await flush();
        expect(navigations).toEqual([]);
    });

    it('does NOT navigate away when the description button is clicked', () => {
        mount();
        switchToTable();
        click(node('pipeline2-description-btn-7'));
        expect(navigations).toEqual([]);
        // ...and the dialog it opens, not the visualizer.
        expect(node('pipeline2-description-dialog')).not.toBeNull();
    });
});

describe('PipelinesPage2 execution_mode toggle (Table view)', () => {
    it('flips parallel to serial with a one-field PUT', async () => {
        mount();
        switchToTable();
        click(node('pipeline2-execmode-chip-7'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline2_pipelines',
            method: 'PUT',
            body: [{ id: 7, execution_mode: 'serial' }],
        }]);
    });

    it('flips serial back to parallel', async () => {
        mount();
        switchToTable();
        click(node('pipeline2-execmode-chip-8'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 8, execution_mode: 'parallel' }]);
    });
});

describe('PipelinesPage2 status chip (Table view)', () => {
    it('is a plain label with no click handler', () => {
        mount();
        switchToTable();
        const chip = node('pipeline2-status-7');
        // MUI's Chip only renders as a <button>/role="button" when it is
        // given an onClick — a plain <div> here proves no toggle was wired.
        expect(chip.tagName).not.toBe('BUTTON');
        expect(chip.getAttribute('role')).not.toBe('button');
    });
});

describe('PipelinesPage2 description dialog (Table view)', () => {
    it('opens pre-filled with the existing description', () => {
        mount();
        switchToTable();
        click(node('pipeline2-description-btn-7'));
        expect(textareaIn('pipeline2-goal').value).toBe('Existing goal.');
    });

    it('opens empty for a pipeline with no description', () => {
        mount();
        switchToTable();
        click(node('pipeline2-description-btn-8'));
        expect(textareaIn('pipeline2-goal').value).toBe('');
    });

    it('saves on blur', async () => {
        mount();
        switchToTable();
        click(node('pipeline2-description-btn-7'));
        type(textareaIn('pipeline2-goal'), 'New goal text');
        blur(textareaIn('pipeline2-goal'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline2_pipelines',
            method: 'PUT',
            body: [{ id: 7, description: 'New goal text' }],
        }]);
    });

    it('saves unsaved text on Close even without a prior blur', async () => {
        mount();
        switchToTable();
        click(node('pipeline2-description-btn-8'));
        type(textareaIn('pipeline2-goal'), 'Closed without blur');
        // No blur() here on purpose — closeAndSave is the save path being tested.
        click(document.body.querySelector('[data-testid="pipeline2-description-dialog"] button'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipeline2_pipelines',
            method: 'PUT',
            body: [{ id: 8, description: 'Closed without blur' }],
        }]);
    });

    it('does not re-send an already-saved value on close', async () => {
        mount();
        switchToTable();
        click(node('pipeline2-description-btn-7'));
        type(textareaIn('pipeline2-goal'), 'Saved once');
        blur(textareaIn('pipeline2-goal'));
        await flush();
        click(document.body.querySelector('[data-testid="pipeline2-description-dialog"] button'));
        await flush();
        expect(restCalls.length).toBe(1);
    });
});
