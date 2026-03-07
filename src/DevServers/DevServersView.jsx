import '../index.css';
import AuthContext from '../Context/AuthContext';
import { useDevServers } from '../hooks/useDataQueries';
import { formatDateTime, formatDate } from '../utils/dateFormat';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import useMediaQuery from '@mui/material/useMediaQuery';
import { CircularProgress, Typography } from '@mui/material';

const getDevServerColumns = (navigate, timezone) => [
    { field: 'id',             headerName: 'ID',        width: 70 },
    {
        field: 'port',
        headerName: 'Port',
        width: 100,
        renderCell: (params) => (
            <Chip label={params.value} size="small" color="primary"
                  component="a" href={`https://localhost:${params.value}`}
                  target="_blank" rel="noopener" clickable
                  data-testid="chip-dev-server-port" />
        ),
    },
    { field: 'pid',            headerName: 'PID',       width: 90,  type: 'number' },
    { field: 'workspace_path', headerName: 'Workspace',  width: 300, flex: 1 },
    {
        field: 'session_fk',
        headerName: 'Session',
        width: 100,
        renderCell: (params) => params.value
            ? <a href={`/swarm/session/${params.value}`}
                 onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigate(`/swarm/session/${params.value}`); }}
                 data-testid="dev-server-session-link">
                #{params.value}
              </a>
            : '—',
    },
    {
        field: 'started_at',
        headerName: 'Started',
        width: 170,
        valueFormatter: (value) => value ? formatDateTime(value, timezone) : '—',
    },
];

const DevServerCard = ({ server, navigate, timezone }) => {
    const workspaceName = server.workspace_path
        ? server.workspace_path.split('/').pop()
        : '—';

    return (
        <Card variant="outlined" sx={{ mb: 1 }}>
            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Chip label={`Port ${server.port}`} size="small" color="primary"
                          component="a" href={`https://localhost:${server.port}`}
                          target="_blank" rel="noopener" clickable
                          data-testid="chip-dev-server-port" />
                    {server.session_fk ? (
                        <Chip label={`Session #${server.session_fk}`} size="small" variant="outlined"
                              onClick={() => navigate(`/swarm/session/${server.session_fk}`)}
                              clickable
                              data-testid="dev-server-session-link" />
                    ) : (
                        <Typography variant="caption" color="text.secondary">No session</Typography>
                    )}
                </Box>
                <Typography variant="body2" sx={{ mb: 0.5, wordBreak: 'break-all' }}>
                    {workspaceName}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="caption" color="text.secondary">
                        PID {server.pid}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                        {server.started_at ? formatDate(server.started_at, timezone) : ''}
                    </Typography>
                </Stack>
            </CardContent>
        </Card>
    );
};

const DevServersView = () => {

    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();
    const isMobile = useMediaQuery('(max-width:899px)');

    const { data: devServersArray } = useDevServers(profile?.userName);

    const sortedServers = devServersArray
        ? [...devServersArray].sort((a, b) => b.id - a.id)
        : null;

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
            <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ mb: 1 }}>Dev Servers</Typography>

            {!devServersArray ? (
                <CircularProgress />
            ) : isMobile ? (
                <Box data-testid="dev-servers-datagrid">
                    {sortedServers.length === 0 ? (
                        <Typography color="text.secondary" sx={{ p: 2 }}>No dev servers</Typography>
                    ) : (
                        sortedServers.map(server => (
                            <DevServerCard key={server.id} server={server} navigate={navigate} timezone={profile?.timezone} />
                        ))
                    )}
                </Box>
            ) : (
                <Box sx={{ height: 600, width: '100%' }} data-testid="dev-servers-datagrid">
                    <DataGrid
                        rows={devServersArray}
                        columns={getDevServerColumns(navigate, profile?.timezone)}
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
                        sx={{ cursor: 'default' }}
                        data-testid="dev-servers-grid"
                    />
                </Box>
            )}
        </Box>
    );
};

export default DevServersView;
