// @vitest-environment jsdom
//
// Req #3235 — the epic box's SECOND link, end to end through the real page:
// the requirement -> feature -> epic chain (req #3234, untouched) plus the
// new epic -> pipeline chain (useEpicPipelineLocation) both resolve through
// the real hooks, and the box renders two distinguishable links when a
// pipeline is found, or omits the second one — never a dead link — when it
// is not.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useMachines: () => ({ data: [] }),
        useAllCategories: () => ({ data: [{ id: 1, category_name: 'Swarm' }] }),
    };
});

let requirementRow;
let featureResponse;
let epicResponse;
let chain; // { features, requirements, stepLinks, steps, pipelines } -> { status, data }

const emptyOk = { status: 200, data: [] };

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method) => {
        if (method !== 'GET') return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
        if (uri.includes('/requirements?id=')) {
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [requirementRow] });
        }
        if (uri.includes('/features?id=')) {
            return Promise.resolve({ httpStatus: { httpStatus: featureResponse.status }, data: featureResponse.data });
        }
        if (uri.includes('/epics?id=')) {
            return Promise.resolve({ httpStatus: { httpStatus: epicResponse.status }, data: epicResponse.data });
        }
        const pick = (key) => (chain && chain[key]) || emptyOk;
        let hit = emptyOk;
        if (uri.includes('/features?epic_fk=')) hit = pick('features');
        else if (uri.includes('/requirements?feature_fk=')) hit = pick('requirements');
        // TWO chains read this table and the difference is the FILTER SHAPE.
        // `useEpicPipelineLocation` widens through every sibling requirement of
        // the epic, so it asks for an id LIST — `requirement_fk=(101)`.
        // `useRequirementStepLocation` (req #3253) asks about THIS requirement
        // alone — `requirement_fk=42`. Routing them to one fixture would make a
        // test that cannot tell "the epic is on a plan" from "this requirement
        // is on a step", which is the exact distinction the link now turns on.
        else if (uri.includes('/pipeline_step_requirements?requirement_fk=(')) hit = pick('stepLinks');
        else if (uri.includes('/pipeline_step_requirements?requirement_fk=')) hit = pick('ownStepLinks');
        else if (uri.includes('/pipeline_steps?id=')) hit = pick('steps');
        else if (uri.includes('/pipelines?id=')) hit = pick('pipelines');
        const answer = { httpStatus: { httpStatus: hit.status }, data: hit.data };
        // `hold` keeps ONE hop in flight so the in-flight window is observable.
        return hit.hold ? hit.hold.then(() => answer) : Promise.resolve(answer);
    }),
}));

import RequirementDetail from '../RequirementDetail';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

let mountedRoots = [];

function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } },
    });
    const root = createRoot(container);
    act(() => {
        root.render(
            <MemoryRouter initialEntries={['/swarm/requirement/42']}>
                <QueryClientProvider client={queryClient}>
                    <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                        <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                            <Routes>
                                <Route path="/swarm/requirement/:id" element={<RequirementDetail />} />
                            </Routes>
                        </AuthContext.Provider>
                    </AppContext.Provider>
                </QueryClientProvider>
            </MemoryRouter>
        );
    });
    mountedRoots.push(root);
}

// Two more hops than the req #3234 epic-linkage test's three, so this needs
// more rounds to drain: requirement -> feature -> epic, IN PARALLEL WITH
// feature_fk -> features -> requirements -> pipeline_step_requirements ->
// pipeline_steps -> pipelines.
async function flush() {
    for (let round = 0; round < 12; round++) {
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
            await new Promise((r) => setTimeout(r, 0));
            for (let i = 0; i < 5; i++) await Promise.resolve();
        });
    }
}

function baseRequirement(overrides = {}) {
    return {
        id: 42,
        title: 'linked or not',
        description: '',
        category_fk: 1,
        requirement_status: 'swarm_ready',
        coordination_type: 'implemented',
        ai_model: 'opus',
        effort: 'xhigh',
        machine_fk: null,
        started_at: null, completed_at: null, deferred_at: null,
        create_ts: null, update_ts: null,
        ...overrides,
    };
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);

