import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { Typography } from '@mui/material';

const ProjectAddDialog = ({ dialogOpen, setDialogOpen, newProjectInfo, setNewProjectInfo, setAddConfirmed }) => {

    const dialogCleanUp = () => {
        setDialogOpen(false);
        setNewProjectInfo('');
    };

    const createProject = (event) => {
        processCreate(event);
    };

    const projectKeyDown = (event) => {
         if (event.key === 'Enter') {
            processCreate(event);
         }
     }

     const processCreate = (event) => {
        if (newProjectInfo !== '') {
            setAddConfirmed(true);
            setDialogOpen(false);
            event.preventDefault();
        }
     }

    return (
        <Dialog open={dialogOpen}
                onClose={dialogCleanUp}
                data-testid="project-add-dialog" >

            <DialogTitle>
                {"Create New Project"}
            </DialogTitle>
            <DialogContent>
                <TextField label='Project Name'
                            value={newProjectInfo || ''}
                            name='projectName-name'
                            id='projectName-id'
                            variant="outlined"
                            onKeyDown={event => projectKeyDown(event)}
                            onChange={({target}) => setNewProjectInfo(target.value)}
                            autoComplete='off'
                            size='small'
                            autoFocus
                            sx={{marginTop: 2}}
                            key={`projectname-key`}
                />
                <Typography variant='body1'
                            sx={{ marginTop: 2 }}>
                    Add a new project to the swarm view.
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={createProject} variant="outlined">
                    OK
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined">
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default ProjectAddDialog
