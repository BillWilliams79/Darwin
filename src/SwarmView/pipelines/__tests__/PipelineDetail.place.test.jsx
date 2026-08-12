// @vitest-environment jsdom
//
// Req #3431 — THE WRITE SIDE. `PipelineDetail` is the single writer of the
// remembered place, and until this file nothing mounted it to check.
//
// The asymmetry that made the gap dangerous: `pipelinePlace.test.js` pins the
// storage module and `PipelinesPage.resume.test.jsx` SEEDS a record by hand
// before every journey, so both suites stay green while the app records
// nothing at all — and a feature that records nothing resumes to nothing. The
// reader's symptom is not an error; it is that clicking Pipelines always shows
// the list, exactly as it did before the requirement.
//
// The other half of what only this file can reach is WHICH ARRIVALS COUNT.
// Req #3311 wrote the id from the list page's click handler, so a plan opened
// by a `?step=` link, by the sessions grid, by the requirement page's epic box
// or by Back was never recorded — the reader had obviously last selected it and
// the app disagreed. Recording on arrival is the fix, and "on arrival" is only
// true if it survives the routes nobody enumerated.
//
// The two mode panels are STUBBED, as in `PipelineDetail.stepParam.test.jsx`:
// the real Plan mode is react-konva and needs a canvas jsdom does not provide,
// and none of this requirement's behaviour is in either panel.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The panel factory lives INSIDE the factory: vi.mock is hoisted above every
// top-level binding in this file, so a `const Panel` outside is a TDZ error.
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

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

// Flipped per test to stage the sequence the real app ALWAYS goes through:
// mount over a spinner, then the reads land.
let loading = false;

// req #3356 — ONE composed read where the 1.0 seven used to be. Two plans still,
// because the in-place-switch case below needs a second one to move to; the
// composed read is per-id, so the fixture is built once per plan and selected by
// the id the hook is called with.
vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const { composedFixture } = await import('./pipeline2ComposedFixture');
    const COMPOSED = new Map([
        [2, composedFixture({ id: 2, title: 'Darwin' })],
        [5, composedFixture({ id: 5, title: 'Substrate', pipelineStatus: 'completed' })],
    ]);
    const empty = () => ({ data: [], isLoading: false, isError: false });
    const gated = () => ({ data: [], isLoading: loading, isError: false });
    return {
        ...actual,
        useComposedPipeline2: (id) => ({
            // `undefined` while loading is what the real hook answers in flight;
            // `null` is its 404. The two must stay distinct here, because the
            // "records when the reads land" case turns on the page sitting over
            // a spinner rather than rendering the not-found alert.
            data: loading ? undefined : (COMPOSED.get(Number(id)) ?? null),
            isLoading: loading,
        }),
        useAllPipelines2: () => ({
            data: [{ id: 2 }, { id: 5 }], isLoading: false, isError: false, isSuccess: true,
        }),
        useMachines: gated,
        useOrchestrationClaims: empty,
        useAllRequirementSessions: empty,
        useAllSessionCostRollups: empty,
    };
});

import PipelineDetail from '../PipelineDetail';
import { PIPELINE_PLACE_SCHEMA_VERSION, PIPELINE_PLACE_STORAGE_KEY } from '../pipelinePlace';
import { PLAN_ERA_2 } from '../planEra';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

let roots = [];

const storedPlace = () => {
    const raw = localStorage.getItem(PIPELINE_PLACE_STORAGE_KEY);
    return raw == null ? null : JSON.parse(raw);
};

/** A control that changes the plan WITHOUT unmounting `PipelineDetail`. */
function GoTo({ to, testId }) {
    const navigate = useNavigate();
    return <button data-testid={testId} onClick={() => navigate(to)} />;
}

function mount(url) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false },
        },
    });
    const root = createRoot(host);
    // A FRESH ELEMENT PER RENDER, not a hoisted constant: React bails out of a
    // re-render when the element it is handed is reference-identical to the
    // last one, so a memoized tree makes `rerender()` a silent no-op — and the
    // "records when the reads land" case below would then pass or fail for a
    // reason that has nothing to do with the component.
    const tree = () => (
        <QueryClientProvider client={queryClient}>
            <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                <AuthContext.Provider
                    value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                    <MemoryRouter initialEntries={[url]}>
                        <GoTo to="/swarm/pipeline2/5" testId="go-plan-5" />
                        <Routes>
                            <Route path="/swarm/pipeline2/:id" element={<PipelineDetail />} />
                        </Routes>
                    </MemoryRouter>
                </AuthContext.Provider>
            </AppContext.Provider>
        </QueryClientProvider>
    );
    const render = () => act(() => { root.render(tree()); });
    render();
    roots.push(root);
    // `rerender` re-renders the same COMPONENT TREE, which is how a query
    // resolving is staged: nothing about the component changes, the mocked
    // hooks simply start answering differently.
    return { rerender: render };
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
const click = (testId) => act(() => { node(testId).click(); });

