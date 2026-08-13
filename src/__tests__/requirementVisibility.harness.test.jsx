// @vitest-environment jsdom
//
// ── THE requirement-visibility harness ───────────────────────────────────────
// req #3419, narrowed by req #3357, WIDENED TO EVERY STATUS AND EVERY SURFACE
// by req #3502.
//
// The requirement that produced this file asked for one thing above all: *"if
// there is only one place to calculate the query for this button then it will
// always work... otherwise you have a single test harness that can test all
// implementations with excellent test coverage."*
//
// WHY IT EXISTS. The orchestrated toggle was busted twice. The second time, the
// suite was GREEN — because every test that touched the rule MOCKED THE HOOK
// THAT ANSWERS IT (`usePipelinedRequirementIds: () => pipelinedIds`). Those
// tests proved that a component filters by whatever Set it is handed. They could
// not, and did not, prove that the Set is the right Set. The defect lived in the
// half nobody mounted.
//
// So this file mocks EXACTLY ONE THING: `call_rest_api`, the HTTP transport.
// Everything above it is real — `createEntityQueries`, `useDataQueries`,
// `useRequirementVisibility`, `pipelineMembership`, `epicMembership`,
// `processSort`, and the surfaces themselves. One fixture goes in at the wire;
// independently written renderers come out; they are asserted to AGREE. A rule
// that is computed in one place cannot fail that assertion, and a rule that
// quietly grows a second copy will.
//
// ── WHAT req #3502 ADDED, AND WHY IT HAD TO ─────────────────────────────────
//
// It was busted a THIRD time, and this harness passed the whole way through —
// because it asserted the defect. The aggregator card kept a SECOND rule
// underneath the shared one (`aggregatorRowVisible`'s unconditional launch
// exclusion, req #3180): step-carried work was dropped from the
// `authoring`/`approved`/`swarm_ready` chips with no toggle. Measured on
// production, 18 `authoring` requirements were step-carried; asked to SHOW
// orchestrated work, the Cards view, the Table view and the elevator showed them
// and the aggregator did not. The old harness had a case literally named
// *"withholds step-carried work from a launch chip even with the toggle OFF"*.
//
// Two structural changes follow from that, and they are the reason this file is
// shaped the way it is now:
//
//   1. THE FIXTURE COVERS EVERY STATUS — all seven, each with one orchestrated
//      row and one plain one. The old fixture was five `authoring` rows and one
//      `development`, so "does the rule depend on status?" could not be asked,
//      and status is exactly what the second rule keyed on.
//
//   2. AGREEMENT IS ASSERTED WITHOUT AN EXEMPTION LIST. The old cross-surface
//      case compared the surfaces only among rows *"the launch rule removes"*
//      had already been subtracted from — so it agreed by construction and could
//      not see the disagreement. Now every surface is compared over the same
//      population, per status, in both toggle states.
//
// A test that encodes the defect it was written to prevent is worse than no
// test: it makes the bug look like a decision. If a future change withholds work
// on one surface and not another, this file must go red.
//
// ── THE EPIC FILTER (req #3428, containment since #3356) ────────────────────
//
// "This should also not break any filters applied from the pipeline views" is
// part of the same requirement, so the epic scope is exercised here too, through
// the REAL `useEpicRequirementIds` derivation (steps -> junction -> requirement
// ids), not a hand-made Set. It forces the toggle OFF and narrows rows AND chip
// badges from one Set.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({
    useNavigate: () => () => {},
    useLocation: () => ({ state: null, pathname: '/swarm', search: '' }),
    Link: ({ children }) => <span>{children}</span>,
}));

// ── THE FIXTURE ──────────────────────────────────────────────────────────────
//
// Every requirement status, twice: one row a pipeline step carries and one row
// nothing carries. Ids are readable on sight — the tens digit is the status, the
// units digit says orchestrated (1) or plain (0).
//
//   100/101  authoring     110/111  approved      120/121  swarm_ready
//   130/131  development   140/141  met           150/151  deferred
//   160/161  wontfix
//
// The orchestrated rows are split across TWO steps under TWO epics, so the epic
// section below filters to a real subset rather than to "everything orchestrated".
const CATEGORY_ID = 5;
const EPIC_A = 7;
const EPIC_B = 8;

// Met rows need a `completed_at` inside the aggregator's trailing-24h window.
// One hour ago, stamped once at module load: `computeMetWindow` quantizes `now`
// DOWN to the minute, so an hour of margin cannot land outside the window
// however long the suite runs.
const RECENT = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19);

const row = (id, status, extra = {}) => ({
    id,
    title: `Requirement ${id}`,
    requirement_status: status,
    category_fk: CATEGORY_ID,
    sort_order: id,
    coordination_type: 'implemented',
    ai_model: 'opus',
    effort: 'high',
    machine_fk: null,
    started_at: null,
    completed_at: null,
    deferred_at: null,
    ...extra,
});

export const ALL_STATUSES = [
    'authoring', 'approved', 'swarm_ready', 'development', 'met', 'deferred', 'wontfix',
];

