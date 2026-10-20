// eslint-disable-next-line no-unused-vars
import varDump from '../../classifier/classifier';

import React, { memo, useMemo } from 'react'

import { useTaskActions } from '../../hooks/useTaskActions';
import { useDarwinDrag, isLiftBlur } from '../../dnd';

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';
import { alpha } from '@mui/material/styles';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import ReportIcon from '@mui/icons-material/Report';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';


// Standard variant: permanent subtle underline (MUI standard default), no border box.
// Size 2 density: padding 6.5px 11px (tighter than default 8.5px 14px).
// Revert reference — Size 1 (original): remove DENSITY_STYLE and change variant back to "outlined".
const DENSITY_STYLE = { padding: '6.5px 11px' };

// One row's height (a single-line description at DENSITY_STYLE) — the size of
// the slot a lifted task leaves in a hand-sorted list.
const SLOT_HEIGHT = 36;

/**
 * A task row that lifts (req #3662). The WHOLE row is the grip — text
 * included: a quick tap still places the caret, a hold (touch) or a 4 px move
 * (mouse) lifts it. Which list it belongs to, and whether that list honours a
 * position, come from the caller; the row only renders the drag state.
 *
 * @param {Object} props.drag  { id, type, containerId, policy, sortMode }
 */
export const SortableTaskEdit = ({ drag, ...props }) => {
    const { ref, style, attributes, listeners, isDragging } = useDarwinDrag({ ...drag, row: props.task });
    // The sortable hook re-runs on every pointer move of any drag on the page;
    // the row it feeds only re-renders when something it SHOWS changed.
    const handle = useMemo(() => ({ ref, style, attributes, listeners, isDragging }),
        [ref, style, attributes, listeners, isDragging]);
    return <TaskEdit {...props} drag={handle} honoursPosition={drag.policy.reorderAllowed(drag.sortMode)} />;
};

/**
 * One task row. Without `drag` it is a plain row (the edit dialog, a history
 * row, the template row) and touches no drag-and-drop context at all.
 */
const TaskEdit = memo(({ task, taskIndex, areaId, areaName, drag = null, honoursPosition = false }) => {

    const { priorityClick, doneClick, descriptionChange, descriptionKeyDown,
        descriptionOnBlur, deleteClick, disableStrikethrough } = useTaskActions();

    // The slot this row leaves while it is lifted. Where a position is honoured
    // it travels with the sort and is tinted — the insert feedback (req #1923);
    // elsewhere it just dims in place.
    const isLifted = !!drag?.isDragging;

    // What the row SHOWS, memoized apart from how it MOVES: while a drag passes,
    // a sorting row's position style changes many times, and re-rendering the
    // auto-sizing text field each time forces a layout read per row per shift
    // — the dominant cost of a drag (measured, req #3662).
    const content = useMemo(() => (
        <>
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
        <TextField variant="standard"
                    value={task.description || ''}
                    name='description'
                    onChange = {(event) => descriptionChange(event, taskIndex) }
                    onKeyDown = {(event) => descriptionKeyDown(event, taskIndex, task.id)}
                    onBlur = {(event) => { if (!isLiftBlur(event)) descriptionOnBlur(event, taskIndex, task.id); }}
                    multiline
                    disabled = {areaId !== '' ? false : areaName === '' ? true : false}
                    autoComplete ='off'
                    sx = {{
                        ...(task.done === 1 && !disableStrikethrough && {textDecoration: 'line-through'}),
                    }}
                    size = 'small'
                    slotProps={{
                        htmlInput: { maxLength: 1024 },
                        input: { style: DENSITY_STYLE },
                    }}
                    key={`description-${task.id}`}
         />
        { task.id === '' ?
            <IconButton key={`savings-${task.id}`}
                        aria-label="Save task"
                        disabled = {areaId !== '' ? false : areaName === '' ? true : false}
                        sx = {{maxWidth: "25px",
                               maxHeight: "25px",
                        }}
            >
                <SavingsIcon key={`savings1-${task.id}`}/>
            </IconButton>
            :
            <IconButton  onClick={(event) => deleteClick(event, task.id)}
                         aria-label="Delete task"
                         key={`delete-${task.id}`}
                         sx = {{maxWidth: "25px",
                                maxHeight: "25px",
                         }}
            >
                <DeleteIcon key={`delete1-${task.id}`} />
            </IconButton>
        }
        </>
    // The shown fields as well as the row: some callers still edit a row in
    // place, and a memo keyed on identity alone would show the old state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ), [task, task.priority, task.done, task.description, taskIndex, areaId, areaName, priorityClick, doneClick, descriptionChange,
        descriptionKeyDown, descriptionOnBlur, deleteClick, disableStrikethrough]);

    return (
        <Box className="task"
             data-testid={task.id === '' ? 'task-template' : `task-${task.id}`}
             data-dragging={isLifted ? 'true' : undefined}
             key={`box-${task.id}`}
             ref={drag?.ref}
             {...(drag ? { ...drag.attributes, ...drag.listeners } : {})}
             style={drag?.style}
             sx = {(theme) => ({
                 // Smooth every DnD-driven visual change so drops/reorders glide
                 // instead of snapping (req #1923). Sibling reflow is the
                 // sortable's own transform transition (inline style).
                 transition: 'opacity 160ms ease, background-color 160ms ease, box-shadow 160ms ease',
                 borderRadius: 1,
                 ...(drag && { cursor: 'grab', '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 } }),
                 ...(isLifted && honoursPosition && {
                    // The insertion slot is ONE row tall whatever the task's
                    // length (user ruling, req #3662 review): the lifted
                    // preview already shows the whole task, and a tall slot
                    // shoves the list around more than the move needs.
                    maxHeight: SLOT_HEIGHT,
                    overflow: 'hidden',
                    alignItems: 'start',
                    backgroundColor: alpha(theme.palette.primary.main, 0.1),
                    boxShadow: `inset 0 0 0 2px ${alpha(theme.palette.primary.main, 0.45)}`,
                    '& > *': { opacity: 0.35 },
                 }),
                 ...(isLifted && !honoursPosition && { opacity: 0.3 }),
             })}
        >
            {content}
        </Box>
    )
});

export default TaskEdit
