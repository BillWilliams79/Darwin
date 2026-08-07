// Delete-confirm dialog for a swarm_start row (req #3265). Mirrors
// RequirementDeleteDialog's shape/confirm pattern — no new confirm dialect.
//
// This guard is CLIENT-SIDE ONLY. The browser's delete goes through the
// generic REST DELETE on `swarm_starts`, not the `delete_swarm_start` MCP
// tool (MCP is agent-only) — and `swarm_start_sessions.swarm_start_fk` is
// `ON DELETE CASCADE` in the schema, not RESTRICT, so nothing at the
// database layer backstops this. The Delete button is disabled whenever
// `linkedSessionIds` is non-empty OR still loading (`linkedLoading`) — the
// loading gate matters because both call sites derive the id list from
// queries that are NOT the one gating the page's render, so without it a
// linked row briefly shows as deletable while sessions/junction are still
// in flight (req #3265 code review, finding C2).

import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const SwarmStartDeleteDialog = ({ deleteDialogOpen, setDeleteDialogOpen, setDeleteId,
                                   setDeleteConfirmed, swarmStart, linkedSessionIds = [],
                                   linkedLoading = false }) => {

    const dialogCleanUp = () => {
        setDeleteDialogOpen(false);
        setDeleteId({});
        return;
    };

    const deleteSwarmStart = (event) => {
        setDeleteConfirmed(true);
        setDeleteDialogOpen(false);
    };

    const hasLinkedSessions = linkedSessionIds.length > 0;

    return (

        <Dialog open={deleteDialogOpen}
                onClose={dialogCleanUp}
                data-testid="swarm-start-delete-dialog" >

            <DialogTitle id="confirm-delete-swarm-start-title">
                {"Delete Swarm Start"}
            </DialogTitle>
            <DialogContent>
                {linkedLoading ? (
                    <DialogContentText id="confirm-delete-swarm-start-text">
                        {`Cannot confirm there are no linked sessions yet — Delete stays disabled until that's known.`}
                    </DialogContentText>
                ) : hasLinkedSessions ? (
                    <DialogContentText id="confirm-delete-swarm-start-text" color="error">
                        {`This invocation is still linked to session${linkedSessionIds.length === 1 ? '' : 's'} `}
                        {linkedSessionIds.join(', ')}
                        {`. Unlink or address ${linkedSessionIds.length === 1 ? 'it' : 'them'} before deleting.`}
                    </DialogContentText>
                ) : (
                    <DialogContentText id="confirm-delete-swarm-start-text">
                        {`Do you want to permanently delete this swarm-start invocation record?`}
                    </DialogContentText>
                )}
                {swarmStart?.id != null && (
                    <Box sx={{
                        mt: 2, mx: 2, p: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        bgcolor: 'background.paper',
                    }}>
                        <Typography variant="body2">
                            {`#${swarmStart.id} — /swarm-start${swarmStart.arguments ? ` ${swarmStart.arguments}` : ''}`}
                        </Typography>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={deleteSwarmStart} variant="outlined"
                        disabled={hasLinkedSessions || linkedLoading}
                        data-testid="btn-confirm-delete-swarm-start">
                    Delete
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default SwarmStartDeleteDialog
