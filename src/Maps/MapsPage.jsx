import React, { useState, useCallback, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import LinearProgress from '@mui/material/LinearProgress';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import BackupRoundedIcon from '@mui/icons-material/BackupRounded';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import RouteIcon from '@mui/icons-material/Route';
import PeopleIcon from '@mui/icons-material/People';
import BarChartIcon from '@mui/icons-material/BarChart';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import { IS_MACOS } from '../photo-browser/proxyConfig.js';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { useMapRuns, useMapRoutes, useMapViews, useMapPartners, useMapRunPartners } from '../hooks/useDataQueries';
import { mapRunKeys, mapRouteKeys, mapPartnerKeys } from '../hooks/useQueryKeys';
import MapRunsView, { TABLE_WIDTH } from '../MapRuns/MapRunsView';
import RouteCardView from '../RouteCards/RouteCardView';
import TrendsView from '../Trends/TrendsView';
import ViewBar from './ViewBar';
import ViewDialog from './ViewDialog';
import ExportDialog from '../MapExport/ExportDialog';
import TrendsFilterChips from './TrendsFilterChips';
import PickerDialog from './PickerDialog';
import { useActiveMapViewStore } from '../stores/useActiveMapViewStore';
import { useTrendsStore } from '../stores/useTrendsStore';
import { applyViewFilter } from '../utils/mapViewFilter';
import { navigateTimeframe, DRILL_DOWN } from '../utils/trendsNavigation';

const STORAGE_KEY = 'darwin-maps-view';

const MapsPage = () => {
    const navigate = useNavigate();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const queryClient = useQueryClient();
    const creatorFk = profile?.id;

    // Data fetching (centralized — children receive as props)
    const { data: allRuns = [], isLoading: runsLoading } = useMapRuns(creatorFk);
    const { data: routes = [], isLoading: routesLoading } = useMapRoutes(creatorFk);
    const { data: views = [] } = useMapViews(creatorFk);
    const { data: partners = [] } = useMapPartners(creatorFk);
    const { data: runPartners = [] } = useMapRunPartners(creatorFk);

    const [view, setView] = useState(() => localStorage.getItem(STORAGE_KEY) || 'cards');
    const {
        metric, timeframe, chartType, timeFilter,
        selectedRouteIds, selectedPartnerIds,
        setMetric, setTimeframe, setChartType, setTimeFilter,
        setSelectedRouteIds, setSelectedPartnerIds,
    } = useTrendsStore();
    const [settingsAnchorEl, setSettingsAnchorEl] = useState(null);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteStep, setDeleteStep] = useState(0); // 0=idle, 1=runs done, 2=routes done, 3=partners done
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // Savable view filter state
    const { activeViewId, setActiveViewId } = useActiveMapViewStore();

    // Parse active view criteria
    const activeView = views.find(v => v.id === activeViewId) || null;
    const criteria = useMemo(() => {
        if (!activeView?.criteria) return null;
        try {
            return typeof activeView.criteria === 'string'
                ? JSON.parse(activeView.criteria)
                : activeView.criteria;
        } catch { return null; }
    }, [activeView?.criteria]);

    // Build run → partnerIds lookup for view filtering
    const runPartnerMap = useMemo(() => {
        const m = new Map();
        for (const rp of runPartners) {
            if (!m.has(rp.map_run_fk)) m.set(rp.map_run_fk, []);
            m.get(rp.map_run_fk).push(rp.map_partner_fk);
        }
        return m;
    }, [runPartners]);

    // Stage 1: savable view filter (base for Trends and Table/Cards)
    const viewFilteredRuns = useMemo(
        () => applyViewFilter(allRuns, criteria, runPartnerMap),
        [allRuns, criteria, runPartnerMap]
    );

    // Stage 2: apply trends time + route filters on top of view filter (for Table/Cards)
    const filteredRuns = useMemo(() => {
        let result = viewFilteredRuns;

        if (timeFilter) {
            result = result.filter(run => {
                const t = new Date(run.start_time.endsWith?.('Z') ? run.start_time : run.start_time + 'Z');
                return t >= timeFilter.start && t < timeFilter.end;
            });
        }

        if (selectedRouteIds.length > 0) {
            const idSet = new Set(selectedRouteIds);
            result = result.filter(run => idSet.has(run.map_route_fk));
        }

        if (selectedPartnerIds.length > 0) {
            const idSet = new Set(selectedPartnerIds);
            result = result.filter(run => {
                const pids = runPartnerMap.get(run.id) || [];
                return pids.some(pid => idSet.has(pid));
            });
        }

        return result;
    }, [viewFilteredRuns, timeFilter, selectedRouteIds, selectedPartnerIds, runPartnerMap]);

    // Count distinct routes in the filtered runs
    const filteredRouteCount = useMemo(() => {
        const ids = new Set();
        for (const run of filteredRuns) {
            if (run.map_route_fk != null) ids.add(run.map_route_fk);
        }
        return ids.size;
    }, [filteredRuns]);

    // Build a human-readable description of active filters (for export dialog placeholder)
    const filterDescription = useMemo(() => {
        const parts = [];
        if (activeView) parts.push(activeView.name);
        if (timeFilter) parts.push(timeFilter.label);
        if (selectedRouteIds.length > 0) {
            const names = selectedRouteIds
                .map(id => routes.find(r => r.id === id)?.name)
                .filter(Boolean);
            if (names.length > 0) parts.push(names.join(', '));
        }
        if (selectedPartnerIds.length > 0) {
            const names = selectedPartnerIds
                .map(id => partners.find(p => p.id === id)?.name)
                .filter(Boolean);
            if (names.length > 0) parts.push(names.join(', '));
        }
        return parts.length > 0 ? parts.join(' \u2022 ') : '';
    }, [activeView, timeFilter, selectedRouteIds, selectedPartnerIds, routes, partners]);

    // View dialog state
    const [viewDialogOpen, setViewDialogOpen] = useState(false);
    const [editingView, setEditingView] = useState(null);

    // Picker dialog state
    const [routeDialogOpen, setRouteDialogOpen] = useState(false);
    const [partnerDialogOpen, setPartnerDialogOpen] = useState(false);

    const isLoading = runsLoading || routesLoading;

    // Effective timeframe for trend controls display
    const effectiveTimeframe = timeFilter
        ? DRILL_DOWN[timeFilter.sourceTimeframe] || timeframe
        : timeframe;

    // Route picker: count activities per route (respects time filter but not route filter)
    const routeCountMap = useMemo(() => {
        let source = viewFilteredRuns;
        if (timeFilter) {
            source = source.filter(run => {
                const t = new Date(run.start_time.endsWith?.('Z') ? run.start_time : run.start_time + 'Z');
                return t >= timeFilter.start && t < timeFilter.end;
            });
        }
        const counts = new Map();
        for (const run of source) {
            counts.set(run.map_route_fk, (counts.get(run.map_route_fk) || 0) + 1);
        }
        return counts;
    }, [viewFilteredRuns, timeFilter]);

    const routeOptions = useMemo(() => {
        return routes
            .filter(r => (routeCountMap.get(r.id) || 0) > 0)
            .map(r => ({ ...r, ride_count: routeCountMap.get(r.id) || 0 }));
    }, [routes, routeCountMap]);

    // Partner picker: count activities per partner (respects time filter but not partner filter)
    const partnerCountMap = useMemo(() => {
        let source = viewFilteredRuns;
        if (timeFilter) {
            source = source.filter(run => {
                const t = new Date(run.start_time.endsWith?.('Z') ? run.start_time : run.start_time + 'Z');
                return t >= timeFilter.start && t < timeFilter.end;
            });
        }
        const sourceIds = new Set(source.map(r => r.id));
        const counts = new Map();
        for (const rp of runPartners) {
            if (sourceIds.has(rp.map_run_fk)) {
                counts.set(rp.map_partner_fk, (counts.get(rp.map_partner_fk) || 0) + 1);
            }
        }
        return counts;
    }, [viewFilteredRuns, timeFilter, runPartners]);

    const partnerOptions = useMemo(() => {
        return partners
            .filter(p => (partnerCountMap.get(p.id) || 0) > 0)
            .map(p => ({ ...p, ride_count: partnerCountMap.get(p.id) || 0 }));
    }, [partners, partnerCountMap]);

    const handleViewChange = (event, newView) => {
        if (newView !== null) {
            setView(newView);
            localStorage.setItem(STORAGE_KEY, newView);
        }
    };

    const handleCreateView = () => {
        setEditingView(null);
        setViewDialogOpen(true);
    };

    const handleEditView = (viewObj) => {
        setEditingView(viewObj);
        setViewDialogOpen(true);
    };

    const handleBucketClick = useCallback((filter) => {
        setTimeFilter(filter);
        setSelectedRouteIds([]);
    }, [setTimeFilter, setSelectedRouteIds]);

    const handleClearFilters = useCallback(() => {
        setMetric('distance');
        setTimeframe('yearly');
        setTimeFilter(null);
        setSelectedRouteIds([]);
        setSelectedPartnerIds([]);
    }, [setMetric, setTimeframe, setTimeFilter, setSelectedRouteIds, setSelectedPartnerIds]);

    const handleMetric = (e, val) => { if (val !== null) setMetric(val); };
    const handleTimeframe = useCallback((e, val) => {
        if (val === null) return;
        const result = navigateTimeframe(val, timeFilter, effectiveTimeframe);
        if (!result) return; // no-op (same level)
        if (result.timeframe !== null) setTimeframe(result.timeframe);
        if (result.timeFilter !== undefined) setTimeFilter(result.timeFilter);
    }, [timeFilter, effectiveTimeframe, setTimeframe, setTimeFilter]);
    const handleChartType = (e, val) => { if (val !== null) setChartType(val); };

    const handleRouteRename = async (id, name) => {
        await call_rest_api(`${darwinUri}/map_routes`, 'PUT', [{ id, name }], idToken);
        queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
    };

    const handlePartnerRename = async (id, name) => {
        await call_rest_api(`${darwinUri}/map_partners`, 'PUT', [{ id, name }], idToken);
        queryClient.invalidateQueries({ queryKey: mapPartnerKeys.all(creatorFk) });
    };

    const routeButtonLabel = selectedRouteIds.length === 0
        ? 'Routes'
        : `Routes (${selectedRouteIds.length})`;

    const partnerButtonLabel = selectedPartnerIds.length === 0
        ? 'Partners'
        : `Partners (${selectedPartnerIds.length})`;

    const hasTrendFilters = !!timeFilter || selectedRouteIds.length > 0 || selectedPartnerIds.length > 0
        || metric !== 'distance' || timeframe !== 'yearly';

    const handleDeleteAll = async () => {
        setDeleting(true);
        setDeleteStep(0);

        try {
            if (allRuns.length > 0) {
                await call_rest_api(`${darwinUri}/map_runs`, 'DELETE', { creator_fk: creatorFk }, idToken);
            }
            setDeleteStep(1);

            if (routes.length > 0) {
                await call_rest_api(`${darwinUri}/map_routes`, 'DELETE', { creator_fk: creatorFk }, idToken);
            }
            setDeleteStep(2);

            if (partners.length > 0) {
                await call_rest_api(`${darwinUri}/map_partners`, 'DELETE', { creator_fk: creatorFk }, idToken);
            }
            setDeleteStep(3);

            queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
            queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
            queryClient.invalidateQueries({ queryKey: mapPartnerKeys.all(creatorFk) });

            setDeleteDialogOpen(false);
            setSnackbar({ open: true, message: 'All map data deleted', severity: 'success' });
        } catch (err) {
            console.error('[MapsPage] Delete error:', err);
            setDeleteDialogOpen(false);
            setSnackbar({ open: true, message: 'Delete failed', severity: 'error' });
        } finally {
            setDeleting(false);
            setDeleteStep(0);
        }
    };

    return (
        <Box sx={{ mt: 3, minWidth: 0, overflow: 'hidden' }}>
            {/* Header row */}
            <Box sx={{
                display: 'flex', alignItems: 'center', gap: 2, mb: 1, px: 2,
                maxWidth: TABLE_WIDTH,
            }}>
                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={handleViewChange}
                    size="small"
                    sx={{ flexShrink: 0 }}
                >
                    <ToggleButton value="cards" data-testid="view-toggle-cards">
                        <ViewModuleIcon sx={{ mr: 0.5 }} fontSize="small" />
                        Cards
                    </ToggleButton>
                    <ToggleButton value="trends" data-testid="view-toggle-trends">
                        <TrendingUpIcon sx={{ mr: 0.5 }} fontSize="small" />
                        Trends
                    </ToggleButton>
                    <ToggleButton value="table" data-testid="view-toggle-table">
                        <TableChartIcon sx={{ mr: 0.5 }} fontSize="small" />
                        Table
                    </ToggleButton>
                </ToggleButtonGroup>

                <ViewBar
                    views={views}
                    activeViewId={activeViewId}
                    onViewSelect={setActiveViewId}
                    onCreateClick={handleCreateView}
                    onEditClick={handleEditView}
                    darwinUri={darwinUri}
                    idToken={idToken}
                    creatorFk={creatorFk}
                />

                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {filteredRuns.length} activities
                    {filteredRouteCount > 0 ? ` / ${filteredRouteCount} routes` : ''}
                </Typography>

                <Box sx={{ flexGrow: 1 }} />

                {!timeFilter && (
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<CloudDownloadRoundedIcon />}
                        onClick={() => navigate('/maps/import')}
                    >
                        Import
                    </Button>
                )}
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={<BackupRoundedIcon />}
                    onClick={() => setExportDialogOpen(true)}
                    data-testid="export-button"
                >
                    Export
                </Button>

                <IconButton
                    onClick={(e) => setSettingsAnchorEl(e.currentTarget)}
                    size="small"
                    data-testid="maps-settings-button"
                >
                    <SettingsIcon fontSize="small" />
                </IconButton>
                <Menu
                    anchorEl={settingsAnchorEl}
                    open={Boolean(settingsAnchorEl)}
                    onClose={() => setSettingsAnchorEl(null)}
                >
                    <MenuItem
                        onClick={() => { setSettingsAnchorEl(null); navigate('/maps/settings/routes'); }}
                        data-testid="manage-routes-button"
                    >
                        <ListItemIcon>
                            <RouteIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Manage Routes</ListItemText>
                    </MenuItem>
                    <MenuItem
                        onClick={() => { setSettingsAnchorEl(null); navigate('/maps/settings/partners'); }}
                        data-testid="manage-partners-button"
                    >
                        <ListItemIcon>
                            <PeopleIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Manage Partners</ListItemText>
                    </MenuItem>
                    {IS_MACOS && (
                        <MenuItem
                            onClick={() => { setSettingsAnchorEl(null); navigate('/maps/settings/photos'); }}
                            data-testid="manage-photos-button"
                        >
                            <ListItemIcon>
                                <PhotoLibraryIcon fontSize="small" />
                            </ListItemIcon>
                            <ListItemText>Photo Settings</ListItemText>
                        </MenuItem>
                    )}
                    <Divider />
                    <MenuItem
                        onClick={() => {
                            setSettingsAnchorEl(null);
                            setDeleteDialogOpen(true);
                        }}
                        disabled={allRuns.length === 0 || deleting}
                        data-testid="delete-all-button"
                    >
                        <ListItemIcon>
                            <DeleteForeverIcon fontSize="small" color="error" />
                        </ListItemIcon>
                        <ListItemText>Delete All</ListItemText>
                    </MenuItem>
                </Menu>
            </Box>

            {/* Temporal controls row — Trends view only */}
            {view === 'trends' && (
                <Box sx={{
                    display: 'flex', alignItems: 'center', gap: 2, mb: 1, px: 2,
                    flexWrap: 'wrap', maxWidth: TABLE_WIDTH,
                }}>
                    <ToggleButtonGroup value={metric} exclusive onChange={handleMetric} size="small" disabled={view !== 'trends'}>
                        <ToggleButton value="distance" data-testid="metric-toggle-distance">Distance</ToggleButton>
                        <ToggleButton value="time" data-testid="metric-toggle-time">Time</ToggleButton>
                        <ToggleButton value="elevation" data-testid="metric-toggle-elevation">Elevation</ToggleButton>
                        <ToggleButton value="count" data-testid="metric-toggle-count">Count</ToggleButton>
                    </ToggleButtonGroup>

                    <ToggleButtonGroup
                        value={timeFilter ? effectiveTimeframe : timeframe}
                        exclusive
                        onChange={handleTimeframe}
                        size="small"
                        disabled={view !== 'trends'}
                    >
                        <ToggleButton value="yearly" data-testid="timeframe-toggle-yearly">Yearly</ToggleButton>
                        <ToggleButton value="monthly" data-testid="timeframe-toggle-monthly">Monthly</ToggleButton>
                        <ToggleButton value="weekly" data-testid="timeframe-toggle-weekly">Weekly</ToggleButton>
                    </ToggleButtonGroup>

                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<RouteIcon />}
                        onClick={() => setRouteDialogOpen(true)}
                        disabled={view !== 'trends'}
                        data-testid="route-filter-button"
                        sx={selectedRouteIds.length > 0 ? { borderColor: '#E91E63', color: '#E91E63' } : {}}
                    >
                        {routeButtonLabel}
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<PeopleIcon />}
                        onClick={() => setPartnerDialogOpen(true)}
                        disabled={view !== 'trends'}
                        data-testid="partner-filter-button"
                        sx={selectedPartnerIds.length > 0 ? { borderColor: '#E91E63', color: '#E91E63' } : {}}
                    >
                        {partnerButtonLabel}
                    </Button>

                    <ToggleButtonGroup value={chartType} exclusive onChange={handleChartType} size="small" disabled={view !== 'trends'}>
                        <ToggleButton value="bar" data-testid="chart-type-toggle-bar">
                            <BarChartIcon fontSize="small" />
                        </ToggleButton>
                        <ToggleButton value="line" data-testid="chart-type-toggle-line">
                            <ShowChartIcon fontSize="small" />
                        </ToggleButton>
                    </ToggleButtonGroup>

                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<CloseIcon />}
                        onClick={handleClearFilters}
                        disabled={!hasTrendFilters}
                        data-testid="clear-filters-button"
                    >
                        Clear Filter
                    </Button>
                </Box>
            )}

            {/* Dismissible filter chips — Table/Cards only */}
            {view !== 'trends' && (!!timeFilter || selectedRouteIds.length > 0 || selectedPartnerIds.length > 0) && (
                <TrendsFilterChips
                    timeFilter={timeFilter}
                    selectedRouteIds={selectedRouteIds}
                    selectedPartnerIds={selectedPartnerIds}
                    onClearTimeFilter={() => setTimeFilter(null)}
                    onClearRouteFilter={() => setSelectedRouteIds([])}
                    onClearPartnerFilter={() => setSelectedPartnerIds([])}
                />
            )}

            {view === 'trends'
                ? <TrendsView runs={viewFilteredRuns} runPartnerMap={runPartnerMap} isLoading={isLoading} onBucketClick={handleBucketClick} />
                : view === 'table'
                    ? <MapRunsView runs={filteredRuns} allRuns={allRuns} routes={routes} partners={partners} runPartners={runPartners} isLoading={isLoading} />
                    : <RouteCardView runs={filteredRuns} allRuns={allRuns} routes={routes} partners={partners} runPartners={runPartners} isLoading={isLoading} />
            }

            <PickerDialog
                open={routeDialogOpen}
                onClose={() => setRouteDialogOpen(false)}
                title="Filter by Route"
                entityLabel="Route"
                rows={routeOptions}
                selectedIds={selectedRouteIds}
                onApply={(ids) => setSelectedRouteIds(ids)}
                onRename={handleRouteRename}
            />

            <PickerDialog
                open={partnerDialogOpen}
                onClose={() => setPartnerDialogOpen(false)}
                title="Filter by Partner"
                entityLabel="Partner"
                rows={partnerOptions}
                selectedIds={selectedPartnerIds}
                onApply={(ids) => setSelectedPartnerIds(ids)}
                onRename={handlePartnerRename}
            />

            <ViewDialog
                open={viewDialogOpen}
                onClose={() => setViewDialogOpen(false)}
                view={editingView}
                views={views}
                routes={routes}
                partners={partners}
                darwinUri={darwinUri}
                idToken={idToken}
                creatorFk={creatorFk}
            />

            <ExportDialog
                open={exportDialogOpen}
                onClose={() => setExportDialogOpen(false)}
                runs={filteredRuns}
                routes={routes}
                partners={partners}
                runPartners={runPartners}
                darwinUri={darwinUri}
                idToken={idToken}
                filterDescription={filterDescription}
            />

            <Dialog open={deleteDialogOpen} onClose={() => !deleting && setDeleteDialogOpen(false)}>
                <DialogTitle>Delete All Map Data?</DialogTitle>
                <DialogContent>
                    {deleting ? (
                        <Box sx={{ minWidth: 300 }}>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                {deleteStep === 0 ? 'Deleting activities...' :
                                 deleteStep === 1 ? 'Deleting routes...' :
                                 'Deleting partners...'}
                            </Typography>
                            <LinearProgress
                                variant="determinate"
                                value={Math.round((deleteStep / 3) * 100)}
                            />
                        </Box>
                    ) : (
                        <DialogContentText>
                            This will permanently delete all {allRuns.length} activities, their GPS coordinates,
                            and {routes.length} routes. This cannot be undone.
                        </DialogContentText>
                    )}
                </DialogContent>
                {!deleting && (
                    <DialogActions>
                        <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleDeleteAll} color="error" variant="contained">
                            Delete All
                        </Button>
                    </DialogActions>
                )}
            </Dialog>

            <Snackbar
                open={snackbar.open}
                autoHideDuration={6000}
                onClose={() => setSnackbar(s => ({ ...s, open: false }))}
            >
                <Alert
                    onClose={() => setSnackbar(s => ({ ...s, open: false }))}
                    severity={snackbar.severity}
                    variant="filled"
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default MapsPage;
