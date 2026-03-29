import React, { useState, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Button from '@mui/material/Button';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import MapRunsView, { TABLE_WIDTH } from '../MapRuns/MapRunsView';
import RouteCardView from '../RouteCards/RouteCardView';
import ViewBar from './ViewBar';
import ViewDialog from './ViewDialog';
import { useMapRuns, useMapRoutes, useMapViews } from '../hooks/useDataQueries';
import { useActiveMapViewStore } from '../stores/useActiveMapViewStore';
import { applyViewFilter } from '../utils/mapViewFilter';

const STORAGE_KEY = 'darwin-maps-view';

const MapsPage = () => {
    const navigate = useNavigate();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const creatorFk = profile?.id;

    const [view, setView] = useState(() => localStorage.getItem(STORAGE_KEY) || 'table');

    // Data fetching (lifted from child components)
    const { data: runs = [], isLoading: runsLoading } = useMapRuns(creatorFk);
    const { data: routes = [], isLoading: routesLoading } = useMapRoutes(creatorFk);
    const { data: views = [] } = useMapViews(creatorFk);

    // Active view state
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

    // Filtered runs
    const filteredRuns = useMemo(
        () => applyViewFilter(runs, criteria),
        [runs, criteria]
    );

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

    return (
        <Box sx={{ mt: 3, minWidth: 0, overflow: 'hidden' }}>
            <Box sx={{
                display: 'flex', alignItems: 'center', gap: 2, mb: 1, px: 2,
                ...(view === 'table' ? { maxWidth: TABLE_WIDTH } : {}),
            }}>
                <Typography variant="h5">Maps</Typography>

                <Box sx={{ flexGrow: 1 }} />

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
                </ToggleButtonGroup>
            </Box>

            <ViewBar
                views={views}
                activeViewId={activeViewId}
                onViewSelect={setActiveViewId}
                onCreateClick={handleCreateView}
                onEditClick={handleEditView}
            />

            {view === 'table'
                ? <MapRunsView runs={filteredRuns} allRuns={runs} routes={routes} isLoading={isLoading} />
                : <RouteCardView runs={filteredRuns} allRuns={runs} routes={routes} isLoading={isLoading} />
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
        </Box>
    );
};

export default MapsPage;
