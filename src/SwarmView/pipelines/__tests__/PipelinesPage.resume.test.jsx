// @vitest-environment jsdom
//
// Req #3431 — "go straight that spot".
//
// > *"It should recall that you had last selected a pipeline and had a
// > particular view port open. so if you navigate away you would hours later
// > when coming back, go straight that spot."*
//
// The storage contract is pinned by `pipelinePlace.test.js` and the trail by
// `routeTrail.test.js`. What only this file can reach is the JOURNEY, and the
// journeys are the point: this feature has exactly one catastrophic failure —
// a resume that fires on the way OUT of a plan makes the list unreachable, with
// no error and no way for the reader to escape it. Every case below is a real
// sequence of reader actions, named as one.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

const PIPELINES = [
    { id: 2, title: 'Darwin', pipeline_status: 'active', machine_fk: null },
    { id: 5, title: 'Substrate', pipeline_status: 'completed', machine_fk: null },
];

let pipelinesLoading = false;
// The rows the pipelines read yields. `undefined` is what TanStack hands back
// on a FAILED read — the case the M1 regression below turns on — and the page's
// own `= []` default is what makes it indistinguishable from "no plans exist".
let pipelinesData = PIPELINES;

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useAllPipelines: () => ({
            data: pipelinesLoading ? [] : pipelinesData,
            isLoading: pipelinesLoading,
            isError: false,
        }),
        useAllPipelineSteps: empty,
        useAllPipelineStepRequirements: empty,
        useAllRequirements: empty,
        useMachines: empty,
        useOrchestrationClaims: empty,
    };
});

import PipelinesPage from '../PipelinesPage';
import { PIPELINE_PLACE_SCHEMA_VERSION, PIPELINE_PLACE_STORAGE_KEY } from '../pipelinePlace';
import { noteRoute, resetRouteTrail } from '../../../utils/routeTrail';
import { readScroll, scrollStorageKey, writeScroll } from '../../../utils/viewportMemory';
import { PLAN_ERA_1, PLAN_ERA_2 } from '../planEra';
import AuthContext from '../../../Context/AuthContext';

let roots = [];

// req #3463 — `v` follows the module's own constant rather than a literal, and
// the record carries an `era`. A hand-written `v: 1` here would seed a record
// the reader now DROPS (v1 predates the era field), so every journey below
// would silently exercise "no record at all" and pass for the wrong reason.
const remember = (at, pipelineId, era = PLAN_ERA_1) => localStorage.setItem(
    PIPELINE_PLACE_STORAGE_KEY,
    JSON.stringify({ v: PIPELINE_PLACE_SCHEMA_VERSION, at, era, pipelineId }));

const storedPlace = () => {
    const raw = localStorage.getItem(PIPELINE_PLACE_STORAGE_KEY);
    return raw == null ? null : JSON.parse(raw);
};

// Stands in for `PipelineDetail`, which this suite does not mount: it needs a
// dozen more query mocks and Konva, and the only thing the resume cares about
// is WHERE it landed.
function PlanStub() {
    const { pathname, search } = useLocation();
    return <div data-testid="plan-stub" data-path={pathname + search} />;
}

function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    // A FRESH ELEMENT PER RENDER. React bails out of a re-render when it is
    // handed the reference-identical element, so a hoisted tree would make
    // `rerender()` a silent no-op — and the loading→loaded case below, whose
    // whole subject is the second commit, would pass without one happening.
    const tree = () => (
        <AuthContext.Provider value={{ profile: { userName: 'tester', timezone: 'UTC' } }}>
            <MemoryRouter initialEntries={['/swarm/pipelines']}>
                <Routes>
                    <Route path="/swarm/pipelines" element={<PipelinesPage />} />
                    <Route path="/swarm/pipeline/:id" element={<PlanStub />} />
                </Routes>
            </MemoryRouter>
        </AuthContext.Provider>
    );
    const render = () => act(() => { root.render(tree()); });
    render();
    roots.push(root);
    return { rerender: render, unmount: () => act(() => root.unmount()) };
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
const landedOn = () => node('plan-stub')?.getAttribute('data-path') ?? null;
const onTheList = () => node('pipelines-status-filter') != null;

