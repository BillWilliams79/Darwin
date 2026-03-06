import '../index.css';
import AuthContext from '../Context/AuthContext';
import { useAppModeStore } from '../stores/useAppModeStore';

import React, {useContext, useEffect} from 'react';
import { Link, useNavigate, useLocation } from "react-router-dom"

import AppBar from '@mui/material/AppBar';
import PedalBikeIcon from '@mui/icons-material/PedalBike';
import HomeIcon from '@mui/icons-material/Home';
import Stack from '@mui/material/Stack';

const TASK_ROUTES = ['/taskcards', '/calview', '/domainedit', '/areaedit'];
const SWARM_ROUTES = ['/swarm', '/devservers'];

function inferModeFromPath(pathname) {
    if (TASK_ROUTES.some(r => pathname.startsWith(r))) return 'tasks';
    if (SWARM_ROUTES.some(r => pathname.startsWith(r))) return 'swarm';
    return null;
}

const NAV_LINKS = {
    tasks: [
        { to: '/taskcards', label: 'Plan' },
        { to: '/calview', label: 'Calendar' },
        { to: '/domainedit', label: 'Domains' },
        { to: '/areaedit', label: 'Areas' },
    ],
    swarm: [
        { to: '/swarm', label: 'Swarm' },
        { to: '/swarm/sessions', label: 'Sessions' },
        { to: '/devservers', label: 'Dev Servers' },
    ],
};

const NavBar = () => {
    console.count('Navbar render');
    const { idToken } = useContext(AuthContext);
    const { appMode, setAppMode, clearAppMode } = useAppModeStore();
    const navigate = useNavigate();
    const location = useLocation();

    const effectiveMode = appMode || inferModeFromPath(location.pathname);
    useEffect(() => {
        if (effectiveMode && !appMode) {
            setAppMode(effectiveMode);
        }
    }, [effectiveMode, appMode, setAppMode]);

    const handleHome = () => {
        clearAppMode();
        navigate('/');
    };

    const links = effectiveMode ? NAV_LINKS[effectiveMode] : [];

  return (
    <AppBar className="app-navbar" position="static" sx={{backgroundColor: 'black', padding: 2,  pb: {xs:2, md:3} }}>
        <Stack direction={{ xs: 'row', md: 'column', }}
               spacing={1}
               alignItems={{xs: 'center', md: 'flex-start'}}
        >
          {idToken ? (
            <Link to="/profile" style={{ display: 'flex' }}>
              <PedalBikeIcon sx={{ color: '#E91E63' }} />
            </Link>
          ) : (
            <PedalBikeIcon sx={{ color: '#E91E63' }} />
          )}
          <Link className="nav-title" to="/">
            Darwin
          </Link>
          {links.map(({ to, label }) => (
            <Link key={to} className="nav-link" to={to}> {label} </Link>
          ))}
          {effectiveMode && (
            <Link
              className="nav-link"
              to="/"
              onClick={(e) => { e.preventDefault(); handleHome(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              data-testid="nav-home"
            >
              <HomeIcon fontSize="small" /> Home
            </Link>
          )}
        </Stack>
    </AppBar>
  );
};

export default NavBar;
