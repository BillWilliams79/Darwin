// @vitest-environment jsdom
//
// Req #3015 (reopened) — the Category <Select> on the requirement editor must:
//   1. sort options by `sort_order` (matching the card view's ordering), and
//   2. NEVER offer a closed category, even if one slips into the query result
//      (e.g. via a stale/shared TanStack Query cache entry).
//
// `useAllCategories` is mocked directly so this test can hand back a closed row
// alongside open ones — proving the component's own client-side guard strips it
// out, independent of whatever server-side `closed=0` filtering also does.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({
    useParams: () => ({ id: '42' }),
    useNavigate: () => () => {},
    useLocation: () => ({ state: {} }),
}));

const CATEGORIES = [
    { id: 3, category_name: 'Zebra',   sort_order: 2,    closed: 0 },
    { id: 1, category_name: 'Alpha',   sort_order: 1,    closed: 0 },
    { id: 5, category_name: 'Retired', sort_order: 0,    closed: 1 }, // closed — must never render
    { id: 2, category_name: 'Beta',    sort_order: null, closed: 0 },
    { id: 4, category_name: 'Amber',   sort_order: null, closed: 0 },
];

// Req #3435 — the Orchestration box added six list reads to every mount of this
// page. This suite is about the Category select and uses none of them, so they are stubbed
// EMPTY rather than left to run: an unstubbed mount pays five extra TanStack
// queries per test. That removes the cost rather than budgeting for it; the
// timeout note above covers what remains, which is render cost, not I/O.
// A FUNCTION DECLARATION, not a const: `vi.mock` factories are hoisted above
// every module-level binding, so a `const` here is in its temporal dead zone
// when the factory runs and the mock fails with a bare "error when mocking a
// module". Declarations hoist whole.
function orchestrationStubs() {
    const empty = { data: [], isLoading: false, isError: false, isPending: false, isSuccess: true };
    return {
        useAllPipelines: () => empty,
        useAllEpics: () => empty,
        useAllPipelineSteps: () => empty,
        useAllPipelineStepRequirements: () => empty,
        useAllFeatures: () => empty,
    };
}

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        ...orchestrationStubs(),
        useMachines: () => ({ data: [] }),
        useAllCategories: () => ({ data: CATEGORIES }),
    };
});

const requirementRow = {
    id: 42,
    title: 'sort me',
    description: '',
    category_fk: 1,
    requirement_status: 'swarm_ready',
    coordination_type: 'implemented',
    ai_model: 'opus',
    effort: 'xhigh',
    machine_fk: null,
    started_at: null, completed_at: null, deferred_at: null,
    create_ts: null, update_ts: null,
};
vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method) => {
        if (method === 'GET' && uri.includes('/requirements?id=')) {
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [requirementRow] });
        }
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import RequirementDetail from '../RequirementDetail';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

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
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <RequirementDetail />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    mountedRoots.push(root);
    return { container };
}

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

function openCategorySelect(container) {
    const combobox = container.querySelector('[data-testid="requirement-category-select"] [role="combobox"]');
    combobox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
}

function optionLabels() {
    return Array.from(document.querySelectorAll('[role="option"]')).map((el) => el.textContent);
}

// Req #3435 — 15s, not vitest's 5000ms default. These cases MOUNT THE WHOLE
// requirement page in jsdom, and the first one in a file also pays module init
// for MUI. Measured before this requirement, the slowest case here already took
// ~4s of the 5s budget, so the default was a latent flake rather than a real
// ceiling; the Orchestration box's two extra MUI Selects are what pushed it
// over. The assertions below are unchanged — only the budget they may take.
describe('RequirementDetail category select ordering + closed exclusion (req #3015)', { timeout: 15000 }, () => {
    beforeEach(() => { mountedRoots = []; });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('never offers a closed category, even when the query result includes one', async () => {
        const { container } = mount();
        await flush();

        await act(async () => { openCategorySelect(container); });
        await flush();

        expect(optionLabels()).not.toContain('Retired');
    });

    it('orders open categories by sort_order, nulls last and tie-broken by name', async () => {
        const { container } = mount();
        await flush();

        await act(async () => { openCategorySelect(container); });
        await flush();

        expect(optionLabels()).toEqual(['Alpha', 'Zebra', 'Amber', 'Beta']);
    });
});
