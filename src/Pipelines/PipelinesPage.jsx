// /swarm/pipelines — the plan-layer pipelines editor (req #3393).
//
// Renders at the route `planListRoutePath()`
// registers in index.jsx — it supersedes that requirement's deliberately-thin
// `PipelinesPage.jsx` placeholder, exactly as that file's own header
// anticipated ("either where they land or it is deleted in favour of the page
// that has them"). Never touches `/swarm/pipelines` (1.0) or its component.
//
// Cards + Table, like 1.0's PipelinesPage.jsx — the Cards/Table toggle, the
// status filter, and browsing the plan set were the pieces missing after the
// first pass (found in manual review): this page IS the 2.0 producer
// `/swarm/pipeline/:id` (the visualizer, req #3463/#3372) needs to be
// reachable from, so it has to be a real browsing surface, not just an
// editor grid. Table view is that editor grid (execution_mode toggle,
// description dialog) — Cards view is `PipelinesCardsView.jsx`, a new file
// adapted from `PipelineCardsView.jsx`.
//
// No create button: pipelines are created via the MCP `create_pipeline` tool
// by the Primary AI, matching 1.0's PipelinesPage.jsx, which carries no create
// control of its own either.
//
// `pipeline_status` renders as a DISPLAY-ONLY chip, not a click-to-cycle
// control — status transitions carry started_at/completed_at side effects
// (`_derive_timestamps2` in darwin-mcp/services/pipelines2.py) a naive
// click-to-cycle from this page would get wrong; that stays an MCP/Primary
// decision. `execution_mode` (parallel|serial, req #3388) is a genuine
// two-value toggle with no such side effects, so it is click-to-toggle here.
//
// Query layer, chip styles, orchestration-holder and the plan-place memory
// are the SHARED files (`useDataQueries.js`, `pipelineChipStyles.js`,
// `orchestrationHolder.js`, `pipelinePlace.js`) rather than parallel copies —
// req #3463 established that additive-extension convention first, and this
// page follows it. `pipelinesViewModel.js` is the one genuinely NEW model
// here: the done/open summary and the requirement met/total counts, neither
// of which needs (or fabricates) the unverified 1.0 derivation engine — see
// that file's header.
//
// NOT ported: the "resume to the plan I was last reading" auto-redirect
// PipelinesPage.jsx performs on mount. That is real complexity (four
// conditions, a settle effect, a monotonic ref) built for a list a reader
// returns to daily; the 2.0 list has a handful of rows today. This page DOES
// read the shared last-viewed mark (`readPipelinePlace`) to highlight the
// card, since `PipelineDetail.jsx` already writes it on arrival for both
// eras — it just does not redirect on it.

import { useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import call_rest_api from '../RestApi/RestApi';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import {
    useMachines,
    useAllPipelines,
    pipelineKeys,
    useAllEpics,
    useAllPipelineSteps,
    useAllPipelineStepRequirements,
    useAllRequirements,
    useOrchestrationClaims,
} from '../hooks/useDataQueries';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useViewPreference } from '../hooks/useViewPreference';
import normalizeView from '../Components/ViewerHeader/normalizeView';
import ViewerHeader from '../Components/ViewerHeader/ViewerHeader';
import ChipFilter from '../Components/ChipFilter';
import { formatDateTime } from '../utils/dateFormat';
import {
    pipelineStatusChipProps,
    executionModeChipProps,
    executionModeLabel,
    PIPELINE_STATUS_VALUES,
} from '../SwarmView/pipelines/pipelineChipStyles';
import {
    hiddenPipelineStatusCounts,
    REQ_COUNTS_STORAGE_KEY,
    DEFAULT_REQ_COUNTS,
} from '../SwarmView/pipelines/pipelineViewModel';
// req #3463/#3372 built the reachable 2.0 visualizer at
// planDetailPath(id). This list is that visualizer's PRODUCER
// (the whole reason it was safe to ship) — a row here has to open it, or the
// producer/consumer pair is only reachable by hand-typing a URL.
import { planDetailPath } from '../SwarmView/pipelines/planEra';
import { readPipelinePlace, prunePipelineStorage } from '../SwarmView/pipelines/pipelinePlace';
import { pipelineSummaries, pipelineRequirementCounts } from './pipelinesViewModel';
import PipelinesCardsView from './PipelinesCardsView';
import { updatePipeline } from './pipelinesApi';

