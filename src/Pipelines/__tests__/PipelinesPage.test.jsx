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
//   · the requirement tally on the card TITLE — it moved to the card's info
//     block (`pipelines-card-requirements-<id>`);
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
// req #3978 — the All Active box's reads.
let requirementSessions;
let sessionTerminals;
let requirementsError = false;
// The options the page's pipelines list read was made with (req #3965: no `closed`).
let pipelineReadOpts = null;

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllPipelines: (_creator, opts) => {
            pipelineReadOpts = opts;
            return { data: pipelines, isLoading: loading.pipelines };
        },
        useMachines: () => ({ data: machines, isLoading: loading.machines }),
        useAllInitiatives: () => ({ data: initiatives, isLoading: loading.initiatives }),
        useAllPipelineEpics: () => ({ data: epics, isLoading: loading.epics }),
        useAllPipelineEpicRequirements: () => ({
            data: epicRequirements, isLoading: loading.links }),
        useAllRequirements: () => ({ data: requirements, isLoading: loading.requirements,
            isError: requirementsError }),
        useOrchestrationClaims: () => ({ data: orchestrationClaims }),
        // req #3823 — initiative-to-initiative edges (none unless a test seeds them).
        useAllInitiativeDeps: () => ({ data: initiativeDeps }),
        useAllRequirementSessions: () => ({ data: requirementSessions }),
        useAllSessionTerminals: () => ({ data: sessionTerminals }),
        useDevServers: () => ({ data: [] }),
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

// req #3972 — the Pipeline group view is STUBBED here for the thumbnail's
// reason: it draws with WebGL, which jsdom does not have. The stub exposes
// what the PAGE hands it (the plans, the focus) and its two callbacks, so the
// page's wiring — `?view=group`, `?focus=` — is what these tests pin.
vi.mock('../PipelineGroupView', () => ({
    default: ({ pipelines: shown, focusId, onFocusChange, onOpen, onSetStatus }) => (
        <div data-testid="pipelines-group-view" data-focus={focusId ?? ''}
             data-ids={shown.map((p) => p.id).join(',')}>
            <button data-testid="group-stub-status-7"
                    onClick={() => onSetStatus(shown.find((p) => p.id === 7), 'deferred')} />
            <button data-testid="group-stub-focus-8" onClick={() => onFocusChange(8)} />
            <button data-testid="group-stub-clear" onClick={() => onFocusChange(null)} />
            <button data-testid="group-stub-open-7" onClick={() => onOpen(7)} />
        </div>
    ),
}));

vi.mock('../../SwarmView/pipelines/pipelinePlace', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, readPipelinePlace: () => null };
});

// req #3966 — the grid's drop handler, captured from the real ReorderList so
// a test can drop without simulating a pointer gesture under jsdom.
const dnd = vi.hoisted(() => ({ onReorder: null }));
vi.mock('../../dnd', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        ReorderList: (props) => {
            dnd.onReorder = props.onReorder;
            return <actual.ReorderList {...props} />;
        },
    };
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

// req #3965 — the status pills lit by default: the four non-terminal values.
const DEFAULT_PILLS = ['authoring', 'authorized', 'orchestration_ready', 'orchestrating'];

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

// jsdom does no layout: scrollHeight and clientHeight are both 0, so no goal
// ever "overflows" and (req #4144) the Show more toggle would never render.
// Stub the two getters — tall content in a short box is what a long goal
// measures as in a browser; `goalOverflows = false` models a short one.
let goalOverflows = true;
const stubLayout = (prop, fn) => Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true, get: fn,
});

