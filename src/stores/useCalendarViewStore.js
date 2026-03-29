import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useCalendarViewStore = create(
    persist(
        (set) => ({
            viewType: 'dayGridMonth',
            currentDate: null,
            mode: ['tasks'],

            setCalendarView: ({ viewType, currentDate }) =>
                set({ viewType, currentDate }),

            setMode: (mode) =>
                set({ mode }),
        }),
        {
            name: 'darwin_calendar_view',
            version: 1,
            migrate: (persisted, version) => {
                if (version === 0) {
                    return {
                        ...persisted,
                        mode: typeof persisted.mode === 'string'
                            ? [persisted.mode]
                            : persisted.mode || ['tasks'],
                    };
                }
                return persisted;
            },
        }
    )
);
