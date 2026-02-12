import '../index.css';
// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import AuthContext from '../Context/AuthContext';

import React, { useContext } from 'react';
import { Link } from 'react-router-dom';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const HomePage = () => {

    console.count('HomePage Render');

    const { idToken } = useContext(AuthContext);

    return (
        <>
        <Box className="app-title">
            <Typography variant="h3">
                Welcome to Darwin
            </Typography>
        </Box>
        <Box className="app-homepage">
            <Typography variant="h6">
                Accounts
            </Typography>
            {!idToken ?
                <Typography key="login"
                            variant="body1"
                            component={Link}
                            to="/login"
                            sx={{marginBottom: 2 }} >
                    Login / Create Account
                </Typography>
             :
                <Typography key="logout"
                            variant="body1"
                            component="a"
                            href="logout"
                            sx={{marginBottom: 0 }} >
                    Logout
                </Typography>
            }
        </Box>
        </>
    )
}

export default HomePage;
