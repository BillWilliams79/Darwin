// @vitest-environment jsdom
//
// Req #3244 — CategoryCard.jsx's status-toggle PUT must send all three
// timestamp columns (started_at/completed_at/deferred_at), matching darwin-mcp's
// update_requirement derivation, not just requirement_status alone. See the
// sibling SwarmStartCard test for the "two writers agree" half of this.

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
const EMPTY_SESSIONS = [];
// req #3419 — MODULE-LEVEL, never an inline `[]` literal. Each of these is a
// query double called on every render; a fresh array each time churns the id
// Sets in `useRequirementVisibility`, which churns every predicate and filtered
// array downstream, which re-runs the seeding effect, which sets state — a
// SYNCHRONOUS render loop that no per-test timeout can interrupt. Measured in
// review: it wedged the worker rather than failing a test.
const EMPTY_JUNCTION = [];
const EMPTY_FEATURES = [];
const EMPTY_ALL_REQS = [];

vi.mock('../../hooks/useDataQueries', () => ({
    useRequirements: () => ({ data: reqData }),
    useSessions: () => ({ data: EMPTY_SESSIONS }),
    // CategoryCard.jsx:212 calls this; a factory that omits it makes the whole
    // file throw at import. Not this suite's subject — no requirement here is
    // pipelined — so an empty set is the neutral value. (Added by req #3298:
    // the export arrived with commit e2dfc8c and only the sibling
    // CategoryCard.pipelinedFilter suite was updated, leaving this one red.)
    useAllRequirements: () => ({ data: EMPTY_ALL_REQS }),

    // req #3419 — the three bounded reads `useRequirementVisibility` joins.
    // The REAL hook runs here rather than a double: it owns the memoization the
    // aggregator's `useMemo` chain depends on, and a stand-in that got that
    // wrong would loop rather than fail. `ALL_ROWS` is re-exported because the
    // hook passes it (a closed feature still seats its requirements).
    useAllPipelineStepRequirements: () => ({ data: EMPTY_JUNCTION }),
    useAllFeatures: () => ({ data: EMPTY_FEATURES }),
    ALL_ROWS: 'all',
}));

const putBodies = [];
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        if (method === 'PUT') putBodies.push(body);
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import CategoryCard from '../CategoryCard';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

const CATEGORY = { id: 5, category_name: 'Test Cat', project_fk: 1, sort_mode: 'process', color: null };
const noop = () => {};

function Harness() {
    return (
        <CategoryCard
            category={CATEGORY}
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
}

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
                            <Harness />
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

describe('CategoryCard status writes carry all three timestamp columns (req #3244)', () => {
    beforeEach(() => {
        putBodies.length = 0;
        roots = [];
        reqData = [{ id: 20, title: 'agree with me', requirement_status: 'approved', category_fk: 5, sort_order: 0 }];
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    // req #3419 — explicit timeout. This file mounts the REAL CategoryCard,
    // which since this requirement resolves visibility through three live
    // queries before it can seed a row. Measured at 4.2s on a loaded machine
    // against vitest's 5s default — passing, but close enough that the suite
    // flakes. The work is slow, not hung; the same allowance its sibling
    // CategoryCard specs already carry.
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
    }, 30000);
});
