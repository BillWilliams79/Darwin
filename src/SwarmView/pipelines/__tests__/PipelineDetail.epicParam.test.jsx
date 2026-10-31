// @vitest-environment jsdom
//
// Req #3140 — the RECEIVING end of the Epics editor's row link.
//
// `pipelineEpicLink.test.js` pins the two pure functions. This pins the React
// half: a `?epic=` link seeds `focusEpicId` on the plan visualizer. Since req
// #3641 the Plan visualizer is the ONLY panel (the Table was withdrawn), so a
// named epic always lands on the plan — whatever `?mode=` an older link
// carries — and there is no mode switcher on the page at all.
//
// The panel is STUBBED: the real Plan mode is react-konva, which needs a canvas
// jsdom does not provide. The stub reports the props the handshake is made of.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The panel factory lives INSIDE the factory: vi.mock is hoisted above every
// top-level binding in this file, so a `const Panel` outside is a TDZ error.
vi.mock('../pipelineDetailModes', () => {
    const Panel = (name) => function ModeStub({ focusEpicId, levelPref, epicWidthLevel, onEpicDeleted }) {
        return <div data-testid={`mode-${name}`}
                    data-epic-width={epicWidthLevel == null ? '' : String(epicWidthLevel)}
                    data-focus={focusEpicId == null ? '' : String(focusEpicId)}
                    // Req #3253 — the level the panel is told to draw at. The
                    // canvas is react-konva and cannot mount here, so the only
                    // observable half of the `?level=` contract is the prop.
                    data-level={levelPref == null ? '' : String(levelPref)}>
            {/* req #4154 — the plan editor's epic delete reports the id upward. */}
            <button type="button" data-testid={`mode-${name}-delete-47`} onClick={() => onEpicDeleted?.(47)} />
            <button type="button" data-testid={`mode-${name}-delete-99`} onClick={() => onEpicDeleted?.(99)} />
        </div>;
    };
    // A `data-level-link` attribute rode beside it between req #3310 and req
    // #3324, mirroring the `levelPrefFromLink` prop the page passed so the
    // canvas could tell a reader's own pick from a `?level=` link's — the pin's
    // camera correction split every one of its flags on that. #3324 deleted the
    // correction and the prop with it: a level is DRAWN the same way whoever
    // asked for it, so there is nothing left for the stub to observe. Emitting
    // it anyway would have made three assertions read `'0'` — the only value it
    // could still produce — which is a green test asserting nothing.
    // The real registry's shape since req #3641: ONE mode.
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
let currentSearch = '';
function SearchProbe() { currentSearch = useLocation().search; return null; }

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
                            <SearchProbe />
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
const storedLevel = () => localStorage.getItem('darwin-pipeline-viz-level');
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

describe('PipelineDetail — deleting the focused epic (req #4154)', () => {
    it('drops the focus when the epic the page landed on is deleted', () => {
        mount('/swarm/pipeline/2?mode=plan&epic=47');
        expect(focusOf('plan')).toBe('47');
        click(node('mode-plan-delete-47'));
        expect(focusOf('plan')).toBe('');
        // …and the link's `?epic=` is gone from the URL, the rest of the query kept.
        expect(currentSearch).toBe('?mode=plan');
    });

    it('keeps the focus when a different epic is deleted', () => {
        mount('/swarm/pipeline/2?mode=plan&epic=47');
        click(node('mode-plan-delete-99'));
        expect(focusOf('plan')).toBe('47');
    });
});

describe('PipelineDetail — ?epic= (req #3140)', () => {
    it('seeds the focus on the FIRST render, not after an effect', () => {
        // `useState(linkEpicId)` rather than a `useState(null)` an effect corrects:
        // a focus that arrives a paint later can miss the panel's own effect.
        mount('/swarm/pipeline/2?mode=plan&epic=47');
        expect(focusOf('plan')).toBe('47');
    });

    it('honours ?mode=plan when the link explicitly asks for it', () => {
        mount('/swarm/pipeline/2?mode=plan&epic=47');
        expect(node('mode-plan')).not.toBeNull();
        expect(focusOf('plan')).toBe('47');
    });

    // REQ #3641 — a bare `?epic=` used to default to the Table. The Table is
    // gone, so it lands on the plan, which centres and zooms on that epic.
    it('lands a bare ?epic= on the PLAN, focused', () => {
        mount('/swarm/pipeline/2?epic=47');
        expect(node('mode-plan')).not.toBeNull();
        expect(focusOf('plan')).toBe('47');
    });

    it('lands an old ?mode=table&epic= link on the plan, focused', () => {
        mount('/swarm/pipeline/2?mode=table&epic=47');
        expect(node('mode-plan')).not.toBeNull();
        expect(focusOf('plan')).toBe('47');
    });

    it('opens the plan for a reader whose STORED preference says table', () => {
        storePreference('table');
        mount('/swarm/pipeline/2');
        expect(node('mode-plan')).not.toBeNull();
        expect(focusOf('plan')).toBe('');
        // …and never rewrites it (`normalizeView` never writes back).
        expect(localStorage.getItem('darwin-swarm-pipeline-detail-mode')).toBe('table');
    });

    it('renders no mode switcher — the visualizer is the only view (req #3641)', () => {
        mount('/swarm/pipeline/2');
        expect(node('pipeline-detail-mode-toggle')).toBeNull();
        expect(node('pipeline-mode-table')).toBeNull();
        expect(node('pipeline-mode-plan')).toBeNull();
    });

    it('carries no focus when the parameter is absent or unusable', () => {
        mount('/swarm/pipeline/2?mode=plan');
        expect(focusOf('plan')).toBe('');
    });

    it('ignores a non-integer ?epic=, rather than focusing NaN or 0', () => {
        mount('/swarm/pipeline/2?mode=plan&epic=12abc');
        expect(focusOf('plan')).toBe('');
        mount('/swarm/pipeline/2?mode=plan&epic=');
        expect(focusOf('plan')).toBe('');
    });
});

// ── Req #3253 — `?level=`, the transient semantic-level pin ─────────────────
// The requirement page's "view on plan" link lands on ONE EPIC, and a one-epic
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
        mount('/swarm/pipeline/2?mode=plan&epic=47&level=2');
        expect(levelOf('plan')).toBe('2');
    });

    it('wins over the reader\'s stored level for this landing', () => {
        storeLevel('3');
        mount('/swarm/pipeline/2?mode=plan&epic=47&level=2');
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
        mount('/swarm/pipeline/2?mode=plan&epic=47&level=2');
        expect(levelOf('plan')).toBe('2');
        click(node('pipeline-viz-level-3'));
        expect(levelOf('plan')).toBe('3');
        expect(localStorage.getItem('darwin-pipeline-viz-level')).toBe('3');
        // Re-render via an unrelated state change — the pin must not come back.
        click(node('pipeline-viz-colorkey-state'));
        expect(levelOf('plan')).toBe('3');
    });
});

