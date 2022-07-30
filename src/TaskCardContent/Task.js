import React from 'react'
import varDump from '../classifier/classifier';

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
                descriptionKeyDown, descriptionOnBlur, deleteClick, }) => {

    return (
        <Box className="task" key={`box-${task.id}`}>
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