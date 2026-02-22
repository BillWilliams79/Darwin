// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, { useState, useEffect, useContext, useRef, useCallback} from 'react'
import TaskEdit from '../Components/TaskEdit/TaskEdit';
import TaskDeleteDialog from '../Components/TaskDeleteDialog/TaskDeleteDialog';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useApiTrigger } from '../hooks/useApiTrigger';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useDragTabStore } from '../stores/useDragTabStore';
import { TaskActionsContext } from '../hooks/useTaskActions';

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


const TaskCard = ({area, areaIndex, domainId, areaChange, areaKeyDown, areaOnBlur, clickCardClosed, clickCardDelete, moveCard, persistAreaOrder, removeArea, isTemplate }) => {

    const revertDragTabSwitch = useDragTabStore(s => s.revertDragTabSwitch);

    // Task card is the list of tasks per area displayed in a card.
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    // Array of task objects
    const [tasksArray, setTasksArray] = useState()
    const [taskApiTrigger, triggerTaskRefresh] = useApiTrigger();

    // Guards against race condition: priority/done clicks during in-flight POST
    const savingRef = useRef(false);
    const pendingMutationsRef = useRef({});

    // Sort mode: 'priority' (default) or 'hand' — persisted in DB (areas.sort_mode)
    const [sortMode, setSortMode] = useState(area.sort_mode || 'priority');

    const changeSortMode = (event, newMode) => {
        if (newMode === null) return; // MUI ToggleButtonGroup sends null when clicking already-selected
        setSortMode(newMode);

        // Re-sort tasks immediately using newMode (not stale sortMode from closure)
        if (tasksArray) {
            const sortFn = newMode === 'hand' ? taskHandSort : taskPrioritySort;
            const sorted = [...tasksArray];
            sorted.sort((a, b) => sortFn(a, b));
            setTasksArray(sorted);
        }

        if (area.id !== '') {
            call_rest_api(`${darwinUri}/areas`, 'PUT', [{ id: area.id, sort_mode: newMode }], idToken)
                .catch(error => showError(error, 'Unable to save sort preference'));
        }
    };

    // Card options menu (triple dots)
    const [menuAnchorEl, setMenuAnchorEl] = useState(null);
    const menuOpen = Boolean(menuAnchorEl);
    const handleMenuOpen = (event) => setMenuAnchorEl(event.currentTarget);
    const handleMenuClose = () => setMenuAnchorEl(null);

    // Tracks where a task should be inserted during hand-sort drag (set by TaskEdit hover)
    const crossCardInsertIndexRef = useRef(null);
    const setCrossCardInsertIndex = useCallback((index) => {
        crossCardInsertIndexRef.current = index;
    }, []);

    const showError = useSnackBarStore(s => s.showError);

    const taskDelete = useConfirmDialog({
        onConfirm: ({ taskId }) => {
            let uri = `${darwinUri}/tasks`;
            call_rest_api(uri, 'DELETE', {'id': taskId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newTasksArray = [...tasksArray]
                        newTasksArray = newTasksArray.filter(task => task.id !== taskId );
                        setTasksArray(newTasksArray);
                    } else {
                        showError(result, 'Unable to delete task')
                    }
                }).catch(error => {
                    showError(error, 'Unable to delete task')
                });
        }
    });


    // READ Task API data for card
    useEffect( () => {

        console.count('useEffect: read task API data for a given area');

        // FETCH TASKS: filter for creator, done=0 and area.id
        let taskUri = `${darwinUri}/tasks?creator_fk=${profile.userName}&done=0&area_fk=${area.id}&fields=id,priority,done,description,area_fk,sort_order`

        call_rest_api(taskUri, 'GET', '', idToken)
            .then(result => {

                if (result.httpStatus.httpStatus === 200) {

                    // 200 = data successfully returned. Sort the tasks, add the blank and update state.
                    let sortedTasksArray = result.data;

                    // Lazy fill: if any real task has null sort_order, assign sequential values and persist
                    const needsFill = sortedTasksArray.some(t => t.sort_order === null || t.sort_order === undefined);
                    if (needsFill) {
                        // Sort by priority first to establish initial hand-sort order
                        sortedTasksArray.sort((a, b) => taskPrioritySort(a, b));
                        const bulkUpdate = [];
                        sortedTasksArray.forEach((t, idx) => {
                            t.sort_order = idx;
                            bulkUpdate.push({ id: t.id, sort_order: idx });
                        });
                        let uri = `${darwinUri}/tasks`;
                        call_rest_api(uri, 'PUT', bulkUpdate, idToken).catch(() => {});
                    }

                    sortedTasksArray.sort((taskA, taskB) => activeSort(taskA, taskB));
                    sortedTasksArray.push({'id':'', 'description':'', 'priority': 0, 'done': 0, 'area_fk': parseInt(area.id), 'sort_order': null, 'creator_fk': profile.userName });
                    setTasksArray(sortedTasksArray);

                } else {
                    showError(result, 'Unable to read tasks')
                }


            }).catch(error => {
                if (error.httpStatus.httpStatus === 404) {

                    // 404 = no tasks currently in this area, so we can add the blank and be done
                    let sortedTasksArray = [];
                    sortedTasksArray.push({'id':'', 'description':'', 'priority': 0, 'done': 0, 'area_fk': parseInt(area.id), 'sort_order': null, 'creator_fk': profile.userName });
                    setTasksArray(sortedTasksArray);
                } else {
                    showError(error, 'Unable to read tasks')
                }
            });

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [taskApiTrigger]);

    const [{ isOver }, drop] = useDrop(() => ({

        accept: ["taskPlan", "areaCard"],

        drop: (item, monitor) => {
            if (monitor.getItemType() === "taskPlan") {
                return addTaskToArea(item);
            }
            // Cross-domain adopted area card
            if (item.sourceDomainId && item.sourceDomainId !== domainId) {
                return { crossDomain: true };
            }
            // Same-domain areaCard drops are handled via hover + drag end
        },

        hover: (item, monitor) => {
            if (monitor.getItemType() !== "areaCard") return;
            if (item.domainId !== domainId) return;
            if (isTemplate) return;
            const dragIndex = item.areaIndex;
            const hoverIndex = areaIndex;
            if (dragIndex === hoverIndex) {
                item.settled = true;
                return;
            }

            if (item.movePending) return;

            if (item.settled === false) return;

            moveCard(dragIndex, hoverIndex);
            item.areaIndex = hoverIndex;
            item.settled = false;

            // 150ms cooldown prevents cascading swaps when the cursor
            // moves through multiple cards in quick succession.
            item.movePending = true;
            setTimeout(() => {
                item.movePending = false;
            }, 150);
        },

        collect: (monitor) => ({
            isOver: monitor.isOver() && monitor.getItemType() === "areaCard",
        }),

    }), [tasksArray, areaIndex, domainId, isTemplate, moveCard]);

    const [{ isDragging }, drag] = useDrag(() => ({
        type: "areaCard",
        item: () => ({ areaId: area.id, areaIndex, domainId, areaData: { ...area } }),
        canDrag: () => !isTemplate,
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
        end: (item, monitor) => {
            const dropResult = monitor.getDropResult();
            if (dropResult && dropResult.crossDomain) {
                if (item.persistInTarget) item.persistInTarget();
                removeArea(item.areaId);
            } else {
                if (item.removeFromTarget) item.removeFromTarget();
                persistAreaOrder(monitor.didDrop());
                revertDragTabSwitch();
            }
        },
    }), [area, areaIndex, domainId, isTemplate, persistAreaOrder, removeArea, revertDragTabSwitch]);

    const cardRef = useRef(null);
    const mergedRef = useCallback((node) => {
        cardRef.current = node;
        drag(drop(node));
    }, [drag, drop]);

    const addTaskToArea = (task) => {

        console.log('addTaskToArea called');

        // Read insert index FIRST (before any early returns clear it)
        const insertIndex = crossCardInsertIndexRef.current;
        crossCardInsertIndexRef.current = null;

        // STEP 1: if we are dropping back to the same card, handle same-card reorder
        let matchTask = tasksArray.find( arrayTask => arrayTask.id === task.id)

        if (matchTask !== undefined) {
            // Same-card drop: reorder if hand-sorted with a valid insertion point
            if (sortMode === 'hand' && insertIndex !== null) {
                const draggedIdx = tasksArray.findIndex(t => t.id === task.id);
                if (draggedIdx === -1) return { task: null };

                // Short-circuit if dropped in same position
                const adjustedIndex = insertIndex > draggedIdx ? insertIndex - 1 : insertIndex;
                if (adjustedIndex === draggedIdx) return { task: null };

                const updated = [...tasksArray];
                const [moved] = updated.splice(draggedIdx, 1);
                updated.splice(adjustedIndex, 0, moved);

                // Renumber sort_orders and bulk PUT
                const bulkUpdate = [];
                updated.forEach((t, idx) => {
                    if (t.id !== '') {
                        t.sort_order = idx;
                        bulkUpdate.push({ id: t.id, sort_order: idx });
                    }
                });

                let taskUri = `${darwinUri}/tasks`;
                call_rest_api(taskUri, 'PUT', bulkUpdate, idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                            showError(result, 'Unable to save task sort order');
                        }
                    }).catch(error => {
                        showError(error, 'Unable to save task sort order');
                    });

                setTasksArray(updated);
            }
            // Return task: null so drag source's end handler knows this was same-card
            return { task: null };
        }

        // STEP 2: is a drop to a new card, update task with new data via API
        let taskUri = `${darwinUri}/tasks`;

        if (sortMode === 'hand' && insertIndex !== null) {
            // Hand-sorted target: insert at the tracked position
            const realTasks = tasksArray.filter(t => t.id !== '');
            const template = tasksArray.find(t => t.id === '');
            const clampedIndex = Math.min(insertIndex, realTasks.length);
            realTasks.splice(clampedIndex, 0, {...task, area_fk: parseInt(area.id)});

            // Renumber sort_orders and build bulk update
            const bulkUpdate = realTasks.map((t, idx) => {
                t.sort_order = idx;
                const update = { id: t.id, sort_order: idx };
                if (t.id === task.id) update.area_fk = parseInt(area.id);
                return update;
            });

            call_rest_api(taskUri, 'PUT', bulkUpdate, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        showError(result, "Unable to save task order");
                    }
                }).catch(error => {
                    showError(error, "Unable to save task order");
                });

            const final = [...realTasks];
            if (template) final.push(template);
            setTasksArray(final);
        } else {
            // Priority-sorted target or no specific position: append to bottom
            // Optimistic UI: update immediately, roll back on failure
            const maxSortOrder = Math.max(0, ...tasksArray.filter(t => t.id !== '').map(t => t.sort_order ?? 0));
            const newSortOrder = maxSortOrder + 1;

            var newTasksArray = [...tasksArray];
            task.sort_order = newSortOrder;
            task.area_fk = parseInt(area.id);
            newTasksArray.push(task);
            newTasksArray.sort((taskA, taskB) => activeSort(taskA, taskB));
            setTasksArray(newTasksArray);

            call_rest_api(taskUri, 'PUT', [{'id': task.id, 'area_fk': area.id, 'sort_order': newSortOrder }], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        // Roll back optimistic update
                        setTasksArray(prev => prev.filter(t => t.id !== task.id));
                        showError(result, "Unable to change task's area");
                    }
                }).catch(error => {
                    setTasksArray(prev => prev.filter(t => t.id !== task.id));
                    showError(error, "Unable to change task's area");
                });
        }

        // Return synchronously so drag source's end handler knows this was a real drop
        return {task: task.id};
    };

    const priorityClick = (taskIndex, taskId) => {

        // invert priority, resort task array for the card, update state.
        let newTasksArray = [...tasksArray]
        newTasksArray[taskIndex].priority = newTasksArray[taskIndex].priority ? 0 : 1;

        // for tasks already in the db, update db
        if (taskId !== '') {
            let uri = `${darwinUri}/tasks`;
            call_rest_api(uri, 'PUT', [{'id': taskId, 'priority': newTasksArray[taskIndex].priority}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        showError(result, "Unable to change task's priority")
                    }
                }).catch(error => {
                    showError(error, "Unable to change task's priority")
                }
            );
        } else if (savingRef.current) {
            // Template task with POST in-flight: queue for follow-up PUT
            pendingMutationsRef.current.priority = newTasksArray[taskIndex].priority;
        }
        
        // Only after database is updated, tasks and update state
        newTasksArray.sort((taskA, taskB) => activeSort(taskA, taskB));
        setTasksArray(newTasksArray);
    }

    const doneClick = (taskIndex, taskId) => {

        // invert done, update state
        let newTasksArray = [...tasksArray]
        newTasksArray[taskIndex].done = newTasksArray[taskIndex].done ? 0 : 1;
        setTasksArray(newTasksArray);

        // for tasks already in the db, update the db
        if (taskId !== '') {
            let uri = `${darwinUri}/tasks`;
            // toISOString converts to the SQL expected format and UTC from local time. They think of everything
            call_rest_api(uri, 'PUT', [{'id': taskId, 'done': newTasksArray[taskIndex].done,
                          ...(newTasksArray[taskIndex].done === 1 ? {'done_ts': new Date().toISOString()} : {'done_ts': 'NULL'})}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        showError(result, "Unable to mark task completed")
                    }
                }).catch(error => {
                    showError(error, "Unable to mark task completed")
                }
            );
        } else if (savingRef.current) {
            // Template task with POST in-flight: queue for follow-up PUT
            pendingMutationsRef.current.done = newTasksArray[taskIndex].done;
            pendingMutationsRef.current.done_ts = newTasksArray[taskIndex].done === 1
                ? new Date().toISOString() : 'NULL';
        }
    }

    const updateTask = (event, taskIndex, taskId) => {

        const noop = ()=>{};

        if ((taskId === '') &&
            (tasksArray[taskIndex].description === '')) {
            // new task with no description, noop
            noop();

        } else {
            // blank taskId indicates we are creating a new task rather than updating existing
            if (taskId === '') {
                saveTask(event, taskIndex)
            } else {
                let uri = `${darwinUri}/tasks`;
                call_rest_api(uri, 'PUT', [{'id': taskId, 'description': tasksArray[taskIndex].description}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 204) {
                            // database value is changed only with a 200/201 response
                            // so only then show snackbar
                            showError(result, 'Task description not updated, HTTP error')
                        }
                    }).catch(error => {
                        showError(error, 'Task description not updated, HTTP error')
                    });
            }
        }
    }

    const { fieldChange: descriptionChange, fieldKeyDown: descriptionKeyDown, fieldOnBlur: descriptionOnBlur } = useCrudCallbacks({
        items: tasksArray, setItems: setTasksArray, fieldName: 'description', saveFn: updateTask
    });

    const saveTask = (event, taskIndex) => {
        if (savingRef.current) return;
        savingRef.current = true;

        // Assign sort_order = max + 1 for new tasks
        const maxSortOrder = Math.max(0, ...tasksArray.filter(t => t.id !== '').map(t => t.sort_order ?? 0));
        const taskToSave = { ...tasksArray[taskIndex], sort_order: maxSortOrder + 1 };

        let uri = `${darwinUri}/tasks`;
        call_rest_api(uri, 'POST', taskToSave, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    // 200 => record added to database and returned in body
                    // show snackbar, place new data in table and created another blank element
                    let newTasksArray = [...tasksArray];
                    newTasksArray[taskIndex] = {...result.data[0]};

                    // Apply any mutations made while POST was in-flight (e.g. priority click)
                    const pending = pendingMutationsRef.current;
                    if (Object.keys(pending).length > 0) {
                        Object.assign(newTasksArray[taskIndex], pending);
                        call_rest_api(uri, 'PUT', [{'id': result.data[0].id, ...pending}], idToken)
                            .then(putResult => {
                                if (putResult.httpStatus.httpStatus !== 200) {
                                    showError(putResult, 'Unable to update task after save');
                                }
                            }).catch(putError => {
                                showError(putError, 'Unable to update task after save');
                            });
                    }

                    newTasksArray.sort((taskA, taskB) => activeSort(taskA, taskB));
                    newTasksArray.push({'id':'', 'description':'', 'priority': 0, 'done': 0, 'area_fk': area.id, 'sort_order': null, 'creator_fk': profile.userName });
                    setTasksArray(newTasksArray);
                } else if (result.httpStatus.httpStatus === 201) {
                    // 201 => record added to database but new data not returned in body
                    // flip read_rest_api state to initiate full data retrieval
                    triggerTaskRefresh();
                } else {
                    showError(result, 'Task not saved, HTTP error')
                }
            }).catch(error => {
                showError(error, 'Task not saved, HTTP error')
            }).finally(() => {
                savingRef.current = false;
                pendingMutationsRef.current = {};
            });
    }

    const deleteClick = (event, taskId) => {
        taskDelete.openDialog({taskId});
    }

    const taskPrioritySort = (taskA, taskB) => {
        // leave blanks in place
        if (taskA.id === '') return 1;
        if (taskB.id === '') return -1;

        if (taskA.priority === taskB.priority) {
            return 0;
        } else if (taskA.priority > taskB.priority) {
            return -1;
        } else {
            return 1;
        }
    }

    const taskHandSort = (taskA, taskB) => {
        // leave blanks in place
        if (taskA.id === '') return 1;
        if (taskB.id === '') return -1;

        const a = taskA.sort_order ?? Infinity;
        const b = taskB.sort_order ?? Infinity;
        return a - b;
    }

    const activeSort = (taskA, taskB) => {
        return sortMode === 'hand' ? taskHandSort(taskA, taskB) : taskPrioritySort(taskA, taskB);
    }


    return (
        <Card key={areaIndex} raised={true} ref={mergedRef}
              data-testid={area.id === '' ? 'area-card-template' : `area-card-${area.id}`}
              sx={{
                  opacity: isDragging ? 0.3 : area._isAdopted ? 0.5 : 1,
                  cursor: isTemplate ? 'default' : 'grab',
                  border: isOver && !isDragging ? '2px solid' : '2px solid transparent',
                  borderColor: isOver && !isDragging ? 'primary.main' : 'transparent',
              }}>
            <CardContent>
                <Box className="card-header" sx={{marginBottom: 2}}>
                    <TextField  /*variant={area.id === '' ? "outlined" : "standard"}*/
                                variant="standard"
                                value={area.area_name || ''}
                                name='area-name'
                                placeholder={area.id === '' ? 'Add new area' : undefined}
                                onChange= { (event) => areaChange(event, areaIndex) }
                                onKeyDown = {(event) => areaKeyDown(event, areaIndex, area.id)}
                                onBlur = {(event) => areaOnBlur(event, areaIndex, area.id)}
                                multiline
                                autoComplete='off'
                                size = 'small'
                                slotProps={{
                                    input: {...((area.id !== '') ? {disableUnderline: true} : (area.area_name !== '') && {disableUnderline: true} ), style: {fontSize: 24}},
                                    htmlInput: { maxLength: 32 }
                                }}
                                key={`area-${area.id}`}
                     />
                    {area.id !== '' && (
                        <>
                            <IconButton
                                onClick={handleMenuOpen}
                                data-testid={`card-menu-${area.id}`}
                                size="small"
                            >
                                <MoreVertIcon />
                            </IconButton>
                            <Menu
                                anchorEl={menuAnchorEl}
                                open={menuOpen}
                                onClose={handleMenuClose}
                                data-testid={`card-menu-popup-${area.id}`}
                                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                            >
                                <MenuItem
                                    onClick={(event) => { handleMenuClose(); changeSortMode(event, 'priority'); }}
                                    data-testid={`sort-priority-${area.id}`}
                                >
                                    <ListItemIcon><FlagIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>Priority Sort</ListItemText>
                                    {sortMode === 'priority' && <Check fontSize="small" sx={{ ml: 1 }} />}
                                </MenuItem>
                                <MenuItem
                                    onClick={(event) => { handleMenuClose(); changeSortMode(event, 'hand'); }}
                                    data-testid={`sort-hand-${area.id}`}
                                >
                                    <ListItemIcon><SwapVertIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>Hand Sort</ListItemText>
                                    {sortMode === 'hand' && <Check fontSize="small" sx={{ ml: 1 }} />}
                                </MenuItem>
                                <Divider />
                                <MenuItem
                                    onClick={(event) => { handleMenuClose(); clickCardClosed(event, area.area_name, area.id); }}
                                    data-testid={`menu-close-area-${area.id}`}
                                >
                                    <ListItemIcon><CloseIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>Close Area</ListItemText>
                                </MenuItem>
                                <Divider />
                                <MenuItem
                                    onClick={(event) => {
                                        handleMenuClose();
                                        const taskCount = tasksArray ? tasksArray.filter(t => t.id !== '').length : 0;
                                        clickCardDelete(event, area.area_name, area.id, taskCount);
                                    }}
                                    data-testid={`menu-delete-area-${area.id}`}
                                    sx={{ color: 'error.main' }}
                                >
                                    <ListItemIcon><DeleteForeverIcon fontSize="small" sx={{ color: 'error.main' }} /></ListItemIcon>
                                    <ListItemText>Delete Area</ListItemText>
                                </MenuItem>
                            </Menu>
                        </>
                    )}
                </Box>
                { (tasksArray) ?
                    <TaskActionsContext.Provider value={{ priorityClick, doneClick, descriptionChange,
                        descriptionKeyDown, descriptionOnBlur, deleteClick, tasksArray, setTasksArray,
                        sortMode, setCrossCardInsertIndex }}>
                        {tasksArray.map((task, taskIndex) => (
                            <TaskEdit {...{key: task.id, supportDrag: true, task, taskIndex,
                                areaId: area.id, areaName: area.area_name }}
                            />
                        ))}
                    </TaskActionsContext.Provider>
                  :
                    area.id  === '' ? '' : <CircularProgress/>
                }
            </CardContent>
            <TaskDeleteDialog deleteDialogOpen = {taskDelete.dialogOpen}
                              setDeleteDialogOpen = {taskDelete.setDialogOpen}
                              setDeleteId = {taskDelete.setInfoObject}
                              setDeleteConfirmed = {taskDelete.setConfirmed} />
        </Card>
    )
}

export default TaskCard