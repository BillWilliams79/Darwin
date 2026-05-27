// /swarm/swarm-starts — table of every /swarm-start invocation (req #2422).
// One row per invocation; click a row to navigate to /swarm/swarm-starts/:id
// (single view-page following the SwarmSessionDetail pattern).
// Sessions launched by an invocation are linked via the swarm_start_sessions
// junction (visible to MCP today; the visualizer surfaces them later).
//
// `parseSummary` is exported so the SwarmStartDetail page (and the unit test)
// can reuse it without duplicating the parser.

import { useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import { useAllSwarmStarts } from '../hooks/useDataQueries';
import { useViewPreference } from '../hooks/useViewPreference';
import { formatDateTime } from '../utils/dateFormat';
import SwarmStartsStatsView from './SwarmStartsStatsView';

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

const VIEW_STORAGE_KEY = 'darwin-swarm-starts-view';

const TABLE_WIDTH = 1140;

// Closed whitelist matching the swarm-start skill (req #2339).
const AUTONOMY_VALUES = ['planned', 'implemented', 'deployed'];

const autonomyChipProps = (filter) => {
    if (!filter) return null;
    switch (filter) {
        case 'planned':     return { sx: { bgcolor: '#90caf9', color: '#000' } };
        case 'implemented': return { sx: { bgcolor: '#a5d6a7', color: '#000' } };
        case 'deployed':    return { sx: { bgcolor: '#ce93d8', color: '#000' } };
        default:            return { color: 'default' };
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

export default function SwarmStartsPage() {
    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: swarmStarts = [], isLoading } = useAllSwarmStarts(creatorFk);

    // Autonomy filter chip-selector. null = All (no filter applied).
    // 'none' = rows with autonomy_filter IS NULL (the launch had no autonomy keyword).
    const [autonomyFilter, setAutonomyFilter] = useState(null);

    // View toggle (Table | Stats) — req #2686.
    const [view, setView] = useViewPreference(VIEW_STORAGE_KEY, 'table');
    const handleViewChange = (_event, newView) => setView(newView);

    const filteredRows = useMemo(() => {
        if (autonomyFilter === null) return swarmStarts;
        if (autonomyFilter === 'none') {
            return swarmStarts.filter(r => !r.autonomy_filter);
        }
        return swarmStarts.filter(r => r.autonomy_filter === autonomyFilter);
    }, [swarmStarts, autonomyFilter]);

    const columns = useMemo(() => [
        { field: 'id', headerName: 'ID', width: 70, type: 'number' },
        { field: 'session_count', headerName: 'Sessions', width: 90, type: 'number' },
        { field: 'wall_seconds', headerName: 'Wall', width: 90, type: 'number',
            valueFormatter: formatWallSeconds },
        {
            field: 'auto_start',
            headerName: 'Auto-Start',
            width: 100,
            type: 'boolean',
            valueGetter: (_v, row) => Boolean(row.auto_start),
        },
        {
            field: 'arguments',
            headerName: 'Arguments',
            width: 390,
            renderCell: (params) => (
                <Tooltip title={params.value || '(empty — all swarm-ready)'}>
                    <Typography variant="body2" component="span"
                                sx={{ fontFamily: 'monospace',
                                       overflow: 'hidden',
                                       textOverflow: 'ellipsis',
                                       whiteSpace: 'nowrap' }}
                                data-testid={`swarm-start-args-${params.row.id}`}>
                        {params.value || <em>(empty)</em>}
                    </Typography>
                </Tooltip>
            ),
        },
        {
            field: 'autonomy_filter',
            headerName: 'Autonomy',
            width: 120,
            renderCell: (params) => params.value
                ? <Chip label={params.value} size="small"
                        {...autonomyChipProps(params.value)}
                        sx={{ textTransform: 'capitalize',
                              ...(autonomyChipProps(params.value)?.sx || {}) }} />
                : <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>,
        },
        // Token columns — hidden by default, revealable via column-visibility toolbar.
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
    ], [timezone]);

    // Hide the four token columns by default; users can reveal via the toolbar.
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
                        mt: 3, mb: 1, px: 3, maxWidth: TABLE_WIDTH, flexWrap: 'wrap' }}>
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}
                       data-testid="autonomy-filter">
                    <Chip label="All" size="small"
                          onClick={() => setAutonomyFilter(null)}
                          color={autonomyFilter === null ? 'primary' : 'default'}
                          variant={autonomyFilter === null ? 'filled' : 'outlined'}
                          sx={{ cursor: 'pointer' }}
                          data-testid="autonomy-chip-all" />
                    {AUTONOMY_VALUES.map(v => {
                        const selected = autonomyFilter === v;
                        const props = autonomyChipProps(v);
                        return (
                            <Chip key={v} label={v} size="small"
                                  onClick={() => setAutonomyFilter(v)}
                                  variant={selected ? 'filled' : 'outlined'}
                                  sx={{ cursor: 'pointer',
                                         textTransform: 'capitalize',
                                         ...(selected && props?.sx ? props.sx : {}),
                                         ...(!selected && props?.sx
                                             ? { borderColor: props.sx.bgcolor, opacity: 0.7 }
                                             : {}) }}
                                  data-testid={`autonomy-chip-${v}`} />
                        );
                    })}
                    <Chip label="None" size="small"
                          title="No autonomy filter recorded"
                          onClick={() => setAutonomyFilter('none')}
                          color={autonomyFilter === 'none' ? 'primary' : 'default'}
                          variant={autonomyFilter === 'none' ? 'filled' : 'outlined'}
                          sx={{ cursor: 'pointer' }}
                          data-testid="autonomy-chip-none" />
                </Stack>
                <Box sx={{ flexGrow: 1 }} />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {view === 'table'
                        ? `${filteredRows.length} of ${swarmStarts.length} invocation${swarmStarts.length === 1 ? '' : 's'} — click a row for full summary`
                        : `${filteredRows.length} of ${swarmStarts.length} invocation${swarmStarts.length === 1 ? '' : 's'} in stats`}
                </Typography>
                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={handleViewChange}
                    size="small"
                    sx={{ flexShrink: 0 }}
                    data-testid="swarm-starts-view-toggle"
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
            </Box>
            {view === 'table' && (
                <Box className="app-content-tabpanel"
                     sx={{ px: 3, pt: 0, maxWidth: TABLE_WIDTH }}>
                    <DataGrid
                        rows={filteredRows}
                        columns={columns}
                        rowHeight={52}
                        density="compact"
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{ toolbar: { showQuickFilter: true } }}
                        initialState={initialState}
                        pageSizeOptions={[25, 50, 100]}
                        onRowClick={(p) => navigate(`/swarm/swarm-starts/${p.row.id}`)}
                        sx={{ cursor: 'pointer' }}
                        data-testid="swarm-starts-datagrid"
                    />
                </Box>
            )}
            {view === 'stats' && (
                <SwarmStartsStatsView rows={filteredRows} />
            )}
        </Box>
    );
}

