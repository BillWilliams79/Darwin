// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, { useState, useEffect, useContext, useRef, useCallback} from 'react'
import TaskEdit from '../Components/TaskEdit/TaskEdit';
import TaskDeleteDialog from '../Components/TaskDeleteDialog/TaskDeleteDialog';
import call_rest_api from '../RestApi/RestApi';
import {SnackBar, snackBarError} from '../Components/SnackBar/SnackBar';

import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';
import { useDrop, useDrag } from "react-dnd";

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import { CircularProgress } from '@mui/material';


const TaskCard = ({area, areaIndex, domainId, areaChange, areaKeyDown, areaOnBlur, clickCardClosed, moveCard, persistAreaOrder, removeArea, revertDragTabSwitch, clearDragTabSwitch, isTemplate }) => {

    // Task card is the list of tasks per area displayed in a card.
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    // Array of task objects
    const [tasksArray, setTasksArray] = useState()
    const [taskApiTrigger, setTaskApiTrigger] = useState(false); 

    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleteConfirmed, setDeleteConfirmed] = useState(false);
    const [deleteId, setDeleteId] = useState({});


    // READ Task API data for card
    useEffect( () => {

        console.count('useEffect: read task API data for a given area');

        // FETCH TASKS: filter for creator, done=0 and area.id
        // QSPs limit fields to minimum: id,priority,done,description,area_fk
        let taskUri = `${darwinUri}/tasks?creator_fk=${profile.userName}&done=0&area_fk=${area.id}&fields=id,priority,done,description,area_fk`

        call_rest_api(taskUri, 'GET', '', idToken)
            .then(result => {

                if (result.httpStatus.httpStatus === 200) {

                    // 200 = data successfully returned. Sort the tasks, add the blank and update state.
                    let sortedTasksArray = result.data;
                    sortedTasksArray.sort((taskA, taskB) => taskPrioritySort(taskA, taskB));
                    sortedTasksArray.push({'id':'', 'description':'', 'priority': 0, 'done': 0, 'area_fk': parseInt(area.id), 'creator_fk': profile.userName });
                    setTasksArray(sortedTasksArray);

                } else {
                    snackBarError(result, 'Unable to read tasks', setSnackBarMessage, setSnackBarOpen)
                }  


            }).catch(error => {
                if (error.httpStatus.httpStatus === 404) {

                    // 404 = no tasks currently in this area, so we can add the blank and be done
                    let sortedTasksArray = [];
                    sortedTasksArray.push({'id':'', 'description':'', 'priority': 0, 'done': 0, 'area_fk': parseInt(area.id), 'creator_fk': profile.userName });
                    setTasksArray(sortedTasksArray);
                } else {
                    snackBarError(error, 'Unable to read tasks', setSnackBarMessage, setSnackBarOpen)
                }
            });

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [taskApiTrigger]);

    // DELETE TASK in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: delete task');

        //TODO confirm deleteId is a valid object
        if (deleteConfirmed === true) {
            const {taskId} = deleteId;

            let uri = `${darwinUri}/tasks`;
            call_rest_api(uri, 'DELETE', {'id': taskId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // database task was deleted, update taskArray, pop snackbar, cleanup delete dialog
                        let newTasksArray = [...tasksArray]
                        newTasksArray = newTasksArray.filter(task => task.id !== taskId );
                        setTasksArray(newTasksArray);
                    } else {
                        snackBarError(result, 'Unable to delete task', setSnackBarMessage, setSnackBarOpen)
                    }
                }).catch(error => {
                    snackBarError(error, 'Unable to delete task', setSnackBarMessage, setSnackBarOpen)
                });
        }
        // prior to exit and regardless of outcome, clean up state
        setDeleteConfirmed(false);
        setDeleteId({});

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deleteConfirmed])

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

        // STEP 1: if we are dropping back to the same card, take no action
        let matchTask = tasksArray.find( arrayTask => arrayTask.id === task.id)

        if (matchTask !== undefined) {
            // there is a matching task so this is not a drop event
            // return object with task = null that's used in drag's end method
            console.log('no drop occurred')
            return {task: null};
        }

        // STEP 2: is a drop to a new card, update task with new data via API
        let taskUri = `${darwinUri}/tasks`;

        call_rest_api(taskUri, 'PUT', [{'id': task.id, 'area_fk': area.id }], idToken)
            .then(result => {

                if (result.httpStatus.httpStatus === 200) {

                    // STEP 3: Add moved task to this cards tasksArray, sort
                    //         and save state which triggers re-render.
                    var newTasksArray = [...tasksArray];
                    newTasksArray.push(task);
                    newTasksArray.sort((taskA, taskB) => taskPrioritySort(taskA, taskB));
                    setTasksArray(newTasksArray);

                } else {
                    snackBarError(result, "Unable to change task's date", setSnackBarMessage, setSnackBarOpen)
                }

            }).catch(error => {
                snackBarError(error, "Unable to change task's date", setSnackBarMessage, setSnackBarOpen)
            });

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
                        snackBarError(result, "Unable to change task's priority", setSnackBarMessage, setSnackBarOpen)
                    }
                }).catch(error => {
                    snackBarError(error, "Unable to change task's priority", setSnackBarMessage, setSnackBarOpen)
                }
            );
        }
        
        // Only after database is updated, tasks and update state
        newTasksArray.sort((taskA, taskB) => taskPrioritySort(taskA, taskB));
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
                        snackBarError(result, "Unable to mark task completed", setSnackBarMessage, setSnackBarOpen)
                    }
                }).catch(error => {
                    snackBarError(error, "Unable to mark task completed", setSnackBarMessage, setSnackBarOpen)
                }
            );
        }
    }

    const descriptionChange = (event, taskIndex) => {

        // event.target.value contains the new text from description which is retained in state
        // updated changes are written to rest API elsewhere (keydown for example)
        let newTasksArray = [...tasksArray]
        newTasksArray[taskIndex].description = event.target.value;
        setTasksArray(newTasksArray);
    }

    const descriptionKeyDown = (event, taskIndex, taskId) => {

        // Enter key triggers save, but Enter itself cannot be part of task.description hence preventDefault
        if (event.key === 'Enter') {
            updateTask(event, taskIndex, taskId);
            event.preventDefault();
        }

        // hack around: not escaping single parens so disallow for now
        if (event.key === "'") {
            event.preventDefault();
        }
    }

    const descriptionOnBlur= (event, taskIndex, taskId) => {

        updateTask(event, taskIndex, taskId);
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
                            snackBarError(result, 'Task description not updated, HTTP error', setSnackBarMessage, setSnackBarOpen)
                        }
                    }).catch(error => {
                        snackBarError(error, 'Task description not updated, HTTP error', setSnackBarMessage, setSnackBarOpen)
                    });
            }
        }
    }

    const saveTask = (event, taskIndex) => {
        let uri = `${darwinUri}/tasks`;
        call_rest_api(uri, 'POST', {...tasksArray[taskIndex]}, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    // 200 => record added to database and returned in body
                    // show snackbar, place new data in table and created another blank element
                    let newTasksArray = [...tasksArray];
                    newTasksArray[taskIndex] = {...result.data[0]};
                    newTasksArray.sort((taskA, taskB) => taskPrioritySort(taskA, taskB));
                    newTasksArray.push({'id':'', 'description':'', 'priority': 0, 'done': 0, 'area_fk': area.id, 'creator_fk': profile.userName });
                    setTasksArray(newTasksArray);
                } else if (result.httpStatus.httpStatus === 201) {
                    // 201 => record added to database but new data not returned in body
                    // flip read_rest_api state to initiate full data retrieval
                    setTaskApiTrigger(taskApiTrigger ? false : true);  
                } else {
                    snackBarError(result, 'Task not saved, HTTP error', setSnackBarMessage, setSnackBarOpen)
                }
            }).catch(error => {
                snackBarError(error, 'Task not saved, HTTP error', setSnackBarMessage, setSnackBarOpen)
            });
    }

    const deleteClick = (event, taskId) => {
        // stores data re: task to delete, opens dialog
        setDeleteId({taskId});
        setDeleteDialogOpen(true);
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

    return (
        <Card key={areaIndex} raised={true} ref={mergedRef}
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
                                /*label={((area.area_name !== '') && (area.id !== '')) ? '' : 'New Area Name'}*/
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
                    <IconButton onClick={(event) => clickCardClosed(event, area.area_name, area.id)} >
                        <CloseIcon />
                    </IconButton>
                </Box>
                { (tasksArray) ?
                    tasksArray.map((task, taskIndex) => (
                        <TaskEdit {...{key: task.id, supportDrag: true, task, taskIndex, priorityClick, doneClick, descriptionChange,
                            descriptionKeyDown, descriptionOnBlur, deleteClick, tasksArray, setTasksArray, areaId: area.id, areaName: area.area_name,
                            revertDragTabSwitch, clearDragTabSwitch }}
                        />
                    ))
                  :
                    area.id  === '' ? '' : <CircularProgress/>
                }
            </CardContent>
            <SnackBar {...{snackBarOpen,
                           setSnackBarOpen,
                           snackBarMessage,}} />
            <TaskDeleteDialog deleteDialogOpen = {deleteDialogOpen}
                              setDeleteDialogOpen = {setDeleteDialogOpen}
                              setDeleteId = {setDeleteId}
                              setDeleteConfirmed = {setDeleteConfirmed} />
        </Card>
    )
}

export default TaskCard