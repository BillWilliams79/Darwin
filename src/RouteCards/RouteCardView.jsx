import '../index.css';
import React, { useContext } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import AuthContext from '../Context/AuthContext';
import { useMapRuns, useMapRoutes } from '../hooks/useDataQueries';
import RouteCard from './RouteCard';

const RouteCardView = () => {
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.id;

    const { data: allRuns = [], isLoading: runsLoading } = useMapRuns(creatorFk);
    const { data: routes = [] } = useMapRoutes(creatorFk);

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

    return (
        <Box sx={{ p: 3 }}>
            {/* Domain header — placeholder */}
            <Typography sx={{ fontSize: 24, fontWeight: 'normal', mb: 2 }}>
                Activities
            </Typography>

            {allRuns.length === 0 && (
                <Typography variant="body2" color="text.disabled" sx={{ p: 2 }}>
                    No activities found. Import data via Maps &gt; Import.
                </Typography>
            )}

            {/* Card grid — same className as TaskPlanView */}
            <Box className="card">
                {allRuns.map(run => (
                    <RouteCard
                        key={run.id}
                        run={run}
                        routeName={routeMap.get(run.map_route_fk)}
                    />
                ))}
            </Box>
        </Box>
    );
};

export default RouteCardView;
