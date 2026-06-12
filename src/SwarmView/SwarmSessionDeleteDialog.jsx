import { swarmStatusChipProps, swarmStatusLabel } from './swarmStatusChipProps';

import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';


const SwarmSessionDeleteDialog = ({ deleteDialogOpen, setDeleteDialogOpen, setDeleteId, setDeleteConfirmed, session }) => {

    const dialogCleanUp = () => {
        setDeleteDialogOpen(false);
        setDeleteId({});
    };

    const deleteSession = () => {
        setDeleteConfirmed(true);
        setDeleteDialogOpen(false);
    };

    const status = session?.swarm_status;
    const label = session?.title || session?.task_name || `Session #${session?.id ?? ''}`;

    return (
        <Dialog open={deleteDialogOpen}
                onClose={dialogCleanUp}
                data-testid="swarm-session-delete-dialog" >

            <DialogTitle id="confirm-delete-session-title">
                Delete Swarm Session
            </DialogTitle>
            <DialogContent>
                <DialogContentText id="confirm-delete-session-text">
                    Do you want to permanently delete this swarm session?
                </DialogContentText>
                {session && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mt: 2, mx: 2, gap: 1 }}>
                        <Chip label={swarmStatusLabel(status)}
                              size="small"
                              {...swarmStatusChipProps(status)} />
                        <Box sx={{
                            flex: 1,
                            p: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            bgcolor: 'background.paper',
                        }}>
                            <Typography variant="body2">{label}</Typography>
                        </Box>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={deleteSession} variant="outlined">
                    Delete
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default SwarmSessionDeleteDialog;
