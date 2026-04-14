import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import call_rest_api from '../../RestApi/RestApi';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { useShowClosedStore, ALL_REQUIREMENT_STATUSES } from '../../stores/useShowClosedStore';
import { siblingActiveSort } from './requirementSort';
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
import { CircularProgress, Stack, Typography } from '@mui/material';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import EditNoteIcon from '@mui/icons-material/EditNote';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import RateReviewIcon from '@mui/icons-material/RateReview';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import DoNotDisturbOnIcon from '@mui/icons-material/DoNotDisturbOn';
import DeleteIcon from '@mui/icons-material/Delete';
import NorthIcon from '@mui/icons-material/North';
import SouthIcon from '@mui/icons-material/South';

const swarmStatusChipProps = (status) => {
    switch (status) {
        case 'active':     return { sx: { bgcolor: '#4caf50', color: '#fff' } };
        case 'review':     return { sx: { bgcolor: '#ce93d8', color: '#000' } };
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
    const [categorySortOrder, setCategorySortOrder] = useState(null);
    const [loading, setLoading] = useState(true);

    const showError = useSnackBarStore(s => s.showError);
    const requirementStatusFilter = useShowClosedStore(s => s.requirementStatusFilter);
    // Filter chips now match DB status values directly
    const siblingStatuses = [...requirementStatusFilter];

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

                // Fetch sessions, siblings, and category sort_mode + sort_order in parallel
                const siblingFilter = siblingStatuses.length === ALL_REQUIREMENT_STATUSES.length
                    ? ''
                    : `&requirement_status=(${siblingStatuses.join(',')})`;
                const [sessionsResult, siblingsResult, categoryResult] = await Promise.all([
                    call_rest_api(`${darwinUri}/swarm_sessions?source_ref=requirement:${p.id}`, 'GET', '', idToken).catch(() => null),
                    call_rest_api(`${darwinUri}/requirements?category_fk=${p.category_fk}&fields=id,requirement_status,sort_order,completed_at,deferred_at${siblingFilter}`, 'GET', '', idToken).catch(() => null),
                    call_rest_api(`${darwinUri}/categories?id=${p.category_fk}&fields=id,sort_mode,sort_order`, 'GET', '', idToken).catch(() => null),
                ]);

                if (sessionsResult?.httpStatus?.httpStatus === 200 && sessionsResult.data.length > 0) {
                    setSessions(sessionsResult.data);
                }
                if (siblingsResult?.httpStatus?.httpStatus === 200 && siblingsResult.data.length > 0) {
                    setSiblings(siblingsResult.data);
                }
                if (categoryResult?.httpStatus?.httpStatus === 200 && categoryResult.data.length > 0) {
                    setSibSortMode(categoryResult.data[0].sort_mode || 'hand');
                    setCategorySortOrder(categoryResult.data[0].sort_order ?? null);
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

    const currentStatus = requirement?.requirement_status || 'authoring';

    // Confirmation dialog for transitions FROM met state
    const requirementReopen = useConfirmDialog({
        onConfirm: ({ targetStatus }) => {
            executeStatusChange(targetStatus);
        }
    });

    const executeStatusChange = (newStatus) => {
        const now = new Date().toISOString();
        // Auto-manage scheduled: swarm_ready sets scheduled=1, other statuses clear it
        const scheduledVal = newStatus === 'swarm_ready' ? 1 : 0;

        const updates = {
            requirement_status: newStatus,
            scheduled: scheduledVal,
            started_at: newStatus === 'development' ? now : 'NULL',
            completed_at: newStatus === 'met' ? now : 'NULL',
            deferred_at: newStatus === 'deferred' ? now : 'NULL',
        };

        setRequirement(prev => ({
            ...prev,
            requirement_status: newStatus,
            scheduled: scheduledVal,
            started_at: newStatus === 'development' ? now : null,
            completed_at: newStatus === 'met' ? now : null,
            deferred_at: newStatus === 'deferred' ? now : null,
        }));

        let uri = `${darwinUri}/requirements`;
        call_rest_api(uri, 'PUT', [{ id: parseInt(id), ...updates }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    showError(result, 'Unable to update requirement status');
                } else {
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                }
            }).catch(error => {
                showError(error, 'Unable to update requirement status');
            });
    };

    const handleStatusChange = (event, newStatus) => {
        if (newStatus === null || newStatus === currentStatus) return;

        // Require confirmation when leaving met state
        if (currentStatus === 'met') {
            requirementReopen.openDialog({ targetStatus: newStatus });
            return;
        }

        executeStatusChange(newStatus);
    };

    const handleCoordinationChange = (event, newVal) => {
        setRequirement(prev => ({ ...prev, coordination_type: newVal }));
        saveField('coordination_type', newVal === null ? 'NULL' : newVal);
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

            <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                {(() => {
                    const hasReviewSession = sessions.some(s => s.swarm_status === 'review');
                    const hasPausedSession = sessions.some(s => s.swarm_status === 'paused');
                    const hasActiveSession = sessions.some(s => ['starting', 'active', 'completing'].includes(s.swarm_status));
                    const status = requirement.requirement_status;
                    const label = status === 'met' ? "Met" :
                        status === 'deferred' ? "Deferred" :
                        hasReviewSession ? "In Review" :
                        hasPausedSession ? "Paused" :
                        hasActiveSession || status === 'development' ? "Development" :
                        status === 'swarm_ready' ? "Swarm-Start" :
                        status === 'approved' ? "Approved" :
                        "Authoring";
                    const icon = status === 'met' ?
                        <CheckCircleIcon sx={{ fontSize: 24, color: 'success.main' }} /> :
                        status === 'deferred' ?
                            <DoNotDisturbOnIcon sx={{ fontSize: 24, color: '#ff9800' }} /> :
                        hasReviewSession ?
                            <RateReviewIcon sx={{ fontSize: 24, color: '#ce93d8' }} /> :
                        hasPausedSession ?
                            <PauseCircleIcon sx={{ fontSize: 24, color: '#f0d000' }} /> :
                        hasActiveSession || status === 'development' ?
                            <RocketLaunchIcon sx={{ fontSize: 24, color: '#4caf50' }} /> :
                        status === 'swarm_ready' ?
                            <PlayCircleIcon sx={{ fontSize: 24, color: 'primary.main' }} /> :
                        status === 'approved' ?
                            <TaskAltIcon sx={{ fontSize: 24, color: '#90caf9' }} /> :
                            <EditNoteIcon sx={{ fontSize: 24, color: '#fbc02d' }} />;
                    return (
                        <Tooltip enterDelay={400} enterNextDelay={200} title={label}>
                            {icon}
                        </Tooltip>
                    );
                })()}
                <Stack direction="row" spacing={0.5} data-testid="requirement-state-selector">
                    {[
                        { value: 'authoring',   label: 'Authoring', chipSx: { bgcolor: '#fbc02d', color: '#000' } },
                        { value: 'approved',    label: 'Approved',  chipSx: { bgcolor: '#90caf9', color: '#000' } },
                        { value: 'swarm_ready', label: 'Swarm-Start', chipSx: { bgcolor: '#1976d2', color: '#fff' } },
                        { value: 'development', label: 'Dev',       chipSx: { bgcolor: '#81c784', color: '#000' } },
                        { value: 'met',         label: 'Met',       chipSx: { bgcolor: '#2e7d32', color: '#fff' } },
                        { value: 'deferred',    label: 'Deferred',  chipSx: { bgcolor: '#ff9800', color: '#fff' } },
                    ].map(({ value, label, color, chipSx }) => {
                        const selected = currentStatus === value;
                        return (
                            <Chip
                                key={value}
                                label={label}
                                size="small"
                                onClick={() => handleStatusChange(null, value)}
                                data-testid={`state-${value}`}
                                {...(selected
                                    ? (chipSx ? { sx: { ...chipSx, cursor: 'pointer' } } : { color, sx: { cursor: 'pointer' } })
                                    : { variant: 'outlined', sx: { cursor: 'pointer', opacity: 0.6 } }
                                )}
                            />
                        );
                    })}
                </Stack>
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

            {/* Swarm-Start Coordination — editable during authoring/approved/swarm_ready, full opacity only on swarm_ready, faded+disabled otherwise */}
            {(() => {
                const isReady = currentStatus === 'swarm_ready';
                const isEditable = ['authoring', 'approved', 'swarm_ready'].includes(currentStatus);
                const isFaded = !isReady;

                return (
                    <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center', opacity: isFaded ? 0.4 : 1 }}>
                        <Typography variant="subtitle2" color={isFaded ? 'text.disabled' : 'text.secondary'}>
                            Swarm-Start Coordination
                        </Typography>
                        <Stack direction="row" spacing={0.5} data-testid="coordination-type-selector">
                            {[
                                { value: 'planned',     label: 'Planned',     chipSx: { bgcolor: '#90caf9', color: '#000' } },
                                { value: 'implemented', label: 'Implemented', chipSx: { bgcolor: '#4caf50', color: '#fff' } },
                                { value: 'deployed',    label: 'Deployed',    chipSx: { bgcolor: '#b39ddb', color: '#000' } },
                            ].map(({ value, label, color, chipSx }) => {
                                const selected = requirement.coordination_type === value;
                                return (
                                    <Chip
                                        key={value}
                                        label={label}
                                        size="small"
                                        disabled={!isEditable}
                                        onClick={() => handleCoordinationChange(null, selected ? null : value)}
                                        {...(selected
                                            ? (chipSx ? { sx: { ...chipSx, cursor: isEditable ? 'pointer' : 'default' } } : { color, sx: { cursor: isEditable ? 'pointer' : 'default' } })
                                            : { variant: 'outlined', sx: { cursor: isEditable ? 'pointer' : 'default', opacity: !isEditable ? 0.3 : 0.6 } }
                                        )}
                                    />
                                );
                            })}
                        </Stack>
                    </Box>
                );
            })()}

            <Box sx={{ mb: 2 }}>
                <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}
                    data-testid="requirement-id"
                >
                    ID - {requirement.id}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Category Order - {categorySortOrder ?? '—'}
                </Typography>
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
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Requirement Met</Typography>
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
                requirement={requirement}
            />

            <Dialog
                open={requirementReopen.dialogOpen}
                onClose={() => { requirementReopen.setDialogOpen(false); requirementReopen.setInfoObject({}); }}
                data-testid="requirement-reopen-dialog"
            >
                <DialogTitle>
                    {requirementReopen.infoObject.targetStatus === 'deferred' ? 'Defer Requirement' : 'Re-open Requirement'}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {requirementReopen.infoObject.targetStatus === 'deferred'
                            ? 'This will clear the completion date and mark the requirement as deferred. Continue?'
                            : 'Re-opening will clear the completion date. Continue?'}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => { requirementReopen.setConfirmed(true); requirementReopen.setDialogOpen(false); }} variant="outlined">
                        {requirementReopen.infoObject.targetStatus === 'deferred' ? 'Defer' : 'Re-open'}
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
