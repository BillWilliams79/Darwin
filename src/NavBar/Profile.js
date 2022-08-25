import '../index.css';
import AuthContext from '../Context/AuthContext';

import React, {useContext} from 'react';

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

const Profile = () => {

    console.count('Profile Render');

    const { profile } = useContext(AuthContext);
    
    return (
        <>
        <Box className="app-title" sx={{ ml: 2}}>
            <Typography variant="h5">
                Profile
            </Typography>
        </Box >
        <Box className="app-content" sx={{ margin: 2}}>
            <TextField  label="Name"
                        value = { profile.name }
                        id= "Name"
                        key="Name"
                        variant= "outlined"
                        size = 'small' />
            <TextField  label="E-mail"
                        value = { profile.email }
                        id= "email"
                        key="email"
                        variant= "outlined"
                        size = 'small' />
            <TextField  label="Region"
                        value = { profile.region }
                        id= "region"
                        key="region"
                        variant= "outlined"
                        size = 'small' />
            <TextField  label="User Pool ID"
                        value = { profile.userPoolId }
                        id= "userPoolId"
                        key="userPoolId"
                        variant= "outlined"
                        size = 'small' />
            <TextField  label="Cognito Identifier"
                        value = { profile.userName }
                        id= "userName"
                        key="userName"
                        variant= "outlined"
                        size = 'small' />
        </Box>
        </>
    )
}

export default Profile;
