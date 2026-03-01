import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useShowClosedStore = create(
    persist(
        (set) => ({
            showClosedPriorities: false,
            showClosedSessions: false,

            toggleShowClosedPriorities: () =>
                set((state) => ({ showClosedPriorities: !state.showClosedPriorities })),

            toggleShowClosedSessions: () =>
                set((state) => ({ showClosedSessions: !state.showClosedSessions })),
        }),
        {
            name: 'darwin_show_closed',
        }
    )
);
