// /swarm/steps — the plan-layer steps editor (req #3393).
//
// Stands BESIDE `/swarm/steps` (Darwin/src/Steps/StepsPage.jsx), never in
// place of it, and shares no COMPONENT with it (structural copy). It DOES
// share the query layer, chip-style file and era binding
// (`useDataQueries.js`, `pipelineChipStyles.js`, `planEra.js`) — req #3463
// established that additive-extension convention for this feature first, and
// this page follows it rather than a parallel copy. See PLAN.md for the full
// re-scope rationale.
//
// Shape follows StepsPage.jsx: one DataGrid, click-to-toggle chips, one
// dialog for create/edit. Differences from the 1.0 page, all schema-driven:
//
//   - The dialog's parent selector is EPIC, not Pipeline (`epic_fk`,
//     required, disabled on edit — a step's epic is its identity, same
//     "delete and recreate to move" doctrine 1.0 states for its own
//     `pipeline_fk` field).
//   - `not_before` (nullable TIMESTAMP, one instant, clearable) is a new
//     field with no 1.0 equivalent — a native `type="datetime-local"` input
//     (Darwin carries no `@mui/x-date-pickers` dependency anywhere today).
//   - NO STATE COLUMN (req #3750). A step HAS NO STATE: it holds
//     requirements and carries orchestration controls, and is never completed
//     or reopened. This editor used to show an Open/Complete chip over
//     `completed_at`; the concept is gone, not moved elsewhere.
//   - Reqs is a read-only count with an id tooltip — no seat editor,
//     matching the requirement's own deliberate-omissions list.
//   - Column order is the user's (req #3750): ID, Pipeline / Epic, Step,
//     Lock, Run, Barrier, Reqs, then Not before. Notes are edited in the
//     dialog and never shown in the grid; dependencies are read on the plan
//     visualizer, not counted here.
//   - The Pipeline / Epic cell is one chip naming both, linking to the plan
//     visualizer focused on that epic's band (`epicLinkTo`).
//   - The toolbar filters by Pipeline, then Epic, and the two cascade: a
//     pipeline narrows the epic list; an epic implies its pipeline.

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import {
    useAllPipelines,
    useAllEpics,
    useAllPipelineSteps,
    useAllPipelineStepRequirements,
    useAllPipelineStepDeps,
    pipelineStepKeys,
    pipelineStepRequirementKeys,
    pipelineStepDepKeys,
    useAllRequirements,
} from '../hooks/useDataQueries';
import { pipelineComposeKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { formatDateTime } from '../utils/dateFormat';
import {
    runChipProps, runLabel,
    barrierChipProps, barrierLabel, lockedChipProps, lockedLabel,
} from '../SwarmView/pipelines/pipelineChipStyles';
// Plan routes come from the SAME builders the router uses, never a literal
// string (planEra.js's own guard forbids one).
import { epicLinkTo } from '../SwarmView/pipelines/pipelineEpicLink';
import { planOriginOf, planReturnPath } from '../SwarmView/pipelines/pipelineStepLink';
import StepEditDialog from './StepEditDialog';
import { buildStepRows } from './stepsModel';
import { deleteStep, updateStep } from './stepsApi';

// `tracking` splits a step's links into gating vs container ids for the Reqs
// tooltip; `title` rides along. Deliberately NOT 1.0's
// `PLAN_REQUIREMENT_FIELDS` (Darwin/src/SwarmView/pipelines/pipelineViewModel.js)
// — a narrower, page-owned projection, same file-isolation rule as everywhere
// else in this feature.
const STEP_REQUIREMENT_FIELDS = 'id,title,tracking';

const ALL_PIPELINES = '';
const ALL_EPICS = '';

const parseIdParam = (raw) => (raw && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null);

const reqIdSummary = (row) => {
    const ids = row.reqIds || [];
    if (!ids.length) return 'No requirements linked — an empty step holds nothing back.';
    const tracking = new Set(row.trackingReqIds || []);
    return ids.map((id) => (tracking.has(id) ? `${id} (tracking)` : String(id))).join(', ');
};

const blockerClause = (row) => {
    const ids = row.blockerStepIds || [];
    if (ids.length === 1 && ids[0] === row.id) return 'it depends on itself';
    return ids.length === 1
        ? `step ${ids[0]} depends on it`
        : `steps ${ids.join(', ')} depend on it`;
};

export default function StepsPage() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();

    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: pipelines = [], isLoading: pipelinesLoading } = useAllPipelines(creatorFk);
    const { data: epics = [], isLoading: epicsLoading } = useAllEpics(creatorFk);
    const { data: steps = [], isLoading: stepsLoading } = useAllPipelineSteps(creatorFk);
    const { data: stepRequirements = [], isLoading: linksLoading, isError: linksError } =
        useAllPipelineStepRequirements(creatorFk);
    const { data: stepDeps = [], isLoading: depsLoading, isError: depsError } =
        useAllPipelineStepDeps(creatorFk);
    const { data: requirements = [], isLoading: reqsLoading, isError: reqsError } =
        useAllRequirements(creatorFk, { fields: STEP_REQUIREMENT_FIELDS });

    // `pipelinesLoading` too: the `?id=` deep link snapshots its row once
    // loading ends, and a row built before the plan list arrived would miss a
    // plan-level lock (req #3742).
    const isLoading = pipelinesLoading || epicsLoading || stepsLoading || linksLoading
        || depsLoading || reqsLoading;

    // A failed PLAN DATA read is not an empty one: an unread link or dependency
    // set renders as zero Reqs and hides the consequence of a
    // delete, so the page says which read failed rather than showing zeros.
    const planDataError = linksError || depsError || reqsError;
    const failedReads = [
        linksError && 'requirement links',
        depsError && 'dependency rows',
        reqsError && 'requirement list',
    ].filter(Boolean);
    const failedReadsText = failedReads.length > 1
        ? `${failedReads.slice(0, -1).join(', ')} and ${failedReads[failedReads.length - 1]}`
        : (failedReads[0] || '');

    // ── PIPELINE → EPIC, CASCADING (req #3750) ────────────────────────────
    // Two stored choices, one derived truth: an epic belongs to exactly one
    // pipeline, so a chosen epic IMPLIES its pipeline and the Pipeline select
    // shows that pipeline whatever was stored — including when the epic arrived
    // by `?epic=` deep link before any pipeline was picked. Choosing a pipeline
    // the chosen epic is not in clears the epic. An id that names nothing
    // (stale link, or a row since deleted) resolves to "All" for both the
    // select AND the filter, so the grid never filters by a choice the toolbar
    // does not show. The URL is the ONLY store for both choices, so a link
    // followed while the page is already open re-filters it.
    const pipelineFilter = parseIdParam(searchParams.get('pipeline')) ?? ALL_PIPELINES;
    const epicFilter = parseIdParam(searchParams.get('epic')) ?? ALL_EPICS;

    // The editor dialog: `key` changes per open so the form seeds afresh.
    const [dialog, setDialog] = useState({ key: 0, open: false, step: null, defaultEpicFk: '' });

    const pipelineById = useMemo(() => new Map(pipelines.map(p => [p.id, p])), [pipelines]);
    const epicById = useMemo(() => new Map(epics.map(e => [e.id, e])), [epics]);

    const activeEpic = epicById.has(epicFilter) ? epicFilter : ALL_EPICS;
    const knownPipeline = (id) => (pipelineById.has(id) ? id : ALL_PIPELINES);
    const activePipeline = knownPipeline(activeEpic !== ALL_EPICS
        ? epicById.get(activeEpic).pipeline_fk
        : pipelineFilter);

    const allRows = useMemo(() => buildStepRows({
        steps, stepRequirements, stepDeps, requirements, epics, pipelines,
    }), [steps, stepRequirements, stepDeps, requirements, epics, pipelines]);

    const rows = useMemo(() => allRows.filter((row) => {
        if (activeEpic !== ALL_EPICS) return row.epic_fk === activeEpic;
        if (activePipeline !== ALL_PIPELINES) return row.pipelineFk === activePipeline;
        return true;
    }), [allRows, activeEpic, activePipeline]);

    const pipelineOptions = useMemo(() => pipelines.map(
        p => ({ id: p.id, title: p.title })), [pipelines]);

    // Every epic — the dialog's parent list, which must hold an edited step's
    // epic whatever the toolbar is filtered to.
    const allEpicOptions = useMemo(() => epics.map(
        e => ({ id: e.id, title: e.title })), [epics]);

    // The toolbar's epic list, narrowed by the chosen pipeline.
    const epicOptions = useMemo(() => epics
        .filter(e => activePipeline === ALL_PIPELINES || e.pipeline_fk === activePipeline)
        .map(e => ({ id: e.id, title: e.title })), [epics, activePipeline]);

    // The choice lives in the URL, so a filtered view is a link. The router
    // state rides along: it is what renders "Back to Plan", and a
    // filter change must not strand a reader who arrived from the visualizer.
    const writeFilterParams = (pipelineId, epicId) => {
        const next = new URLSearchParams(searchParams);
        if (pipelineId === ALL_PIPELINES) next.delete('pipeline');
        else next.set('pipeline', String(pipelineId));
        if (epicId === ALL_EPICS) next.delete('epic');
        else next.set('epic', String(epicId));
        setSearchParams(next, { replace: true, state: location.state });
    };

    const choosePipeline = (value) => {
        const keepEpic = activeEpic !== ALL_EPICS && value !== ALL_PIPELINES
            && epicById.get(activeEpic)?.pipeline_fk === value;
        writeFilterParams(value, keepEpic ? activeEpic : ALL_EPICS);
    };

    const chooseEpic = (value) => {
        const nextPipeline = value === ALL_EPICS
            ? activePipeline
            : (epicById.get(value)?.pipeline_fk ?? ALL_PIPELINES);
        writeFilterParams(nextPipeline, value);
    };

    // A step write also invalidates the composed plan reads (req #3742), so a
    // plan open elsewhere — or opened next — never draws the pre-save card.
    const invalidateSteps = () => {
        queryClient.invalidateQueries({ queryKey: pipelineStepKeys.all(creatorFk) });
        queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.all });
    };

    // A new step starts in the chosen epic, else the first epic of the chosen
    // pipeline; a pipeline with no epics leaves the field empty rather than
    // pre-picking an epic from some other plan.
    const openCreate = () => setDialog((d) => ({
        key: d.key + 1, open: true, step: null,
        defaultEpicFk: activeEpic !== ALL_EPICS ? activeEpic : (epicOptions[0]?.id ?? ''),
    }));

    const openEdit = (row) => setDialog((d) => ({
        key: d.key + 1, open: true, step: row, defaultEpicFk: '',
    }));

    // Deep-link via ?id=<id> (req #3742), matching EpicsPage's own `?id=`
    // contract. The param is consumed once; the router state rides along on
    // the replace so the page's Back to Plan survives it.
    const autoOpenedIdRef = useRef(null);
    useEffect(() => {
        if (isLoading) return;
        const raw = searchParams.get('id');
        if (!raw || !/^\d+$/.test(raw.trim())) return;
        const targetId = Number(raw.trim());
        if (autoOpenedIdRef.current === targetId) return;
        const target = allRows.find(r => r.id === targetId);
        if (!target) return;
        autoOpenedIdRef.current = targetId;
        openEdit(target);
        const next = new URLSearchParams(searchParams);
        next.delete('id');
        setSearchParams(next, { replace: true, state: location.state });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoading, allRows, searchParams]);

    const toggleRun = async (row) => {
        try {
            await updateStep(darwinUri, idToken, row.id,
                { run: row.run === 'manual' ? 'auto' : 'manual' });
            invalidateSteps();
        } catch (err) {
            showError(err, 'Could not change the step run mode');
        }
    };

    // req #3649 — the barrier and lock flags, toggled exactly as `run` is.
    // A NULL/absent `checkpoint` is the column default (1), so it flips to 0.
    const toggleBarrier = async (row) => {
        try {
            await updateStep(darwinUri, idToken, row.id,
                { checkpoint: (row.checkpoint ?? 1) ? 0 : 1 });
            invalidateSteps();
        } catch (err) {
            showError(err, 'Could not change the step barrier');
        }
    };

    const toggleLock = async (row) => {
        try {
            await updateStep(darwinUri, idToken, row.id, { locked: row.locked ? 0 : 1 });
            invalidateSteps();
        } catch (err) {
            showError(err, 'Could not change the step lock');
        }
    };

    const handleDelete = async (row) => {
        if (row.blockerStepIds.length) {
            showError(`Step ${row.id} cannot be deleted: ${blockerClause(row)}. `
                + 'Re-point or remove those dependencies in the plan first.');
            return;
        }
        const linkCount = (row.reqIds || []).length;
        const gateCount = (row.depIds || []).length;
        const consequence = [
            linkCount && `${linkCount} requirement link${linkCount === 1 ? '' : 's'}`,
            gateCount && `${gateCount} dependency row${gateCount === 1 ? '' : 's'}`,
        ].filter(Boolean).join(' and ');
        if (!window.confirm(
            `Delete step ${row.id} "${row.title}"?`
            + (planDataError
                ? ` The ${failedReadsText} could not be read, so the consequence is`
                  + ' unknown — the database will refuse if another step depends on it.'
                : consequence
                    ? ` Its ${consequence} will be removed with it. The requirements themselves are not touched.`
                    : '')
            + ' This cannot be undone.')) return;
        try {
            await deleteStep(darwinUri, idToken, row.id);
            invalidateSteps();
            queryClient.invalidateQueries({
                queryKey: pipelineStepRequirementKeys.all(creatorFk) });
            queryClient.invalidateQueries({ queryKey: pipelineStepDepKeys.all(creatorFk) });
        } catch (err) {
            showError(err, 'Could not delete step');
        }
    };

    const columns = [
        { field: 'id', headerName: 'ID', width: 70 },
        {
            // req #3750 — ONE chip naming both levels a step sits under,
            // pipeline on the first line and epic on the second. The value is
            // the joined text so sort and quick-filter match either name; the
            // click opens the plan focused on this epic's band.
            field: 'planEpic', headerName: 'Pipeline / Epic', width: 280,
            valueGetter: (_v, row) => [
                row.pipelineTitle || (row.pipelineFk != null ? `#${row.pipelineFk}` : '—'),
                row.epicTitle || `#${row.epic_fk}`,
            ].join(' / '),
            renderCell: (params) => {
                const row = params.row;
                const pipelineLabel = row.pipelineTitle
                    || (row.pipelineFk != null ? `#${row.pipelineFk}` : '—');
                const epicLabel = row.epicTitle || `#${row.epic_fk}`;
                const to = epicLinkTo(row.pipelineFk, row.epic_fk);
                return (
                    <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', minWidth: 0 }}>
                        <Tooltip title={to
                            ? `${params.value} — open this epic in its plan`
                            : params.value}>
                            <Chip
                                label={(
                                    <>
                                        <Box component="span" sx={{ display: 'block',
                                            color: 'text.secondary' }}>
                                            {pipelineLabel}
                                        </Box>
                                        <Box component="span" sx={{ display: 'block' }}>
                                            {epicLabel}
                                        </Box>
                                    </>
                                )}
                                size="small"
                                variant="outlined"
                                clickable={!!to}
                                onClick={(e) => { e.stopPropagation(); if (to) navigate(to); }}
                                sx={{
                                    maxWidth: '100%', height: 'auto', borderRadius: 2,
                                    '& .MuiChip-label': { py: 0.25, lineHeight: 1.3 },
                                    '& .MuiChip-label > span': {
                                        overflow: 'hidden', textOverflow: 'ellipsis' },
                                }}
                                data-testid={`step2-plan-link-${row.id}`}
                            />
                        </Tooltip>
                    </Box>
                );
            },
        },
        // Step names are short — a fixed width, not the flex share that used
        // to take half the page (req #3750: 45% smaller).
        { field: 'title', headerName: 'Step', width: 420 },
        {
            // req #3649 — a locked step is frozen; the gateway refuses edits (423).
            field: 'locked', headerName: 'Lock', width: 100, sortable: false,
            renderCell: (params) => (
                <Tooltip title={params.value
                    ? 'Locked — frozen as a record; edits are refused. Click to unlock.'
                    : 'Open — editable. Click to lock this step.'}>
                    <Chip
                        label={lockedLabel(params.value)}
                        size="small"
                        {...lockedChipProps(params.value)}
                        clickable
                        onClick={() => toggleLock(params.row)}
                        data-testid={`step2-lock-chip-${params.row.id}`}
                    />
                </Tooltip>
            ),
        },
        {
            field: 'run', headerName: 'Run', width: 110, sortable: false,
            renderCell: (params) => (
                <Tooltip title={params.value === 'manual'
                    ? 'Manual — reported eligible, never launched. Click for Auto.'
                    : 'Auto — the orchestrator launches this step when its gate clears. Click for Manual.'}>
                    <Chip
                        label={runLabel(params.value)}
                        size="small"
                        {...runChipProps(params.value)}
                        clickable
                        onClick={() => toggleRun(params.row)}
                        data-testid={`step2-run-chip-${params.row.id}`}
                    />
                </Tooltip>
            ),
        },
        {
            // req #3649/#3750 — a barrier HOLDS every downstream step while it
            // holds open work; a priority step only goes out first and holds nothing.
            field: 'checkpoint', headerName: 'Barrier', width: 120, sortable: false,
            renderCell: (params) => {
                const on = params.value ?? 1;
                return (
                    <Tooltip title={Number(on)
                        ? 'Barrier — Dependent steps may start requirements only when all requirements in this step are met, wontfix, deferred, or paused. Click for Priority.'
                        : 'Priority (barrier off) — Dependent steps may start requirements only when all requirements in this step have been started or are met, wontfix, deferred or paused. Click for Barrier.'}>
                        <Chip
                            label={barrierLabel(on)}
                            size="small"
                            {...barrierChipProps(on)}
                            clickable
                            onClick={() => toggleBarrier(params.row)}
                            data-testid={`step2-barrier-chip-${params.row.id}`}
                        />
                    </Tooltip>
                );
            },
        },
        {
            field: 'reqCount', headerName: 'Reqs', width: 90, type: 'number',
            valueGetter: (_v, row) => (row.reqIds || []).length,
            renderCell: (params) => (
                <Tooltip title={reqIdSummary(params.row)}>
                    <Box component="span" data-testid={`step2-req-count-${params.row.id}`}>
                        {params.value}
                    </Box>
                </Tooltip>
            ),
        },
        {
            field: 'not_before', headerName: 'Not before', width: 150,
            valueFormatter: (value) => (value ? formatDateTime(value, timezone) : '—'),
        },
        {
            field: 'actions', headerName: '', width: 100, sortable: false,
            filterable: false, disableColumnMenu: true,
            renderCell: (params) => (
                <Stack direction="row" spacing={0.5}>
                    <Tooltip title="Edit">
                        <IconButton size="small"
                                    data-testid={`step2-edit-${params.row.id}`}
                                    onClick={(e) => { e.stopPropagation(); openEdit(params.row); }}>
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={params.row.blockerStepIds.length
                        ? `Blocked — ${blockerClause(params.row)}`
                        : 'Delete'}>
                        <IconButton size="small"
                                    aria-label={params.row.blockerStepIds.length
                                        ? `Blocked — ${blockerClause(params.row)}`
                                        : `Delete step ${params.row.id}`}
                                    data-blocked={params.row.blockerStepIds.length ? 'yes' : 'no'}
                                    data-testid={`step2-delete-${params.row.id}`}
                                    onClick={(e) => { e.stopPropagation(); handleDelete(params.row); }}>
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Stack>
            ),
        },
    ];

    // Where the reader came FROM, if anywhere. Same vocabulary the requirement
    // page reads (req #3252): `from:'pipeline'` plus the plan's id and the panel
    // they were looking at — `planOriginOf` says how it is validated.
    const planOrigin = planOriginOf(location.state);

    return (
        <Box sx={{ gridArea: 'content', p: 3, width: '100%', minWidth: 0, overflow: 'auto' }}
             data-testid="steps-page">
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}
                   useFlexGap>
                {/* ── BACK TO THE PLAN THAT SENT YOU (req #3498) ──────────────
                    The plan visualizer's epic chip carries a steps-editor link,
                    and until now following it was one-way: the reader landed
                    here with the plan, its panel and the camera they had set all
                    to be found again by hand.

                    THE STATE IS THE ONE `RequirementDetail` ALREADY SPEAKS —
                    `{from:'pipeline', pipelineId, mode}` (req #3252) — and the
                    route is built by `planDetailPath`, not interpolated here, so
                    this page never spells a plan route of its own. `mode=` is a
                    TRANSIENT override on the receiving page and never rewrites
                    the reader's stored panel preference.

                    RENDERED ONLY WHEN THERE IS AN ORIGIN. Arriving from the nav
                    bar shows no button, because there is nothing to go back
                    TO — a Back that guesses is worse than none. */}
                {planOrigin && (
                    <Button size="small" variant="outlined"
                            startIcon={<ArrowBackIcon />}
                            onClick={() => navigate(planReturnPath(location.state))}
                            data-testid="steps-back-to-plan">
                        Back to Plan
                    </Button>
                )}
                <Typography variant="h5">Steps</Typography>

                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Pipeline</InputLabel>
                    <Select label="Pipeline" value={activePipeline}
                            onChange={(e) => choosePipeline(e.target.value)}
                            data-testid="steps-pipeline-filter">
                        <MenuItem value={ALL_PIPELINES}>All pipelines</MenuItem>
                        {pipelineOptions.map(p => (
                            <MenuItem key={p.id} value={p.id}>{p.title}</MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Epic</InputLabel>
                    <Select label="Epic" value={activeEpic}
                            onChange={(e) => chooseEpic(e.target.value)}
                            data-testid="steps-epic-filter">
                        <MenuItem value={ALL_EPICS}>All epics</MenuItem>
                        {epicOptions.map(e => (
                            <MenuItem key={e.id} value={e.id}>{e.title}</MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <Typography variant="caption" sx={{ color: 'text.secondary' }}
                            data-testid="steps-accounting">
                    {rows.length} of {allRows.length} step{allRows.length === 1 ? '' : 's'}
                </Typography>

                <Box sx={{ flexGrow: 1 }} />

                <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}
                        disabled={!allEpicOptions.length}
                        data-testid="step2-add">
                    New Step
                </Button>
            </Stack>

            {planDataError && (
                <Box sx={{ mb: 2, p: 1.5, border: 1, borderColor: 'error.main', borderRadius: 1 }}
                     data-testid="steps-plan-data-error">
                    The {failedReadsText} failed to load, so the Reqs counts may be
                    incomplete. Edits are unaffected, and the database still refuses a delete
                    that would break a dependency. Reload.
                </Box>
            )}

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <Box sx={{ width: '100%' }} data-testid="steps-datagrid">
                    <DataGrid
                        autoHeight
                        rows={rows}
                        columns={columns}
                        getRowId={(r) => r.id}
                        density="compact"
                        // Fixed height for the two-line Pipeline / Epic chip —
                        // never auto (memory/view-switchable-pages.md § D rule 2).
                        rowHeight={56}
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{ toolbar: { showQuickFilter: true } }}
                        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                        pageSizeOptions={[10, 25, 50, 100]}
                        disableRowSelectionOnClick
                        data-testid="steps-grid"
                    />
                </Box>
            )}

            {/* req #3742 — the shared step editor; the plan canvas opens the
                same one over itself when a step is clicked. */}
            <StepEditDialog
                key={dialog.key}
                open={dialog.open}
                step={dialog.step}
                epicOptions={allEpicOptions}
                defaultEpicFk={dialog.defaultEpicFk}
                onClose={() => setDialog((d) => ({ ...d, open: false }))}
                onSaved={invalidateSteps}
            />
        </Box>
    );
}
