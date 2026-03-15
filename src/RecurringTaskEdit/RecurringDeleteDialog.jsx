import React from 'react';

import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import ReportIcon from '@mui/icons-material/Report';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import LayersIcon from '@mui/icons-material/Layers';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';

const WEEKDAY_OPTIONS = [
    { value: '2025-01-06', label: 'Mon' },
    { value: '2025-01-07', label: 'Tue' },
    { value: '2025-01-08', label: 'Wed' },
    { value: '2025-01-09', label: 'Thu' },
    { value: '2025-01-10', label: 'Fri' },
    { value: '2025-01-11', label: 'Sat' },
    { value: '2025-01-12', label: 'Sun' },
];

const MONTH_OPTIONS = [
    { value: 1,  label: 'Jan' }, { value: 2,  label: 'Feb' },
    { value: 3,  label: 'Mar' }, { value: 4,  label: 'Apr' },
    { value: 5,  label: 'May' }, { value: 6,  label: 'Jun' },
    { value: 7,  label: 'Jul' }, { value: 8,  label: 'Aug' },
    { value: 9,  label: 'Sep' }, { value: 10, label: 'Oct' },
    { value: 11, label: 'Nov' }, { value: 12, label: 'Dec' },
];

const getAnchorLabel = (def) => {
    if (!def || !def.anchor_date) return '';
    switch (def.recurrence) {
        case 'weekly':
            return WEEKDAY_OPTIONS.find(d => d.value === def.anchor_date)?.label || '';
        case 'monthly':
            return `Day ${parseInt(def.anchor_date.slice(8, 10), 10) || 1}`;
        case 'annual': {
            const month = parseInt(def.anchor_date.slice(5, 7), 10) || 1;
            const day   = parseInt(def.anchor_date.slice(8, 10), 10) || 1;
            const monthLabel = MONTH_OPTIONS.find(m => m.value === month)?.label || '';
            return `${monthLabel} ${day}`;
        }
        default:
            return '';
    }
};

const RecurringDeleteDialog = ({ open, setOpen, def, setConfirmed }) => {

    const dialogCleanUp = () => {
        setOpen(false);
    };

    const handleDelete = () => {
        setConfirmed(true);
        setOpen(false);
    };

    const recurrenceLabel = def?.recurrence
        ? (def.recurrence === 'annual' ? 'Yearly' : def.recurrence.charAt(0).toUpperCase() + def.recurrence.slice(1))
        : '';
    const anchorLabel = getAnchorLabel(def);

    return (
        <Dialog open={open} onClose={dialogCleanUp} data-testid="recurring-delete-dialog">
            <DialogTitle>Delete Recurring Task</DialogTitle>
            <DialogContent>
                <DialogContentText>
                    Do you want to permanently delete this recurring task?
                </DialogContentText>

                {def?.recurrence && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mt: 2, mx: 2, gap: 1, opacity: def.active ? 1 : 0.45 }}>
                        <Checkbox
                            checked={!!def.priority}
                            disabled
                            icon={<ReportGmailerrorredOutlinedIcon />}
                            checkedIcon={<ReportIcon />}
                            sx={{ maxWidth: 25, maxHeight: 25, mr: '2px', p: 0 }}
                        />
                        <IconButton size="small" disabled
                            color={def.accumulate ? 'default' : 'warning'}
                            sx={{ maxWidth: 25, maxHeight: 25, mr: '2px', p: 0 }}
                        >
                            {def.accumulate
                                ? <LayersIcon sx={{ fontSize: 16 }} />
                                : <SwapHorizIcon sx={{ fontSize: 16 }} />}
                        </IconButton>
                        <Box sx={{
                            flex: 1,
                            p: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            bgcolor: 'background.paper',
                            overflow: 'hidden',
                        }}>
                            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {def.description}
                            </Typography>
                        </Box>
                        <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {recurrenceLabel}{anchorLabel ? ` · ${anchorLabel}` : ''}
                        </Typography>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleDelete} variant="outlined">Delete</Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>Cancel</Button>
            </DialogActions>
        </Dialog>
    );
};

export default RecurringDeleteDialog;
