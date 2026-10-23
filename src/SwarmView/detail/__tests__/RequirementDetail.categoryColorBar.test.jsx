// @vitest-environment jsdom
//
// Req #3746 — the requirement editor draws the selected category's color bar to
// the left of "Category -" when (and only when) that category has a color.

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
    { id: 1, category_name: 'Alpha', sort_order: 1, closed: 0, color: '#e53935' },
    { id: 2, category_name: 'Beta',  sort_order: 2, closed: 0, color: null },
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
        useAllInitiatives: () => empty,
        useAllPipelineSteps: () => empty,
        useAllPipelineStepRequirements: () => empty,
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

let CATEGORY_FK = 1;
const requirementRow = {
    id: 42,
    title: 'sort me',
    description: '',
    category_fk: CATEGORY_FK,
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

describe('RequirementDetail category color bar (req #3746)', { timeout: 15000 }, () => {
    beforeEach(() => { mountedRoots = []; });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('shows the bar in the category color when the selected category has one', async () => {
        CATEGORY_FK = 1; requirementRow.category_fk = 1;
        const { container } = mount();
        await flush();
        const bar = container.querySelector('[data-testid="requirement-category-color-bar"]');
        expect(bar).not.toBeNull();
        expect(getComputedStyle(bar).backgroundColor).toBe('rgb(229, 57, 53)');
    });

    it('shows no bar when the selected category has no color', async () => {
        requirementRow.category_fk = 2;
        const { container } = mount();
        await flush();
        expect(container.querySelector('[data-testid="requirement-category-color-bar"]')).toBeNull();
    });
});
