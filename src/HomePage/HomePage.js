import '../index.css';
import AuthContext from '../Context/AuthContext';

import React,  { useContext } from 'react';
import { useCookies } from 'react-cookie';
import cryptoRandomString from 'crypto-random-string';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const HomePage = () => {

    console.count('HomePage Render');

    const { idToken, } = useContext(AuthContext);
    const [cookies, setCookie] = useCookies(['csrfToken']);

    if (!idToken) {
        // generate CSRF token for login and store in a cookie w/60m expiry
        var generatedCsrf = cryptoRandomString({length: 64, type: 'alphanumeric'});
        setCookie('csrfToken', generatedCsrf, { path: '/', maxAge: 3600 });
    }
        
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
                <Typography variant="body1"
                             component="a"
                              href={`https://darwin2.auth.us-west-1.amazoncognito.com/login?response_type=token&state=${generatedCsrf}&client_id=4qv8m44mllqllljbenbeou4uis&scope=aws.cognito.signin.user.admin+email+openid&redirect_uri=https://localhost:3001/loggedin/`}
                              sx={{marginBottom: 2 }} >
                    Login / Create Account
                </Typography>
             :
                <Typography variant="body1"
                            component="a"
                            href="https://darwin2.auth.us-west-1.amazoncognito.com/logout?client_id=4qv8m44mllqllljbenbeou4uis&logout_uri=https://localhost:3001/"
                            sx={{marginBottom: 2 }} >
                    Logout
                </Typography>
            }
        </Box>
        </>
    )
}

export default HomePage;
