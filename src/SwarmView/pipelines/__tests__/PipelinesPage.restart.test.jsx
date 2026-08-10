// @vitest-environment jsdom
//
// Req #3431 — HOURS LATER, WITH THE BROWSER CLOSED IN BETWEEN.
//
// > *"so if you naviggate away you would hours later when coming back, go
// > straight that spot. a feature saved to local storage only."*
//
// This is the acceptance criterion in the requester's own terms, and it is the
// one thing none of the sibling suites can reach. Each of them proves a piece
// against a store that is never destroyed: `viewportMemory.test.js` asserts
// sessionStorage is never TOUCHED (a proxy for durability, not durability),
// `pipelinePlace.test.js` round-trips a record inside one realm, and
// `PipelinesPage.resume.test.jsx` seeds the record by hand. Every one of them
// stays green if some later change re-introduces a per-tab cache, a module-level
// memo, or a session-scoped seed — and the reader loses their place overnight
// with nothing anywhere to say so.
//
// ── WHAT "A BROWSER RESTART" IS, MECHANICALLY ──────────────────────────────
// Exactly one thing: sessionStorage is gone and localStorage is not. So the
// journey below is played in two halves with `sessionStorage.clear()` and a
// full unmount between them, and everything the reader gets back in the second
// half is something that survived that clear. Nothing is seeded by hand across
// the boundary — the first half PRODUCES the records through the real write
// paths, and if any of them were per-tab the second half simply would not find
// them.
//
// ── THE THREE FACTS THAT HAVE TO SURVIVE TOGETHER ──────────────────────────
// `viewportMemory.js` states it: two surfaces of one feature stored in two
// places would mean coming back to a plan whose camera survived and whose
// scroll did not. So this asserts all of them in ONE journey rather than three:
//   · WHICH PLAN      — `pipelinePlace.js`, the resume itself
//   · WHICH PANEL     — `useViewPreference`'s localStorage seed, which is the
//                       entire reason the panel is deliberately NOT in the
//                       place record. That argument has never been tested, and
//                       it is the half a reader would notice first.
//   · WHERE IN IT     — the camera (`viewportMemory.js`) and the list's scroll
//                       offset, both of which reversed store under this req.
//
// The mode panels are STUBBED (react-konva needs a canvas jsdom has not got),
// and `NavBar`/`SnackBar` are stubbed because neither takes part. `App` itself
// is REAL: it feeds the route trail, and the second half's last leg — walking
// back out of the resumed plan to the list — is only honest if the trail is fed
// the way the running app feeds it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../pipelineDetailModes', () => {
    const Panel = (name) => function ModeStub() {
        return <div data-testid={`mode-${name}`} />;
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

vi.mock('../../../NavBar/NavBar', () => ({ default: () => null }));
vi.mock('../../../Components/SnackBar/SnackBar', () => ({ SnackBar: () => null }));
vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

const PIPELINES = [
    { id: 2, title: 'Darwin', pipeline_status: 'active', description: '', machine_fk: null },
    { id: 5, title: 'Substrate', pipeline_status: 'active', description: '', machine_fk: null },
];

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useAllPipelines: () => ({ data: PIPELINES, isLoading: false, isError: false }),
        useAllPipelineSteps: empty,
        useAllPipelineStepRequirements: empty,
        useAllPipelineStepDeps: empty,
        useAllRequirements: empty,
        useAllFeatures: empty,
        useAllEpics: empty,
        useMachines: empty,
        useOrchestrationClaims: empty,
        useAllRequirementSessions: empty,
        useAllSessionCostRollups: empty,
    };
});

import App from '../../../App';
import PipelinesPage from '../PipelinesPage';
import PipelineDetail from '../PipelineDetail';
import { PIPELINE_PLACE_SCHEMA_VERSION, PIPELINE_PLACE_STORAGE_KEY } from '../pipelinePlace';
import { PLAN_ERA_1 } from '../planEra';
import { resetRouteTrail } from '../../../utils/routeTrail';
import { useSavedViewport } from '../../../hooks/useSavedViewport';
import { scrollStorageKey, viewportStorageKey } from '../../../utils/viewportMemory';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

const MODE_KEY = 'darwin-swarm-pipeline-detail-mode';
const LIST_SCROLL_KEY = scrollStorageKey('pipelines-list');
// The plan-2 camera, keyed and fingerprinted exactly as
// `PipelinePlanVisualizer` keys and fingerprints its own.
const CAM_KEY = viewportStorageKey('pipeline-plan', 2);
const CAM_FP = '1200x800:34:4';
const CAM = { x: -412.5, y: -96.25, k: 1.8 };

let roots = [];
let cameraApi = {};
// rAF is QUEUED, never run inline: `useScrollMemory`'s restore attaches its
// listener first and then schedules, and running the callback synchronously
// would apply the restore before the listener exists — an ordering no browser
// produces, and the one that hides the echo the hook exists to recognise. Same
// device as `useScrollMemory.test.jsx`.
let frames = [];
let cancelled = new Set();
let nextFrameId = 1;
const runFrames = (n = 4) => {
    for (let i = 0; i < n; i += 1) {
        const due = frames;
        frames = [];
        due.forEach(({ id, cb }) => { if (!cancelled.has(id)) cb(0); });
    }
};

