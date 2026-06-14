import '../index.css';
import React, { useState, useMemo, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import TablePagination from '@mui/material/TablePagination';

import RouteCard from './RouteCard';
import { TABLE_WIDTH } from '../MapRuns/MapRunsView';
import { loadIndex } from '../photo-browser/handleDB.js';
import { deduplicateIndex } from '../photo-browser/filterUtils.js';
import { IS_MACOS } from '../photo-browser/proxyConfig.js';

// Same gate as RouteCard's camera button — only load the photo index when the
// photo-browser feature is available. Resolved once at module load.
const PHOTO_FEATURE_ENABLED = IS_MACOS && localStorage.getItem('photo-browser-enabled') !== 'false';

const RouteCardView = ({ runs = [], allRuns = [], routes = [], partners = [], runPartners = [], isLoading = false }) => {
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);

    // Build route lookup
    const routeMap = useMemo(() => {
        const m = new Map();
        for (const route of routes) m.set(route.id, route.name);
        return m;
    }, [routes]);

    // Load the photo index once (if available in IndexedDB) and dedupe a single time,
    // then hand the deduped list to every card so each can count its own photos without
    // re-loading or re-deduping. Null until loaded → cards render no count (req #2855).
    const [photoIndex, setPhotoIndex] = useState(null);
    useEffect(() => {
        if (!PHOTO_FEATURE_ENABLED) return;
        let cancelled = false;
        loadIndex().then(idx => {
            if (!cancelled && idx && idx.length > 0) setPhotoIndex(idx);
        });
        return () => { cancelled = true; };
    }, []);
    const dedupedPhotoIndex = useMemo(
        () => (photoIndex ? deduplicateIndex(photoIndex) : null),
        [photoIndex]
    );

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    const paginatedRuns = rowsPerPage === -1 ? runs : runs.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

    const handleChangePage = (event, newPage) => {
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    return (
        <Box sx={{ px: 2, pt: 1, maxWidth: TABLE_WIDTH }}>
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
                        dedupedPhotoIndex={dedupedPhotoIndex}
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
                    rowsPerPageOptions={(() => {
                        const opts = runs.length > 100 ? [25, 50, 100] : [25, 50];
                        if (runs.length >= 100 && runs.length <= 300) opts.push({ value: -1, label: 'All' });
                        return opts;
                    })()}
                    labelRowsPerPage="Maps per page"
                    data-testid="route-card-pagination"
                />
            )}
        </Box>
    );
};

export default RouteCardView;
