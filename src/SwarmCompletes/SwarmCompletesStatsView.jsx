// /swarm/swarm-completes — Stats view (req #2794). Sibling of the DataGrid
// table, switched via the `darwin-swarm-completes-view` toggle in
// SwarmCompletesPage. Mirrors SwarmStartsStatsView (req #2686) but aggregates
// the richer swarm_completes data: status (success/error), skill, token cost,
// and the genuine per-phase token breakdown embedded in the telemetry blob.
//
// `computeSwarmCompleteStats` is exported as a pure function so the vitest unit
// test can validate the aggregation without rendering recharts. This is a POC
// — full + aggressive ideation of data points (req #2794); we reduce later.

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
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import {
    ResponsiveContainer, BarChart, Bar, LineChart, Line,
    PieChart, Pie, Cell, Legend,
    XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from 'recharts';

import { parsePhaseBreakdown } from './SwarmCompleteDetail';
import { AI_MODELS, AI_MODEL_COLOR, aiModelLabel } from '../SwarmView/modelChipStyles';
import { EFFORTS, EFFORT_COLOR, effortLabel } from '../SwarmView/effortChipStyles';

const STATS_WIDTH = 1140;
const TOP_PHASES_LIMIT = 12;

// Throughput x-axis range selector (req #2794). null = All time.
const THROUGHPUT_RANGES = [
    { label: '7d',  days: 7   },
    { label: '30d', days: 30  },
    { label: '90d', days: 90  },
    { label: '1Y',  days: 365 },
    { label: 'All', days: null },
];
const DEFAULT_THROUGHPUT_RANGE = 'All';

// Same wall buckets as swarm_starts so the two stats pages read consistently.
const WALL_BUCKETS = [
    { label: '<30s',   min: 0,    max: 30   },
    { label: '30–60s', min: 30,   max: 60   },
    { label: '1–2m',   min: 60,   max: 120  },
    { label: '2–5m',   min: 120,  max: 300  },
    { label: '5–10m',  min: 300,  max: 600  },
    { label: '10m+',   min: 600,  max: Infinity },
];

const TURN_BUCKETS = [
    { label: '<10',   min: 0,   max: 10  },
    { label: '10–20', min: 10,  max: 20  },
    { label: '20–30', min: 20,  max: 30  },
    { label: '30–50', min: 30,  max: 50  },
    { label: '50+',   min: 50,  max: Infinity },
];

// Fixed display order so a zero-count category still shows its column.
const STATUS_ORDER = ['ok', 'error', 'in_progress'];

const rowTokenTotal = (row) =>
    (Number(row.tokens_input) || 0) +
    (Number(row.tokens_cache_write) || 0) +
    (Number(row.tokens_cache_read) || 0) +
    (Number(row.tokens_output) || 0);

const emptyStats = () => ({
    total: 0,
    okCount: 0,
    errorCount: 0,
    inProgressCount: 0,
    successRate: 0,
    avgWall: null,
    inputTotal: 0,
    cacheWriteTotal: 0,
    cacheReadTotal: 0,
    outputTotal: 0,
    totalTokens: 0,
    avgTokensPerComplete: 0,
    cacheHitRate: null,
    avgTurns: null,
    statusHistogram: STATUS_ORDER.map(label => ({ label, count: 0 })),
    skillHistogram: [],
    wallHistogram: WALL_BUCKETS.map(b => ({ label: b.label, count: 0 })),
    turnsHistogram: TURN_BUCKETS.map(b => ({ label: b.label, count: 0 })),
    phaseAggregate: [],
    phaseTokenTotal: 0,
    throughput: [],
    modelHistogram: AI_MODELS.map(m => ({ label: aiModelLabel(m), count: 0 })),
    effortHistogram: EFFORTS.map(e => ({ label: effortLabel(e), count: 0 })),
});

// Pure aggregator — rows → stats object. Exported for unit testing.
export function computeSwarmCompleteStats(rows) {
    const total = rows.length;
    if (total === 0) return emptyStats();

    let okCount = 0;
    let errorCount = 0;
    let inProgressCount = 0;
    let wallSum = 0;
    let wallCount = 0;
    let turnSum = 0;
    let turnCount = 0;
    let inputTotal = 0;
    let cacheWriteTotal = 0;
    let cacheReadTotal = 0;
    let outputTotal = 0;

    const statusMap = Object.fromEntries(STATUS_ORDER.map(s => [s, 0]));
    const skillMap = new Map();          // skill_name → count
    const wallHistMap = Object.fromEntries(WALL_BUCKETS.map(b => [b.label, 0]));
    const turnsHistMap = Object.fromEntries(TURN_BUCKETS.map(b => [b.label, 0]));
    // req #2955 (#2949's swarm_completes.ai_model/effort columns) — the
    // finalizing session's model/effort. Unknown/NULL normalizes to the
    // documented backfill defaults ('opus' / 'high'), same rule as
    // SessionsStatsView's per-model/effort rollup.
    const modelMap = Object.fromEntries(AI_MODELS.map(m => [m, 0]));
    const effortMap = Object.fromEntries(EFFORTS.map(e => [e, 0]));
    // phase name → { phase, completes, tokens, wall }
    const phaseMap = new Map();
    // calendar date (YYYY-MM-DD from started_at) → { date, count, tokens }
    const dayMap = new Map();

    for (const row of rows) {
        // Status
        if (row.status === 'ok') okCount += 1;
        else if (row.status === 'error') errorCount += 1;
        else if (row.status === 'in_progress') inProgressCount += 1;
        if (row.status in statusMap) statusMap[row.status] += 1;

        // Skill
        const skill = row.skill_name || '—';
        skillMap.set(skill, (skillMap.get(skill) || 0) + 1);

        // Model/Effort (req #2955)
        modelMap[AI_MODEL_COLOR[row.ai_model] ? row.ai_model : 'opus'] += 1;
        effortMap[EFFORT_COLOR[row.effort] ? row.effort : 'high'] += 1;

        // Tokens
        inputTotal += Number(row.tokens_input) || 0;
        cacheWriteTotal += Number(row.tokens_cache_write) || 0;
        cacheReadTotal += Number(row.tokens_cache_read) || 0;
        outputTotal += Number(row.tokens_output) || 0;

        // Wall (skip null)
        const wall = row.wall_seconds;
        if (wall != null) {
            wallSum += Number(wall);
            wallCount += 1;
            const bucket = WALL_BUCKETS.find(b => wall >= b.min && wall < b.max);
            if (bucket) wallHistMap[bucket.label] += 1;
        }

        // Turns (skip null)
        const turns = row.turn_count;
        if (turns != null) {
            turnSum += Number(turns);
            turnCount += 1;
            const tb = TURN_BUCKETS.find(b => turns >= b.min && turns < b.max);
            if (tb) turnsHistMap[tb.label] += 1;
        }

        // Per-phase token aggregate (from telemetry). Each complete that records
        // a given phase contributes that phase's token total + wall once.
        const { tokenPhases } = parsePhaseBreakdown(row.telemetry);
        for (const p of tokenPhases) {
            const existing = phaseMap.get(p.phase) || {
                phase: p.phase, completes: 0, tokens: 0, wall: 0,
            };
            existing.completes += 1;
            existing.tokens += p.total;
            existing.wall += Number(p.wall) || 0;
            phaseMap.set(p.phase, existing);
        }

        // Throughput by calendar day (date portion of started_at).
        if (row.started_at) {
            const day = String(row.started_at).slice(0, 10);
            const d = dayMap.get(day) || { date: day, count: 0, tokens: 0 };
            d.count += 1;
            d.tokens += rowTokenTotal(row);
            dayMap.set(day, d);
        }
    }

    const totalTokens = inputTotal + cacheWriteTotal + cacheReadTotal + outputTotal;
    const cacheDenom = cacheReadTotal + cacheWriteTotal + inputTotal;

    const skillHistogram = Array.from(skillMap.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

    // Grand total of phase tokens across ALL phases (not just the top N) — the
    // denominator for the "% of Total" column (req #2794).
    const phaseTokenTotal = Array.from(phaseMap.values())
        .reduce((s, p) => s + p.tokens, 0);

    const phaseAggregate = Array.from(phaseMap.values())
        .map(p => ({
            phase: p.phase,
            completes: p.completes,
            tokens: p.tokens,
            avgTokens: p.completes > 0 ? p.tokens / p.completes : 0,
            wall: p.wall,
            pctOfTotal: phaseTokenTotal > 0 ? (p.tokens / phaseTokenTotal) * 100 : 0,
        }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, TOP_PHASES_LIMIT);

    const throughput = Array.from(dayMap.values())
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return {
        total,
        okCount,
        errorCount,
        inProgressCount,
        successRate: okCount / total,
        avgWall: wallCount > 0 ? wallSum / wallCount : null,
        inputTotal,
        cacheWriteTotal,
        cacheReadTotal,
        outputTotal,
        totalTokens,
        avgTokensPerComplete: totalTokens / total,
        cacheHitRate: cacheDenom > 0 ? cacheReadTotal / cacheDenom : null,
        avgTurns: turnCount > 0 ? turnSum / turnCount : null,
        statusHistogram: STATUS_ORDER.map(label => ({ label, count: statusMap[label] || 0 })),
        skillHistogram,
        wallHistogram: WALL_BUCKETS.map(b => ({ label: b.label, count: wallHistMap[b.label] || 0 })),
        turnsHistogram: TURN_BUCKETS.map(b => ({ label: b.label, count: turnsHistMap[b.label] || 0 })),
        phaseAggregate,
        phaseTokenTotal,
        throughput,
        modelHistogram: AI_MODELS.map(m => ({ label: aiModelLabel(m), count: modelMap[m] })),
        effortHistogram: EFFORTS.map(e => ({ label: effortLabel(e), count: effortMap[e] })),
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

function KpiCard({ label, value, hint }) {
    return (
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

const tooltipStyle = {
    contentStyle: {
        backgroundColor: '#2a2723',
        border: '1px solid rgba(255,255,255,0.1)',
        color: '#e8e1d5',
        borderRadius: 4,
    },
    labelStyle: { color: '#e8e1d5' },
};

const axisTick = { fill: '#9a9186', fontSize: 12 };
const grid = <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />;
const countFormatter = (v) => [`${v} complete${v === 1 ? '' : 's'}`, null];

// Per-category slice colors for the pie charts; unmatched labels fall through
// to the rotating palette so the chart never renders a colorless slice.
const STATUS_COLORS = { ok: '#4caf50', error: '#ef5350', in_progress: '#29b6f6' };
const SKILL_COLORS = {
    'swarm-complete': '#26c6da',
    'primary-ai-swarm-complete': '#ffa726',
};
// Model/effort pie colors (req #2955), keyed by capitalized label — mirrors
// SessionsStatsView's MODEL_PIE_COLORS/EFFORT_PIE_COLORS.
const MODEL_PIE_COLORS = Object.fromEntries(
    AI_MODELS.map(m => [aiModelLabel(m), AI_MODEL_COLOR[m]]));
const EFFORT_PIE_COLORS = Object.fromEntries(
    EFFORTS.map(e => [effortLabel(e), EFFORT_COLOR[e]]));
const PIE_FALLBACK = ['#7E57C2', '#E91E63', '#ffca28', '#66bb6a', '#42a5f5'];

const colorFor = (label, map, idx) => map[label] || PIE_FALLBACK[idx % PIE_FALLBACK.length];

// % label drawn just outside each slice (short → no clipping for long names).
const piePctLabel = ({ percent }) => `${(percent * 100).toFixed(0)}%`;

// Tooltip shows both count and % for the hovered slice.
const piePieFormatter = (value, _name, item) => {
    const pct = ((item?.payload?.percent ?? 0) * 100).toFixed(0);
    return [`${value} (${pct}%)`, item?.payload?.label];
};

// Legend renders the category name plus its raw count, so count + % are both
// always on-screen without crowding the slices.
const legendWithCount = (value, entry) => {
    const c = entry?.payload?.count ?? entry?.payload?.value ?? 0;
    return `${value} (${c})`;
};

// Distribution rendered as a donut. `data` is [{ label, count }]; zero-count
// categories are dropped so the pie shows only present values.
function PieDistribution({ data, colorMap, testId }) {
    const slices = data.filter(d => d.count > 0);
    if (slices.length === 0) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center',
                        justifyContent: 'center', height: '100%' }}>
                <Typography variant="body2" color="text.secondary">No data.</Typography>
            </Box>
        );
    }
    return (
        <ResponsiveContainer width="100%" height="100%" data-testid={testId}>
            <PieChart margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <Pie data={slices} dataKey="count" nameKey="label"
                     cx="50%" cy="50%" innerRadius={45} outerRadius={75}
                     paddingAngle={2} label={piePctLabel} labelLine={false}>
                    {slices.map((d, i) => (
                        <Cell key={d.label} fill={colorFor(d.label, colorMap, i)} />
                    ))}
                </Pie>
                <RTooltip {...tooltipStyle} formatter={piePieFormatter} />
                <Legend formatter={legendWithCount}
                        wrapperStyle={{ fontSize: 12, color: '#9a9186' }} />
            </PieChart>
        </ResponsiveContainer>
    );
}

// Filter the throughput series to the selected range (relative to today). null
// days = All time. Uses the browser clock; the aggregator stays pure/testable
// by producing the full series and letting the view window it.
function windowThroughput(series, days) {
    if (days == null) return series;
    const cutoff = new Date(Date.now() - days * 86400000)
        .toISOString().slice(0, 10);
    return series.filter(d => d.date >= cutoff);
}

export default function SwarmCompletesStatsView({ rows = [] }) {
    const stats = computeSwarmCompleteStats(rows);
    const [throughputRange, setThroughputRange] = useState(DEFAULT_THROUGHPUT_RANGE);

    if (rows.length === 0) {
        return (
            <Box sx={{ px: 3, pt: 1, maxWidth: STATS_WIDTH }} data-testid="swarm-completes-stats-empty">
                <Typography color="text.secondary">
                    No completes recorded.
                </Typography>
            </Box>
        );
    }

    const rangeDays = THROUGHPUT_RANGES.find(r => r.label === throughputRange)?.days ?? null;
    const throughputData = windowThroughput(stats.throughput, rangeDays);

    return (
        <Box sx={{ px: 3, pt: 1, maxWidth: STATS_WIDTH }} data-testid="swarm-completes-stats-view">
            {/* KPI strip — uniform grid columns so cards align on both edges. */}
            <Box sx={{ display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                        gap: 2, mb: 2 }}
                 data-testid="swarm-completes-stats-kpis">
                <KpiCard label="Completes" value={stats.total.toLocaleString()} />
                <KpiCard label="Success Rate"
                         value={formatPct(stats.successRate)}
                         hint={`${stats.okCount} ok · ${stats.errorCount} err${stats.inProgressCount ? ` · ${stats.inProgressCount} wip` : ''}`} />
                <KpiCard label="Avg Wall / Complete" value={formatSeconds(stats.avgWall)} />
                <KpiCard label="Avg Tokens / Complete" value={formatTokens(stats.avgTokensPerComplete)} />
                <KpiCard label="Total Tokens" value={formatTokens(stats.totalTokens)} />
                <KpiCard label="Cache Hit Rate"
                         value={formatPct(stats.cacheHitRate)}
                         hint="context read from cache" />
                <KpiCard label="Avg Turns / Complete"
                         value={stats.avgTurns == null ? '—' : stats.avgTurns.toFixed(1)} />
            </Box>

            {/* Charts — full-width, stacked so each block hugs the page margins. */}
            <Stack spacing={2} sx={{ mb: 2 }}>
                <ChartCard
                    title="Status Distribution"
                    height={240}
                    testId="chart-status-histogram"
                >
                    <PieDistribution data={stats.statusHistogram}
                                     colorMap={STATUS_COLORS}
                                     testId="pie-status" />
                </ChartCard>

                <ChartCard
                    title="Skill Distribution"
                    height={240}
                    testId="chart-skill-histogram"
                >
                    <PieDistribution data={stats.skillHistogram}
                                     colorMap={SKILL_COLORS}
                                     testId="pie-skill" />
                </ChartCard>

                {/* Model/Effort Split (req #2955) — cost-by-model/effort at a
                    glance, mirroring SessionsStatsView's Model/Effort Split. */}
                <ChartCard
                    title="Model Split"
                    height={240}
                    testId="chart-model-histogram"
                >
                    <PieDistribution data={stats.modelHistogram}
                                     colorMap={MODEL_PIE_COLORS}
                                     testId="pie-model" />
                </ChartCard>

                <ChartCard
                    title="Effort Split"
                    height={240}
                    testId="chart-effort-histogram"
                >
                    <PieDistribution data={stats.effortHistogram}
                                     colorMap={EFFORT_PIE_COLORS}
                                     testId="pie-effort" />
                </ChartCard>

                <ChartCard
                    title="Wall-Time Distribution"
                    subtitle="How long each complete takes end-to-end"
                    testId="chart-wall-histogram"
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.wallHistogram}
                                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            {grid}
                            <XAxis dataKey="label" tick={axisTick} />
                            <YAxis allowDecimals={false} tick={axisTick} />
                            <RTooltip {...tooltipStyle} formatter={countFormatter} />
                            <Bar dataKey="count" fill="#7E57C2" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard
                    title="Turn-Count Distribution"
                    subtitle="LLM turns consumed per complete"
                    testId="chart-turns-histogram"
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.turnsHistogram}
                                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            {grid}
                            <XAxis dataKey="label" tick={axisTick} />
                            <YAxis allowDecimals={false} tick={axisTick} />
                            <RTooltip {...tooltipStyle} formatter={countFormatter} />
                            <Bar dataKey="count" fill="#E91E63" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                {stats.throughput.length > 0 && (
                    <ChartCard
                        title="Throughput Over Time"
                        subtitle="Completes per calendar day"
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
                                    No completes in the last {throughputRange}.
                                </Typography>
                            </Box>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={throughputData}
                                           margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                    {grid}
                                    <XAxis dataKey="date" tick={axisTick} />
                                    <YAxis allowDecimals={false} tick={axisTick} />
                                    <RTooltip {...tooltipStyle} formatter={countFormatter} />
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

            {/* Phase Cost Leaderboard — aggregate of the per-phase token costs every
                complete records in its telemetry. The analog of swarm-starts'
                "Top Invocation Patterns": which /swarm-complete phase dominates the
                token spend across all completes. */}
            <Paper elevation={1} sx={{ p: 2 }} data-testid="phase-cost-leaderboard">
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    Phase Cost Leaderboard
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                    Aggregate per-phase token cost across all completes (top {TOP_PHASES_LIMIT})
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
                                    <TableCell align="right">Completes</TableCell>
                                    <TableCell align="right">% of Total</TableCell>
                                    <TableCell align="right">Total Tokens</TableCell>
                                    <TableCell align="right">Avg / Complete</TableCell>
                                    <TableCell align="right">Total Wall</TableCell>
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
                                        <TableCell align="right">{p.completes}</TableCell>
                                        <TableCell align="right">{p.pctOfTotal.toFixed(1)}%</TableCell>
                                        <TableCell align="right">{p.tokens.toLocaleString()}</TableCell>
                                        <TableCell align="right">{formatTokens(p.avgTokens)}</TableCell>
                                        <TableCell align="right">{formatSeconds(p.wall)}</TableCell>
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
