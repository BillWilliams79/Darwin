// @vitest-environment jsdom
//
// Req #3234 — the read-only Epic linkage box beside AI Settings on the
// requirement detail page. Pins the derived requirement -> feature -> epic
// chain: no feature, a feature with no epic, and a resolved epic all render
// distinctly, a resolved epic links to `/swarm/epics?id=<id>`, and a failed
// fetch reads as "unavailable" rather than the same "No epic" a genuinely
// absent link renders (code review finding — the two must not look alike).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `useFeatureById`/`useEpicById` are the real hooks (not stubbed) — the whole
// point of these tests is pinning their wiring into the page. Only the two
// unrelated data hooks the page also calls are stubbed, mirroring
// RequirementDetail.machine.test.jsx.
vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useMachines: () => ({ data: [] }),
        useAllCategories: () => ({ data: [{ id: 1, category_name: 'Swarm' }] }),
    };
});

let requirementRow;
let featureResponse;   // { status, data } for GET /features?id=...
let epicResponse;      // { status, data } for GET /epics?id=...

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method) => {
        if (method !== 'GET') return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
        if (uri.includes('/requirements?id=')) {
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [requirementRow] });
        }
        if (uri.includes('/features?id=')) {
            return Promise.resolve({ httpStatus: { httpStatus: featureResponse.status }, data: featureResponse.data });
        }
        if (uri.includes('/epics?id=')) {
            return Promise.resolve({ httpStatus: { httpStatus: epicResponse.status }, data: epicResponse.data });
        }
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

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
            <MemoryRouter initialEntries={['/swarm/requirement/42']}>
                <QueryClientProvider client={queryClient}>
                    <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                        <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                            <Routes>
                                <Route path="/swarm/requirement/:id" element={<RequirementDetail />} />
                            </Routes>
                        </AuthContext.Provider>
                    </AppContext.Provider>
                </QueryClientProvider>
            </MemoryRouter>
        );
    });
    mountedRoots.push(root);
    return { container };
}

// Deeper than RequirementDetail.machine.test.jsx's `flush`: this page chains
// THREE round-trips through the mocked REST client (the requirement GET, then
// — once it lands and re-renders with `feature_fk` — the real `useFeatureById`
// query, then — once THAT lands with `epic_fk` — the real `useEpicById` query).
// Those are real TanStack Query fetches, not stubbed hooks, so each hop costs
// its own micro/macrotask round beyond what a single `setTimeout(0)` covers.
async function flush() {
    for (let round = 0; round < 6; round++) {
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
            await new Promise((r) => setTimeout(r, 0));
            for (let i = 0; i < 5; i++) await Promise.resolve();
        });
    }
}

function baseRequirement(overrides = {}) {
    return {
        id: 42,
        title: 'linked or not',
        description: '',
        category_fk: 1,
        requirement_status: 'swarm_ready',
        coordination_type: 'implemented',
        ai_model: 'opus',
        effort: 'xhigh',
        machine_fk: null,
        started_at: null, completed_at: null, deferred_at: null,
        create_ts: null, update_ts: null,
        ...overrides,
    };
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);

describe('RequirementDetail — Epic linkage box (req #3234)', () => {
    beforeEach(() => {
        mountedRoots = [];
        featureResponse = { status: 200, data: [] };
        epicResponse = { status: 200, data: [] };
    });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('says "No epic" when the requirement has no feature — never an empty box', async () => {
        requirementRow = baseRequirement();   // no feature_fk at all
        mount();
        await flush();

        expect(node('epic-linkage-none')).not.toBeNull();
        expect(node('epic-linkage-none').textContent).toBe('No epic');
        expect(node('epic-linkage-link')).toBeNull();
    });

    it('says "No epic" when the feature exists but has no epic — same treatment, not a differentiated message', async () => {
        requirementRow = baseRequirement({ feature_fk: 88 });
        featureResponse = { status: 200, data: [{ id: 88, title: 'Orphan Feature', epic_fk: null }] };
        mount();
        await flush();

        expect(node('epic-linkage-none').textContent).toBe('No epic');
        expect(node('epic-linkage-link')).toBeNull();
    });

    it('links a resolved epic to /swarm/epics?id=<id> and shows the feature as context', async () => {
        requirementRow = baseRequirement({ feature_fk: 88 });
        featureResponse = { status: 200, data: [{ id: 88, title: 'Cool Feature', epic_fk: 55 }] };
        epicResponse = { status: 200, data: [{ id: 55, title: 'Big Epic' }] };
        mount();
        await flush();

        const link = node('epic-linkage-link');
        expect(link).not.toBeNull();
        expect(link.textContent).toBe('Big Epic');
        expect(link.getAttribute('href')).toBe('/swarm/epics?id=55');
        expect(document.body.textContent).toContain('via feature "Cool Feature"');
        expect(node('epic-linkage-none')).toBeNull();
    });

    it('reads as "Epic unavailable", not "No epic", when the feature fetch fails', async () => {
        requirementRow = baseRequirement({ feature_fk: 88 });
        featureResponse = { status: 500, data: [] };
        mount();
        await flush();

        expect(node('epic-linkage-error')).not.toBeNull();
        expect(node('epic-linkage-error').textContent).toBe('Epic unavailable');
        expect(node('epic-linkage-none')).toBeNull();
    });

    it('reads as "Epic unavailable" when the feature resolves but the epic fetch fails', async () => {
        requirementRow = baseRequirement({ feature_fk: 88 });
        featureResponse = { status: 200, data: [{ id: 88, title: 'Cool Feature', epic_fk: 55 }] };
        epicResponse = { status: 500, data: [] };
        mount();
        await flush();

        expect(node('epic-linkage-error')).not.toBeNull();
        expect(node('epic-linkage-none')).toBeNull();
        expect(node('epic-linkage-link')).toBeNull();
    });

    it('is hidden (kept in layout) in "new" draft mode, before any feature_fk can exist', async () => {
        // "new" mode never issues the requirement GET — RequirementDetail reads
        // `id === 'new'` from the route param.
        const container = document.createElement('div');
        document.body.appendChild(container);
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } },
        });
        const root = createRoot(container);
        act(() => {
            root.render(
                <MemoryRouter initialEntries={['/swarm/requirement/new']}>
                    <QueryClientProvider client={queryClient}>
                        <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                            <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                                <Routes>
                                    <Route path="/swarm/requirement/:id" element={<RequirementDetail />} />
                                </Routes>
                            </AuthContext.Provider>
                        </AppContext.Provider>
                    </QueryClientProvider>
                </MemoryRouter>
            );
        });
        mountedRoots.push(root);
        await flush();

        const group = node('requirement-epic-linkage-group');
        expect(group).not.toBeNull();
        expect(getComputedStyle(group).visibility).toBe('hidden');
    });
});
