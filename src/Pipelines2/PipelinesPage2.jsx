// /swarm/pipelines2 — the Pipeline 2.0 plan-layer pipelines editor (req #3393).
//
// Stands BESIDE `/swarm/pipelines` (Darwin/src/SwarmView/pipelines/PipelinesPage.jsx),
// never in place of it — reads pipeline2_pipelines, imports nothing from that
// file or from any other 1.0 module. See PLAN.md for the full re-scope
// rationale (req #3393 was halted once for re-pointing the 1.0 routes at 2.0
// data in place, which broke every 1.0 consumer of those routes).
//
// One DataGrid, no cards/table view toggle — that machinery in 1.0's
// PipelinesPage.jsx exists to feed a plan VISUALIZER entry point
// (`/swarm/pipeline/:id`) that has no 2.0 equivalent yet. This page follows
// the plan-layer EDITOR shape `EpicsPage.jsx`/`StepsPage.jsx` already
// establish: one DataGrid, click-to-toggle chips, one dialog for the one
// multi-line field.
//
// No create button: pipelines are created via the MCP `create_pipeline2` tool
// by the Primary AI, matching 1.0's PipelinesPage.jsx, which carries no create
// control of its own either.
//
// `pipeline_status` renders as a DISPLAY-ONLY chip, not a click-to-cycle
// control — status transitions carry started_at/completed_at side effects
// (`_derive_timestamps2` in darwin-mcp/services/pipelines2.py) a naive
// click-to-cycle from this page would get wrong; that stays an MCP/Primary
// decision. `execution_mode` (parallel|serial, req #3388) is a genuine
// two-value toggle with no such side effects, so it is click-to-toggle here —
// the first UI anywhere, in either era, to expose that field at all.

import { useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import call_rest_api from '../RestApi/RestApi';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { useMachines } from '../hooks/useDataQueries';
import { useAllPipelines2, pipeline2Keys } from '../hooks/factory/devopsQueries2';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { formatDateTime } from '../utils/dateFormat';
import {
    pipelineStatus2ChipProps,
    executionModeChipProps,
    executionModeLabel,
} from './pipeline2ChipStyles';
import { updatePipeline2 } from './pipelines2Api';

// ── Editable pipeline description ────────────────────────────────────────
// Structural port of `PipelineDescriptionDialog`
// (Darwin/src/SwarmView/pipelines/PipelineDetail.jsx:139-259) — local draft +
// save-on-blur/close, the same `savedRef`/`inFlightRef` staleness guards —
// writing to `pipeline2_pipelines` instead of `pipelines`. Copied rather than
// imported/generalized: see devopsQueries2.js's header for why 2.0 code
// carries no import edge into any 1.0 file.
function Pipeline2DescriptionDialog({ pipeline, open, onClose }) {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore((s) => s.showError);
    const incoming = pipeline.description || '';
    const [draft, setDraft] = useState(incoming);
    const savedRef = useRef(incoming);
    const inFlightRef = useRef(null);

    // Adopt a server value that arrives or changes later, but only while the
    // field is clean — verbatim port of PipelineDescriptionDialog's adoption
    // effect (PipelineDetail.jsx:153-158).
    useEffect(() => {
        if (incoming === savedRef.current) return;
        if (draft !== savedRef.current) return;
        savedRef.current = incoming;
        setDraft(incoming);
    }, [incoming, draft]);

    const save = () => {
        const value = draft;
        if (value === (inFlightRef.current ?? savedRef.current)) return;
        inFlightRef.current = value;
        call_rest_api(`${darwinUri}/pipeline2_pipelines`, 'PUT',
            [{ id: pipeline.id, description: value }], idToken)
            .then((result) => {
                const code = result?.httpStatus?.httpStatus;
                if (code !== 200 && code !== 204) {
                    showError(result, 'Unable to update the pipeline description');
                } else {
                    savedRef.current = value;
                    queryClient.invalidateQueries({
                        queryKey: pipeline2Keys.all(profile?.userName) });
                }
            })
            .catch((error) => showError(error, 'Unable to update the pipeline description'))
            .finally(() => {
                if (inFlightRef.current === value) inFlightRef.current = null;
            });
    };

    const closeAndSave = () => {
        save();
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={closeAndSave}
            maxWidth="md"
            fullWidth
            disableScrollLock
            data-testid="pipeline2-description-dialog"
        >
            <DialogTitle>Description — {pipeline.title}</DialogTitle>
            <DialogContent dividers>
                <TextField
                    label="Description"
                    variant="outlined"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={save}
                    fullWidth
                    multiline
                    minRows={8}
                    maxRows={24}
                    autoComplete="off"
                    autoFocus
                    sx={{ mt: 1 }}
                    data-testid="pipeline2-goal"
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={closeAndSave} variant="outlined">Close</Button>
            </DialogActions>
        </Dialog>
    );
}

export default function PipelinesPage2() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore((s) => s.showError);

    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: pipelines = [], isLoading: pipelinesLoading } = useAllPipelines2(creatorFk);
    const { data: machines = [], isLoading: machinesLoading } = useMachines(creatorFk);

    const isLoading = pipelinesLoading || machinesLoading;

    const [descriptionTarget, setDescriptionTarget] = useState(null);

    const machineById = new Map(machines.map((m) => [m.id, m]));

    const invalidatePipelines = () =>
        queryClient.invalidateQueries({ queryKey: pipeline2Keys.all(creatorFk) });

    const toggleExecutionMode = async (row) => {
        try {
            await updatePipeline2(darwinUri, idToken, row.id,
                { execution_mode: row.execution_mode === 'serial' ? 'parallel' : 'serial' });
            invalidatePipelines();
        } catch (err) {
            showError(err, 'Could not change the plan execution mode');
        }
    };

    const columns = [
        { field: 'id', headerName: 'ID', width: 70 },
        { field: 'title', headerName: 'Pipeline', flex: 1, minWidth: 220 },
        {
            field: 'pipeline_status', headerName: 'Status', width: 120, sortable: false,
            renderCell: (params) => (
                <Chip
                    label={params.value}
                    size="small"
                    {...pipelineStatus2ChipProps(params.value)}
                    data-testid={`pipeline2-status-${params.row.id}`}
                />
            ),
        },
        {
            field: 'execution_mode', headerName: 'Execution', width: 130, sortable: false,
            renderCell: (params) => (
                <Tooltip title={params.value === 'serial'
                    ? 'Serial — one epic at a time, in sort_order. Click for Parallel.'
                    : 'Parallel — every epic runs at once. Click for Serial.'}>
                    <Chip
                        label={executionModeLabel(params.value)}
                        size="small"
                        {...executionModeChipProps(params.value)}
                        clickable
                        onClick={() => toggleExecutionMode(params.row)}
                        data-testid={`pipeline2-execmode-chip-${params.row.id}`}
                    />
                </Tooltip>
            ),
        },
        {
            field: 'machine_fk', headerName: 'Machine', width: 140,
            valueGetter: (_v, row) => (row.machine_fk == null
                ? '' : (machineById.get(row.machine_fk)?.title || `#${row.machine_fk}`)),
            valueFormatter: (value) => value || '—',
        },
        {
            field: 'started_at', headerName: 'Started', width: 150,
            valueFormatter: (value) => (value ? formatDateTime(value, timezone) : '—'),
        },
        {
            field: 'completed_at', headerName: 'Completed', width: 150,
            valueFormatter: (value) => (value ? formatDateTime(value, timezone) : '—'),
        },
        {
            field: 'description', headerName: '', width: 90, sortable: false,
            filterable: false, disableColumnMenu: true,
            renderCell: (params) => {
                const hasDescription = !!(params.row.description || '').trim();
                return (
                    <Tooltip title={hasDescription ? 'View / edit description' : 'Add a description'}>
                        <Button
                            size="small"
                            variant={hasDescription ? 'contained' : 'outlined'}
                            startIcon={<InfoOutlinedIcon fontSize="small" />}
                            onClick={() => setDescriptionTarget(params.row)}
                            data-testid={`pipeline2-description-btn-${params.row.id}`}
                        >
                            Goal
                        </Button>
                    </Tooltip>
                );
            },
        },
    ];

    return (
        <Box sx={{ gridArea: 'content', p: 3, width: '100%', overflow: 'auto' }}
             data-testid="pipelines2-page">
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                <Typography variant="h5">Pipelines 2.0</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}
                            data-testid="pipelines2-accounting">
                    {pipelines.length} pipeline{pipelines.length === 1 ? '' : 's'}
                </Typography>
            </Stack>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <Box sx={{ width: '100%' }} data-testid="pipelines2-datagrid">
                    <DataGrid
                        autoHeight
                        rows={pipelines}
                        columns={columns}
                        getRowId={(r) => r.id}
                        density="compact"
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{ toolbar: { showQuickFilter: true } }}
                        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                        pageSizeOptions={[10, 25, 50]}
                        disableRowSelectionOnClick
                        data-testid="pipelines2-grid"
                    />
                </Box>
            )}

            {descriptionTarget && (
                <Pipeline2DescriptionDialog
                    key={descriptionTarget.id}
                    pipeline={descriptionTarget}
                    open={!!descriptionTarget}
                    onClose={() => setDescriptionTarget(null)}
                />
            )}
        </Box>
    );
}