const SYNTHESIZED_HEADERS = ['Session', 'Branch', 'Autonomy', 'Terminal', 'PRs'];

export function parseSummary(summary) {
    if (!summary) return [];
    const lines = summary.split('\n');
    const blocks = [];
    let i = 0;

    const isPipeRow = (s) => s.includes(' | ') || (s.startsWith('|') && s.endsWith('|'));
    const isSeparator = (s) => /^\|[\s|:-]+\|$/.test(s.trim());
    const splitMarkdownRow = (s) => {
        const trimmed = s.trim().replace(/^\|/, '').replace(/\|$/, '');
        return trimmed.split('|').map(c => c.trim());
    };
    const splitCompactRow = (s) => s.split(' | ').map(c => c.trim());

    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
            i += 1;
            continue;
        }

        // Standard markdown table: row | row, then separator |---|---|
        if (line.trim().startsWith('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
            const headers = splitMarkdownRow(line);
            i += 2; // skip header + separator
            const rows = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                rows.push(splitMarkdownRow(lines[i]));
                i += 1;
            }
            blocks.push({ kind: 'table', headers, rows });
            continue;
        }

        // Compact pipe block: 1+ consecutive lines with ` | ` (no markdown table syntax).
        if (isPipeRow(line) && !line.trim().startsWith('|')) {
            const rows = [];
            while (i < lines.length && lines[i].trim() &&
                   isPipeRow(lines[i]) && !lines[i].trim().startsWith('|')) {
                rows.push(splitCompactRow(lines[i]));
                i += 1;
            }
            // Synthesize headers based on column count. Truncate or pad.
            const colCount = Math.max(...rows.map(r => r.length));
            const headers = SYNTHESIZED_HEADERS.slice(0, colCount).concat(
                Array.from({ length: Math.max(0, colCount - SYNTHESIZED_HEADERS.length) },
                           (_, k) => `Col ${SYNTHESIZED_HEADERS.length + k + 1}`)
            );
            // Pad rows to colCount.
            const paddedRows = rows.map(r => r.concat(Array(colCount - r.length).fill('')));
            blocks.push({ kind: 'table', headers, rows: paddedRows });
            continue;
        }

        // Plain text (title lines, footers like "N of N swarms launched successfully.").
        // **bold** wrappers from the skill report → render as bold.
        let text = line;
        let bold = false;
        const m = text.match(/^\*\*(.+)\*\*$/);
        if (m) {
            text = m[1];
            bold = true;
        }
        blocks.push({ kind: 'text', text, bold });
        i += 1;
    }

    return blocks;
}