const ROWS = [
    row(100, 'authoring'),
    row(101, 'authoring'),
    row(110, 'approved'),
    row(111, 'approved'),
    row(120, 'swarm_ready'),
    row(121, 'swarm_ready'),
    row(130, 'development', { started_at: '2026-08-01T00:00:00' }),
    row(131, 'development', { started_at: '2026-08-01T00:00:00' }),
    row(140, 'met', { completed_at: RECENT }),
    row(141, 'met', { completed_at: RECENT }),
    row(150, 'deferred', { deferred_at: '2026-08-01T00:00:00' }),
    row(151, 'deferred', { deferred_at: '2026-08-01T00:00:00' }),
    row(160, 'wontfix', { completed_at: '2026-08-01T00:00:00' }),
    row(161, 'wontfix', { completed_at: '2026-08-01T00:00:00' }),
];

// Step 1 sits under epic A, step 2 under epic B — `pipeline_steps.epic_fk` is
// NOT NULL under containment, so this is the real shape.
const STEPS = [
    { id: 1, epic_fk: EPIC_A },
    { id: 2, epic_fk: EPIC_B },
];
const JUNCTION = [
    { step_fk: 1, requirement_fk: 101 },
    { step_fk: 1, requirement_fk: 111 },
    { step_fk: 1, requirement_fk: 121 },
    { step_fk: 1, requirement_fk: 131 },
    { step_fk: 2, requirement_fk: 141 },
    { step_fk: 2, requirement_fk: 151 },
    { step_fk: 2, requirement_fk: 161 },
];
const CATEGORIES = [{ id: CATEGORY_ID, category_name: 'Harness', project_fk: 1, color: null, sort_mode: 'process' }];

// The answers, stated once, independently of any component.
const ORCHESTRATED = [101, 111, 121, 131, 141, 151, 161];
const PLAIN = [100, 110, 120, 130, 140, 150, 160];
const EPIC_A_REQS = [101, 111, 121, 131];

// The aggregator's chip vocabulary (SWARM_START_STATUSES) — deferred and wontfix
// have never been chips there.
const CHIPS = ['authoring', 'approved', 'swarm_ready', 'development', 'met'];

const idsWithStatus = (status) => ROWS.filter(r => r.requirement_status === status).map(r => r.id);

// ── the ONE mock: the wire ───────────────────────────────────────────────────
//
// Routed on the real URLs the real hooks build, so a hook that changes its
// query string fails here loudly instead of silently receiving `[]` — which is
// what `fetchEntity` turns a 404 into, and is exactly the shape of "nothing is
// orchestrated, hide nothing".
const restCalls = [];
const serve = (uri) => {
    const [path, query = ''] = uri.split('?');
    const table = path.split('/').pop();
    const params = new URLSearchParams(query);

    if (table === 'requirements') {
        if (params.has('category_fk')) {
            return ROWS.filter(r => String(r.category_fk) === params.get('category_fk'));
        }
        if (params.has('filter_ts')) {
            // The aggregator's trailing-24h Met read. Answered like the server
            // does — by the window, not by "it asked for met, here is met" —
            // so a card that widened its window would be visible here.
            const m = params.get('filter_ts').match(/^\(completed_at,([^,]+),([^)]+)\)$/);
            const [, start, end] = m || [];
            return ROWS.filter(r => r.requirement_status === 'met'
                && r.completed_at && r.completed_at >= start && r.completed_at <= end);
        }
        if (params.has('requirement_status')) {
            return ROWS.filter(r => r.requirement_status === params.get('requirement_status'));
        }
        return ROWS;
    }
    if (table === 'pipeline_step_requirements') return JUNCTION;
    if (table === 'pipeline_steps') return STEPS;
    if (table === 'categories') return CATEGORIES;
    return [];
};

vi.mock('../RestApi/RestApi', () => ({
    default: vi.fn((uri, method) => {
        if (method !== 'GET') {
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
        }
        restCalls.push(uri);
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: serve(uri) });
    }),
}));

import CategoryCard from '../SwarmView/CategoryCard';
import RequirementsTableView from '../SwarmView/RequirementsTableView';
import SwarmStartCard from '../TaskPlanView/SwarmStartCard';
import { useRequirementVisibility } from '../hooks/useRequirementVisibility';
import { useEpicRequirementIds } from '../hooks/useDataQueries';
import { siblingElevator } from '../SwarmView/detail/requirementSort';
import { orchestratedRequirementIds } from '../utils/pipelineMembership';
import { epicRequirementIds } from '../utils/epicMembership';
import { useShowClosedStore, ALL_REQUIREMENT_STATUSES } from '../stores/useShowClosedStore';
import { useSwarmStartCardStore } from '../stores/useSwarmStartCardStore';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';

const noop = () => {};

let roots = [];
let containers = [];

const mount = (ui) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const root = createRoot(container);
    roots.push(root);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin', darwinOpsUri: 'http://test.local/darwin' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <DndProvider backend={TouchBackend} options={{ enableMouseEvents: true }}>
                            {ui}
                        </DndProvider>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    return container;
};

