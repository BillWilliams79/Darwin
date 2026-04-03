import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { currentPeriodStart } from '../utils/dateFormat';

export const useCalendarViewStore = create(
    persist(
        (set) => ({
            viewType: 'dayGridMonth',
            currentDate: new Date().toISOString().slice(0, 10),
            mode: ['tasks', 'activities', 'priorities'],
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
            version: 2,
            migrate: (persisted, version) => {
                if (version === 0) {
                    return {
                        ...persisted,
                        mode: typeof persisted.mode === 'string'
                            ? [persisted.mode]
                            : persisted.mode || ['tasks', 'activities', 'priorities'],
                        summaryMode: null,
                        summaryDate: null,
                    };
                }
                if (version === 1) {
                    return {
                        ...persisted,
                        summaryMode: null,
                        summaryDate: null,
                    };
                }
                return persisted;
            },
        }
    )
);
