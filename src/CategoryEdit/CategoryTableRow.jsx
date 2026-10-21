import React from 'react'
import { useReorderItem, reorderRowSx, isLiftBlur } from '../dnd';

import Box from '@mui/material/Box';
import { Checkbox, Typography } from '@mui/material';
import { TextField } from '@mui/material';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

export const CATEGORY_GRID_COLUMNS = {
    xs: '24px 36px 1fr 42px 40px 40px',
    md: '28px 36px 220px 70px 80px 48px',
};

export const categoryItemId = (category) => (category.id === '' ? 'category:template' : `category:${category.id}`);

/** Open categories are the positions; closed categories and the template neither lift nor take a drop. */
export const isOrderableCategory = (category) => category.id !== '' && category.closed === 0;

// Memoized (req #2865): the cells re-render when the category does, not on
// every pointer move of a drag — the row around them re-renders with the drag.
const CategoryCells = React.memo(({category, categoryIndex, changeCategoryName, changeCategoryColor, keyDownCategoryName, blurCategoryName, clickCategoryClosed, clickCategoryDelete, requirementCount, draggable, inputRef}) => (
    <>
        {/* The grip mark: the whole row is the grip (req #3664 — a press on the
            colour, the name or the box lifts it too, while a quick click still
            uses them), the mark just says so. */}
        <Box
            data-testid={draggable ? `category-drag-handle-${category.id}` : undefined}
            sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                color: 'text.disabled',
            }}
        >
            { draggable ? <DragIndicatorIcon fontSize="small" /> : null }
        </Box>
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
                       onBlur = {(event) => { if (!isLiftBlur(event)) blurCategoryName(event, categoryIndex, category.id); }}
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
                    requirementCount === undefined ? 0 :
                        requirementCount === '' ? '' : requirementCount
                }
            </Typography>
        </Box>
        <Box>
            { category.id === '' ?
                    <IconButton aria-label="Save category">
                        <SavingsIcon />
                    </IconButton>
                :
                    <IconButton aria-label="Delete category" onClick={(event) => clickCategoryDelete(event, category.id, category.category_name)} >
                        <DeleteIcon />
                    </IconButton>
            }
        </Box>
    </>
));

CategoryCells.displayName = 'CategoryCells';

// One row of the editor's ReorderList (req #3664): the whole row is the grip
// on an open category — a quick click still edits, a hold (touch, or a long
// mouse click) or a 4 px mouse move lifts it.
const CategoryTableRow = ({category, requirementCounts, ...cellProps}) => {
    const { ref, style, attributes, listeners, isDragging, draggable } = useReorderItem(categoryItemId(category), category);

    return (
        <Box
            ref={ref}
            data-testid={category.id === '' ? 'category-row-template' : `category-row-${category.id}`}
            data-dragging={isDragging ? 'true' : undefined}
            {...(draggable ? { ...attributes, ...listeners } : {})}
            style={style}
            sx={(theme) => ({
                display: 'grid',
                gridTemplateColumns: CATEGORY_GRID_COLUMNS,
                alignItems: 'center',
                py: 0.5,
                borderRadius: 1,
                ...reorderRowSx(theme, { draggable, isDragging }),
            })}
        >
            <CategoryCells category={category}
                           requirementCount={requirementCounts[`${category.id}`]}
                           draggable={draggable}
                           {...cellProps} />
        </Box>
    );
};

export default CategoryTableRow;
