// eslint-disable-next-line no-unused-vars
import varDump from '../../classifier/classifier';

import React, { useState, useEffect, useRef, useCallback } from 'react'

import { useDrag, useDrop } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { useDragTabStore } from '../../stores/useDragTabStore';
import { useTaskActions } from '../../hooks/useTaskActions';

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';

import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import ReportIcon from '@mui/icons-material/Report';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';


const TaskEdit = ({ supportDrag, task, taskIndex, areaId, areaName }) => {

    const { priorityClick, doneClick, descriptionChange, descriptionKeyDown,
        descriptionOnBlur, deleteClick, tasksArray, setTasksArray,
        sortMode, setCrossCardInsertIndex, disableStrikethrough } = useTaskActions();
    const [insertIndicator, setInsertIndicator] = useState(null); // 'above' | 'below' | null
    const revertDragTabSwitch = useDragTabStore(s => s.revertDragTabSwitch);
    const clearDragTabSwitch = useDragTabStore(s => s.clearDragTabSwitch);

    const [{ isDragging }, drag, preview] = useDrag(() => ({
        type: "taskPlan",
        item: () => {
            const rect = rowRef.current?.getBoundingClientRect();
            return {...task, taskIndex, sourceWidth: rect?.width || 300, sourceHeight: rect?.height || 40};
        },
        end: (item, monitor) => {
            const dropResult = monitor.getDropResult();
            if (!dropResult || dropResult.task === null) {
                // No drop or same-card drop: clear insert index, revert tab switch
                setCrossCardInsertIndex(null);
                revertDragTabSwitch();
                return;
            }
            // Cross-card drop: remove task from this card
            removeTaskFromArea(item, monitor);
        },
        collect: (monitor) => ({
          isDragging: !!monitor.isDragging(),
        }),
    }),[tasksArray, taskIndex]);

    useEffect(() => {
        preview(getEmptyImage());
    }, [preview]);

    const [{ isTaskOver }, taskDrop] = useDrop(() => ({
        accept: "taskPlan",
        canDrop: () => false, // Task rows are hover-only targets; card-level handles all drops
        hover: (dragItem, monitor) => {
            if (sortMode !== 'hand') return;
            if (task.id === '') return; // skip template

            // Unified blue-line insertion for both same-area and cross-card
            if (dragItem.area_fk === task.area_fk && dragItem.taskIndex === taskIndex) return;

            const hoverRect = rowRef.current?.getBoundingClientRect();
            if (!hoverRect) return;
            const clientOffset = monitor.getClientOffset();
            if (!clientOffset) return;
            const hoverClientY = clientOffset.y - hoverRect.top;
            const hoverMiddleY = (hoverRect.bottom - hoverRect.top) / 2;

            if (hoverClientY < hoverMiddleY) {
                setInsertIndicator('above');
                setCrossCardInsertIndex(taskIndex);
            } else {
                setInsertIndicator('below');
                setCrossCardInsertIndex(taskIndex + 1);
            }
        },
        collect: (monitor) => ({
            isTaskOver: monitor.isOver(),
        }),
    }), [sortMode, task.id, task.area_fk, taskIndex, setCrossCardInsertIndex]);

    // Clear insertion indicator when drag leaves this task
    useEffect(() => {
        if (!isTaskOver) setInsertIndicator(null);
    }, [isTaskOver]);

    const removeTaskFromArea = async (item, monitor) => {

        var dropResult = monitor.getDropResult();

        if (!dropResult || dropResult.task === null) {
            revertDragTabSwitch();
            return;
        }

        // when dropResult.task is non-null, the task is moved off this card
        clearDragTabSwitch();
        var newTasksArray = [...tasksArray];
        newTasksArray = newTasksArray.filter( task => task.id !== item.id);
        setTasksArray(newTasksArray);
    }

    const rowRef = useRef(null);
    const mergedRef = useCallback((node) => {
        rowRef.current = node;
        drag(node);
        taskDrop(node);
    }, [drag, taskDrop]);

    return (
        <Box className="task"
             data-testid={task.id === '' ? 'task-template' : `task-${task.id}`}
             key={`box-${task.id}`}
             ref={task.id === '' ? null :
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
            <Tooltip title={task.priority ? "Clear Priority" : "Set Priority"} arrow>
                <Checkbox
                    checked = {task.priority ? true : false}
                    onClick = {() => priorityClick(taskIndex, task.id)}
                    icon={<ReportGmailerrorredOutlinedIcon />}
                    checkedIcon={<ReportIcon />}
                    disabled = {areaId !== '' ? false : areaName === '' ? true : false}
                    key={`priority-${task.id}`}
                    sx = {{maxWidth: "25px",
                           maxHeight: "25px",
                           mr: "2px",
                    }}
                />
            </Tooltip>
            <Tooltip title={task.done ? "Mark Open" : "Mark Complete"} arrow>
                <Checkbox
                    checked = {task.done ? true : false}
                    onClick = {() => doneClick(taskIndex, task.id)}
                    icon={<CheckCircleOutlineIcon />}
                    checkedIcon={<CheckCircleIcon />}
                    disabled = {areaId !== '' ? false : areaName === '' ? true : false}
                    key={`done-${task.id}`}
                    sx = {{maxWidth: "25px",
                           maxHeight: "25px",
                           mr: "2px",
                    }}
                />
            </Tooltip> 
            <TextField variant="outlined"
                        value={task.description || ''}
                        name='description'
                        onChange = {(event) => descriptionChange(event, taskIndex) }
                        onKeyDown = {(event) => descriptionKeyDown(event, taskIndex, task.id)}
                        onBlur = {(event) => descriptionOnBlur(event, taskIndex, task.id)}
                        multiline
                        disabled = {areaId !== '' ? false : areaName === '' ? true : false}
                        autoComplete ='off'
                        sx = {{...(task.done === 1 && !disableStrikethrough && {textDecoration: 'line-through'}),}}
                        size = 'small'
                        /* inputProps={{ tabIndex: `${taskIndex}` }} */
                        slotProps={{ htmlInput: { maxLength: 1024 } }}
                        key={`description-${task.id}`}
             />
            { task.id === '' ?
                <Tooltip title="New task" arrow>
                    <IconButton key={`savings-${task.id}`}
                                disabled = {areaId !== '' ? false : areaName === '' ? true : false}
                                sx = {{maxWidth: "25px",
                                       maxHeight: "25px",
                                }}
                    >
                        <SavingsIcon key={`savings1-${task.id}`}/>
                    </IconButton>
                </Tooltip>
                :
                <Tooltip title="Delete task" arrow>
                    <IconButton  onClick={(event) => deleteClick(event, task.id)}
                                 key={`delete-${task.id}`}
                                 sx = {{maxWidth: "25px",
                                        maxHeight: "25px",
                                 }}
                    >
                        <DeleteIcon key={`delete1-${task.id}`} />
                    </IconButton>
                </Tooltip>
            }
        </Box>
    )
}

export default TaskEdit
