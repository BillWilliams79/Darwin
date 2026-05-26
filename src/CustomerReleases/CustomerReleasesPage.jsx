// /customer-releases — Customer Release Events landing page (req #2606).
//
// DataGrid lists every customer_releases row. Customers are joined client-side
// via useAllCustomers; builds are joined via useAllBuilds (we surface
// build_number + branch_number for a readable identifier). Add/Edit/Delete
// dialogs mirror the Customers page pattern.

import { useContext, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import {
    useAllCustomerReleases,
    useAllCustomers,
    useAllBuilds,
} from '../hooks/useDataQueries';
import { customerReleaseKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import {
    createCustomerRelease,
    updateCustomerRelease,
    deleteCustomerRelease,
} from './customerReleasesApi';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

const TABLE_WIDTH = 1100;
const formatDate = (v) => v ? new Date(v).toLocaleDateString() : '';

function buildLabel(b) {
    if (!b) return '';
    if (b.build_number != null) {
        const tail = b.branch_number ? `.${b.branch_number}` : '';
        return `#${b.build_number}${tail}`;
    }
    return `id:${b.id}`;
}

export default function CustomerReleasesPage() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);

    const creatorFk = profile?.userName;
    const [searchParams, setSearchParams] = useSearchParams();
    const customerFkFilter = parseInt(searchParams.get('customer_fk') || '', 10);
    const hasCustomerFilter = Number.isFinite(customerFkFilter);

    const { data: releases = [], isLoading } = useAllCustomerReleases(creatorFk);
    const { data: customers = [] } = useAllCustomers(creatorFk);
    const { data: builds = [] } = useAllBuilds(creatorFk);

    const customerById = useMemo(
        () => Object.fromEntries(customers.map(c => [c.id, c])), [customers]);
    const buildById = useMemo(
        () => Object.fromEntries(builds.map(b => [b.id, b])), [builds]);

    const rows = useMemo(() => {
        const enriched = releases.map(r => ({
            ...r,
            customer_name: customerById[r.customer_fk]?.customer_name || `id:${r.customer_fk}`,
            build_label: buildLabel(buildById[r.build_fk]),
        }));
        return hasCustomerFilter
            ? enriched.filter(r => r.customer_fk === customerFkFilter)
            : enriched;
    }, [releases, customerById, buildById, hasCustomerFilter, customerFkFilter]);

    const filterCustomerName = hasCustomerFilter
        ? customerById[customerFkFilter]?.customer_name || `id:${customerFkFilter}`
        : null;

    const clearCustomerFilter = () => {
        const next = new URLSearchParams(searchParams);
        next.delete('customer_fk');
        setSearchParams(next, { replace: true });
    };

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [formCustomer, setFormCustomer] = useState('');
    const [formBuild, setFormBuild] = useState('');
    const [formNotes, setFormNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const openCreate = () => {
        setEditTarget(null);
        setFormCustomer('');
        setFormBuild('');
        setFormNotes('');
        setDialogOpen(true);
    };

    const openEdit = (row) => {
        setEditTarget(row);
        setFormCustomer(String(row.customer_fk));
        setFormBuild(String(row.build_fk));
        setFormNotes(row.release_notes || '');
        setDialogOpen(true);
    };

    const handleSubmit = async () => {
        if (!formCustomer || !formBuild) {
            showError('Customer and Build are required');
            return;
        }
        setSubmitting(true);
        try {
            if (editTarget) {
                await updateCustomerRelease(darwinUri, idToken, editTarget.id, {
                    customer_fk: Number(formCustomer),
                    build_fk: Number(formBuild),
                    release_notes: formNotes.trim() || null,
                });
            } else {
                await createCustomerRelease(darwinUri, idToken, {
                    customer_fk: Number(formCustomer),
                    build_fk: Number(formBuild),
                    release_notes: formNotes.trim() || null,
                });
            }
            queryClient.invalidateQueries({ queryKey: customerReleaseKeys.all(creatorFk) });
            setDialogOpen(false);
        } catch (err) {
            showError(err.message || 'Save failed');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Delete release of "${row.customer_name}" → ${row.build_label}?`)) return;
        try {
            await deleteCustomerRelease(darwinUri, idToken, row.id);
            queryClient.invalidateQueries({ queryKey: customerReleaseKeys.all(creatorFk) });
        } catch (err) {
            showError(err.message || 'Delete failed');
        }
    };

    const columns = [
        { field: 'id', headerName: 'ID', width: 70 },
        { field: 'customer_name', headerName: 'Customer', flex: 1, minWidth: 160 },
        { field: 'build_label', headerName: 'Build', width: 110 },
        { field: 'release_notes', headerName: 'Notes', flex: 2, minWidth: 220 },
        { field: 'create_ts', headerName: 'Created', width: 130, valueFormatter: formatDate },
        {
            field: 'actions',
            headerName: '',
            width: 110,
            sortable: false,
            filterable: false,
            disableColumnMenu: true,
            renderCell: (params) => (
                <Stack direction="row" spacing={0.5}>
                    <Tooltip title="Edit">
                        <IconButton
                            size="small"
                            data-testid={`release-edit-${params.row.id}`}
                            onClick={(e) => { e.stopPropagation(); openEdit(params.row); }}
                        >
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                        <IconButton
                            size="small"
                            data-testid={`release-delete-${params.row.id}`}
                            onClick={(e) => { e.stopPropagation(); handleDelete(params.row); }}
                        >
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Stack>
            ),
        },
    ];

    return (
        <Box sx={{ gridArea: 'content', p: 2, width: '100%', overflow: 'auto' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2, maxWidth: TABLE_WIDTH }}>
                {hasCustomerFilter ? (
                    <Chip
                        label={`Filter: ${filterCustomerName}`}
                        onDelete={clearCustomerFilter}
                        color="primary"
                        size="small"
                        data-testid="release-customer-filter-chip"
                    />
                ) : (
                    <Box />
                )}
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={openCreate}
                    data-testid="release-add"
                >
                    Add release
                </Button>
            </Stack>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <Box sx={{ maxWidth: TABLE_WIDTH, width: '100%' }}>
                    <DataGrid
                        autoHeight
                        rows={rows}
                        columns={columns}
                        getRowId={(r) => r.id}
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{ toolbar: { showQuickFilter: true } }}
                        initialState={{
                            pagination: { paginationModel: { pageSize: 25 } },
                            sorting: { sortModel: [{ field: 'create_ts', sort: 'desc' }] },
                        }}
                        pageSizeOptions={[10, 25, 50]}
                        disableRowSelectionOnClick
                        data-testid="customer-releases-table"
                    />
                </Box>
            )}

            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editTarget ? 'Edit release' : 'Add release'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <FormControl fullWidth required>
                            <InputLabel id="customer-label">Customer</InputLabel>
                            <Select
                                labelId="customer-label"
                                label="Customer"
                                value={formCustomer}
                                onChange={(e) => setFormCustomer(e.target.value)}
                                data-testid="release-customer-select"
                            >
                                {customers.map(c => (
                                    <MenuItem key={c.id} value={String(c.id)}>{c.customer_name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth required>
                            <InputLabel id="build-label">Build</InputLabel>
                            <Select
                                labelId="build-label"
                                label="Build"
                                value={formBuild}
                                onChange={(e) => setFormBuild(e.target.value)}
                                data-testid="release-build-select"
                            >
                                {builds.map(b => (
                                    <MenuItem key={b.id} value={String(b.id)}>
                                        {buildLabel(b)} (id {b.id})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            label="Release notes"
                            value={formNotes}
                            onChange={(e) => setFormNotes(e.target.value)}
                            fullWidth
                            multiline
                            minRows={2}
                            data-testid="release-notes-input"
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        disabled={submitting}
                        data-testid="release-save"
                    >
                        {editTarget ? 'Save' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
