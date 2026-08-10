// SwarmStartCard — cross-category requirement aggregator in the requirement view.
//   • Header is a row of status chips (same styling as the requirements page filter chips).
//   • Single-select: exactly one status is active at a time.
//   • Card shows all requirements with the selected status across all categories,
//     MINUS the ones a pipeline step carries (req #3180 — see below).
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
import { filterKeepingIdentity } from '../utils/pipelineMembership';
import { aggregatorRowVisible, tallyRequirementStatuses } from './swarmStartCardUtils';
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

const SwarmStartCard = () => {
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

    // Persisted-store fallback — req #2584 retired 'deferred' from this card. Users
    // with a now-invalid persisted value get re-pointed at the default. `effectiveStatus`
    // is computed synchronously so the hook calls below never fire against the stale
    // value (otherwise we'd pay one wasted fetch for 'deferred' before the useEffect ran).
    const effectiveStatus = SWARM_START_STATUSES.includes(selectedStatus) ? selectedStatus : 'swarm_ready';
    useEffect(() => {
        if (selectedStatus !== effectiveStatus) {
            setSelectedStatus(effectiveStatus);
        }
    }, [selectedStatus, effectiveStatus, setSelectedStatus]);

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

    // req #3180 / #3419 — this card OFFERS requirements for a direct
    // swarm-start, and it is also a browse surface. Both rules live in ONE place
    // (`aggregatorRowVisible`), and the chip badges below apply the very same
    // predicate, so a count can never disagree with the rows under it.
    const visibility = useRequirementVisibility(profile?.userName);

    // Memoized AND identity-preserving, and both halves are load-bearing.
    // `eligibleRequirements` is a dependency of the seeding `useEffect` below,
    // which calls `setRequirementsArray` — so an array that changes identity on
    // every render is not wasted work, it is a synchronous render loop. A bare
    // `.filter` does exactly that whenever anything upstream churns (a query
    // hook handing back a fresh `[]`, say). `filterKeepingIdentity` returns the
    // INPUT when it drops nothing, which is what absorbed that churn before req
    // #3419 — see its docstring.
    const rowVisible = React.useMemo(
        () => aggregatorRowVisible(effectiveStatus, visibility),
        [effectiveStatus, visibility]);

    const eligibleRequirements = React.useMemo(
        () => filterKeepingIdentity(serverRequirements, rowVisible),
        [serverRequirements, rowVisible]);

    // The Met chip's own population never goes through `eligibleRequirements`
    // (its query is `serverMetRequirements`, not `serverRequirements`) — so it
    // needs its own pass, under the Met chip's own rule.
    const metRowVisible = React.useMemo(
        () => aggregatorRowVisible('met', visibility),
        [visibility]);

    const eligibleMetRequirements = React.useMemo(
        () => filterKeepingIdentity(serverMetRequirements, metRowVisible),
        [serverMetRequirements, metRowVisible]);

    // The array that drives the card body for the currently selected chip.
    const currentRequirements = isMet ? eligibleMetRequirements : eligibleRequirements;

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

    // Fetch all requirements across categories — powers the per-status counts below.
    const { data: allRequirementsForCounts } = useAllRequirements(profile?.userName, {
        fields: 'id,requirement_status',
    });

    // Count requirements per status across all categories (req #2549). Reuses the
    // same useAllRequirements query — no extra fetch.
    // The 'met' count is overlaid from the trailing-24h Met query (req #2584), since
    // useAllRequirements doesn't carry completed_at and can't be filtered to the
    // 24-hour window here. Returns { authoring, approved, swarm_ready, development, met }.
    //
    // req #3180 / #3419 — a chip's count applies the SAME rule as its list, from
    // the SAME function (`aggregatorRowVisible`), so the header can never
    // disagree with the rows beneath it.
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
    const statusCountMap = React.useMemo(() => {
        const { counts } = tallyRequirementStatuses(
            allRequirementsForCounts, SWARM_START_STATUSES, visibility);
        if (Array.isArray(serverMetRequirements)) {
            counts.met = eligibleMetRequirements?.length ?? serverMetRequirements.length;
        }
        return counts;
    }, [allRequirementsForCounts, serverMetRequirements, eligibleMetRequirements, visibility]);

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
        setRequirementsArray(prev => {
            const prevTemplate = prev && prev.find(r => r.id === '');
            return [...sorted, prevTemplate
                ?? { id: '', title: '', requirement_status: 'authoring', category_fk: null }];
        });
    }, [currentRequirements, effectiveSortMode]); // eslint-disable-line react-hooks/exhaustive-deps

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
                        sessionStatusMap,
                        categoryColorMap,
                        strikethroughMet: false, // req #2584 — recent-Met list, not crossed-off
                        // req #3419 — the SAME set the toggle hides by, so a row
                        // that survives this card's own launch exclusion is still
                        // marked when it is plan work.
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
                            The EXCLUSION ITSELF IS UNCHANGED: see `excludeFromThisChip` above.
                            Do not reintroduce prose here to explain a filter. */}
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
