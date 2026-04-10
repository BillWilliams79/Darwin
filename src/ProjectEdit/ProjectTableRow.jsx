import React from 'react'
import { Draggable } from '@hello-pangea/dnd';

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

const ProjectTableRow = ({
    project, projectIndex,
    changeProjectName, keyDownProjectName, blurProjectName,
    clickProjectClosed, clickProjectDelete,
    categoryCounts, requirementCounts,
    onRowClick, isSelected,
    isDraggable, inputRef
}) => {

    const row = (provided = {}, snapshot = {}) => (
        <Box
            ref={provided.innerRef}
            data-testid={project.id === '' ? 'project-row-template' : `project-row-${project.id}`}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            onClick={() => onRowClick(project.id)}
            sx={{
                display: 'grid',
                gridTemplateColumns: PROJECT_GRID_COLUMNS,
                alignItems: 'center',
                py: 0.5,
                cursor: 'pointer',
                backgroundColor: isSelected ? 'action.selected' : 'inherit',
                ...(snapshot.isDragging && {
                    backgroundColor: 'background.paper',
                    boxShadow: 3,
                    opacity: 0.9,
                    borderRadius: 1,
                }),
            }}
        >
            <Box sx={{ px: 1 }}>
                <TextField variant="outlined"
                           value={project.project_name || ''}
                           name='project-name'
                           onChange={ (event) => changeProjectName(event, projectIndex) }
                           onKeyDown={(event) => keyDownProjectName(event, projectIndex, project.id)}
                           onBlur={(event) => blurProjectName(event, projectIndex, project.id)}
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
                    categoryCounts[`${project.id}`] === undefined ? 0 :
                      categoryCounts[`${project.id}`] === '' ? '' : categoryCounts[`${project.id}`] }
                 </Typography>
            </Box>
            <Box sx={{ textAlign: 'center' }}>
                <Typography variant='body1' data-testid={project.id ? `requirement-count-${project.id}` : undefined}>
                {  project.id === '' ? '' :
                    requirementCounts[`${project.id}`] === undefined ? 0 :
                      requirementCounts[`${project.id}`] === '' ? '' : requirementCounts[`${project.id}`] }
                 </Typography>
            </Box>
            <Box>
                { project.id === '' ?
                    <IconButton>
                        <SavingsIcon />
                    </IconButton>
                    :
                    <IconButton onClick={(event) => clickProjectDelete(event, project.id, project.project_name)}>
                        <DeleteIcon />
                    </IconButton>
                }
            </Box>
        </Box>
    );

    if (!isDraggable) {
        return row();
    }

    return (
        <Draggable draggableId={`projectId-${project.id}`} index={projectIndex}>
            {(provided, snapshot) => row(provided, snapshot)}
        </Draggable>
    );
}

export default ProjectTableRow;