describe('PipelineDetail — recording the remembered place (req #3431)', () => {
    beforeEach(() => {
        roots = [];
        loading = false;
        localStorage.clear();
        sessionStorage.clear();
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        localStorage.clear();
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    // The whole feature's input. Without this write there is nothing for the
    // list page to resume to, and the reader sees the pre-#3431 behaviour with
    // no error anywhere to say so.
    it('records the plan the reader is looking at', () => {
        mount('/swarm/pipeline2/2');
        expect(storedPlace()).toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', era: PLAN_ERA_2, pipelineId: 2 });
    });

    // THE FIELD SET IS THE CONTRACT, so it is asserted as a field set rather
    // than by picking out `at` and `pipelineId`. `pipelinePlace.js` argues the
    // PANEL out of the record deliberately — it is already durable through
    // `useViewPreference`, and the only channel a resume could replay it on is
    // `?mode=`, which this page treats as a link asking to see one thing once.
    // A `mode` quietly added back here would put `?mode=` in the resumed URL,
    // where it outranks the reader's own preference and then LIES in the
    // address bar the moment they pick a different panel.
    it('records exactly {v, at, era, pipelineId} — never the panel', () => {
        mount('/swarm/pipeline2/2');
        // req #3463 added `era` and NOTHING ELSE. It is in the contract for the
        // same reason the panel is out of it: an id with no era is not an
        // address, while a panel is already durable elsewhere. req #3356
        // removed the page's `era` PROP but NOT this field — `pipelinePlace.js`
        // owns the record's shape, and a record written without it would read
        // as era-less to a reader that has not been collapsed yet.
        expect(Object.keys(storedPlace()).sort()).toEqual(['at', 'era', 'pipelineId', 'v']);
        click('pipeline-mode-plan');
        expect(node('mode-plan')).not.toBeNull();
        expect(storedPlace()).toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', era: PLAN_ERA_2, pipelineId: 2 });
    });

    // THE REASON THE WRITER MOVED HERE. Each of these is a route req #3311's
    // list-page click handler could not see, and each one is a plan the reader
    // would swear they had last selected.
    it.each([
        ['a ?step= deep link', '/swarm/pipeline2/2?mode=table&step=47'],
        ['an ?epic= link from the requirement page', '/swarm/pipeline2/2?epic=9'],
        ['a ?mode= link', '/swarm/pipeline2/2?mode=plan'],
        ['a bare bookmark', '/swarm/pipeline2/2'],
    ])('records an arrival by %s', (_label, url) => {
        mount(url);
        expect(storedPlace()).toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', era: PLAN_ERA_2, pipelineId: 2 });
    });

    // GATED ON THE RESOLVED PLAN, not on the id in the URL. A hand-typed or
    // stale id must never become the place the reader is sent back to — the
    // list page would then navigate to a not-found alert on every visit, which
    // reads as a defect in the data rather than in the record.
    it('records nothing for a plan that does not exist', () => {
        mount('/swarm/pipeline2/999');
        expect(node('pipeline-not-found')).not.toBeNull();
        expect(storedPlace()).toBeNull();
    });

    // ...and it LEAVES the good record alone rather than clearing it. A bad id
    // in the address bar says nothing about the plan the reader was last really
    // on, and forgetting it here would make one mistyped URL cost them the
    // resume.
    it('leaves an existing record intact when the URL names no plan', () => {
        localStorage.setItem(PIPELINE_PLACE_STORAGE_KEY,
            JSON.stringify({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', era: PLAN_ERA_2, pipelineId: 2 }));
        mount('/swarm/pipeline2/999');
        expect(storedPlace()).toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', era: PLAN_ERA_2, pipelineId: 2 });
    });

    // THE SEQUENCE THE REAL APP ALWAYS TAKES, which no other case here covers:
    // the page mounts over a spinner and the plan arrives on a later commit. An
    // effect that only fired on the first commit would record nothing in
    // production while every synchronous test above stayed green.
    it('records when the reads land, not before', () => {
        loading = true;
        const h = mount('/swarm/pipeline2/2');
        expect(storedPlace(), 'nothing is decided over a spinner').toBeNull();
        loading = false;
        h.rerender();
        expect(storedPlace()).toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', era: PLAN_ERA_2, pipelineId: 2 });
    });

    // This page survives an in-place switch from one plan to the next without
    // remounting (its own `pipelineId` note says so), so the record has to
    // follow the plan rather than the mount. Otherwise a reader who moved
    // between two plans by link is sent back to the first one.
    it('follows an in-place switch to another plan', () => {
        mount('/swarm/pipeline2/2');
        expect(storedPlace().pipelineId).toBe(2);
        click('go-plan-5');
        expect(storedPlace()).toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', era: PLAN_ERA_2, pipelineId: 5 });
    });

    // localStorage BY NAME — "a feature saved to local storage only", and
    // "hours later" is unreachable from the alternative. Asserting the record
    // round-trips proves nothing about this: it round-trips through either
    // store equally well. What pins it is that the other store stays empty.
    it('writes the record to localStorage and not to sessionStorage', () => {
        mount('/swarm/pipeline2/2');
        expect(localStorage.getItem(PIPELINE_PLACE_STORAGE_KEY)).not.toBeNull();
        expect(sessionStorage.getItem(PIPELINE_PLACE_STORAGE_KEY)).toBeNull();
    });
});
