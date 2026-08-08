// /swarm/swarm-starts/:id — single-row detail page for a swarm_start (req #2422).
// Same content shape as the prior dialog (Invocation header → Summary table
// → Token totals → Raw telemetry), now a route page so the user lands here
// from /swarm/sessions or /swarm/session/:id with the proper origin in
// browser history. Back button restores the originating route.

import { useContext, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { swarmStartKeys, swarmStartSessionKeys } from '../hooks/useQueryKeys';
import {
    useSwarmStartById,
    useSessions,
    useAllSwarmStartSessions,
    useMachines,
} from '../hooks/useDataQueries';
import { formatDateTime } from '../utils/dateFormat';
import { formatDuration } from '../utils/formatDuration';
import { swarmStatusChipProps, swarmStatusLabel } from '../SwarmView/swarmStatusChipProps';
import { aiModelChipProps, aiModelLabel } from '../SwarmView/modelChipStyles';
import { effortChipProps, effortLabel } from '../SwarmView/effortChipStyles';
import { parseSummary } from './SwarmStartsPage';
import { selectSessionsForSwarmStart } from './sessionFilter';
import SwarmStartDeleteDialog from './SwarmStartDeleteDialog';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import { DataGrid } from '@mui/x-data-grid';

const SYNTHESIZED_HEADERS = ['Session', 'Branch', 'Autonomy', 'Terminal', 'PRs'];

const getLinkedSessionColumns = (timezone) => [
    { field: 'id', headerName: 'ID', width: 70, type: 'number' },
    {
        field: 'swarm_status',
        headerName: 'Status',
        width: 110,
        renderCell: (params) => (
            <Chip label={swarmStatusLabel(params.value)} size="small"
                  {...swarmStatusChipProps(params.value)} />
        ),
    },
    { field: 'title',    headerName: 'Title',  flex: 1, minWidth: 220 },
    // Branch names follow `feature/<reqId>-<task-name>-N` and routinely run 35–45 chars
    // (e.g. `feature/2494-swarm-start-editor-links-1`). 360px also covers historical
    // pre-numeric-prefix branches (~52 chars, e.g. `feature/swarm-complete-writes-
    // darwinai-config-directly-to-1`) on one line at density="compact"; anything
    // narrower wraps and inflates row height.
    { field: 'branch',   headerName: 'Branch', width: 360 },
    {
        // req #2955 — each linked session carries its own ai_model/effort.
        field: 'ai_model',
        headerName: 'Model',
        width: 70,
        renderCell: (params) => (
            <Chip label={aiModelLabel(params.value)} size="small"
                  {...aiModelChipProps(params.value)}
                  data-testid="chip-ai-model" />
        ),
    },
    {
        field: 'effort',
        headerName: 'Effort',
        width: 90,
        renderCell: (params) => (
            <Chip label={effortLabel(params.value)} size="small"
                  {...effortChipProps(params.value)}
                  data-testid="chip-effort" />
        ),
    },
    {
        field: 'duration',
        headerName: 'Duration',
        width: 110,
        valueGetter: (value, row) => {
            if (row.instrumented) {
                return (Number(row.starting_secs) || 0) + (Number(row.waiting_secs) || 0)
                    + (Number(row.planning_secs) || 0) + (Number(row.implementing_secs) || 0)
                    + (Number(row.review_secs) || 0) + (Number(row.completion_secs) || 0)
                    + (Number(row.paused_secs) || 0) + (Number(row.legacy_secs) || 0);
            }
            return row.legacy_secs != null ? Number(row.legacy_secs) : null;
        },
        valueFormatter: (value) => formatDuration(value),
    },
    {
        field: 'started_at',
        headerName: 'Started',
        width: 170,
        valueFormatter: (value) => value ? formatDateTime(value, timezone) : '—',
    },
    {
        field: 'completed_at',
        headerName: 'Completed',
        width: 170,
        valueFormatter: (value) => value ? formatDateTime(value, timezone) : '—',
    },
];

export default function SwarmStartDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);

    const swarmStartId = parseInt(id);
    const { data: row, isLoading } = useSwarmStartById(creatorFk, swarmStartId);

    // Req #2494 — linked-sessions table. Junction is global; user-scope falls
    // out naturally when filtered against the user's own `useSessions` list.
    const { data: sessionsArray, isLoading: sessionsLoading, isError: sessionsError } =
        useSessions(creatorFk);
    const { data: junction, isLoading: junctionLoading, isError: junctionError } =
        useAllSwarmStartSessions(creatorFk);
    // req #2943 — resolve this start's machine name from the machines cache.
    const { data: machinesData = [] } = useMachines(creatorFk);
    const machineName = useMemo(() => {
        if (!row || row.machine_fk == null) return null;
        const m = machinesData.find(x => x.id === row.machine_fk);
        return m ? m.title : `#${row.machine_fk}`;
    }, [machinesData, row]);

    const linkedSessions = useMemo(
        () => selectSessionsForSwarmStart(sessionsArray, junction, swarmStartId),
        [sessionsArray, junction, swarmStartId]
    );
    // req #3265 code review (re-verify pass, finding 1) — a settled query
    // error leaves isLoading false, so isError must gate the delete affordance
    // too or a failed sessions/junction fetch reads as "confirmed unlinked".
    const linkedLoading = sessionsLoading || junctionLoading || sessionsError || junctionError;
    const linkedSectionRef = useRef(null);

    // req #3265 — delete affordance. This is a CLIENT-SIDE guard only: the
    // dialog disables Delete and names linked sessions while `linkedLoading`
    // gates it during the fetch, but there is no database-level backstop
    // (swarm_start_sessions.swarm_start_fk is ON DELETE CASCADE, not
    // RESTRICT — see SwarmStartDeleteDialog.jsx).
    const swarmStartDelete = useConfirmDialog({
        onConfirm: ({ swarmStartId: deleteId }) => {
            const uri = `${darwinUri}/swarm_starts`;
            call_rest_api(uri, 'DELETE', { id: deleteId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200 || result.httpStatus.httpStatus === 204) {
                        queryClient.invalidateQueries({ queryKey: swarmStartKeys.all(creatorFk) });
                        queryClient.invalidateQueries({ queryKey: swarmStartSessionKeys.all(creatorFk) });
                        navigate('/swarm/swarm-starts');
                    } else {
                        showError(result, 'Unable to delete swarm start');
                    }
                })
                .catch(error => showError(error, 'Unable to delete swarm start'));
        }
    });

    const scrollToLinkedSessions = (e) => {
        if (e) e.preventDefault();
        linkedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // Same back-button policy as SwarmSessionDetail: prefer browser-history back
    // when there's an origin to return to (clicked through from /swarm/sessions
    // or /swarm/session/:id), else fall back to the swarm-starts list.
    const hasHistory = location.key !== 'default';
    const handleBack = () => hasHistory ? navigate(-1) : navigate('/swarm/swarm-starts');

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }
    if (!row) {
        return (
            <Box sx={{ p: 3, maxWidth: 800 }} data-testid="swarm-start-detail-not-found">
                <Box sx={{ mb: 2 }}>
                    <Button variant="outlined" onClick={handleBack}
                            startIcon={<ArrowBackIcon />}
                            data-testid="btn-back">
                        Back
                    </Button>
                </Box>
                <Typography>Swarm Start #{id} not found.</Typography>
            </Box>
        );
    }

    // Page is wide enough to fit the Linked Sessions DataGrid without column wrap
    // (id 70 + status 110 + title flex≥220 + branch 320 + started 170 + completed 170
    // ≈ 1060 + scrollbar). Prose-style sections (Invocation, Summary, Tokens,
    // Telemetry) get an inner `maxWidth: 900` wrapper so reading width stays sane.
    const NARROW = { maxWidth: 900 };
    return (
        <Box sx={{ p: 3, maxWidth: 1400 }} data-testid="swarm-start-detail">
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Button variant="outlined" onClick={handleBack}
                        startIcon={<ArrowBackIcon />}
                        data-testid="btn-back">
                    Back
                </Button>
                <Tooltip title="Delete swarm start" enterDelay={400} enterNextDelay={200}>
                    <IconButton
                        onClick={() => swarmStartDelete.openDialog({ swarmStartId: row.id })}
                        data-testid="btn-delete-swarm-start"
                    >
                        <DeleteIcon />
                    </IconButton>
                </Tooltip>
            </Box>

            <Typography variant="h5" gutterBottom>
                Swarm Start #{row.id}
                {row.started_at && (
                    <Typography component="span" variant="caption"
                                sx={{ ml: 2, color: 'text.secondary' }}>
                        {formatDateTime(row.started_at, timezone)}
                    </Typography>
                )}
            </Typography>

            {/* 1. Invocation header */}
            <Box sx={{ mb: 3, ...NARROW }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Invocation</Typography>
                <Typography variant="body2"
                            sx={{ fontFamily: 'monospace',
                                   bgcolor: 'action.hover',
                                   px: 1.5, py: 1, borderRadius: 1 }}>
                    /swarm-start{row.arguments ? ` ${row.arguments}` : ''}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                    {row.auto_start ? <Chip label="auto-start" size="small" color="primary" /> : null}
                    {/* Req #2494 — chip is now a real anchor link to the Linked Sessions
                        table below; smooth-scrolls into view on click and is keyboard-
                        focusable as an <a>. Empty (0-session) chip stays inert — there's
                        nothing to scroll to. */}
                    <Chip label={`${row.session_count} session${row.session_count === 1 ? '' : 's'}`}
                          size="small" variant="outlined"
                          {...(row.session_count > 0
                              ? {
                                  clickable: true,
                                  component: 'a',
                                  href: '#linked-sessions',
                                  onClick: scrollToLinkedSessions,
                              }
                              : {})}
                          data-testid="swarm-start-session-count-chip" />
                    {machineName &&
                        <Chip label={machineName} size="small" variant="outlined"
                              data-testid="swarm-start-machine" />
                    }
                    {/* req #2955 — the launcher's model/effort (#2949's swarm_starts
                        columns), the model/effort that incurred this start's cost. */}
                    <Chip label={aiModelLabel(row.ai_model)} size="small"
                          {...aiModelChipProps(row.ai_model)}
                          data-testid="chip-ai-model" />
                    <Chip label={effortLabel(row.effort)} size="small"
                          {...effortChipProps(row.effort)}
                          data-testid="chip-effort" />
                </Box>
            </Box>

            {/* 2. Linked sessions — req #2494. Live DataGrid of the swarm_sessions
                  the junction links to this swarm_start. Rows are clickable and
                  navigate to the per-session detail page. */}
            <Box sx={{ mb: 3 }} ref={linkedSectionRef} id="linked-sessions">
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Linked Sessions</Typography>
                {linkedLoading ? (
                    <CircularProgress size={20} />
                ) : linkedSessions.length === 0 ? (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}
                                data-testid="swarm-start-no-linked-sessions">
                        No sessions linked to this swarm-start.
                    </Typography>
                ) : (
                    <Box data-testid="swarm-start-linked-sessions-grid">
                        <DataGrid
                            autoHeight
                            rows={linkedSessions}
                            columns={getLinkedSessionColumns(timezone)}
                            density="compact"
                            disableRowSelectionOnClick
                            hideFooter={linkedSessions.length <= 25}
                            pageSizeOptions={[10, 25, 50]}
                            initialState={{
                                pagination: { paginationModel: { pageSize: 25 } },
                                sorting: { sortModel: [{ field: 'started_at', sort: 'desc' }] },
                            }}
                            onRowClick={(p) => navigate(`/swarm/session/${p.row.id}`)}
                            sx={{ cursor: 'pointer' }}
                        />
                    </Box>
                )}
            </Box>

            {/* 3. Final summary — the table the CLI showed at end-of-run */}
            <Box sx={{ mb: 3, ...NARROW }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Summary</Typography>
                <SummaryRenderer summary={row.start_summary} />
            </Box>

            {/* 4. Token rollups */}
            <Box sx={{ mb: 3, ...NARROW }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Token totals</Typography>
                <Box sx={{ display: 'grid',
                            gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: 1.5,
                            bgcolor: 'action.hover',
                            p: 1.5, borderRadius: 1 }}
                     data-testid="swarm-start-tokens">
                    <TokenStat label="Input" value={row.tokens_input} />
                    <TokenStat label="Cache write" value={row.tokens_cache_write} />
                    <TokenStat label="Cache read" value={row.tokens_cache_read} />
                    <TokenStat label="Output" value={row.tokens_output} />
                    <TokenStat label="Wall"
                               value={row.wall_seconds == null ? null : formatDuration(row.wall_seconds)}
                               raw />
                    <TokenStat label="Turns" value={row.turn_count} />
                </Box>
            </Box>

            {/* 5. Raw telemetry — debug-only */}
            <Accordion disableGutters elevation={0}
                       sx={{ '&:before': { display: 'none' }, ...NARROW }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle2">Raw telemetry</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    {row.telemetry
                        ? <Box component="pre"
                               sx={{ fontFamily: 'monospace', fontSize: '0.75rem',
                                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                      bgcolor: 'action.hover',
                                      p: 1.5, borderRadius: 1, m: 0,
                                      maxHeight: 400, overflow: 'auto' }}
                               data-testid="swarm-start-telemetry">
                               {row.telemetry}
                          </Box>
                        : <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            (no telemetry recorded)
                          </Typography>
                    }
                </AccordionDetails>
            </Accordion>

            <SwarmStartDeleteDialog
                deleteDialogOpen={swarmStartDelete.dialogOpen}
                setDeleteDialogOpen={swarmStartDelete.setDialogOpen}
                setDeleteId={swarmStartDelete.setInfoObject}
                setDeleteConfirmed={swarmStartDelete.setConfirmed}
                swarmStart={row}
                linkedSessionIds={linkedSessions.map(s => s.id)}
                linkedLoading={linkedLoading}
            />
        </Box>
    );
}

function SummaryRenderer({ summary }) {
    if (!summary || !summary.trim()) {
        return (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                (no summary recorded)
            </Typography>
        );
    }
    const blocks = parseSummary(summary);
    return (
        <Box data-testid="swarm-start-summary">
            {blocks.map((block, i) => {
                if (block.kind === 'text') {
                    return (
                        <Typography key={i} variant="body2"
                                    sx={{ mb: 1, whiteSpace: 'pre-wrap',
                                           fontWeight: block.bold ? 600 : 400 }}>
                            {block.text}
                        </Typography>
                    );
                }
                return (
                    <Table key={i} size="small" sx={{ mb: 1.5,
                                                       '& td, & th': { fontSize: '0.8rem' } }}>
                        <TableHead>
                            <TableRow>
                                {block.headers.map((h, hi) => (
                                    <TableCell key={hi}
                                               sx={{ fontWeight: 600,
                                                      bgcolor: 'action.hover' }}>
                                        {h}
                                    </TableCell>
                                ))}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {block.rows.map((cells, ri) => (
                                <TableRow key={ri}>
                                    {cells.map((c, ci) => (
                                        <TableCell key={ci}
                                                   sx={{ fontFamily: 'monospace',
                                                          wordBreak: 'break-word' }}>
                                            {c}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                );
            })}
        </Box>
    );
}

function TokenStat({ label, value, raw }) {
    return (
        <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {value == null ? '—' : (raw ? value : Number(value).toLocaleString())}
            </Typography>
        </Box>
    );
}