// Let every query in the tree resolve. The visibility hook fans out to its
// bounded reads and each surface to several more, and TanStack schedules its
// state updates across real task boundaries — so a fixed number of microtask
// ticks is a race, not a wait. Poll until the tree says it is done.
// The inner budget MATCHES the per-test timeout on purpose. A smaller budget
// always fires first, so a genuine failure would surface as "settle() gave up"
// with no assertion diff — and this is the one test that would have caught the
// original defect, so it is the one that must not become a mystery under load.
const TIMEOUT = 60000;
// `observe` is optional and exists only to make a TIMEOUT READABLE. A failing
// settle costs the full budget and then says "gave up" with no diff, which is
// the least useful possible form for the one file that would have caught the
// original defect — so a caller that can cheaply state what it was watching
// passes a thunk, and the message carries the value actually observed.
const settle = async (predicate = () => true, observe = null, budgetMs = 55000) => {
    const start = Date.now();
    let last = null;
    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { await new Promise(r => setTimeout(r, 25)); });
        try {
            if (predicate()) return;
        } catch (e) { last = e; }
        if (Date.now() - start > budgetMs) {
            let seen = '';
            if (observe) {
                try { seen = ` — last observed: ${JSON.stringify(observe())}`; }
                catch (e) { seen = ` — observe() itself threw: ${e.message}`; }
            }
            throw new Error(
                `settle() gave up after ${budgetMs}ms${last ? `: ${last.message}` : ''}${seen}`);
        }
    }
};

// The card renders a spinner until its requirements query lands, so "no rows"
// and "not loaded" look the same in the DOM. The add-row template is the
// difference: it exists only once `requirementsArray` is seeded.
const cardLoaded = (container) => () =>
    container.querySelector('[data-testid="requirement-template"]') !== null;

// The aggregator always renders its chips.
//
// THE BADGE ELEMENT IS NOT A SIGNAL, and an earlier version of this comment said
// it was (req #3502 code review). MUI renders `.MuiBadge-badge` unconditionally;
// `showZero={false}` only adds `MuiBadge-invisible` while the text stays "0". On
// first paint `statusCountMap` is the zeroed map `tallyRequirementStatuses`
// returns for an unresolved read, so waiting on this element is satisfied BEFORE
// any query lands. It is a mount check and nothing more.
//
// That matters because a chip's ROWS and its BADGE come from DIFFERENT queries
// (`useRequirementsByStatus`/`useRequirementsDone` vs `useAllRequirements`), so
// settling on a row count proves nothing about the badge. Every badge assertion
// below therefore waits on `chipSettled`, which pins BOTH — otherwise the badge
// is being read unwaited relative to its own source, which fails safe (a flake
// is a false RED, never a false GREEN) but exactly as a mystery under load.
const aggregatorMounted = (container) => () =>
    container.querySelector('[data-testid="swarm-start-chip-badge-authoring"] .MuiBadge-badge') !== null;

// Both halves of one chip, from their two queries. `rows` is also the badge's
// expected value in every case here, because the two must agree — which is the
// invariant under test, so it is asserted afterwards too rather than only waited on.
const chipSettled = (container, status, rows) => () =>
    renderedIds(container).length === rows && badgeCount(container, status) === rows;

// What `chipSettled` was watching, for the timeout message. This is the gate that
// costs the full budget when the aggregator's rule regresses — pre-fix, the three
// launch-chip toggle-OFF cases each burned 55s and reported only "gave up".
const chipState = (container, status) => () => ({
    rows: renderedIds(container), badge: badgeCount(container, status),
});

const Card = ({ epicReqIds = null }) => (
    <CategoryCard
        category={CATEGORIES[0]}
        categoryIndex={0}
        projectId={1}
        categoryChange={noop}
        categoryKeyDown={noop}
        categoryOnBlur={noop}
        clickCardClosed={noop}
        clickCardDelete={noop}
        moveCard={noop}
        persistCategoryOrder={noop}
        removeCategory={noop}
        isTemplate={false}
        showClosed={false}
        epicReqIds={epicReqIds}
    />
);

// The ids a surface actually put on screen. `requirement-<id>` is
// RequirementRow's own testid; the template add-row is `requirement-template`.
const renderedIds = (container) =>
    [...container.querySelectorAll('[data-testid^="requirement-"]')]
        .map(el => el.getAttribute('data-testid').slice('requirement-'.length))
        .filter(v => v !== 'template' && /^\d+$/.test(v))
        .map(Number);

const sorted = (ids) => [...ids].sort((a, b) => a - b);

const tableIds = (container) =>
    [...container.querySelectorAll('.MuiDataGrid-row')]
        .map(el => Number(el.getAttribute('data-id')))
        .filter(n => !Number.isNaN(n))
        .sort((a, b) => a - b);

const badgeCount = (container, status) => {
    const bubble = container.querySelector(
        `[data-testid="swarm-start-chip-badge-${status}"] .MuiBadge-badge`);
    if (!bubble) return null;
    const text = bubble.textContent || '';
    return text === '' ? 0 : Number(text);
};

// A probe that hands the REAL hooks' output back to the test, so the elevator,
// the pure predicates and the epic scope can be driven by exactly what the
// components consume.
let probed = null;
let probedEpic = null;
const Probe = () => {
    probed = useRequirementVisibility('tester');
    return null;
};

