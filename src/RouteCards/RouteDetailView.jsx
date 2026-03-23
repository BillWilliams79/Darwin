import React, { useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import AuthContext from '../Context/AuthContext';
import { useMapRuns, useMapRoutes, useMapCoordinates } from '../hooks/useDataQueries';
import RouteMapFull from './RouteMapFull';
import RouteStatsOverlay from './RouteStatsOverlay';

const RouteDetailView = () => {
    const { runId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.id;

    const fromCalendar = location.state?.from === 'calendar';
    const backPath = fromCalendar ? '/calview' : '/maps';
    const backLabel = fromCalendar ? 'Back to Calendar' : '{backLabel}';

    const { data: allRuns = [], isLoading: runsLoading } = useMapRuns(creatorFk);
    const { data: routes = [] } = useMapRoutes(creatorFk);
    const { data: coordinates = [], isLoading: coordsLoading } = useMapCoordinates(Number(runId));

    // Find the specific run
    const run = allRuns.find(r => String(r.id) === String(runId));

    // Build route lookup
    const routeMap = new Map();
    for (const route of routes) {
        routeMap.set(route.id, route.name);
    }

    if (runsLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!run) {
        return (
            <Box sx={{ p: 3 }}>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backPath)} sx={{ mb: 2 }}>
                    {backLabel}
                </Button>
                <Typography color="error">Run not found.</Typography>
            </Box>
        );
    }

    const routeName = routeMap.get(run.map_route_fk);

    return (
        <Box sx={{ p: 3 }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backPath)} sx={{ mb: 2 }}>
                {backLabel}
            </Button>

            <RouteMapFull coordinates={coordinates} isLoading={coordsLoading} />
            <RouteStatsOverlay run={run} routeName={routeName} />
        </Box>
    );
};

export default RouteDetailView;
