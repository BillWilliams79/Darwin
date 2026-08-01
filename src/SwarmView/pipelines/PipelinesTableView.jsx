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
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { formatDateTime } from '../../utils/dateFormat';
import { pipelineStatusChipProps, PIPELINE_STATUS_VALUES } from './pipelineChipStyles';
import { machineTitle, pipelinesEmptyMessage } from './pipelineViewModel';
import { claimForPipeline, holderView } from './orchestrationHolder';

const EMPTY_SUMMARY = { total: 0, done: 0, running: 0, pending: 0 };

// Lifecycle order, not alphabetical — sorting a status column A→Z would put
// "aborted" above "active" and read as noise (table-design.md § custom sort).
const STATUS_ORDER = PIPELINE_STATUS_VALUES.reduce(
    (acc, v, i) => ({ ...acc, [v]: i }), {});

// req #3220 — the table view's own empty state, matching Cards: a status
// filter that hid every pipeline must say WHICH statuses it hid rather than
// falling through to the DataGrid's generic "No rows" placeholder.
function PipelinesNoRowsOverlay({ hiddenStatusCounts = [] }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%', p: 2 }}
             data-testid="pipelines-table-empty">
            <Typography variant="body2" color="text.secondary">
                {pipelinesEmptyMessage(hiddenStatusCounts)}
            </Typography>
        </Box>
    );
}

export default function PipelinesTableView({ pipelines, summaries, machines, claims = [],
    timezone, onOpen, hiddenStatusCounts = [] }) {
    const rows = useMemo(() => pipelines.map((p) => {
        const s = summaries.get(p.id) || EMPTY_SUMMARY;
        // req #3224 — the WHOLE-PLAN reservation only. An epic-scoped one is the
        // epics page's answer; showing it here would say a plan is orchestrated
        // when a slice of it is, which is a different and weaker claim.
        const holder = holderView(claimForPipeline(claims, p.id), machines);
        return {
            ...p,
            machine_label: machineTitle(p.machine_fk, machines),
            orchestrated_by: holder ? holder.label : '',
            orchestrated_title: holder ? holder.title : '',
            orchestrated_stale: holder ? holder.stale : false,
            step_count: s.total,
            done_count: s.done,
            running_count: s.running,
            pending_count: s.pending,
        };
    }), [pipelines, summaries, machines, claims]);

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
        {
            // req #3224 — WHO is orchestrating this plan, from WHERE. An empty
            // cell is a real answer ("nobody"), so it renders as an em-dash
            // rather than a chip nobody can read.
            field: 'orchestrated_by',
            headerName: 'Orchestrated by',
            width: 190,
            renderCell: (params) => (params.value ? (
                <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                    <Tooltip title={params.row.orchestrated_title}>
                        <Chip size="small" label={params.value}
                              color={params.row.orchestrated_stale ? 'warning' : 'success'}
                              variant={params.row.orchestrated_stale ? 'outlined' : 'filled'}
                              data-testid={`pipelines-holder-${params.row.id}`} />
                    </Tooltip>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', height: '100%',
                            color: 'text.secondary' }}>—</Box>
            )),
        },
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

    // The testid goes on a WRAPPING Box, not on <DataGrid> — MUI does not
    // forward unknown props to the grid root, so a `data-testid` handed to the
    // component simply never reaches the DOM and the registry entry named in
    // this file's header was unqueryable (found by the req #3118 E2E battery).
    // Same shape as RequirementsTableView / InstructionsTableView.
    return (
        <Box sx={{ width: '100%' }} data-testid="pipelines-datagrid">
            <DataGrid
                rows={rows}
                columns={columns}
                rowHeight={52}
                density="compact"
                slots={{ toolbar: GridToolbar, noRowsOverlay: PipelinesNoRowsOverlay }}
                slotProps={{
                    toolbar: { showQuickFilter: true },
                    noRowsOverlay: { hiddenStatusCounts },
                }}
                initialState={{
                    pagination: { paginationModel: { pageSize: 25 } },
                    sorting: { sortModel: [{ field: 'id', sort: 'desc' }] },
                }}
                pageSizeOptions={[25, 50, 100]}
                disableRowSelectionOnClick
                onRowClick={(params) => onOpen(params.row.id)}
                sx={{ cursor: 'pointer' }}
            />
        </Box>
    );
}
