// @vitest-environment jsdom
//
// Req #3244 — a requirement_status transition made from the Darwin UI must leave
// the same timestamps a transition made through MCP leaves
// (darwin-mcp/services/requirements.py::update_requirement). This exercises the
// REAL RequirementDetail component and asserts the PUT body it sends.

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

// Req #3435 — the Orchestration box added six list reads to every mount of this
// page. This suite is about status timestamps and uses none of them, so they are stubbed
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
    };
}

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        ...orchestrationStubs(),
        useMachines: () => ({ data: [] }),
        useAllCategories: () => ({ data: [{ id: 1, category_name: 'Swarm' }] }),
    };
});

let requirementRow;
const putBodies = [];
vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        if (method === 'PUT') {
            putBodies.push(body);
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
        }
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

const statusChip = (container, value) => container.querySelector(`[data-testid="state-${value}"]`);

function baseRequirement(overrides = {}) {
    return {
        id: 42,
        title: 'stamp me',
        description: '',
        category_fk: 1,
        requirement_status: 'swarm_ready',
        coordination_type: 'implemented',
        ai_model: 'opus',
        effort: 'xhigh',
        machine_fk: null,
        started_at: null, completed_at: null, deferred_at: null,
        create_ts: null, update_ts: null,
        ...overrides,
    };
}

// Req #3435 — 15s, not vitest's 5000ms default. These cases MOUNT THE WHOLE
// requirement page in jsdom, and the first one in a file also pays module init
// for MUI. Measured before this requirement, the slowest case here already took
// ~4s of the 5s budget, so the default was a latent flake rather than a real
// ceiling; the Orchestration box's two extra MUI Selects are what pushed it
// over. The assertions below are unchanged — only the budget they may take.
describe('RequirementDetail status timestamp derivation (req #3244)', { timeout: 15000 }, () => {
    beforeEach(() => {
        putBodies.length = 0;
        requirementRow = baseRequirement();
        mountedRoots = [];
    });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('stamps completed_at (and clears the others) when moved to met through the UI', async () => {
        const { container } = mount();
        await flush();

        await act(async () => { statusChip(container, 'met').click(); });
        await flush();

        expect(putBodies).toHaveLength(1);
        const [[body]] = putBodies;
        expect(body.id).toBe(42);
        expect(body.requirement_status).toBe('met');
        expect(body.started_at).toBe('NULL');
        expect(body.deferred_at).toBe('NULL');
        expect(typeof body.completed_at).toBe('string');
        expect(Number.isNaN(new Date(body.completed_at).getTime())).toBe(false);
    });

    it('stamps started_at (and clears the others) when moved to development', async () => {
        const { container } = mount();
        await flush();

        await act(async () => { statusChip(container, 'development').click(); });
        await flush();

        const [[body]] = putBodies;
        expect(body.requirement_status).toBe('development');
        expect(typeof body.started_at).toBe('string');
        expect(body.completed_at).toBe('NULL');
        expect(body.deferred_at).toBe('NULL');
    });

    it('stamps deferred_at (and clears the others) when moved to deferred', async () => {
        const { container } = mount();
        await flush();

        await act(async () => { statusChip(container, 'deferred').click(); });
        await flush();

        const [[body]] = putBodies;
        expect(body.requirement_status).toBe('deferred');
        expect(body.started_at).toBe('NULL');
        expect(body.completed_at).toBe('NULL');
        expect(typeof body.deferred_at).toBe('string');
    });

    it('clears all three when moved back to authoring', async () => {
        const { container } = mount();
        await flush();

        await act(async () => { statusChip(container, 'authoring').click(); });
        await flush();

        const [[body]] = putBodies;
        expect(body.requirement_status).toBe('authoring');
        expect(body.started_at).toBe('NULL');
        expect(body.completed_at).toBe('NULL');
        expect(body.deferred_at).toBe('NULL');
    });
});
