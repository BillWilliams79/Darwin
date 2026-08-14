// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, { useState, useEffect, useContext, useRef, useCallback} from 'react'
import { useQueryClient } from '@tanstack/react-query';
import TaskEdit from '../Components/TaskEdit/TaskEdit';
import TaskDeleteDialog from '../Components/TaskDeleteDialog/TaskDeleteDialog';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useTasks, useTasksClosed } from '../hooks/useDataQueries';
import { taskKeys } from '../hooks/useQueryKeys';
import { useClosedTasksStore } from '../stores/useClosedTasksStore';
import { taskGroupRank, closedTaskSort, isOrderableTask, isClosedHistory,
         clearClosedHistory, buildClosedRows, mergeClosedRows } from './closedTasks';
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
import { alpha } from '@mui/material/styles';


const TaskCard = ({area, areaIndex, domainId, areaChange, areaKeyDown, areaOnBlur, clickCardClosed, clickCardDelete, moveCard, persistAreaOrder, removeArea, isTemplate, autoFocusTemplate, clearAutoFocusTemplate, domainActive = true }) => {

    const revertDragTabSwitch = useDragTabStore(s => s.revertDragTabSwitch);

    // Task card is the list of tasks per area displayed in a card.
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    // Array of task objects
    const [tasksArray, setTasksArray] = useState()

    // Guards against race condition: priority/done clicks during in-flight POST
    const savingRef = useRef(false);
    const pendingMutationsRef = useRef({});

    // Focus template task description when this is a newly created area
    useEffect(() => {
        if (autoFocusTemplate && tasksArray && cardRef.current) {
            const textarea = cardRef.current.querySelector('[data-testid="task-template"] [name="description"]');
            if (textarea) textarea.focus();
            clearAutoFocusTemplate();
        }
    }, [autoFocusTemplate, tasksArray]);

    // Sort mode: 'priority' (default) or 'hand' — persisted in DB (areas.sort_mode)
    const [sortMode, setSortMode] = useState(area.sort_mode || 'priority');

    // TanStack Query — fetch open tasks for this area
    const { data: serverTasks } = useTasks(profile?.userName, area.id, {
        enabled: area.id !== '',
    });

    // req #3506 — the page-wide "Closed" window. `null` (the default) disables
    // the query entirely, so a card costs exactly what it always did until the
    // option is switched on. `domainActive` keeps the fan-out to the domain the
    // user is actually looking at: inactive tab panels stay MOUNTED (they are
    // hidden, not unmounted), so without it switching the option on would fire
    // one request per area across every domain in the account, and again on
    // every rolling-window refetch.
    const closedWindow = useClosedTasksStore(s => s.closedWindow);
    const { data: serverClosedTasks, isError: closedError, error: closedErrorObj } =
        useTasksClosed(profile?.userName, area.id, closedWindow, {
            enabled: area.id !== '' && domainActive,
        });

    // A "Closed" button that silently does nothing is worse than one that says
    // why — `fetchEntity` throws on any non-2xx and the card would otherwise
    // just render no history.
    useEffect(() => {
        if (closedError) showError(closedErrorObj, 'Unable to load closed tasks');
    }, [closedError]);

    // Which `serverTasks` reference the open half of the array was last built
    // from. The closed window refetches on its own schedule, and re-seeding the
    // OPEN rows on its cadence would discard whatever the user is typing — so a
    // closed-only change takes the fast path below and never rebuilds them.
    const seededFromRef = useRef(null);

    // The template row is the only row holding text with no server counterpart,
    // so a re-seed must carry the live one forward rather than replace it with a
    // blank literal — otherwise a refetch landing mid-sentence erases what the
    // user is typing.
    const carriedTemplate = (prev) =>
        prev?.find(t => t.id === '')
        || {'id':'', 'description':'', 'priority': 0, 'done': 0, 'area_fk': parseInt(area.id), 'sort_order': null };

    // Seed local state from query data (hybrid pattern — local state owns DnD + template)
    useEffect(() => {
        const closedRows = closedWindow
            ? buildClosedRows(serverClosedTasks, (serverTasks || []).map(t => t.id))
            : [];

        // Only the closed window moved: swap the history below the template and
        // leave every live row — and the template's unsaved text — untouched.
        // `mergeClosedRows` owns the three rules that makes safe.
        if (seededFromRef.current === serverTasks) {
            setTasksArray(prev => prev ? mergeClosedRows(prev, closedRows) : prev);
            return;
        }

        if (serverTasks && serverTasks.length > 0) {
            seededFromRef.current = serverTasks;
            let sortedTasksArray = [...serverTasks];

            // Lazy fill: if any real task has null sort_order, assign sequential values and persist.
            // Reached once per `serverTasks` identity — the guard above is what
            // bounds it now that the effect has a second, faster trigger.
            const needsFill = sortedTasksArray.some(t => t.sort_order === null || t.sort_order === undefined);
            if (needsFill) {
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
            setTasksArray(prev => [...sortedTasksArray, carriedTemplate(prev), ...closedRows]);
        } else if (serverTasks && serverTasks.length === 0) {
            seededFromRef.current = serverTasks;
            setTasksArray(prev => [carriedTemplate(prev), ...closedRows]);
        }
    }, [serverTasks, serverClosedTasks, closedWindow]);

    // For template cards (area.id === ''), set up empty tasks array
    useEffect(() => {
        if (area.id === '' && !tasksArray) {
            setTasksArray(undefined);
        }
    }, [area.id]);

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
                        // Also clean up any priority_card_order record
                        call_rest_api(`${darwinUri}/priority_card_order`, 'DELETE',
                            { domain_id: domainId, task_id: taskId }, idToken);
                        let newTasksArray = [...tasksArray]
                        newTasksArray = newTasksArray.filter(task => task.id !== taskId );
                        setTasksArray(newTasksArray);
                        queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to delete task')
                    }
                }).catch(error => {
                    showError(error, 'Unable to delete task')
                });
        }
    });

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

            // Short cooldown prevents cascading swaps when the cursor moves through
            // multiple cards in quick succession. Tightened 150ms→90ms (req #1923) so
            // the card-switch path feels more responsive while still suppressing thrash.
            item.movePending = true;
            setTimeout(() => {
                item.movePending = false;
            }, 90);
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

                // Renumber sort_orders and bulk PUT. `isOrderableTask` skips the
                // template row and — since req #3506 — any closed row parked at
                // the bottom of the card: a closed task's stored position is
                // history and must survive a live reorder above it.
                const bulkUpdate = [];
                updated.forEach((t, idx) => {
                    if (isOrderableTask(t)) {
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
            // Hand-sorted target: insert at the tracked position.
            // `isOrderableTask` keeps closed rows (req #3506) out of the
            // renumbering entirely — they are re-appended below, unchanged.
            const realTasks = tasksArray.filter(isOrderableTask);
            const template = tasksArray.find(t => t.id === '');
            const closedRows = tasksArray.filter(isClosedHistory);
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
            final.push(...closedRows);
            setTasksArray(final);
        } else {
            // Priority-sorted target or no specific position: append to bottom
            // Optimistic UI: update immediately, roll back on failure
            const maxSortOrder = Math.max(0, ...tasksArray.filter(isOrderableTask).map(t => t.sort_order ?? 0));
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
                    if (result.httpStatus.httpStatus > 204) {
                        showError(result, "Unable to change task's priority")
                    } else {
                        // Invalidate AFTER PUT completes so PriorityCard refetches current server state
                        queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
                    }
                }).catch(error => {
                    showError(error, "Unable to change task's priority")
                }
            );
            // If priority was toggled OFF, clean up any priority_card_order record for this domain
            if (newTasksArray[taskIndex].priority === 0) {
                call_rest_api(`${darwinUri}/priority_card_order`, 'DELETE',
                    { domain_id: domainId, task_id: taskId }, idToken);
            }
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

        // Read the new value BEFORE any re-sort below — everything after this
        // point uses `nextDone` rather than re-reading `newTasksArray[taskIndex]`,
        // which a sort would repoint at a different row.
        const nextDone = newTasksArray[taskIndex].done;

        // req #3506 — re-opening a history row makes it live work again. It has
        // to leave the closed group in the SAME act, because every callback here
        // addresses a row by its index: leaving it parked below the template
        // while it counts as orderable would aim hand-sort insertions one slot
        // wide for as long as it sat there. Closing a row is deliberately NOT
        // re-sorted — that row stays put with a strikethrough, exactly as it did
        // before this option existed.
        if (nextDone === 0 && isClosedHistory(newTasksArray[taskIndex])) {
            newTasksArray[taskIndex] = clearClosedHistory(newTasksArray[taskIndex]);
            newTasksArray.sort((taskA, taskB) => activeSort(taskA, taskB));
        }
        setTasksArray(newTasksArray);

        // for tasks already in the db, update the db
        if (taskId !== '') {
            let uri = `${darwinUri}/tasks`;
            // toISOString converts to the SQL expected format and UTC from local time. They think of everything
            call_rest_api(uri, 'PUT', [{'id': taskId, 'done': nextDone,
                          ...(nextDone === 1 ? {'done_ts': new Date().toISOString()} : {'done_ts': 'NULL'})}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus > 204) {
                        showError(result, "Unable to mark task completed")
                    } else {
                        // Invalidate AFTER PUT completes so PriorityCard refetches current server state
                        queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
                    }
                }).catch(error => {
                    showError(error, "Unable to mark task completed")
                }
            );
            // If marked done, clean up any priority_card_order record for this domain
            if (nextDone === 1) {
                call_rest_api(`${darwinUri}/priority_card_order`, 'DELETE',
                    { domain_id: domainId, task_id: taskId }, idToken);
            }
        } else if (savingRef.current) {
            // Template task with POST in-flight: queue for follow-up PUT
            pendingMutationsRef.current.done = nextDone;
            pendingMutationsRef.current.done_ts = nextDone === 1
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
        const maxSortOrder = Math.max(0, ...tasksArray.filter(isOrderableTask).map(t => t.sort_order ?? 0));
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
                    const hasPending = Object.keys(pending).length > 0;
                    if (hasPending) {
                        Object.assign(newTasksArray[taskIndex], pending);
                        // Fire follow-up PUT and defer cache invalidation until it completes —
                        // otherwise the refetch can race the PUT and overwrite the just-set fields
                        // with the POST's original values (priority=0, done=0).
                        call_rest_api(uri, 'PUT', [{'id': result.data[0].id, ...pending}], idToken)
                            .then(putResult => {
                                if (putResult.httpStatus.httpStatus > 204) {
                                    showError(putResult, 'Unable to update task after save');
                                }
                            }).catch(putError => {
                                showError(putError, 'Unable to update task after save');
                            }).finally(() => {
                                queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
                            });
                    }

                    // PUSH THEN SORT, not sort then push (req #3506): the array
                    // can now end with history rows, so appending the fresh
                    // template would leave the card's live edge below them —
                    // arbitrarily far down under "All". The comparator ranks the
                    // template between the live rows and the history, so letting
                    // it place the row is what keeps that invariant.
                    newTasksArray.push({'id':'', 'description':'', 'priority': 0, 'done': 0, 'area_fk': area.id, 'sort_order': null });
                    newTasksArray.sort((taskA, taskB) => activeSort(taskA, taskB));
                    setTasksArray(newTasksArray);
                    if (!hasPending) {
                        queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
                    }
                } else if (result.httpStatus.httpStatus === 201) {
                    // 201 => record added to database but new data not returned in body
                    queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) });
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
        const task = tasksArray?.find(t => t.id === taskId);
        taskDelete.openDialog({ taskId, description: task?.description || '', priority: task?.priority, done: task?.done });
    }

    // req #3506 — open tasks, then the template row, then closed tasks. Both
    // comparators open with it so every re-sort (mode change, priority click,
    // save, cross-card drop) lands closed rows in the same place.
    const taskGroupSort = (taskA, taskB) => taskGroupRank(taskA) - taskGroupRank(taskB);

    const taskPrioritySort = (taskA, taskB) => {
        const byGroup = taskGroupSort(taskA, taskB);
        if (byGroup !== 0) return byGroup;
        // within the closed group, most recently closed first
        if (isClosedHistory(taskA) && isClosedHistory(taskB)) return closedTaskSort(taskA, taskB);
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
        const byGroup = taskGroupSort(taskA, taskB);
        if (byGroup !== 0) return byGroup;
        // within the closed group, most recently closed first
        if (isClosedHistory(taskA) && isClosedHistory(taskB)) return closedTaskSort(taskA, taskB);
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
              sx={(theme) => ({
                  // Animate the drag/drop visual states so the card lifts, dims and
                  // highlights smoothly instead of snapping (req #1923).
                  transition: 'opacity 160ms ease, border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease',
                  opacity: isDragging ? 0.3 : area._isAdopted ? 0.5 : 1,
                  cursor: isTemplate ? 'default' : 'grab',
                  border: '2px solid',
                  borderColor: isOver && !isDragging ? 'primary.main' : 'transparent',
                  // Drop-target affordance: tint + lift so the destination card is
                  // unmistakable while a card is dragged over it.
                  ...(isOver && !isDragging && {
                      backgroundColor: alpha(theme.palette.primary.main, 0.06),
                      boxShadow: `0 6px 18px ${alpha(theme.palette.primary.main, 0.35)}`,
                  }),
              })}>
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
                                aria-label="Area card menu"
                                data-testid={`card-menu-${area.id}`}
                                size="small"
                                sx={{ maxWidth: "25px", maxHeight: "25px" }}
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
                                        // Open tasks only — the delete warning is about work
                                        // that would be lost, not about closed history the
                                        // "Closed" option happens to be showing (req #3506).
                                        const taskCount = tasksArray ? tasksArray.filter(isOrderableTask).length : 0;
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
                            <TaskEdit key={task.id} {...{supportDrag: !isClosedHistory(task), task, taskIndex,
                                areaId: area.id, areaName: area.area_name }}
                            />
                        ))}
                    </TaskActionsContext.Provider>
                  :
                    area.id  === '' ? '' : <CircularProgress/>
                }
            </CardContent>
            <TaskDeleteDialog deleteDialogOpen={taskDelete.dialogOpen}
                              setDeleteDialogOpen={taskDelete.setDialogOpen}
                              setDeleteId={taskDelete.setInfoObject}
                              setDeleteConfirmed={taskDelete.setConfirmed}
                              task={taskDelete.infoObject} />
        </Card>
    )
}

export default TaskCard