// req #3356 — the `2` is out of both keys now that there is one plan list.
// Dropping it ORPHANS the two stored preferences rather than migrating them, so
// on first load after this ships a reader's view choice (Cards vs Table) and
// status filter fall back to their defaults, once. That is the same call
// `PIPELINE_PLACE_SCHEMA_VERSION` and the plan storage namespace make, and for
// the same reason: a migration branch for a view preference lives forever, and
// re-establishing it costs one click.
const VIEW_STORAGE_KEY = 'darwin-swarm-pipelines-view';
const STATUS_FILTER_STORAGE_KEY = 'darwin-swarm-pipelines-status-filter';

const VIEWS = [
    { value: 'cards', label: 'Cards view', icon: ViewModuleIcon },
    { value: 'table', label: 'Table view', icon: TableChartIcon },
];

const DEFAULT_PIPELINE_STATUSES = ['draft', 'active', 'paused'];

// `description` is NOT in `pipelines`' own defaultFields (devopsQueries.js
// deliberately keeps req #3463's id-producer index light) — this page both
// RENDERS and EDITS the description, so it must ask for it explicitly. Code
// review (req #3393): without this, every row arrived with
// `description === undefined`, the Goal dialog opened EMPTY over a real goal,
// and the first save silently overwrote it — a real data-loss path, confirmed
// against production plan 7's 454-character description. Own cache entry
// (`pipelines` has `fieldsInKey: true`), so this does not collide with req
// #3463's own narrower read of the same table.
const PIPELINES_FIELDS = 'id,title,description,pipeline_status,execution_mode,'
    + 'machine_fk,started_at,completed_at,creator_fk,create_ts,update_ts';

const pipelineStatusOptions = PIPELINE_STATUS_VALUES.map((status) => ({
    value: status,
    label: status,
    chipProps: pipelineStatusChipProps(status),
}));

function readStoredStatusFilter() {
    try {
        const raw = sessionStorage.getItem(STATUS_FILTER_STORAGE_KEY);
        if (raw == null) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed.filter((v) => PIPELINE_STATUS_VALUES.includes(v));
    } catch {
        return null;
    }
}

function writeStoredStatusFilter(statuses) {
    try {
        sessionStorage.setItem(STATUS_FILTER_STORAGE_KEY, JSON.stringify(statuses));
    } catch {
        // Safari private mode / quota exceeded — in-memory state still updates.
    }
}

