// @vitest-environment jsdom
//
// req #3393 — the pipelines browser/editor. Structural sibling of the other
// plan-layer page test files (see the initiatives page test's header for the
// DataGrid-stub rationale, copied rather than imported).
//
// req #3356 collapsed the plan layer to one era: the visualizer route these
// assertions pin moved from `/swarm/pipeline2/:id` to `/swarm/pipeline/:id`
// when the 2.0 pages took the vacated routes. The `pipelines-*` / `pipelines-*`
// TESTIDS below are NOT stale — they are the strings the production components
// still emit, and this file asserts what production does rather than renaming
// it from here.
//
// What is pinned: Cards is the default view and shows status/epic-count/
// orchestration-holder chips and a progress bar over REQUIREMENTS
// MET; the status filter hides/shows pipelines and names what it hid when the
// result is empty; the Table view carries the one editor control (the
// lock toggle) Cards deliberately does not; neither view nor the New pipeline
// dialog offers an execution mode (req #3822 — a plan always runs parallel); opening a plan — from a
// card, from the table title, or from clicking anywhere else in a table row —
// always navigates to the real 2.0 visualizer (`/swarm/pipeline/:id`, req
// #3463/#3372), and never fires a mutation; every editor control stops
// propagation so it does not ALSO navigate the row away.
//
// ── req #3365 CHANGED WHAT THIS FILE PINS, on user directive ───────────────
// Three things this header used to describe are gone from the page and so
// from these tests, and they are named here rather than silently dropped:
//   · the two-state done/open EPIC progress bar — completeness is measured on
//     requirements now, because an epic has no status column and the
//     `completed_at` the bar counted is empty on essentially every epic;
//   · the requirement tally on the card TITLE — it moved to the accounting
//     line under the bar that draws it;
//   · the Table view's "Goal" description dialog and its trailing Open icon —
//     both removed, and their absence is now itself asserted.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

// Renders the router's live query string, so a test can see `?view=` drop.
function LocationProbe() {
    return <span data-testid="location-probe">{useLocation().search}</span>;
}

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
    // (the title link, the Open action, the lock chip, the
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
let initiatives;
let epics;
let epicRequirements;
let requirements;
let orchestrationClaims;
let loading;
let initiativeDeps = [];

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllPipelines: () => ({ data: pipelines, isLoading: loading.pipelines }),
        useMachines: () => ({ data: machines, isLoading: loading.machines }),
        useAllInitiatives: () => ({ data: initiatives, isLoading: loading.initiatives }),
        useAllPipelineEpics: () => ({ data: epics, isLoading: loading.epics }),
        useAllPipelineEpicRequirements: () => ({
            data: epicRequirements, isLoading: loading.links }),
        useAllRequirements: () => ({ data: requirements, isLoading: loading.requirements }),
        useOrchestrationClaims: () => ({ data: orchestrationClaims }),
        // req #3823 — initiative-to-initiative edges (none unless a test seeds them).
        useAllInitiativeDeps: () => ({ data: initiativeDeps }),
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
// A test may answer a call itself (req #3934's delete reads the plan first);
// `undefined` falls through to the defaults below.
let restRespond = null;
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri, method, body });
        const answer = restRespond?.(uri, method, body);
        if (answer) return Promise.resolve(answer);
        // A POST echoes the created row back, as Lambda-Rest does (req #3773).
        if (method === 'POST') {
            return Promise.resolve({ httpStatus: { httpStatus: 201 }, data: [{ id: 99 }] });
        }
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import PipelinesPage2 from '../PipelinesPage';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

let mountedRoots = [];

