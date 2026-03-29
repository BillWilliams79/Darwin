import React, { useEffect } from 'react';
import { useDragLayer } from 'react-dnd';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import ReportIcon from '@mui/icons-material/Report';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
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
    const { itemType, isDragging, item, currentClientOffset, initialClientOffset, initialSourceClientOffset } = useDragLayer((monitor) => ({
        item: monitor.getItem(),
        itemType: monitor.getItemType(),
        currentClientOffset: monitor.getClientOffset(),
        initialClientOffset: monitor.getInitialClientOffset(),
        initialSourceClientOffset: monitor.getInitialSourceClientOffset(),
        isDragging: monitor.isDragging(),
    }));

    useEffect(() => {
        if (isDragging) {
            document.body.style.userSelect = 'none';
            document.body.style.WebkitUserSelect = 'none';
        } else {
            document.body.style.userSelect = '';
            document.body.style.WebkitUserSelect = '';
            window.getSelection()?.removeAllRanges();
        }
        return () => {
            document.body.style.userSelect = '';
            document.body.style.WebkitUserSelect = '';
        };
    }, [isDragging]);

    if (!isDragging || !currentClientOffset || !initialClientOffset || !initialSourceClientOffset) {
        return null;
    }

    // Compute pointer-relative positioning that accounts for scale factor.
    // This keeps the preview anchored under the finger regardless of where
    // within the element the drag started.
    const getScaledTransform = (scale) => {
        const fingerOffsetX = initialClientOffset.x - initialSourceClientOffset.x;
        const fingerOffsetY = initialClientOffset.y - initialSourceClientOffset.y;
        const x = currentClientOffset.x - fingerOffsetX * scale;
        const y = currentClientOffset.y - fingerOffsetY * scale;
        return `translate(${x}px, ${y}px) scale(${scale})`;
    };

    if (itemType === 'domainTab') {
        const transform = getScaledTransform(0.75);
        return (
            <div style={layerStyles}>
                <Box sx={{
                    transform,
                    WebkitTransform: transform,
                    transformOrigin: 'top left',
                    width: item?.sourceWidth || 100,
                    height: item?.sourceHeight || 48,
                    opacity: 0.85,
                    bgcolor: 'background.paper',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '0 16px',
                    fontSize: '0.875rem',
                    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.02857em',
                    color: 'rgba(0, 0, 0, 0.6)',
                    whiteSpace: 'nowrap',
                    boxSizing: 'border-box',
                    borderBottom: '2px solid #1976d2',
                }}>
                    {item?.domainName || ''}
                    <CloseIcon sx={{ fontSize: '1.25rem', color: 'rgba(0, 0, 0, 0.54)' }} />
                </Box>
            </div>
        );
    }

    if (itemType === 'taskPlan') {
        const transform = getScaledTransform(0.67);
        return (
            <div style={layerStyles}>
                <Box className="task" sx={{
                    transform,
                    WebkitTransform: transform,
                    transformOrigin: 'top left',
                    width: item?.sourceWidth || 300,
                    opacity: 0.75,
                    bgcolor: 'background.paper',
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
    }

    return null;
};

export default TaskDragLayer;
