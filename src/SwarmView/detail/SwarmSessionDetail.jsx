import React, { useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSession, useDevServersBySession, useAllSwarmStartSessions, useAllSwarmStarts, useAllSwarmCompleteSessions, useAllSwarmCompletes } from '../../hooks/useDataQueries';
import { sessionKeys } from '../../hooks/useQueryKeys';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import call_rest_api from '../../RestApi/RestApi';
import SwarmSessionDeleteDialog from '../SwarmSessionDeleteDialog';
import { swarmStatusChipProps, swarmStatusLabel } from '../swarmStatusChipProps';
import { formatDuration } from '../../utils/formatDuration';

import { renderSourceRef } from '../repoGitHubMap.jsx';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Tooltip from '@mui/material/Tooltip';
import DeleteIcon from '@mui/icons-material/Delete';
import { CircularProgress, Typography } from '@mui/material';

const labelSx = { fontWeight: 'bold', fontSize: '1.25rem' };

const SwarmSessionDetail = () => {

    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const { idToken, profile } = useContext(AuthContext);
    const { darwinOpsUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);

    const { data: session, isLoading } = useSession(id);
    const { data: devServers = [] } = useDevServersBySession(id);
    // Req #2422 — reverse junction lookup for the parent swarm_start.
    // Multi-parent policy: pick the most-recent swarm_start (highest fk).
    // Matches SessionsView's last-most-recent-wins map and the MCP resource's
    // ORDER BY id DESC — all three paths converge on the same parent.
    const { data: swarmStartSessions } = useAllSwarmStartSessions(profile?.userName);
    const { data: swarmStarts } = useAllSwarmStarts(profile?.userName);
    const swarmStart = React.useMemo(() => {
        if (!swarmStartSessions || !swarmStarts) return null;
        const links = swarmStartSessions
            .filter(j => String(j.session_fk) === String(id))
            .sort((a, b) => b.swarm_start_fk - a.swarm_start_fk);
        if (links.length === 0) return null;
        return swarmStarts.find(s => s.id === links[0].swarm_start_fk) || null;
    }, [swarmStartSessions, swarmStarts, id]);

    // Req #2497 — reverse junction lookup for the swarm_complete that closed
    // this session. Same multi-parent policy (most-recent fk wins). Works for
    // both worker sessions (closed by /swarm-complete) and primary-fix sessions
    // (closed by /primary-ai-swarm-complete).
    const { data: swarmCompleteSessions } = useAllSwarmCompleteSessions(profile?.userName);
    const { data: swarmCompletes } = useAllSwarmCompletes(profile?.userName);
    const swarmComplete = React.useMemo(() => {
        if (!swarmCompleteSessions || !swarmCompletes) return null;
        const links = swarmCompleteSessions
            .filter(j => String(j.session_fk) === String(id))
            .sort((a, b) => b.swarm_complete_fk - a.swarm_complete_fk);
        if (links.length === 0) return null;
        return swarmCompletes.find(s => s.id === links[0].swarm_complete_fk) || null;
    }, [swarmCompleteSessions, swarmCompletes, id]);

    const hasHistory = location.key !== 'default';
    const handleBack = () => hasHistory ? navigate(-1) : navigate('/swarm/sessions');

    const sessionDelete = useConfirmDialog({
        onConfirm: ({ sessionId }) => {
            // Req #2697 — operational tables live exclusively in `darwin`.
            const uri = `${darwinOpsUri}/swarm_sessions`;
            call_rest_api(uri, 'DELETE', { id: sessionId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        if (profile?.userName) {
                            queryClient.invalidateQueries({ queryKey: sessionKeys.all(profile.userName) });
                        }
                        queryClient.invalidateQueries({ queryKey: sessionKeys.byId(id) });
                        navigate('/swarm/sessions');
                    } else {
                        showError(result, 'Unable to delete session');
                    }
                })
                .catch(error => showError(error, 'Unable to delete session'));
        }
    });

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

            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip label={swarmStatusLabel(session.swarm_status)}
                      {...swarmStatusChipProps(session.swarm_status)}
                      data-testid="chip-swarm-status" />
                <Tooltip title="Delete session" enterDelay={400} enterNextDelay={200}>
                    <IconButton
                        onClick={() => sessionDelete.openDialog({ sessionId: parseInt(id) })}
                        data-testid="btn-delete-session"
                        sx={{ maxWidth: '25px', maxHeight: '25px' }}
                    >
                        <DeleteIcon />
                    </IconButton>
                </Tooltip>
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

                    {swarmStart &&
                        <Box sx={{ mb: 1 }} data-testid="session-launched-by">
                            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Launched by</Typography>
                            <Typography variant="body2" component="div">
                                <Chip label={`Swarm Start #${swarmStart.id}`} size="small" variant="outlined"
                                      onClick={() => navigate(`/swarm/swarm-starts/${swarmStart.id}`)}
                                      sx={{ cursor: 'pointer', mr: 1 }}
                                      data-testid="session-launched-by-chip" />
                                <Typography component="span" variant="body2"
                                            sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                                    /swarm-start{swarmStart.arguments ? ` ${swarmStart.arguments}` : ''}
                                </Typography>
                            </Typography>
                        </Box>
                    }

                    {swarmComplete && (() => {
                        const toks = ['tokens_input', 'tokens_cache_write', 'tokens_cache_read', 'tokens_output']
                            .reduce((sum, k) => sum + (Number(swarmComplete[k]) || 0), 0);
                        const wall = formatDuration(swarmComplete.wall_seconds);
                        const facts = [
                            `status ${swarmComplete.status}`,
                            wall !== '—' ? `took ${wall}` : null,
                            toks > 0 ? `cost ${toks.toLocaleString()} tok` : null,
                        ].filter(Boolean).join(' · ');
                        return (
                            <Box sx={{ mb: 1 }} data-testid="session-closed-by">
                                <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Closed by</Typography>
                                <Typography variant="body2" component="div">
                                    <Chip label={`Complete #${swarmComplete.id}`} size="small" variant="outlined"
                                          onClick={() => navigate(`/swarm/swarm-completes/${swarmComplete.id}`)}
                                          sx={{ cursor: 'pointer', mr: 1 }}
                                          data-testid="session-closed-by-chip" />
                                    <Typography component="span" variant="body2"
                                                sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                                        /{swarmComplete.skill_name} — {facts}
                                    </Typography>
                                </Typography>
                            </Box>
                        );
                    })()}

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

            {/* --- Phase breakdown (req #2332) --- */}
            <SessionPhaseBreakdown session={session} />

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

            <SwarmSessionDeleteDialog
                deleteDialogOpen={sessionDelete.dialogOpen}
                setDeleteDialogOpen={sessionDelete.setDialogOpen}
                setDeleteId={sessionDelete.setInfoObject}
                setDeleteConfirmed={sessionDelete.setConfirmed}
                session={session}
            />
        </Box>
    );
};

