// eslint-disable-next-line no-unused-vars
import varDump from '../../classifier/classifier';

import React from 'react'

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


const TaskEdit = ({ supportDrag, task, taskIndex, priorityClick, doneClick, descriptionChange,
    descriptionKeyDown, descriptionOnBlur, deleteClick, tasksArray, setTasksArray, areaId, areaName,
    revertDragTabSwitch, clearDragTabSwitch }) => {

    const [{ isDragging }, drag] = useDrag(() => ({
        type: "taskPlan",
        item: {...task},
        end: (item, monitor) => removeTaskFromArea(item, monitor),
        collect: (monitor) => ({
          isDragging: !!monitor.isDragging(),
        }),
    }),[tasksArray]);

    const removeTaskFromArea = async (item, monitor) => {

        var dropResult = monitor.getDropResult();

        if (!dropResult || dropResult.task === null) {
            if (revertDragTabSwitch) revertDragTabSwitch();
            return;
        }

        // when dropResult.task is non-null, the task is moved off this card
        if (clearDragTabSwitch) clearDragTabSwitch();
        var newTasksArray = [...tasksArray];
        newTasksArray = newTasksArray.filter( task => task.id !== item.id);
        setTasksArray(newTasksArray);
    }

    return (
        <Box className="task"
             data-testid={task.id === '' ? 'task-template' : `task-${task.id}`}
             key={`box-${task.id}`}
             ref={task.id === '' ? null :
                  supportDrag === false ? null : drag}
             sx = {{...(isDragging && {opacity: 0.2}),}} 
        >
            <Checkbox
                checked = {task.priority ? true : false}
                onClick = {() => priorityClick(taskIndex, task.id)}
                icon={<ReportGmailerrorredOutlinedIcon />}
                checkedIcon={<ReportIcon />}
                disabled = {areaId !== '' ? false : areaName === '' ? true : false}
                key={`priority-${task.id}`}
                sx = {{maxWidth: "25px",
                       maxHeight: "25px",
                       mr: "2px",
                }}
            />
            <Checkbox
                checked = {task.done ? true : false}
                onClick = {() => doneClick(taskIndex, task.id)}
                icon={<CheckCircleOutlineIcon />}
                checkedIcon={<CheckCircleIcon />}
                disabled = {areaId !== '' ? false : areaName === '' ? true : false}
                key={`done-${task.id}`}
                sx = {{maxWidth: "25px",
                       maxHeight: "25px",
                       mr: "2px",
                }}
            /> 
            <TextField variant="outlined"
                        value={task.description || ''}
                        name='description'
                        onChange = {(event) => descriptionChange(event, taskIndex) }
                        onKeyDown = {(event) => descriptionKeyDown(event, taskIndex, task.id)}
                        onBlur = {(event) => descriptionOnBlur(event, taskIndex, task.id)}
                        multiline
                        disabled = {areaId !== '' ? false : areaName === '' ? true : false}
                        autoComplete ='off'
                        sx = {{...(task.done === 1 && {textDecoration: 'line-through'}),}}
                        size = 'small'
                        /* inputProps={{ tabIndex: `${taskIndex}` }} */
                        slotProps={{ htmlInput: { maxLength: 1024 } }}
                        key={`description-${task.id}`}
             />
            { task.id === '' ?
                <IconButton key={`savings-${task.id}`}
                            disabled = {areaId !== '' ? false : areaName === '' ? true : false}
                            sx = {{maxWidth: "25px",
                                   maxHeight: "25px",
                            }}
                >
                    <SavingsIcon key={`savings1-${task.id}`}/>
                </IconButton>
                :
                <IconButton  onClick={(event) => deleteClick(event, task.id)}
                             key={`delete-${task.id}`}
                             sx = {{maxWidth: "25px",
                                    maxHeight: "25px",
                             }}
                >
                    <DeleteIcon key={`delete1-${task.id}`} />
                </IconButton>
            }
        </Box>
    )
}

export default TaskEdit
