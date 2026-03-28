import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';


const ProjectDeleteDialog = ({ projectDeleteDialogOpen, setProjectDeleteDialogOpen, projectInfo, setProjectInfo, setProjectDeleteConfirmed }) => {

    const { projectName, prioritiesCount } = projectInfo;

    let priorityString = ` and its ${prioritiesCount} related priorities?`;

    if (prioritiesCount === undefined) {
        priorityString = '?';
    } else if (prioritiesCount === 0) {
        priorityString = '? This project has no priorities.';
    } else if (prioritiesCount === 1) {
        priorityString = ' and its 1 related priority?';
    }

    const dialogCleanUp = () => {
        setProjectDeleteDialogOpen(false);
        setProjectInfo({});
    };

    const clickDeleteProject = (event) => {
        setProjectDeleteDialogOpen(false);
        setProjectDeleteConfirmed(true);
    };

    return (
        <Dialog open={projectDeleteDialogOpen}
                onClose={dialogCleanUp}
                data-testid="project-delete-dialog" >

            <DialogTitle>
                {"Delete Project?"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText>
                    {`Permanently delete the project ${projectName}${priorityString}`}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={clickDeleteProject} variant="outlined" color="error">
                    Delete
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default ProjectDeleteDialog
