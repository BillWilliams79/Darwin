// @vitest-environment jsdom
//
// PipelineDetail — WHICH TABLE THE PAGE READS, mounted (req #3463).
//
// WHAT ONLY THIS FILE CAN REACH. `planEra.test.js` proves the route binding is
// stated once and obeyed by the source tree; `usePlanSources.js` proves nothing
// on its own. What neither reaches is the page ACTUALLY READING the right table
// — and that is precisely what req #3381 got wrong: every module it wrote was
// correct and reviewed, and the page still read the wrong one.
//
// ── req #3356: THE 1.0 HALF IS GONE, THE ASSERTIONS GOT STRONGER ───────────
// This file used to mount the page TWICE, once per era, and assert that each
// read its own tables and not the other's. Pipeline 1.0 is eradicated: there is
// one route, the page takes no `era` prop, and `usePlan1Sources` no longer
// exists. So the 1.0 cases are deleted — but the COUNTERS on the seven 1.0
// hooks are kept, and asserting they are never touched is now a PERMANENT
// claim rather than a per-era one. That is the outage's own acceptance
// criterion, inverted and made unconditional.
//
// The two things asserted here:
//
//   1. The page reads `pipeline_compose` and NOTHING from the 1.0 seven.
//   2. A MISS IS LOUD. req #3462's fifth why was that 80 identical 404s during
//      verification rendered as a tidy "No pipeline with id 79" — so the alert
//      must name the entity that answered and the ids it holds, and an EMPTY
//      table must not read the same as a missing plan.
//
// The two mode panels are STUBBED, as in `PipelineDetail.place.test.jsx`: the
// real Plan mode is react-konva and needs a canvas jsdom does not provide, and
// none of this requirement's behaviour is in either panel.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// ── The two data worlds, and A COUNTER ON EACH ─────────────────────────────
// The counters are the whole point of the mock. Asserting on what RENDERED
// would pass if the page read both eras and picked the right one to draw; what
// the outage needs ruled out is the page READING the wrong table at all.
const COMPOSED_2 = {
    pipeline: { id: 7, title: 'Darwin (2.0)', pipeline_status: 'active', description: '' },
    epics: [], steps: [], step_requirements: [], step_deps: [], requirements: [],
    derived: { rows: [], rows_complete: true, withheld: false },
};

let reads;
// What the 2.0 composed read answers: the payload, or `null` for a 404.
let composedAnswer;
// What the 2.0 plan INDEX answers on the not-found path.
let known2;
// Whether the list reads have SETTLED SUCCESSFULLY. `false` stages the two
// states the id-list report must never mistake for an empty table: still in
// flight, and failed. `fetchEntity` maps a 5xx to `undefined` and the hooks'
// `= EMPTY` default turns that into `[]`, so both look exactly like a table
// with no rows unless `isSuccess` is consulted (code review, req #3463).
let listSettled;

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const empty = () => ({ data: [], isLoading: false, isError: false });
    const count = (name) => (creatorFk, opts = {}) => {
        // `enabled: false` means the query issues NO request, so a disabled hook
        // must not count as a read — that is the property being asserted.
        if (opts.enabled !== false) reads[name] = (reads[name] || 0) + 1;
        return { data: [], isLoading: false, isError: false };
    };
    return {
        ...actual,
        // The plan-layer LIST hooks all still EXIST (the editor pages read
        // them); what must never happen is this page reaching for one, because
        // the composed route already answered the whole render server-side.
        // Counted so "never read" is asserted rather than assumed.
        //
        // `useAllPipelines` is NOT in this group — see the header. It is the
        // index, it is read on the miss path, and it is stubbed below.
        useAllPipelineSteps: count('steps'),
        useAllPipelineStepRequirements: count('stepRequirements'),
        useAllPipelineStepDeps: count('stepDeps'),
        useAllRequirements: count('requirements'),
        useAllFeatures: count('features'),
        useAllEpics: count('epics'),
        useComposedPipeline: (id, opts = {}) => {
            if (opts.enabled !== false) reads.composed = (reads.composed || 0) + 1;
            return {
                data: opts.enabled === false ? undefined : composedAnswer,
                isLoading: false,
            };
        },
        useAllPipelines: (creatorFk, opts = {}) => {
            if (opts.enabled !== false) reads.pipelineIndex = (reads.pipelineIndex || 0) + 1;
            return {
                data: opts.enabled === false || !listSettled ? [] : known2,
                isLoading: false, isError: !listSettled,
                isSuccess: opts.enabled !== false && listSettled,
            };
        },
        useMachines: () => ({ data: [], isLoading: false, isError: false }),
        useOrchestrationClaims: empty,
        useAllRequirementSessions: empty,
        useAllSessionCostRollups: empty,
    };
});

import PipelineDetail from '../PipelineDetail';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

let roots = [];

