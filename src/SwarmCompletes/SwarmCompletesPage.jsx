// /swarm/swarm-completes — table of every /swarm-complete (and
// /primary-ai-swarm-complete) invocation (req #2497). One row per
// invocation; click a row to navigate to /swarm/swarm-completes/:id.
// Sessions closed by an invocation are linked via the swarm_complete_sessions
// junction (visible to MCP today; surfaced in the detail page below).

import { useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import { useAllSwarmCompletes } from '../hooks/useDataQueries';
import { useViewPreference } from '../hooks/useViewPreference';
import { formatDateTime } from '../utils/dateFormat';
import SwarmCompletesStatsView from './SwarmCompletesStatsView';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import TableChartIcon from '@mui/icons-material/TableChart';
import BarChartIcon from '@mui/icons-material/BarChart';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';


const VIEW_STORAGE_KEY = 'darwin-swarm-completes-view';

const STATUS_VALUES = ['in_progress', 'ok', 'error'];

const statusChipProps = (status) => {
    switch (status) {
        case 'in_progress': return { color: 'info' };
        case 'ok':          return { sx: { bgcolor: '#4caf50', color: '#fff' } };
        case 'error':       return { sx: { bgcolor: '#ef5350', color: '#fff' } };
        default:            return { color: 'default' };
    }
};

const skillChipProps = (name) => {
    switch (name) {
        case 'swarm-complete':            return { sx: { bgcolor: '#26c6da', color: '#000' } };
        case 'primary-ai-swarm-complete': return { sx: { bgcolor: '#ffa726', color: '#000' } };
        default:                          return { color: 'default' };
    }
};

const formatNum = (v) => (v == null ? '—' : Number(v).toLocaleString());
const formatWallSeconds = (v) => {
    if (v == null) return '—';
    const s = Number(v);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r}s`;
};

export default function SwarmCompletesPage() {
    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: swarmCompletes = [], isLoading } = useAllSwarmCompletes(creatorFk);

    // View toggle (Table | Stats) — req #2794.
    const [view, setView] = useViewPreference(VIEW_STORAGE_KEY, 'table');
    const handleViewChange = (_event, newView) => setView(newView);

    // Status filter chip-selector. null = All.
    const [statusFilter, setStatusFilter] = useState(null);

    const filteredRows = useMemo(() => {
        if (statusFilter === null) return swarmCompletes;
        return swarmCompletes.filter(r => r.status === statusFilter);
    }, [swarmCompletes, statusFilter]);

    const columns = useMemo(() => [
        { field: 'id', headerName: 'ID', width: 70, type: 'number' },
        {
            field: 'skill_name',
            headerName: 'Skill',
            width: 250,
            renderCell: (params) => (
                <Chip label={params.value} size="small"
                      {...skillChipProps(params.value)}
                      sx={{ fontFamily: 'monospace',
                             ...(skillChipProps(params.value)?.sx || {}) }} />
            ),
        },
        {
            field: 'status',
            headerName: 'Status',
            width: 110,
            renderCell: (params) => (
                <Chip label={params.value} size="small"
                      {...statusChipProps(params.value)} />
            ),
        },
        { field: 'wall_seconds', headerName: 'Wall Clock Time', width: 140, type: 'number',
            valueFormatter: formatWallSeconds },
        // Token columns — hidden by default, revealable via the toolbar.
        { field: 'tokens_input', headerName: 'Input', width: 100, type: 'number',
            valueFormatter: formatNum },
        { field: 'tokens_cache_write', headerName: 'Cache W', width: 110, type: 'number',
            valueFormatter: formatNum },
        { field: 'tokens_cache_read', headerName: 'Cache R', width: 120, type: 'number',
            valueFormatter: formatNum },
        { field: 'tokens_output', headerName: 'Output', width: 100, type: 'number',
            valueFormatter: formatNum },
        { field: 'turn_count', headerName: 'Turns', width: 80, type: 'number' },
        {
            field: 'started_at',
            headerName: 'Started',
            width: 200,
            valueFormatter: (value) => value ? formatDateTime(value, timezone) : '—',
        },
        {
            field: 'completed_at',
            headerName: 'Completed',
            width: 200,
            valueFormatter: (value) => value ? formatDateTime(value, timezone) : '—',
        },
    ], [timezone]);

    const initialState = useMemo(() => ({
        pagination: { paginationModel: { pageSize: 25 } },
        sorting: { sortModel: [{ field: 'started_at', sort: 'desc' }] },
        columns: {
            columnVisibilityModel: {
                tokens_input: false,
                tokens_cache_write: false,
                tokens_cache_read: false,
                tokens_output: false,
            },
        },
    }), []);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box className="app-content-planpage">
            <Box className="app-content-view-toggle"
                 sx={{ display: 'flex', alignItems: 'center', gap: 2,
                        mt: 3, mb: 1, px: 3, flexWrap: 'wrap' }}>
                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={handleViewChange}
                    size="small"
                    sx={{ flexShrink: 0 }}
                    data-testid="swarm-completes-view-toggle"
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
                {view === 'table' && (
                    <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}
                           data-testid="status-filter">
                        <Chip label="All" size="small"
                              onClick={() => setStatusFilter(null)}
                              color={statusFilter === null ? 'primary' : 'default'}
                              variant={statusFilter === null ? 'filled' : 'outlined'}
                              sx={{ cursor: 'pointer' }}
                              data-testid="status-chip-all" />
                        {STATUS_VALUES.map(v => {
                            const selected = statusFilter === v;
                            const props = statusChipProps(v);
                            return (
                                <Chip key={v} label={v} size="small"
                                      onClick={() => setStatusFilter(v)}
                                      variant={selected ? 'filled' : 'outlined'}
                                      sx={{ cursor: 'pointer',
                                             ...(selected && props?.sx ? props.sx : {}),
                                             ...(!selected && props?.sx
                                                 ? { borderColor: props.sx.bgcolor, opacity: 0.7 }
                                                 : {}) }}
                                      data-testid={`status-chip-${v}`} />
                            );
                        })}
                    </Stack>
                )}
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {view === 'table'
                        ? `${filteredRows.length} of ${swarmCompletes.length} complete${swarmCompletes.length === 1 ? '' : 's'} — click a row for full summary`
                        : `${swarmCompletes.length} complete${swarmCompletes.length === 1 ? '' : 's'} in stats`}
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
            </Box>
            {view === 'table' && (
                <Box className="app-content-tabpanel"
                     sx={{ px: 3, pt: 0 }}>
                    <DataGrid
                        rows={filteredRows}
                        columns={columns}
                        rowHeight={52}
                        density="compact"
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{ toolbar: { showQuickFilter: true } }}
                        initialState={initialState}
                        pageSizeOptions={[25, 50, 100]}
                        onRowClick={(p) => navigate(`/swarm/swarm-completes/${p.row.id}`)}
                        sx={{ cursor: 'pointer' }}
                        data-testid="swarm-completes-datagrid"
                    />
                </Box>
            )}
            {view === 'stats' && (
                <SwarmCompletesStatsView rows={swarmCompletes} />
            )}
        </Box>
    );
}
