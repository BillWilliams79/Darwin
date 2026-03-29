import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useTrendsStore = create(
    persist(
        (set) => ({
            metric: 'distance',
            timeframe: 'monthly',
            chartType: 'bar',
            timeFilter: null, // { label, start: Date, end: Date, sourceTimeframe } — not persisted
            selectedRouteIds: [], // route IDs to filter by — not persisted

            setMetric: (metric) => set({ metric }),
            setTimeframe: (timeframe) => set({ timeframe }),
            setChartType: (chartType) => set({ chartType }),
            setTimeFilter: (timeFilter) => set({ timeFilter }),
            setSelectedRouteIds: (selectedRouteIds) => set({ selectedRouteIds }),
        }),
        {
            name: 'darwin_trends_view',
            partialize: (state) => ({
                metric: state.metric,
                timeframe: state.timeframe,
                chartType: state.chartType,
            }),
        }
    )
);
