// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, { useState, useEffect, useContext, useRef, useCallback, useMemo} from 'react'
import { useQueryClient } from '@tanstack/react-query';
import TaskEdit, { SortableTaskEdit } from '../Components/TaskEdit/TaskEdit';
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
import { TaskActionsContext, useStableTaskActions } from '../hooks/useTaskActions';
import { DarwinSortableList, useDarwinDrag, useDarwinDropZone, isLiftBlur } from '../dnd';
import { AREA_CARDS, AREA_TASKS, planIds, usePlanDragStore, usePlanSession, useRegisterPlanList } from './planDnd';
import { withPlacement } from './planMoves';

import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';

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


const TaskCard = ({area, areaIndex, domainId, areaChange, areaKeyDown, areaOnBlur, clickCardClosed, clickCardDelete, isTemplate, autoFocusTemplate, clearAutoFocusTemplate, domainActive = true }) => {

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

    // --- Drag and drop (req #3662) ---
    // The card lifts as a whole (anywhere on it — a press on one of its task
    // rows lifts that row instead) and is a position in its domain's grid. Its
    // task list is a drop zone: hand-sorted, it honours a position and its rows
    // slide aside; priority-sorted, it highlights and a drop appends. Every
    // drop is resolved by the page (usePlanDnd) against this registration.
    // The template card (one per domain, id '') is neither draggable nor a
    // drop zone, but its hooks still register — under ids no other domain's
    // template shares.
    const tasksListId = isTemplate ? `tasks-template:${domainId}` : planIds.tasks(area.id);
    const cardDrag = useDarwinDrag({
        id: isTemplate ? `area-template:${domainId}` : planIds.area(area.id),
        type: 'area',
        containerId: planIds.areas(domainId),
        policy: AREA_CARDS,
        row: area,
        // A hidden domain's cards take no part in a drag: dnd-kit measures and
        // collides only ENABLED zones, so they cost nothing until a hover-switch
        // shows their domain and switches them on.
        disabled: isTemplate || !domainActive,
        sortsOutside: true,
    });
    const { setNodeRef: tasksDropRef } = useDarwinDropZone({
        id: tasksListId, policy: AREA_TASKS, sortMode, disabled: isTemplate || !domainActive,
    });
    useRegisterPlanList(isTemplate ? null : tasksListId, {
        getItems: () => tasksArray || [],
        setItems: setTasksArray,
        ready: !!tasksArray,
        sortMode,
        areaId: area.id,
        sortRows: (rows) => [...rows].sort((a, b) => activeSort(a, b)),
    });
    const { active: dragActive, placement } = usePlanSession(tasksListId);
    const highlighted = usePlanDragStore(s => s.highlight === tasksListId);
    const renderedTasks = withPlacement(tasksArray, tasksListId,
        { active: dragActive, placement }, AREA_TASKS.isTarget);
    const sortableTaskIds = (renderedTasks || [])
        .filter(AREA_TASKS.isTarget)
        .map(task => planIds.task(task.id));

    const cardRef = useRef(null);
    const mergedRef = useCallback((node) => {
        cardRef.current = node;
        cardDrag.ref(node);
        tasksDropRef(node);
    }, [cardDrag.ref, tasksDropRef]);

    const priorityClick = (taskIndex, taskId) => {

        // invert priority, resort task array for the card, update state. A new
        // row object, never an in-place edit: rows are memoized on identity
        // (req #3662) and may be the query cache's own objects.
        let newTasksArray = [...tasksArray]
        newTasksArray[taskIndex] = { ...newTasksArray[taskIndex], priority: newTasksArray[taskIndex].priority ? 0 : 1 };

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

        // invert done, update state (a new row object — see priorityClick)
        let newTasksArray = [...tasksArray]
        newTasksArray[taskIndex] = { ...newTasksArray[taskIndex], done: newTasksArray[taskIndex].done ? 0 : 1 };

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


    // The card's header (the area-name field, the menu) is memoized for the
    // same reason as the rows: the card re-renders on every pointer move of a
    // drag, and an auto-sizing text field measures its layout each time it does.
    const header = useMemo(() => (
        <Box className="card-header" sx={{marginBottom: 2}}>
            <TextField  /*variant={area.id === '' ? "outlined" : "standard"}*/
                        variant="standard"
                        value={area.area_name || ''}
                        name='area-name'
                        placeholder={area.id === '' ? 'Add new area' : undefined}
                        onChange= { (event) => areaChange(event, areaIndex) }
                        onKeyDown = {(event) => areaKeyDown(event, areaIndex, area.id)}
                        onBlur = {(event) => { if (!isLiftBlur(event)) areaOnBlur(event, areaIndex, area.id); }}
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ), [area, areaIndex, sortMode, menuAnchorEl, tasksArray, areaChange, areaKeyDown, areaOnBlur,
        clickCardClosed, clickCardDelete]);

    // Rows re-render when the data changes, not on every pointer move (req #3662).
    const taskActions = useStableTaskActions({ priorityClick, doneClick, descriptionChange,
        descriptionKeyDown, descriptionOnBlur, deleteClick, tasksArray, setTasksArray, sortMode });

    return (
        <Card raised={true} ref={mergedRef}
              data-testid={area.id === '' ? 'area-card-template' : `area-card-${area.id}`}
              data-dragging={cardDrag.isDragging ? 'true' : undefined}
              data-drop-highlight={highlighted ? 'true' : undefined}
              {...(isTemplate ? {} : { ...cardDrag.attributes, ...cardDrag.listeners })}
              style={cardDrag.style}
              sx={(theme) => ({
                  // Animate the drag/drop visual states so the card lifts, dims and
                  // highlights smoothly instead of snapping (req #1923).
                  transition: 'opacity 160ms ease, border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease',
                  cursor: isTemplate ? 'default' : 'grab',
                  border: '2px solid',
                  borderColor: highlighted ? 'primary.main' : 'transparent',
                  '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                  // The slot a lifted card leaves: tinted, so the grid shows
                  // where it will land as its neighbours slide aside.
                  ...(cardDrag.isDragging && {
                      backgroundColor: alpha(theme.palette.primary.main, 0.08),
                      borderColor: alpha(theme.palette.primary.main, 0.45),
                      borderStyle: 'dashed',
                      boxShadow: 'none',
                      '& > *': { opacity: 0.3 },
                  }),
                  // Drop-target affordance: tint + lift so a card taking a task
                  // as a whole is unmistakable while the task hovers it.
                  ...(highlighted && {
                      backgroundColor: alpha(theme.palette.primary.main, 0.06),
                      boxShadow: `0 6px 18px ${alpha(theme.palette.primary.main, 0.35)}`,
                  }),
              })}>
            <CardContent>
                {header}
                { (tasksArray) ?
                    <TaskActionsContext.Provider value={taskActions}>
                        <DarwinSortableList id={tasksListId} items={sortableTaskIds}
                                            policy={AREA_TASKS} sortMode={sortMode}>
                        {renderedTasks.map((task) => {
                            // Handlers address rows by their index in tasksArray;
                            // a task carried in from another card mid-drag has none.
                            const rowProps = { task, taskIndex: tasksArray.indexOf(task),
                                areaId: area.id, areaName: area.area_name };
                            return AREA_TASKS.isTarget(task)
                                ? <SortableTaskEdit key={task.id} {...rowProps} drag={{
                                      id: planIds.task(task.id), type: 'task', disabled: !domainActive,
                                      containerId: tasksListId, policy: AREA_TASKS, sortMode }} />
                                : <TaskEdit key={task.id} {...rowProps} />;
                        })}
                        </DarwinSortableList>
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
