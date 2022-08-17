import React from 'react'
import varDump from '../classifier/classifier';

import { useDrag, useDrop } from "react-dnd";

import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import { Checkbox, Typography } from '@mui/material';
import { TextField } from '@mui/material';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';


const AreaTableRow = ({area, areaIndex, changeAreaName, keyDownAreaName, blurAreaName, clickAreaClosed, clickAreaDelete, taskCounts}) => {

    varDump({area, areaIndex, changeAreaName, keyDownAreaName,
        blurAreaName, clickAreaClosed, clickAreaDelete, taskCounts}, 'parameters')

    const [{ isDragging }, drag, preview] = useDrag(() => ({
        type: "areaEdit",
        item: {...area},
        //end: (item, monitor) => removeTaskFromDay(item, monitor),
        collect: (monitor) => ({
          isDragging: !!monitor.isDragging(),
        }),
    }),[]);

    const [, drop] = useDrop(() => ({

        accept: "areaEdit",

        //drop: (item) => addTaskToDay(item),

    }), []);


/*     const addTaskToDay = (task) => {

        // STEP 1: if we are dropping back to the same card, take no action
        let matchTask = tasksArray.find( arrayTask => arrayTask.id === task.id)

        if (matchTask !== undefined) {
            // there is a matching task so this is not a drop event
            // return object with task = null that's used in drag's end method
            return {task: null};
        }

        // STEP 2: is a drop to a new card, update task with new data via API
        let taskUri = `${darwinUri}/tasks`;

        call_rest_api(taskUri, 'POST', {'id': task.id, 'done_ts': dropDateString }, idToken)
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
 */
    return (
        <TableRow key={area.id}
                  ref={drag}
                  sx = {{...(isDragging && {opacity: 0.2}),}}
        >
            <TableCell> 
                <TextField variant="outlined"
                value={area.area_name || ''}
                name='area-name'
                onChange= { (event) => changeAreaName(event, areaIndex) }
                onKeyDown = {(event) => keyDownAreaName(event, areaIndex, area.id)}
                onBlur = {(event) => blurAreaName(event, areaIndex, area.id)}
                autoComplete='off'
                size = 'small'
                           key={`name-${area.id}`}
                />
            </TableCell>
            <TableCell> 
                <Checkbox checked = {(area.closed === 1) ? true : false }
                          onClick = {(event) => clickAreaClosed(event, areaIndex, area.id) }
                          key={`checked-${area.id}`}
                />
            </TableCell>
            <TableCell> {/* triple ternary checks all cases and display correct value */}
                <Typography variant='body1'>
                    { area.id === '' ? '' :
                        taskCounts[`${area.id}`] === undefined ? 0 :
                            taskCounts[`${area.id}`] === '' ? '' : taskCounts[`${area.id}`] 
                    }
                </Typography>
            </TableCell>
            <TableCell >
                { area.id === '' ?
                        <IconButton>
                            <SavingsIcon />
                        </IconButton>
                    :
                        <IconButton  onClick={(event) => clickAreaDelete(event, area.id, area.area_name)} >
                            <DeleteIcon />
                        </IconButton>
                }
            </TableCell>
        </TableRow>
    )
}

export default AreaTableRow;
