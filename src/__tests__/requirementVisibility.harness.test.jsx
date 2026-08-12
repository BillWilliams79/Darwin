// @vitest-environment jsdom
//
// ── THE requirement-visibility harness — req #3419, narrowed by req #3357 ────
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
// `useRequirementVisibility`, `pipelineMembership`, `processSort`, and the four
// surfaces themselves. One fixture goes in at the wire; four independently
// written renderers come out; they are asserted to AGREE. A rule that is
// computed in one place cannot fail that assertion, and a rule that quietly
// grows a sixth copy will.
//
// req #3419's EPIC population (a requirement filed under an epic via
// `feature_fk` with no step carrying it yet) is retired by req #3357: Feature
// left the frontend, and it was the only mechanism that could produce that
// population — see `utils/pipelineMembership.js`'s header. The fixture below
// keeps its original row shape (so the surface-by-surface structure of this
// harness stays intact) but every row's orchestration now turns on STEP
// association alone.

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
// 100  unplanned                                    -> always visible
// 101  carried by pipeline step 1                   -> STEP association
// 102  unplanned (the req #3419 epic population it once carried is retired)
// 103  unplanned
// 104  unplanned, status development
const CATEGORY_ID = 5;
const ROWS = [
    { id: 100, title: 'Unplanned', requirement_status: 'authoring', category_fk: CATEGORY_ID, sort_order: 0, coordination_type: 'implemented', ai_model: 'opus', effort: 'high', machine_fk: null, started_at: null, completed_at: null, deferred_at: null },
    { id: 101, title: 'On a plan step', requirement_status: 'authoring', category_fk: CATEGORY_ID, sort_order: 1, coordination_type: 'implemented', ai_model: 'opus', effort: 'high', machine_fk: null, started_at: null, completed_at: null, deferred_at: null },
    { id: 102, title: 'Unplanned (formerly epic-seated)', requirement_status: 'authoring', category_fk: CATEGORY_ID, sort_order: 2, coordination_type: 'implemented', ai_model: 'opus', effort: 'high', machine_fk: null, started_at: null, completed_at: null, deferred_at: null },
    { id: 103, title: 'Unplanned', requirement_status: 'authoring', category_fk: CATEGORY_ID, sort_order: 3, coordination_type: 'implemented', ai_model: 'opus', effort: 'high', machine_fk: null, started_at: null, completed_at: null, deferred_at: null },
    { id: 104, title: 'Unplanned, in flight', requirement_status: 'development', category_fk: CATEGORY_ID, sort_order: 4, coordination_type: 'implemented', ai_model: 'opus', effort: 'high', machine_fk: null, started_at: '2026-08-01T00:00:00', completed_at: null, deferred_at: null },
];
const JUNCTION = [{ step_fk: 1, requirement_fk: 101 }];
const CATEGORIES = [{ id: CATEGORY_ID, category_name: 'Harness', project_fk: 1, color: null, sort_mode: 'process' }];

// The answer, stated once, independently of any component.
const ORCHESTRATED = [101];
const VISIBLE_WHEN_HIDING = [100, 102, 103, 104];

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
        if (params.get('requirement_status') === 'met') return [];
        if (params.has('requirement_status')) {
            return ROWS.filter(r => r.requirement_status === params.get('requirement_status'));
        }
        return ROWS;
    }
    if (table === 'pipeline_step_requirements') return JUNCTION;
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
import { siblingElevator } from '../SwarmView/detail/requirementSort';
import { orchestratedRequirementIds } from '../utils/pipelineMembership';
import { useShowClosedStore } from '../stores/useShowClosedStore';
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

// Let every query in the tree resolve. The visibility hook fans out to three
// reads and each surface to several more, and TanStack schedules its state
// updates across real task boundaries — so a fixed number of microtask ticks is
// a race, not a wait. Poll until the tree says it is done.
// The inner budget MATCHES the per-test timeout on purpose. A smaller budget
// always fires first, so a genuine failure would surface as "settle() gave up"
// with no assertion diff — and this is the one test that would have caught the
// original defect, so it is the one that must not become a mystery under load.
const TIMEOUT = 60000;
const settle = async (predicate = () => true, budgetMs = 55000) => {
    const start = Date.now();
    let last = null;
    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { await new Promise(r => setTimeout(r, 25)); });
        try {
            if (predicate()) return;
        } catch (e) { last = e; }
        if (Date.now() - start > budgetMs) {
            throw new Error(`settle() gave up after ${budgetMs}ms${last ? `: ${last.message}` : ''}`);
        }
    }
};

