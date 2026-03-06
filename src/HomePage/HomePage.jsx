import '../index.css';
// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import AuthContext from '../Context/AuthContext';
import { useAppModeStore } from '../stores/useAppModeStore';

import React, { useContext } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AssignmentIcon from '@mui/icons-material/Assignment';
import HiveIcon from '@mui/icons-material/Hive';

const APP_PRIMARY_ROUTES = {
    tasks: '/taskcards',
    swarm: '/swarm',
};

const HomePage = () => {

    console.count('HomePage Render');

    const { idToken } = useContext(AuthContext);
    const { appMode, setAppMode } = useAppModeStore();
    const navigate = useNavigate();

    const selectMode = (mode) => {
        setAppMode(mode);
        navigate(APP_PRIMARY_ROUTES[mode]);
    };

    if (idToken && appMode) {
        return <Navigate to={APP_PRIMARY_ROUTES[appMode]} replace />;
    }

    return (
        <>
        <Box className="app-title">
            <Typography variant="h3">
                Welcome to Darwin
            </Typography>
        </Box>
        <Box className="app-homepage">
            {!idToken ?
                <Typography key="login"
                            variant="body1"
                            component={Link}
                            to="/login"
                            sx={{marginBottom: 2 }} >
                    Login / Create Account
                </Typography>
             :
                <>
                <Typography variant="h6" sx={{ mb: 2 }}>
                    Select an App
                </Typography>
                <Stack direction="row" spacing={3}>
                    <Button
                        data-testid="app-mode-tasks"
                        variant="contained"
                        size="large"
                        startIcon={<AssignmentIcon />}
                        onClick={() => selectMode('tasks')}
                        sx={{ px: 4, py: 2, fontSize: '1.1rem' }}
                    >
                        Tasks
                    </Button>
                    <Button
                        data-testid="app-mode-swarm"
                        variant="contained"
                        size="large"
                        startIcon={<HiveIcon />}
                        onClick={() => selectMode('swarm')}
                        sx={{ px: 4, py: 2, fontSize: '1.1rem' }}
                    >
                        Swarm
                    </Button>
                </Stack>
                <Typography key="logout"
                            variant="body1"
                            component={Link}
                            to="/logout"
                            sx={{ mt: 4 }} >
                    Logout
                </Typography>
                </>
            }
        </Box>
        </>
    )
}

export default HomePage;
