import React, { useState, useEffect, useMemo } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useQueryClient } from '@tanstack/react-query';

import call_rest_api from '../RestApi/RestApi';
import { mapRunKeys, mapRouteKeys } from '../hooks/useQueryKeys';
import { formatDuration, parseDuration } from '../utils/mapDataUtils';
import { useSnackBarStore } from '../stores/useSnackBarStore';

const CREATE_NEW = '__create_new__';
const NO_ROUTE = '__no_route__';

const RideEditDialog = ({ open, onClose, run, routes, allRuns, darwinUri, idToken, creatorFk }) => {
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);

    // Form state
    const [routeValue, setRouteValue] = useState(NO_ROUTE);
    const [newRouteName, setNewRouteName] = useState('');
    const [distance, setDistance] = useState('');
    const [rideTime, setRideTime] = useState('');
    const [stoppedTime, setStoppedTime] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    // Route delete confirmation state
    const [deleteRouteConfirm, setDeleteRouteConfirm] = useState(false);

    // Reset form when run changes or dialog opens
    useEffect(() => {
        if (run && open) {
            setRouteValue(run.map_route_fk != null ? run.map_route_fk : NO_ROUTE);
            setNewRouteName('');
            setDistance(Number(run.distance_mi).toFixed(1));
            setRideTime(formatDuration(run.run_time_sec));
            setStoppedTime(formatDuration(run.stopped_time_sec || 0));
            setNotes(run.notes || '');
            setDeleteRouteConfirm(false);
        }
    }, [run, open]);

    // Compute ride counts per route from allRuns
    const rideCountByRoute = useMemo(() => {
        const counts = new Map();
        for (const r of (allRuns || [])) {
            if (r.map_route_fk != null) {
                counts.set(r.map_route_fk, (counts.get(r.map_route_fk) || 0) + 1);
            }
        }
        return counts;
    }, [allRuns]);

    // Sort routes by name
    const sortedRoutes = useMemo(() => {
        return [...(routes || [])].sort((a, b) => a.name.localeCompare(b.name));
    }, [routes]);

    const selectedRouteObj = sortedRoutes.find(r => r.id === routeValue);
    const selectedRouteRideCount = selectedRouteObj ? (rideCountByRoute.get(selectedRouteObj.id) || 0) : 0;

    const handleSave = async () => {
        // Validate duration fields
        const rideTimeSec = parseDuration(rideTime);
        const stoppedTimeSec = parseDuration(stoppedTime);
        if (isNaN(rideTimeSec)) return;
        if (isNaN(stoppedTimeSec)) return;

        const distanceVal = parseFloat(distance);
        if (isNaN(distanceVal)) return;

        setSaving(true);
        try {
            let newRouteId = routeValue === NO_ROUTE ? null : routeValue;

            // If creating a new route, POST it first
            if (routeValue === CREATE_NEW && newRouteName.trim()) {
                const nextRouteId = routes.length > 0
                    ? Math.max(...routes.map(r => r.route_id)) + 1
                    : 1;
                const routeResult = await call_rest_api(
                    `${darwinUri}/map_routes`, 'POST',
                    { route_id: nextRouteId, name: newRouteName.trim(), creator_fk: creatorFk },
                    idToken
                );
                if (routeResult.httpStatus.httpStatus === 200) {
                    newRouteId = routeResult.data[0].id;
                } else if (routeResult.httpStatus.httpStatus === 201) {
                    // 201 = created but no data returned, invalidate and use null for now
                    newRouteId = null;
                }
                queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
            }

            // PUT the run update
            const updateBody = [{
                id: run.id,
                map_route_fk: newRouteId === null ? 'NULL' : newRouteId,
                distance_mi: distanceVal,
                run_time_sec: rideTimeSec,
                stopped_time_sec: stoppedTimeSec,
                notes: notes.trim() || 'NULL',
            }];

            const result = await call_rest_api(
                `${darwinUri}/map_runs`, 'PUT', updateBody, idToken
            );

            if (result.httpStatus.httpStatus > 204) {
                showError(result, 'Failed to update ride');
            } else {
                queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
                onClose();
            }
        } catch (error) {
            showError(error, 'Failed to update ride');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteRoute = async () => {
        if (!selectedRouteObj) return;
        setSaving(true);
        try {
            const result = await call_rest_api(
                `${darwinUri}/map_routes`, 'DELETE',
                { id: selectedRouteObj.id }, idToken
            );
            if (result.httpStatus.httpStatus === 200) {
                // DB ON DELETE SET NULL handles runs — invalidate both caches
                queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
                queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
                setRouteValue(NO_ROUTE);
                setDeleteRouteConfirm(false);
            } else {
                showError(result, 'Failed to delete route');
            }
        } catch (error) {
            showError(error, 'Failed to delete route');
        } finally {
            setSaving(false);
        }
    };

    if (!run) return null;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="ride-edit-dialog">
            <DialogTitle>Edit Ride</DialogTitle>
            <DialogContent>
                {/* Route selection */}
                <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, mt: 1 }}>
                    <FormControl fullWidth size="small">
                        <InputLabel>Route</InputLabel>
                        <Select
                            value={routeValue}
                            onChange={(e) => {
                                setRouteValue(e.target.value);
                                setDeleteRouteConfirm(false);
                                setNewRouteName('');
                            }}
                            label="Route"
                            data-testid="ride-edit-route-select"
                        >
                            <MenuItem value={NO_ROUTE}><em>No route</em></MenuItem>
                            {sortedRoutes.map(route => (
                                <MenuItem key={route.id} value={route.id}>
                                    {route.name}
                                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                        ({rideCountByRoute.get(route.id) || 0} rides)
                                    </Typography>
                                </MenuItem>
                            ))}
                            <MenuItem value={CREATE_NEW}><em>Create new...</em></MenuItem>
                        </Select>
                    </FormControl>
                    {selectedRouteObj && !deleteRouteConfirm && (
                        <IconButton
                            size="small"
                            color="error"
                            onClick={() => setDeleteRouteConfirm(true)}
                            title="Delete this route"
                            data-testid="ride-edit-delete-route-btn"
                        >
                            <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                    )}
                </Box>

                {/* Route delete confirmation */}
                {deleteRouteConfirm && selectedRouteObj && (
                    <Box sx={{ mt: 1, p: 1.5, bgcolor: 'error.light', borderRadius: 1, color: 'error.contrastText' }}>
                        <Typography variant="body2">
                            Delete &ldquo;{selectedRouteObj.name}&rdquo;? {selectedRouteRideCount} ride{selectedRouteRideCount !== 1 ? 's' : ''} will have no route.
                        </Typography>
                        <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                            <Button
                                size="small" variant="contained" color="error"
                                onClick={handleDeleteRoute} disabled={saving}
                            >
                                Delete Route
                            </Button>
                            <Button
                                size="small" variant="outlined"
                                onClick={() => setDeleteRouteConfirm(false)}
                                sx={{ color: 'error.contrastText', borderColor: 'error.contrastText' }}
                            >
                                Cancel
                            </Button>
                        </Box>
                    </Box>
                )}

                {/* New route name input */}
                {routeValue === CREATE_NEW && (
                    <TextField
                        fullWidth size="small" label="New route name"
                        value={newRouteName} onChange={(e) => setNewRouteName(e.target.value)}
                        sx={{ mt: 2 }}
                        autoFocus
                        data-testid="ride-edit-new-route-name"
                    />
                )}

                {/* Distance */}
                <TextField
                    fullWidth size="small" label="Distance (mi)"
                    type="number" inputProps={{ step: '0.1', min: '0' }}
                    value={distance} onChange={(e) => setDistance(e.target.value)}
                    sx={{ mt: 2 }}
                    data-testid="ride-edit-distance"
                />

                {/* Ride Time */}
                <TextField
                    fullWidth size="small" label="Ride Time (H:MM:SS)"
                    value={rideTime} onChange={(e) => setRideTime(e.target.value)}
                    error={rideTime !== '' && isNaN(parseDuration(rideTime))}
                    helperText={rideTime !== '' && isNaN(parseDuration(rideTime)) ? 'Use H:MM:SS format' : ''}
                    sx={{ mt: 2 }}
                    data-testid="ride-edit-ride-time"
                />

                {/* Stopped Time */}
                <TextField
                    fullWidth size="small" label="Stopped Time (H:MM:SS)"
                    value={stoppedTime} onChange={(e) => setStoppedTime(e.target.value)}
                    error={stoppedTime !== '' && isNaN(parseDuration(stoppedTime))}
                    helperText={stoppedTime !== '' && isNaN(parseDuration(stoppedTime)) ? 'Use H:MM:SS format' : ''}
                    sx={{ mt: 2 }}
                    data-testid="ride-edit-stopped-time"
                />

                {/* Notes */}
                <TextField
                    fullWidth size="small" label="Notes" multiline minRows={2}
                    value={notes} onChange={(e) => setNotes(e.target.value)}
                    sx={{ mt: 2 }}
                    data-testid="ride-edit-notes"
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} variant="outlined" disabled={saving}>Cancel</Button>
                <Button
                    onClick={handleSave} variant="contained" disabled={saving}
                    data-testid="ride-edit-save-btn"
                >
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default RideEditDialog;