// The window scroller, modelled the way the hook's own suite models it: jsdom
// has no layout, so `scrollTo` is spied and `scrollX/scrollY` are made to
// report what it was given.
let windowScroll = { x: 0, y: 0 };

/**
 * A stand-in for the plan visualizer's camera lifecycle.
 *
 * The real one is react-konva and cannot mount here, but the camera it saves
 * goes through `useSavedViewport` — so the hook IS the write path, and using it
 * means the record in the second half was produced rather than planted.
 */
function CameraProbe() {
    cameraApi.current = useSavedViewport(CAM_KEY, CAM_FP);
    return null;
}

/**
 * The nav rail's Pipelines item, reduced to what it does.
 *
 * A real in-app navigation and not a second mount, because the trap this
 * feature can set only exists on that path: the app shell records the plan as
 * the route the reader came from, and the resume gate has to read it. Mounting
 * the list afresh would test an arrival the reader never makes.
 */
function NavRailPipelines() {
    const navigate = useNavigate();
    return <button data-testid="nav-pipelines" onClick={() => navigate('/swarm/pipelines')} />;
}

function mount(start) {
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
                        value={{ idToken: 'tok',
                                 profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <CameraProbe />
                        <MemoryRouter initialEntries={[start]}>
                            <NavRailPipelines />
                            <Routes>
                                <Route element={<App />}>
                                    <Route path="/swarm/pipelines" element={<PipelinesPage />} />
                                    <Route path="/swarm/pipeline/:id"
                                           element={<PipelineDetail />} />
                                </Route>
                            </Routes>
                        </MemoryRouter>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>,
        );
    });
    roots.push(root);
    return { unmount: () => act(() => root.unmount()) };
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
const click = (el) => act(() => { el.click(); });
const onTheList = () => node('pipelines-status-filter') != null;
const storedPlace = () => {
    const raw = localStorage.getItem(PIPELINE_PLACE_STORAGE_KEY);
    return raw == null ? null : JSON.parse(raw);
};
/** Scroll the document the way a reader does, and let the hook hear it. */
const scrollWindowTo = (x, y) => act(() => {
    windowScroll = { x, y };
    window.dispatchEvent(new Event('scroll'));
});

