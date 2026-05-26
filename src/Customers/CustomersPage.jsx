// /customers — Customers landing page (req #2604).
//
// Flat-list MUI DataGrid with Add / Edit / Delete via dialog. Customers are
// recipients of build releases (HP, NVIDIA, Cisco, Google, ...). The Build
// Visualizer attaches `customer-release` branches to build dots to convey
// which customer received which sprint or end-release build.

import { useContext, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { useAllCustomers, useAllCustomerReleases } from '../hooks/useDataQueries';
import { customerKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { createCustomer, updateCustomer, deleteCustomer } from './customersApi';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

const TABLE_WIDTH = 900;

const formatDate = (v) => v ? new Date(v).toLocaleDateString() : '';

export default function CustomersPage() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);

    const creatorFk = profile?.userName;
    const navigate = useNavigate();
    const { data: customers = [], isLoading } = useAllCustomers(creatorFk);
    const { data: releases = [] } = useAllCustomerReleases(creatorFk);

    const releaseCountByCustomer = useMemo(() => {
        const m = {};
        for (const r of releases) m[r.customer_fk] = (m[r.customer_fk] || 0) + 1;
        return m;
    }, [releases]);

    const rows = useMemo(() => customers.map(c => ({
        ...c,
        release_count: releaseCountByCustomer[c.id] || 0,
    })), [customers, releaseCountByCustomer]);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [formName, setFormName] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const openCreate = () => {
        setEditTarget(null);
        setFormName('');
        setFormDescription('');
        setDialogOpen(true);
    };

    const openEdit = (row) => {
        setEditTarget(row);
        setFormName(row.customer_name || '');
        setFormDescription(row.description || '');
        setDialogOpen(true);
    };

    const handleSubmit = async () => {
        const name = formName.trim();
        if (!name) {
            showError('Customer name is required');
            return;
        }
        setSubmitting(true);
        try {
            if (editTarget) {
                await updateCustomer(darwinUri, idToken, editTarget.id, {
                    customer_name: name,
                    description: formDescription.trim() || null,
                });
            } else {
                const nextSortOrder = customers.length;
                await createCustomer(darwinUri, idToken, {
                    customer_name: name,
                    description: formDescription.trim() || null,
                    sort_order: nextSortOrder,
                });
            }
            queryClient.invalidateQueries({ queryKey: customerKeys.all(creatorFk) });
            setDialogOpen(false);
        } catch (err) {
            showError(err.message || 'Save failed');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Delete customer "${row.customer_name}"?`)) return;
        try {
            await deleteCustomer(darwinUri, idToken, row.id);
            queryClient.invalidateQueries({ queryKey: customerKeys.all(creatorFk) });
        } catch (err) {
            showError(err.message || 'Delete failed');
        }
    };

    const columns = [
        { field: 'id', headerName: 'ID', width: 70 },
        { field: 'customer_name', headerName: 'Customer', flex: 1, minWidth: 180 },
        { field: 'description', headerName: 'Description', flex: 2, minWidth: 260 },
        {
            field: 'release_count',
            headerName: 'Releases',
            width: 100,
            type: 'number',
            renderCell: (params) => (
                <Box
                    component="span"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/customer-releases?customer_fk=${params.row.id}`);
                    }}
                    sx={{
                        cursor: 'pointer',
                        textDecoration: params.value > 0 ? 'underline' : 'none',
                        color: params.value > 0 ? 'primary.main' : 'text.secondary',
                    }}
                    data-testid={`customer-releases-link-${params.row.id}`}
                >
                    {params.value}
                </Box>
            ),
        },
        {
            field: 'create_ts',
            headerName: 'Created',
            width: 130,
            valueFormatter: formatDate,
        },
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
                            data-testid={`customer-edit-${params.row.id}`}
                            onClick={(e) => { e.stopPropagation(); openEdit(params.row); }}
                        >
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                        <IconButton
                            size="small"
                            data-testid={`customer-delete-${params.row.id}`}
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
                <Box />
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={openCreate}
                    data-testid="customer-add"
                >
                    Add customer
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
                            sorting: { sortModel: [{ field: 'customer_name', sort: 'asc' }] },
                        }}
                        pageSizeOptions={[10, 25, 50]}
                        disableRowSelectionOnClick
                        data-testid="customers-table"
                    />
                </Box>
            )}

            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editTarget ? 'Edit customer' : 'Add customer'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField
                            label="Customer name"
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            autoFocus
                            required
                            fullWidth
                            data-testid="customer-name-input"
                        />
                        <TextField
                            label="Description"
                            value={formDescription}
                            onChange={(e) => setFormDescription(e.target.value)}
                            fullWidth
                            multiline
                            minRows={2}
                            data-testid="customer-description-input"
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        disabled={submitting}
                        data-testid="customer-save"
                    >
                        {editTarget ? 'Save' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
