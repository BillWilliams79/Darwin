import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom';

import { useDrag, useDrop } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { usePriorityActions } from '../hooks/usePriorityActions';

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Tooltip from '@mui/material/Tooltip';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import RocketIcon from '@mui/icons-material/Rocket';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import FlightLandIcon from '@mui/icons-material/FlightLand';
import HotelIcon from '@mui/icons-material/Hotel';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';


const PriorityRow = ({ supportDrag, priority, priorityIndex, categoryId, categoryName }) => {

    const navigate = useNavigate();
    const { inProgressClick, closedClick, titleChange, titleKeyDown,
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

    return (
        <Box className="task"
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
            <ToggleButtonGroup
                value={
                    sessionStatusMap && sessionStatusMap[priority.id]
                        ? sessionStatusMap[priority.id]
                        : priority.closed ? 'completed'
                        : priority.in_progress ? 'active'
                        : 'idle'
                }
                exclusive
                size="small"
                key={`status-${priority.id}`}
                sx={{ height: 28, '& .MuiToggleButton-root': { px: 0.5, py: 0, minWidth: 28 } }}
            >
                <ToggleButton value="idle" disabled><Tooltip title="Idle"><RocketIcon sx={{ fontSize: 18 }} /></Tooltip></ToggleButton>
                <ToggleButton value="starting" disabled><Tooltip title="Starting"><FlightTakeoffIcon sx={{ fontSize: 18 }} /></Tooltip></ToggleButton>
                <ToggleButton value="active" disabled><Tooltip title="Active"><RocketLaunchIcon sx={{ fontSize: 18 }} /></Tooltip></ToggleButton>
                <ToggleButton value="paused" disabled><Tooltip title="Paused"><HotelIcon sx={{ fontSize: 18 }} /></Tooltip></ToggleButton>
                <ToggleButton value="completing" disabled><Tooltip title="Completing"><FlightLandIcon sx={{ fontSize: 18 }} /></Tooltip></ToggleButton>
                <ToggleButton value="completed" disabled><Tooltip title="Completed"><AttachMoneyIcon sx={{ fontSize: 18 }} /></Tooltip></ToggleButton>
            </ToggleButtonGroup>
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
            <Box sx={{ display: 'flex', justifyContent: 'flex-start', width: 56 }}>
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
                <>
                    <IconButton onClick={() => navigate(`/swarm/priority/${priority.id}`)}
                                key={`navigate-${priority.id}`}
                                sx = {{maxWidth: "25px",
                                       maxHeight: "25px",
                                }}
                    >
                        <OpenInNewIcon key={`navigate1-${priority.id}`} />
                    </IconButton>
                    <IconButton onClick={(event) => deleteClick(event, priority.id)}
                                key={`delete-${priority.id}`}
                                sx = {{maxWidth: "25px",
                                       maxHeight: "25px",
                                }}
                    >
                        <DeleteIcon key={`delete1-${priority.id}`} />
                    </IconButton>
                </>
            }
            </Box>
        </Box>
    )
}

export default PriorityRow
