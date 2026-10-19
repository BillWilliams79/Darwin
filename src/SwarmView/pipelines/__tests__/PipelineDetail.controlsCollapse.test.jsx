// @vitest-environment jsdom
//
// Req #3650 — ONE collapse head, TPU 3D style, in the plan page's upper-left
// corner, folding the UI options of BOTH modes: the Plan (pipeline) view's
// toolbar and the Table (steps) view's Time/Tokens. Mounts the real header
// (mode panels stubbed) and asserts the head leads the row, that folding keeps
// the plan's name, that each mode's controls go and come back, and that the
// choice persists like the page's other view preferences.

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

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

// Two plans: 2 is `active` (the ordinary row), 3 is `paused`, so the header
// carries the live-ops Paused chip the fold must leave in place.
vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const { composedFixture } = await import('./pipelineComposedFixture');
    const plans = {
        2: composedFixture({ id: 2, title: 'Darwin', pipelineStatus: 'active' }),
        3: composedFixture({ id: 3, title: 'Held', pipelineStatus: 'paused' }),
    };
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useComposedPipeline: (id) => ({
            data: plans[Number(id)] ?? null, isLoading: false,
        }),
        useAllPipelines: () => ({
            data: [{ id: 2 }, { id: 3 }], isLoading: false, isError: false, isSuccess: true,
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

const header = () => node('pipeline-header-row');
const head = () => node('pipeline-controls-collapse');
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('PipelineDetail — controls collapse head (req #3650)', () => {
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        roots = [];
        document.body.innerHTML = '';
        localStorage.clear();
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it('leads the header row — the upper-left corner — expanded by default', () => {
        mount('/swarm/pipeline/2');
        expect(head()).not.toBeNull();
        expect(header().firstElementChild).toBe(head());
        expect(head().getAttribute('aria-expanded')).toBe('true');
        expect(head().textContent).toContain('Controls');
        expect(head().getAttribute('aria-label')).toBe('Controls');
        expect(head().getAttribute('title')).toBe('Collapse controls');
    });

    it('has no mode switcher to fold — the visualizer is the only view (req #3641)', () => {
        mount('/swarm/pipeline/2?mode=table');
        expect(node('pipeline-detail-mode-toggle')).toBeNull();
        expect(node('pipeline-cost-toggle')).toBeNull();
        expect(node('mode-plan')).not.toBeNull();
    });

    it('folds and unfolds the Plan (pipeline) view toolbar with the same head', () => {
        mount('/swarm/pipeline/2?mode=plan');
        expect(node('pipeline-viz-reset')).not.toBeNull();
        expect(node('pipeline-viz-colorkey-toggle')).not.toBeNull();
        expect(header().querySelectorAll('.MuiDivider-root').length).toBeGreaterThan(0);

        click(head());
        expect(node('pipeline-viz-reset')).toBeNull();
        expect(node('pipeline-viz-colorkey-toggle')).toBeNull();
        expect(node('pipeline-viz-steps-across')).toBeNull();
        expect(node('pipeline-detail-mode-toggle')).toBeNull();
        expect(header().querySelector('.MuiDivider-root')).toBeNull();   // no divider over nothing
        expect(node('mode-plan')).not.toBeNull();

        click(head());
        expect(node('pipeline-viz-reset')).not.toBeNull();
    });

    it('keeps the live-ops status chip, behind its divider, when folded', () => {
        mount('/swarm/pipeline/3');
        click(head());
        expect(head().getAttribute('title')).toBe('Expand controls');
        expect(node('pipeline-detail-paused')).not.toBeNull();
        const kids = [...header().children];
        const title = kids.findIndex((k) => k.contains(node('pipeline-title')));
        const chip = kids.findIndex((k) => k.contains(node('pipeline-detail-paused')));
        expect(header().querySelectorAll('.MuiDivider-root')).toHaveLength(1);
        expect(kids.indexOf(header().querySelector('.MuiDivider-root'))).toBeGreaterThan(title);
        expect(kids.indexOf(header().querySelector('.MuiDivider-root'))).toBeLessThan(chip);
    });

    it('persists the fold across a remount', () => {
        mount('/swarm/pipeline/2');
        click(head());
        expect(localStorage.getItem('darwin-swarm-pipeline-detail-controls')).toBe('collapsed');
        act(() => { roots.forEach((r) => r.unmount()); });
        roots = [];
        document.body.innerHTML = '';
        mount('/swarm/pipeline/2');
        expect(head().getAttribute('aria-expanded')).toBe('false');
        expect(node('pipeline-detail-mode-toggle')).toBeNull();
    });
});
