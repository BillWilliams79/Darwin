// /swarm/initiatives — the plan-layer initiatives editor (req #3393).
//
// Stands BESIDE `/swarm/initiatives` (Darwin/src/Initiatives/InitiativesPage.jsx), never in
// place of it, and shares no COMPONENT with it (structural copy). It DOES
// share the query layer and chip-style files (`useDataQueries.js`,
// `pipelineChipStyles.js`) — req #3463 established that additive-extension
// convention for this feature first, and this page follows it rather than a
// parallel copy. See PLAN.md for the full re-scope rationale.
//
// Shape follows InitiativesPage.jsx exactly: one DataGrid, a click-to-toggle closed
// chip, create/edit through one dialog. Differences from the 1.0 page, all
// schema-driven:
//
//   - The dialog gains a Pipeline select (`pipeline_fk`, required at create,
//     DISABLED once editing — re-homing an initiative is `move_initiative`, an
//     MCP-only tool with cross-plan-edge checks this page does not
//     reproduce, matching EpicsPage.jsx's identical rule for its own
//     `pipeline_fk` field).
//   - `initiative_status` (active|paused) gets a click-to-toggle chip — genuinely
//     new UI: there is no pause/unpause control anywhere today, in either
//     era, only a derived bubble.
//   - No count column for the retired middle tier — 2.0 has no such tier
//     (containment goes straight initiative -> epic). An epic_count column takes
//     its place, linking to
//     `/swarm/epics?initiative=<id>`.
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
    useAllInitiatives,
    useAllPipelineEpics,
    initiativeKeys,
    pipelineEpicKeys,
} from '../hooks/useDataQueries';
import { pipelineComposeKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import ChipFilter from '../Components/ChipFilter/ChipFilter';
import { formatDate } from '../utils/dateFormat';
import {
    initiativeStatus2ChipProps, initiativeStatus2Label, lockedChipProps, lockedLabel,
} from '../SwarmView/pipelines/pipelineChipStyles';
import { updateInitiative, deleteInitiative } from './initiativesApi';
import InitiativeEditDialog, { CATEGORY_FIELDS } from './InitiativeEditDialog';

const CLOSED_FILTER_OPTIONS = [
    { value: 'open', label: 'Open', chipProps: { color: 'success' } },
    { value: 'closed', label: 'Closed', chipProps: { color: 'default' } },
];

const oneLine = (value) => (value ? String(value).replace(/\s+/g, ' ').trim() : '');

export default function InitiativesPage() {
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
    const { data: initiatives = [], isLoading: initiativesLoading } = useAllInitiatives(creatorFk);
    const { data: epics = [], isLoading: epicsLoading } = useAllPipelineEpics(creatorFk);
    const { data: categories = [], isLoading: categoriesLoading } =
        useAllCategories(creatorFk, { fields: CATEGORY_FIELDS });

    const isLoading = pipelinesLoading || initiativesLoading || epicsLoading || categoriesLoading;

    const [closedFilter, setClosedFilter] = useState(['open']);
    const toggleClosedFilter = (value) => setClosedFilter(current => (
        current.includes(value)
            ? current.filter(v => v !== value)
            : [...current, value]
    ));

    // The editor dialog: `key` changes per open so the form seeds afresh.
    const [dialog, setDialog] = useState({ key: 0, open: false, initiative: null });

    const epicCountByInitiative = useMemo(() => {
        const m = {};
        for (const s of epics) {
            if (s.initiative_fk == null) continue;
            m[s.initiative_fk] = (m[s.initiative_fk] || 0) + 1;
        }
        return m;
    }, [epics]);

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
        const visible = initiatives.filter(e => (
            closedFilter.includes(e.closed ? 'closed' : 'open')
        ));
        return [...visible]
            .map(e => ({
                ...e,
                epic_count: epicCountByInitiative[e.id] || 0,
                pipeline_title: pipelineById[e.pipeline_fk]?.title
                    ?? (e.pipeline_fk != null ? `#${e.pipeline_fk}` : ''),
            }))
            .sort((a, b) => {
                const ao = a.sort_order == null ? Infinity : a.sort_order;
                const bo = b.sort_order == null ? Infinity : b.sort_order;
                return ao - bo || a.id - b.id;
            });
    }, [initiatives, closedFilter, epicCountByInitiative, pipelineById]);

    // An initiative write also invalidates the composed plan reads (req #3742), so a
    // plan open elsewhere — or opened next — never draws the pre-save initiative.
    const invalidateInitiatives = () => {
        queryClient.invalidateQueries({ queryKey: initiativeKeys.all(creatorFk) });
        queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.all });
    };

    const openCreate = () => setDialog((d) => ({ key: d.key + 1, open: true, initiative: null }));
    const openEdit = (row) => setDialog((d) => ({ key: d.key + 1, open: true, initiative: row }));

    // Deep-link via ?id=<id>, matching InitiativesPage.jsx's own contract.
    const autoOpenedIdRef = useRef(null);
    useEffect(() => {
        if (isLoading) return;
        const raw = searchParams.get('id');
        if (!raw || !/^\d+$/.test(raw.trim())) return;
        const targetId = Number(raw.trim());
        if (autoOpenedIdRef.current === targetId) return;
        const target = initiatives.find(e => e.id === targetId);
        if (!target) return;
        autoOpenedIdRef.current = targetId;
        openEdit(target);
        const next = new URLSearchParams(searchParams);
        next.delete('id');
        setSearchParams(next, { replace: true, state: location.state });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoading, initiatives, searchParams]);

    const toggleClosed = async (row) => {
        try {
            await updateInitiative(darwinUri, idToken, row.id, { closed: row.closed ? 0 : 1 });
            invalidateInitiatives();
        } catch (err) {
            showError(err, 'Could not change initiative status');
        }
    };

    const toggleInitiativeStatus = async (row) => {
        try {
            await updateInitiative(darwinUri, idToken, row.id,
                { initiative_status: row.initiative_status === 'paused' ? 'active' : 'paused' });
            invalidateInitiatives();
        } catch (err) {
            showError(err, 'Could not change the initiative pause state');
        }
    };

    // req #3649 — a locked initiative freezes itself and its epics (gateway 423).
    const toggleLock = async (row) => {
        try {
            await updateInitiative(darwinUri, idToken, row.id, { locked: row.locked ? 0 : 1 });
            invalidateInitiatives();
        } catch (err) {
            showError(err, 'Could not change the initiative lock');
        }
    };

    const handleDelete = async (row) => {
        const count = row.epic_count;
        const consequence = count
            ? ` Its ${count} epic${count === 1 ? '' : 's'} will be deleted with it (an epic never `
              + 'survives its initiative — containment). This cannot be undone.'
            : ' This cannot be undone.';
        if (!window.confirm(`Delete initiative "${row.title}"?${consequence}`)) return;
        try {
            await deleteInitiative(darwinUri, idToken, row.id);
            invalidateInitiatives();
            // The initiative's epics CASCADE away with it (when the delete succeeds),
            // so this page's own epic_count read is stale until invalidated —
            // same rule EpicsPage.jsx's handleDelete follows for its own
            // dependency/link caches after a cascading delete.
            queryClient.invalidateQueries({ queryKey: pipelineEpicKeys.all(creatorFk) });
        } catch (err) {
            showError(err, 'Could not delete initiative — if another epic outside it depends on one '
                + 'of its epics, remove that dependency first');
        }
    };

    const columns = [
        { field: 'id', headerName: 'ID', width: 70 },
        { field: 'title', headerName: 'Initiative', flex: 1, minWidth: 200 },
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
            field: 'epic_count', headerName: 'Epics', width: 90, type: 'number',
            renderCell: (params) => (
                <Box
                    component="span"
                    role="link"
                    tabIndex={0}
                    aria-label={`Open the epics filed under ${params.row.title}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/swarm/epics?initiative=${params.row.id}`);
                    }}
                    onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.stopPropagation();
                        navigate(`/swarm/epics?initiative=${params.row.id}`);
                    }}
                    sx={{
                        cursor: 'pointer',
                        textDecoration: params.value > 0 ? 'underline' : 'none',
                        color: params.value > 0 ? 'primary.main' : 'text.secondary',
                    }}
                    data-testid={`initiative-epics-link-${params.row.id}`}
                >
                    {params.value}
                </Box>
            ),
        },
        {
            field: 'initiative_status', headerName: 'Pause', width: 100, sortable: false,
            renderCell: (params) => (
                <Tooltip title={params.value === 'paused'
                    ? 'Paused — this initiative\'s work will not swarm-start. Click to unpause.'
                    : 'Active — click to pause (stops this initiative swarm-starting; everything '
                      + 'already running is untouched).'}>
                    <Chip
                        label={initiativeStatus2Label(params.value)}
                        size="small"
                        {...initiativeStatus2ChipProps(params.value)}
                        clickable
                        onClick={() => toggleInitiativeStatus(params.row)}
                        data-testid={`initiative-pause-chip-${params.row.id}`}
                    />
                </Tooltip>
            ),
        },
        {
            // req #3649 — the lock cascades: a locked initiative freezes its epics.
            field: 'locked', headerName: 'Lock', width: 100, sortable: false,
            renderCell: (params) => (
                <Tooltip title={params.value
                    ? 'Locked — this initiative and its epics are frozen as a record. Click to unlock.'
                    : 'Open — editable. Click to lock this initiative and freeze its epics.'}>
                    <Chip
                        label={lockedLabel(params.value)}
                        size="small"
                        {...lockedChipProps(params.value)}
                        clickable
                        onClick={() => toggleLock(params.row)}
                        data-testid={`initiative-lock-chip-${params.row.id}`}
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
                    data-testid={`initiative-toggle-closed-${params.row.id}`}
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
                                    data-testid={`initiative-edit-${params.row.id}`}
                                    onClick={(e) => { e.stopPropagation(); openEdit(params.row); }}>
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                        <IconButton size="small"
                                    data-testid={`initiative-delete-${params.row.id}`}
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
             data-testid="initiatives-page">
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                <Typography variant="h5">Initiatives</Typography>
                <ChipFilter
                    options={CLOSED_FILTER_OPTIONS}
                    selected={closedFilter}
                    onToggle={toggleClosedFilter}
                    testId="initiatives-closed-filter"
                    chipTestIdPrefix="initiatives-closed-chip"
                />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}
                            data-testid="initiatives-accounting">
                    {rows.length} of {initiatives.length} initiative{initiatives.length === 1 ? '' : 's'}
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}
                        disabled={!pipelineOptions.length}
                        data-testid="initiative-add">
                    New Initiative
                </Button>
            </Stack>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <Box sx={{ width: '100%' }} data-testid="initiatives-datagrid">
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
                        data-testid="initiatives-grid"
                    />
                </Box>
            )}

            {/* req #3742 — the shared initiative editor; the plan canvas opens the
                same one over itself when an initiative's name is clicked. */}
            <InitiativeEditDialog
                key={dialog.key}
                open={dialog.open}
                initiative={dialog.initiative}
                pipelineOptions={pipelineOptions}
                onClose={() => setDialog((d) => ({ ...d, open: false }))}
                onSaved={invalidateInitiatives}
            />
        </Box>
    );
}