// Phase breakdown for session detail (req #2332). The data comes from the 8
// INT *_secs columns on swarm_sessions, not from parsed telemetry. For legacy
// sessions (instrumented===0), only legacy_secs is shown.
// Each phase has its own color (matched to its status chip) for the bar + dots;
// the agentic/human/machine subtotal chips below use GROUP_COLORS.
const PHASE_BUCKETS = [
    { key: 'starting_secs',      label: 'Starting',      group: 'machine', color: '#5c6bc0' },
    { key: 'waiting_secs',       label: 'Waiting',       group: 'human',   color: '#ffb74d' },
    { key: 'planning_secs',      label: 'Planning',      group: 'agentic', color: '#4fc3f7' },
    { key: 'implementing_secs',  label: 'Implementing',  group: 'agentic', color: '#4caf50' },
    { key: 'review_secs',        label: 'Review',        group: 'human',   color: '#ce93d8' },
    { key: 'completion_secs',    label: 'Completion',    group: 'agentic', color: '#8d6e63' },
    { key: 'paused_secs',        label: 'Paused',        group: 'human',   color: '#f0d000' },
    { key: 'legacy_secs',        label: 'Legacy',        group: 'legacy',  color: '#bdbdbd' },
];

const GROUP_COLORS = {
    agentic: '#4fc3f7',
    human:   '#ffb74d',
    machine: '#90caf9',
    legacy:  '#bdbdbd',
};