// A probe that re-renders ON COMMAND without changing anything the hook reads,
// and keeps every value it saw. That is the only way to observe referential
// stability: the property is about what happens when NOTHING changes.
let renderLog = [];
let bumpProbe = null;
const StabilityProbe = () => {
    const [, setTick] = React.useState(0);
    bumpProbe = () => setTick(t => t + 1);
    renderLog.push(useRequirementVisibility('tester'));
    return null;
};
const EpicProbe = ({ epicId }) => {
    probedEpic = useEpicRequirementIds('tester', epicId);
    return null;
};

describe('the requirement-visibility harness — one rule, every surface, every status', () => {
    beforeEach(() => {
        roots = [];
        containers = [];
        restCalls.length = 0;
        probed = null;
        probedEpic = null;
        renderLog = [];
        bumpProbe = null;
        useShowClosedStore.setState({
            hidePipelinedRequirements: true,
            // EVERY status, so the status-chip filter never silently narrows
            // what this harness is measuring. The orchestrated toggle is the
            // variable here; nothing else may be.
            requirementStatusFilter: [...ALL_REQUIREMENT_STATUSES],
        });
        useSwarmStartCardStore.setState({ selectedStatus: 'authoring' });
    });
    afterEach(() => {
        act(() => { roots.forEach(r => r.unmount()); });
        containers.forEach(c => c.remove());
        document.body.innerHTML = '';
        useShowClosedStore.setState({
            hidePipelinedRequirements: true,
            requirementStatusFilter: [...ALL_REQUIREMENT_STATUSES],
        });
    });

    // ── the answer itself ────────────────────────────────────────────────────
    describe('the shared hook', () => {
        it('reads the junction and answers step association', async () => {
            mount(<Probe />);
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length);
            expect(sorted(probed.orchestratedIds)).toEqual(ORCHESTRATED);
        }, TIMEOUT);

        it('agrees with the pure function it is a memoized form of', async () => {
            mount(<Probe />);
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length);
            expect(probed.orchestratedIds).toEqual(orchestratedRequirementIds(JUNCTION));
        }, TIMEOUT);

        it('sees step-carried work under every step, not just the first', async () => {
            // 141/151/161 are seated on step 2 — this pins that the read is a
            // whole-table junction scan, not a lookup keyed to one step.
            mount(<Probe />);
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length);
            for (const id of [141, 151, 161]) expect(probed.orchestratedIds.has(id)).toBe(true);
        }, TIMEOUT);

        it('answers the SAME for every status — the rule does not key on one', async () => {
            // req #3502. The deleted aggregator rule keyed on status; this is the
            // hook-level statement that the surviving one does not.
            mount(<Probe />);
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length);
            for (const status of ALL_STATUSES) {
                const [plain, orch] = idsWithStatus(status);
                expect(probed.isVisible({ id: plain })).toBe(true);
                expect(probed.isVisible({ id: orch })).toBe(false);
            }
        }, TIMEOUT);

        it('exposes no narrow step-only set for a caller to filter by (req #3502)', async () => {
            // `pipelinedIds` was the ingredient of the deleted second rule, and
            // its presence is what made a second rule easy to write. Gone.
            mount(<Probe />);
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length);
            expect(probed.pipelinedIds).toBeUndefined();
            expect(Object.keys(probed).sort()).toEqual(
                ['filterVisible', 'hideOrchestrated', 'isVisible', 'orchestratedIds']);
        }, TIMEOUT);

        it('actually issued the read — an empty answer must not be silent', async () => {
            // `fetchEntity` turns a 404 into `[]`, so a hook pointed at the wrong
            // URL produces "nothing is orchestrated" rather than an error. Assert
            // the read happened at all, on the EXACT table name.
            mount(<Probe />);
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length);
            expect(restCalls.some(u => /\/pipeline_step_requirements\b/.test(u))).toBe(true);
        }, TIMEOUT);

        it('hides nothing while the reads are in flight', () => {
            // Deliberate failure direction: show MORE, never hide eligible work
            // behind a pending or failed fetch.
            mount(<Probe />);
            expect(probed.orchestratedIds.size).toBe(0);
            expect(probed.isVisible({ id: 101 })).toBe(true);
        });
    });

    // ── REFERENTIAL STABILITY — the property whose loss WEDGES the process ───
    //
    // Every consumer feeds these values into a `useMemo` whose result is a
    // `useEffect` dependency, and that effect calls `setState`. A `filterVisible`
    // with a fresh identity per render therefore does not merely waste work: it
    // is a SYNCHRONOUS RENDER LOOP.
    //
    // WHY THIS BLOCK EXISTS AT ALL (req #3502 code review). The guard was
    // load-bearing and untested. Measured by mutating the `useCallback` at
    // `useRequirementVisibility.js` into a bare arrow and running ONE harness
    // case: no output after 600s with a core pinned — because Vitest's per-test
    // timeout cannot interrupt a synchronous loop. So the failure mode of losing
    // this property is a WEDGED CI WORKER, not a diff, and the diff-producing
    // test has to exist separately. `pipelineMembership.test.js` pins
    // `excludeByIds`'s identity at the pure-function level, which does NOT cover
    // the case that actually loops: drops something AND unstable callback.
    //
    // These cases fail in milliseconds instead.
    describe('referential stability (a fresh identity here is a render loop)', () => {
        const renderAgain = async (times = 3) => {
            for (let i = 0; i < times; i += 1) {
                // eslint-disable-next-line no-await-in-loop
                await act(async () => { bumpProbe(); });
            }
        };

        it('hands back the SAME object and members across renders that change nothing', async () => {
            mount(<StabilityProbe />);
            await settle(() => renderLog.at(-1).orchestratedIds.size === ORCHESTRATED.length);
            const before = renderLog.length;
            await renderAgain();
            expect(renderLog.length).toBeGreaterThan(before);

            const settledFrom = renderLog.slice(before - 1);
            const first = settledFrom[0];
            for (const v of settledFrom) {
                expect(v).toBe(first);                       // the whole object
                expect(v.filterVisible).toBe(first.filterVisible);
                expect(v.isVisible).toBe(first.isVisible);
                expect(v.orchestratedIds).toBe(first.orchestratedIds);
            }
        }, TIMEOUT);

        it('returns the INPUT ARRAY when it drops nothing, in every off path', async () => {
            // The three ways `filterVisible` must be a no-op by IDENTITY, not
            // merely by value: toggle off, empty id set, and a non-empty set
            // that happens to match no row.
            mount(<StabilityProbe />);
            await settle(() => renderLog.at(-1).orchestratedIds.size === ORCHESTRATED.length);
            const rows = ROWS.filter(r => PLAIN.includes(r.id));

            // Toggle ON but nothing in `rows` is orchestrated → same reference.
            expect(renderLog.at(-1).hideOrchestrated).toBe(true);
            expect(renderLog.at(-1).filterVisible(rows)).toBe(rows);

            // Toggle OFF → `enabled === false` short-circuit, same reference.
            await act(async () => {
                useShowClosedStore.getState().toggleHidePipelinedRequirements();
            });
            await settle(() => renderLog.at(-1).hideOrchestrated === false);
            expect(renderLog.at(-1).filterVisible(ROWS)).toBe(ROWS);
        }, TIMEOUT);

        it('passes undefined through untouched — never converts it to []', async () => {
            // The card distinguishes `undefined` (spinner) from `[]` (empty
            // body). A filter that normalized one into the other would make the
            // aggregator render an empty card on first paint instead of a
            // spinner, on every chip switch.
            mount(<StabilityProbe />);
            await settle(() => renderLog.at(-1).orchestratedIds.size === ORCHESTRATED.length);
            expect(renderLog.at(-1).filterVisible(undefined)).toBeUndefined();
            const empty = [];
            expect(renderLog.at(-1).filterVisible(empty)).toBe(empty);
        }, TIMEOUT);

        it('mints exactly ONE new identity when the toggle actually flips', async () => {
            // The other half: stable must not mean frozen. A real change has to
            // produce a real new value, once, and then settle again.
            mount(<StabilityProbe />);
            await settle(() => renderLog.at(-1).orchestratedIds.size === ORCHESTRATED.length);
            const before = renderLog.at(-1);
            await act(async () => {
                useShowClosedStore.getState().toggleHidePipelinedRequirements();
            });
            await settle(() => renderLog.at(-1).hideOrchestrated === false);
            const after = renderLog.at(-1);
            expect(after).not.toBe(before);
            expect(after.filterVisible).not.toBe(before.filterVisible);
            // ...and the id set, which did NOT change, is still the same object.
            expect(after.orchestratedIds).toBe(before.orchestratedIds);
            await renderAgain();
            expect(renderLog.at(-1)).toBe(after);
        }, TIMEOUT);
    });

    // ── surface by surface, through the REAL chain ───────────────────────────
    describe('the Cards view', () => {
        it('hides every orchestrated row with the toggle ON', async () => {
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === PLAIN.length);
            expect(sorted(renderedIds(c))).toEqual(PLAIN);
        }, TIMEOUT);

        it('shows every row with the toggle OFF', async () => {
            useShowClosedStore.setState({ hidePipelinedRequirements: false });
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === ROWS.length);
            expect(sorted(renderedIds(c))).toEqual(sorted(ROWS.map(r => r.id)));
        }, TIMEOUT);

        it('responds to the toggle live, without a remount', async () => {
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === PLAIN.length);
            await act(async () => {
                useShowClosedStore.getState().toggleHidePipelinedRequirements();
            });
            await settle(() => renderedIds(c).length === ROWS.length);
            expect(sorted(renderedIds(c))).toEqual(sorted(ROWS.map(r => r.id)));
        }, TIMEOUT);

        it('keeps the add-row template regardless of the toggle', async () => {
            // `Number('')` is 0; a predicate that let the template through the
            // Set lookup would be one id collision away from eating the add-row.
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            expect(c.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
        }, TIMEOUT);
    });

    describe('the Table view', () => {
        it('hides every orchestrated row with the toggle ON', async () => {
            const c = mount(<RequirementsTableView />);
            await settle(() => tableIds(c).length === PLAIN.length);
            expect(tableIds(c)).toEqual(PLAIN);
        }, TIMEOUT);

        it('shows every row with the toggle OFF', async () => {
            useShowClosedStore.setState({ hidePipelinedRequirements: false });
            const c = mount(<RequirementsTableView />);
            await settle(() => tableIds(c).length === ROWS.length);
            expect(tableIds(c)).toEqual(sorted(ROWS.map(r => r.id)));
        }, TIMEOUT);
    });

    // ── THE AGGREGATOR, CHIP BY CHIP (req #3502) ────────────────────────────
    //
    // This is the surface the requirement is about, and the loop is the point:
    // the same two assertions for all five chips in both toggle states, with no
    // chip exempted and no branch in the expectation. Any per-chip rule that
    // comes back fails here on the chip it applies to.
    describe('the aggregator card', () => {
        for (const status of CHIPS) {
            const [plain, orch] = idsWithStatus(status);

            it(`the ${status} chip hides the orchestrated row with the toggle ON`, async () => {
                useSwarmStartCardStore.setState({ selectedStatus: status });
                const c = mount(<SwarmStartCard />);
                await settle(aggregatorMounted(c));
                await settle(chipSettled(c, status, 1), chipState(c, status));
                expect(renderedIds(c)).toEqual([plain]);
                expect(badgeCount(c, status)).toBe(1);
            }, TIMEOUT);

            it(`the ${status} chip SHOWS the orchestrated row with the toggle OFF`, async () => {
                // THE DEFECT req #3502 WAS FILED FOR, per chip. Before the fix
                // this failed on authoring/approved/swarm_ready and passed on
                // development/met — one control, two answers.
                useShowClosedStore.setState({ hidePipelinedRequirements: false });
                useSwarmStartCardStore.setState({ selectedStatus: status });
                const c = mount(<SwarmStartCard />);
                await settle(aggregatorMounted(c));
                await settle(chipSettled(c, status, 2), chipState(c, status));
                expect(sorted(renderedIds(c))).toEqual([plain, orch]);
                expect(badgeCount(c, status)).toBe(2);
            }, TIMEOUT);
        }

        it.each([true, false])(
            'EVERY chip badge equals the rows that chip renders (toggle=%s)',
            async (hiding) => {
                // The badge/rows invariant, asserted by OUTCOME across the whole
                // chip vocabulary rather than for whichever chip happens to be
                // selected. Mount once per chip so each badge is checked against
                // the list the card actually built for it.
                useShowClosedStore.setState({ hidePipelinedRequirements: hiding });
                const expected = hiding ? 1 : 2;
                for (const status of CHIPS) {
                    useSwarmStartCardStore.setState({ selectedStatus: status });
                    const c = mount(<SwarmStartCard />);
                    // eslint-disable-next-line no-await-in-loop
                    await settle(aggregatorMounted(c));
                    // Waits on BOTH queries; the assertion then re-states the
                    // invariant so a predicate someone weakens still gets caught.
                    // eslint-disable-next-line no-await-in-loop
                    await settle(chipSettled(c, status, expected), chipState(c, status));
                    expect(badgeCount(c, status)).toBe(renderedIds(c).length);
                }
            }, TIMEOUT);

        it('responds to the toggle live, without a remount', async () => {
            useSwarmStartCardStore.setState({ selectedStatus: 'swarm_ready' });
            const c = mount(<SwarmStartCard />);
            await settle(aggregatorMounted(c));
            await settle(chipSettled(c, 'swarm_ready', 1), chipState(c, 'swarm_ready'));
            expect(renderedIds(c)).toEqual([120]);
            await act(async () => {
                useShowClosedStore.getState().toggleHidePipelinedRequirements();
            });
            await settle(chipSettled(c, 'swarm_ready', 2), chipState(c, 'swarm_ready'));
            expect(sorted(renderedIds(c))).toEqual([120, 121]);
            expect(badgeCount(c, 'swarm_ready')).toBe(2);
        }, TIMEOUT);

        it('never counts the add-row template in a badge', async () => {
            useSwarmStartCardStore.setState({ selectedStatus: 'authoring' });
            const c = mount(<SwarmStartCard />);
            await settle(aggregatorMounted(c));
            await settle(chipSettled(c, 'authoring', 1), chipState(c, 'authoring'));
            expect(c.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
            expect(badgeCount(c, 'authoring')).toBe(1);
        }, TIMEOUT);
    });

    // ── the property the whole refactor buys ─────────────────────────────────
    describe('cross-surface agreement, per status, no exemptions', () => {
        // NO `COMPARABLE` EXEMPTION LIST. The old version of this case subtracted
        // the rows the aggregator's launch rule removed before comparing, so it
        // agreed by construction and was blind to the very defect req #3502
        // reports. Every surface is now compared over the SAME population.
        it.each([true, false])('cards, table, aggregator and hook agree (hiding=%s)', async (hiding) => {
            useShowClosedStore.setState({ hidePipelinedRequirements: hiding });
            const card = mount(<Card />);
            const table = mount(<RequirementsTableView />);
            mount(<Probe />);
            const expectedCount = hiding ? PLAIN.length : ROWS.length;
            await settle(cardLoaded(card));
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length
                && renderedIds(card).length === expectedCount
                && tableIds(table).length === expectedCount);

            for (const status of CHIPS) {
                const population = idsWithStatus(status);
                const expected = hiding ? population.filter(id => PLAIN.includes(id)) : population;

                useSwarmStartCardStore.setState({ selectedStatus: status });
                const agg = mount(<SwarmStartCard />);
                // eslint-disable-next-line no-await-in-loop
                await settle(aggregatorMounted(agg));
                // eslint-disable-next-line no-await-in-loop
                await settle(chipSettled(agg, status, expected.length), chipState(agg, status));

                const fromCard = sorted(renderedIds(card)).filter(id => population.includes(id));
                const fromTable = tableIds(table).filter(id => population.includes(id));
                const fromAggregator = sorted(renderedIds(agg));
                const fromHook = population.filter(id => probed.isVisible({ id }));

                expect(fromCard).toEqual(expected);
                expect(fromTable).toEqual(expected);
                expect(fromAggregator).toEqual(expected);
                expect(fromHook).toEqual(expected);
            }
        }, TIMEOUT);
    });

    // ── req #3419 — the gold title box ───────────────────────────────────────
    //
    // The mark and the filter are ONE predicate. That is the property worth
    // testing: not "is it gold" (a style assertion pins a hex value, not a
    // rule), but "is the marked set EXACTLY the set the toggle hides". A second
    // derivation would show up here as a row that is gold and still visible
    // under hiding, or plain and hidden.
    describe('orchestrated rows are MARKED, from the same set that hides them', () => {
        const marked = (container) =>
            [...container.querySelectorAll('[data-orchestrated="true"]')]
                .map(el => Number(el.getAttribute('data-testid').replace('req-title-', '')))
                .sort((a, b) => a - b);
        const plain = (container) =>
            [...container.querySelectorAll('[data-orchestrated="false"]')]
                .map(el => Number(el.getAttribute('data-testid').replace('req-title-', '')))
                .sort((a, b) => a - b);

        it('marks exactly the orchestrated rows when the toggle is OFF', async () => {
            useShowClosedStore.setState({ hidePipelinedRequirements: false });
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === ROWS.length);
            expect(marked(c)).toEqual(ORCHESTRATED);
            expect(plain(c)).toEqual(PLAIN);
        }, TIMEOUT);

        it('marks NOTHING that survives the toggle — mark and filter are one set', async () => {
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === PLAIN.length);
            expect(marked(c)).toEqual([]);
            expect(plain(c)).toEqual(PLAIN);
        }, TIMEOUT);

        it('never marks the add-row template', async () => {
            // `Number('')` is 0. A predicate that let the template reach the Set
            // lookup would gild the add-row the first time id 0 appeared.
            useShowClosedStore.setState({ hidePipelinedRequirements: false });
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            const template = c.querySelector('[data-testid="requirement-template"]');
            expect(template).not.toBeNull();
            expect(template.querySelector('[data-orchestrated]')).toBeNull();
        }, TIMEOUT);

        it('MARKS the orchestrated rows in the aggregator too (req #3502)', async () => {
            // Before #3502 this card could never mark anything on a launch chip,
            // because the rows it would have marked were withheld. Now the mark
            // is what tells the reader the plan owns this work — so it has to be
            // there, on the surface that used to hide it instead.
            useShowClosedStore.setState({ hidePipelinedRequirements: false });
            useSwarmStartCardStore.setState({ selectedStatus: 'swarm_ready' });
            const c = mount(<SwarmStartCard />);
            await settle(aggregatorMounted(c));
            await settle(chipSettled(c, 'swarm_ready', 2), chipState(c, 'swarm_ready'));
            expect(marked(c)).toEqual([121]);
            expect(plain(c)).toEqual([120]);
        }, TIMEOUT);
    });

    describe('the up/down elevator', () => {
        const elevatorIds = (visibility) => siblingElevator(
            ROWS.filter(r => ALL_REQUIREMENT_STATUSES.includes(r.requirement_status)),
            { sortMode: 'process', isVisible: visibility.isVisible, currentId: 100 },
        );

        it('walks exactly the rows the card rendered', async () => {
            const c = mount(<Card />);
            mount(<Probe />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === PLAIN.length
                && probed.orchestratedIds.size === ORCHESTRATED.length);
            expect(elevatorIds(probed).ordered.map(r => r.id)).toEqual(renderedIds(c));
        }, TIMEOUT);

        it('disables both arrows on a requirement the filter itself hides', async () => {
            mount(<Probe />);
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length);
            const at101 = siblingElevator(ROWS, {
                sortMode: 'process', isVisible: probed.isVisible, currentId: 101,
            });
            expect(at101.currentIndex).toBe(-1);
            expect(at101.prevId).toBeNull();
            expect(at101.nextId).toBeNull();
        }, TIMEOUT);
    });

    // ── THE PIPELINE VIEWS' FILTER (req #3428) ──────────────────────────────
    //
    // "This should also not break any filters applied from the pipeline views."
    // The epic chip on a plan view lands on `/swarm?epic=N`; `SwarmView` derives
    // the scope with `useEpicRequirementIds` and threads it down as a Set. The
    // derivation runs FOR REAL here — steps -> junction -> requirement ids —
    // because a hand-made Set would prove only that the consumers filter by
    // whatever they are handed, which is the standard of evidence this whole
    // harness exists to reject.
    describe('the epic filter from the pipeline views', () => {
        it('derives the epic scope through the real containment chain', async () => {
            mount(<EpicProbe epicId={EPIC_A} />);
            await settle(() => probedEpic.epicReqIds && probedEpic.epicReqIds.size === EPIC_A_REQS.length);
            expect(sorted(probedEpic.epicReqIds)).toEqual(EPIC_A_REQS);
            expect(probedEpic.epicReqIds).toEqual(epicRequirementIds(STEPS, JUNCTION, EPIC_A));
        }, TIMEOUT);

        it('reads null (no filter) when no epic is named', async () => {
            // `null` and an EMPTY SET are different pages — the first filters
            // nothing, the second filters everything out.
            mount(<EpicProbe epicId={null} />);
            await settle(() => probedEpic !== null);
            expect(probedEpic.epicReqIds).toBeNull();
        }, TIMEOUT);

        it('narrows the Cards view to the epic, with the toggle stored ON', async () => {
            // The forced override: an epic's work is step-carried BY DEFINITION
            // under containment, so honouring the stored ON would render the page
            // empty, always.
            const c = mount(<Card epicReqIds={new Set(EPIC_A_REQS)} />);
            await settle(() => renderedIds(c).length === EPIC_A_REQS.length);
            expect(sorted(renderedIds(c))).toEqual(EPIC_A_REQS);
            // Suppressed while filtered — a row saved there would belong to no
            // epic and vanish the instant it saved.
            expect(c.querySelector('[data-testid="requirement-template"]')).toBeNull();
        }, TIMEOUT);

        it('narrows the aggregator rows AND badges to the epic, on a launch chip', async () => {
            // The intersection of both fixes: the epic scope still applies (only
            // 101 of the two authoring rows), and the launch chip no longer
            // withholds plan-carried work (101 is on screen at all). Before req
            // #3502 this chip rendered nothing and badged 0.
            useSwarmStartCardStore.setState({ selectedStatus: 'authoring' });
            const c = mount(<SwarmStartCard epicReqIds={new Set(EPIC_A_REQS)} />);
            await settle(aggregatorMounted(c));
            await settle(chipSettled(c, 'authoring', 1), chipState(c, 'authoring'));
            expect(renderedIds(c)).toEqual([101]);
            expect(badgeCount(c, 'authoring')).toBe(1);
        }, TIMEOUT);

        it('keeps another epic\'s work out of every chip', async () => {
            // 141/151/161 sit under epic B. `met` is the chip where that is
            // visible, since it is the only one of B's statuses in the chip
            // vocabulary — and the met badge comes from a DIFFERENT query than
            // its rows (the trailing-24h overlay), so an unscoped overlay would
            // show up right here as a `2` over an empty list.
            //
            // The card then opens on `authoring` rather than on the empty `met`
            // the store asked for: that is req #3428's don't-open-blank override,
            // and its presence here is the second half of the same assertion —
            // epic A really has nothing met.
            useSwarmStartCardStore.setState({ selectedStatus: 'met' });
            const c = mount(<SwarmStartCard epicReqIds={new Set(EPIC_A_REQS)} />);
            await settle(aggregatorMounted(c));
            await settle(chipSettled(c, 'authoring', 1), chipState(c, 'authoring'));
            expect(badgeCount(c, 'met')).toBe(0);
            expect(badgeCount(c, 'authoring')).toBe(1);
            expect(badgeCount(c, 'development')).toBe(1);
            expect(renderedIds(c)).toEqual([101]);   // the override's chip, epic-scoped
            expect(useSwarmStartCardStore.getState().selectedStatus).toBe('met');
        }, TIMEOUT);

        it('agrees with the Cards view over the epic scope', async () => {
            useSwarmStartCardStore.setState({ selectedStatus: 'development' });
            const card = mount(<Card epicReqIds={new Set(EPIC_A_REQS)} />);
            const agg = mount(<SwarmStartCard epicReqIds={new Set(EPIC_A_REQS)} />);
            await settle(() => renderedIds(card).length === EPIC_A_REQS.length);
            await settle(aggregatorMounted(agg));
            await settle(chipSettled(agg, 'development', 1), chipState(agg, 'development'));
            expect(renderedIds(agg)).toEqual([131]);
            expect(renderedIds(card)).toContain(131);
        }, TIMEOUT);

        it('leaves the stored toggle untouched — dismissing the filter restores it', async () => {
            // A derived override, never a write. The reader's preference must
            // survive a visit to an epic page.
            expect(useShowClosedStore.getState().hidePipelinedRequirements).toBe(true);
            const c = mount(<Card epicReqIds={new Set(EPIC_A_REQS)} />);
            await settle(() => renderedIds(c).length === EPIC_A_REQS.length);
            expect(useShowClosedStore.getState().hidePipelinedRequirements).toBe(true);
        }, TIMEOUT);
    });
});
