import '../index.css';
import varDump from '../classifier/classifier';
import call_rest_api from '../RestApi/RestApi';

import React, { useState, useEffect, useContext } from 'react'
import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';
import { useDrop } from "react-dnd";

import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import { Typography, Box } from '@mui/material';

import Task from './Task';

const DayView = (date) => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [tasksArray, setTasksArray] = useState();
    const [taskApiToggle, setTaskApiToggle] = useState(false);
    const [dropDateString, setDropDateString] = useState('');

    const [cardTitleDate, setCardTitleDate] = useState('');
    const [cardTitleDay, setCardTitleDay] = useState('');

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
        let taskUri = `${darwinUri}/tasks?creator_fk=${profile.userName}&done=1&filter_ts=(done_ts,${startDateString},${endDateString})&fields=id,description`

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

        call_rest_api(taskUri, 'POST', [{'id': task.id, 'done_ts': dropDateString }], idToken)
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
                    { tasksArray &&
                        tasksArray.map((task, taskIndex) => (
                            <Task key = {task.id}
                                  task = {task}
                                  taskIndex = {taskIndex}
                                  tasksArray = {tasksArray}
                                  setTasksArray = {setTasksArray} >
                            </Task>
                        ))
                    }
                </Box>
            </CardContent>
        </Card>
    )
}

export default DayView