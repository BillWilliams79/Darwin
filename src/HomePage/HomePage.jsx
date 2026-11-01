import AuthContext from '../Context/AuthContext';
import { NAV_GROUPS, NAV_LINKS, DEV_HOME_ROUTE, PRODUCT_HOME_ROUTE, isGroupVisible } from '../NavBar/navConfig';
import { PROXY_AUTH } from '../config/product';
import { ProxyNotIdentified } from '../Components/AuthenticatedRoute/AuthenticatedRoute';

import React, { useContext, useMemo } from 'react';
import { Navigate } from 'react-router-dom';

import CircularProgress from '@mui/material/CircularProgress';

const HomePage = () => {

    const { idToken, authLoading, profile, authError } = useContext(AuthContext);

    const homePath = useMemo(() => {
        if (import.meta.env.DEV) {
            // Session-scoped default (req #3242): devserver-start.sh writes
            // VITE_DEV_DEFAULT_ROUTE into this worktree's own
            // .env.development.local whenever a deep-link ROUTE is passed, so
            // this session's dev server opens to the surface it's about
            // rather than the hardcoded /systems2 fallback below — every
            // other worktree's dev server, and production, are unaffected.
            return DEV_HOME_ROUTE;
        }
        // req #4076 — a scoped product (internal: Topology) has a fixed home.
        if (PRODUCT_HOME_ROUTE) return PRODUCT_HOME_ROUTE;
        // Find first link of first enabled group — the SAME predicate
        // NavBarSidebar filters with (req #2611, #3790), so a default-off app
        // (Swarm Validate) is never treated as enabled while the profile row
        // is still loading.
        const firstEnabledGroup = NAV_GROUPS.find(g => isGroupVisible(profile, g.id));
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

    // Proxy auth has no sign-in page: no user means the server named nobody.
    if (PROXY_AUTH) return <ProxyNotIdentified status={authError} />;

    return <Navigate to="/profile" replace />;
}

export default HomePage;