// The timeout is raised off the 5s default deliberately. Each case mounts the
// app shell, a QueryClient, the list page and the plan page — twice, once per
// half of the journey — and the FIRST case in the file additionally pays the
// cold-start cost of that module graph. Measured at ~9s cold and ~3s warm, so
// the default fails the first case and only the first case: a flake that reads
// as a hang and is nothing of the kind.
describe('Pipelines — coming back after the browser was closed (req #3431)',
    { timeout: 30_000 }, () => {
    beforeEach(() => {
        roots = [];
        cameraApi = {};
        frames = [];
        cancelled = new Set();
        nextFrameId = 1;
        windowScroll = { x: 0, y: 0 };
        localStorage.clear();
        sessionStorage.clear();
        resetRouteTrail();
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
            const id = nextFrameId;
            nextFrameId += 1;
            frames.push({ id, cb });
            return id;
        });
        vi.spyOn(globalThis, 'cancelAnimationFrame')
            .mockImplementation((id) => { cancelled.add(id); });
        vi.spyOn(window, 'scrollTo').mockImplementation((x, y) => { windowScroll = { x, y }; });
        Object.defineProperty(window, 'scrollX',
            { configurable: true, get: () => windowScroll.x });
        Object.defineProperty(window, 'scrollY',
            { configurable: true, get: () => windowScroll.y });
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        // `restoreAllMocks` does not undo `defineProperty`; jsdom's own offsets
        // are plain data properties on the window.
        Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
        Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
        localStorage.clear();
        sessionStorage.clear();
    });

    /**
     * THE FIRST HALF — the reader does a normal session's worth of work.
     *
     * Every record the second half depends on is produced here, through the
     * app's own write paths and nothing else.
     */
    function anOrdinarySession() {
        const session = mount('/swarm/pipelines');
        expect(onTheList(), 'a cold first visit shows the list').toBe(true);

        // They scroll down the list, then open the second plan from a card.
        scrollWindowTo(0, 640);
        click(node('pipeline-card-2').querySelector('button'));
        expect(node('pipeline-detail'), 'the plan opened').not.toBeNull();

        // ...pick the Plan panel, and leave the camera somewhere distinctive.
        click(node('pipeline-mode-plan'));
        expect(node('mode-plan')).not.toBeNull();
        act(() => { cameraApi.current.record(CAM); cameraApi.current.commit(); });

        return session;
    }

    /** Close the browser: every tab gone, and sessionStorage with them. */
    function closeTheBrowser(session) {
        session.unmount();
        document.body.innerHTML = '';
        sessionStorage.clear();
        resetRouteTrail();      // a new process has no idea where anyone was
        roots = [];
        frames = [];
        cancelled = new Set();
    }

    it('resumes to the plan, in the panel and at the camera the reader left', () => {
        const session = anOrdinarySession();

        // Everything the second half needs is in the DURABLE store, and the
        // per-tab store holds nothing that matters. Asserted BEFORE the clear,
        // so a later change that quietly moved one of these back to
        // sessionStorage reddens HERE, naming the record, instead of surfacing
        // as an unexplained failure to resume three assertions later.
        expect(localStorage.getItem(PIPELINE_PLACE_STORAGE_KEY)).not.toBeNull();
        expect(localStorage.getItem(CAM_KEY)).not.toBeNull();
        expect(localStorage.getItem(LIST_SCROLL_KEY)).not.toBeNull();
        expect(sessionStorage.getItem(PIPELINE_PLACE_STORAGE_KEY)).toBeNull();
        expect(sessionStorage.getItem(CAM_KEY)).toBeNull();
        expect(sessionStorage.getItem(LIST_SCROLL_KEY)).toBeNull();

        closeTheBrowser(session);

        // ── HOURS LATER. The reader clicks Pipelines in a brand-new window:
        // a cold route trail, an empty sessionStorage, and nothing else.
        mount('/swarm/pipelines');

        // 1. WHICH PLAN. This is the sentence the requirement is made of.
        expect(node('pipeline-detail'), 'it went straight to the plan').not.toBeNull();
        expect(onTheList()).toBe(false);

        // 2. WHICH PANEL — and it comes back WITHOUT being in the place record.
        //    `useViewPreference` finds nothing in the (cleared) sessionStorage
        //    and seeds the tab from localStorage. That seed is the whole reason
        //    `pipelinePlace.js` refuses to carry a `mode`, and if it ever stops
        //    being true the record would have to grow one — so this is the
        //    assertion that would tell somebody.
        expect(node('mode-plan'), 'in the panel the reader left').not.toBeNull();
        expect(node('mode-table')).toBeNull();

        // 3. WHERE IN IT. Read through the same hook the visualizer restores
        //    with, at the same fingerprint, so this is the camera the canvas
        //    would actually have been handed.
        expect(cameraApi.current.read()).toEqual(CAM);
    });

    // THE LAST LEG, and the one that makes the whole thing usable rather than a
    // trap: from the resumed plan the reader must still be able to reach the
    // list, and when they do it must be where they left it. The resume is what
    // makes the list scroll worth keeping at all — a reader who is always put
    // back on a plan never sees the list they scrolled.
    it('lets the reader walk back out to the list, restored where they left it', () => {
        const session = anOrdinarySession();
        closeTheBrowser(session);

        mount('/swarm/pipelines');
        expect(node('pipeline-detail'), 'resumed first').not.toBeNull();

        // Everything the resume itself may have done to the scroller is behind
        // us. Counted from HERE, so the assertion below cannot be satisfied by
        // the restore the outgoing list page fired on its way out — which is a
        // real call with the same arguments (see `PipelinesPage.resume`'s own
        // case for why it is harmless), and would make this vacuous.
        act(() => { runFrames(4); });
        const before = window.scrollTo.mock.calls.length;

        // Pipelines in the nav rail, from inside the resumed plan. The shell
        // has recorded the plan as the route they came from, so the gate holds
        // the resume back and the list is reachable.
        click(node('nav-pipelines'));
        expect(onTheList(), 'the list is reachable from the plan it resumed to').toBe(true);
        expect(storedPlace(), 'and leaving it is recorded, without losing the mark')
            .toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'list', era: PLAN_ERA_1, pipelineId: 2 });

        // The restore is a queued frame, not a synchronous write.
        act(() => { runFrames(4); });
        expect(window.scrollTo.mock.calls.slice(before),
            'the list came back where the reader left it before the browser closed')
            .toContainEqual([0, 640]);
    });

    // THE NEGATIVE CONTROL, and it is what stops the two cases above from
    // passing for the wrong reason. If the records had been per-tab all along,
    // "close the browser" would be indistinguishable from "clear everything" —
    // so clearing LOCALSTORAGE INSTEAD must produce the opposite outcome. Both
    // halves fail together the moment durability is only apparent.
    it('and none of it comes back if the DURABLE store is the one that is lost', () => {
        const session = anOrdinarySession();
        session.unmount();
        document.body.innerHTML = '';
        localStorage.clear();       // the profile was wiped, not the tab
        resetRouteTrail();
        roots = [];

        mount('/swarm/pipelines');
        expect(onTheList(), 'nothing to resume to').toBe(true);
        expect(storedPlace(), 'and the page starts the record over')
            .toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'list', era: PLAN_ERA_1, pipelineId: null });
        expect(cameraApi.current.read()).toBeNull();
    });
});
