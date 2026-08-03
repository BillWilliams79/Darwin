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
    const Panel = (name) => function ModeStub({ focusStepId, levelPref,
        levelPrefFromLink }) {
        return <div data-testid={`mode-${name}`}
                    data-focus={focusStepId == null ? '' : String(focusStepId)}
                    // Req #3253 — the level the panel is told to draw at. The
                    // canvas is react-konva and cannot mount here, so the only
                    // observable half of the `?level=` contract is the prop.
                    data-level={levelPref == null ? '' : String(levelPref)}
                    // Req #3310 — and WHOSE level it is. `levelPref` collapses
                    // the link's pin and the reader's stored one into one value
                    // by design; this is the only thing that tells them apart,
                    // and the canvas's camera correction turns on it.
                    data-level-link={levelPrefFromLink ? '1' : '0'} />;
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
const levelOf = (name) => node(`mode-${name}`)?.getAttribute('data-level');
const levelFromLinkOf = (name) => node(`mode-${name}`)?.getAttribute('data-level-link');
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

    // REVERSED BY REQ #3253, deliberately. The old rule forced the table even on
    // `?mode=plan&step=`, and its stated reason was that only the table consumed
    // `focusStepId` — a plan landing would have highlighted nothing. The plan
    // visualizer now consumes it (it centres and zooms on the bead), so the
    // reason is gone and an explicit `?mode=plan` is honoured.
    it('honours ?mode=plan when the link explicitly asks for it', () => {
        mount('/swarm/pipeline/2?mode=plan&step=47');
        expect(node('mode-plan')).not.toBeNull();
        expect(node('mode-table')).toBeNull();
        expect(focusOf('plan')).toBe('47');
    });

    it('still defaults a bare ?step= to the TABLE', () => {
        // The Steps editor's row link carries `mode=table` explicitly, but a
        // hand-typed or truncated URL must not silently change surface.
        mount('/swarm/pipeline/2?step=47');
        expect(node('mode-table')).not.toBeNull();
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

// ── Req #3253 — `?level=`, the transient semantic-level pin ─────────────────
// The requirement page's "view on plan" link lands on ONE STEP, and a one-step
// fit sits well past `SEMANTIC_IN_MIN`, so the canvas would auto-derive L3 and
// draw every requirement TITLE. The link pins L2 for that landing — and, like
// every other parameter on this page, for that landing ONLY: the reader's stored
// level is not rewritten and any manual pick ends the pin.
const storeLevel = (value) => {
    localStorage.setItem('darwin-pipeline-viz-level', value);
    sessionStorage.setItem('darwin-pipeline-viz-level', value);
};

describe('PipelineDetail — ?level= (req #3253)', () => {
    it('pins the level the link names', () => {
        mount('/swarm/pipeline/2?mode=plan&step=47&level=2');
        expect(levelOf('plan')).toBe('2');
    });

    it('wins over the reader\'s stored level for this landing', () => {
        storeLevel('3');
        mount('/swarm/pipeline/2?mode=plan&step=47&level=2');
        expect(levelOf('plan')).toBe('2');
        // ...and never writes it. The stored value is what the reader gets back
        // the next time they open a plan by any other route.
        expect(localStorage.getItem('darwin-pipeline-viz-level')).toBe('3');
    });

    it('leaves the stored level in charge with no ?level=', () => {
        storeLevel('3');
        mount('/swarm/pipeline/2?mode=plan');
        expect(levelOf('plan')).toBe('3');
    });

    it('ignores a value outside the vocabulary rather than pinning auto', () => {
        // `normalizePlanLevelPref` would answer 'auto' for these, which would
        // DISCARD the reader's stored L3. Falling through to null is the same
        // rule `?mode=xyz` follows.
        storeLevel('3');
        mount('/swarm/pipeline/2?mode=plan&level=9');
        expect(levelOf('plan')).toBe('3');
        mount('/swarm/pipeline/2?mode=plan&level=constructor');
        expect(levelOf('plan')).toBe('3');
        mount('/swarm/pipeline/2?mode=plan&level=');
        expect(levelOf('plan')).toBe('3');
    });

    it('a manual LEVEL pick clears the link pin and persists the choice', () => {
        storeLevel('3');
        mount('/swarm/pipeline/2?mode=plan&step=47&level=2');
        expect(levelOf('plan')).toBe('2');
        click(node('pipeline-viz-level-3'));
        expect(levelOf('plan')).toBe('3');
        expect(localStorage.getItem('darwin-pipeline-viz-level')).toBe('3');
        // Re-render via an unrelated state change — the pin must not come back.
        click(node('pipeline-description-btn'));
        expect(levelOf('plan')).toBe('3');
    });

    it('a manual MODE pick clears the link pin too', () => {
        storeLevel('auto');
        mount('/swarm/pipeline/2?mode=plan&step=47&level=2');
        expect(levelOf('plan')).toBe('2');
        click(node('pipeline-mode-table'));
        click(node('pipeline-mode-plan'));
        expect(levelOf('plan')).toBe('auto');
        expect(focusOf('plan')).toBe('');
    });
});

// ── Req #3310 — WHOSE level, and Reset ──────────────────────────────────────
// Since #3310 a pinned level the current scale cannot draw MOVES THE CAMERA, and
// every flag on that move splits on whether the reader chose the level in the
// moment. `levelPref` deliberately cannot answer that — it is one value for both
// sources — so the page passes the answer separately. Both facts below are
// invisible in the rendered canvas (react-konva does not mount here) and
// invisible in `levelPref`, which is exactly why they are asserted at the prop.
describe('PipelineDetail — whose level is it, and Reset (req #3310)', () => {
    it('marks a ?level= pin as the LINK\'s, not the reader\'s', () => {
        storeLevel('3');
        mount('/swarm/pipeline/2?mode=plan&step=47&level=2');
        expect(levelOf('plan')).toBe('2');
        // THE REGRESSION THIS GUARDS: read as a reader's own pick, the canvas
        // treats the link's pin as an in-the-moment camera instruction, raises
        // `userMovedCameraRef` — and the `?step=` focus arriving in the SAME
        // link is then skipped by its own guard. A silently dead link.
        expect(levelFromLinkOf('plan')).toBe('1');
    });

    it('marks the reader\'s stored pin as their own', () => {
        storeLevel('3');
        mount('/swarm/pipeline/2?mode=plan');
        expect(levelOf('plan')).toBe('3');
        expect(levelFromLinkOf('plan')).toBe('0');
    });

    it('a manual pick after a link is the reader\'s again', () => {
        storeLevel('auto');
        mount('/swarm/pipeline/2?mode=plan&step=47&level=2');
        expect(levelFromLinkOf('plan')).toBe('1');
        click(node('pipeline-viz-level-3'));
        expect(levelOf('plan')).toBe('3');
        expect(levelFromLinkOf('plan')).toBe('0');
    });

    // Reset lands on `factoryDefaultScale` — the whole plan's vertical extent,
    // which is BELOW `K_READABLE` on any plan large enough to need it. A pin that
    // survived it would leave a lit chip over an overview: the "stuck at L1"
    // state #3310 is about, one click away, in the level control's own left-hand
    // neighbour. `auto` IS the factory default, so Reset returns it.
    it('Reset returns the level to the factory default', () => {
        storeLevel('3');
        mount('/swarm/pipeline/2?mode=plan');
        expect(levelOf('plan')).toBe('3');
        click(node('pipeline-viz-reset'));
        expect(levelOf('plan')).toBe('auto');
        expect(localStorage.getItem('darwin-pipeline-viz-level')).toBe('auto');
        // Re-render via an unrelated state change — the pin must not come back.
        click(node('pipeline-description-btn'));
        expect(levelOf('plan')).toBe('auto');
    });

    it('Reset clears a LINK\'s pin too, so it cannot snap back', () => {
        storeLevel('auto');
        mount('/swarm/pipeline/2?mode=plan&step=47&level=2');
        expect(levelOf('plan')).toBe('2');
        click(node('pipeline-viz-reset'));
        expect(levelOf('plan')).toBe('auto');
        expect(levelFromLinkOf('plan')).toBe('0');
    });
});
