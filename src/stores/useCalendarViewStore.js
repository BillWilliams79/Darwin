import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { currentPeriodStart, localDateStr } from '../utils/dateFormat';

export const useCalendarViewStore = create(
    persist(
        (set) => ({
            viewType: 'dayGridMonth',
            currentDate: localDateStr(),
            mode: ['tasks', 'activities', 'requirements'],
            summaryMode: null,   // null | 'week' | 'month'
            summaryDate: null,   // YYYY-MM-DD start of viewed period

            setCalendarView: ({ viewType, currentDate }) =>
                set({ viewType, currentDate }),

            setMode: (mode) =>
                set({ mode }),

            setSummaryMode: (mode) =>
                set({
                    summaryMode: mode,
                    summaryDate: mode ? currentPeriodStart(mode) : null,
                }),

            setSummaryDate: (date) =>
                set({ summaryDate: date }),
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
                };
                base.mode = base.mode.map(m => m === 'priorities' ? 'requirements' : m);
                // v6 → v7: Swarm Visualizer migrated to /swarm (req #2394); strip
                // obsolete time-series fields. Prior preferences are discarded —
                // the new `useSwarmVisualizerStore` initializes with defaults
                // (day view, bead viz, 24h window, sidewalk off).
                delete base.timeSeriesMode;
                delete base.timeSeriesBeadWindow;
                delete base.timeSeriesVizKey;
                delete base.timeSeriesSidewalkOn;
                // v<6 legacy field cleanup (preserved from prior migrations)
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
