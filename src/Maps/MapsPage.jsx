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
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Popover from '@mui/material/Popover';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Checkbox from '@mui/material/Checkbox';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import RouteIcon from '@mui/icons-material/Route';
import BarChartIcon from '@mui/icons-material/BarChart';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { useMapRuns, useMapRoutes, useMapViews } from '../hooks/useDataQueries';
import { mapRunKeys, mapRouteKeys } from '../hooks/useQueryKeys';
import MapRunsView, { TABLE_WIDTH } from '../MapRuns/MapRunsView';
import RouteCardView from '../RouteCards/RouteCardView';
import TrendsView from '../Trends/TrendsView';
import ViewBar from './ViewBar';
import ViewDialog from './ViewDialog';
import { useActiveMapViewStore } from '../stores/useActiveMapViewStore';
import { useTrendsStore } from '../stores/useTrendsStore';
import { applyViewFilter } from '../utils/mapViewFilter';

const DRILL_DOWN = { yearly: 'monthly', monthly: 'weekly', weekly: 'weekly' };

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

    const [view, setView] = useState(() => localStorage.getItem(STORAGE_KEY) || 'table');
    const {
        metric, timeframe, chartType, timeFilter,
        selectedRouteIds,
        setMetric, setTimeframe, setChartType, setTimeFilter, setSelectedRouteIds,
    } = useTrendsStore();
    const [settingsAnchorEl, setSettingsAnchorEl] = useState(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
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

    // Stage 1: savable view filter (base for Trends and Table/Cards)
    const viewFilteredRuns = useMemo(
        () => applyViewFilter(allRuns, criteria),
        [allRuns, criteria]
    );

    // Stage 2: apply trends time + route filters on top (for Table/Cards)
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

        return result;
    }, [viewFilteredRuns, timeFilter, selectedRouteIds]);

    // Count distinct routes in the filtered runs
    const filteredRouteCount = useMemo(() => {
        const ids = new Set();
        for (const run of filteredRuns) {
            if (run.map_route_fk != null) ids.add(run.map_route_fk);
        }
        return ids.size;
    }, [filteredRuns]);

    // View dialog state
    const [viewDialogOpen, setViewDialogOpen] = useState(false);
    const [editingView, setEditingView] = useState(null);

    // Route picker state
    const [routeAnchor, setRouteAnchor] = useState(null);
    const [pendingRouteIds, setPendingRouteIds] = useState([]);

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
        return [...routes]
            .filter(r => (routeCountMap.get(r.id) || 0) > 0)
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [routes, routeCountMap]);

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
    }, [setMetric, setTimeframe, setTimeFilter, setSelectedRouteIds]);

    const handleMetric = (e, val) => { if (val !== null) setMetric(val); };
    const handleTimeframe = (e, val) => { if (val !== null) setTimeframe(val); };
    const handleChartType = (e, val) => { if (val !== null) setChartType(val); };

    const handleOpenRoutes = (e) => {
        setPendingRouteIds([...selectedRouteIds]);
        setRouteAnchor(e.currentTarget);
    };

    const handleToggleRoute = (id) => {
        setPendingRouteIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const handleApplyRoutes = () => {
        setSelectedRouteIds(pendingRouteIds);
        setRouteAnchor(null);
    };

    const routeButtonLabel = selectedRouteIds.length === 0
        ? 'Routes'
        : `Routes (${selectedRouteIds.length})`;

    const hasTrendFilters = !!timeFilter || selectedRouteIds.length > 0
        || metric !== 'distance' || timeframe !== 'yearly';

    const handleDeleteAll = async () => {
        setDeleteDialogOpen(false);
        setDeleting(true);

        try {
            for (const run of allRuns) {
                await call_rest_api(`${darwinUri}/map_runs`, 'DELETE', { id: run.id }, idToken);
            }
            for (const route of routes) {
                await call_rest_api(`${darwinUri}/map_routes`, 'DELETE', { id: route.id }, idToken);
            }

            queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
            queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });

            setSnackbar({ open: true, message: 'All map data deleted', severity: 'success' });
        } catch (err) {
            console.error('[MapsPage] Delete error:', err);
            setSnackbar({ open: true, message: 'Delete failed', severity: 'error' });
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Box sx={{ mt: 3, minWidth: 0, overflow: 'hidden' }}>
            {/* Header row */}
            <Box sx={{
                display: 'flex', alignItems: 'center', gap: 2, mb: 1, px: 2,
                maxWidth: TABLE_WIDTH,
            }}>
                <Typography variant="h5" sx={{ flexShrink: 0 }}>
                    {timeFilter ? `Maps - ${timeFilter.label}` : 'Maps'}
                </Typography>

                <ViewBar
                    views={views}
                    activeViewId={activeViewId}
                    onViewSelect={setActiveViewId}
                    onCreateClick={handleCreateView}
                    onEditClick={handleEditView}
                />

                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {filteredRuns.length} runs
                    {filteredRouteCount > 0 ? ` / ${filteredRouteCount} routes` : ''}
                </Typography>

                <Box sx={{ flexGrow: 1 }} />

                {!timeFilter && (
                    <>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<CloudUploadIcon />}
                            onClick={() => navigate('/maps/import')}
                        >
                            Import
                        </Button>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<FileDownloadOutlinedIcon />}
                            onClick={() => navigate('/maps/export')}
                        >
                            Export
                        </Button>

                        <Box sx={{ width: 16 }} />
                    </>
                )}

                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={handleViewChange}
                    size="small"
                    sx={{ flexShrink: 0 }}
                >
                    <ToggleButton value="table" data-testid="view-toggle-table">
                        <TableChartIcon sx={{ mr: 0.5 }} fontSize="small" />
                        Table
                    </ToggleButton>
                    <ToggleButton value="cards" data-testid="view-toggle-cards">
                        <ViewModuleIcon sx={{ mr: 0.5 }} fontSize="small" />
                        Cards
                    </ToggleButton>
                    <ToggleButton value="trends" data-testid="view-toggle-trends">
                        <TrendingUpIcon sx={{ mr: 0.5 }} fontSize="small" />
                        Trends
                    </ToggleButton>
                </ToggleButtonGroup>

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

            {/* Temporal controls row — always on Trends, only when filtered on Table/Cards */}
            {(view === 'trends' || hasTrendFilters) && (
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
                        disabled={view !== 'trends' || !!timeFilter}
                    >
                        <ToggleButton value="yearly" data-testid="timeframe-toggle-yearly">Yearly</ToggleButton>
                        <ToggleButton value="monthly" data-testid="timeframe-toggle-monthly">Monthly</ToggleButton>
                        <ToggleButton value="weekly" data-testid="timeframe-toggle-weekly">Weekly</ToggleButton>
                    </ToggleButtonGroup>

                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<RouteIcon />}
                        onClick={handleOpenRoutes}
                        disabled={view !== 'trends'}
                        data-testid="route-filter-button"
                        sx={selectedRouteIds.length > 0 ? { borderColor: '#E91E63', color: '#E91E63' } : {}}
                    >
                        {routeButtonLabel}
                    </Button>
                    <Popover
                        open={Boolean(routeAnchor)}
                        anchorEl={routeAnchor}
                        onClose={() => setRouteAnchor(null)}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                    >
                        <Box sx={{ width: 300, display: 'flex', flexDirection: 'column', maxHeight: 400 }}>
                            <List dense sx={{ overflow: 'auto', flex: 1 }}>
                                {routeOptions.map(route => (
                                    <ListItemButton
                                        key={route.id}
                                        onClick={() => handleToggleRoute(route.id)}
                                        dense
                                    >
                                        <Checkbox
                                            edge="start"
                                            checked={pendingRouteIds.includes(route.id)}
                                            tabIndex={-1}
                                            disableRipple
                                            size="small"
                                        />
                                        <ListItemText
                                            primary={route.name}
                                            secondary={`${routeCountMap.get(route.id) || 0} activities`}
                                        />
                                    </ListItemButton>
                                ))}
                            </List>
                            <Box sx={{ p: 1, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                <Button size="small" onClick={() => { setPendingRouteIds([]); setSelectedRouteIds([]); setRouteAnchor(null); }}>
                                    Clear
                                </Button>
                                <Button size="small" variant="contained" onClick={handleApplyRoutes}>
                                    Apply
                                </Button>
                            </Box>
                        </Box>
                    </Popover>

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

            {view === 'trends'
                ? <TrendsView runs={viewFilteredRuns} isLoading={isLoading} onBucketClick={handleBucketClick} />
                : view === 'table'
                    ? <MapRunsView runs={filteredRuns} allRuns={allRuns} routes={routes} isLoading={isLoading} />
                    : <RouteCardView runs={filteredRuns} allRuns={allRuns} routes={routes} isLoading={isLoading} />
            }

            <ViewDialog
                open={viewDialogOpen}
                onClose={() => setViewDialogOpen(false)}
                view={editingView}
                routes={routes}
                darwinUri={darwinUri}
                idToken={idToken}
                creatorFk={creatorFk}
            />

            <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
                <DialogTitle>Delete All Map Data?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        This will permanently delete all {allRuns.length} runs, their GPS coordinates,
                        and {routes.length} routes. This cannot be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleDeleteAll} color="error" variant="contained">
                        Delete All
                    </Button>
                </DialogActions>
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
