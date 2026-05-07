import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom';

import { useDrag, useDrop } from 'react-dnd';
import { useRequirementActions } from '../hooks/useRequirementActions';

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditNoteIcon from '@mui/icons-material/EditNote';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import RateReviewIcon from '@mui/icons-material/RateReview';
import DoNotDisturbOnIcon from '@mui/icons-material/DoNotDisturbOn';
import DescriptionIcon from '@mui/icons-material/Description';
import BuildIcon from '@mui/icons-material/Build';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';


const RequirementRow = ({ requirement, requirementIndex, categoryId, categoryName }) => {

    const navigate = useNavigate();
    const { statusClick, coordinationClick, titleChange, titleKeyDown,
        titleOnBlur, deleteClick, sessionStatusMap,
        categoryColorMap, sortMode, setCrossCardInsertIndex,
        requirementsArray, setRequirementsArray } = useRequirementActions();

    // Drag rules (req #2417):
    //   - Drag source is enabled for every non-template row, regardless of
    //     sortMode. Cross-card moves are valid in process / reverse modes too;
    //     in those modes the target card simply appends + persists category_fk
    //     without touching sort_order.
    //   - Same-card reorder still requires the target card's sortMode === 'hand'
    //     (gated in CategoryCard.addRequirementToCategory).
    //   - The aggregator card (SwarmStartCard) provides sortMode === 'created'
    //     and a no-op setCrossCardInsertIndex; aggregator rows can still be
    //     drag sources because the underlying requirement lives in some real
    //     CategoryCard, which is what gets re-categorized on drop.
    const isTemplate = requirement.id === '';
    const handSortActive = sortMode === 'hand';
    const [insertIndicator, setInsertIndicator] = useState(null);

    const [{ isDragging }, drag] = useDrag(() => ({
        type: 'requirementRow',
        item: () => {
            // Spread the full requirement so cross-card moves carry every
            // field the target needs to render the row consistently
            // (coordination_type, started_at, deferred_at, completed_at, etc.)
            // until the next server refetch. Without this, the moved row
            // visually loses chips and tooltips for a few frames mid-drop.
            const rect = rowRef.current?.getBoundingClientRect();
            return {
                ...requirement,
                requirementIndex,
                sourceWidth: rect?.width || 300,
                sourceHeight: rect?.height || 40,
            };
        },
        canDrag: () => !isTemplate,
        end: (item, monitor) => {
            // Always release the cross-card insert index — same-card splice
            // already cleared it in addRequirementToCategory; this covers the
            // no-drop / cancelled-drop / aggregator-drop / cross-card paths.
            if (setCrossCardInsertIndex) setCrossCardInsertIndex(null);

            const dropResult = monitor.getDropResult();
            if (!dropResult) return;
            if (!dropResult.crossCard) return;
            if (dropResult.requirement !== item.id) return;
            // Cross-card success: filter the moved row out of the source card's
            // local state — UNLESS the source is the aggregator. The aggregator
            // is filtered by status (e.g. swarm_ready), and the moved row still
            // matches that status, so it should remain visible. The cache
            // write-through in addRequirementToCategory keeps the byStatus
            // slice in sync; an explicit filter here would just cause a flicker
            // before the aggregator's useEffect re-seeds from cache.
            if (sortMode === 'created') return;
            if (setRequirementsArray) {
                setRequirementsArray(prev => prev ? prev.filter(p => p.id !== item.id) : prev);
            }
        },
        collect: (monitor) => ({
            isDragging: !!monitor.isDragging(),
        }),
    }), [requirement.id, requirement.title, requirement.requirement_status,
         requirement.category_fk, requirement.sort_order, requirementIndex,
         isTemplate, sortMode, setCrossCardInsertIndex, setRequirementsArray]);

    // Hover-only drop target — sets the insert indicator above/below this row
    // and writes the splice target into the parent CategoryCard via
    // setCrossCardInsertIndex. canDrop returns false so the actual drop bubbles
    // to the card-level useDrop. The indicator only renders when THIS card is
    // in hand mode — in process / reverse the target card appends to the end,
    // so a positional indicator would lie.
    const [{ isRequirementOver }, requirementDrop] = useDrop(() => ({
        accept: 'requirementRow',
        canDrop: () => false,
        hover: (dragItem, monitor) => {
            if (!handSortActive) return;
            if (isTemplate) return;
            // Hovering over the same row → no indicator.
            if (dragItem.id === requirement.id) return;

            const hoverRect = rowRef.current?.getBoundingClientRect();
            if (!hoverRect) return;
            const clientOffset = monitor.getClientOffset();
            if (!clientOffset) return;
            const hoverClientY = clientOffset.y - hoverRect.top;
            const hoverMiddleY = (hoverRect.bottom - hoverRect.top) / 2;

            if (hoverClientY < hoverMiddleY) {
                setInsertIndicator('above');
                if (setCrossCardInsertIndex) setCrossCardInsertIndex(requirementIndex);
            } else {
                setInsertIndicator('below');
                if (setCrossCardInsertIndex) setCrossCardInsertIndex(requirementIndex + 1);
            }
        },
        collect: (monitor) => ({
            isRequirementOver: monitor.isOver(),
        }),
    }), [handSortActive, isTemplate, requirement.id, requirementIndex,
         setCrossCardInsertIndex]);

    useEffect(() => {
        if (!isRequirementOver) setInsertIndicator(null);
    }, [isRequirementOver]);

    const rowRef = useRef(null);
    const mergedRef = useCallback((node) => {
        rowRef.current = node;
        drag(node);
        requirementDrop(node);
    }, [drag, requirementDrop]);

    // Determine status for indicator
    const sessionStatus = sessionStatusMap && sessionStatusMap[requirement.id];
    const status = requirement.requirement_status;
    const canCycleStatus = ['authoring', 'approved', 'swarm_ready'].includes(status);

    const getStatusIcon = () => {
        if (requirement.id === '') return null;
        if (status === 'met')          return <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />;
        if (status === 'deferred')     return <DoNotDisturbOnIcon sx={{ fontSize: 18, color: '#ff9800' }} />;
        if (sessionStatus === 'review') return <RateReviewIcon sx={{ fontSize: 18, color: '#ce93d8' }} />;
        if (sessionStatus === 'paused') return <PauseCircleIcon sx={{ fontSize: 18, color: '#f0d000' }} />;
        if (sessionStatus)             return <RocketLaunchIcon sx={{ fontSize: 18, color: '#4caf50' }} />;
        if (status === 'development')  return <RocketLaunchIcon sx={{ fontSize: 18, color: '#4caf50' }} />;
        if (status === 'swarm_ready')  return <PlayCircleIcon sx={{ fontSize: 18, color: 'primary.main' }} />; // Swarm-Start
        if (status === 'approved')     return <TaskAltIcon sx={{ fontSize: 18, color: '#90caf9' }} />; // lighter blue
        return <EditNoteIcon sx={{ fontSize: 18, color: '#fbc02d' }} />; // authoring yellow
    };

    const statusTooltip = {
        met: 'Met', deferred: 'Deferred', development: 'Development',
        swarm_ready: 'Swarm-Start — click to cycle', approved: 'Approved — click to cycle',
        authoring: 'Authoring — click to cycle',
    };

    const coordType = requirement.coordination_type || null;
    const getCoordinationIcon = () => {
        if (requirement.id === '') return null;
        if (coordType === 'planned')     return <DescriptionIcon sx={{ fontSize: 18, color: '#90caf9' }} />; // lighter blue
        if (coordType === 'implemented') return <BuildIcon sx={{ fontSize: 18, color: '#4caf50' }} />;
        if (coordType === 'deployed')    return <CloudUploadIcon sx={{ fontSize: 18, color: '#b39ddb' }} />; // light purple
        return <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />;
    };

    const coordTooltip = {
        planned: 'Planned — click to cycle', implemented: 'Implemented — click to cycle',
        deployed: 'Deployed — click to cycle',
    };

    const isAggregatorRow = Boolean(categoryColorMap);
    const rowClassName = `task requirement-row${isAggregatorRow ? ' aggregator-row' : ''}`;

    return (
        <Box className={rowClassName}
             data-testid={requirement.id === '' ? 'requirement-template' : `requirement-${requirement.id}`}
             key={`box-${requirement.id}`}
             ref={isTemplate ? null : mergedRef}
             sx={{
                 // While dragging, collapse the source row in hand mode (so
                 // the splice preview at the insert indicator is uncluttered).
                 // In process / reverse modes the row instead fades — there's
                 // no in-card splice preview to make room for, but feedback
                 // that THIS row is the one being dragged is still useful.
                 ...(isDragging && handSortActive && {
                     height: 0, minHeight: 0, overflow: 'hidden',
                     padding: 0, margin: 0, opacity: 0,
                 }),
                 ...(isDragging && !handSortActive && { opacity: 0.2 }),
                 ...(!isTemplate && { cursor: 'grab' }),
                 ...(insertIndicator === 'above' && { borderTop: '4px solid', borderTopColor: 'primary.main' }),
                 ...(insertIndicator === 'below' && { borderBottom: '4px solid', borderBottomColor: 'primary.main' }),
             }}
        >
            {/* Col 1 (aggregator only): Category color bar */}
            {isAggregatorRow && (
                <Box
                    data-testid={requirement.id !== '' ? `category-color-bar-${requirement.id}` : undefined}
                    sx={{
                        minWidth: 24,
                        display: 'flex',
                        alignItems: 'stretch',
                        justifyContent: 'center',
                    }}
                >
                    {requirement.id !== '' && (
                        <Box sx={{
                            width: 6,
                            alignSelf: 'stretch',
                            minHeight: 24,
                            bgcolor: categoryColorMap[requirement.category_fk] || 'transparent',
                            borderRadius: '3px',
                        }} />
                    )}
                </Box>
            )}

            {/* Col "chip": Requirement # chip — clickable, navigates to detail (replaces numerical ordering + settings button) */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, pr: '2px' }}>
                {requirement.id !== '' ? (
                    // testid deliberately does NOT start with `requirement-` to avoid colliding with the
                    // E2E prefix selector `[data-testid^="requirement-"]` used in swarm.spec.ts.
                    <Tooltip title="Open requirement details" enterDelay={400} enterNextDelay={200}>
                        <Chip
                            label={requirement.id}
                            size="small"
                            variant="outlined"
                            clickable
                            onClick={() => navigate(`/swarm/requirement/${requirement.id}`)}
                            aria-label={`Open requirement ${requirement.id}`}
                            data-testid={`req-id-chip-${requirement.id}`}
                        />
                    </Tooltip>
                ) : null}
            </Box>

            {/* Status icon — clickable cycle for authoring/approved/swarm_ready */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28 }}>
                {requirement.id !== '' ? (
                    canCycleStatus ? (
                        <Tooltip title={statusTooltip[status] || status} enterDelay={400} enterNextDelay={200}>
                            <IconButton
                                onClick={() => statusClick(requirementIndex, requirement.id)}
                                data-testid={`status-toggle-${requirement.id}`}
                                sx={{ maxWidth: 28, maxHeight: 28 }}
                            >
                                {getStatusIcon()}
                            </IconButton>
                        </Tooltip>
                    ) : (
                        <Tooltip title={statusTooltip[status] || sessionStatus || status} enterDelay={400} enterNextDelay={200}>
                            {getStatusIcon()}
                        </Tooltip>
                    )
                ) : null}
            </Box>

            {/* Coordination type icon — visible only for swarm_ready and development; editable only for swarm_ready */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28 }}>
                {requirement.id !== '' ? (() => {
                    const showCoord = ['swarm_ready', 'development'].includes(status);
                    if (!showCoord) return null;
                    const isCoordEditable = status === 'swarm_ready';
                    const tooltip = isCoordEditable
                        ? (coordTooltip[coordType] || 'No autonomy — click to set')
                        : 'Locked — not editable';
                    return (
                        <Tooltip title={tooltip} enterDelay={400} enterNextDelay={200}>
                            <span>
                                <IconButton
                                    onClick={() => coordinationClick(requirementIndex, requirement.id)}
                                    disabled={!isCoordEditable}
                                    data-testid={`coordination-toggle-${requirement.id}`}
                                    sx={{ maxWidth: 28, maxHeight: 28, '&.Mui-disabled': { opacity: 1 } }}
                                >
                                    {getCoordinationIcon()}
                                </IconButton>
                            </span>
                        </Tooltip>
                    );
                })() : null}
            </Box>

            {/* Title */}
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
                        sx = {{...(status === 'met' && {textDecoration: 'line-through'}), ...(status === 'deferred' && {opacity: 0.5}),}}
                        size = 'small'
                        slotProps={{ htmlInput: { maxLength: 256 } }}
                        key={`title-${requirement.id}`}
             />

            {/* Col 6: Delete / Savings — padded so the icon sits between the title editor edge and the card edge,
                biased slightly toward the title editor. */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', pl: 1, pr: 1.25 }}>
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
