// SwarmStartCard — cross-category requirement aggregator in the Roadmap view.
//   • Header is a row of status chips (same styling as the Roadmap filter chips).
//   • Single-select: exactly one status is active at a time.
//   • Card shows all requirements with the selected status across all categories.
//   • No template row — "add new" is not supported on this card.
//   • Other interactions (status cycle, coord cycle, title edit, delete) mirror CategoryCard.

import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import RequirementRow from '../SwarmView/RequirementRow';
import RequirementDeleteDialog from '../SwarmView/RequirementDeleteDialog';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useRequirementsByStatus, useSessions, useCategoryColors, useAllRequirements } from '../hooks/useDataQueries';
import { requirementKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { RequirementActionsContext } from '../hooks/useRequirementActions';
import { useSwarmStartCardStore } from '../stores/useSwarmStartCardStore';
import { requirementStatusChipProps, requirementStatusLabel } from '../SwarmView/statusChipStyles';
import { computeCategoryRankMap } from '../SwarmView/processSort';

// Chip statuses shown on this card — same order as the Roadmap filter chips,
// minus 'met' (completed work lives elsewhere — this card aggregates active work).
const SWARM_START_STATUSES = ['authoring', 'approved', 'swarm_ready', 'development', 'deferred'];
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import Check from '@mui/icons-material/Check';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { CircularProgress } from '@mui/material';

const SwarmStartCard = () => {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const selectedStatus = useSwarmStartCardStore(s => s.selectedStatus);
    const setSelectedStatus = useSwarmStartCardStore(s => s.setSelectedStatus);

    const [requirementsArray, setRequirementsArray] = useState();
    const [sessionStatusMap, setSessionStatusMap] = useState({});
    const [sortMode, setSortMode] = useState('hand');
    const [menuAnchorEl, setMenuAnchorEl] = useState(null);
    const menuOpen = Boolean(menuAnchorEl);

    const showError = useSnackBarStore(s => s.showError);

    // Fetch requirements for the currently selected status (global, cross-category).
    const { data: serverRequirements } = useRequirementsByStatus(profile?.userName, selectedStatus);

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

    // Fetch all requirements (open-status only is handled inside computeCategoryRankMap)
    // so each aggregator row can show its 1-based swarm-start position within its origin
    // category — the same N that `/swarm-start <category> <N>` would target.
    const { data: allRequirementsForRanking } = useAllRequirements(profile?.userName, {
        fields: 'id,category_fk,requirement_status,started_at',
    });
    const requirementRankMap = React.useMemo(
        () => computeCategoryRankMap(allRequirementsForRanking),
        [allRequirementsForRanking]
    );

    const createdSort = (a, b) => a.id - b.id;

    // Seed local state from server data (re-runs on every fetch — including chip switch).
    // After req #2405 removed requirements.sort_order, 'hand' and 'created' sort modes
    // both resolve to id-ascending order; the toggle is retained only for UI continuity
    // and will be removed in a follow-up req.
    useEffect(() => {
        if (!serverRequirements) {
            setRequirementsArray(undefined);
            return;
        }
        const sorted = [...serverRequirements];
        sorted.sort((a, b) => createdSort(a, b));
        setRequirementsArray(sorted);
    }, [serverRequirements]); // eslint-disable-line react-hooks/exhaustive-deps

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
            sorted.sort((a, b) => createdSort(a, b));
            setRequirementsArray(sorted);
        }
    };

    const handleChipClick = (status) => {
        if (status === selectedStatus) return;
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
        const current = requirementsArray[requirementIndex].requirement_status;
        const idx = STATUS_CYCLE.indexOf(current);
        if (idx === -1) return;
        const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];

        // Capture cache snapshots BEFORE touching local state (shared refs, see helper comment).
        const revert = writeThroughRequirementCaches(requirementId, { requirement_status: next });

        call_rest_api(`${darwinUri}/requirements`, 'PUT',
            [{ id: requirementId, requirement_status: next }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    revert();
                    setRequirementsArray(prev => prev ? prev.map(r =>
                        r.id === requirementId ? { ...r, requirement_status: current } : r) : prev);
                    showError(result, 'Unable to change requirement status');
                } else {
                    // Item no longer matches the card's aggregate status — remove it.
                    if (next !== selectedStatus) {
                        setRequirementsArray(prev => prev ? prev.filter(p => p.id !== requirementId) : prev);
                        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                    }
                }
            }).catch(error => {
                revert();
                setRequirementsArray(prev => prev ? prev.map(r =>
                    r.id === requirementId ? { ...r, requirement_status: current } : r) : prev);
                showError(error, 'Unable to change requirement status');
            });

        // Immutable local update — new object at the target index rather than in-place
        // mutation on a cache-shared object reference.
        setRequirementsArray(prev => prev ? prev.map((r, i) =>
            i === requirementIndex ? { ...r, requirement_status: next } : r) : prev);
    };

    // Coordination click — mirrors CategoryCard
    const COORD_CYCLE = [null, 'planned', 'implemented', 'deployed'];
    const coordinationClick = (requirementIndex, requirementId) => {
        const current = requirementsArray[requirementIndex].coordination_type || null;
        const idx = COORD_CYCLE.indexOf(current);
        const next = COORD_CYCLE[(idx + 1) % COORD_CYCLE.length];

        // Capture cache snapshots BEFORE touching local state (shared refs, see helper comment).
        const revert = writeThroughRequirementCaches(requirementId, { coordination_type: next });

        call_rest_api(`${darwinUri}/requirements`, 'PUT',
            [{ id: requirementId, coordination_type: next === null ? 'NULL' : next }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    revert();
                    setRequirementsArray(prev => prev ? prev.map(r =>
                        r.id === requirementId ? { ...r, coordination_type: current } : r) : prev);
                    showError(result, 'Unable to change coordination type');
                }
            }).catch(error => {
                revert();
                setRequirementsArray(prev => prev ? prev.map(r =>
                    r.id === requirementId ? { ...r, coordination_type: current } : r) : prev);
                showError(error, 'Unable to change coordination type');
            });

        setRequirementsArray(prev => prev ? prev.map((r, i) =>
            i === requirementIndex ? { ...r, coordination_type: next } : r) : prev);
    };

    // Title editing — mirrors CategoryCard (PUT only, no POST/template)
    const updateRequirement = (event, requirementIndex, requirementId) => {
        if (!requirementId || requirementId === '' || !requirementsArray) return;
        call_rest_api(`${darwinUri}/requirements`, 'PUT',
            [{ id: requirementId, title: requirementsArray[requirementIndex].title }], idToken)
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
            requirement_status: requirement?.requirement_status || selectedStatus,
        });
    };

    // No same-card DnD reordering for a cross-category aggregation card
    const setCrossCardInsertIndex = useCallback(() => {}, []);

    return (
        <Card raised={true}
              data-testid="swarm-start-card"
              sx={{ border: '2px solid transparent' }}>
            <CardContent>
                <Box className="card-header"
                     sx={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                     data-testid="swarm-start-card-status-filter">
                    <Stack direction="row" spacing={0.5} sx={{ flex: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
                        {SWARM_START_STATUSES.map(status => {
                            const selected = status === selectedStatus;
                            const chipProps = requirementStatusChipProps(status);
                            return (
                                <Chip
                                    key={status}
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
                            );
                        })}
                    </Stack>
                    <IconButton
                        onClick={handleMenuOpen}
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
                ) : requirementsArray.length === 0 ? (
                    <Typography variant="body2" sx={{ color: 'text.disabled', p: 1 }}>
                        No {requirementStatusLabel(selectedStatus).toLowerCase()} requirements
                    </Typography>
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
                        requirementRankMap,
                    }}>
                        {requirementsArray.map((requirement, requirementIndex) => (
                            <RequirementRow
                                key={requirement.id}
                                supportDrag={false}
                                requirement={requirement}
                                requirementIndex={requirementIndex}
                                categoryId={String(requirement.category_fk)}
                                categoryName=""
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
