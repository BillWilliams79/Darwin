// @vitest-environment jsdom
//
// Req #3737 — deleting a requirement leaves the page the way Back would: one
// opened from a plan returns to that plan's view (the camera restores from
// storage, req #3637), not to the Roadmap.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let locationState = null;
const navigateCalls = [];
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useParams: () => ({ id: '42' }),
        useNavigate: () => (...args) => navigateCalls.push(args),
        useLocation: () => ({ state: locationState }),
    };
});

vi.mock('../../../hooks/factory/createEntityQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        fetchEntity: vi.fn((uri) => Promise.resolve(
            String(uri).includes('/categories')
                ? [{ id: 11, category_name: 'Darwin', sort_order: 1, closed: 0 }]
                : [])),
    };
});

const restCalls = [];
vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri: String(uri), method, body });
        if (String(uri).includes('/requirements?id=42') && method === 'GET') {
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [{
                id: 42, title: 'Doomed', description: '', category_fk: 11,
                requirement_status: 'swarm_ready', coordination_type: 'implemented',
                ai_model: 'opus', effort: 'high', tracking: 0 }] });
        }
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

vi.mock('../../../stores/useSnackBarStore', () => ({
    useSnackBarStore: (selector) => selector({
        showError: () => {}, close: () => {}, open: false, message: '',
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

async function deleteRequirement(container) {
    await act(async () => {
        container.querySelector('[data-testid="btn-delete-requirement"]').click();
    });
    await flush();
    const confirm = Array.from(document.querySelectorAll(
        '[data-testid="requirement-delete-dialog"] button'))[0];
    await act(async () => { confirm.click(); });
    await flush();
}

describe('RequirementDetail delete returns where the reader came from (req #3737)', { timeout: 15000 }, () => {
    beforeEach(() => {
        mountedRoots = [];
        restCalls.length = 0;
        navigateCalls.length = 0;
    });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('opened from the plan visualizer: returns to that plan, in its mode', async () => {
        locationState = { from: 'pipeline', pipelineId: 7, mode: 'plan', backEpicId: 412 };
        const { container } = mount();
        await flush();
        await deleteRequirement(container);
        expect(restCalls.filter((c) => c.method === 'DELETE').map((c) => c.body)).toEqual([{ id: 42 }]);
        expect(navigateCalls.at(-1)).toEqual(['/swarm/pipeline/7?mode=plan']);
    });

    it('opened from the calendar: returns to the calendar', async () => {
        locationState = { from: 'calendar' };
        const { container } = mount();
        await flush();
        await deleteRequirement(container);
        expect(navigateCalls.at(-1)).toEqual(['/calview']);
    });

    it('opened with no origin: returns to the Roadmap as before', async () => {
        locationState = null;
        const { container } = mount();
        await flush();
        await deleteRequirement(container);
        expect(navigateCalls.at(-1)).toEqual(['/swarm']);
    });
});
