import React, { useState, useEffect, useContext, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { STATUS_SORT_PROCESS, processSort, processSortReverse } from './processSort';
import RequirementRow from './RequirementRow';
import RequirementDeleteDialog from './RequirementDeleteDialog';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useRequirements, useSessions } from '../hooks/useDataQueries';
import { requirementKeys, categoryKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { useShowClosedStore } from '../stores/useShowClosedStore';
import { RequirementActionsContext } from '../hooks/useRequirementActions';

import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';
import { useDrop, useDrag } from "react-dnd";

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Check from '@mui/icons-material/Check';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import CloseIcon from '@mui/icons-material/Close';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import { CircularProgress } from '@mui/material';

const createdSort = (a, b) => {
    if (a.id === '') return 1;
    if (b.id === '') return -1;
    return a.id - b.id;
};

const CategoryCard = ({category, categoryIndex, projectId, categoryChange, categoryKeyDown, categoryOnBlur, clickCardClosed, clickCardDelete, moveCard, persistCategoryOrder, removeCategory, isTemplate, showClosed }) => {

    const revertDragTabSwitch = useSwarmTabStore(s => s.revertDragTabSwitch);

    const navigate = useNavigate();
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [requirementsArray, setRequirementsArray] = useState()
    const [sessionStatusMap, setSessionStatusMap] = useState({});

    const savingRef = useRef(false);
    const pendingMutationsRef = useRef({});
    const sortModePendingRef = useRef(false);
    const sortModeMutationRef = useRef(0);

    const requirementStatusFilter = useShowClosedStore(s => s.requirementStatusFilter);

    const showError = useSnackBarStore(s => s.showError);

    const requirementDelete = useConfirmDialog({
        onConfirm: ({ requirementId }) => {
            let uri = `${darwinUri}/requirements`;
            call_rest_api(uri, 'DELETE', {'id': requirementId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newRequirementsArray = [...requirementsArray]
                        newRequirementsArray = newRequirementsArray.filter(p => p.id !== requirementId );
                        setRequirementsArray(newRequirementsArray);
                        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to delete requirement')
                    }
                }).catch(error => {
                    showError(error, 'Unable to delete requirement')
                });
        }
    });

    // Legacy categories may have sort_mode='created' — treat anything other than
    // 'hand' / 'reverse' as 'process'. Three live values: 'hand' | 'process' | 'reverse'.
    const [sortMode, setSortMode] = useState(
        category.sort_mode === 'hand'
            ? 'hand'
            : category.sort_mode === 'reverse' ? 'reverse' : 'process'
    );

    // Status Sort menu item toggles direction when already active: process ↔ reverse.
    // Hand Sort menu item always sets 'hand' directly.
    const changeSortMode = (event, requestedMode) => {
        if (requestedMode === null) return;
        // Block while a previous sort-mode PUT is still in flight — cancelQueries only cancels
        // background refetches, not the mutation itself. Without this guard, two concurrent PUTs
        // race and the server may commit the older value.
        if (sortModePendingRef.current) return;

        // When caller requests 'process' but Status Sort is already in 'process',
        // flip to 'reverse'. When already in 'reverse', flip back to 'process'.
        // 'hand' is always a direct set.
        let newMode = requestedMode;
        if (requestedMode === 'process') {
            if (sortMode === 'process') newMode = 'reverse';
            else if (sortMode === 'reverse') newMode = 'process';
            // else sortMode is 'hand' → newMode stays 'process'
        }
        if (newMode === sortMode) return;  // no-op (shouldn't happen but safe)

        setSortMode(newMode);

        if (requirementsArray) {
            const sortFn = newMode === 'hand'
                ? createdSort
                : newMode === 'reverse' ? processSortReverse : processSort;
            const sorted = [...requirementsArray];
            sorted.sort((a, b) => sortFn(a, b));
            setRequirementsArray(sorted);
        }

        if (category.id !== '') {
            // Optimistically update both possible categories cache entries so the new sort_mode
            // survives unmount/remount (e.g. navigating into RequirementDetail and back).
            //
            // Maintenance note: `useQueryKeys.js` also defines `categoryKeys.byProject` (no `closed`
            // filter — effectively `closed=1` only). That key has zero live subscribers today;
            // no caller of `useCategories` passes `closed=1`. If a future "closed categories" view
            // is added, update BOTH (a) the `cancelQueries` calls below and (b) the `setQueryData`
            // optimistic writes below to include `categoryKeys.byProject(...)` alongside
            // `byProjectOpen` / `byProjectWithClosed`.
            const openKey = categoryKeys.byProjectOpen(profile.userName, projectId);
            const allKey  = categoryKeys.byProjectWithClosed(profile.userName, projectId);
            queryClient.cancelQueries({ queryKey: openKey });
            queryClient.cancelQueries({ queryKey: allKey });
            const previousOpen = queryClient.getQueryData(openKey);
            const previousAll  = queryClient.getQueryData(allKey);
            const updateCache = (old) => {
                if (!Array.isArray(old)) return old;
                return old.map(c => c.id === category.id ? { ...c, sort_mode: newMode } : c);
            };
            queryClient.setQueryData(openKey, updateCache);
            queryClient.setQueryData(allKey, updateCache);

            // Defense-in-depth rollback guard: even with sortModePendingRef blocking
            // concurrent entry, a monotonic mutation id on rollback protects the cache
            // if the pending guard is ever bypassed or removed. Skip rollback + toast
            // when a newer invocation has superseded this one (req #2202).
            const mutationId = ++sortModeMutationRef.current;
            const rollback = (errorArg, message) => {
                if (sortModeMutationRef.current !== mutationId) return;
                queryClient.setQueryData(openKey, previousOpen);
                queryClient.setQueryData(allKey, previousAll);
                const prior = category.sort_mode === 'hand'
                    ? 'hand'
                    : category.sort_mode === 'reverse' ? 'reverse' : 'process';
                setSortMode(prior);
                showError(errorArg, message);
            };

            sortModePendingRef.current = true;
            call_rest_api(`${darwinUri}/categories`, 'PUT', [{ id: category.id, sort_mode: newMode }], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        rollback(result, 'Unable to save sort preference');
                    }
                    sortModePendingRef.current = false;
                })
                .catch(error => {
                    rollback(error, 'Unable to save sort preference');
                    sortModePendingRef.current = false;
                });
        }
    };

    const [menuAnchorEl, setMenuAnchorEl] = useState(null);
    const menuOpen = Boolean(menuAnchorEl);
    const handleMenuOpen = (event) => setMenuAnchorEl(event.currentTarget);
    const handleMenuClose = () => setMenuAnchorEl(null);

    // TanStack Query — fetch all requirements for this category (client-side filtering via chips)
    const { data: serverRequirements } = useRequirements(profile?.userName, category.id, {
        enabled: category.id !== '',
    });

    // TanStack Query — fetch sessions for status badges
    const { data: serverSessions } = useSessions(profile?.userName, {
        enabled: category.id !== '',
    });

    // Seed local state from query data (hybrid pattern — local state owns template row)
    useEffect(() => {
        if (serverRequirements && serverRequirements.length > 0) {
            let sortedRequirementsArray = [...serverRequirements];

            // Client-side filtering based on requirement status chips (direct match)
            sortedRequirementsArray = sortedRequirementsArray.filter(p =>
                requirementStatusFilter.includes(p.requirement_status)
            );

            sortedRequirementsArray.sort((a, b) => activeSort(a, b));
            sortedRequirementsArray.push({'id':'', 'title':'', 'requirement_status': 'authoring', 'category_fk': parseInt(category.id) });
            setRequirementsArray(sortedRequirementsArray);
        } else if (serverRequirements && serverRequirements.length === 0) {
            let sortedRequirementsArray = [];
            sortedRequirementsArray.push({'id':'', 'title':'', 'requirement_status': 'authoring', 'category_fk': parseInt(category.id) });
            setRequirementsArray(sortedRequirementsArray);
        }
    }, [serverRequirements, requirementStatusFilter]);

    // Build session status map from query data
    useEffect(() => {
        if (serverSessions && serverSessions.length > 0) {
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
            // Flatten to string values for consumers (RequirementRow)
            const flatMap = {};
            for (const [k, v] of Object.entries(map)) {
                flatMap[k] = v.swarm_status;
            }
            setSessionStatusMap(flatMap);
        }
    }, [serverSessions]);

    // For template cards (category.id === ''), keep requirementsArray undefined
    useEffect(() => {
        if (category.id === '' && !requirementsArray) {
            setRequirementsArray(undefined);
        }
    }, [category.id]);

    const [{ isOver }, drop] = useDrop(() => ({

        accept: "categoryCard",

        drop: (item) => {
            if (item.sourceDomainId && item.sourceDomainId !== projectId) {
                return { crossDomain: true };
            }
        },

        hover: (item, monitor) => {
            if (monitor.getItemType() !== "categoryCard") return;
            if (item.domainId !== projectId) return;
            if (isTemplate) return;
            const dragIndex = item.areaIndex;
            const hoverIndex = categoryIndex;
            if (dragIndex === hoverIndex) {
                item.settled = true;
                return;
            }

            if (item.movePending) return;
            if (item.settled === false) return;

            moveCard(dragIndex, hoverIndex);
            item.areaIndex = hoverIndex;
            item.settled = false;

            item.movePending = true;
            setTimeout(() => {
                item.movePending = false;
            }, 150);
        },

        collect: (monitor) => ({
            isOver: monitor.isOver() && monitor.getItemType() === "categoryCard",
        }),

    }), [categoryIndex, projectId, isTemplate, moveCard]);

    const [{ isDragging }, drag] = useDrag(() => ({
        type: "categoryCard",
        item: () => ({ areaId: category.id, areaIndex: categoryIndex, domainId: projectId, areaData: { ...category } }),
        canDrag: () => !isTemplate,
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
        end: (item, monitor) => {
            const dropResult = monitor.getDropResult();
            if (dropResult && dropResult.crossDomain) {
                if (item.persistInTarget) item.persistInTarget();
                removeCategory(item.areaId);
            } else {
                if (item.removeFromTarget) item.removeFromTarget();
                persistCategoryOrder(monitor.didDrop());
                revertDragTabSwitch();
            }
        },
    }), [category, categoryIndex, projectId, isTemplate, persistCategoryOrder, removeCategory, revertDragTabSwitch]);

    const cardRef = useRef(null);
    const mergedRef = useCallback((node) => {
        cardRef.current = node;
        drag(drop(node));
    }, [drag, drop]);

    // Optimistically apply `updates` to every requirement cache for this creator
    // (byCategory, byStatus, done, etc.) so downstream views — including the
    // Visualizer's `useRequirementsDone` cache (req #2381) — reflect the mutation
    // without waiting for a refetch. Returns a revert fn that restores every
    // snapshot captured before the write.
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

    const STATUS_CYCLE = ['authoring', 'approved', 'swarm_ready'];
    const statusClick = (requirementIndex, requirementId) => {
        const current = requirementsArray[requirementIndex].requirement_status;
        const idx = STATUS_CYCLE.indexOf(current);
        if (idx === -1) return; // not a cycleable status (development/met/deferred)
        const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];

        if (requirementId !== '') {
            // Optimistic write-through across every requirement cache (req #2381).
            // Snapshot BEFORE any local-state mutation: requirementsArray and the cache
            // share object references (useEffect seeds from serverRequirements via shallow
            // copy), so in-place mutation would poison the snapshot.
            const revert = writeThroughRequirementCaches(requirementId, { requirement_status: next });

            let uri = `${darwinUri}/requirements`;
            call_rest_api(uri, 'PUT', [{'id': requirementId, 'requirement_status': next}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        revert();
                        setRequirementsArray(prev => prev.map(r =>
                            r.id === requirementId ? { ...r, requirement_status: current } : r));
                        showError(result, "Unable to change requirement status");
                    }
                }).catch(error => {
                    revert();
                    setRequirementsArray(prev => prev.map(r =>
                        r.id === requirementId ? { ...r, requirement_status: current } : r));
                    showError(error, "Unable to change requirement status");
                });
        } else if (savingRef.current) {
            pendingMutationsRef.current.requirement_status = next;
        }
        // Immutable update — new object at the target index rather than in-place mutation
        // on a cache-shared object reference (see snapshot comment above).
        setRequirementsArray(prev => prev.map((r, i) =>
            i === requirementIndex ? { ...r, requirement_status: next } : r));
    }

    const COORD_CYCLE = [null, 'planned', 'implemented', 'deployed'];
    const coordinationClick = (requirementIndex, requirementId) => {
        const current = requirementsArray[requirementIndex].coordination_type || null;
        const idx = COORD_CYCLE.indexOf(current);
        const next = COORD_CYCLE[(idx + 1) % COORD_CYCLE.length];

        if (requirementId !== '') {
            // Write-through to every requirement cache (req #2381) — see statusClick
            // for snapshot-ordering rationale.
            const revert = writeThroughRequirementCaches(requirementId, { coordination_type: next });

            let uri = `${darwinUri}/requirements`;
            call_rest_api(uri, 'PUT', [{'id': requirementId, 'coordination_type': next === null ? 'NULL' : next}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        revert();
                        setRequirementsArray(prev => prev.map(r =>
                            r.id === requirementId ? { ...r, coordination_type: current } : r));
                        showError(result, "Unable to change coordination type");
                    }
                }).catch(error => {
                    revert();
                    setRequirementsArray(prev => prev.map(r =>
                        r.id === requirementId ? { ...r, coordination_type: current } : r));
                    showError(error, "Unable to change coordination type");
                });
        } else if (savingRef.current) {
            pendingMutationsRef.current.coordination_type = next === null ? 'NULL' : next;
        }
        setRequirementsArray(prev => prev.map((r, i) =>
            i === requirementIndex ? { ...r, coordination_type: next } : r));
    }

    const updateRequirement = (event, requirementIndex, requirementId) => {

        const noop = ()=>{};

        if ((requirementId === '') &&
            (requirementsArray[requirementIndex].title === '')) {
            noop();
        } else {
            if (requirementId === '') {
                saveRequirement(event, requirementIndex)
            } else {
                let uri = `${darwinUri}/requirements`;
                call_rest_api(uri, 'PUT', [{'id': requirementId, 'title': requirementsArray[requirementIndex].title}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 204) {
                            showError(result, 'Requirement title not updated, HTTP error')
                        }
                    }).catch(error => {
                        showError(error, 'Requirement title not updated, HTTP error')
                    });
            }
        }
    }

    const { fieldChange: titleChange, fieldKeyDown: titleKeyDown, fieldOnBlur: titleOnBlur } = useCrudCallbacks({
        items: requirementsArray, setItems: setRequirementsArray, fieldName: 'title', saveFn: updateRequirement
    });

    const saveRequirement = (event, requirementIndex) => {
        if (savingRef.current) return;
        savingRef.current = true;

        const requirementToSave = { ...requirementsArray[requirementIndex], project_fk: null };

        let uri = `${darwinUri}/requirements`;
        call_rest_api(uri, 'POST', requirementToSave, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    let newRequirementsArray = [...requirementsArray];
                    newRequirementsArray[requirementIndex] = {...result.data[0]};

                    const pending = pendingMutationsRef.current;
                    if (Object.keys(pending).length > 0) {
                        Object.assign(newRequirementsArray[requirementIndex], pending);
                        call_rest_api(uri, 'PUT', [{'id': result.data[0].id, ...pending}], idToken)
                            .then(putResult => {
                                if (putResult.httpStatus.httpStatus !== 200 && putResult.httpStatus.httpStatus !== 204) {
                                    showError(putResult, 'Unable to update requirement after save');
                                }
                            }).catch(putError => {
                                showError(putError, 'Unable to update requirement after save');
                            });
                    }

                    newRequirementsArray.sort((a, b) => activeSort(a, b));
                    newRequirementsArray.push({'id':'', 'title':'', 'requirement_status': 'authoring', 'category_fk': category.id });
                    setRequirementsArray(newRequirementsArray);
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                    navigate(`/swarm/requirement/${result.data[0].id}`);
                } else if (result.httpStatus.httpStatus === 201) {
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                } else {
                    showError(result, 'Requirement not saved, HTTP error')
                }
            }).catch(error => {
                showError(error, 'Requirement not saved, HTTP error')
            }).finally(() => {
                savingRef.current = false;
                pendingMutationsRef.current = {};
            });
    }

    const deleteClick = (event, requirementId) => {
        const requirement = requirementsArray?.find(p => p.id === requirementId);
        requirementDelete.openDialog({
            requirementId,
            title: requirement?.title || '',
            coordination_type: requirement?.coordination_type || null,
            requirement_status: requirement?.requirement_status || 'authoring',
        });
    }

    // STATUS_SORT_PROCESS, processSort, processSortReverse imported from ./processSort

    const STATUS_SORT = { authoring: 0, approved: 0, swarm_ready: 0, development: 0, deferred: 1, met: 2 };

    const activeSort = (a, b) => {
        if (a.id === '') return 1;
        if (b.id === '') return -1;
        if (sortMode === 'process') return processSort(a, b);
        if (sortMode === 'reverse') return processSortReverse(a, b);
        // Three-group sort: active (0) < deferred (1) < met (2)
        const aState = STATUS_SORT[a.requirement_status] ?? 0;
        const bState = STATUS_SORT[b.requirement_status] ?? 0;
        if (aState !== bState) return aState - bState;
        if (a.requirement_status === 'met' && b.requirement_status === 'met') {
            const aTime = a.completed_at ? new Date(a.completed_at).getTime() : 0;
            const bTime = b.completed_at ? new Date(b.completed_at).getTime() : 0;
            if (aTime !== bTime) return bTime - aTime;  // most recent first
        }
        if (a.requirement_status === 'deferred' && b.requirement_status === 'deferred') {
            const aTime = a.deferred_at ? new Date(a.deferred_at).getTime() : 0;
            const bTime = b.deferred_at ? new Date(b.deferred_at).getTime() : 0;
            if (aTime !== bTime) return bTime - aTime;  // most recent first
        }
        return a.id - b.id;  // hand / default: natural id order (req #2405)
    }

    return (
        <Card key={categoryIndex} raised={true} ref={mergedRef}
              data-testid={category.id === '' ? 'category-card-template' : `category-card-${category.id}`}
              sx={{
                  opacity: isDragging ? 0.3 : category._isAdopted ? 0.5 : 1,
                  cursor: isTemplate ? 'default' : 'grab',
                  border: isOver && !isDragging ? '2px solid' : '2px solid transparent',
                  borderColor: isOver && !isDragging ? 'primary.main' : 'transparent',
              }}>
            <CardContent>
                <Box className="card-header" sx={{marginBottom: 2}}>
                    <TextField
                                variant="standard"
                                value={category.category_name || ''}
                                name='category-name'
                                placeholder={category.id === '' ? 'Add new category' : undefined}
                                onChange= { (event) => categoryChange(event, categoryIndex) }
                                onKeyDown = {(event) => categoryKeyDown(event, categoryIndex, category.id)}
                                onBlur = {(event) => categoryOnBlur(event, categoryIndex, category.id)}
                                multiline
                                autoComplete='off'
                                size = 'small'
                                sx={{
                                    ...(category.color && { borderLeft: `4px solid ${category.color}`, pl: 1 }),
                                }}
                                slotProps={{
                                    input: {...((category.id !== '') ? {disableUnderline: true} : (category.category_name !== '') && {disableUnderline: true} ), style: {fontSize: 24}},
                                    htmlInput: { maxLength: 128 }
                                }}
                                key={`category-${category.id}`}
                     />
                    {category.id !== '' && (
                        <>
                            <IconButton
                                onClick={handleMenuOpen}
                                data-testid={`card-menu-${category.id}`}
                                size="small"
                                sx={{ maxWidth: "25px", maxHeight: "25px" }}
                            >
                                <MoreVertIcon />
                            </IconButton>
                            <Menu
                                anchorEl={menuAnchorEl}
                                open={menuOpen}
                                onClose={handleMenuClose}
                                data-testid={`card-menu-popup-${category.id}`}
                                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                            >
                                <MenuItem
                                    onClick={(event) => { handleMenuClose(); changeSortMode(event, 'process'); }}
                                    data-testid={`sort-process-${category.id}`}
                                >
                                    <ListItemIcon><AccountTreeIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>Status Sort</ListItemText>
                                    {sortMode === 'process' && (
                                        <ArrowUpwardIcon
                                            fontSize="small"
                                            sx={{ ml: 1 }}
                                            data-testid={`sort-direction-asc-${category.id}`}
                                        />
                                    )}
                                    {sortMode === 'reverse' && (
                                        <ArrowDownwardIcon
                                            fontSize="small"
                                            sx={{ ml: 1 }}
                                            data-testid={`sort-direction-desc-${category.id}`}
                                        />
                                    )}
                                </MenuItem>
                                <MenuItem
                                    onClick={(event) => { handleMenuClose(); changeSortMode(event, 'hand'); }}
                                    data-testid={`sort-hand-${category.id}`}
                                >
                                    <ListItemIcon><SwapVertIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>Hand Sort</ListItemText>
                                    {sortMode === 'hand' && <Check fontSize="small" sx={{ ml: 1 }} />}
                                </MenuItem>
                                <Divider />
                                <MenuItem
                                    onClick={(event) => { handleMenuClose(); clickCardClosed(event, category.category_name, category.id); }}
                                    data-testid={`menu-close-category-${category.id}`}
                                >
                                    <ListItemIcon><CloseIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>Close Category</ListItemText>
                                </MenuItem>
                                <Divider />
                                <MenuItem
                                    onClick={(event) => {
                                        handleMenuClose();
                                        const requirementCount = requirementsArray ? requirementsArray.filter(t => t.id !== '').length : 0;
                                        clickCardDelete(event, category.category_name, category.id, requirementCount);
                                    }}
                                    data-testid={`menu-delete-category-${category.id}`}
                                    sx={{ color: 'error.main' }}
                                >
                                    <ListItemIcon><DeleteForeverIcon fontSize="small" sx={{ color: 'error.main' }} /></ListItemIcon>
                                    <ListItemText>Delete Category</ListItemText>
                                </MenuItem>
                            </Menu>
                        </>
                    )}
                </Box>
                { (requirementsArray) ?
                    <RequirementActionsContext.Provider value={{ statusClick, coordinationClick,
                        titleChange, titleKeyDown, titleOnBlur, deleteClick, requirementsArray, setRequirementsArray,
                        sessionStatusMap }}>
                        {requirementsArray.map((requirement, requirementIndex) => (
                            <RequirementRow {...{key: requirement.id, requirement, requirementIndex,
                                categoryId: category.id, categoryName: category.category_name }}
                            />
                        ))}
                    </RequirementActionsContext.Provider>
                  :
                    category.id  === '' ? '' : <CircularProgress/>
                }
            </CardContent>
            <RequirementDeleteDialog deleteDialogOpen = {requirementDelete.dialogOpen}
                              setDeleteDialogOpen = {requirementDelete.setDialogOpen}
                              setDeleteId = {requirementDelete.setInfoObject}
                              setDeleteConfirmed = {requirementDelete.setConfirmed}
                              requirement = {requirementDelete.infoObject} />
        </Card>
    )
}

export default CategoryCard
