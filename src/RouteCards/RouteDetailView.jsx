import React, { useState, useContext, useLayoutEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import IconButton from '@mui/material/IconButton';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { useMapRuns, useMapRoutes, useMapCoordinates, useMapPartners, useMapRunPartners } from '../hooks/useDataQueries';
import { mapRunKeys, mapRouteKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { loadIndex, loadMeta } from '../photo-browser/handleDB.js';
import { checkPhotosProxy, startScan } from '../photo-browser/scanUtils.js';
import { IS_MACOS } from '../photo-browser/proxyConfig.js';
import RouteMapFull from './RouteMapFull';
import RideEditDialog from './RideEditDialog';
import RideDeleteDialog from './RideDeleteDialog';

const RouteDetailView = () => {
    const { runId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const showError = useSnackBarStore(s => s.showError);

    useLayoutEffect(() => { window.scrollTo(0, 0); }, []);
    const creatorFk = profile?.id;

    const fromCalendar = location.state?.from === 'calendar';
    const backPath = fromCalendar ? '/calview' : '/maps';
    const backLabel = fromCalendar ? 'Back to Calendar' : 'Back to Routes';

    const { data: allRuns = [], isLoading: runsLoading } = useMapRuns(creatorFk);
    const { data: routes = [] } = useMapRoutes(creatorFk);
    const { data: coordinates = [], isLoading: coordsLoading } = useMapCoordinates(Number(runId));
    const { data: partners = [] } = useMapPartners(creatorFk);
    const { data: runPartners = [] } = useMapRunPartners(creatorFk);

    // Dialog state
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);

    // Find the specific run
    const run = allRuns.find(r => String(r.id) === String(runId));

    // Build route lookup
    const routeMap = new Map();
    for (const route of routes) {
        routeMap.set(route.id, route.name);
    }

    if (runsLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!run) {
        return (
            <Box sx={{ p: 3 }}>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backPath)} sx={{ mb: 2 }}>
                    {backLabel}
                </Button>
                <Typography color="error">Activity not found.</Typography>
            </Box>
        );
    }

    const routeName = routeMap.get(run.map_route_fk);

    const featureEnabled = IS_MACOS && localStorage.getItem('photo-browser-enabled') !== 'false';

    const handlePhotosClick = async () => {
        const [savedIndex, meta, proxy] = await Promise.all([
            loadIndex(), loadMeta(), checkPhotosProxy(),
        ]);
        // Trigger background rescan if proxy asset count changed
        if (proxy.available && savedIndex && meta?.fileCount !== proxy.assetCount) {
            startScan();
        }
        if (savedIndex) {
            sessionStorage.setItem('maps_scrollY', String(window.scrollY));
            navigate(`/maps/photos/${runId}`);
        } else if (proxy.available) {
            startScan();
            navigate('/maps/settings/photos');
        } else {
            navigate('/maps/settings/photos');
        }
    };

    const handleDeleteConfirm = async () => {
        try {
            const result = await call_rest_api(
                `${darwinUri}/map_runs`, 'DELETE', { id: run.id }, idToken
            );
            if (result.httpStatus.httpStatus === 200) {
                queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
                queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
                navigate(backPath);
            } else {
                showError(result, 'Failed to delete ride');
            }
        } catch (error) {
            showError(error, 'Failed to delete ride');
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backPath)}>
                    {backLabel}
                </Button>
                <Box sx={{ flexGrow: 1 }} />
                {featureEnabled && (
                    <IconButton
                        size="small"
                        onClick={handlePhotosClick}
                        title="Photos from this activity"
                        data-testid="detail-photos-btn"
                    >
                        <CameraAltIcon fontSize="small" />
                    </IconButton>
                )}
                <Button
                    startIcon={<EditIcon />}
                    variant="outlined"
                    size="small"
                    onClick={() => setEditOpen(true)}
                    data-testid="detail-edit-btn"
                >
                    Edit
                </Button>
                <Button
                    startIcon={<DeleteIcon />}
                    variant="outlined"
                    color="error"
                    size="small"
                    onClick={() => setDeleteOpen(true)}
                    data-testid="detail-delete-btn"
                >
                    Delete
                </Button>
            </Box>

            <RouteMapFull coordinates={coordinates} isLoading={coordsLoading} run={run} routeName={routeName} partners={partners} runPartners={runPartners} />

            {/* Edit Dialog */}
            <RideEditDialog
                open={editOpen}
                onClose={() => setEditOpen(false)}
                run={run}
                routes={routes}
                allRuns={allRuns}
                partners={partners}
                runPartners={runPartners}
                darwinUri={darwinUri}
                idToken={idToken}
                creatorFk={creatorFk}
                timezone={profile?.timezone}
            />

            {/* Delete Dialog */}
            <RideDeleteDialog
                open={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                onConfirm={handleDeleteConfirm}
                run={run}
                routeName={routeName}
                timezone={profile?.timezone}
            />
        </Box>
    );
};

export default RouteDetailView;
