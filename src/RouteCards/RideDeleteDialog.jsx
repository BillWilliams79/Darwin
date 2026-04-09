import React from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import RouteMapThumbnail from './RouteMapThumbnail';
import { formatCardDateTime } from '../utils/dateFormat';
import { formatDuration } from '../utils/mapDataUtils';

const RideDeleteDialog = ({ open, onClose, onConfirm, run, routeName, timezone }) => {
    const handleDelete = async () => {
        await onConfirm();
        onClose();
    };

    if (!run) return null;

    const displayName = routeName || run.activity_name || 'Activity';
    const dateStr = formatCardDateTime(run.start_time, timezone);
    const distance = Number(run.distance_mi).toFixed(1);
    const rideTime = formatDuration(run.run_time_sec);
    const ascent = run.ascent_ft != null ? Math.round(Number(run.ascent_ft)).toLocaleString() : null;

    return (
        <Dialog open={open} onClose={onClose} data-testid="ride-delete-dialog" maxWidth="xs" fullWidth>
            <DialogTitle>Delete Activity?</DialogTitle>
            <DialogContent sx={{ pb: 1 }}>
                {/* Activity identity */}
                <Typography variant="h6" sx={{ fontWeight: 'bold', lineHeight: 1.3 }}>
                    {displayName}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    {run.activity_name && routeName ? `${run.activity_name} · ` : ''}{dateStr}
                </Typography>

                {/* Stats summary */}
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {distance} mi{' · '}{rideTime}
                    {ascent != null && <>{' · '}{ascent} ft</>}
                </Typography>

                {/* Map thumbnail */}
                <Box sx={{ mt: 1 }}>
                    <RouteMapThumbnail runId={run.id} height={160} />
                </Box>

                {/* Warning */}
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                    GPS coordinates will also be deleted. This cannot be undone.
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleDelete} variant="outlined" color="error" data-testid="ride-delete-confirm-btn">
                    Delete
                </Button>
                <Button onClick={onClose} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default RideDeleteDialog;
