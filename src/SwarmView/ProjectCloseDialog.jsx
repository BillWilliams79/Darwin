import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';

const ProjectCloseDialog = ({ dialogOpen, setDialogOpen, closeInfo, setCloseInfo, setCloseConfirmed }) => {

    const { projectName } = closeInfo;

    const dialogCleanUp = () => {
        setDialogOpen(false);
        setCloseInfo({});
    };

    const closeProject = () => {
        setCloseConfirmed(true);
        setDialogOpen(false);
    };

    return (
        <Dialog open={dialogOpen}
                onClose={dialogCleanUp}
                data-testid="project-close-dialog" >

            <DialogTitle>
                {"Close Project"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText>
                {`Do you want to close the ${projectName} project?`}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={closeProject} variant="outlined">
                    Close Project
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default ProjectCloseDialog
