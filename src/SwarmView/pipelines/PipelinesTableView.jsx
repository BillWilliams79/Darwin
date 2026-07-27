// PipelinesTableView.jsx — the Table half of /swarm/pipelines (req #3114).
//
// A real DataGrid per memory/table-design.md: compact density, fixed rowHeight,
// GridToolbar with quick filter, column widths sized to the widest realistic
// value, row click to the detail page. Registry entry: `pipelines-datagrid`.
//
// (The PLAN-ROWS table on the detail page is deliberately NOT a DataGrid — its
// order is computed and self-verified, so it must not be user-sortable. The
// reasoning is at the top of PipelinePlanTable.jsx.)

import { useMemo } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';

import { formatDateTime } from '../../utils/dateFormat';
import { pipelineStatusChipProps, PIPELINE_STATUS_VALUES } from './pipelineChipStyles';
import { machineTitle } from './pipelineViewModel';

const EMPTY_SUMMARY = { total: 0, done: 0, running: 0, pending: 0 };

// Lifecycle order, not alphabetical — sorting a status column A→Z would put
// "aborted" above "active" and read as noise (table-design.md § custom sort).
const STATUS_ORDER = PIPELINE_STATUS_VALUES.reduce(
    (acc, v, i) => ({ ...acc, [v]: i }), {});

export default function PipelinesTableView({ pipelines, summaries, machines, timezone, onOpen }) {
    const rows = useMemo(() => pipelines.map((p) => {
        const s = summaries.get(p.id) || EMPTY_SUMMARY;
        return {
            ...p,
            machine_label: machineTitle(p.machine_fk, machines),
            step_count: s.total,
            done_count: s.done,
            running_count: s.running,
            pending_count: s.pending,
        };
    }), [pipelines, summaries, machines]);

    const columns = useMemo(() => [
        { field: 'id', headerName: 'ID', width: 80, type: 'number' },
        {
            field: 'title',
            headerName: 'Pipeline',
            flex: 1,
            minWidth: 280,
        },
        {
            field: 'pipeline_status',
            headerName: 'Status',
            width: 120,
            sortComparator: (a, b) => (STATUS_ORDER[a] ?? 99) - (STATUS_ORDER[b] ?? 99),
            renderCell: (params) => (
                <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                    <Chip size="small" label={params.value}
                          {...pipelineStatusChipProps(params.value)}
                          data-testid={`pipelines-status-${params.row.id}`} />
                </Box>
            ),
        },
        { field: 'machine_label', headerName: 'Machine', width: 150 },
        { field: 'step_count', headerName: 'Steps', width: 90, type: 'number' },
        { field: 'done_count', headerName: 'Complete', width: 110, type: 'number' },
        { field: 'running_count', headerName: 'Running', width: 100, type: 'number' },
        { field: 'pending_count', headerName: 'Scheduled', width: 110, type: 'number' },
        {
            field: 'started_at',
            headerName: 'Started',
            width: 190,
            valueFormatter: (value) => (value ? formatDateTime(value, timezone) : '—'),
        },
        {
            field: 'completed_at',
            headerName: 'Completed',
            width: 190,
            valueFormatter: (value) => (value ? formatDateTime(value, timezone) : '—'),
        },
    ], [timezone]);

    return (
        <DataGrid
            rows={rows}
            columns={columns}
            rowHeight={52}
            density="compact"
            slots={{ toolbar: GridToolbar }}
            slotProps={{ toolbar: { showQuickFilter: true } }}
            initialState={{
                pagination: { paginationModel: { pageSize: 25 } },
                sorting: { sortModel: [{ field: 'id', sort: 'desc' }] },
            }}
            pageSizeOptions={[25, 50, 100]}
            disableRowSelectionOnClick
            onRowClick={(params) => onOpen(params.row.id)}
            sx={{ cursor: 'pointer' }}
            data-testid="pipelines-datagrid"
        />
    );
}
