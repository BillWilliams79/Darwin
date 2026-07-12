import '../index.css';
import AuthContext from '../Context/AuthContext';
import { useSessions, useDevServers, useAllSwarmStartSessions, useMachines } from '../hooks/useDataQueries';
import { useShowClosedStore, ALL_SESSION_STATUSES } from '../stores/useShowClosedStore';
import { useViewPreference } from '../hooks/useViewPreference';
import { formatDateTime, formatDate } from '../utils/dateFormat';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import { swarmStatusChipProps, swarmStatusLabel } from './swarmStatusChipProps';
import { aiModelChipProps, aiModelLabel } from './modelChipStyles';
import { effortChipProps, effortLabel } from './effortChipStyles';
import { formatDuration } from '../utils/formatDuration';
import { renderSourceRef } from './repoGitHubMap.jsx';
import SessionsStatsView from './SessionsStatsView';
import React, { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import TableChartIcon from '@mui/icons-material/TableChart';
import BarChartIcon from '@mui/icons-material/BarChart';
import useMediaQuery from '@mui/material/useMediaQuery';
import { CircularProgress, Typography } from '@mui/material';

const SESSIONS_VIEW_STORAGE_KEY = 'darwin-swarm-sessions-view';

// Render a chip for source_ref values matching `requirement:N` (clickable,
// primary-color, navigates to the requirement detail). For other shapes
// (GitHub issue refs, plain strings) fall back to renderSourceRef.
const renderRequirementCell = (sourceRef, navigate) => {
    if (!sourceRef) return '—';
    const m = String(sourceRef).match(/^(?:priority|requirement):(\d+)$/);
    if (m) {
        const reqId = m[1];
        return (
            <Chip label={`#${reqId}`} size="small" color="primary"
                  onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/swarm/requirement/${reqId}`);
                  }}
                  sx={{ cursor: 'pointer' }}
                  data-testid={`session-requirement-${reqId}`} />
        );
    }
    return renderSourceRef(sourceRef, navigate);
};

const getSessionColumns = (navigate, timezone) => [
    { field: 'id',           headerName: 'ID',          width: 70 },
    {
        field: 'swarm_status',
        headerName: 'Status',
        width: 120,
        renderCell: (params) => (
            <Chip label={swarmStatusLabel(params.value)} size="small"
                  {...swarmStatusChipProps(params.value)}
                  data-testid="chip-swarm-status" />
        ),
    },
    {
        field: 'source_ref',
        headerName: 'Requirement',
        width: 120,
        renderCell: (params) => renderRequirementCell(params.value, navigate),
    },
    { field: 'title',        headerName: 'Title',       width: 250 },
    {
        // req #2943 — which machine ran this session. Name resolved client-side
        // from the machines query cache; NULL / unresolved renders em-dash.
        field: 'machine_name',
        headerName: 'Machine',
        width: 130,
        renderCell: (params) => params.value || '—',
    },
    {
        // req #2909 — the Claude model the session ran with. Pre-migration
        // rows render as Opus (the documented backfill default).
        field: 'ai_model',
        headerName: 'Model',
        width: 90,
        renderCell: (params) => (
            <Chip label={aiModelLabel(params.value)} size="small"
                  {...aiModelChipProps(params.value)}
                  data-testid="chip-ai-model" />
        ),
    },
    {
        // req #2916 — the Claude Code effort level the session ran with.
        // Pre-migration rows render as High (the documented backfill default).
        field: 'effort',
        headerName: 'Effort',
        width: 100,
        renderCell: (params) => (
            <Chip label={effortLabel(params.value)} size="small"
                  {...effortChipProps(params.value)}
                  data-testid="chip-effort" />
        ),
    },
    {
        field: 'dev_server_port',
        headerName: 'Dev Server',
        width: 100,
        renderCell: (params) => params.value
            ? <Chip label={params.value} size="small" color="primary"
                    component="a" href={`https://localhost:${params.value}`}
                    target="_blank" rel="noopener" clickable
                    onClick={(e) => e.stopPropagation()}
                    data-testid="chip-dev-server-port" />
            : '—',
    },
    {
        // Req #2422 — reverse junction lookup. Value populated client-side from
        // useAllSwarmStartSessions; pre-#2422 sessions and primary-closeout
        // sessions have no link (cell shows "—").
        field: 'swarm_start_fk',
        headerName: 'Swarm-Start',
        width: 110,
        renderCell: (params) => params.value
            ? <Chip label={`#${params.value}`} size="small" variant="outlined"
                    onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/swarm/swarm-starts/${params.value}`);
                    }}
                    sx={{ cursor: 'pointer' }}
                    data-testid={`session-launch-${params.row.id}`} />
            : '—',
    },
    {
        field: 'duration',
        headerName: 'Duration',
        width: 120,
        valueGetter: (value, row) => {
            if (row.instrumented) {
                return (Number(row.starting_secs) || 0)
                    + (Number(row.waiting_secs) || 0)
                    + (Number(row.planning_secs) || 0)
                    + (Number(row.implementing_secs) || 0)
                    + (Number(row.review_secs) || 0)
                    + (Number(row.completion_secs) || 0)
                    + (Number(row.paused_secs) || 0)
                    + (Number(row.legacy_secs) || 0);
            }
            return row.legacy_secs != null ? Number(row.legacy_secs) : null;
        },
        renderCell: (params) => {
            const row = params.row;
            const isLegacy = !row.instrumented;
            return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <span>{formatDuration(params.value)}</span>
                    {isLegacy && params.value != null && (
                        <Chip label="Legacy" size="small" variant="outlined"
                              sx={{ height: 18, fontSize: '0.65rem' }} />
                    )}
                </Box>
            );
        },
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
                    <Chip label={swarmStatusLabel(session.swarm_status)} size="small"
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
                    <Chip label={aiModelLabel(session.ai_model)} size="small"
                          {...aiModelChipProps(session.ai_model)}
                          data-testid="chip-ai-model" />
                    <Chip label={effortLabel(session.effort)} size="small"
                          {...effortChipProps(session.effort)}
                          data-testid="chip-effort" />
                    {session.dev_server_port && (
                        <Chip label={`Port ${session.dev_server_port}`} size="small" color="primary"
                              component="a" href={`https://localhost:${session.dev_server_port}`}
                              target="_blank" rel="noopener" clickable
                              onClick={(e) => e.stopPropagation()}
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
    const { data: swarmStartSessions } = useAllSwarmStartSessions(profile?.userName);
    const { data: machinesData } = useMachines(profile?.userName);

    // req #2943 — machine id → friendly name for the Machine column.
    const machineNameById = useMemo(() => {
        const map = {};
        (machinesData || []).forEach(m => { map[m.id] = m.title; });
        return map;
    }, [machinesData]);
    const sessionStatusFilter = useShowClosedStore(s => s.sessionStatusFilter);
    const toggleSessionStatus = useShowClosedStore(s => s.toggleSessionStatus);

    // View toggle (Table | Stats) — req #2825.
    const [view, setView] = useViewPreference(SESSIONS_VIEW_STORAGE_KEY, 'table');
    const handleViewChange = (_event, newView) => setView(newView);

    const devServerMap = useMemo(() => {
        if (!devServersData) return {};
        const map = {};
        devServersData.forEach(ds => { if (ds.session_fk) map[ds.session_fk] = ds.port; });
        return map;
    }, [devServersData]);

    // Req #2422 — session_fk -> swarm_start_fk lookup from the junction.
    // Multi-parent policy: a session linked to multiple swarm_starts resolves
    // to the MOST RECENT one (highest swarm_start_fk). Junction is sorted by
    // swarm_start_fk DESC so the first-write wins per session_fk. This matches
    // the MCP `darwin://swarm-starts-for-session/{id}` ORDER BY id DESC and
    // SwarmSessionDetail's `.find()` on the same sorted list — all three code
    // paths agree on the same parent for any given session.
    const swarmStartBySession = useMemo(() => {
        if (!swarmStartSessions) return {};
        const sorted = [...swarmStartSessions]
            .sort((a, b) => b.swarm_start_fk - a.swarm_start_fk);
        const map = {};
        sorted.forEach(j => {
            if (!(j.session_fk in map)) map[j.session_fk] = j.swarm_start_fk;
        });
        return map;
    }, [swarmStartSessions]);

    const enrichedSessions = sessionsArray
        ? sessionsArray.map(s => ({
            ...s,
            dev_server_port: devServerMap[s.id] || null,
            swarm_start_fk: swarmStartBySession[s.id] || null,
            machine_name: s.machine_fk != null ? (machineNameById[s.machine_fk] ?? null) : null,
          }))
        : null;

    const filteredSessions = enrichedSessions
        ? enrichedSessions.filter(s => sessionStatusFilter.includes(s.swarm_status))
        : null;

    const sortedSessions = filteredSessions
        ? [...filteredSessions].sort((a, b) => b.id - a.id)
        : null;

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={handleViewChange}
                    size="small"
                    sx={{ flexShrink: 0 }}
                    data-testid="sessions-view-toggle"
                >
                    <Tooltip title="Table View">
                        <ToggleButton value="table" data-testid="view-toggle-table" sx={{ px: 2 }}>
                            <TableChartIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                    <Tooltip title="Stats View">
                        <ToggleButton value="stats" data-testid="view-toggle-stats" sx={{ px: 2 }}>
                            <BarChartIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                </ToggleButtonGroup>
                <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ flex: 1 }}>Swarm Sessions</Typography>
                {view === 'table' && (
                    <Stack direction="row" spacing={0.5} data-testid="session-status-filter">
                        {ALL_SESSION_STATUSES.map(status => {
                            const selected = sessionStatusFilter.includes(status);
                            const chipProps = swarmStatusChipProps(status);
                            return (
                                <Chip
                                    key={status}
                                    label={swarmStatusLabel(status)}
                                    size="small"
                                    onClick={() => toggleSessionStatus(status)}
                                    {...(selected ? chipProps : { variant: 'outlined' })}
                                    sx={{
                                        ...(selected ? chipProps.sx : {}),
                                        ...(!selected && { opacity: 0.5 }),
                                        cursor: 'pointer',
                                        textTransform: 'capitalize',
                                    }}
                                    data-testid={`filter-chip-${status}`}
                                />
                            );
                        })}
                    </Stack>
                )}
            </Box>

            {!sessionsArray ? (
                <CircularProgress />
            ) : view === 'stats' ? (
                <SessionsStatsView rows={enrichedSessions || []} />
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
                <Box sx={{ width: '100%' }} data-testid="sessions-datagrid">
                    <DataGrid
                        autoHeight
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
