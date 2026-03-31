import React, { useState, useContext, useMemo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import { DataGrid, useGridApiRef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { useMapRoutes, useMapRuns } from '../hooks/useDataQueries';
import { mapRouteKeys, mapRunKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';

const MapRouteSettingsView = () => {
    const navigate = useNavigate();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const queryClient = useQueryClient();
    const creatorFk = profile?.id;
    const showError = useSnackBarStore(s => s.showError);
    const apiRef = useGridApiRef();

    const { data: routes = [], isLoading: routesLoading } = useMapRoutes(creatorFk);
    const { data: runs = [], isLoading: runsLoading } = useMapRuns(creatorFk);

    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [newRouteName, setNewRouteName] = useState('');
    const [addSaving, setAddSaving] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null, name: '' });
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // Compute ride count per route
    const rideCountMap = useMemo(() => {
        const m = new Map();
        for (const run of runs) {
            if (run.map_route_fk != null) {
                m.set(run.map_route_fk, (m.get(run.map_route_fk) || 0) + 1);
            }
        }
        return m;
    }, [runs]);

    // Build DataGrid rows
    const rows = useMemo(() =>
        routes.map(r => ({ ...r, ride_count: rideCountMap.get(r.id) || 0 })),
        [routes, rideCountMap]
    );

    const handleAddRoute = async () => {
        const name = newRouteName.trim();
        if (!name) return;
        setAddSaving(true);
        try {
            await call_rest_api(`${darwinUri}/map_routes`, 'POST', { name, creator_fk: creatorFk }, idToken);
            queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
            setSnackbar({ open: true, message: 'Route added', severity: 'success' });
            setAddDialogOpen(false);
            setNewRouteName('');
        } catch (err) {
            showError(err, 'Failed to add route');
        } finally {
            setAddSaving(false);
        }
    };

    const handleProcessRowUpdate = async (newRow, oldRow) => {
        if (newRow.name === oldRow.name) return oldRow;
        const name = newRow.name.trim();
        if (!name) return oldRow;
        try {
            await call_rest_api(`${darwinUri}/map_routes`, 'PUT', [{ id: newRow.id, name }], idToken);
            queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
            setSnackbar({ open: true, message: 'Route renamed', severity: 'success' });
            return { ...newRow, name };
        } catch (err) {
            showError(err, 'Failed to rename route');
            return oldRow;
        }
    };

    const handleDeleteConfirm = async () => {
        const { id } = deleteConfirm;
        setDeleteConfirm({ open: false, id: null, name: '' });
        try {
            await call_rest_api(`${darwinUri}/map_routes`, 'DELETE', { id }, idToken);
            queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
            queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
            setSnackbar({ open: true, message: 'Route deleted', severity: 'success' });
        } catch (err) {
            showError(err, 'Failed to delete route');
        }
    };

    const columns = [
        {
            field: 'name',
            headerName: 'Route Name',
            flex: 1,
            editable: true,
        },
        {
            field: 'ride_count',
            headerName: 'Rides',
            width: 120,
            type: 'number',
        },
        {
            field: 'actions',
            headerName: '',
            width: 60,
            sortable: false,
            renderCell: (params) => (
                <IconButton
                    size="small"
                    onClick={() => setDeleteConfirm({ open: true, id: params.row.id, name: params.row.name })}
                    data-testid={`delete-route-${params.row.id}`}
                >
                    <DeleteIcon fontSize="small" />
                </IconButton>
            ),
        },
    ];

    return (
        <Box sx={{ p: 2, maxWidth: 700 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Button
                    startIcon={<ArrowBackIcon />}
                    onClick={() => navigate('/maps')}
                    size="small"
                    data-testid="back-to-maps"
                >
                    Maps
                </Button>
                <Typography variant="h6" sx={{ flex: 1 }}>Routes</Typography>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    size="small"
                    onClick={() => setAddDialogOpen(true)}
                    data-testid="add-route-button"
                >
                    Add Route
                </Button>
            </Box>

            <DataGrid
                apiRef={apiRef}
                rows={rows}
                columns={columns}
                loading={routesLoading || runsLoading}
                processRowUpdate={handleProcessRowUpdate}
                onProcessRowUpdateError={(err) => showError(err, 'Failed to rename route')}
                onCellClick={(params) => {
                    if (params.field === 'name' && apiRef.current.getCellMode(params.id, params.field) === 'view') {
                        apiRef.current.startCellEditMode({ id: params.id, field: params.field });
                    }
                }}
                initialState={{
                    sorting: { sortModel: [{ field: 'name', sort: 'asc' }] },
                }}
                autoHeight
                disableRowSelectionOnClick
                density="compact"
                data-testid="routes-datagrid"
            />

            {/* Add Route Dialog */}
            <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Add Route</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        label="Route Name"
                        value={newRouteName}
                        onChange={(e) => setNewRouteName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddRoute()}
                        fullWidth
                        size="small"
                        sx={{ mt: 1 }}
                        inputProps={{ 'data-testid': 'add-route-name-input' }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => { setAddDialogOpen(false); setNewRouteName(''); }}>Cancel</Button>
                    <Button
                        onClick={handleAddRoute}
                        disabled={!newRouteName.trim() || addSaving}
                        variant="contained"
                        data-testid="add-route-submit"
                    >
                        Add
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Delete Confirm Dialog */}
            <Dialog
                open={deleteConfirm.open}
                onClose={() => setDeleteConfirm({ open: false, id: null, name: '' })}
            >
                <DialogTitle>Delete Route?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Delete "{deleteConfirm.name}"? Rides using this route will not be deleted, but will have no assigned route.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteConfirm({ open: false, id: null, name: '' })}>Cancel</Button>
                    <Button onClick={handleDeleteConfirm} color="error" variant="contained" data-testid="delete-route-confirm">
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar
                open={snackbar.open}
                autoHideDuration={3000}
                onClose={() => setSnackbar(s => ({ ...s, open: false }))}
            >
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(s => ({ ...s, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default MapRouteSettingsView;
