// @vitest-environment jsdom
//
// Req #3258 — Cards view joins the Table view's `hidePipelinedRequirements`
// toggle (req #3180). Mounts the REAL CategoryCard against a controllable
// `usePipelinedRequirementIds` mock and the REAL useShowClosedStore, and
// asserts the toggle actually removes/restores the row in this view too.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

const reqData = [
    { id: 10, title: 'Not pipelined', requirement_status: 'authoring', category_fk: 5, sort_order: 0 },
    { id: 11, title: 'Pipelined', requirement_status: 'authoring', category_fk: 5, sort_order: 1 },
];
const EMPTY_SESSIONS = [];
let pipelinedIds = new Set([11]);
vi.mock('../../hooks/useDataQueries', () => ({
    useRequirements: () => ({ data: reqData }),
    useSessions: () => ({ data: EMPTY_SESSIONS }),
    usePipelinedRequirementIds: () => pipelinedIds,
}));

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

import CategoryCard from '../CategoryCard';
import { useShowClosedStore } from '../../stores/useShowClosedStore';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

const CATEGORY = { id: 5, category_name: 'Test Cat', project_fk: 1, sort_mode: 'process', color: null };
const noop = () => {};

function Harness() {
    const [, setTick] = useState(0);
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

// RequirementRow.jsx renders each real row's container as
// `data-testid="requirement-<id>"` (the template row is `requirement-template`).
const rowPresent = (container, id) => container.querySelector(`[data-testid="requirement-${id}"]`) !== null;

describe('CategoryCard hides/shows pipelined requirements with the shared toggle (req #3258)', () => {
    beforeEach(() => {
        pipelinedIds = new Set([11]);
        roots = [];
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
    });

    it('toggle OFF (no longer the default since req #3242 — set explicitly here): both rows render', () => {
        const { container } = mount();
        expect(rowPresent(container, 10)).toBe(true);
        expect(rowPresent(container, 11)).toBe(true);
    });

    it('toggle ON: the pipelined row is hidden, the other stays', async () => {
        const { container } = mount();

        await act(async () => {
            useShowClosedStore.getState().toggleHidePipelinedRequirements();
        });

        expect(rowPresent(container, 10)).toBe(true);
        expect(rowPresent(container, 11)).toBe(false);
    });

    it('toggle ON then OFF: the pipelined row returns', async () => {
        const { container } = mount();

        await act(async () => {
            useShowClosedStore.getState().toggleHidePipelinedRequirements();
        });
        expect(rowPresent(container, 11)).toBe(false);

        await act(async () => {
            useShowClosedStore.getState().toggleHidePipelinedRequirements();
        });
        expect(rowPresent(container, 11)).toBe(true);
    });
});
