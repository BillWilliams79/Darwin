import '../index.css';
import AuthContext from '../Context/AuthContext';
import { useDevServers, useSessions, useAllRequirements, useMachines } from '../hooks/useDataQueries';
import { formatDateTime, formatDate } from '../utils/dateFormat';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import React, { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import useMediaQuery from '@mui/material/useMediaQuery';
import { CircularProgress, Link, Typography } from '@mui/material';

const getDevServerColumns = (navigate, timezone) => [
    { field: 'id',             headerName: 'ID',        width: 70 },
    {
        field: 'started_at',
        headerName: 'Started',
        width: 170,
        valueFormatter: (value) => value ? formatDateTime(value, timezone) : '—',
    },
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
    {
        field: 'terminal_number',
        headerName: 'Terminal',
        width: 100,
        renderCell: (params) => params.value != null
            ? `Term ${params.value}`
            : '—',
    },
    {
        field: 'requirement_id',
        headerName: 'Roadmap ID',
        width: 110,
        renderCell: (params) => params.value
            ? <a href={`/swarm/requirement/${params.value}`}
                 target="_blank" rel="noopener noreferrer"
                 data-testid="dev-server-requirement-id-link">
                #{params.value}
              </a>
            : '—',
    },
    {
        field: 'requirement_title',
        headerName: 'Roadmap Requirement',
        width: 300,
        renderCell: (params) => {
            if (!params.value) return '—';
            const reqId = params.row.requirement_id;
            return reqId ? (
                <a href={`/swarm/requirement/${reqId}`}
                   target="_blank" rel="noopener noreferrer"
                   data-testid="dev-server-requirement-link">
                    {params.value}
                </a>
            ) : params.value;
        },
    },
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
        // req #2943 — which machine hosts this dev server. Name resolved
        // client-side from the machines cache; NULL / unresolved → em-dash. (The
        // browser can't detect which machine it is on, so the column itself is
        // the disambiguator — `https://localhost:<port>` only works locally.)
        field: 'machine_name',
        headerName: 'Machine',
        width: 130,
        renderCell: (params) => params.value || '—',
    },
    { field: 'pid',            headerName: 'PID',        width: 90,  type: 'number' },
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
                {server.terminal_number != null ? (
                    <Typography variant="caption" color="text.secondary"
                                sx={{ mb: 0.5, display: 'block' }}
                                data-testid="dev-server-terminal-number">
                        Term {server.terminal_number}
                    </Typography>
                ) : null}
                {server.requirement_id ? (
                    <Box sx={{ mb: 0.5 }}>
                        <Link href={`/swarm/requirement/${server.requirement_id}`}
                              target="_blank" rel="noopener noreferrer"
                              variant="body2"
                              data-testid="dev-server-requirement-id-link">
                            #{server.requirement_id}
                        </Link>
                        {server.requirement_title ? (
                            <Link href={`/swarm/requirement/${server.requirement_id}`}
                                  target="_blank" rel="noopener noreferrer"
                                  variant="body2"
                                  sx={{ ml: 1 }}
                                  data-testid="dev-server-requirement-link">
                                {server.requirement_title}
                            </Link>
                        ) : null}
                    </Box>
                ) : null}
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
    const { data: sessionsArray } = useSessions(profile?.userName);
    const { data: allRequirements } = useAllRequirements(profile?.userName);
    const { data: machinesData } = useMachines(profile?.userName);

    // req #2943 — machine id → friendly name for the Machine column.
    const machineNameById = useMemo(() => {
        const map = {};
        (machinesData || []).forEach(m => { map[m.id] = m.title; });
        return map;
    }, [machinesData]);

    const sessionToRequirementId = useMemo(() => {
        if (!sessionsArray) return {};
        const map = {};
        sessionsArray.forEach(s => {
            const m = s.source_ref?.match(/^(priority|requirement):(\d+)$/);
            if (m) map[s.id] = parseInt(m[2], 10);
        });
        return map;
    }, [sessionsArray]);

    const requirementMap = useMemo(() => {
        if (!allRequirements) return {};
        const map = {};
        allRequirements.forEach(p => { map[p.id] = p; });
        return map;
    }, [allRequirements]);

    const enrichedServers = useMemo(() => devServersArray?.map(s => ({
        ...s,
        requirement_id: s.session_fk ? sessionToRequirementId[s.session_fk] ?? null : null,
        requirement_title: s.session_fk
            ? requirementMap[sessionToRequirementId[s.session_fk]]?.title ?? null
            : null,
        machine_name: s.machine_fk != null ? (machineNameById[s.machine_fk] ?? null) : null,
    })), [devServersArray, sessionToRequirementId, requirementMap, machineNameById]);

    const sortedServers = enrichedServers
        ? [...enrichedServers].sort((a, b) => b.id - a.id)
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
                <Box sx={{ width: 'fit-content' }} data-testid="dev-servers-datagrid">
                    <DataGrid
                        autoHeight
                        rows={enrichedServers ?? []}
                        columns={getDevServerColumns(navigate, profile?.timezone)}
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{
                            toolbar: {
                                showQuickFilter: true,
                            },
                        }}
                        initialState={{
                            pagination: { paginationModel: { pageSize: 25 } },
                            sorting: { sortModel: [{ field: 'port', sort: 'asc' }] },
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
