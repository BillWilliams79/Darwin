import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import call_rest_api from '../../RestApi/RestApi';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { useShowClosedStore } from '../../stores/useShowClosedStore';
import { formatDateTime, formatDate } from '../../utils/dateFormat';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { DataGrid } from '@mui/x-data-grid';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { requirementKeys } from '../../hooks/useQueryKeys';
import RequirementDeleteDialog from '../RequirementDeleteDialog';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

import { renderSourceRef } from '../repoGitHubMap.jsx';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { CircularProgress, Typography } from '@mui/material';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import HotelIcon from '@mui/icons-material/Hotel';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import DoNotDisturbOnIcon from '@mui/icons-material/DoNotDisturbOn';
import DeleteIcon from '@mui/icons-material/Delete';
import NorthIcon from '@mui/icons-material/North';
import SouthIcon from '@mui/icons-material/South';

const swarmStatusChipProps = (status) => {
    switch (status) {
        case 'active':     return { sx: { bgcolor: '#4caf50', color: '#fff' } };
        case 'paused':     return { sx: { bgcolor: '#f0d000', color: '#000' } };
        case 'starting':   return { color: 'info' };
        case 'completing': return { color: 'info' };
        case 'completed':  return { color: 'success' };
        default:           return { color: 'default' };
    }
};

const getSessionColumns = (navigate, timezone) => [
    { field: 'id',           headerName: 'ID',        width: 70 },
    { field: 'swarm_status', headerName: 'Status',    width: 110,
      renderCell: (params) => (
          <Chip label={params.value} size="small"
                {...swarmStatusChipProps(params.value)} />
      )
    },
    {
        field: 'source_ref',
        headerName: 'Source',
        width: 140,
        renderCell: (params) => renderSourceRef(params.value, navigate),
    },
    { field: 'branch',       headerName: 'Branch',    width: 200, flex: 1 },
    { field: 'started_at',   headerName: 'Started',   width: 170,
      valueFormatter: (value) => value ? formatDate(value, timezone) : '—' },
    { field: 'completed_at', headerName: 'Completed', width: 120,
      valueFormatter: (value) => value ? formatDate(value, timezone) : '—' },
];

const siblingHandSort = (a, b) => {
    const aOrder = a.sort_order ?? Infinity;
    const bOrder = b.sort_order ?? Infinity;
    return aOrder - bOrder;
};

const siblingCreatedSort = (a, b) => a.id - b.id;

const STATUS_SORT_ORDER = { idle: 0, in_progress: 0, deferred: 1, completed: 2 };

const siblingActiveSort = (sortMode, a, b) => {
    const aState = STATUS_SORT_ORDER[a.requirement_status] ?? 0;
    const bState = STATUS_SORT_ORDER[b.requirement_status] ?? 0;
    if (aState !== bState) return aState - bState;
    if (a.requirement_status === 'completed' && b.requirement_status === 'completed') {
        const aTime = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const bTime = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        if (aTime !== bTime) return bTime - aTime;
    }
    if (a.requirement_status === 'deferred' && b.requirement_status === 'deferred') {
        const aTime = a.deferred_at ? new Date(a.deferred_at).getTime() : 0;
        const bTime = b.deferred_at ? new Date(b.deferred_at).getTime() : 0;
        if (aTime !== bTime) return bTime - aTime;
    }
    return sortMode === 'hand' ? siblingHandSort(a, b) : siblingCreatedSort(a, b);
};

