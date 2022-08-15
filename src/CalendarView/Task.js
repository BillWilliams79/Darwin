import React from 'react'
import varDump from '../classifier/classifier';

import { useDrag } from "react-dnd";

import Box from '@mui/material/Box';
import { Typography } from '@mui/material';


const Task = ({ task, taskIndex, tasksArray, setTasksArray /* priorityClick, doneClick, descriptionChange,
                descriptionKeyDown, descriptionOnBlur, deleteClick, */ }) => {

    const [{ isDragging }, drag] = useDrag(() => ({
        type: "taskCalendar",
        item: {...task},
        end: (item, monitor) => removeTaskFromDay(item, monitor),
        collect: (monitor) => ({
          isDragging: !!monitor.isDragging(),
        }),
    }),[tasksArray]);

    const removeTaskFromDay = async (item, monitor) => {

        // getDropResult is finnicky. drag's end method is called immediately after
        // drop's drop method. getDropResult is suppoed to include the return value
        // from the drop method, however only values immediately returned from drop
        // method are available here. So it's not possible to call a rest API in drop
        // and then update the value for use here. So we can only use drop for
        // immediate fail cases such as dropping a task back to same card.
        var dropResult = monitor.getDropResult();

        // if task is null, we are dropping on ourselves and
        // no render Change is required
        if (dropResult.task === null) {
            return;
        }

        // when dropResult.task is non-null, the task is moved off this card
        // so adjust state accordingly
        var newTasksArray = [...tasksArray];
        newTasksArray = newTasksArray.filter( task => task.id !== item.id);
        setTasksArray(newTasksArray);
    }

    return (
        <Box className="task-calendar" key={`box-${task.id}`} ref={drag}>
{/*             <TextField variant="outlined"
                        value={task.description || ''}
                        name='description'
                         onChange= { (event) => descriptionChange(event, taskIndex) }
                        onKeyDown = {(event) => descriptionKeyDown(event, taskIndex, task.id)}
                        onBlur = {(event) => descriptionOnBlur(event, taskIndex, task.id)}
                        multiline
                        autoComplete='off'
                        size = 'small'
                        key={`description-${task.id}`}
             /> */}
             <Typography key={`description-${task.id}`}
                         variant = 'body2' 
                         sx = {{...(isDragging && {opacity: 0.2}),}}
             >
                {task.description || ''}
             </Typography>
        </Box>
    )
}

export default Task