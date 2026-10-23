// @vitest-environment jsdom
//
// Req #3428 — the initiative filter as the CategoryCard actually applies it.
//
// The pure rules are pinned in `utils/__tests__/initiativeMembership.test.js`. Since
// req #3598 a scope RESTRICTS THE ROWS AND CHANGES NOTHING ELSE (user ruling,
// 2026-10-17), so this suite pins that req #3428's three overrides are gone:
//   1. the orchestrated toggle applies as stored (no forced override);
//   2. a card with none of the initiative's work still renders;
//   3. the add-a-requirement row stays.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarwinDndContext } from '../../dnd';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The first mounted `it()` in a file absorbs the cold module-compile cost of the
// component tree (dnd-kit + MUI + this page), which on a loaded machine is
// measured at 5-8s against vitest's 5000ms default — red in CI about half the
// time, for nothing. File-scoped rather than a global config change, so no other
// suite's timeout moves.
vi.setConfig({ testTimeout: 30000 });

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

// 10 is in the initiative, 11 is not — and BOTH are pipelined, which is the ordinary
// state of an initiative's work and the state that makes rule 1 above load-bearing.
const reqData = [
    { id: 10, title: 'In the initiative', requirement_status: 'authoring', category_fk: 5, sort_order: 0 },
    { id: 11, title: 'Another initiative', requirement_status: 'authoring', category_fk: 5, sort_order: 1 },
];
const EMPTY_SESSIONS = [];
let pipelinedIds = new Set([10, 11]);
// req #3419 MERGE — `usePipelinedRequirementIds` is gone; the REAL
// `useRequirementVisibility` now owns both the id set and the initiative override
// (`effectiveHidePipelined` moved inside it). Feed it the three bounded reads it
// joins, as the wire shapes they arrive in, so the initiative-forces-toggle-off rule
// this file exists to test is exercised for real rather than stubbed past.
//
// MODULE-LEVEL constants, never inline `[]` literals: a fresh array per render
// churns the hook's memoized Sets and re-runs the card's seeding effect, which
// is a synchronous render loop rather than a failing assertion.
const JUNCTION = [...pipelinedIds].map((id) => ({ epic_fk: 1, requirement_fk: id }));
const ALL_REQS = reqData.map(({ id }) => ({ id }));
vi.mock('../../hooks/useDataQueries', () => ({
    useRequirements: () => ({ data: reqData }),
    useSessions: () => ({ data: EMPTY_SESSIONS }),
    useAllPipelineEpicRequirements: () => ({ data: JUNCTION }),
    useAllRequirements: () => ({ data: ALL_REQS }),
    ALL_ROWS: 'all',
}));

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

import CategoryCard from '../CategoryCard';
import { useShowClosedStore } from '../../stores/useShowClosedStore';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

const CATEGORY = { id: 5, category_name: 'Test Cat', project_fk: 1, sort_mode: 'process', color: null };
const noop = () => {};

let roots = [];
function mount(initiativeReqIds) {
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
                        <DarwinDndContext>
                            <CategoryCard
                                category={CATEGORY}
                                categoryIndex={0}
                                projectId={1}
                                categoryChange={noop}
                                categoryKeyDown={noop}
                                categoryOnBlur={noop}
                                clickCardClosed={noop}
                                clickCardDelete={noop}
                                isTemplate={false}
                                showClosed={false}
                                initiativeReqIds={initiativeReqIds}
                            />
                        </DarwinDndContext>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    return { container };
}

const rowPresent = (container, id) => container.querySelector(`[data-testid="requirement-${id}"]`) !== null;
const cardPresent = (container) => container.querySelector('[data-testid="category-card-5"]') !== null;

describe('CategoryCard under an initiative filter (req #3428)', () => {
    beforeEach(() => {
        pipelinedIds = new Set([10, 11]);
        roots = [];
        // THE SHIPPED DEFAULT (req #3242), stated explicitly because it is the
        // whole point of the first test below.
        useShowClosedStore.setState({ hidePipelinedRequirements: true });
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
    });

    it('the orchestrated toggle APPLIES under an initiative filter: stored ON hides the '
        + 'initiative\'s pipelined row (req #3598)', () => {
        const { container } = mount(new Set([10]));
        expect(rowPresent(container, 10)).toBe(false);
    });

    it('with the toggle OFF, shows ONLY the initiative\'s rows', () => {
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
        const { container } = mount(new Set([10]));
        expect(rowPresent(container, 10)).toBe(true);
        expect(rowPresent(container, 11)).toBe(false);
    });

    it('still renders the card when this category holds none of the initiative', () => {
        const { container } = mount(new Set([9999]));
        expect(cardPresent(container)).toBe(true);
    });

    it('keeps the add-a-requirement row while filtered', () => {
        const { container } = mount(new Set([10]));
        expect(container.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
    });

    it('with NO filter (null), behaves exactly as before', () => {
        const { container } = mount(null);
        // The stored toggle is ON and both rows are pipelined, so the unfiltered
        // card is empty of rows but still RENDERS, template and all.
        expect(cardPresent(container)).toBe(true);
        expect(rowPresent(container, 10)).toBe(false);
        expect(rowPresent(container, 11)).toBe(false);
        expect(container.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
    });

    it('never writes the store', () => {
        mount(new Set([10]));
        expect(useShowClosedStore.getState().hidePipelinedRequirements).toBe(true);
    });
});
