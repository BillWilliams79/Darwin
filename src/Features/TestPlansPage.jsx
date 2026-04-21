// /swarm/testplans — Test Plans page (req #2380 Phase 2).
// Cards + Table views (matching exemplar).
// Table: checkboxSelection + bulk-close + bulk-set-category.
// Cards: one card per category, plan rows with Start Run / Edit / Delete.
// Plan Detail modal: drag-reorder plan cases (@hello-pangea/dnd).

import { useState, useMemo, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import {
    useAllTestPlans, useAllCategories, useTestPlanCases, useAllTestCases,
    useTestRunsByPlan,
} from '../hooks/useDataQueries';
import { testPlanKeys, testPlanCaseKeys } from '../hooks/useQueryKeys';
import { useFeaturesFilterStore } from '../stores/useFeaturesFilterStore';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import {
    createTestPlan, updateTestPlan, deleteTestPlan,
    addTestCaseToPlan, removeTestCaseFromPlan, reorderTestPlanCases,
} from './actions/validationApi';
import { runStatusChipProps } from './statusChipStyles';

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
import Alert from '@mui/material/Alert';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TableChartIcon from '@mui/icons-material/TableChart';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

const VIEW_KEY = 'darwin-swarm-testplans-view';
const TABLE_WIDTH = 950;
const NO_CHANGE = '__no_change__';
const formatDate = (v) => v ? new Date(v).toLocaleDateString() : '';

export default function TestPlansPage() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const navigate = useNavigate();

    const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'cards');
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [detailPlan, setDetailPlan] = useState(null);

    const categoryFilter = useFeaturesFilterStore(s => s.categoryFilter);
    const setCategoryFilter = useFeaturesFilterStore(s => s.setCategoryFilter);

    const creatorFk = profile?.userName;
    const { data: plans = [], isLoading } = useAllTestPlans(creatorFk);
    const { data: categories = [] } = useAllCategories(creatorFk, {
        fields: 'id,category_name,color,project_fk,closed', closed: 0,
    });

    const categoryById = useMemo(() => {
        const m = {};
        for (const c of categories) m[c.id] = c;
        return m;
    }, [categories]);

    const filtered = useMemo(() => {
        return plans.filter(p => categoryFilter === null || p.category_fk === categoryFilter);
    }, [plans, categoryFilter]);

    // Bulk select + edit
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
    const [bulkClosed, setBulkClosed] = useState(NO_CHANGE);
    const [savingBulk, setSavingBulk] = useState(false);
    const hasBulkChanges = bulkCategory !== NO_CHANGE || bulkClosed !== NO_CHANGE;
    const resetBulk = () => { setBulkCategory(NO_CHANGE); setBulkClosed(NO_CHANGE); };
    const applyBulk = async () => {
        const ids = getSelectedIds();
        if (!ids.length || !hasBulkChanges) return;
        const update = {};
        if (bulkCategory !== NO_CHANGE) update.category_fk = bulkCategory;
        if (bulkClosed !== NO_CHANGE) update.closed = bulkClosed;
        setSavingBulk(true);
        let succeeded = false;
        try {
            await Promise.all(ids.map(id => updateTestPlan(darwinUri, idToken, id, update)));
            succeeded = true;
        } catch (e) {
            showError(e, 'Bulk update failed (some rows may have been updated)');
        } finally {
            queryClient.invalidateQueries({ queryKey: testPlanKeys.all(creatorFk) });
            if (succeeded) {
                setRowSelectionModel({ type: 'include', ids: new Set() });
                setBulkConfirmOpen(false);
                setBulkDialogOpen(false);
                resetBulk();
            }
            setSavingBulk(false);
        }
    };

    const handleViewChange = (_e, newView) => {
        if (newView !== null) {
            setView(newView);
            localStorage.setItem(VIEW_KEY, newView);
        }
    };

    const invalidatePlans = () => {
        queryClient.invalidateQueries({ queryKey: testPlanKeys.all(creatorFk) });
    };

    const openAdd = () => { setEditTarget(null); setEditDialogOpen(true); };
    const openEdit = (plan) => { setEditTarget(plan); setEditDialogOpen(true); };

    const handleSave = async (values) => {
        try {
            if (editTarget) await updateTestPlan(darwinUri, idToken, editTarget.id, values);
            else await createTestPlan(darwinUri, idToken, values);
            invalidatePlans();
            setEditDialogOpen(false);
        } catch (e) {
            showError(e, editTarget ? 'Could not save plan' : 'Could not create plan');
        }
    };

    const handleDelete = async (plan) => {
        if (!window.confirm(`Delete plan "${plan.title}"?`)) return;
        try {
            await deleteTestPlan(darwinUri, idToken, plan.id);
            invalidatePlans();
        } catch (e) {
            showError(e, 'Could not delete plan (may have run history)');
        }
    };

    // Note: Start Run was removed from this page (previously called startTestRun via REST
    // which doesn't plug into any actual test-execution engine). Runs are authored by the
    // dogfood CLI (`scripts/swarm/dogfood/run-pass.py`) which creates the run AND runs
    // pytest AND records results. A UI-driven manual-test run flow is filed as a follow-on
    // requirement — it would sensibly live on /swarm/testruns with a "+ New Run" button
    // that picks a plan and takes you straight into inline result recording.

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
                                   data-testid="test-plans-view-toggle">
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
                        sx={{ flexShrink: 0 }} data-testid="new-test-plan-btn">
                    New Test Plan
                </Button>
            </Box>

            {isLoading
                ? <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>
                : view === 'table'
                    ? (
                        <Box className="app-content-tabpanel" sx={{ px: 3, pt: 0, maxWidth: TABLE_WIDTH }}>
                            {selectedCount > 0 && (
                                <Box sx={{ display: 'flex', justifyContent: 'flex-end',
                                            alignItems: 'center', gap: 1, mb: 0.5 }}
                                     data-testid="bulk-edit-bar">
                                    <Button variant="outlined" size="small" startIcon={<EditIcon />}
                                            onClick={() => { resetBulk(); setBulkDialogOpen(true); }}
                                            disabled={savingBulk}
                                            data-testid="bulk-edit-button">
                                        Edit Selected ({selectedCount})
                                    </Button>
                                </Box>
                            )}
                            <TestPlansTableView
                                plans={filtered} categoryById={categoryById}
                                onEdit={openEdit} onDelete={handleDelete}
                                onOpenDetail={setDetailPlan}
                                rowSelectionModel={rowSelectionModel}
                                setRowSelectionModel={setRowSelectionModel} />
                        </Box>
                    )
                    : (
                        <Box className="app-content-tabpanel" sx={{ p: 3 }}>
                            <TestPlansCardsView
                                plans={filtered} categoryById={categoryById}
                                onEdit={openEdit} onDelete={handleDelete}
                                onOpenDetail={setDetailPlan} />
                        </Box>
                    )
            }

            <TestPlanEditDialog
                open={editDialogOpen}
                onClose={() => setEditDialogOpen(false)}
                onSave={handleSave}
                initial={editTarget}
                categories={categories} />

            {detailPlan && (
                <TestPlanDetail
                    plan={detailPlan}
                    onClose={() => setDetailPlan(null)} />
            )}

            {/* Bulk edit + confirm */}
            <Dialog open={bulkDialogOpen} onClose={() => !savingBulk && setBulkDialogOpen(false)}
                    maxWidth="sm" fullWidth data-testid="bulk-edit-dialog">
                <DialogTitle>Edit {selectedCount} Selected Plan{selectedCount !== 1 ? 's' : ''}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel>Category</InputLabel>
                            <Select label="Category" value={bulkCategory}
                                    onChange={e => setBulkCategory(e.target.value)}>
                                <MenuItem value={NO_CHANGE}><em>No change</em></MenuItem>
                                {categories.map(c => <MenuItem key={c.id} value={c.id}>{c.category_name}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth size="small">
                            <InputLabel>Closed</InputLabel>
                            <Select label="Closed" value={bulkClosed}
                                    onChange={e => setBulkClosed(e.target.value)}>
                                <MenuItem value={NO_CHANGE}><em>No change</em></MenuItem>
                                <MenuItem value={0}>Open (closed=0)</MenuItem>
                                <MenuItem value={1}>Close (closed=1)</MenuItem>
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
                        You are about to update <strong>{selectedCount}</strong> plan{selectedCount !== 1 ? 's' : ''}:
                    </Typography>
                    <Box component="ul" sx={{ my: 1, pl: 3 }}>
                        {bulkCategory !== NO_CHANGE &&
                            <li>Category → <strong>{categoryById[bulkCategory]?.category_name || '(unknown)'}</strong></li>}
                        {bulkClosed !== NO_CHANGE &&
                            <li>{bulkClosed === 1 ? 'Close (closed=1)' : 'Reopen (closed=0)'}</li>}
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

function TestPlansTableView({ plans, categoryById, onEdit, onDelete, onOpenDetail,
                                rowSelectionModel, setRowSelectionModel }) {
    const columns = [
        { field: 'id', headerName: 'ID', width: 70, type: 'number' },
        { field: 'title', headerName: 'Title', flex: 1, minWidth: 220 },
        {
            field: 'category_name', headerName: 'Category', width: 160,
            valueGetter: (_v, row) => categoryById[row.category_fk]?.category_name || '',
        },
        { field: 'create_ts', headerName: 'Created', width: 105, valueFormatter: formatDate },
        {
            field: '_actions', headerName: '', width: 100, sortable: false, filterable: false,
            renderCell: (p) => (
                <Box sx={{ display: 'flex', height: '100%', alignItems: 'center' }}>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEdit(p.row); }}>
                        <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDelete(p.row); }}>
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </Box>
            ),
        },
    ];
    const handleCellClick = (params) => {
        if (params.field === '__check__' || params.field === '_actions') return;
        onOpenDetail(params.row);
    };
    return (
        <DataGrid
            rows={plans}
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
            data-testid="test-plans-datagrid"
        />
    );
}

