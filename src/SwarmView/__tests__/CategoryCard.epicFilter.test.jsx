// @vitest-environment jsdom
//
// Req #3428 — the epic filter as the CategoryCard actually applies it.
//
// The pure rules are pinned in `utils/__tests__/epicMembership.test.js`; this
// suite exists for the three things only a mounted card can show, and all three
// are places where the feature silently fails rather than errors:
//   1. the forced pipeline override — without it this page renders EMPTY, because
//      `hidePipelinedRequirements` defaults to ON and an epic's requirements are
//      seated in pipeline steps by construction;
//   2. a card with none of the epic's work renders NOTHING, which is the
//      requirement's "only those categories that have requirements from the epic";
//   3. the add-a-requirement row stands down, because a row saved there would
//      belong to no epic and vanish on save.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The first mounted `it()` in a file absorbs the cold module-compile cost of the
// component tree (react-dnd + MUI + this page), which on a loaded machine is
// measured at 5-8s against vitest's 5000ms default — red in CI about half the
// time, for nothing. File-scoped rather than a global config change, so no other
// suite's timeout moves.
vi.setConfig({ testTimeout: 30000 });

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

// 10 is in the epic, 11 is not — and BOTH are pipelined, which is the ordinary
// state of an epic's work and the state that makes rule 1 above load-bearing.
const reqData = [
    { id: 10, title: 'In the epic', requirement_status: 'authoring', category_fk: 5, feature_fk: 46, sort_order: 0 },
    { id: 11, title: 'Another epic', requirement_status: 'authoring', category_fk: 5, feature_fk: 50, sort_order: 1 },
];
const EMPTY_SESSIONS = [];
let pipelinedIds = new Set([10, 11]);
// req #3419 MERGE — `usePipelinedRequirementIds` is gone; the REAL
// `useRequirementVisibility` now owns both the id set and the epic override
// (`effectiveHidePipelined` moved inside it). Feed it the three bounded reads it
// joins, as the wire shapes they arrive in, so the epic-forces-toggle-off rule
// this file exists to test is exercised for real rather than stubbed past.
//
// MODULE-LEVEL constants, never inline `[]` literals: a fresh array per render
// churns the hook's memoized Sets and re-runs the card's seeding effect, which
// is a synchronous render loop rather than a failing assertion.
const JUNCTION = [...pipelinedIds].map((id) => ({ step_fk: 1, requirement_fk: id }));
const ALL_REQS = reqData.map(({ id, feature_fk }) => ({ id, feature_fk }));
const FEATURES = [{ id: 46, epic_fk: 11 }, { id: 50, epic_fk: 12 }];
vi.mock('../../hooks/useDataQueries', () => ({
    useRequirements: () => ({ data: reqData }),
    useSessions: () => ({ data: EMPTY_SESSIONS }),
    useAllPipeline2StepRequirements: () => ({ data: JUNCTION }),
    useAllRequirements: () => ({ data: ALL_REQS }),
    useAllFeatures: () => ({ data: FEATURES }),
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
function mount(epicReqIds) {
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

describe('CategoryCard under an epic filter (req #3428)', () => {
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

    it('shows the epic\'s row even though it is pipelined and the toggle is ON', () => {
        // The defect this closes: with `hidePipelined` left in charge, the page
        // the epic link opens is blank, and nothing anywhere reports an error.
        const { container } = mount(new Set([10]));
        expect(rowPresent(container, 10)).toBe(true);
    });

    it('shows ONLY the epic\'s rows', () => {
        const { container } = mount(new Set([10]));
        expect(rowPresent(container, 11)).toBe(false);
    });

    it('renders no card at all when this category holds none of the epic', () => {
        const { container } = mount(new Set([9999]));
        expect(cardPresent(container)).toBe(false);
    });

    it('suppresses the add-a-requirement row while filtered', () => {
        const { container } = mount(new Set([10]));
        expect(container.querySelector('[data-testid="requirement-template"]')).toBeNull();
    });

    it('with NO filter (null), behaves exactly as before — both the toggle and '
        + 'the template row are back in charge', () => {
        const { container } = mount(null);
        // The stored toggle is ON and both rows are pipelined, so the unfiltered
        // card is empty of rows but still RENDERS, template and all.
        expect(cardPresent(container)).toBe(true);
        expect(rowPresent(container, 10)).toBe(false);
        expect(rowPresent(container, 11)).toBe(false);
        expect(container.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
    });

    it('never writes the store — dismissing the filter restores what the reader had', () => {
        mount(new Set([10]));
        expect(useShowClosedStore.getState().hidePipelinedRequirements).toBe(true);
    });
});
