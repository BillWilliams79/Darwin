import React, { useEffect } from 'react';
import { useDragLayer } from 'react-dnd';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';

import DeleteIcon from '@mui/icons-material/Delete';
import LayersIcon from '@mui/icons-material/Layers';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import ReportIcon from '@mui/icons-material/Report';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';

const ANCHOR_WIDTH = 122;

const layerStyles = {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: 1500,
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function anchorLabel(item) {
    if (!item?.anchor_date) return '';
    const { recurrence, anchor_date } = item;
    if (recurrence === 'weekly') {
        const d = new Date(anchor_date + 'T12:00:00');
        return DAYS[d.getDay()] || '';
    }
    if (recurrence === 'monthly') {
        return String(parseInt(anchor_date.slice(8, 10), 10));
    }
    if (recurrence === 'annual') {
        const m = parseInt(anchor_date.slice(5, 7), 10) - 1;
        const d = parseInt(anchor_date.slice(8, 10), 10);
        return `${MONTHS[m]} ${d}`;
    }
    return '';
}

function formatRecurrence(r) {
    if (r === 'annual') return 'Yearly';
    if (!r) return '';
    return r.charAt(0).toUpperCase() + r.slice(1);
}

const selectSx = {
    '& .MuiSelect-icon': { display: 'none' },
    '& .MuiSelect-select': { pr: '8px !important' },
};

const RecurringTaskDragLayer = () => {
    const { item, itemType, isDragging, currentOffset } = useDragLayer((monitor) => ({
        item: monitor.getItem(),
        itemType: monitor.getItemType(),
        currentOffset: monitor.getSourceClientOffset(),
        isDragging: monitor.isDragging(),
    }));

    // Prevent text selection everywhere while a recurring task is being dragged
    useEffect(() => {
        document.body.style.userSelect = isDragging ? 'none' : '';
        return () => { document.body.style.userSelect = ''; };
    }, [isDragging]);

    if (!isDragging || itemType !== 'recurringTask' || !currentOffset) return null;

    const transform = `translate(${currentOffset.x}px, ${currentOffset.y}px) scale(0.67)`;
    const anchor = anchorLabel(item);

    return (
        <div style={layerStyles}>
            <Box sx={{
                transform,
                WebkitTransform: transform,
                transformOrigin: 'top left',
                // Match RecurringTaskRow grid exactly
                display: 'grid',
                gridTemplateColumns: `25px 25px 25px 1fr 105px ${ANCHOR_WIDTH}px 30px`,
                alignItems: 'center',
                width: item?.sourceWidth || 500,
                opacity: 0.75,
                background: '#fff',
                boxShadow: 3,
                borderRadius: 1,
            }}>
                {/* 1. Priority */}
                <Checkbox
                    checked={!!item?.priority}
                    readOnly
                    icon={<ReportGmailerrorredOutlinedIcon />}
                    checkedIcon={<ReportIcon />}
                    sx={{ maxWidth: 25, maxHeight: 25, mr: '2px' }}
                />

                {/* 2. Accumulate */}
                <IconButton size="small" sx={{ maxWidth: 25, maxHeight: 25, mr: '2px', p: 0 }}>
                    {item?.accumulate
                        ? <LayersIcon sx={{ fontSize: 16 }} />
                        : <SwapHorizIcon sx={{ fontSize: 16 }} />}
                </IconButton>

                {/* 3. Active */}
                <Checkbox
                    checked={!!item?.active}
                    readOnly
                    icon={<PauseCircleOutlineIcon />}
                    checkedIcon={<PlayCircleOutlineIcon color="success" />}
                    sx={{ maxWidth: 25, maxHeight: 25, mr: '2px' }}
                />

                {/* 4. Description */}
                <TextField
                    variant="outlined"
                    value={item?.description || ''}
                    size="small"
                    slotProps={{ input: { readOnly: true } }}
                    sx={{ width: '100%' }}
                />

                {/* 5. Recurrence */}
                <Box sx={{
                    width: 105,
                    px: 1,
                    fontSize: '0.875rem',
                    color: 'text.primary',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    py: '8.5px',
                    whiteSpace: 'nowrap',
                }}>
                    {formatRecurrence(item?.recurrence)}
                </Box>

                {/* 6. Anchor */}
                <Box sx={{
                    width: ANCHOR_WIDTH,
                    px: 1,
                    fontSize: '0.875rem',
                    color: 'text.primary',
                    ...(anchor && {
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        py: '8.5px',
                    }),
                    whiteSpace: 'nowrap',
                }}>
                    {anchor}
                </Box>

                {/* 7. Delete */}
                <IconButton size="small" sx={{ maxWidth: 28, maxHeight: 28, p: 0 }}>
                    <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
            </Box>
        </div>
    );
};

export default RecurringTaskDragLayer;
