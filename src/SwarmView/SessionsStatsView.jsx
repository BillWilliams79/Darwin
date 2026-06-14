// /swarm/sessions — Stats view (req #2825). Sibling of the DataGrid table,
// switched via the `darwin-swarm-sessions-view` toggle in SessionsView.
// Aggregates the per-phase time buckets from req #2332 across all sessions:
// avg/median duration per phase, % of total, agentic/human/machine time split,
// duration distribution, status distribution, and an avg-duration trend.
//
// Pre-instrumentation sessions (instrumented=0) are EXCLUDED from every average
// so legacy rows don't pollute the numbers; their count + total time are shown
// separately. `computeSessionStats` is exported as a pure function so the vitest
// unit test can validate the aggregation without rendering recharts. POC spirit
// (req #2825) — aggressive ideation of data points; we reduce later.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

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

import { PHASE_BUCKETS, GROUP_COLORS, bucketTokens, parsePhaseTokens, formatTokens,
         TOKEN_TYPES, tokenPhaseKey } from './sessionPhases';
import { formatDuration } from '../utils/formatDuration';

const STATS_WIDTH = 1140;

// The 7 real instrumented phases (everything except the legacy bucket). Legacy
// is reported separately, never aggregated into per-phase averages.
const REAL_PHASES = PHASE_BUCKETS.filter(p => p.key !== 'legacy_secs');

// Agentic/Human/Machine grouping (canonical per CLAUDE.md / sessionPhases).
const GROUP_ORDER = ['agentic', 'human', 'machine'];
const GROUP_LABEL = { agentic: 'Agentic', human: 'Human', machine: 'Machine' };

// Trend x-axis range selector. null = All time.
const TREND_RANGES = [
    { label: '7d',  days: 7   },
    { label: '30d', days: 30  },
    { label: '90d', days: 90  },
    { label: '1Y',  days: 365 },
    { label: 'All', days: null },
];
const DEFAULT_TREND_RANGE = 'All';

// Session-scale duration buckets (seconds).
const DURATION_BUCKETS = [
    { label: '<1m',    min: 0,    max: 60    },
    { label: '1–5m',   min: 60,   max: 300   },
    { label: '5–15m',  min: 300,  max: 900   },
    { label: '15–30m', min: 900,  max: 1800  },
    { label: '30–60m', min: 1800, max: 3600  },
    { label: '1h+',    min: 3600, max: Infinity },
];

// Fixed status order so the status histogram has a stable shape (still computed
// for the unit tests / aggregator even though the status pie was culled).
const STATUS_ORDER = ['starting', 'waiting', 'planning', 'active', 'review', 'completing', 'completed', 'paused'];

// The four token types (req #2839 / #2845). Ordered cheapest-context → priciest
// so the composition chart reads left-to-right by unit price; labels are friendly.
const TOKEN_TYPE_META = [
    { key: 'cache_read',  label: 'Cache Read',  color: '#66bb6a' },
    { key: 'input',       label: 'Input',       color: '#42a5f5' },
    { key: 'cache_write', label: 'Cache Write', color: '#ffca28' },
    { key: 'output',      label: 'Output',      color: '#ef5350' },
];

// How many sessions to surface in the Biggest-Cost Sessions leaderboard.
const TOP_COST_LIMIT = 10;

// Sum of all 8 *_secs buckets — matches the SessionsView Duration column so the
// stats page and the table report the same per-session total.
const sessionDurationSecs = (row) =>
    PHASE_BUCKETS.reduce((s, b) => s + (Number(row[b.key]) || 0), 0);

const median = (nums) => {
    if (nums.length === 0) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
};

