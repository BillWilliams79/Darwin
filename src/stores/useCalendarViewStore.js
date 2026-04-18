import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { currentPeriodStart } from '../utils/dateFormat';

export const useCalendarViewStore = create(
    persist(
        (set, get) => ({
            viewType: 'dayGridMonth',
            currentDate: new Date().toISOString().slice(0, 10),
            mode: ['tasks', 'activities', 'requirements'],
            summaryMode: null,   // null | 'week' | 'month'
            summaryDate: null,   // YYYY-MM-DD start of viewed period

            timeSeriesMode: null,          // null | 'day'
            timeSeriesGranularity: '24h',  // '24h' | '4h' | '8h' | 'ampm'
            timeSeriesChipMode: 'title',   // 'id' | 'title'
            timeSeriesLaneMode: 'none',    // 'none' | 'category'
            timeSeriesView: 'rail',        // 'rail' | 'river' | 'density' | 'bead'
            timeSeriesShowAll: false,      // when true, overrides row cap so every chip renders
            timeSeriesBeadWindow: '36h',   // '24h' | '36h' — bead necklace only

            setCalendarView: ({ viewType, currentDate }) =>
                set({ viewType, currentDate }),

            setMode: (mode) =>
                set({ mode }),

            setSummaryMode: (mode) =>
                set({
                    summaryMode: mode,
                    summaryDate: mode ? currentPeriodStart(mode) : null,
                    timeSeriesMode: mode ? null : get().timeSeriesMode,
                }),

            setSummaryDate: (date) =>
                set({ summaryDate: date }),

            setTimeSeriesMode: (mode) =>
                set({
                    timeSeriesMode: mode,
                    summaryMode: mode ? null : get().summaryMode,
                    summaryDate: mode ? null : get().summaryDate,
                }),

            setTimeSeriesGranularity: (granularity) =>
                set({ timeSeriesGranularity: granularity }),

            setTimeSeriesChipMode: (chipMode) =>
                set({ timeSeriesChipMode: chipMode }),

            setTimeSeriesLaneMode: (laneMode) =>
                set({ timeSeriesLaneMode: laneMode }),

            setTimeSeriesView: (view) =>
                set({ timeSeriesView: view }),

            setTimeSeriesShowAll: (showAll) =>
                set({ timeSeriesShowAll: !!showAll }),

            setTimeSeriesBeadWindow: (win) =>
                set({ timeSeriesBeadWindow: win }),
        }),
        {
            name: 'darwin_calendar_view',
            version: 4,
            migrate: (persisted, version) => {
                if (version === 0) {
                    return {
                        ...persisted,
                        mode: typeof persisted.mode === 'string'
                            ? [persisted.mode]
                            : persisted.mode || ['tasks', 'activities', 'requirements'],
                        summaryMode: null,
                        summaryDate: null,
                        timeSeriesMode: null,
                        timeSeriesGranularity: '24h',
                        timeSeriesChipMode: 'title',
                        timeSeriesLaneMode: 'none',
                        timeSeriesView: 'rail',
                        timeSeriesShowAll: false,
                        timeSeriesBeadWindow: '36h',
                    };
                }
                if (version === 1) {
                    return {
                        ...persisted,
                        summaryMode: null,
                        summaryDate: null,
                        timeSeriesMode: null,
                        timeSeriesGranularity: '24h',
                        timeSeriesChipMode: 'title',
                        timeSeriesLaneMode: 'none',
                        timeSeriesView: 'rail',
                        timeSeriesShowAll: false,
                        timeSeriesBeadWindow: '36h',
                    };
                }
                if (version === 2) {
                    return {
                        ...persisted,
                        mode: (persisted.mode || []).map(m => m === 'priorities' ? 'requirements' : m),
                        timeSeriesMode: null,
                        timeSeriesGranularity: '24h',
                        timeSeriesChipMode: 'title',
                        timeSeriesLaneMode: 'none',
                        timeSeriesView: 'rail',
                        timeSeriesShowAll: false,
                        timeSeriesBeadWindow: '36h',
                    };
                }
                if (version === 3) {
                    return {
                        ...persisted,
                        timeSeriesMode: null,
                        timeSeriesGranularity: '24h',
                        timeSeriesChipMode: 'title',
                        timeSeriesLaneMode: 'none',
                        timeSeriesView: 'rail',
                        timeSeriesShowAll: false,
                        timeSeriesBeadWindow: '36h',
                    };
                }
                return persisted;
            },
        }
    )
);
