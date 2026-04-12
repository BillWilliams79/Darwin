import React from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useSession, useDevServersBySession } from '../../hooks/useDataQueries';

import { renderSourceRef } from '../repoGitHubMap.jsx';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import { CircularProgress, Typography } from '@mui/material';

const labelSx = { fontWeight: 'bold', fontSize: '1.25rem' };

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

const SwarmSessionDetail = () => {

    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const { data: session, isLoading } = useSession(id);
    const { data: devServers = [] } = useDevServersBySession(id);

    const hasHistory = location.key !== 'default';
    const handleBack = () => hasHistory ? navigate(-1) : navigate('/swarm/sessions');

    if (isLoading) return <CircularProgress />;
    if (!session) return <Typography>Session not found.</Typography>;

    return (
        <Box sx={{ p: 3, maxWidth: 800 }} data-testid="swarm-session-detail">
            <Box sx={{ mb: 2 }}>
                <Button variant="outlined" onClick={handleBack}
                        data-testid="btn-back">
                    Back
                </Button>
            </Box>

            <Typography variant="h5" gutterBottom>
                Swarm Session #{session.id}
            </Typography>

            <Box sx={{ mb: 2 }}>
                <Chip label={session.swarm_status}
                      {...swarmStatusChipProps(session.swarm_status)}
                      data-testid="chip-swarm-status" />
            </Box>

            {/* --- Two-column layout for metadata --- */}
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 0, md: 4 }, mb: 3 }}>
                {/* Left column */}
                <Box sx={{ flex: 1 }}>
                    {session.title &&
                        <Box sx={{ mb: 1 }}>
                            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Title</Typography>
                            <Typography variant="body2" data-testid="session-title">{session.title}</Typography>
                        </Box>
                    }

                    {session.task_name &&
                        <Box sx={{ mb: 1 }}>
                            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Task Name</Typography>
                            <Typography variant="body2" data-testid="session-task-name">{session.task_name}</Typography>
                        </Box>
                    }

                    {session.source_type &&
                        <Box sx={{ mb: 1 }}>
                            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Source</Typography>
                            <Typography variant="body2" component="div" data-testid="session-source">
                                {session.source_type}
                                {session.source_ref && <> — {renderSourceRef(session.source_ref, navigate)}</>}
                            </Typography>
                        </Box>
                    }

                    {session.branch &&
                        <Box sx={{ mb: 1 }}>
                            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Branch</Typography>
                            <Typography variant="body2" data-testid="session-branch">{session.branch}</Typography>
                        </Box>
                    }

                    {session.pr_url &&
                        <Box sx={{ mb: 1 }}>
                            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Pull Request</Typography>
                            <Typography variant="body2" component="div">
                                <a href={session.pr_url} target="_blank" rel="noopener noreferrer"
                                   data-testid="session-pr-url">
                                    {session.pr_url}
                                </a>
                            </Typography>
                        </Box>
                    }

                    {session.worktree_path &&
                        <Box sx={{ mb: 1 }}>
                            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Worktree Path</Typography>
                            <Typography variant="body2" data-testid="session-worktree-path">
                                {session.worktree_path}
                            </Typography>
                        </Box>
                    }
                </Box>

                {/* Right column */}
                <Box sx={{ flex: 1 }}>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Started</Typography>
                        <Typography variant="body2" data-testid="session-started-at">
                            {session.started_at || '—'}
                        </Typography>
                    </Box>

                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Completed</Typography>
                        <Typography variant="body2" data-testid="session-completed-at">
                            {session.completed_at || '—'}
                        </Typography>
                    </Box>

                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Created</Typography>
                        <Typography variant="body2" data-testid="session-create-ts">
                            {session.create_ts || '—'}
                        </Typography>
                    </Box>

                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Updated</Typography>
                        <Typography variant="body2" data-testid="session-update-ts">
                            {session.update_ts || '—'}
                        </Typography>
                    </Box>

                    {devServers.length > 0 &&
                        <Box sx={{ mb: 1 }}>
                            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Dev Servers</Typography>
                            <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }} data-testid="session-dev-servers">
                                {devServers.map(ds => (
                                    <Chip
                                        key={ds.id}
                                        label={`Port ${ds.port}`}
                                        size="small"
                                        color="primary"
                                        component="a"
                                        href={`https://localhost:${ds.port}`}
                                        target="_blank"
                                        rel="noopener"
                                        clickable
                                        data-testid="chip-dev-server-port"
                                    />
                                ))}
                            </Box>
                        </Box>
                    }
                </Box>
            </Box>

            {/* --- Swarm-Start Summary (bordered section) --- */}
            {session.start_summary &&
                <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>
                        Swarm-Start Summary
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 2, mt: 0.5 }} data-testid="session-start-summary-panel">
                        <Typography variant="body2" data-testid="session-start-summary"
                                    sx={{ whiteSpace: 'pre-wrap' }}>
                            {session.start_summary}
                        </Typography>
                    </Paper>
                </Box>
            }

            {/* --- Swarm-Complete Summary (bordered section) --- */}
            {session.complete_summary &&
                <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>
                        Swarm-Complete Summary
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 2, mt: 0.5 }} data-testid="session-complete-summary-panel">
                        <Typography variant="body2" data-testid="session-complete-summary"
                                    sx={{ whiteSpace: 'pre-wrap' }}>
                            {session.complete_summary}
                        </Typography>
                    </Paper>
                </Box>
            }

            {/* --- Plan (bordered section) --- */}
            {session.plan &&
                <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>
                        Plan
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 2, mt: 0.5 }} data-testid="session-plan-panel">
                        <Typography variant="body2" data-testid="session-plan"
                                    sx={{ whiteSpace: 'pre-wrap' }}>
                            {session.plan}
                        </Typography>
                    </Paper>
                </Box>
            }

            {/* --- Telemetry (bordered section) --- */}
            {session.telemetry &&
                <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>
                        Telemetry
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 2, mt: 0.5 }} data-testid="session-telemetry-panel">
                        <Typography variant="body2" data-testid="session-telemetry"
                                    sx={{ whiteSpace: 'pre-wrap' }}>
                            {session.telemetry}
                        </Typography>
                    </Paper>
                </Box>
            }
        </Box>
    );
};

export default SwarmSessionDetail;
