import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import HotelIcon from '@mui/icons-material/Hotel';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import DoNotDisturbOnIcon from '@mui/icons-material/DoNotDisturbOn';
import SettingsIcon from '@mui/icons-material/Settings';


const RequirementDeleteDialog = ({ deleteDialogOpen, setDeleteDialogOpen, setDeleteId, setDeleteConfirmed, requirement }) => {

    const dialogCleanUp = () => {
        setDeleteDialogOpen(false);
        setDeleteId({});
        return;
    };

    const deleteRequirement = (event) => {
        setDeleteConfirmed(true);
        setDeleteDialogOpen(false);
    };

    return (

        <Dialog open={deleteDialogOpen}
                onClose={dialogCleanUp}
                data-testid="requirement-delete-dialog" >

            <DialogTitle id="confirm-delete-title">
                {"Delete Requirement"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText id="confirm-delete-text">
                {`Do you want to permanently delete this requirement?`}
                </DialogContentText>
                {requirement?.title && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mt: 2, mx: 2, gap: 0.5 }}>
                        <IconButton size="small" disabled sx={{ maxWidth: 28, maxHeight: 28, p: 0 }}>
                            {requirement.scheduled === 2
                                ? <PlayCircleIcon sx={{ fontSize: 20, color: 'success.main' }} />
                                : requirement.scheduled === 1
                                ? <PlayCircleIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                                : <PlayCircleOutlineIcon sx={{ fontSize: 20, color: 'text.disabled' }} />}
                        </IconButton>
                        <IconButton size="small" disabled sx={{ maxWidth: 25, maxHeight: 25, p: 0 }}>
                            <SettingsIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                        <IconButton size="small" disabled sx={{ maxWidth: 28, maxHeight: 28, p: 0 }}>
                            {requirement.requirement_status === 'completed'
                                ? <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
                                : requirement.requirement_status === 'deferred'
                                    ? <DoNotDisturbOnIcon sx={{ fontSize: 18, color: '#ff9800' }} />
                                    : requirement.requirement_status === 'in_progress'
                                        ? <RocketLaunchIcon sx={{ fontSize: 18, color: '#4caf50' }} />
                                        : <HotelIcon sx={{ fontSize: 18, color: 'text.disabled' }} />}
                        </IconButton>
                        <Box sx={{
                            flex: 1,
                            p: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            bgcolor: 'background.paper',
                        }}>
                            <Typography variant="body2">{requirement.title}</Typography>
                        </Box>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={deleteRequirement} variant="outlined">
                    Delete
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default RequirementDeleteDialog
