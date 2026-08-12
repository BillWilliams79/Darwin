// @vitest-environment jsdom
//
// Req #3475 — the Paused chip in the plan header spread
// `pipelineStatusChipProps('paused')` and then a trailing literal `sx` prop
// clobbered it, so `#ff9800`/`#000` never reached the DOM and the chip
// rendered in MUI's default grey. This test mounts the real header with a
// `paused` plan and asserts the chip's COMPUTED inline style, so a return of
// the overwrite (or a future edit that reorders the props back) fails here
// rather than only being caught by eye.

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

const PIPELINES = [
    { id: 2, title: 'Darwin', pipeline_status: 'paused', description: '' },
];

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useAllPipelines: () => ({ data: PIPELINES, isLoading: false, isError: false }),
        useAllPipelineSteps: empty,
        useAllPipelineStepRequirements: empty,
        useAllPipelineStepDeps: empty,
        useAllRequirements: empty,
        useAllFeatures: empty,
        useAllEpics: empty,
        useMachines: empty,
        useOrchestrationClaims: empty,
        useAllRequirementSessions: empty,
        useAllSessionCostRollups: empty,
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

describe('PipelineDetail — Paused chip colour (req #3475)', () => {
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        roots = [];
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('renders the header Paused chip with the pause colour, not MUI default grey', () => {
        mount('/swarm/pipeline/2');
        const chip = node('pipeline-detail-paused');
        expect(chip).not.toBeNull();
        // jsdom resolves emotion's injected <style> tags, so getComputedStyle
        // sees the sx-generated CSS class MUI applies — a plain `.style` read
        // would not, since sx is not inlined.
        const style = getComputedStyle(chip);
        expect(style.backgroundColor).toBe('rgb(255, 152, 0)'); // #ff9800
        expect(style.color).toBe('rgb(0, 0, 0)'); // #000
    });

    it('still does not shrink in its flex row', () => {
        mount('/swarm/pipeline/2');
        const chip = node('pipeline-detail-paused');
        expect(getComputedStyle(chip).flexShrink).toBe('0');
    });
});
