import React, { useState, useContext, useMemo, useRef } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
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
import { DataGrid, useGridApiRef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { useMapPartners, useMapRunPartners } from '../hooks/useDataQueries';
import { mapPartnerKeys, mapRunPartnerKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';

const MapPartnerSettingsView = () => {
    const navigate = useNavigate();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const queryClient = useQueryClient();
    const creatorFk = profile?.id;
    const showError = useSnackBarStore(s => s.showError);
    const apiRef = useGridApiRef();

    const { data: partners = [], isLoading: partnersLoading } = useMapPartners(creatorFk);
    const { data: runPartners = [], isLoading: runPartnersLoading } = useMapRunPartners(creatorFk);

    const [inlineInput, setInlineInput] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const isSavingRef = useRef(false); // synchronous guard — prevents stale-closure double-submit
    const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null, name: '' });
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // Compute ride count per partner
    const rideCountMap = useMemo(() => {
        const m = new Map();
        for (const rp of runPartners) {
            m.set(rp.map_partner_fk, (m.get(rp.map_partner_fk) || 0) + 1);
        }
        return m;
    }, [runPartners]);

    // Build DataGrid rows
    const rows = useMemo(() =>
        partners.map(p => ({ ...p, ride_count: rideCountMap.get(p.id) || 0 })),
        [partners, rideCountMap]
    );

    const handleSaveNewPartner = async () => {
        const name = inlineInput.trim();
        if (!name || isSavingRef.current) return; // synchronous guard catches rapid Enter+blur
        isSavingRef.current = true;
        setIsSaving(true);
        try {
            await call_rest_api(`${darwinUri}/map_partners`, 'POST', { name, creator_fk: creatorFk }, idToken);
            queryClient.invalidateQueries({ queryKey: mapPartnerKeys.all(creatorFk) });
            setInlineInput('');
        } catch (err) {
            showError(err, 'Failed to add partner');
        } finally {
            isSavingRef.current = false;
            setIsSaving(false);
        }
    };

    const handleProcessRowUpdate = async (newRow, oldRow) => {
        if (newRow.name === oldRow.name) return oldRow;
        const name = newRow.name.trim();
        if (!name) return oldRow;
        try {
            await call_rest_api(`${darwinUri}/map_partners`, 'PUT', [{ id: newRow.id, name }], idToken);
            queryClient.invalidateQueries({ queryKey: mapPartnerKeys.all(creatorFk) });
            setSnackbar({ open: true, message: 'Partner renamed', severity: 'success' });
            return { ...newRow, name };
        } catch (err) {
            showError(err, 'Failed to rename partner');
            return oldRow;
        }
    };

    const handleDeleteConfirm = async () => {
        const { id } = deleteConfirm;
        setDeleteConfirm({ open: false, id: null, name: '' });
        try {
            await call_rest_api(`${darwinUri}/map_partners`, 'DELETE', { id }, idToken);
            queryClient.invalidateQueries({ queryKey: mapPartnerKeys.all(creatorFk) });
            queryClient.invalidateQueries({ queryKey: mapRunPartnerKeys.all(creatorFk) });
            setSnackbar({ open: true, message: 'Partner deleted', severity: 'success' });
        } catch (err) {
            showError(err, 'Failed to delete partner');
        }
    };

    const columns = [
        {
            field: 'name',
            headerName: 'Partner Name',
            flex: 1,
            editable: true,
            renderCell: (params) => (
                <Chip label={params.value} variant="outlined" size="small" />
            ),
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
                    data-testid={`delete-partner-${params.row.id}`}
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
                <Typography variant="h6" sx={{ flex: 1 }}>Partners</Typography>
            </Box>

            <DataGrid
                apiRef={apiRef}
                rows={rows}
                columns={columns}
                loading={partnersLoading || runPartnersLoading}
                processRowUpdate={handleProcessRowUpdate}
                onCellClick={(params) => {
                    if (params.field === 'name' && apiRef.current.getCellMode(params.id, params.field) === 'view') {
                        apiRef.current.startCellEditMode({ id: params.id, field: params.field });
                    }
                }}
                initialState={{
                    sorting: { sortModel: [{ field: 'name', sort: 'asc' }] },
                }}
                hideFooter
                autoHeight
                disableRowSelectionOnClick
                density="compact"
                data-testid="partners-datagrid"
            />

            {/* Blank template — sibling Box, not a DataGrid slot, so no remount on re-render */}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderTop: 0, px: 1.5, py: 0.5 }}>
                <TextField
                    value={inlineInput}
                    onChange={e => setInlineInput(e.target.value)}
                    onBlur={handleSaveNewPartner}
                    onKeyDown={e => {
                        if (e.key === 'Enter') handleSaveNewPartner();
                        if (e.key === 'Escape') setInlineInput('');
                    }}
                    placeholder="Add partner..."
                    size="small"
                    variant="standard"
                    fullWidth
                    disabled={isSaving}
                    InputProps={{ disableUnderline: true }}
                    inputProps={{ 'data-testid': 'new-partner-input' }}
                />
            </Box>

            {/* Delete Confirm Dialog */}
            <Dialog
                open={deleteConfirm.open}
                onClose={() => setDeleteConfirm({ open: false, id: null, name: '' })}
            >
                <DialogTitle>Delete Partner?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Delete "{deleteConfirm.name}"? They will be removed from all rides.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteConfirm({ open: false, id: null, name: '' })}>Cancel</Button>
                    <Button onClick={handleDeleteConfirm} color="error" variant="contained" data-testid="delete-partner-confirm">
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

export default MapPartnerSettingsView;
