import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import call_rest_api from '../../RestApi/RestApi';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { formatDateTime, formatDate } from '../../utils/dateFormat';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { DataGrid } from '@mui/x-data-grid';

import { renderSourceRef } from '../repoGitHubMap.jsx';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import { CircularProgress, Typography } from '@mui/material';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import HotelIcon from '@mui/icons-material/Hotel';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';

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

const PriorityDetail = () => {

    const { id } = useParams();
    const navigate = useNavigate();
    const { idToken, profile } = useContext(AuthContext);
    const timezone = profile?.timezone;
    const { darwinUri } = useContext(AppContext);

    const [priority, setPriority] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);

    const showError = useSnackBarStore(s => s.showError);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const priorityUri = `${darwinUri}/priorities?id=${id}`;
                const result = await call_rest_api(priorityUri, 'GET', '', idToken);

                if (result.httpStatus.httpStatus !== 200 || result.data.length === 0) {
                    showError(result, 'Unable to load priority');
                    setLoading(false);
                    return;
                }

                const p = result.data[0];
                setPriority(p);

                // Fetch sessions linked via source_ref="priority:<id>"
                try {
                    const sessionsUri = `${darwinUri}/swarm_sessions?source_ref=priority:${p.id}`;
                    const sessionsResult = await call_rest_api(sessionsUri, 'GET', '', idToken);
                    if (sessionsResult.httpStatus.httpStatus === 200 && sessionsResult.data.length > 0) {
                        setSessions(sessionsResult.data);
                    }
                } catch {
                    // 404 or error — no linked sessions
                }
            } catch (error) {
                showError(error, 'Unable to load priority');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [id, idToken, darwinUri]);

    const saveField = (field, value) => {
        let uri = `${darwinUri}/priorities`;
        call_rest_api(uri, 'PUT', [{ id: parseInt(id), [field]: value }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    showError(result, `Unable to update ${field}`);
                }
            }).catch(error => {
                showError(error, `Unable to update ${field}`);
            });
    };

    const handleTitleBlur = () => {
        if (priority) saveField('title', priority.title);
    };

    const handleTitleKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveField('title', priority.title);
        }
    };

    const handleDescriptionBlur = () => {
        if (priority) saveField('description', priority.description || '');
    };

    const handleScheduledToggle = () => {
        const newVal = priority.scheduled ? 0 : 1;
        setPriority(prev => ({ ...prev, scheduled: newVal }));
        saveField('scheduled', newVal);
    };

    const handleClosedToggle = () => {
        const newVal = priority.closed ? 0 : 1;
        const updates = { closed: newVal };
        if (newVal === 1) {
            updates.completed_at = new Date().toISOString();
        } else {
            updates.completed_at = 'NULL';
        }
        setPriority(prev => ({
            ...prev,
            closed: newVal,
            completed_at: newVal === 1 ? new Date().toISOString() : null,
        }));

        let uri = `${darwinUri}/priorities`;
        call_rest_api(uri, 'PUT', [{ id: parseInt(id), ...updates }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    showError(result, 'Unable to update closed status');
                }
            }).catch(error => {
                showError(error, 'Unable to update closed status');
            });
    };

    if (loading) return <CircularProgress />;
    if (!priority) return <Typography>Priority not found.</Typography>;

    return (
        <Box sx={{ p: 3, maxWidth: 800 }} data-testid="priority-detail">
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <Button variant="outlined"
                        onClick={() => navigate(sessions.length === 1 ? `/swarm/session/${sessions[0].id}` : '/swarm')}
                        data-testid="btn-back-to-swarm">
                    {sessions.length === 1 ? 'Go to Session' : 'Back to Roadmap'}
                </Button>
            </Box>

            <TextField
                variant="standard"
                value={priority.title || ''}
                onChange={(e) => setPriority(prev => ({ ...prev, title: e.target.value }))}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                fullWidth
                autoComplete="off"
                slotProps={{
                    input: { style: { fontSize: 24, fontWeight: 500 } },
                    htmlInput: { maxLength: 256 }
                }}
                sx={{ mb: 2 }}
                data-testid="priority-title"
            />

            <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
                {(() => {
                    const activeStatuses = ['starting', 'active', 'completing'];
                    const hasActiveSession = sessions.some(s => activeStatuses.includes(s.swarm_status));
                    const isDisabled = hasActiveSession || priority.closed === 1;
                    const button = (
                        <IconButton
                            onClick={handleScheduledToggle}
                            disabled={isDisabled}
                            data-testid="toggle-scheduled"
                        >
                            {priority.scheduled ?
                                <PlayCircleIcon sx={{ fontSize: 28, color: isDisabled ? 'text.disabled' : 'primary.main' }} /> :
                                <PlayCircleOutlineIcon sx={{ fontSize: 28, color: 'text.disabled' }} />
                            }
                        </IconButton>
                    );
                    return isDisabled ? button : (
                        <Tooltip title={priority.scheduled ? "Scheduled for Swarm-Start" : "Schedule for Swarm-Start"} enterDelay={400} enterNextDelay={200}>
                            {button}
                        </Tooltip>
                    );
                })()}
                {(() => {
                    const hasPausedSession = sessions.some(s => s.swarm_status === 'paused');
                    const hasActiveSession = sessions.some(s => ['starting', 'active', 'completing'].includes(s.swarm_status));
                    const label = priority.closed ? "Completed" :
                        hasPausedSession ? "Paused" :
                        hasActiveSession || priority.in_progress ? "In Progress" :
                        "Not Started";
                    const icon = priority.closed ?
                        <CheckCircleIcon sx={{ fontSize: 24, color: 'success.main' }} /> :
                        hasPausedSession ?
                            <PauseCircleIcon sx={{ fontSize: 24, color: '#f0d000' }} /> :
                            hasActiveSession || priority.in_progress ?
                                <RocketLaunchIcon sx={{ fontSize: 24, color: '#4caf50' }} /> :
                                <HotelIcon sx={{ fontSize: 24, color: 'text.disabled' }} />;
                    return (
                        <Tooltip enterDelay={400} enterNextDelay={200} title={label}>
                            {icon}
                        </Tooltip>
                    );
                })()}
                <FormControlLabel
                    control={
                        <Switch
                            checked={priority.closed === 1}
                            onChange={handleClosedToggle}
                            color="success"
                        />
                    }
                    label="Closed"
                    data-testid="toggle-closed"
                />
            </Box>

            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">Description</Typography>
                <TextField
                    variant="outlined"
                    value={priority.description || ''}
                    onChange={(e) => setPriority(prev => ({ ...prev, description: e.target.value }))}
                    onBlur={handleDescriptionBlur}
                    fullWidth
                    multiline
                    minRows={3}
                    autoComplete="off"
                    size="small"
                    data-testid="priority-description"
                />
            </Box>

            <Box sx={{ mb: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">Started</Typography>
                <Typography variant="body2" data-testid="priority-started-at">
                    {priority.started_at ? formatDateTime(priority.started_at, timezone) : '—'}
                </Typography>
            </Box>

            <Box sx={{ mb: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">Completed</Typography>
                <Typography variant="body2" data-testid="priority-completed-at">
                    {priority.completed_at ? formatDateTime(priority.completed_at, timezone) : '—'}
                </Typography>
            </Box>

            <Box sx={{ mb: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">Created</Typography>
                <Typography variant="body2" data-testid="priority-create-ts">
                    {priority.create_ts ? formatDateTime(priority.create_ts, timezone) : '—'}
                </Typography>
            </Box>

            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" color="text.secondary">Updated</Typography>
                <Typography variant="body2" data-testid="priority-update-ts">
                    {priority.update_ts ? formatDateTime(priority.update_ts, timezone) : '—'}
                </Typography>
            </Box>

            <Typography variant="h6" gutterBottom>Linked Sessions</Typography>
            {sessions.length === 0 ? (
                <Typography variant="body2" color="text.secondary" data-testid="no-linked-sessions">
                    No sessions linked to this priority.
                </Typography>
            ) : (
                <Box sx={{ height: 300 }} data-testid="linked-sessions-grid">
                    <DataGrid
                        rows={sessions}
                        columns={getSessionColumns(navigate, timezone)}
                        density="compact"
                        disableRowSelectionOnClick
                        onRowClick={(params) => navigate(`/swarm/session/${params.id}`)}
                        sx={{ cursor: 'pointer' }}
                    />
                </Box>
            )}
        </Box>
    );
};

export default PriorityDetail;
