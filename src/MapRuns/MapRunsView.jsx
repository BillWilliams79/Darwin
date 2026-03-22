import React, { useState, useContext, useMemo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { useMapRuns, useMapRoutes } from '../hooks/useDataQueries';
import { mapRunKeys, mapRouteKeys } from '../hooks/useQueryKeys';

// Column widths + DataGrid chrome (borders + column separators + scrollbar gutter + cell padding)
export const TABLE_WIDTH = 250 + 180 + 90 + 100 + 110 + 90 + 90 + 110 + 110 + 200 + 50;

/**
 * Format seconds as "H:MM:SS".
 */
function formatDuration(totalSeconds) {
    if (totalSeconds == null) return '';
    const s = Math.floor(totalSeconds);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const MapRunsView = () => {
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const queryClient = useQueryClient();
    const creatorFk = profile?.id;

    const { data: runs = [], isLoading: runsLoading } = useMapRuns(creatorFk);
    const { data: routes = [], isLoading: routesLoading } = useMapRoutes(creatorFk);

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // Build route lookup: map_routes.id → name
    const routeMap = useMemo(() => {
        const m = new Map();
        for (const route of routes) {
            m.set(route.id, route.name);
        }
        return m;
    }, [routes]);

    // Format start_time using user's timezone from profile
    const dateFormatter = useMemo(() => {
        const tz = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        return new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });
    }, [profile?.timezone]);

    const columns = [
        {
            field: 'start_time',
            headerName: 'Date',
            width: 250,
            valueFormatter: (value) => {
                if (!value) return '';
                // start_time is UTC DATETIME from SQL; append Z for UTC parsing
                const d = new Date(value.endsWith('Z') ? value : value + 'Z');
                return dateFormatter.format(d);
            },
        },
        {
            field: 'route_name',
            headerName: 'Route',
            width: 180,
            valueGetter: (value, row) => routeMap.get(row.map_route_fk) || '',
        },
        { field: 'activity_name', headerName: 'Activity', width: 90 },
        {
            field: 'distance_mi',
            headerName: 'Distance',
            width: 100,
            type: 'number',
            valueFormatter: (value) => value != null ? Number(value).toFixed(1) : '',
        },
        {
            field: 'run_time_sec',
            headerName: 'Run Time',
            width: 110,
            valueFormatter: (value) => formatDuration(value),
        },
        {
            field: 'ascent_ft',
            headerName: 'Ascent',
            width: 90,
            type: 'number',
            valueFormatter: (value) => value != null ? Number(value).toLocaleString() : '',
        },
        {
            field: 'descent_ft',
            headerName: 'Descent',
            width: 90,
            type: 'number',
            valueFormatter: (value) => value != null ? Number(value).toLocaleString() : '',
        },
        {
            field: 'max_speed_mph',
            headerName: 'Max Speed',
            width: 110,
            type: 'number',
            valueFormatter: (value) => value != null ? Number(value).toFixed(1) : '',
        },
        {
            field: 'avg_speed_mph',
            headerName: 'Avg Speed',
            width: 110,
            type: 'number',
            valueFormatter: (value) => value != null ? Number(value).toFixed(2) : '',
        },
        {
            field: 'notes',
            headerName: 'Notes',
            width: 200,
            renderCell: (params) => (
                <Box sx={{
                    whiteSpace: 'normal',
                    lineHeight: 1.3,
                    py: 0.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                }}>
                    {params.value || ''}
                </Box>
            ),
        },
    ];

    const handleDeleteAll = async () => {
        setDeleteDialogOpen(false);
        setDeleting(true);

        try {
            // Delete all runs (CASCADE cleans coordinates)
            for (const run of runs) {
                await call_rest_api(`${darwinUri}/map_runs`, 'DELETE', { id: run.id }, idToken);
            }

            // Delete all routes
            for (const route of routes) {
                await call_rest_api(`${darwinUri}/map_routes`, 'DELETE', { id: route.id }, idToken);
            }

            // Invalidate caches
            queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
            queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });

            setSnackbar({ open: true, message: 'All map data deleted', severity: 'success' });
        } catch (err) {
            console.error('[MapRuns] Delete error:', err);
            setSnackbar({ open: true, message: 'Delete failed', severity: 'error' });
        } finally {
            setDeleting(false);
        }
    };

    const isLoading = runsLoading || routesLoading;

    return (
        <Box sx={{ mt: 1, px: 2, maxWidth: TABLE_WIDTH }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                    {runs.length} runs{routes.length > 0 ? ` across ${routes.length} routes` : ''}
                </Typography>
                <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    startIcon={deleting ? <CircularProgress size={16} /> : <DeleteForeverIcon />}
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={runs.length === 0 || deleting}
                    data-testid="delete-all-button"
                >
                    Delete All
                </Button>
            </Box>

            <Box sx={{ height: 'calc(100vh - 200px)', minHeight: 400 }}>
                <DataGrid
                    rows={runs}
                    columns={columns}
                    loading={isLoading}
                    getRowHeight={() => 'auto'}
                    slots={{ toolbar: GridToolbar }}
                    slotProps={{
                        toolbar: {
                            showQuickFilter: true,
                        },
                    }}
                    initialState={{
                        sorting: {
                            sortModel: [{ field: 'start_time', sort: 'desc' }],
                        },
                        pagination: {
                            paginationModel: { pageSize: 25 },
                        },
                    }}
                    pageSizeOptions={[25, 50, 100]}
                    disableRowSelectionOnClick
                    density="compact"
                />
            </Box>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
                <DialogTitle>Delete All Map Data?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        This will permanently delete all {runs.length} runs, their GPS coordinates,
                        and {routes.length} routes. This cannot be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleDeleteAll} color="error" variant="contained">
                        Delete All
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={6000}
                onClose={() => setSnackbar(s => ({ ...s, open: false }))}
            >
                <Alert
                    onClose={() => setSnackbar(s => ({ ...s, open: false }))}
                    severity={snackbar.severity}
                    variant="filled"
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default MapRunsView;
