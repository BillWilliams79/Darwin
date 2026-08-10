// PipelinesPage.jsx — /swarm/pipelines (req #3114).
//
// The orchestrator of a view-switchable page per memory/view-switchable-pages.md:
// the `.app-content-planpage` CSS grid, the canonical `<ViewerHeader>`, and exactly
// one view component rendered at a time. View state comes from useViewPreference
// (R1/V8) under `darwin-swarm-pipelines-view`.
//
// Both views are fed the SAME pre-filtered rows and the SAME derived summaries
// (R5) — switching views re-renders, never re-fetches.
//
// req #3282 — the header used to be hand-rolled: a bare Box holding a
// ToggleButtonGroup, the ChipFilter, an inline `variant="caption"` accounting line
// and a separate `flexGrow` spacer, with NO TITLE at all. Req #3067 extracted
// `ViewerHeader` at the moment a third hand-rolled copy existed and had already
// drifted; this was the fourth, and it had drifted on V2 (the spacer Box), V7 (the
// accounting position AND its type scale) and on having no title. Converting also
// fixes the toggle's accessible name for free: the old row wrapped the Tooltip
// INSIDE the ToggleButton around the icon, so MUI put the name on an SvgIcon that
// SvgIcon.js then marks aria-hidden and both buttons computed an EMPTY accessible
// name (the same defect req #3281 files against PipelineDetail.jsx). ViewerHeader
// wraps the Tooltip AROUND the button and sets `aria-label` on the button itself.

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';

import AuthContext from '../../Context/AuthContext';
import {
    useAllPipelineStepRequirements,
    useAllPipelineSteps,
    useAllPipelines,
    useAllRequirements,
    useMachines,
    useOrchestrationClaims,
} from '../../hooks/useDataQueries';
import { useViewPreference } from '../../hooks/useViewPreference';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { scrollStorageKey } from '../../utils/viewportMemory';
import { cameFrom } from '../../utils/routeTrail';
import {
    clearPipelinePlace,
    isPipelineDetailPath,
    pipelinePlaceAtList,
    pipelinePlacePath,
    prunePipelineStorage,
    readPipelinePlace,
    writePipelinePlace,
} from './pipelinePlace';
// req #3463 — THIS PAGE IS THE 1.0 PLAN LIST, and it says so once, here.
//
// A CONSTANT AND NOT A PROP, deliberately. An era-parameterised list component
// would mean the era of this page is decided by whoever mounts it — which is
// the shape that let a page's data source and its links disagree in the first
// place.
//
// WHAT `PAGE_ERA` ACTUALLY GOVERNS, stated exactly (code review): the route
// this page OPENS (`planDetailPath`), the place record it WRITES and accepts
// (`placeIsOurs`), and the storage namespace it SWEEPS (`prunePipelineStorage`).
// It does NOT govern the reads — those are the `useAllPipelines`/
// `useAllPipelineSteps`/… calls below, named directly.
//
// So re-pointing this page at 2.0 is NOT one edit, and the guard in
// `__tests__/planEra.test.js` cannot catch a change that swaps the reads and
// leaves `PAGE_ERA` at 1 — it scans for route STRINGS, and that change involves
// none. `PipelineDetail.jsx` is the one page where the binding is structural
// (`usePlanSources(era, …)` selects the whole fetch head off the era); here it
// is a convention. Req #3393 owns re-pointing this page, and when it does, the
// reads and this constant have to move together BY HAND.
import { PLAN_ERA_1, planDetailPath } from './planEra';
import normalizeView from '../../Components/ViewerHeader/normalizeView';
import ViewerHeader from '../../Components/ViewerHeader/ViewerHeader';
import ChipFilter from '../../Components/ChipFilter';
import PipelineCardsView from './PipelineCardsView';
import PipelinesTableView from './PipelinesTableView';
import {
    pipelineStatusChipProps,
    DEFAULT_PIPELINE_STATUSES,
    PIPELINE_STATUS_VALUES,
} from './pipelineChipStyles';
import {
    DEFAULT_REQ_COUNTS,
    PLAN_REQUIREMENT_FIELDS,
    REQ_COUNTS_STORAGE_KEY,
    pipelineSummaries,
    pipelineRequirementCounts,
    hiddenPipelineStatusCounts,
} from './pipelineViewModel';