beforeEach(() => {
    goalOverflows = true;
    stubLayout('scrollHeight', () => (goalOverflows ? 400 : 80));
    stubLayout('clientHeight', () => 80);
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
        { id: 7, title: 'Plan Seven', description: 'Existing goal.', pipeline_status: 'orchestrating',
          sort_order: 0, machine_fk: 4, started_at: '2026-08-01 00:00:00', completed_at: null },
        { id: 8, title: 'Plan Eight', description: null, pipeline_status: 'authoring',
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
    requirementsError = false;
    requirementSessions = [{ requirement_fk: 901, session_fk: 3001 }];
    sessionTerminals = [{ id: 3001, swarm_status: 'active' }];
    useSnackBarStore.setState({ open: false, message: '' });
});

afterEach(() => {
    delete HTMLElement.prototype.scrollHeight;
    delete HTMLElement.prototype.clientHeight;
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

// req #3978 — every plan's Active box in one, on this page.
describe('PipelinesPage2 — All Active', () => {
    it('lists the active requirements of every plan in the Active box', () => {
        requirements = [
            { id: 900, title: 'Done thing', requirement_status: 'met' },
            { id: 901, title: 'Running thing', requirement_status: 'development' },
        ];
        mount();
        expect(node('pipelines-all-active-title').textContent).toBe('All Active');
        expect(node('pipelines-all-active-count').textContent).toBe('1');
        expect(node('pipelines-all-active-item-title-901').textContent).toBe('Running thing');
        expect(node('pipelines-all-active-item-900')).toBeNull();
        click(node('pipelines-all-active-item-901'));
        expect(navigations).toEqual(['/swarm/requirement/901']);
    });

    it('reads loading, not None running, until the session reads have data', () => {
        sessionTerminals = undefined;
        mount();
        expect(node('pipelines-all-active-count').textContent).toBe('…');
        expect(node('pipelines-all-active-empty')).toBeNull();
    });

    it('reads loading, not None running, when the requirement read failed', () => {
        requirements = [];
        requirementsError = true;
        mount();
        expect(node('pipelines-all-active-count').textContent).toBe('…');
        expect(node('pipelines-all-active-empty')).toBeNull();
    });
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
    // the requirement tally moved off the title into the card's info block — so
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

    it('keeps the title to the plan NAME, with the tally in the card info block', () => {
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

    // req #3804 review — "drop the info blurbs about machine, status"; req
    // #3965 brought the STATUS back as the card's status editor.
    it('carries a status editor but no machine chip', () => {
        mount();
        expect(node('pipelines-card-status-7').textContent).toBe('Running');
        expect(node('pipelines-card-status-8').textContent).toBe('Authoring');
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
    it('draws the holder as a machine-coloured M / W badge right of the status', () => {
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
        // req #4169 — filled with the machine's colour, and just right of the status.
        expect(lead.style.backgroundColor || getComputedStyle(lead).backgroundColor).toBeTruthy();
        const status = node('pipelines-card-status-7');
        const order = [...status.parentElement.querySelectorAll('[data-testid]')].map((el) => el.dataset.testid);
        expect(order.indexOf('pipelines-card-status-7')).toBeLessThan(order.indexOf('pipelines-card-holder-7'));
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

    // req #4027 — the picture is a real link, so the browser's right-click
    // menu offers "Open link in new tab", and a modified click is the browser's.
    it('makes the picture a link to the plan, leaving modified clicks to the browser', () => {
        mount();
        const link = node('pipelines-card-thumbnail-8');
        expect(link.tagName).toBe('A');
        expect(link.getAttribute('href')).toBe('/swarm/pipeline/8');
        expect(link.getAttribute('draggable')).toBe('false');
        // Read what the app did, then stop jsdom following the link itself.
        const seen = [];
        const record = (e) => { seen.push(e.defaultPrevented); e.preventDefault(); };
        window.addEventListener('click', record);
        for (const mod of ['metaKey', 'ctrlKey', 'shiftKey']) {
            const e = new MouseEvent('click', { bubbles: true, cancelable: true, [mod]: true });
            act(() => { link.dispatchEvent(e); });
        }
        window.removeEventListener('click', record);
        expect(seen).toEqual([false, false, false]);
        expect(navigations).toEqual([]);
        const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
        act(() => { link.dispatchEvent(plain); });
        expect(plain.defaultPrevented).toBe(true);
        expect(navigations).toEqual(['/swarm/pipeline/8']);
    });

    it('does not navigate when the card body is clicked', () => {
        mount();
        click(node('pipelines-card-info-7'));
        click(node('pipelines-card-title-7'));
        expect(navigations).toEqual([]);
    });
});

describe('PipelinesPage2 — dropping a card (req #3966)', () => {
    const cardOrder = () => [...document.body.querySelectorAll('[data-testid^="pipelines-card-"]')]
        .map((el) => el.getAttribute('data-testid'))
        .filter((id) => /^pipelines-card-\d+$/.test(id));

    // The drop handler runs inside dnd-kit's drop; anything the page awaits
    // first lands a render late, and the card flies back to its old slot.
    it('draws the new order in the render that ends the drag, while the write is in flight', () => {
        let settle;
        restRespond = (uri, method) => (method === 'PUT'
            ? new Promise((resolve) => { settle = resolve; }) : undefined);
        mount();
        expect(cardOrder()).toEqual(['pipelines-card-7', 'pipelines-card-8']);
        act(() => { dnd.onReorder(1, 0); });
        expect(cardOrder()).toEqual(['pipelines-card-8', 'pipelines-card-7']);
        const put = restCalls.find((c) => c.method === 'PUT');
        expect(put.body).toEqual([{ id: 8, sort_order: 0 }, { id: 7, sort_order: 1 }]);
        return act(async () => { settle({ httpStatus: { httpStatus: 200 }, data: [] }); });
    });

    it('holds the order until the write and its re-read settle, then draws what the read says', async () => {
        let settle;
        restRespond = (uri, method) => (method === 'PUT'
            ? new Promise((resolve) => { settle = resolve; }) : undefined);
        mount();
        act(() => { dnd.onReorder(1, 0); });
        // The stubbed read keeps returning the OLD positions — only the hold
        // can be drawing the new order here.
        await flush();
        expect(cardOrder()).toEqual(['pipelines-card-8', 'pipelines-card-7']);
        await act(async () => { settle({ httpStatus: { httpStatus: 200 }, data: [] }); });
        await flush();
        expect(cardOrder()).toEqual(['pipelines-card-7', 'pipelines-card-8']);
    });
});

describe('PipelinesPage2 — status filter', () => {
    it('shows both fixture pipelines by default (orchestrating + authoring)', () => {
        mount();
        expect(node('pipelines-card-7')).not.toBeNull();
        expect(node('pipelines-card-8')).not.toBeNull();
        // req #3964 — the page carries no accounting line.
        expect(node('pipelines-accounting')).toBeNull();
    });

    it('hides a pipeline when its status chip is toggled off', () => {
        mount();
        click(node('pipelines-status-chip-authoring'));
        expect(node('pipelines-card-8')).toBeNull();
        expect(node('pipelines-card-7')).not.toBeNull();
    });

    it('names the hidden statuses in the empty state when every chip is off', () => {
        mount();
        DEFAULT_PILLS.forEach((s) => click(node(`pipelines-status-chip-${s}`)));
        expect(node('pipelines-card-7')).toBeNull();
        expect(node('pipelines-cards-empty').textContent).toContain('Running (1)');
        expect(node('pipelines-cards-empty').textContent).toContain('Authoring (1)');
    });

    // req #3965 — the pills replaced the `closed` flag.
    it('offers all seven statuses, with the four non-terminal ones lit by default', () => {
        mount();
        const pressed = (s) => node(`pipelines-status-chip-${s}`).className.includes('MuiChip-outlined')
            ? 'off' : 'on';
        expect(['authoring', 'authorized', 'orchestration_ready', 'orchestrating', 'met', 'wontfix',
            'deferred'].map(pressed)).toEqual(['on', 'on', 'on', 'on', 'off', 'off', 'off']);
        expect(node('pipelines-status-chip-orchestration_ready').textContent).toBe('Ready');
        expect(node('pipelines-status-chip-wontfix').textContent).toBe("Won't Fix");
    });

    it('hides a finished plan by default and shows it when its pill is lit', () => {
        pipelines = [...pipelines, { id: 9, title: 'Plan Nine', pipeline_status: 'met', sort_order: 2 }];
        mount();
        expect(node('pipelines-card-9')).toBeNull();
        click(node('pipelines-status-chip-met'));
        expect(node('pipelines-card-9')).not.toBeNull();
    });

    it('falls back to the default when the stored filter names a retired status', () => {
        sessionStorage.setItem('darwin-swarm-pipelines-status-filter', JSON.stringify(['active', 'draft']));
        mount();
        expect(node('pipelines-card-7')).not.toBeNull();
        expect(node('pipelines-card-8')).not.toBeNull();
    });

    it('has no Closed chip any more (req #3965)', () => {
        mount();
        expect(node('pipelines-show-closed')).toBeNull();
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

describe('PipelinesPage2 — Pipeline group view (req #3972)', () => {
    const groupView = async (entry) => {
        mount(entry);
        await flush();
        return node('pipelines-group-view');
    };

    it('is a third view in the toggle and renders every shown plan', async () => {
        mount();
        expect(node('view-toggle-group')).not.toBeNull();
        click(node('view-toggle-group'));
        await flush();
        const view = node('pipelines-group-view');
        expect(view).not.toBeNull();
        expect(view.dataset.ids).toBe('7,8');
        expect(node('pipelines-cards-view')).toBeNull();
        expect(localStorage.getItem('darwin-swarm-pipelines-view')
            ?? sessionStorage.getItem('darwin-swarm-pipelines-view')).toContain('group');
    });

    it('opens from a ?view=group link and honours the page filters', async () => {
        sessionStorage.setItem('darwin-swarm-pipelines-status-filter', JSON.stringify(['orchestrating']));
        const view = await groupView('/swarm/pipelines?view=group');
        expect(view.dataset.ids).toBe('7');
    });

    it('reads the focused pipeline from ?focus= and writes it back on a focus change', async () => {
        const view = await groupView('/swarm/pipelines?view=group&focus=7');
        expect(view.dataset.focus).toBe('7');
        click(node('group-stub-focus-8'));
        expect(node('pipelines-group-view').dataset.focus).toBe('8');
        expect(node('location-probe').textContent).toBe('?view=group&focus=8');
        click(node('group-stub-clear'));
        expect(node('pipelines-group-view').dataset.focus).toBe('');
        expect(node('location-probe').textContent).toBe('?view=group');
    });

    // req #3965 — the focus panel's status editor writes through the page.
    it('writes a status the group view picks, through the page write path', async () => {
        await groupView('/swarm/pipelines?view=group');
        await act(async () => { node('group-stub-status-7').click(); });
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines',
            method: 'PUT',
            body: [{ id: 7, pipeline_status: 'deferred' }],
        }]);
    });

    it('ignores a ?focus= that is not a pipeline id', async () => {
        const view = await groupView('/swarm/pipelines?view=group&focus=abc');
        expect(view.dataset.focus).toBe('');
    });

    it('leaving the view drops ?focus=', async () => {
        await groupView('/swarm/pipelines?view=group&focus=7&keep=1');
        click(node('view-toggle-cards'));
        expect(node('pipelines-cards-view')).not.toBeNull();
        expect(node('location-probe').textContent).toBe('?keep=1');
    });

    it('opens a plan\'s visualizer from the focus panel', async () => {
        await groupView('/swarm/pipelines?view=group');
        click(node('group-stub-open-7'));
        expect(navigations).toHaveLength(1);
        expect(String(navigations[0])).toContain('7');
    });
});

describe('PipelinesPage2 — opening the visualizer, Table view (req #3463/#3372)', () => {
    // req #4170 — the Pipeline name is an in-place field, not a link: a click
    // in it edits and never navigates.
    it('does NOT navigate when the title field is clicked', () => {
        mount();
        switchToTable();
        expect(node('pipelines-open-title-7')).toBeNull();
        click(node('pipelines-title-7'));
        expect(navigations).toEqual([]);
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
        click(node('grid-row-7'));
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
        // The row click survives (req #4170 made the title a field, not a link).
    });

    // req #4170 — the removed columns are pinned absent, the Goal, Machine and
    // Started cells present.
    it('has no Initiative deps or Completed column, and shows Started in full', () => {
        mount();
        switchToTable();
        expect(node('cell-initiative_deps-7')).toBeNull();
        expect(node('cell-completed_at-7')).toBeNull();
        expect(node('pipelines-initiative-deps-7')).toBeNull();
        // Date, time to the second and the zone, in the reader's timezone.
        expect(node('cell-started_at-7').textContent).toMatch(/2026.*\d{1,2}:\d{2}:\d{2}/);
        expect(node('cell-started_at-8').textContent).toBe('—');
        expect(node('pipelines-goal-7')).not.toBeNull();
        expect(node('pipelines-machine-7')).not.toBeNull();
    });

    it('renames and re-words the goal in place with one-field PUTs', async () => {
        mount();
        switchToTable();
        const title = node('pipelines-title-7');
        act(() => { title.focus(); });
        type(title, 'Plan Seven Renamed');
        await act(async () => { title.blur(); });
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines', method: 'PUT',
            body: [{ id: 7, title: 'Plan Seven Renamed' }],
        }]);
        restCalls.length = 0;
        const goal = node('pipelines-goal-7');
        act(() => { goal.focus(); });
        type(goal, 'A new goal');
        await act(async () => { goal.blur(); });
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines', method: 'PUT',
            body: [{ id: 7, description: 'A new goal' }],
        }]);
    });

    it('shows a locked plan\'s title and goal read-only', () => {
        mount();
        switchToTable();
        expect(node('pipelines-title-8').disabled).toBe(true);
        expect(node('pipelines-goal-8').disabled).toBe(true);
        expect(node('pipelines-title-7').disabled).toBe(false);
    });

    it('sets the machine in place with a one-field PUT, and refuses it on a locked plan', async () => {
        mount();
        switchToTable();
        click(node('pipelines-machine-7'));
        await flush();
        click(node('pipelines-machine-option-7-any'));
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines',
            method: 'PUT',
            body: [{ id: 7, machine_fk: 'NULL' }],
        }]);
        restCalls.length = 0;
        click(node('pipelines-machine-8'));
        await flush();
        expect(node('pipelines-machine-option-8-any')).toBeNull();
        expect(restCalls).toEqual([]);
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

// req #3965 — the status chip is the plan's status EDITOR on both views.
describe('PipelinesPage2 status editor (Table view)', () => {
    it('opens a menu of all seven statuses and writes the one picked, without navigating', async () => {
        mount();
        switchToTable();
        const chip = node('pipelines-status-7');
        expect(chip.textContent).toBe('Running');
        click(chip);
        expect(navigations).toEqual([]);
        const options = [...document.body.querySelectorAll('[data-testid^="pipelines-status-7-option-"]')]
            .map((el) => el.getAttribute('data-testid').replace('pipelines-status-7-option-', ''));
        expect(options).toEqual(['authoring', 'authorized', 'orchestration_ready', 'orchestrating', 'met',
            'wontfix', 'deferred']);
        await act(async () => { node('pipelines-status-7-option-orchestration_ready').click(); });
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines',
            method: 'PUT',
            body: [{ id: 7, pipeline_status: 'orchestration_ready' }],
        }]);
        expect(navigations).toEqual([]);
    });

    it('still writes the status of a LOCKED plan (the gateway lock-free set)', async () => {
        mount();
        switchToTable();
        click(node('pipelines-status-8'));
        await act(async () => { node('pipelines-status-8-option-authorized').click(); });
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 8, pipeline_status: 'authorized' }]);
    });

    it('has no Closed column', () => {
        mount();
        switchToTable();
        expect(node('pipelines-closed-chip-7')).toBeNull();
    });
});

