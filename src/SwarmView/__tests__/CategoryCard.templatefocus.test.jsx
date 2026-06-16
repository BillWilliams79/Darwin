// @vitest-environment jsdom
//
// Req #2884 reproduction harness — does a background-refetch re-seed of
// `requirementsArray` steal focus from the template title field in the card view?
// Mounts the REAL CategoryCard, focuses the template <textarea>, then simulates a
// background refetch returning new `serverRequirements` (the refetchOnWindowFocus
// path) and asserts whether focus survives.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

// Controllable query data. useRequirements returns the current module-level array
// (a new reference per re-seed); useSessions stays a stable empty list.
let reqData = [{ id: 10, title: 'Existing req', requirement_status: 'authoring', category_fk: 5, sort_order: 0 }];
const EMPTY_SESSIONS = [];
vi.mock('../../hooks/useDataQueries', () => ({
    useRequirements: () => ({ data: reqData }),
    useSessions: () => ({ data: EMPTY_SESSIONS }),
}));

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

import CategoryCard from '../CategoryCard';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

const CATEGORY = { id: 5, category_name: 'Test Cat', project_fk: 1, sort_mode: 'process', color: null };
const noop = () => {};

let bumpHarness;
function Harness() {
    const [, setTick] = useState(0);
    bumpHarness = () => setTick((t) => t + 1);
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

function templateTextarea(container) {
    return container.querySelector('[data-testid="requirement-template"] textarea:not([aria-hidden="true"])');
}

describe('CategoryCard template title keeps focus across a background re-seed (req #2884)', () => {
    beforeEach(() => {
        reqData = [{ id: 10, title: 'Existing req', requirement_status: 'authoring', category_fk: 5, sort_order: 0 }];
        roots = [];
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('keeps focus on the template title when serverRequirements refetches', async () => {
        const { container } = mount();

        const ta = templateTextarea(container);
        expect(ta).not.toBeNull();

        // User clicks into the template title field.
        await act(async () => { ta.focus(); });
        expect(document.activeElement).toBe(ta);

        // Background refetch lands: a NEW requirement appears, shifting the template's
        // index (1 → 2). This is the decisive case for index-vs-key reconciliation.
        await act(async () => {
            reqData = [
                { id: 10, title: 'Existing req', requirement_status: 'authoring', category_fk: 5, sort_order: 0 },
                { id: 11, title: 'Brand new req', requirement_status: 'authoring', category_fk: 5, sort_order: 1 },
            ];
            bumpHarness();
        });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        // The template field must still be focused.
        const taAfter = templateTextarea(container);
        expect(taAfter).not.toBeNull();
        expect(document.activeElement).toBe(taAfter);
    });
});
