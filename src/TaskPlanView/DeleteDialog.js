import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';


const DeleteDialog = ({ deleteDialogOpen, setDeleteDialogOpen, setDeleteId, setDeleteConfirmed }) => {

    const dialogCleanUp = () => {
        // Cancel and Close Path
        setDeleteDialogOpen(false);
        setDeleteId({});
        return;
    };

    const deleteTask = (event) => {
        // User confirms delete
        setDeleteConfirmed(true);
        setDeleteDialogOpen(false);
    };

    return (

        <Dialog open={deleteDialogOpen}
                onClose={dialogCleanUp} >

            <DialogTitle id="confirm-delete-title">
                {"Delete Task?"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText id="confirm-delete-text">
                {`Do you want to permanently delete this task?`}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={deleteTask} variant="outlined">
                    Delete
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default DeleteDialog
