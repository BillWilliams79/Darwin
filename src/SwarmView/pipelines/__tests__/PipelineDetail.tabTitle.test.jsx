// @vitest-environment jsdom
//
// Req #3970 — the browser tab is named after the plan the visualizer shows,
// and reads "Darwin" again the moment the visualizer is left. The restore is
// the half the requirement singled out ("don't fail me here"), so every way
// off the page is driven here: navigating to another route, unmounting, and
// moving in place to a different plan.
//
// The mode panel is STUBBED as in `PipelineDetail.place.test.jsx`: the real
// Plan mode is react-konva and needs a canvas jsdom does not provide.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../pipelineDetailModes', () => {
    const Panel = (name) => function ModeStub() {
        return <div data-testid={`mode-${name}`} />;
    };
    const MODES = [
        { value: 'plan', label: 'Plan', icon: () => null, Component: Panel('plan') },
    ];
    return {
        PIPELINE_DETAIL_MODES: MODES,
        PIPELINE_DETAIL_MODE_STORAGE_KEY: 'darwin-swarm-pipeline-detail-mode',
        DEFAULT_PIPELINE_DETAIL_MODE: 'plan',
        findPipelineDetailMode: (v) => MODES.find((m) => m.value === v),
        default: MODES,
    };
});

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

let loading = false;
// Mutable so a rename can be staged: the real page re-reads the plan after
// PlanTitle saves a new title, and the tab must follow it.
let titles = new Map([[2, 'Virgo Network Install'], [5, 'Substrate']]);

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const { composedFixture } = await import('./pipelineComposedFixture');
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useComposedPipeline: (id) => {
            const title = titles.get(Number(id));
            return {
                data: loading ? undefined
                    : (title == null ? null : composedFixture({ id: Number(id), title })),
                isLoading: loading,
            };
        },
        useAllPipelines: () => ({
            data: [{ id: 2 }, { id: 5 }], isLoading: false, isError: false, isSuccess: true,
        }),
        useMachines: empty,
        useOrchestrationClaims: empty,
        useAllRequirementSessions: empty,
        useAllSessionCostRollups: empty,
        useAllSessionTerminals: empty,
        useDevServers: empty,
    };
});

import PipelineDetail from '../PipelineDetail';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

let roots = [];

function GoTo({ to, testId }) {
    const navigate = useNavigate();
    return <button data-testid={testId} onClick={() => navigate(to)} />;
}

function mount(url) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false },
        },
    });
    const root = createRoot(host);
    const tree = () => (
        <QueryClientProvider client={queryClient}>
            <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                <AuthContext.Provider
                    value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                    <MemoryRouter initialEntries={[url]}>
                        <GoTo to="/swarm/pipeline/5" testId="go-plan-5" />
                        <GoTo to="/swarm/pipelines" testId="go-list" />
                        <Routes>
                            <Route path="/swarm/pipeline/:id" element={<PipelineDetail />} />
                            <Route path="/swarm/pipelines" element={<div data-testid="list-page" />} />
                        </Routes>
                    </MemoryRouter>
                </AuthContext.Provider>
            </AppContext.Provider>
        </QueryClientProvider>
    );
    const render = () => act(() => { root.render(tree()); });
    render();
    roots.push(root);
    return { rerender: render, root };
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
const click = (testId) => act(() => { node(testId).click(); });

describe('PipelineDetail — the browser tab carries the plan name (req #3970)', () => {
    beforeEach(() => {
        roots = [];
        loading = false;
        titles = new Map([[2, 'Virgo Network Install'], [5, 'Substrate']]);
        document.title = 'Darwin';
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        localStorage.clear();
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it('names the tab after the plan being visualized', () => {
        mount('/swarm/pipeline/2');
        expect(node('mode-plan')).not.toBeNull();
        expect(document.title).toBe('Virgo Network Install');
    });

    it('restores "Darwin" when the reader navigates away from the visualizer', () => {
        mount('/swarm/pipeline/2');
        expect(document.title).toBe('Virgo Network Install');
        click('go-list');
        expect(node('list-page')).not.toBeNull();
        expect(document.title).toBe('Darwin');
    });

    it('restores "Darwin" when the visualizer unmounts', () => {
        const { root } = mount('/swarm/pipeline/2');
        expect(document.title).toBe('Virgo Network Install');
        act(() => { root.unmount(); });
        roots = [];
        expect(document.title).toBe('Darwin');
    });

    it('follows an in-place switch to another plan', () => {
        mount('/swarm/pipeline/2');
        click('go-plan-5');
        expect(document.title).toBe('Substrate');
        click('go-list');
        expect(document.title).toBe('Darwin');
    });

    it('follows a rename of the plan', () => {
        const h = mount('/swarm/pipeline/2');
        titles.set(2, 'Virgo Network Install v2');
        h.rerender();
        expect(document.title).toBe('Virgo Network Install v2');
    });

    it('leaves "Darwin" while the plan is loading, then names it when the read lands', () => {
        loading = true;
        const h = mount('/swarm/pipeline/2');
        expect(document.title).toBe('Darwin');
        loading = false;
        h.rerender();
        expect(document.title).toBe('Virgo Network Install');
    });

    it('leaves "Darwin" for a plan that does not exist', () => {
        mount('/swarm/pipeline/999');
        expect(node('pipeline-not-found')).not.toBeNull();
        expect(document.title).toBe('Darwin');
    });

    it('leaves "Darwin" for a plan with a blank title', () => {
        titles.set(2, '   ');
        mount('/swarm/pipeline/2');
        expect(document.title).toBe('Darwin');
    });
});
