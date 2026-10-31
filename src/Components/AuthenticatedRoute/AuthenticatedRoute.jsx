// eslint-disable-next-line no-unused-vars
import varDump from '../../classifier/classifier';

import AuthContext from '../../Context/AuthContext'

import {React, useContext} from 'react'
import {Navigate, useLocation } from 'react-router-dom';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import { PROXY_AUTH, PRODUCT_NAME } from '../../config/product';


// req #4076 — proxy auth has no login page to send anyone to: the server
// authenticated the request before the app loaded. A missing user means the
// server did not map this login to a profile, which only an admin can fix.
export const ProxyNotIdentified = ({ status }) => (
    <Box sx={{ p: 3, maxWidth: 560 }} data-testid="proxy-auth-unidentified">
        <Alert severity="error">
            {PRODUCT_NAME} could not identify you{status ? ` (HTTP ${status})` : ''}. Your login was
            accepted, but no {PRODUCT_NAME} profile is mapped to it — ask the administrator to add you.
        </Alert>
    </Box>
);

const AuthenticatedRoute = ({children}) => {
    const { idToken, profile, authLoading, authError } = useContext(AuthContext);
    const location = useLocation();

    // While silent refresh is in progress (page reload), show spinner instead of redirecting
    if (authLoading) {
        return <CircularProgress />;
    }

    if (PROXY_AUTH && ((profile?.userName === undefined) || (!idToken))) {
        return <ProxyNotIdentified status={authError} />;
    }

    if ((profile?.userName === undefined) || (!idToken)) {

        // user is not logged in — send them to the custom /login form (LoginPage),
        // saving the current URL in route state so LoginPage can return them here
        return <Navigate to="/login" replace={true} state={{ from: location }} />;

    } else {

        // User is authenticated, so allow access to child component
        return children
    }
}

export default AuthenticatedRoute
