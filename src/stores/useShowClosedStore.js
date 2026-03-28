import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const ALL_SESSION_STATUSES = ['starting', 'active', 'paused', 'completing', 'completed'];
export const DEFAULT_SESSION_STATUSES = ['starting', 'active', 'completing'];

export const ALL_PRIORITY_STATUSES = ['open', 'deferred', 'completed'];
export const DEFAULT_PRIORITY_STATUSES = ['open'];

export const useShowClosedStore = create(
    persist(
        (set) => ({
            priorityStatusFilter: DEFAULT_PRIORITY_STATUSES,
            sessionStatusFilter: DEFAULT_SESSION_STATUSES,

            togglePriorityStatus: (status) =>
                set((state) => {
                    const current = state.priorityStatusFilter;
                    if (current.includes(status)) {
                        return { priorityStatusFilter: current.filter(s => s !== status) };
                    }
                    return { priorityStatusFilter: [...current, status] };
                }),

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
            version: 4,
            migrate: (persisted, version) => {
                if (version === 0) {
                    const { showClosedSessions, showClosedPriorities, ...rest } = persisted;
                    return {
                        ...rest,
                        sessionStatusFilter: showClosedSessions
                            ? ALL_SESSION_STATUSES
                            : DEFAULT_SESSION_STATUSES,
                        priorityStatusFilter: showClosedPriorities
                            ? ['open', 'closed']
                            : DEFAULT_PRIORITY_STATUSES,
                    };
                }
                if (version === 1) {
                    const { showClosedPriorities, ...rest } = persisted;
                    return {
                        ...rest,
                        sessionStatusFilter: DEFAULT_SESSION_STATUSES,
                        priorityStatusFilter: showClosedPriorities
                            ? ['open', 'closed']
                            : DEFAULT_PRIORITY_STATUSES,
                    };
                }
                if (version === 2) {
                    const { showClosedPriorities, toggleShowClosedPriorities, ...rest } = persisted;
                    return {
                        ...rest,
                        priorityStatusFilter: showClosedPriorities
                            ? ['open', 'closed']
                            : DEFAULT_PRIORITY_STATUSES,
                    };
                }
                if (version === 3) {
                    return {
                        ...persisted,
                        priorityStatusFilter: (persisted.priorityStatusFilter || DEFAULT_PRIORITY_STATUSES)
                            .map(s => s === 'closed' ? 'completed' : s),
                    };
                }
                return persisted;
            },
        }
    )
);
