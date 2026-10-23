// @vitest-environment jsdom
//
// Req #3641 — "remove the option to see the epics in the pipeline in a special
// viewer; just show the visualizer, it's the only way to look at a pipeline
// for now". Mounted against the REAL `pipelineDetailModes.js` registry (only
// the two panel bodies are stubbed, for react-konva's canvas), so this proves
// what the shipped page does: the Plan visualizer renders, the Table never
// does — not for a stored 'table' preference, not for an old `?mode=table`
// link. Since req #3760 the header row switches Plan | Engine; the Table is
// still not among them.
//
// It replaces req #3281's accessible-name coverage of that switcher, which no
// longer exists to be named.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The real registry's Plan entry pulls in react-konva at module load, which
// needs a `canvas` binding jsdom does not provide. Rather than replacing the
// whole registry (which would leave a real third mode with no coverage —
// req #3281 code review), stub only the two panel bodies so
// `pipelineDetailModes.js` itself, its labels and its icons stay real. That
// is what SvgIcon's aria-hidden dance operates on, and it is the whole point
// of this test: to prove the BUTTON, not the icon, ends up named.
vi.mock('../PipelinePlanTable', () => ({ default: () => <div data-testid="mode-table" /> }));
vi.mock('../PipelinePlanVisualizer', () => ({ default: () => <div data-testid="mode-plan" /> }));
// req #3760 — the Engine mode's body reads the engine tables; stubbed like the
// other two so this file stays about which panel the page picks.
vi.mock('../../engine/EngineScopeView', () => ({ default: () => <div data-testid="mode-engine" /> }));

vi.mock('../../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

// req #3356 — ONE composed read where the 1.0 seven used to be. The fixture
// carries the SAME epic 47 the 1.0 mock supplied, so every `?epic=47` case
// below still names an epic the page can resolve; `composedFixture` builds the
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
import { PIPELINE_DETAIL_MODES } from '../pipelineDetailModes';
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

afterEach(() => {
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
    mountedRoots = [];
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
});

describe('PipelineDetail — Plan, Lock and Engine, never the Table (req #3641, #3760, #3761)', () => {
    // The Table stays withdrawn. The Lock view (req #3761) is switched from the
    // plan toolbar's Lock chip — see PipelineDetail.lockMode.test.jsx — and the
    // Engine view (req #3760) from the header's Plan | Engine switch.
    it('registers the Plan visualizer first, then Lock and Engine — never the Table', () => {
        expect(PIPELINE_DETAIL_MODES.map((m) => m.value)).toEqual(['plan', 'lock', 'engine']);
    });

    it.each([
        ['a bare plan URL', '/swarm/pipeline/2'],
        ['an old ?mode=table link', '/swarm/pipeline/2?mode=table'],
        ['an old Table epic link', '/swarm/pipeline/2?mode=table&epic=47'],
    ])('renders the Plan and never the Table for %s', (_label, url) => {
        mount(url);
        expect(node('mode-plan')).not.toBeNull();
        expect(node('mode-table')).toBeNull();
    });

    it('renders the Plan for a reader whose stored preference says table', () => {
        localStorage.setItem('darwin-swarm-pipeline-detail-mode', 'table');
        sessionStorage.setItem('darwin-swarm-pipeline-detail-mode', 'table');
        mount('/swarm/pipeline/2');
        expect(node('mode-plan')).not.toBeNull();
        expect(node('mode-table')).toBeNull();
    });

    it('switches Plan | Engine on the header row, and offers no Table', () => {
        mount('/swarm/pipeline/2');
        expect(node('pipeline-mode-switch')).not.toBeNull();
        expect(node('pipeline-mode-plan').getAttribute('aria-pressed')).toBe('true');
        expect(node('pipeline-mode-table')).toBeNull();
        // The Lock view is the plan toolbar's toggle, not a header chip.
        expect(node('pipeline-mode-lock')).toBeNull();
        expect(node('pipeline-plan-toolbar') || node('mode-plan')).not.toBeNull();
        act(() => { node('pipeline-mode-engine').click(); });
        expect(node('mode-engine')).not.toBeNull();
        expect(node('mode-plan')).toBeNull();
        expect(node('pipeline-mode-engine').getAttribute('aria-pressed')).toBe('true');
    });

    it.each(['/swarm/pipeline/2', '/swarm/pipeline/2?mode=engine'])(
        'puts Plan | Engine first on the header row, left of the plan name — %s (req #3875)',
        (url) => {
            mount(url);
            expect(node('pipeline-header-row').firstElementChild)
                .toBe(node('pipeline-mode-switch'));
            expect(node('pipeline-mode-switch').compareDocumentPosition(node('pipeline-title'))
                & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

    it('opens the Engine view from a ?mode=engine link', () => {
        mount('/swarm/pipeline/2?mode=engine');
        expect(node('mode-engine')).not.toBeNull();
        expect(node('mode-plan')).toBeNull();
    });

    it('an epic link lands on the Plan, whatever mode was stored', () => {
        sessionStorage.setItem('darwin-swarm-pipeline-detail-mode', 'engine');
        localStorage.setItem('darwin-swarm-pipeline-detail-mode', 'engine');
        mount('/swarm/pipeline/2?epic=47');
        expect(node('mode-plan')).not.toBeNull();
        expect(node('mode-engine')).toBeNull();
    });

    it('a stored Engine pick opens the Engine view on a bare plan URL', () => {
        sessionStorage.setItem('darwin-swarm-pipeline-detail-mode', 'engine');
        localStorage.setItem('darwin-swarm-pipeline-detail-mode', 'engine');
        mount('/swarm/pipeline/2');
        expect(node('mode-engine')).not.toBeNull();
    });

    it('picking Engine after arriving on an epic link leaves the Plan', () => {
        mount('/swarm/pipeline/2?mode=plan&epic=47&level=3');
        expect(node('mode-plan')).not.toBeNull();
        act(() => { node('pipeline-mode-engine').click(); });
        expect(node('mode-engine')).not.toBeNull();
        expect(node('mode-plan')).toBeNull();
    });
});
