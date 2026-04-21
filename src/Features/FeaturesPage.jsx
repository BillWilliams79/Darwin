// /swarm/features — Features landing page (req #2380 Phase 1).
//
// Follows the exemplar view-switchable pattern from SwarmView / RequirementsTableView:
//   - No inline H5 title; toolbar row IS the header (borderBottom under Cards view)
//   - Cards view: one card per category, inline Edit/Delete buttons on each row
//   - Table view: MUI DataGrid with checkboxSelection + bulk-edit action bar +
//     bulk-edit dialog + confirmation gate (two-step save)
//   - onCellClick (not onRowClick) so clicking the checkbox column doesn't navigate
//   - Coverage dot (green ≥1 link / red 0 links) computed client-side

import { useState, useMemo, useContext, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { useAllFeatures, useAllCategories, useFeatureTestCaseLinks } from '../hooks/useDataQueries';
import { featureKeys, featureTestCaseKeys } from '../hooks/useQueryKeys';
import { useFeaturesFilterStore } from '../stores/useFeaturesFilterStore';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { createFeature, updateFeature, deleteFeature } from './actions/validationApi';
import {
    featureStatusChipProps, FEATURE_STATUS_ORDER, makeStatusComparator,
} from './statusChipStyles';

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

const VIEW_KEY = 'darwin-swarm-features-view';
const FEATURES_TABLE_WIDTH = 1000;
const NO_CHANGE = '__no_change__';

const GHERKIN_PLACEHOLDER = `**Given** <precondition>
**When** <action>
**Then** <observable outcome>`;

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : '';

export default function FeaturesPage() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);

    const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'cards');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);

    const categoryFilter = useFeaturesFilterStore(s => s.categoryFilter);
    const setCategoryFilter = useFeaturesFilterStore(s => s.setCategoryFilter);
    const statusFilter = useFeaturesFilterStore(s => s.statusFilter);
    const setStatusFilter = useFeaturesFilterStore(s => s.setStatusFilter);
    const coverageFilter = useFeaturesFilterStore(s => s.coverageFilter);
    const setCoverageFilter = useFeaturesFilterStore(s => s.setCoverageFilter);

    const creatorFk = profile?.userName;
    const { data: features = [], isLoading: loadingFeatures } = useAllFeatures(creatorFk, {
        fields: 'id,title,description,feature_status,category_fk,closed,sort_order,create_ts',
    });
    const { data: categories = [] } = useAllCategories(creatorFk, {
        fields: 'id,category_name,color,project_fk,closed',
        closed: 0,
    });
    const { data: links = [] } = useFeatureTestCaseLinks(creatorFk);

    const coverageByFeature = useMemo(() => {
        const map = {};
        for (const l of links) map[l.feature_fk] = (map[l.feature_fk] || 0) + 1;
        return map;
    }, [links]);

    const categoryById = useMemo(() => {
        const m = {};
        for (const c of categories) m[c.id] = c;
        return m;
    }, [categories]);

    const filtered = useMemo(() => {
        return features.filter(f => {
            if (categoryFilter !== null && f.category_fk !== categoryFilter) return false;
            if (statusFilter !== 'all' && f.feature_status !== statusFilter) return false;
            const linkedCount = coverageByFeature[f.id] || 0;
            if (coverageFilter === 'covered' && linkedCount === 0) return false;
            if (coverageFilter === 'uncovered' && linkedCount > 0) return false;
            return true;
        });
    }, [features, coverageByFeature, categoryFilter, statusFilter, coverageFilter]);

    // ---- bulk selection + bulk edit (mirrors RequirementsTableView) ----
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
    const [bulkStatus, setBulkStatus] = useState(NO_CHANGE);
    const [savingBulk, setSavingBulk] = useState(false);
    const hasBulkChanges = bulkCategory !== NO_CHANGE || bulkStatus !== NO_CHANGE;

    const resetBulk = () => { setBulkCategory(NO_CHANGE); setBulkStatus(NO_CHANGE); };
    const openBulkEdit = () => { resetBulk(); setBulkDialogOpen(true); };
    const closeBulkEdit = () => { if (!savingBulk) setBulkDialogOpen(false); };
    const requestConfirm = () => {
        if (!hasBulkChanges || selectedCount === 0) return;
        setBulkConfirmOpen(true);
    };
    const cancelConfirm = () => { if (!savingBulk) setBulkConfirmOpen(false); };
    const applyBulk = async () => {
        const ids = getSelectedIds();
        if (!ids.length || !hasBulkChanges) return;
        const update = {};
        if (bulkCategory !== NO_CHANGE) update.category_fk = bulkCategory;
        if (bulkStatus !== NO_CHANGE) update.feature_status = bulkStatus;
        setSavingBulk(true);
        let succeeded = false;
        try {
            await Promise.all(ids.map(id => updateFeature(darwinUri, idToken, id, update)));
            succeeded = true;
        } catch (e) {
            showError(e, 'Bulk update failed (some rows may have been updated)');
        } finally {
            // Always invalidate: even on partial failure, some rows may have succeeded,
            // and the UI must reflect server reality immediately (code-review req #2380).
            queryClient.invalidateQueries({ queryKey: featureKeys.all(creatorFk) });
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

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: featureKeys.all(creatorFk) });
        queryClient.invalidateQueries({ queryKey: featureTestCaseKeys.all(creatorFk) });
    };

    const openAdd = () => { setEditTarget(null); setDialogOpen(true); };
    const openEdit = (feature) => { setEditTarget(feature); setDialogOpen(true); };

    const handleSave = async (values) => {
        try {
            if (editTarget) await updateFeature(darwinUri, idToken, editTarget.id, values);
            else await createFeature(darwinUri, idToken, values);
            invalidateAll();
            setDialogOpen(false);
        } catch (e) {
            showError(e, editTarget ? 'Could not save feature' : 'Could not create feature');
        }
    };

    const handleDelete = async (feature) => {
        if (!window.confirm(`Delete feature "${feature.title}"? Linked test_cases are unaffected.`)) return;
        try {
            await deleteFeature(darwinUri, idToken, feature.id);
            invalidateAll();
        } catch (e) {
            showError(e, 'Could not delete feature');
        }
    };

    return (
        <Box className="app-content-planpage">
            {/* Row A — toolbar (exemplar: SwarmView line 209). No separate title;
                the toolbar row IS the page header. borderBottom in Cards view
                mirrors the exemplar. Table view caps maxWidth to the table width
                so controls align flush with the table's right edge. */}
            <Box className="app-content-view-toggle"
                 sx={{
                     display: 'flex', alignItems: 'center', gap: 2,
                     mt: 3, mb: 1, px: 3,
                     flexWrap: 'nowrap',
                     ...(view === 'cards' && { borderBottom: 1, borderColor: 'divider' }),
                     ...(view === 'table' && { maxWidth: FEATURES_TABLE_WIDTH }),
                 }}
                 data-testid="features-toolbar-row">
                <ToggleButtonGroup value={view} exclusive onChange={handleViewChange} size="small"
                                   sx={{ flexShrink: 0 }}
                                   data-testid="features-view-toggle">
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

                <FormControl size="small" sx={{ minWidth: 120, flexShrink: 0 }}>
                    <InputLabel>Status</InputLabel>
                    <Select label="Status" value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            data-testid="status-filter">
                        <MenuItem value="all">All</MenuItem>
                        <MenuItem value="draft">Draft</MenuItem>
                        <MenuItem value="active">Active</MenuItem>
                        <MenuItem value="deprecated">Deprecated</MenuItem>
                    </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 130, flexShrink: 0 }}>
                    <InputLabel>Coverage</InputLabel>
                    <Select label="Coverage" value={coverageFilter}
                            onChange={e => setCoverageFilter(e.target.value)}
                            data-testid="coverage-filter">
                        <MenuItem value="all">All</MenuItem>
                        <MenuItem value="covered">Covered</MenuItem>
                        <MenuItem value="uncovered">Uncovered</MenuItem>
                    </Select>
                </FormControl>

                {view === 'table' && <Box sx={{ flexGrow: 1 }} />}

                <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}
                        sx={{ flexShrink: 0 }} data-testid="new-feature-btn">
                    New Feature
                </Button>
            </Box>

            {/* Content area */}
            {loadingFeatures
                ? <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>
                : view === 'cards'
                    ? (
                        <Box className="app-content-tabpanel" sx={{ p: 3 }}>
                            <FeaturesCardsView features={filtered} coverage={coverageByFeature}
                                                categoryById={categoryById}
                                                onEdit={openEdit} onDelete={handleDelete} />
                        </Box>
                    )
                    : (
                        <Box className="app-content-tabpanel"
                             sx={{ px: 3, pt: 0, maxWidth: FEATURES_TABLE_WIDTH }}>
                            {/* Bulk edit action bar — mirrors RequirementsTableView line 223 */}
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
                            <FeaturesTableView
                                features={filtered}
                                coverage={coverageByFeature}
                                categoryById={categoryById}
                                onEdit={openEdit} onDelete={handleDelete}
                                rowSelectionModel={rowSelectionModel}
                                setRowSelectionModel={setRowSelectionModel}
                            />
                        </Box>
                    )
            }

            <FeatureEditDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                onSave={handleSave}
                initial={editTarget}
                categories={categories}
            />

            <BulkEditDialog
                open={bulkDialogOpen} onClose={closeBulkEdit}
                selectedCount={selectedCount}
                bulkCategory={bulkCategory} setBulkCategory={setBulkCategory}
                bulkStatus={bulkStatus} setBulkStatus={setBulkStatus}
                categories={categories}
                onSave={requestConfirm}
                savingBulk={savingBulk}
                hasBulkChanges={hasBulkChanges}
            />

            <BulkConfirmDialog
                open={bulkConfirmOpen} onClose={cancelConfirm}
                selectedCount={selectedCount}
                bulkCategory={bulkCategory} bulkStatus={bulkStatus}
                categoryById={categoryById}
                savingBulk={savingBulk}
                onConfirm={applyBulk}
            />
        </Box>
    );
}