const PAGE_ERA = PLAN_ERA_1;

const VIEW_STORAGE_KEY = 'darwin-swarm-pipelines-view';

// req #3311 — "the list viewport ... is remembered". ONE position for this page:
// both views scroll the document, and a reader who switches Cards↔Table is
// looking at the same plans in a different shape, not at a second list.
const LIST_SCROLL_KEY = scrollStorageKey('pipelines-list');

// req #3431 — the remembered place replaces req #3311's
// `darwin-swarm-pipelines-last-opened`. See `pipelinePlace.js`: one record now
// answers both "which plan do I mark" and "where was the reader", the second of
// which this page needs in order to RESUME rather than merely mark. The old key
// was written by this page's click handler alone, so a plan opened by any other
// route was never recorded — which is most of why the first attempt could not
// resume to it.

// req #3220 — per-tab only (sessionStorage), matching useViewPreference's own
// per-tab-first rationale (memory/view-switchable-pages.md). Needed because the
// default is no longer "show everything": before this feature, losing the
// filter on a click-into-detail-and-back was harmless (it reset to null, i.e.
// every pipeline). Now it resets to a NARROWER set, so silently forgetting a
// chip the user turned back on (e.g. re-enabling `completed` to look at one)
// would re-hide it the moment they navigate back — the exact class of surprise
// this requirement's default-set discussion was worried about.
const STATUS_FILTER_STORAGE_KEY = 'darwin-swarm-pipelines-status-filter';

function readStoredStatusFilter() {
    try {
        const raw = sessionStorage.getItem(STATUS_FILTER_STORAGE_KEY);
        if (raw == null) return null; // nothing stored yet — caller falls back to the default
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        // A stored [] is a legal, intentional "show nothing" (ChipFilter's own
        // contract: empty is never auto-corrected back to a default). `[]` is
        // truthy in JS, so the caller's `|| DEFAULT_PIPELINE_STATUSES` only
        // fires when nothing was stored at all, never on a real empty choice.
        return parsed.filter((v) => PIPELINE_STATUS_VALUES.includes(v));
    } catch {
        return null;
    }
}

function writeStoredStatusFilter(statuses) {
    try {
        sessionStorage.setItem(STATUS_FILTER_STORAGE_KEY, JSON.stringify(statuses));
    } catch {
        // Safari private mode / quota exceeded — in-memory state still updates.
    }
}

// `label` is REQUIRED by ViewerHeader and is never rendered as text: it becomes
// BOTH the tooltip and the button's aria-label. So it is the full caption here
// ('Cards view', matching DocumentsPage) rather than the bare noun the old
// hand-rolled row expanded with a `${label} View` template at the render site.
const VIEWS = [
    { value: 'cards', label: 'Cards view', icon: ViewModuleIcon },
    { value: 'table', label: 'Table view', icon: TableChartIcon },
];

// req #3220 — fixed vocabulary, so options are module-level, same pattern as
// SwarmView's requirementStatusOptions. Colors come from pipelineStatusChipProps,
// not the ChipFilter palette.
const pipelineStatusOptions = PIPELINE_STATUS_VALUES.map((status) => ({
    value: status,
    label: status,
    chipProps: pipelineStatusChipProps(status),
}));

