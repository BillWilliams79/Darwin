// @vitest-environment jsdom
//
// req #3393 — the pipelines browser/editor. Structural sibling of the other
// plan-layer page test files (see the epics page test's header for the
// DataGrid-stub rationale, copied rather than imported).
//
// req #3356 collapsed the plan layer to one era: the visualizer route these
// assertions pin moved from `/swarm/pipeline2/:id` to `/swarm/pipeline/:id`
// when the 2.0 pages took the vacated routes. The `pipelines-*` / `pipelines-*`
// TESTIDS below are NOT stale — they are the strings the production components
// still emit, and this file asserts what production does rather than renaming
// it from here.
//
// What is pinned: Cards is the default view and shows status/execution-mode/
// step-count/orchestration-holder chips and a progress bar over REQUIREMENTS
// MET; the status filter hides/shows pipelines and names what it hid when the
// result is empty; the Table view carries the one editor control (the
// execution_mode toggle) Cards deliberately does not; opening a plan — from a
// card, from the table title, or from clicking anywhere else in a table row —
// always navigates to the real 2.0 visualizer (`/swarm/pipeline/:id`, req
// #3463/#3372), and never fires a mutation; every editor control stops
// propagation so it does not ALSO navigate the row away.
//
// ── req #3365 CHANGED WHAT THIS FILE PINS, on user directive ───────────────
// Three things this header used to describe are gone from the page and so
// from these tests, and they are named here rather than silently dropped:
//   · the two-state done/open STEP progress bar — completeness is measured on
//     requirements now, because a step has no status column and the
//     `completed_at` the bar counted is empty on essentially every step;
//   · the requirement tally on the card TITLE — it moved to the accounting
//     line under the bar that draws it;
//   · the Table view's "Goal" description dialog and its trailing Open icon —
//     both removed, and their absence is now itself asserted.

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
    // `data-testid` is forwarded from the real usage (`pipelines-grid`), not
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
        useAllPipelines: () => ({ data: pipelines, isLoading: loading.pipelines }),
        useMachines: () => ({ data: machines, isLoading: loading.machines }),
        useAllEpics: () => ({ data: epics, isLoading: loading.epics }),
        useAllPipelineSteps: () => ({ data: steps, isLoading: loading.steps }),
        useAllPipelineStepRequirements: () => ({
            data: stepRequirements, isLoading: loading.links }),
        useAllRequirements: () => ({ data: requirements, isLoading: loading.requirements }),
        useOrchestrationClaims: () => ({ data: orchestrationClaims }),
    };
});

// THE CARD THUMBNAIL IS STUBBED, for the same reason `PipelineDetail`'s own
// tests stub `pipelineDetailModes` (req #3365): it renders a `react-konva`
// Stage, and under jsdom `konva` resolves to its NODE build, which `require`s
// the optional native `canvas` package. That package is not a dependency of
// this repo, so importing it fails the whole SUITE at collection — not one
// assertion, every test in the file — and the failure names `canvas` rather
// than anything to do with this page.
//
// The stub keeps the thumbnail OBSERVABLE (same testid, same pipeline id) so
// the card's composition can still be asserted; what it deliberately does not
// try to do is prove the drawing, which needs a real canvas and belongs in a
// browser test rather than in jsdom.
vi.mock('../PipelinePlanThumbnail', () => ({
    default: ({ pipelineId }) => (
        <div data-testid={`pipelines-card-thumb-${pipelineId}`} />
    ),
}));

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

