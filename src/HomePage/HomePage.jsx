import AuthContext from '../Context/AuthContext';

import React, { useContext } from 'react';
import { Navigate } from 'react-router-dom';

import CircularProgress from '@mui/material/CircularProgress';

const HomePage = () => {

    const { idToken, authLoading } = useContext(AuthContext);

    if (authLoading) {
        return <CircularProgress />;
    }

    if (idToken) {
        return <Navigate to="/taskcards" replace />;
    }

    return <Navigate to="/profile" replace />;
}

export default HomePage;