describe('PipelinesPage2 status (Cards view, req #4144 / #4153)', () => {
    const key = (el, k) => act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    });

    it('shows the status as the info box legend, closed until it is clicked', () => {
        mount();
        const status = node('pipelines-card-status-7');
        expect(status.textContent).toBe('Running');
        expect(node('pipelines-card-info-7').contains(status)).toBe(true);
        expect(status.getAttribute('role')).toBe('button');
        expect(status.getAttribute('aria-expanded')).toBe('false');
        expect(node('pipelines-card-status-7-menu')).toBeNull();
    });

    it('opens the seven statuses on a click and writes the one picked, without navigating', async () => {
        mount();
        const status = node('pipelines-card-status-7');
        click(status);
        expect(status.getAttribute('aria-expanded')).toBe('true');
        expect(navigations).toEqual([]);
        const options = [...document.body.querySelectorAll('[data-testid^="pipelines-card-status-7-option-"]')]
            .map((el) => el.getAttribute('data-testid').replace('pipelines-card-status-7-option-', ''));
        expect(options).toEqual(['authoring', 'authorized', 'orchestration_ready', 'orchestrating', 'met',
            'wontfix', 'deferred']);
        expect(node('pipelines-card-status-7-option-orchestrating').classList.contains('Mui-selected')).toBe(true);
        await act(async () => { node('pipelines-card-status-7-option-orchestration_ready').click(); });
        await flush();
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines',
            method: 'PUT',
            body: [{ id: 7, pipeline_status: 'orchestration_ready' }],
        }]);
        expect(navigations).toEqual([]);
    });

    it('opens from the keyboard too', () => {
        mount();
        key(node('pipelines-card-status-7'), 'Enter');
        expect(node('pipelines-card-status-7-option-met')).not.toBeNull();
    });

    it('opens on Space and stays open — the keyup does not pick the focused item', async () => {
        mount();
        const status = node('pipelines-card-status-7');
        key(status, ' ');
        expect(node('pipelines-card-status-7-menu')).toBeNull();
        act(() => { status.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })); });
        expect(node('pipelines-card-status-7-option-met')).not.toBeNull();
        await flush();
        expect(status.getAttribute('aria-expanded')).toBe('true');
        expect(restCalls).toEqual([]);
    });

    it('writes nothing when the current status is picked', async () => {
        mount();
        click(node('pipelines-card-status-7'));
        await act(async () => { node('pipelines-card-status-7-option-orchestrating').click(); });
        await flush();
        expect(restCalls).toEqual([]);
    });

    it('still writes the status of a LOCKED plan (the gateway lock-free set)', async () => {
        mount();
        click(node('pipelines-card-status-8'));
        await act(async () => { node('pipelines-card-status-8-option-authorized').click(); });
        await flush();
        expect(restCalls[0].body).toEqual([{ id: 8, pipeline_status: 'authorized' }]);
    });
});

