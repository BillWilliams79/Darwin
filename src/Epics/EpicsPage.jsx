// /swarm/epics — the Epics editor (req #3139).
//
// Epics are the TOP tier of Epic > Feature > Story (req #3111, migration 076).
// Every other tier already had a page: requirements at /swarm, features at
// /swarm/features. Epics had none — req #3115 shipped the `?epic=<id>` filter on
// the features view as "the minimal target the requirement asked for; dedicated
// epic pages are deliberately deferred". This is that deferred page, and it sits
// as an L2 nav entry directly under Pipelines because an epic is what a plan is
// made OF (design rule 10 derives a step's label by walking requirement →
// feature → epic).
//
// Shape follows MachinesView (/swarm/machines): one DataGrid, a click-to-toggle
// closed chip, no cards/trends views. Create and Edit go through one dialog
// rather than inline editing, because `description` is multi-paragraph prose and
// `category_fk` is a constrained choice — neither fits a grid cell.
//
// Deliberately NOT a `ViewerHeader` page (memory/darwin-viewer-pages.md): that
// contract is for a dataset shown through MORE THAN ONE presentation, and it
// mandates a ToggleButtonGroup even at length 1 — a dead control on a page with
// a single view. The siblings this page sits beside (Machines, Customers,
// Features) all hand-roll the same header row. Adopting ViewerHeader is the
// right move the day this page grows a second view, not before.
//
// The connection to the existing epic surface is the Features count cell: it
// navigates to /swarm/features?epic=<id>, the same target the plan visualizer's
// epic chip ↗ uses (req #3119). The features view's epic chip links back here.

import { useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useAllEpics, useAllFeatures, useAllCategories, useMachines, useOrchestrationClaims, ALL_ROWS } from '../hooks/useDataQueries';
import { claimsForEpic, holderView } from '../SwarmView/pipelines/orchestrationHolder';
import { epicKeys, featureKeys, sessionKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import ChipFilter from '../Components/ChipFilter/ChipFilter';
import { formatDate } from '../utils/dateFormat';
import { createEpic, updateEpic, deleteEpic, REST_NULL } from './epicsApi';

// The same projection RequirementsTrendsView already requests, deliberately —
// `useAllCategories` keys on `fields`, so matching it shares one cache entry
// instead of paying for a second read of the same table. No `closed` filter:
// this is a NAME DICTIONARY first (an epic filed under a since-closed category
// must still render its category, not a blank), and the dialog narrows it to
// open categories itself.
const CATEGORY_FIELDS = 'id,category_name,color,sort_order,closed';

// Explicit chipProps, not the ChipFilter palette: open/closed is a fixed
// two-value VOCABULARY, and the palette is for dimensions whose values are data
// (machines, projects). Left to hash, 'open' and 'closed' would pick arbitrary
// colours that contradict the grid's own Status chip two columns away — the
// same word in two colours on one screen.
const CLOSED_FILTER_OPTIONS = [
    { value: 'open', label: 'Open', chipProps: { color: 'success' } },
    { value: 'closed', label: 'Closed', chipProps: { color: 'default' } },
];

// SMALLINT — the column's real width, not INT. 40000 is a 1264 from MySQL and
// a 500 at the gateway, which is a worse answer than refusing it in the form.
const SORT_ORDER_MIN = -32768;
const SORT_ORDER_MAX = 32767;

// The ENTITY ROOT of the swarm_sessions cache, and it has to be the root.
// `sessions` is declared `byIdCreatorScoped: false`, so its two key shapes are
// SIBLINGS rather than ancestor and descendant — ['swarm_sessions', creatorFk]
// for the list, ['swarm_sessions', {id}] for a detail row — and they diverge at
// element 1, where 'tester' and {id:42} fail deep equality. Neither prefix
// reaches the other. That matters here because SwarmSessionDetail is the ONLY
// component that renders a session's `epic_fk` at all, and it reads through the
// byId key: invalidating the list alone refreshes every cache except the one
// that shows the column. Derived from the factory rather than typed out, so an
// entity rename cannot desync it.
const SESSION_CACHE_ROOT = sessionKeys.all(null).slice(0, 1);

// Collapse prose to one line for the grid cell. Epic descriptions are several
// paragraphs (see darwin://epics) and a raw multi-line value renders as a single
// clipped line with the newlines swallowed anyway — this at least keeps the
// words on either side of a break from running together.
const oneLine = (value) => (value ? String(value).replace(/\s+/g, ' ').trim() : '');

// sort_order is a nullable SMALLINT fed by a text input, so there are THREE
// answers, not two, and collapsing the last two loses data: EMPTY (clear the
// column), a usable integer, and INVALID. `<input type="number">` keeps "4.5"
// and "4e3" in the field rather than clearing them, so treating anything
// non-integer as empty would silently wipe an epic's plan position on a typo.
// Returns { value } | { empty: true } | { invalid: <reason> }.
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

export default function EpicsPage() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const navigate = useNavigate();

    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: epics = [], isLoading: epicsLoading } = useAllEpics(creatorFk);
    // ALL_ROWS: the count is "features filed under this epic", and a closed
    // feature is still filed under it. Counting only open ones would report 0
    // for a finished epic and read as a data bug.
    const { data: features = [], isLoading: featuresLoading } =
        useAllFeatures(creatorFk, { closed: ALL_ROWS });
    const { data: categories = [], isLoading: categoriesLoading } =
        useAllCategories(creatorFk, { fields: CATEGORY_FIELDS });
    // req #3224 — which epics are being orchestrated, from where. Deliberately
    // NOT in `isLoading`: it feeds an OPTIONAL badge whose absence means "not
    // orchestrated", which is the right reading while it is in flight too.
    const { data: orchestrationClaims = [] } = useOrchestrationClaims(creatorFk);
    // machines are what turn a machine_fk into a name; the page already has none
    // of its own, so this is the one read the badge adds beyond the claims.
    const { data: machines = [] } = useMachines(creatorFk);

    // Every read that feeds a NUMBER OR A LABEL gates the spinner (the
    // PipelinesPage rule). The three reads resolve independently: gating on
    // epics alone paints a grey `0` in the Features column for every epic, and
    // — worse — a delete confirmed in that window omits the "its N features
    // will be unfiled" clause the confirmation exists to deliver.
    const isLoading = epicsLoading || featuresLoading || categoriesLoading;

    // Plain state, deliberately: unlike PipelinesPage's persisted filter, this
    // page has no detail route to click into and come back from, so there is no
    // navigation that could silently forget a chip the user turned on.
    const [closedFilter, setClosedFilter] = useState(['open']);
    const toggleClosedFilter = (value) => setClosedFilter(current => (
        current.includes(value)
            ? current.filter(v => v !== value)
            : [...current, value]
    ));

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [formTitle, setFormTitle] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [formCategoryFk, setFormCategoryFk] = useState('');
    const [formSortOrder, setFormSortOrder] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const featureCountByEpic = useMemo(() => {
        const m = {};
        for (const f of features) {
            if (f.epic_fk == null) continue;
            m[f.epic_fk] = (m[f.epic_fk] || 0) + 1;
        }
        return m;
    }, [features]);

    const categoryById = useMemo(() => {
        const m = {};
        for (const c of categories) m[c.id] = c;
        return m;
    }, [categories]);

    // Open categories in the user's own order (sort_order NULLs last, then name),
    // plus whichever one the epic being edited already carries even if it has
    // since been closed — otherwise opening the dialog on such an epic shows an
    // empty Select and saving would silently re-file it. The order matters
    // beyond tidiness: `openCreate` defaults to the first entry, and "whichever
    // row the database happened to return first" is not a default worth having.
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

    const rows = useMemo(() => {
        const visible = epics.filter(e => (
            closedFilter.includes(e.closed ? 'closed' : 'open')
        ));
        // sort_order NULLs last, then id — the order darwin://epics itself uses.
        // Pre-sorted rather than an initial sortModel because MUI sorts a null
        // sort_order to the TOP in ascending order, which puts brand-new,
        // unordered epics above the ordered plan.
        return [...visible]
            .map(e => {
                // THE EPIC'S OWN reservation only. A WHOLE-PLAN orchestrator
                // also owns this epic's steps, but knowing which plans an epic
                // is seated in means walking epic -> features -> requirements ->
                // step links, and that is three more whole-table reads for a
                // badge. The plan surfaces answer the whole-plan case directly,
                // so this page answers the question it can answer exactly —
                // hence the empty `pipelineIds`.
                const holder = holderView(claimsForEpic(orchestrationClaims, e.id, [])[0],
                                          machines);
                return {
                    ...e,
                    feature_count: featureCountByEpic[e.id] || 0,
                    orchestrated_by: holder ? holder.label : '',
                    orchestrated_title: holder ? holder.title : '',
                    orchestrated_stale: holder ? holder.stale : false,
                };
            })
            .sort((a, b) => {
                const ao = a.sort_order == null ? Infinity : a.sort_order;
                const bo = b.sort_order == null ? Infinity : b.sort_order;
                return ao - bo || a.id - b.id;
            });
    }, [epics, closedFilter, featureCountByEpic, orchestrationClaims, machines]);

    const invalidateEpics = () =>
        queryClient.invalidateQueries({ queryKey: epicKeys.all(creatorFk) });

    const openCreate = () => {
        setEditTarget(null);
        setFormTitle('');
        setFormDescription('');
        // Pre-select the first OPEN category (the FeatureEditDialog rule).
        // category_fk is required by the API, so an empty default is a dead Save
        // button on a form that looks complete. `categoryOptions` was memoized
        // for the previous `editTarget` and may still carry that epic's closed
        // category appended at the end, so the openness test is explicit rather
        // than positional — filing new work under a closed category is wrong
        // even when it is the only category left.
        setFormCategoryFk(categoryOptions.find(c => !c.closed)?.id ?? '');
        setFormSortOrder('');
        setDialogOpen(true);
    };

    const openEdit = (row) => {
        setEditTarget(row);
        setFormTitle(row.title || '');
        setFormDescription(row.description || '');
        setFormCategoryFk(row.category_fk ?? '');
        setFormSortOrder(row.sort_order == null ? '' : String(row.sort_order));
        setDialogOpen(true);
    };

    const handleSubmit = async () => {
        const title = formTitle.trim();
        const description = formDescription.trim();
        const sortOrder = parseSortOrder(formSortOrder);
        if (!title) {
            showError('Title is required');
            return;
        }
        // category_fk is ON DELETE RESTRICT and required by the API — a create
        // without it fails at the gateway, so refuse it here with a real message.
        if (formCategoryFk === '' || formCategoryFk == null) {
            showError('Category is required');
            return;
        }
        // An unusable sort order is REFUSED, never silently treated as "clear
        // it": the two look identical in the payload and one of them destroys
        // the epic's position in the plan.
        if (sortOrder.invalid) {
            showError(sortOrder.invalid);
            return;
        }
        setSubmitting(true);
        try {
            if (editTarget) {
                // Every editable column is sent, with the nullable ones cleared
                // via the REST 'NULL' sentinel. One code path beats diffing the
                // form against the row and getting the empty cases wrong.
                await updateEpic(darwinUri, idToken, editTarget.id, {
                    title,
                    description: description || REST_NULL,
                    category_fk: formCategoryFk,
                    sort_order: sortOrder.empty ? REST_NULL : sortOrder.value,
                });
            } else {
                await createEpic(darwinUri, idToken, {
                    title,
                    description: description || null,
                    category_fk: formCategoryFk,
                    // POST takes a real null; the 'NULL' string is a PUT-only
                    // sentinel and would be stored as the literal text.
                    sort_order: sortOrder.empty ? null : sortOrder.value,
                });
            }
            invalidateEpics();
            setDialogOpen(false);
        } catch (err) {
            // TWO-argument form on purpose. call_rest_api THROWS a bare
            // `{data, httpStatus}` object for every gateway error, so `err.message`
            // is undefined on exactly the failures worth reporting; the store's
            // second argument is what renders the status code beside the text.
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

    const handleDelete = async (row) => {
        const count = row.feature_count;
        const consequence = count
            ? ` Its ${count} feature${count === 1 ? '' : 's'} will be unfiled (kept, but with no epic).`
            : '';
        if (!window.confirm(`Delete epic "${row.title}"?${consequence}`)) return;
        try {
            await deleteEpic(darwinUri, idToken, row.id);
            invalidateEpics();
            // BOTH columns that point at an epic are ON DELETE SET NULL, so both
            // caches are now stale: features.epic_fk (the count on this page) and
            // swarm_sessions.epic_fk (req #3186's attribution row, which would
            // otherwise keep rendering a bare `#<id>` chip for an epic that no
            // longer exists — the title lookup fails once the epics list refetches).
            // The session invalidation goes to the ENTITY ROOT deliberately; see
            // SESSION_CACHE_ROOT above for why the list key cannot reach the row
            // that actually renders the column.
            queryClient.invalidateQueries({ queryKey: featureKeys.all(creatorFk) });
            queryClient.invalidateQueries({ queryKey: SESSION_CACHE_ROOT });
        } catch (err) {
            showError(err, 'Could not delete epic');
        }
    };

    // Deliberately NOT memoized (the FeaturesPage / CustomersPage shape). Every
    // action cell closes over `idToken`, which is refreshed in place by
    // AuthContext; a memoized column array would keep firing REST calls with the
    // token it captured on first render long after that token expired.
    const columns = [
        { field: 'id', headerName: 'ID', width: 70 },
        { field: 'title', headerName: 'Epic', flex: 1, minWidth: 200 },
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
            field: 'feature_count', headerName: 'Features', width: 100, type: 'number',
            // The connection to the existing epic surface (req #3139): the same
            // epic-filtered features view the plan visualizer's ↗ opens.
            renderCell: (params) => (
                <Box
                    component="span"
                    role="link"
                    tabIndex={0}
                    aria-label={`Open the features filed under ${params.row.title}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/swarm/features?epic=${params.row.id}`);
                    }}
                    onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.stopPropagation();
                        navigate(`/swarm/features?epic=${params.row.id}`);
                    }}
                    sx={{
                        cursor: 'pointer',
                        textDecoration: params.value > 0 ? 'underline' : 'none',
                        color: params.value > 0 ? 'primary.main' : 'text.secondary',
                    }}
                    data-testid={`epic-features-link-${params.row.id}`}
                >
                    {params.value}
                </Box>
            ),
        },
        {
            // req #3224 — is this epic being SWARM-ORCHESTRATED right now, and
            // from which machine. An empty cell is a real answer, so it renders
            // as an em-dash rather than an unreadable empty chip.
            field: 'orchestrated_by', headerName: 'Orchestrated by', width: 180,
            renderCell: (params) => (params.value ? (
                <Tooltip title={params.row.orchestrated_title}>
                    <Chip size="small" label={params.value}
                          color={params.row.orchestrated_stale ? 'warning' : 'success'}
                          variant={params.row.orchestrated_stale ? 'outlined' : 'filled'}
                          data-testid={`epic-holder-${params.row.id}`} />
                </Tooltip>
            ) : (
                <Box sx={{ color: 'text.secondary' }}>—</Box>
            )),
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
                    data-testid={`epic-toggle-closed-${params.row.id}`}
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
                                    data-testid={`epic-edit-${params.row.id}`}
                                    onClick={(e) => { e.stopPropagation(); openEdit(params.row); }}>
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                        <IconButton size="small"
                                    data-testid={`epic-delete-${params.row.id}`}
                                    onClick={(e) => { e.stopPropagation(); handleDelete(params.row); }}>
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Stack>
            ),
        },
    ];

    return (
        <Box sx={{ gridArea: 'content', p: 3, width: '100%', overflow: 'auto' }}>
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
                        data-testid="epic-add">
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
                    maxWidth="md" fullWidth data-testid="epic-edit-dialog">
                <DialogTitle>{editTarget ? 'Edit epic' : 'New epic'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField
                            label="Title"
                            value={formTitle}
                            onChange={(e) => setFormTitle(e.target.value)}
                            autoFocus required fullWidth
                            // maxLength matches the column (VARCHAR 256). Without
                            // it a longer title reaches MySQL, fails 1406, and
                            // comes back as an opaque 500 (the RequirementRow rule).
                            slotProps={{ htmlInput: { 'data-testid': 'epic-title-input', maxLength: 256 } }}
                        />
                        <TextField
                            label="Description"
                            value={formDescription}
                            onChange={(e) => setFormDescription(e.target.value)}
                            helperText="What this epic is for — purpose, not a fact a query can answer."
                            fullWidth multiline minRows={6}
                            slotProps={{ htmlInput: { 'data-testid': 'epic-description-input' } }}
                        />
                        <FormControl fullWidth required>
                            <InputLabel>Category</InputLabel>
                            <Select label="Category" value={formCategoryFk}
                                    onChange={(e) => setFormCategoryFk(e.target.value)}
                                    data-testid="epic-category-select">
                                {categoryOptions.map(c => (
                                    <MenuItem key={c.id} value={c.id}>{c.category_name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            label="Sort order"
                            value={formSortOrder}
                            onChange={(e) => setFormSortOrder(e.target.value)}
                            helperText="Whole number, position in the plan. Leave blank for unordered (sorts last)."
                            type="number" fullWidth
                            // step/min/max are the spinner's manners only — a typed
                            // "4.5" still arrives here, which is why handleSubmit
                            // refuses it rather than trusting the field.
                            slotProps={{ htmlInput: {
                                'data-testid': 'epic-sort-order-input',
                                step: 1, min: SORT_ORDER_MIN, max: SORT_ORDER_MAX,
                            } }}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
                    <Button variant="contained" onClick={handleSubmit}
                            disabled={submitting || !formTitle.trim() || formCategoryFk === ''}
                            data-testid="epic-save">
                        {editTarget ? 'Save' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
