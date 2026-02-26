import React, { useState, useEffect, useContext, useRef, useCallback } from 'react'
import PriorityRow from './PriorityRow';
import PriorityDeleteDialog from './PriorityDeleteDialog';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useApiTrigger } from '../hooks/useApiTrigger';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { PriorityActionsContext } from '../hooks/usePriorityActions';

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
import FlagIcon from '@mui/icons-material/Flag';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import { CircularProgress } from '@mui/material';


const CategoryCard = ({category, categoryIndex, projectId, categoryChange, categoryKeyDown, categoryOnBlur, clickCardClosed, clickCardDelete, moveCard, persistCategoryOrder, removeCategory, isTemplate }) => {

    const revertDragTabSwitch = useSwarmTabStore(s => s.revertDragTabSwitch);

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [prioritiesArray, setPrioritiesArray] = useState()
    const [priorityApiTrigger, triggerPriorityRefresh] = useApiTrigger();
    const [sessionStatusMap, setSessionStatusMap] = useState({});

    const savingRef = useRef(false);
    const pendingMutationsRef = useRef({});

    const [sortMode, setSortMode] = useState(category.sort_mode || 'priority');

    const changeSortMode = (event, newMode) => {
        if (newMode === null) return;
        setSortMode(newMode);

        if (prioritiesArray) {
            const sortFn = newMode === 'hand' ? priorityHandSort : priorityPrioritySort;
            const sorted = [...prioritiesArray];
            sorted.sort((a, b) => sortFn(a, b));
            setPrioritiesArray(sorted);
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

    const priorityDelete = useConfirmDialog({
        onConfirm: ({ priorityId }) => {
            let uri = `${darwinUri}/priorities`;
            call_rest_api(uri, 'DELETE', {'id': priorityId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newPrioritiesArray = [...prioritiesArray]
                        newPrioritiesArray = newPrioritiesArray.filter(p => p.id !== priorityId );
                        setPrioritiesArray(newPrioritiesArray);
                    } else {
                        showError(result, 'Unable to delete priority')
                    }
                }).catch(error => {
                    showError(error, 'Unable to delete priority')
                });
        }
    });

    // READ priorities for this category
    useEffect( () => {

        let priorityUri = `${darwinUri}/priorities?creator_fk=${profile.userName}&closed=0&category_fk=${category.id}&fields=id,title,in_progress,closed,category_fk,sort_order,completed_at`

        call_rest_api(priorityUri, 'GET', '', idToken)
            .then(result => {

                if (result.httpStatus.httpStatus === 200) {

                    let sortedPrioritiesArray = result.data;

                    // Lazy fill: if any priority has null sort_order, assign sequential values
                    const needsFill = sortedPrioritiesArray.some(t => t.sort_order === null || t.sort_order === undefined);
                    if (needsFill) {
                        sortedPrioritiesArray.sort((a, b) => priorityPrioritySort(a, b));
                        const bulkUpdate = [];
                        sortedPrioritiesArray.forEach((t, idx) => {
                            t.sort_order = idx;
                            bulkUpdate.push({ id: t.id, sort_order: idx });
                        });
                        let uri = `${darwinUri}/priorities`;
                        call_rest_api(uri, 'PUT', bulkUpdate, idToken).catch(() => {});
                    }

                    sortedPrioritiesArray.sort((a, b) => activeSort(a, b));
                    sortedPrioritiesArray.push({'id':'', 'title':'', 'in_progress': 0, 'closed': 0, 'category_fk': parseInt(category.id), 'sort_order': null, 'creator_fk': profile.userName });
                    setPrioritiesArray(sortedPrioritiesArray);

                    // Fetch session statuses for these priorities
                    const priorityIds = sortedPrioritiesArray.filter(p => p.id !== '').map(p => p.id);
                    if (priorityIds.length > 0) {
                        call_rest_api(`${darwinUri}/swarm_sessions?creator_fk=${profile.userName}`, 'GET', '', idToken)
                            .then(sessResult => {
                                if (sessResult.httpStatus.httpStatus === 200) {
                                    const map = {};
                                    sessResult.data.forEach(s => {
                                        const m = s.source_ref && s.source_ref.match(/^priority:(\d+)$/);
                                        if (m) {
                                            const pid = parseInt(m[1]);
                                            if (!map[pid] || s.id > map[pid].id) {
                                                map[pid] = s.swarm_status;
                                            }
                                        }
                                    });
                                    setSessionStatusMap(map);
                                }
                            }).catch(() => {});
                    }

                } else {
                    showError(result, 'Unable to read priorities')
                }

            }).catch(error => {
                if (error.httpStatus.httpStatus === 404) {
                    let sortedPrioritiesArray = [];
                    sortedPrioritiesArray.push({'id':'', 'title':'', 'in_progress': 0, 'closed': 0, 'category_fk': parseInt(category.id), 'sort_order': null, 'creator_fk': profile.userName });
                    setPrioritiesArray(sortedPrioritiesArray);
                } else {
                    showError(error, 'Unable to read priorities')
                }
            });

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [priorityApiTrigger]);

    const [{ isOver }, drop] = useDrop(() => ({

        accept: ["priorityRow", "categoryCard"],

        drop: (item, monitor) => {
            if (monitor.getItemType() === "priorityRow") {
                return addPriorityToCategory(item);
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

    }), [prioritiesArray, categoryIndex, projectId, isTemplate, moveCard]);

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

    const addPriorityToCategory = (priority) => {

        const insertIndex = crossCardInsertIndexRef.current;
        crossCardInsertIndexRef.current = null;

        // Same-card drop
        let matchPriority = prioritiesArray.find( p => p.id === priority.id)

        if (matchPriority !== undefined) {
            if (sortMode === 'hand' && insertIndex !== null) {
                const draggedIdx = prioritiesArray.findIndex(t => t.id === priority.id);
                if (draggedIdx === -1) return { priority: null };

                const adjustedIndex = insertIndex > draggedIdx ? insertIndex - 1 : insertIndex;
                if (adjustedIndex === draggedIdx) return { priority: null };

                const updated = [...prioritiesArray];
                const [moved] = updated.splice(draggedIdx, 1);
                updated.splice(adjustedIndex, 0, moved);

                const bulkUpdate = [];
                updated.forEach((t, idx) => {
                    if (t.id !== '') {
                        t.sort_order = idx;
                        bulkUpdate.push({ id: t.id, sort_order: idx });
                    }
                });

                let priorityUri = `${darwinUri}/priorities`;
                call_rest_api(priorityUri, 'PUT', bulkUpdate, idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                            showError(result, 'Unable to save priority sort order');
                        }
                    }).catch(error => {
                        showError(error, 'Unable to save priority sort order');
                    });

                setPrioritiesArray(updated);
            }
            return { priority: null };
        }

        // Cross-card drop
        let priorityUri = `${darwinUri}/priorities`;

        if (sortMode === 'hand' && insertIndex !== null) {
            const realPriorities = prioritiesArray.filter(t => t.id !== '');
            const template = prioritiesArray.find(t => t.id === '');
            const clampedIndex = Math.min(insertIndex, realPriorities.length);
            realPriorities.splice(clampedIndex, 0, {...priority, category_fk: parseInt(category.id)});

            const bulkUpdate = realPriorities.map((t, idx) => {
                t.sort_order = idx;
                const update = { id: t.id, sort_order: idx };
                if (t.id === priority.id) update.category_fk = parseInt(category.id);
                return update;
            });

            call_rest_api(priorityUri, 'PUT', bulkUpdate, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        showError(result, "Unable to save priority order");
                    }
                }).catch(error => {
                    showError(error, "Unable to save priority order");
                });

            const final = [...realPriorities];
            if (template) final.push(template);
            setPrioritiesArray(final);
        } else {
            const maxSortOrder = Math.max(0, ...prioritiesArray.filter(t => t.id !== '').map(t => t.sort_order ?? 0));
            const newSortOrder = maxSortOrder + 1;

            var newPrioritiesArray = [...prioritiesArray];
            priority.sort_order = newSortOrder;
            priority.category_fk = parseInt(category.id);
            newPrioritiesArray.push(priority);
            newPrioritiesArray.sort((a, b) => activeSort(a, b));
            setPrioritiesArray(newPrioritiesArray);

            call_rest_api(priorityUri, 'PUT', [{'id': priority.id, 'category_fk': category.id, 'sort_order': newSortOrder }], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        setPrioritiesArray(prev => prev.filter(t => t.id !== priority.id));
                        showError(result, "Unable to change priority's category");
                    }
                }).catch(error => {
                    setPrioritiesArray(prev => prev.filter(t => t.id !== priority.id));
                    showError(error, "Unable to change priority's category");
                });
        }

        return {priority: priority.id};
    };

    const inProgressClick = (priorityIndex, priorityId) => {

        let newPrioritiesArray = [...prioritiesArray]
        newPrioritiesArray[priorityIndex].in_progress = newPrioritiesArray[priorityIndex].in_progress ? 0 : 1;

        if (priorityId !== '') {
            let uri = `${darwinUri}/priorities`;
            call_rest_api(uri, 'PUT', [{'id': priorityId, 'in_progress': newPrioritiesArray[priorityIndex].in_progress}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        showError(result, "Unable to change priority's in_progress flag")
                    }
                }).catch(error => {
                    showError(error, "Unable to change priority's in_progress flag")
                }
            );
        } else if (savingRef.current) {
            pendingMutationsRef.current.in_progress = newPrioritiesArray[priorityIndex].in_progress;
        }

        newPrioritiesArray.sort((a, b) => activeSort(a, b));
        setPrioritiesArray(newPrioritiesArray);
    }

    const closedClick = (priorityIndex, priorityId) => {

        let newPrioritiesArray = [...prioritiesArray]
        newPrioritiesArray[priorityIndex].closed = newPrioritiesArray[priorityIndex].closed ? 0 : 1;
        setPrioritiesArray(newPrioritiesArray);

        if (priorityId !== '') {
            let uri = `${darwinUri}/priorities`;
            call_rest_api(uri, 'PUT', [{'id': priorityId, 'closed': newPrioritiesArray[priorityIndex].closed,
                          ...(newPrioritiesArray[priorityIndex].closed === 1 ? {'completed_at': new Date().toISOString()} : {'completed_at': 'NULL'})}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        showError(result, "Unable to mark priority closed")
                    }
                }).catch(error => {
                    showError(error, "Unable to mark priority closed")
                }
            );
        } else if (savingRef.current) {
            pendingMutationsRef.current.closed = newPrioritiesArray[priorityIndex].closed;
            pendingMutationsRef.current.completed_at = newPrioritiesArray[priorityIndex].closed === 1
                ? new Date().toISOString() : 'NULL';
        }
    }

    const updatePriority = (event, priorityIndex, priorityId) => {

        const noop = ()=>{};

        if ((priorityId === '') &&
            (prioritiesArray[priorityIndex].title === '')) {
            noop();
        } else {
            if (priorityId === '') {
                savePriority(event, priorityIndex)
            } else {
                let uri = `${darwinUri}/priorities`;
                call_rest_api(uri, 'PUT', [{'id': priorityId, 'title': prioritiesArray[priorityIndex].title}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 204) {
                            showError(result, 'Priority title not updated, HTTP error')
                        }
                    }).catch(error => {
                        showError(error, 'Priority title not updated, HTTP error')
                    });
            }
        }
    }

    const { fieldChange: titleChange, fieldKeyDown: titleKeyDown, fieldOnBlur: titleOnBlur } = useCrudCallbacks({
        items: prioritiesArray, setItems: setPrioritiesArray, fieldName: 'title', saveFn: updatePriority
    });

    const savePriority = (event, priorityIndex) => {
        if (savingRef.current) return;
        savingRef.current = true;

        const maxSortOrder = Math.max(0, ...prioritiesArray.filter(t => t.id !== '').map(t => t.sort_order ?? 0));
        const priorityToSave = { ...prioritiesArray[priorityIndex], sort_order: maxSortOrder + 1, project_fk: null };

        let uri = `${darwinUri}/priorities`;
        call_rest_api(uri, 'POST', priorityToSave, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    let newPrioritiesArray = [...prioritiesArray];
                    newPrioritiesArray[priorityIndex] = {...result.data[0]};

                    const pending = pendingMutationsRef.current;
                    if (Object.keys(pending).length > 0) {
                        Object.assign(newPrioritiesArray[priorityIndex], pending);
                        call_rest_api(uri, 'PUT', [{'id': result.data[0].id, ...pending}], idToken)
                            .then(putResult => {
                                if (putResult.httpStatus.httpStatus !== 200) {
                                    showError(putResult, 'Unable to update priority after save');
                                }
                            }).catch(putError => {
                                showError(putError, 'Unable to update priority after save');
                            });
                    }

                    newPrioritiesArray.sort((a, b) => activeSort(a, b));
                    newPrioritiesArray.push({'id':'', 'title':'', 'in_progress': 0, 'closed': 0, 'category_fk': category.id, 'sort_order': null, 'creator_fk': profile.userName });
                    setPrioritiesArray(newPrioritiesArray);
                } else if (result.httpStatus.httpStatus === 201) {
                    triggerPriorityRefresh();
                } else {
                    showError(result, 'Priority not saved, HTTP error')
                }
            }).catch(error => {
                showError(error, 'Priority not saved, HTTP error')
            }).finally(() => {
                savingRef.current = false;
                pendingMutationsRef.current = {};
            });
    }

    const deleteClick = (event, priorityId) => {
        priorityDelete.openDialog({priorityId});
    }

    const priorityPrioritySort = (a, b) => {
        if (a.id === '') return 1;
        if (b.id === '') return -1;
        if (a.in_progress === b.in_progress) return 0;
        return a.in_progress > b.in_progress ? -1 : 1;
    }

    const priorityHandSort = (a, b) => {
        if (a.id === '') return 1;
        if (b.id === '') return -1;
        const aOrder = a.sort_order ?? Infinity;
        const bOrder = b.sort_order ?? Infinity;
        return aOrder - bOrder;
    }

    const activeSort = (a, b) => {
        return sortMode === 'hand' ? priorityHandSort(a, b) : priorityPrioritySort(a, b);
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
                                    onClick={(event) => { handleMenuClose(); changeSortMode(event, 'priority'); }}
                                    data-testid={`sort-priority-${category.id}`}
                                >
                                    <ListItemIcon><FlagIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>Priority Sort</ListItemText>
                                    {sortMode === 'priority' && <Check fontSize="small" sx={{ ml: 1 }} />}
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
                                        const priorityCount = prioritiesArray ? prioritiesArray.filter(t => t.id !== '').length : 0;
                                        clickCardDelete(event, category.category_name, category.id, priorityCount);
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
                { (prioritiesArray) ?
                    <PriorityActionsContext.Provider value={{ inProgressClick, closedClick, titleChange,
                        titleKeyDown, titleOnBlur, deleteClick, prioritiesArray, setPrioritiesArray,
                        sortMode, setCrossCardInsertIndex, sessionStatusMap }}>
                        {prioritiesArray.map((priority, priorityIndex) => (
                            <PriorityRow {...{key: priority.id, supportDrag: true, priority, priorityIndex,
                                categoryId: category.id, categoryName: category.category_name }}
                            />
                        ))}
                    </PriorityActionsContext.Provider>
                  :
                    category.id  === '' ? '' : <CircularProgress/>
                }
            </CardContent>
            <PriorityDeleteDialog deleteDialogOpen = {priorityDelete.dialogOpen}
                              setDeleteDialogOpen = {priorityDelete.setDialogOpen}
                              setDeleteId = {priorityDelete.setInfoObject}
                              setDeleteConfirmed = {priorityDelete.setConfirmed} />
        </Card>
    )
}

export default CategoryCard
