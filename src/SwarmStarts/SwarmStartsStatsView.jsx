// /swarm/swarm-starts — Stats view (req #2686). Sibling of the DataGrid table.
// Aggregates the same `useAllSwarmStarts` rows the table consumes; switches via
// the `darwin-swarm-starts-view` view toggle in SwarmStartsPage.
//
// `computeSwarmStartStats` is exported as a pure function so the vitest unit
// test can validate the aggregation without rendering recharts.
//
// Req #2811 — brought to parity with SwarmCompletesStatsView's token analytics.
// swarm_starts rows carry the same hardened token/turn columns completes do
// (tokens_input/cache_write/cache_read/output, turn_count, wall_seconds,
// started_at), so we mirror the token KPIs, the Turn-Count + Throughput charts,
// and augment Top Invocation Patterns with per-pattern token cost. Each start
// also embeds a TOKEN_TELEMETRY `phases` blob (same shape completes use), so we
// additionally render a Phase Cost Leaderboard via the shared
// `parsePhaseBreakdown` parser — full parity with completes.

import { useState } from 'react';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import {
    ResponsiveContainer, BarChart, Bar, LineChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from 'recharts';

import { parsePhaseBreakdown } from '../utils/phaseTelemetry';

const STATS_WIDTH = 1140;
const ARG_DISPLAY_LIMIT = 60;
const TOP_PATTERNS_LIMIT = 10;
const TOP_PHASES_LIMIT = 12;

const WALL_BUCKETS = [
    { label: '<30s',   min: 0,    max: 30   },
    { label: '30–60s', min: 30,   max: 60   },
    { label: '1–2m',   min: 60,   max: 120  },
    { label: '2–5m',   min: 120,  max: 300  },
    { label: '5–10m',  min: 300,  max: 600  },
    { label: '10m+',   min: 600,  max: Infinity },
];

// Same turn buckets as swarm_completes so the two stats pages read consistently.
const TURN_BUCKETS = [
    { label: '<10',   min: 0,   max: 10  },
    { label: '10–20', min: 10,  max: 20  },
    { label: '20–30', min: 20,  max: 30  },
    { label: '30–50', min: 30,  max: 50  },
    { label: '50+',   min: 50,  max: Infinity },
];

// Throughput x-axis range selector (mirrors completes). null = All time.
const THROUGHPUT_RANGES = [
    { label: '7d',  days: 7   },
    { label: '30d', days: 30  },
    { label: '90d', days: 90  },
    { label: '1Y',  days: 365 },
    { label: 'All', days: null },
];
const DEFAULT_THROUGHPUT_RANGE = 'All';

// session_count histogram buckets: each integer 0..5 is its own bucket, 6+ collapsed.
const SESSION_BUCKETS = ['0', '1', '2', '3', '4', '5', '6+'];

const rowTokenTotal = (row) =>
    (Number(row.tokens_input) || 0) +
    (Number(row.tokens_cache_write) || 0) +
    (Number(row.tokens_cache_read) || 0) +
    (Number(row.tokens_output) || 0);

// Pure aggregator — rows → stats object. Exported for unit testing.
export function computeSwarmStartStats(rows) {
    const total = rows.length;
    if (total === 0) {
        return {
            total: 0,
            totalSessions: 0,
            avgSessionsPerInvocation: 0,
            avgSecondsPerSession: null,
            autoStartCount: 0,
            autoStartRatio: 0,
            maxRequirements: null,
            inputTotal: 0,
            cacheWriteTotal: 0,
            cacheReadTotal: 0,
            outputTotal: 0,
            totalTokens: 0,
            avgTokensPerInvocation: 0,
            cacheHitRate: null,
            avgTurns: null,
            sessionsHistogram: SESSION_BUCKETS.map(label => ({ label, count: 0 })),
            wallHistogram: WALL_BUCKETS.map(b => ({ label: b.label, count: 0 })),
            turnsHistogram: TURN_BUCKETS.map(b => ({ label: b.label, count: 0 })),
            throughput: [],
            topPatterns: [],
            phaseAggregate: [],
            phaseAvgTokenTotal: 0,
        };
    }

    let totalSessions = 0;
    let autoStartCount = 0;
    let wallSumWithSessions = 0;
    let sessionsForAvg = 0;
    let inputTotal = 0;
    let cacheWriteTotal = 0;
    let cacheReadTotal = 0;
    let outputTotal = 0;
    let turnSum = 0;
    let turnCount = 0;
    // Largest launch by requirements generated (req #2747). Each session a
    // swarm-start launches works one requirement, so session_count is the
    // count of requirements that launch generated. Track the row holding the
    // max; strict `>` keeps the first/earliest row on a tie.
    let maxRequirements = null; // { id, count }
    const sessionsHistMap = Object.fromEntries(SESSION_BUCKETS.map(b => [b, 0]));
    const wallHistMap = Object.fromEntries(WALL_BUCKETS.map(b => [b.label, 0]));
    const turnsHistMap = Object.fromEntries(TURN_BUCKETS.map(b => [b.label, 0]));
    const patterns = new Map(); // key → {pattern, invocations, sessions, wallSum, wallCount, tokens}
    // calendar date (YYYY-MM-DD from started_at) → { date, count, tokens }
    const dayMap = new Map();
    // phase name → { phase, invocations, tokens, wall } — aggregated from each
    // start's TOKEN_TELEMETRY `phases` blob (req #2811, analog of completes).
    const phaseMap = new Map();

    for (const row of rows) {
        const sessionCount = Number(row.session_count) || 0;
        totalSessions += sessionCount;
        if (row.auto_start) autoStartCount += 1;
        if (maxRequirements === null || sessionCount > maxRequirements.count) {
            maxRequirements = { id: row.id, count: sessionCount };
        }

        // Tokens
        inputTotal += Number(row.tokens_input) || 0;
        cacheWriteTotal += Number(row.tokens_cache_write) || 0;
        cacheReadTotal += Number(row.tokens_cache_read) || 0;
        outputTotal += Number(row.tokens_output) || 0;
        const tokenTotal = rowTokenTotal(row);

        // Sessions histogram
        const sessKey = sessionCount >= 6 ? '6+' : String(sessionCount);
        sessionsHistMap[sessKey] = (sessionsHistMap[sessKey] || 0) + 1;

        // Wall histogram (skip rows with null wall_seconds)
        const wall = row.wall_seconds;
        if (wall != null) {
            const bucket = WALL_BUCKETS.find(b => wall >= b.min && wall < b.max);
            if (bucket) wallHistMap[bucket.label] += 1;
            if (sessionCount > 0) {
                wallSumWithSessions += Number(wall);
                sessionsForAvg += sessionCount;
            }
        }

        // Turns (skip null)
        const turns = row.turn_count;
        if (turns != null) {
            turnSum += Number(turns);
            turnCount += 1;
            const tb = TURN_BUCKETS.find(b => turns >= b.min && turns < b.max);
            if (tb) turnsHistMap[tb.label] += 1;
        }

        // Per-phase token aggregate (from TOKEN_TELEMETRY). Each start that records
        // a given phase contributes that phase's token total + wall once.
        const { tokenPhases } = parsePhaseBreakdown(row.telemetry);
        for (const p of tokenPhases) {
            const existing = phaseMap.get(p.phase) || {
                phase: p.phase, invocations: 0, tokens: 0, wall: 0,
            };
            existing.invocations += 1;
            existing.tokens += p.total;
            existing.wall += Number(p.wall) || 0;
            phaseMap.set(p.phase, existing);
        }

        // Throughput by calendar day (date portion of started_at).
        if (row.started_at) {
            const day = String(row.started_at).slice(0, 10);
            const d = dayMap.get(day) || { date: day, count: 0, tokens: 0 };
            d.count += 1;
            d.tokens += tokenTotal;
            dayMap.set(day, d);
        }

        // Patterns: group by raw arguments string (empty/null → '—' per req #2710)
        const argsKey = (row.arguments == null || row.arguments === '')
            ? '—'
            : row.arguments;
        const existing = patterns.get(argsKey) || {
            pattern: argsKey, invocations: 0, sessions: 0, wallSum: 0, wallCount: 0, tokens: 0,
        };
        existing.invocations += 1;
        existing.sessions += sessionCount;
        existing.tokens += tokenTotal;
        if (wall != null) {
            existing.wallSum += Number(wall);
            existing.wallCount += 1;
        }
        patterns.set(argsKey, existing);
    }

    const topPatterns = Array.from(patterns.values())
        .map(p => ({
            pattern: p.pattern,
            invocations: p.invocations,
            sessions: p.sessions,
            avgWall: p.wallCount > 0 ? p.wallSum / p.wallCount : null,
            avgTokens: p.invocations > 0 ? p.tokens / p.invocations : 0,
        }))
        .sort((a, b) => b.invocations - a.invocations || b.sessions - a.sessions)
        .slice(0, TOP_PATTERNS_LIMIT);

    const totalTokens = inputTotal + cacheWriteTotal + cacheReadTotal + outputTotal;
    const cacheDenom = cacheReadTotal + cacheWriteTotal + inputTotal;

    const throughput = Array.from(dayMap.values())
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // Req #2819 — the leaderboard is now average-based: per-phase average token
    // cost per invocation (and average wall per invocation) surface the
    // over-time offenders better than raw totals do. Compute each phase's
    // avgTokens/avgWall first, then use the SUM of avgTokens across ALL phases
    // (not just top N) as the "% of Total" denominator so the share reflects the
    // average rather than the total.
    const phaseRows = Array.from(phaseMap.values()).map(p => ({
        phase: p.phase,
        invocations: p.invocations,
        avgTokens: p.invocations > 0 ? p.tokens / p.invocations : 0,
        avgWall: p.invocations > 0 ? p.wall / p.invocations : 0,
    }));

    const phaseAvgTokenTotal = phaseRows.reduce((s, p) => s + p.avgTokens, 0);

    const phaseAggregate = phaseRows
        .map(p => ({
            ...p,
            pctOfTotal: phaseAvgTokenTotal > 0 ? (p.avgTokens / phaseAvgTokenTotal) * 100 : 0,
        }))
        .sort((a, b) => b.avgTokens - a.avgTokens)
        .slice(0, TOP_PHASES_LIMIT);

    return {
        total,
        totalSessions,
        avgSessionsPerInvocation: totalSessions / total,
        avgSecondsPerSession: sessionsForAvg > 0 ? wallSumWithSessions / sessionsForAvg : null,
        autoStartCount,
        autoStartRatio: autoStartCount / total,
        maxRequirements,
        inputTotal,
        cacheWriteTotal,
        cacheReadTotal,
        outputTotal,
        totalTokens,
        avgTokensPerInvocation: totalTokens / total,
        cacheHitRate: cacheDenom > 0 ? cacheReadTotal / cacheDenom : null,
        avgTurns: turnCount > 0 ? turnSum / turnCount : null,
        sessionsHistogram: SESSION_BUCKETS.map(label => ({ label, count: sessionsHistMap[label] || 0 })),
        wallHistogram: WALL_BUCKETS.map(b => ({ label: b.label, count: wallHistMap[b.label] || 0 })),
        turnsHistogram: TURN_BUCKETS.map(b => ({ label: b.label, count: turnsHistMap[b.label] || 0 })),
        throughput,
        topPatterns,
        phaseAggregate,
        phaseAvgTokenTotal,
    };
}

const formatSeconds = (s) => {
    if (s == null) return '—';
    const v = Number(s);
    if (v < 1) return `${v.toFixed(2)}s`;
    if (v < 60) return `${v.toFixed(1)}s`;
    const m = Math.floor(v / 60);
    const r = Math.round(v % 60);
    return `${m}m ${r}s`;
};

const formatPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

// Compact token formatter for KPI cards (12.3M / 45.6k / 789).
const formatTokens = (v) => {
    if (v == null) return '—';
    const n = Number(v);
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return n.toLocaleString();
};

// Filter the throughput series to the selected range (relative to today). null
// days = All time. Uses the browser clock; the aggregator stays pure/testable
// by producing the full series and letting the view window it.
function windowThroughput(series, days) {
    if (days == null) return series;
    const cutoff = new Date(Date.now() - days * 86400000)
        .toISOString().slice(0, 10);
    return series.filter(d => d.date >= cutoff);
}

function KpiCard({ label, value, hint }) {
    return (
        // Width is owned by the CSS-grid cell in the KPI strip (uniform columns →
        // clean left + right alignment, req #2747); the card just fills its cell.
        <Paper elevation={1} sx={{ p: 2, height: '100%' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                {label}
            </Typography>
            <Typography variant="h5" sx={{ mt: 0.5, fontWeight: 600 }}>
                {value}
            </Typography>
            {hint && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                    {hint}
                </Typography>
            )}
        </Paper>
    );
}

function ChartCard({ title, subtitle, height = 220, children, testId, action }) {
    return (
        // Full-width so each chart block hugs the page's left + right margins
        // when stacked (req #2747).
        <Paper elevation={1} sx={{ p: 2, width: '100%' }} data-testid={testId}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        {title}
                    </Typography>
                    {subtitle && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                            {subtitle}
                        </Typography>
                    )}
                </Box>
                {action}
            </Box>
            <Box sx={{ height, '& svg': { outline: 'none' }, '& svg *': { outline: 'none' } }}>
                {children}
            </Box>
        </Paper>
    );
}

const axisTick = { fill: '#9a9186', fontSize: 12 };
const grid = <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />;

const tooltipStyle = {
    contentStyle: {
        backgroundColor: '#2a2723',
        border: '1px solid rgba(255,255,255,0.1)',
        color: '#e8e1d5',
        borderRadius: 4,
    },
    labelStyle: { color: '#e8e1d5' },
};

export default function SwarmStartsStatsView({ rows = [] }) {
    const stats = computeSwarmStartStats(rows);
    const [throughputRange, setThroughputRange] = useState(DEFAULT_THROUGHPUT_RANGE);

    if (rows.length === 0) {
        return (
            <Box sx={{ px: 3, pt: 1, maxWidth: STATS_WIDTH }} data-testid="swarm-starts-stats-empty">
                <Typography color="text.secondary">
                    No /swarm-start invocations recorded.
                </Typography>
            </Box>
        );
    }

    const rangeDays = THROUGHPUT_RANGES.find(r => r.label === throughputRange)?.days ?? null;
    const throughputData = windowThroughput(stats.throughput, rangeDays);

    return (
        <Box sx={{ px: 3, pt: 1, maxWidth: STATS_WIDTH }} data-testid="swarm-starts-stats-view">
            {/* KPI strip — CSS grid with uniform auto-fit columns so the cards
                line up on BOTH the left and right edges (req #2747). The prior
                flex-wrap layout justified the right edge but let interior cards
                land at ragged left offsets when a row held a different count. */}
            <Box sx={{ display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                        gap: 2, mb: 2 }}
                 data-testid="swarm-starts-stats-kpis">
                <KpiCard label="Invocations" value={stats.total.toLocaleString()} />
                <KpiCard label="Sessions Launched" value={stats.totalSessions.toLocaleString()} />
                <KpiCard label="Most Requirements / Launch"
                         value={stats.maxRequirements ? stats.maxRequirements.count.toLocaleString() : '—'}
                         hint={stats.maxRequirements && stats.maxRequirements.id != null
                             ? `Swarm-Start #${stats.maxRequirements.id}`
                             : undefined} />
                <KpiCard label="Avg Sessions / Invocation"
                         value={stats.avgSessionsPerInvocation.toFixed(2)} />
                <KpiCard label="Avg Time to Start a Session"
                         value={formatSeconds(stats.avgSecondsPerSession)}
                         hint="sum(wall) / sum(sessions)" />
                <KpiCard label="Auto-Start"
                         value={formatPct(stats.autoStartRatio)}
                         hint={`${stats.autoStartCount} of ${stats.total}`} />
                {/* Token analytics — parity with swarm-completes (req #2811). */}
                <KpiCard label="Avg Tokens / Invocation"
                         value={formatTokens(stats.avgTokensPerInvocation)} />
                <KpiCard label="Total Tokens" value={formatTokens(stats.totalTokens)} />
                <KpiCard label="Cache Hit Rate"
                         value={formatPct(stats.cacheHitRate)}
                         hint="context read from cache" />
                <KpiCard label="Avg Turns / Invocation"
                         value={stats.avgTurns == null ? '—' : stats.avgTurns.toFixed(1)} />
            </Box>

            {/* Charts — full-width and stacked so every block shares the page's
                left + right margins (req #2747). Previously Sessions + Wall-Time
                were a 2-up row, which left Wall-Time's left edge detached from the
                page margin while everything else hugged it. */}
            <Stack spacing={2} sx={{ mb: 2 }}>
                <ChartCard
                    title="Sessions per Invocation"
                    subtitle="How many sessions each /swarm-start launches"
                    testId="chart-sessions-histogram"
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.sessionsHistogram}
                                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis dataKey="label" tick={{ fill: '#9a9186', fontSize: 12 }} />
                            <YAxis allowDecimals={false} tick={{ fill: '#9a9186', fontSize: 12 }} />
                            <RTooltip {...tooltipStyle}
                                      formatter={(v) => [`${v} invocation${v === 1 ? '' : 's'}`, null]} />
                            <Bar dataKey="count" fill="#E91E63" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard
                    title="Wall-Time Distribution"
                    subtitle="How long each launch takes end-to-end"
                    testId="chart-wall-histogram"
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.wallHistogram}
                                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis dataKey="label" tick={{ fill: '#9a9186', fontSize: 12 }} />
                            <YAxis allowDecimals={false} tick={{ fill: '#9a9186', fontSize: 12 }} />
                            <RTooltip {...tooltipStyle}
                                      formatter={(v) => [`${v} invocation${v === 1 ? '' : 's'}`, null]} />
                            <Bar dataKey="count" fill="#7E57C2" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                {/* Turn-Count Distribution — parity with completes (req #2811). */}
                <ChartCard
                    title="Turn-Count Distribution"
                    subtitle="LLM turns consumed per /swarm-start launch"
                    testId="chart-turns-histogram"
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.turnsHistogram}
                                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            {grid}
                            <XAxis dataKey="label" tick={axisTick} />
                            <YAxis allowDecimals={false} tick={axisTick} />
                            <RTooltip {...tooltipStyle}
                                      formatter={(v) => [`${v} invocation${v === 1 ? '' : 's'}`, null]} />
                            <Bar dataKey="count" fill="#26c6da" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                {/* Throughput Over Time — invocations per calendar day, range-windowed
                    on the client (req #2811, mirrors completes). */}
                {stats.throughput.length > 0 && (
                    <ChartCard
                        title="Throughput Over Time"
                        subtitle="Invocations per calendar day"
                        testId="chart-throughput"
                        action={
                            <ToggleButtonGroup
                                value={throughputRange}
                                exclusive
                                size="small"
                                onChange={(_e, v) => { if (v) setThroughputRange(v); }}
                                data-testid="throughput-range-toggle"
                            >
                                {THROUGHPUT_RANGES.map(r => (
                                    <ToggleButton key={r.label} value={r.label}
                                                  sx={{ px: 1.25, py: 0.25, fontSize: '0.7rem' }}
                                                  data-testid={`throughput-range-${r.label}`}>
                                        {r.label}
                                    </ToggleButton>
                                ))}
                            </ToggleButtonGroup>
                        }
                    >
                        {throughputData.length === 0 ? (
                            <Box sx={{ display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', height: '100%' }}>
                                <Typography variant="body2" color="text.secondary">
                                    No invocations in the last {throughputRange}.
                                </Typography>
                            </Box>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={throughputData}
                                           margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                    {grid}
                                    <XAxis dataKey="date" tick={axisTick} />
                                    <YAxis allowDecimals={false} tick={axisTick} />
                                    <RTooltip {...tooltipStyle}
                                              formatter={(v) => [`${v} invocation${v === 1 ? '' : 's'}`, null]} />
                                    <Line type="monotone" dataKey="count" stroke="#ffa726"
                                          strokeWidth={2}
                                          dot={{ fill: '#ffa726', r: 3 }}
                                          activeDot={{ r: 5 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </ChartCard>
                )}
            </Stack>

            {/* Top invocation patterns */}
            <Paper elevation={1} sx={{ p: 2 }} data-testid="top-invocation-patterns">
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    Top Invocation Patterns
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                    Top {TOP_PATTERNS_LIMIT} most-repeated <code>arguments</code> strings
                </Typography>
                {stats.topPatterns.length === 0 ? (
                    <Typography color="text.secondary" variant="body2">
                        No patterns recorded.
                    </Typography>
                ) : (
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Pattern</TableCell>
                                    <TableCell align="right">Invocations</TableCell>
                                    <TableCell align="right">Sessions</TableCell>
                                    <TableCell align="right">Avg Wall</TableCell>
                                    <TableCell align="right">Avg Tokens</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {stats.topPatterns.map(p => {
                                    const display = p.pattern.length > ARG_DISPLAY_LIMIT
                                        ? p.pattern.slice(0, ARG_DISPLAY_LIMIT) + '…'
                                        : p.pattern;
                                    const cell = (
                                        <Typography component="span" variant="body2"
                                                    sx={{ fontFamily: 'monospace' }}>
                                            {display}
                                        </Typography>
                                    );
                                    return (
                                        <TableRow key={p.pattern} hover>
                                            <TableCell>
                                                {p.pattern.length > ARG_DISPLAY_LIMIT
                                                    ? <Tooltip title={p.pattern}>{cell}</Tooltip>
                                                    : cell}
                                            </TableCell>
                                            <TableCell align="right">{p.invocations}</TableCell>
                                            <TableCell align="right">{p.sessions}</TableCell>
                                            <TableCell align="right">{formatSeconds(p.avgWall)}</TableCell>
                                            <TableCell align="right">{formatTokens(p.avgTokens)}</TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Paper>

            {/* Phase Cost Leaderboard — aggregate of the per-phase token costs every
                /swarm-start records in its TOKEN_TELEMETRY blob (req #2811, the
                direct analog of the swarm-completes leaderboard): which phase of
                the /swarm-start skill dominates token spend across all launches. */}
            <Paper elevation={1} sx={{ p: 2, mt: 2 }} data-testid="phase-cost-leaderboard">
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    Phase Cost Leaderboard
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                    Average per-phase token cost per invocation (top {TOP_PHASES_LIMIT})
                </Typography>
                {stats.phaseAggregate.length === 0 ? (
                    <Typography color="text.secondary" variant="body2">
                        No per-phase telemetry recorded.
                    </Typography>
                ) : (
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Phase</TableCell>
                                    <TableCell align="right">Invocations</TableCell>
                                    <TableCell align="right">% of Total</TableCell>
                                    <TableCell align="right">Avg / Invocation</TableCell>
                                    <TableCell align="right">Avg Wall</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {stats.phaseAggregate.map(p => (
                                    <TableRow key={p.phase} hover>
                                        <TableCell>
                                            <Typography component="span" variant="body2"
                                                        sx={{ fontFamily: 'monospace' }}>
                                                {p.phase}
                                            </Typography>
                                        </TableCell>
                                        <TableCell align="right">{p.invocations}</TableCell>
                                        <TableCell align="right">{p.pctOfTotal.toFixed(1)}%</TableCell>
                                        <TableCell align="right">{formatTokens(p.avgTokens)}</TableCell>
                                        <TableCell align="right">{formatSeconds(p.avgWall)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Paper>
        </Box>
    );
}
