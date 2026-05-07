// /swarm/swarm-starts/:id — single-row detail page for a swarm_start (req #2422).
// Same content shape as the prior dialog (Invocation header → Summary table
// → Token totals → Raw telemetry), now a route page so the user lands here
// from /swarm/sessions or /swarm/session/:id with the proper origin in
// browser history. Back button restores the originating route.

import { useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import { useSwarmStartById } from '../hooks/useDataQueries';
import { formatDateTime } from '../utils/dateFormat';
import { parseSummary } from './SwarmStartsPage';

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

const SYNTHESIZED_HEADERS = ['Session', 'Branch', 'Coordination', 'Terminal', 'PRs'];

const autonomyChipProps = (filter) => {
    if (!filter) return null;
    switch (filter) {
        case 'planned':     return { sx: { bgcolor: '#90caf9', color: '#000' } };
        case 'implemented': return { sx: { bgcolor: '#a5d6a7', color: '#000' } };
        case 'deployed':    return { sx: { bgcolor: '#ce93d8', color: '#000' } };
        default:            return { color: 'default' };
    }
};

const formatWallSeconds = (v) => {
    if (v == null) return '—';
    const s = Number(v);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r}s`;
};

export default function SwarmStartDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: row, isLoading } = useSwarmStartById(creatorFk, parseInt(id));

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

    return (
        <Box sx={{ p: 3, maxWidth: 900 }} data-testid="swarm-start-detail">
            <Box sx={{ mb: 2 }}>
                <Button variant="outlined" onClick={handleBack}
                        startIcon={<ArrowBackIcon />}
                        data-testid="btn-back">
                    Back
                </Button>
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
            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Invocation</Typography>
                <Typography variant="body2"
                            sx={{ fontFamily: 'monospace',
                                   bgcolor: 'action.hover',
                                   px: 1.5, py: 1, borderRadius: 1 }}>
                    /swarm-start {row.arguments || <em>(empty — all swarm-ready)</em>}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                    {row.autonomy_filter && (
                        <Chip label={`autonomy: ${row.autonomy_filter}`} size="small"
                              {...autonomyChipProps(row.autonomy_filter)} />
                    )}
                    {row.auto_start ? <Chip label="auto-start" size="small" color="primary" /> : null}
                    <Chip label={`${row.session_count} session${row.session_count === 1 ? '' : 's'}`}
                          size="small" variant="outlined" />
                </Box>
            </Box>

            {/* 2. Final summary — the table the CLI showed at end-of-run */}
            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Summary</Typography>
                <SummaryRenderer summary={row.start_summary} />
            </Box>

            {/* 3. Token rollups */}
            <Box sx={{ mb: 3 }}>
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
                               value={row.wall_seconds == null ? null : formatWallSeconds(row.wall_seconds)}
                               raw />
                    <TokenStat label="Turns" value={row.turn_count} />
                </Box>
            </Box>

            {/* 4. Raw telemetry — debug-only */}
            <Accordion disableGutters elevation={0}
                       sx={{ '&:before': { display: 'none' } }}>
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
