// /swarm/swarm-undos/:id — single-row detail page for a swarm_undo (req #2719).
// Shows the user-provided reason plus the snapshot columns that outlive the
// cascading session delete. Cross-links to the originating swarm_start (when
// known) so the user can see what was undone.
//
// Req #2769 — the Reason is editable here (the single swarm-undo editor).
// Follows the inline-save pattern from RequirementDetail: local state synced
// from the loaded row, save-on-blur (and Cmd/Ctrl+Enter) via a generic PUT to
// /swarm_undos, then cache invalidation. swarm_undos reads/writes through
// `darwinUri` (not ops-routed) — see hooks/factory/devopsQueries.js.

import { useContext, useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSwarmUndoById, useAllRequirements } from '../hooks/useDataQueries';
import { swarmUndoKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { formatDateTime } from '../utils/dateFormat';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

const coordinationChipProps = (ct) => {
    switch (ct) {
        case 'discuss':     return { sx: { bgcolor: '#f48fb1', color: '#000' } };
        case 'planned':     return { sx: { bgcolor: '#90caf9', color: '#000' } };
        case 'implemented': return { sx: { bgcolor: '#a5d6a7', color: '#000' } };
        case 'deployed':    return { sx: { bgcolor: '#ce93d8', color: '#000' } };
        default:            return null;
    }
};

const PAGE_WIDTH = 900;

export default function SwarmUndoDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { profile, idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const timezone = profile?.timezone;
    const creatorFk = profile?.userName;

    const undoId = Number(id);
    const { data: undo, isLoading, isError } = useSwarmUndoById(creatorFk, undoId);

    // Req #2769 — editable Reason. Seed local state from the loaded row and
    // keep it in sync whenever the underlying record changes (cache refresh,
    // navigation between undo ids). The TextField is the single source of
    // truth while the user types; we persist on blur / Cmd+Enter.
    const [reason, setReason] = useState('');
    useEffect(() => {
        setReason(undo?.reason ?? '');
    }, [undo?.id, undo?.reason]);

    const saveReason = () => {
        if (!undo) return;
        const next = reason;
        if (next === (undo.reason ?? '')) return;  // nothing changed
        call_rest_api(`${darwinUri}/swarm_undos`, 'PUT', [{ id: undo.id, reason: next }], idToken)
            .then(result => {
                const code = result?.httpStatus?.httpStatus;
                if (code !== 200 && code !== 204) {
                    showError(result, 'Unable to update reason');
                } else {
                    queryClient.invalidateQueries({ queryKey: swarmUndoKeys.all(creatorFk) });
                    queryClient.invalidateQueries({ queryKey: swarmUndoKeys.byId(creatorFk, undoId) });
                }
            })
            .catch(error => showError(error, 'Unable to update reason'));
    };

    const handleReasonKeyDown = (event) => {
        // Cmd/Ctrl+Enter commits; plain Enter keeps inserting newlines (the
        // reason is multiline free text).
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.target.blur();  // triggers saveReason via onBlur
        }
    };
    // Req #2719 follow-up — display the requirement as "#NNN — Title" so the
    // detail page reads like a human-curated record, not just a snapshot FK.
    // Targeted projection keeps the round-trip small; the hook already caches
    // the full list for the visualizer's `requirementById` map, so this is
    // typically a cache hit.
    const { data: allRequirements = [] } = useAllRequirements(
        creatorFk,
        { fields: 'id,title', enabled: !!creatorFk && !!undo },
    );
    const reqTitle = useMemo(() => {
        if (!undo?.req_id_at_undo) return null;
        const r = allRequirements.find(x => x.id === undo.req_id_at_undo);
        return r?.title || null;
    }, [undo, allRequirements]);

    const onBack = () => {
        if (location.state?.from) {
            navigate(location.state.from);
        } else {
            navigate('/swarm/swarm-undos');
        }
    };

    const rows = useMemo(() => {
        if (!undo) return [];
        return [
            ['Requirement', undo.req_id_at_undo
                ? <Box component="span"
                       sx={{ cursor: 'pointer', color: 'primary.main' }}
                       onClick={() => navigate(`/swarm/requirement/${undo.req_id_at_undo}`,
                                               { state: { from: location.pathname } })}
                       data-testid="swarm-undo-detail-req">
                    <Box component="span" sx={{ fontFamily: 'monospace' }}>
                        #{undo.req_id_at_undo}
                    </Box>
                    {reqTitle ? (
                        <Box component="span" sx={{ color: 'text.primary', ml: 1 }}>
                            — {reqTitle}
                        </Box>
                    ) : null}
                  </Box>
                : <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>],
            ['Task', undo.task_name || '—'],
            ['Branch', undo.branch
                ? <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {undo.branch}
                  </Typography>
                : '—'],
            ['Coordination', undo.coordination_type
                ? <Chip label={undo.coordination_type} size="small"
                        {...(coordinationChipProps(undo.coordination_type) || {})}
                        sx={{ textTransform: 'capitalize',
                              ...((coordinationChipProps(undo.coordination_type)?.sx) || {}) }} />
                : <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>],
            ['Session', undo.session_fk
                ? <Box component="span"
                       sx={{ fontFamily: 'monospace', cursor: 'pointer',
                              color: 'primary.main' }}
                       onClick={() => navigate(`/swarm/session/${undo.session_fk}`,
                                               { state: { from: location.pathname } })}>
                    #{undo.session_fk}
                  </Box>
                : <Typography variant="caption" sx={{ color: 'text.secondary' }}
                              title="Session row was deleted by /swarm-undo; snapshot columns preserve link history.">
                    (gone)
                  </Typography>],
            ['Swarm Start', undo.swarm_start_fk_at_undo
                ? <Box component="span"
                       sx={{ fontFamily: 'monospace', cursor: 'pointer',
                              color: 'primary.main' }}
                       onClick={() => navigate(`/swarm/swarm-starts/${undo.swarm_start_fk_at_undo}`,
                                               { state: { from: location.pathname } })}>
                    #{undo.swarm_start_fk_at_undo}
                  </Box>
                : <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>],
            ['Undone At', formatDateTime(undo.undone_at, timezone)],
        ];
    }, [undo, timezone, navigate, location.pathname, reqTitle]);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (isError || !undo) {
        return (
            <Box sx={{ px: 3, pt: 3, maxWidth: PAGE_WIDTH }}>
                <Button startIcon={<ArrowBackIcon />} onClick={onBack}>Back</Button>
                <Typography variant="h6" sx={{ mt: 2 }}>
                    Swarm undo #{undoId} not found
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ px: 3, pt: 3, maxWidth: PAGE_WIDTH }}
             data-testid="swarm-undo-detail">
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                <Button startIcon={<ArrowBackIcon />} onClick={onBack}
                        data-testid="swarm-undo-detail-back">Back</Button>
                <Typography variant="h6">
                    Swarm Undo #{undo.id}
                </Typography>
            </Stack>

            <Box sx={{ mb: 3 }}>
                <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                    Reason
                </Typography>
                {/* Req #2769 — editable. Persists on blur and Cmd/Ctrl+Enter. */}
                <TextField
                    variant="outlined"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    onBlur={saveReason}
                    onKeyDown={handleReasonKeyDown}
                    fullWidth
                    multiline
                    minRows={3}
                    autoComplete="off"
                    size="small"
                    sx={{ mt: 0.5 }}
                    slotProps={{ htmlInput: { 'data-testid': 'swarm-undo-detail-reason' } }}
                />
            </Box>

            <Box>
                <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                    Snapshot
                </Typography>
                <Table size="small">
                    <TableBody>
                        {rows.map(([label, value]) => (
                            <TableRow key={label}>
                                <TableCell sx={{ width: 160,
                                                  color: 'text.secondary',
                                                  borderBottom: 'none',
                                                  pl: 0, py: 0.5 }}>
                                    {label}
                                </TableCell>
                                <TableCell sx={{ borderBottom: 'none', py: 0.5 }}>
                                    {value}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Box>
        </Box>
    );
}