describe('PipelinesPage — resuming the last plan (req #3431)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        resetRouteTrail();
        pipelinesLoading = false;
        pipelinesData = PIPELINES;
        roots = [];
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        localStorage.clear();
        sessionStorage.clear();
    });

    describe('the ask itself', () => {
        // Browser reopened hours later, or any arrival that is not out of a
        // plan: the trail is cold and the record says a plan.
        it('goes straight to the plan the reader last had open', () => {
            remember('plan', 2);
            mount();
            expect(landedOn()).toBe('/swarm/pipeline/2');
            expect(onTheList()).toBe(false);
        });

        // NO QUERY STRING. The panel comes from the reader's stored mode
        // preference; `?mode=` is the link channel and would both lie in the
        // address bar after a manual toggle and outrank the preference.
        it('lands with no query string', () => {
            remember('plan', 2);
            mount();
            expect(landedOn()).not.toContain('?');
        });

        // Leaving a plan for somewhere ELSE in the app is not the same act as
        // walking back out to the list. This is the requirement's own sentence:
        // navigate away, come back, go straight to the spot.
        it('resumes after a detour through another page', () => {
            remember('plan', 2);
            noteRoute('/swarm/pipeline/2');
            noteRoute('/swarm/sessions');
            mount();
            expect(landedOn()).toBe('/swarm/pipeline/2');
        });

        // A plan hidden by the reader's own status filter is PRESENT, not
        // deleted. Testing membership against the filtered rows would infer
        // "deleted" and destroy a valid record (data-architect review). Plan 5
        // is `completed`, which the default filter hides.
        it('resumes to a plan the status filter is hiding', () => {
            remember('plan', 5);
            mount();
            expect(landedOn()).toBe('/swarm/pipeline/5');
            expect(storedPlace()).toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', era: PLAN_ERA_1, pipelineId: 5 });
        });
    });

    // ── req #3463 — A FOREIGN-ERA RECORD (code review) ────────────────────
    // This list reads `pipelines` (1.0). A 2.0 record naming plan 2 is a
    // DIFFERENT plan that happens to share a number — nothing translates
    // between the id spaces — so honouring it would resume the reader into a
    // plan they never opened. That is req #3462's outage arriving by resume
    // instead of by click, which is why the era gate exists and why it needs a
    // test that actually supplies the other era.
    describe('a record from the other era', () => {
        it('does NOT resume, even when the id exists in this era too', () => {
            remember('plan', 2, PLAN_ERA_2);
            mount();
            expect(landedOn()).toBeNull();
        });

        it('replaces it with this list\'s own place, rather than preserving it', () => {
            // ONE RECORD ACROSS BOTH ERAS by design: the reader is on the 1.0
            // list now, and the record says so. What the gate prevents is the
            // foreign record being READ, never its replacement.
            remember('plan', 2, PLAN_ERA_2);
            mount();
            expect(storedPlace()).toEqual({
                v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'list', era: PLAN_ERA_1, pipelineId: null });
        });
    });

    describe('the trap it must not set', () => {
        // THE case. Without this the nav rail's Pipelines item is a no-op from
        // inside a plan and the list can never be opened again.
        it('shows the list when the reader arrives from a plan', () => {
            remember('plan', 2);
            noteRoute('/swarm/pipeline/2');
            mount();
            expect(onTheList()).toBe(true);
            expect(landedOn()).toBeNull();
        });

        // …and the decision STICKS, so the next arrival from anywhere else
        // lands here too. The reader's last act was to leave the plan.
        it('records the list visit, so the next arrival is not resumed', () => {
            remember('plan', 2);
            noteRoute('/swarm/pipeline/2');
            mount().unmount();
            document.body.innerHTML = '';
            expect(storedPlace()).toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'list', era: PLAN_ERA_1, pipelineId: 2 });

            resetRouteTrail();          // a fresh page load, cold trail
            mount();
            expect(onTheList()).toBe(true);
        });

        // A RELOAD of the list. `at: 'list'` is what answers this — the trail is
        // cold on a reload by design, so condition 4 alone would redirect and
        // the reader could never reload the page they are looking at.
        it('shows the list on a reload of the list', () => {
            remember('list', 2);
            mount();
            expect(onTheList()).toBe(true);
        });

        // A tab opened straight into a plan by bookmark or deep link. The detail
        // page records `at: 'plan'`; the reader's next click on Pipelines is an
        // arrival from that plan and must not bounce.
        it('shows the list after a bookmarked arrival into a plan', () => {
            remember('plan', 5);
            noteRoute('/swarm/pipeline/5');
            mount();
            expect(onTheList()).toBe(true);
        });
    });

    describe('records that cannot be honoured', () => {
        it('shows the list and forgets a plan that no longer exists', () => {
            remember('plan', 999);
            mount();
            expect(onTheList()).toBe(true);
            expect(landedOn()).toBeNull();
            // Cleared, not rewritten to `at: 'list'`: there is no plan left to
            // mark, and a record naming a dead id would be re-tested forever.
            expect(storedPlace()).toBeNull();
        });

        it('shows the list on a first-ever visit', () => {
            mount();
            expect(onTheList()).toBe(true);
            expect(storedPlace()).toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'list', era: PLAN_ERA_1, pipelineId: null });
        });

        it('shows the list when the record is unreadable', () => {
            localStorage.setItem(PIPELINE_PLACE_STORAGE_KEY, '{{{not json');
            mount();
            expect(onTheList()).toBe(true);
        });

        it('shows the list when the record names no plan', () => {
            remember('plan', null);
            mount();
            expect(onTheList()).toBe(true);
        });
    });

    describe('the loading gate', () => {
        // A redirect decided over a spinner is a redirect decided over no data:
        // the membership test would see an empty list and conclude the plan was
        // deleted — destroying the record this feature exists to keep.
        it('decides nothing, and destroys nothing, while the plans are in flight', () => {
            pipelinesLoading = true;
            remember('plan', 2);
            mount();
            expect(landedOn()).toBeNull();
            expect(onTheList()).toBe(false);          // still the spinner
            expect(storedPlace()).toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', era: PLAN_ERA_1, pipelineId: 2 });
        });

        // THE SEQUENCE THE RUNNING APP ALWAYS TAKES, and the one every other
        // case in this file skips: the page mounts over a spinner and the plans
        // arrive on a LATER commit. A gate that only resolved on the first
        // commit — sampled into state, computed in a mount-only effect, guarded
        // by a ref that is set too early — would resume in every test here and
        // never once in production, where `isLoading` is true on the render
        // that mounts.
        it('resumes once the plans arrive, not only when they are already there', () => {
            pipelinesLoading = true;
            remember('plan', 2);
            const h = mount();
            expect(landedOn(), 'nothing yet').toBeNull();
            pipelinesLoading = false;
            h.rerender();
            expect(landedOn()).toBe('/swarm/pipeline/2');
        });

        // ...and the anti-bounce survives the same two-commit arrival. The
        // origin is frozen at mount, which is DURING the spinner — so if that
        // sample were retaken on the commit that decides, it would be read
        // after the shell had advanced the trail, and this is the case where
        // that difference shows.
        it('still shows the list when a two-commit arrival came from a plan', () => {
            pipelinesLoading = true;
            remember('plan', 2);
            noteRoute('/swarm/pipeline/2');
            const h = mount();
            noteRoute('/swarm/pipelines');            // the shell catches up
            pipelinesLoading = false;
            h.rerender();
            expect(onTheList()).toBe(true);
            expect(landedOn()).toBeNull();
        });
    });

    // ── THE TWO CODE-REVIEW FINDINGS, EACH WITH ITS OWN CASE ───────────────
    // Both were live defects in the first cut of this gate, both were silent,
    // and both destroy something the reader cannot get back. They share a root:
    // an empty `pipelines` array and "the server says these are all the plans"
    // are not the same fact.
    describe('a read that failed is not a deletion (review M1)', () => {
        // `useAllPipelines` yields `undefined` on a 5xx, an auth blip or an
        // offline tab; this page defaults that to `[]` and `isLoading` goes
        // FALSE, so nothing downstream can tell it from a reader who owns no
        // plans. Concluding "deleted" wipes the record on a transient network
        // fault — and the reader's resume point is gone permanently, with an
        // empty list on screen and no error to explain it.
        it('keeps the record when the plans read came back empty', () => {
            pipelinesData = undefined;
            remember('plan', 2);
            mount();
            expect(onTheList()).toBe(true);
            expect(landedOn()).toBeNull();
            expect(storedPlace()).toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', era: PLAN_ERA_1, pipelineId: 2 });
        });

        // The same guard must not swallow a REAL deletion: a non-empty list is
        // a statement about which plans exist, and plan 999 is not among them.
        it('still forgets a plan that a successful read does not contain', () => {
            remember('plan', 999);
            mount();
            expect(storedPlace()).toBeNull();
        });

        // The sweep is guarded by the identical sentence, so an empty read must
        // not collect either — that would delete every camera the reader has.
        it('sweeps nothing when the plans read came back empty', () => {
            pipelinesData = undefined;
            localStorage.setItem('darwin-viewport-pipeline-plan-2', 'keep');
            mount();
            expect(localStorage.getItem('darwin-viewport-pipeline-plan-2')).toBe('keep');
        });
    });

    describe('the resume never fires late (review M2)', () => {
        // `refetchOnWindowFocus` replaces `pipelines` under a MOUNTED page. A
        // plan missing at mount — the read had failed, or it was created in
        // another tab — flips the membership test true on that refetch, and
        // without a latch the reader is teleported off a list they are already
        // reading, mid-scroll, with no gesture of their own behind it.
        it('does not redirect when a later refetch brings the plan back', () => {
            pipelinesData = undefined;              // first commit: read failed
            remember('plan', 2);
            const h = mount();
            expect(onTheList()).toBe(true);

            pipelinesData = PIPELINES;              // the focus refetch succeeds
            h.rerender();

            expect(onTheList()).toBe(true);
            expect(landedOn()).toBeNull();
        });

        // The latch is armed by the settle, so it must NOT be armed on a commit
        // that resumed — or a resume interrupted and re-rendered would land the
        // reader back on the list. Guards the fix against over-correction.
        it('still resumes on the commit that first has the data', () => {
            pipelinesLoading = true;
            remember('plan', 2);
            const h = mount();
            pipelinesLoading = false;
            h.rerender();
            expect(landedOn()).toBe('/swarm/pipeline/2');
        });
    });

    describe('the sweep', () => {
        // Durability removed the collector that tab lifetime used to be.
        it('drops stored positions belonging to plans that are gone', () => {
            localStorage.setItem('darwin-viewport-pipeline-plan-2', 'keep');
            localStorage.setItem('darwin-viewport-pipeline-plan-777', 'drop');
            localStorage.setItem('darwin-scroll-pipeline-plan-table-777', 'drop');
            localStorage.setItem('darwin-scroll-pipelines-list', 'keep');
            localStorage.setItem('darwin-swarm-pipelines-last-opened', 'retired');

            mount();

            expect(localStorage.getItem('darwin-viewport-pipeline-plan-2')).toBe('keep');
            expect(localStorage.getItem('darwin-scroll-pipelines-list')).toBe('keep');
            expect(localStorage.getItem('darwin-viewport-pipeline-plan-777')).toBeNull();
            expect(localStorage.getItem('darwin-scroll-pipeline-plan-table-777')).toBeNull();
            expect(localStorage.getItem('darwin-swarm-pipelines-last-opened')).toBeNull();
        });

        // THE LIVE SET IS `pipelines`, NEVER `filtered`. Plan 5 is `completed`,
        // which the default status filter hides — it is not deleted, and its
        // camera and offsets are the reader's. A sweep taken against the
        // visible rows would delete the stored positions of every plan the
        // reader has filtered out, on every visit to this page, and put them
        // back nowhere: the plan still exists, so nothing ever re-establishes
        // them and the loss is silent and permanent.
        it('keeps the positions of a plan the status filter is hiding', () => {
            localStorage.setItem('darwin-viewport-pipeline-plan-5', 'hidden but alive');
            localStorage.setItem('darwin-scroll-pipeline-plan-table-5', 'hidden but alive');
            localStorage.setItem('darwin-viewport-pipeline-plan-777', 'genuinely gone');

            mount();

            expect(onTheList(), 'plan 5 is filtered out of the view').toBe(true);
            expect(document.body.querySelector('[data-testid="pipeline-card-5"]')).toBeNull();
            expect(localStorage.getItem('darwin-viewport-pipeline-plan-5'))
                .toBe('hidden but alive');
            expect(localStorage.getItem('darwin-scroll-pipeline-plan-table-5'))
                .toBe('hidden but alive');
            expect(localStorage.getItem('darwin-viewport-pipeline-plan-777')).toBeNull();
        });

        // It must not run on the render that redirects: the reader is on their
        // way to a plan, and the settle step would overwrite the record the
        // outgoing navigation is acting on.
        it('does not run when the page is resuming', () => {
            remember('plan', 2);
            localStorage.setItem('darwin-viewport-pipeline-plan-777', 'orphan');
            mount();
            expect(landedOn()).toBe('/swarm/pipeline/2');
            expect(localStorage.getItem('darwin-viewport-pipeline-plan-777')).toBe('orphan');
            expect(storedPlace()).toEqual({ v: PIPELINE_PLACE_SCHEMA_VERSION, at: 'plan', era: PLAN_ERA_1, pipelineId: 2 });
        });
    });

    // ── THE TWO MEMORIES ON THIS PAGE, RUNNING AT ONCE ─────────────────────
    // `useScrollMemory` and the resume gate share one render and one mount, and
    // they are gated on the same `isLoading` flag — so on the render that
    // REDIRECTS, the scroll hook is fully live: it has a real key, it reads the
    // stored offset, it applies it to a document that is about to be replaced,
    // and then it unmounts and commits.
    //
    // That is the shape of a silent data loss, and it is the reason this
    // describe exists rather than trusting `useScrollMemory.test.jsx`: the hook
    // is correct in isolation and the page is correct in isolation, and neither
    // suite can see what the pair does. If the restore's own echo were ever
    // mis-recognised, resuming would commit a clamped 0 over the reader's list
    // position — so every arrival that goes straight to a plan would quietly
    // destroy where they were in the list, and they would only find out on the
    // day they walked back out to it.
    describe('the resume and the list\'s own scroll position', () => {
        const LIST_SCROLL_KEY = scrollStorageKey('pipelines-list');
        let windowScroll;
        let frames;
        let cancelled;
        let nextFrameId;

        // Frames are QUEUED, not run inline: the hook attaches its scroll
        // listener and THEN schedules the restore, so a synchronous callback
        // would apply it before the listener exists — an ordering no browser
        // produces, and the one that hides the echo. Same device as
        // `useScrollMemory.test.jsx`.
        const runFrames = (n = 4) => act(() => {
            for (let i = 0; i < n; i += 1) {
                const due = frames;
                frames = [];
                due.forEach(({ id, cb }) => { if (!cancelled.has(id)) cb(0); });
            }
        });

        beforeEach(() => {
            windowScroll = { x: 0, y: 0 };
            frames = [];
            cancelled = new Set();
            nextFrameId = 1;
            vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
                const id = nextFrameId;
                nextFrameId += 1;
                frames.push({ id, cb });
                return id;
            });
            vi.spyOn(globalThis, 'cancelAnimationFrame')
                .mockImplementation((id) => { cancelled.add(id); });
            // jsdom has no layout, so the scroller is modelled: `scrollTo`
            // records, and `scrollX/scrollY` report what it was given. Without
            // this the restore can never "land" and every assertion below would
            // be measuring a scroller that does not move.
            vi.spyOn(window, 'scrollTo')
                .mockImplementation((x, y) => { windowScroll = { x, y }; });
            Object.defineProperty(window, 'scrollX',
                { configurable: true, get: () => windowScroll.x });
            Object.defineProperty(window, 'scrollY',
                { configurable: true, get: () => windowScroll.y });
        });
        afterEach(() => {
            vi.restoreAllMocks();
            // `restoreAllMocks` does not undo `defineProperty`; jsdom's own
            // offsets are plain data properties on the window.
            Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
            Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
        });

        // THE ONE THAT MATTERS, and the ANSWER IS NOT THE OBVIOUS ONE — it was
        // measured here rather than reasoned, after the first draft of this case
        // asserted the opposite and failed.
        //
        // What holds it: the page hands `useScrollMemory` a NULL KEY while
        // `resumeTo` is set, which is the hook's own "not this time" channel.
        // Nothing is read, nothing is applied, nothing is recorded, and the
        // unmount commit has nothing pending to write.
        //
        // There is a SECOND line of defence and it is worth knowing about,
        // because it is what would carry the page if the gate were ever relaxed:
        // the restore is scheduled on an animation frame and `<Navigate>`
        // unmounts the page in the same commit, so the cleanup cancels the frame
        // before it fires. That was the whole mechanism until this page was
        // reviewed — and one link of it is a plausible edit away (applying the
        // restore synchronously, dropping the `cancelAnimationFrame`, or an echo
        // the hook stops recognising).
        //
        // Either way the failure is the same and it is silent: a clamped 0
        // committed over the reader's list position on EVERY arrival that
        // resumes, so they lose where they were in the list precisely by using
        // the feature, and find out only on the day they walk back out to it.
        // This case is deliberately written against the OUTCOME rather than
        // against either mechanism, so it survives the page changing its mind
        // about which one to rely on.
        //
        // Its non-vacuity control is the case below: same stored position, same
        // scroller, and there the restore lands.
        it('a resume neither applies nor commits a list position', () => {
            writeScroll(LIST_SCROLL_KEY, { x: 0, y: 640 });
            remember('plan', 2);
            const h = mount();
            expect(landedOn(), 'this is the resuming render').toBe('/swarm/pipeline/2');
            runFrames(30);
            expect(window.scrollTo,
                'the redirect cancelled the restore before it could touch the document')
                .not.toHaveBeenCalled();
            h.unmount();                              // the commit path
            expect(readScroll(LIST_SCROLL_KEY)).toEqual({ x: 0, y: 640 });
        });

        // THE RETURN JOURNEY, and the control that makes the case above mean
        // something. The reader walks back out of the plan — the one arrival
        // that suppresses the resume — and the list they get is the list they
        // left, scrolled where they left it.
        //
        // Asserted through the page rather than left to `useScrollMemory`'s own
        // suite, because what is under test is this page's GATE: it withholds
        // the key while the plans are in flight and hands it over afterwards,
        // and a page that never handed it over would lose the feature with no
        // symptom but "the list always opens at the top".
        it('restores the list position when the reader walks back out of a plan', () => {
            writeScroll(LIST_SCROLL_KEY, { x: 0, y: 640 });
            remember('plan', 2);
            noteRoute('/swarm/pipeline/2');
            mount();
            expect(onTheList(), 'no resume — they asked for the list').toBe(true);
            runFrames();
            expect(window.scrollTo).toHaveBeenCalledWith(0, 640);
            expect(window.scrollY).toBe(640);
        });

        // A spinner has no height, so a restore over one lands at 0 — and the
        // hook's commit would then write that 0 back. The page's answer is to
        // withhold the key entirely until the rows exist; this proves it does,
        // because the alternative is a page that resets the reader's position
        // every time the plans are slow.
        it('restores nothing, and commits nothing, over the spinner', () => {
            writeScroll(LIST_SCROLL_KEY, { x: 0, y: 640 });
            pipelinesLoading = true;
            const h = mount();
            runFrames();
            expect(window.scrollTo).not.toHaveBeenCalled();
            h.unmount();
            expect(readScroll(LIST_SCROLL_KEY)).toEqual({ x: 0, y: 640 });
        });
    });
});