import PipelinesPage2 from '../PipelinesPage';
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
            <MemoryRouter initialEntries={['/swarm/pipelines']}>
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
const click = (el) => act(() => { el.click(); });
// `textareaIn`/`type` went with the description-dialog suite (req #3365) —
// no remaining test types into a field on this page.
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
        expect(node('pipelines-card-7')).not.toBeNull();
        expect(node('pipelines-card-8')).not.toBeNull();
    });

    // ── req #3365 — COMPLETENESS IS MEASURED ON REQUIREMENTS ────────────────
    // These two assertions replace, rather than relax, the pair that stood
    // here: "shows the done/open two-state summary" and "shows the met/total
    // requirement count on the title". Both described behaviour the user
    // directed away on 2026-08-12 — step state is not shown at all now, and
    // the requirement tally moved off the title into the accounting line — so
    // leaving them passing would have meant pinning a contract nobody holds.
    it('accounts for completeness in REQUIREMENTS met, not in step state', () => {
        mount();
        expect(node('pipelines-card-summary-7').textContent)
            .toBe('1 of 2 requirements met');
        // The old line counted steps and would have said "0 complete · 1 open"
        // here; a step carries no status column, so that number was `completed_at`
        // and nothing else.
        expect(node('pipelines-card-summary-7').textContent).not.toContain('complete ·');
        expect(node('pipelines-card-summary-7').textContent).not.toContain('open');
    });

    it('keeps the title to the plan NAME, with the tally in the accounting line', () => {
        mount();
        expect(node('pipelines-card-7').textContent).toContain('Plan Seven');
        // The tally used to be glued to the title as a bare " 1/2".
        expect(node('pipelines-card-7').textContent).not.toContain('Plan Seven 1/2');
        expect(node('pipelines-card-summary-7').textContent).toContain('1 of 2');
    });

    it('renders no last-viewed decoration at all (req #3365)', () => {
        mount();
        expect(node('pipelines-card-lastviewed-7')).toBeNull();
        expect(node('pipelines-card-7').textContent).not.toContain('Last viewed');
    });

    it('renders a plan thumbnail on each card (req #3365)', () => {
        mount();
        expect(node('pipelines-card-thumb-7')).not.toBeNull();
        expect(node('pipelines-card-thumb-8')).not.toBeNull();
    });

    it('puts the status chip in the pill row', () => {
        mount();
        const status = node('pipelines-card-status-7');
        expect(status).not.toBeNull();
        expect(status.textContent).toBe('active');
    });

    it('shows the orchestration holder only when a claim covers the plan', () => {
        mount();
        expect(node('pipelines-card-holder-7')).toBeNull();

        orchestrationClaims = [{
            id: 1, pipeline_fk: 7, epic_fk: null, machine_fk: 4,
            claimed_at: '2026-08-10T10:00:00', update_ts: new Date().toISOString().slice(0, 19),
        }];
        mount();
        expect(node('pipelines-card-holder-7')).not.toBeNull();
        expect(node('pipelines-card-holder-7').textContent).toContain('Mac mini');
        // Scoped — plan 8 carries no claim.
        expect(node('pipelines-card-holder-8')).toBeNull();
    });

    it('opens the visualizer when a card is clicked', () => {
        mount();
        // Click a DESCENDANT of the CardActionArea, not the outer Card
        // wrapper — a real click event bubbles from child to parent, never
        // the reverse, so `.click()` on the Card itself never reaches
        // CardActionArea's own onClick.
        click(node('pipelines-card-summary-7'));
        expect(navigations).toEqual(['/swarm/pipeline/7']);
    });
});

describe('PipelinesPage2 — status filter', () => {
    it('shows both fixture pipelines by default (active + draft)', () => {
        mount();
        expect(node('pipelines-card-7')).not.toBeNull();
        expect(node('pipelines-card-8')).not.toBeNull();
        expect(node('pipelines-accounting').textContent).toContain('2 of 2');
    });

    it('hides a pipeline when its status chip is toggled off', () => {
        mount();
        click(node('pipelines-status-chip-draft'));
        expect(node('pipelines-card-8')).toBeNull();
        expect(node('pipelines-card-7')).not.toBeNull();
    });

    it('names the hidden statuses in the empty state when every chip is off', () => {
        mount();
        click(node('pipelines-status-chip-active'));
        click(node('pipelines-status-chip-draft'));
        click(node('pipelines-status-chip-paused'));
        expect(node('pipelines-card-7')).toBeNull();
        expect(node('pipelines-cards-empty').textContent).toContain('active');
        expect(node('pipelines-cards-empty').textContent).toContain('draft');
    });
});