const emptyStats = () => ({
    total: 0,
    instrumentedCount: 0,
    legacyCount: 0,
    legacySecs: 0,
    totalTrackedSecs: 0,
    avgDuration: null,
    medianDuration: null,
    agenticSecs: 0,
    humanSecs: 0,
    machineSecs: 0,
    agenticPct: null,
    humanPct: null,
    machinePct: null,
    // Per-phase TOKEN cost (req #2839) — parallel to the time aggregates above.
    totalTokens: 0,
    tokenInstrumentedCount: 0,
    agenticTokens: 0,
    humanTokens: 0,
    machineTokens: 0,
    // Token economics (req #2845).
    tokenTypeTotals: { input: 0, cache_write: 0, cache_read: 0, output: 0 },
    avgTokensPerSession: null,
    medianTokensPerSession: null,
    tokenTrackedSecs: 0,
    tokensPerSecond: null,
    cacheReadShare: null,
    tokenTrend: [],
    topCostSessions: [],
    groupSplit: GROUP_ORDER.map(g => ({ label: GROUP_LABEL[g], group: g, count: 0 })),
    phaseAggregate: [],
    durationHistogram: DURATION_BUCKETS.map(b => ({ label: b.label, count: 0 })),
    statusHistogram: STATUS_ORDER.map(label => ({ label, count: 0 })),
    trend: [],
});

