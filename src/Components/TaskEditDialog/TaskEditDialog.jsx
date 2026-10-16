// eslint-disable-next-line no-unused-vars
import varDump from '../../classifier/classifier';

import TaskDeleteDialog from '../TaskDeleteDialog/TaskDeleteDialog';
import TaskEdit from '../TaskEdit/TaskEdit';
import { useTaskActions } from '../../hooks/useTaskActions';

import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';

const TaskEditDialog = ({ taskEditDialogOpen,
                          setTaskEditDialogOpen,
                          taskEditInfo,
                          setTaskEditInfo,
                          taskApiToggle,
                          setTaskApiToggle,
                          onClose, }
                        ) => {

    const { deleteDialogOpen, setDeleteDialogOpen, setDeleteId, setDeleteConfirmed, tasksArray } = useTaskActions();

    // taskEditInfo.task is a snapshot taken when the dialog opened. Field edits update
    // tasksArray immutably (useCrudCallbacks), so the snapshot goes stale and the
    // controlled description input would snap back on every keystroke (req #3525).
    // Resolve the live row by id. If the row has left tasksArray (e.g. a refetch
    // dropped it) render nothing: the saved index would point at a different row.
    const snapshot = taskEditInfo.task;
    const taskIndex = snapshot && tasksArray ? tasksArray.findIndex(t => t.id === snapshot.id) : -1;
    const task = taskIndex !== -1 ? tasksArray[taskIndex] : undefined;

    const closeDialog = () => {
        // on dialog close, trigger data re-read in case items are no longer a priority
        // close the dialog and clear the task context info
        if (onClose) {
            onClose();
        } else if (setTaskApiToggle) {
            setTaskApiToggle(taskApiToggle ? false : true);
        }
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
                    <TaskEdit {...{supportDrag: false, task, taskIndex }} />
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
