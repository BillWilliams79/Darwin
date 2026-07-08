import React, { useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSession, useDevServersBySession, useAllSwarmStartSessions, useAllSwarmStarts, useAllSwarmCompleteSessions, useAllSwarmCompletes, useAllRequirements } from '../../hooks/useDataQueries';
import { sessionKeys } from '../../hooks/useQueryKeys';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import call_rest_api from '../../RestApi/RestApi';
import SwarmSessionDeleteDialog from '../SwarmSessionDeleteDialog';
import { swarmStatusChipProps, swarmStatusLabel } from '../swarmStatusChipProps';
import { aiModelChipProps, aiModelLabel } from '../modelChipStyles';
import { effortChipProps, effortLabel } from '../effortChipStyles';
import { PHASE_BUCKETS, GROUP_COLORS, bucketTokens, parsePhaseTokens, formatTokens } from '../sessionPhases';
import { formatDuration } from '../../utils/formatDuration';
import { trimMicroseconds } from '../../utils/dateFormat';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Tooltip from '@mui/material/Tooltip';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { CircularProgress, Typography } from '@mui/material';

const labelSx = { fontWeight: 'bold', fontSize: '1.25rem' };

const SwarmSessionDetail = () => {

    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
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

    // Req #2831 — the session's originating requirement. The id lives in
    // `source_ref` as `requirement:NNNN` (legacy `priority:NNNN`); the title is
    // resolved from the requirements list. Issue-sourced / unparseable refs
    // yield null and the UI falls back to the plain Title row.
    const requirementId = React.useMemo(() => {
        const m = session?.source_ref?.match(/^(?:priority|requirement):(\d+)$/);
        return m ? m[1] : null;
    }, [session?.source_ref]);

    const { data: allRequirements } = useAllRequirements(profile?.userName);
    const requirementTitle = React.useMemo(() => {
        if (!requirementId || !allRequirements) return null;
        const r = allRequirements.find(req => String(req.id) === String(requirementId));
        return r ? r.title : null;
    }, [requirementId, allRequirements]);

    const hasHistory = location.key !== 'default';
    const handleBack = () => hasHistory ? navigate(-1) : navigate('/swarm/sessions');

    const sessionDelete = useConfirmDialog({
        onConfirm: ({ sessionId }) => {
            // Req #2837/#2829 — read/write swarm_sessions via `darwinUri` so the dev UI
            // (darwin_dev) deletes the row it actually shows; prod no-op
            // (darwinUri === darwinOpsUri). Completes the req #2827/#2834 sweep.
            const uri = `${darwinUri}/swarm_sessions`;
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
                {/* req #2909 — the Claude model the session ran with */}
                <Chip label={aiModelLabel(session.ai_model)}
                      size="small"
                      {...aiModelChipProps(session.ai_model)}
                      data-testid="chip-ai-model" />
                {/* req #2916 — the Claude Code effort level the session ran with */}
                <Chip label={effortLabel(session.effort)}
                      size="small"
                      {...effortChipProps(session.effort)}
                      data-testid="chip-effort" />
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

            {/* --- Two-column layout: the four aligned metadata rows (req #2832).
                 Left and right columns are kept row-for-row aligned: Requirement↔Started,
                 Swarm-Start↔Completed, Swarm-Complete↔Created, Pull Request↔Updated. --- */}
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 0, md: 4 }, mb: 3 }}>
                {/* Left column — the four aligned rows */}
                <Box sx={{ flex: 1 }}>
                    {requirementId ? (
                        <Box sx={{ mb: 1 }} data-testid="session-requirement">
                            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Requirement</Typography>
                            <Typography variant="body2" component="div">
                                <Chip label={`#${requirementId}`} size="small" variant="outlined"
                                      onClick={() => navigate(`/swarm/requirement/${requirementId}`)}
                                      sx={{ cursor: 'pointer', mr: 1 }}
                                      data-testid="session-requirement-chip" />
                                {(requirementTitle || session.title) &&
                                    <Typography component="span" variant="body2">
                                        — {requirementTitle || session.title}
                                    </Typography>
                                }
                            </Typography>
                        </Box>
                    ) : session.title &&
                        <Box sx={{ mb: 1 }}>
                            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Title</Typography>
                            <Typography variant="body2" data-testid="session-title">{session.title}</Typography>
                        </Box>
                    }

                    {swarmStart &&
                        <Box sx={{ mb: 1 }} data-testid="session-launched-by">
                            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Swarm-Start</Typography>
                            <Typography variant="body2" component="div">
                                <Chip label={`#${swarmStart.id}`} size="small" variant="outlined"
                                      onClick={() => navigate(`/swarm/swarm-starts/${swarmStart.id}`)}
                                      sx={{ cursor: 'pointer' }}
                                      data-testid="session-launched-by-chip" />
                            </Typography>
                        </Box>
                    }

                    {swarmComplete &&
                        <Box sx={{ mb: 1 }} data-testid="session-closed-by">
                            <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Swarm-Complete</Typography>
                            <Typography variant="body2" component="div">
                                <Chip label={`#${swarmComplete.id}`} size="small" variant="outlined"
                                      onClick={() => navigate(`/swarm/swarm-completes/${swarmComplete.id}`)}
                                      sx={{ cursor: 'pointer' }}
                                      data-testid="session-closed-by-chip" />
                            </Typography>
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
                </Box>

                {/* Right column — timestamps, microseconds trimmed (req #2832) */}
                <Box sx={{ flex: 1 }}>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Started</Typography>
                        <Typography variant="body2" data-testid="session-started-at">
                            {trimMicroseconds(session.started_at)}
                        </Typography>
                    </Box>

                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Completed</Typography>
                        <Typography variant="body2" data-testid="session-completed-at">
                            {trimMicroseconds(session.completed_at)}
                        </Typography>
                    </Box>

                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Created</Typography>
                        <Typography variant="body2" data-testid="session-create-ts">
                            {trimMicroseconds(session.create_ts)}
                        </Typography>
                    </Box>

                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Updated</Typography>
                        <Typography variant="body2" data-testid="session-update-ts">
                            {trimMicroseconds(session.update_ts)}
                        </Typography>
                    </Box>
                </Box>
            </Box>

            {/* --- Phase breakdown (req #2332) — moved up directly under the aligned rows (req #2832) --- */}
            <SessionPhaseBreakdown session={session} />

            {/* --- Full-width detail rows (req #2832): task / branch / worktree have no
                 right-column companion, so they span the full width and don't wrap in a
                 narrow column. Dev Servers rides along as another full-width detail. --- */}
            <Box sx={{ mb: 3 }}>
                {session.task_name &&
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Task Name</Typography>
                        <Typography variant="body2" data-testid="session-task-name">{session.task_name}</Typography>
                    </Box>
                }

                {session.branch &&
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>Branch</Typography>
                        <Typography variant="body2" data-testid="session-branch">{session.branch}</Typography>
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

            {/* --- Swarm-Start Summary (collapsible, default collapsed — req #2832) --- */}
            {session.start_summary &&
                <CollapsibleSection title="Swarm-Start Summary" testId="session-start-summary">
                    <Paper variant="outlined" sx={{ p: 2, mt: 0.5 }} data-testid="session-start-summary-panel">
                        <Typography variant="body2" data-testid="session-start-summary"
                                    sx={{ whiteSpace: 'pre-wrap' }}>
                            {session.start_summary}
                        </Typography>
                    </Paper>
                </CollapsibleSection>
            }

            {/* --- Swarm-Complete Summary (collapsible, default collapsed — req #2832) --- */}
            {session.complete_summary &&
                <CollapsibleSection title="Swarm-Complete Summary" testId="session-complete-summary">
                    <Paper variant="outlined" sx={{ p: 2, mt: 0.5 }} data-testid="session-complete-summary-panel">
                        <Typography variant="body2" data-testid="session-complete-summary"
                                    sx={{ whiteSpace: 'pre-wrap' }}>
                            {session.complete_summary}
                        </Typography>
                    </Paper>
                </CollapsibleSection>
            }

            {/* --- Plan (collapsible, default collapsed — req #2835) --- */}
            {session.plan &&
                <CollapsibleSection title="Plan" testId="session-plan">
                    <Paper variant="outlined" sx={{ p: 2, mt: 0.5 }} data-testid="session-plan-panel">
                        <Typography variant="body2" data-testid="session-plan"
                                    sx={{ whiteSpace: 'pre-wrap' }}>
                            {session.plan}
                        </Typography>
                    </Paper>
                </CollapsibleSection>
            }

            {/* --- Telemetry (collapsible, default collapsed — req #2832) --- */}
            {session.telemetry &&
                <CollapsibleSection title="Telemetry" testId="session-telemetry">
                    <Paper variant="outlined" sx={{ p: 2, mt: 0.5 }} data-testid="session-telemetry-panel">
                        <Typography variant="body2" data-testid="session-telemetry"
                                    sx={{ whiteSpace: 'pre-wrap' }}>
                            {session.telemetry}
                        </Typography>
                    </Paper>
                </CollapsibleSection>
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

// Collapsible bordered section (req #2832). The title row is the toggle —
// clicking it expands/collapses the body. Default collapsed; used for the large
// Swarm-Start / Swarm-Complete summaries and the Telemetry blob.
function CollapsibleSection({ title, testId, defaultExpanded = false, children }) {
    const [expanded, setExpanded] = React.useState(defaultExpanded);
    return (
        <Box sx={{ mb: 2 }} data-testid={testId ? `${testId}-section` : undefined}>
            <Box
                onClick={() => setExpanded(e => !e)}
                role="button"
                aria-expanded={expanded}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', userSelect: 'none' }}
                data-testid={testId ? `${testId}-toggle` : undefined}
            >
                {expanded
                    ? <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                    : <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary' }} />}
                <Typography variant="subtitle2" color="text.secondary" sx={labelSx}>
                    {title}
                </Typography>
            </Box>
            <Collapse in={expanded} unmountOnExit>
                {children}
            </Collapse>
        </Box>
    );
}

// Phase breakdown for session detail (req #2332). The data comes from the 8
// INT *_secs columns on swarm_sessions, not from parsed telemetry. For legacy
// sessions (instrumented===0), only legacy_secs is shown.
// Each phase has its own color (matched to its status chip) for the bar + dots;
// the agentic/human/machine subtotal chips below use GROUP_COLORS. The
// PHASE_BUCKETS / GROUP_COLORS constants live in ../sessionPhases (shared with
// SessionsStatsView, req #2825).
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

    // Per-phase token cost (req #2839). NULL phase_tokens (no token
    // instrumentation) → hasTokens=false → the token column/total is hidden so
    // the layout stays identical to a pre-#2839 session.
    const parsedTokens = parsePhaseTokens(session.phase_tokens);

    // Instrumented session — collect nonzero phases
    const phases = PHASE_BUCKETS
        .map(b => ({ ...b, seconds: Number(session[b.key]) || 0,
                     tokens: bucketTokens(parsedTokens, b.key) }))
        .filter(b => b.seconds > 0);

    if (phases.length === 0) return null;

    const total = phases.reduce((sum, p) => sum + p.seconds, 0);
    const totalTokens = phases.reduce((sum, p) => sum + p.tokens, 0);
    const hasTokens = totalTokens > 0;

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
                    <Tooltip key={p.key}
                             title={`${p.label}: ${formatDuration(p.seconds)}${p.tokens > 0 ? ` · ${formatTokens(p.tokens)} tok` : ''}`}
                             enterDelay={200}>
                        <Box sx={{
                            width: `${(p.seconds / total) * 100}%`,
                            bgcolor: p.color,
                            minWidth: 2,
                        }} />
                    </Tooltip>
                ))}
            </Box>

            {/* Per-phase list — a Token Cost column is appended only when this
                session carries token instrumentation (req #2839). */}
            <Box sx={{ display: 'grid',
                       gridTemplateColumns: hasTokens ? 'auto 1fr auto auto' : 'auto 1fr auto',
                       columnGap: 1.5, rowGap: 0.5, alignItems: 'center' }}>
                {phases.map(p => (
                    <React.Fragment key={p.key}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: p.color }} />
                        <Typography variant="body2">{p.label}</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', textAlign: 'right' }}>
                            {formatDuration(p.seconds)}
                        </Typography>
                        {hasTokens && (
                            <Typography variant="body2"
                                        sx={{ fontFamily: 'monospace', textAlign: 'right', color: 'text.secondary' }}>
                                {p.tokens > 0 ? `${formatTokens(p.tokens)} tok` : '—'}
                            </Typography>
                        )}
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
                    Total: {formatDuration(total)}{hasTokens ? ` · ${formatTokens(totalTokens)} tok` : ''}
                </Typography>
            </Box>
        </Box>
    );
}

export default SwarmSessionDetail;
