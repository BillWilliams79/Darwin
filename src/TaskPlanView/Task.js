import React from 'react'
import varDump from '../classifier/classifier';
import { useDrag } from "react-dnd";

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import ReportIcon from '@mui/icons-material/Report';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';


const Task = ({ task, taskIndex, priorityClick, doneClick, descriptionChange,
                descriptionKeyDown, descriptionOnBlur, deleteClick, tasksArray, setTasksArray }) => {

    const [{ isDragging }, drag] = useDrag(() => ({
        type: "taskPlan",
        item: {...task},
        end: (item, monitor) => removeTaskFromArea(item, monitor),
        collect: (monitor) => ({
          isDragging: !!monitor.isDragging(),
        }),
    }),[tasksArray]);

    const removeTaskFromArea = async (item, monitor) => {

        // getDropResult is finnicky. drag's end method is called immediately after
        // drop's drop method. getDropResult is suppoed to include the return value
        // from the drop method, however only values immediately returned from drop
        // method are available here. So it's not possible to call a rest API in drop
        // and then update the value for use here. So we can only use drop for
        // immediate fail cases such as dropping a task back to same card.
        var dropResult = monitor.getDropResult();

        // if task is null, we are dropping on ourselves and
        // no render Change is required
        // for now, an off target drop causes this to generate an exception, which stops 
        // the re-render below.  While that works, need a better solution
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
        <Box className="task"
             key={`box-${task.id}`}
             ref={task.id === '' ? null : drag}
             sx = {{...(isDragging && {opacity: 0.2}),}} 
        >
            <Checkbox
                checked = {task.priority ? true : false}
                onClick = {() => priorityClick(taskIndex, task.id)}
                icon={<ReportGmailerrorredOutlinedIcon />}
                checkedIcon={<ReportIcon />}
                key={`priority-${task.id}`}
            />
            <Checkbox
                checked = {task.done ? true : false}
                onClick = {() => doneClick(taskIndex, task.id)}
                icon={<CheckCircleOutlineIcon />}
                checkedIcon={<CheckCircleIcon />}
                key={`done-${task.id}`}
            /> 
            <TextField variant="outlined"
                        value={task.description || ''}
                        name='description'
                        onChange= { (event) => descriptionChange(event, taskIndex) }
                        onKeyDown = {(event) => descriptionKeyDown(event, taskIndex, task.id)}
                        onBlur = {(event) => descriptionOnBlur(event, taskIndex, task.id)}
                        multiline
                        autoComplete='off'
                        sx = {{...(task.done === 1 && {textDecoration: 'line-through'}),}}
                        size = 'small'
                        /* inputProps={{ tabIndex: `${taskIndex}` }} */
                        key={`description-${task.id}`}
             />
            { task.id === '' ?
                <IconButton key={`savings-${task.id}`}>
                    <SavingsIcon key={`savings1-${task.id}`}/>
                </IconButton>
                :
                <IconButton  onClick={(event) => deleteClick(event, task.id)} key={`delete-${task.id}`}>
                    <DeleteIcon key={`delete1-${task.id}`} />
                </IconButton>
            }
        </Box>
    )
}

export default Task
