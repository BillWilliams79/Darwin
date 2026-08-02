import AuthContext from '../Context/AuthContext';
import { NAV_GROUPS, NAV_LINKS, GROUP_PROFILE_KEY, GROUP_PROFILE_DEFAULT } from '../NavBar/navConfig';

import React, { useContext, useMemo } from 'react';
import { Navigate } from 'react-router-dom';

import CircularProgress from '@mui/material/CircularProgress';

const HomePage = () => {

    const { idToken, authLoading, profile } = useContext(AuthContext);

    const homePath = useMemo(() => {
        if (import.meta.env.DEV) {
            // Session-scoped default (req #3242): devserver-start.sh writes
            // VITE_DEV_DEFAULT_ROUTE into this worktree's own
            // .env.development.local whenever a deep-link ROUTE is passed, so
            // this session's dev server opens to the surface it's about
            // rather than the hardcoded /systems2 fallback below — every
            // other worktree's dev server, and production, are unaffected.
            return import.meta.env.VITE_DEV_DEFAULT_ROUTE || '/systems2';
        }
        // Find first link of first enabled group. Per-key default lives in
        // GROUP_PROFILE_DEFAULT (req #2611) — must match NavBarSidebar so a
        // default-off app (Swarm Validate) is never treated as enabled while
        // the profile row is still loading.
        const firstEnabledGroup = NAV_GROUPS.find(g => {
            const key = GROUP_PROFILE_KEY[g.id];
            if (!key) return true;
            const fallback = GROUP_PROFILE_DEFAULT[key] ?? 1;
            return Number(profile?.[key] ?? fallback) === 1;
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