// ── Editable pipeline description ────────────────────────────────────────
// Structural port of `PipelineDescriptionDialog`
// (Darwin/src/SwarmView/pipelines/PipelineDetail.jsx:139-259) — local draft +
// save-on-blur/close, the same `savedRef`/`inFlightRef` staleness guards —
// writing to `pipelines` instead of `pipelines`. Copied rather than
// imported/generalized: see pipelinesViewModel.js's header for why this stays
// a structural copy rather than an import.
function PipelineDescriptionDialog({ pipeline, open, onClose }) {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore((s) => s.showError);
    const incoming = pipeline.description || '';
    const [draft, setDraft] = useState(incoming);
    const savedRef = useRef(incoming);
    const inFlightRef = useRef(null);

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
        call_rest_api(`${darwinUri}/pipelines`, 'PUT',
            [{ id: pipeline.id, description: value }], idToken)
            .then((result) => {
                const code = result?.httpStatus?.httpStatus;
                if (code !== 200 && code !== 204) {
                    showError(result, 'Unable to update the pipeline description');
                } else {
                    savedRef.current = value;
                    queryClient.invalidateQueries({
                        queryKey: pipelineKeys.all(profile?.userName) });
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
            data-testid="pipelines-description-dialog"
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
                    data-testid="pipelines-goal"
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={closeAndSave} variant="outlined">Close</Button>
            </DialogActions>
        </Dialog>
    );
}

export default function PipelinesPage() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore((s) => s.showError);
    const navigate = useNavigate();

    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const [view, setView] = useViewPreference(VIEW_STORAGE_KEY, 'cards');
    const activeView = normalizeView(view, VIEWS);
    const [showReqCountsPref] = useViewPreference(REQ_COUNTS_STORAGE_KEY, DEFAULT_REQ_COUNTS);
    const showReqCounts = showReqCountsPref === 'on';

    const [statusFilter, setStatusFilter] = useState(
        () => readStoredStatusFilter() || DEFAULT_PIPELINE_STATUSES);
    const toggleStatus = (status) => setStatusFilter((current) => {
        const next = current.includes(status)
            ? current.filter((s) => s !== status)
            : [...current, status];
        writeStoredStatusFilter(next);
        return next;
    });

    // The remembered "last plan opened" mark — read ONCE, ONLY when it names
    // a 2.0 plan (the record is shared with 1.0 and holds one era at a time;
    // see this file's header and pipelinePlace.js's own doc on why a v1/wrong
    // -era record is dropped rather than guessed at).
    const [lastOpenedId] = useState(() => {
        const place = readPipelinePlace();
        return place?.pipelineId ?? null;
    });

    const open = (id) => {
        const to = planDetailPath(id);
        if (to) navigate(to);
    };

    const { data: pipelines = [], isLoading: pipelinesLoading } =
        useAllPipelines(creatorFk, { fields: PIPELINES_FIELDS });

    // The orphan sweep for per-plan camera/scroll storage (viewportMemory.js
    // keys keyed by plan id) had no caller anywhere in `src/` after the 1.0
    // list page — its only caller — was deleted (code review, req #3356):
    // every camera and scroll offset for every plan ever opened, including
    // deleted ones, would otherwise accumulate in localStorage for the life
    // of the browser profile. This page is the natural home — it already
    // fetches the live id set on every mount, which is exactly what the
    // prune needs to tell a live plan from an orphan.
    useEffect(() => {
        if (pipelinesLoading) return;
        prunePipelineStorage(pipelines.map((p) => p.id));
    }, [pipelinesLoading, pipelines]);
    const { data: machines = [], isLoading: machinesLoading } = useMachines(creatorFk);
    const { data: epics = [], isLoading: epicsLoading, isError: epicsError } =
        useAllEpics(creatorFk);
    const { data: steps = [], isLoading: stepsLoading, isError: stepsError } =
        useAllPipelineSteps(creatorFk);
    const { data: stepRequirements = [], isLoading: linksLoading } =
        useAllPipelineStepRequirements(creatorFk);
    // `id,requirement_status` is enough for the met/total counts — see
    // pipelinesViewModel.js. A narrower projection than 1.0's PLAN_REQUIREMENT_FIELDS
    // on purpose: this page derives no step state from it, only a stored-status tally.
    const { data: requirements = [], isLoading: reqsLoading } =
        useAllRequirements(creatorFk, { fields: 'id,requirement_status' });
    const { data: orchestrationClaims = [] } = useOrchestrationClaims(creatorFk);

    const isLoading = pipelinesLoading || machinesLoading || epicsLoading
        || stepsLoading || linksLoading || reqsLoading;

    // A step's PLAN is reachable only through its epic (containment — no
    // `pipeline_fk` column on pipeline_steps), so a failed epics OR steps
    // read does not just blank one column, it zeroes every card's step
    // count, progress bar and requirement tally — indistinguishable from a
    // genuinely empty plan (code review, req #3393; StepsPage.jsx draws the
    // identical distinction for the same underlying reason).
    const planDataError = epicsError || stepsError;
    const failedReadsText = [epicsError && 'epics', stepsError && 'steps']
        .filter(Boolean).join(' and ');

    const [descriptionTarget, setDescriptionTarget] = useState(null);

    const machineById = new Map(machines.map((m) => [m.id, m]));

    const summaries = pipelineSummaries({ pipelines, steps, epics });
    const reqCounts = pipelineRequirementCounts({
        pipelines, steps, epics, stepRequirements, requirements });

    const filtered = pipelines.filter((p) => statusFilter.includes(p.pipeline_status));
    const hiddenStatusCounts = hiddenPipelineStatusCounts(pipelines, statusFilter);

    const invalidatePipelines = () =>
        queryClient.invalidateQueries({ queryKey: pipelineKeys.all(creatorFk) });

    const toggleExecutionMode = async (row) => {
        try {
            await updatePipeline(darwinUri, idToken, row.id,
                { execution_mode: row.execution_mode === 'serial' ? 'parallel' : 'serial' });
            invalidatePipelines();
        } catch (err) {
            showError(err, 'Could not change the plan execution mode');
        }
    };

    const columns = [
        { field: 'id', headerName: 'ID', width: 70 },
        {
            field: 'title', headerName: 'Pipeline', flex: 1, minWidth: 220,
            renderCell: (params) => (
                <Tooltip title="Open this plan's visualizer">
                    <Box
                        component="span"
                        role="link"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); open(params.row.id); }}
                        onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            e.stopPropagation();
                            open(params.row.id);
                        }}
                        sx={{ cursor: 'pointer', color: 'primary.main', textDecoration: 'underline' }}
                        data-testid={`pipelines-open-title-${params.row.id}`}
                    >
                        {params.value}
                    </Box>
                </Tooltip>
            ),
        },
        {
            field: 'pipeline_status', headerName: 'Status', width: 120, sortable: false,
            renderCell: (params) => (
                <Chip
                    label={params.value}
                    size="small"
                    {...pipelineStatusChipProps(params.value)}
                    data-testid={`pipelines-status-${params.row.id}`}
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
                        onClick={(e) => { e.stopPropagation(); toggleExecutionMode(params.row); }}
                        data-testid={`pipelines-execmode-chip-${params.row.id}`}
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
                            onClick={(e) => { e.stopPropagation(); setDescriptionTarget(params.row); }}
                            data-testid={`pipelines-description-btn-${params.row.id}`}
                        >
                            Goal
                        </Button>
                    </Tooltip>
                );
            },
        },
        {
            field: 'open', headerName: '', width: 60, sortable: false,
            filterable: false, disableColumnMenu: true,
            renderCell: (params) => (
                <Tooltip title="Open plan">
                    <IconButton size="small"
                                onClick={(e) => { e.stopPropagation(); open(params.row.id); }}
                                data-testid={`pipelines-open-${params.row.id}`}>
                        <OpenInNewIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            ),
        },
    ];

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box className="app-content-planpage" data-testid="pipelines-page">
            <Box className="app-content-view-toggle" sx={{ mt: 3, px: 3 }}>
                <ViewerHeader
                    title="Pipelines"
                    views={VIEWS}
                    view={activeView}
                    onViewChange={setView}
                    testIdPrefix="pipelines"
                    filters={
                        <ChipFilter
                            options={pipelineStatusOptions}
                            selected={statusFilter}
                            onToggle={toggleStatus}
                            testId="pipelines-status-filter"
                            chipTestIdPrefix="pipelines-status-chip"
                        />
                    }
                    accounting={<>
                        {filtered.length} of {pipelines.length} pipeline
                        {pipelines.length === 1 ? '' : 's'} — click a{' '}
                        {activeView === 'table' ? 'row' : 'card'} for the plan
                    </>}
                />
            </Box>

            {planDataError && (
                <Box sx={{ px: 3 }}>
                    <Alert severity="error" variant="outlined" sx={{ mb: 2 }}
                           data-testid="pipelines-plan-data-error">
                        The {failedReadsText} read{failedReadsText.includes(' and ') ? 's' : ''} failed
                        to load. Every step count, progress bar and requirement tally below is
                        computed as though those rows do not exist — a plan with real work may show
                        "0 steps". Reload.
                    </Alert>
                </Box>
            )}

            <Box className="app-content-tabpanel" sx={{ px: 3, pt: 0 }}>
                {activeView === 'table' ? (
                    <Box sx={{ width: '100%' }} data-testid="pipelines-datagrid">
                        <DataGrid
                            autoHeight
                            rows={filtered}
                            columns={columns}
                            getRowId={(r) => r.id}
                            density="compact"
                            slots={{ toolbar: GridToolbar }}
                            slotProps={{ toolbar: { showQuickFilter: true } }}
                            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                            pageSizeOptions={[10, 25, 50]}
                            disableRowSelectionOnClick
                            onRowClick={(params) => open(params.id)}
                            sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
                            data-testid="pipelines-grid"
                        />
                    </Box>
                ) : (
                    <PipelinesCardsView
                        pipelines={filtered}
                        summaries={summaries}
                        reqCounts={reqCounts}
                        showReqCounts={showReqCounts}
                        machines={machines}
                        claims={orchestrationClaims}
                        onOpen={open}
                        lastOpenedId={lastOpenedId}
                        hiddenStatusCounts={hiddenStatusCounts}
                    />
                )}
            </Box>

            {descriptionTarget && (
                <PipelineDescriptionDialog
                    key={descriptionTarget.id}
                    pipeline={descriptionTarget}
                    open={!!descriptionTarget}
                    onClose={() => setDescriptionTarget(null)}
                />
            )}
        </Box>
    );
}
