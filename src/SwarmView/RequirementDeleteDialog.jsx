import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import EditNoteIcon from '@mui/icons-material/EditNote';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import DoNotDisturbOnIcon from '@mui/icons-material/DoNotDisturbOn';
import DescriptionIcon from '@mui/icons-material/Description';
import BuildIcon from '@mui/icons-material/Build';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';


// Mirror RequirementRow getStatusIcon (minus session-scoped states that don't
// apply in the delete-confirm preview: paused/review/live-session rocket).
const getStatusIcon = (status) => {
    if (status === 'met')          return <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />;
    if (status === 'deferred')     return <DoNotDisturbOnIcon sx={{ fontSize: 18, color: '#ff9800' }} />;
    if (status === 'development')  return <RocketLaunchIcon sx={{ fontSize: 18, color: '#4caf50' }} />;
    if (status === 'swarm_ready')  return <PlayCircleIcon sx={{ fontSize: 18, color: 'primary.main' }} />;
    if (status === 'approved')     return <TaskAltIcon sx={{ fontSize: 18, color: '#90caf9' }} />;
    return <EditNoteIcon sx={{ fontSize: 18, color: '#fbc02d' }} />;
};

// Mirror RequirementRow getCoordinationIcon — visible only for swarm_ready/development.
const getCoordinationIcon = (status, coordType) => {
    if (!['swarm_ready', 'development'].includes(status)) return null;
    if (coordType === 'planned')     return <DescriptionIcon sx={{ fontSize: 18, color: '#90caf9' }} />;
    if (coordType === 'implemented') return <BuildIcon sx={{ fontSize: 18, color: '#4caf50' }} />;
    if (coordType === 'deployed')    return <CloudUploadIcon sx={{ fontSize: 18, color: '#b39ddb' }} />;
    return <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />;
};


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

    const status = requirement?.requirement_status;
    const coordType = requirement?.coordination_type || null;

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
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28 }}>
                            {getStatusIcon(status)}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28 }}>
                            {getCoordinationIcon(status, coordType)}
                        </Box>
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