// The card renders a spinner until its requirements query lands, so "no rows"
// and "not loaded" look the same in the DOM. The add-row template is the
// difference: it exists only once `requirementsArray` is seeded.
const cardLoaded = (container) => () =>
    container.querySelector('[data-testid="requirement-template"]') !== null;

// The aggregator always renders its chips; the badge text is the signal that the
// counts query has landed.
const aggregatorLoaded = (container) => () =>
    container.querySelector('[data-testid="swarm-start-chip-badge-authoring"] .MuiBadge-badge') !== null;

const Card = () => (
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
    />
);

// The ids a surface actually put on screen, in render order. `requirement-<id>`
// is RequirementRow's own testid; the template add-row is `requirement-template`.
const renderedIds = (container) =>
    [...container.querySelectorAll('[data-testid^="requirement-"]')]
        .map(el => el.getAttribute('data-testid').slice('requirement-'.length))
        .filter(v => v !== 'template' && /^\d+$/.test(v))
        .map(Number);

// A probe that hands the REAL hook's output back to the test, so the elevator
// and the pure predicate can be driven by exactly what the components consume.
let probed = null;
const Probe = () => {
    probed = useRequirementVisibility('tester');
    return null;
};

describe('req #3419 — one visibility rule, every surface (the single harness)', () => {
    beforeEach(() => {
        roots = [];
        containers = [];
        restCalls.length = 0;
        probed = null;
        useShowClosedStore.setState({
            hidePipelinedRequirements: true,
            requirementStatusFilter: ['authoring', 'approved', 'swarm_ready', 'development'],
        });
        useSwarmStartCardStore.setState({ selectedStatus: 'authoring' });
    });
    afterEach(() => {
        act(() => { roots.forEach(r => r.unmount()); });
        containers.forEach(c => c.remove());
        document.body.innerHTML = '';
        useShowClosedStore.setState({ hidePipelinedRequirements: true });
    });

    // ── the answer itself ────────────────────────────────────────────────────
    describe('the shared hook', () => {
        it('reads the junction and answers step association', async () => {
            mount(<Probe />);
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length);
            expect([...probed.orchestratedIds].sort((a, b) => a - b)).toEqual(ORCHESTRATED);
        }, TIMEOUT);

        it('the ORCHESTRATED and STEP sets are now the same set (req #3357)', async () => {
            // req #3419's epic population is retired — see the module header —
            // so `orchestratedIds` and `pipelinedIds` agree exactly.
            mount(<Probe />);
            await settle(() => probed.pipelinedIds.size === 1);
            expect([...probed.pipelinedIds]).toEqual([101]);
            expect(probed.orchestratedIds).toEqual(probed.pipelinedIds);
        }, TIMEOUT);

        it('agrees with the pure function it is a memoized form of', async () => {
            mount(<Probe />);
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length);
            expect(probed.orchestratedIds)
                .toEqual(orchestratedRequirementIds(JUNCTION));
        }, TIMEOUT);

        it('actually issued the read — an empty answer must not be silent', async () => {
            // `fetchEntity` turns a 404 into `[]`, so a hook pointed at the wrong
            // URL produces "nothing is orchestrated" rather than an error. Assert
            // the read happened at all.
            mount(<Probe />);
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length);
            expect(restCalls.some(u => u.includes('/pipeline_step_requirements'))).toBe(true);
        }, TIMEOUT);

        it('hides nothing while the reads are in flight', () => {
            // Deliberate failure direction: show MORE, never hide eligible work
            // behind a pending or failed fetch.
            mount(<Probe />);
            expect(probed.orchestratedIds.size).toBe(0);
            expect(probed.isVisible({ id: 101 })).toBe(true);
        });
    });

    // ── surface by surface, through the REAL chain ───────────────────────────
    describe('the Cards view', () => {
        it('hides step-carried work with the toggle ON', async () => {
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === VISIBLE_WHEN_HIDING.length);
            expect(renderedIds(c)).toEqual(VISIBLE_WHEN_HIDING);
        }, TIMEOUT);

        it('shows every row with the toggle OFF', async () => {
            useShowClosedStore.setState({ hidePipelinedRequirements: false });
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === 5);
            expect(renderedIds(c).sort((a, b) => a - b)).toEqual([100, 101, 102, 103, 104]);
        }, TIMEOUT);

        it('responds to the toggle live, without a remount', async () => {
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === VISIBLE_WHEN_HIDING.length);
            expect(renderedIds(c)).toEqual(VISIBLE_WHEN_HIDING);
            await act(async () => {
                useShowClosedStore.getState().toggleHidePipelinedRequirements();
            });
            await settle(() => renderedIds(c).length === 5);
            expect(renderedIds(c)).toContain(102);
        }, TIMEOUT);

        it('keeps the add-row template regardless of the toggle', async () => {
            // `Number('')` is 0; a predicate that let the template through the
            // Set lookup would be one id collision away from eating the add-row.
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            expect(c.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
        }, TIMEOUT);
    });

    describe('the aggregator card', () => {
        it('withholds step-carried work from a launch chip even with the toggle OFF', async () => {
            useShowClosedStore.setState({ hidePipelinedRequirements: false });
            const c = mount(<SwarmStartCard />);
            await settle(aggregatorLoaded(c));
            await settle(() => renderedIds(c).length === 3);
            const ids = renderedIds(c);
            expect(ids).not.toContain(101);   // req #3180 — unconditional
            expect(ids).toEqual([100, 102, 103]);
        }, TIMEOUT);

        it('the toggle changes nothing further on the aggregator (req #3357)', async () => {
            // req #3419's epic population — the one thing the toggle could still
            // withhold beyond the unconditional launch exclusion — is retired, so
            // ON and OFF now render identically here. That collapse is itself the
            // regression req #3357's report names.
            const c = mount(<SwarmStartCard />);
            await settle(aggregatorLoaded(c));
            await settle(() => renderedIds(c).length === 3);
            expect(renderedIds(c)).toEqual([100, 102, 103]);
        }, TIMEOUT);

        it('badges the chip with the number of rows it renders', async () => {
            // The list and its own count are one function since req #3419. This
            // asserts it by OUTCOME, so re-inlining either half fails here.
            const c = mount(<SwarmStartCard />);
            await settle(aggregatorLoaded(c));
            await settle(() => renderedIds(c).length === 3);
            const badge = c.querySelector('[data-testid="swarm-start-chip-badge-authoring"] .MuiBadge-badge');
            expect(badge?.textContent).toBe(String(renderedIds(c).length));
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
            // Toggle OFF is the state where the mark earns its keep: both
            // populations are on screen together.
            useShowClosedStore.setState({ hidePipelinedRequirements: false });
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === 5);
            expect(marked(c)).toEqual(ORCHESTRATED);
            expect(plain(c)).toEqual(VISIBLE_WHEN_HIDING);
        }, TIMEOUT);

        it('marks step-carried work, and step-carried work alone (req #3357)', async () => {
            // 102 was epic-seated under the retired req #3419 population; a mark
            // still built against that dead predicate would leave it gold.
            useShowClosedStore.setState({ hidePipelinedRequirements: false });
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === 5);
            expect(marked(c)).toContain(101);      // step-carried
            expect(marked(c)).not.toContain(102);  // no longer a population at all
        }, TIMEOUT);

        it('marks NOTHING that survives the toggle — mark and filter are one set', async () => {
            // The invariant. Whatever is on screen while hiding is, by
            // definition, not orchestrated; so nothing there may be gold.
            const c = mount(<Card />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === VISIBLE_WHEN_HIDING.length);
            expect(marked(c)).toEqual([]);
            expect(plain(c)).toEqual(VISIBLE_WHEN_HIDING);
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

        it('marks in the aggregator card too, from its own copy of the same set', async () => {
            useShowClosedStore.setState({ hidePipelinedRequirements: false });
            const c = mount(<SwarmStartCard />);
            await settle(aggregatorLoaded(c));
            await settle(() => renderedIds(c).length === 3);
            // 101 is withheld by the launch exclusion, so it never reaches the
            // aggregator to be marked — and nothing else is orchestrated now.
            expect(marked(c)).toEqual([]);
        }, TIMEOUT);
    });

    describe('the Table view', () => {
        // The fourth surface the hook's docstring names. Without it, the table's
        // only proof was that it happens to call the same callback — which is
        // precisely the standard of evidence req #3419 exists to reject.
        const tableIds = (container) =>
            [...container.querySelectorAll('.MuiDataGrid-row')]
                .map(el => Number(el.getAttribute('data-id')))
                .filter(n => !Number.isNaN(n))
                .sort((a, b) => a - b);

        it('hides step-carried work with the toggle ON', async () => {
            const c = mount(<RequirementsTableView />);
            await settle(() => tableIds(c).length === VISIBLE_WHEN_HIDING.length);
            expect(tableIds(c)).toEqual(VISIBLE_WHEN_HIDING);
        }, TIMEOUT);

        it('shows every row with the toggle OFF', async () => {
            useShowClosedStore.setState({ hidePipelinedRequirements: false });
            const c = mount(<RequirementsTableView />);
            await settle(() => tableIds(c).length === 5);
            expect(tableIds(c)).toEqual([100, 101, 102, 103, 104]);
        }, TIMEOUT);

        it('renders the same rows the Cards view does', async () => {
            const card = mount(<Card />);
            const table = mount(<RequirementsTableView />);
            await settle(cardLoaded(card));
            await settle(() => renderedIds(card).length === VISIBLE_WHEN_HIDING.length
                && tableIds(table).length === VISIBLE_WHEN_HIDING.length);
            expect(tableIds(table)).toEqual([...renderedIds(card)].sort((a, b) => a - b));
        }, TIMEOUT);
    });

    describe('the up/down elevator', () => {
        const elevatorIds = (visibility) => siblingElevator(
            ROWS.filter(r => ['authoring', 'approved', 'swarm_ready', 'development']
                .includes(r.requirement_status)),
            { sortMode: 'process', isVisible: visibility.isVisible, currentId: 100 },
        );

        it('walks exactly the rows the card rendered', async () => {
            const c = mount(<Card />);
            mount(<Probe />);
            await settle(cardLoaded(c));
            await settle(() => renderedIds(c).length === VISIBLE_WHEN_HIDING.length
                && probed.orchestratedIds.size === ORCHESTRATED.length);
            expect(elevatorIds(probed).ordered.map(r => r.id)).toEqual(renderedIds(c));
        }, TIMEOUT);

        it('sends Down to 102 now that no epic population hides it (req #3357)', async () => {
            mount(<Probe />);
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length);
            const { nextId } = elevatorIds(probed);
            expect(nextId).toBe(102);
            expect(elevatorIds(probed).ordered.map(r => r.id)).not.toContain(101);
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

    // ── the property the whole refactor buys ─────────────────────────────────
    describe('cross-surface agreement', () => {
        // The aggregator shows ONE status and applies its own unconditional
        // launch exclusion on top, so the fair comparison is: among the rows
        // both surfaces could show (authoring, minus the step-carried one the
        // launch rule removes), do they render the same set?
        const COMPARABLE = ROWS
            .filter(r => r.requirement_status === 'authoring' && r.id !== 101)
            .map(r => r.id);

        it.each([true, false])('card, aggregator and hook agree (hiding=%s)', async (hiding) => {
            useShowClosedStore.setState({ hidePipelinedRequirements: hiding });
            // req #3357 — the epic population COMPARABLE used to be split by is
            // gone, so both toggle states now agree on the same answer: nothing
            // in COMPARABLE (101 already excluded) is ever hidden.
            const expected = [100, 102, 103];

            const card = mount(<Card />);
            const agg = mount(<SwarmStartCard />);
            mount(<Probe />);
            await settle(cardLoaded(card));
            await settle(aggregatorLoaded(agg));
            await settle(() => probed.orchestratedIds.size === ORCHESTRATED.length
                && renderedIds(card).length === (hiding ? VISIBLE_WHEN_HIDING.length : 5));

            const fromCard = renderedIds(card).filter(id => COMPARABLE.includes(id));
            const fromAggregator = renderedIds(agg).filter(id => COMPARABLE.includes(id));
            const fromHook = COMPARABLE.filter(id => probed.isVisible({ id }));

            expect(fromCard.sort()).toEqual(expected);
            expect(fromAggregator.sort()).toEqual(expected);
            expect(fromHook.sort()).toEqual(expected);
        }, TIMEOUT);
    });
});
