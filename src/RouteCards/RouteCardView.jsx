import '../index.css';
import React, { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import TablePagination from '@mui/material/TablePagination';

import RouteCard from './RouteCard';

const RouteCardView = ({ runs = [], allRuns = [], routes = [], partners = [], runPartners = [], isLoading = false }) => {
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);

    // Build route lookup
    const routeMap = useMemo(() => {
        const m = new Map();
        for (const route of routes) m.set(route.id, route.name);
        return m;
    }, [routes]);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    const paginatedRuns = runs.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

    const handleChangePage = (event, newPage) => {
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    return (
        <Box sx={{ px: 3, pt: 1 }}>
            {runs.length === 0 && (
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
                        partners={partners}
                        runPartners={runPartners}
                    />
                ))}
            </Box>

            {runs.length > 0 && (
                <TablePagination
                    component="div"
                    count={runs.length}
                    page={page}
                    onPageChange={handleChangePage}
                    rowsPerPage={rowsPerPage}
                    onRowsPerPageChange={handleChangeRowsPerPage}
                    rowsPerPageOptions={runs.length > 100 ? [25, 50, 100] : [25, 50]}
                    labelRowsPerPage="Maps per page"
                    data-testid="route-card-pagination"
                />
            )}
        </Box>
    );
};

export default RouteCardView;
