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
import { useRequirementsByStatus, useRequirementsDone, useSessions, useCategoryColors, useAllRequirements, usePipelinedRequirementIds } from '../hooks/useDataQueries';
import { excludePipelined } from '../utils/pipelineMembership';
import { PIPELINE_FILTERED_STATUSES, tallyRequirementStatuses } from './swarmStartCardUtils';
import { requirementKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { RequirementActionsContext } from '../hooks/useRequirementActions';
import { useSwarmStartCardStore } from '../stores/useSwarmStartCardStore';
import { useShowClosedStore } from '../stores/useShowClosedStore';
import { requirementStatusChipProps, requirementStatusLabel } from '../SwarmView/statusChipStyles';
import { requirementStatusTimestampFields, requirementStatusTimestampState } from '../utils/requirementStatusTimestamps';

// Chip statuses shown on this card. Mirrors the requirements page filter chips minus
// 'deferred' and 'wontfix' — both terminal/historical states outside this card's
// "active work" scope ('deferred' retired from the aggregator per req #2584;
// 'wontfix' was never added, same reasoning). 'met' is special-cased: it shows only
// the trailing-24h Met list — recent completions, not the full Met history.
const SWARM_START_STATUSES = ['authoring', 'approved', 'swarm_ready', 'development', 'met'];
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
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import SwapVertIcon from '@mui/icons-material/SwapVert';
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
    const [sortMode, setSortMode] = useState('hand');
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

    // req #3180 — this card OFFERS requirements for a direct swarm-start, so the
    // ones a pipeline step already carries do not belong on its launch chips:
    // their launch is the coordinator's to make, at the point the plan says so.
    //
    // The launch exclusion (PIPELINE_FILTERED_STATUSES) is UNCONDITIONAL — not a
    // user preference. Offering an ineligible launch is a defect, not a viewing
    // choice, so nothing gates it here.
    //
    // The DEVELOPMENT/MET chips are different: both populations are legitimate
    // to browse, same reasoning as the requirements table — so THOSE respect
    // the same global toggle the table and Cards view do (req #3242), on top of
    // (never instead of) the unconditional launch exclusion above.
    const pipelinedIds = usePipelinedRequirementIds(profile?.userName);
    const hidePipelined = useShowClosedStore(s => s.hidePipelinedRequirements);
    const chipOffersLaunch = PIPELINE_FILTERED_STATUSES.includes(effectiveStatus);
    const excludeFromThisChip = chipOffersLaunch || hidePipelined;

    // Memoized because this feeds a useEffect dependency and a useMemo below —
    // `excludePipelined` mints a new array whenever it actually drops something,
    // so an unmemoized call would re-seed local state on every render.
    const eligibleRequirements = React.useMemo(
        () => excludePipelined(serverRequirements, pipelinedIds, excludeFromThisChip),
        [serverRequirements, pipelinedIds, excludeFromThisChip]);

    // The Met chip's own population never went through `eligibleRequirements`
    // (its query is `serverMetRequirements`, not `serverRequirements`) — so the
    // toggle needs its own pass here. `chipOffersLaunch` never applies to Met
    // (it is not in PIPELINE_FILTERED_STATUSES), hence `hidePipelined` alone.
    const eligibleMetRequirements = React.useMemo(
        () => excludePipelined(serverMetRequirements, pipelinedIds, hidePipelined),
        [serverMetRequirements, pipelinedIds, hidePipelined]);

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
    // req #3180 — a launch chip's count applies the SAME rule as its list, from
    // the same Set, so the header can never disagree with the rows beneath it.
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
            allRequirementsForCounts, SWARM_START_STATUSES, pipelinedIds, hidePipelined);
        if (Array.isArray(serverMetRequirements)) {
            counts.met = eligibleMetRequirements?.length ?? serverMetRequirements.length;
        }
        return counts;
    }, [allRequirementsForCounts, serverMetRequirements, eligibleMetRequirements, pipelinedIds, hidePipelined]);

    // Template rows (id === '') always sort last so they stay anchored at the
    // bottom of the card on every re-sort.
    const createdSort = (a, b) => {
        if (a.id === '') return 1;
        if (b.id === '') return -1;
        return a.id - b.id;
    };

    // Met chip sort (req #2613): most-recently-completed first. Rows missing
    // completed_at sink to the end; id DESC tiebreaker so same-instant completions
    // surface the higher (typically newer) id first.
    const metSort = (a, b) => {
        if (a.id === '') return 1;
        if (b.id === '') return -1;
        const aTime = a.completed_at ? new Date(a.completed_at).getTime() : -Infinity;
        const bTime = b.completed_at ? new Date(b.completed_at).getTime() : -Infinity;
        if (aTime !== bTime) return bTime - aTime;
        return b.id - a.id;
    };

    // Seed local state from server data (re-runs on every fetch — including chip switch).
    // After req #2405 removed requirements.sort_order, 'hand' and 'created' sort modes
    // both resolve to id-ascending order; the toggle is retained only for UI continuity
    // and will be removed in a follow-up req.
    useEffect(() => {
        if (!currentRequirements) {
            setRequirementsArray(undefined);
            return;
        }
        const sorted = [...currentRequirements];
        sorted.sort((a, b) => isMet ? metSort(a, b) : createdSort(a, b));
        // Template row (req #2414) — title-only entry; saving is deferred to the
        // requirement editor where the user must pick a category before any POST.
        sorted.push({ id: '', title: '', requirement_status: 'authoring', category_fk: null });
        setRequirementsArray(sorted);
    }, [currentRequirements, isMet]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const changeSortMode = (newMode) => {
        handleMenuClose();
        setSortMode(newMode);
        if (requirementsArray) {
            const sorted = [...requirementsArray];
            sorted.sort((a, b) => isMet ? metSort(a, b) : createdSort(a, b));
            setRequirementsArray(sorted);
        }
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
                        <MenuItem onClick={() => changeSortMode('hand')} data-testid="swarm-start-sort-hand">
                            <ListItemIcon><SwapVertIcon fontSize="small" /></ListItemIcon>
                            <ListItemText>Hand Sort</ListItemText>
                            {sortMode === 'hand' && <Check fontSize="small" sx={{ ml: 1 }} />}
                        </MenuItem>
                        <MenuItem onClick={() => changeSortMode('created')} data-testid="swarm-start-sort-created">
                            <ListItemIcon><AccessTimeIcon fontSize="small" /></ListItemIcon>
                            <ListItemText>Created Sort</ListItemText>
                            {sortMode === 'created' && <Check fontSize="small" sx={{ ml: 1 }} />}
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
                        sortMode: 'created', // suppress insert indicators — no same-card reorder
                        setCrossCardInsertIndex,
                        sessionStatusMap,
                        categoryColorMap,
                        strikethroughMet: false, // req #2584 — recent-Met list, not crossed-off
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