function SessionPhaseBreakdown({ session }) {
    if (!session) return null;

    const isLegacy = !session.instrumented;

    // For legacy sessions, show only the legacy total
    if (isLegacy) {
        if (session.legacy_secs == null) return null;
        return (
            <Box sx={{ mb: 2 }} data-testid="session-phase-breakdown">
                <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>
                    Phase Breakdown
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    <Chip label="Legacy" size="small" variant="outlined" />
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {formatDuration(session.legacy_secs)}
                    </Typography>
                </Box>
            </Box>
        );
    }

    // Instrumented session — collect nonzero phases
    const phases = PHASE_BUCKETS
        .map(b => ({ ...b, seconds: Number(session[b.key]) || 0 }))
        .filter(b => b.seconds > 0);

    if (phases.length === 0) return null;

    const total = phases.reduce((sum, p) => sum + p.seconds, 0);

    // Subtotals
    const agenticSecs = phases.filter(p => p.group === 'agentic').reduce((s, p) => s + p.seconds, 0);
    const humanSecs = phases.filter(p => p.group === 'human').reduce((s, p) => s + p.seconds, 0);
    const machineSecs = phases.filter(p => p.group === 'machine').reduce((s, p) => s + p.seconds, 0);

    return (
        <Box sx={{ mb: 2 }} data-testid="session-phase-breakdown">
            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>
                Phase Breakdown
            </Typography>

            {/* Proportional stacked mini-bar */}
            <Box sx={{ display: 'flex', height: 10, borderRadius: 1, overflow: 'hidden', mt: 0.5, mb: 1 }}>
                {phases.map(p => (
                    <Tooltip key={p.key} title={`${p.label}: ${formatDuration(p.seconds)}`} enterDelay={200}>
                        <Box sx={{
                            width: `${(p.seconds / total) * 100}%`,
                            bgcolor: p.color,
                            minWidth: 2,
                        }} />
                    </Tooltip>
                ))}
            </Box>

            {/* Per-phase list */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 0.5, alignItems: 'center' }}>
                {phases.map(p => (
                    <React.Fragment key={p.key}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: p.color }} />
                        <Typography variant="body2">{p.label}</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', textAlign: 'right' }}>
                            {formatDuration(p.seconds)}
                        </Typography>
                    </React.Fragment>
                ))}
            </Box>

            {/* Subtotals */}
            <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                {agenticSecs > 0 && (
                    <Chip label={`Agentic: ${formatDuration(agenticSecs)}`} size="small"
                          sx={{ bgcolor: GROUP_COLORS.agentic, color: '#000' }} />
                )}
                {humanSecs > 0 && (
                    <Chip label={`Human: ${formatDuration(humanSecs)}`} size="small"
                          sx={{ bgcolor: GROUP_COLORS.human, color: '#000' }} />
                )}
                {machineSecs > 0 && (
                    <Chip label={`Machine: ${formatDuration(machineSecs)}`} size="small"
                          sx={{ bgcolor: GROUP_COLORS.machine, color: '#000' }} />
                )}
                <Typography variant="body2" sx={{ fontFamily: 'monospace', alignSelf: 'center' }}>
                    Total: {formatDuration(total)}
                </Typography>
            </Box>
        </Box>
    );
}

export default SwarmSessionDetail;
