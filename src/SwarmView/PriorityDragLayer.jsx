import React from 'react';
import { useDragLayer } from 'react-dnd';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import RocketIcon from '@mui/icons-material/Rocket';

const layerStyles = {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: 1500,
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
};

const PriorityDragLayer = () => {
    const { itemType, isDragging, item, currentOffset } = useDragLayer((monitor) => ({
        item: monitor.getItem(),
        itemType: monitor.getItemType(),
        currentOffset: monitor.getSourceClientOffset(),
        isDragging: monitor.isDragging(),
    }));

    if (!isDragging || !currentOffset || itemType !== 'priorityRow') {
        return null;
    }

    const transform = `translate(${currentOffset.x}px, ${currentOffset.y}px) scale(0.67)`;

    return (
        <div style={layerStyles}>
            <Box className="task priority-row" sx={{
                transform,
                WebkitTransform: transform,
                transformOrigin: 'top left',
                width: item?.sourceWidth || 300,
                opacity: 0.75,
                background: '#fff',
                boxShadow: 3,
                borderRadius: 1,
            }}>
                <ToggleButtonGroup
                    value="idle"
                    exclusive
                    size="small"
                    sx={{ height: 28, '& .MuiToggleButton-root': { px: 0.5, py: 0, minWidth: 28 } }}
                >
                    <ToggleButton value="idle" disabled><RocketIcon sx={{ fontSize: 18 }} /></ToggleButton>
                </ToggleButtonGroup>
                <TextField
                    variant="outlined"
                    value={item?.title || ''}
                    size="small"
                    slotProps={{ input: { readOnly: true } }}
                    sx={{...(item?.closed === 1 && { textDecoration: 'line-through' })}}
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-start', width: 56 }}>
                    <IconButton sx={{ maxWidth: "25px", maxHeight: "25px" }}>
                        <OpenInNewIcon />
                    </IconButton>
                    <IconButton sx={{ maxWidth: "25px", maxHeight: "25px" }}>
                        <DeleteIcon />
                    </IconButton>
                </Box>
            </Box>
        </div>
    );
};

export default PriorityDragLayer;
