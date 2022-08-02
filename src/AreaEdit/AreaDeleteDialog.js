import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';


const AreaDeleteDialog = ({ areaDeleteDialogOpen, setAreaDeleteDialogOpen, areaInfo, setAreaInfo, setAreaDeleteConfirmed }) => {

    const {areaName, areaId, tasksCount } = areaInfo;
    
    let taskString = ` and its ${tasksCount} related tasks?`;

    if (tasksCount === undefined) {
        taskString = '?';
    } else if (tasksCount === 1) {
        taskString = ' and its 1 related task?'
    }
    
    const dialogCleanUp = () => {
        // Cancel and Close Path
        setAreaDeleteDialogOpen(false);
        setAreaInfo({});
        return;
    };

    const clickDeleteArea = (event) => {
        // User confirms delete
        setAreaDeleteConfirmed(true);
        setAreaDeleteDialogOpen(false);
    };

    return (

        <Dialog open={areaDeleteDialogOpen}
                onClose={dialogCleanUp} >

            <DialogTitle id="confirm-delete-title">
                {"Delete Area?"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText id="confirm-delete-text">
                {`Permanently delete the area ${areaName}${taskString}`}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={clickDeleteArea} variant="outlined">
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
