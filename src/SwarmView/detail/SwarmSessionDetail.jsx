import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession, useDevServersBySession } from '../../hooks/useDataQueries';

import { renderSourceRef } from '../repoGitHubMap.jsx';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import { CircularProgress, Typography } from '@mui/material';

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

const SwarmSessionDetail = () => {

    const { id } = useParams();
    const navigate = useNavigate();

    const { data: session, isLoading } = useSession(id);
    const { data: devServers = [] } = useDevServersBySession(id);

    if (isLoading) return <CircularProgress />;
    if (!session) return <Typography>Session not found.</Typography>;

    return (
        <Box sx={{ p: 3, maxWidth: 700 }} data-testid="swarm-session-detail">
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <Button variant="outlined" onClick={() => navigate('/swarm/sessions')}
                        data-testid="btn-back-to-sessions">
                    Back to Sessions
                </Button>
                <Button variant="outlined" onClick={() => navigate('/swarm')}
                        data-testid="btn-back-to-swarm">
                    Back to Swarm
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

            {session.task_name &&
                <Box sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Task Name</Typography>
                    <Typography variant="body1" data-testid="session-task-name">{session.task_name}</Typography>
                </Box>
            }

            {session.title &&
                <Box sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Title</Typography>
                    <Typography variant="body1" data-testid="session-title">{session.title}</Typography>
                </Box>
            }

            {session.source_type &&
                <Box sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Source</Typography>
                    <Typography variant="body2" component="div" data-testid="session-source">
                        {session.source_type}
                        {session.source_ref && <> — {renderSourceRef(session.source_ref, navigate)}</>}
                    </Typography>
                </Box>
            }

            {session.branch &&
                <Box sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Branch</Typography>
                    <Typography variant="body1" data-testid="session-branch">{session.branch}</Typography>
                </Box>
            }

            {session.pr_url &&
                <Box sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Pull Request</Typography>
                    <a href={session.pr_url} target="_blank" rel="noopener noreferrer"
                       data-testid="session-pr-url">
                        {session.pr_url}
                    </a>
                </Box>
            }

            {session.worktree_path &&
                <Box sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Worktree Path</Typography>
                    <Typography variant="body2" data-testid="session-worktree-path">
                        {session.worktree_path}
                    </Typography>
                </Box>
            }

            <Box sx={{ mb: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">Started</Typography>
                <Typography variant="body2" data-testid="session-started-at">
                    {session.started_at || '—'}
                </Typography>
            </Box>

            <Box sx={{ mb: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">Completed</Typography>
                <Typography variant="body2" data-testid="session-completed-at">
                    {session.completed_at || '—'}
                </Typography>
            </Box>

            <Box sx={{ mb: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">Created</Typography>
                <Typography variant="body2" data-testid="session-create-ts">
                    {session.create_ts || '—'}
                </Typography>
            </Box>

            <Box sx={{ mb: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">Updated</Typography>
                <Typography variant="body2" data-testid="session-update-ts">
                    {session.update_ts || '—'}
                </Typography>
            </Box>

            {devServers.length > 0 &&
                <Box sx={{ mb: 1, mt: 2 }}>
                    <Typography variant="subtitle2" color="text.secondary">Dev Servers</Typography>
                    <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }} data-testid="session-dev-servers">
                        {devServers.map(ds => (
                            <Chip
                                key={ds.id}
                                label={`Port ${ds.port}`}
                                size="small"
                                color="primary"
                                onClick={() => navigate('/devservers')}
                                data-testid="chip-dev-server-port"
                            />
                        ))}
                    </Box>
                </Box>
            }
        </Box>
    );
};

export default SwarmSessionDetail;
