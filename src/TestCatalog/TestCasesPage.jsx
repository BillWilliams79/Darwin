// /swarm/testcases — Test Cases page (req #2380 Phase 1).
// The exemplar pattern this once followed was the retired middle tier's own
// browsable catalog page, retired by req #3357 — test cases now link to
// Requirement (req #3352's junction) instead.

import { useState, useMemo, useContext, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import {
    useAllTestCases, useAllRequirements, useAllCategories, useAllRequirementTestCaseLinks,
} from '../hooks/useDataQueries';
import { testCaseKeys, requirementTestCaseKeys } from '../hooks/useQueryKeys';
import { useViewPreference } from '../hooks/useViewPreference';
import { useTestCatalogFilterStore } from '../stores/useTestCatalogFilterStore';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import {
    createTestCase, updateTestCase, deleteTestCase,
    linkRequirementTestCase, unlinkRequirementTestCase,
} from './actions/validationApi';
import { testTypeChipProps, TEST_TYPE_ORDER, makeStatusComparator } from './statusChipStyles';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import Alert from '@mui/material/Alert';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TableChartIcon from '@mui/icons-material/TableChart';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';

const VIEW_KEY = 'darwin-swarm-testcases-view';
const TABLE_WIDTH = 1100;
const NO_CHANGE = '__no_change__';
const formatDate = (v) => v ? new Date(v).toLocaleDateString() : '';
// ONE stable reference for "no links yet" (code review finding). A `|| []`
// literal at the dialog's call site mints a NEW array every render of this
// page — including one triggered by something as unrelated as clicking a
// category filter chip — and the dialog's edit-target effect used to depend
// on that reference, so any such render reset every field the reader had
// just typed. The dialog no longer depends on this prop's identity either
// (see its own effect comment), but this stays as the honest empty value.
const EMPTY_LINKS = [];
// The requirements table runs to thousands of rows (code review finding).
// MUI's default `filterOptions` scans every option on each keystroke and the
// popper renders every match unvirtualized — capped here the same way a type-
// ahead over an unbounded set always has to be: enough results to recognise
// the one you want, never the whole table.
const LINK_FILTER_OPTIONS = createFilterOptions({ limit: 50 });

export default function TestCasesPage() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);

    const [view, setView] = useViewPreference(VIEW_KEY, 'table');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);

    const categoryFilter = useTestCatalogFilterStore(s => s.categoryFilter);
    const setCategoryFilter = useTestCatalogFilterStore(s => s.setCategoryFilter);

    const creatorFk = profile?.userName;
    const { data: testCases = [], isLoading } = useAllTestCases(creatorFk, {
        fields: 'id,title,preconditions,steps,expected,test_type,tags,category_fk,closed,sort_order,create_ts',
    });
    const { data: requirements = [] } = useAllRequirements(creatorFk, { fields: 'id,title' });
    const { data: categories = [] } = useAllCategories(creatorFk, {
        fields: 'id,category_name,color,project_fk,closed', closed: 0,
    });
    const { data: links = [] } = useAllRequirementTestCaseLinks(creatorFk);

    const requirementsByTestCase = useMemo(() => {
        const map = {};
        for (const l of links) (map[l.test_case_fk] = map[l.test_case_fk] || []).push(l.requirement_fk);
        return map;
    }, [links]);

    const categoryById = useMemo(() => {
        const m = {};
        for (const c of categories) m[c.id] = c;
        return m;
    }, [categories]);

    const filtered = useMemo(() => {
        return testCases.filter(tc => {
            if (categoryFilter !== null && tc.category_fk !== categoryFilter) return false;
            return true;
        });
    }, [testCases, categoryFilter]);

    // Bulk selection + edit
    const [rowSelectionModel, setRowSelectionModel] = useState({ type: 'include', ids: new Set() });
    const visibleIds = useMemo(() => new Set(filtered.map(r => r.id)), [filtered]);
    const selectedCount = rowSelectionModel.type === 'include'
        ? [...rowSelectionModel.ids].filter(id => visibleIds.has(id)).length
        : filtered.filter(r => !rowSelectionModel.ids.has(r.id)).length;
    const getSelectedIds = () => rowSelectionModel.type === 'include'
        ? [...rowSelectionModel.ids].filter(id => visibleIds.has(id))
        : filtered.filter(r => !rowSelectionModel.ids.has(r.id)).map(r => r.id);

    const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
    const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
    const [bulkCategory, setBulkCategory] = useState(NO_CHANGE);
    const [bulkType, setBulkType] = useState(NO_CHANGE);
    const [savingBulk, setSavingBulk] = useState(false);
    const hasBulkChanges = bulkCategory !== NO_CHANGE || bulkType !== NO_CHANGE;
    const resetBulk = () => { setBulkCategory(NO_CHANGE); setBulkType(NO_CHANGE); };
    const openBulkEdit = () => { resetBulk(); setBulkDialogOpen(true); };
    const applyBulk = async () => {
        const ids = getSelectedIds();
        if (!ids.length || !hasBulkChanges) return;
        const update = {};
        if (bulkCategory !== NO_CHANGE) update.category_fk = bulkCategory;
        if (bulkType !== NO_CHANGE) update.test_type = bulkType;
        setSavingBulk(true);
        let succeeded = false;
        try {
            await Promise.all(ids.map(id => updateTestCase(darwinUri, idToken, id, update)));
            succeeded = true;
        } catch (e) {
            showError(e, 'Bulk update failed (some rows may have been updated)');
        } finally {
            queryClient.invalidateQueries({ queryKey: testCaseKeys.all(creatorFk) });
            if (succeeded) {
                setRowSelectionModel({ type: 'include', ids: new Set() });
                setBulkConfirmOpen(false);
                setBulkDialogOpen(false);
                resetBulk();
            }
            setSavingBulk(false);
        }
    };

    const handleViewChange = (_e, newView) => setView(newView);

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: testCaseKeys.all(creatorFk) });
        queryClient.invalidateQueries({ queryKey: requirementTestCaseKeys.all(creatorFk) });
    };

    const openAdd = () => { setEditTarget(null); setDialogOpen(true); };
    const openEdit = (tc) => { setEditTarget(tc); setDialogOpen(true); };

    const handleSave = async (values, linkedRequirementIds) => {
        try {
            let saved = editTarget;
            if (editTarget) await updateTestCase(darwinUri, idToken, editTarget.id, values);
            else {
                saved = await createTestCase(darwinUri, idToken, values);
                if (Array.isArray(saved)) saved = saved[0];
            }
            const caseId = saved?.id || editTarget?.id;
            if (caseId) {
                const prev = new Set(requirementsByTestCase[caseId] || []);
                const next = new Set(linkedRequirementIds);
                for (const rid of next) {
                    if (!prev.has(rid)) await linkRequirementTestCase(darwinUri, idToken, rid, caseId);
                }
                for (const rid of prev) {
                    if (!next.has(rid)) await unlinkRequirementTestCase(darwinUri, idToken, rid, caseId);
                }
            }
            invalidateAll();
            setDialogOpen(false);
        } catch (e) {
            showError(e, editTarget ? 'Could not save test case' : 'Could not create test case');
        }
    };

    const handleDelete = async (tc) => {
        if (!window.confirm(`Delete test case "${tc.title}"?`)) return;
        try {
            await deleteTestCase(darwinUri, idToken, tc.id);
            invalidateAll();
        } catch (e) {
            showError(e, 'Could not delete test case (may have recorded results)');
        }
    };

    return (
        <Box className="app-content-planpage">
            <Box className="app-content-view-toggle"
                 sx={{
                     display: 'flex', alignItems: 'center', gap: 2,
                     mt: 3, mb: 1, px: 3, flexWrap: 'nowrap',
                     ...(view === 'cards' && { borderBottom: 1, borderColor: 'divider' }),
                     ...(view === 'table' && { maxWidth: TABLE_WIDTH }),
                 }}>
                <ToggleButtonGroup value={view} exclusive onChange={handleViewChange} size="small"
                                   sx={{ flexShrink: 0 }}
                                   data-testid="test-cases-view-toggle">
                    <Tooltip title="Cards View">
                        <ToggleButton value="cards" data-testid="view-toggle-cards" sx={{ px: 2 }}>
                            <ViewModuleIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                    <Tooltip title="Table View">
                        <ToggleButton value="table" data-testid="view-toggle-table" sx={{ px: 2 }}>
                            <TableChartIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                </ToggleButtonGroup>
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }} data-testid="category-filter">
                    <Chip label="All" size="small"
                          onClick={() => setCategoryFilter(null)}
                          color={categoryFilter === null ? 'primary' : 'default'}
                          variant={categoryFilter === null ? 'filled' : 'outlined'}
                          sx={{ cursor: 'pointer' }} />
                    {categories.map(c => {
                        const selected = categoryFilter === c.id;
                        return (
                            <Chip key={c.id} label={c.category_name} size="small"
                                  onClick={() => setCategoryFilter(c.id)}
                                  color={selected ? 'primary' : 'default'}
                                  variant={selected ? 'filled' : 'outlined'}
                                  sx={{
                                      cursor: 'pointer',
                                      ...(c.color && { borderColor: c.color }),
                                      ...(!selected && { opacity: 0.6 }),
                                  }}
                                  data-testid={`category-chip-${c.id}`} />
                        );
                    })}
                </Stack>
                {view === 'table' && <Box sx={{ flexGrow: 1 }} />}
                <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}
                        sx={{ flexShrink: 0 }} data-testid="new-test-case-btn">
                    New Test Case
                </Button>
            </Box>

            {isLoading
                ? <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>
                : view === 'table'
                    ? (
                        <Box className="app-content-tabpanel"
                             sx={{ px: 3, pt: 0, maxWidth: TABLE_WIDTH }}>
                            {selectedCount > 0 && (
                                <Box sx={{ display: 'flex', justifyContent: 'flex-end',
                                            alignItems: 'center', gap: 1, mb: 0.5 }}
                                     data-testid="bulk-edit-bar">
                                    <Button variant="outlined" size="small" startIcon={<EditIcon />}
                                            onClick={openBulkEdit} disabled={savingBulk}
                                            data-testid="bulk-edit-button">
                                        Edit Selected ({selectedCount})
                                    </Button>
                                </Box>
                            )}
                            <TestCasesTableView
                                testCases={filtered} categoryById={categoryById}
                                requirementsByTestCase={requirementsByTestCase}
                                onEdit={openEdit} onDelete={handleDelete}
                                rowSelectionModel={rowSelectionModel}
                                setRowSelectionModel={setRowSelectionModel} />
                        </Box>
                    )
                    : (
                        <Box className="app-content-tabpanel" sx={{ p: 3 }}>
                            <TestCasesCardsView
                                testCases={filtered} categoryById={categoryById}
                                requirementsByTestCase={requirementsByTestCase}
                                onEdit={openEdit} onDelete={handleDelete} />
                        </Box>
                    )
            }

            <TestCaseEditDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                onSave={handleSave}
                initial={editTarget}
                categories={categories}
                requirements={requirements}
                currentLinks={requirementsByTestCase[editTarget?.id] || EMPTY_LINKS} />

            {/* Bulk edit + confirm */}
            <Dialog open={bulkDialogOpen} onClose={() => !savingBulk && setBulkDialogOpen(false)}
                    maxWidth="sm" fullWidth data-testid="bulk-edit-dialog">
                <DialogTitle>Edit {selectedCount} Selected Test Case{selectedCount !== 1 ? 's' : ''}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel>Category</InputLabel>
                            <Select label="Category" value={bulkCategory}
                                    onChange={e => setBulkCategory(e.target.value)}
                                    data-testid="bulk-category-select">
                                <MenuItem value={NO_CHANGE}><em>No change</em></MenuItem>
                                {categories.map(c => (
                                    <MenuItem key={c.id} value={c.id}>{c.category_name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth size="small">
                            <InputLabel>Type</InputLabel>
                            <Select label="Type" value={bulkType}
                                    onChange={e => setBulkType(e.target.value)}
                                    data-testid="bulk-type-select">
                                <MenuItem value={NO_CHANGE}><em>No change</em></MenuItem>
                                <MenuItem value="manual">Manual</MenuItem>
                                <MenuItem value="automated">Automated</MenuItem>
                                <MenuItem value="hybrid">Hybrid</MenuItem>
                            </Select>
                        </FormControl>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setBulkDialogOpen(false)} disabled={savingBulk}>Cancel</Button>
                    <Button variant="contained" onClick={() => setBulkConfirmOpen(true)}
                            disabled={!hasBulkChanges || savingBulk}
                            data-testid="bulk-save-button">Save</Button>
                </DialogActions>
            </Dialog>
            <Dialog open={bulkConfirmOpen} onClose={() => !savingBulk && setBulkConfirmOpen(false)}
                    maxWidth="sm" fullWidth data-testid="bulk-confirm-dialog">
                <DialogTitle>Confirm Bulk Update</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1 }}>
                        You are about to update <strong>{selectedCount}</strong> test case{selectedCount !== 1 ? 's' : ''}:
                    </Typography>
                    <Box component="ul" sx={{ my: 1, pl: 3 }}>
                        {bulkCategory !== NO_CHANGE &&
                            <li>Category → <strong>{categoryById[bulkCategory]?.category_name || '(unknown)'}</strong></li>}
                        {bulkType !== NO_CHANGE &&
                            <li>Type → <strong style={{ textTransform: 'capitalize' }}>{bulkType}</strong></li>}
                    </Box>
                    <Alert severity="warning" sx={{ mt: 2 }}>This action cannot be easily undone.</Alert>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setBulkConfirmOpen(false)} disabled={savingBulk}>Cancel</Button>
                    <Button variant="contained" color="warning" onClick={applyBulk} disabled={savingBulk}
                            data-testid="bulk-confirm-button">
                        {savingBulk ? 'Applying...' : 'Yes, Apply Changes'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

function TestCasesTableView({ testCases, categoryById, requirementsByTestCase, onEdit, onDelete,
                                rowSelectionModel, setRowSelectionModel }) {
    const columns = [
        { field: 'id', headerName: 'ID', width: 70, type: 'number' },
        { field: 'title', headerName: 'Title', flex: 1, minWidth: 220 },
        {
            field: 'category_name', headerName: 'Category', width: 150,
            valueGetter: (_v, row) => categoryById[row.category_fk]?.category_name || '',
        },
        {
            field: 'test_type', headerName: 'Type', width: 120,
            sortComparator: makeStatusComparator(TEST_TYPE_ORDER),
            renderCell: (p) => {
                const props = testTypeChipProps(p.value);
                return (
                    <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                        <Chip label={p.value} size="small"
                              sx={{ ...props.sx, textTransform: 'capitalize' }} />
                    </Box>
                );
            },
        },
        { field: 'tags', headerName: 'Tags', width: 180 },
        {
            field: 'linked_requirements', headerName: 'Linked Requirements', width: 150, type: 'number',
            valueGetter: (_v, row) => (requirementsByTestCase[row.id] || []).length,
        },
        { field: 'create_ts', headerName: 'Created', width: 105, valueFormatter: formatDate },
        {
            field: '_actions', headerName: '', width: 80, sortable: false, filterable: false,
            renderCell: (p) => (
                <Box sx={{ display: 'flex', height: '100%', alignItems: 'center' }}>
                    <IconButton size="small" aria-label="Edit test case" onClick={(e) => { e.stopPropagation(); onEdit(p.row); }}>
                        <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" aria-label="Delete test case" onClick={(e) => { e.stopPropagation(); onDelete(p.row); }}>
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </Box>
            ),
        },
    ];
    const handleCellClick = (params) => {
        if (params.field === '__check__' || params.field === '_actions') return;
        onEdit(params.row);
    };
    return (
        <DataGrid
            rows={testCases}
            columns={columns}
            rowHeight={52}
            density="compact"
            slots={{ toolbar: GridToolbar }}
            slotProps={{ toolbar: { showQuickFilter: true } }}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            pageSizeOptions={[25, 50, 100]}
            checkboxSelection
            disableRowSelectionOnClick
            rowSelectionModel={rowSelectionModel}
            onRowSelectionModelChange={setRowSelectionModel}
            onCellClick={handleCellClick}
            sx={{ cursor: 'pointer' }}
            data-testid="test-cases-datagrid"
        />
    );
}

function TestCasesCardsView({ testCases, categoryById, requirementsByTestCase, onEdit, onDelete }) {
    const byCategory = useMemo(() => {
        const g = {};
        for (const tc of testCases) {
            const k = tc.category_fk || 'uncategorized';
            (g[k] = g[k] || []).push(tc);
        }
        return g;
    }, [testCases]);

    if (testCases.length === 0) {
        return <Typography sx={{ color: 'text.secondary' }}>No test cases match the current filters.</Typography>;
    }
    return (
        <Stack spacing={2} data-testid="test-cases-cards-view">
            {Object.entries(byCategory).map(([cid, group]) => {
                const cat = categoryById[cid];
                return (
                    <Card key={cid} variant="outlined"
                          sx={cat?.color ? { borderLeft: `4px solid ${cat.color}` } : undefined}>
                        <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                            <Typography variant="h6" sx={{ mb: 1 }}>
                                {cat?.category_name || '(uncategorized)'}
                                <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                                    ({group.length})
                                </Typography>
                            </Typography>
                            <Stack spacing={0.5}>
                                {group.map(tc => {
                                    const chipProps = testTypeChipProps(tc.test_type);
                                    return (
                                        <Box key={tc.id}
                                             sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.75,
                                                    border: 1, borderColor: 'divider', borderRadius: 1,
                                                    '&:hover': { bgcolor: 'action.hover' } }}
                                             data-testid={`test-case-row-${tc.id}`}>
                                            <Typography sx={{ flex: 1, minWidth: 0,
                                                                overflow: 'hidden', textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap' }}>{tc.title}</Typography>
                                            <Chip label={tc.test_type} size="small"
                                                  sx={{ ...chipProps.sx, textTransform: 'capitalize' }} />
                                            <Typography variant="caption" sx={{ color: 'text.secondary',
                                                                                 minWidth: 90, textAlign: 'right' }}>
                                                {(requirementsByTestCase[tc.id] || []).length} requirement(s)
                                            </Typography>
                                            <IconButton size="small" aria-label="Edit test case" onClick={() => onEdit(tc)}><EditIcon fontSize="small" /></IconButton>
                                            <IconButton size="small" aria-label="Delete test case" onClick={() => onDelete(tc)}><DeleteIcon fontSize="small" /></IconButton>
                                        </Box>
                                    );
                                })}
                            </Stack>
                        </CardContent>
                    </Card>
                );
            })}
        </Stack>
    );
}

function TestCaseEditDialog({ open, onClose, onSave, initial, categories, requirements, currentLinks }) {
    const [title, setTitle] = useState('');
    const [preconditions, setPreconditions] = useState('');
    const [steps, setSteps] = useState('');
    const [expected, setExpected] = useState('');
    const [test_type, setTestType] = useState('manual');
    const [tags, setTags] = useState('');
    const [category_fk, setCategoryFk] = useState('');
    const [linkedRequirementIds, setLinkedRequirementIds] = useState([]);
    const [linkQuery, setLinkQuery] = useState('');

    useEffect(() => {
        if (!open) return;
        setTitle(initial?.title || '');
        setPreconditions(initial?.preconditions || '');
        setSteps(initial?.steps || '');
        setExpected(initial?.expected || '');
        setTestType(initial?.test_type || 'manual');
        setTags(initial?.tags || '');
        setCategoryFk(initial?.category_fk || (categories[0]?.id ?? ''));
        setLinkedRequirementIds(currentLinks || EMPTY_LINKS);
        setLinkQuery('');
        // Keyed on the row's OWN id, not the array/object references its
        // fields arrive in — `categories` and `currentLinks` are read here for
        // their VALUES, not to re-arm on every reference change. Re-opening
        // (or re-running) this effect on every parent re-render — which a
        // fresh `currentLinks` array literal at the call site used to force —
        // silently reset every field the reader had just typed. See the
        // caller's `EMPTY_LINKS` comment.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initial?.id]);

    const submit = () => {
        if (!title || !steps || !expected || !category_fk) return;
        onSave({
            title, preconditions: preconditions || null,
            steps, expected, test_type,
            tags: tags || null, category_fk,
        }, linkedRequirementIds);
    };

    // req #3357 item 9 — a checkbox-per-row list does not scale past a handful
    // of options (34 rows in the retired middle tier's catalog vs. 200+ live
    // requirements, thousands in the table), so linking is SEARCH-AND-SELECT:
    // a typeahead over `id - title`
    // that adds a chip per selection, with the linked set as removable chips
    // above it.
    //
    // Ids COERCED on both sides of every comparison — the wire makes no
    // promise these stay JSON numbers, and the app's own convention elsewhere
    // (`orchestrationIndex.js`'s `toId`, `pipelineMembership.js`) is never to
    // trust it silently: a string/number mismatch here would leave an
    // already-linked row still offered, or a saved link's chip simply missing.
    const requirementById = useMemo(() => {
        const m = new Map();
        for (const r of requirements) m.set(Number(r.id), r);
        return m;
    }, [requirements]);
    const linkedRequirements = useMemo(() => linkedRequirementIds.map(rid => {
        const found = requirementById.get(Number(rid));
        // A link to a requirement absent from the current read (still
        // loading, or deleted) still renders — as its bare id — so it stays
        // visible AND removable rather than disappearing from the chip row
        // while `handleSave`'s diff still carries it.
        return found || { id: rid, title: `#${rid}` };
    }), [linkedRequirementIds, requirementById]);
    const unlinkedOptions = useMemo(() => {
        const linked = new Set(linkedRequirementIds.map(Number));
        return requirements.filter(r => !linked.has(Number(r.id)));
    }, [requirements, linkedRequirementIds]);
    const addRequirement = (rid) =>
        setLinkedRequirementIds(prev => (prev.map(Number).includes(Number(rid)) ? prev : [...prev, rid]));
    const removeRequirement = (rid) =>
        setLinkedRequirementIds(prev => prev.filter(x => Number(x) !== Number(rid)));

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth data-testid="test-case-edit-dialog">
            <DialogTitle>{initial ? 'Edit test case' : 'New test case'}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <TextField autoFocus label="Title (matches Playwright/pytest describe/it name)"
                               value={title} onChange={e => setTitle(e.target.value)} required
                               inputProps={{ 'data-testid': 'test-case-title-input' }} />
                    <TextField label="Preconditions (optional)" value={preconditions}
                               onChange={e => setPreconditions(e.target.value)}
                               multiline minRows={2}
                               inputProps={{ 'data-testid': 'test-case-preconditions-input' }} />
                    <TextField label="Steps" value={steps} onChange={e => setSteps(e.target.value)}
                               multiline minRows={3} required
                               inputProps={{ 'data-testid': 'test-case-steps-input' }} />
                    <TextField label="Expected" value={expected} onChange={e => setExpected(e.target.value)}
                               multiline minRows={2} required
                               inputProps={{ 'data-testid': 'test-case-expected-input' }} />
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <FormControl sx={{ minWidth: 180 }}>
                            <InputLabel>Type</InputLabel>
                            <Select label="Type" value={test_type}
                                    onChange={e => setTestType(e.target.value)}
                                    data-testid="test-case-type-select">
                                <MenuItem value="manual">Manual</MenuItem>
                                <MenuItem value="automated">Automated</MenuItem>
                                <MenuItem value="hybrid">Hybrid</MenuItem>
                            </Select>
                        </FormControl>
                        <FormControl fullWidth required>
                            <InputLabel>Category</InputLabel>
                            <Select label="Category" value={category_fk}
                                    onChange={e => setCategoryFk(e.target.value)}
                                    data-testid="test-case-category-select">
                                {categories.map(c => <MenuItem key={c.id} value={c.id}>{c.category_name}</MenuItem>)}
                            </Select>
                        </FormControl>
                    </Box>
                    <TextField label="Tags (comma-separated)" value={tags}
                               onChange={e => setTags(e.target.value)}
                               inputProps={{ 'data-testid': 'test-case-tags-input' }} />
                    <Typography variant="subtitle2" sx={{ mt: 2 }}>Linked requirements</Typography>
                    <Box data-testid="requirement-link-list">
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: linkedRequirements.length ? 1 : 0 }}>
                            {linkedRequirements.map(r => (
                                <Chip
                                    key={r.id}
                                    label={`${r.id} - ${r.title}`}
                                    size="small"
                                    onDelete={() => removeRequirement(r.id)}
                                    data-testid={`link-requirement-${r.id}`}
                                />
                            ))}
                        </Box>
                        <Autocomplete
                            options={unlinkedOptions}
                            getOptionLabel={(r) => `${r.id} - ${r.title}`}
                            filterOptions={LINK_FILTER_OPTIONS}
                            value={null}
                            // CONTROLLED input text, separately from `value`
                            // (code review finding). MUI's own reset effect
                            // only clears typed text on a `value` CHANGE — and
                            // `value` here is permanently `null` (a link is an
                            // ADD, not a selection the field should keep
                            // showing) — so leaving `inputValue` uncontrolled
                            // left the previous pick's label stuck in the
                            // field, filtering `unlinkedOptions` (which no
                            // longer contains it) down to nothing and showing
                            // "No options" until the reader cleared it by hand.
                            inputValue={linkQuery}
                            onInputChange={(_e, value, reason) => {
                                if (reason !== 'reset') setLinkQuery(value);
                            }}
                            onChange={(_e, value) => {
                                if (!value) return;
                                addRequirement(value.id);
                                setLinkQuery('');
                            }}
                            isOptionEqualToValue={(a, b) => Number(a.id) === Number(b.id)}
                            renderInput={(params) => (
                                <TextField {...params} label="Link a requirement"
                                           placeholder="Search by id or title"
                                           inputProps={{ ...params.inputProps,
                                               'data-testid': 'requirement-link-search' }} />
                            )}
                            data-testid="requirement-link-autocomplete"
                        />
                    </Box>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} data-testid="test-case-cancel-btn">Cancel</Button>
                <Button onClick={submit} variant="contained"
                        disabled={!title || !steps || !expected || !category_fk}
                        data-testid="test-case-save-btn">
                    {initial ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
