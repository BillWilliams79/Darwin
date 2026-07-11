import '../index.css';
import React, { useContext, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import useMediaQuery from '@mui/material/useMediaQuery';
import { CircularProgress, Typography } from '@mui/material';
import { DataGrid, GridToolbar, useGridApiRef } from '@mui/x-data-grid';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { useMachines, machineKeys } from '../hooks/useDataQueries';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { formatDateTime } from '../utils/dateFormat';

// Platform chip colouring — a small visual anchor per OS family.
const platformChipProps = (platform) => {
    switch (platform) {
        case 'darwin': return { color: 'primary' };
        case 'wsl':    return { color: 'secondary' };
        case 'linux':  return { color: 'default', variant: 'outlined' };
        default:       return { color: 'default', variant: 'outlined' };
    }
};

/**
 * MachinesView — the /swarm/machines management page (req #2943).
 *
 * Table of the machines that run Darwin swarm work. Name + Description are
 * inline-editable (DataGrid processRowUpdate → REST PUT). The Closed column is a
 * click-to-toggle retire/re-open chip (soft-close via `closed`). Follows the Dev
 * Servers page shape; no Cards/Trends views (minimal by design).
 */
const MachinesView = () => {
    const { profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const isMobile = useMediaQuery('(max-width:899px)');
    const apiRef = useGridApiRef();

    const creatorFk = profile?.userName;
    const { data: machinesArray, isLoading } = useMachines(creatorFk);

    const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: machineKeys.all(creatorFk) });

    // Inline edit of Name (title) or Description → REST PUT (body is always an
    // array; NULL description sent as the string "NULL" per Darwin convention).
    const handleProcessRowUpdate = async (newRow, oldRow) => {
        const patch = {};
        if (newRow.title !== oldRow.title) {
            const t = (newRow.title || '').trim();
            if (!t) return oldRow;              // title is NOT NULL — reject blanks
            patch.title = t;
        }
        if (newRow.description !== oldRow.description) {
            const d = (newRow.description || '').trim();
            patch.description = d === '' ? 'NULL' : d;
        }
        if (Object.keys(patch).length === 0) return oldRow;
        try {
            await call_rest_api(`${darwinUri}/machines`, 'PUT',
                [{ id: newRow.id, ...patch }], idToken);
            invalidate();
            return { ...newRow, ...patch, description: patch.description === 'NULL' ? null : newRow.description };
        } catch (err) {
            showError(err, 'Failed to update machine');
            return oldRow;
        }
    };

    const toggleClosed = async (row) => {
        try {
            await call_rest_api(`${darwinUri}/machines`, 'PUT',
                [{ id: row.id, closed: row.closed ? 0 : 1 }], idToken);
            invalidate();
        } catch (err) {
            showError(err, 'Failed to retire/re-open machine');
        }
    };

    const columns = useMemo(() => [
        { field: 'id', headerName: 'ID', width: 60 },
        {
            field: 'title',
            headerName: 'Name',
            width: 180,
            editable: true,
            renderCell: (params) => (
                <span data-testid={`machine-name-${params.row.id}`}>{params.value}</span>
            ),
        },
        { field: 'hostname', headerName: 'Hostname', width: 160 },
        {
            field: 'platform',
            headerName: 'Platform',
            width: 110,
            renderCell: (params) => (
                <Chip label={params.value || '—'} size="small"
                      {...platformChipProps(params.value)}
                      data-testid={`machine-platform-${params.row.id}`} />
            ),
        },
        { field: 'arch', headerName: 'Arch', width: 90 },
        {
            field: 'hw_model',
            headerName: 'HW Model',
            width: 140,
            valueFormatter: (value) => value || '—',
        },
        {
            field: 'os_version',
            headerName: 'OS Version',
            width: 150,
            valueFormatter: (value) => value || '—',
        },
        {
            field: 'description',
            headerName: 'Description',
            width: 200,
            editable: true,
            valueFormatter: (value) => value || '—',
        },
        {
            field: 'last_seen_at',
            headerName: 'Last Seen',
            width: 170,
            valueFormatter: (value) => value ? formatDateTime(value, profile?.timezone) : '—',
        },
        {
            field: 'closed',
            headerName: 'Status',
            width: 110,
            sortable: false,
            renderCell: (params) => (
                <Chip
                    label={params.value ? 'Retired' : 'Active'}
                    size="small"
                    color={params.value ? 'default' : 'success'}
                    variant={params.value ? 'outlined' : 'filled'}
                    onClick={() => toggleClosed(params.row)}
                    clickable
                    data-testid={`machine-toggle-closed-${params.row.id}`}
                />
            ),
        },
    ], [profile?.timezone]); // eslint-disable-line react-hooks/exhaustive-deps

    const sortedMachines = machinesArray
        ? [...machinesArray].sort((a, b) => {
            // sort_order NULLs last, then id
            const ao = a.sort_order == null ? Infinity : a.sort_order;
            const bo = b.sort_order == null ? Infinity : b.sort_order;
            return ao - bo || a.id - b.id;
        })
        : null;

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
            <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ mb: 1 }}>Machines</Typography>

            {isLoading || !machinesArray ? (
                <CircularProgress />
            ) : isMobile ? (
                <Box data-testid="machines-datagrid">
                    {sortedMachines.length === 0 ? (
                        <Typography color="text.secondary" sx={{ p: 2 }}>No machines</Typography>
                    ) : (
                        sortedMachines.map(m => (
                            <Card key={m.id} variant="outlined" sx={{ mb: 1 }}>
                                <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                                        <Typography variant="body1" sx={{ fontWeight: 500 }}
                                                    data-testid={`machine-name-${m.id}`}>
                                            {m.title}
                                        </Typography>
                                        <Chip label={m.closed ? 'Retired' : 'Active'} size="small"
                                              color={m.closed ? 'default' : 'success'}
                                              variant={m.closed ? 'outlined' : 'filled'}
                                              onClick={() => toggleClosed(m)} clickable
                                              data-testid={`machine-toggle-closed-${m.id}`} />
                                    </Box>
                                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                        <Chip label={m.platform || '—'} size="small" {...platformChipProps(m.platform)} />
                                        <Typography variant="caption" color="text.secondary">{m.hostname}</Typography>
                                        <Typography variant="caption" color="text.secondary">{m.arch}</Typography>
                                    </Stack>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                        {m.hw_model || ''} {m.os_version ? `· ${m.os_version}` : ''}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                        Last seen: {m.last_seen_at ? formatDateTime(m.last_seen_at, profile?.timezone) : '—'}
                                    </Typography>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </Box>
            ) : (
                <Box sx={{ width: '100%' }} data-testid="machines-datagrid">
                    <DataGrid
                        apiRef={apiRef}
                        autoHeight
                        rows={sortedMachines ?? []}
                        columns={columns}
                        processRowUpdate={handleProcessRowUpdate}
                        onProcessRowUpdateError={(err) => showError(err, 'Failed to update machine')}
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{ toolbar: { showQuickFilter: true } }}
                        initialState={{
                            pagination: { paginationModel: { pageSize: 25 } },
                            sorting: { sortModel: [{ field: 'id', sort: 'asc' }] },
                        }}
                        pageSizeOptions={[10, 25, 50, 100]}
                        disableRowSelectionOnClick
                        density="compact"
                        data-testid="machines-grid"
                    />
                </Box>
            )}
        </Box>
    );
};

export default MachinesView;
