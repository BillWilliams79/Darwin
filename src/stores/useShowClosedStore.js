import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const ALL_SESSION_STATUSES = ['starting', 'active', 'paused', 'completing', 'completed'];
export const DEFAULT_SESSION_STATUSES = ['starting', 'active', 'completing'];

export const useShowClosedStore = create(
    persist(
        (set) => ({
            showClosedPriorities: false,
            sessionStatusFilter: DEFAULT_SESSION_STATUSES,

            toggleShowClosedPriorities: () =>
                set((state) => ({ showClosedPriorities: !state.showClosedPriorities })),

            toggleSessionStatus: (status) =>
                set((state) => {
                    const current = state.sessionStatusFilter;
                    if (current.includes(status)) {
                        return { sessionStatusFilter: current.filter(s => s !== status) };
                    }
                    return { sessionStatusFilter: [...current, status] };
                }),
        }),
        {
            name: 'darwin_show_closed',
            version: 2,
            migrate: (persisted, version) => {
                if (version === 0) {
                    const { showClosedSessions, ...rest } = persisted;
                    return {
                        ...rest,
                        sessionStatusFilter: showClosedSessions
                            ? ALL_SESSION_STATUSES
                            : DEFAULT_SESSION_STATUSES,
                    };
                }
                if (version === 1) {
                    return {
                        ...persisted,
                        sessionStatusFilter: DEFAULT_SESSION_STATUSES,
                    };
                }
                return persisted;
            },
        }
    )
);
