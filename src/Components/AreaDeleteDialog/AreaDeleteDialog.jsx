import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';


const AreaDeleteDialog = ({ deleteDialogOpen, setDeleteDialogOpen, areaDeleteInfo, setAreaDeleteInfo, setDeleteConfirmed }) => {

    const { areaName, taskCount } = areaDeleteInfo;

    const truncatedName = areaName && areaName.length > 20
        ? areaName.substring(0, 20) + '...'
        : areaName;

    const dialogCleanUp = () => {
        setDeleteDialogOpen(false);
        setAreaDeleteInfo({});
    };

    const confirmDelete = () => {
        setDeleteConfirmed(true);
        setDeleteDialogOpen(false);
    };

    const actionText = taskCount === 0
        ? `Delete "${truncatedName}"? This area has no tasks.`
        : `Delete "${truncatedName}" and its ${taskCount} task${taskCount === 1 ? '' : 's'}?`;

    return (
        <Dialog open={deleteDialogOpen}
                onClose={dialogCleanUp}
                data-testid="area-delete-dialog" >

            <DialogTitle>
                {"Delete Area"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText>
                    {actionText}
                </DialogContentText>
                <DialogContentText sx={{ mt: 2 }}>
                    This cannot be undone.
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={confirmDelete} variant="outlined" color="error">
                    Delete
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default AreaDeleteDialog
