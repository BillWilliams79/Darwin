// /swarm/swarm-starts — Stats view (req #2686). Sibling of the DataGrid table.
// Aggregates the same `useAllSwarmStarts` rows the table consumes; switches via
// the `darwin-swarm-starts-view` view toggle in SwarmStartsPage.
//
// `computeSwarmStartStats` is exported as a pure function so the vitest unit
// test can validate the aggregation without rendering recharts.

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
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from 'recharts';

const STATS_WIDTH = 1140;
const ARG_DISPLAY_LIMIT = 60;
const TOP_PATTERNS_LIMIT = 10;

const WALL_BUCKETS = [
    { label: '<30s',   min: 0,    max: 30   },
    { label: '30–60s', min: 30,   max: 60   },
    { label: '1–2m',   min: 60,   max: 120  },
    { label: '2–5m',   min: 120,  max: 300  },
    { label: '5–10m',  min: 300,  max: 600  },
    { label: '10m+',   min: 600,  max: Infinity },
];

// session_count histogram buckets: each integer 0..5 is its own bucket, 6+ collapsed.
const SESSION_BUCKETS = ['0', '1', '2', '3', '4', '5', '6+'];

const AUTONOMY_VALUES = ['discuss', 'planned', 'implemented', 'deployed'];

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
            sessionsHistogram: SESSION_BUCKETS.map(label => ({ label, count: 0 })),
            wallHistogram: WALL_BUCKETS.map(b => ({ label: b.label, count: 0 })),
            topPatterns: [],
            autonomyBreakdown: AUTONOMY_VALUES.map(v => ({ label: v, count: 0 }))
                                              .concat([{ label: 'none', count: 0 }]),
        };
    }

    let totalSessions = 0;
    let autoStartCount = 0;
    let wallSumWithSessions = 0;
    let sessionsForAvg = 0;
    const sessionsHistMap = Object.fromEntries(SESSION_BUCKETS.map(b => [b, 0]));
    const wallHistMap = Object.fromEntries(WALL_BUCKETS.map(b => [b.label, 0]));
    const patterns = new Map(); // key → {pattern, invocations, sessions, wallSum, wallCount}
    const autonomyMap = Object.fromEntries(
        AUTONOMY_VALUES.concat(['none']).map(v => [v, 0])
    );

    for (const row of rows) {
        const sessionCount = Number(row.session_count) || 0;
        totalSessions += sessionCount;
        if (row.auto_start) autoStartCount += 1;

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

        // Patterns: group by raw arguments string (empty/null → '—' per req #2710)
        const argsKey = (row.arguments == null || row.arguments === '')
            ? '—'
            : row.arguments;
        const existing = patterns.get(argsKey) || {
            pattern: argsKey, invocations: 0, sessions: 0, wallSum: 0, wallCount: 0,
        };
        existing.invocations += 1;
        existing.sessions += sessionCount;
        if (wall != null) {
            existing.wallSum += Number(wall);
            existing.wallCount += 1;
        }
        patterns.set(argsKey, existing);

        // Autonomy breakdown
        const autonomy = row.autonomy_filter && AUTONOMY_VALUES.includes(row.autonomy_filter)
            ? row.autonomy_filter
            : 'none';
        autonomyMap[autonomy] += 1;
    }

    const topPatterns = Array.from(patterns.values())
        .map(p => ({
            pattern: p.pattern,
            invocations: p.invocations,
            sessions: p.sessions,
            avgWall: p.wallCount > 0 ? p.wallSum / p.wallCount : null,
        }))
        .sort((a, b) => b.invocations - a.invocations || b.sessions - a.sessions)
        .slice(0, TOP_PATTERNS_LIMIT);

    return {
        total,
        totalSessions,
        avgSessionsPerInvocation: totalSessions / total,
        avgSecondsPerSession: sessionsForAvg > 0 ? wallSumWithSessions / sessionsForAvg : null,
        autoStartCount,
        autoStartRatio: autoStartCount / total,
        sessionsHistogram: SESSION_BUCKETS.map(label => ({ label, count: sessionsHistMap[label] || 0 })),
        wallHistogram: WALL_BUCKETS.map(b => ({ label: b.label, count: wallHistMap[b.label] || 0 })),
        topPatterns,
        autonomyBreakdown: AUTONOMY_VALUES.concat(['none']).map(label => ({
            label, count: autonomyMap[label] || 0,
        })),
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

const formatPct = (v) => `${(v * 100).toFixed(0)}%`;

function KpiCard({ label, value, hint }) {
    return (
        <Paper elevation={1} sx={{ p: 2, flex: 1, minWidth: 160 }}>
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

function ChartCard({ title, subtitle, height = 220, children, testId }) {
    return (
        <Paper elevation={1} sx={{ p: 2, flex: 1, minWidth: 280 }} data-testid={testId}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {title}
            </Typography>
            {subtitle && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                    {subtitle}
                </Typography>
            )}
            <Box sx={{ height, '& svg': { outline: 'none' }, '& svg *': { outline: 'none' } }}>
                {children}
            </Box>
        </Paper>
    );
}

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

    if (rows.length === 0) {
        return (
            <Box sx={{ px: 3, pt: 1, maxWidth: STATS_WIDTH }} data-testid="swarm-starts-stats-empty">
                <Typography color="text.secondary">
                    No /swarm-start invocations match the current filter.
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ px: 3, pt: 1, maxWidth: STATS_WIDTH }} data-testid="swarm-starts-stats-view">
            {/* KPI strip */}
            <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 2 }}
                   data-testid="swarm-starts-stats-kpis">
                <KpiCard label="Invocations" value={stats.total.toLocaleString()} />
                <KpiCard label="Sessions Launched" value={stats.totalSessions.toLocaleString()} />
                <KpiCard label="Avg Sessions / Invocation"
                         value={stats.avgSessionsPerInvocation.toFixed(2)} />
                <KpiCard label="Avg Time to Start a Session"
                         value={formatSeconds(stats.avgSecondsPerSession)}
                         hint="sum(wall) / sum(sessions)" />
                <KpiCard label="Auto-Start"
                         value={formatPct(stats.autoStartRatio)}
                         hint={`${stats.autoStartCount} of ${stats.total}`} />
            </Stack>

            {/* Charts row 1 — sessions histogram + wall histogram */}
            <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 2 }}>
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
            </Stack>

            {/* Charts row 2 — autonomy breakdown */}
            <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 2 }}>
                <ChartCard
                    title="Autonomy Filter Breakdown"
                    subtitle="How often each autonomy keyword is used"
                    height={200}
                    testId="chart-autonomy-breakdown"
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.autonomyBreakdown}
                                  layout="vertical"
                                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis type="number" allowDecimals={false}
                                   tick={{ fill: '#9a9186', fontSize: 12 }} />
                            <YAxis type="category" dataKey="label" width={100}
                                   tick={{ fill: '#9a9186', fontSize: 12, textTransform: 'capitalize' }} />
                            <RTooltip {...tooltipStyle}
                                      formatter={(v) => [`${v} invocation${v === 1 ? '' : 's'}`, null]} />
                            <Bar dataKey="count" fill="#42A5F5" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
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
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Paper>
        </Box>
    );
}
