import React, { useState, useContext, useMemo } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import TextField from '@mui/material/TextField';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { mapRunKeys, mapRouteKeys, mapPartnerKeys, mapRunPartnerKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import RideEditDialog from '../RouteCards/RideEditDialog';

// Column widths + DataGrid chrome (borders + column separators + scrollbar gutter + cell padding)
export const TABLE_WIDTH = 50 + 250 + 180 + 90 + 100 + 110 + 90 + 90 + 110 + 110 + 400 + 200 + 50;

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

const MapRunsView = ({ runs = [], allRuns = [], routes = [], partners = [], runPartners = [], isLoading = false }) => {
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const queryClient = useQueryClient();
    const creatorFk = profile?.id;

    const showError = useSnackBarStore(s => s.showError);

    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // Row selection state (v8 shape: include = only these, exclude = all except these)
    const [rowSelectionModel, setRowSelectionModel] = useState({ type: 'include', ids: new Set() });
    const selectedCount = rowSelectionModel.type === 'include'
        ? rowSelectionModel.ids.size
        : runs.length - rowSelectionModel.ids.size;
    const getSelectedIds = () => rowSelectionModel.type === 'include'
        ? [...rowSelectionModel.ids]
        : runs.filter(r => !rowSelectionModel.ids.has(r.id)).map(r => r.id);

    // Edit dialog state
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingRun, setEditingRun] = useState(null);

    // Bulk delete state
    const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
    const [deletingSelected, setDeletingSelected] = useState(false);

    // Bulk route edit state
    const [bulkEditDialogOpen, setBulkEditDialogOpen] = useState(false);
    const [bulkRouteValue, setBulkRouteValue] = useState('');
    const [bulkNewRouteName, setBulkNewRouteName] = useState('');
    const [savingBulkEdit, setSavingBulkEdit] = useState(false);

    // Bulk partner edit state
    const [bulkAddPartners, setBulkAddPartners] = useState([]);
    const [bulkRemovePartners, setBulkRemovePartners] = useState([]);

    // Build route lookup: map_routes.id → name
    const routeMap = useMemo(() => {
        const m = new Map();
        for (const route of routes) {
            m.set(route.id, route.name);
        }
        return m;
    }, [routes]);

    // Build partner lookup: map_run_fk → partner names
    const partnerMap = useMemo(() => {
        const nameMap = new Map();
        for (const p of partners) nameMap.set(p.id, p.name);
        const m = new Map();
        for (const rp of runPartners) {
            if (!m.has(rp.map_run_fk)) m.set(rp.map_run_fk, []);
            const name = nameMap.get(rp.map_partner_fk);
            if (name) m.get(rp.map_run_fk).push(name);
        }
        return m;
    }, [partners, runPartners]);

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
            flex: 1,
            minWidth: 200,
            maxWidth: 400,
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
        {
            field: 'partners',
            headerName: 'Partners',
            width: 200,
            sortable: false,
            filterable: false,
            valueGetter: (value, row) => (partnerMap.get(row.id) || []).join(', '),
            renderCell: (params) => {
                const names = partnerMap.get(params.row.id) || [];
                if (names.length === 0) return null;
                return (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, py: 0.5 }}>
                        {names.map(name => (
                            <Chip key={name} label={name} size="small" variant="outlined" />
                        ))}
                    </Box>
                );
            },
        },
    ];

    const handleCellClick = (params) => {
        if (params.field === '__check__') return;
        setEditingRun(params.row);
        setEditDialogOpen(true);
    };

    const handleDeleteSelected = async () => {
        setDeletingSelected(true);

        const selectedIds = getSelectedIds();
        let failCount = 0;

        for (const id of selectedIds) {
            try {
                const result = await call_rest_api(
                    `${darwinUri}/map_runs`, 'DELETE', { id }, idToken
                );
                if (result.httpStatus.httpStatus !== 200) failCount++;
            } catch (err) {
                console.error('[MapRuns] Delete error:', err);
                failCount++;
            }
        }

        queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
        queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
        setRowSelectionModel({ type: 'include', ids: new Set() });
        setBulkEditDialogOpen(false);
        setBulkDeleteConfirm(false);

        if (failCount > 0) {
            setSnackbar({ open: true, message: `Deleted ${selectedIds.length - failCount} of ${selectedIds.length} rides. ${failCount} failed.`, severity: 'warning' });
        } else {
            setSnackbar({ open: true, message: `Deleted ${selectedIds.length} ride${selectedIds.length !== 1 ? 's' : ''}`, severity: 'success' });
        }
        setDeletingSelected(false);
    };

    const sortedRoutes = useMemo(() => {
        return [...routes].sort((a, b) => a.name.localeCompare(b.name));
    }, [routes]);

    const handleOpenBulkEdit = () => {
        setBulkRouteValue('');
        setBulkNewRouteName('');
        setBulkDeleteConfirm(false);
        setBulkAddPartners([]);
        setBulkRemovePartners([]);
        setBulkEditDialogOpen(true);
    };

    const handleBulkRouteEdit = async () => {
        setSavingBulkEdit(true);
        try {
            let routeId = bulkRouteValue === '__no_route__' ? null : bulkRouteValue;

            // Create new route if requested
            if (bulkRouteValue === '__create_new__' && bulkNewRouteName.trim()) {
                const nextRouteId = routes.length > 0
                    ? Math.max(...routes.map(r => r.route_id)) + 1
                    : 1;
                const routeResult = await call_rest_api(
                    `${darwinUri}/map_routes`, 'POST',
                    { route_id: nextRouteId, name: bulkNewRouteName.trim(), creator_fk: creatorFk },
                    idToken
                );
                if (routeResult.httpStatus.httpStatus === 200) {
                    routeId = routeResult.data[0].id;
                } else {
                    routeId = null;
                }
                queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
            }

            // Bulk PUT all selected runs
            const updateBody = getSelectedIds().map(id => ({
                id,
                map_route_fk: routeId === null ? 'NULL' : routeId,
            }));

            const result = await call_rest_api(
                `${darwinUri}/map_runs`, 'PUT', updateBody, idToken
            );

            if (result.httpStatus.httpStatus > 204) {
                showError(result, 'Failed to update rides');
            } else {
                queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
                const count = selectedCount;
                setSnackbar({ open: true, message: `Updated route for ${count} ride${count !== 1 ? 's' : ''}`, severity: 'success' });
                setRowSelectionModel({ type: 'include', ids: new Set() });
                setBulkEditDialogOpen(false);
            }
        } catch (error) {
            showError(error, 'Failed to update rides');
        } finally {
            setSavingBulkEdit(false);
        }
    };

    const handleBulkPartnerEdit = async () => {
        if (bulkAddPartners.length === 0 && bulkRemovePartners.length === 0) return;
        setSavingBulkEdit(true);
        try {
            const selectedIds = getSelectedIds();

            // Add partners to selected rides
            for (const name of bulkAddPartners) {
                let partner = partners.find(p => p.name === name);
                if (!partner) {
                    const pResult = await call_rest_api(
                        `${darwinUri}/map_partners`, 'POST',
                        { name, creator_fk: creatorFk }, idToken
                    );
                    if (pResult.httpStatus.httpStatus === 200 && pResult.data?.[0]) {
                        partner = pResult.data[0];
                    } else {
                        continue;
                    }
                }
                for (const runId of selectedIds) {
                    // UNIQUE constraint prevents duplicates
                    await call_rest_api(
                        `${darwinUri}/map_run_partners`, 'POST',
                        { map_run_fk: runId, map_partner_fk: partner.id }, idToken
                    ).catch(() => {}); // Ignore duplicate errors
                }
            }

            // Remove partners from selected rides
            for (const name of bulkRemovePartners) {
                const partner = partners.find(p => p.name === name);
                if (!partner) continue;
                for (const runId of selectedIds) {
                    const link = runPartners.find(
                        rp => rp.map_run_fk === runId && rp.map_partner_fk === partner.id
                    );
                    if (link) {
                        await call_rest_api(
                            `${darwinUri}/map_run_partners`, 'DELETE',
                            { id: link.id }, idToken
                        );
                    }
                }
            }

            queryClient.invalidateQueries({ queryKey: mapPartnerKeys.all(creatorFk) });
            queryClient.invalidateQueries({ queryKey: mapRunPartnerKeys.all(creatorFk) });
            const count = selectedCount;
            setSnackbar({ open: true, message: `Updated partners for ${count} ride${count !== 1 ? 's' : ''}`, severity: 'success' });
            setRowSelectionModel({ type: 'include', ids: new Set() });
            setBulkEditDialogOpen(false);
        } catch (error) {
            showError(error, 'Failed to update partners');
        } finally {
            setSavingBulkEdit(false);
        }
    };

    return (
        <Box sx={{ mt: 1, px: 2, maxWidth: TABLE_WIDTH }}>
            {selectedCount > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<EditIcon />}
                        onClick={handleOpenBulkEdit}
                        disabled={savingBulkEdit || deletingSelected}
                        data-testid="edit-selected-button"
                    >
                        Edit Selected ({selectedCount})
                    </Button>
                </Box>
            )}

            <Box>
                <DataGrid
                    autoHeight
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
                    pageSizeOptions={runs.length >= 100 && runs.length <= 300
                        ? [25, 50, 100, { value: -1, label: 'All' }]
                        : [25, 50, 100]
                    }
                    checkboxSelection
                    disableRowSelectionOnClick
                    rowSelectionModel={rowSelectionModel}
                    onRowSelectionModelChange={setRowSelectionModel}
                    onCellClick={handleCellClick}
                    density="compact"
                    sx={{ cursor: 'pointer' }}
                    data-testid="map-runs-datagrid"
                />
            </Box>

            {/* Edit Selected Dialog */}
            <Dialog
                open={bulkEditDialogOpen}
                onClose={() => { setBulkEditDialogOpen(false); setBulkDeleteConfirm(false); }}
                maxWidth="sm"
                fullWidth
                data-testid="edit-selected-dialog"
            >
                <DialogTitle>
                    Edit {selectedCount} Selected Ride{selectedCount !== 1 ? 's' : ''}
                </DialogTitle>
                <DialogContent>
                    {/* Route assignment */}
                    <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5 }}>Assign Route</Typography>
                    <FormControl fullWidth size="small">
                        <InputLabel>Route</InputLabel>
                        <Select
                            value={bulkRouteValue}
                            onChange={(e) => {
                                setBulkRouteValue(e.target.value);
                                setBulkNewRouteName('');
                            }}
                            label="Route"
                            data-testid="bulk-route-select"
                        >
                            <MenuItem value="__no_route__"><em>No route</em></MenuItem>
                            {sortedRoutes.map(route => (
                                <MenuItem key={route.id} value={route.id}>
                                    {route.name}
                                </MenuItem>
                            ))}
                            <MenuItem value="__create_new__"><em>Create new...</em></MenuItem>
                        </Select>
                    </FormControl>
                    {bulkRouteValue === '__create_new__' && (
                        <TextField
                            fullWidth size="small" label="New route name"
                            value={bulkNewRouteName}
                            onChange={(e) => setBulkNewRouteName(e.target.value)}
                            sx={{ mt: 2 }}
                            autoFocus
                            data-testid="bulk-new-route-name"
                        />
                    )}

                    {/* Partner assignment */}
                    <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>Add Partners</Typography>
                    <Autocomplete
                        multiple
                        freeSolo
                        size="small"
                        options={partners.map(p => p.name)}
                        value={bulkAddPartners}
                        onChange={(e, newValue) => setBulkAddPartners(newValue)}
                        renderTags={(value, getTagProps) =>
                            value.map((option, index) => (
                                <Chip variant="outlined" label={option} size="small" {...getTagProps({ index })} key={option} />
                            ))
                        }
                        renderInput={(params) => (
                            <TextField {...params} placeholder="Add partner..." />
                        )}
                        data-testid="bulk-add-partners"
                    />

                    {partners.length > 0 && (
                        <>
                            <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>Remove Partners</Typography>
                            <Autocomplete
                                multiple
                                size="small"
                                options={partners.map(p => p.name)}
                                value={bulkRemovePartners}
                                onChange={(e, newValue) => setBulkRemovePartners(newValue)}
                                renderTags={(value, getTagProps) =>
                                    value.map((option, index) => (
                                        <Chip variant="outlined" label={option} size="small" {...getTagProps({ index })} key={option} />
                                    ))
                                }
                                renderInput={(params) => (
                                    <TextField {...params} placeholder="Remove partner..." />
                                )}
                                data-testid="bulk-remove-partners"
                            />
                        </>
                    )}

                    {/* Delete section */}
                    <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                        {!bulkDeleteConfirm ? (
                            <Button
                                variant="outlined"
                                color="error"
                                size="small"
                                startIcon={deletingSelected ? <CircularProgress size={16} /> : <DeleteIcon />}
                                onClick={() => setBulkDeleteConfirm(true)}
                                disabled={deletingSelected || savingBulkEdit}
                                data-testid="delete-selected-button"
                            >
                                Delete {selectedCount} Ride{selectedCount !== 1 ? 's' : ''}
                            </Button>
                        ) : (
                            <Box sx={{ p: 1.5, bgcolor: 'error.light', borderRadius: 1, color: 'error.contrastText' }}>
                                <Typography variant="body2">
                                    Permanently delete {selectedCount} ride{selectedCount !== 1 ? 's' : ''} and their GPS coordinates? This cannot be undone.
                                </Typography>
                                <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                                    <Button
                                        size="small" variant="contained" color="error"
                                        onClick={handleDeleteSelected}
                                        disabled={deletingSelected}
                                        data-testid="bulk-delete-confirm-button"
                                    >
                                        Delete
                                    </Button>
                                    <Button
                                        size="small" variant="outlined"
                                        onClick={() => setBulkDeleteConfirm(false)}
                                        sx={{ color: 'error.contrastText', borderColor: 'error.contrastText' }}
                                    >
                                        Cancel
                                    </Button>
                                </Box>
                            </Box>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => { setBulkEditDialogOpen(false); setBulkDeleteConfirm(false); }}
                        variant="outlined"
                        disabled={savingBulkEdit || deletingSelected}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleBulkPartnerEdit}
                        variant="contained"
                        disabled={savingBulkEdit || (bulkAddPartners.length === 0 && bulkRemovePartners.length === 0) || deletingSelected}
                        data-testid="bulk-partner-save-button"
                    >
                        Apply Partners
                    </Button>
                    <Button
                        onClick={handleBulkRouteEdit}
                        variant="contained"
                        disabled={savingBulkEdit || (!bulkRouteValue) || (bulkRouteValue === '__create_new__' && !bulkNewRouteName.trim()) || deletingSelected}
                        data-testid="bulk-route-save-button"
                    >
                        Apply Route
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Edit Dialog */}
            <RideEditDialog
                open={editDialogOpen}
                onClose={() => {
                    setEditDialogOpen(false);
                    setEditingRun(null);
                }}
                run={editingRun}
                routes={routes}
                allRuns={allRuns}
                partners={partners}
                runPartners={runPartners}
                darwinUri={darwinUri}
                idToken={idToken}
                creatorFk={creatorFk}
            />

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
