import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom';

import { useDrag, useDrop } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { useRequirementActions } from '../hooks/useRequirementActions';

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
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import DoNotDisturbOnIcon from '@mui/icons-material/DoNotDisturbOn';
import SettingsIcon from '@mui/icons-material/Settings';


const RequirementRow = ({ supportDrag, requirement, requirementIndex, categoryId, categoryName }) => {

    const navigate = useNavigate();
    const { scheduledClick, titleChange, titleKeyDown,
        titleOnBlur, deleteClick, requirementsArray, setRequirementsArray,
        sortMode, setCrossCardInsertIndex, sessionStatusMap } = useRequirementActions();
    const [insertIndicator, setInsertIndicator] = useState(null);
    const revertDragTabSwitch = useSwarmTabStore(s => s.revertDragTabSwitch);
    const clearDragTabSwitch = useSwarmTabStore(s => s.clearDragTabSwitch);

    const [{ isDragging }, drag, preview] = useDrag(() => ({
        type: "requirementRow",
        item: () => {
            const rect = rowRef.current?.getBoundingClientRect();
            return {...requirement, requirementIndex, sourceWidth: rect?.width || 300, sourceHeight: rect?.height || 40};
        },
        canDrag: () => true,
        end: (item, monitor) => {
            const dropResult = monitor.getDropResult();
            if (!dropResult || dropResult.requirement === null) {
                setCrossCardInsertIndex(null);
                revertDragTabSwitch();
                return;
            }
            removeRequirementFromCategory(item, monitor);
        },
        collect: (monitor) => ({
          isDragging: !!monitor.isDragging(),
        }),
    }),[requirementsArray, requirementIndex]);

    useEffect(() => {
        preview(getEmptyImage());
    }, [preview]);

    const [{ isRequirementOver }, requirementDrop] = useDrop(() => ({
        accept: "requirementRow",
        canDrop: () => false,
        hover: (dragItem, monitor) => {
            if (sortMode !== 'hand') return;
            if (requirement.id === '') return;

            if (dragItem.category_fk === requirement.category_fk && dragItem.requirementIndex === requirementIndex) return;

            const hoverRect = rowRef.current?.getBoundingClientRect();
            if (!hoverRect) return;
            const clientOffset = monitor.getClientOffset();
            if (!clientOffset) return;
            const hoverClientY = clientOffset.y - hoverRect.top;
            const hoverMiddleY = (hoverRect.bottom - hoverRect.top) / 2;

            if (hoverClientY < hoverMiddleY) {
                setInsertIndicator('above');
                setCrossCardInsertIndex(requirementIndex);
            } else {
                setInsertIndicator('below');
                setCrossCardInsertIndex(requirementIndex + 1);
            }
        },
        collect: (monitor) => ({
            isRequirementOver: monitor.isOver(),
        }),
    }), [sortMode, requirement.id, requirement.category_fk, requirementIndex, setCrossCardInsertIndex]);

    useEffect(() => {
        if (!isRequirementOver) setInsertIndicator(null);
    }, [isRequirementOver]);

    const removeRequirementFromCategory = async (item, monitor) => {
        var dropResult = monitor.getDropResult();
        if (!dropResult || dropResult.requirement === null) {
            revertDragTabSwitch();
            return;
        }
        clearDragTabSwitch();
        var newRequirementsArray = [...requirementsArray];
        newRequirementsArray = newRequirementsArray.filter( p => p.id !== item.id);
        setRequirementsArray(newRequirementsArray);
    }

    const rowRef = useRef(null);
    const mergedRef = useCallback((node) => {
        rowRef.current = node;
        drag(node);
        requirementDrop(node);
    }, [drag, requirementDrop]);

    // Determine status for indicator
    const sessionStatus = sessionStatusMap && sessionStatusMap[requirement.id];
    const status = requirement.requirement_status;
    const getStatusIcon = () => {
        if (requirement.id === '') return null;
        if (status === 'completed') {
            return <Tooltip title="Completed" enterDelay={400} enterNextDelay={200}><CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} /></Tooltip>;
        }
        if (status === 'deferred') {
            return <Tooltip title="Deferred" enterDelay={400} enterNextDelay={200}><DoNotDisturbOnIcon sx={{ fontSize: 18, color: '#ff9800' }} /></Tooltip>;
        }
        if (sessionStatus === 'paused') {
            return <Tooltip title="Paused" enterDelay={400} enterNextDelay={200}><PauseCircleIcon sx={{ fontSize: 18, color: '#f0d000' }} /></Tooltip>;
        }
        if (sessionStatus) {
            return <Tooltip title={sessionStatus} enterDelay={400} enterNextDelay={200}><RocketLaunchIcon sx={{ fontSize: 18, color: '#4caf50' }} /></Tooltip>;
        }
        if (status === 'in_progress') {
            return <Tooltip title="In Progress" enterDelay={400} enterNextDelay={200}><RocketLaunchIcon sx={{ fontSize: 18, color: '#4caf50' }} /></Tooltip>;
        }
        return <Tooltip title="Not Started" enterDelay={400} enterNextDelay={200}><HotelIcon sx={{ fontSize: 18, color: 'text.disabled' }} /></Tooltip>;
    };

    return (
        <Box className="task requirement-row"
             data-testid={requirement.id === '' ? 'requirement-template' : `requirement-${requirement.id}`}
             key={`box-${requirement.id}`}
             ref={requirement.id === '' ? null :
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
                {requirement.id !== '' ? requirementIndex + 1 : ''}
            </Typography>

            {/* Col 2: Scheduled toggle — hidden when closed or in-progress, disabled when session is active */}
            <Box className="requirement-scheduled-col" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28 }}>
                {requirement.id !== '' && status === 'idle' ? (() => {
                    const isActiveSession = ['starting', 'active', 'completing'].includes(sessionStatus);
                    const scheduledVal = requirement.scheduled || 0;
                    const iconColor = isActiveSession ? 'text.disabled'
                        : scheduledVal === 2 ? 'success.main'
                        : scheduledVal === 1 ? 'primary.main'
                        : 'text.disabled';
                    const tooltipText = scheduledVal === 2 ? "Auto-Start — click to clear"
                        : scheduledVal === 1 ? "Scheduled — click for Auto-Start"
                        : "Schedule for Swarm-Start";
                    const btn = (
                        <IconButton
                            onClick={() => scheduledClick(requirementIndex, requirement.id)}
                            disabled={isActiveSession}
                            data-testid={`scheduled-toggle-${requirement.id}`}
                            sx={{ maxWidth: 28, maxHeight: 28 }}
                        >
                            {scheduledVal > 0 ?
                                <PlayCircleIcon sx={{ fontSize: 20, color: iconColor }} /> :
                                <PlayCircleOutlineIcon sx={{ fontSize: 20, color: 'text.disabled' }} />
                            }
                        </IconButton>
                    );
                    return isActiveSession ? btn : (
                        <Tooltip title={tooltipText} enterDelay={400} enterNextDelay={200}>
                            {btn}
                        </Tooltip>
                    );
                })() : null}
            </Box>

            {/* Col 3: Details link */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {requirement.id !== '' ? (
                    <Tooltip title="Details" enterDelay={400} enterNextDelay={200}>
                        <IconButton onClick={() => navigate(`/swarm/requirement/${requirement.id}`)}
                                    key={`navigate-${requirement.id}`}
                                    sx={{ maxWidth: 25, maxHeight: 25 }}
                        >
                            <SettingsIcon sx={{ fontSize: 18 }} />
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
                        value={requirement.title || ''}
                        name='title'
                        onChange = {(event) => titleChange(event, requirementIndex) }
                        onKeyDown = {(event) => titleKeyDown(event, requirementIndex, requirement.id)}
                        onBlur = {(event) => titleOnBlur(event, requirementIndex, requirement.id)}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        multiline
                        disabled = {categoryId !== '' ? false : categoryName === '' ? true : false}
                        autoComplete ='off'
                        sx = {{...(status === 'completed' && {textDecoration: 'line-through'}), ...(status === 'deferred' && {opacity: 0.5}),}}
                        size = 'small'
                        slotProps={{ htmlInput: { maxLength: 256 } }}
                        key={`title-${requirement.id}`}
             />

            {/* Col 6: Delete / Savings */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            { requirement.id === '' ?
                    <IconButton key={`savings-${requirement.id}`}
                                disabled = {categoryId !== '' ? false : categoryName === '' ? true : false}
                                sx = {{maxWidth: "25px",
                                       maxHeight: "25px",
                                }}
                    >
                        <SavingsIcon key={`savings1-${requirement.id}`}/>
                    </IconButton>
                :
                    <Tooltip title="Delete requirement" enterDelay={400} enterNextDelay={200}>
                        <IconButton onClick={(event) => deleteClick(event, requirement.id)}
                                    key={`delete-${requirement.id}`}
                                    sx = {{maxWidth: "25px",
                                           maxHeight: "25px",
                                    }}
                        >
                            <DeleteIcon key={`delete1-${requirement.id}`} />
                        </IconButton>
                    </Tooltip>
            }
            </Box>
        </Box>
    )
}

export default RequirementRow