describe('PipelinesPage2 — view toggle', () => {
    it('switches from Cards to Table and back', () => {
        mount();
        expect(node('pipelines-cards-view')).not.toBeNull();
        expect(node('pipelines-grid')).toBeNull();

        switchToTable();
        expect(node('pipelines-grid')).not.toBeNull();
        expect(node('pipelines-cards-view')).toBeNull();

        click(node('view-toggle-cards'));
        expect(node('pipelines-cards-view')).not.toBeNull();
    });
});

describe('PipelinesPage2 — opening the visualizer, Table view (req #3463/#3372)', () => {
    it('navigates to the 2.0 visualizer from the title', () => {
        mount();
        switchToTable();
        click(node('pipelines-open-title-7'));
        expect(navigations).toEqual(['/swarm/pipeline/7']);
    });

    it('navigates when any other part of the row is clicked', () => {
        mount();
        switchToTable();
        click(node('grid-row-7'));
        expect(navigations).toEqual(['/swarm/pipeline/7']);
    });

    it('opening a row never fires a mutation', async () => {
        mount();
        switchToTable();
        click(node('pipelines-open-title-7'));
        await flush();
        expect(restCalls).toEqual([]);
    });

    it('does NOT navigate away when the execution_mode chip is clicked', async () => {
        mount();
        switchToTable();
        click(node('pipelines-execmode-chip-7'));
        await flush();
        expect(navigations).toEqual([]);
    });

    // ── req #3365 — THE TWO REMOVED CONTROLS, PINNED AS ABSENT ─────────────
    // Replaces 'navigates to the 2.0 visualizer from the Open action' and
    // 'does NOT navigate away when the description button is clicked'. Both
    // drove controls the user directed away; asserting their ABSENCE is what
    // keeps the removal a decision rather than something a later edit undoes
    // by accident. Row-click navigation is covered by the test above, which is
    // the whole reason the Open icon was redundant.
    it('renders neither the Goal button nor the trailing Open icon', () => {
        mount();
        switchToTable();
        expect(node('pipelines-description-btn-7')).toBeNull();
        expect(node('pipelines-open-7')).toBeNull();
        expect(node('pipelines-open-8')).toBeNull();
        // The title link survives — it is one of the three ways in that made
        // the fourth redundant.
        expect(node('pipelines-open-title-7')).not.toBeNull();
    });
});

describe('PipelinesPage2 execution_mode toggle (Table view)', () => {
    it('flips parallel to serial with a one-field PUT', async () => {
        mount();
        switchToTable();
        click(node('pipelines-execmode-chip-7'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines',
            method: 'PUT',
            body: [{ id: 7, execution_mode: 'serial' }],
        }]);
    });

    it('flips serial back to parallel', async () => {
        mount();
        switchToTable();
        click(node('pipelines-execmode-chip-8'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 8, execution_mode: 'parallel' }]);
    });
});

describe('PipelinesPage2 status chip (Table view)', () => {
    it('is a plain label with no click handler', () => {
        mount();
        switchToTable();
        const chip = node('pipelines-status-7');
        // MUI's Chip only renders as a <button>/role="button" when it is
        // given an onClick — a plain <div> here proves no toggle was wired.
        expect(chip.tagName).not.toBe('BUTTON');
        expect(chip.getAttribute('role')).not.toBe('button');
    });
});

// THE 'description dialog (Table view)' SUITE IS GONE (req #3365). Its five
// tests drove `pipelines-description-btn-*`, the Goal column the user removed,
// and the dialog behind it — which this page no longer defines at all. They are
// deleted rather than re-pointed: the equivalent dialog on `PipelineDetail.jsx`
// is a SEPARATE component with its own tests, and pointing these at it would
// make this file assert another page's behaviour.
