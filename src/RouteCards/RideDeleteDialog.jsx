import React from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';

const RideDeleteDialog = ({ open, onClose, onConfirm, rideSummary }) => {
    const handleDelete = () => {
        onConfirm();
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} data-testid="ride-delete-dialog">
            <DialogTitle>Delete Ride?</DialogTitle>
            <DialogContent>
                <DialogContentText>
                    Permanently delete this ride{rideSummary ? ` (${rideSummary})` : ''}?
                    GPS coordinates will also be deleted. This cannot be undone.
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleDelete} variant="outlined" color="error">
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