function TestPlansCardsView({ plans, categoryById, onEdit, onDelete, onOpenDetail }) {
    const byCategory = useMemo(() => {
        const g = {};
        for (const p of plans) {
            const k = p.category_fk || 'uncategorized';
            (g[k] = g[k] || []).push(p);
        }
        return g;
    }, [plans]);
    if (plans.length === 0) {
        return <Typography sx={{ color: 'text.secondary' }}>No plans match the current filters.</Typography>;
    }
    return (
        <Stack spacing={2} data-testid="test-plans-cards-view">
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
                                {group.map(p => (
                                    <Box key={p.id}
                                         sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.75,
                                                border: 1, borderColor: 'divider', borderRadius: 1,
                                                cursor: 'pointer',
                                                '&:hover': { bgcolor: 'action.hover' } }}
                                         onClick={() => onOpenDetail(p)}
                                         data-testid={`test-plan-row-${p.id}`}>
                                        <Typography sx={{ flex: 1, minWidth: 0,
                                                            overflow: 'hidden', textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap' }}>
                                            {p.title}
                                        </Typography>
                                        <IconButton size="small"
                                                    onClick={(e) => { e.stopPropagation(); onEdit(p); }}>
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                        <IconButton size="small"
                                                    onClick={(e) => { e.stopPropagation(); onDelete(p); }}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Box>
                                ))}
                            </Stack>
                        </CardContent>
                    </Card>
                );
            })}
        </Stack>
    );
}

