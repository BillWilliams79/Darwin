import React from 'react'
import { useReorderItem, reorderRowSx, isLiftBlur } from '../dnd';

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

export const domainItemId = (domain) => (domain.id === '' ? 'domain:template' : `domain:${domain.id}`);

/** Open domains are the positions; closed domains and the template neither lift nor take a drop. */
export const isOrderableDomain = (domain) => domain.id !== '' && domain.closed === 0;

// The cells re-render when the domain does, not on every pointer move of a drag.
const DomainCells = React.memo(({
    domain, domainIndex,
    changeDomainName, keyDownDomainName, blurDomainName,
    clickDomainClosed, clickDomainDelete,
    areaCount, taskCount, inputRef
}) => (
    <>
        <Box sx={{ px: 1 }}>
            <TextField variant="outlined"
                       value={domain.domain_name || ''}
                       name='domain-name'
                       onChange={ (event) => changeDomainName(event, domainIndex) }
                       onKeyDown={(event) => keyDownDomainName(event, domainIndex, domain.id)}
                       onBlur={(event) => { if (!isLiftBlur(event)) blurDomainName(event, domainIndex, domain.id); }}
                       autoComplete='off'
                       size='small'
                       fullWidth
                       slotProps={{ htmlInput: { maxLength: 32, ref: inputRef } }}
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
                areaCount === undefined ? 0 :
                  areaCount === '' ? '' : areaCount }
             </Typography>
        </Box>
        <Box sx={{ textAlign: 'center' }}>
            <Typography variant='body1' data-testid={domain.id ? `task-count-${domain.id}` : undefined}>
            {  domain.id === '' ? '' :
                taskCount === undefined ? 0 :
                  taskCount === '' ? '' : taskCount }
             </Typography>
        </Box>
        <Box>
            { domain.id === '' ?
                <IconButton aria-label="Save domain">
                    <SavingsIcon />
                </IconButton>
                :
                <IconButton aria-label="Delete domain" onClick={(event) => clickDomainDelete(event, domain.id, domain.domain_name)}>
                    <DeleteIcon />
                </IconButton>
            }
        </Box>
    </>
));

// One row of the editor's ReorderList (req #3664): the whole row is the grip
// on an open domain — a click still selects the row, edits the name or ticks
// the box; a hold (touch, or a long mouse click) or a 4 px mouse move lifts it.
const DomainTableRow = ({ domain, areaCounts, taskCounts, onRowClick, isSelected, ...cellProps }) => {
    const { ref, style, attributes, listeners, isDragging, draggable } = useReorderItem(domainItemId(domain), domain);

    return (
        <Box
            ref={ref}
            data-testid={domain.id === '' ? 'domain-row-template' : `domain-row-${domain.id}`}
            data-dragging={isDragging ? 'true' : undefined}
            {...(draggable ? { ...attributes, ...listeners } : {})}
            onClick={() => onRowClick(domain.id)}
            style={style}
            sx={(theme) => ({
                display: 'grid',
                gridTemplateColumns: DOMAIN_GRID_COLUMNS,
                alignItems: 'center',
                py: 0.5,
                borderRadius: 1,
                cursor: 'pointer',
                backgroundColor: isSelected ? 'action.selected' : 'inherit',
                ...reorderRowSx(theme, { draggable, isDragging }),
            })}
        >
            <DomainCells domain={domain}
                         areaCount={areaCounts[`${domain.id}`]}
                         taskCount={taskCounts[`${domain.id}`]}
                         {...cellProps} />
        </Box>
    );
}

export default DomainTableRow;