export default function PipelinesPage() {
    const navigate = useNavigate();
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const [view, setView] = useViewPreference(VIEW_STORAGE_KEY, 'cards');
    const activeView = normalizeView(view, VIEWS);
    // req #3431 — the remembered place, read ONCE per mount into state.
    //
    // STATE AND NOT A BARE `readPipelinePlace()` CALL, which would be simpler and
    // wrong: this page WRITES the record below (an `at: 'list'` visit), and a
    // per-render read would then see its own write and re-render on it. Reading
    // once at mount is also what makes the resume decision stable — the gate must
    // judge the record the reader arrived with, not one that changed underneath
    // it. `lastOpenedId` marks the row (req #3311's visible half) regardless of
    // whether the record would resume, because "the plan I last opened" is true
    // even when the reader's last act was to walk back out to this list.
    const [place] = useState(readPipelinePlace);
    // req #3463 — A RECORD FROM THE OTHER ERA IS NOT THIS PAGE'S RECORD. The
    // ids are disjoint and nothing translates between them, so a 2.0 record's
    // plan 7 would mark whichever 1.0 row happens to be numbered 7 and, worse,
    // satisfy the resume gate's `pipelines.some(...)` check and redirect the
    // reader into a plan they never opened. Every use of `place` below is
    // therefore gated on the era matching.
    //
    // A FOREIGN RECORD IS NOT PRESERVED, and that is deliberate rather than an
    // oversight (code review corrected the comment that said otherwise): there
    // is ONE record across both eras by design (`pipelinePlace.js` § THREE
    // FACTS), because the question it answers — "where was the reader?" — has
    // one answer. So arriving on this list OVERWRITES a 2.0 record with
    // `{at:'list', era:1, pipelineId:null}`: the reader is on the 1.0 list now,
    // and that is true. What the gate prevents is the foreign record being
    // READ — marking a row, or resuming into a plan — never its replacement.
    const placeIsOurs = place?.era === PAGE_ERA;
    const lastOpenedId = placeIsOurs ? (place?.pipelineId ?? null) : null;
    // req #3225 — the SAME preference the plan detail header's toggle writes.
    // This page carries no control of its own for it (the toggle lives where
    // the requirement puts it, in the header's row of toggle groups); it only
    // reads whatever the reader last chose there. `useViewPreference`'s
    // per-tab sessionStorage read happens at mount, which is exactly when a
    // route change lands here, so a choice made on the detail page is already
    // in effect the moment this page opens.
    //
    // Key and default from the ONE shared pair (req #3241) rather than a second
    // copy of both literals — a page reading a mistyped key does not fail, it
    // quietly falls back to its own default and shows a plausible answer.
    const [showReqCountsPref] = useViewPreference(
        REQ_COUNTS_STORAGE_KEY, DEFAULT_REQ_COUNTS);
    const showReqCounts = showReqCountsPref === 'on';
    // req #3220 — multi-select via the shared ChipFilter, not the old nullable
    // single value. Nothing outside this page reads the filter, so a Zustand
    // store would still be ceremony without a second consumer — but the value
    // itself is now worth surviving a click-into-detail-and-back (see the
    // STATUS_FILTER_STORAGE_KEY comment above), so it's seeded from and
    // written through to sessionStorage rather than living purely in memory.
    const [statusFilter, setStatusFilter] = useState(
        () => readStoredStatusFilter() || DEFAULT_PIPELINE_STATUSES);
    const toggleStatus = (status) => setStatusFilter((current) => {
        const next = current.includes(status)
            ? current.filter((s) => s !== status)
            : [...current, status];
        writeStoredStatusFilter(next);
        return next;
    });

    const { data: pipelines = [], isLoading: pipelinesLoading } = useAllPipelines(creatorFk);
    const { data: steps = [], isLoading: stepsLoading } = useAllPipelineSteps(creatorFk);
    const { data: stepRequirements = [], isLoading: linksLoading } =
        useAllPipelineStepRequirements(creatorFk);
    // The SAME projection the detail page requests. `useAllRequirements` puts
    // `fields` in its cache key, so a narrower one here would be a second cache
    // entry — and clicking into a plan would refetch the whole requirements table
    // rather than rendering from the read this page already paid for.
    const { data: requirements = [], isLoading: reqsLoading } =
        useAllRequirements(creatorFk, { fields: PLAN_REQUIREMENT_FIELDS });
    const { data: machines = [], isLoading: machinesLoading } = useMachines(creatorFk);
    // req #3224 — the durable orchestration reservation. ONE unfiltered list
    // read (a handful of rows: one per reserved scope), joined client-side, so
    // the request count still grows with the number of TABLES this page draws
    // on and never with the number of plans on it.
    //
    // Deliberately NOT in `isLoading`. Every other read below feeds a NUMBER OR
    // A LABEL that would render wrong before it arrives; this one feeds an
    // OPTIONAL badge whose absence means "not orchestrated", which is also the
    // correct reading while it is in flight. Gating the whole page on live
    // process state would make an unreachable ops table a blank plans page.
    const { data: orchestrationClaims = [] } = useOrchestrationClaims(creatorFk);

    // Every read that feeds a NUMBER OR A LABEL gates the spinner. `pipelines` is
    // one row and resolves first; the requirements read is the whole table and
    // resolves last — so gating on pipelines alone paints "0 steps · 0 complete"
    // and an empty progress bar over a 34-step plan on essentially every cold
    // load, then snaps to the real figures. A wrong number is not a loading
    // state, and neither is a machine rendered as a bare id.
    const isLoading = pipelinesLoading || stepsLoading || linksLoading
        || reqsLoading || machinesLoading;


    // ── req #3431 — GO STRAIGHT BACK TO THE SPOT ────────────────────────────
    // > *"if you navigate away you would hours later when coming back, go
    // > straight that spot."*
    //
    // Req #3311 remembered which plan the reader last opened and MARKED its row.
    // That is a bookmark, not a return: the reader still had to find and click
    // it. This is the return, and it is one navigation with four conditions on
    // it — each of which is a way the feature would otherwise misfire.
    //
    // 1. NOT WHILE LOADING. A redirect decided over a spinner is a redirect
    //    decided over no data: condition 3 would see an empty list and conclude
    //    the plan was deleted. Same gate, same reason, as the scroll restore
    //    directly above.
    // 2. `at === 'plan'`. A reader whose last act was to walk back out to this
    //    list asked for this list. The record says which, so "resume" and
    //    "don't" are one field rather than a heuristic — and it is what makes a
    //    RELOAD of the list show the list.
    // 3. THE PLAN STILL EXISTS — tested against `pipelines`, NOT `filtered`. A
    //    plan hidden by the reader's own status filter is present and would read
    //    as deleted, destroying a perfectly good record (data-architect review).
    //    A genuinely deleted plan is swept below instead of navigated to, which
    //    would land on a not-found alert that reads as a defect in the data.
    // 4. THE READER DID NOT ARRIVE FROM A PLAN. This is the one that keeps the
    //    page reachable. Without it, clicking Pipelines in the nav rail while on
    //    a plan — or pressing Back — bounces straight back to the plan, and the
    //    list can never be opened again. With it, that gesture lands here AND
    //    rewrites the record to `at: 'list'`, so the next visit from anywhere
    //    else lands here too: the reader's last decision was to leave the plan,
    //    and it stands until they open one again.
    //
    // ── RETURNED FROM RENDER, NOT FIRED FROM AN EFFECT ─────────────────────
    // `<Navigate replace />` after the spinner branch, the shape `HomePage.jsx`
    // already uses for a stored-preference landing redirect. An effect renders
    // the full list first and navigates on the next tick, so the reader sees a
    // flash of the page they are not going to. `replace`, never a push: a pushed
    // redirect leaves the list on the history stack, so Back re-enters it and it
    // redirects again — condition 4's trap reached through the history API.
    //
    // ── THE ORIGIN IS SAMPLED ONCE, AT MOUNT ───────────────────────────────
    // `cameFrom` is a moving value: the app shell advances the trail in its own
    // effect, which runs AFTER this component's (React runs children first). The
    // helper is written to answer correctly on both sides of that, but the
    // answer must still be frozen — the gate re-evaluates as data arrives, and
    // "where did the reader come from" is a fact about the arrival, not about
    // the render that happens to be asking.
    // ── AND ONCE THE READER IS ON THIS PAGE, IT NEVER FIRES (review M2) ────
    // `settledRef` below is the same "the reader stayed" fact the settle effect
    // already turns on, consulted here so the redirect cannot happen LATER. The
    // inputs are not frozen: `refetchOnWindowFocus` replaces `pipelines` under a
    // mounted page, so a plan that was missing at mount — because the read had
    // failed, or because it was created in another tab — flips condition 3 true
    // thirty seconds in and teleports a reader off a list they are reading.
    //
    // Read during render, which is safe because the ref is MONOTONIC: it goes
    // false → true exactly once, in an effect, so it cannot differ between two
    // reads within one commit.
    const { pathname } = useLocation();
    const [arrivedFromPlan] = useState(() => isPipelineDetailPath(cameFrom(pathname)));
    const settledRef = useRef(false);

    const resumeTo = !isLoading && !arrivedFromPlan && !settledRef.current
        && placeIsOurs && place?.at === 'plan'
        && pipelines.some((p) => p.id === place.pipelineId)
        ? pipelinePlacePath(place) : null;

    // req #3311 — GATED ON THE SPINNER, and that gate is the whole subtlety. A
    // position cannot be restored onto a page that is 40px of CircularProgress:
    // every scroller clamps on assignment, so an early restore does not fail, it
    // lands at 0 and reads as the feature not working. A null key parks the hook
    // until the rows exist; the effect then re-runs with the real key and
    // restores against a page that has height. Nothing is lost in the meantime —
    // a spinner emits no scroll events, so there is no position to commit and the
    // stored one is never overwritten with a 0.
    //
    // req #3431 — AND PARKED WHILE RESUMING, which is the hook's "not this
    // time" channel, the same one a deep link uses. This render returns a
    // redirect, so restoring the list's position would scroll a page the reader
    // is already leaving and then commit whatever that produced. Nothing is
    // lost: they never saw the list.
    useScrollMemory(isLoading || resumeTo ? null : LIST_SCROLL_KEY);

    // Everything that is TRUE BECAUSE THE READER STAYED — so it must not run on
    // the render that redirects, or an outgoing resume would overwrite the very
    // record it is acting on. Once per mount: the inputs change as data arrives
    // and none of these is a per-render fact.
    useEffect(() => {
        if (isLoading || resumeTo || settledRef.current) return;
        settledRef.current = true;

        // ── AN EMPTY LIST IS NOT A FACT ABOUT THE WORLD (review M1) ────────
        // `useAllPipelines` yields `undefined` on a FAILED read — an auth blip,
        // a 5xx, an offline tab — and this page defaults that to `[]` while
        // `isLoading` goes false. So a read that never succeeded is
        // indistinguishable here from a reader who owns no plans, and NEITHER
        // of the two things below may be done on that evidence:
        //
        //   · CLEARING the record would destroy the reader's resume point on a
        //     transient network fault, silently, with an empty list on screen
        //     and no error to explain it. It is `prunePipelineStorage`'s own
        //     guard — "no plans exist" and "the plans have not arrived" are the
        //     same value and opposite instructions — applied to the same
        //     destructive act on the same evidence.
        //   · RECORDING `at: 'list'` is subtler and was the first fix's own bug:
        //     it survives the blip, but it still tells the next visit the reader
        //     CHOSE this list, so one failed read quietly costs them the resume.
        //     They did not choose anything; they were shown a broken page.
        //
        // So the whole settle is skipped and the record is left exactly as it
        // was. The latch above is still armed, deliberately: the reader is
        // reading this page now, and a refetch that succeeds thirty seconds
        // later must not teleport them off it (M2). Their next fresh arrival
        // resumes normally.
        if (pipelines.length === 0) return;

        // Orphaned cameras and offsets from deleted plans, plus req #3311's
        // retired key. Here rather than anywhere else because this is the one
        // page that holds the complete live plan set (design rule 5 — it is
        // already fetched; the sweep adds no read).
        prunePipelineStorage(pipelines.map((p) => p.id), PAGE_ERA);

        // req #3463 — ONLY OUR OWN ERA'S RECORD IS JUDGED AGAINST OUR OWN LIST.
        // `pipelines` here is the 1.0 read, so asking it whether a 2.0 plan
        // still exists is a question it cannot answer, and the honest-looking
        // "no" would delete a perfectly good record belonging to the other
        // page.
        if (placeIsOurs && place?.at === 'plan'
            && !pipelines.some((p) => p.id === place.pipelineId)) {
            clearPipelinePlace();
            return;
        }
        // Being here IS the reader's place now. Merged rather than overwritten,
        // or the row marker would go with it — and merged from OUR record only,
        // so arriving on the 1.0 list does not relabel a 2.0 plan id as 1.0.
        writePipelinePlace(pipelinePlaceAtList(placeIsOurs ? place : null, PAGE_ERA));
    }, [isLoading, resumeTo, pipelines, place, placeIsOurs]);

    const summaries = useMemo(
        () => pipelineSummaries({ pipelines, steps, stepRequirements, requirements }),
        [pipelines, steps, stepRequirements, requirements]);
    // req #3225 — one more pass over the same shared reads (design rule 5:
    // never a per-pipeline fetch), computed unconditionally so toggling the
    // preference never triggers a fresh read — only a fresh render.
    const reqCounts = useMemo(
        () => pipelineRequirementCounts({ pipelines, steps, stepRequirements, requirements }),
        [pipelines, steps, stepRequirements, requirements]);

    const filtered = useMemo(
        () => pipelines.filter((p) => statusFilter.includes(p.pipeline_status)),
        [pipelines, statusFilter]);

    // Named for the empty state (req #3220 acceptance) rather than a boolean —
    // "a filter is active" doesn't say WHICH statuses vanished.
    const hiddenStatusCounts = useMemo(
        () => hiddenPipelineStatusCounts(pipelines, statusFilter),
        [pipelines, statusFilter]);

    // req #3431 — THIS HANDLER NO LONGER RECORDS ANYTHING, and that is the fix
    // rather than an omission. Req #3311 wrote the id here, at the one call site
    // that opens a plan from this page, so a plan reached by a `?step=` deep
    // link, by Back, by the sessions grid or by the requirement page's "view on
    // plan" link was never recorded. `PipelineDetail` writes the record on
    // arrival instead: one writer, every route, nothing to keep exhaustive —
    // the argument `viewportMemory.js` makes about return paths, applied to
    // entry paths.
    const open = (id) => {
        const to = planDetailPath(PAGE_ERA, id);
        if (to) navigate(to);
    };

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    // req #3431 — the resume. See the gate above; this is only where it lands.
    if (resumeTo) return <Navigate to={resumeTo} replace />;

    return (
        <Box className="app-content-planpage">
            {/* The grid class goes on a WRAPPER, not on ViewerHeader's own row.
                `.app-content-planpage` assigns areas by class and ViewerHeader
                returns a FRAGMENT — the header row plus the V7 accounting line —
                so classing the row alone would leave the accounting Typography as
                a second, unplaced grid child, auto-flowed into the `tabs` row at
                one column's width. Both lines belong in the `view-toggle` area,
                which is also exactly where the accounting text sat before.

                Only the page-level insets (mt/px) live here; the rhythm INSIDE the
                header — the row/accounting gap and the accounting line's own
                bottom margin — is ViewerHeader's and is not overridden. */}
            <Box className="app-content-view-toggle" sx={{ mt: 3, px: 3 }}>
                <ViewerHeader
                    title="Pipelines"
                    views={VIEWS}
                    view={activeView}
                    onViewChange={setView}
                    testIdPrefix="pipelines"
                    /* Shared control — filters BOTH views (R4/R5). Multi-select
                       via the standardized ChipFilter (req #3220), not a second
                       hand-rolled implementation of it. V3 puts it in the filters
                       slot: it changes WHAT is listed. */
                    filters={
                        <ChipFilter
                            options={pipelineStatusOptions}
                            selected={statusFilter}
                            onToggle={toggleStatus}
                            testId="pipelines-status-filter"
                            chipTestIdPrefix="pipelines-status-chip"
                        />
                    }
                    /* Counts the WHOLE dataset, with the filtered subset named
                       separately (V7). The call-to-action names what the ACTIVE
                       view actually shows — "click a row" is wrong advice in
                       Cards, where the click target is a card. */
                    accounting={<>
                        {filtered.length} of {pipelines.length} pipeline
                        {pipelines.length === 1 ? '' : 's'} — click a{' '}
                        {activeView === 'table' ? 'row' : 'card'} for the plan
                    </>}
                />
            </Box>

            <Box className="app-content-tabpanel" sx={{ px: 3, pt: 0 }}>
                {activeView === 'table' ? (
                    <PipelinesTableView
                        pipelines={filtered}
                        summaries={summaries}
                        reqCounts={reqCounts}
                        showReqCounts={showReqCounts}
                        machines={machines}
                        claims={orchestrationClaims}
                        timezone={timezone}
                        onOpen={open}
                        lastOpenedId={lastOpenedId}
                        hiddenStatusCounts={hiddenStatusCounts}
                    />
                ) : (
                    <PipelineCardsView
                        pipelines={filtered}
                        summaries={summaries}
                        reqCounts={reqCounts}
                        showReqCounts={showReqCounts}
                        machines={machines}
                        claims={orchestrationClaims}
                        onOpen={open}
                        lastOpenedId={lastOpenedId}
                        hiddenStatusCounts={hiddenStatusCounts}
                    />
                )}
            </Box>
        </Box>
    );
}
