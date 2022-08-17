import React from 'react'
import varDump from '../classifier/classifier';

import { useDrag } from "react-dnd";

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

    const [{ isDragging }, drag] = useDrag(() => ({
        type: "areaEdit",
        item: {...area},
        //end: (item, monitor) => removeTaskFromDay(item, monitor),
        collect: (monitor) => ({
          isDragging: !!monitor.isDragging(),
        }),
    }),[]);

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
            <TableCell>
                { area.id === '' ?
                        <IconButton >
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
