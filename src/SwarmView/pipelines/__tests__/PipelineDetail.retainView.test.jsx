// @vitest-environment jsdom
//
// Req #3637 — "refresh, reload, should not change the viewport". The page half:
// a `?epic=`/`?initiative=` link moves the camera ONCE per history entry, never again
// on a reload or a Back/Forward onto it; a manual level pick rewrites the URL so
// a reload cannot resurrect the pin just left. (A bead click pushed a Table
// entry until req #3641 withdrew the Table; the canvas now frames the epic
// itself and the page is not involved.) The panels are stubbed (react-konva
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
    const Panel = (name) => function ModeStub({ focusEpicId, focusInitiativeId, onEpicFocus }) {
        // EVERY render, not just the last (req #3651): a stale focus that is
        // cleared a render later has already reached a mounting canvas.
        (globalThis.__panelRenders ||= []).push(
            { name, epic: focusEpicId ?? null, initiative: focusInitiativeId ?? null });
        return <div data-testid={`mode-${name}`}
                    data-focus-epic={focusEpicId == null ? '' : String(focusEpicId)}
                    data-focus-initiative={focusInitiativeId == null ? '' : String(focusInitiativeId)}>
            <button type="button" data-testid={`bead-${name}`}
                    onClick={() => onEpicFocus?.(47)} />
        </div>;
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
const focusInitiativeOf = (name) => node(`mode-${name}`)?.getAttribute('data-focus-initiative');
const focusEpicOf = (name) => node(`mode-${name}`)?.getAttribute('data-focus-epic');
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
    it('honours a fresh ?initiative= link and marks the entry, keeping the focus', () => {
        mount(['/swarm/pipeline/2?initiative=55']);
        expect(focusInitiativeOf('plan')).toBe('55');
        // Same URL, marked in place — so a reload of it is recognisable.
        expect(loc.search).toBe('?initiative=55');
        expect(loc.state).toEqual(consumed('?initiative=55'));
    });

    it('does NOT re-fire a marked ?initiative= entry (a reload) — the saved camera answers', () => {
        mount([{ pathname: '/swarm/pipeline/2', search: '?initiative=55', state: consumed('?initiative=55') }]);
        expect(node('mode-plan')).not.toBeNull();       // still the plan the link forced
        expect(focusInitiativeOf('plan')).toBe('');
    });

    it('does NOT re-fire a marked ?epic= entry, and stays on the plan', () => {
        mount([{ pathname: '/swarm/pipeline/2', search: '?mode=plan&epic=47',
            state: consumed('?mode=plan&epic=47') }]);
        expect(node('mode-plan')).not.toBeNull();
        expect(focusEpicOf('plan')).toBe('');
    });

    it('treats a mark for a DIFFERENT query as no mark', () => {
        mount([{ pathname: '/swarm/pipeline/2', search: '?initiative=56', state: consumed('?initiative=55') }]);
        expect(focusInitiativeOf('plan')).toBe('56');
    });

    it('a Back onto a marked entry clears the focus instead of re-fitting the link', () => {
        mount(['/swarm/pipeline/2?initiative=55']);
        expect(focusInitiativeOf('plan')).toBe('55');
        act(() => { nav('/swarm/pipeline/2?mode=plan&initiative=56'); });
        expect(focusInitiativeOf('plan')).toBe('56');
        act(() => { nav(-1); });
        expect(loc.search).toBe('?initiative=55');
        expect(focusInitiativeOf('plan')).toBe('');
    });
});

describe('PipelineDetail — manual picks rewrite the URL (req #3637)', () => {
    it('a manual level pick drops ?level= so a reload keeps the pick', () => {
        mount(['/swarm/pipeline/2?mode=plan&initiative=55&level=3']);
        act(() => { node('pipeline-viz-level-2').click(); });
        expect(new URLSearchParams(loc.search).get('level')).toBeNull();
        expect(localStorage.getItem('darwin-pipeline-viz-level')).toBe('2');
    });
});

// Req #3641 — the panel is given no `onEpicFocus`: an epic click is the canvas's
// own business (it frames the epic), so it neither switches panel nor pushes a
// history entry.
describe('PipelineDetail — a bead click stays on the plan (req #3641)', () => {
    it('does not navigate, and the plan stays the panel', () => {
        mount(['/swarm/pipeline/2?mode=plan']);
        act(() => { node('bead-plan').click(); });
        expect(node('mode-plan')).not.toBeNull();
        expect(loc.search).toBe('?mode=plan');
    });
});

describe('PipelineDetail — a RETURN never hands a panel the previous entry\'s focus (req #3651)', () => {
    // The measured defect: Back from a bead click's `?mode=table&epic=N` mounted
    // the canvas with `focusEpicId = N` for one render, which was enough for it
    // to start flying to the epic and save the interrupted flight over the
    // reader's camera. The final state was always right — which is why the
    // test above, which reads only the final state, passed throughout. A bead
    // click no longer pushes that link (req #3641 withdrew the Table), so the
    // epic link is followed directly — the property is the same: a RETURN
    // never carries the previous entry's focus.
    it('Back from an epic link: no plan render ever carries the epic', () => {
        mount(['/swarm/pipeline/2?mode=plan']);
        act(() => { nav('/swarm/pipeline/2?mode=plan&epic=47'); });
        expect(focusEpicOf('plan')).toBe('47');
        globalThis.__panelRenders = [];
        act(() => { nav(-1); });
        const plan = globalThis.__panelRenders.filter((r) => r.name === 'plan');
        expect(plan.length).toBeGreaterThan(0);
        expect(plan.filter((r) => r.epic != null || r.initiative != null)).toEqual([]);
    });

    it('Back from an initiative link onto a plain entry: no render carries the initiative', () => {
        mount(['/swarm/pipeline/2?mode=plan']);
        act(() => { nav('/swarm/pipeline/2?initiative=55'); });
        expect(focusInitiativeOf('plan')).toBe('55');
        globalThis.__panelRenders = [];
        act(() => { nav(-1); });
        expect(globalThis.__panelRenders.filter((r) => r.initiative != null)).toEqual([]);
    });

    it('a fresh link still focuses on its FIRST render, and keeps it through its own mark', () => {
        mount(['/swarm/pipeline/2?mode=plan']);
        globalThis.__panelRenders = [];
        act(() => { nav('/swarm/pipeline/2?mode=plan&initiative=55'); });
        const plan = globalThis.__panelRenders.filter((r) => r.name === 'plan');
        expect(plan.length).toBeGreaterThan(0);
        expect(plan.every((r) => r.initiative === 55)).toBe(true);
        expect(loc.state).toEqual(consumed('?mode=plan&initiative=55'));
    });

    it('Forward onto a marked link entry is a RETURN too — no re-fire', () => {
        mount(['/swarm/pipeline/2?mode=plan']);
        act(() => { nav('/swarm/pipeline/2?mode=plan&epic=47'); });
        act(() => { nav(-1); });
        globalThis.__panelRenders = [];
        act(() => { nav(1); });
        expect(node('mode-plan')).not.toBeNull();
        expect(globalThis.__panelRenders.filter((r) => r.epic != null)).toEqual([]);
    });
});
