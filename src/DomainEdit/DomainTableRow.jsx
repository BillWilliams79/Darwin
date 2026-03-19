import React from 'react'
import { Draggable } from '@hello-pangea/dnd';

import Box from '@mui/material/Box';
import { Checkbox, Typography } from '@mui/material';
import { TextField } from '@mui/material';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';

export const DOMAIN_GRID_COLUMNS = {
    xs: '1fr 42px 40px 40px 40px',
    md: '220px 70px 60px 60px 48px',
};

const DomainTableRow = ({
    domain, domainIndex,
    changeDomainName, keyDownDomainName, blurDomainName,
    clickDomainClosed, clickDomainDelete,
    areaCounts, taskCounts,
    onRowClick, isSelected,
    isDraggable
}) => {

    const row = (provided = {}, snapshot = {}) => (
        <Box
            ref={provided.innerRef}
            data-testid={domain.id === '' ? 'domain-row-template' : `domain-row-${domain.id}`}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            onClick={() => domain.id && onRowClick(domain.id)}
            sx={{
                display: 'grid',
                gridTemplateColumns: DOMAIN_GRID_COLUMNS,
                alignItems: 'center',
                py: 0.5,
                cursor: domain.id ? 'pointer' : 'default',
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
                           value={domain.domain_name || ''}
                           name='domain-name'
                           onChange={ (event) => changeDomainName(event, domainIndex) }
                           onKeyDown={(event) => keyDownDomainName(event, domainIndex, domain.id)}
                           onBlur={(event) => blurDomainName(event, domainIndex, domain.id)}
                           autoComplete='off'
                           size='small'
                           fullWidth
                           slotProps={{ htmlInput: { maxLength: 32 } }}
                           key={`name-${domain.id}`}
                />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Checkbox checked={(domain.closed === 1) ? true : false}
                          onClick={(event) => clickDomainClosed(event, domainIndex, domain.id)}
                          key={`checked-${domain.id}`}
                />
            </Box>
            <Box sx={{ textAlign: 'center' }}>
                <Typography variant='body1' data-testid={domain.id ? `area-count-${domain.id}` : undefined}>
                {  domain.id === '' ? '' :
                    areaCounts[`${domain.id}`] === undefined ? 0 :
                      areaCounts[`${domain.id}`] === '' ? '' : areaCounts[`${domain.id}`] }
                 </Typography>
            </Box>
            <Box sx={{ textAlign: 'center' }}>
                <Typography variant='body1' data-testid={domain.id ? `task-count-${domain.id}` : undefined}>
                {  domain.id === '' ? '' :
                    taskCounts[`${domain.id}`] === undefined ? 0 :
                      taskCounts[`${domain.id}`] === '' ? '' : taskCounts[`${domain.id}`] }
                 </Typography>
            </Box>
            <Box>
                { domain.id === '' ?
                    <IconButton>
                        <SavingsIcon />
                    </IconButton>
                    :
                    <IconButton onClick={(event) => clickDomainDelete(event, domain.id, domain.domain_name)}>
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
        <Draggable draggableId={`domainId-${domain.id}`} index={domainIndex}>
            {(provided, snapshot) => row(provided, snapshot)}
        </Draggable>
    );
}

export default DomainTableRow;
