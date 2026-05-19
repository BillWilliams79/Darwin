// /swarm/agents — table of every agent (req #2496 Agents 2.0).
// Click a row to navigate to /swarm/agents/:id (single-agent editor).
//
// Row source of truth is the .md file in `.claude/agents/<name>.md` in the
// worktree; the DB row is a cached projection synced via
// `scripts/agents/sync-agents-from-files.sh`. Edits saved in the UI write to
// the DB; reconciliation back to the file is a follow-up (see PLAN.md).

import { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import { useAllAgents } from '../hooks/useDataQueries';
import { formatDateTime } from '../utils/dateFormat';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

const TABLE_WIDTH = 1400;

const splitTools = (csv) => (csv || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

export default function AgentsPage() {
    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: agents = [], isLoading } = useAllAgents(creatorFk);

    const columns = useMemo(() => [
        { field: 'darwin_id', headerName: 'ID', width: 80, type: 'number' },
        {
            field: 'name',
            headerName: 'Name',
            width: 220,
            renderCell: (params) => (
                <Typography variant="body2"
                            sx={{ fontFamily: 'monospace' }}
                            data-testid={`agent-name-${params.row.id}`}>
                    {params.value}
                </Typography>
            ),
        },
        { field: 'model', headerName: 'Model', width: 180 },
        {
            field: 'tools_csv',
            headerName: 'Tools',
            width: 260,
            renderCell: (params) => (
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    {splitTools(params.value).map(t => (
                        <Chip key={t} label={t} size="small" variant="outlined"
                              sx={{ height: 20 }} />
                    ))}
                </Stack>
            ),
        },
        {
            field: 'description',
            headerName: 'Description',
            flex: 1,
            minWidth: 240,
            renderCell: (params) => (
                <Tooltip title={params.value || ''}>
                    <Typography variant="body2"
                                sx={{ overflow: 'hidden',
                                       textOverflow: 'ellipsis',
                                       whiteSpace: 'nowrap' }}>
                        {params.value || <em>—</em>}
                    </Typography>
                </Tooltip>
            ),
        },
        {
            field: 'update_ts',
            headerName: 'Updated',
            width: 180,
            valueFormatter: (value) => value ? formatDateTime(value, timezone) : '—',
        },
    ], [timezone]);

    const initialState = useMemo(() => ({
        pagination: { paginationModel: { pageSize: 25 } },
        sorting: { sortModel: [{ field: 'name', sort: 'asc' }] },
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
                <Box sx={{ flexGrow: 1 }} />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {agents.length} agent{agents.length === 1 ? '' : 's'} — click a row to view/edit
                </Typography>
            </Box>
            <Box className="app-content-tabpanel"
                 sx={{ px: 3, pt: 0, maxWidth: TABLE_WIDTH }}>
                <DataGrid
                    rows={agents}
                    columns={columns}
                    rowHeight={52}
                    density="compact"
                    slots={{ toolbar: GridToolbar }}
                    slotProps={{ toolbar: { showQuickFilter: true } }}
                    initialState={initialState}
                    pageSizeOptions={[25, 50, 100]}
                    onRowClick={(p) => navigate(`/swarm/agents/${p.row.id}`)}
                    sx={{ cursor: 'pointer' }}
                    data-testid="agents-datagrid"
                />
            </Box>
        </Box>
    );
}
