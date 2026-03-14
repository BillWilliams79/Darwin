import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';

import ReportIcon from '@mui/icons-material/Report';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';


const TaskDeleteDialog = ({ deleteDialogOpen, setDeleteDialogOpen, setDeleteId, setDeleteConfirmed, task }) => {

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
                onClose={dialogCleanUp}
                data-testid="task-delete-dialog" >

            <DialogTitle id="confirm-delete-title">
                {"Delete Task"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText id="confirm-delete-text">
                {`Do you want to permanently delete this task?`}
                </DialogContentText>
                {task?.description && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mt: 2, mx: 2 }}>
                        <Checkbox
                            checked={!!task.priority}
                            disabled
                            icon={<ReportGmailerrorredOutlinedIcon />}
                            checkedIcon={<ReportIcon />}
                            sx={{ maxWidth: 25, maxHeight: 25, mr: '2px', p: 0 }}
                        />
                        <Checkbox
                            checked={!!task.done}
                            disabled
                            icon={<CheckCircleOutlineIcon />}
                            checkedIcon={<CheckCircleIcon />}
                            sx={{ maxWidth: 25, maxHeight: 25, mr: '4px', p: 0 }}
                        />
                        <Box sx={{
                            flex: 1,
                            p: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            bgcolor: 'background.paper',
                        }}>
                            <Typography variant="body2">{task.description}</Typography>
                        </Box>
                    </Box>
                )}
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

export default TaskDeleteDialog
