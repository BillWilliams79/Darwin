// @vitest-environment jsdom
//
// Req #3503 — the step filter as the CategoryCard actually applies it.
//
// The pure rules are pinned in `utils/__tests__/pipelineMembership.test.js`; this
// suite exists for the four things only a mounted card can show, and all four are
// places where the behavior silently fails rather than errors:
//   1. the forced pipeline override — without it this page renders EMPTY, and
//      unlike the epic case it renders empty ALWAYS: `hidePipelinedRequirements`
//      defaults to ON and a step's requirements are on a step BY DEFINITION;
//   2. a card with none of the step's work renders NOTHING;
//   3. the add-a-requirement row stands down, because a row saved there sits on
//      no step and would vanish from the page that offered the control;
//   4. the two filters COMPOSE as an intersection rather than one winning.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// See the epic suite's note: the first mounted `it()` absorbs the cold
// module-compile cost of react-dnd + MUI + this card.
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
function mount({ stepReqIds = null, epicReqIds = null } = {}) {
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
                                epicReqIds={epicReqIds}
                                stepReqIds={stepReqIds}
                            />
                        </DndProvider>
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

    it('shows the step\'s row even though it is pipelined and the toggle is ON', () => {
        // The defect this closes: with `hidePipelined` left in charge, the page
        // the badge opens is blank, always, and nothing anywhere reports an error.
        const { container } = mount({ stepReqIds: new Set([10]) });
        expect(rowPresent(container, 10)).toBe(true);
    });

    it('shows ONLY the step\'s rows', () => {
        const { container } = mount({ stepReqIds: new Set([10]) });
        expect(rowPresent(container, 11)).toBe(false);
    });

    it('renders no card at all when this category holds none of the step', () => {
        const { container } = mount({ stepReqIds: new Set([9999]) });
        expect(cardPresent(container)).toBe(false);
    });

    it('suppresses the add-a-requirement row while filtered', () => {
        const { container } = mount({ stepReqIds: new Set([10]) });
        expect(container.querySelector('[data-testid="requirement-template"]')).toBeNull();
    });

    it('with NO filter (null), behaves exactly as before — both the toggle and '
        + 'the template row are back in charge', () => {
        const { container } = mount();
        // The stored toggle is ON and both rows are pipelined, so the unfiltered
        // card is empty of rows but still RENDERS, template and all.
        expect(cardPresent(container)).toBe(true);
        expect(rowPresent(container, 10)).toBe(false);
        expect(rowPresent(container, 11)).toBe(false);
        expect(container.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
    });

    it('never writes the store — dismissing the filter restores what the reader had', () => {
        mount({ stepReqIds: new Set([10]) });
        expect(useShowClosedStore.getState().hidePipelinedRequirements).toBe(true);
    });

    it('COMPOSES with the epic filter as an intersection, not as a winner', () => {
        // Both scopes arrive as props and neither is a mode of the other. The
        // epic set holds both rows, the step set holds one — so one survives.
        const { container } = mount({
            epicReqIds: new Set([10, 11]), stepReqIds: new Set([11]),
        });
        expect(rowPresent(container, 11)).toBe(true);
        expect(rowPresent(container, 10)).toBe(false);
    });

    it('an epic filter and a step filter with nothing in common leave no card', () => {
        const { container } = mount({
            epicReqIds: new Set([10]), stepReqIds: new Set([11]),
        });
        expect(cardPresent(container)).toBe(false);
    });
});
