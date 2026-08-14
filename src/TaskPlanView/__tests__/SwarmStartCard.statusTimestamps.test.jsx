// @vitest-environment jsdom
//
// Req #3244 — CategoryCard.jsx and SwarmStartCard.jsx are the two frontend
// writers named in the requirement's "FOUND BY" section: both PUT
// requirement_status alone, skipping the timestamp derivation darwin-mcp's
// update_requirement performs on the same transition. This asserts the two
// writers now AGREE — same status in, same PUT body shape out — by driving
// the real components rather than re-deriving the expectation independently.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

let reqData;
const EMPTY = [];
// req #3419 — MODULE-LEVEL, never an inline `[]` literal. Each of these is a
// query double called on every render; a fresh array each time churns the id
// Sets in `useRequirementVisibility`, which churns every predicate and filtered
// array downstream, which re-runs the seeding effect, which sets state — a
// SYNCHRONOUS render loop that no per-test timeout can interrupt. Measured in
// review: it wedged the worker rather than failing a test.
const EMPTY_JUNCTION = [];
const EMPTY_ALL_REQS = [];

vi.mock('../../hooks/useDataQueries', () => ({
    useRequirementsByStatus: () => ({ data: reqData }),
    useRequirementsDone: () => ({ data: EMPTY }),
    useSessions: () => ({ data: EMPTY }),
    useCategoryColors: () => ({ data: EMPTY }),
    useAllRequirements: () => ({ data: reqData }),

    // req #3419 — the three bounded reads `useRequirementVisibility` joins.
    // The REAL hook runs here rather than a double: it owns the memoization the
    // aggregator's `useMemo` chain depends on, and a stand-in that got that
    // wrong would loop rather than fail. `ALL_ROWS` is re-exported because the
    // hook passes it (a closed feature still seats its requirements).
    useAllPipelineStepRequirements: () => ({ data: EMPTY_JUNCTION }),
    ALL_ROWS: 'all',
}));

const putBodies = [];
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        if (method === 'PUT') putBodies.push(body);
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import SwarmStartCard from '../SwarmStartCard';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSwarmStartCardStore } from '../../stores/useSwarmStartCardStore';

let roots = [];
function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(container);
    roots.push(root);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <DndProvider backend={TouchBackend} options={{ enableMouseEvents: true }}>
                            <SwarmStartCard />
                        </DndProvider>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    return { container };
}

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

describe('SwarmStartCard status writes agree with CategoryCard (req #3244)', () => {
    beforeEach(() => {
        putBodies.length = 0;
        roots = [];
        reqData = [{ id: 20, title: 'agree with me', requirement_status: 'approved', category_fk: 5 }];
        useSwarmStartCardStore.setState({ selectedStatus: 'approved' });
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('sends all three NULL-sentinel timestamp columns alongside requirement_status', async () => {
        const { container } = mount();
        await flush();

        const toggle = container.querySelector('[data-testid="status-toggle-20"]');
        expect(toggle).not.toBeNull();

        await act(async () => { toggle.click(); });
        await flush();

        expect(putBodies).toHaveLength(1);
        const [[body]] = putBodies;
        expect(body).toEqual({
            id: 20,
            requirement_status: 'swarm_ready',
            started_at: 'NULL',
            completed_at: 'NULL',
            deferred_at: 'NULL',
        });
    });
});
