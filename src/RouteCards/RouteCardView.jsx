import '../index.css';
import React, { useState, useContext, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import TablePagination from '@mui/material/TablePagination';

import AuthContext from '../Context/AuthContext';
import { useMapRuns, useMapRoutes } from '../hooks/useDataQueries';
import { useTrendsStore } from '../stores/useTrendsStore';
import RouteCard from './RouteCard';

const RouteCardView = ({ timeFilter }) => {
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.id;

    const { data: rawRuns = [], isLoading: runsLoading } = useMapRuns(creatorFk);
    const { data: routes = [] } = useMapRoutes(creatorFk);
    const selectedRouteIds = useTrendsStore(s => s.selectedRouteIds);

    const allRuns = useMemo(() => {
        let filtered = rawRuns;
        if (timeFilter) {
            filtered = filtered.filter(run => {
                const t = new Date(run.start_time.endsWith?.('Z') ? run.start_time : run.start_time + 'Z');
                return t >= timeFilter.start && t < timeFilter.end;
            });
        }
        if (selectedRouteIds.length > 0) {
            const idSet = new Set(selectedRouteIds);
            filtered = filtered.filter(run => idSet.has(run.map_route_fk));
        }
        return filtered;
    }, [rawRuns, timeFilter, selectedRouteIds]);

    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);

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

    const paginatedRuns = allRuns.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

    const handleChangePage = (event, newPage) => {
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    return (
        <Box sx={{ px: 3, pt: 1 }}>
            {allRuns.length === 0 && (
                <Typography variant="body2" color="text.disabled" sx={{ p: 2 }}>
                    No activities found. Import data via Maps &gt; Import.
                </Typography>
            )}

            {/* Card grid — same className as TaskPlanView */}
            <Box className="card" sx={{ pb: 2 }}>
                {paginatedRuns.map(run => (
                    <RouteCard
                        key={run.id}
                        run={run}
                        routeName={routeMap.get(run.map_route_fk)}
                        routes={routes}
                        allRuns={allRuns}
                    />
                ))}
            </Box>

            {allRuns.length > 0 && (
                <TablePagination
                    component="div"
                    count={allRuns.length}
                    page={page}
                    onPageChange={handleChangePage}
                    rowsPerPage={rowsPerPage}
                    onRowsPerPageChange={handleChangeRowsPerPage}
                    rowsPerPageOptions={allRuns.length > 100 ? [25, 50, 100] : [25, 50]}
                    labelRowsPerPage="Maps per page"
                    data-testid="route-card-pagination"
                />
            )}
        </Box>
    );
};

export default RouteCardView;
