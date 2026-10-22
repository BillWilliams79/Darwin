// @vitest-environment jsdom
//
// req #3793 — the PAGE half of the Plan visualizer's maximize switch: by the
// user's rule, while the plan's controls are on screen the switch is in their
// header row (`pipeline-header-row`), right of the plan's title; maximized the
// header row is hidden and the switch moves to the canvas's upper-left corner
// (the canvas half is `PipelinePlanVisualizer.maximize.test.jsx`). One switch,
// one test id, whichever home it is in. The mount scaffolding is
// `PipelineDetail.lockButton`'s; the plan panel is a stub that reports the
// `maximized` it was handed and, maximized, draws the canvas's switch.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../pipelineDetailModes', () => {
    const Plan = function PlanStub({ maximized, onToggleMaximized }) {
        return (
            <div data-testid="mode-plan" data-maximized={String(!!maximized)}>
                {maximized && onToggleMaximized && (
                    <button type="button" data-testid="pipeline-viz-maximize"
                            data-home="canvas" onClick={onToggleMaximized} />
                )}
            </div>
        );
    };
    const MODES = [
        { value: 'plan', label: 'Plan', icon: () => null, Component: Plan },
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

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const { composedFixture } = await import('./pipelineComposedFixture');
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useComposedPipeline: (id) => ({
            data: Number(id) === 2 ? composedFixture({ id: 2, title: 'Darwin' }) : null,
            isLoading: false,
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
import { usePanelRackStore } from '../../../stores/usePanelRackStore';

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
const all = (testId) => document.body.querySelectorAll(`[data-testid="${testId}"]`);

describe('PipelineDetail — the maximize switch\'s two homes (req #3793)', () => {
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        roots = [];
        document.body.innerHTML = '';
        document.documentElement.style.overflow = '';
    });

    it('with the controls on screen, sits in the header row right of the title', () => {
        mount('/swarm/pipeline/2?mode=plan');
        const row = node('pipeline-header-row');
        const sw = node('pipeline-viz-maximize');
        expect(sw).not.toBeNull();
        expect(all('pipeline-viz-maximize')).toHaveLength(1);
        expect(row.contains(sw)).toBe(true);
        // Straight after the title's text, inside the title's slot (which is
        // the row's spacer), ahead of the plan-mode controls.
        expect(sw.previousElementSibling).toBe(node('pipeline-title'));
        const slot = sw.parentElement;
        expect(slot.parentElement).toBe(row);
        const order = Array.from(row.children);
        expect(order.indexOf(slot)).toBeGreaterThanOrEqual(0);
        expect(order.indexOf(slot))
            .toBeLessThan(order.indexOf(node('pipeline-viz-colorkey-toggle')));
        expect(sw.getAttribute('aria-pressed')).toBe('false');
        expect(sw.getAttribute('aria-label')).toBe('Maximize the plan');
        expect(sw.getAttribute('title')).toBe('Maximize — only the plan (Esc to exit)');
        // The OUT arrows — "go full screen".
        expect(sw.querySelector('path').getAttribute('d'))
            .toBe('M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5');
        expect(node('pipeline-detail').getAttribute('data-maximized')).toBe('false');
    });

    it('maximized, the header row is hidden and the ONE switch is the canvas\'s', () => {
        mount('/swarm/pipeline/2?mode=plan');
        act(() => { node('pipeline-viz-maximize').click(); });
        expect(node('pipeline-detail').getAttribute('data-maximized')).toBe('true');
        expect(getComputedStyle(node('pipeline-detail')).position).toBe('fixed');
        expect(getComputedStyle(node('pipeline-header-row')).display).toBe('none');
        expect(node('mode-plan').getAttribute('data-maximized')).toBe('true');
        // Exactly one switch on the page, and it is not in the hidden row.
        expect(all('pipeline-viz-maximize')).toHaveLength(1);
        expect(node('pipeline-viz-maximize').getAttribute('data-home')).toBe('canvas');
        expect(usePanelRackStore.getState().covered).toBe(true);
    });

    it('restores from the canvas, and the switch is back in the header row', () => {
        mount('/swarm/pipeline/2?mode=plan');
        act(() => { node('pipeline-viz-maximize').click(); });
        act(() => { node('pipeline-viz-maximize').click(); });
        expect(node('pipeline-detail').getAttribute('data-maximized')).toBe('false');
        expect(node('pipeline-header-row').contains(node('pipeline-viz-maximize'))).toBe(true);
        expect(usePanelRackStore.getState().covered).toBe(false);
    });

    it('Esc leaves, as it always has', () => {
        vi.useFakeTimers();
        try {
            mount('/swarm/pipeline/2?mode=plan');
            act(() => { node('pipeline-viz-maximize').click(); });
            act(() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                vi.runAllTimers();
            });
            expect(node('pipeline-detail').getAttribute('data-maximized')).toBe('false');
            expect(node('pipeline-header-row').contains(node('pipeline-viz-maximize'))).toBe(true);
        } finally { vi.useRealTimers(); }
    });
});