const RequirementDetail = () => {

    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const fromCalendar = location.state?.from === 'calendar';
    const handleBack = () => navigate(fromCalendar ? '/calview' : '/swarm');
    const backLabel = fromCalendar ? 'Back to Calendar' : 'Back to Roadmap';
    const { idToken, profile } = useContext(AuthContext);
    const timezone = profile?.timezone;
    const { darwinUri } = useContext(AppContext);

    const [requirement, setRequirement] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [siblings, setSiblings] = useState([]);
    const [sibSortMode, setSibSortMode] = useState('hand');
    const [loading, setLoading] = useState(true);

    const showError = useSnackBarStore(s => s.showError);
    const requirementStatusFilter = useShowClosedStore(s => s.requirementStatusFilter);
    // Map chip filter values to DB requirement_status values for sibling query
    const siblingStatuses = [];
    if (requirementStatusFilter.includes('open')) siblingStatuses.push('idle', 'in_progress');
    if (requirementStatusFilter.includes('deferred')) siblingStatuses.push('deferred');
    if (requirementStatusFilter.includes('completed')) siblingStatuses.push('completed');
    const showClosed = requirementStatusFilter.includes('completed');

    const queryClient = useQueryClient();

    const requirementDelete = useConfirmDialog({
        onConfirm: ({ requirementId }) => {
            const uri = `${darwinUri}/requirements`;
            call_rest_api(uri, 'DELETE', { id: requirementId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                        navigate('/swarm');
                    } else {
                        showError(result, 'Unable to delete requirement');
                    }
                })
                .catch(error => showError(error, 'Unable to delete requirement'));
        }
    });

    useEffect(() => {
        const fetchData = async () => {
            try {
                const requirementUri = `${darwinUri}/requirements?id=${id}`;
                const result = await call_rest_api(requirementUri, 'GET', '', idToken);

                if (result.httpStatus.httpStatus !== 200 || result.data.length === 0) {
                    showError(result, 'Unable to load requirement');
                    setLoading(false);
                    return;
                }

                const p = result.data[0];
                setRequirement(p);

                // Fetch sessions, siblings, and category sort_mode in parallel
                const siblingFilter = siblingStatuses.length === 4 ? '' : `&requirement_status=(${siblingStatuses.join(',')})`;
                const [sessionsResult, siblingsResult, categoryResult] = await Promise.all([
                    call_rest_api(`${darwinUri}/swarm_sessions?source_ref=requirement:${p.id}`, 'GET', '', idToken).catch(() => null),
                    call_rest_api(`${darwinUri}/requirements?category_fk=${p.category_fk}&fields=id,requirement_status,sort_order,completed_at,deferred_at${siblingFilter}`, 'GET', '', idToken).catch(() => null),
                    call_rest_api(`${darwinUri}/categories?id=${p.category_fk}&fields=id,sort_mode`, 'GET', '', idToken).catch(() => null),
                ]);

                if (sessionsResult?.httpStatus?.httpStatus === 200 && sessionsResult.data.length > 0) {
                    setSessions(sessionsResult.data);
                }
                if (siblingsResult?.httpStatus?.httpStatus === 200 && siblingsResult.data.length > 0) {
                    setSiblings(siblingsResult.data);
                }
                if (categoryResult?.httpStatus?.httpStatus === 200 && categoryResult.data.length > 0) {
                    setSibSortMode(categoryResult.data[0].sort_mode || 'hand');
                }
            } catch (error) {
                showError(error, 'Unable to load requirement');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [id, idToken, darwinUri, siblingStatuses.join()]);

    const saveField = (field, value) => {
        let uri = `${darwinUri}/requirements`;
        call_rest_api(uri, 'PUT', [{ id: parseInt(id), [field]: value }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    showError(result, `Unable to update ${field}`);
                } else {
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                }
            }).catch(error => {
                showError(error, `Unable to update ${field}`);
            });
    };

    const handleTitleBlur = () => {
        if (requirement) saveField('title', requirement.title);
    };

    const handleTitleKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveField('title', requirement.title);
        }
    };

    const handleDescriptionBlur = () => {
        if (requirement) saveField('description', requirement.description || '');
    };

    const handleScheduledToggle = (event, newVal) => {
        if (newVal === null) return;
        const scheduledMap = { idle: 0, scheduled: 1, auto: 2 };
        const numVal = scheduledMap[newVal];
        setRequirement(prev => ({ ...prev, scheduled: numVal }));
        saveField('scheduled', numVal);
    };

    const scheduledState = requirement?.scheduled === 2 ? 'auto' : requirement?.scheduled === 1 ? 'scheduled' : 'idle';

    // Map DB requirement_status to toggle button value: idle/in_progress → 'open'
    const currentState = requirement
        ? (requirement.requirement_status === 'completed' ? 'closed'
            : requirement.requirement_status === 'deferred' ? 'deferred'
            : 'open')
        : 'open';

    // Confirmation dialog for transitions FROM completed state
    const requirementReopen = useConfirmDialog({
        onConfirm: ({ targetState }) => {
            executeStateChange(targetState);
        }
    });

    const executeStateChange = (newState) => {
        // Map toggle values to requirement_status
        const statusMap = { open: 'idle', deferred: 'deferred', closed: 'completed' };
        const newStatus = statusMap[newState];
        const now = new Date().toISOString();

        const updates = {
            requirement_status: newStatus,
            started_at: 'NULL',
            completed_at: newState === 'closed' ? now : 'NULL',
            deferred_at: newState === 'deferred' ? now : 'NULL',
        };

        setRequirement(prev => ({
            ...prev,
            requirement_status: newStatus,
            started_at: null,
            completed_at: newState === 'closed' ? now : null,
            deferred_at: newState === 'deferred' ? now : null,
        }));

        let uri = `${darwinUri}/requirements`;
        call_rest_api(uri, 'PUT', [{ id: parseInt(id), ...updates }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    showError(result, 'Unable to update requirement state');
                } else {
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                }
            }).catch(error => {
                showError(error, 'Unable to update requirement state');
            });
    };

    const handleStateChange = (event, newState) => {
        if (newState === null || newState === currentState) return;

        // Require confirmation when leaving completed state
        if (currentState === 'closed') {
            requirementReopen.openDialog({ targetState: newState });
            return;
        }

        executeStateChange(newState);
    };

    const sortedSiblings = useMemo(() => {
        if (!siblings.length) return [];
        return [...siblings].sort((a, b) => siblingActiveSort(sibSortMode, a, b));
    }, [siblings, sibSortMode]);

    const currentIndex = useMemo(() => {
        const idNum = parseInt(id);
        return sortedSiblings.findIndex(s => parseInt(s.id) === idNum);
    }, [sortedSiblings, id]);

    const prevId = currentIndex > 0 ? sortedSiblings[currentIndex - 1]?.id : null;
    const nextId = currentIndex >= 0 && currentIndex < sortedSiblings.length - 1 ? sortedSiblings[currentIndex + 1]?.id : null;
    const displayIndex = currentIndex >= 0 ? currentIndex + 1 : null;

    if (loading) return <CircularProgress />;
    if (!requirement) return <Typography>Requirement not found.</Typography>;

    return (
        <Box sx={{ p: 3, maxWidth: 800 }} data-testid="requirement-detail">
            <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
                <Button variant="outlined"
                        onClick={handleBack}
                        data-testid="btn-back-to-swarm">
                    {backLabel}
                </Button>
                <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }} data-testid="requirement-id">
                    Requirement ID - {requirement.id}
                </Typography>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, mb: 2 }}>
                <Typography
                    data-testid="requirement-index"
                    sx={{ fontSize: 24, fontWeight: 500, color: 'text.secondary', lineHeight: 1.4, pb: '3px', whiteSpace: 'nowrap' }}
                >
                    {displayIndex !== null ? `${displayIndex}.` : ''}
                </Typography>
                <TextField
                    variant="standard"
                    value={requirement.title || ''}
                    onChange={(e) => setRequirement(prev => ({ ...prev, title: e.target.value }))}
                    onBlur={handleTitleBlur}
                    onKeyDown={handleTitleKeyDown}
                    fullWidth
                    autoComplete="off"
                    slotProps={{
                        input: { style: { fontSize: 24, fontWeight: 500 } },
                        htmlInput: { maxLength: 256 }
                    }}
                    data-testid="requirement-title"
                />
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
                {(() => {
                    const activeStatuses = ['starting', 'active', 'completing'];
                    const hasActiveSession = sessions.some(s => activeStatuses.includes(s.swarm_status));
                    const isDisabled = hasActiveSession || requirement.requirement_status === 'completed' || requirement.requirement_status === 'deferred';
                    return (
                        <ToggleButtonGroup
                            value={scheduledState}
                            exclusive
                            onChange={handleScheduledToggle}
                            size="small"
                            disabled={isDisabled}
                            data-testid="toggle-scheduled"
                        >
                            <Tooltip title="Not set for swarm-start" enterDelay={400} enterNextDelay={200}>
                                <ToggleButton value="idle" data-testid="scheduled-idle"
                                    sx={{ textTransform: 'capitalize', ...(scheduledState === 'idle' && { bgcolor: 'action.selected' }) }}
                                >Idle</ToggleButton>
                            </Tooltip>
                            <Tooltip title="Set for swarm-start, manual start" enterDelay={400} enterNextDelay={200}>
                                <ToggleButton value="scheduled" data-testid="scheduled-scheduled"
                                    sx={{ textTransform: 'capitalize', ...(scheduledState === 'scheduled' && { bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.dark' }, '&.Mui-selected': { bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.dark' } } }) }}
                                >Scheduled</ToggleButton>
                            </Tooltip>
                            <Tooltip title="Set for swarm-start, begins automatically" enterDelay={400} enterNextDelay={200}>
                                <ToggleButton value="auto" data-testid="scheduled-auto"
                                    sx={{ textTransform: 'capitalize', ...(scheduledState === 'auto' && { bgcolor: 'success.main', color: '#fff', '&:hover': { bgcolor: 'success.dark' }, '&.Mui-selected': { bgcolor: 'success.main', color: '#fff', '&:hover': { bgcolor: 'success.dark' } } }) }}
                                >Auto-Start</ToggleButton>
                            </Tooltip>
                        </ToggleButtonGroup>
                    );
                })()}
                {(() => {
                    const hasPausedSession = sessions.some(s => s.swarm_status === 'paused');
                    const hasActiveSession = sessions.some(s => ['starting', 'active', 'completing'].includes(s.swarm_status));
                    const status = requirement.requirement_status;
                    const label = status === 'completed' ? "Completed" :
                        status === 'deferred' ? "Deferred" :
                        hasPausedSession ? "Paused" :
                        hasActiveSession || status === 'in_progress' ? "In Progress" :
                        "Not Started";
                    const icon = status === 'completed' ?
                        <CheckCircleIcon sx={{ fontSize: 24, color: 'success.main' }} /> :
                        status === 'deferred' ?
                            <DoNotDisturbOnIcon sx={{ fontSize: 24, color: '#ff9800' }} /> :
                        hasPausedSession ?
                            <PauseCircleIcon sx={{ fontSize: 24, color: '#f0d000' }} /> :
                            hasActiveSession || status === 'in_progress' ?
                                <RocketLaunchIcon sx={{ fontSize: 24, color: '#4caf50' }} /> :
                                <HotelIcon sx={{ fontSize: 24, color: 'text.disabled' }} />;
                    return (
                        <Tooltip enterDelay={400} enterNextDelay={200} title={label}>
                            {icon}
                        </Tooltip>
                    );
                })()}
                <ToggleButtonGroup
                    value={currentState}
                    exclusive
                    onChange={handleStateChange}
                    size="small"
                    data-testid="requirement-state-selector"
                >
                    <ToggleButton value="open" data-testid="state-open"
                        sx={{ textTransform: 'capitalize', ...(currentState === 'open' && { bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.dark' }, '&.Mui-selected': { bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.dark' } } }) }}
                    >Open</ToggleButton>
                    <ToggleButton value="deferred" data-testid="state-deferred"
                        sx={{ textTransform: 'capitalize', ...(currentState === 'deferred' && { bgcolor: '#ff9800', color: '#fff', '&:hover': { bgcolor: '#e68900' }, '&.Mui-selected': { bgcolor: '#ff9800', color: '#fff', '&:hover': { bgcolor: '#e68900' } } }) }}
                    >Deferred</ToggleButton>
                    <ToggleButton value="closed" data-testid="state-closed"
                        sx={{ textTransform: 'capitalize', ...(currentState === 'closed' && { bgcolor: 'success.main', color: '#fff', '&:hover': { bgcolor: 'success.dark' }, '&.Mui-selected': { bgcolor: 'success.main', color: '#fff', '&:hover': { bgcolor: 'success.dark' } } }) }}
                    >Closed</ToggleButton>
                </ToggleButtonGroup>
                <Tooltip title="Previous requirement" enterDelay={400}>
                    <span>
                        <IconButton
                            onClick={() => navigate(`/swarm/requirement/${prevId}`)}
                            disabled={!prevId}
                            data-testid="btn-prev-requirement"
                            sx={{ maxWidth: 25, maxHeight: 25 }}
                        >
                            <NorthIcon />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="Next requirement" enterDelay={400}>
                    <span>
                        <IconButton
                            onClick={() => navigate(`/swarm/requirement/${nextId}`)}
                            disabled={!nextId}
                            data-testid="btn-next-requirement"
                            sx={{ maxWidth: 25, maxHeight: 25 }}
                        >
                            <SouthIcon />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="Delete requirement" enterDelay={400} enterNextDelay={200}>
                    <IconButton
                        onClick={() => requirementDelete.openDialog({ requirementId: parseInt(id) })}
                        data-testid="btn-delete-requirement"
                        sx={{ maxWidth: '25px', maxHeight: '25px' }}
                    >
                        <DeleteIcon />
                    </IconButton>
                </Tooltip>
            </Box>

            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Description</Typography>
                <TextField
                    variant="outlined"
                    value={requirement.description || ''}
                    onChange={(e) => setRequirement(prev => ({ ...prev, description: e.target.value }))}
                    onBlur={handleDescriptionBlur}
                    fullWidth
                    multiline
                    minRows={3}
                    autoComplete="off"
                    autoFocus
                    size="small"
                    data-testid="requirement-description"
                />
            </Box>

            <Box sx={{ display: 'flex', gap: 4, mb: 3 }}>
                {/* Requirement timings — left column */}
                <Box sx={{ flex: 1 }}>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Requirement Created</Typography>
                        <Typography variant="body2" data-testid="requirement-create-ts">
                            {requirement.create_ts ? formatDateTime(requirement.create_ts, timezone) : '—'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Requirement Updated</Typography>
                        <Typography variant="body2" data-testid="requirement-update-ts">
                            {requirement.update_ts ? formatDateTime(requirement.update_ts, timezone) : '—'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Requirement Deferred</Typography>
                        <Typography variant="body2" data-testid="requirement-deferred-at">
                            {requirement.deferred_at ? formatDateTime(requirement.deferred_at, timezone) : '—'}
                        </Typography>
                    </Box>
                </Box>
                {/* Session timings — right column */}
                <Box sx={{ flex: 1 }}>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Swarm Started</Typography>
                        <Typography variant="body2" data-testid="requirement-started-at">
                            {requirement.started_at ? formatDateTime(requirement.started_at, timezone) : '—'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Swarm Completed</Typography>
                        <Typography variant="body2" data-testid="requirement-completed-at">
                            {requirement.completed_at ? formatDateTime(requirement.completed_at, timezone) : '—'}
                        </Typography>
                    </Box>
                </Box>
            </Box>

            <Typography variant="h6" gutterBottom>Linked Sessions</Typography>
            {sessions.length === 0 ? (
                <Typography variant="body2" color="text.secondary" data-testid="no-linked-sessions">
                    No sessions linked to this requirement.
                </Typography>
            ) : (
                <Box data-testid="linked-sessions-grid">
                    <DataGrid
                        autoHeight
                        rows={sessions}
                        columns={getSessionColumns(navigate, timezone)}
                        density="compact"
                        disableRowSelectionOnClick
                        onRowClick={(params) => navigate(`/swarm/session/${params.id}`)}
                        sx={{ cursor: 'pointer' }}
                    />
                </Box>
            )}

            <RequirementDeleteDialog
                deleteDialogOpen={requirementDelete.dialogOpen}
                setDeleteDialogOpen={requirementDelete.setDialogOpen}
                setDeleteId={requirementDelete.setInfoObject}
                setDeleteConfirmed={requirementDelete.setConfirmed}
            />

            <Dialog
                open={requirementReopen.dialogOpen}
                onClose={() => { requirementReopen.setDialogOpen(false); requirementReopen.setInfoObject({}); }}
                data-testid="requirement-reopen-dialog"
            >
                <DialogTitle>
                    {requirementReopen.infoObject.targetState === 'deferred' ? 'Defer Requirement' : 'Re-open Requirement'}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {requirementReopen.infoObject.targetState === 'deferred'
                            ? 'This will clear the completion date and mark the requirement as deferred. Continue?'
                            : 'Re-opening will clear the completion date. Continue?'}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => { requirementReopen.setConfirmed(true); requirementReopen.setDialogOpen(false); }} variant="outlined">
                        {requirementReopen.infoObject.targetState === 'deferred' ? 'Defer' : 'Re-open'}
                    </Button>
                    <Button onClick={() => { requirementReopen.setDialogOpen(false); requirementReopen.setInfoObject({}); }} variant="outlined" autoFocus>
                        Cancel
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default RequirementDetail;
