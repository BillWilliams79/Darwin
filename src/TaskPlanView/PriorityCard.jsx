// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDrop } from 'react-dnd';
import call_rest_api from '../RestApi/RestApi';
import { usePriorityCardStore } from '../stores/usePriorityCardStore';
import { usePriorityTasks, usePriorityCardOrder } from '../hooks/useDataQueries';
import { taskKeys, priorityCardOrderKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { TaskActionsContext } from '../hooks/useTaskActions';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';

import TaskEdit from '../Components/TaskEdit/TaskEdit';
import TaskDeleteDialog from '../Components/TaskDeleteDialog/TaskDeleteDialog';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Check from '@mui/icons-material/Check';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { CircularProgress } from '@mui/material';

const sortByHandOrder = (tasks, orderRecs) => {
    if (!orderRecs || orderRecs.length === 0) {
        return [...tasks].sort((a, b) => a.id - b.id);
    }
    const orderMap = {};
    orderRecs.forEach(r => { orderMap[r.task_id] = r; });
    const withOrder = tasks.filter(t => orderMap[t.id]);
    const withoutOrder = tasks.filter(t => !orderMap[t.id]);
    withOrder.sort((a, b) => orderMap[a.id].sort_order - orderMap[b.id].sort_order);
    withoutOrder.sort((a, b) => a.id - b.id);
    return [...withOrder, ...withoutOrder];
};

const PriorityCard = ({ domainId, areaIds }) => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);

    // Sort mode from persisted store (per domain)
    const sortMode = usePriorityCardStore(s => s.priorityCards[String(domainId)]?.sortMode ?? 'created');
    const setSortModeInStore = usePriorityCardStore(s => s.setSortMode);

    // Local state
    const [tasksArray, setTasksArray] = useState(null);
    const [cardOrderArray, setCardOrderArray] = useState([]);
    const [menuAnchorEl, setMenuAnchorEl] = useState(null);
    const menuOpen = Boolean(menuAnchorEl);

    // react-dnd: tracks where task should be inserted (set by TaskEdit hover)
    const crossCardInsertIndexRef = useRef(null);
    const setCrossCardInsertIndex = useCallback((index) => {
        crossCardInsertIndexRef.current = index;
    }, []);

    // TanStack Query
    const { data: serverTasks } = usePriorityTasks(profile?.userName, domainId, areaIds, {
        enabled: areaIds.length > 0,
    });
    const { data: serverCardOrder } = usePriorityCardOrder(profile?.userName, domainId);

    // Seed tasksArray from server data
    useEffect(() => {
        if (!serverTasks) return;
        if (sortMode === 'hand' && serverCardOrder && serverCardOrder.length > 0) {
            setTasksArray(sortByHandOrder([...serverTasks], serverCardOrder));
        } else {
            setTasksArray([...serverTasks].sort((a, b) => a.id - b.id));
        }
    }, [serverTasks, serverCardOrder]); // eslint-disable-line react-hooks/exhaustive-deps

    // Seed cardOrderArray
    useEffect(() => {
        if (serverCardOrder) setCardOrderArray(serverCardOrder);
    }, [serverCardOrder]);

    // 3-dot menu
    const handleMenuOpen = (e) => setMenuAnchorEl(e.currentTarget);
    const handleMenuClose = () => setMenuAnchorEl(null);

    // Persist hand sort order to priority_card_order table
    const persistHandSort = useCallback((orderedTasks) => {
        const orderMap = {};
        cardOrderArray.forEach(r => { orderMap[r.task_id] = r; });

        const putData = [];
        const postOps = [];
        orderedTasks.forEach((task, idx) => {
            if (orderMap[task.id]) {
                putData.push({ id: orderMap[task.id].id, sort_order: idx });
            } else {
                postOps.push(
                    call_rest_api(`${darwinUri}/priority_card_order`, 'POST',
                        { domain_id: domainId, task_id: task.id, sort_order: idx }, idToken)
                );
            }
        });

        const ops = [];
        if (putData.length > 0) {
            ops.push(call_rest_api(`${darwinUri}/priority_card_order`, 'PUT', putData, idToken));
        }
        ops.push(...postOps);

        Promise.all(ops)
            .then(() => queryClient.invalidateQueries({
                queryKey: priorityCardOrderKeys.byDomain(profile.userName, domainId)
            }))
            .catch(e => showError(e, 'Unable to save priority sort order'));
    }, [cardOrderArray, darwinUri, domainId, idToken, profile, queryClient, showError]);

    // Sort mode change
    const changeSortMode = async (newMode) => {
        handleMenuClose();
        setSortModeInStore(domainId, newMode);
        if (!tasksArray) return;

        if (newMode === 'hand') {
            const currentCardOrder = serverCardOrder || [];
            if (currentCardOrder.length === 0 && tasksArray.length > 0) {
                // No order records yet — POST all tasks to establish initial hand-sort order
                const sortedById = [...tasksArray].sort((a, b) => a.id - b.id);
                const posts = sortedById.map((task, idx) =>
                    call_rest_api(`${darwinUri}/priority_card_order`, 'POST',
                        { domain_id: domainId, task_id: task.id, sort_order: idx }, idToken)
                );
                try {
                    const results = await Promise.all(posts);
                    const newRecords = results
                        .filter(r => r.httpStatus.httpStatus === 200)
                        .map(r => r.data[0]);
                    setCardOrderArray(newRecords);
                    queryClient.invalidateQueries({
                        queryKey: priorityCardOrderKeys.byDomain(profile.userName, domainId)
                    });
                    setTasksArray(sortByHandOrder([...tasksArray], newRecords));
                } catch (e) {
                    showError(e, 'Unable to initialize priority sort order');
                }
            } else {
                setTasksArray(sortByHandOrder([...tasksArray], currentCardOrder));
            }
        } else {
            setTasksArray([...tasksArray].sort((a, b) => a.id - b.id));
        }
    };

    // react-dnd: card-level drop target — only accepts priorityTask (not taskPlan)
    // so tasks from area cards cannot be dropped here, and priority tasks cannot
    // be dropped on area cards (they drag as priorityTask which other cards don't accept).
    const [, drop] = useDrop(() => ({
        accept: 'priorityTask',
        drop: (item, monitor) => {
            if (monitor.didDrop()) return;

            const insertIndex = crossCardInsertIndexRef.current;
            crossCardInsertIndexRef.current = null;

            if (!tasksArray) return { task: null };

            const matchTask = tasksArray.find(t => t.id === item.id);

            if (matchTask !== undefined) {
                // Same-card drop: reorder if in hand sort mode
                if (sortMode === 'hand' && insertIndex !== null) {
                    const draggedIdx = tasksArray.findIndex(t => t.id === item.id);
                    if (draggedIdx !== -1) {
                        const adjustedIndex = insertIndex > draggedIdx ? insertIndex - 1 : insertIndex;
                        if (adjustedIndex !== draggedIdx) {
                            const updated = [...tasksArray];
                            const [moved] = updated.splice(draggedIdx, 1);
                            updated.splice(adjustedIndex, 0, moved);
                            setTasksArray(updated);
                            persistHandSort(updated);
                        }
                    }
                }
                return { task: null }; // same-card: source keeps the task
            }

            // Cross-card drop: reject — tasks can't be dropped into the priority card
            return { task: null };
        },
    }), [tasksArray, sortMode, persistHandSort]);

    const cardRef = useRef(null);
    const mergedRef = useCallback((node) => {
        cardRef.current = node;
        drop(node);
    }, [drop]);

    // Delete confirm dialog
    const taskDelete = useConfirmDialog({
        onConfirm: ({ taskId }) => {
            call_rest_api(`${darwinUri}/tasks`, 'DELETE', { id: taskId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        call_rest_api(`${darwinUri}/priority_card_order`, 'DELETE',
                            { domain_id: domainId, task_id: taskId }, idToken);
                        setTasksArray(prev => prev ? prev.filter(t => t.id !== taskId) : prev);
                        setCardOrderArray(prev => prev.filter(r => r.task_id !== taskId));
                        queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to delete task');
                    }
                }).catch(e => showError(e, 'Unable to delete task'));
        }
    });

    // Task action: priority toggle (tasks are priority=1; toggle always removes from card)
    const priorityClick = (taskIndex, taskId) => {
        setTasksArray(prev => prev ? prev.filter((_, i) => i !== taskIndex) : prev);
        call_rest_api(`${darwinUri}/tasks`, 'PUT', [{ id: taskId, priority: 0 }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus > 204) {
                    showError(result, "Unable to change task's priority");
                } else {
                    // Invalidate AFTER PUT completes so area cards refetch current server state
                    queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
                }
            }).catch(e => showError(e, "Unable to change task's priority"));
        call_rest_api(`${darwinUri}/priority_card_order`, 'DELETE',
            { domain_id: domainId, task_id: taskId }, idToken);
        setCardOrderArray(prev => prev.filter(r => r.task_id !== taskId));
    };

    // Task action: done toggle — mark done in local state (stays with strikethrough until re-fetch)
    const doneClick = (taskIndex, taskId) => {
        setTasksArray(prev => {
            if (!prev) return prev;
            const updated = [...prev];
            updated[taskIndex] = { ...updated[taskIndex], done: 1 };
            return updated;
        });
        call_rest_api(`${darwinUri}/tasks`, 'PUT',
            [{ id: taskId, done: 1, done_ts: new Date().toISOString() }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus > 204) {
                    showError(result, "Unable to mark task completed");
                } else {
                    // Invalidate AFTER PUT completes so area cards refetch current server state
                    queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
                }
            }).catch(e => showError(e, "Unable to mark task completed"));
        // Clean up priority_card_order — task will disappear on next re-fetch
        call_rest_api(`${darwinUri}/priority_card_order`, 'DELETE',
            { domain_id: domainId, task_id: taskId }, idToken);
        setCardOrderArray(prev => prev.filter(r => r.task_id !== taskId));
    };

    const deleteClick = (event, taskId) => {
        taskDelete.openDialog({ taskId });
    };

    const updateTask = (event, taskIndex, taskId) => {
        if (!taskId || taskId === '' || !tasksArray) return;
        call_rest_api(`${darwinUri}/tasks`, 'PUT',
            [{ id: taskId, description: tasksArray[taskIndex].description }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus > 299) {
                    showError(result, 'Task description not updated');
                }
            }).catch(e => showError(e, 'Task description not updated'));
    };

    const { fieldChange: descriptionChange, fieldKeyDown: descriptionKeyDown, fieldOnBlur: descriptionOnBlur } =
        useCrudCallbacks({
            items: tasksArray || [],
            setItems: setTasksArray,
            fieldName: 'description',
            saveFn: updateTask,
        });

    const taskActions = {
        priorityClick,
        doneClick,
        descriptionChange,
        descriptionKeyDown,
        descriptionOnBlur,
        deleteClick,
        tasksArray,
        setTasksArray,
        sortMode,        // real sortMode — enables insert indicators in hand sort
        setCrossCardInsertIndex,
    };

    return (
        <Card raised={true}
              data-testid="priority-card"
              ref={mergedRef}
              sx={{ border: '2px solid transparent' }}>
            <CardContent>
                <Box className="card-header" sx={{ marginBottom: 2 }}>
                    <Typography sx={{ fontSize: 24, fontWeight: 'normal' }}>
                        Priorities
                    </Typography>
                    <IconButton
                        onClick={handleMenuOpen}
                        data-testid={`priority-card-menu-${domainId}`}
                        size="small"
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
                        <MenuItem onClick={() => changeSortMode('created')} data-testid="priority-card-sort-created">
                            <ListItemIcon><AccessTimeIcon fontSize="small" /></ListItemIcon>
                            <ListItemText>Chronological Sort</ListItemText>
                            {sortMode === 'created' && <Check fontSize="small" sx={{ ml: 1 }} data-testid="priority-card-sort-created-check" />}
                        </MenuItem>
                        <MenuItem onClick={() => changeSortMode('hand')} data-testid="priority-card-sort-hand">
                            <ListItemIcon><SwapVertIcon fontSize="small" /></ListItemIcon>
                            <ListItemText>Hand Sort</ListItemText>
                            {sortMode === 'hand' && <Check fontSize="small" sx={{ ml: 1 }} data-testid="priority-card-sort-hand-check" />}
                        </MenuItem>
                    </Menu>
                </Box>

                {tasksArray === null ? (
                    <CircularProgress size={24} />
                ) : tasksArray.length === 0 ? (
                    <Typography variant="body2" sx={{ color: 'text.disabled', p: 1 }}>
                        No priority tasks in this domain
                    </Typography>
                ) : (
                    <TaskActionsContext.Provider value={taskActions}>
                        {tasksArray.map((task, taskIndex) => (
                            <TaskEdit
                                key={task.id}
                                supportDrag={true}
                                dragType="priorityTask"
                                task={task}
                                taskIndex={taskIndex}
                                areaId={String(task.area_fk)}
                                areaName=""
                            />
                        ))}
                    </TaskActionsContext.Provider>
                )}
            </CardContent>
            <TaskDeleteDialog
                deleteDialogOpen={taskDelete.dialogOpen}
                setDeleteDialogOpen={taskDelete.setDialogOpen}
                setDeleteId={taskDelete.setInfoObject}
                setDeleteConfirmed={taskDelete.setConfirmed}
            />
        </Card>
    );
};

export default PriorityCard;
