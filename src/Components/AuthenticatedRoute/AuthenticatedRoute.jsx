// eslint-disable-next-line no-unused-vars
import varDump from '../../classifier/classifier';

import AuthContext from '../../Context/AuthContext'

import {React, useContext} from 'react'
import {Navigate, useLocation } from 'react-router-dom';
import CircularProgress from '@mui/material/CircularProgress';


const AuthenticatedRoute = ({children}) => {
    const { idToken, profile, authLoading } = useContext(AuthContext);
    const location = useLocation();

    // While silent refresh is in progress (page reload), show spinner instead of redirecting
    if (authLoading) {
        return <CircularProgress />;
    }

    if ((profile?.userName === undefined) || (!idToken)) {

        // user is not logged in, process login via LoginLink component
        // while saving the current URL for redirect
        return <Navigate to="/login" replace={true} state={{ from: location }} />;

    } else {

        // User is authenticated, so allow access to child component
        return children
    }
}

export default AuthenticatedRoute
