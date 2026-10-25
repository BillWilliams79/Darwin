// @vitest-environment jsdom
//
// Req #3908 — the plan header draws NO orchestration badge. Req #3809 put
// circular badges beside the plan's name (green master, orange secondary) and
// removed the "Orchestrated by …" chip at the title bar's right edge; req #3908
// removed the badges too (user directive: the Engine on/off control at the
// canvas's bottom right replaces them). Mounts the real header against a lead
// Mac claim and a subscribing WSL claim, so a regression has claims to draw.

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

const mockClaims = vi.hoisted(() => ({ rows: [] }));

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const { composedFixture } = await import('./pipelineComposedFixture');
    const composed = composedFixture({ id: 2, title: 'Darwin', pipelineStatus: 'active' });
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useComposedPipeline: (id) => ({
            data: Number(id) === 2 ? composed : null, isLoading: false,
        }),
        useAllPipelines: () => ({
            data: [{ id: 2 }], isLoading: false, isError: false, isSuccess: true,
        }),
        useMachines: () => ({
            data: [
                { id: 4, title: 'Mac Mini', hostname: 'Macmini', platform: 'darwin' },
                { id: 5, title: 'MCHP Windows', hostname: 'SJO', platform: 'wsl' },
            ],
            isLoading: false, isError: false,
        }),
        useOrchestrationClaims: () => ({ data: mockClaims.rows, isLoading: false, isError: false }),
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

// A heartbeat stamped now, in the MySQL UTC shape Lambda-Rest returns.
const NOW_STAMP = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const liveClaim = (over) => ({
    pipeline_fk: 2, initiative_fk: null, terminal_pid: 100, engine_pid: 200,
    claimed_at: NOW_STAMP(), update_ts: NOW_STAMP(), ...over,
});

describe('PipelineDetail — no orchestration badge in the header (req #3908)', () => {
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        roots = [];
        document.body.innerHTML = '';
        mockClaims.rows = [];
        vi.restoreAllMocks();
    });

    it('draws no badge beside the name while two machines orchestrate the plan', () => {
        mockClaims.rows = [
            liveClaim({ id: 1, machine_fk: 4 }),
            liveClaim({ id: 2, machine_fk: 5 }),
        ];
        mount('/swarm/pipeline/2');
        const title = node('pipeline-title');
        expect(title).not.toBeNull();
        expect(node('pipeline-orchestration-badges')).toBeNull();
        expect(node('pipeline-orchestration-badge-m4')).toBeNull();
        // The name is first in the title's slot again.
        expect(title.previousElementSibling).toBeNull();
    });

    it('the old "Orchestrated by" chip at the right edge stays gone', () => {
        mockClaims.rows = [liveClaim({ id: 1, machine_fk: 4 })];
        mount('/swarm/pipeline/2');
        expect(node('pipeline-detail-holder')).toBeNull();
        expect(document.body.textContent).not.toContain('Orchestrated by');
    });
});
