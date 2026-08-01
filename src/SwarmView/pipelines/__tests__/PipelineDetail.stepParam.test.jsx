// @vitest-environment jsdom
//
// Req #3140 — the RECEIVING end of the Steps editor's row link.
//
// `pipelineStepLink.test.js` pins the two pure functions. This pins the React
// half, which is where the property that actually matters lives: a `?step=` link
// seeds `focusStepId` and forces the table, and NEITHER of those may survive a
// manual mode pick. The mode-override machinery is shared with the req #3115
// bead-click handshake and with `?mode=`, so an edit to that effect's dependency
// list would break all three at once and silently.
//
// The two mode panels are STUBBED: the real Plan mode is react-konva, which needs
// a canvas jsdom does not provide, and none of this requirement's behaviour is in
// either panel. The stub reports the props the handshake is made of.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The panel factory lives INSIDE the factory: vi.mock is hoisted above every
// top-level binding in this file, so a `const Panel` outside is a TDZ error.
vi.mock('../pipelineDetailModes', () => {
    const Panel = (name) => function ModeStub({ focusStepId }) {
        return <div data-testid={`mode-${name}`}
                    data-focus={focusStepId == null ? '' : String(focusStepId)} />;
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

vi.mock('../../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useAllPipelines: () => ({
            data: [{ id: 2, title: 'Darwin', pipeline_status: 'active', description: '' }],
            isLoading: false,
        }),
        useAllPipelineSteps: () => ({
            data: [{ id: 47, pipeline_fk: 2, title: 'Session Drain', run: 'auto', notes: null, completed_at: null }],
            isLoading: false,
        }),
        useAllPipelineStepRequirements: empty,
        useAllPipelineStepDeps: empty,
        useAllRequirements: empty,
        useAllFeatures: empty,
        useAllEpics: empty,
        useMachines: empty,
        useAllRequirementSessions: empty,
        useAllSessionCostRollups: empty,
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
const focusOf = (name) => node(`mode-${name}`)?.getAttribute('data-focus');
const click = (el) => act(() => { el.click(); });

// `useViewPreference` stores a RAW string and reads sessionStorage FIRST, falling
// back to localStorage for a newly opened tab. A JSON-encoded value would arrive
// as `"plan"` with the quotes, fail normalizeView, and silently fall through to
// the default — making a preference test pass for the wrong reason.
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

describe('PipelineDetail — ?step= (req #3140)', () => {
    it('seeds the focus on the FIRST render, not after an effect', () => {
        // `useState(linkStepId)` rather than a `useState(null)` an effect corrects:
        // the table scrolls to the focused row in its own layout effect, and a
        // focus that arrives a paint later can miss that.
        mount('/swarm/pipeline/2?mode=table&step=47');
        expect(focusOf('table')).toBe('47');
    });

    it('forces the TABLE even when ?mode= names the visualizer', () => {
        // Only the table consumes focusStepId. Honouring ?mode=plan here would
        // land the reader on a plan with nothing highlighted and nothing to say why.
        mount('/swarm/pipeline/2?mode=plan&step=47');
        expect(node('mode-table')).not.toBeNull();
        expect(node('mode-plan')).toBeNull();
        expect(focusOf('table')).toBe('47');
    });

    it('forces the table over a STORED preference of plan', () => {
        storePreference('plan');
        mount('/swarm/pipeline/2?step=47');
        expect(node('mode-table')).not.toBeNull();
        expect(focusOf('table')).toBe('47');
    });

    it('leaves the stored preference in charge when there is no ?step=', () => {
        storePreference('plan');
        mount('/swarm/pipeline/2');
        expect(node('mode-plan')).not.toBeNull();
        expect(focusOf('plan')).toBe('');
    });

    it('carries no focus when the parameter is absent or unusable', () => {
        mount('/swarm/pipeline/2?mode=table');
        expect(focusOf('table')).toBe('');
    });

    it('ignores a non-integer ?step=, rather than focusing NaN or 0', () => {
        mount('/swarm/pipeline/2?mode=table&step=12abc');
        expect(focusOf('table')).toBe('');
        mount('/swarm/pipeline/2?mode=table&step=');
        expect(focusOf('table')).toBe('');
    });

    // THE PROPERTY A DEPENDENCY-LIST EDIT WOULD BREAK SILENTLY. The link asks to
    // see one thing once; picking a mode by hand must clear both the override and
    // the focus and must never be resurrected by a re-render.
    it('a manual mode pick clears the focus and survives re-render', () => {
        mount('/swarm/pipeline/2?mode=table&step=47');
        expect(focusOf('table')).toBe('47');
        click(node('pipeline-mode-plan'));
        expect(node('mode-plan')).not.toBeNull();
        expect(focusOf('plan')).toBe('');
        // Re-render via an unrelated state change on the same page — the
        // description dialog. The URL is untouched, so the seeding effect must
        // not fire again and drag the reader back to the table.
        click(node('pipeline-description-btn'));
        expect(node('mode-plan')).not.toBeNull();
        expect(focusOf('plan')).toBe('');
    });

    it('a manual pick back to table does not resurrect the link focus', () => {
        mount('/swarm/pipeline/2?mode=table&step=47');
        click(node('pipeline-mode-plan'));
        click(node('pipeline-mode-table'));
        expect(focusOf('table')).toBe('');
    });
});
