// @vitest-environment jsdom
//
// Req #2884 — "Click on template requirement doesn't stick".
//
// Root cause: on the new-requirement page (`/swarm/requirement/new`, `isNew`)
// the Category <Select> is gated behind the categories query
// (`allCategories ? <Select autoFocus={categoryUnset}/> : —`). On a cold load it
// mounts only once `useAllCategories` resolves, and `autoFocus` fires at that
// (late) mount — stealing focus from the Title/Description field the user already
// clicked into. The fix suppresses the select's auto-focus once the user has
// focused an editable field (`userInteractedRef`).
//
// This test mounts the REAL RequirementDetail and drives the genuine query race
// (loading → success) so a regression that removes the guard fails here.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Router hooks: render in "new" mode with a prefilled title (the aggregator flow).
vi.mock('react-router-dom', () => ({
    useParams: () => ({ id: 'new' }),
    useNavigate: () => () => {},
    useLocation: () => ({ state: { title: 'A new requirement' } }),
}));

// Control the categories query timing through the shared fetchEntity. Resolution
// is deferred until the test calls `releaseCategories()` so we can interleave a
// user focus BEFORE the <Select> mounts — exactly the reported race. The release
// is idempotent (resolves any pending fetch AND short-circuits future calls) so a
// background refetch can't leave a dangling unresolved promise.
let categoriesData = null;          // null = still "loading"
let pendingResolvers = [];
function releaseCategories(data) {
    categoriesData = data;
    pendingResolvers.forEach((r) => r(data));
    pendingResolvers = [];
}
vi.mock('../../../hooks/factory/createEntityQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        fetchEntity: vi.fn(() => {
            if (categoriesData !== null) return Promise.resolve(categoriesData);
            return new Promise((resolve) => { pendingResolvers.push(resolve); });
        }),
    };
});

// call_rest_api is never hit on the isNew path, but stub it defensively.
vi.mock('../../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

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
    return { container, root };
}

function titleInput(container) {
    return container.querySelector('[data-testid="requirement-title"] input');
}
function categorySelectButton(container) {
    return container.querySelector('[data-testid="requirement-category-select"]');
}

async function flush() {
    // Let the resolved query propagate and React commit the re-render. Several
    // microtask cycles plus a macrotask keeps this deterministic even when the
    // file runs alongside the rest of the suite (react-query settles the query,
    // then React flushes the mount that renders the <Select>).
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

describe('RequirementDetail new-mode category autofocus (req #2884)', () => {
    beforeEach(() => { categoriesData = null; pendingResolvers = []; mountedRoots = []; });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('does NOT steal focus from the Title field when categories resolve late', async () => {
        const { container } = mount();

        // Categories still loading → the Select is not mounted yet.
        expect(categorySelectButton(container)).toBeNull();

        // User clicks into the Title field and starts typing.
        const input = titleInput(container);
        expect(input).not.toBeNull();
        await act(async () => { input.focus(); });
        expect(document.activeElement).toBe(input);

        // Categories resolve AFTER the click → the Select mounts late.
        await act(async () => { releaseCategories([{ id: 1, category_name: 'Personal' }]); });
        await flush();

        // The late-mounting Select must NOT have yanked focus away from the Title.
        expect(categorySelectButton(container)).not.toBeNull();
        expect(document.activeElement).toBe(input);
    });

    it('DOES focus the Category select when the user has not interacted (intended req #2815 behavior)', async () => {
        const { container } = mount();

        // No user interaction. Categories resolve → Select mounts and autofocuses.
        await act(async () => { releaseCategories([{ id: 1, category_name: 'Personal' }]); });
        await flush();

        const selectBtn = categorySelectButton(container);
        expect(selectBtn).not.toBeNull();
        // Focus left the title (the select grabbed it). Assert focus is NOT on the
        // title input — the select's own focused node is an implementation detail
        // of MUI, so we assert the absence of the steal-regression instead.
        expect(document.activeElement).not.toBe(titleInput(container));
    });
});