// req #3965 — a new plan is born `authoring`; `closed` is gone, and the
// stamps are the gateway's to derive, so the body carries neither.
const POST_BODY_DEFAULTS = { pipeline_status: 'authoring', locked: 0 };

describe('PipelinesPage2 — create trial A: header button + dialog (req #3773)', () => {
    it('is in the header in both views', () => {
        mount();
        expect(node('pipelines-new-button')).not.toBeNull();
        switchToTable();
        expect(node('pipelines-new-button')).not.toBeNull();
    });

    it('creates an authoring plan from every field and opens it', async () => {
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
        DEFAULT_PILLS.forEach((s) => click(node(`pipelines-status-chip-${s}`)));
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

    it('lights the authoring status when it was filtered out, so the new card stays visible', async () => {
        mount();
        click(node('pipelines-status-chip-authoring'));
        click(node('pipelines-new-card-open'));
        type(node('pipelines-new-card-title'), 'Hidden?');
        await act(async () => { keyDown(node('pipelines-new-card-title'), 'Enter'); });
        await flush();
        expect(JSON.parse(sessionStorage.getItem('darwin-swarm-pipelines-status-filter')))
            .toContain('authoring');
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

    it('gives every card a drag grip — a finished plan included (req #3965)', () => {
        pipelines = [...pipelines, { id: 9, title: 'Plan Nine', pipeline_status: 'met', sort_order: 2 }];
        mount();
        click(node('pipelines-status-chip-met'));
        const grip = node('pipelines-card-grip-7');
        expect(grip.getAttribute('role')).toBe('button');
        expect(grip.getAttribute('aria-roledescription')).toBeNull();
        expect(node('pipelines-card-7').getAttribute('data-darwin-drag')).toBe('true');
        expect(node('pipelines-card-7').getAttribute('role')).toBeNull();
        expect(node('pipelines-card-grip-9').getAttribute('role')).toBe('button');
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

// req #3965 — the `closed` flag is gone: no Closed chip, no close/reopen in
// the card menu, nothing reads or writes `closed`.
describe('PipelinesPage2 — no closed flag (req #3965)', () => {
    it('offers no close or reopen action in the card menu', () => {
        mount();
        click(node('pipelines-card-menu-7'));
        expect(node('pipelines-card-menu-close-7')).toBeNull();
        expect(node('pipelines-card-menu-delete-7')).not.toBeNull();
    });

    it('does not ask the gateway for `closed`', () => {
        mount();
        const fields = pipelineReadOpts.fields.split(',');
        expect(fields).toContain('pipeline_status');
        expect(fields).not.toContain('closed');
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
        click(node('pipelines-status-chip-met'));
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

    // req #4144 — a goal that already fits has nothing to show more of.
    it('renders no Show more toggle when the goal fits', () => {
        goalOverflows = false;
        mount();
        expect(node('pipelines-card-description-7')).not.toBeNull();
        expect(node('pipelines-card-description-7-toggle')).toBeNull();
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
