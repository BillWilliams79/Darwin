import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { currentPeriodStart, localDateStr } from '../utils/dateFormat';

export const useCalendarViewStore = create(
    persist(
        (set, get) => ({
            viewType: 'dayGridMonth',
            currentDate: localDateStr(),
            mode: ['tasks', 'activities', 'requirements'],
            summaryMode: null,   // null | 'week' | 'month'
            summaryDate: null,   // YYYY-MM-DD start of viewed period

            timeSeriesMode: null,          // null | 'day'
            timeSeriesBeadWindow: '24h',   // '24h' | '36h'
            timeSeriesVizKey: 'bead',      // 'bead' | 'swarm' — controlled by toolbar buttons
            timeSeriesSidewalkOn: false,   // toolbar toggle (horizontal 21-day strip; non-week views)
            timeSeriesElevatorOn: false,   // toolbar toggle (vertical 21-day strip; week view)
            timeSeriesDataKey: 'category', // 'category' | 'coordination' — data-selection toggle (req #2382)

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

            setTimeSeriesBeadWindow: (win) =>
                set({ timeSeriesBeadWindow: win }),

            setTimeSeriesVizKey: (viz) =>
                set({ timeSeriesVizKey: viz }),

            setTimeSeriesSidewalkOn: (on) =>
                set({ timeSeriesSidewalkOn: !!on }),

            setTimeSeriesElevatorOn: (on) =>
                set({ timeSeriesElevatorOn: !!on }),

            setTimeSeriesDataKey: (key) =>
                set({ timeSeriesDataKey: key === 'coordination' ? 'coordination' : 'category' }),
        }),
        {
            name: 'darwin_calendar_view',
            version: 7,
            migrate: (persisted, version) => {
                const base = {
                    ...persisted,
                    mode: typeof persisted.mode === 'string'
                        ? [persisted.mode]
                        : persisted.mode || ['tasks', 'activities', 'requirements'],
                    summaryMode: persisted.summaryMode ?? null,
                    summaryDate: persisted.summaryDate ?? null,
                    timeSeriesMode: null,
                    timeSeriesBeadWindow: '24h',
                    timeSeriesVizKey: 'bead',
                    timeSeriesSidewalkOn: false,
                    timeSeriesElevatorOn: false,
                    timeSeriesDataKey: persisted.timeSeriesDataKey === 'coordination' ? 'coordination' : 'category',
                };
                base.mode = base.mode.map(m => m === 'priorities' ? 'requirements' : m);
                delete base.timeSeriesView;
                delete base.timeSeriesGranularity;
                delete base.timeSeriesChipMode;
                delete base.timeSeriesLaneMode;
                delete base.timeSeriesShowAll;
                return base;
            },
        }
    )
);
