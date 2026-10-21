import React from 'react'
import { useReorderItem, reorderRowSx, isLiftBlur } from '../dnd';

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

export const areaItemId = (area) => (area.id === '' ? 'area:template' : `area:${area.id}`);

/** Open areas are the positions; closed areas and the template neither lift nor take a drop. */
export const isOrderableArea = (area) => area.id !== '' && area.closed === 0;

// The cells re-render when the area does, not on every pointer move of a drag.
const AreaCells = React.memo(({area, areaIndex, changeAreaName, keyDownAreaName, blurAreaName, clickAreaClosed, clickAreaDelete, taskCount, inputRef}) => (
    <>
        <Box sx={{ px: 1 }}>
            <TextField variant="outlined"
                       value={area.area_name || ''}
                       name='area-name'
                       onChange= { (event) => changeAreaName(event, areaIndex) }
                       onKeyDown = {(event) => keyDownAreaName(event, areaIndex, area.id)}
                       onBlur = {(event) => { if (!isLiftBlur(event)) blurAreaName(event, areaIndex, area.id); }}
                       autoComplete='off'
                       size = 'small'
                       fullWidth
                       slotProps={{ htmlInput: { maxLength: 32, ref: inputRef } }}
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
                    taskCount === undefined ? 0 :
                        taskCount === '' ? '' : taskCount
                }
            </Typography>
        </Box>
        <Box>
            { area.id === '' ?
                    <IconButton aria-label="Save area">
                        <SavingsIcon />
                    </IconButton>
                :
                    <IconButton aria-label="Delete area" onClick={(event) => clickAreaDelete(event, area.id, area.area_name)} >
                        <DeleteIcon />
                    </IconButton>
            }
        </Box>
    </>
));

// One row of the editor's ReorderList (req #3664): the whole row is the grip
// on an open area — a quick click still edits the name or ticks the box, a
// hold (touch, or a long mouse click) or a 4 px mouse move lifts it.
const AreaTableRow = ({area, taskCounts, ...cellProps}) => {
    const { ref, style, attributes, listeners, isDragging, draggable } = useReorderItem(areaItemId(area), area);

    return (
        <Box
            ref={ref}
            data-testid={area.id === '' ? 'area-row-template' : `area-row-${area.id}`}
            data-dragging={isDragging ? 'true' : undefined}
            {...(draggable ? { ...attributes, ...listeners } : {})}
            style={style}
            sx={(theme) => ({
                display: 'grid',
                gridTemplateColumns: AREA_GRID_COLUMNS,
                alignItems: 'center',
                py: 0.5,
                borderRadius: 1,
                ...reorderRowSx(theme, { draggable, isDragging }),
            })}
        >
            <AreaCells area={area} taskCount={taskCounts[`${area.id}`]} {...cellProps} />
        </Box>
    );
}

export default AreaTableRow;
