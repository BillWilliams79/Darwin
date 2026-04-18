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
            timeSeriesBeadWindow: '24h',   // '24h' | '36h'

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
        }),
        {
            name: 'darwin_calendar_view',
            version: 5,
            migrate: (persisted, version) => {
                const base = {
                    ...persisted,
                    mode: typeof persisted.mode === 'string'
                        ? [persisted.mode]
                        : persisted.mode || ['tasks', 'activities', 'requirements'],
                    summaryMode: persisted.summaryMode ?? null,
                    summaryDate: persisted.summaryDate ?? null,
                    timeSeriesMode: null,            // always reset (bead defaults)
                    timeSeriesBeadWindow: '24h',     // always reset
                };
                // mode value rename from earlier migrations
                base.mode = base.mode.map(m => m === 'priorities' ? 'requirements' : m);
                // Drop obsolete v4 keys (rich UI option set) silently.
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
