import '../index.css';
import AuthContext from '../Context/AuthContext';
import { useSessions, useDevServers } from '../hooks/useDataQueries';
import { useShowClosedStore } from '../stores/useShowClosedStore';
import { formatDateTime, formatDate } from '../utils/dateFormat';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import { renderSourceRef } from './repoGitHubMap.jsx';
import React, { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import useMediaQuery from '@mui/material/useMediaQuery';
import { CircularProgress, Typography, FormControlLabel, Switch } from '@mui/material';

const swarmStatusChipProps = (status) => {
    switch (status) {
        case 'active':     return { sx: { bgcolor: '#4caf50', color: '#fff' } };
        case 'paused':     return { sx: { bgcolor: '#f0d000', color: '#000' } };
        case 'starting':   return { color: 'info' };
        case 'completing': return { color: 'info' };
        case 'completed':  return { color: 'success' };
        default:           return { color: 'default' };
    }
};

const getSessionColumns = (navigate, timezone) => [
    { field: 'id',           headerName: 'ID',          width: 70 },
    {
        field: 'swarm_status',
        headerName: 'Status',
        width: 120,
        renderCell: (params) => (
            <Chip label={params.value} size="small"
                  {...swarmStatusChipProps(params.value)}
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
    {
        field: 'started_at',
        headerName: 'Started',
        width: 170,
        valueFormatter: (value) => value ? formatDateTime(value, timezone) : '—',
    },
    {
        field: 'completed_at',
        headerName: 'Completed',
        width: 170,
        valueFormatter: (value) => value ? formatDateTime(value, timezone) : '—',
    },
];

const SessionCard = ({ session, navigate, timezone }) => (
    <Card variant="outlined" sx={{ mb: 1 }}>
        <CardActionArea onClick={() => navigate(`/swarm/session/${session.id}`)}>
            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Chip label={session.swarm_status} size="small"
                          {...swarmStatusChipProps(session.swarm_status)}
                          data-testid="chip-swarm-status" />
                    <Typography variant="caption" color="text.secondary">
                        #{session.id}
                    </Typography>
                </Box>
                <Typography variant="body1" sx={{ fontWeight: 500, mb: 0.5 }}>
                    {session.title || session.task_name || '(untitled)'}
                </Typography>
                {session.title && session.task_name && session.task_name !== session.title && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                        {session.task_name}
                    </Typography>
                )}
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    {session.dev_server_port && (
                        <Chip label={`Port ${session.dev_server_port}`} size="small" color="primary"
                              data-testid="chip-dev-server-port" />
                    )}
                    {session.pr_url && (
                        <Chip label="PR" size="small" variant="outlined"
                              component="a" href={session.pr_url} target="_blank" rel="noopener noreferrer"
                              clickable onClick={(e) => e.stopPropagation()}
                              data-testid="session-pr-url" />
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                        {session.started_at ? formatDate(session.started_at, timezone) : ''}
                    </Typography>
                </Stack>
            </CardContent>
        </CardActionArea>
    </Card>
);

const SessionsView = () => {

    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();
    const isMobile = useMediaQuery('(max-width:899px)');

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

    const sortedSessions = filteredSessions
        ? [...filteredSessions].sort((a, b) => b.id - a.id)
        : null;

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ flex: 1 }}>Swarm Sessions</Typography>
                <FormControlLabel
                    control={<Switch checked={showClosedSessions} onChange={toggleShowClosedSessions} size="small" />}
                    label="Show Completed"
                    data-testid="toggle-show-closed-sessions"
                    sx={{ mr: 1 }}
                />
            </Box>

            {!sessionsArray ? (
                <CircularProgress />
            ) : isMobile ? (
                <Box data-testid="sessions-datagrid">
                    {sortedSessions.length === 0 ? (
                        <Typography color="text.secondary" sx={{ p: 2 }}>No sessions</Typography>
                    ) : (
                        sortedSessions.map(session => (
                            <SessionCard key={session.id} session={session} navigate={navigate} timezone={profile?.timezone} />
                        ))
                    )}
                </Box>
            ) : (
                <Box sx={{ height: 600, width: '100%' }} data-testid="sessions-datagrid">
                    <DataGrid
                        rows={filteredSessions}
                        columns={getSessionColumns(navigate, profile?.timezone)}
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
