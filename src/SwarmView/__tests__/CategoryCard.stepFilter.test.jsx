// @vitest-environment jsdom
//
// Req #3503 — the step filter as the CategoryCard actually applies it.
//
// The pure rules are pinned in `utils/__tests__/pipelineMembership.test.js`.
// Since req #3598 a scope RESTRICTS THE ROWS AND CHANGES NOTHING ELSE (user
// ruling, 2026-10-17): the orchestrated toggle applies as stored, the card
// renders even when it holds none of the step, and the add-a-requirement row
// stays. What only a mounted card can show:
//   1. the scope narrows the rows, on top of the toggle and the chips;
//   2. none of req #3503's overrides survive (forced toggle, hidden card,
//      suppressed add-row);
//   3. the two filters COMPOSE as an intersection rather than one winning.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarwinDndContext } from '../../dnd';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// See the initiative suite's note: the first mounted `it()` absorbs the cold
// module-compile cost of dnd-kit + MUI + this card.
vi.setConfig({ testTimeout: 30000 });

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

// 10 is on step 186, 11 is on step 187 — and BOTH are pipelined, which is the
// only state a step's work is ever in, and what makes rule 1 above load-bearing.
const reqData = [
    { id: 10, title: 'On the step', requirement_status: 'authoring', category_fk: 5, sort_order: 0 },
    { id: 11, title: 'On another step', requirement_status: 'authoring', category_fk: 5, sort_order: 1 },
];
const EMPTY_SESSIONS = [];
// The junction in the wire shape the REAL `useRequirementVisibility` reads, so
// the forces-the-toggle-off rule this file exists to test runs for real rather
// than being stubbed past. MODULE-LEVEL, never an inline literal: a fresh array
// per render churns the hook's memoized Sets and re-runs the card's seeding
// effect — a synchronous render loop, not a failing assertion.
const JUNCTION = [
    { step_fk: 186, requirement_fk: 10 },
    { step_fk: 187, requirement_fk: 11 },
];
const ALL_REQS = reqData.map(({ id }) => ({ id }));
vi.mock('../../hooks/useDataQueries', () => ({
    useRequirements: () => ({ data: reqData }),
    useSessions: () => ({ data: EMPTY_SESSIONS }),
    useAllPipelineStepRequirements: () => ({ data: JUNCTION }),
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
function mount({ stepReqIds = null, initiativeReqIds = null } = {}) {
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
                                stepReqIds={stepReqIds}
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

describe('CategoryCard under a step filter (req #3503)', () => {
    beforeEach(() => {
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

    it('the orchestrated toggle APPLIES under a step filter: stored ON hides the '
        + 'step\'s pipelined row (req #3598)', () => {
        const { container } = mount({ stepReqIds: new Set([10]) });
        expect(rowPresent(container, 10)).toBe(false);
    });

    it('with the toggle OFF, shows ONLY the step\'s rows', () => {
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
        const { container } = mount({ stepReqIds: new Set([10]) });
        expect(rowPresent(container, 10)).toBe(true);
        expect(rowPresent(container, 11)).toBe(false);
    });

    it('still renders the card when this category holds none of the step', () => {
        const { container } = mount({ stepReqIds: new Set([9999]) });
        expect(cardPresent(container)).toBe(true);
    });

    it('keeps the add-a-requirement row while filtered', () => {
        const { container } = mount({ stepReqIds: new Set([10]) });
        expect(container.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
    });

    it('never writes the store', () => {
        mount({ stepReqIds: new Set([10]) });
        expect(useShowClosedStore.getState().hidePipelinedRequirements).toBe(true);
    });

    it('COMPOSES with the initiative filter as an intersection, not as a winner', () => {
        // Both scopes arrive as props and neither is a mode of the other. The
        // initiative set holds both rows, the step set holds one — so one survives.
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
        const { container } = mount({
            initiativeReqIds: new Set([10, 11]), stepReqIds: new Set([11]),
        });
        expect(rowPresent(container, 11)).toBe(true);
        expect(rowPresent(container, 10)).toBe(false);
    });

    it('an initiative filter and a step filter with nothing in common leave the card '
        + 'with no rows, but on screen', () => {
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
        const { container } = mount({
            initiativeReqIds: new Set([10]), stepReqIds: new Set([11]),
        });
        expect(cardPresent(container)).toBe(true);
        expect(rowPresent(container, 10)).toBe(false);
        expect(rowPresent(container, 11)).toBe(false);
    });
});
