import React, { useState, useEffect, useContext, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import RequirementRow from './RequirementRow';
import RequirementDeleteDialog from './RequirementDeleteDialog';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useRequirements, useSessions } from '../hooks/useDataQueries';
import { requirementKeys } from '../hooks/useQueryKeys';
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
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import { CircularProgress } from '@mui/material';


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

    const requirementStatusFilter = useShowClosedStore(s => s.requirementStatusFilter);

    const [sortMode, setSortMode] = useState(category.sort_mode || 'hand');

    const changeSortMode = (event, newMode) => {
        if (newMode === null) return;
        setSortMode(newMode);

        if (requirementsArray) {
            const sortFn = newMode === 'hand' ? requirementHandSort : createdSort;
            const sorted = [...requirementsArray];
            sorted.sort((a, b) => sortFn(a, b));
            setRequirementsArray(sorted);
        }

        if (category.id !== '') {
            call_rest_api(`${darwinUri}/categories`, 'PUT', [{ id: category.id, sort_mode: newMode }], idToken)
                .catch(error => showError(error, 'Unable to save sort preference'));
        }
    };

    const [menuAnchorEl, setMenuAnchorEl] = useState(null);
    const menuOpen = Boolean(menuAnchorEl);
    const handleMenuOpen = (event) => setMenuAnchorEl(event.currentTarget);
    const handleMenuClose = () => setMenuAnchorEl(null);

    const crossCardInsertIndexRef = useRef(null);
    const setCrossCardInsertIndex = useCallback((index) => {
        crossCardInsertIndexRef.current = index;
    }, []);

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

    // TanStack Query — fetch all requirements for this category (client-side filtering via chips)
    const { data: serverRequirements } = useRequirements(profile?.userName, category.id, {
        enabled: category.id !== '',
    });

    // TanStack Query — fetch sessions for status badges
    const { data: serverSessions } = useSessions(profile?.userName, {
        enabled: category.id !== '',
    });

    // Seed local state from query data (hybrid pattern — local state owns DnD + template)
    useEffect(() => {
        if (serverRequirements && serverRequirements.length > 0) {
            let sortedRequirementsArray = [...serverRequirements];

            // Lazy fill: if any requirement has null sort_order, assign sequential values
            const needsFill = sortedRequirementsArray.some(t => t.sort_order === null || t.sort_order === undefined);
            if (needsFill) {
                sortedRequirementsArray.sort((a, b) => createdSort(a, b));
                const bulkUpdate = [];
                sortedRequirementsArray.forEach((t, idx) => {
                    t.sort_order = idx;
                    bulkUpdate.push({ id: t.id, sort_order: idx });
                });
                let uri = `${darwinUri}/requirements`;
                call_rest_api(uri, 'PUT', bulkUpdate, idToken).catch(() => {});
            }

            // Client-side filtering based on requirement status chips (direct match)
            sortedRequirementsArray = sortedRequirementsArray.filter(p =>
                requirementStatusFilter.includes(p.requirement_status)
            );

            sortedRequirementsArray.sort((a, b) => activeSort(a, b));
            sortedRequirementsArray.push({'id':'', 'title':'', 'requirement_status': 'authoring', 'scheduled': 0, 'category_fk': parseInt(category.id), 'sort_order': null });
            setRequirementsArray(sortedRequirementsArray);
        } else if (serverRequirements && serverRequirements.length === 0) {
            let sortedRequirementsArray = [];
            sortedRequirementsArray.push({'id':'', 'title':'', 'requirement_status': 'authoring', 'scheduled': 0, 'category_fk': parseInt(category.id), 'sort_order': null });
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

        accept: ["requirementRow", "categoryCard"],

        drop: (item, monitor) => {
            if (monitor.getItemType() === "requirementRow") {
                return addRequirementToCategory(item);
            }
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

    }), [requirementsArray, categoryIndex, projectId, isTemplate, moveCard]);

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

    const addRequirementToCategory = (requirement) => {

        const insertIndex = crossCardInsertIndexRef.current;
        crossCardInsertIndexRef.current = null;

        // Same-card drop
        let matchRequirement = requirementsArray.find( p => p.id === requirement.id)

        if (matchRequirement !== undefined) {
            if (sortMode === 'hand' && insertIndex !== null) {
                const draggedIdx = requirementsArray.findIndex(t => t.id === requirement.id);
                if (draggedIdx === -1) return { requirement: null };

                const adjustedIndex = insertIndex > draggedIdx ? insertIndex - 1 : insertIndex;
                if (adjustedIndex === draggedIdx) return { requirement: null };

                const updated = [...requirementsArray];
                const [moved] = updated.splice(draggedIdx, 1);
                updated.splice(adjustedIndex, 0, moved);

                const bulkUpdate = [];
                updated.forEach((t, idx) => {
                    if (t.id !== '') {
                        t.sort_order = idx;
                        bulkUpdate.push({ id: t.id, sort_order: idx });
                    }
                });

                let requirementUri = `${darwinUri}/requirements`;
                call_rest_api(requirementUri, 'PUT', bulkUpdate, idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                            showError(result, 'Unable to save requirement sort order');
                        }
                    }).catch(error => {
                        showError(error, 'Unable to save requirement sort order');
                    });

                setRequirementsArray(updated);
            }
            return { requirement: null };
        }

        // Cross-card drop
        let requirementUri = `${darwinUri}/requirements`;

        // Optimistic cache update — prevent TanStack refetches from overwriting local state
        const sourceKey = requirementKeys.byCategoryWithClosed(profile.userName, requirement.category_fk);
        const targetKey = requirementKeys.byCategoryWithClosed(profile.userName, category.id);
        queryClient.cancelQueries({ queryKey: sourceKey });
        queryClient.cancelQueries({ queryKey: targetKey });
        const previousSource = queryClient.getQueryData(sourceKey);
        const previousTarget = queryClient.getQueryData(targetKey);
        queryClient.setQueryData(sourceKey, (old) => old ? old.filter(p => p.id !== requirement.id) : old);

        if (sortMode === 'hand' && insertIndex !== null) {
            const realRequirements = requirementsArray.filter(t => t.id !== '');
            const template = requirementsArray.find(t => t.id === '');
            const clampedIndex = Math.min(insertIndex, realRequirements.length);
            realRequirements.splice(clampedIndex, 0, {...requirement, category_fk: parseInt(category.id)});

            const bulkUpdate = realRequirements.map((t, idx) => {
                t.sort_order = idx;
                const update = { id: t.id, sort_order: idx };
                if (t.id === requirement.id) update.category_fk = parseInt(category.id);
                return update;
            });

            queryClient.setQueryData(targetKey, () => realRequirements.map(p => ({...p})));

            call_rest_api(requirementUri, 'PUT', bulkUpdate, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        queryClient.setQueryData(sourceKey, previousSource);
                        queryClient.setQueryData(targetKey, previousTarget);
                        showError(result, "Unable to save requirement order");
                    }
                }).catch(error => {
                    queryClient.setQueryData(sourceKey, previousSource);
                    queryClient.setQueryData(targetKey, previousTarget);
                    showError(error, "Unable to save requirement order");
                }).finally(() => {
                    queryClient.invalidateQueries({ queryKey: sourceKey });
                    queryClient.invalidateQueries({ queryKey: targetKey });
                });

            const final = [...realRequirements];
            if (template) final.push(template);
            setRequirementsArray(final);
        } else {
            const maxSortOrder = Math.max(0, ...requirementsArray.filter(t => t.id !== '').map(t => t.sort_order ?? 0));
            const newSortOrder = maxSortOrder + 1;

            var newRequirementsArray = [...requirementsArray];
            requirement.sort_order = newSortOrder;
            requirement.category_fk = parseInt(category.id);
            newRequirementsArray.push(requirement);
            newRequirementsArray.sort((a, b) => activeSort(a, b));
            setRequirementsArray(newRequirementsArray);

            queryClient.setQueryData(targetKey, (old) => {
                if (!old) return old;
                return [...old, {...requirement}];
            });

            call_rest_api(requirementUri, 'PUT', [{'id': requirement.id, 'category_fk': category.id, 'sort_order': newSortOrder }], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        queryClient.setQueryData(sourceKey, previousSource);
                        queryClient.setQueryData(targetKey, previousTarget);
                        setRequirementsArray(prev => prev.filter(t => t.id !== requirement.id));
                        showError(result, "Unable to change requirement's category");
                    }
                }).catch(error => {
                    queryClient.setQueryData(sourceKey, previousSource);
                    queryClient.setQueryData(targetKey, previousTarget);
                    setRequirementsArray(prev => prev.filter(t => t.id !== requirement.id));
                    showError(error, "Unable to change requirement's category");
                }).finally(() => {
                    queryClient.invalidateQueries({ queryKey: sourceKey });
                    queryClient.invalidateQueries({ queryKey: targetKey });
                });
        }

        return {requirement: requirement.id};
    };

    const scheduledClick = (requirementIndex, requirementId) => {

        let newRequirementsArray = [...requirementsArray]
        const current = newRequirementsArray[requirementIndex].scheduled || 0;
        newRequirementsArray[requirementIndex].scheduled = (current + 1) % 3;

        if (requirementId !== '') {
            let uri = `${darwinUri}/requirements`;
            call_rest_api(uri, 'PUT', [{'id': requirementId, 'scheduled': newRequirementsArray[requirementIndex].scheduled}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        showError(result, "Unable to change requirement's scheduled flag")
                    }
                }).catch(error => {
                    showError(error, "Unable to change requirement's scheduled flag")
                }
            );
        } else if (savingRef.current) {
            pendingMutationsRef.current.scheduled = newRequirementsArray[requirementIndex].scheduled;
        }

        setRequirementsArray(newRequirementsArray);
    }

    const STATUS_CYCLE = ['authoring', 'approved', 'swarm_ready'];
    const statusClick = (requirementIndex, requirementId) => {
        let newRequirementsArray = [...requirementsArray];
        const current = newRequirementsArray[requirementIndex].requirement_status;
        const idx = STATUS_CYCLE.indexOf(current);
        if (idx === -1) return; // not a cycleable status (development/met/deferred)
        const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
        // Auto-manage scheduled: swarm_ready sets scheduled=1, others clear to 0
        const scheduledVal = next === 'swarm_ready' ? 1 : 0;
        newRequirementsArray[requirementIndex].requirement_status = next;
        newRequirementsArray[requirementIndex].scheduled = scheduledVal;

        if (requirementId !== '') {
            let uri = `${darwinUri}/requirements`;
            call_rest_api(uri, 'PUT', [{'id': requirementId, 'requirement_status': next, 'scheduled': scheduledVal}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        showError(result, "Unable to change requirement status");
                    }
                }).catch(error => showError(error, "Unable to change requirement status"));
        } else if (savingRef.current) {
            pendingMutationsRef.current.requirement_status = next;
            pendingMutationsRef.current.scheduled = scheduledVal;
        }
        setRequirementsArray(newRequirementsArray);
    }

    const COORD_CYCLE = [null, 'planned', 'implemented', 'deployed'];
    const coordinationClick = (requirementIndex, requirementId) => {
        let newRequirementsArray = [...requirementsArray];
        const current = newRequirementsArray[requirementIndex].coordination_type || null;
        const idx = COORD_CYCLE.indexOf(current);
        const next = COORD_CYCLE[(idx + 1) % COORD_CYCLE.length];
        newRequirementsArray[requirementIndex].coordination_type = next;

        if (requirementId !== '') {
            let uri = `${darwinUri}/requirements`;
            call_rest_api(uri, 'PUT', [{'id': requirementId, 'coordination_type': next === null ? 'NULL' : next}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        showError(result, "Unable to change coordination type");
                    }
                }).catch(error => showError(error, "Unable to change coordination type"));
        } else if (savingRef.current) {
            pendingMutationsRef.current.coordination_type = next === null ? 'NULL' : next;
        }
        setRequirementsArray(newRequirementsArray);
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

        const maxSortOrder = Math.max(0, ...requirementsArray.filter(t => t.id !== '').map(t => t.sort_order ?? 0));
        const requirementToSave = { ...requirementsArray[requirementIndex], sort_order: maxSortOrder + 1, project_fk: null };

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
                                if (putResult.httpStatus.httpStatus !== 200) {
                                    showError(putResult, 'Unable to update requirement after save');
                                }
                            }).catch(putError => {
                                showError(putError, 'Unable to update requirement after save');
                            });
                    }

                    newRequirementsArray.sort((a, b) => activeSort(a, b));
                    newRequirementsArray.push({'id':'', 'title':'', 'requirement_status': 'authoring', 'scheduled': 0, 'category_fk': category.id, 'sort_order': null });
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
            scheduled: requirement?.scheduled || 0,
            requirement_status: requirement?.requirement_status || 'authoring',
        });
    }

    const createdSort = (a, b) => {
        if (a.id === '') return 1;
        if (b.id === '') return -1;
        return a.id - b.id;
    }

    const requirementHandSort = (a, b) => {
        if (a.id === '') return 1;
        if (b.id === '') return -1;
        const aOrder = a.sort_order ?? Infinity;
        const bOrder = b.sort_order ?? Infinity;
        return aOrder - bOrder;
    }

    const STATUS_SORT = { authoring: 0, approved: 0, swarm_ready: 0, development: 0, deferred: 1, met: 2 };

    const activeSort = (a, b) => {
        if (a.id === '') return 1;
        if (b.id === '') return -1;
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
        return sortMode === 'hand' ? requirementHandSort(a, b) : createdSort(a, b);
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
                                    onClick={(event) => { handleMenuClose(); changeSortMode(event, 'hand'); }}
                                    data-testid={`sort-hand-${category.id}`}
                                >
                                    <ListItemIcon><SwapVertIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>Hand Sort</ListItemText>
                                    {sortMode === 'hand' && <Check fontSize="small" sx={{ ml: 1 }} />}
                                </MenuItem>
                                <MenuItem
                                    onClick={(event) => { handleMenuClose(); changeSortMode(event, 'created'); }}
                                    data-testid={`sort-created-${category.id}`}
                                >
                                    <ListItemIcon><AccessTimeIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>Created Sort</ListItemText>
                                    {sortMode === 'created' && <Check fontSize="small" sx={{ ml: 1 }} />}
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
                    <RequirementActionsContext.Provider value={{ scheduledClick, statusClick, coordinationClick,
                        titleChange, titleKeyDown, titleOnBlur, deleteClick, requirementsArray, setRequirementsArray,
                        sortMode, setCrossCardInsertIndex, sessionStatusMap }}>
                        {requirementsArray.map((requirement, requirementIndex) => (
                            <RequirementRow {...{key: requirement.id, supportDrag: true, requirement, requirementIndex,
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
