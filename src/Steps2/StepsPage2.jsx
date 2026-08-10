// /swarm/steps2 — the Pipeline 2.0 plan-layer steps editor (req #3393).
//
// Stands BESIDE `/swarm/steps` (Darwin/src/Steps/StepsPage.jsx), never in
// place of it — reads pipeline2_steps, imports nothing from that file or from
// any other 1.0 module (structural copy, not a shared component). See
// PLAN.md for the full re-scope rationale.
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
//   - `completed_at` renders a TWO-state Open/Complete chip, not 1.0's
//     three-state Pending/Running/Done. Full state derivation needs the
//     server-side `pipeline2_derive.py` this session cannot read to verify
//     against — see `steps2Model.js`'s header for the full rationale. The
//     guard itself (design rule 1 — a step with any real linked requirement
//     can never be hand-stamped) is ported faithfully, live re-read
//     included.
//   - Gate/link columns (`reqCount`, `gateCount`) are read-only counts with
//     an id tooltip, exactly like 1.0 — no seat/dependency editor, matching
//     the requirement's own deliberate-omissions list.
//   - The Epic cell is a plain label, not a link — there is no 2.0 plan
//     detail/visualizer page yet to deep-link into (`PLAN.md`'s named gap).

import { useContext, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
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
    useAllPipeline2Epics,
    useAllPipeline2Steps,
    useAllPipeline2StepRequirements,
    useAllPipeline2StepDeps,
    pipeline2StepKeys,
    pipeline2StepRequirementKeys,
    pipeline2StepDepKeys,
} from '../hooks/factory/devopsQueries2';
import { useAllRequirements } from '../hooks/useDataQueries';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import ChipFilter from '../Components/ChipFilter/ChipFilter';
import { formatDateTime } from '../utils/dateFormat';
import { run2ChipProps, run2Label } from '../Pipelines2/pipeline2ChipStyles';
import { buildStep2Rows, completionGuard2, gatingRequirementIds2 } from './steps2Model';
import {
    REST_NULL,
    VALID_RUN2_MODES,
    completeStep2,
    createStep2,
    deleteStep2,
    fetchRequirement2Tracking,
    fetchStep2RequirementIds,
    isRestNullLiteral,
    reopenStep2,
    updateStep2,
} from './steps2Api';

// Only `id` and `tracking` are needed by the completion guard (steps2Model.js);
// `title` rides along for the requirement-id tooltip. Deliberately NOT 1.0's
// `PLAN_REQUIREMENT_FIELDS` (Darwin/src/SwarmView/pipelines/pipelineViewModel.js)
// — a narrower, page-owned projection, same file-isolation rule as everywhere
// else in this feature.
const STEP2_REQUIREMENT_FIELDS = 'id,title,tracking';

const TITLE_MAX = 256;

const ALL_EPICS = '';

const COMPLETED_FILTER_OPTIONS = [
    { value: 'open', label: 'Open', chipProps: { color: 'default' } },
    { value: 'complete', label: 'Complete', chipProps: { color: 'success' } },
];

const oneLine = (value) => (value ? String(value).replace(/\s+/g, ' ').trim() : '');

