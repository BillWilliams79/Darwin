// @vitest-environment jsdom
//
// Req #3140 — the Steps editor. `features` is deliberately STILL READ here
// (req #3357 code review): the engine's dominant-epic derivation (design rule
// 10, requirement -> feature -> epic) and the `?epic=<id>` filter (req #3373)
// both need it, and the latter is what the plan visualizer's already-shipped
// epic chip ↗ links to — dropping the read broke that live control. See
// `StepsPage.jsx`'s "`features` KEPT ALIVE" file-header note.
//
// The DataGrid is STUBBED (see the mock below) for EpicsPage.test.jsx's reason:
// jsdom gives every element a zero-size box, so the real grid virtualizes down to
// no cells and a suite built on it asserts against an empty table. The stub runs
// each column through the SAME contract the real grid uses — `valueGetter(value,
// row)` then `valueFormatter(value, row)` then `renderCell({row, value})`, v7
// argument order — so a column that mis-uses that signature still fails here.
//
// What IS pinned is the wiring this requirement is about:
//   - the Pipeline cell deep-links to the step in its plan table, which is the
//     "connects to the existing Step editor" clause
//   - design rule 1: the State chip is inert on a requirement-backed step and
//     stamps `completed_at` on a step that derives from nothing else
//   - design rule 4: delete refuses BEFORE clearing anything when another step
//     depends on this one, and the cascade order is deps, links, step
//   - create / edit send the right body to the right endpoint, `pipeline_fk` is
//     locked on edit, and the REST 'NULL' sentinel a JSON null cannot express
//   - the junction caches are invalidated after a delete, or the plan table draws
//     a gate pointing at a step that no longer exists

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigations = [];
// Spread the real module rather than replacing it: a narrow `{ useNavigate }`
// mock turns any future router import in the page into an undefined-export crash
// that says nothing about the actual failure.
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal()),
    useNavigate: () => (to) => navigations.push(to),
}));

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

let pipelines;
let steps;
let stepRequirements;
let stepDeps;
let requirements;
let features;
let epics;
let loading;
let errors;

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllPipelines: () => ({ data: pipelines, isLoading: loading.pipelines }),
        useAllPipelineSteps: () => ({ data: steps, isLoading: loading.steps }),
        useAllPipelineStepRequirements: () => ({ data: stepRequirements, isLoading: loading.links, isError: errors.links }),
        useAllPipelineStepDeps: () => ({ data: stepDeps, isLoading: loading.deps, isError: errors.deps }),
        useAllRequirements: () => ({ data: requirements, isLoading: loading.reqs, isError: errors.reqs }),
        useAllFeatures: () => ({ data: features, isLoading: loading.features, isError: errors.features }),
        useAllEpics: () => ({ data: epics, isLoading: loading.epics, isError: errors.epics }),
    };
});

const restCalls = [];
let restFail = null;
// Rows a GET answers with — the live pre-stamp re-read of a step's requirement
// links. `null` means "no rows", which is what Lambda-Rest expresses as a 404 and
// `fetchEntity` turns back into [].
let restGetRows = null;
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri, method, body });
        if (restFail && restFail(uri, method)) {
            // The shape call_rest_api THROWS for a gateway error — a bare object,
            // never an Error, which is why the page uses showError's two-arg form.
            // eslint-disable-next-line no-throw-literal
            return Promise.reject({ data: null, httpStatus: { httpStatus: 409, httpMessage: 'CONFLICT' } });
        }
        if (method === 'GET') {
            const rows = typeof restGetRows === 'function' ? restGetRows(uri) : restGetRows;
            if (rows == null) {
                // The real 404-on-zero-rows answer, which fetchEntity absorbs.
                // eslint-disable-next-line no-throw-literal
                return Promise.reject({ data: null, httpStatus: { httpStatus: 404, httpMessage: 'NOT FOUND' } });
            }
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: rows });
        }
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import StepsPage from '../StepsPage';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

let mountedRoots = [];
let queryClient;