// Pure aggregator — session rows → stats object. Exported for unit testing.
export function computeSessionStats(rows) {
    const total = rows.length;
    if (total === 0) return emptyStats();

    const instrumented = rows.filter(r => r.instrumented);
    const legacy = rows.filter(r => !r.instrumented);
    const instrumentedCount = instrumented.length;

    const legacySecs = legacy.reduce((s, r) => s + (Number(r.legacy_secs) || 0), 0);

    // Per-phase running sums + the list of per-session values (for medians),
    // built only from instrumented rows.
    const phaseSums = Object.fromEntries(REAL_PHASES.map(p => [p.key, 0]));
    const phaseSessions = Object.fromEntries(REAL_PHASES.map(p => [p.key, 0])); // nonzero count
    const phaseNonzeroValues = Object.fromEntries(REAL_PHASES.map(p => [p.key, []]));

    // Per-phase TOKEN cost (req #2839). Summed across instrumented rows that
    // carry a phase_tokens blob; rows without token instrumentation contribute 0
    // (their phase_tokens is NULL) and are counted separately so the UI can show
    // how many sessions actually have token data.
    const phaseTokenSums = Object.fromEntries(REAL_PHASES.map(p => [p.key, 0]));
    let tokenInstrumentedCount = 0;

    // Token economics (req #2845): per-type totals (cache-efficiency view),
    // per-session totals (leaderboard + avg/median), and the duration of
    // token-instrumented sessions only (so tokens/sec isn't diluted by sessions
    // that never carried token data).
    const tokenTypeTotals = { input: 0, cache_write: 0, cache_read: 0, output: 0 };
    const sessionTokenList = [];
    let tokenTrackedSecs = 0;

    const durationHistMap = Object.fromEntries(DURATION_BUCKETS.map(b => [b.label, 0]));
    const durations = [];
    let totalTrackedSecs = 0;

    // status counts over ALL rows (legacy + instrumented).
    const statusMap = Object.fromEntries(STATUS_ORDER.map(s => [s, 0]));

    // calendar day (YYYY-MM-DD from started_at) → { date, sumDuration, count }
    const dayMap = new Map();

    for (const row of rows) {
        if (row.swarm_status in statusMap) statusMap[row.swarm_status] += 1;
    }

    for (const row of instrumented) {
        const parsedTokens = parsePhaseTokens(row.phase_tokens);
        // An empty {} carries no token data — treat it like NULL so it doesn't
        // inflate tokenInstrumentedCount or deflate the per-session averages.
        const hasTokens = !!parsedTokens && Object.keys(parsedTokens).length > 0;
        if (hasTokens) tokenInstrumentedCount += 1;
        let rowTokens = 0;
        for (const p of REAL_PHASES) {
            const v = Number(row[p.key]) || 0;
            phaseSums[p.key] += v;
            if (v > 0) {
                phaseSessions[p.key] += 1;
                phaseNonzeroValues[p.key].push(v);
            }
            if (hasTokens) {
                const phaseBlob = parsedTokens[tokenPhaseKey(p.key)];
                const tk = bucketTokens(parsedTokens, p.key);
                phaseTokenSums[p.key] += tk;
                rowTokens += tk;
                for (const t of TOKEN_TYPES) tokenTypeTotals[t] += Number(phaseBlob?.[t]) || 0;
            }
        }

        const dur = sessionDurationSecs(row);
        durations.push(dur);
        totalTrackedSecs += dur;
        const bucket = DURATION_BUCKETS.find(b => dur >= b.min && dur < b.max);
        if (bucket) durationHistMap[bucket.label] += 1;

        if (hasTokens) {
            tokenTrackedSecs += dur;
            sessionTokenList.push({
                id: row.id,
                label: row.title || row.task_name || `#${row.id}`,
                tokens: rowTokens,
                durationSecs: dur,
            });
        }

        if (row.started_at) {
            const day = String(row.started_at).slice(0, 10);
            const d = dayMap.get(day) || { date: day, sumDuration: 0, sumTokens: 0, count: 0 };
            d.sumDuration += dur;
            d.sumTokens += rowTokens;
            d.count += 1;
            dayMap.set(day, d);
        }
    }

    // Grand total of phase tokens — equals totalTokens; used for the per-phase
    // token % so the column doesn't depend on totalTokens being computed first.
    const tokenGrandTotal = REAL_PHASES.reduce((s, p) => s + phaseTokenSums[p.key], 0);

    const phaseAggregate = REAL_PHASES.map(p => ({
        key: p.key,
        phase: p.label,
        color: p.color,
        group: p.group,
        sessions: phaseSessions[p.key],
        total: phaseSums[p.key],
        avg: instrumentedCount > 0 ? phaseSums[p.key] / instrumentedCount : 0,
        median: median(phaseNonzeroValues[p.key]),
        pctOfTotal: totalTrackedSecs > 0 ? (phaseSums[p.key] / totalTrackedSecs) * 100 : 0,
        tokens: phaseTokenSums[p.key],
        // Avg token cost per token-instrumented session + that phase's share of
        // total token cost (req #2845 follow-up).
        avgTokens: tokenInstrumentedCount > 0 ? phaseTokenSums[p.key] / tokenInstrumentedCount : 0,
        pctOfTokens: tokenGrandTotal > 0 ? (phaseTokenSums[p.key] / tokenGrandTotal) * 100 : 0,
    }));

    const groupSecs = (g) => phaseAggregate
        .filter(p => p.group === g)
        .reduce((s, p) => s + p.total, 0);
    const agenticSecs = groupSecs('agentic');
    const humanSecs = groupSecs('human');
    const machineSecs = groupSecs('machine');

    // Token cost grouped the same way the timing is (req #2839 §stats page).
    const groupTokens = (g) => phaseAggregate
        .filter(p => p.group === g)
        .reduce((s, p) => s + p.tokens, 0);
    const agenticTokens = groupTokens('agentic');
    const humanTokens = groupTokens('human');
    const machineTokens = groupTokens('machine');
    const totalTokens = agenticTokens + humanTokens + machineTokens;

    const pct = (v) => (totalTrackedSecs > 0 ? (v / totalTrackedSecs) * 100 : null);

    const sortedDays = Array.from(dayMap.values())
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const trend = sortedDays.map(d => ({
        date: d.date, count: d.count, avgDuration: d.sumDuration / d.count,
        // Token cost on this day; null (not 0) on token-less days so the merged
        // dual-axis trend line skips the gap instead of dropping to the floor.
        tokens: d.sumTokens > 0 ? d.sumTokens : null,
    }));
    // Token cost over time (req #2845): per-day total token cost, days with token
    // data only so the line isn't dragged to zero by pre-token sessions.
    const tokenTrend = sortedDays
        .filter(d => d.sumTokens > 0)
        .map(d => ({ date: d.date, tokens: d.sumTokens }));

    // Biggest-cost sessions leaderboard (req #2845): descending by total tokens.
    const topCostSessions = [...sessionTokenList]
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, TOP_COST_LIMIT);

    const tokenValues = sessionTokenList.map(s => s.tokens);
    const avgTokensPerSession = tokenInstrumentedCount > 0
        ? totalTokens / tokenInstrumentedCount : null;
    const medianTokensPerSession = median(tokenValues);
    const tokensPerSecond = tokenTrackedSecs > 0 ? totalTokens / tokenTrackedSecs : null;
    // Cache effectiveness: cheap cache reads as a share of the "context load"
    // (cache reads + fresh input). High = strong cache reuse.
    const cacheBase = tokenTypeTotals.cache_read + tokenTypeTotals.input;
    const cacheReadShare = cacheBase > 0 ? (tokenTypeTotals.cache_read / cacheBase) * 100 : null;

    return {
        total,
        instrumentedCount,
        legacyCount: legacy.length,
        legacySecs,
        totalTrackedSecs,
        avgDuration: instrumentedCount > 0 ? totalTrackedSecs / instrumentedCount : null,
        medianDuration: median(durations),
        agenticSecs,
        humanSecs,
        machineSecs,
        agenticPct: pct(agenticSecs),
        humanPct: pct(humanSecs),
        machinePct: pct(machineSecs),
        totalTokens,
        tokenInstrumentedCount,
        agenticTokens,
        humanTokens,
        machineTokens,
        tokenTypeTotals,
        avgTokensPerSession,
        medianTokensPerSession,
        tokenTrackedSecs,
        tokensPerSecond,
        cacheReadShare,
        tokenTrend,
        topCostSessions,
        groupSplit: GROUP_ORDER.map(g => ({
            label: GROUP_LABEL[g],
            group: g,
            count: groupSecs(g),
        })),
        phaseAggregate,
        durationHistogram: DURATION_BUCKETS.map(b => ({ label: b.label, count: durationHistMap[b.label] || 0 })),
        statusHistogram: STATUS_ORDER.map(label => ({ label, count: statusMap[label] || 0 })),
        trend,
    };
}