function mount(entry = '/swarm/pipelines') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } },
    });
    const root = createRoot(container);
    act(() => {
        root.render(
            <MemoryRouter initialEntries={[entry]}>
                <QueryClientProvider client={queryClient}>
                    <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                        <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                            <PipelinesPage2 />
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
// Types into a React-controlled input/textarea (req #3773's create controls).
const type = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
    act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const keyDown = (el, key) => act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
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
    restRespond = null;
    mountedRoots = [];
    // useViewPreference/the status filter both persist to Web Storage, which
    // jsdom keeps ALIVE across tests in one file unless cleared.
    sessionStorage.clear();
    localStorage.clear();
    loading = {
        pipelines: false, machines: false, initiatives: false, epics: false,
        links: false, requirements: false,
    };
    pipelines = [
        { id: 7, title: 'Plan Seven', description: 'Existing goal.', pipeline_status: 'active',
          sort_order: 0, machine_fk: 4, started_at: '2026-08-01 00:00:00', completed_at: null },
        { id: 8, title: 'Plan Eight', description: null, pipeline_status: 'draft',
          sort_order: 1, locked: 1, machine_fk: null, started_at: null,
          completed_at: null },
    ];
    machines = [{ id: 4, title: 'Mac mini', platform: 'darwin' },
                { id: 5, title: 'Gaming PC', platform: 'wsl' }];
    initiatives = [
        { id: 40, pipeline_fk: 7, title: 'Initiative Seven' },
        { id: 41, pipeline_fk: 8, title: 'Initiative Eight' },
    ];
    epics = [
        { id: 500, initiative_fk: 40 },
        { id: 501, initiative_fk: 40 },
        { id: 502, initiative_fk: 41 },
    ];
    epicRequirements = [
        { epic_fk: 500, requirement_fk: 900 },
        { epic_fk: 501, requirement_fk: 901 },
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
    // directed away on 2026-08-12 — epic state is not shown at all now, and
    // the requirement tally moved off the title into the accounting line — so
    // leaving them passing would have meant pinning a contract nobody holds.
    // req #3804 review — ONE plain info block: initiatives, epics, and
    // requirements closed of total; no badges for them, and no "x of y met"
    // line restating the block.
    it('shows initiatives, epics and requirements closed in one info block', () => {
        mount();
        expect(node('pipelines-card-initiatives-7').textContent).toBe('1');
        expect(node('pipelines-card-epics-7').textContent).toBe('2');
        expect(node('pipelines-card-requirements-7').textContent).toBe('1 / 2');
        // req #3804 review — the label is "requirements"; the figure is closed / total.
        expect(node('pipelines-card-info-7').textContent).toContain('requirements');
        expect(node('pipelines-card-info-7').textContent).not.toContain('closed');
        // req #3804 review — "remove the status bar".
        expect(node('pipelines-card-progress-7')).toBeNull();
        expect(node('pipelines-card-summary-7')).toBeNull();
        expect(node('pipelines-card-7').textContent).not.toContain('requirements met');
    });

    it('keeps the title to the plan NAME, with the tally in the accounting line', () => {
        mount();
        // req #3804 — the title is an in-place field; its value is the name alone.
        expect(node('pipelines-card-title-7').value).toBe('Plan Seven');
        expect(node('pipelines-card-requirements-7').textContent).toBe('1 / 2');
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

    // req #3804 review — "drop the info blurbs about machine, status".
    it('carries no status or machine chip', () => {
        mount();
        expect(node('pipelines-card-status-7')).toBeNull();
        expect(node('pipelines-card-machine-7')).toBeNull();
        expect(node('pipelines-card-7').textContent).not.toContain('Mac mini');
    });

    it('shows the orchestration holder only when a claim covers the plan', () => {
        mount();
        expect(node('pipelines-card-holder-7')).toBeNull();

        orchestrationClaims = [{
            id: 1, pipeline_fk: 7, initiative_fk: null, machine_fk: 4,
            claimed_at: '2026-08-10T10:00:00', update_ts: new Date().toISOString().slice(0, 19),
        }];
        mount();
        expect(node('pipelines-card-holder-7')).not.toBeNull();
        // Scoped — plan 8 carries no claim.
        expect(node('pipelines-card-holder-8')).toBeNull();
    });

    // req #3973 — the holder is a round badge between the grip and the title,
    // carrying only the machine's letter; the bottom chip is gone.
    it('draws the holder as an M / W badge between the grip and the title', () => {
        const fresh = new Date().toISOString().slice(0, 19);
        orchestrationClaims = [
            { id: 1, pipeline_fk: 7, initiative_fk: null, machine_fk: 4,
              claimed_at: '2026-08-10T10:00:00', update_ts: fresh },
            { id: 2, pipeline_fk: 7, initiative_fk: null, machine_fk: 5,
              claimed_at: '2026-08-10T10:00:00', update_ts: fresh },
        ];
        mount();
        const lead = node('pipelines-card-holder-7-lead');
        expect(lead.textContent).toBe('M');
        expect(lead.getAttribute('data-tone')).toBe('lead');
        expect(lead.getAttribute('aria-label')).toContain('Mac mini');
        const sub = node('pipelines-card-holder-7-claim-2');
        expect(sub.textContent).toBe('W');
        expect(sub.getAttribute('data-tone')).toBe('subscriber');
        // Row one, in order: grip, badge, title.
        const row = node('pipelines-card-grip-7').parentElement;
        const order = [...row.querySelectorAll('[data-testid]')].map((el) => el.dataset.testid);
        const at = (id) => order.indexOf(id);
        expect(at('pipelines-card-grip-7')).toBeLessThan(at('pipelines-card-holder-7'));
        expect(at('pipelines-card-holder-7')).toBeLessThan(at('pipelines-card-title-7'));
    });

    it('draws a stale holder as an outline badge', () => {
        orchestrationClaims = [{
            id: 1, pipeline_fk: 7, initiative_fk: null, machine_fk: 5,
            claimed_at: '2026-08-10T10:00:00', update_ts: '2026-08-10T10:00:00',
        }];
        mount();
        const lead = node('pipelines-card-holder-7-lead');
        expect(lead.textContent).toBe('W');
        expect(lead.getAttribute('data-tone')).toBe('stale');
    });

    // req #3804 — a click on the card body is an EDIT now, so the plan opens
    // from the open button or its picture, and nowhere else.
    // req #3804 review — the open buttons are gone (beside the title and in
    // the menu); the picture is the way in.
    it('opens the visualizer from the picture, and has no open button', () => {
        mount();
        expect(node('pipelines-card-open-7')).toBeNull();
        click(node('pipelines-card-menu-7'));
        expect(document.body.textContent).not.toContain('Open plan');
        click(node('pipelines-card-thumb-8'));
        expect(navigations).toEqual(['/swarm/pipeline/8']);
    });

    it('does not navigate when the card body is clicked', () => {
        mount();
        click(node('pipelines-card-info-7'));
        click(node('pipelines-card-title-7'));
        expect(navigations).toEqual([]);
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

    // req #3641 — `?view=` names the panel, over the stored preference,
    // without rewriting it.
    it('opens the panel a ?view= link names, without persisting it', () => {
        localStorage.setItem('darwin-swarm-pipelines-view', 'table');
        mount('/swarm/pipelines?view=cards');
        expect(node('pipelines-cards-view')).not.toBeNull();
        expect(node('pipelines-grid')).toBeNull();
        expect(sessionStorage.getItem('darwin-swarm-pipelines-view')).toBe('table');
    });

    it('ignores an unknown ?view= and keeps the stored preference', () => {
        localStorage.setItem('darwin-swarm-pipelines-view', 'table');
        mount('/swarm/pipelines?view=bogus');
        expect(node('pipelines-grid')).not.toBeNull();
    });

    it('a hand-picked view replaces the link view and drops ?view=', () => {
        mount('/swarm/pipelines?view=cards&keep=1');
        expect(node('location-probe').textContent).toBe('?view=cards&keep=1');
        switchToTable();
        expect(node('pipelines-grid')).not.toBeNull();
        expect(node('pipelines-cards-view')).toBeNull();
        expect(sessionStorage.getItem('darwin-swarm-pipelines-view')).toBe('table');
        expect(node('location-probe').textContent).toBe('?keep=1');
    });

    it('clicking the already-active view keeps the link view and its ?view=', () => {
        mount('/swarm/pipelines?view=cards');
        click(node('view-toggle-cards'));
        expect(node('pipelines-cards-view')).not.toBeNull();
        expect(node('location-probe').textContent).toBe('?view=cards');
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

    it('does NOT navigate away when the lock chip is clicked', async () => {
        mount();
        switchToTable();
        click(node('pipelines-lock-chip-7'));
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

// req #3822 — a plan always runs every initiative at once, so no surface on
// this page offers an execution mode: not the Table, not the Cards, not the
// New pipeline dialog.
describe('PipelinesPage2 — no execution mode anywhere (req #3822)', () => {
    it('renders no execution-mode control in either view or the dialog', () => {
        mount();
        expect(document.body.textContent).not.toMatch(/Parallel|Serial/);
        switchToTable();
        expect(node('pipelines-execmode-chip-7')).toBeNull();
        expect(document.body.textContent).not.toMatch(/Execution|Parallel|Serial/);
        click(node('pipelines-new-button'));
        expect(node('pipelines-new-execmode')).toBeNull();
        expect(document.body.textContent).not.toMatch(/Execution|Parallel|Serial/);
    });
});

// req #3649 — the Lock column flips `locked` with a one-field PUT; the Cards
// view shows a display-only lock chip on a locked plan and nothing on an open one.
describe('PipelinesPage2 lock toggle (Table view)', () => {
    it('locks an open plan', async () => {
        mount();
        switchToTable();
        expect(node('pipelines-lock-chip-7').textContent).toBe('Open');
        click(node('pipelines-lock-chip-7'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines',
            method: 'PUT',
            body: [{ id: 7, locked: 1 }],
        }]);
        expect(navigations).toEqual([]);
    });

    it('unlocks a locked plan', async () => {
        mount();
        switchToTable();
        expect(node('pipelines-lock-chip-8').textContent).toBe('Locked');
        click(node('pipelines-lock-chip-8'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 8, locked: 0 }]);
    });
});

describe('PipelinesPage2 lock chip (Cards view)', () => {
    it('marks only the locked plan', () => {
        mount();
        expect(node('pipelines-card-locked-8')).not.toBeNull();
        expect(node('pipelines-card-locked-7')).toBeNull();
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

const POST_BODY_DEFAULTS = {
    pipeline_status: 'draft', locked: 0, closed: 0, started_at: null, completed_at: null,
};

describe('PipelinesPage2 — create trial A: header button + dialog (req #3773)', () => {
    it('is in the header in both views', () => {
        mount();
        expect(node('pipelines-new-button')).not.toBeNull();
        switchToTable();
        expect(node('pipelines-new-button')).not.toBeNull();
    });

    it('creates a draft plan from every field and opens it', async () => {
        mount();
        click(node('pipelines-new-button'));
        expect(node('pipelines-new-dialog')).not.toBeNull();
        type(node('pipelines-new-title'), '  Fresh Plan  ');
        type(node('pipelines-new-description'), '  Why it exists.  ');
        await act(async () => { node('pipelines-new-create').click(); });
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines',
            method: 'POST',
            // req #3804 — in FRONT of every positioned plan (fixture min 0).
            body: { title: 'Fresh Plan', description: 'Why it exists.',
                    machine_fk: null, sort_order: -1, ...POST_BODY_DEFAULTS },
        }]);
        expect(navigations).toEqual(['/swarm/pipeline/99']);
    });

    it('writes nothing without a title', async () => {
        mount();
        click(node('pipelines-new-button'));
        expect(node('pipelines-new-create').disabled).toBe(true);
        type(node('pipelines-new-title'), '   ');
        keyDown(node('pipelines-new-title'), 'Enter');
        await flush();
        expect(restCalls).toEqual([]);
        expect(navigations).toEqual([]);
    });

    it('refuses the NULL sentinel as a title', async () => {
        mount();
        click(node('pipelines-new-button'));
        type(node('pipelines-new-title'), 'NULL');
        await act(async () => { node('pipelines-new-create').click(); });
        await flush();
        expect(restCalls).toEqual([]);
        expect(useSnackBarStore.getState().message).toMatch(/sentinel/);
    });
});

describe('PipelinesPage2 — "+ New pipeline" makes a card in place, at the FRONT (req #3804)', () => {
    it('closes the Cards grid', () => {
        mount();
        const grid = node('pipelines-cards-view');
        expect(grid.lastElementChild.getAttribute('data-testid')).toBe('pipelines-new-card');
    });

    it('is still offered when the status filter hides every plan', () => {
        mount();
        click(node('pipelines-status-chip-active'));
        click(node('pipelines-status-chip-draft'));
        click(node('pipelines-status-chip-paused'));
        expect(node('pipelines-cards-empty')).not.toBeNull();
        expect(node('pipelines-new-card')).not.toBeNull();
    });

    it('puts an unsaved card FIRST in the grid; Enter writes it in front, without opening it', async () => {
        mount();
        click(node('pipelines-new-card-open'));
        const grid = node('pipelines-cards-view');
        expect(grid.firstElementChild.getAttribute('data-testid')).toBe('pipelines-draft-card');
        const input = node('pipelines-new-card-title');
        type(input, 'Quick Plan');
        await act(async () => { keyDown(input, 'Enter'); });
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines',
            method: 'POST',
            body: { title: 'Quick Plan', description: null,
                    machine_fk: null, sort_order: -1, ...POST_BODY_DEFAULTS },
        }]);
        expect(navigations).toEqual([]);
        expect(node('pipelines-draft-card')).toBeNull();
    });

    it('lights the draft status when it was filtered out, so the new card stays visible', async () => {
        mount();
        click(node('pipelines-status-chip-draft'));
        click(node('pipelines-new-card-open'));
        type(node('pipelines-new-card-title'), 'Hidden?');
        await act(async () => { keyDown(node('pipelines-new-card-title'), 'Enter'); });
        await flush();
        expect(JSON.parse(sessionStorage.getItem('darwin-swarm-pipelines-status-filter')))
            .toContain('draft');
    });

    it('Escape takes the unsaved card away without writing', async () => {
        mount();
        click(node('pipelines-new-card-open'));
        type(node('pipelines-new-card-title'), 'Never mind');
        keyDown(node('pipelines-new-card-title'), 'Escape');
        await flush();
        expect(node('pipelines-draft-card')).toBeNull();
        expect(node('pipelines-new-card-open')).not.toBeNull();
        expect(restCalls).toEqual([]);
    });

    it('keeps the typed title when the create fails', async () => {
        const RestApi = (await import('../../RestApi/RestApi')).default;
        // call_rest_api THROWS `{data, httpStatus}` on any non-2xx.
        RestApi.mockImplementationOnce(() => Promise.reject(
            { data: null, httpStatus: { httpStatus: 500, httpMessage: 'boom' } }));
        mount();
        click(node('pipelines-new-card-open'));
        type(node('pipelines-new-card-title'), 'Kept');
        await act(async () => { node('pipelines-new-card-create').click(); });
        await flush();
        expect(node('pipelines-new-card-title').value).toBe('Kept');
        expect(navigations).toEqual([]);
    });
});

// ── req #3804 — hand-sorted, closable, edited in place ─────────────────────
describe('PipelinesPage2 — hand-sorted order (req #3804)', () => {
    // req #3804 review — a card lifts from its grip only; the rest of the card
    // is the page's to pan.
    // req #3804 review — "flip the design": grip/title, the info block and
    // its bar, then the preview, then the goal.
    it('stacks the card as title, info block, preview, goal', () => {
        mount();
        const card = node('pipelines-card-7');
        const order = ['pipelines-card-title-7', 'pipelines-card-info-7',
            'pipelines-card-thumb-7', 'pipelines-card-description-7']
            .map((id) => card.querySelector(`[data-testid="${id}"]`));
        for (let i = 1; i < order.length; i += 1) {
            expect(order[i - 1].compareDocumentPosition(order[i])
                & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
    });

    it('gives every open card a drag grip, and a closed card an inert one', () => {
        pipelines = [...pipelines, { id: 9, title: 'Plan Nine', pipeline_status: 'active',
            closed: 1, sort_order: 2 }];
        mount();
        click(node('pipelines-show-closed'));
        const grip = node('pipelines-card-grip-7');
        expect(grip.getAttribute('role')).toBe('button');
        expect(grip.getAttribute('aria-roledescription')).toBeNull();
        expect(node('pipelines-card-7').getAttribute('data-darwin-drag')).toBe('true');
        expect(node('pipelines-card-7').getAttribute('role')).toBeNull();
        expect(node('pipelines-card-grip-9').getAttribute('role')).toBeNull();
    });

    it('draws the cards in sort_order, not by id', () => {
        pipelines = [
            { ...pipelines[0], sort_order: 1 },
            { ...pipelines[1], sort_order: 0 },
        ];
        mount();
        const cards = [...node('pipelines-cards-view').querySelectorAll('[data-testid^="pipelines-card-"][data-testid$="-7"], [data-testid^="pipelines-card-"][data-testid$="-8"]')]
            .filter((el) => /^pipelines-card-\d+$/.test(el.getAttribute('data-testid')))
            .map((el) => el.getAttribute('data-testid'));
        expect(cards).toEqual(['pipelines-card-8', 'pipelines-card-7']);
    });
});

describe('PipelinesPage2 — closed pipelines (req #3804)', () => {
    beforeEach(() => {
        pipelines = [...pipelines, { id: 9, title: 'Plan Nine', description: null,
            pipeline_status: 'active', closed: 1, sort_order: 2, machine_fk: null }];
    });

    it('hides a closed plan by default, and the Closed chip shows it', () => {
        mount();
        expect(node('pipelines-card-9')).toBeNull();
        expect(node('pipelines-show-closed').textContent).toBe('Closed (1)');
        expect(node('pipelines-accounting').textContent).toContain('1 closed hidden');
        click(node('pipelines-show-closed'));
        expect(node('pipelines-card-9')).not.toBeNull();
        expect(node('pipelines-card-closed-9')).not.toBeNull();
    });

    it('closes a plan from its card menu with a one-field PUT', async () => {
        mount();
        click(node('pipelines-card-menu-7'));
        await act(async () => { node('pipelines-card-menu-close-7').click(); });
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines',
            method: 'PUT',
            body: [{ id: 7, closed: 1 }],
        }]);
    });

    it('reopens a closed plan, and a locked plan can still be closed', async () => {
        mount();
        click(node('pipelines-show-closed'));
        click(node('pipelines-card-menu-9'));
        await act(async () => { node('pipelines-card-menu-close-9').click(); });
        await flush();
        click(node('pipelines-card-menu-8'));
        await act(async () => { node('pipelines-card-menu-close-8').click(); });
        await flush();
        expect(restCalls.map((c) => c.body)).toEqual([[{ id: 9, closed: 0 }], [{ id: 8, closed: 1 }]]);
    });

    it('says every plan is closed rather than "No pipelines yet"', () => {
        pipelines = pipelines.map((p) => ({ ...p, closed: 1 }));
        mount();
        expect(node('pipelines-cards-empty').textContent).toContain('Every pipeline is closed (3)');
    });

    it('toggles closed from the Table view without navigating', async () => {
        mount();
        switchToTable();
        click(node('pipelines-closed-chip-7'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 7, closed: 1 }]);
        expect(navigations).toEqual([]);
    });
});

describe('PipelinesPage2 — edit in place (req #3804)', () => {
    it('saves a renamed title on Enter, sending only the title', async () => {
        mount();
        const input = node('pipelines-card-title-7');
        act(() => { input.focus(); });
        type(input, 'Plan Seven Renamed');
        await act(async () => { keyDown(input, 'Enter'); });
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines',
            method: 'PUT',
            body: [{ id: 7, title: 'Plan Seven Renamed' }],
        }]);
    });

    it('leaving an untouched field writes nothing, even after a poll brought newer text', async () => {
        const { container } = mount();
        const input = node('pipelines-card-title-7');
        act(() => { input.focus(); });
        // Another writer renamed the plan; the next poll re-renders the page.
        pipelines = [{ ...pipelines[0], title: 'Renamed Elsewhere' }, pipelines[1]];
        click(node('pipelines-status-chip-paused'));
        blur(input);
        await flush();
        expect(container).toBeTruthy();
        expect(restCalls).toEqual([]);
        expect(node('pipelines-card-title-7').value).toBe('Renamed Elsewhere');
    });

    it('Escape puts the stored title back without writing', async () => {
        mount();
        const input = node('pipelines-card-title-7');
        act(() => { input.focus(); });
        type(input, 'Oops');
        await act(async () => { keyDown(input, 'Escape'); });
        await flush();
        expect(restCalls).toEqual([]);
        expect(node('pipelines-card-title-7').value).toBe('Plan Seven');
    });

    it('refuses a blank title and writes nothing', async () => {
        mount();
        const input = node('pipelines-card-title-7');
        act(() => { input.focus(); });
        type(input, '   ');
        await act(async () => { keyDown(input, 'Enter'); });
        await flush();
        expect(restCalls).toEqual([]);
        expect(useSnackBarStore.getState().message).toMatch(/Title is required/);
    });

    it('a locked plan\'s title is read-only', () => {
        mount();
        expect(node('pipelines-card-title-8').readOnly).toBe(true);
        expect(node('pipelines-card-title-7').readOnly).toBe(false);
    });

    it('saves the goal on leaving the field, clearing it with the NULL sentinel', async () => {
        mount();
        const goal = node('pipelines-card-description-7');
        act(() => { goal.focus(); });
        type(goal, '');
        blur(goal);
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 7, description: 'NULL' }]);
    });

    // req #3945 — the goal sits collapsed under the shared Show more toggle.
    it('collapses the goal by default; the toggle pins it open, focus expands it', async () => {
        mount();
        const toggle = node('pipelines-card-description-7-toggle');
        expect(toggle.textContent).toBe('Show more');
        expect(toggle.compareDocumentPosition(node('pipelines-card-description-7'))
            & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        click(toggle);
        expect(toggle.textContent).toBe('Show less');
        click(toggle);
        expect(toggle.textContent).toBe('Show more');

        const goal = node('pipelines-card-description-7');
        act(() => { goal.focus(); });
        expect(toggle.textContent).toBe('Show less');
        act(() => { goal.blur(); });
        await flush();
        expect(toggle.textContent).toBe('Show more');
        expect(restCalls).toEqual([]);
        // A locked plan's goal still collapses and discloses.
        expect(node('pipelines-card-description-8-toggle').textContent).toBe('Show more');
    });

    it('the field itself reports collapsed, and expanded once pinned open', () => {
        mount();
        expect(node('pipelines-card-description-7').dataset.collapsed).toBe('true');
        click(node('pipelines-card-description-7-toggle'));
        expect(node('pipelines-card-description-7').dataset.collapsed).toBe('false');
    });

    it('collapsing a goal being edited saves the edit, as leaving it does', async () => {
        mount();
        const goal = node('pipelines-card-description-7');
        act(() => { goal.focus(); });
        type(goal, 'A sharper goal.');
        click(node('pipelines-card-description-7-toggle'));
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 7, description: 'A sharper goal.' }]);
        expect(node('pipelines-card-description-7-toggle').textContent).toBe('Show more');
    });

    it('changes the machine from the card menu', async () => {
        mount();
        // Plan 8 is locked: its Machine item is disabled.
        click(node('pipelines-card-menu-8'));
        expect(node('pipelines-card-menu-machine-8').getAttribute('aria-disabled')).toBe('true');
        click(node('pipelines-card-menu-7'));
        click(node('pipelines-card-menu-machine-7'));
        await act(async () => { node('pipelines-card-machine-option-7-any').click(); });
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 7, machine_fk: 'NULL' }]);
    });
});

