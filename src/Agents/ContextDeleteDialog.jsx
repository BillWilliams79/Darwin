import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

import { runDateLabel } from './contextRenderUtils';

// Delete-confirm dialog for one telemetry capture — same shape as the other
// delete dialogs (TaskDeleteDialog, SwarmSessionDeleteDialog): title + prompt
// + a bordered mini-preview box, Delete/Cancel as outlined buttons. Wired via
// the house useConfirmDialog hook (see ContextPage.jsx).
const ContextDeleteDialog = ({
    deleteDialogOpen, setDeleteDialogOpen, setDeleteId, setDeleteConfirmed, run, agentCount,
}) => {
    const dialogCleanUp = () => {
        setDeleteDialogOpen(false);
        setDeleteId({});
    };

    const deleteCapture = () => {
        setDeleteConfirmed(true);
        setDeleteDialogOpen(false);
    };

    return (
        <Dialog open={deleteDialogOpen}
                onClose={dialogCleanUp}
                data-testid="agent-context-delete-dialog">

            <DialogTitle id="confirm-delete-capture-title">
                Delete Capture
            </DialogTitle>
            <DialogContent>
                <DialogContentText id="confirm-delete-capture-text">
                    Do you want to permanently delete this telemetry capture? This cannot be undone.
                </DialogContentText>
                {run?.id && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mt: 2, mx: 2, gap: 1 }}>
                        {agentCount != null && (
                            <Chip label={`${agentCount} agent${agentCount === 1 ? '' : 's'}`}
                                  size="small" variant="outlined" />
                        )}
                        <Box sx={{
                            flex: 1,
                            p: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            bgcolor: 'background.paper',
                        }}>
                            <Typography variant="body2">{runDateLabel(run)}</Typography>
                            {run.source_note && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    {run.source_note}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={deleteCapture} variant="outlined">
                    Delete
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ContextDeleteDialog;
