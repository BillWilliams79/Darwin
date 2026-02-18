import React from 'react'
import { Draggable } from '@hello-pangea/dnd';

import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import { Checkbox, Typography } from '@mui/material';
import { TextField } from '@mui/material';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';

const DomainTableRow = ({
    domain, domainIndex,
    changeDomainName, keyDownDomainName, blurDomainName,
    clickDomainClosed, clickDomainDelete,
    areaCounts, taskCounts,
    onRowClick, isSelected
}) => {

    return (
        <Draggable key={domain.id} draggableId={`domainId-${domain.id}`} index={domainIndex}>
            {(provided) => (
                <TableRow
                    ref={provided.innerRef}
                    data-testid={domain.id === '' ? 'domain-row-template' : `domain-row-${domain.id}`}
                    {...(((domain.closed === 0) && (domain.id !== '')) && provided.draggableProps)}
                    {...(((domain.closed === 0) && (domain.id !== '')) && provided.dragHandleProps)}
                    onClick={() => domain.id && onRowClick(domain.id)}
                    sx={{
                        cursor: domain.id ? 'pointer' : 'default',
                        backgroundColor: isSelected ? 'action.selected' : 'inherit',
                    }}
                >
                    <TableCell>
                        <TextField variant="outlined"
                                   value={domain.domain_name || ''}
                                   name='domain-name'
                                   onChange={ (event) => changeDomainName(event, domainIndex) }
                                   onKeyDown={(event) => keyDownDomainName(event, domainIndex, domain.id)}
                                   onBlur={(event) => blurDomainName(event, domainIndex, domain.id)}
                                   autoComplete='off'
                                   size='small'
                                   slotProps={{ htmlInput: { maxLength: 32 } }}
                                   key={`name-${domain.id}`}
                        />
                    </TableCell>
                    <TableCell>
                        <Checkbox checked={(domain.closed === 1) ? true : false}
                                  onClick={(event) => clickDomainClosed(event, domainIndex, domain.id)}
                                  key={`checked-${domain.id}`}
                        />
                    </TableCell>
                    <TableCell>
                        <Typography variant='body1' sx={{textAlign: 'center'}} data-testid={domain.id ? `area-count-${domain.id}` : undefined}>
                        {  domain.id === '' ? '' :
                            areaCounts[`${domain.id}`] === undefined ? 0 :
                              areaCounts[`${domain.id}`] === '' ? '' : areaCounts[`${domain.id}`] }
                         </Typography>
                    </TableCell>
                    <TableCell>
                        <Typography variant='body1' sx={{textAlign: 'center'}} data-testid={domain.id ? `task-count-${domain.id}` : undefined}>
                        {  domain.id === '' ? '' :
                            taskCounts[`${domain.id}`] === undefined ? 0 :
                              taskCounts[`${domain.id}`] === '' ? '' : taskCounts[`${domain.id}`] }
                         </Typography>
                    </TableCell>
                    <TableCell>
                        { domain.id === '' ?
                            <IconButton>
                                <SavingsIcon />
                            </IconButton>
                            :
                            <IconButton onClick={(event) => clickDomainDelete(event, domain.id, domain.domain_name)}>
                                <DeleteIcon />
                            </IconButton>
                        }
                    </TableCell>
                </TableRow>
            )}
        </Draggable>
    )
}

export default DomainTableRow;