// `initialEntries` defaults to a bare route — req #3373's `?epic=<id>` filter
// tests pass `['/swarm/steps?epic=<id>']`. `useSearchParams` needs a real
// Router in the tree, the same `EpicsPage.test.jsx` doctrine; `useNavigate`
// stays mocked above regardless.
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
                            <StepsPage />
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
const snackMessage = () => useSnackBarStore.getState().message;
const stepPuts = () => restCalls.filter(c => c.method === 'PUT'
    && c.uri.endsWith('/pipeline_steps'));

beforeEach(() => {
    navigations.length = 0;
    restCalls.length = 0;
    restFail = null;
    restGetRows = null;
    mountedRoots = [];
    loading = { pipelines: false, steps: false, links: false, deps: false, reqs: false, features: false, epics: false };
    errors = { features: false, epics: false, links: false, deps: false, reqs: false };
    pipelines = [
        { id: 2, title: 'Darwin', pipeline_status: 'active' },
        { id: 1, title: 'Substrate', pipeline_status: 'draft' },
    ];
    steps = [
        // Requirement-backed and RUNNING — the derived case design rule 1 protects.
        { id: 10, pipeline_fk: 2, title: 'Session Drain', run: 'auto', notes: 'Close every\nopen session.', completed_at: null },
        // Link-less and gated ON by step 10 — the delete-blocked case.
        { id: 11, pipeline_fk: 2, title: 'Green Baseline', run: 'manual', notes: null, completed_at: null },
        // In the other plan, requirement-backed and Complete — derived, so its
        // State chip must refuse a hand stamp even though it reads Complete.
        { id: 20, pipeline_fk: 1, title: 'Clone Canary', run: 'auto', notes: null, completed_at: null },
        // Link-less and ALREADY stamped — the only shape that can be reopened by
        // hand (design rule 1: no gating requirements, so its own column decides).
        { id: 21, pipeline_fk: 1, title: 'Manual Gate', run: 'auto', notes: null, completed_at: '2026-07-28 06:00:00' },
    ];
    stepRequirements = [
        { step_fk: 10, requirement_fk: 3050 },
        { step_fk: 20, requirement_fk: 3111 },
    ];
    stepDeps = [
        { id: 1, step_fk: 10, dep_step_fk: 11, time_at: null },
    ];
    requirements = [
        { id: 3050, title: 'Gateway', requirement_status: 'development', feature_fk: 100, tracking: 0 },
        { id: 3111, title: 'Schema', requirement_status: 'met', feature_fk: 101, tracking: 0 },
    ];
    features = [
        { id: 100, title: 'Substrate', epic_fk: 900 },
        { id: 101, title: 'Tables', epic_fk: 901 },
    ];
    epics = [
        { id: 900, title: 'Swarm Substrate' },
        { id: 901, title: 'Orchestration' },
    ];
    useSnackBarStore.setState({ open: false, message: '' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('StepsPage rows', () => {
    it('lists every step of every plan by default', () => {
        mount();
        expect(rowIds().sort((a, b) => a - b)).toEqual([10, 11, 20, 21]);
    });

    it('renders the state the ENGINE derived, not the completed_at column', () => {
        mount();
        expect(node('step-state-chip-10').textContent).toBe('Running');
        expect(node('step-state-chip-11').textContent).toBe('Scheduled');
        // Step 20 has a NULL completed_at and still reads Complete, because its
        // one requirement is met — the derivation, not the column.
        expect(node('step-state-chip-20').textContent).toBe('Complete');
        expect(node('step-state-chip-21').textContent).toBe('Complete');
    });

    it('marks what the State chip CLICK will do — three outcomes, three values', () => {
        mount();
        // Requirement-backed: the click writes nothing.
        expect(node('step-state-chip-10').getAttribute('data-guard')).toBe('derived');
        expect(node('step-state-chip-20').getAttribute('data-guard')).toBe('derived');
        // Derives from its own column and is unstamped: the click completes it.
        expect(node('step-state-chip-11').getAttribute('data-guard')).toBe('editable');
        // Already stamped: the click REOPENS. Not `editable`, because that value
        // has to keep meaning "this click completes", and not `derived`, because
        // that has to keep meaning "this click writes nothing".
        expect(node('step-state-chip-21').getAttribute('data-guard')).toBe('reopen');
    });

    it('resolves the epic label through requirement -> feature -> epic', () => {
        mount();
        expect(node('cell-epic-10').textContent).toBe('Swarm Substrate');
        expect(node('cell-epic-20').textContent).toBe('Orchestration');
        // Step 11 links no requirement and inherits nothing (it depends on
        // nothing), so it genuinely has no epic.
        expect(node('cell-epic-11').textContent).toBe('—');
    });

    it('counts requirements and gate rows', () => {
        mount();
        expect(node('step-req-count-10').textContent).toBe('1');
        expect(node('step-req-count-11').textContent).toBe('0');
        expect(node('step-gate-count-10').textContent).toBe('1');
        expect(node('step-gate-count-11').textContent).toBe('0');
    });

    it('collapses multi-line notes to one line', () => {
        mount();
        expect(node('cell-notes-10').textContent).toBe('Close every open session.');
        expect(node('cell-notes-11').textContent).toBe('—');
    });

    it('reports the whole plan in the accounting line, and the filter beside it', () => {
        mount();
        expect(node('steps-accounting').textContent).toContain('4 of 4 steps');
        expect(node('steps-accounting').textContent).toContain('2 complete');
        expect(node('steps-accounting').textContent).toContain('1 running');
        expect(node('steps-accounting').textContent).toContain('1 scheduled');
    });

    it('narrows to one derived state, and to nothing when every chip is off', () => {
        mount();
        click(node('steps-state-chip-running'));   // null -> all-but-running
        expect(rowIds().sort((a, b) => a - b)).toEqual([11, 20, 21]);
        click(node('steps-state-chip-done'));
        click(node('steps-state-chip-pending'));
        expect(rowIds()).toEqual([]);
        expect(node('steps-accounting').textContent).toContain('0 of 4');
    });

    // Every read feeds a number or a label. Painting off the steps read alone
    // shows every State chip as Scheduled — a claim about the plan, not about the
    // fetch — and lets a delete be confirmed without its consequence clause.
    it('holds the grid until the requirement read lands, not just the steps one', () => {
        loading = { ...loading, reqs: true };
        mount();
        expect(node('steps-datagrid')).toBeNull();
    });

    it('says the Epic column is blank because a read FAILED, not because there is no epic', () => {
        errors = { ...errors, features: true };
        mount();
        expect(node('steps-dictionary-error')).not.toBeNull();
    });

    it('reports a step it cannot place rather than dropping it silently', () => {
        steps = [...steps, { id: 99, pipeline_fk: null, title: 'Orphan', run: 'auto' }];
        mount();
        expect(node('steps-unrendered-warning').textContent).toContain('99');
        expect(rowIds()).not.toContain(99);
    });
});

// req #3373 — the plan visualizer's epic chip ↗ control re-points at
// `/swarm/steps?epic=<id>`, and THIS is the filter it now lands on: it did
// not exist before this requirement (StepsPage filtered by pipeline only).
// req #3357 code review — `features` stays live here specifically so this
// already-shipped filter keeps working; see StepsPage.jsx's file header.
describe('StepsPage — ?epic=<id> filter (req #3373)', () => {
    it('narrows to the steps whose dominant epic matches the param', () => {
        mount(['/swarm/steps?epic=900']);
        // Step 10 -> requirement 3050 -> feature 100 -> epic 900. Steps 11, 20,
        // 21 either carry no requirement or resolve to epic 901.
        expect(rowIds()).toEqual([10]);
    });

    it('renders a dismissable chip naming the epic by title', () => {
        mount(['/swarm/steps?epic=900']);
        expect(node('steps-epic-filter-chip').textContent).toContain('Swarm Substrate');
    });

    it('clearing the chip restores every plan\'s steps', () => {
        mount(['/swarm/steps?epic=900']);
        expect(rowIds()).toEqual([10]);
        // MUI's Chip renders the delete affordance as a child SVG, and jsdom's
        // SVGElement has no `.click()` — dispatch the event `onDelete` listens
        // for directly, the same outcome a real pointer click produces.
        act(() => {
            node('steps-epic-filter-chip').querySelector('svg')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(node('steps-epic-filter-chip')).toBeNull();
        expect(rowIds().sort((a, b) => a - b)).toEqual([10, 11, 20, 21]);
    });

    it('ignores a non-integer param rather than filtering everything out', () => {
        mount(['/swarm/steps?epic=abc']);
        expect(node('steps-epic-filter-chip')).toBeNull();
        expect(rowIds().sort((a, b) => a - b)).toEqual([10, 11, 20, 21]);
    });

    it('narrows to a different epic independently — this is a real filter, not a fixed id', () => {
        mount(['/swarm/steps?epic=901']);
        // Epic 901 is step 20's (requirement 3111 -> feature 101 -> epic 901),
        // in the OTHER plan from the epic-900 case above.
        expect(rowIds()).toEqual([20]);
    });
});

describe('StepsPage — connects to the existing step surface', () => {
    it('deep-links the Pipeline cell to this step in its plan table', () => {
        mount();
        click(node('step-plan-link-10'));
        expect(navigations).toEqual(['/swarm/pipeline/2?mode=table&step=10']);
    });

    it('labels the cell with the plan title', () => {
        mount();
        expect(node('step-plan-link-10').textContent).toBe('Darwin');
        expect(node('step-plan-link-20').textContent).toBe('Substrate');
    });

    it('still links, labelled by id, when the pipelines read did not resolve the plan', () => {
        // The id is known and the ROUTE is valid — it is the read that failed. The
        // plan page reports a missing pipeline far better than a dead chip here
        // could, so the link stands.
        pipelines = [];
        mount();
        expect(node('step-plan-link-10').textContent).toBe('#2');
        click(node('step-plan-link-10'));
        expect(navigations).toEqual(['/swarm/pipeline/2?mode=table&step=10']);
    });
});

describe('StepsPage — design rule 1 (completed_at)', () => {
    it('stamps a step that derives from nothing else', async () => {
        mount();
        click(node('step-state-chip-11'));
        await flush();
        const put = stepPuts()[0];
        expect(put.body[0].id).toBe(11);
        // UTC MySQL naive form — never the ISO 'T' form, which dateFormat reads
        // as LOCAL and would render offset-shifted everywhere it appears.
        expect(put.body[0].completed_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('reopens a hand-stamped step', async () => {
        mount();
        click(node('step-state-chip-21'));
        await flush();
        expect(stepPuts()[0].body[0]).toEqual({ id: 21, completed_at: 'NULL' });
    });

    it('writes NOTHING for a requirement-backed step, and says why', async () => {
        mount();
        click(node('step-state-chip-10'));
        await flush();
        expect(stepPuts()).toEqual([]);
        expect(snackMessage()).toContain('3050');
    });

    it('refuses a derived step even when it reads Complete', async () => {
        // Step 20 is Complete because its requirement is met. Stamping it would
        // put a stored answer beside a derived one that can still change.
        mount();
        click(node('step-state-chip-20'));
        await flush();
        expect(stepPuts()).toEqual([]);
        expect(snackMessage()).toContain('3111');
    });

    it('does not open with "Complete" on a stamp its requirements contradict', async () => {
        // A stamped step whose requirement is still in development renders
        // "Running" (derived, correct). This page is where someone would come to
        // clean that up, so the explanation must not read as though the chip
        // agreed with the column.
        steps = steps.map(s => (s.id === 10 ? { ...s, completed_at: '2026-07-28 06:00:00' } : s));
        mount();
        expect(node('step-state-chip-10').textContent).toBe('Running');
        expect(node('step-state-chip-10').getAttribute('data-guard')).toBe('reopen');
        const why = node('step-state-chip-10').getAttribute('aria-label');
        // The verb agrees — the singular is the common case for a contradicted
        // stamp, so "requirement 3050 contradict it" would be the wording most
        // readers actually saw.
        expect(why).toContain('requirement 3050 contradicts it');
        expect(why.startsWith('Complete')).toBe(false);
        // The action is still right: the click clears the dead stamp.
        click(node('step-state-chip-10'));
        await flush();
        expect(stepPuts()[0].body[0]).toEqual({ id: 10, completed_at: 'NULL' });
    });

    it('pluralizes the contradiction for several requirements', () => {
        steps = steps.map(s => (s.id === 10 ? { ...s, completed_at: '2026-07-28 06:00:00' } : s));
        stepRequirements = [...stepRequirements, { step_fk: 10, requirement_fk: 3111 }];
        mount();
        expect(node('step-state-chip-10').getAttribute('aria-label'))
            .toContain('requirements 3050, 3111 contradict it');
    });

    it('opens with "Complete" on an ordinary hand-stamped step', () => {
        mount();
        expect(node('step-state-chip-21').getAttribute('aria-label').startsWith('Complete'))
            .toBe(true);
    });

    it('re-reads the step LIVE before stamping, because the cache is 30s stale', async () => {
        mount();
        click(node('step-state-chip-11'));
        await flush();
        const get = restCalls.find(c => c.method === 'GET');
        expect(get.uri).toBe('http://test.local/darwin/pipeline_step_requirements?step_fk=11');
        // The GET precedes the PUT — a check after the write protects nothing.
        expect(restCalls.indexOf(get)).toBeLessThan(
            restCalls.findIndex(c => c.method === 'PUT'));
    });

    it('refuses when the LIVE read shows a requirement the cache had not seen yet', async () => {
        // The Primary AI links a requirement onto a manual step while this page is
        // open. The grid still says zero links; the write path must not.
        restGetRows = () => [{ step_fk: 11, requirement_fk: 3050 }];
        mount();
        click(node('step-state-chip-11'));
        await flush();
        expect(stepPuts()).toEqual([]);
        expect(snackMessage()).toContain('3050');
    });

    it('still allows the stamp when the live read returns only a TRACKING container', async () => {
        requirements = [...requirements,
            { id: 3083, title: 'Tracker', requirement_status: 'development', feature_fk: 100, tracking: 1 }];
        restGetRows = () => [{ step_fk: 11, requirement_fk: 3083 }];
        mount();
        click(node('step-state-chip-11'));
        await flush();
        expect(stepPuts()[0].body[0].id).toBe(11);
    });

    it('refuses when the live read FAILS — "cannot check" is not "nothing to check"', async () => {
        restFail = (uri, method) => method === 'GET';
        mount();
        click(node('step-state-chip-11'));
        await flush();
        expect(stepPuts()).toEqual([]);
        expect(snackMessage()).toContain('Could not verify');
    });

    it('reopens WITHOUT a live read — clearing a stamp needs no permission', async () => {
        mount();
        click(node('step-state-chip-21'));
        await flush();
        expect(restCalls.filter(c => c.method === 'GET')).toEqual([]);
        expect(stepPuts()[0].body[0]).toEqual({ id: 21, completed_at: 'NULL' });
    });

    it('re-reads the TRACKING FLAG of anything the cache wants to exempt', async () => {
        // Live ids with cached flags is still half a cached guard: a requirement
        // cached as a container that has since been corrected to work would drop
        // out of the gating set and let the stamp through.
        requirements = [...requirements,
            { id: 3083, title: 'Was a tracker', requirement_status: 'development', feature_fk: 100, tracking: 1 }];
        restGetRows = (uri) => (uri.includes('pipeline_step_requirements')
            ? [{ step_fk: 11, requirement_fk: 3083 }]
            // The server's current truth: it is WORK now.
            : [{ id: 3083, tracking: 0 }]);
        mount();
        click(node('step-state-chip-11'));
        await flush();
        expect(restCalls.some(c => c.uri.includes('requirements?id=3083'))).toBe(true);
        expect(stepPuts()).toEqual([]);
        expect(snackMessage()).toContain('3083');
    });

    it('GATES an exemption the re-read could not confirm', async () => {
        // A 404 on the tracking re-read means NOT CONFIRMED, not "nothing to
        // check". Letting the merge fall back to a cached `tracking: 1` would be a
        // failed verification producing a write — the one outcome the live re-read
        // exists to prevent. (Unreachable in production because
        // `fk_psr_requirement` is ON DELETE RESTRICT, which is a fact about the
        // schema, not about this code.)
        requirements = [...requirements,
            { id: 3083, title: 'Cached as a container', requirement_status: 'development', feature_fk: 100, tracking: 1 }];
        restGetRows = (uri) => (uri.includes('pipeline_step_requirements')
            ? [{ step_fk: 11, requirement_fk: 3083 }]
            : null);   // 404 — the row was not returned
        mount();
        click(node('step-state-chip-11'));
        await flush();
        expect(stepPuts()).toEqual([]);
        expect(snackMessage()).toContain('3083');
    });

    it('re-reads nothing extra when the cache exempts nothing', async () => {
        restGetRows = () => [{ step_fk: 11, requirement_fk: 3050 }];
        mount();
        click(node('step-state-chip-11'));
        await flush();
        // 3050 is work in the cache, so it gates without a second look.
        expect(restCalls.filter(c => c.method === 'GET')).toHaveLength(1);
    });

    it('issues ONE completion per step however many times the chip is clicked', async () => {
        // toggleComplete is a read then a write, so a double-click would otherwise
        // start a second round trip while the first is still deciding.
        mount();
        click(node('step-state-chip-11'));
        click(node('step-state-chip-11'));
        await flush();
        expect(restCalls.filter(c => c.method === 'GET')).toHaveLength(1);
        expect(stepPuts()).toHaveLength(1);
    });
});

describe('StepsPage — a FAILED read is not an empty one', () => {
    it('blocks completion and says so when the requirement links did not load', async () => {
        // Without this the `= []` default reports zero gating requirements for
        // every step, the guard reads `editable`, and one click stamps
        // completed_at on a requirement-backed step of a live plan.
        errors = { ...errors, links: true };
        mount();
        expect(node('steps-plan-data-error')).not.toBeNull();
        expect(node('step-state-chip-10').getAttribute('data-guard')).toBe('derived');
        click(node('step-state-chip-10'));
        await flush();
        expect(stepPuts()).toEqual([]);
        expect(restCalls.filter(c => c.method === 'GET')).toEqual([]);
    });

    it('raises the same banner when the requirements list itself failed', () => {
        errors = { ...errors, reqs: true };
        mount();
        expect(node('steps-plan-data-error')).not.toBeNull();
    });

    it('names WHICH read failed rather than always blaming the links', async () => {
        // One boolean is right for deciding whether to block, but spending it as
        // though it were always the links read makes the page state a falsehood
        // about the other two.
        errors = { ...errors, reqs: true };
        mount();
        expect(node('steps-plan-data-error').textContent).toContain('requirement list');
        expect(node('steps-plan-data-error').textContent).not.toContain('requirement links');
        click(node('step-state-chip-10'));
        await flush();
        expect(snackMessage()).toContain('requirement list');
    });

    it('joins several failed reads into one honest list', () => {
        errors = { ...errors, links: true, deps: true };
        mount();
        expect(node('steps-plan-data-error').textContent)
            .toContain('requirement links and dependency rows');
    });

    it('still REOPENS a stamped step, and says so, while completion is blocked', async () => {
        // Clearing a stamp never depends on knowing the link set, so blocking it
        // would be a rule the data does not require — but the marker and tooltip
        // must then not claim the click is disabled.
        errors = { ...errors, links: true };
        mount();
        expect(node('step-state-chip-21').getAttribute('data-guard')).toBe('reopen');
        click(node('step-state-chip-21'));
        await flush();
        expect(stepPuts()[0].body[0]).toEqual({ id: 21, completed_at: 'NULL' });
    });

    it('does not state a consequence it could not compute in the delete confirmation', async () => {
        errors = { ...errors, deps: true };
        mount();
        click(node('step-delete-10'));
        await flush();
        expect(window.confirm.mock.calls[0][0]).toContain('could not be read');
        expect(window.confirm.mock.calls[0][0]).toContain('dependency rows');
    });

    it('leaves title / notes / run edits alone — they depend on none of it', async () => {
        errors = { ...errors, links: true };
        mount();
        click(node('step-run-chip-10'));
        await flush();
        expect(stepPuts()[0].body[0]).toEqual({ id: 10, run: 'manual' });
    });
});

describe('StepsPage — design rule 4 (delete)', () => {
    it('refuses BEFORE clearing anything when another step depends on this one', async () => {
        mount();
        click(node('step-delete-11'));
        await flush();
        // Not one statement issued — reaching MySQL's RESTRICT on the third would
        // leave step 11 alive, stripped of its links and completely UN-GATED.
        expect(restCalls.filter(c => c.method === 'DELETE')).toEqual([]);
        expect(snackMessage()).toContain('10');
        expect(window.confirm).not.toHaveBeenCalled();
    });

    it('marks which rows the delete will refuse', () => {
        mount();
        expect(node('step-delete-11').getAttribute('data-blocked')).toBe('yes');
        expect(node('step-delete-10').getAttribute('data-blocked')).toBe('no');
    });

    it('makes the verb agree, so a single blocker does not read as a bug', async () => {
        mount();
        click(node('step-delete-11'));
        await flush();
        expect(snackMessage()).toContain('step 10 depends on it');
    });

    it('says a self-dependency outright rather than naming the step twice', async () => {
        // dropBlockers counts a self-dep because InnoDB does. "step 11 depend on
        // it" for a step blocking itself reads as a rendering fault.
        stepDeps = [{ id: 1, step_fk: 11, dep_step_fk: 11, time_at: null }];
        mount();
        click(node('step-delete-11'));
        await flush();
        expect(snackMessage()).toContain('it depends on itself');
        expect(restCalls.filter(c => c.method === 'DELETE')).toEqual([]);
    });

    it('pluralizes correctly for several blockers', async () => {
        stepDeps = [
            { id: 1, step_fk: 10, dep_step_fk: 11, time_at: null },
            { id: 2, step_fk: 20, dep_step_fk: 11, time_at: null },
        ];
        mount();
        click(node('step-delete-11'));
        await flush();
        expect(snackMessage()).toContain('steps 10, 20 depend on it');
    });

    it('deletes with ONE statement and lets the database cascade the children', async () => {
        // Three statements from a browser is strictly worse than one: every
        // intermediate failure leaves the step alive and UN-GATED, which the
        // orchestration engine reads as eligible-immediately. The links and the
        // step's own dep rows CASCADE; `dep_step_fk` RESTRICTs. So the worst case
        // is a clean 409 with the plan untouched.
        mount();
        click(node('step-delete-10'));
        await flush();
        expect(restCalls.filter(c => c.method === 'DELETE').map(c => [c.uri, c.body])).toEqual([
            ['http://test.local/darwin/pipeline_steps', { id: 10 }],
        ]);
    });

    it('is the same single statement for a step with no junction rows', async () => {
        mount();
        click(node('step-delete-21'));
        await flush();
        expect(restCalls.filter(c => c.method === 'DELETE').map(c => c.uri))
            .toEqual(['http://test.local/darwin/pipeline_steps']);
    });

    it('names the consequence in the confirmation', async () => {
        mount();
        click(node('step-delete-10'));
        await flush();
        expect(window.confirm.mock.calls[0][0]).toContain('1 requirement link and 1 dependency row');
    });

    it('does nothing when the confirmation is declined', async () => {
        window.confirm.mockReturnValue(false);
        mount();
        click(node('step-delete-10'));
        await flush();
        expect(restCalls.filter(c => c.method === 'DELETE')).toEqual([]);
    });

    it('invalidates BOTH junction caches, not just the steps one', async () => {
        mount();
        click(node('step-delete-10'));
        await flush();
        const keys = queryClient.invalidateQueries.mock.calls.map(c => c[0].queryKey[0]);
        // Without these the plan table keeps drawing a gate pointing at a step
        // that no longer exists, which verifyOrder reports as a loud, wrong
        // `dangling-dependency`.
        expect(keys).toContain('pipeline_steps');
        expect(keys).toContain('pipeline_step_requirements');
        expect(keys).toContain('pipeline_step_deps');
    });
});

describe('StepsPage — create and edit', () => {
    it('creates a step in the selected plan with a real null for empty notes', async () => {
        mount();
        click(node('step-add'));
        type(node('step-title-input'), 'New Gate');
        click(node('step-save'));
        await flush();
        const post = restCalls.find(c => c.method === 'POST');
        expect(post.uri).toBe('http://test.local/darwin/pipeline_steps');
        // POST takes a real null; the 'NULL' string is a PUT-only sentinel and
        // would be stored as the literal text.
        expect(post.body).toEqual({
            pipeline_fk: 2, title: 'New Gate', run: 'auto', notes: null, completed_at: null,
        });
    });

    it('never sets completed_at on a new step — a step is born incomplete', async () => {
        mount();
        click(node('step-add'));
        type(node('step-title-input'), 'New Gate');
        click(node('step-save'));
        await flush();
        expect(restCalls.find(c => c.method === 'POST').body.completed_at).toBeNull();
    });

    it('sends the REST NULL sentinel when an edit clears the notes', async () => {
        mount();
        click(node('step-edit-10'));
        type(node('step-notes-input'), '');
        click(node('step-save'));
        await flush();
        expect(stepPuts()[0].body[0]).toEqual({
            id: 10, title: 'Session Drain', notes: 'NULL', run: 'auto',
        });
    });

    it('never sends pipeline_fk on an edit — plan membership is identity', async () => {
        mount();
        click(node('step-edit-10'));
        click(node('step-save'));
        await flush();
        expect(stepPuts()[0].body[0]).not.toHaveProperty('pipeline_fk');
    });

    it('refuses an empty title rather than sending a 1406 to MySQL', async () => {
        mount();
        click(node('step-edit-10'));
        type(node('step-title-input'), '   ');
        expect(node('step-save').disabled).toBe(true);
    });

    it('refuses the literal string NULL as a title rather than shipping a 1048', async () => {
        // rest_post and rest_put BOTH substitute SQL NULL for this exact string,
        // and `title` is NOT NULL — so it reaches the user as an opaque 500.
        mount();
        click(node('step-add'));
        type(node('step-title-input'), 'NULL');
        click(node('step-save'));
        await flush();
        expect(restCalls.filter(c => c.method === 'POST')).toEqual([]);
        expect(snackMessage()).toContain('sentinel');
    });

    it('allows a title that merely resembles the sentinel', async () => {
        mount();
        click(node('step-add'));
        type(node('step-title-input'), 'Null check');
        click(node('step-save'));
        await flush();
        expect(restCalls.find(c => c.method === 'POST').body.title).toBe('Null check');
    });

    it('reports a gateway failure with its status rather than swallowing it', async () => {
        restFail = (uri, method) => method === 'POST';
        mount();
        click(node('step-add'));
        type(node('step-title-input'), 'New Gate');
        click(node('step-save'));
        await flush();
        expect(snackMessage()).toContain('Could not create step');
    });
});

describe('StepsPage — run mode', () => {
    it('toggles auto to manual and back', async () => {
        mount();
        click(node('step-run-chip-10'));
        await flush();
        expect(stepPuts()[0].body[0]).toEqual({ id: 10, run: 'manual' });
        restCalls.length = 0;
        click(node('step-run-chip-11'));
        await flush();
        expect(stepPuts()[0].body[0]).toEqual({ id: 11, run: 'auto' });
    });
});