const formatPct = (v) => (v == null ? '—' : `${v.toFixed(0)}%`);

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

function ChartCard({ title, subtitle, height = 240, children, testId, action }) {
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
const sessionCountFormatter = (v) => [`${v} session${v === 1 ? '' : 's'}`, null];

const PIE_FALLBACK = ['#7E57C2', '#E91E63', '#ffca28', '#66bb6a', '#42a5f5'];
const colorFor = (label, map, idx) => map[label] || PIE_FALLBACK[idx % PIE_FALLBACK.length];

const piePctLabel = ({ percent }) => `${(percent * 100).toFixed(0)}%`;

// Pie value tooltip — show formatted duration + % for the hovered slice.
const pieDurationFormatter = (value, _name, item) => {
    const pct = ((item?.payload?.percent ?? 0) * 100).toFixed(0);
    return [`${formatDuration(value)} (${pct}%)`, item?.payload?.label];
};

// Token-cost variants of the pie/axis formatters (req #2845).
const pieTokenFormatter = (value, _name, item) => {
    const pct = ((item?.payload?.percent ?? 0) * 100).toFixed(0);
    return [`${formatTokens(value)} tok (${pct}%)`, item?.payload?.label];
};
const tokenAxisFormatter = (v) => formatTokens(v);
const tokenBarFormatter = (v) => [`${formatTokens(v)} tok`, null];
const formatTokensPerSec = (v) => (v == null ? '—' : `${formatTokens(Math.round(v))}/s`);

// Donut distribution. `data` is [{ label, count }]; zero-count slices dropped.
// `hideLegend` suppresses the per-chart legend so a pair of pies can share one
// common legend rendered below them (req #2845 follow-up).
function PieDistribution({ data, colorMap, testId, valueFormatter, legendFormatter, hideLegend }) {
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
                <RTooltip {...tooltipStyle} formatter={valueFormatter} />
                {!hideLegend && (
                    <Legend formatter={legendFormatter}
                            wrapperStyle={{ fontSize: 12, color: '#9a9186' }} />
                )}
            </PieChart>
        </ResponsiveContainer>
    );
}