// ── Req #3324 — the level is FIXED UNTIL AUTO IS SELECTED ───────────────────
// > *"the buttons are sticky … it's fixed until Auto is selected."*
//
// So the page's job is to hand the canvas one level and to change it for exactly
// two reasons: the reader picked one, or a `?level=` link asked for one. Nothing
// else may touch it — and RESET is the "nothing else" this describe is about,
// because Reset DID clear it between req #3310 and #3324 and that is the
// behaviour these cases were written to lock in. They now lock in its opposite.
//
// WHY IT IS ASSERTED AT THE PROP: the canvas is react-konva and cannot mount
// here, so `levelPref` is the whole of what this page can be observed to decide.
// The four modes' RENDERING contract lives in `pipelinePlanLayout.test.js`
// (`the four modes`) and in PIPE-16/16b.
describe('PipelineDetail — the level is fixed until Auto (req #3324)', () => {
    it('hands the canvas a ?level= link\'s pin', () => {
        storeLevel('3');
        mount('/swarm/pipeline/2?mode=plan&epic=47&level=2');
        expect(levelOf('plan')).toBe('2');
        // …and does NOT write it to storage: a link asks to see one thing once
        // (req #3253), so the reader's own L3 is still there afterward.
        expect(storedLevel()).toBe('3');
    });

    it('hands the canvas the reader\'s stored pin when no link asks', () => {
        storeLevel('3');
        mount('/swarm/pipeline/2?mode=plan');
        expect(levelOf('plan')).toBe('3');
    });

    it('a manual pick after a link wins, and persists', () => {
        storeLevel('auto');
        mount('/swarm/pipeline/2?mode=plan&epic=47&level=2');
        expect(levelOf('plan')).toBe('2');
        click(node('pipeline-viz-level-3'));
        expect(levelOf('plan')).toBe('3');
        expect(storedLevel()).toBe('3');
    });

    // THE #3310 BEHAVIOUR, INVERTED (req #3324). Reset lands on
    // `factoryDefaultScale` — the whole plan's vertical extent, below
    // `K_READABLE` on any plan large enough to need it — and #3310 cleared the
    // pin there because a pin could not be DRAWN at that scale, so a lit chip
    // sat over a blank overview. #3324 honours the pin at every scale, so the
    // factory camera and a pinned level are a coherent pair and Reset is what it
    // says: the view. The reader's way back to Auto is the Auto chip.
    it('Reset restores the camera and leaves the pinned level alone', () => {
        storeLevel('3');
        mount('/swarm/pipeline/2?mode=plan');
        expect(levelOf('plan')).toBe('3');
        click(node('pipeline-viz-reset'));
        expect(levelOf('plan')).toBe('3');
        expect(storedLevel()).toBe('3');
        // Re-render via an unrelated state change — still L3.
        click(node('pipeline-viz-colorkey-state'));
        expect(levelOf('plan')).toBe('3');
    });

    it('Reset leaves a LINK\'s pin alone too', () => {
        storeLevel('auto');
        mount('/swarm/pipeline/2?mode=plan&epic=47&level=2');
        expect(levelOf('plan')).toBe('2');
        click(node('pipeline-viz-reset'));
        expect(levelOf('plan')).toBe('2');
    });

    // req #3648 — Epic Width is a rung in quarters of the base card; the plan
    // opens at 5 (25% wider), a level stored under the OLD key is not read, and
    // the title has no tooltip.
    it('opens at Epic Width 5 and ignores a level stored under the old key', () => {
        window.localStorage.setItem('darwin-pipeline-viz-epic-width', '1');
        mount('/swarm/pipeline/2?mode=plan');
        expect(node('mode-plan').getAttribute('data-epic-width')).toBe('5');
    });

    it('a stored rung is not drawn while the Epic Width control is hidden', () => {
        window.localStorage.setItem('darwin-pipeline-viz-epic-width-q', '6');
        mount('/swarm/pipeline/2?mode=plan');
        expect(node('mode-plan').getAttribute('data-epic-width')).toBe('5');
    });

    it('the title carries no tooltip', () => {
        mount('/swarm/pipeline/2?mode=plan');
        const title = node('pipeline-title');
        expect(title.hasAttribute('aria-label')).toBe(false);
        expect(title.getAttribute('aria-describedby')).toBeNull();
    });

    it('AUTO is the one control that clears a pin', () => {
        storeLevel('3');
        mount('/swarm/pipeline/2?mode=plan');
        click(node('pipeline-viz-level-auto'));
        expect(levelOf('plan')).toBe('auto');
        expect(storedLevel()).toBe('auto');
        // And clicking the PINNED chip is the same exit (the shared control's
        // escape hatch), so a pin is never a trap.
        click(node('pipeline-viz-level-2'));
        expect(levelOf('plan')).toBe('2');
        click(node('pipeline-viz-level-2'));
        expect(levelOf('plan')).toBe('auto');
    });
});
