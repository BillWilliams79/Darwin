// /swarm/swarm-undos — table of every /swarm-undo invocation (req #2719).
// One row per invocation; click a row to navigate to /swarm/swarm-undos/:id.
//
// Mirrors SwarmStartsPage in shape (DataGrid + GridToolbar + row-click drill).
// The unique columns are `reason` (user-provided "why") and the snapshot
// fields (task_name, branch, coordination_type, req_id_at_undo,
// swarm_start_fk_at_undo) which survive the cascading session delete that
// /swarm-undo performs immediately after recording the row.

import { useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import { useAllSwarmUndos } from '../hooks/useDataQueries';
import { formatDateTime } from '../utils/dateFormat';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

const TABLE_WIDTH = 1500;

const coordinationChipProps = (ct) => {
    switch (ct) {
        case 'discuss':     return { sx: { bgcolor: '#f48fb1', color: '#000' } };
        case 'planned':     return { sx: { bgcolor: '#90caf9', color: '#000' } };
        case 'implemented': return { sx: { bgcolor: '#a5d6a7', color: '#000' } };
        case 'deployed':    return { sx: { bgcolor: '#ce93d8', color: '#000' } };
        default:            return null;
    }
};

export default function SwarmUndosPage() {
    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: swarmUndos = [], isLoading } = useAllSwarmUndos(creatorFk);

    const columns = useMemo(() => [
        { field: 'id', headerName: 'ID', width: 70, type: 'number', display: 'flex' },
        {
            field: 'req_id_at_undo',
            headerName: 'Req',
            width: 90,
            type: 'number',
            display: 'flex',
            renderCell: (params) => params.value
                ? <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    #{params.value}
                  </Typography>
                : <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>,
        },
        {
            field: 'task_name',
            headerName: 'Task',
            width: 280,
            display: 'flex',
            renderCell: (params) => (
                <Tooltip title={params.value || '—'}>
                    <Typography variant="body2"
                                sx={{ fontFamily: 'monospace',
                                       overflow: 'hidden',
                                       textOverflow: 'ellipsis',
                                       whiteSpace: 'nowrap' }}
                                data-testid={`swarm-undo-task-${params.row.id}`}>
                        {params.value || <em>(none)</em>}
                    </Typography>
                </Tooltip>
            ),
        },
        {
            field: 'coordination_type',
            headerName: 'Coordination',
            width: 130,
            display: 'flex',
            renderCell: (params) => params.value
                ? <Chip label={params.value} size="small"
                        {...(coordinationChipProps(params.value) || {})}
                        sx={{ textTransform: 'capitalize',
                              ...((coordinationChipProps(params.value)?.sx) || {}) }} />
                : <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>,
        },
        {
            field: 'reason',
            headerName: 'Reason',
            width: 460,
            display: 'flex',
            renderCell: (params) => (
                <Tooltip title={params.value || ''}>
                    <Typography variant="body2"
                                sx={{ overflow: 'hidden',
                                       textOverflow: 'ellipsis',
                                       whiteSpace: 'nowrap' }}
                                data-testid={`swarm-undo-reason-${params.row.id}`}>
                        {params.value}
                    </Typography>
                </Tooltip>
            ),
        },
        {
            field: 'swarm_start_fk_at_undo',
            headerName: 'Start',
            width: 90,
            type: 'number',
            display: 'flex',
            renderCell: (params) => params.value
                ? <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    #{params.value}
                  </Typography>
                : <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>,
        },
        {
            field: 'undone_at',
            headerName: 'Undone',
            width: 200,
            display: 'flex',
            valueFormatter: (value) => value ? formatDateTime(value, timezone) : '—',
        },
        // Hidden by default; revealable via column-visibility toolbar.
        {
            field: 'branch',
            headerName: 'Branch',
            width: 320,
            display: 'flex',
            renderCell: (params) => (
                <Tooltip title={params.value || '—'}>
                    <Typography variant="body2"
                                sx={{ fontFamily: 'monospace',
                                       overflow: 'hidden',
                                       textOverflow: 'ellipsis',
                                       whiteSpace: 'nowrap' }}>
                        {params.value || <em>—</em>}
                    </Typography>
                </Tooltip>
            ),
        },
    ], [timezone]);

    const initialState = useMemo(() => ({
        pagination: { paginationModel: { pageSize: 25 } },
        sorting: { sortModel: [{ field: 'undone_at', sort: 'desc' }] },
        columns: {
            columnVisibilityModel: {
                branch: false,
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
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {swarmUndos.length} undo{swarmUndos.length === 1 ? '' : 's'} recorded — click a row for the full reason
                </Typography>
            </Box>
            <Box className="app-content-tabpanel"
                 sx={{ px: 3, pt: 0, maxWidth: TABLE_WIDTH }}>
                <DataGrid
                    rows={swarmUndos}
                    columns={columns}
                    density="compact"
                    slots={{ toolbar: GridToolbar }}
                    slotProps={{ toolbar: { showQuickFilter: true } }}
                    initialState={initialState}
                    pageSizeOptions={[25, 50, 100]}
                    onRowClick={(p) => navigate(`/swarm/swarm-undos/${p.row.id}`)}
                    sx={{ cursor: 'pointer' }}
                    data-testid="swarm-undos-datagrid"
                />
            </Box>
        </Box>
    );
}
