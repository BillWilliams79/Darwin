import React, { useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import EditIcon from '@mui/icons-material/Edit';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { useQueryClient } from '@tanstack/react-query';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useAllRequirements, useAllCategories, useSessions } from '../hooks/useDataQueries';
import { requirementKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { requirementStatusChipProps, requirementStatusLabel } from './statusChipStyles';
import { swarmStatusChipProps, swarmStatusLabel } from './swarmStatusChipProps';
import { useShowClosedStore, ALL_REQUIREMENT_STATUSES } from '../stores/useShowClosedStore';
import { useRequirementDrillStore } from '../stores/useRequirementDrillStore';
import { requirementBucketKey } from '../utils/aggregateRequirementTrends';

// Exact column width sum + DataGrid chrome (borders + column separators + scrollbar gutter
// + checkbox column). Exported so SwarmView.jsx can align the header row (toggle + chips +
// settings) to the same width — keeps the settings icon flush with the table's right edge.
// Columns: checkbox(50) + id(70) + category(150) + title(220) + status(140)
//          + autonomy(110) + sessions(200) + created(105) + completed(105) = 1150
export const SWARM_TABLE_WIDTH = 1200;

const FIELDS = 'id,title,requirement_status,category_fk,coordination_type,completed_at,create_ts';

const WRAP_CELL_SX = {
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    lineHeight: 1.3,
    py: 1,
    display: 'flex',
    alignItems: 'center',
    width: '100%',
};

const STATUS_SORT_ORDER = {
    authoring: 0, approved: 1, swarm_ready: 2, development: 3, deferred: 4, met: 5, wontfix: 6,
};

const AUTONOMY_OPTIONS = ['discuss', 'planned', 'implemented', 'deployed'];

const NO_CHANGE = '__no_change__';

// Same matcher used by CategoryCard — handles the legacy `priority:` prefix as
// well as the current `requirement:` prefix.
const SOURCE_REF_RE = /^(priority|requirement):(\d+)$/;

const statusComparator = (v1, v2) => (STATUS_SORT_ORDER[v1] ?? 99) - (STATUS_SORT_ORDER[v2] ?? 99);

const formatDate = (value) => {
    if (!value) return '';
    return new Date(value).toLocaleDateString();
};

const RequirementsTableView = () => {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const creatorFk = profile?.userName;

    const requirementStatusFilter = useShowClosedStore(s => s.requirementStatusFilter);
    const drill = useRequirementDrillStore(s => s.drill);
    const clearDrill = useRequirementDrillStore(s => s.clearDrill);
    const showError = useSnackBarStore(s => s.showError);

    const { data: requirements = [], isLoading: reqLoading } = useAllRequirements(creatorFk, { fields: FIELDS });
    const { data: categories = [], isLoading: catLoading } = useAllCategories(creatorFk, {
        fields: 'id,category_name',
        closed: 0,
    });
    const { data: sessions = [] } = useSessions(creatorFk);

    const categoryMap = useMemo(() => {
        const m = new Map();
        for (const c of categories) m.set(c.id, c.category_name);
        return m;
    }, [categories]);

    // requirement_id -> sessions linked via source_ref, newest first.
    const sessionsByRequirementId = useMemo(() => {
        const m = new Map();
        for (const s of sessions) {
            const match = s.source_ref && s.source_ref.match(SOURCE_REF_RE);
            if (!match) continue;
            const reqId = parseInt(match[2], 10);
            const list = m.get(reqId) || [];
            list.push({ id: s.id, swarm_status: s.swarm_status });
            m.set(reqId, list);
        }
        for (const list of m.values()) list.sort((a, b) => b.id - a.id);
        return m;
    }, [sessions]);

    const sortedCategories = useMemo(() => {
        return [...categories].sort((a, b) => (a.category_name || '').localeCompare(b.category_name || ''));
    }, [categories]);

    // Filter out:
    //  - Requirements whose status isn't in the chip filter
    //  - Requirements linked to closed categories (categoryMap only has open ones)
    //
    // req #2850 — when a Trends drill-down is active, the chips are bypassed entirely:
    // the table shows exactly the Met requirements in the clicked time bucket (and
    // category, if a split segment was clicked). Matching reuses the chart's bucket
    // keying (`requirementBucketKey`) so the row set equals the bar that was clicked.
    const filteredRequirements = useMemo(() => {
        if (drill) {
            // categoryIds: explicit set the chart showed (a split segment → one id, or
            // a narrowed chip selection → that subset). Honored even for closed
            // categories (categoryMap only carries open ones) so the table matches the
            // clicked bar exactly. null → all visible categories, in which case mirror
            // the chart's closed-category visibility (open-only by default).
            const catSet = drill.categoryIds ? new Set(drill.categoryIds) : null;
            return requirements.filter(r => {
                // Only MET requirements — keep parity with the chart, which counts
                // requirement_status === 'met' (wontfix is excluded though it too
                // stamps completed_at — req #2850).
                if (r.requirement_status !== 'met') return false;
                if (!r.completed_at) return false;
                if (requirementBucketKey(r.completed_at, drill.timeframe) !== drill.bucketKey) return false;
                if (catSet) return catSet.has(r.category_fk);
                return drill.includeClosed || categoryMap.has(r.category_fk);
            });
        }
        return requirements.filter(r =>
            requirementStatusFilter.includes(r.requirement_status) &&
            categoryMap.has(r.category_fk)
        );
    }, [requirements, requirementStatusFilter, categoryMap, drill]);

    // Multi-select state (v8 DataGrid shape: include=only these ids, exclude=all except these).
    // Both selectedCount and getSelectedIds are intersected with `filteredRequirements`
    // so that when the filter changes (chips toggled, closed-category requirements pruned,
    // or cache refetched), stale selections don't leak into the bulk PUT.
    const [rowSelectionModel, setRowSelectionModel] = useState({ type: 'include', ids: new Set() });
    const visibleIds = useMemo(() => new Set(filteredRequirements.map(r => r.id)), [filteredRequirements]);
    const selectedCount = rowSelectionModel.type === 'include'
        ? [...rowSelectionModel.ids].filter(id => visibleIds.has(id)).length
        : filteredRequirements.filter(r => !rowSelectionModel.ids.has(r.id)).length;
    const getSelectedIds = () => rowSelectionModel.type === 'include'
        ? [...rowSelectionModel.ids].filter(id => visibleIds.has(id))
        : filteredRequirements.filter(r => !rowSelectionModel.ids.has(r.id)).map(r => r.id);

    // Bulk edit dialog state
    const [bulkEditDialogOpen, setBulkEditDialogOpen] = useState(false);
    const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
    const [bulkCategory, setBulkCategory] = useState(NO_CHANGE);
    const [bulkStatus, setBulkStatus] = useState(NO_CHANGE);
    const [bulkAutonomy, setBulkAutonomy] = useState(NO_CHANGE);
    const [savingBulk, setSavingBulk] = useState(false);

    const resetBulkDialog = () => {
        setBulkCategory(NO_CHANGE);
        setBulkStatus(NO_CHANGE);
        setBulkAutonomy(NO_CHANGE);
    };

    const handleOpenBulkEdit = () => {
        resetBulkDialog();
        setBulkEditDialogOpen(true);
    };

    const handleCloseBulkEdit = () => {
        if (!savingBulk) setBulkEditDialogOpen(false);
    };

    const hasBulkChanges = bulkCategory !== NO_CHANGE || bulkStatus !== NO_CHANGE || bulkAutonomy !== NO_CHANGE;

    // Step 1: Save button opens the confirmation gate (does NOT apply changes yet)
    const handleRequestConfirm = () => {
        if (!hasBulkChanges || selectedCount === 0) return;
        setBulkConfirmOpen(true);
    };

    const handleCancelConfirm = () => {
        if (!savingBulk) setBulkConfirmOpen(false);
    };

    // Step 2: Confirm button in the gate dialog actually applies the changes
    const handleConfirmBulkSave = async () => {
        const ids = getSelectedIds();
        if (ids.length === 0 || !hasBulkChanges) return;

        const update = {};
        if (bulkCategory !== NO_CHANGE) update.category_fk = bulkCategory;
        if (bulkStatus !== NO_CHANGE) update.requirement_status = bulkStatus;
        if (bulkAutonomy !== NO_CHANGE) update.coordination_type = bulkAutonomy;

        setSavingBulk(true);
        try {
            const body = ids.map(id => ({ id, ...update }));
            const result = await call_rest_api(`${darwinUri}/requirements`, 'PUT', body, idToken);
            if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                showError(result, 'Bulk update failed');
            } else {
                queryClient.invalidateQueries({ queryKey: requirementKeys.all(creatorFk) });
                setRowSelectionModel({ type: 'include', ids: new Set() });
                setBulkConfirmOpen(false);
                setBulkEditDialogOpen(false);
                resetBulkDialog();
            }
        } catch (error) {
            showError(error, 'Bulk update failed');
        } finally {
            setSavingBulk(false);
        }
    };

    const handleCellClick = (params) => {
        // Don't navigate when clicking the checkbox column
        if (params.field === '__check__') return;
        navigate(`/swarm/requirement/${params.row.id}`);
    };

    const columns = [
        { field: 'id', headerName: 'ID', width: 70, type: 'number' },
        {
            field: 'category_name',
            headerName: 'Category',
            width: 150,
            valueGetter: (value, row) => categoryMap.get(row.category_fk) || '',
        },
        {
            field: 'title',
            headerName: 'Title',
            width: 220,
            renderCell: (params) => (
                <Box sx={WRAP_CELL_SX}>{params.value}</Box>
            ),
        },
        {
            field: 'requirement_status',
            headerName: 'Status',
            width: 140,
            sortComparator: statusComparator,
            renderCell: (params) => {
                const chipProps = requirementStatusChipProps(params.value);
                return (
                    <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                        <Chip
                            label={requirementStatusLabel(params.value)}
                            size="small"
                            sx={{ ...chipProps.sx, textTransform: 'capitalize' }}
                        />
                    </Box>
                );
            },
        },
        { field: 'coordination_type', headerName: 'Autonomy', width: 110 },
        {
            field: 'sessions',
            headerName: 'Sessions',
            width: 200,
            filterable: false,
            disableExport: true,
            valueGetter: (value, row) => sessionsByRequirementId.get(row.id) || [],
            // Sort by newest linked session id (first chip in the row). Buckets
            // are pre-sorted desc, so list[0].id is the max. Empty buckets sort
            // last in ascending order via -Infinity.
            sortComparator: (a, b) => {
                const aId = a && a.length ? a[0].id : -Infinity;
                const bId = b && b.length ? b[0].id : -Infinity;
                return aId - bId;
            },
            renderCell: (params) => {
                const list = params.value || [];
                if (list.length === 0) {
                    return <Box sx={{ ...WRAP_CELL_SX, color: 'text.secondary' }}>—</Box>;
                }
                return (
                    <Box sx={{
                        ...WRAP_CELL_SX,
                        flexWrap: 'wrap',
                        gap: 0.5,
                    }}>
                        {list.map(s => {
                            const chipProps = swarmStatusChipProps(s.swarm_status);
                            return (
                                <Chip
                                    key={s.id}
                                    label={`#${s.id}`}
                                    size="small"
                                    {...chipProps}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/swarm/session/${s.id}`);
                                    }}
                                    sx={{ ...chipProps.sx, cursor: 'pointer' }}
                                    data-testid={`requirement-session-chip-${s.id}`}
                                />
                            );
                        })}
                    </Box>
                );
            },
        },
        { field: 'create_ts', headerName: 'Created', width: 105, valueFormatter: formatDate },
        { field: 'completed_at', headerName: 'Completed', width: 105, valueFormatter: formatDate },
    ];

    if (reqLoading || catLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    const drillPillLabel = drill
        ? `Met • ${drill.categoryName ? `${drill.categoryName} • ` : ''}${drill.label}`
        : '';

    return (
        <Box sx={{ px: 3, pt: 0, maxWidth: SWARM_TABLE_WIDTH }}>
            {/* Trends drill-down pill (req #2850) — describes the clicked time bucket
                (+ category) and clears the drill on delete, restoring the normal
                status-chip-filtered table. */}
            {drill && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Chip
                        icon={<CalendarTodayIcon />}
                        label={drillPillLabel}
                        variant="outlined"
                        size="small"
                        onDelete={clearDrill}
                        sx={{
                            borderColor: '#E91E63',
                            color: '#E91E63',
                            '& .MuiChip-icon': { color: '#E91E63' },
                            '& .MuiChip-deleteIcon': { color: '#E91E63', '&:hover': { color: '#C2185B' } },
                        }}
                        data-testid="requirements-drill-pill"
                    />
                    <Typography variant="body2" color="text.secondary">
                        {filteredRequirements.length} requirement{filteredRequirements.length !== 1 ? 's' : ''} met
                    </Typography>
                </Box>
            )}

            {/* Bulk edit action bar — mirrors MapRunsView: outlined button, EditIcon,
                right-aligned, label "Edit Selected (N)". */}
            {selectedCount > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, mb: 0.5 }}
                     data-testid="bulk-edit-bar">
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<EditIcon />}
                        onClick={handleOpenBulkEdit}
                        disabled={savingBulk}
                        data-testid="bulk-edit-button"
                    >
                        Edit Selected ({selectedCount})
                    </Button>
                </Box>
            )}

            {/* Wrap the DataGrid in a Box that carries the testid: MUI X v8 does not
                forward an arbitrary `data-testid` prop to a queryable DOM node, so the
                testid must live on a real element (mirrors DevServersView's pattern). */}
            <Box data-testid="requirements-datagrid">
                <DataGrid
                    rows={filteredRequirements}
                    columns={columns}
                    loading={reqLoading || catLoading}
                    getRowHeight={() => 'auto'}
                    slots={{ toolbar: GridToolbar }}
                    slotProps={{ toolbar: { showQuickFilter: true } }}
                    initialState={{
                        pagination: {
                            paginationModel: { pageSize: 25 },
                        },
                    }}
                    pageSizeOptions={[25, 50, 100]}
                    checkboxSelection
                    disableRowSelectionOnClick
                    rowSelectionModel={rowSelectionModel}
                    onRowSelectionModelChange={setRowSelectionModel}
                    onCellClick={handleCellClick}
                    density="compact"
                    sx={{ cursor: 'pointer' }}
                />
            </Box>

            {/* Bulk edit dialog */}
            <Dialog
                open={bulkEditDialogOpen}
                onClose={handleCloseBulkEdit}
                maxWidth="sm"
                fullWidth
                data-testid="bulk-edit-dialog"
            >
                <DialogTitle>
                    Edit {selectedCount} Selected Requirement{selectedCount !== 1 ? 's' : ''}
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel id="bulk-category-label">Category</InputLabel>
                            <Select
                                labelId="bulk-category-label"
                                value={bulkCategory}
                                label="Category"
                                onChange={(e) => setBulkCategory(e.target.value)}
                                data-testid="bulk-category-select"
                            >
                                <MenuItem value={NO_CHANGE}><em>No change</em></MenuItem>
                                {sortedCategories.map(cat => (
                                    <MenuItem key={cat.id} value={cat.id}>{cat.category_name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl fullWidth size="small">
                            <InputLabel id="bulk-status-label">Status</InputLabel>
                            <Select
                                labelId="bulk-status-label"
                                value={bulkStatus}
                                label="Status"
                                onChange={(e) => setBulkStatus(e.target.value)}
                                data-testid="bulk-status-select"
                            >
                                <MenuItem value={NO_CHANGE}><em>No change</em></MenuItem>
                                {ALL_REQUIREMENT_STATUSES.map(status => (
                                    <MenuItem key={status} value={status} sx={{ textTransform: 'capitalize' }}>
                                        {requirementStatusLabel(status)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl fullWidth size="small">
                            <InputLabel id="bulk-autonomy-label">Autonomy</InputLabel>
                            <Select
                                labelId="bulk-autonomy-label"
                                value={bulkAutonomy}
                                label="Autonomy"
                                onChange={(e) => setBulkAutonomy(e.target.value)}
                                data-testid="bulk-autonomy-select"
                            >
                                <MenuItem value={NO_CHANGE}><em>No change</em></MenuItem>
                                {AUTONOMY_OPTIONS.map(opt => (
                                    <MenuItem key={opt} value={opt} sx={{ textTransform: 'capitalize' }}>
                                        {opt}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseBulkEdit} disabled={savingBulk}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleRequestConfirm}
                        disabled={!hasBulkChanges || savingBulk}
                        data-testid="bulk-save-button"
                    >
                        Save
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Confirmation gate — prevents accidental bulk updates. Shows a summary of
                what will change so the user can verify before applying. */}
            <Dialog
                open={bulkConfirmOpen}
                onClose={handleCancelConfirm}
                maxWidth="sm"
                fullWidth
                data-testid="bulk-confirm-dialog"
            >
                <DialogTitle>Confirm Bulk Update</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1 }}>
                        You are about to update <strong>{selectedCount}</strong> requirement{selectedCount !== 1 ? 's' : ''}:
                    </Typography>
                    <Box component="ul" sx={{ my: 1, pl: 3 }}>
                        {bulkCategory !== NO_CHANGE && (
                            <li>
                                Category → <strong>{categoryMap.get(bulkCategory) || '(unknown)'}</strong>
                            </li>
                        )}
                        {bulkStatus !== NO_CHANGE && (
                            <li>
                                Status → <strong style={{ textTransform: 'capitalize' }}>
                                    {requirementStatusLabel(bulkStatus)}
                                </strong>
                            </li>
                        )}
                        {bulkAutonomy !== NO_CHANGE && (
                            <li>
                                Autonomy → <strong style={{ textTransform: 'capitalize' }}>{bulkAutonomy}</strong>
                            </li>
                        )}
                    </Box>
                    <Alert severity="warning" sx={{ mt: 2 }}>
                        This action cannot be easily undone.
                    </Alert>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCancelConfirm} disabled={savingBulk}>Cancel</Button>
                    <Button
                        variant="contained"
                        color="warning"
                        onClick={handleConfirmBulkSave}
                        disabled={savingBulk}
                        data-testid="bulk-confirm-button"
                    >
                        {savingBulk ? 'Applying...' : 'Yes, Apply Changes'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default RequirementsTableView;