function TestPlanEditDialog({ open, onClose, onSave, initial, categories }) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [category_fk, setCategoryFk] = useState('');

    useEffect(() => {
        if (!open) return;
        setTitle(initial?.title || '');
        setDescription(initial?.description || '');
        setCategoryFk(initial?.category_fk || (categories[0]?.id ?? ''));
    }, [open, initial, categories]);

    const submit = () => {
        if (!title || !category_fk) return;
        onSave({ title, description: description || null, category_fk });
    };
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="test-plan-edit-dialog">
            <DialogTitle>{initial ? 'Edit plan' : 'New test plan'}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <TextField autoFocus label="Title" value={title}
                               onChange={e => setTitle(e.target.value)}
                               required inputProps={{ 'data-testid': 'test-plan-title-input' }} />
                    <TextField label="Description" value={description}
                               onChange={e => setDescription(e.target.value)}
                               multiline minRows={3}
                               inputProps={{ 'data-testid': 'test-plan-description-input' }} />
                    <FormControl fullWidth required>
                        <InputLabel>Category</InputLabel>
                        <Select label="Category" value={category_fk}
                                onChange={e => setCategoryFk(e.target.value)}
                                data-testid="test-plan-category-select">
                            {categories.map(c => <MenuItem key={c.id} value={c.id}>{c.category_name}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} data-testid="test-plan-cancel-btn">Cancel</Button>
                <Button onClick={submit} variant="contained" disabled={!title || !category_fk}
                        data-testid="test-plan-save-btn">
                    {initial ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

function TestPlanDetail({ plan, onClose }) {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const creatorFk = profile?.userName;

    const { data: planCases = [], isLoading } = useTestPlanCases(creatorFk, plan.id);
    const { data: allTestCases = [] } = useAllTestCases(creatorFk, {
        fields: 'id,title,category_fk,test_type',
    });
    const { data: priorRuns = [] } = useTestRunsByPlan(creatorFk, plan.id);

    const [localOrder, setLocalOrder] = useState([]);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerSelection, setPickerSelection] = useState([]);

    useEffect(() => { setLocalOrder(planCases.map(pc => pc.test_case_fk)); }, [planCases]);

    const testCasesById = useMemo(() => {
        const m = {};
        for (const tc of allTestCases) m[tc.id] = tc;
        return m;
    }, [allTestCases]);

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: testPlanCaseKeys.byPlan(creatorFk, plan.id) });
    };

    const onDragEnd = async (result) => {
        if (!result.destination) return;
        const next = Array.from(localOrder);
        const [moved] = next.splice(result.source.index, 1);
        next.splice(result.destination.index, 0, moved);
        setLocalOrder(next);
        try {
            await reorderTestPlanCases(darwinUri, idToken, plan.id, next);
        } catch (e) {
            showError(e, 'Could not reorder (plan may be partially reordered on the server)');
        } finally {
            // Always invalidate: reorder is non-atomic (DELETE-all then POST-all) — partial
            // failure can leave the server with missing rows. The refetch syncs the UI to
            // server truth, which may differ from `next` OR from the pre-drag `planCases`.
            // Code-review req #2380.
            invalidate();
        }
    };

    const handleRemoveCase = async (caseId) => {
        try {
            await removeTestCaseFromPlan(darwinUri, idToken, plan.id, caseId);
            invalidate();
        } catch (e) {
            showError(e, 'Could not remove case');
        }
    };

    const handleAddSelection = async () => {
        try {
            const existing = new Set(localOrder);
            let nextOrder = localOrder.length + 1;
            for (const id of pickerSelection) {
                if (!existing.has(id)) {
                    await addTestCaseToPlan(darwinUri, idToken, plan.id, id, nextOrder);
                    nextOrder += 1;
                }
            }
            setPickerOpen(false); setPickerSelection([]);
            invalidate();
        } catch (e) {
            showError(e, 'Could not add cases to plan');
        }
    };

    return (
        <Dialog open={true} onClose={onClose} maxWidth="md" fullWidth data-testid="test-plan-detail">
            <DialogTitle>
                {plan.title}
                <Typography variant="caption" display="block">
                    {localOrder.length} case(s) · {priorRuns.length} prior run(s)
                </Typography>
            </DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                    <Button size="small" startIcon={<AddIcon />}
                            onClick={() => { setPickerSelection([]); setPickerOpen(true); }}
                            data-testid="add-case-to-plan-btn">
                        Add cases
                    </Button>
                </Box>
                {isLoading ? <CircularProgress />
                    : <DragDropContext onDragEnd={onDragEnd}>
                        <Droppable droppableId="plan-cases">
                            {(provided) => (
                                <Box ref={provided.innerRef} {...provided.droppableProps}
                                     data-testid="plan-case-dnd-list">
                                    {localOrder.map((caseId, index) => {
                                        const tc = testCasesById[caseId];
                                        return (
                                            <Draggable key={caseId} draggableId={String(caseId)} index={index}>
                                                {(dprov) => (
                                                    <Box ref={dprov.innerRef} {...dprov.draggableProps}
                                                         sx={{ display: 'flex', alignItems: 'center', gap: 1,
                                                                p: 1, border: 1, borderColor: 'divider',
                                                                borderRadius: 1, mb: 0.5,
                                                                bgcolor: 'background.paper' }}
                                                         data-testid={`plan-case-${caseId}`}>
                                                        <Box {...dprov.dragHandleProps}
                                                             data-testid={`plan-case-handle-${caseId}`}
                                                             sx={{ display: 'flex', alignItems: 'center',
                                                                    cursor: 'grab' }}>
                                                            <DragIndicatorIcon fontSize="small" />
                                                        </Box>
                                                        <Typography sx={{ flex: 1 }}>
                                                            {tc?.title || `(Test case ${caseId})`}
                                                        </Typography>
                                                        {tc?.test_type &&
                                                            <Chip label={tc.test_type} size="small" />}
                                                        <IconButton size="small"
                                                                    onClick={() => handleRemoveCase(caseId)}
                                                                    data-testid={`remove-case-${caseId}`}>
                                                            <DeleteIcon fontSize="small" />
                                                        </IconButton>
                                                    </Box>
                                                )}
                                            </Draggable>
                                        );
                                    })}
                                    {provided.placeholder}
                                    {localOrder.length === 0 &&
                                        <Typography sx={{ p: 2, color: 'text.secondary' }}>
                                            No cases in this plan yet. Click "Add cases" to add some.
                                        </Typography>
                                    }
                                </Box>
                            )}
                        </Droppable>
                    </DragDropContext>
                }
                {priorRuns.length > 0 && (
                    <>
                        <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>Prior runs</Typography>
                        <Stack spacing={0.5}>
                            {priorRuns.map(r => {
                                const rp = runStatusChipProps(r.run_status);
                                return (
                                    <Box key={r.id} sx={{ display: 'flex', alignItems: 'center', gap: 1,
                                                            p: 0.5, border: 1, borderColor: 'divider',
                                                            borderRadius: 1 }}>
                                        <Typography sx={{ flex: 1 }}>Run #{r.id}</Typography>
                                        <Chip label={r.run_status} size="small" {...rp} />
                                        <Typography variant="caption">
                                            {r.started_at ? new Date(r.started_at).toLocaleString() : ''}
                                        </Typography>
                                    </Box>
                                );
                            })}
                        </Stack>
                    </>
                )}
                <TestCasePicker open={pickerOpen}
                                 onClose={() => setPickerOpen(false)}
                                 testCases={allTestCases} existing={new Set(localOrder)}
                                 selection={pickerSelection} setSelection={setPickerSelection}
                                 onConfirm={handleAddSelection} />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
}

function TestCasePicker({ open, onClose, testCases, existing, selection, setSelection, onConfirm }) {
    const toggle = (id) =>
        setSelection(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="test-case-picker">
            <DialogTitle>Add test cases to plan</DialogTitle>
            <DialogContent>
                <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                    {testCases.filter(tc => !existing.has(tc.id)).map(tc => (
                        <Box key={tc.id}
                             sx={{ display: 'flex', alignItems: 'center', p: 1,
                                    borderBottom: 1, borderColor: 'divider', cursor: 'pointer' }}
                             onClick={() => toggle(tc.id)}
                             data-testid={`picker-case-${tc.id}`}>
                            <input type="checkbox" checked={selection.includes(tc.id)} readOnly
                                   style={{ marginRight: 8 }} />
                            <Typography>{tc.title}</Typography>
                        </Box>
                    ))}
                    {testCases.filter(tc => !existing.has(tc.id)).length === 0 &&
                        <Typography sx={{ p: 2 }}>All test cases are already in this plan.</Typography>}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={onConfirm} disabled={selection.length === 0}>
                    Add {selection.length} case(s)
                </Button>
            </DialogActions>
        </Dialog>
    );
}
