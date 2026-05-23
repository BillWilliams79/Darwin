// /swarm/swarm-completes/:id — single-row detail page for a swarm_complete
// (req #2497). Mirrors SwarmStartDetail in shape: invocation header,
// Linked Sessions DataGrid, Summary, Token totals, Raw telemetry accordion.

import { useContext, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import {
    useSwarmCompleteById,
    useSessions,
    useAllSwarmCompleteSessions,
} from '../hooks/useDataQueries';
import { formatDateTime } from '../utils/dateFormat';
import { parseSummary } from '../SwarmStarts/SwarmStartsPage';
import { selectSessionsForSwarmComplete } from './sessionFilter';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
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
import { DataGrid } from '@mui/x-data-grid';

const coordinationChipProps = (filter) => {
    if (!filter) return null;
    switch (filter) {
        case 'planned':     return { sx: { bgcolor: '#90caf9', color: '#000' } };
        case 'implemented': return { sx: { bgcolor: '#a5d6a7', color: '#000' } };
        case 'deployed':    return { sx: { bgcolor: '#ce93d8', color: '#000' } };
        default:            return { color: 'default' };
    }
};

const statusChipProps = (status) => {
    switch (status) {
        case 'in_progress': return { color: 'info' };
        case 'ok':          return { sx: { bgcolor: '#4caf50', color: '#fff' } };
        case 'error':       return { sx: { bgcolor: '#ef5350', color: '#fff' } };
        default:            return { color: 'default' };
    }
};

const skillChipProps = (name) => {
    switch (name) {
        case 'swarm-complete':            return { sx: { bgcolor: '#26c6da', color: '#000' } };
        case 'primary-ai-swarm-complete': return { sx: { bgcolor: '#ffa726', color: '#000' } };
        default:                          return { color: 'default' };
    }
};

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

const getLinkedSessionColumns = (timezone) => [
    { field: 'id', headerName: 'ID', width: 70, type: 'number' },
    {
        field: 'swarm_status',
        headerName: 'Status',
        width: 110,
        renderCell: (params) => (
            <Chip label={params.value} size="small"
                  {...swarmStatusChipProps(params.value)} />
        ),
    },
    { field: 'title',    headerName: 'Title',  flex: 1, minWidth: 220 },
    { field: 'branch',   headerName: 'Branch', width: 360 },
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

const formatWallSeconds = (v) => {
    if (v == null) return '—';
    const s = Number(v);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r}s`;
};

export default function SwarmCompleteDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const swarmCompleteId = parseInt(id);
    const { data: row, isLoading } = useSwarmCompleteById(creatorFk, swarmCompleteId);

    const { data: sessionsArray, isLoading: sessionsLoading } = useSessions(creatorFk);
    const { data: junction, isLoading: junctionLoading } = useAllSwarmCompleteSessions(creatorFk);

    const linkedSessions = useMemo(
        () => selectSessionsForSwarmComplete(sessionsArray, junction, swarmCompleteId),
        [sessionsArray, junction, swarmCompleteId]
    );
    const linkedLoading = sessionsLoading || junctionLoading;
    const linkedSectionRef = useRef(null);

    const scrollToLinkedSessions = (e) => {
        if (e) e.preventDefault();
        linkedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const hasHistory = location.key !== 'default';
    const handleBack = () => hasHistory ? navigate(-1) : navigate('/swarm/swarm-completes');

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }
    if (!row) {
        return (
            <Box sx={{ p: 3, maxWidth: 800 }} data-testid="swarm-complete-detail-not-found">
                <Box sx={{ mb: 2 }}>
                    <Button variant="outlined" onClick={handleBack}
                            startIcon={<ArrowBackIcon />}
                            data-testid="btn-back">
                        Back
                    </Button>
                </Box>
                <Typography>Swarm Complete #{id} not found.</Typography>
            </Box>
        );
    }

    const NARROW = { maxWidth: 900 };
    return (
        <Box sx={{ p: 3, maxWidth: 1400 }} data-testid="swarm-complete-detail">
            <Box sx={{ mb: 2 }}>
                <Button variant="outlined" onClick={handleBack}
                        startIcon={<ArrowBackIcon />}
                        data-testid="btn-back">
                    Back
                </Button>
            </Box>

            <Typography variant="h5" gutterBottom>
                Swarm Complete #{row.id}
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
                    /{row.skill_name} {row.arguments || <em>(no arguments)</em>}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                    <Chip label={row.skill_name} size="small"
                          {...skillChipProps(row.skill_name)}
                          sx={{ fontFamily: 'monospace',
                                 ...(skillChipProps(row.skill_name)?.sx || {}) }} />
                    <Chip label={`status: ${row.status}`} size="small"
                          {...statusChipProps(row.status)} />
                    {row.coordination_type && (
                        <Chip label={`coordination: ${row.coordination_type}`} size="small"
                              {...coordinationChipProps(row.coordination_type)} />
                    )}
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
                          data-testid="swarm-complete-session-count-chip" />
                    {row.completed_at && (
                        <Chip label={`completed: ${formatDateTime(row.completed_at, timezone)}`}
                              size="small" variant="outlined" />
                    )}
                </Box>
            </Box>

            {/* 2. Linked sessions */}
            <Box sx={{ mb: 3 }} ref={linkedSectionRef} id="linked-sessions">
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Linked Sessions</Typography>
                {linkedLoading ? (
                    <CircularProgress size={20} />
                ) : linkedSessions.length === 0 ? (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}
                                data-testid="swarm-complete-no-linked-sessions">
                        No sessions linked to this swarm-complete.
                    </Typography>
                ) : (
                    <Box data-testid="swarm-complete-linked-sessions-grid">
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

            {/* 3. Final summary */}
            <Box sx={{ mb: 3, ...NARROW }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Summary</Typography>
                <SummaryRenderer summary={row.complete_summary} />
            </Box>

            {/* 4. Token rollups */}
            <Box sx={{ mb: 3, ...NARROW }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Token totals</Typography>
                <Box sx={{ display: 'grid',
                            gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: 1.5,
                            bgcolor: 'action.hover',
                            p: 1.5, borderRadius: 1 }}
                     data-testid="swarm-complete-tokens">
                    <TokenStat label="Input" value={row.tokens_input} />
                    <TokenStat label="Cache write" value={row.tokens_cache_write} />
                    <TokenStat label="Cache read" value={row.tokens_cache_read} />
                    <TokenStat label="Output" value={row.tokens_output} />
                    <TokenStat label="Wall"
                               value={row.wall_seconds == null ? null : formatWallSeconds(row.wall_seconds)}
                               raw />
                    <TokenStat label="Turns" value={row.turn_count} />
                </Box>
            </Box>

            {/* 5. Raw telemetry */}
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
                               data-testid="swarm-complete-telemetry">
                               {row.telemetry}
                          </Box>
                        : <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            (no telemetry recorded)
                          </Typography>
                    }
                </AccordionDetails>
            </Accordion>
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
        <Box data-testid="swarm-complete-summary">
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
