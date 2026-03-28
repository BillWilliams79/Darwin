import React, { useState, useContext } from 'react';
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
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import SettingsIcon from '@mui/icons-material/Settings';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { useMapRuns, useMapRoutes } from '../hooks/useDataQueries';
import { mapRunKeys, mapRouteKeys } from '../hooks/useQueryKeys';
import MapRunsView, { TABLE_WIDTH } from '../MapRuns/MapRunsView';
import RouteCardView from '../RouteCards/RouteCardView';

const STORAGE_KEY = 'darwin-maps-view';

const MapsPage = () => {
    const navigate = useNavigate();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const queryClient = useQueryClient();
    const creatorFk = profile?.id;

    const { data: runs = [] } = useMapRuns(creatorFk);
    const { data: routes = [] } = useMapRoutes(creatorFk);

    const [view, setView] = useState(() => localStorage.getItem(STORAGE_KEY) || 'table');
    const [settingsAnchorEl, setSettingsAnchorEl] = useState(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const handleViewChange = (event, newView) => {
        if (newView !== null) {
            setView(newView);
            localStorage.setItem(STORAGE_KEY, newView);
        }
    };

    const handleDeleteAll = async () => {
        setDeleteDialogOpen(false);
        setDeleting(true);

        try {
            for (const run of runs) {
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
                        disabled={runs.length === 0 || deleting}
                        data-testid="delete-all-button"
                    >
                        <ListItemIcon>
                            <DeleteForeverIcon fontSize="small" color="error" />
                        </ListItemIcon>
                        <ListItemText>Delete All</ListItemText>
                    </MenuItem>
                </Menu>
            </Box>

            {view === 'table' ? <MapRunsView /> : <RouteCardView />}

            <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
                <DialogTitle>Delete All Map Data?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        This will permanently delete all {runs.length} runs, their GPS coordinates,
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
