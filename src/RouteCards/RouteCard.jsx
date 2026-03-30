import React, { useState, useContext } from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { mapRunKeys, mapRouteKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import RouteMapThumbnail from './RouteMapThumbnail';
import RideEditDialog from './RideEditDialog';
import RideDeleteDialog from './RideDeleteDialog';
import { formatDuration } from '../utils/mapDataUtils';
import { formatCardDateTime } from '../utils/dateFormat';

const RouteCard = ({ run, routeName, routes, allRuns }) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const showError = useSnackBarStore(s => s.showError);
    const creatorFk = profile?.id;

    // Menu state
    const [menuAnchor, setMenuAnchor] = useState(null);
    const menuOpen = Boolean(menuAnchor);

    // Dialog state
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);

    // Format start_time with timezone-aware date + time
    const dateStr = formatCardDateTime(run.start_time, profile?.timezone);

    const distance = Number(run.distance_mi).toFixed(1);
    const avgSpeed = run.avg_speed_mph != null ? Number(run.avg_speed_mph).toFixed(1) : '—';
    const maxSpeed = run.max_speed_mph != null ? Number(run.max_speed_mph).toFixed(1) : '—';
    const ascent = run.ascent_ft != null ? Math.round(Number(run.ascent_ft)) : '—';
    const rideTime = formatDuration(run.run_time_sec);
    const stopTime = formatDuration(run.stopped_time_sec || 0);

    const rideSummary = `${routeName || run.activity_name || 'Activity'}, ${dateStr}`;

    const handleMenuClick = (event) => {
        event.stopPropagation();
        event.preventDefault();
        setMenuAnchor(event.currentTarget);
    };

    const handleMenuClose = () => {
        setMenuAnchor(null);
    };

    const handleEdit = () => {
        handleMenuClose();
        setEditOpen(true);
    };

    const handleDelete = () => {
        handleMenuClose();
        setDeleteOpen(true);
    };

    const handleDeleteConfirm = async () => {
        try {
            const result = await call_rest_api(
                `${darwinUri}/map_runs`, 'DELETE', { id: run.id }, idToken
            );
            if (result.httpStatus.httpStatus === 200) {
                queryClient.invalidateQueries({ queryKey: mapRunKeys.all(creatorFk) });
                queryClient.invalidateQueries({ queryKey: mapRouteKeys.all(creatorFk) });
            } else {
                showError(result, 'Failed to delete ride');
            }
        } catch (error) {
            showError(error, 'Failed to delete ride');
        }
    };

    return (
        <>
            <Card raised={true}
                  data-testid="route-card"
                  onClick={() => navigate(`/maps/${run.id}`)}
                  sx={{
                      border: '2px solid transparent',
                      position: 'relative',
                      cursor: 'pointer',
                      '&:hover': { borderColor: 'primary.main' },
                  }}
            >
                <Menu
                    anchorEl={menuAnchor}
                    open={menuOpen}
                    onClose={handleMenuClose}
                    onClick={(e) => e.stopPropagation()}
                >
                    <MenuItem onClick={handleEdit} data-testid="route-card-edit-item">
                        <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
                        <ListItemText>Edit</ListItemText>
                    </MenuItem>
                    <MenuItem onClick={handleDelete} data-testid="route-card-delete-item">
                        <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
                        <ListItemText>Delete</ListItemText>
                    </MenuItem>
                </Menu>

                {/* Header: route name + menu button */}
                <Box sx={{ display: 'flex', alignItems: 'center', px: 2, pt: 1.5 }}>
                    <Typography sx={{ fontSize: 24, fontWeight: 'normal', flexGrow: 1 }}>
                        {routeName || run.activity_name || 'Activity'}
                    </Typography>
                    <IconButton
                        size="small"
                        onClick={handleMenuClick}
                        data-testid="route-card-menu-btn"
                    >
                        <MoreVertIcon />
                    </IconButton>
                </Box>

                <RouteMapThumbnail runId={run.id} />

                <CardContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {dateStr}
                    </Typography>

                    <Box component="table" sx={{ width: '100%', '& td': { py: 0.2 }, '& td:first-of-type': { color: 'text.secondary', pr: 1.5 } }}>
                        <tbody>
                            <tr><td>Distance</td><td>{distance} mi</td></tr>
                            <tr><td>Avg Speed</td><td>{avgSpeed} mph</td></tr>
                            <tr><td>Max Speed</td><td>{maxSpeed} mph</td></tr>
                            <tr><td>Ascent</td><td>{ascent} ft</td></tr>
                            <tr><td>Ride Time</td><td>{rideTime}</td></tr>
                            <tr><td>Stop Time</td><td>{stopTime}</td></tr>
                        </tbody>
                    </Box>

                    {run.notes && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontStyle: 'italic' }}>
                            {run.notes}
                        </Typography>
                    )}
                </CardContent>
            </Card>

            {/* Edit Dialog */}
            <RideEditDialog
                open={editOpen}
                onClose={() => setEditOpen(false)}
                run={run}
                routes={routes}
                allRuns={allRuns}
                darwinUri={darwinUri}
                idToken={idToken}
                creatorFk={creatorFk}
            />

            {/* Delete Dialog */}
            <RideDeleteDialog
                open={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                onConfirm={handleDeleteConfirm}
                rideSummary={rideSummary}
            />
        </>
    );
};

export default RouteCard;
