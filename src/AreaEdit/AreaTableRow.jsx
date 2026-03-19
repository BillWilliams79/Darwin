import React from 'react'
import { Draggable } from '@hello-pangea/dnd';

import Box from '@mui/material/Box';
import { Checkbox, Typography } from '@mui/material';
import { TextField } from '@mui/material';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';

export const AREA_GRID_COLUMNS = {
    xs: '1fr 42px 40px 40px',
    md: '220px 70px 80px 48px',
};

const AreaTableRow = ({area, areaIndex, changeAreaName, keyDownAreaName, blurAreaName, clickAreaClosed, clickAreaDelete, taskCounts, isDraggable}) => {

    const row = (provided = {}, snapshot = {}) => (
        <Box
            ref={provided.innerRef}
            data-testid={area.id === '' ? 'area-row-template' : `area-row-${area.id}`}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            sx={{
                display: 'grid',
                gridTemplateColumns: AREA_GRID_COLUMNS,
                alignItems: 'center',
                py: 0.5,
                ...(snapshot.isDragging && {
                    backgroundColor: 'background.paper',
                    boxShadow: 3,
                    opacity: 0.9,
                    borderRadius: 1,
                }),
            }}
        >
            <Box sx={{ px: 1 }}>
                <TextField variant="outlined"
                           value={area.area_name || ''}
                           name='area-name'
                           onChange= { (event) => changeAreaName(event, areaIndex) }
                           onKeyDown = {(event) => keyDownAreaName(event, areaIndex, area.id)}
                           onBlur = {(event) => blurAreaName(event, areaIndex, area.id)}
                           autoComplete='off'
                           size = 'small'
                           fullWidth
                           slotProps={{ htmlInput: { maxLength: 32 } }}
                           key={`name-${area.id}`} />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Checkbox checked = {(area.closed === 1) ? true : false }
                          onClick = {(event) => clickAreaClosed(event, areaIndex, area.id) }
                          key={`checked-${area.id}`} />
            </Box>
            <Box sx={{ textAlign: 'center' }}>
                <Typography variant='body1'>
                    { area.id === '' ? '' :
                        taskCounts[`${area.id}`] === undefined ? 0 :
                            taskCounts[`${area.id}`] === '' ? '' : taskCounts[`${area.id}`]
                    }
                </Typography>
            </Box>
            <Box>
                { area.id === '' ?
                        <IconButton>
                            <SavingsIcon />
                        </IconButton>
                    :
                        <IconButton onClick={(event) => clickAreaDelete(event, area.id, area.area_name)} >
                            <DeleteIcon />
                        </IconButton>
                }
            </Box>
        </Box>
    );

    if (!isDraggable) {
        return row();
    }

    return (
        <Draggable draggableId={`areaId-${area.id}`} index={areaIndex}>
            {(provided, snapshot) => row(provided, snapshot)}
        </Draggable>
    );
}

export default AreaTableRow;
