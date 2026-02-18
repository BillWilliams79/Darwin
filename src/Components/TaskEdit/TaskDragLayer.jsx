import React from 'react';
import { useDragLayer } from 'react-dnd';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import ReportIcon from '@mui/icons-material/Report';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import TextField from '@mui/material/TextField';

const layerStyles = {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: 1500,
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
};

const TaskDragLayer = () => {
    const { itemType, isDragging, item, currentOffset } = useDragLayer((monitor) => ({
        item: monitor.getItem(),
        itemType: monitor.getItemType(),
        currentOffset: monitor.getSourceClientOffset(),
        isDragging: monitor.isDragging(),
    }));

    if (!isDragging || itemType !== 'taskPlan' || !currentOffset) {
        return null;
    }

    const transform = `translate(${currentOffset.x}px, ${currentOffset.y}px) scale(0.67)`;

    return (
        <div style={layerStyles}>
            <Box className="task" sx={{
                transform,
                WebkitTransform: transform,
                transformOrigin: 'top left',
                width: item?.sourceWidth || 300,
                opacity: 0.75,
                background: '#fff',
                boxShadow: 3,
                borderRadius: 1,
            }}>
                <Checkbox
                    checked={item?.priority ? true : false}
                    icon={<ReportGmailerrorredOutlinedIcon />}
                    checkedIcon={<ReportIcon />}
                    sx={{ maxWidth: "25px", maxHeight: "25px", mr: "2px" }}
                />
                <Checkbox
                    checked={item?.done ? true : false}
                    icon={<CheckCircleOutlineIcon />}
                    checkedIcon={<CheckCircleIcon />}
                    sx={{ maxWidth: "25px", maxHeight: "25px", mr: "2px" }}
                />
                <TextField
                    variant="outlined"
                    value={item?.description || ''}
                    size="small"
                    slotProps={{ input: { readOnly: true } }}
                    sx={{...(item?.done === 1 && { textDecoration: 'line-through' })}}
                />
                <IconButton sx={{ maxWidth: "25px", maxHeight: "25px" }}>
                    <DeleteIcon />
                </IconButton>
            </Box>
        </div>
    );
};

export default TaskDragLayer;
