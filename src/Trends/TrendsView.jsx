import React, { useMemo, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import {
    ResponsiveContainer, BarChart, LineChart, Bar, Line,
    XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

import { useTrendsStore } from '../stores/useTrendsStore';
import { aggregateTrends, bucketDateRange } from '../utils/aggregateTrends';

const METRIC_LABELS = {
    distance: 'Miles',
    time: 'Hours',
    elevation: 'Feet',
    count: 'Activities',
};

const DRILL_DOWN = { yearly: 'monthly', monthly: 'weekly', weekly: 'weekly' };

const TrendsView = ({ runs: viewFilteredRuns = [], isLoading = false, onBucketClick }) => {
    const {
        metric, timeframe, chartType, timeFilter,
        selectedRouteIds,
    } = useTrendsStore();

    const allRuns = viewFilteredRuns;

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

    const unitLabel = METRIC_LABELS[metric];
    const displayTimeframe = timeFilter ? effectiveTimeframe : timeframe;
    const needsRotation = displayTimeframe !== 'yearly';

    const Chart = chartType === 'bar' ? BarChart : LineChart;

    return (
        <Box sx={{ mt: 1 }}>
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