describe('RequirementDetail — epic box plan link (req #3235)', () => {
    beforeEach(() => {
        mountedRoots = [];
        featureResponse = { status: 200, data: [] };
        epicResponse = { status: 200, data: [] };
        chain = {};
    });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('renders both links, distinguishably, when the epic resolves to a pipeline', async () => {
        requirementRow = baseRequirement({ feature_fk: 88 });
        featureResponse = { status: 200, data: [{ id: 88, title: 'Cool Feature', epic_fk: 55 }] };
        epicResponse = { status: 200, data: [{ id: 55, title: 'Big Epic' }] };
        chain = {
            features: { status: 200, data: [{ id: 88 }] },
            requirements: { status: 200, data: [{ id: 101 }] },
            stepLinks: { status: 200, data: [{ step_fk: 47 }] },
            steps: { status: 200, data: [{ id: 47, pipeline_fk: 2 }] },
            pipelines: { status: 200, data: [{ id: 2, pipeline_status: 'active' }] },
            // THIS requirement is on no step — a sibling under the same epic is
            // what put the epic on the plan. So the link falls back to the epic
            // fit, which is req #3235's behaviour, unchanged.
            ownStepLinks: { status: 200, data: [] },
        };
        mount();
        await flush();

        const epicLink = node('epic-linkage-link');
        expect(epicLink).not.toBeNull();
        expect(epicLink.getAttribute('href')).toBe('/swarm/epics?id=55');

        const planLink = node('epic-linkage-plan-link');
        expect(planLink).not.toBeNull();
        expect(planLink.getAttribute('href')).toBe('/swarm/pipeline/2?mode=plan&epic=55');
        // Distinguishable text — never a second bare "Big Epic" anchor.
        expect(planLink.textContent).not.toBe('Big Epic');
        expect(epicLink.getAttribute('aria-label')).not.toBe(planLink.getAttribute('aria-label'));
    });

    // ── Req #3253 ───────────────────────────────────────────────────────────
    it('links to THIS requirement\'s step, not the epic fit, when a step carries it', async () => {
        requirementRow = baseRequirement({ feature_fk: 88 });
        featureResponse = { status: 200, data: [{ id: 88, title: 'Cool Feature', epic_fk: 55 }] };
        epicResponse = { status: 200, data: [{ id: 55, title: 'Big Epic' }] };
        chain = {
            features: { status: 200, data: [{ id: 88 }] },
            requirements: { status: 200, data: [{ id: 101 }] },
            stepLinks: { status: 200, data: [{ step_fk: 47 }] },
            steps: { status: 200, data: [{ id: 47, pipeline_fk: 2 }] },
            pipelines: { status: 200, data: [{ id: 2, pipeline_status: 'active' }] },
            ownStepLinks: { status: 200, data: [{ step_fk: 47 }] },
        };
        mount();
        await flush();

        const planLink = node('epic-linkage-plan-link');
        expect(planLink).not.toBeNull();
        expect(planLink.getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan&step=47&level=2');
        // The accessible name has to change with the target: a reader told
        // "view epic Big Epic" and landed on one step of it was told wrong.
        expect(planLink.getAttribute('aria-label')).not.toContain('Big Epic');
        // The epic link itself is untouched.
        expect(node('epic-linkage-link').getAttribute('href')).toBe('/swarm/epics?id=55');
    });

    it('takes the lowest step id when two steps of one plan carry it', async () => {
        // Documented tie-break. "First in display order" is derived from the
        // WHOLE plan (deps, states, epic labels) and this page deliberately does
        // not load one to decide a link; the lowest id is deterministic and
        // stable across refetches. Reachable only by a requirement seated twice
        // on one plan, which the plan model already treats as a defect.
        requirementRow = baseRequirement({ feature_fk: 88 });
        featureResponse = { status: 200, data: [{ id: 88, title: 'Cool Feature', epic_fk: 55 }] };
        epicResponse = { status: 200, data: [{ id: 55, title: 'Big Epic' }] };
        chain = {
            features: { status: 200, data: [{ id: 88 }] },
            requirements: { status: 200, data: [{ id: 101 }] },
            stepLinks: { status: 200, data: [{ step_fk: 47 }] },
            // Deliberately returned high-id-first: the order the wire happens to
            // send must not decide the link.
            steps: { status: 200, data: [{ id: 91, pipeline_fk: 2 }, { id: 47, pipeline_fk: 2 }] },
            pipelines: { status: 200, data: [{ id: 2, pipeline_status: 'active' }] },
            ownStepLinks: { status: 200, data: [{ step_fk: 91 }, { step_fk: 47 }] },
        };
        mount();
        await flush();

        expect(node('epic-linkage-plan-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan&step=47&level=2');
    });

    it('shows NO link while the step chain is in flight — never the epic one', async () => {
        // Code review MAJ-1. A null step id means either "no step" or "not
        // answered yet", and falling back to the epic href on the second renders
        // a CLICKABLE whole-epic fit — exactly the defect this requirement
        // removes. Reachable on the ordinary path: opening a sibling requirement
        // re-renders rather than remounts, so the epic chain is a cache hit and
        // answers on the first paint while the step chain re-queries.
        //
        // Held at the step-links hop, with the epic chain fully resolved, which
        // is that race made deterministic.
        let releaseOwn;
        const held = new Promise((r) => { releaseOwn = r; });
        requirementRow = baseRequirement({ feature_fk: 88 });
        featureResponse = { status: 200, data: [{ id: 88, title: 'Cool Feature', epic_fk: 55 }] };
        epicResponse = { status: 200, data: [{ id: 55, title: 'Big Epic' }] };
        chain = {
            features: { status: 200, data: [{ id: 88 }] },
            requirements: { status: 200, data: [{ id: 101 }] },
            stepLinks: { status: 200, data: [{ step_fk: 47 }] },
            steps: { status: 200, data: [{ id: 47, pipeline_fk: 2 }] },
            pipelines: { status: 200, data: [{ id: 2, pipeline_status: 'active' }] },
            ownStepLinks: { status: 200, data: [{ step_fk: 47 }], hold: held },
        };
        mount();
        await flush();

        // The epic link itself is resolved and rendered — this is not "the page
        // has not loaded", it is "one of the two answers is still coming".
        expect(node('epic-linkage-link')).not.toBeNull();
        expect(node('epic-linkage-plan-link'), 'no plan link mid-flight').toBeNull();

        releaseOwn();
        await flush();
        expect(node('epic-linkage-plan-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan&step=47&level=2');
    });

    it('never pairs a step with a plan it is not on', async () => {
        // The pipeline tie-break picks the ACTIVE plan; a step belonging to the
        // loser must not ride along with the winner's id, or the link names a
        // step the visualizer will correctly refuse to focus.
        requirementRow = baseRequirement({ feature_fk: 88 });
        featureResponse = { status: 200, data: [{ id: 88, title: 'Cool Feature', epic_fk: 55 }] };
        epicResponse = { status: 200, data: [{ id: 55, title: 'Big Epic' }] };
        chain = {
            features: { status: 200, data: [{ id: 88 }] },
            requirements: { status: 200, data: [{ id: 101 }] },
            stepLinks: { status: 200, data: [{ step_fk: 47 }] },
            steps: { status: 200, data: [{ id: 12, pipeline_fk: 9 }, { id: 47, pipeline_fk: 2 }] },
            pipelines: { status: 200, data: [
                { id: 2, pipeline_status: 'active' },
                { id: 9, pipeline_status: 'draft' },
            ] },
            ownStepLinks: { status: 200, data: [{ step_fk: 12 }, { step_fk: 47 }] },
        };
        mount();
        await flush();

        // Plan 2 wins on `active`, so step 47 — the one that is ON plan 2 —
        // is the link, never the numerically lower step 12 from plan 9.
        expect(node('epic-linkage-plan-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan&step=47&level=2');
    });

    it('omits the plan link — never a dead one — when the epic is in no pipeline', async () => {
        requirementRow = baseRequirement({ feature_fk: 88 });
        featureResponse = { status: 200, data: [{ id: 88, title: 'Cool Feature', epic_fk: 55 }] };
        epicResponse = { status: 200, data: [{ id: 55, title: 'Big Epic' }] };
        chain = { features: { status: 200, data: [] } }; // epic has no features -> chain runs dry
        mount();
        await flush();

        expect(node('epic-linkage-link')).not.toBeNull();
        expect(node('epic-linkage-plan-link')).toBeNull();
    });
});
