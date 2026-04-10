import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';


const ProjectDeleteDialog = ({ projectDeleteDialogOpen, setProjectDeleteDialogOpen, projectInfo, setProjectInfo, setProjectDeleteConfirmed }) => {

    const { projectName, requirementsCount } = projectInfo;

    let requirementString = ` and its ${requirementsCount} related requirements?`;

    if (requirementsCount === undefined) {
        requirementString = '?';
    } else if (requirementsCount === 0) {
        requirementString = '? This project has no requirements.';
    } else if (requirementsCount === 1) {
        requirementString = ' and its 1 related requirement?';
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
                    {`Permanently delete the project ${projectName}${requirementString}`}
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
