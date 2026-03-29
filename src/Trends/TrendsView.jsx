import React, { useContext, useMemo, useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Button from '@mui/material/Button';
import Popover from '@mui/material/Popover';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Checkbox from '@mui/material/Checkbox';
import BarChartIcon from '@mui/icons-material/BarChart';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import RouteIcon from '@mui/icons-material/Route';
import {
    ResponsiveContainer, BarChart, LineChart, Bar, Line,
    XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

import AuthContext from '../Context/AuthContext';
import { useMapRuns, useMapRoutes } from '../hooks/useDataQueries';
import { useTrendsStore } from '../stores/useTrendsStore';
import { aggregateTrends, bucketDateRange } from '../utils/aggregateTrends';

const METRIC_LABELS = {
    distance: 'Miles',
    time: 'Hours',
    elevation: 'Feet',
    count: 'Activities',
};

const DRILL_DOWN = { yearly: 'monthly', monthly: 'weekly', weekly: 'weekly' };

const TrendsView = ({ onBucketClick }) => {
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.id;

    const {
        metric, timeframe, chartType, timeFilter,
        selectedRouteIds,
        setMetric, setTimeframe, setChartType, setSelectedRouteIds,
    } = useTrendsStore();

    const { data: allRuns = [], isLoading } = useMapRuns(creatorFk);
    const { data: routes = [] } = useMapRoutes(creatorFk);

    // Determine effective timeframe: drill down when filtered
    const effectiveTimeframe = timeFilter
        ? DRILL_DOWN[timeFilter.sourceTimeframe] || timeframe
        : timeframe;

    // Filter runs by timeFilter and selectedRouteIds
    const filteredRuns = useMemo(() => {
        let runs = allRuns;
        if (timeFilter) {
            runs = runs.filter(run => {
                const t = new Date(run.start_time.endsWith?.('Z') ? run.start_time : run.start_time + 'Z');
                return t >= timeFilter.start && t < timeFilter.end;
            });
        }
        if (selectedRouteIds.length > 0) {
            const idSet = new Set(selectedRouteIds);
            runs = runs.filter(run => idSet.has(run.map_route_fk));
        }
        return runs;
    }, [allRuns, timeFilter, selectedRouteIds]);

    const chartData = useMemo(
        () => aggregateTrends(filteredRuns, metric, effectiveTimeframe),
        [filteredRuns, metric, effectiveTimeframe]
    );

    // Route picker state
    const [routeAnchor, setRouteAnchor] = useState(null);
    const [pendingRouteIds, setPendingRouteIds] = useState([]);

    // Count activities per route (respects time filter but not route filter)
    const routeCountMap = useMemo(() => {
        const source = timeFilter
            ? allRuns.filter(run => {
                const t = new Date(run.start_time.endsWith?.('Z') ? run.start_time : run.start_time + 'Z');
                return t >= timeFilter.start && t < timeFilter.end;
            })
            : allRuns;
        const counts = new Map();
        for (const run of source) {
            counts.set(run.map_route_fk, (counts.get(run.map_route_fk) || 0) + 1);
        }
        return counts;
    }, [allRuns, timeFilter]);

    const routeOptions = useMemo(() => {
        return [...routes]
            .filter(r => (routeCountMap.get(r.id) || 0) > 0)
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [routes, routeCountMap]);

    const handleOpenRoutes = (e) => {
        setPendingRouteIds([...selectedRouteIds]);
        setRouteAnchor(e.currentTarget);
    };

    const handleToggleRoute = (id) => {
        setPendingRouteIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const handleApplyRoutes = () => {
        setSelectedRouteIds(pendingRouteIds);
        setRouteAnchor(null);
    };

    const routeButtonLabel = selectedRouteIds.length === 0
        ? 'Routes'
        : `Routes (${selectedRouteIds.length})`;

    const handleElementClick = useCallback((data) => {
        if (!onBucketClick || !data?.payload) return;
        const point = data.payload;
        const { start, end } = bucketDateRange(point.key, effectiveTimeframe);
        onBucketClick({ label: point.label, start, end, sourceTimeframe: effectiveTimeframe });
    }, [onBucketClick, effectiveTimeframe]);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (allRuns.length === 0) {
        return (
            <Box sx={{ mt: 4, px: 2 }}>
                <Typography color="text.secondary">
                    No activities found. Import data via Maps &gt; Import.
                </Typography>
            </Box>
        );
    }

    const handleMetric = (e, val) => { if (val !== null) setMetric(val); };
    const handleTimeframe = (e, val) => { if (val !== null) setTimeframe(val); };
    const handleChartType = (e, val) => { if (val !== null) setChartType(val); };

    const unitLabel = METRIC_LABELS[metric];
    const displayTimeframe = timeFilter ? effectiveTimeframe : timeframe;
    const needsRotation = displayTimeframe !== 'yearly';

    const Chart = chartType === 'bar' ? BarChart : LineChart;

    return (
        <Box sx={{ mt: 1 }}>
            {/* Controls row */}
            <Box sx={{
                display: 'flex', alignItems: 'center', gap: 2, mb: 2, px: 2,
                flexWrap: 'wrap',
            }}>
                <ToggleButtonGroup value={metric} exclusive onChange={handleMetric} size="small">
                    <ToggleButton value="distance" data-testid="metric-toggle-distance">Distance</ToggleButton>
                    <ToggleButton value="time" data-testid="metric-toggle-time">Time</ToggleButton>
                    <ToggleButton value="elevation" data-testid="metric-toggle-elevation">Elevation</ToggleButton>
                    <ToggleButton value="count" data-testid="metric-toggle-count">Count</ToggleButton>
                </ToggleButtonGroup>

                <Box sx={{ width: 16 }} />

                <ToggleButtonGroup
                    value={timeFilter ? effectiveTimeframe : timeframe}
                    exclusive
                    onChange={handleTimeframe}
                    size="small"
                    disabled={!!timeFilter}
                >
                    <ToggleButton value="yearly" data-testid="timeframe-toggle-yearly">Yearly</ToggleButton>
                    <ToggleButton value="monthly" data-testid="timeframe-toggle-monthly">Monthly</ToggleButton>
                    <ToggleButton value="weekly" data-testid="timeframe-toggle-weekly">Weekly</ToggleButton>
                </ToggleButtonGroup>

                <Box sx={{ width: 16 }} />

                <Button
                    variant="outlined"
                    size="small"
                    startIcon={<RouteIcon />}
                    onClick={handleOpenRoutes}
                    data-testid="route-filter-button"
                    sx={selectedRouteIds.length > 0 ? { borderColor: '#E91E63', color: '#E91E63' } : {}}
                >
                    {routeButtonLabel}
                </Button>
                <Popover
                    open={Boolean(routeAnchor)}
                    anchorEl={routeAnchor}
                    onClose={() => setRouteAnchor(null)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                >
                    <Box sx={{ width: 300, display: 'flex', flexDirection: 'column', maxHeight: 400 }}>
                        <List dense sx={{ overflow: 'auto', flex: 1 }}>
                            {routeOptions.map(route => (
                                <ListItemButton
                                    key={route.id}
                                    onClick={() => handleToggleRoute(route.id)}
                                    dense
                                >
                                    <Checkbox
                                        edge="start"
                                        checked={pendingRouteIds.includes(route.id)}
                                        tabIndex={-1}
                                        disableRipple
                                        size="small"
                                    />
                                    <ListItemText
                                        primary={route.name}
                                        secondary={`${routeCountMap.get(route.id) || 0} activities`}
                                    />
                                </ListItemButton>
                            ))}
                        </List>
                        <Box sx={{ p: 1, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                            <Button size="small" onClick={() => { setPendingRouteIds([]); setSelectedRouteIds([]); setRouteAnchor(null); }}>
                                Clear
                            </Button>
                            <Button size="small" variant="contained" onClick={handleApplyRoutes}>
                                Apply
                            </Button>
                        </Box>
                    </Box>
                </Popover>

                <Box sx={{ width: 16 }} />

                <ToggleButtonGroup value={chartType} exclusive onChange={handleChartType} size="small">
                    <ToggleButton value="bar" data-testid="chart-type-toggle-bar">
                        <BarChartIcon fontSize="small" />
                    </ToggleButton>
                    <ToggleButton value="line" data-testid="chart-type-toggle-line">
                        <ShowChartIcon fontSize="small" />
                    </ToggleButton>
                </ToggleButtonGroup>
            </Box>

            {/* Chart */}
            <Box sx={{ px: 2, userSelect: 'none', '& svg': { outline: 'none' }, '& svg *': { outline: 'none' } }} data-testid="trends-chart">
                <ResponsiveContainer width="100%" height={500}>
                    <Chart
                        data={chartData}
                        margin={{ top: 10, right: 30, left: 10, bottom: needsRotation ? 60 : 20 }}
                        style={{ cursor: 'pointer' }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis
                            dataKey="label"
                            tick={{ fill: '#9a9186', fontSize: 12 }}
                            angle={needsRotation ? -45 : 0}
                            textAnchor={needsRotation ? 'end' : 'middle'}
                            interval={displayTimeframe === 'weekly' ? Math.max(0, Math.floor(chartData.length / 20)) : 0}
                        />
                        <YAxis
                            tick={{ fill: '#9a9186', fontSize: 12 }}
                            label={{
                                value: unitLabel,
                                angle: -90,
                                position: 'insideLeft',
                                style: { fill: '#9a9186', fontSize: 13 },
                            }}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: '#2a2723',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: '#e8e1d5',
                                borderRadius: 4,
                            }}
                            formatter={(value) => [`${value} ${unitLabel}`, '']}
                            labelStyle={{ color: '#e8e1d5' }}
                        />
                        {chartType === 'bar' ? (
                            <Bar
                                dataKey="value"
                                fill="#E91E63"
                                radius={[4, 4, 0, 0]}
                                cursor="pointer"
                                onClick={handleElementClick}
                            />
                        ) : (
                            <Line
                                dataKey="value"
                                stroke="#E91E63"
                                strokeWidth={2}
                                dot={{ fill: '#E91E63', r: 3 }}
                                activeDot={{ r: 5, cursor: 'pointer', onClick: (_, __, data) => handleElementClick(data) }}
                            />
                        )}
                    </Chart>
                </ResponsiveContainer>
            </Box>
        </Box>
    );
};

export default TrendsView;
