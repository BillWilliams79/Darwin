import '../index.css';
import AuthContext from '../Context/AuthContext';
import { useSessions, useDevServers } from '../hooks/useDataQueries';
import { useShowClosedStore } from '../stores/useShowClosedStore';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import { renderSourceRef } from './repoGitHubMap.jsx';
import React, { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { CircularProgress, Typography, FormControlLabel, Switch } from '@mui/material';

const swarmStatusColor = (status) => {
    switch (status) {
        case 'starting':   return 'info';
        case 'active':     return 'primary';
        case 'paused':     return 'warning';
        case 'completing': return 'info';
        case 'completed':  return 'success';
        default:           return 'default';
    }
};

const getSessionColumns = (navigate) => [
    { field: 'id',           headerName: 'ID',          width: 70 },
    {
        field: 'swarm_status',
        headerName: 'Status',
        width: 120,
        renderCell: (params) => (
            <Chip label={params.value} size="small"
                  color={swarmStatusColor(params.value)}
                  data-testid="chip-swarm-status" />
        ),
    },
    { field: 'title',        headerName: 'Title',       width: 250 },
    { field: 'task_name',    headerName: 'Task',        width: 200, flex: 1 },
    {
        field: 'source_ref',
        headerName: 'Source',
        width: 140,
        renderCell: (params) => renderSourceRef(params.value, navigate),
    },
    {
        field: 'dev_server_port',
        headerName: 'Dev Server',
        width: 100,
        renderCell: (params) => params.value
            ? <Chip label={params.value} size="small" color="primary"
                    onClick={(e) => { e.stopPropagation(); navigate('/devservers'); }}
                    data-testid="chip-dev-server-port" />
            : '—',
    },
    { field: 'branch',       headerName: 'Branch',      width: 200 },
    {
        field: 'pr_url',
        headerName: 'Pull Request',
        width: 80,
        renderCell: (params) => params.value
            ? <a href={params.value} target="_blank" rel="noopener noreferrer"
                 onClick={(e) => e.stopPropagation()}
                 data-testid="session-pr-url">PR</a>
            : '—',
    },
    { field: 'worker_count', headerName: 'Workers',     width: 80,  type: 'number' },
    {
        field: 'started_at',
        headerName: 'Started',
        width: 170,
        valueFormatter: (value) => value ? new Date(value).toLocaleString() : '—',
    },
    {
        field: 'completed_at',
        headerName: 'Completed',
        width: 170,
        valueFormatter: (value) => value ? new Date(value).toLocaleString() : '—',
    },
];

const SessionsView = () => {

    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();

    const { data: sessionsArray } = useSessions(profile?.userName);
    const { data: devServersData } = useDevServers(profile?.userName);
    const showClosedSessions = useShowClosedStore(s => s.showClosedSessions);
    const toggleShowClosedSessions = useShowClosedStore(s => s.toggleShowClosedSessions);

    const devServerMap = useMemo(() => {
        if (!devServersData) return {};
        const map = {};
        devServersData.forEach(ds => { if (ds.session_fk) map[ds.session_fk] = ds.port; });
        return map;
    }, [devServersData]);

    const enrichedSessions = sessionsArray
        ? sessionsArray.map(s => ({ ...s, dev_server_port: devServerMap[s.id] || null }))
        : null;

    const filteredSessions = enrichedSessions && !showClosedSessions
        ? enrichedSessions.filter(s => s.swarm_status !== 'completed')
        : enrichedSessions;

    return (
        <Box sx={{ gridArea: 'content', p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography variant="h5" sx={{ flex: 1 }}>Swarm Sessions</Typography>
                <FormControlLabel
                    control={<Switch checked={showClosedSessions} onChange={toggleShowClosedSessions} size="small" />}
                    label="Show Completed"
                    data-testid="toggle-show-closed-sessions"
                    sx={{ mr: 1 }}
                />
            </Box>

            {!sessionsArray ? (
                <CircularProgress />
            ) : (
                <Box sx={{ height: 600, width: '100%' }} data-testid="sessions-datagrid">
                    <DataGrid
                        rows={filteredSessions}
                        columns={getSessionColumns(navigate)}
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{
                            toolbar: {
                                showQuickFilter: true,
                            },
                        }}
                        initialState={{
                            pagination: { paginationModel: { pageSize: 25 } },
                            sorting: { sortModel: [{ field: 'id', sort: 'desc' }] },
                        }}
                        pageSizeOptions={[10, 25, 50, 100]}
                        disableRowSelectionOnClick
                        onRowClick={(params) => navigate(`/swarm/session/${params.id}`)}
                        sx={{ cursor: 'pointer' }}
                        data-testid="sessions-grid"
                    />
                </Box>
            )}
        </Box>
    );
};

export default SessionsView;
