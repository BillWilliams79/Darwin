import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Custom storage that handles Date serialization for timeFilter
const dateAwareStorage = {
    getItem: (name) => {
        const raw = localStorage.getItem(name);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Rehydrate timeFilter dates from ISO strings
        if (parsed?.state?.timeFilter) {
            parsed.state.timeFilter.start = new Date(parsed.state.timeFilter.start);
            parsed.state.timeFilter.end = new Date(parsed.state.timeFilter.end);
        }
        return parsed;
    },
    setItem: (name, value) => localStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localStorage.removeItem(name),
};

export const useTrendsStore = create(
    persist(
        (set) => ({
            metric: 'distance',
            timeframe: 'yearly',
            chartType: 'bar',
            timeFilter: null, // { label, start: Date, end: Date, sourceTimeframe }
            selectedRouteIds: [],

            setMetric: (metric) => set({ metric }),
            setTimeframe: (timeframe) => set({ timeframe }),
            setChartType: (chartType) => set({ chartType }),
            setTimeFilter: (timeFilter) => set({ timeFilter }),
            setSelectedRouteIds: (selectedRouteIds) => set({ selectedRouteIds }),
        }),
        {
            name: 'darwin_trends_view',
            storage: dateAwareStorage,
        }
    )
);
