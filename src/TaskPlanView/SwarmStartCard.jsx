// SwarmStartCard — cross-category requirement aggregator in the requirement view.
//   • Header is a row of status chips (same styling as the requirements page filter chips).
//   • Single-select: exactly one status is active at a time.
//   • Card shows all requirements with the selected status across all categories,
//     under the ONE shared visibility rule (`useRequirementVisibility`) — the
//     reader's orchestrated toggle and nothing else. req #3502 removed this
//     card's own second rule; see `swarmStartCardUtils.js`'s header for why.
//   • Template row at the bottom (req #2414): typing a title + Enter/blur navigates
//     the user to the requirement editor in "new" mode — nothing is saved until the
//     user picks a category in the editor (the aggregator has no default category).
//   • Other interactions (status cycle, coord cycle, title edit, delete) mirror CategoryCard.
//   • req #3286 — the card renders NO MESSAGES, in any state. Chips, rows, the sort
//     menu and the template row are the whole card; an empty chip renders an empty
//     body. Removing text never removes behaviour: the pipeline exclusion below is
//     untouched and simply goes unexplained on this surface, by design.

import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import RequirementRow from '../SwarmView/RequirementRow';
import RequirementDeleteDialog from '../SwarmView/RequirementDeleteDialog';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useRequirementsByStatus, useRequirementsDone, useSessions, useCategoryColors, useAllRequirements } from '../hooks/useDataQueries';
import { useRequirementVisibility } from '../hooks/useRequirementVisibility';
import { filterToEpic } from '../utils/epicMembership';
import { tallyRequirementStatuses } from './swarmStartCardUtils';
import { requirementKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { RequirementActionsContext } from '../hooks/useRequirementActions';
import { useSwarmStartCardStore } from '../stores/useSwarmStartCardStore';
import { requirementStatusChipProps, requirementStatusLabel } from '../SwarmView/statusChipStyles';
import { requirementStatusTimestampFields, requirementStatusTimestampState } from '../utils/requirementStatusTimestamps';

// Chip statuses shown on this card. Mirrors the requirements page filter chips minus
// 'deferred' and 'wontfix' — both terminal/historical states outside this card's
// "active work" scope ('deferred' retired from the aggregator per req #2584;
// 'wontfix' was never added, same reasoning). 'met' is special-cased: it shows only
// the trailing-24h Met list — recent completions, not the full Met history.
const SWARM_START_STATUSES = ['authoring', 'approved', 'swarm_ready', 'development', 'met'];

// ── The card's order (req #3302) ────────────────────────────────────────────
//
// Two REAL positions. They were `hand` and `created`, and `changeSortMode`
// discarded the value it was handed — both ran `isMet ? metSort : createdSort`,
// so the menu had two entries and one behaviour and only the checkmark moved.
//
// Hand sort cannot work on this card at all: it aggregates ACROSS categories
// while `requirements.sort_order` positions a row within ONE of them, and the
// card is deliberately not a drop target (`memory/aggregator-card-pattern.md`),
// so there is no way to set a position. The two orders that are meaningful for
// "every requirement with status X" are the two comparators this file already
// had, so this makes them selectable rather than inventing a third.
export const SORT_OLDEST = 'oldest';
export const SORT_NEWEST = 'newest';

// The template row (id === '') is an input affordance, not a requirement, and
// stays anchored at the bottom on every re-sort.
const templateLast = (a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : 0);

// THE TWO MODES ARE INVERSES OVER ONE KEY, and that is not decoration. A first
// cut made Oldest `id ASC` and Newest `completed_at DESC`, so on the met chip the
// two answered different questions and the pair only looked like a direction
// toggle — its own test caught it by asserting they must DIFFER on a fixture
// where those two keys happened to agree.
//
// The key is "when did this happen": `completed_at` where there is one, id
// otherwise. Rows with no completion sort LAST in both directions — they are
// undated, not earliest, and flipping them to the front under Oldest would make
// the met chip open on the rows it knows least about.
const completedAtOf = (r) => (r.completed_at ? new Date(r.completed_at).getTime() : null);

const byRecency = (a, b, dir) => {
    const t = templateLast(a, b);
    if (t) return t;
    const aTime = completedAtOf(a);
    const bTime = completedAtOf(b);
    // Undated last, both directions.
    if (aTime === null && bTime !== null) return 1;
    if (bTime === null && aTime !== null) return -1;
    if (aTime !== null && bTime !== null && aTime !== bTime) return (bTime - aTime) * dir;
    // No completion anywhere — every row on the four queue chips — so the id is
    // the only ordering fact there is.
    return (b.id - a.id) * dir;
};

// Newest first: most-recently-completed first (req #2613's `metSort`), id DESC
// where nothing is completed.
const newestSort = (a, b) => byRecency(a, b, 1);

// Oldest first: the exact inverse. id ASC where nothing is completed, which is
// what the four queue chips have always shown.
const oldestSort = (a, b) => byRecency(a, b, -1);

export const aggregatorSort = (mode) => (mode === SORT_NEWEST ? newestSort : oldestSort);

/**
 * The order a chip shows before the reader has chosen one.
 *
 * Exported so a test can reach the rule rather than re-derive it. Newest for
 * `met` — req #2613 made that list most-recently-completed first and it is what
 * the list is read for — and Oldest for the four queue chips, which is what they
 * have always shown. Keeping "unchosen" distinct from either value is what let
 * the menu become real without changing what any chip shows on arrival.
 */
export const defaultSortMode = (isMet) => (isMet ? SORT_NEWEST : SORT_OLDEST);
const MET_TRAILING_HOURS = 24;
// Met window refresh cadence — also the quantum the window is rounded to so that
// re-renders within a single quantum don't mint a new query key (req #2609).
const MET_REFRESH_INTERVAL_MS = 60_000;

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import Badge from '@mui/material/Badge';
import Check from '@mui/icons-material/Check';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { CircularProgress } from '@mui/material';

// Quantize `now` to the nearest prior MET_REFRESH_INTERVAL_MS boundary, then
// derive the trailing-24h window from that. Two calls within the same quantum
// return value-equal strings so the consumer can preserve referential equality.
const computeMetWindow = () => {
    const nowMs = Math.floor(Date.now() / MET_REFRESH_INTERVAL_MS) * MET_REFRESH_INTERVAL_MS;
    const startMs = nowMs - MET_TRAILING_HOURS * 60 * 60 * 1000;
    return {
        startStr: new Date(startMs).toISOString().slice(0, 19),
        endStr: new Date(nowMs).toISOString().slice(0, 19),
    };
};

// req #3428 — `epicReqIds` is the epic filter's SCOPE, handed down by the host
// (`CategoryTabPanel`, from `SwarmView`). A Set of requirement ids, or `null`
// when no filter is active — an AGGREGATOR NEVER INVENTS A FILTER THE HOST OWNS
// (`memory/aggregator-card-pattern.md`), and one derivation upstairs is what
// stops this card from disagreeing with the category cards beside it.
//
// AN UNFILTERED AGGREGATOR OVER A FILTERED GRID would mean something different
// from the grid beneath it, which is the defect the pattern's own tests exist to
// catch. Applied to the ROWS and to the CHIP BADGES from the same Set, for the
// same reason the pipeline exclusion is.
const SwarmStartCard = ({ epicReqIds = null }) => {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const navigate = useNavigate();

    const selectedStatus = useSwarmStartCardStore(s => s.selectedStatus);
    const setSelectedStatus = useSwarmStartCardStore(s => s.setSelectedStatus);

    const [requirementsArray, setRequirementsArray] = useState();
    const [sessionStatusMap, setSessionStatusMap] = useState({});
    // req #3302 — a REAL two-position order. This was `'hand' | 'created'`, and
    // `changeSortMode` ignored the value entirely: both items ran
    // `isMet ? metSort : createdSort`, so the two menu entries produced the same
    // list and only the checkmark moved. Hand sort cannot work here at all — the
    // aggregator is CROSS-CATEGORY and `requirements.sort_order` positions a row
    // within ONE category, and the card is not a drop target, so there is no way
    // to set it. The two orders that ARE meaningful for "every requirement with
    // status X" are the two comparators this file already had.
    const [sortMode, setSortMode] = useState(null);
    const [menuAnchorEl, setMenuAnchorEl] = useState(null);
    const menuOpen = Boolean(menuAnchorEl);

    const showError = useSnackBarStore(s => s.showError);

    // ── The inputs the chip counts are built from ───────────────────────────
    // Hoisted ABOVE `effectiveStatus` (req #3428) so the epic override below can
    // read the counts. Nothing here depends on which chip is selected, which is
    // what makes the move safe: `chipOffersLaunch` is the only count-adjacent
    // value that does, and it stays where it was.
    // req #3428 — an epic filter forces the orchestrated toggle off, on every
    // chip. Since req #3502 there is nothing else for it to override: this card
    // has no second rule.
    const epicFilterActive = epicReqIds != null;

    // req #3419 / #3428 / #3502 — THE visibility answer, identical on every
    // browse surface (Cards view, Table view, the detail elevator). This card
    // derives nothing of its own; `isVisible` filters the rows AND tallies the
    // badges, so a count can never disagree with the rows under it.
    const visibility = useRequirementVisibility(profile?.userName, { epicFilterActive });

    // All requirements across categories — the per-status counts' source (req #2549).
    const { data: allRequirementsForCounts } = useAllRequirements(profile?.userName, {
        fields: 'id,requirement_status',
    });

    // THE TALLY, COMPUTED ONCE. `statusCountMap` below overlays only the `met`
    // figure onto this; the epic chip override reads the same object. Three
    // computations of one number is how a badge and a list start disagreeing,
    // which is the defect this file's own comments call load-bearing.
    const baseStatusCounts = React.useMemo(() => tallyRequirementStatuses(
        filterToEpic(allRequirementsForCounts, epicReqIds),
        SWARM_START_STATUSES, visibility.isVisible).counts,
        [allRequirementsForCounts, epicReqIds, visibility.isVisible]);

    // Persisted-store fallback — req #2584 retired 'deferred' from this card. Users
    // with a now-invalid persisted value get re-pointed at the default. `storedStatus`
    // is computed synchronously so the hook calls below never fire against the stale
    // value (otherwise we'd pay one wasted fetch for 'deferred' before the useEffect ran).
    const storedStatus = SWARM_START_STATUSES.includes(selectedStatus) ? selectedStatus : 'swarm_ready';
    useEffect(() => {
        if (selectedStatus !== storedStatus) {
            setSelectedStatus(storedStatus);
        }
    }, [selectedStatus, storedStatus, setSelectedStatus]);

    // ── OPEN ON A CHIP THAT HAS THE EPIC'S WORK (req #3428) ─────────────────
    // MEASURED, not reasoned: every requirement under epic 11 on 2026-08-09 was
    // `development` AND plan-carried, while `selectedStatus` persists as
    // `swarm_ready` — so the aggregator this requirement asks to be turned ON
    // opened with zero rows and a `0` badge.
    //
    // req #3502 removed one of the two causes: the three launch chips no longer
    // exclude plan-carried work, so an epic's `authoring`/`approved`/
    // `swarm_ready` work now shows here. The OTHER cause is untouched and is why
    // this override stays — an epic simply may not have any work in the chip the
    // reader last selected, and a filtered aggregator that opens blank fails the
    // same acceptance wording either way.
    //
    // "The aggregator is on" is the requirement's acceptance wording, and an
    // aggregator that is on and blank does not meet it.
    //
    // A DERIVED OVERRIDE, exactly like the card's forced visibility and the
    // forced pipeline toggle — `setSelectedStatus` is never called, so dismissing
    // the pill returns the reader to their own chip. It applies ONLY while they
    // have not picked one during this filtered visit (`chipPickedWhileFiltered`),
    // so a deliberate click onto an empty chip is respected rather than undone.
    //
    // `met` IS A LAST-RESORT CANDIDATE ONLY (req #3500). It is skipped while any
    // of the four "queue" statuses has epic work, for the reason the original
    // req #3428 comment gave: its badge is normally the trailing-24h overlay
    // below, not the all-time tally here, so auto-selecting it FIRST could land
    // on another empty chip. But measured against real completed plans (pipeline
    // 8's six epics, 2026-08-13), EVERY requirement under EVERY one of them is
    // `met` — a finished epic has nothing left in authoring/approved/swarm_ready/
    // development by construction, so "if nothing else has rows, the reader's
    // own chip stands" left the aggregator this requirement asks to be turned ON
    // blank for exactly the epics a reader is likeliest to click into from a
    // completed pipeline. `met` is checked LAST, against `baseStatusCounts.met`
    // — the ALL-TIME, epic-scoped tally (`useAllRequirements`, not the trailing
    // window) — so a plan that finished days ago still lands here. The rows and
    // badge for that landing are sourced without the 24h window too; see
    // `serverMetRequirementsAllTime` below.
    //
    // req #3502 CHANGED WHICH CHIP THE QUEUE SCAN LANDS ON, and left the rule
    // alone. The rule is and was "the first queue chip in
    // `SWARM_START_STATUSES` that has rows", scanned in vocabulary order. What
    // moved is the DATA: the three launch chips used to be structurally
    // near-empty under an epic filter — an epic's work is step-carried by
    // construction and those chips excluded exactly that, unconditionally — so
    // in practice `activeCandidate` could only ever resolve to `development`.
    // Their counts are real now, so an epic holding both authoring and
    // development work opens on `authoring` where it used to open on
    // `development`. That also makes #3500's last-resort `met` branch the ONLY
    // thing standing between a finished epic and a blank card, since the queue
    // chips genuinely are empty there — the two changes compose rather than
    // overlap. Left as a first-non-empty scan on purpose: an arrival-order
    // preference ("a plan-visualizer arrival wants in-flight work") is a NEW
    // rule nobody asked for, and inventing one here would put a second,
    // undocumented ordering in a fallback the reader never sees chosen.
    const [chipPickedWhileFiltered, setChipPickedWhileFiltered] = useState(false);
    useEffect(() => { setChipPickedWhileFiltered(false); }, [epicFilterActive]);
    const epicChipOverride = React.useMemo(() => {
        if (!epicFilterActive || chipPickedWhileFiltered) return null;
        if (baseStatusCounts[storedStatus] > 0) return null;
        const activeCandidate = SWARM_START_STATUSES.find(
            s => s !== 'met' && baseStatusCounts[s] > 0);
        if (activeCandidate) return activeCandidate;
        return baseStatusCounts.met > 0 ? 'met' : null;
    }, [epicFilterActive, chipPickedWhileFiltered, baseStatusCounts, storedStatus]);

    const effectiveStatus = epicChipOverride ?? storedStatus;

    const isMet = effectiveStatus === 'met';

    // `null` means the reader has not chosen, so the chip's own default applies —
    // Newest for `met` (req #2613: most-recently-completed first, which is what
    // that list is read for) and Oldest for the four queue chips. Keeping the
    // unchosen state distinct is what lets the menu become real without changing
    // what either chip shows on arrival. A pick sticks for the visit and applies
    // to every chip, which is why it is not persisted per status.
    const effectiveSortMode = sortMode ?? defaultSortMode(isMet);

    // Trailing-24h Met window — quantized to MET_REFRESH_INTERVAL_MS boundaries and
    // bumped on a timer + tab-visibility return (req #2609). Quantization keeps the
    // query key stable across re-renders within a single quantum (the property that
    // motivated the original mount-time freeze) while still sliding the window
    // forward without a full page refresh once the quantum elapses.
    const [metWindow, setMetWindow] = useState(computeMetWindow);
    useEffect(() => {
        const tick = () => {
            setMetWindow(prev => {
                const next = computeMetWindow();
                return (next.startStr === prev.startStr && next.endStr === prev.endStr)
                    ? prev
                    : next;
            });
        };
        const intervalId = setInterval(tick, MET_REFRESH_INTERVAL_MS);
        const onVisibility = () => {
            if (document.visibilityState === 'visible') tick();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);

    // Active-status query — disabled when Met is selected (the done query below
    // is the row source in that case). started_at/completed_at/deferred_at are
    // added to the default projection (req #3244) so statusClick's revert-on-failure
    // path has the row's real prior timestamps to restore, not undefined.
    const { data: serverRequirements } = useRequirementsByStatus(profile?.userName, effectiveStatus, {
        fields: 'id,title,requirement_status,coordination_type,ai_model,effort,machine_fk,category_fk,started_at,completed_at,deferred_at',
        enabled: !isMet,
    });

    // Trailing-24h Met query — always enabled so the Met chip badge has a live count
    // regardless of which chip is currently selected.
    const { data: serverMetRequirements } = useRequirementsDone(
        profile?.userName,
        metWindow.startStr,
        metWindow.endStr,
        // ai_model,effort included so the Met chip's rows can render the Model +
        // Effort columns too (req #3029); the active-status query already carries them.
        { fields: 'id,title,requirement_status,coordination_type,ai_model,effort,category_fk,completed_at' },
    );

    // req #3500 — under an epic filter, "met" means the EPIC's completed work,
    // not the whole account's last 24 hours: an epic reached from the plan
    // visualizer is routinely already finished, and the trailing window empties
    // the moment the plan is more than a day old, wrongly reading as "nothing to
    // show" for real, completed work. Same shape as the queue-status query
    // above (`useRequirementsByStatus`, unwindowed, whole-account) rather than a
    // new fetch pattern — only its STATUS differs.
    //
    // `enabled: epicFilterActive && isMet`, NOT `epicFilterActive` alone.
    // MEASURED: 1188 of 1367 requirements in this account are `met`, so an
    // unconditional whole-account fetch on every epic-filtered visit would pull
    // that population even in the common case — an epic with queue work, where
    // `epicChipOverride` lands on `development` and not one `met` row is ever
    // rendered. `isMet` is derived from `epicChipOverride` in this SAME render
    // pass (both are plain `const`s computed top-to-bottom in this function
    // body, not state that lags a render), so gating on it costs no extra
    // round trip when the override does land on `met` — the query enables in
    // the exact render that happens.
    const { data: serverMetRequirementsAllTime } = useRequirementsByStatus(profile?.userName, 'met', {
        fields: 'id,title,requirement_status,coordination_type,ai_model,effort,category_fk,completed_at',
        enabled: epicFilterActive && isMet,
    });

    // Memoized AND identity-preserving, and both halves are load-bearing.
    // `eligibleRequirements` is a dependency of the seeding `useEffect` below,
    // which calls `setRequirementsArray` — so an array that changes identity on
    // every render is not wasted work, it is a synchronous render loop. A bare
    // `.filter` does exactly that whenever anything upstream churns (a query
    // hook handing back a fresh `[]`, say). `filterVisible` returns the INPUT
    // when it drops nothing — see `excludeByIds`/`filterKeepingIdentity`.
    //
    // req #3502 — the chip's status is no longer an input to the rule, so both
    // populations take the SAME pass. There is nothing left for `met` to be an
    // exception to.
    const eligibleRequirements = React.useMemo(
        () => visibility.filterVisible(serverRequirements),
        [serverRequirements, visibility.filterVisible]);

    // The Met chip's own population never goes through `eligibleRequirements`
    // (its query is `serverMetRequirements`, not `serverRequirements`) — so it
    // needs its own pass — under THE SAME RULE, since req #3502.
    //
    // req #3500 — the SOURCE swaps under an epic filter (all-time, epic-scoped)
    // but the visibility pass applied to it is unchanged. req #3502 then made
    // that pass the shared one: `met` had its own `aggregatorRowVisible('met',
    // …)` predicate because the rule keyed on the chip's status, and it no
    // longer does, so there is nothing left for `met` to be an exception to.
    // The two changes are orthogonal — #3500 picks WHICH ROWS arrive here,
    // #3502 decides which of them are visible.
    const metSourceRequirements = epicFilterActive ? serverMetRequirementsAllTime : serverMetRequirements;

    const eligibleMetRequirements = React.useMemo(
        () => visibility.filterVisible(metSourceRequirements),
        [metSourceRequirements, visibility.filterVisible]);

    // The array that drives the card body for the currently selected chip.
    //
    // req #3428 — the epic filter is the LAST pass, after both pipeline
    // exclusions, and it is an ID-SET test: none of this card's three
    // projections carries `feature_fk`, and none of them needs to. That is the
    // whole reason the scope arrives as ids.
    const currentRequirements = React.useMemo(
        () => filterToEpic(isMet ? eligibleMetRequirements : eligibleRequirements, epicReqIds),
        [isMet, eligibleMetRequirements, eligibleRequirements, epicReqIds]);

    // Fetch sessions for status badges (same as CategoryCard)
    const { data: serverSessions } = useSessions(profile?.userName);

    // Fetch category colors so each row can show a color bar for its source category
    const { data: serverCategoryColors } = useCategoryColors(profile?.userName);
    const categoryColorMap = React.useMemo(() => {
        if (!serverCategoryColors) return {};
        const map = {};
        serverCategoryColors.forEach(c => { if (c.color) map[c.id] = c.color; });
        return map;
    }, [serverCategoryColors]);

    // Count requirements per status across all categories (req #2549). Reuses the
    // same useAllRequirements query — no extra fetch.
    // The 'met' count is overlaid from the trailing-24h Met query (req #2584), since
    // useAllRequirements doesn't carry completed_at and can't be filtered to the
    // 24-hour window here. Returns { authoring, approved, swarm_ready, development, met }.
    //
    // req #3419 / #3502 — a chip's count applies the SAME rule as its list, from
    // the SAME predicate object (`visibility.isVisible`, which `filterVisible`
    // is the array form of), so the header can never disagree with the rows
    // beneath it.
    //
    // LOAD-BEARING: a chip's badge matches the rows beneath it only because both
    // sources are the same population — `useAllRequirements` here and
    // `useRequirementsByStatus` above both read /requirements with NO category
    // predicate and NO closed-category guard. RequirementsTableView does filter
    // through `categoryMap`, and copying that here would look like an improvement
    // while desynchronizing the count from the list. See `tallyRequirementStatuses`.
    //
    // req #3286 — the card reads `counts` ONLY. `tallyRequirementStatuses` still
    // returns `hidden` (a pure util with its own tests, and the count arithmetic
    // depends on it), but the card no longer tracks it: its one consumer was the
    // explanatory sentence, and this card renders no sentences. Reading `hidden`
    // again here means a message is being reintroduced.
    //
    // req #3428 — the epic filter narrows the COUNT SOURCE, not the tally rule,
    // so a badge can never disagree with the rows beneath it. The met overlay
    // reads `eligibleMetRequirements`, which is why it gets the same pass: that
    // array is the one the rows are NOT taken from directly (`currentRequirements`
    // filters it), so leaving the overlay alone would print an unfiltered met
    // count over a filtered met list.
    //
    // req #3500 — UNDER AN EPIC FILTER THE OVERLAY IS SKIPPED ENTIRELY.
    // `baseStatusCounts.met` is already the right number: it comes from
    // `useAllRequirements`, all-time, run through the SAME `filterToEpic` +
    // `tallyRequirementStatuses` pass as the other four statuses. Overlaying the
    // trailing-24h figure on top of it would put the global-card window back on
    // an epic-scoped badge — the exact mismatch this requirement reports. The
    // branch below therefore only ever runs while `epicFilterActive` is false,
    // which makes `epicReqIds` null there by that flag's own definition — so
    // `filterToEpic` is a guaranteed no-op and reads straight off
    // `eligibleMetRequirements`, no fallback needed.
    const statusCountMap = React.useMemo(() => {
        // req #3428 — `baseStatusCounts` above IS the tally (computed once, under
        // the epic filter); this only overlays the trailing-24h `met` figure.
        const counts = { ...baseStatusCounts };
        // req #3502 arrived here with the same dead
        // `?? filterToEpic(serverMetRequirements, …).length` fallback removed
        // for its own reason (it could never fire — the branch is already
        // guarded on the array, and every pass in it returns an array). req
        // #3500's narrowing subsumes that: skipping the overlay entirely under
        // an epic filter leaves `filterToEpic` a guaranteed no-op here, so the
        // expression is simpler still. Nothing of #3502's reasoning is lost —
        // there is no second, unfiltered answer for this count either way.
        if (!epicFilterActive && Array.isArray(serverMetRequirements)) {
            counts.met = eligibleMetRequirements.length;
        }
        return counts;
    }, [baseStatusCounts, serverMetRequirements, eligibleMetRequirements, epicFilterActive]);

    // Comparators are module-level — see `aggregatorSort` above.

    // Seed local state from server data (re-runs on every fetch, chip switch, and
    // sort-order pick). THE ONLY PLACE THIS CARD ORDERS ITS ROWS — `changeSortMode`
    // deliberately re-sorts nothing, so there is one ordering path rather than two
    // racing ones (req #3302).
    useEffect(() => {
        if (!currentRequirements) {
            setRequirementsArray(undefined);
            return;
        }
        const sorted = [...currentRequirements];
        sorted.sort(aggregatorSort(effectiveSortMode));
        // Template row (req #2414) — title-only entry; saving is deferred to the
        // requirement editor where the user must pick a category before any POST.
        //
        // CARRY THE EXISTING TEMPLATE FORWARD (req #2747's fix, which `CategoryCard`
        // has had since then and this card never did). A fresh `{ title: '' }`
        // discards whatever the user has typed into the add-row but not yet saved,
        // and since req #3302 this effect re-runs on a sort-order pick as well as
        // on a refetch — so the loss went from occasional to routine.
        //
        // req #3428 — SUPPRESSED WHILE FILTERED, the same rule `CategoryCard`
        // applies to its own add-row: a requirement created from here carries no
        // feature, so it belongs to no epic and would not appear on the page that
        // offered the control.
        setRequirementsArray(prev => {
            if (epicFilterActive) return sorted;
            const prevTemplate = prev && prev.find(r => r.id === '');
            return [...sorted, prevTemplate
                ?? { id: '', title: '', requirement_status: 'authoring', category_fk: null }];
        });
    }, [currentRequirements, effectiveSortMode, epicFilterActive]); // eslint-disable-line react-hooks/exhaustive-deps

    // Build session status map (same logic as CategoryCard)
    useEffect(() => {
        if (!serverSessions || serverSessions.length === 0) return;
        const map = {};
        serverSessions.forEach(s => {
            const m = s.source_ref && s.source_ref.match(/^(priority|requirement):(\d+)$/);
            if (m) {
                const pid = parseInt(m[2]);
                if (!map[pid] || s.id > map[pid].id) {
                    map[pid] = { id: s.id, swarm_status: s.swarm_status };
                }
            }
        });
        const flatMap = {};
        for (const [k, v] of Object.entries(map)) {
            flatMap[k] = v.swarm_status;
        }
        setSessionStatusMap(flatMap);
    }, [serverSessions]);

    const handleMenuOpen = (e) => setMenuAnchorEl(e.currentTarget);
    const handleMenuClose = () => setMenuAnchorEl(null);

    // RECORD THE PICK, ALWAYS. The re-sort is the seeding effect's, which re-runs
    // on `effectiveSortMode`.
    //
    // There is deliberately no `newMode === effectiveSortMode` early return: an
    // unchosen `sortMode` is `null`, so on the met chip `effectiveSortMode` is
    // already 'newest' and such a guard would swallow the click on "Newest first"
    // — leaving the card looking correct while recording nothing, so switching
    // chips silently flipped the order back. NOT CHANGING THE ORDER IS NOT THE
    // SAME AS NOT CHANGING THE INTENTION.
    const changeSortMode = (newMode) => {
        handleMenuClose();
        setSortMode(newMode);
    };

    const handleChipClick = (status) => {
        if (status === effectiveStatus) return;
        // req #3428 — the reader has now chosen, so the epic override stands down
        // for the rest of this filtered visit. Recorded even outside a filter: it
        // is reset whenever `epicFilterActive` changes, so it can only ever mean
        // "picked during the current filter state".
        setChipPickedWhileFiltered(true);
        setSelectedStatus(status);
    };

    // Delete dialog (same as CategoryCard)
    const requirementDelete = useConfirmDialog({
        onConfirm: ({ requirementId }) => {
            call_rest_api(`${darwinUri}/requirements`, 'DELETE', { id: requirementId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        setRequirementsArray(prev => prev ? prev.filter(p => p.id !== requirementId) : prev);
                        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to delete requirement');
                    }
                }).catch(error => showError(error, 'Unable to delete requirement'));
        }
    });

    // Optimistically apply `updates` to every requirement cache for this creator
    // (byCategory, byStatus, done, etc.) so downstream views — including the
    // Visualizer's `useRequirementsDone` cache (req #2381) — reflect the mutation
    // without waiting for a refetch. Returns a revert fn that restores every
    // snapshot captured before the write.
    //
    // IMPORTANT: call this BEFORE any local-state mutation. requirementsArray and
    // the TanStack cache share object references (useEffect seeds via `[...serverRequirements]`
    // — shallow copy of the array, not the objects), so in-place mutation of a row
    // would poison the snapshot captured here.
    //
    // The updater returns the same `old` reference when no row matches `requirementId`,
    // so unrelated caches (e.g. counts aggregates) don't trigger spurious re-renders.
    const writeThroughRequirementCaches = (requirementId, updates) => {
        const prefix = requirementKeys.all(profile.userName);
        queryClient.cancelQueries({ queryKey: prefix });
        const snapshots = queryClient.getQueriesData({ queryKey: prefix });
        queryClient.setQueriesData({ queryKey: prefix }, (old) => {
            if (!Array.isArray(old)) return old;
            if (!old.some(r => r.id === requirementId)) return old;
            return old.map(r => r.id === requirementId ? { ...r, ...updates } : r);
        });
        return () => {
            for (const [key, data] of snapshots) {
                queryClient.setQueryData(key, data);
            }
        };
    };

    // Status click — items cycle off the selected status leave the card.
    const STATUS_CYCLE = ['authoring', 'approved', 'swarm_ready'];
    const statusClick = (requirementIndex, requirementId) => {
        const currentRow = requirementsArray[requirementIndex];
        const current = currentRow.requirement_status;
        const idx = STATUS_CYCLE.indexOf(current);
        if (idx === -1) return;
        const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
        // req #3244 — every requirement_status write re-derives all three status
        // timestamps, matching darwin-mcp's update_requirement, so this UI path
        // never leaves a stale started_at/completed_at/deferred_at behind. One `now`
        // shared between the PUT body and the local-state form so they can't drift.
        const now = new Date().toISOString();
        const timestampState = requirementStatusTimestampState(next, now);
        const timestampFields = requirementStatusTimestampFields(next, now);
        const previousTimestamps = {
            started_at: currentRow.started_at,
            completed_at: currentRow.completed_at,
            deferred_at: currentRow.deferred_at,
        };

        // Capture cache snapshots BEFORE touching local state (shared refs, see helper comment).
        const revert = writeThroughRequirementCaches(requirementId, { requirement_status: next, ...timestampState });

        call_rest_api(`${darwinUri}/requirements`, 'PUT',
            [{ id: requirementId, requirement_status: next, ...timestampFields }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    revert();
                    setRequirementsArray(prev => prev ? prev.map(r =>
                        r.id === requirementId ? { ...r, requirement_status: current, ...previousTimestamps } : r) : prev);
                    showError(result, 'Unable to change requirement status');
                } else {
                    // Item no longer matches the card's aggregate status — remove it.
                    if (next !== effectiveStatus) {
                        setRequirementsArray(prev => prev ? prev.filter(p => p.id !== requirementId) : prev);
                        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                    }
                }
            }).catch(error => {
                revert();
                setRequirementsArray(prev => prev ? prev.map(r =>
                    r.id === requirementId ? { ...r, requirement_status: current, ...previousTimestamps } : r) : prev);
                showError(error, 'Unable to change requirement status');
            });

        // Immutable local update — new object at the target index rather than in-place
        // mutation on a cache-shared object reference.
        setRequirementsArray(prev => prev ? prev.map((r, i) =>
            i === requirementIndex ? { ...r, requirement_status: next, ...timestampState } : r) : prev);
    };

    // Coordination click — mirrors CategoryCard
    // Autonomy is mandatory (req #2745) — no null/empty state. Cycling a legacy
    // unset requirement (indexOf === -1) advances to the first value, 'discuss'.
    const COORD_CYCLE = ['discuss', 'planned', 'implemented', 'deployed'];
    const coordinationClick = (requirementIndex, requirementId) => {
        const current = requirementsArray[requirementIndex].coordination_type || null;
        const idx = COORD_CYCLE.indexOf(current);
        const next = COORD_CYCLE[(idx + 1) % COORD_CYCLE.length];

        // Capture cache snapshots BEFORE touching local state (shared refs, see helper comment).
        const revert = writeThroughRequirementCaches(requirementId, { coordination_type: next });

        call_rest_api(`${darwinUri}/requirements`, 'PUT',
            [{ id: requirementId, coordination_type: next }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    revert();
                    setRequirementsArray(prev => prev ? prev.map(r =>
                        r.id === requirementId ? { ...r, coordination_type: current } : r) : prev);
                    showError(result, 'Unable to change autonomy');
                }
            }).catch(error => {
                revert();
                setRequirementsArray(prev => prev ? prev.map(r =>
                    r.id === requirementId ? { ...r, coordination_type: current } : r) : prev);
                showError(error, 'Unable to change autonomy');
            });

        setRequirementsArray(prev => prev ? prev.map((r, i) =>
            i === requirementIndex ? { ...r, coordination_type: next } : r) : prev);
    };

    // Title editing — mirrors CategoryCard for existing rows (PUT). For the template
    // row (req #2414) the typed title is handed off to the requirement editor in
    // "new" mode, which forces the user to pick a category before any POST.
    const updateRequirement = (event, requirementIndex, requirementId) => {
        if (!requirementsArray) return;
        const title = requirementsArray[requirementIndex]?.title;
        if (!requirementId || requirementId === '') {
            if (!title || title.trim() === '') return;
            navigate('/swarm/requirement/new', { state: { title } });
            return;
        }
        call_rest_api(`${darwinUri}/requirements`, 'PUT',
            [{ id: requirementId, title }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus > 204) {
                    showError(result, 'Requirement title not updated');
                }
            }).catch(error => showError(error, 'Requirement title not updated'));
    };

    const { fieldChange: titleChange, fieldKeyDown: titleKeyDown, fieldOnBlur: titleOnBlur } = useCrudCallbacks({
        items: requirementsArray || [],
        setItems: setRequirementsArray,
        fieldName: 'title',
        saveFn: updateRequirement,
    });

    const deleteClick = (event, requirementId) => {
        const requirement = requirementsArray?.find(p => p.id === requirementId);
        requirementDelete.openDialog({
            requirementId,
            title: requirement?.title || '',
            coordination_type: requirement?.coordination_type || null,
            requirement_status: requirement?.requirement_status || effectiveStatus,
        });
    };

    // No same-card DnD reordering for a cross-category aggregation card
    const setCrossCardInsertIndex = useCallback(() => {}, []);

    return (
        <Card raised={true}
              data-testid="swarm-start-card"
              sx={{ border: '2px solid transparent' }}>
            {/* req #3064 — CardContent defaults to 16px left/right padding; trimming
                it (-15% left, -33% right) widens the requirement display area. The
                Title column is the row's only `1fr` grid track, so the reclaimed
                space flows straight into it with no other layout change. */}
            <CardContent sx={{ pl: '13.6px', pr: '10.7px' }}>
                <Box className="card-header"
                     sx={{ marginBottom: 2, minHeight: '44px', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                     data-testid="swarm-start-card-status-filter">
                    <Stack direction="row" spacing={1.75} sx={{ flex: 1, flexWrap: 'wrap', rowGap: 0.5, alignItems: 'center' }}>
                        {SWARM_START_STATUSES.map(status => {
                            const selected = status === effectiveStatus;
                            const chipProps = requirementStatusChipProps(status);
                            const count = statusCountMap[status] ?? 0;
                            return (
                                <Badge
                                    key={status}
                                    badgeContent={count}
                                    overlap="rectangular"
                                    showZero={false}
                                    data-testid={`swarm-start-chip-badge-${status}`}
                                    sx={{
                                        '& .MuiBadge-badge': {
                                            fontSize: 10,
                                            height: 16,
                                            minWidth: 16,
                                            padding: '0 4px',
                                            bgcolor: '#241773',
                                            color: '#ffffff',
                                        },
                                    }}
                                >
                                    <Chip
                                        label={requirementStatusLabel(status)}
                                        size="small"
                                        onClick={() => handleChipClick(status)}
                                        {...(selected ? chipProps : { variant: 'outlined' })}
                                        sx={{
                                            ...(selected ? chipProps.sx : {}),
                                            ...(!selected && { opacity: 0.5 }),
                                            cursor: 'pointer',
                                            textTransform: 'capitalize',
                                        }}
                                        data-testid={`swarm-start-chip-${status}`}
                                    />
                                </Badge>
                            );
                        })}
                    </Stack>
                    <IconButton
                        onClick={handleMenuOpen}
                        aria-label="Swarm start card menu"
                        data-testid="swarm-start-card-menu"
                        size="small"
                        sx={{ maxWidth: '25px', maxHeight: '25px' }}
                    >
                        <MoreVertIcon />
                    </IconButton>
                    <Menu
                        anchorEl={menuAnchorEl}
                        open={menuOpen}
                        onClose={handleMenuClose}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                    >
                        <MenuItem onClick={() => changeSortMode(SORT_OLDEST)} data-testid="swarm-start-sort-oldest">
                            <ListItemIcon><ArrowUpwardIcon fontSize="small" /></ListItemIcon>
                            <ListItemText>Oldest first</ListItemText>
                            {effectiveSortMode === SORT_OLDEST && <Check fontSize="small" sx={{ ml: 1 }} />}
                        </MenuItem>
                        <MenuItem onClick={() => changeSortMode(SORT_NEWEST)} data-testid="swarm-start-sort-newest">
                            <ListItemIcon><ArrowDownwardIcon fontSize="small" /></ListItemIcon>
                            <ListItemText>Newest first</ListItemText>
                            {effectiveSortMode === SORT_NEWEST && <Check fontSize="small" sx={{ ml: 1 }} />}
                        </MenuItem>
                    </Menu>
                </Box>

                {requirementsArray === undefined ? (
                    <CircularProgress size={24} />
                ) : (
                    <RequirementActionsContext.Provider value={{
                        statusClick, coordinationClick,
                        titleChange, titleKeyDown, titleOnBlur,
                        deleteClick,
                        requirementsArray,
                        setRequirementsArray,
                        // A SENTINEL, not this card's sort mode (which is
                        // SORT_OLDEST/SORT_NEWEST since req #3302). `RequirementRow`
                        // reads it only to suppress the hand-sort insert indicators,
                        // because the aggregator is not a drop target.
                        sortMode: 'created',
                        setCrossCardInsertIndex,
                        // req #3428 — no row may be dragged out of a filtered
                        // aggregator either. Its rows land on a CategoryCard,
                        // whose drop handler rebuilds `sort_order` from positions
                        // in a list the reader is seeing a subset of.
                        dragDisabled: epicFilterActive,
                        sessionStatusMap,
                        categoryColorMap,
                        strikethroughMet: false, // req #2584 — recent-Met list, not crossed-off
                        // req #3419 — the SAME set the toggle hides by, so every
                        // row on screen that is plan work is marked. Since req
                        // #3502 that is the ONLY thing standing between the
                        // reader and an orchestrated row here, which is what
                        // makes the mark load-bearing rather than decorative.
                        orchestratedIds: visibility.orchestratedIds,
                    }}>
                        {/* req #3286 — THE CARD RENDERS NO MESSAGES. Two used to sit here:
                            the "No <status> requirements" empty state and the req #3180
                            pipelined-exclusion note. Both are gone unconditionally. An empty
                            chip renders an empty card body — chips, rows, the sort menu and
                            the template row are the card.

                            THE NOTE HAS BEEN REMOVED ONCE BEFORE AND CAME BACK, which is why
                            the guard is a test and not a convention: req #3248 deleted it on
                            master (Darwin PR #911, merge 0623939 — verified), and req
                            #3242/#3258's merge (e52da54) restored it on the user's explicit
                            direction, to revisit rather than drop it twice. This is that
                            revisit, and the answer is no message. The empty state is older
                            than both and was never in scope until now.
                            req #3502 removed the card's own launch exclusion entirely
                            (the toggle is now the whole rule — see
                            `swarmStartCardUtils.js`), so there is even less to narrate
                            than there was. Do not reintroduce prose here to explain a
                            filter. */}
                        {requirementsArray.map((requirement, requirementIndex) => (
                            <RequirementRow
                                key={requirement.id}
                                supportDrag={false}
                                requirement={requirement}
                                requirementIndex={requirementIndex}
                                categoryId={requirement.id === '' ? '' : String(requirement.category_fk)}
                                categoryName={requirement.id === '' ? 'aggregator' : ''}
                            />
                        ))}
                    </RequirementActionsContext.Provider>
                )}
            </CardContent>
            <RequirementDeleteDialog
                deleteDialogOpen={requirementDelete.dialogOpen}
                setDeleteDialogOpen={requirementDelete.setDialogOpen}
                setDeleteId={requirementDelete.setInfoObject}
                setDeleteConfirmed={requirementDelete.setConfirmed}
                requirement={requirementDelete.infoObject}
            />
        </Card>
    );
};

export default SwarmStartCard;
