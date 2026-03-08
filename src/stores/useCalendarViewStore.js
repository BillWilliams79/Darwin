import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useCalendarViewStore = create(
    persist(
        (set) => ({
            viewType: 'dayGridMonth',
            currentDate: null,
            mode: 'tasks',

            setCalendarView: ({ viewType, currentDate }) =>
                set({ viewType, currentDate }),

            setMode: (mode) =>
                set({ mode }),
        }),
        {
            name: 'darwin_calendar_view',
        }
    )
);
