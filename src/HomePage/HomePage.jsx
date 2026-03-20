import AuthContext from '../Context/AuthContext';
import { NAV_GROUPS, NAV_LINKS, GROUP_PROFILE_KEY } from '../NavBar/navConfig';

import React, { useContext, useMemo } from 'react';
import { Navigate } from 'react-router-dom';

import CircularProgress from '@mui/material/CircularProgress';

const HomePage = () => {

    const { idToken, authLoading, profile } = useContext(AuthContext);

    const homePath = useMemo(() => {
        // Find first link of first enabled group
        const firstEnabledGroup = NAV_GROUPS.find(g => {
            const key = GROUP_PROFILE_KEY[g.id];
            return !key || (profile?.[key] ?? 1) === 1;
        });
        if (firstEnabledGroup) {
            const firstLink = NAV_LINKS.find(l => l.group === firstEnabledGroup.id);
            if (firstLink) return firstLink.path;
        }
        return '/taskcards'; // fallback
    }, [profile]);

    if (authLoading) {
        return <CircularProgress />;
    }

    if (idToken) {
        return <Navigate to={homePath} replace />;
    }

    return <Navigate to="/profile" replace />;
}

export default HomePage;
