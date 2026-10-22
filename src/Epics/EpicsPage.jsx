// /swarm/epics — the plan-layer epics editor (req #3393).
//
// Stands BESIDE `/swarm/epics` (Darwin/src/Epics/EpicsPage.jsx), never in
// place of it, and shares no COMPONENT with it (structural copy). It DOES
// share the query layer and chip-style files (`useDataQueries.js`,
// `pipelineChipStyles.js`) — req #3463 established that additive-extension
// convention for this feature first, and this page follows it rather than a
// parallel copy. See PLAN.md for the full re-scope rationale.
//
// Shape follows EpicsPage.jsx exactly: one DataGrid, a click-to-toggle closed
// chip, create/edit through one dialog. Differences from the 1.0 page, all
// schema-driven:
//
//   - The dialog gains a Pipeline select (`pipeline_fk`, required at create,
//     DISABLED once editing — re-homing an epic is `move_epic`, an
//     MCP-only tool with cross-plan-edge checks this page does not
//     reproduce, matching StepsPage.jsx's identical rule for its own
//     `pipeline_fk` field).
//   - `epic_status` (active|paused) gets a click-to-toggle chip — genuinely
//     new UI: there is no pause/unpause control anywhere today, in either
//     era, only a derived bubble.
//   - No count column for the retired middle tier — 2.0 has no such tier
//     (containment goes straight epic -> step). A step_count column takes
//     its place, linking to
//     `/swarm/steps?epic=<id>`.
//   - No orchestration-claim "orchestrated by" badge — not in the
//     requirement's field matrix; left out deliberately rather than folded
//     in silently.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useContext } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import {
    useAllCategories,
    useAllPipelines,
    useAllEpics,
    useAllPipelineSteps,
    epicKeys,
    pipelineStepKeys,
} from '../hooks/useDataQueries';
import { pipelineComposeKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import ChipFilter from '../Components/ChipFilter/ChipFilter';
import { formatDate } from '../utils/dateFormat';
import {
    epicStatus2ChipProps, epicStatus2Label, lockedChipProps, lockedLabel,
} from '../SwarmView/pipelines/pipelineChipStyles';
import { updateEpic, deleteEpic } from './epicsApi';
import EpicEditDialog, { CATEGORY_FIELDS } from './EpicEditDialog';

const CLOSED_FILTER_OPTIONS = [
    { value: 'open', label: 'Open', chipProps: { color: 'success' } },
    { value: 'closed', label: 'Closed', chipProps: { color: 'default' } },
];

const oneLine = (value) => (value ? String(value).replace(/\s+/g, ' ').trim() : '');

export default function EpicsPage() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: pipelines = [], isLoading: pipelinesLoading } = useAllPipelines(creatorFk);
    const { data: epics = [], isLoading: epicsLoading } = useAllEpics(creatorFk);
    const { data: steps = [], isLoading: stepsLoading } = useAllPipelineSteps(creatorFk);
    const { data: categories = [], isLoading: categoriesLoading } =
        useAllCategories(creatorFk, { fields: CATEGORY_FIELDS });

    const isLoading = pipelinesLoading || epicsLoading || stepsLoading || categoriesLoading;

    const [closedFilter, setClosedFilter] = useState(['open']);
    const toggleClosedFilter = (value) => setClosedFilter(current => (
        current.includes(value)
            ? current.filter(v => v !== value)
            : [...current, value]
    ));

    // The editor dialog: `key` changes per open so the form seeds afresh.
    const [dialog, setDialog] = useState({ key: 0, open: false, epic: null });

    const stepCountByEpic = useMemo(() => {
        const m = {};
        for (const s of steps) {
            if (s.epic_fk == null) continue;
            m[s.epic_fk] = (m[s.epic_fk] || 0) + 1;
        }
        return m;
    }, [steps]);

    const pipelineById = useMemo(() => {
        const m = {};
        for (const p of pipelines) m[p.id] = p;
        return m;
    }, [pipelines]);

    const categoryById = useMemo(() => {
        const m = {};
        for (const c of categories) m[c.id] = c;
        return m;
    }, [categories]);

    // Plans in the same order PipelinesPage shows them (id:desc — newest first).
    const pipelineOptions = useMemo(() => pipelines.map(
        p => ({ id: p.id, title: p.title })), [pipelines]);

    const rows = useMemo(() => {
        const visible = epics.filter(e => (
            closedFilter.includes(e.closed ? 'closed' : 'open')
        ));
        return [...visible]
            .map(e => ({
                ...e,
                step_count: stepCountByEpic[e.id] || 0,
                pipeline_title: pipelineById[e.pipeline_fk]?.title
                    ?? (e.pipeline_fk != null ? `#${e.pipeline_fk}` : ''),
            }))
            .sort((a, b) => {
                const ao = a.sort_order == null ? Infinity : a.sort_order;
                const bo = b.sort_order == null ? Infinity : b.sort_order;
                return ao - bo || a.id - b.id;
            });
    }, [epics, closedFilter, stepCountByEpic, pipelineById]);

    // An epic write also invalidates the composed plan reads (req #3742), so a
    // plan open elsewhere — or opened next — never draws the pre-save epic.
    const invalidateEpics = () => {
        queryClient.invalidateQueries({ queryKey: epicKeys.all(creatorFk) });
        queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.all });
    };

    const openCreate = () => setDialog((d) => ({ key: d.key + 1, open: true, epic: null }));
    const openEdit = (row) => setDialog((d) => ({ key: d.key + 1, open: true, epic: row }));

    // Deep-link via ?id=<id>, matching EpicsPage.jsx's own contract.
    const autoOpenedIdRef = useRef(null);
    useEffect(() => {
        if (isLoading) return;
        const raw = searchParams.get('id');
        if (!raw || !/^\d+$/.test(raw.trim())) return;
        const targetId = Number(raw.trim());
        if (autoOpenedIdRef.current === targetId) return;
        const target = epics.find(e => e.id === targetId);
        if (!target) return;
        autoOpenedIdRef.current = targetId;
        openEdit(target);
        const next = new URLSearchParams(searchParams);
        next.delete('id');
        setSearchParams(next, { replace: true, state: location.state });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoading, epics, searchParams]);

    const toggleClosed = async (row) => {
        try {
            await updateEpic(darwinUri, idToken, row.id, { closed: row.closed ? 0 : 1 });
            invalidateEpics();
        } catch (err) {
            showError(err, 'Could not change epic status');
        }
    };

    const toggleEpicStatus = async (row) => {
        try {
            await updateEpic(darwinUri, idToken, row.id,
                { epic_status: row.epic_status === 'paused' ? 'active' : 'paused' });
            invalidateEpics();
        } catch (err) {
            showError(err, 'Could not change the epic pause state');
        }
    };

    // req #3649 — a locked epic freezes itself and its steps (gateway 423).
    const toggleLock = async (row) => {
        try {
            await updateEpic(darwinUri, idToken, row.id, { locked: row.locked ? 0 : 1 });
            invalidateEpics();
        } catch (err) {
            showError(err, 'Could not change the epic lock');
        }
    };

    const handleDelete = async (row) => {
        const count = row.step_count;
        const consequence = count
            ? ` Its ${count} step${count === 1 ? '' : 's'} will be deleted with it (a step never `
              + 'survives its epic — containment). This cannot be undone.'
            : ' This cannot be undone.';
        if (!window.confirm(`Delete epic "${row.title}"?${consequence}`)) return;
        try {
            await deleteEpic(darwinUri, idToken, row.id);
            invalidateEpics();
            // The epic's steps CASCADE away with it (when the delete succeeds),
            // so this page's own step_count read is stale until invalidated —
            // same rule StepsPage.jsx's handleDelete follows for its own
            // dependency/link caches after a cascading delete.
            queryClient.invalidateQueries({ queryKey: pipelineStepKeys.all(creatorFk) });
        } catch (err) {
            showError(err, 'Could not delete epic — if another step outside it depends on one '
                + 'of its steps, remove that dependency first');
        }
    };

    const columns = [
        { field: 'id', headerName: 'ID', width: 70 },
        { field: 'title', headerName: 'Epic', flex: 1, minWidth: 200 },
        {
            field: 'pipeline_title', headerName: 'Pipeline', width: 160,
            valueFormatter: (value) => value || '—',
        },
        {
            field: 'category_name', headerName: 'Category', width: 150,
            valueGetter: (_v, row) => categoryById[row.category_fk]?.category_name || '',
            renderCell: (params) => (
                <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                    <Chip label={params.value || '—'} size="small" variant="outlined"
                          sx={categoryById[params.row.category_fk]?.color
                              ? { borderColor: categoryById[params.row.category_fk].color }
                              : undefined} />
                </Box>
            ),
        },
        {
            field: 'description', headerName: 'Description', flex: 2, minWidth: 260,
            valueGetter: (value) => oneLine(value),
            valueFormatter: (value) => value || '—',
        },
        {
            field: 'step_count', headerName: 'Steps', width: 90, type: 'number',
            renderCell: (params) => (
                <Box
                    component="span"
                    role="link"
                    tabIndex={0}
                    aria-label={`Open the steps filed under ${params.row.title}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/swarm/steps?epic=${params.row.id}`);
                    }}
                    onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.stopPropagation();
                        navigate(`/swarm/steps?epic=${params.row.id}`);
                    }}
                    sx={{
                        cursor: 'pointer',
                        textDecoration: params.value > 0 ? 'underline' : 'none',
                        color: params.value > 0 ? 'primary.main' : 'text.secondary',
                    }}
                    data-testid={`epic2-steps-link-${params.row.id}`}
                >
                    {params.value}
                </Box>
            ),
        },
        {
            field: 'epic_status', headerName: 'Pause', width: 100, sortable: false,
            renderCell: (params) => (
                <Tooltip title={params.value === 'paused'
                    ? 'Paused — this epic\'s work will not swarm-start. Click to unpause.'
                    : 'Active — click to pause (stops this epic swarm-starting; everything '
                      + 'already running is untouched).'}>
                    <Chip
                        label={epicStatus2Label(params.value)}
                        size="small"
                        {...epicStatus2ChipProps(params.value)}
                        clickable
                        onClick={() => toggleEpicStatus(params.row)}
                        data-testid={`epic2-pause-chip-${params.row.id}`}
                    />
                </Tooltip>
            ),
        },
        {
            // req #3649 — the lock cascades: a locked epic freezes its steps.
            field: 'locked', headerName: 'Lock', width: 100, sortable: false,
            renderCell: (params) => (
                <Tooltip title={params.value
                    ? 'Locked — this epic and its steps are frozen as a record. Click to unlock.'
                    : 'Open — editable. Click to lock this epic and freeze its steps.'}>
                    <Chip
                        label={lockedLabel(params.value)}
                        size="small"
                        {...lockedChipProps(params.value)}
                        clickable
                        onClick={() => toggleLock(params.row)}
                        data-testid={`epic2-lock-chip-${params.row.id}`}
                    />
                </Tooltip>
            ),
        },
        {
            field: 'sort_order', headerName: 'Order', width: 90, type: 'number',
            valueFormatter: (value) => (value == null ? '—' : value),
        },
        {
            field: 'closed', headerName: 'Status', width: 110, sortable: false,
            renderCell: (params) => (
                <Chip
                    label={params.value ? 'Closed' : 'Open'}
                    size="small"
                    color={params.value ? 'default' : 'success'}
                    variant={params.value ? 'outlined' : 'filled'}
                    onClick={() => toggleClosed(params.row)}
                    clickable
                    data-testid={`epic2-toggle-closed-${params.row.id}`}
                />
            ),
        },
        {
            field: 'create_ts', headerName: 'Created', width: 120,
            valueFormatter: (value) => formatDate(value, timezone),
        },
        {
            field: 'actions', headerName: '', width: 100, sortable: false,
            filterable: false, disableColumnMenu: true,
            renderCell: (params) => (
                <Stack direction="row" spacing={0.5}>
                    <Tooltip title="Edit">
                        <IconButton size="small"
                                    data-testid={`epic2-edit-${params.row.id}`}
                                    onClick={(e) => { e.stopPropagation(); openEdit(params.row); }}>
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                        <IconButton size="small"
                                    data-testid={`epic2-delete-${params.row.id}`}
                                    onClick={(e) => { e.stopPropagation(); handleDelete(params.row); }}>
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Stack>
            ),
        },
    ];

    return (
        <Box sx={{ gridArea: 'content', p: 3, width: '100%', overflow: 'auto' }}
             data-testid="epics-page">
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                <Typography variant="h5">Epics</Typography>
                <ChipFilter
                    options={CLOSED_FILTER_OPTIONS}
                    selected={closedFilter}
                    onToggle={toggleClosedFilter}
                    testId="epics-closed-filter"
                    chipTestIdPrefix="epics-closed-chip"
                />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}
                            data-testid="epics-accounting">
                    {rows.length} of {epics.length} epic{epics.length === 1 ? '' : 's'}
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}
                        disabled={!pipelineOptions.length}
                        data-testid="epic2-add">
                    New Epic
                </Button>
            </Stack>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <Box sx={{ width: '100%' }} data-testid="epics-datagrid">
                    <DataGrid
                        autoHeight
                        rows={rows}
                        columns={columns}
                        getRowId={(r) => r.id}
                        density="compact"
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{ toolbar: { showQuickFilter: true } }}
                        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                        pageSizeOptions={[10, 25, 50]}
                        disableRowSelectionOnClick
                        data-testid="epics-grid"
                    />
                </Box>
            )}

            {/* req #3742 — the shared epic editor; the plan canvas opens the
                same one over itself when an epic's name is clicked. */}
            <EpicEditDialog
                key={dialog.key}
                open={dialog.open}
                epic={dialog.epic}
                pipelineOptions={pipelineOptions}
                onClose={() => setDialog((d) => ({ ...d, open: false }))}
                onSaved={invalidateEpics}
            />
        </Box>
    );
}