// ------- Cards view -------
function FeaturesCardsView({ features, coverage, categoryById, onEdit, onDelete }) {
    const byCategory = useMemo(() => {
        const g = {};
        for (const f of features) {
            const k = f.category_fk || 'uncategorized';
            (g[k] = g[k] || []).push(f);
        }
        return g;
    }, [features]);

    if (features.length === 0) {
        return <Typography sx={{ color: 'text.secondary' }}>No features match the current filters.</Typography>;
    }

    return (
        <Stack spacing={2} data-testid="features-cards-view">
            {Object.entries(byCategory).map(([cid, group]) => {
                const cat = categoryById[cid];
                return (
                    <Card key={cid} variant="outlined"
                          sx={cat?.color ? { borderLeft: `4px solid ${cat.color}` } : undefined}
                          data-testid={`features-card-${cid}`}>
                        <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                            <Typography variant="h6" sx={{ mb: 1 }}>
                                {cat?.category_name || '(uncategorized)'}
                                <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                                    ({group.length})
                                </Typography>
                            </Typography>
                            <Stack spacing={0.5}>
                                {group.map(f => {
                                    const linkedCount = coverage[f.id] || 0;
                                    const chipProps = featureStatusChipProps(f.feature_status);
                                    return (
                                        <Box key={f.id}
                                             sx={{ display: 'flex', alignItems: 'center', gap: 1,
                                                    p: 0.75, border: 1, borderColor: 'divider',
                                                    borderRadius: 1,
                                                    '&:hover': { bgcolor: 'action.hover' } }}
                                             data-testid={`feature-row-${f.id}`}>
                                            <Box data-testid={`coverage-dot-${f.id}`}
                                                 sx={{ width: 10, height: 10, borderRadius: '50%',
                                                        bgcolor: linkedCount >= 1 ? 'success.main' : 'error.main',
                                                        flexShrink: 0 }}
                                                 title={linkedCount >= 1
                                                    ? `Covered — ${linkedCount} linked test case(s)`
                                                    : 'Uncovered — no linked test cases'} />
                                            <Typography sx={{ flex: 1, minWidth: 0,
                                                                overflow: 'hidden', textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap' }}>
                                                {f.title}
                                            </Typography>
                                            <Chip label={f.feature_status} size="small"
                                                  sx={{ ...chipProps.sx, textTransform: 'capitalize' }} />
                                            <IconButton size="small" onClick={() => onEdit(f)}
                                                        data-testid={`edit-feature-${f.id}`}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                            <IconButton size="small" onClick={() => onDelete(f)}
                                                        data-testid={`delete-feature-${f.id}`}>
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
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

// ------- Table view -------
function FeaturesTableView({ features, coverage, categoryById, onEdit, onDelete,
                              rowSelectionModel, setRowSelectionModel }) {
    const columns = [
        { field: 'id', headerName: 'ID', width: 70, type: 'number' },
        { field: 'title', headerName: 'Title', flex: 1, minWidth: 200 },
        {
            field: 'category_name', headerName: 'Category', width: 150,
            valueGetter: (_v, row) => categoryById[row.category_fk]?.category_name || '',
        },
        {
            field: 'feature_status', headerName: 'Status', width: 130,
            sortComparator: makeStatusComparator(FEATURE_STATUS_ORDER),
            renderCell: (p) => {
                const props = featureStatusChipProps(p.value);
                return (
                    <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                        <Chip label={p.value} size="small"
                              sx={{ ...props.sx, textTransform: 'capitalize' }} />
                    </Box>
                );
            },
        },
        {
            field: 'linked_count', headerName: 'Linked TCs', width: 120, type: 'number',
            valueGetter: (_v, row) => coverage[row.id] || 0,
            renderCell: (p) => (
                <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', gap: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%',
                                bgcolor: p.value >= 1 ? 'success.main' : 'error.main' }} />
                    {p.value}
                </Box>
            ),
        },
        { field: 'create_ts', headerName: 'Created', width: 105, valueFormatter: formatDate },
        {
            field: '_actions', headerName: '', width: 80, sortable: false, filterable: false,
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
        onEdit(params.row);
    };

    return (
        <DataGrid
            rows={features}
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
            data-testid="features-datagrid"
        />
    );
}

// ------- Edit / Create dialog -------
function FeatureEditDialog({ open, onClose, onSave, initial, categories }) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [feature_status, setFeatureStatus] = useState('draft');
    const [category_fk, setCategoryFk] = useState('');

    useEffect(() => {
        if (!open) return;
        setTitle(initial?.title || '');
        setDescription(initial?.description || '');
        setFeatureStatus(initial?.feature_status || 'draft');
        setCategoryFk(initial?.category_fk || (categories[0]?.id ?? ''));
    }, [open, initial, categories]);

    const submit = () => {
        if (!title || !description || !category_fk) return;
        onSave({ title, description, feature_status, category_fk });
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth data-testid="feature-edit-dialog">
            <DialogTitle>{initial ? 'Edit feature' : 'New feature'}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <TextField autoFocus label="Title" value={title} onChange={e => setTitle(e.target.value)}
                               required inputProps={{ 'data-testid': 'feature-title-input' }} />
                    <TextField label="Description (Gherkin recommended)" value={description}
                               onChange={e => setDescription(e.target.value)}
                               placeholder={GHERKIN_PLACEHOLDER}
                               multiline minRows={6} required
                               inputProps={{ 'data-testid': 'feature-description-input' }} />
                    <FormControl fullWidth>
                        <InputLabel>Status</InputLabel>
                        <Select label="Status" value={feature_status}
                                onChange={e => setFeatureStatus(e.target.value)}
                                data-testid="feature-status-select">
                            <MenuItem value="draft">Draft</MenuItem>
                            <MenuItem value="active">Active</MenuItem>
                            <MenuItem value="deprecated">Deprecated</MenuItem>
                        </Select>
                    </FormControl>
                    <FormControl fullWidth required>
                        <InputLabel>Category</InputLabel>
                        <Select label="Category" value={category_fk}
                                onChange={e => setCategoryFk(e.target.value)}
                                data-testid="feature-category-select">
                            {categories.map(c => <MenuItem key={c.id} value={c.id}>{c.category_name}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} data-testid="feature-cancel-btn">Cancel</Button>
                <Button onClick={submit} variant="contained"
                        disabled={!title || !description || !category_fk}
                        data-testid="feature-save-btn">
                    {initial ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ------- Bulk edit dialog -------
function BulkEditDialog({ open, onClose, selectedCount, bulkCategory, setBulkCategory,
                           bulkStatus, setBulkStatus, categories, onSave, savingBulk,
                           hasBulkChanges }) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="bulk-edit-dialog">
            <DialogTitle>
                Edit {selectedCount} Selected Feature{selectedCount !== 1 ? 's' : ''}
            </DialogTitle>
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
                        <InputLabel>Status</InputLabel>
                        <Select label="Status" value={bulkStatus}
                                onChange={e => setBulkStatus(e.target.value)}
                                data-testid="bulk-status-select">
                            <MenuItem value={NO_CHANGE}><em>No change</em></MenuItem>
                            <MenuItem value="draft">Draft</MenuItem>
                            <MenuItem value="active">Active</MenuItem>
                            <MenuItem value="deprecated">Deprecated</MenuItem>
                        </Select>
                    </FormControl>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={savingBulk}>Cancel</Button>
                <Button variant="contained" onClick={onSave}
                        disabled={!hasBulkChanges || savingBulk}
                        data-testid="bulk-save-button">
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ------- Bulk confirm gate -------
function BulkConfirmDialog({ open, onClose, selectedCount, bulkCategory, bulkStatus,
                              categoryById, savingBulk, onConfirm }) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="bulk-confirm-dialog">
            <DialogTitle>Confirm Bulk Update</DialogTitle>
            <DialogContent>
                <Typography sx={{ mb: 1 }}>
                    You are about to update <strong>{selectedCount}</strong> feature{selectedCount !== 1 ? 's' : ''}:
                </Typography>
                <Box component="ul" sx={{ my: 1, pl: 3 }}>
                    {bulkCategory !== NO_CHANGE && (
                        <li>Category → <strong>{categoryById[bulkCategory]?.category_name || '(unknown)'}</strong></li>
                    )}
                    {bulkStatus !== NO_CHANGE && (
                        <li>Status → <strong style={{ textTransform: 'capitalize' }}>{bulkStatus}</strong></li>
                    )}
                </Box>
                <Alert severity="warning" sx={{ mt: 2 }}>This action cannot be easily undone.</Alert>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={savingBulk}>Cancel</Button>
                <Button variant="contained" color="warning" onClick={onConfirm} disabled={savingBulk}
                        data-testid="bulk-confirm-button">
                    {savingBulk ? 'Applying...' : 'Yes, Apply Changes'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
