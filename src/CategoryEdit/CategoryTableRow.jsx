import React from 'react'
import { Draggable } from '@hello-pangea/dnd';

import Box from '@mui/material/Box';
import { Checkbox, Typography } from '@mui/material';
import { TextField } from '@mui/material';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';

export const CATEGORY_GRID_COLUMNS = {
    xs: '36px 1fr 42px 40px 40px',
    md: '36px 220px 70px 80px 48px',
};

const CategoryTableRow = ({category, categoryIndex, changeCategoryName, changeCategoryColor, keyDownCategoryName, blurCategoryName, clickCategoryClosed, clickCategoryDelete, requirementCounts, isDraggable, inputRef}) => {

    const row = (provided = {}, snapshot = {}) => (
        <Box
            ref={provided.innerRef}
            data-testid={category.id === '' ? 'category-row-template' : `category-row-${category.id}`}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            sx={{
                display: 'grid',
                gridTemplateColumns: CATEGORY_GRID_COLUMNS,
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
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <input
                    type="color"
                    value={category.color || '#4A90D9'}
                    onChange={(event) => changeCategoryColor(event, categoryIndex, category.id)}
                    style={{
                        width: 28,
                        height: 28,
                        padding: 0,
                        border: 'none',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        backgroundColor: 'transparent',
                    }}
                />
            </Box>
            <Box sx={{ px: 1 }}>
                <TextField variant="outlined"
                           value={category.category_name || ''}
                           name='category-name'
                           onChange= { (event) => changeCategoryName(event, categoryIndex) }
                           onKeyDown = {(event) => keyDownCategoryName(event, categoryIndex, category.id)}
                           onBlur = {(event) => blurCategoryName(event, categoryIndex, category.id)}
                           autoComplete='off'
                           size = 'small'
                           fullWidth
                           slotProps={{ htmlInput: { maxLength: 128, ref: inputRef } }}
                           key={`name-${category.id}`} />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Checkbox checked = {(category.closed === 1) ? true : false }
                          onClick = {(event) => clickCategoryClosed(event, categoryIndex, category.id) }
                          key={`checked-${category.id}`} />
            </Box>
            <Box sx={{ textAlign: 'center' }}>
                <Typography variant='body1'>
                    { category.id === '' ? '' :
                        requirementCounts[`${category.id}`] === undefined ? 0 :
                            requirementCounts[`${category.id}`] === '' ? '' : requirementCounts[`${category.id}`]
                    }
                </Typography>
            </Box>
            <Box>
                { category.id === '' ?
                        <IconButton>
                            <SavingsIcon />
                        </IconButton>
                    :
                        <IconButton onClick={(event) => clickCategoryDelete(event, category.id, category.category_name)} >
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
        <Draggable draggableId={`categoryId-${category.id}`} index={categoryIndex}>
            {(provided, snapshot) => row(provided, snapshot)}
        </Draggable>
    );
}

export default CategoryTableRow;
