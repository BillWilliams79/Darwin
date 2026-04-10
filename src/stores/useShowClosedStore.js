import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const ALL_SESSION_STATUSES = ['starting', 'active', 'paused', 'completing', 'completed'];
export const DEFAULT_SESSION_STATUSES = ['starting', 'active', 'completing'];

export const ALL_REQUIREMENT_STATUSES = ['open', 'deferred', 'completed'];
export const DEFAULT_REQUIREMENT_STATUSES = ['open'];

export const useShowClosedStore = create(
    persist(
        (set) => ({
            requirementStatusFilter: DEFAULT_REQUIREMENT_STATUSES,
            sessionStatusFilter: DEFAULT_SESSION_STATUSES,

            toggleRequirementStatus: (status) =>
                set((state) => {
                    const current = state.requirementStatusFilter;
                    if (current.includes(status)) {
                        return { requirementStatusFilter: current.filter(s => s !== status) };
                    }
                    return { requirementStatusFilter: [...current, status] };
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
            version: 5,
            migrate: (persisted, version) => {
                if (version === 0) {
                    const { showClosedSessions, showClosedPriorities, ...rest } = persisted;
                    return {
                        ...rest,
                        sessionStatusFilter: showClosedSessions
                            ? ALL_SESSION_STATUSES
                            : DEFAULT_SESSION_STATUSES,
                        requirementStatusFilter: showClosedPriorities
                            ? ['open', 'closed']
                            : DEFAULT_REQUIREMENT_STATUSES,
                    };
                }
                if (version === 1) {
                    const { showClosedPriorities, ...rest } = persisted;
                    return {
                        ...rest,
                        sessionStatusFilter: DEFAULT_SESSION_STATUSES,
                        requirementStatusFilter: showClosedPriorities
                            ? ['open', 'closed']
                            : DEFAULT_REQUIREMENT_STATUSES,
                    };
                }
                if (version === 2) {
                    const { showClosedPriorities, toggleShowClosedPriorities, ...rest } = persisted;
                    return {
                        ...rest,
                        requirementStatusFilter: showClosedPriorities
                            ? ['open', 'closed']
                            : DEFAULT_REQUIREMENT_STATUSES,
                    };
                }
                if (version === 3) {
                    return {
                        ...persisted,
                        requirementStatusFilter: (persisted.priorityStatusFilter || DEFAULT_REQUIREMENT_STATUSES)
                            .map(s => s === 'closed' ? 'completed' : s),
                    };
                }
                if (version === 4) {
                    const { priorityStatusFilter, togglePriorityStatus, ...rest } = persisted;
                    return {
                        ...rest,
                        requirementStatusFilter: priorityStatusFilter || DEFAULT_REQUIREMENT_STATUSES,
                    };
                }
                return persisted;
            },
        }
    )
);