const reqIdSummary = (row) => {
    const ids = row.reqIds || [];
    if (!ids.length) return 'No requirements linked — this step is completed by hand.';
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

const gateSummary = (row) => ((row.depIds || []).length
    ? `after step${row.depIds.length === 1 ? '' : 's'} ${row.depIds.join(', ')}`
    : 'No step gate.') + (row.not_before
        ? ` · not before ${row.not_before}`
        : '');

// HTML `<input type="datetime-local">` reads/writes local wall-clock time with
// no timezone — `YYYY-MM-DDTHH:mm`. `not_before` is stored as a naive-UTC
// string (`YYYY-MM-DD HH:mm:ss`, the same convention `sqlNow()` in
// steps2Api.js writes and `formatDateTime` reads — see that file's header).
// These two helpers are the one place that conversion happens.
const notBeforeToInputValue = (naiveUtc) => {
    if (!naiveUtc) return '';
    const d = new Date(`${naiveUtc.replace(' ', 'T')}Z`);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const inputValueToNotBefore = (localValue) => {
    if (!localValue) return null;
    const d = new Date(localValue);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace('T', ' ');
};

export default function StepsPage2() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const [searchParams, setSearchParams] = useSearchParams();

    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: epics = [], isLoading: epicsLoading } = useAllPipeline2Epics(creatorFk);
    const { data: steps = [], isLoading: stepsLoading } = useAllPipeline2Steps(creatorFk);
    const { data: stepRequirements = [], isLoading: linksLoading, isError: linksError } =
        useAllPipeline2StepRequirements(creatorFk);
    const { data: stepDeps = [], isLoading: depsLoading, isError: depsError } =
        useAllPipeline2StepDeps(creatorFk);
    const { data: requirements = [], isLoading: reqsLoading, isError: reqsError } =
        useAllRequirements(creatorFk, { fields: STEP2_REQUIREMENT_FIELDS });

    const isLoading = epicsLoading || stepsLoading || linksLoading || depsLoading || reqsLoading;

    // A failed PLAN DATA read is not an empty one — same distinction
    // StepsPage.jsx draws, and for the same reason: an unread link set reports
    // zero gating requirements, which would let a manual stamp through on a
    // step that should have refused it.
    const planDataError = linksError || depsError || reqsError;
    const failedReads = [
        linksError && 'requirement links',
        depsError && 'dependency rows',
        reqsError && 'requirement list',
    ].filter(Boolean);
    const failedReadsText = failedReads.length > 1
        ? `${failedReads.slice(0, -1).join(', ')} and ${failedReads[failedReads.length - 1]}`
        : (failedReads[0] || '');

    const [epicFilter, setEpicFilter] = useState(() => {
        const raw = searchParams.get('epic');
        return raw && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : ALL_EPICS;
    });
    const [completedFilter, setCompletedFilter] = useState(null);
    const toggleCompletedFilter = (value) => setCompletedFilter(current => {
        const selected = current === null
            ? COMPLETED_FILTER_OPTIONS.map(o => o.value)
            : current;
        return selected.includes(value)
            ? selected.filter(v => v !== value)
            : [...selected, value];
    });

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [formEpicFk, setFormEpicFk] = useState('');
    const [formTitle, setFormTitle] = useState('');
    const [formNotes, setFormNotes] = useState('');
    const [formRun, setFormRun] = useState('auto');
    const [formNotBefore, setFormNotBefore] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const completingRef = useRef(new Set());

    const allRows = useMemo(() => buildStep2Rows({
        steps, stepRequirements, stepDeps, requirements, epics,
    }), [steps, stepRequirements, stepDeps, requirements, epics]);

    const rows = useMemo(() => allRows.filter((row) => {
        if (epicFilter !== ALL_EPICS && row.epic_fk !== epicFilter) return false;
        if (completedFilter !== null) {
            const bucket = row.completedAt ? 'complete' : 'open';
            if (!completedFilter.includes(bucket)) return false;
        }
        return true;
    }), [allRows, epicFilter, completedFilter]);

    const accounting = useMemo(() => {
        let done = 0;
        for (const r of allRows) if (r.completedAt) done += 1;
        return { total: allRows.length, done, open: allRows.length - done };
    }, [allRows]);

    const epicOptions = useMemo(() => epics.map(
        e => ({ id: e.id, title: e.title })), [epics]);

    const invalidateSteps = () =>
        queryClient.invalidateQueries({ queryKey: pipeline2StepKeys.all(creatorFk) });

    const openCreate = () => {
        setEditTarget(null);
        setFormEpicFk(epicFilter !== ALL_EPICS ? epicFilter : (epicOptions[0]?.id ?? ''));
        setFormTitle('');
        setFormNotes('');
        setFormRun('auto');
        setFormNotBefore('');
        setDialogOpen(true);
    };

    const openEdit = (row) => {
        setEditTarget(row);
        setFormEpicFk(row.epic_fk);
        setFormTitle(row.title || '');
        setFormNotes(row.notes || '');
        setFormRun(VALID_RUN2_MODES.includes(row.run) ? row.run : 'auto');
        setFormNotBefore(notBeforeToInputValue(row.not_before));
        setDialogOpen(true);
    };

    const handleSubmit = async () => {
        const title = formTitle.trim();
        const notes = formNotes.trim();
        if (!title) {
            showError('Title is required');
            return;
        }
        if (isRestNullLiteral(title)) {
            showError(`"${REST_NULL}" is the API's clear-this-column sentinel and cannot `
                + 'be a title. Try "Null" or another wording.');
            return;
        }
        if (!editTarget && (formEpicFk === '' || formEpicFk == null)) {
            showError('Epic is required');
            return;
        }
        const notBeforeValue = inputValueToNotBefore(formNotBefore);
        setSubmitting(true);
        try {
            if (editTarget) {
                await updateStep2(darwinUri, idToken, editTarget.id, {
                    title,
                    notes: notes || REST_NULL,
                    run: formRun,
                    not_before: notBeforeValue || REST_NULL,
                });
            } else {
                await createStep2(darwinUri, idToken, {
                    epic_fk: formEpicFk,
                    title,
                    notes: notes || null,
                    run: formRun,
                    not_before: notBeforeValue,
                });
            }
            invalidateSteps();
            setDialogOpen(false);
        } catch (err) {
            showError(err, editTarget ? 'Could not save step' : 'Could not create step');
        } finally {
            setSubmitting(false);
        }
    };

    const toggleRun = async (row) => {
        try {
            await updateStep2(darwinUri, idToken, row.id,
                { run: row.run === 'manual' ? 'auto' : 'manual' });
            invalidateSteps();
        } catch (err) {
            showError(err, 'Could not change the step run mode');
        }
    };

    const completeFlow = async (row) => {
        if (planDataError) {
            showError(`Step ${row.id} cannot be completed: the ${failedReadsText} did not `
                + 'load, so there is no way to tell whether its state is derived. Reload first.');
            return;
        }
        const cached = completionGuard2(row);
        if (!cached.allowed) {
            showError(`Step ${row.id} is derived from its requirements. ${cached.reason}`);
            return;
        }

        // THE CACHED GUARD IS NOT ENOUGH — the live re-read StepsPage.jsx's
        // completeFlow performs, ported unchanged: re-read this step's links
        // before writing, because the Primary AI may have linked a requirement
        // onto it while this page's ≤30s cache was still showing the old set.
        let liveGating;
        let liveTracking;
        try {
            const liveReqIds = await fetchStep2RequirementIds(darwinUri, idToken, row.id);
            liveGating = gatingRequirementIds2(liveReqIds, requirements);
            liveTracking = liveReqIds.filter((rid) => !liveGating.includes(rid));
            if (liveTracking.length) {
                const rows2 = await Promise.all(liveTracking.map(
                    (rid) => fetchRequirement2Tracking(darwinUri, idToken, rid)));
                const fresh = rows2.filter(Boolean);
                liveGating = gatingRequirementIds2(liveReqIds, [...requirements, ...fresh]);
                for (const rid of liveTracking.filter((_r, i) => rows2[i] == null)) {
                    if (!liveGating.includes(rid)) liveGating.push(rid);
                }
                liveTracking = liveReqIds.filter((rid) => !liveGating.includes(rid));
            }
        } catch (err) {
            showError(err, `Could not verify step ${row.id}'s requirements — not completed`);
            return;
        }
        if (liveGating.length) {
            showError(`Step ${row.id} is derived from its requirements. `
                + `${completionGuard2({
                    ...row, gatingReqIds: liveGating, trackingReqIds: liveTracking,
                }).reason}`);
            invalidateSteps();
            queryClient.invalidateQueries({
                queryKey: pipeline2StepRequirementKeys.all(creatorFk) });
            return;
        }

        try {
            await completeStep2(darwinUri, idToken, row.id);
            invalidateSteps();
        } catch (err) {
            showError(err, 'Could not complete the step');
        }
    };

    const toggleComplete = async (row) => {
        if (row.completedAt) {
            try {
                await reopenStep2(darwinUri, idToken, row.id);
                invalidateSteps();
            } catch (err) {
                showError(err, 'Could not reopen the step');
            }
            return;
        }
        if (completingRef.current.has(row.id)) return;
        completingRef.current.add(row.id);
        try {
            await completeFlow(row);
        } finally {
            completingRef.current.delete(row.id);
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
            await deleteStep2(darwinUri, idToken, row.id);
            invalidateSteps();
            queryClient.invalidateQueries({
                queryKey: pipeline2StepRequirementKeys.all(creatorFk) });
            queryClient.invalidateQueries({ queryKey: pipeline2StepDepKeys.all(creatorFk) });
        } catch (err) {
            showError(err, 'Could not delete step');
        }
    };

    const columns = [
        { field: 'id', headerName: 'ID', width: 70 },
        { field: 'title', headerName: 'Step', flex: 1, minWidth: 180 },
        {
            field: 'epicTitle', headerName: 'Epic', width: 160,
            valueFormatter: (value, row) => value || `#${row.epic_fk}`,
        },
        {
            field: 'completedAt', headerName: 'State', width: 130, sortable: false,
            renderCell: (params) => {
                const guard = params.row.completedAt
                    ? { kind: 'reopen', reason: 'Complete — click to reopen this step' }
                    : planDataError
                        ? { kind: 'derived',
                            reason: `The ${failedReadsText} did not load, so there is no way `
                                + 'to tell whether this step can be completed by hand.' }
                        : (({ allowed, reason }) => ({
                            kind: allowed ? 'editable' : 'derived', reason }))(
                            completionGuard2(params.row));
                return (
                    <Tooltip title={guard.reason}>
                        <Chip
                            label={params.row.completedAt ? 'Complete' : 'Open'}
                            size="small"
                            color={params.row.completedAt ? 'success' : 'default'}
                            variant={params.row.completedAt ? 'filled' : 'outlined'}
                            clickable
                            onClick={() => toggleComplete(params.row)}
                            aria-label={guard.reason}
                            data-guard={guard.kind}
                            data-testid={`step2-completed-chip-${params.row.id}`}
                        />
                    </Tooltip>
                );
            },
        },
        {
            field: 'run', headerName: 'Run', width: 110, sortable: false,
            renderCell: (params) => (
                <Tooltip title={params.value === 'manual'
                    ? 'Manual — reported eligible, never launched. Click for Auto.'
                    : 'Auto — the orchestrator launches this step when its gate clears. Click for Manual.'}>
                    <Chip
                        label={run2Label(params.value)}
                        size="small"
                        {...run2ChipProps(params.value)}
                        clickable
                        onClick={() => toggleRun(params.row)}
                        data-testid={`step2-run-chip-${params.row.id}`}
                    />
                </Tooltip>
            ),
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
            field: 'gateCount', headerName: 'Gate', width: 90, type: 'number',
            valueGetter: (_v, row) => (row.depIds || []).length,
            renderCell: (params) => (
                <Tooltip title={gateSummary(params.row)}>
                    <Box component="span" data-testid={`step2-gate-count-${params.row.id}`}>
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
            field: 'notes', headerName: 'Notes', flex: 2, minWidth: 220,
            valueGetter: (value) => oneLine(value),
            valueFormatter: (value) => value || '—',
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

    return (
        <Box sx={{ gridArea: 'content', p: 3, width: '100%', minWidth: 0, overflow: 'auto' }}
             data-testid="steps2-page">
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}
                   useFlexGap>
                <Typography variant="h5">Steps 2.0</Typography>

                <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>Epic</InputLabel>
                    <Select label="Epic" value={epicFilter}
                            onChange={(e) => {
                                setEpicFilter(e.target.value);
                                if (searchParams.get('epic')) {
                                    const next = new URLSearchParams(searchParams);
                                    next.delete('epic');
                                    setSearchParams(next, { replace: true });
                                }
                            }}
                            data-testid="steps2-epic-filter">
                        <MenuItem value={ALL_EPICS}>All epics</MenuItem>
                        {epicOptions.map(e => (
                            <MenuItem key={e.id} value={e.id}>{e.title}</MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <ChipFilter
                    options={COMPLETED_FILTER_OPTIONS}
                    selected={completedFilter}
                    onToggle={toggleCompletedFilter}
                    testId="steps2-completed-filter"
                    chipTestIdPrefix="steps2-completed-chip"
                />

                <Typography variant="caption" sx={{ color: 'text.secondary' }}
                            data-testid="steps2-accounting">
                    {rows.length} of {accounting.total} step{accounting.total === 1 ? '' : 's'} —{' '}
                    {accounting.done} complete · {accounting.open} open
                </Typography>

                <Box sx={{ flexGrow: 1 }} />

                <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}
                        disabled={!epicOptions.length}
                        data-testid="step2-add">
                    New Step
                </Button>
            </Stack>

            {planDataError && (
                <Box sx={{ mb: 2, p: 1.5, border: 1, borderColor: 'error.main', borderRadius: 1 }}
                     data-testid="steps2-plan-data-error">
                    The {failedReadsText} failed to load. Completing a step is disabled until
                    this read recovers; reopening one, and edits to title, notes and run mode,
                    are unaffected, and the database still refuses a delete that would break a
                    dependency. Reload.
                </Box>
            )}

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <Box sx={{ width: '100%' }} data-testid="steps2-datagrid">
                    <DataGrid
                        autoHeight
                        rows={rows}
                        columns={columns}
                        getRowId={(r) => r.id}
                        density="compact"
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{ toolbar: { showQuickFilter: true } }}
                        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                        pageSizeOptions={[10, 25, 50, 100]}
                        disableRowSelectionOnClick
                        data-testid="steps2-grid"
                    />
                </Box>
            )}

            <Dialog open={dialogOpen} onClose={() => !submitting && setDialogOpen(false)}
                    maxWidth="md" fullWidth data-testid="step2-edit-dialog">
                <DialogTitle>{editTarget ? `Edit step ${editTarget.id}` : 'New step'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <FormControl fullWidth required disabled={!!editTarget}>
                            <InputLabel>Epic</InputLabel>
                            <Select label="Epic" value={formEpicFk}
                                    onChange={(e) => setFormEpicFk(e.target.value)}
                                    data-testid="step2-epic-select">
                                {epicOptions.map(e => (
                                    <MenuItem key={e.id} value={e.id}>{e.title}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {editTarget && (
                            <Typography variant="caption" sx={{ color: 'text.secondary', mt: -1 }}>
                                A step&apos;s epic is its identity. To move this step, delete it
                                and create it in the other epic — that forces its dependencies to
                                be answered rather than silently broken.
                            </Typography>
                        )}
                        <TextField
                            label="Title"
                            value={formTitle}
                            onChange={(e) => setFormTitle(e.target.value)}
                            helperText={'The step\'s short NAME — "Session Drain", not a sentence.'}
                            autoFocus required fullWidth
                            slotProps={{ htmlInput: {
                                'data-testid': 'step2-title-input', maxLength: TITLE_MAX } }}
                        />
                        <TextField
                            label="Notes"
                            value={formNotes}
                            onChange={(e) => setFormNotes(e.target.value)}
                            helperText={'What this step must achieve and why. Never its dependencies, '
                                + 'status, membership or ordinal — those are rows, and prose that '
                                + 'restates them goes stale. Replaces on save; it does not append.'}
                            fullWidth multiline minRows={5}
                            slotProps={{ htmlInput: { 'data-testid': 'step2-notes-input' } }}
                        />
                        <FormControl fullWidth>
                            <InputLabel>Run</InputLabel>
                            <Select label="Run" value={formRun}
                                    onChange={(e) => setFormRun(e.target.value)}
                                    data-testid="step2-run-select">
                                <MenuItem value="auto">Auto — the orchestrator launches it</MenuItem>
                                <MenuItem value="manual">Manual — reported eligible, never launched</MenuItem>
                            </Select>
                        </FormControl>
                        <TextField
                            label="Not before"
                            type="datetime-local"
                            value={formNotBefore}
                            onChange={(e) => setFormNotBefore(e.target.value)}
                            helperText={'The one instant before which this step does not start. '
                                + 'Leave blank for no time gate.'}
                            fullWidth
                            slotProps={{
                                inputLabel: { shrink: true },
                                htmlInput: { 'data-testid': 'step2-not-before-input' },
                            }}
                        />
                        {formNotBefore && (
                            <Button size="small" onClick={() => setFormNotBefore('')}
                                    data-testid="step2-not-before-clear"
                                    sx={{ alignSelf: 'flex-start', mt: -1 }}>
                                Clear time gate
                            </Button>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
                    <Button variant="contained" onClick={handleSubmit}
                            disabled={submitting || !formTitle.trim()
                                || (!editTarget && formEpicFk === '')}
                            data-testid="step2-save">
                        {editTarget ? 'Save' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
