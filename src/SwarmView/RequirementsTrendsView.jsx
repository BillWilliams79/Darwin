// Requirements Trends view (req #2812) — the fourth Requirements view alongside
// Cards / Table / Visualizer. Charts requirements *closed* over time (per day /
// week / month) as bar or line charts, with an optional per-category split,
// category selector chips, a cumulative toggle, and a time-range window.
//
// "Met" = a requirement with requirement_status === 'met' (req #2850 — `wontfix`
// is excluded even though it also stamps completed_at). The heavy lifting lives in
// the pure, unit-tested aggregator `aggregateRequirementTrends`; this component is
// presentational over it, mirroring the recharts styling of SwarmCompletesStatsView
// (req #2794).

import React, { useContext, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import {
    ResponsiveContainer, BarChart, Bar, LineChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from 'recharts';

import AuthContext from '../Context/AuthContext';
import { useAllRequirements, useAllCategories } from '../hooks/useDataQueries';
import { aggregateRequirementTrends } from '../utils/aggregateRequirementTrends';
import { useRequirementDrillStore } from '../stores/useRequirementDrillStore';

const TRENDS_WIDTH = 1200;

const FIELDS = 'id,requirement_status,category_fk,completed_at';

const TIMEFRAMES = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
];

const RANGES = [
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
    { label: '1Y', days: 365 },
    { label: 'All', days: null },
];
const DEFAULT_RANGE = 'All';

// Rotating fallback palette for categories without a stored color, so every
// series renders a distinct hue rather than collapsing to one default.
const FALLBACK_PALETTE = [
    '#7E57C2', '#E91E63', '#ffca28', '#66bb6a', '#42a5f5',
    '#ff7043', '#26c6da', '#ab47bc', '#9ccc65', '#ec407a',
];
const TOTAL_COLOR = '#E91E63';

// Stable empty-array sentinel so the "show closed categories" path passes a
// reference-stable value to the aggregator memos (req #2821).
const NO_EXCLUDE = [];

// The chart sits on a warm parchment panel (not the app's dark background) so
// saturated category colours — especially the blues/teals (Mapping, Topology)
// — read clearly. The tooltip uses the same light family so the colour swatches
// in a multi-series hover have something to contrast against too.
const CHART_BG = '#e8dfc8';
const tooltipStyle = {
    contentStyle: {
        backgroundColor: '#f3ecda',
        border: '1px solid rgba(60,50,30,0.25)',
        color: '#2a2723',
        borderRadius: 4,
    },
    labelStyle: { color: '#2a2723', fontWeight: 600 },
};
// Axis ticks + grid tuned for the light parchment panel (dark ink, faint grid).
const axisTick = { fill: '#5a5238', fontSize: 12 };
const axisLabelStyle = { fill: '#5a5238', fontSize: 13 };
const grid = <CartesianGrid strokeDasharray="3 3" stroke="rgba(60,50,30,0.18)" />;

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

const RequirementsTrendsView = ({ onDrillToTable }) => {
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const setDrill = useRequirementDrillStore(s => s.setDrill);

    const { data: requirements = [], isLoading: reqLoading } =
        useAllRequirements(creatorFk, { fields: FIELDS });
    // Fetch ALL categories (open + closed): requirements are fetched unfiltered,
    // so met requirements in a closed category (e.g. 968 Solar) need their name to
    // resolve. The aggregator only renders categories that have requirements, so
    // including closed ones adds no empty series — it just supplies the label (req #2820).
    const { data: categories = [], isLoading: catLoading } =
        useAllCategories(creatorFk, { fields: 'id,category_name,color,sort_order,closed' });

    const [timeframe, setTimeframe] = useState('week');
    const [chartType, setChartType] = useState('line');
    const [split, setSplit] = useState(true);
    const [cumulative, setCumulative] = useState(false);
    // Requirements in closed categories are hidden by default; the rightmost
    // toggle unhides them (req #2821).
    const [showClosedCategories, setShowClosedCategories] = useState(false);
    const [rangeLabel, setRangeLabel] = useState(DEFAULT_RANGE);
    // null = no manual category filter (all categories included).
    const [selectedCatIds, setSelectedCatIds] = useState(null);

    const rangeDays = RANGES.find(r => r.label === rangeLabel)?.days ?? null;

    // Category ids flagged closed (category.closed = 1). When the toggle is off
    // (default), their requirements are excluded from the chart, chips and KPIs.
    const closedCategoryIds = useMemo(
        () => categories.filter(c => c.closed).map(c => c.id),
        [categories]
    );
    const hasClosedCategories = closedCategoryIds.length > 0;
    const excludeCategoryIds = showClosedCategories ? NO_EXCLUDE : closedCategoryIds;

    // Toggling closed categories changes the set of available chips, so any manual
    // category selection is reset to "all" to avoid stale ids leaking into the
    // chip "collapse back to all" math (req #2821 review fix).
    const toggleShowClosedCategories = () => {
        setShowClosedCategories(s => !s);
        setSelectedCatIds(null);
    };

    const { data, categories: activeCategories, kpis } = useMemo(
        () => aggregateRequirementTrends(requirements, categories, {
            timeframe,
            selectedCategoryIds: selectedCatIds || [],
            excludeCategoryIds,
            rangeDays,
            cumulative,
        }),
        [requirements, categories, timeframe, selectedCatIds, excludeCategoryIds, rangeDays, cumulative]
    );

    // Categories available to filter on = every category that has at least one
    // closed requirement (ignoring the current selection, so chips never vanish).
    // Closed-category chips disappear in lockstep with the toggle.
    const allClosedCategories = useMemo(
        () => aggregateRequirementTrends(requirements, categories,
            { timeframe: 'month', excludeCategoryIds }).categories,
        [requirements, categories, excludeCategoryIds]
    );

    // Stable color per category id, derived once from the full category list.
    // Both the selector chips and the chart series read from this map so a
    // category's chip color always matches its bar/line — even when colors fall
    // back to the rotating palette and the visible series subset differs from
    // the full chip list (req #2812 review fix).
    const colorById = useMemo(() => {
        const m = new Map();
        allClosedCategories.forEach((c, idx) => {
            m.set(c.id, c.color || FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length]);
        });
        return m;
    }, [allClosedCategories]);

    const colorForCategory = (cat, idx) =>
        colorById.get(cat.id) || cat.color || FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];

    const toggleCategory = (id) => {
        setSelectedCatIds(prev => {
            const base = prev || allClosedCategories.map(c => c.id);
            const next = base.includes(id) ? base.filter(x => x !== id) : [...base, id];
            // Empty selection or full selection both collapse back to "all".
            if (next.length === 0 || next.length === allClosedCategories.length) return null;
            return next;
        });
    };

    const isCatSelected = (id) => selectedCatIds === null || selectedCatIds.includes(id);

    // Click-to-zoom (req #2850): clicking a bar/segment (or a line's active dot)
    // records the clicked time bucket — plus the category when the chart is split —
    // and asks the parent to switch to the Table view, which renders a dismissible
    // pill and filters to exactly those Met requirements. Recharts hands the data
    // point as `{ payload: <bucket row> }`; `payload.key` is the aggregator bucket
    // key the Table matches against. No-op without a parent handler or payload.
    const handleSegmentClick = (data, category = null) => {
        const payload = data?.payload;
        if (!onDrillToTable || !payload?.key) return;

        // Which categories the clicked bar/point actually represented — so the Table
        // reproduces the SAME subset (req #2850). Priority:
        //  1. A split-segment click pins that single category.
        //  2. A total-bar click while the chip selector is narrowed to a subset
        //     (selectedCatIds) carries that subset — the bar's height already
        //     reflected only those categories, so the table must too. (The bug where
        //     narrowing to "Swarm" then clicking a bar showed every category.)
        //  3. Otherwise null = all visible categories (subject to includeClosed).
        let categoryIds = null;
        let categoryName = null;
        if (category) {
            categoryIds = [category.id];
            categoryName = category.name;
        } else if (selectedCatIds && selectedCatIds.length > 0) {
            categoryIds = [...selectedCatIds];
            if (selectedCatIds.length === 1) {
                const only = allClosedCategories.find(c => c.id === selectedCatIds[0]);
                categoryName = only ? only.name : null;
            } else {
                categoryName = `${selectedCatIds.length} categories`;
            }
        }

        setDrill({
            bucketKey: payload.key,
            timeframe,
            label: payload.label,
            categoryIds,
            categoryName,
            // Whether closed-category requirements were visible in the clicked
            // chart, so the Table can reproduce the same row set (req #2850).
            includeClosed: showClosedCategories,
        });
        onDrillToTable();
    };

    // A <Line>'s activeDot onClick receives its args in a recharts-version-dependent
    // order — the object carrying the data row on `.payload` is not reliably the
    // third argument (req #2850 review fix). Find whichever arg carries it.
    const handleDotClick = (category, ...args) => {
        const dot = args.find(a => a && a.payload && a.payload.key);
        if (dot) handleSegmentClick(dot, category);
    };

    if (reqLoading || catLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    const hasData = data.some(d => d.total > 0) || kpis.totalClosed > 0;

    const Chart = chartType === 'bar' ? BarChart : LineChart;
    const countSuffix = cumulative ? ' total' : '';
    const metricLabel = cumulative ? 'Cumulative Met' : 'Met';

    // Day/Week buckets rotate their x-axis labels -45°. We render the category
    // legend as our OWN DOM row beneath the chart (not recharts' built-in
    // <Legend>, which shares the bottom band with the rotated axis labels and
    // overlapped them no matter the margin — req #2812 review feedback). With a
    // separate legend row, overlap is structurally impossible; the chart only
    // needs enough bottom margin for the rotated tick labels themselves.
    const needsRotation = timeframe !== 'month';
    const bottomMargin = needsRotation ? 60 : 20;
    const chartHeight = 440 + (needsRotation ? 40 : 0);

    return (
        <Box sx={{ px: 3, pt: 1, pb: 4, maxWidth: TRENDS_WIDTH }} data-testid="requirements-trends-view">
            {/* Controls */}
            <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap"
                   sx={{ alignItems: 'center', mb: 2 }}
                   data-testid="requirements-trends-controls">
                <ToggleButtonGroup value={timeframe} exclusive size="small"
                                   onChange={(_e, v) => { if (v) setTimeframe(v); }}
                                   data-testid="trends-timeframe-toggle">
                    {TIMEFRAMES.map(t => (
                        <ToggleButton key={t.value} value={t.value} sx={{ px: 1.5 }}
                                      data-testid={`trends-timeframe-${t.value}`}>
                            {t.label}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>

                <ToggleButtonGroup value={chartType} exclusive size="small"
                                   onChange={(_e, v) => { if (v) setChartType(v); }}
                                   data-testid="trends-charttype-toggle">
                    <ToggleButton value="bar" sx={{ px: 1.5 }} data-testid="trends-charttype-bar">Bar</ToggleButton>
                    <ToggleButton value="line" sx={{ px: 1.5 }} data-testid="trends-charttype-line">Line</ToggleButton>
                </ToggleButtonGroup>

                <ToggleButtonGroup value={rangeLabel} exclusive size="small"
                                   onChange={(_e, v) => { if (v) setRangeLabel(v); }}
                                   data-testid="trends-range-toggle">
                    {RANGES.map(r => (
                        <ToggleButton key={r.label} value={r.label} sx={{ px: 1.25 }}
                                      data-testid={`trends-range-${r.label}`}>
                            {r.label}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>

                <Tooltip title="Split the series by category">
                    <Chip label="Split by category"
                          size="small"
                          color={split ? 'primary' : 'default'}
                          variant={split ? 'filled' : 'outlined'}
                          onClick={() => setSplit(s => !s)}
                          sx={{ cursor: 'pointer' }}
                          data-testid="trends-split-toggle" />
                </Tooltip>

                <Tooltip title="Show a running cumulative total">
                    <Chip label="Cumulative"
                          size="small"
                          color={cumulative ? 'primary' : 'default'}
                          variant={cumulative ? 'filled' : 'outlined'}
                          onClick={() => setCumulative(c => !c)}
                          sx={{ cursor: 'pointer' }}
                          data-testid="trends-cumulative-toggle" />
                </Tooltip>

                {hasClosedCategories && (
                    <Tooltip title="Include requirements from closed categories">
                        <Chip label="Closed categories"
                              size="small"
                              color={showClosedCategories ? 'primary' : 'default'}
                              variant={showClosedCategories ? 'filled' : 'outlined'}
                              onClick={toggleShowClosedCategories}
                              sx={{ cursor: 'pointer' }}
                              data-testid="trends-show-closed-toggle" />
                    </Tooltip>
                )}
            </Stack>

            {/* Category selector chips */}
            {allClosedCategories.length > 0 && (
                <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap"
                       sx={{ mb: 2 }} data-testid="trends-category-chips">
                    {allClosedCategories.map((c, idx) => {
                        const selected = isCatSelected(c.id);
                        const color = colorForCategory(c, idx);
                        return (
                            <Chip key={c.id}
                                  label={c.name}
                                  size="small"
                                  onClick={() => toggleCategory(c.id)}
                                  variant={selected ? 'filled' : 'outlined'}
                                  sx={{
                                      cursor: 'pointer',
                                      ...(selected
                                          ? { bgcolor: color, color: '#fff', borderColor: color }
                                          : { borderColor: color, color, opacity: 0.7 }),
                                  }}
                                  data-testid={`trends-category-chip-${c.id}`} />
                        );
                    })}
                </Stack>
            )}

            {/* Chart — on a light parchment panel so colours read clearly. */}
            <Paper elevation={1} sx={{ p: 2 }} data-testid="requirements-trends-chart-card">
                {!hasData ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 360 }}>
                        <Typography color="text.secondary">
                            No met requirements yet for this selection.
                        </Typography>
                    </Box>
                ) : (
                    <Box sx={{ backgroundColor: CHART_BG, borderRadius: 1, p: 1.5,
                               '& svg': { outline: 'none' }, '& svg *': { outline: 'none' } }}>
                        <ResponsiveContainer width="100%" height={chartHeight}>
                            <Chart data={data}
                                   margin={{ top: 10, right: 30, left: 10, bottom: bottomMargin }}>
                                {grid}
                                <XAxis dataKey="label"
                                       tick={axisTick}
                                       angle={needsRotation ? -45 : 0}
                                       textAnchor={needsRotation ? 'end' : 'middle'}
                                       interval={timeframe === 'day'
                                           ? Math.max(0, Math.floor(data.length / 25))
                                           : 0} />
                                <YAxis allowDecimals={false}
                                       tick={axisTick}
                                       label={{ value: metricLabel,
                                                angle: -90, position: 'insideLeft',
                                                style: axisLabelStyle }} />
                                <RTooltip {...tooltipStyle} />

                                {split ? (
                                    activeCategories.map((c, idx) => {
                                        const color = colorForCategory(c, idx);
                                        return chartType === 'bar' ? (
                                            <Bar key={c.id} dataKey={`cat_${c.id}`} name={c.name}
                                                 stackId="cats" fill={color}
                                                 cursor="pointer"
                                                 onClick={(d) => handleSegmentClick(d, c)}
                                                 radius={idx === activeCategories.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                                        ) : (
                                            <Line key={c.id} type="monotone" dataKey={`cat_${c.id}`} name={c.name}
                                                  stroke={color} strokeWidth={2}
                                                  dot={{ fill: color, r: 2 }}
                                                  activeDot={{ r: 5, cursor: 'pointer',
                                                              onClick: (...args) => handleDotClick(c, ...args) }} />
                                        );
                                    })
                                ) : (
                                    chartType === 'bar' ? (
                                        <Bar dataKey="total" name={`Met${countSuffix}`}
                                             fill={TOTAL_COLOR} radius={[4, 4, 0, 0]}
                                             cursor="pointer"
                                             onClick={(d) => handleSegmentClick(d)} />
                                    ) : (
                                        <Line type="monotone" dataKey="total" name={`Met${countSuffix}`}
                                              stroke={TOTAL_COLOR} strokeWidth={2}
                                              dot={{ fill: TOTAL_COLOR, r: 3 }}
                                              activeDot={{ r: 5, cursor: 'pointer',
                                                          onClick: (...args) => handleDotClick(null, ...args) }} />
                                    )
                                )}
                            </Chart>
                        </ResponsiveContainer>

                        {/* Custom legend row — its own DOM lane beneath the
                            chart so it can never overlap the rotated x-axis
                            labels (req #2812 review feedback). */}
                        {split && activeCategories.length > 0 && (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
                                       gap: 1.5, mt: 1, px: 1 }}
                                 data-testid="trends-chart-legend">
                                {activeCategories.map((c, idx) => (
                                    <Box key={c.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Box sx={{ width: 12, height: 12, borderRadius: '2px',
                                                   backgroundColor: colorForCategory(c, idx), flexShrink: 0 }} />
                                        <Typography variant="caption" sx={{ color: '#3a352e', fontSize: 12 }}>
                                            {c.name}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        )}
                    </Box>
                )}
            </Paper>

            {/* KPI strip — moved below the chart and fully windowed by the range
                selector (7d/30d/…). Every figure reflects the active window so
                the selectors drive the headline numbers too (req #2812). */}
            <Box sx={{ display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                        gap: 2, mt: 2 }}
                 data-testid="requirements-trends-kpis">
                <KpiCard label={rangeLabel === 'All' ? 'Met (All time)' : `Met (${rangeLabel})`}
                         value={kpis.closedInRange.toLocaleString()} />
                <KpiCard label={`Avg per ${timeframe}`}
                         value={kpis.avgPerBucket ? kpis.avgPerBucket.toFixed(1) : '—'} />
                <KpiCard label={`Busiest ${timeframe}`}
                         value={kpis.busiest ? kpis.busiest.count.toLocaleString() : '—'}
                         hint={kpis.busiest ? kpis.busiest.label : undefined} />
                <KpiCard label="Top Category"
                         value={kpis.topCategory ? kpis.topCategory.count.toLocaleString() : '—'}
                         hint={kpis.topCategory ? kpis.topCategory.name : undefined} />
            </Box>
        </Box>
    );
};

export default RequirementsTrendsView;
