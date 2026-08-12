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
//   - No Features count column — 2.0 has no feature tier (containment goes
//     straight epic -> step). A step_count column takes its place, linking to
//     `/swarm/steps?epic=<id>`.
//   - No orchestration-claim "orchestrated by" badge — not in the
//     requirement's field matrix; left out deliberately rather than folded
//     in silently.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useContext } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
    useAllCategories,
    useAllPipelines,
    useAllEpics,
    useAllPipelineSteps,
    epicKeys,
    pipelineStepKeys,
} from '../hooks/useDataQueries';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import ChipFilter from '../Components/ChipFilter/ChipFilter';
import { formatDate } from '../utils/dateFormat';
import { epicStatus2ChipProps, epicStatus2Label } from '../SwarmView/pipelines/pipelineChipStyles';
import { createEpic, updateEpic, deleteEpic, isRestNullLiteral, REST_NULL } from './epicsApi';

// Same projection 1.0's EpicsPage requests — a NAME DICTIONARY, no `closed`
// filter (an epic filed under a since-closed category must still render it).
const CATEGORY_FIELDS = 'id,category_name,color,sort_order,closed';

const CLOSED_FILTER_OPTIONS = [
    { value: 'open', label: 'Open', chipProps: { color: 'success' } },
    { value: 'closed', label: 'Closed', chipProps: { color: 'default' } },
];

// SMALLINT — the column's real width. Copied from EpicsPage.jsx rather than
// imported: a small pure validation function, not a data or style dependency,
// so it stays a local copy even where the query layer and chip styles now
// share their 1.0 files directly.
const SORT_ORDER_MIN = -32768;
const SORT_ORDER_MAX = 32767;

const oneLine = (value) => (value ? String(value).replace(/\s+/g, ' ').trim() : '');

// sort_order is a nullable SMALLINT fed by a text input — three answers, not
// two: EMPTY (clear the column), a usable integer, and INVALID.
const parseSortOrder = (raw) => {
    const t = (raw ?? '').trim();
    if (t === '') return { empty: true };
    const n = Number(t);
    if (!Number.isInteger(n)) return { invalid: 'Sort order must be a whole number' };
    if (n < SORT_ORDER_MIN || n > SORT_ORDER_MAX) {
        return { invalid: `Sort order must be between ${SORT_ORDER_MIN} and ${SORT_ORDER_MAX}` };
    }
    return { value: n };
};

