// @vitest-environment jsdom
//
// Req #3798 — the plan visualizer's title row carries the Requirements page's
// "Req #" launcher, immediately left of the Full screen switch.

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

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const { composedFixture } = await import('./pipelineComposedFixture');
    const composed = composedFixture({ id: 2, title: 'Darwin', pipelineStatus: 'active' });
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useComposedPipeline: (id) => ({ data: Number(id) === 2 ? composed : null, isLoading: false }),
        useAllPipelines: () => ({ data: [{ id: 2 }], isLoading: false, isError: false, isSuccess: true }),
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
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } },
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

describe('PipelineDetail — requirement launcher (req #3798)', () => {
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        roots = [];
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('puts the Req # field in the title row', () => {
        mount('/swarm/pipeline/2');
        const row = node('pipeline-header-row');
        expect(row.contains(node('req-jump-input'))).toBe(true);
        expect(node('req-jump-submit')).not.toBeNull();
    });

    it('sits immediately left of the Full screen switch when it is drawn', () => {
        mount('/swarm/pipeline/2?mode=plan');
        const launcher = node('pipeline-req-launcher');
        const sw = node('pipeline-viz-maximize');
        expect(sw).not.toBeNull();
        expect(launcher.nextElementSibling).toBe(sw);
    });

    it('opens the typed requirement in a new tab', () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        mount('/swarm/pipeline/2');
        const input = node('req-jump-input').querySelector('input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        act(() => { setter.call(input, '3798'); input.dispatchEvent(new Event('input', { bubbles: true })); });
        act(() => { node('req-jump-submit').click(); });
        expect(open).toHaveBeenCalledWith('/swarm/requirement/3798', '_blank', 'noopener,noreferrer');
    });

    it('takes at most four digits (req #4064)', () => {
        mount('/swarm/pipeline/2');
        const input = node('req-jump-input').querySelector('input');
        expect(input.getAttribute('maxlength')).toBe('4');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        act(() => { setter.call(input, '123456'); input.dispatchEvent(new Event('input', { bubbles: true })); });
        expect(input.value).toBe('1234');
    });
});
