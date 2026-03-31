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
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import OutlinedInput from '@mui/material/OutlinedInput';
import { useQueryClient } from '@tanstack/react-query';

import call_rest_api from '../RestApi/RestApi';
import { mapViewKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useActiveMapViewStore } from '../stores/useActiveMapViewStore';

const ViewDialog = ({ open, onClose, view, views = [], routes, partners = [], darwinUri, idToken, creatorFk }) => {
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const { activeViewId, setActiveViewId } = useActiveMapViewStore();

    const isEdit = view != null;

    // Form state
    const [name, setName] = useState('');
    const [routeIds, setRouteIds] = useState([]);
    const [dateStart, setDateStart] = useState('');
    const [dateEnd, setDateEnd] = useState('');
    const [notesSearch, setNotesSearch] = useState('');
    const [distanceMin, setDistanceMin] = useState('');
    const [distanceMax, setDistanceMax] = useState('');
    const [partnerIds, setPartnerIds] = useState([]);
    const [saving, setSaving] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);

    // Sort routes by name for the multi-select
    const sortedRoutes = useMemo(() => {
        return [...(routes || [])].sort((a, b) => a.name.localeCompare(b.name));
    }, [routes]);

    // Route lookup for chip labels
    const routeMap = useMemo(() => {
        const m = new Map();
        for (const r of (routes || [])) m.set(r.id, r.name);
        return m;
    }, [routes]);

    // Partner lookup for chip labels
    const partnerMap = useMemo(() => {
        const m = new Map();
        for (const p of (partners || [])) m.set(p.id, p.name);
        return m;
    }, [partners]);

    const sortedPartners = useMemo(() => {
        return [...(partners || [])].sort((a, b) => a.name.localeCompare(b.name));
    }, [partners]);

    // Reset form when view changes or dialog opens
    useEffect(() => {
        if (!open) return;

        if (isEdit) {
            setName(view.name || '');
            let criteria = {};
            try {
                criteria = typeof view.criteria === 'string'
                    ? JSON.parse(view.criteria)
                    : (view.criteria || {});
            } catch { /* empty */ }
            setRouteIds(criteria.route_ids || []);
            setDateStart(criteria.date_start || '');
            setDateEnd(criteria.date_end || '');
            setNotesSearch(criteria.notes_search || '');
            setDistanceMin(criteria.distance_min != null ? String(criteria.distance_min) : '');
            setDistanceMax(criteria.distance_max != null ? String(criteria.distance_max) : '');
            setPartnerIds(criteria.partner_ids || []);
        } else {
            setName('');
            setRouteIds([]);
            setDateStart('');
            setDateEnd('');
            setNotesSearch('');
            setDistanceMin('');
            setDistanceMax('');
            setPartnerIds([]);
        }
        setDeleteConfirm(false);
        setSaving(false);
    }, [view, open, isEdit]);

    const buildCriteria = () => {
        const criteria = {};
        if (routeIds.length > 0) criteria.route_ids = routeIds;
        if (dateStart) criteria.date_start = dateStart;
        if (dateEnd) criteria.date_end = dateEnd;
        if (notesSearch.trim()) criteria.notes_search = notesSearch.trim();
        if (distanceMin !== '') criteria.distance_min = Number(distanceMin);
        if (distanceMax !== '') criteria.distance_max = Number(distanceMax);
        if (partnerIds.length > 0) criteria.partner_ids = partnerIds;
        return criteria;
    };

    const canSave = name.trim().length >= 1 && name.trim().length <= 10;

    const handleSave = async () => {
        if (!canSave) return;
        setSaving(true);

        try {
            const criteria = buildCriteria();

            if (isEdit) {
                const result = await call_rest_api(
                    `${darwinUri}/map_views`, 'PUT',
                    [{ id: view.id, name: name.trim(), criteria: JSON.stringify(criteria) }],
                    idToken
                );
                if (result.httpStatus.httpStatus > 204) {
                    showError(result, 'Failed to update view');
                    return;
                }
            } else {
                const result = await call_rest_api(
                    `${darwinUri}/map_views`, 'POST',
                    { name: name.trim(), criteria: JSON.stringify(criteria), sort_order: views.length, creator_fk: creatorFk },
                    idToken
                );
                if (result.httpStatus.httpStatus === 200 && result.data?.[0]) {
                    // Auto-select the newly created view
                    setActiveViewId(result.data[0].id);
                } else if (result.httpStatus.httpStatus > 201) {
                    showError(result, 'Failed to create view');
                    return;
                }
            }

            queryClient.invalidateQueries({ queryKey: mapViewKeys.all(creatorFk) });
            onClose();
        } catch (error) {
            showError(error, isEdit ? 'Failed to update view' : 'Failed to create view');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        setSaving(true);
        try {
            const result = await call_rest_api(
                `${darwinUri}/map_views`, 'DELETE',
                { id: view.id }, idToken
            );
            if (result.httpStatus.httpStatus === 200) {
                // Reset to "All" if the deleted view was active
                if (activeViewId === view.id) {
                    setActiveViewId(null);
                }
                queryClient.invalidateQueries({ queryKey: mapViewKeys.all(creatorFk) });
                onClose();
            } else {
                showError(result, 'Failed to delete view');
            }
        } catch (error) {
            showError(error, 'Failed to delete view');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            data-testid="view-dialog"
        >
            <DialogTitle>{isEdit ? 'Edit View' : 'Create View'}</DialogTitle>
            <DialogContent>
                {/* Name */}
                <TextField
                    fullWidth
                    size="small"
                    label="View Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    inputProps={{ maxLength: 10 }}
                    helperText={`${name.length}/10 characters`}
                    sx={{ mt: 1 }}
                    autoFocus
                    data-testid="view-name-input"
                />

                {/* Route multi-select */}
                <FormControl fullWidth size="small" sx={{ mt: 2 }}>
                    <InputLabel>Routes</InputLabel>
                    <Select
                        multiple
                        value={routeIds}
                        onChange={(e) => setRouteIds(e.target.value)}
                        input={<OutlinedInput label="Routes" />}
                        renderValue={(selected) => (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {selected.map(id => (
                                    <Chip key={id} label={routeMap.get(id) || id} size="small" />
                                ))}
                            </Box>
                        )}
                        data-testid="view-routes-select"
                    >
                        {sortedRoutes.map(route => (
                            <MenuItem key={route.id} value={route.id}>
                                {route.name}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {/* Partner multi-select */}
                {sortedPartners.length > 0 && (
                    <FormControl fullWidth size="small" sx={{ mt: 2 }}>
                        <InputLabel>Partners</InputLabel>
                        <Select
                            multiple
                            value={partnerIds}
                            onChange={(e) => setPartnerIds(e.target.value)}
                            input={<OutlinedInput label="Partners" />}
                            renderValue={(selected) => (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {selected.map(id => (
                                        <Chip key={id} label={partnerMap.get(id) || id} size="small" />
                                    ))}
                                </Box>
                            )}
                            data-testid="view-partners-select"
                        >
                            {sortedPartners.map(partner => (
                                <MenuItem key={partner.id} value={partner.id}>
                                    {partner.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                )}

                {/* Date range */}
                <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                    <TextField
                        fullWidth
                        size="small"
                        label="Date From"
                        type="date"
                        value={dateStart}
                        onChange={(e) => setDateStart(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        data-testid="view-date-start"
                    />
                    <TextField
                        fullWidth
                        size="small"
                        label="Date To"
                        type="date"
                        value={dateEnd}
                        onChange={(e) => setDateEnd(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        data-testid="view-date-end"
                    />
                </Box>

                {/* Notes search */}
                <TextField
                    fullWidth
                    size="small"
                    label="Notes contain"
                    value={notesSearch}
                    onChange={(e) => setNotesSearch(e.target.value)}
                    sx={{ mt: 2 }}
                    data-testid="view-notes-search"
                />

                {/* Distance range */}
                <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                    <TextField
                        fullWidth
                        size="small"
                        label="Min Distance (mi)"
                        type="number"
                        inputProps={{ step: '0.1', min: '0' }}
                        value={distanceMin}
                        onChange={(e) => setDistanceMin(e.target.value)}
                        data-testid="view-distance-min"
                    />
                    <TextField
                        fullWidth
                        size="small"
                        label="Max Distance (mi)"
                        type="number"
                        inputProps={{ step: '0.1', min: '0' }}
                        value={distanceMax}
                        onChange={(e) => setDistanceMax(e.target.value)}
                        data-testid="view-distance-max"
                    />
                </Box>

                {/* Delete section (edit mode only) */}
                {isEdit && (
                    <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                        {!deleteConfirm ? (
                            <Button
                                variant="outlined"
                                color="error"
                                size="small"
                                onClick={() => setDeleteConfirm(true)}
                                disabled={saving}
                                data-testid="view-delete-button"
                            >
                                Delete View
                            </Button>
                        ) : (
                            <Box sx={{ p: 1.5, bgcolor: 'error.light', borderRadius: 1, color: 'error.contrastText' }}>
                                <Typography variant="body2">
                                    Delete view &ldquo;{view.name}&rdquo;?
                                </Typography>
                                <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                                    <Button
                                        size="small" variant="contained" color="error"
                                        onClick={handleDelete} disabled={saving}
                                        data-testid="view-delete-confirm"
                                    >
                                        Delete
                                    </Button>
                                    <Button
                                        size="small" variant="outlined"
                                        onClick={() => setDeleteConfirm(false)}
                                        sx={{ color: 'error.contrastText', borderColor: 'error.contrastText' }}
                                    >
                                        Cancel
                                    </Button>
                                </Box>
                            </Box>
                        )}
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} variant="outlined" disabled={saving}>Cancel</Button>
                <Button
                    onClick={handleSave}
                    variant="contained"
                    disabled={saving || !canSave}
                    data-testid="view-save-button"
                >
                    {isEdit ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ViewDialog;