export default function EpicsPage2() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const navigate = useNavigate();
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

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [formPipelineFk, setFormPipelineFk] = useState('');
    const [formTitle, setFormTitle] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [formCategoryFk, setFormCategoryFk] = useState('');
    const [formSortOrder, setFormSortOrder] = useState('');
    const [formEpicStatus, setFormEpicStatus] = useState('active');
    const [submitting, setSubmitting] = useState(false);

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

    const categoryOptions = useMemo(() => {
        const open = categories.filter(c => !c.closed).sort((a, b) => {
            const ao = a.sort_order == null ? Infinity : a.sort_order;
            const bo = b.sort_order == null ? Infinity : b.sort_order;
            return ao - bo || String(a.category_name).localeCompare(String(b.category_name));
        });
        const current = editTarget?.category_fk;
        if (current != null && !open.some(c => c.id === current)) {
            const row = categoryById[current];
            if (row) return [...open, row];
        }
        return open;
    }, [categories, categoryById, editTarget]);

    // Plans in the same order PipelinesPage2 shows them (id:desc — newest first).
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

    const invalidateEpics = () =>
        queryClient.invalidateQueries({ queryKey: epicKeys.all(creatorFk) });

    const openCreate = () => {
        setEditTarget(null);
        setFormPipelineFk(pipelineOptions[0]?.id ?? '');
        setFormTitle('');
        setFormDescription('');
        setFormCategoryFk(categoryOptions.find(c => !c.closed)?.id ?? '');
        setFormSortOrder('');
        setFormEpicStatus('active');
        setDialogOpen(true);
    };

    const openEdit = (row) => {
        setEditTarget(row);
        setFormPipelineFk(row.pipeline_fk ?? '');
        setFormTitle(row.title || '');
        setFormDescription(row.description || '');
        setFormCategoryFk(row.category_fk ?? '');
        setFormSortOrder(row.sort_order == null ? '' : String(row.sort_order));
        setFormEpicStatus(row.epic_status === 'paused' ? 'paused' : 'active');
        setDialogOpen(true);
    };

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
        setSearchParams(next, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoading, epics, searchParams]);

    const handleSubmit = async () => {
        const title = formTitle.trim();
        const description = formDescription.trim();
        const sortOrder = parseSortOrder(formSortOrder);
        if (!title) {
            showError('Title is required');
            return;
        }
        // `title` is NOT NULL — a typed "NULL" is Lambda-Rest's clear-column
        // sentinel on BOTH POST and PUT, so it would otherwise reach the
        // gateway as SQL NULL and fail as an opaque 500 (code review, req
        // #3393; matches StepsPage2's identical guard for its own title field).
        if (isRestNullLiteral(title)) {
            showError(`"${REST_NULL}" is the API's clear-this-column sentinel and cannot `
                + 'be a title. Try "Null" or another wording.');
            return;
        }
        if (!editTarget && (formPipelineFk === '' || formPipelineFk == null)) {
            showError('Pipeline is required');
            return;
        }
        if (formCategoryFk === '' || formCategoryFk == null) {
            showError('Category is required');
            return;
        }
        if (sortOrder.invalid) {
            showError(sortOrder.invalid);
            return;
        }
        setSubmitting(true);
        try {
            if (editTarget) {
                // `pipeline_fk` is deliberately never sent here — the field is
                // disabled once editing (see this file's header).
                await updateEpic(darwinUri, idToken, editTarget.id, {
                    title,
                    description: description || REST_NULL,
                    category_fk: formCategoryFk,
                    sort_order: sortOrder.empty ? REST_NULL : sortOrder.value,
                    epic_status: formEpicStatus,
                });
            } else {
                await createEpic(darwinUri, idToken, {
                    pipeline_fk: formPipelineFk,
                    title,
                    description: description || null,
                    category_fk: formCategoryFk,
                    sort_order: sortOrder.empty ? null : sortOrder.value,
                    epic_status: formEpicStatus,
                });
            }
            invalidateEpics();
            setDialogOpen(false);
        } catch (err) {
            showError(err, editTarget ? 'Could not save epic' : 'Could not create epic');
        } finally {
            setSubmitting(false);
        }
    };

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
                <Typography variant="h5">Epics 2.0</Typography>
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

            <Dialog open={dialogOpen} onClose={() => !submitting && setDialogOpen(false)}
                    maxWidth="md" fullWidth data-testid="epic2-edit-dialog">
                <DialogTitle>{editTarget ? 'Edit epic' : 'New epic'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <FormControl fullWidth required disabled={!!editTarget}>
                            <InputLabel>Pipeline</InputLabel>
                            <Select label="Pipeline" value={formPipelineFk}
                                    onChange={(e) => setFormPipelineFk(e.target.value)}
                                    data-testid="epic2-pipeline-select">
                                {pipelineOptions.map(p => (
                                    <MenuItem key={p.id} value={p.id}>{p.title}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {editTarget && (
                            <Typography variant="caption" sx={{ color: 'text.secondary', mt: -1 }}>
                                An epic&apos;s plan membership is not editable from this dialog —
                                use the move tool (MCP `move_epic`) to re-home it.
                            </Typography>
                        )}
                        <TextField
                            label="Title"
                            value={formTitle}
                            onChange={(e) => setFormTitle(e.target.value)}
                            autoFocus required fullWidth
                            slotProps={{ htmlInput: { 'data-testid': 'epic2-title-input', maxLength: 256 } }}
                        />
                        <TextField
                            label="Description"
                            value={formDescription}
                            onChange={(e) => setFormDescription(e.target.value)}
                            helperText="What this epic is for — purpose, not a fact a query can answer."
                            fullWidth multiline minRows={6}
                            slotProps={{ htmlInput: { 'data-testid': 'epic2-description-input' } }}
                        />
                        <FormControl fullWidth required>
                            <InputLabel>Category</InputLabel>
                            <Select label="Category" value={formCategoryFk}
                                    onChange={(e) => setFormCategoryFk(e.target.value)}
                                    data-testid="epic2-category-select">
                                {categoryOptions.map(c => (
                                    <MenuItem key={c.id} value={c.id}>{c.category_name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth>
                            <InputLabel>Pause state</InputLabel>
                            <Select label="Pause state" value={formEpicStatus}
                                    onChange={(e) => setFormEpicStatus(e.target.value)}
                                    data-testid="epic2-status-select">
                                <MenuItem value="active">Active — swarm-starts normally</MenuItem>
                                <MenuItem value="paused">Paused — suppresses swarm-start</MenuItem>
                            </Select>
                        </FormControl>
                        <TextField
                            label="Sort order"
                            value={formSortOrder}
                            onChange={(e) => setFormSortOrder(e.target.value)}
                            helperText={"Whole number, position among this plan's epics. Leave "
                                + 'blank for derived order (started epics by start date, '
                                + 'unstarted after by creation).'}
                            type="number" fullWidth
                            slotProps={{ htmlInput: {
                                'data-testid': 'epic2-sort-order-input',
                                step: 1, min: SORT_ORDER_MIN, max: SORT_ORDER_MAX,
                            } }}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
                    <Button variant="contained" onClick={handleSubmit}
                            disabled={submitting || !formTitle.trim() || formCategoryFk === ''
                                || (!editTarget && formPipelineFk === '')}
                            data-testid="epic2-save">
                        {editTarget ? 'Save' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
