import React from 'react'
import { useReorderItem, reorderRowSx, isLiftBlur } from '../dnd';

import Box from '@mui/material/Box';
import { Checkbox, Typography } from '@mui/material';
import { TextField } from '@mui/material';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';

export const PROJECT_GRID_COLUMNS = {
    xs: '1fr 42px 70px 70px 40px',
    md: '220px 70px 90px 80px 48px',
};

export const projectItemId = (project) => (project.id === '' ? 'project:template' : `project:${project.id}`);

/** Open projects are the positions; closed projects and the template neither lift nor take a drop. */
export const isOrderableProject = (project) => project.id !== '' && project.closed === 0;

// The cells re-render when the project does, not on every pointer move of a drag.
const ProjectCells = React.memo(({
    project, projectIndex,
    changeProjectName, keyDownProjectName, blurProjectName,
    clickProjectClosed, clickProjectDelete,
    categoryCount, requirementCount, inputRef
}) => (
    <>
        <Box sx={{ px: 1 }}>
            <TextField variant="outlined"
                       value={project.project_name || ''}
                       name='project-name'
                       onChange={ (event) => changeProjectName(event, projectIndex) }
                       onKeyDown={(event) => keyDownProjectName(event, projectIndex, project.id)}
                       onBlur={(event) => { if (!isLiftBlur(event)) blurProjectName(event, projectIndex, project.id); }}
                       autoComplete='off'
                       size='small'
                       fullWidth
                       slotProps={{ htmlInput: { maxLength: 32, ref: inputRef } }}
                       key={`name-${project.id}`}
            />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Checkbox checked={(project.closed === 1) ? true : false}
                      onClick={(event) => clickProjectClosed(event, projectIndex, project.id)}
                      key={`checked-${project.id}`}
            />
        </Box>
        <Box sx={{ textAlign: 'center' }}>
            <Typography variant='body1' data-testid={project.id ? `category-count-${project.id}` : undefined}>
            {  project.id === '' ? '' :
                categoryCount === undefined ? 0 :
                  categoryCount === '' ? '' : categoryCount }
             </Typography>
        </Box>
        <Box sx={{ textAlign: 'center' }}>
            <Typography variant='body1' data-testid={project.id ? `requirement-count-${project.id}` : undefined}>
            {  project.id === '' ? '' :
                requirementCount === undefined ? 0 :
                  requirementCount === '' ? '' : requirementCount }
             </Typography>
        </Box>
        <Box>
            { project.id === '' ?
                <IconButton aria-label="Save project">
                    <SavingsIcon />
                </IconButton>
                :
                <IconButton aria-label="Delete project" onClick={(event) => clickProjectDelete(event, project.id, project.project_name)}>
                    <DeleteIcon />
                </IconButton>
            }
        </Box>
    </>
));

// One row of the editor's ReorderList (req #3664): the whole row is the grip
// on an open project — a click still selects the row, edits the name or ticks
// the box; a hold (touch, or a long mouse click) or a 4 px mouse move lifts it.
const ProjectTableRow = ({ project, categoryCounts, requirementCounts, onRowClick, isSelected, ...cellProps }) => {
    const { ref, style, attributes, listeners, isDragging, draggable } = useReorderItem(projectItemId(project), project);

    return (
        <Box
            ref={ref}
            data-testid={project.id === '' ? 'project-row-template' : `project-row-${project.id}`}
            data-dragging={isDragging ? 'true' : undefined}
            {...(draggable ? { ...attributes, ...listeners } : {})}
            onClick={() => onRowClick(project.id)}
            style={style}
            sx={(theme) => ({
                display: 'grid',
                gridTemplateColumns: PROJECT_GRID_COLUMNS,
                alignItems: 'center',
                py: 0.5,
                borderRadius: 1,
                cursor: 'pointer',
                backgroundColor: isSelected ? 'action.selected' : 'inherit',
                ...reorderRowSx(theme, { draggable, isDragging }),
            })}
        >
            <ProjectCells project={project}
                          categoryCount={categoryCounts[`${project.id}`]}
                          requirementCount={requirementCounts[`${project.id}`]}
                          {...cellProps} />
        </Box>
    );
}

export default ProjectTableRow;
