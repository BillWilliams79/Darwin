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
import { Typography } from '@mui/material';


const Task = ({ task, taskIndex, /* priorityClick, doneClick, descriptionChange,
                descriptionKeyDown, descriptionOnBlur, deleteClick, */ }) => {

    return (
        <Box className="task-calendar" key={`box-${task.id}`}>
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
             <Typography key={`description-${task.id}`} variant = 'body2'>
                {task.description || ''}
             </Typography>
        </Box>
    )
}

export default Task