// @vitest-environment jsdom
//
// Req #3649 — the plan header's padlock: always rendered, reflects
// `pipeline.locked`, and a click writes the flipped flag through
// `updatePipeline`. The mount scaffolding is `PipelineDetail.pausedChip`'s.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../pipelineDetailModes', () => {
    const Panel = (name) => function ModeStub() {
        return <div data-testid={`mode-${name}`} />;
    };
    const MODES = [
        { value: 'table', label: 'Table', icon: () => null, Component: Panel('table') },
        { value: 'plan', label: 'Plan', icon: () => null, Component: Panel('plan') },
    ];
    return {
        PIPELINE_DETAIL_MODES: MODES,
        PIPELINE_DETAIL_MODE_STORAGE_KEY: 'darwin-swarm-pipeline-detail-mode',
        DEFAULT_PIPELINE_DETAIL_MODE: 'table',
        findPipelineDetailMode: (v) => MODES.find((m) => m.value === v),
        default: MODES,
    };
});

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

const updatePipeline = vi.fn(() => Promise.resolve({}));
vi.mock('../../../Pipelines/pipelinesApi', async (orig) => ({
    ...(await orig()),
    updatePipeline: (...a) => updatePipeline(...a),
}));

let lockedFlag = 0;
vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const { composedFixture } = await import('./pipelineComposedFixture');
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useComposedPipeline: (id) => {
            const composed = composedFixture({ id: 2, title: 'Darwin' });
            composed.pipeline.locked = lockedFlag;
            return { data: Number(id) === 2 ? composed : null, isLoading: false };
        },
        useAllPipelines: () => ({
            data: [{ id: 2 }], isLoading: false, isError: false, isSuccess: true,
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

function mount(url) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false },
        },
    });
    const root = createRoot(host);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                    <AuthContext.Provider
                        value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <MemoryRouter initialEntries={[url]}>
                            <Routes>
                                <Route path="/swarm/pipeline/:id" element={<PipelineDetail />} />
                            </Routes>
                        </MemoryRouter>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>,
        );
    });
    roots.push(root);
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('PipelineDetail — the plan padlock (req #3649)', () => {
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        roots = [];
        document.body.innerHTML = '';
        updatePipeline.mockClear();
        lockedFlag = 0;
    });

    it('renders open on an unlocked plan and a click writes locked=1', async () => {
        mount('/swarm/pipeline/2');
        const btn = node('pipeline-detail-lock');
        expect(btn).not.toBeNull();
        expect(btn.getAttribute('data-locked')).toBe('0');
        expect(btn.getAttribute('aria-pressed')).toBe('false');
        act(() => { btn.click(); });
        await flush();
        expect(updatePipeline).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 2, { locked: 1 });
    });

    it('renders closed on a locked plan and a click writes locked=0', async () => {
        lockedFlag = 1;
        mount('/swarm/pipeline/2');
        const btn = node('pipeline-detail-lock');
        expect(btn.getAttribute('data-locked')).toBe('1');
        expect(btn.getAttribute('aria-pressed')).toBe('true');
        act(() => { btn.click(); });
        await flush();
        expect(updatePipeline).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 2, { locked: 0 });
    });
});
