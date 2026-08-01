// @vitest-environment jsdom
//
// Req #3139 — the epic filter chip on /swarm/features is now the way BACK to
// the Epics editor.
//
// One chip, two controls: the body navigates, the ✕ clears the filter. That
// split rests entirely on MUI stopping propagation inside its own delete-icon
// handler before calling onDelete — a library internal, not our code. If a MUI
// upgrade ever drops it, dismissing the filter would silently navigate away
// from the page the user is standing on instead, and nothing else in the suite
// would notice. Hence a test that owns the assumption rather than inheriting it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigations = [];
let searchParams;
const setSearchParams = vi.fn((next) => { searchParams = next; });

vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal()),
    useNavigate: () => (to) => navigations.push(to),
    useSearchParams: () => [searchParams, setSearchParams],
}));

vi.mock('../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useAllFeatures: () => ({ data: [], isLoading: false }),
        useAllEpics: () => ({ data: [{ id: 4, title: 'Pipeline' }] }),
        useAllCategories: () => ({ data: [] }),
        useFeatureTestCaseLinks: () => ({ data: [] }),
    };
});

vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

import FeaturesPage from '../FeaturesPage';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

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
                <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <FeaturesPage />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    mountedRoots.push(root);
}

const chip = () => document.body.querySelector('[data-testid="epic-filter-chip"]');

beforeEach(() => {
    navigations.length = 0;
    setSearchParams.mockClear();
    mountedRoots = [];
    searchParams = new URLSearchParams('epic=4');
    // 'cards' is the default view; keep the DataGrid out of jsdom entirely.
    localStorage.clear();
});

afterEach(() => {
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
});

describe('FeaturesPage epic filter chip (req #3139)', () => {
    it('renders the filtering epic by title', () => {
        mount();
        expect(chip()).not.toBeNull();
        expect(chip().textContent).toContain('Epic: Pipeline');
    });

    it('opens the Epics editor when the chip body is clicked', () => {
        mount();
        act(() => { chip().click(); });
        expect(navigations).toEqual(['/swarm/epics']);
    });

    it('clears the filter — and does NOT navigate — when the ✕ is clicked', () => {
        mount();
        const deleteIcon = chip().querySelector('.MuiChip-deleteIcon');
        expect(deleteIcon).not.toBeNull();
        act(() => { deleteIcon.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

        expect(navigations).toEqual([]);
        expect(setSearchParams).toHaveBeenCalledTimes(1);
        expect(setSearchParams.mock.calls[0][0].get('epic')).toBeNull();
    });

    it('renders no chip at all when no epic filter is applied', () => {
        searchParams = new URLSearchParams('');
        mount();
        expect(chip()).toBeNull();
    });
});