describe('PipelinesPage2 — delete from the card menu (req #3934)', () => {
    beforeEach(() => {
        // Plan 7 as the gateway returns it: two epics, one edge between them.
        restRespond = (uri, method) => {
            if (method !== 'GET') return undefined;
            const rows = uri.includes('/pipelines?') ? [{ id: 7, title: 'Plan Seven', locked: 0 }]
                : uri.includes('/initiatives?') ? [{ id: 40, locked: 0 }]
                    : uri.includes('/epics?') ? [{ id: 500, locked: 0 }, { id: 501, locked: 0 }]
                        : uri.includes('/epic_deps?') ? [{ id: 9, epic_fk: 501, dep_epic_fk: 500 }]
                            : null;
            return rows ? { httpStatus: { httpStatus: 200 }, data: rows }
                : { httpStatus: { httpStatus: 404 }, data: [] };
        };
    });

    it('confirms, then clears the edge and deletes the plan', async () => {
        mount();
        click(node('pipelines-card-menu-7'));
        click(node('pipelines-card-menu-delete-7'));
        const dialog = node('pipelines-card-delete-dialog-7');
        expect(dialog.textContent).toContain('Plan Seven');
        expect(dialog.textContent).toContain('1 initiative, 2 epics');
        expect(dialog.textContent).toContain('2 requirements are kept');
        // Nothing is written until the reader confirms.
        expect(restCalls).toEqual([]);
        await act(async () => { node('pipelines-card-delete-confirm-7').click(); });
        await flush();
        expect(restCalls.filter((c) => c.method !== 'GET')).toEqual([
            { uri: 'http://test.local/darwin/epic_deps', method: 'DELETE', body: [{ id: 9 }] },
            { uri: 'http://test.local/darwin/pipelines', method: 'DELETE', body: { id: 7 } },
        ]);
        expect(useSnackBarStore.getState().message).toBe('Deleted pipeline "Plan Seven"');
        expect(navigations).toEqual([]);
    });

    it('cancel writes nothing', async () => {
        mount();
        click(node('pipelines-card-menu-7'));
        click(node('pipelines-card-menu-delete-7'));
        await act(async () => { node('pipelines-card-delete-cancel-7').click(); });
        expect(restCalls).toEqual([]);
    });

    it('is offered on any status, but not on a locked plan', () => {
        mount();
        click(node('pipelines-card-menu-7'));
        expect(node('pipelines-card-menu-delete-7').getAttribute('aria-disabled')).toBeNull();
        act(() => { document.body.querySelector('.MuiBackdrop-root')?.click(); });
        click(node('pipelines-card-menu-8'));
        const item = node('pipelines-card-menu-delete-8');
        expect(item.getAttribute('aria-disabled')).toBe('true');
        expect(item.textContent).toContain('unlock it first');
    });

    it('is not offered while a live orchestrator holds the plan', () => {
        orchestrationClaims = [{
            id: 1, pipeline_fk: 7, initiative_fk: null, machine_fk: 4,
            claimed_at: '2026-08-10T10:00:00', update_ts: new Date().toISOString().slice(0, 19),
        }];
        mount();
        click(node('pipelines-card-menu-7'));
        const item = node('pipelines-card-menu-delete-7');
        expect(item.getAttribute('aria-disabled')).toBe('true');
        expect(item.textContent).toContain('/pipeline-stop it first');
    });

    it('is not offered while a live engine holds just one initiative of the plan', () => {
        orchestrationClaims = [{
            id: 2, pipeline_fk: 7, initiative_fk: 40, machine_fk: 4,
            claimed_at: '2026-08-10T10:00:00', update_ts: new Date().toISOString().slice(0, 19),
        }];
        mount();
        click(node('pipelines-card-menu-7'));
        expect(node('pipelines-card-menu-delete-7').getAttribute('aria-disabled')).toBe('true');
    });

    it('shows the named refusal and keeps the dialog open when the delete is refused', async () => {
        // The plan is unlocked, so the menu offers Delete — an epic in it is locked.
        const world = restRespond;
        restRespond = (uri, method, body) => (method === 'GET' && uri.includes('/epics?')
            ? { httpStatus: { httpStatus: 200 }, data: [{ id: 500, locked: 0 }, { id: 501, locked: 1 }] }
            : world(uri, method, body));
        mount();
        click(node('pipelines-card-menu-7'));
        click(node('pipelines-card-menu-delete-7'));
        await act(async () => { node('pipelines-card-delete-confirm-7').click(); });
        await flush();
        expect(restCalls.filter((c) => c.method !== 'GET')).toEqual([]);
        expect(useSnackBarStore.getState().message).toBe('Could not delete the pipeline (423) — '
            + '"Plan Seven" cannot be deleted: epic 501 in it is locked — unlock it first.');
        expect(node('pipelines-card-delete-dialog-7')).not.toBeNull();
    });
});
