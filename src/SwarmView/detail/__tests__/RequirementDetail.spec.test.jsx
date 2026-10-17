// @vitest-environment jsdom
//
// Req #3573 — the Spec field. Shows the live five-letter spec code and, while
// the requirement is pre-launch, a typed code sets all four launch fields in ONE
// PUT. Harness copied from RequirementDetail.statusTimestamps.test.jsx.

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

const specInput = (container) => container.querySelector('[data-testid="requirement-spec-input"]');
const specReading = (container) => container.querySelector('[data-testid="requirement-spec-reading"]').textContent;

async function typeSpec(container, value, key = 'Enter') {
    const input = specInput(container);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
    await flush();
}

function baseRequirement(overrides = {}) {
    return {
        id: 42, title: 'spec me', description: '', category_fk: 1,
        requirement_status: 'swarm_ready', coordination_type: 'implemented',
        ai_model: 'opus', effort: 'high', machine_fk: null,
        started_at: null, completed_at: null, deferred_at: null,
        create_ts: null, update_ts: null,
        ...overrides,
    };
}

describe('RequirementDetail Spec field (req #3573)', { timeout: 15000 }, () => {
    beforeEach(() => {
        putBodies.length = 0;
        requirementRow = baseRequirement();
        mountedRoots = [];
    });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('shows the live code and its long-form reading', async () => {
        const { container } = mount();
        await flush();
        expect(specInput(container).value).toBe('SRIOH');
        expect(specReading(container)).toBe('Swarm Ready · Implemented · Opus · High');
    });

    it('a typed code sets only the changed fields in one PUT', async () => {
        const { container } = mount();
        await flush();
        await typeSpec(container, 'srism');

        expect(putBodies).toHaveLength(1);
        expect(putBodies[0]).toEqual([{ id: 42, ai_model: 'sonnet', effort: 'medium' }]);
        expect(specInput(container).value).toBe('SRISM');
    });

    it('a status change carries the derived timestamp columns', async () => {
        const { container } = mount();
        await flush();
        await typeSpec(container, 'AUDOH');

        const [[body]] = putBodies;
        expect(body).toMatchObject({ id: 42, requirement_status: 'authoring', coordination_type: 'deployed' });
        expect(body.started_at).toBe('NULL');
        expect(body.completed_at).toBe('NULL');
        expect(body.deferred_at).toBe('NULL');
    });

    it('refuses an invalid code and writes nothing', async () => {
        const { container } = mount();
        await flush();
        await typeSpec(container, 'SRIOZ');
        expect(putBodies).toHaveLength(0);
        expect(specReading(container)).toMatch(/Not a spec code/);
    });

    it('refuses a post-launch status', async () => {
        const { container } = mount();
        await flush();
        await typeSpec(container, 'MTIOH');
        expect(putBodies).toHaveLength(0);
        expect(specReading(container)).toMatch(/AU, AP or SR/);
    });

    it('Escape discards the draft', async () => {
        const { container } = mount();
        await flush();
        await typeSpec(container, 'SRDFX', 'Escape');
        expect(putBodies).toHaveLength(0);
        expect(specInput(container).value).toBe('SRIOH');
    });

    it('is read-only once the work has launched', async () => {
        requirementRow = baseRequirement({ requirement_status: 'development' });
        const { container } = mount();
        await flush();
        expect(specInput(container).value).toBe('DVIOH');
        expect(specInput(container).disabled).toBe(true);
    });
});
