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
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
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
    const { timeFilter, setTimeFilter, selectedRouteIds, setSelectedRouteIds } = useTrendsStore();
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

    // Apply savable view filter, then trends timeFilter + route filter
    const filteredRuns = useMemo(() => {
        let result = applyViewFilter(allRuns, criteria);

        // Trends time filter (from chart bucket click)
        if (timeFilter) {
            result = result.filter(run => {
                const t = new Date(run.start_time.endsWith?.('Z') ? run.start_time : run.start_time + 'Z');
                return t >= timeFilter.start && t < timeFilter.end;
            });
        }

        // Trends route filter
        if (selectedRouteIds.length > 0) {
            const idSet = new Set(selectedRouteIds);
            result = result.filter(run => idSet.has(run.map_route_fk));
        }

        return result;
    }, [allRuns, criteria, timeFilter, selectedRouteIds]);

    // View dialog state
    const [viewDialogOpen, setViewDialogOpen] = useState(false);
    const [editingView, setEditingView] = useState(null);

    const isLoading = runsLoading || routesLoading;

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

    const handleResetFilter = useCallback(() => {
        setTimeFilter(null);
        setSelectedRouteIds([]);
    }, [setTimeFilter, setSelectedRouteIds]);

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

    const title = timeFilter ? `Maps - ${timeFilter.label}` : 'Maps';

    return (
        <Box sx={{ mt: 3, minWidth: 0, overflow: 'hidden' }}>
            <Box sx={{
                display: 'flex', alignItems: 'center', gap: 2, mb: 1, px: 2,
                ...(view === 'table' ? { maxWidth: TABLE_WIDTH } : {}),
            }}>
                <Typography variant="h5">{title}</Typography>

                {timeFilter && (
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<CloseIcon />}
                        onClick={handleResetFilter}
                        data-testid="reset-filter-button"
                    >
                        Reset View
                    </Button>
                )}

                <Box sx={{ flexGrow: 1 }} />

                {view !== 'trends' && !timeFilter && (
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

            <ViewBar
                views={views}
                activeViewId={activeViewId}
                onViewSelect={setActiveViewId}
                onCreateClick={handleCreateView}
                onEditClick={handleEditView}
            />

            {view === 'trends'
                ? <TrendsView onBucketClick={handleBucketClick} />
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
