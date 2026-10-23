// @vitest-environment jsdom
//
// req #3761 — the Lock view's entry on the plan page: a chip on the plan
// toolbar, persisted per tab through the mode registry, plus `?mode=lock` as a
// transient link. Only the two panel bodies are stubbed; the registry, the
// toolbar and the page are real.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const planProps = vi.fn();
vi.mock('../PipelinePlanVisualizer', () => ({
    default: (props) => { planProps(props); return <div data-testid="mode-plan" />; },
}));
const lockProps = vi.fn();
vi.mock('../PipelineLockView', () => ({
    default: (props) => { lockProps(props); return <div data-testid="mode-lock" />; },
}));

vi.mock('../../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const { composedFixture } = await import('./pipelineComposedFixture');
    const composed = composedFixture({ id: 2, title: 'Darwin' });
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useComposedPipeline: (id) => ({
            data: Number(id) === 2 ? composed : null, isLoading: false,
        }),
        useAllPipelines: () => ({
            data: [{ id: 2 }], isLoading: false, isError: false, isSuccess: true,
        }),
        useMachines: () => ({ data: [{ id: 7, title: 'Mac Mini', platform: 'darwin', closed: 0 }],
            isLoading: false, isError: false }),
        useOrchestrationClaims: () => ({
            data: [{ id: 1, pipeline_fk: 2, initiative_fk: null, machine_fk: 7 }],
            isLoading: false, isError: false }),
        useAllRequirementSessions: empty,
        useAllSessionCostRollups: empty,
        useAllSessionTerminals: empty,
        useDevServers: empty,
    };
});

import PipelineDetail from '../PipelineDetail';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

let mountedRoots = [];
let search = '';

function Where() {
    search = useLocation().search;
    return null;
}

function mount(url) {
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
                        <MemoryRouter initialEntries={[url]}>
                            <Where />
                            <Routes>
                                <Route path="/swarm/pipeline/:id" element={<PipelineDetail />} />
                            </Routes>
                        </MemoryRouter>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    mountedRoots.push(root);
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
const click = (testId) => {
    const el = node(testId);
    expect(el, testId).not.toBeNull();
    act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

afterEach(() => {
    act(() => { mountedRoots.forEach((r) => r.unmount()); });
    document.body.innerHTML = '';
    mountedRoots = [];
    localStorage.clear();
    sessionStorage.clear();
    lockProps.mockClear();
    planProps.mockClear();
});

describe('PipelineDetail — the Lock view (req #3761)', () => {
    it('opens on the Plan with the Lock chip unlit', () => {
        mount('/swarm/pipeline/2');
        expect(node('mode-plan')).not.toBeNull();
        expect(node('mode-lock')).toBeNull();
        expect(node('pipeline-viz-mode-lock').getAttribute('aria-pressed')).toBe('false');
    });

    it('the Lock chip switches to the Lock view and persists the choice per tab', () => {
        mount('/swarm/pipeline/2');
        click('pipeline-viz-mode-lock');
        expect(node('mode-lock')).not.toBeNull();
        expect(node('mode-plan')).toBeNull();
        expect(node('pipeline-viz-mode-lock').getAttribute('aria-pressed')).toBe('true');
        expect(sessionStorage.getItem('darwin-swarm-pipeline-detail-mode')).toBe('lock');
        // …so a fresh mount of the page lands in it
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        mountedRoots = [];
        mount('/swarm/pipeline/2');
        expect(node('mode-lock')).not.toBeNull();
    });

    it('the chip again returns to the full Plan', () => {
        mount('/swarm/pipeline/2');
        click('pipeline-viz-mode-lock');
        click('pipeline-viz-mode-lock');
        expect(node('mode-plan')).not.toBeNull();
        expect(node('mode-lock')).toBeNull();
        expect(sessionStorage.getItem('darwin-swarm-pipeline-detail-mode')).toBe('plan');
    });

    it('?mode=lock opens the Lock view without writing the preference', () => {
        mount('/swarm/pipeline/2?mode=lock');
        expect(node('mode-lock')).not.toBeNull();
        expect(sessionStorage.getItem('darwin-swarm-pipeline-detail-mode')).not.toBe('lock');
    });

    it('a pick made on a ?mode=lock link clears the link so the URL cannot override it', () => {
        mount('/swarm/pipeline/2?mode=lock');
        expect(search).toBe('?mode=lock');
        click('pipeline-viz-mode-lock');
        expect(node('mode-plan')).not.toBeNull();
        expect(search).toBe('');
    });

    it('a ?epic= link means the Plan, even over a stored Lock preference', () => {
        sessionStorage.setItem('darwin-swarm-pipeline-detail-mode', 'lock');
        mount('/swarm/pipeline/2?epic=47');
        expect(node('mode-plan')).not.toBeNull();
        expect(node('mode-lock')).toBeNull();
    });

    it('the Lock chip works on an ?epic= entry: a manual pick overrides the focus link', () => {
        mount('/swarm/pipeline/2?epic=47&mode=plan&level=3');
        expect(node('mode-plan')).not.toBeNull();
        click('pipeline-viz-mode-lock');
        expect(node('mode-lock')).not.toBeNull();
        expect(search).toContain('level=3');
        expect(search).not.toContain('epic=');
        expect(search).not.toContain('mode=');
    });

    it('a mode change starts the next panel from a zero Default nonce', () => {
        mount('/swarm/pipeline/2?mode=lock');
        click('pipeline-viz-reset');
        click('pipeline-viz-reset');
        expect(lockProps.mock.calls.at(-1)[0].resetViewNonce).toBe(2);
        click('pipeline-viz-mode-lock');           // back to the plan: its panel must not see 2
        expect(node('mode-plan')).not.toBeNull();
        expect(planProps.mock.calls.at(-1)[0].resetViewNonce).toBe(0);
    });

    it('in the Lock view the toolbar keeps the chip and Default and drops the requirement controls', () => {
        mount('/swarm/pipeline/2?mode=lock');
        expect(node('pipeline-viz-mode-lock')).not.toBeNull();
        expect(node('pipeline-viz-reset')).not.toBeNull();
        ['pipeline-viz-colorkey-toggle', 'pipeline-viz-hide-closed', 'pipeline-viz-show-times',
            'pipeline-viz-machine-filter', 'pipeline-viz-level-control']
            .forEach((id) => expect(node(id), id).toBeNull());
        // no full-screen switch either: the view is one screen already
        expect(node('pipeline-viz-maximize')).toBeNull();
    });

    it('hands the view the claims and the machines it draws holders from', () => {
        mount('/swarm/pipeline/2?mode=lock');
        const props = lockProps.mock.calls.at(-1)[0];
        expect(props.orchestrationClaims).toHaveLength(1);
        expect(props.machines.map((m) => m.id)).toEqual([7]);
        expect(props.pipeline.id).toBe(2);
    });

    it('Default reaches the view as a bumped resetViewNonce', () => {
        mount('/swarm/pipeline/2?mode=lock');
        const before = lockProps.mock.calls.at(-1)[0].resetViewNonce;
        click('pipeline-viz-reset');
        expect(lockProps.mock.calls.at(-1)[0].resetViewNonce).toBe(before + 1);
    });
});
