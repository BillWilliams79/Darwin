// @vitest-environment jsdom
//
// Req #3505 — the optional " (N)" requirement-count suffix on a category
// card's title. Mounts the REAL CategoryCard (harness mirrors
// CategoryCard.templatefocus.test.jsx) and drives the REAL
// useCategoryCountDisplayStore to assert: off by default, on shows the count
// excluding the template add-row, off hides it again, and the template
// "Add new category" card never shows a count regardless of the setting.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

let reqData = [
    { id: 10, title: 'Req A', requirement_status: 'authoring', category_fk: 5, sort_order: 0 },
    { id: 11, title: 'Req B', requirement_status: 'authoring', category_fk: 5, sort_order: 1 },
    { id: 12, title: 'Req C', requirement_status: 'authoring', category_fk: 5, sort_order: 2 },
];
const EMPTY_SESSIONS = [];
const EMPTY_JUNCTION = [];
const EMPTY_FEATURES = [];
const EMPTY_ALL_REQS = [];

vi.mock('../../hooks/useDataQueries', () => ({
    useRequirements: () => ({ data: reqData }),
    useSessions: () => ({ data: EMPTY_SESSIONS }),
    useAllRequirements: () => ({ data: EMPTY_ALL_REQS }),
    useAllPipelineStepRequirements: () => ({ data: EMPTY_JUNCTION }),
    useAllFeatures: () => ({ data: EMPTY_FEATURES }),
    ALL_ROWS: 'all',
}));

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

import CategoryCard from '../CategoryCard';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useCategoryCountDisplayStore } from '../../stores/useCategoryCountDisplayStore';

const CATEGORY = { id: 5, category_name: 'Test Cat', project_fk: 1, sort_mode: 'process', color: null };
const TEMPLATE_CATEGORY = { id: '', category_name: '', project_fk: 1, sort_mode: 'process', color: null };
const noop = () => {};

let bumpHarness;
function Harness({ category }) {
    const [, setTick] = useState(0);
    bumpHarness = () => setTick((t) => t + 1);
    return (
        <CategoryCard
            category={category}
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
            isTemplate={category.id === ''}
            showClosed={false}
        />
    );
}

let roots = [];
function mount(category) {
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
                            <Harness category={category} />
                        </DndProvider>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    return { container };
}

function countEl(container, categoryId) {
    return container.querySelector(`[data-testid="category-count-${categoryId}"]`);
}

describe('CategoryCard requirement-count suffix (req #3505)', () => {
    beforeEach(() => {
        reqData = [
            { id: 10, title: 'Req A', requirement_status: 'authoring', category_fk: 5, sort_order: 0 },
            { id: 11, title: 'Req B', requirement_status: 'authoring', category_fk: 5, sort_order: 1 },
            { id: 12, title: 'Req C', requirement_status: 'authoring', category_fk: 5, sort_order: 2 },
        ];
        roots = [];
        useCategoryCountDisplayStore.setState({ showCount: false });
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        useCategoryCountDisplayStore.setState({ showCount: false });
    });

    it('hides the count by default', async () => {
        const { container } = mount(CATEGORY);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(countEl(container, 5)).toBeNull();
    }, 30000);

    it('never flashes "(0)" while the requirements query is still in flight', async () => {
        // Simulates TanStack Query's real pre-resolution shape (`data: undefined`),
        // not this file's other tests' synchronously-resolved mock — the exact
        // window a naive `category.id !== '' && showCategoryCount` guard would
        // render "(0)" in, indistinguishable from a real empty count.
        reqData = undefined;
        useCategoryCountDisplayStore.setState({ showCount: true });
        const { container } = mount(CATEGORY);
        expect(countEl(container, 5)).toBeNull();

        // Query "resolves": the seeding effect now has real rows to work with.
        await act(async () => {
            reqData = [
                { id: 10, title: 'Req A', requirement_status: 'authoring', category_fk: 5, sort_order: 0 },
                { id: 11, title: 'Req B', requirement_status: 'authoring', category_fk: 5, sort_order: 1 },
                { id: 12, title: 'Req C', requirement_status: 'authoring', category_fk: 5, sort_order: 2 },
            ];
            bumpHarness();
        });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        const el = countEl(container, 5);
        expect(el).not.toBeNull();
        expect(el.textContent).toBe('(3)');
    }, 30000);

    it('shows "(3)" — excluding the template add-row — when the setting is on', async () => {
        const { container } = mount(CATEGORY);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        await act(async () => { useCategoryCountDisplayStore.getState().setShowCount(true); });
        const el = countEl(container, 5);
        expect(el).not.toBeNull();
        expect(el.textContent).toBe('(3)');
    }, 30000);

    it('hides the count again when toggled back off', async () => {
        const { container } = mount(CATEGORY);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        await act(async () => { useCategoryCountDisplayStore.getState().setShowCount(true); });
        expect(countEl(container, 5)).not.toBeNull();
        await act(async () => { useCategoryCountDisplayStore.getState().setShowCount(false); });
        expect(countEl(container, 5)).toBeNull();
    }, 30000);

    it('never shows a count on the template "Add new category" card', async () => {
        useCategoryCountDisplayStore.setState({ showCount: true });
        const { container } = mount(TEMPLATE_CATEGORY);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(container.querySelector('[data-testid^="category-count-"]')).toBeNull();
    }, 30000);
});
