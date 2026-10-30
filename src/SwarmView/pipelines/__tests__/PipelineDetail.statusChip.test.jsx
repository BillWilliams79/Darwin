// @vitest-environment jsdom
//
// Req #3965 — the plan header's STATUS chip, and its editor. It replaced the
// conditional Paused chip (req #3226/#3475): a plan no longer pauses, and its
// status is one of seven values the reader can see and change from the plan
// itself. Req #3475's lesson is kept: the chip's COMPUTED style is asserted, so
// a trailing `sx` that clobbers the status colours fails here rather than only
// being caught by eye.

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
    // The real registry's shape since req #3641: ONE mode, the Plan visualizer.
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

const restCalls = vi.hoisted(() => []);
vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        if (method !== 'GET') restCalls.push({ uri, method, body });
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

// req #3356 — ONE composed read where the 1.0 seven used to be. The plan is
// `orchestration_ready`: `composedFixture` puts that status on both
// `pipeline.pipeline_status` and `derived.pause`, so the header chip has the
// same fact to draw from that the live page gives it.
vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const { composedFixture } = await import('./pipelineComposedFixture');
    const composed = composedFixture({ id: 2, title: 'Darwin', pipelineStatus: 'orchestration_ready' });
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useComposedPipeline: (id) => ({
            data: Number(id) === 2 ? composed : null, isLoading: false,
        }),
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

describe('PipelineDetail — the status chip and its editor (req #3965)', () => {
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        roots = [];
        restCalls.length = 0;
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('shows the plan\'s status in its requirement-mirroring colours, not MUI default grey', () => {
        mount('/swarm/pipeline/2');
        const chip = node('pipeline-detail-status');
        expect(chip).not.toBeNull();
        expect(chip.textContent).toBe('Orchestration Ready');
        // jsdom resolves emotion's injected <style> tags, so getComputedStyle
        // sees the sx-generated CSS class MUI applies.
        const style = getComputedStyle(chip);
        expect(style.backgroundColor).toBe('rgb(25, 118, 210)'); // #1976d2 (~ swarm_ready)
        expect(style.color).toBe('rgb(255, 255, 255)');
        expect(style.flexShrink).toBe('0');
        expect(node('pipeline-detail-paused')).toBeNull();
    });

    it('offers all seven statuses and writes the one picked, alone', async () => {
        mount('/swarm/pipeline/2');
        act(() => { node('pipeline-detail-status').click(); });
        const options = [...document.body.querySelectorAll('[data-testid^="pipeline-detail-status-option-"]')]
            .map((el) => el.textContent);
        expect(options).toEqual(['Authoring', 'Authorized', 'Orchestration Ready', 'Orchestrating', 'Met',
            "Won't Fix", 'Deferred']);
        await act(async () => { node('pipeline-detail-status-option-orchestrating').click(); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(restCalls).toEqual([{
            uri: 'http://test.local/darwin/pipelines',
            method: 'PUT',
            body: [{ id: 2, pipeline_status: 'orchestrating' }],
        }]);
    });
});
