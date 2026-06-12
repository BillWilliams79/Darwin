// /swarm/swarm-starts — table of every /swarm-start invocation (req #2422).
// One row per invocation; click a row to navigate to /swarm/swarm-starts/:id
// (single view-page following the SwarmSessionDetail pattern).
// Sessions launched by an invocation are linked via the swarm_start_sessions
// junction (visible to MCP today; the visualizer surfaces them later).
//
// `parseSummary` is exported so the SwarmStartDetail page (and the unit test)
// can reuse it without duplicating the parser.

import { useCallback, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import {
    useAllSwarmStarts,
    useSessions,
    useAllSwarmStartSessions,
} from '../hooks/useDataQueries';
import { useViewPreference } from '../hooks/useViewPreference';
import { formatDateTime } from '../utils/dateFormat';
import { selectRequirementsForSwarmStart } from './requirementsList';
import SwarmStartsStatsView from './SwarmStartsStatsView';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import TableChartIcon from '@mui/icons-material/TableChart';
import BarChartIcon from '@mui/icons-material/BarChart';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

const VIEW_STORAGE_KEY = 'darwin-swarm-starts-view';

const TABLE_WIDTH = 1500;

// Per-line height for the multi-line "Requirements" cell (req #2685). Compact
// `Typography body2` renders at 18px line-height; the baseline 52px gives a
// 0-session row two lines of vertical padding equal to the prior fixed height.
const REQ_LINE_HEIGHT = 18;
const REQ_BASE_HEIGHT = 52;

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
    // Req #2685 — junction + sessions feed the per-row "Requirements" cell.
    // Both lists are already paged into the cache by other views (SwarmStartDetail,
    // SessionsView); reusing them keeps this page free of extra round-trips.
    const { data: sessionsArray = [] } = useSessions(creatorFk);
    const { data: junction = [] } = useAllSwarmStartSessions(creatorFk);

    // View toggle (Table | Stats) — req #2686.
    const [view, setView] = useViewPreference(VIEW_STORAGE_KEY, 'table');
    const handleViewChange = (_event, newView) => setView(newView);

    // swarm_start.id → [{ reqId, title, sessionId, startedAt }], built once
    // per (sessions, junction) change. The DataGrid's `valueGetter` and
    // `renderCell` both pull from this map by row id.
    const requirementsByStart = useMemo(() => {
        const m = new Map();
        for (const s of swarmStarts) {
            m.set(s.id, selectRequirementsForSwarmStart(sessionsArray, junction, s.id));
        }
        return m;
    }, [swarmStarts, sessionsArray, junction]);

    const columns = useMemo(() => [
        { field: 'id', headerName: 'ID', width: 70, type: 'number' },
        { field: 'session_count', headerName: 'Sessions', width: 90, type: 'number' },
        { field: 'wall_seconds', headerName: 'Wall Clock Time', width: 140, type: 'number',
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
                <Tooltip title={params.value || '—'}>
                    <Typography variant="body2" component="span"
                                sx={{ fontFamily: 'monospace',
                                       overflow: 'hidden',
                                       textOverflow: 'ellipsis',
                                       whiteSpace: 'nowrap',
                                       ...(params.value ? {} : { color: 'text.secondary' }) }}
                                data-testid={`swarm-start-args-${params.row.id}`}>
                        {params.value || '—'}
                    </Typography>
                </Tooltip>
            ),
        },
        // Req #2685 — per-row list of every requirement launched by this
        // swarm-start. One line per linked session; lines do not wrap;
        // overflow is clipped with an ellipsis. Row height grows with
        // session count (see getRowHeight below).
        {
            field: 'requirements_list',
            headerName: 'Requirements',
            width: 360,
            sortable: false,
            // valueGetter feeds quick-filter and CSV export with a newline-
            // joined string ("2685 — display\n2686 — stats\n…"). Filter
            // matches when the user types any req id or title substring.
            valueGetter: (_v, row) => {
                const list = requirementsByStart.get(row.id) || [];
                return list
                    .map(r => `${r.reqId ?? ''} ${r.title}`.trim())
                    .join('\n');
            },
            renderCell: (params) => {
                const list = requirementsByStart.get(params.row.id) || [];
                if (list.length === 0) {
                    return (
                        <Typography variant="caption"
                                    sx={{ color: 'text.secondary' }}>
                            —
                        </Typography>
                    );
                }
                return (
                    <Box sx={{ display: 'flex', flexDirection: 'column',
                                width: '100%', py: 0.5,
                                lineHeight: `${REQ_LINE_HEIGHT}px` }}
                         data-testid={`swarm-start-reqs-${params.row.id}`}>
                        {list.map(r => {
                            const reqLabel = r.reqId ?? '—';
                            const full = `${reqLabel} — ${r.title}`;
                            return (
                                <Tooltip key={r.sessionId} title={full}>
                                    <Typography variant="body2" component="span"
                                                sx={{ fontFamily: 'monospace',
                                                       overflow: 'hidden',
                                                       textOverflow: 'ellipsis',
                                                       whiteSpace: 'nowrap',
                                                       lineHeight: `${REQ_LINE_HEIGHT}px`,
                                                       fontSize: '0.8rem' }}>
                                        <Box component="span"
                                             sx={{ color: 'text.secondary', mr: 0.75 }}>
                                            {reqLabel}
                                        </Box>
                                        {r.title}
                                    </Typography>
                                </Tooltip>
                            );
                        })}
                    </Box>
                );
            },
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
    ], [timezone, requirementsByStart]);

    // Req #2685 — row height grows to fit one line per linked session.
    // Empty rows fall back to the prior fixed 52px so the table doesn't
    // collapse before the junction loads. Cap at 26 lines (~520px) so a
    // pathological launch can't blow up the viewport. `useCallback` keeps
    // the reference stable across re-renders that don't change the map,
    // so DataGrid doesn't re-measure every row on each render.
    const getRowHeight = useCallback((params) => {
        const list = requirementsByStart.get(params.id);
        const n = list ? list.length : 0;
        if (n <= 1) return REQ_BASE_HEIGHT;
        const capped = Math.min(n, 26);
        return Math.max(REQ_BASE_HEIGHT, 28 + REQ_LINE_HEIGHT * capped);
    }, [requirementsByStart]);

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
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {view === 'table'
                        ? `${swarmStarts.length} invocation${swarmStarts.length === 1 ? '' : 's'} — click a row for full summary`
                        : `${swarmStarts.length} invocation${swarmStarts.length === 1 ? '' : 's'} in stats`}
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
            </Box>
            {view === 'table' && (
                <Box className="app-content-tabpanel"
                     sx={{ px: 3, pt: 0, maxWidth: TABLE_WIDTH }}>
                    <DataGrid
                        rows={swarmStarts}
                        columns={columns}
                        getRowHeight={getRowHeight}
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
                <SwarmStartsStatsView rows={swarmStarts} />
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
