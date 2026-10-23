// @vitest-environment jsdom
//
// Req #3235 — the RECEIVING end of the requirement page's initiative-box "view on
// plan" link.
//
// `pipelineInitiativeLink.test.js` pins the two pure functions. This pins the React
// half: a `?initiative=` link forces the Plan mode (an initiative band only exists there)
// and seeds `focusInitiativeId` on the visualizer — mirroring
// `PipelineDetail.stepParam.test.jsx`'s coverage of `?step=` forcing the
// table. The two panels are stubbed for the same reason that file stubs
// them: the real Plan mode is react-konva, which needs a canvas jsdom does
// not provide.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../pipelineDetailModes', () => {
    const Panel = (name) => function ModeStub({ focusStepId, focusInitiativeId }) {
        return <div data-testid={`mode-${name}`}
                    data-focus-step={focusStepId == null ? '' : String(focusStepId)}
                    data-focus-initiative={focusInitiativeId == null ? '' : String(focusInitiativeId)} />;
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

vi.mock('../../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

// req #3356 — ONE composed read where the 1.0 seven used to be. The fixture
// carries the SAME step 47 the 1.0 mock supplied, so every `?step=47` case
// below still names a step the page can resolve; `composedFixture` builds the
// `derived` block the page hard-stops without.
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

let mountedRoots = [];

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
const focusInitiativeOf = (name) => node(`mode-${name}`)?.getAttribute('data-focus-initiative');
const focusStepOf = (name) => node(`mode-${name}`)?.getAttribute('data-focus-step');

const storePreference = (value) => {
    localStorage.setItem('darwin-swarm-pipeline-detail-mode', value);
    sessionStorage.setItem('darwin-swarm-pipeline-detail-mode', value);
};

beforeEach(() => {
    mountedRoots = [];
    localStorage.clear();
    sessionStorage.clear();
});

afterEach(() => {
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
});

describe('PipelineDetail — ?initiative= (req #3235)', () => {
    it('forces the PLAN mode even when ?mode= names the table', () => {
        mount('/swarm/pipeline/2?mode=table&initiative=55');
        expect(node('mode-plan')).not.toBeNull();
        expect(focusInitiativeOf('plan')).toBe('55');
    });

    it('forces the plan over a STORED preference of table', () => {
        storePreference('table');
        mount('/swarm/pipeline/2?initiative=55');
        expect(node('mode-plan')).not.toBeNull();
        expect(focusInitiativeOf('plan')).toBe('55');
    });

    it('leaves the stored preference in charge when there is no ?initiative=', () => {
        storePreference('plan');
        mount('/swarm/pipeline/2');
        expect(node('mode-plan')).not.toBeNull();
        expect(focusInitiativeOf('plan')).toBe('');
    });

    it('carries no initiative focus when the parameter is absent or unusable', () => {
        mount('/swarm/pipeline/2?mode=plan');
        expect(focusInitiativeOf('plan')).toBe('');
        mount('/swarm/pipeline/2?mode=plan&initiative=12abc');
        expect(focusInitiativeOf('plan')).toBe('');
    });

    it('a named ?step= and ?initiative= both reach the plan (req #3641 — no Table)', () => {
        // The step still outranks the initiative inside the canvas (its focus effect
        // runs instead of the band fit), so the page passes BOTH and lets the
        // canvas apply that precedence; the panel is the plan either way.
        mount('/swarm/pipeline/2?step=47&initiative=55');
        expect(node('mode-plan')).not.toBeNull();
        expect(focusStepOf('plan')).toBe('47');
        expect(focusInitiativeOf('plan')).toBe('55');
    });
});
