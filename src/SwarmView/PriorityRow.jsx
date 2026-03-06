import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom';

import { useDrag, useDrop } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { usePriorityActions } from '../hooks/usePriorityActions';

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HotelIcon from '@mui/icons-material/Hotel';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';


const PriorityRow = ({ supportDrag, priority, priorityIndex, categoryId, categoryName }) => {

    const navigate = useNavigate();
    const { inProgressClick, closedClick, scheduledClick, titleChange, titleKeyDown,
        titleOnBlur, deleteClick, prioritiesArray, setPrioritiesArray,
        sortMode, setCrossCardInsertIndex, sessionStatusMap } = usePriorityActions();
    const [insertIndicator, setInsertIndicator] = useState(null);
    const revertDragTabSwitch = useSwarmTabStore(s => s.revertDragTabSwitch);
    const clearDragTabSwitch = useSwarmTabStore(s => s.clearDragTabSwitch);

    const [{ isDragging }, drag, preview] = useDrag(() => ({
        type: "priorityRow",
        item: () => {
            const rect = rowRef.current?.getBoundingClientRect();
            return {...priority, priorityIndex, sourceWidth: rect?.width || 300, sourceHeight: rect?.height || 40};
        },
        end: (item, monitor) => {
            const dropResult = monitor.getDropResult();
            if (!dropResult || dropResult.priority === null) {
                setCrossCardInsertIndex(null);
                revertDragTabSwitch();
                return;
            }
            removePriorityFromCategory(item, monitor);
        },
        collect: (monitor) => ({
          isDragging: !!monitor.isDragging(),
        }),
    }),[prioritiesArray, priorityIndex]);

    useEffect(() => {
        preview(getEmptyImage());
    }, [preview]);

    const [{ isPriorityOver }, priorityDrop] = useDrop(() => ({
        accept: "priorityRow",
        canDrop: () => false,
        hover: (dragItem, monitor) => {
            if (sortMode !== 'hand') return;
            if (priority.id === '') return;

            if (dragItem.category_fk === priority.category_fk && dragItem.priorityIndex === priorityIndex) return;

            const hoverRect = rowRef.current?.getBoundingClientRect();
            if (!hoverRect) return;
            const clientOffset = monitor.getClientOffset();
            if (!clientOffset) return;
            const hoverClientY = clientOffset.y - hoverRect.top;
            const hoverMiddleY = (hoverRect.bottom - hoverRect.top) / 2;

            if (hoverClientY < hoverMiddleY) {
                setInsertIndicator('above');
                setCrossCardInsertIndex(priorityIndex);
            } else {
                setInsertIndicator('below');
                setCrossCardInsertIndex(priorityIndex + 1);
            }
        },
        collect: (monitor) => ({
            isPriorityOver: monitor.isOver(),
        }),
    }), [sortMode, priority.id, priority.category_fk, priorityIndex, setCrossCardInsertIndex]);

    useEffect(() => {
        if (!isPriorityOver) setInsertIndicator(null);
    }, [isPriorityOver]);

    const removePriorityFromCategory = async (item, monitor) => {
        var dropResult = monitor.getDropResult();
        if (!dropResult || dropResult.priority === null) {
            revertDragTabSwitch();
            return;
        }
        clearDragTabSwitch();
        var newPrioritiesArray = [...prioritiesArray];
        newPrioritiesArray = newPrioritiesArray.filter( p => p.id !== item.id);
        setPrioritiesArray(newPrioritiesArray);
    }

    const rowRef = useRef(null);
    const mergedRef = useCallback((node) => {
        rowRef.current = node;
        drag(node);
        priorityDrop(node);
    }, [drag, priorityDrop]);

    // Determine status for indicator
    const sessionStatus = sessionStatusMap && sessionStatusMap[priority.id];
    const isRunning = !!(priority.in_progress || sessionStatus);
    const getStatusIcon = () => {
        if (priority.id === '') return null;
        if (priority.closed) {
            return <Tooltip title="Completed"><CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} /></Tooltip>;
        }
        if (sessionStatus) {
            return <Tooltip title={sessionStatus}><RocketLaunchIcon sx={{ fontSize: 18, color: 'primary.main' }} /></Tooltip>;
        }
        if (priority.in_progress) {
            return <Tooltip title="In Progress"><RocketLaunchIcon sx={{ fontSize: 18, color: 'primary.main' }} /></Tooltip>;
        }
        return <Tooltip title="Not Started"><HotelIcon sx={{ fontSize: 18, color: 'text.disabled' }} /></Tooltip>;
    };

    return (
        <Box className="task priority-row"
             data-testid={priority.id === '' ? 'priority-template' : `priority-${priority.id}`}
             key={`box-${priority.id}`}
             ref={priority.id === '' ? null :
                  supportDrag === false ? null : mergedRef}
             sx = {{
                 ...(isDragging && sortMode === 'hand' && {
                    height: 0,
                    minHeight: 0,
                    overflow: 'hidden',
                    padding: 0,
                    margin: 0,
                    opacity: 0,
                }),
                 ...(isDragging && sortMode !== 'hand' && { opacity: 0.2 }),
                 ...(insertIndicator === 'above' && { borderTop: '4px solid', borderTopColor: 'primary.main' }),
                 ...(insertIndicator === 'below' && { borderBottom: '4px solid', borderBottomColor: 'primary.main' }),
             }}
        >
            {/* Col 1: Row number */}
            <Typography
                variant="body2"
                sx={{ color: 'text.secondary', textAlign: 'center', minWidth: 24, userSelect: 'none' }}
            >
                {priority.id !== '' ? priorityIndex + 1 : ''}
            </Typography>

            {/* Col 2: Scheduled toggle — hidden when running, spacer preserves layout */}
            <Box className="priority-scheduled-col" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28 }}>
                {priority.id !== '' && !isRunning ? (
                    <Tooltip title={priority.scheduled ? "Marked for Swarm-Start" : "Mark for Swarm-Start"}>
                        <IconButton
                            onClick={() => scheduledClick(priorityIndex, priority.id)}
                            data-testid={`scheduled-toggle-${priority.id}`}
                            sx={{ maxWidth: 28, maxHeight: 28 }}
                        >
                            {priority.scheduled ?
                                <PlayCircleIcon sx={{ fontSize: 20, color: 'primary.main' }} /> :
                                <PlayCircleOutlineIcon sx={{ fontSize: 20, color: 'text.disabled' }} />
                            }
                        </IconButton>
                    </Tooltip>
                ) : null}
            </Box>

            {/* Col 3: Details link */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {priority.id !== '' ? (
                    <Tooltip title="Details">
                        <IconButton onClick={() => navigate(`/swarm/priority/${priority.id}`)}
                                    key={`navigate-${priority.id}`}
                                    sx={{ maxWidth: 25, maxHeight: 25 }}
                        >
                            <OpenInNewIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    </Tooltip>
                ) : (
                    <Box sx={{ width: 25 }} />
                )}
            </Box>

            {/* Col 4: Status indicator */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28 }}>
                {getStatusIcon()}
            </Box>

            {/* Col 5: Title */}
            <TextField variant="outlined"
                        value={priority.title || ''}
                        name='title'
                        onChange = {(event) => titleChange(event, priorityIndex) }
                        onKeyDown = {(event) => titleKeyDown(event, priorityIndex, priority.id)}
                        onBlur = {(event) => titleOnBlur(event, priorityIndex, priority.id)}
                        multiline
                        disabled = {categoryId !== '' ? false : categoryName === '' ? true : false}
                        autoComplete ='off'
                        sx = {{...(priority.closed === 1 && {textDecoration: 'line-through'}),}}
                        size = 'small'
                        slotProps={{ htmlInput: { maxLength: 256 } }}
                        key={`title-${priority.id}`}
             />

            {/* Col 6: Delete / Savings */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            { priority.id === '' ?
                    <IconButton key={`savings-${priority.id}`}
                                disabled = {categoryId !== '' ? false : categoryName === '' ? true : false}
                                sx = {{maxWidth: "25px",
                                       maxHeight: "25px",
                                }}
                    >
                        <SavingsIcon key={`savings1-${priority.id}`}/>
                    </IconButton>
                :
                    <Tooltip title="Delete priority">
                        <IconButton onClick={(event) => deleteClick(event, priority.id)}
                                    key={`delete-${priority.id}`}
                                    sx = {{maxWidth: "25px",
                                           maxHeight: "25px",
                                    }}
                        >
                            <DeleteIcon key={`delete1-${priority.id}`} />
                        </IconButton>
                    </Tooltip>
            }
            </Box>
        </Box>
    )
}

export default PriorityRow
