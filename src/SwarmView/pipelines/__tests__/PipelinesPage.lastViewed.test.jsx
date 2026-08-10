// @vitest-environment jsdom
//
// Req #3311 — "remember my last selected pipeline", the VISIBLE half: the list
// marks the plan you were last on.
// Req #3431 — the same mark, now driven off the durable place record rather
// than `darwin-swarm-pipelines-last-opened`, and still shown when the record
// says the reader walked back out to this list. The mark is what makes the
// remembering something a reader can SEE; the resume (a sibling file) is what
// makes it something they can USE, and a page that did the second without the
// first would move people around with nothing to explain why.
//
// The storage contract itself is pinned by `pipelinePlace.test.js`. What only
// an integration test can reach is the round trip: a record in storage, a mark
// on the right card, and no mark anywhere else.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

const PIPELINES = [
    { id: 2, title: 'Darwin', pipeline_status: 'active', machine_fk: null },
    { id: 5, title: 'Substrate', pipeline_status: 'active', machine_fk: null },
];

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useAllPipelines: () => ({ data: PIPELINES, isLoading: false, isError: false }),
        useAllPipelineSteps: empty,
        useAllPipelineStepRequirements: empty,
        useAllRequirements: empty,
        useMachines: empty,
        useOrchestrationClaims: empty,
    };
});

import PipelinesPage from '../PipelinesPage';
import { PIPELINE_PLACE_SCHEMA_VERSION, PIPELINE_PLACE_STORAGE_KEY } from '../pipelinePlace';
import { PLAN_ERA_1, PLAN_ERA_2 } from '../planEra';
import { noteRoute, resetRouteTrail } from '../../../utils/routeTrail';
import AuthContext from '../../../Context/AuthContext';

let roots = [];

// `at: 'list'` throughout, because that IS the reader's state whenever this page
// is the one on screen — they are on the list. An `at: 'plan'` record would
// RESUME rather than render, which is the sibling file's subject.
const remember = (pipelineId, at = 'list', era = PLAN_ERA_1) => localStorage.setItem(
    // req #3463 — `v` from the module's own constant, plus the `era` the
    // record now carries. A literal `v: 1` seeds a record the reader DROPS,
    // so every case below would silently exercise 'no record at all'.
    PIPELINE_PLACE_STORAGE_KEY,
    JSON.stringify({ v: PIPELINE_PLACE_SCHEMA_VERSION, at, era, pipelineId }));

function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
        root.render(
            <AuthContext.Provider value={{ profile: { userName: 'tester', timezone: 'UTC' } }}>
                <MemoryRouter initialEntries={['/swarm/pipelines']}>
                    <PipelinesPage />
                </MemoryRouter>
            </AuthContext.Provider>,
        );
    });
    roots.push(root);
    return { unmount: () => act(() => root.unmount()) };
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);

// Mount as the reader arriving from a plan — the one entry that suppresses the
// resume, and therefore the only way to render this page with an `at: 'plan'`
// record still in storage.
function mountFromPlan(planId = 5) {
    noteRoute(`/swarm/pipeline/${planId}`);
    return mount();
}

describe('PipelinesPage — the last selected pipeline', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        resetRouteTrail();
        roots = [];
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        sessionStorage.clear();
        localStorage.clear();
    });

    it('marks nothing on a first-ever visit', () => {
        mount();
        expect(node('pipeline-card-2')).not.toBeNull();
        expect(node('pipeline-card-lastviewed-2')).toBeNull();
        expect(node('pipeline-card-lastviewed-5')).toBeNull();
    });

    it('marks the plan the reader last had open', () => {
        remember(5);
        mount();
        expect(node('pipeline-card-lastviewed-5')).not.toBeNull();
        // EXACTLY ONE mark. A predicate that matched loosely — a string id
        // against a numeric one, say — would light every card up and say
        // nothing at all.
        expect(node('pipeline-card-lastviewed-2')).toBeNull();
    });

    // req #3463 (code review) — the mark is the VISIBLE half of the record, so
    // the era gate has to hold here too. This list reads `pipelines` (1.0); a
    // 2.0 record naming plan 5 is a different plan that happens to share a
    // number, and lighting up the 1.0 row for it would tell the reader they
    // last opened something they never did.
    it('marks nothing when the record belongs to the OTHER era', () => {
        remember(5, 'list', PLAN_ERA_2);
        mount();
        expect(node('pipeline-card-lastviewed-5')).toBeNull();
        expect(node('pipeline-card-lastviewed-2')).toBeNull();
    });

    it('moves the mark when the record names a different plan', () => {
        remember(5);
        mount().unmount();
        document.body.innerHTML = '';

        remember(2);
        mount();
        expect(node('pipeline-card-lastviewed-2')).not.toBeNull();
        expect(node('pipeline-card-lastviewed-5')).toBeNull();
    });

    // req #3431 — the mark SURVIVES walking back out to the list, which is the
    // whole reason `pipelineId` and `at` are separate fields. Landing here sets
    // `at: 'list'`, and if that had dropped the id the reader would lose the
    // mark by the single act of coming to look at it.
    it('still marks after the page has recorded a list visit', () => {
        remember(5, 'plan');
        // Arriving from the plan: no resume, so the page settles to `at: 'list'`.
        mountFromPlan();
        expect(node('pipeline-card-lastviewed-5')).not.toBeNull();
        expect(JSON.parse(localStorage.getItem(PIPELINE_PLACE_STORAGE_KEY)))
            .toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'list', era: PLAN_ERA_1, pipelineId: 5 });
    });

    // The value indexes a row, so anything that is not an id must mark NOTHING
    // rather than match by accident. It comes out of web storage, so an older
    // build's value and a hand-typed one are both reachable. `0` and `''` both
    // pass a careless `Number()` and neither is an id any row carries.
    it.each([null, '', '  ', 0, 'constructor', 'NaN', '5abc', {}])(
        'marks nothing for a stored id of %s', (id) => {
            remember(id);
            mount();
            expect(node('pipeline-card-lastviewed-2')).toBeNull();
            expect(node('pipeline-card-lastviewed-5')).toBeNull();
        });

    it('marks nothing when the remembered plan is no longer listed', () => {
        remember(999);
        mount();
        // Asserted against the cards that EXIST. Looking for
        // `pipeline-card-lastviewed-999` could never fail — there is no row 999
        // to render one — so it would pass with the mark on every card.
        expect(node('pipeline-card-2')).not.toBeNull();
        expect(node('pipeline-card-lastviewed-2')).toBeNull();
        expect(node('pipeline-card-lastviewed-5')).toBeNull();
    });
});
