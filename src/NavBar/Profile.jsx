import ProfileContent from './ProfileContent';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const Profile = () => {
    return (
        <>
        <Box className="app-title" sx={{ ml: 2}}>
            <Typography variant="h5">
                Profile
            </Typography>
        </Box>
        <Box className="app-content" sx={{ margin: 2, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400 }}>
            <ProfileContent />
        </Box>
        </>
    );
};

export default Profile;
