import '../index.css';
import varDump from '../classifier/classifier';
import call_rest_api from '../RestApi/RestApi';
import TaskEditDialog from '../Components/TaskEditDialog/TaskEditDialog';
import {SnackBar, snackBarError} from '../Components/SnackBar/SnackBar';


import React, { useState, useEffect, useContext } from 'react'
import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';
import { useDrop } from "react-dnd";

import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import { Typography, Box, CircularProgress } from '@mui/material';

import CalendarTask from './CalendarTask';

const DayView = (date) => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [tasksArray, setTasksArray] = useState();
    const [taskApiToggle, setTaskApiToggle] = useState(false);
    const [dropDateString, setDropDateString] = useState('');

    const [cardTitleDate, setCardTitleDate] = useState('');
    const [cardTitleDay, setCardTitleDay] = useState('');

    const [taskEditDialogOpen, setTaskEditDialogOpen] = useState(false);
    const [taskEditInfo, setTaskEditInfo] = useState({});

    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');

    // Yikes, have a dialog for this dialog
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleteConfirmed, setDeleteConfirmed] = useState(false);
    const [deleteId, setDeleteId] = useState({});

    // READ Task API data for card
    useEffect( () => {

        // if passed date is null, there's no work for useEffect
        if (date === null) {
            return;
        }

        // date passed is an object with an ISO string, create a date object
        // and the start date string for the URI
        var startDate = new Date(date.date);
        var startDateString = startDate.toISOString().slice(0,19);

        // Drap and drop uses and arbitrary date of noon for the new complete date
        var dragDate = new Date(date.date);
        dragDate.setTime(dragDate.getTime() + 12 * 60 * 60 * 1000)
        var dragDateString = dragDate.toISOString().slice(0,19);
        setDropDateString(dragDateString);

        // create the end date string for the URI
        var endDate = new Date(date.date);
        endDate.setDate(endDate.getDate() + 1);
        var endDateString = endDate.toISOString().slice(0,19);

        // set the date and day for the card title
        const date_options = {month: 'short', day: 'numeric'};
        setCardTitleDate(startDate.toLocaleDateString(undefined, date_options));
        const day_options = {weekday: 'long'};
        setCardTitleDay(startDate.toLocaleDateString(undefined, day_options));

        // FETCH TASKS: filter for creator, done=1 and props.date
        // QSPs limit fields to minimum: id,description
        let taskUri = `${darwinUri}/tasks?creator_fk=${profile.userName}&done=1&filter_ts=(done_ts,${startDateString},${endDateString})&fields=id,priority,done,description`

         call_rest_api(taskUri, 'GET', '', idToken)
            .then(result => {

                if (result.httpStatus.httpStatus === 200) {

                    // 200 = data successfully returned. Sort the tasks, add the blank and update state.
                    let sortedTasksArray = result.data;
                    setTasksArray(sortedTasksArray);

                } else {
                    varDump(result.httpStatus, `TaskCard UseEffect: error retrieving tasks`);

                }  

            }).catch(error => {

                if (error.httpStatus.httpStatus === 404) {

                    setTasksArray([]);

                } else {
                    varDump(error, `TaskCard UseEffect: error retrieving tasks`);
                }
            });

    }, [taskApiToggle]);

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
        setTaskEditDialogOpen(false);
        setTaskEditInfo({});

    }, [deleteConfirmed])

    // Drop support from drag and drop
    const [, drop] = useDrop(() => ({

        accept: "taskCalendar",

        drop: (item) => addTaskToDay(item),

    }), [dropDateString, tasksArray]);

    const addTaskToDay = (task) => {

        // STEP 1: if we are dropping back to the same card, take no action
        let matchTask = tasksArray.find( arrayTask => arrayTask.id === task.id)

        if (matchTask !== undefined) {
            // there is a matching task so this is not a drop event
            // return object with task = null that's used in drag's end method
            return {task: null};
        }

        // STEP 2: is a drop to a new card, update task with new data via API
        let taskUri = `${darwinUri}/tasks`;

        call_rest_api(taskUri, 'PUT', [{'id': task.id, 'done_ts': dropDateString }], idToken)
            .then(result => {

                if (result.httpStatus.httpStatus === 200) {

                    // STEP 3: Add moved task to this cards tasksArray
                    //         which triggers re-render.
                    var newTasksArray = [...tasksArray];
                    newTasksArray.push(task);
                    setTasksArray(newTasksArray);
                    return {task: task.id};

                } else {
                    varDump(result.httpStatus, `TaskCard UseEffect: error retrieving tasks`);
                    return {task: null};
                }  

            }).catch(error => {
                varDump(error, `TaskCard drop: error updating task with new Date`);
                return {task: null};
            });
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
                    if (result.httpStatus.httpStatus === 200) {

                        setTasksArray(newTasksArray);
                        
                    } else if (result.httpStatus.httpStatus > 204) {
                        snackBarError(result, "Unable to change task's priority", setSnackBarMessage, setSnackBarOpen)
                    }
                }).catch(error => {
                    snackBarError(error, "Unable to change task's priority", setSnackBarMessage, setSnackBarOpen)
                }
            );
        }
        
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
        // updated changes are written to rest API elsewhere (keyup for example)
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

    const deleteClick = (event, taskId) => {
        // stores data re: task to delete, opens dialog
        setDeleteId({taskId});
        setDeleteDialogOpen(true);
    }

/*     const taskPrioritySort = (taskA, taskB) => {
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
    }     */


    return (

        <Card key={date} raised={true} ref={drop}>
            <CardContent>
                <Box className="card-header" sx={{marginBottom: 2}}>
                    <Typography>
                        {cardTitleDate}
                    </Typography>
                    <Typography>
                        {cardTitleDay}
                    </Typography>
                </Box>
                <Box>
                    { tasksArray ?
                        tasksArray.map((task, taskIndex) => (
                            <CalendarTask {...{key: task.id, task, taskIndex, tasksArray,
                                               setTasksArray, setTaskEditInfo, setTaskEditDialogOpen}}
                            />
                            
                        ))
                      :
                        <CircularProgress/>
                    }
                </Box>
            </CardContent>
            <TaskEditDialog {...{ taskEditDialogOpen,
                                  setTaskEditDialogOpen,
                                  taskEditInfo,
                                  setTaskEditInfo,
                                  priorityClick,
                                  doneClick,
                                  descriptionChange,
                                  descriptionKeyDown,
                                  descriptionOnBlur,
                                  deleteClick,
                                  tasksArray,
                                  setTasksArray,
                                  taskApiToggle,
                                  setTaskApiToggle,
                                  deleteDialogOpen,
                                  setDeleteDialogOpen,
                                  setDeleteId,
                                  setDeleteConfirmed, }}
            />
            <SnackBar {...{snackBarOpen,
               setSnackBarOpen,
               snackBarMessage,}} />
        </Card>
    )
}

export default DayView