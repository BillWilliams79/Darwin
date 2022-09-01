import varDump from '../../classifier/classifier';
import TaskDeleteDialog from '../TaskDeleteDialong/TaskDeleteDialog';
import TaskEdit from '../TaskEdit/TaskEdit';

import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';

const TaskEditDialog = ({ taskEditDialogOpen,
                          setTaskEditDialogOpen,
                          taskEditInfo,
                          setTaskEditInfo,
                          priorityClick,
                          doneClick,
                          descriptionChange,
                          descriptionKeyDown,
                          descriptionOnBlur,
                          deleteClick,
                          tasksArray,
                          setTasksArray,
                          taskApiToggle,
                          setTaskApiToggle,
                          deleteDialogOpen,
                          setDeleteDialogOpen,
                          setDeleteId,
                          setDeleteConfirmed, }
                        ) => {



    var {task, taskIndex} = taskEditInfo;

    const closeDialog = () => {
        // on dialog close, trigger data re-read in case items are no longer a priority
        // close the dialog and clear the task context info
        setTaskApiToggle(taskApiToggle ? false : true);
        setTaskEditDialogOpen(false);
        setTaskEditInfo({});
        return;
    };


    return (

        <Dialog open={taskEditDialogOpen}
                onClose={closeDialog} >

            <DialogTitle id="domain-settings-title">
                {"Edit Task"}
            </DialogTitle>
            <DialogContent>
                {task &&
                    <TaskEdit {...{supportDrag: false, task, taskIndex, priorityClick, doneClick, descriptionChange,
                                    descriptionKeyDown, descriptionOnBlur, deleteClick, tasksArray, setTasksArray }} />
                }
            </DialogContent>
            <DialogActions>
                <Button onClick={closeDialog} variant="outlined">
                    Close Dialog
                </Button>
            </DialogActions>
            <TaskDeleteDialog deleteDialogOpen = {deleteDialogOpen}
                          setDeleteDialogOpen = {setDeleteDialogOpen}
                          setDeleteId = {setDeleteId}
                          setDeleteConfirmed = {setDeleteConfirmed} />
        </Dialog>
    )
}

export default TaskEditDialog