// One common key shared by a pair of pies. `items` is [{ label, color }] — no
// per-slice values, so it reads the same for both the time and token pies.
function SharedLegend({ items }) {
    return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
                    columnGap: 2, rowGap: 0.5, mt: 1 }}>
            {items.map(it => (
                <Box key={it.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: it.color }} />
                    <Typography variant="caption" sx={{ color: '#9a9186' }}>{it.label}</Typography>
                </Box>
            ))}
        </Box>
    );
}

// A card holding the time pie next to the token-cost pie, sharing one legend.
// The token pie is omitted when there's no token data (the time pie centers).
function DualPieCard({ title, subtitle, testId, timeData, tokenData, colorMap, legendItems, showToken }) {
    return (
        <Paper elevation={1} sx={{ p: 2, width: '100%' }} data-testid={testId}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{title}</Typography>
            {subtitle && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                    {subtitle}
                </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 2 }}>
                <Box sx={{ flex: 1, textAlign: 'center' }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>Time</Typography>
                    <Box sx={{ height: 220, '& svg': { outline: 'none' }, '& svg *': { outline: 'none' } }}>
                        <PieDistribution data={timeData} colorMap={colorMap} hideLegend
                                         valueFormatter={pieDurationFormatter} />
                    </Box>
                </Box>
                {showToken && (
                    <Box sx={{ flex: 1, textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Token Cost</Typography>
                        <Box sx={{ height: 220, '& svg': { outline: 'none' }, '& svg *': { outline: 'none' } }}>
                            <PieDistribution data={tokenData} colorMap={colorMap} hideLegend
                                             valueFormatter={pieTokenFormatter} />
                        </Box>
                    </Box>
                )}
            </Box>
            <SharedLegend items={legendItems} />
        </Paper>
    );
}

// Window the trend series to the selected range (relative to today). null days
// = All time. Uses the browser clock; aggregator stays pure by producing the
// full series and letting the view window it.
function windowTrend(series, days) {
    if (days == null) return series;
    const cutoff = new Date(Date.now() - days * 86400000)
        .toISOString().slice(0, 10);
    return series.filter(d => d.date >= cutoff);
}

// The group split pie keys off the human-readable group label, so its color
// map must use those same labels.
const GROUP_PIE_COLORS = {
    [GROUP_LABEL.agentic]: GROUP_COLORS.agentic,
    [GROUP_LABEL.human]:   GROUP_COLORS.human,
    [GROUP_LABEL.machine]: GROUP_COLORS.machine,
};
const PHASE_PIE_COLORS = Object.fromEntries(REAL_PHASES.map(p => [p.label, p.color]));

// Token-type composition colors, keyed by friendly label (req #2845).
const TOKEN_TYPE_COLORS = Object.fromEntries(TOKEN_TYPE_META.map(t => [t.label, t.color]));

export default function SessionsStatsView({ rows = [] }) {
    const stats = computeSessionStats(rows);
    const navigate = useNavigate();
    const [trendRange, setTrendRange] = useState(DEFAULT_TREND_RANGE);

    if (rows.length === 0) {
        return (
            <Box sx={{ px: 3, pt: 1, maxWidth: STATS_WIDTH }} data-testid="sessions-stats-empty">
                <Typography color="text.secondary">No sessions recorded.</Typography>
            </Box>
        );
    }

    if (stats.instrumentedCount === 0) {
        return (
            <Box sx={{ px: 3, pt: 1, maxWidth: STATS_WIDTH }} data-testid="sessions-stats-no-instrumented">
                <Typography color="text.secondary">
                    No instrumented sessions yet — phase-duration stats require
                    sessions tracked under req #2332.
                    {stats.legacyCount > 0 && ` (${stats.legacyCount} legacy session${stats.legacyCount === 1 ? '' : 's'} excluded.)`}
                </Typography>
            </Box>
        );
    }

    const rangeDays = TREND_RANGES.find(r => r.label === trendRange)?.days ?? null;
    const trendData = windowTrend(stats.trend, rangeDays);
    // Does the windowed range actually carry any token cost? (controls whether the
    // token line + right axis appear on the merged trend chart).
    const trendHasTokens = trendData.some(d => d.tokens != null);

    // Token-cost views render only once at least one session carries token data.
    const hasTokenData = stats.tokenInstrumentedCount > 0;

    // Paired time/token pie data, grouped into one card each (req #2845 follow-up).
    const timePhaseData = stats.phaseAggregate.map(p => ({ label: p.phase, count: p.total }));
    const tokenPhaseData = stats.phaseAggregate.map(p => ({ label: p.phase, count: p.tokens }));
    const phaseLegendItems = stats.phaseAggregate
        .filter(p => p.total > 0 || p.tokens > 0)
        .map(p => ({ label: p.phase, color: p.color }));

    const tokenGroupData = GROUP_ORDER.map(g => ({
        label: GROUP_LABEL[g],
        count: g === 'agentic' ? stats.agenticTokens
             : g === 'human'   ? stats.humanTokens
             : stats.machineTokens,
    }));
    const groupLegendItems = GROUP_ORDER.map(g => ({
        label: GROUP_LABEL[g], color: GROUP_COLORS[g],
    }));

    const tokenTypeData = TOKEN_TYPE_META.map(t => ({
        label: t.label, count: stats.tokenTypeTotals[t.key] || 0, color: t.color,
    }));

    return (
        <Box sx={{ px: 3, pt: 1, maxWidth: STATS_WIDTH }} data-testid="sessions-stats-view">
            {/* KPI strip — row 1: overall session metrics. */}
            <Box sx={{ display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                        gap: 2, mb: 2 }}
                 data-testid="sessions-stats-kpis">
                <KpiCard label="Instrumented Sessions"
                         value={stats.instrumentedCount.toLocaleString()}
                         hint={stats.legacyCount > 0 ? `${stats.legacyCount} legacy excluded` : 'all instrumented'} />
                <KpiCard label="Total Tracked Time" value={formatDuration(stats.totalTrackedSecs)} />
                <KpiCard label="Avg Duration" value={formatDuration(Math.round(stats.avgDuration))} />
                <KpiCard label="Median Duration" value={formatDuration(Math.round(stats.medianDuration))} />
            </Box>

            {/* KPI strip — row 2: agentic / human / machine time split. */}
            <Box sx={{ display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: 2, mb: 2 }}
                 data-testid="sessions-stats-kpis-split">
                <KpiCard label="Agentic"
                         value={formatPct(stats.agenticPct)}
                         hint={formatDuration(stats.agenticSecs)} />
                <KpiCard label="Human"
                         value={formatPct(stats.humanPct)}
                         hint={formatDuration(stats.humanSecs)} />
                <KpiCard label="Machine"
                         value={formatPct(stats.machinePct)}
                         hint={formatDuration(stats.machineSecs)} />
            </Box>

            {/* KPI strip — row 3: token cost economics (req #2845). */}
            {hasTokenData && (
                <Box sx={{ display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                            gap: 2, mb: 2 }}
                     data-testid="token-stats-kpis">
                    <KpiCard label="Total Token Cost"
                             value={formatTokens(stats.totalTokens)}
                             hint={`${stats.tokenInstrumentedCount} session${stats.tokenInstrumentedCount === 1 ? '' : 's'} with token data`} />
                    <KpiCard label="Avg Cost / Session"
                             value={formatTokens(Math.round(stats.avgTokensPerSession))} />
                    <KpiCard label="Median Cost / Session"
                             value={stats.medianTokensPerSession == null ? '—' : formatTokens(Math.round(stats.medianTokensPerSession))} />
                    <KpiCard label="Throughput"
                             value={formatTokensPerSec(stats.tokensPerSecond)}
                             hint="tokens / tracked second" />
                    <KpiCard label="Cache Read Share"
                             value={formatPct(stats.cacheReadShare)}
                             hint="cache reads vs fresh input" />
                </Box>
            )}

            {/* Major blocks — full-width, stacked. */}
            <Stack spacing={2} sx={{ mb: 2 }}>
                {/* Per-Phase Breakdown — the core of req #2825: avg/median per
                    phase, % of total, across all instrumented sessions. */}
                <Paper elevation={1} sx={{ p: 2 }} data-testid="phase-leaderboard">
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                        Per-Phase Breakdown
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                        Across {stats.instrumentedCount} instrumented session{stats.instrumentedCount === 1 ? '' : 's'}
                        {stats.legacyCount > 0 && ` (${stats.legacyCount} legacy excluded, ${formatDuration(stats.legacySecs)} total)`}
                    </Typography>
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Phase</TableCell>
                                    <TableCell align="right">Sessions</TableCell>
                                    <TableCell align="right">Avg Time / Session</TableCell>
                                    <TableCell align="right">% of Time</TableCell>
                                    <TableCell align="right">Avg Token Cost / Session</TableCell>
                                    <TableCell align="right">% of Tokens</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {stats.phaseAggregate.map(p => (
                                    <TableRow key={p.key} hover>
                                        <TableCell>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: p.color }} />
                                                <Typography component="span" variant="body2">{p.phase}</Typography>
                                            </Box>
                                        </TableCell>
                                        <TableCell align="right">{p.sessions}</TableCell>
                                        <TableCell align="right">{formatDuration(Math.round(p.avg))}</TableCell>
                                        <TableCell align="right">{p.pctOfTotal.toFixed(0)}%</TableCell>
                                        <TableCell align="right">{p.tokens > 0 ? formatTokens(Math.round(p.avgTokens)) : '—'}</TableCell>
                                        <TableCell align="right">{p.tokens > 0 ? `${p.pctOfTokens.toFixed(0)}%` : '—'}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>

                <DualPieCard
                    title="Phase Distribution"
                    subtitle="Share of time vs token cost by phase"
                    testId="chart-phase-distribution"
                    timeData={timePhaseData}
                    tokenData={tokenPhaseData}
                    colorMap={PHASE_PIE_COLORS}
                    legendItems={phaseLegendItems}
                    showToken={hasTokenData} />

                <DualPieCard
                    title="Agentic vs Human vs Machine"
                    subtitle="Share of time vs token cost by who/what owns the phase"
                    testId="chart-group-split"
                    timeData={stats.groupSplit}
                    tokenData={tokenGroupData}
                    colorMap={GROUP_PIE_COLORS}
                    legendItems={groupLegendItems}
                    showToken={hasTokenData} />

                <ChartCard
                    title="Session Duration Distribution"
                    subtitle="How long each instrumented session runs end-to-end"
                    testId="chart-duration-histogram"
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.durationHistogram}
                                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            {grid}
                            <XAxis dataKey="label" tick={axisTick} />
                            <YAxis allowDecimals={false} tick={axisTick} />
                            <RTooltip {...tooltipStyle} formatter={sessionCountFormatter} />
                            <Bar dataKey="count" fill="#7E57C2" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>

                {stats.trend.length > 0 && (
                    <ChartCard
                        title="Time & Token Cost Over Time"
                        subtitle="Avg session duration (left axis) and total token cost (right axis) per day"
                        testId="chart-trend"
                        action={
                            <ToggleButtonGroup
                                value={trendRange}
                                exclusive
                                size="small"
                                onChange={(_e, v) => { if (v) setTrendRange(v); }}
                                data-testid="trend-range-toggle"
                            >
                                {TREND_RANGES.map(r => (
                                    <ToggleButton key={r.label} value={r.label}
                                                  sx={{ px: 1.25, py: 0.25, fontSize: '0.7rem' }}
                                                  data-testid={`trend-range-${r.label}`}>
                                        {r.label}
                                    </ToggleButton>
                                ))}
                            </ToggleButtonGroup>
                        }
                    >
                        {trendData.length === 0 ? (
                            <Box sx={{ display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', height: '100%' }}>
                                <Typography variant="body2" color="text.secondary">
                                    No sessions in the last {trendRange}.
                                </Typography>
                            </Box>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={trendData}
                                           margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                    {grid}
                                    <XAxis dataKey="date" tick={axisTick} />
                                    <YAxis yAxisId="time" tick={{ ...axisTick, fill: '#ffa726' }}
                                           tickFormatter={(v) => formatDuration(Math.round(v))} />
                                    {trendHasTokens && (
                                        <YAxis yAxisId="tokens" orientation="right"
                                               tick={{ ...axisTick, fill: '#7E57C2' }}
                                               tickFormatter={tokenAxisFormatter} />
                                    )}
                                    <RTooltip {...tooltipStyle}
                                              formatter={(v, name) => (name === 'token cost'
                                                  ? [`${formatTokens(v)} tok`, name]
                                                  : [formatDuration(Math.round(v)), name])} />
                                    <Legend wrapperStyle={{ fontSize: 12, color: '#9a9186' }} />
                                    <Line yAxisId="time" type="monotone" dataKey="avgDuration"
                                          name="avg duration" stroke="#ffa726" strokeWidth={2}
                                          dot={{ fill: '#ffa726', r: 3 }} activeDot={{ r: 5 }} />
                                    {trendHasTokens && (
                                        <Line yAxisId="tokens" type="monotone" dataKey="tokens"
                                              name="token cost" stroke="#7E57C2" strokeWidth={2}
                                              connectNulls
                                              dot={{ fill: '#7E57C2', r: 3 }} activeDot={{ r: 5 }} />
                                    )}
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </ChartCard>
                )}

                {hasTokenData && (
                    <ChartCard
                        title="Token Cost Composition"
                        subtitle="Cache reads (cheap) vs fresh input vs cache writes vs output"
                        testId="chart-token-composition"
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={tokenTypeData}
                                      margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                                {grid}
                                <XAxis dataKey="label" tick={axisTick} />
                                <YAxis tick={axisTick} tickFormatter={tokenAxisFormatter} />
                                <RTooltip {...tooltipStyle} formatter={tokenBarFormatter} />
                                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                    {tokenTypeData.map(d => (
                                        <Cell key={d.label} fill={TOKEN_TYPE_COLORS[d.label]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartCard>
                )}

                {hasTokenData && (
                        <Paper elevation={1} sx={{ p: 2 }} data-testid="token-cost-leaderboard">
                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                                Biggest-Cost Sessions
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                                Top {Math.min(TOP_COST_LIMIT, stats.topCostSessions.length)} sessions by total token cost
                            </Typography>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Session</TableCell>
                                            <TableCell align="right">Token Cost</TableCell>
                                            <TableCell align="right">Duration</TableCell>
                                            <TableCell align="right">Tokens / sec</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {stats.topCostSessions.map(s => (
                                            <TableRow key={s.id} hover sx={{ cursor: 'pointer' }}
                                                      onClick={() => navigate(`/swarm/session/${s.id}`)}
                                                      data-testid={`token-cost-row-${s.id}`}>
                                                <TableCell>
                                                    <Typography component="span" variant="body2"
                                                                sx={{ color: 'text.secondary', mr: 1 }}>#{s.id}</Typography>
                                                    <Typography component="span" variant="body2">{s.label}</Typography>
                                                </TableCell>
                                                <TableCell align="right">{formatTokens(s.tokens)}</TableCell>
                                                <TableCell align="right">{formatDuration(s.durationSecs)}</TableCell>
                                                <TableCell align="right">
                                                    {s.durationSecs > 0 ? formatTokensPerSec(s.tokens / s.durationSecs) : '—'}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                )}
            </Stack>
        </Box>
    );
}
