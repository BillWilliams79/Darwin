// @vitest-environment jsdom
//
// Req #3637 — "refresh, reload, should not change the viewport". The page half:
// a `?step=`/`?epic=` link moves the camera ONCE per history entry, never again
// on a reload or a Back/Forward onto it; a manual mode pick rewrites the URL so
// a reload cannot resurrect the panel just left; a bead click pushes an entry so
// the browser's Back returns to the canvas. The panels are stubbed (react-konva
// needs a canvas jsdom does not provide) — the canvas half's landing rule is
// `planLandingAction` (pinned in `pipelinePlanLayout.landing.test.js`) and the
// record lifecycle is `useSavedViewport.test.jsx`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../pipelineDetailModes', () => {
    const Panel = (name) => function ModeStub({ focusStepId, focusEpicId, onStepFocus }) {
        return <div data-testid={`mode-${name}`}
                    data-focus-step={focusStepId == null ? '' : String(focusStepId)}
                    data-focus-epic={focusEpicId == null ? '' : String(focusEpicId)}>
            <button type="button" data-testid={`bead-${name}`}
                    onClick={() => onStepFocus?.(47)} />
        </div>;
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
let loc = null;
let nav = null;

function Probe() {
    loc = useLocation();
    nav = useNavigate();
    return null;
}

// `entry` is a URL string or a `{pathname, search, state}` object — the latter
// is how a RELOAD looks to the page: same URL, and the history entry's own
// state survives (the browser keeps `history.state` across a reload).
function mount(entries, initialIndex) {
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
                        <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
                            <Probe />
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
const focusEpicOf = (name) => node(`mode-${name}`)?.getAttribute('data-focus-epic');
const focusStepOf = (name) => node(`mode-${name}`)?.getAttribute('data-focus-step');
const consumed = (search) => ({ planLinkConsumed: search });

beforeEach(() => {
    mountedRoots = [];
    loc = null;
    nav = null;
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

describe('PipelineDetail — a deep link fires once per history entry (req #3637)', () => {
    it('honours a fresh ?epic= link and marks the entry, keeping the focus', () => {
        mount(['/swarm/pipeline/2?epic=55']);
        expect(focusEpicOf('plan')).toBe('55');
        // Same URL, marked in place — so a reload of it is recognisable.
        expect(loc.search).toBe('?epic=55');
        expect(loc.state).toEqual(consumed('?epic=55'));
    });

    it('does NOT re-fire a marked ?epic= entry (a reload) — the saved camera answers', () => {
        mount([{ pathname: '/swarm/pipeline/2', search: '?epic=55', state: consumed('?epic=55') }]);
        expect(node('mode-plan')).not.toBeNull();       // still the plan the link forced
        expect(focusEpicOf('plan')).toBe('');
    });

    it('does NOT re-fire a marked ?step= entry, and keeps the table it forced', () => {
        mount([{ pathname: '/swarm/pipeline/2', search: '?mode=table&step=47',
            state: consumed('?mode=table&step=47') }]);
        expect(node('mode-table')).not.toBeNull();
        expect(focusStepOf('table')).toBe('');
    });

    it('treats a mark for a DIFFERENT query as no mark', () => {
        mount([{ pathname: '/swarm/pipeline/2', search: '?epic=56', state: consumed('?epic=55') }]);
        expect(focusEpicOf('plan')).toBe('56');
    });

    it('a Back onto a marked entry clears the focus instead of re-fitting the link', () => {
        mount(['/swarm/pipeline/2?epic=55']);
        expect(focusEpicOf('plan')).toBe('55');
        act(() => { nav('/swarm/pipeline/2?mode=plan&epic=56'); });
        expect(focusEpicOf('plan')).toBe('56');
        act(() => { nav(-1); });
        expect(loc.search).toBe('?epic=55');
        expect(focusEpicOf('plan')).toBe('');
    });
});

describe('PipelineDetail — manual picks rewrite the URL (req #3637)', () => {
    it('a manual mode pick drops ?mode=/?step=/?epic=/?level= so a reload keeps the pick', () => {
        localStorage.setItem('darwin-swarm-pipeline-detail-mode', 'plan');
        mount(['/swarm/pipeline/2?mode=plan&epic=55&level=3']);
        act(() => { node('pipeline-mode-table').click(); });
        expect(node('mode-table')).not.toBeNull();
        expect(loc.search).toBe('');
        // …and the stored preference is what a reload lands on.
        expect(localStorage.getItem('darwin-swarm-pipeline-detail-mode')).toBe('table');
    });
});

describe('PipelineDetail — a bead click is a history entry (req #3637)', () => {
    it('pushes the step\'s table link, and Back returns to the plan with no focus', () => {
        mount(['/swarm/pipeline/2?mode=plan']);
        act(() => { node('bead-plan').click(); });
        expect(node('mode-table')).not.toBeNull();
        expect(focusStepOf('table')).toBe('47');
        expect(loc.search).toBe('?mode=table&step=47');
        act(() => { nav(-1); });
        expect(loc.search).toBe('?mode=plan');
        expect(node('mode-plan')).not.toBeNull();
        expect(focusStepOf('plan')).toBe('');
    });
});
