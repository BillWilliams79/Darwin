import ProfileContent from './ProfileContent';

import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';

const ProfileDialog = ({ open, onClose }) => {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                Profile
                <IconButton onClick={onClose} size="small" data-testid="profile-dialog-close">
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>
            <DialogContent style={{ paddingTop: 12 }}>
                <ProfileContent onClose={onClose} />
            </DialogContent>
        </Dialog>
    );
};

export default ProfileDialog;