function mount(url, routePath = '/swarm/pipeline/:id') {
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
                                <Route path={routePath} element={<PipelineDetail />} />
                            </Routes>
                        </MemoryRouter>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>);
    });
    roots.push(root);
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
const text = (testId) => (node(testId)?.textContent || '').replace(/\s+/g, ' ').trim();

describe('PipelineDetail — which table is read (req #3463, one era since #3356)', () => {
    beforeEach(() => {
        roots = [];
        reads = {};
        composedAnswer = COMPOSED_2;
        known2 = [];
        listSettled = true;
        localStorage.clear();
        document.body.innerHTML = '';
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('reads the composed read and NEVER issues any 1.0 read', () => {
        mount('/swarm/pipeline/7');

        expect(reads.composed).toBeGreaterThan(0);
        // Every one of the six, BY NAME: a blanket "no other read fired" would
        // pass vacuously the moment a hook was renamed — which is precisely how
        // this file lost an assertion during req #3356's rename.
        expect(reads.steps).toBeUndefined();
        expect(reads.stepRequirements).toBeUndefined();
        expect(reads.stepDeps).toBeUndefined();
        expect(reads.requirements).toBeUndefined();
        expect(reads.features).toBeUndefined();
        expect(reads.epics).toBeUndefined();
        // The index is not read on the happy path either — asserted here as
        // well as in its own case, because this is where a reader looks for the
        // complete list of what the happy path costs.
        expect(reads.pipelineIndex).toBeUndefined();
        expect(node('pipeline-not-found')).toBeNull();
    });

    it('renders the plan panel once the composed read resolves', () => {
        mount('/swarm/pipeline/7');
        expect(node('mode-table')).not.toBeNull();
    });
});

describe('PipelineDetail — a miss is LOUD and names its source (req #3463 Guard B)', () => {
    beforeEach(() => {
        roots = [];
        reads = {};
        composedAnswer = COMPOSED_2;
        known2 = [];
        listSettled = true;
        localStorage.clear();
        document.body.innerHTML = '';
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('names the ENTITY that answered, not just the id', () => {
        // The page must say which table it looked in rather than implying the
        // plan is gone — the outage's own lesson, kept after req #3356 removed
        // the second table it could have been confused with.
        composedAnswer = null;
        known2 = [{ id: 11 }];
        mount('/swarm/pipeline/7');

        const alert = text('pipeline-not-found');
        expect(alert).toContain('7');
        // req #3356 — and it must NOT carry an era marker any more. The alert
        // is the most-read sentence this module owns; a stale "2.0" here is a
        // user-visible leftover.
        expect(alert).not.toContain('2.0');
        expect(text('pipeline-not-found-source')).toContain('pipelines');
    });

    it('says the table is EMPTY when it is empty — the #3462 verification hole', () => {
        // THE EXACT STATE #3381's DEV SERVER WAS IN, eighty times over: the
        // composed read 404s because `pipelines` has no rows at all.
        // "No pipeline with id 79" was indistinguishable from a deleted plan;
        // this sentence is not.
        composedAnswer = null;
        known2 = [];
        mount('/swarm/pipeline/79');

        const source = text('pipeline-not-found-source');
        expect(source).toContain('pipelines');
        expect(source).toMatch(/NO plans at all|empty table/i);
        // And the index read is the one that establishes it — fired ONLY here,
        // on the miss path, never on the happy path (asserted above).
        expect(reads.pipelineIndex).toBeGreaterThan(0);
    });

    it('lists the ids the table DOES hold when it holds some', () => {
        composedAnswer = null;
        known2 = [{ id: 7 }, { id: 11 }];
        mount('/swarm/pipeline/79');

        const source = text('pipeline-not-found-source');
        expect(source).toContain('7');
        expect(source).toContain('11');
        // "2 plans", so a reader can tell a short list from a truncated one.
        expect(source).toMatch(/2 plans/);
    });

    // ── A FAILED OR IN-FLIGHT ID LIST IS NOT AN EMPTY TABLE ───────────────
    // Found by code review, and it is the SAME conflation this whole guard
    // exists to kill, reproduced inside the guard itself: `fetchEntity` maps a
    // 5xx to `undefined` and the `= EMPTY` default turns that into `[]`, so a
    // broken read and an empty table are one value. Reporting the first as the
    // second is a CONFIDENT FALSE CLAIM about the data — strictly worse than
    // the uninformative message this replaced, which at least claimed nothing.

    it('says the id list DID NOT RESOLVE when the 2.0 index read failed', () => {
        composedAnswer = null;
        known2 = [];
        listSettled = false;
        mount('/swarm/pipeline/79');

        const source = text('pipeline-not-found-source');
        expect(source).toMatch(/did not load|unknown/i);
        // And it must NOT say the table is empty, which is the false claim.
        expect(source).not.toMatch(/NO plans at all/i);
    });

    it('does not fire the index read on the HAPPY path', () => {
        mount('/swarm/pipeline/7');
        // The extra read is the price of a good error message and is paid only
        // when there is an error message to write.
        expect(reads.pipelineIndex).toBeUndefined();
    });
});
