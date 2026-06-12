import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// req #2810: 'paused' moved to the end of the selector order (was after 'review').
// req #2332: 'waiting' and 'planning' added as first-class statuses.
export const ALL_SESSION_STATUSES = ['starting', 'waiting', 'planning', 'active', 'review', 'completing', 'completed', 'paused'];
export const DEFAULT_SESSION_STATUSES = ['starting', 'waiting', 'planning', 'active', 'review', 'completing'];

// req #2784 reordered filter chips to met-before-deferred; req #2783 appends wontfix last.
export const ALL_REQUIREMENT_STATUSES = ['authoring', 'approved', 'swarm_ready', 'development', 'met', 'deferred', 'wontfix'];
export const DEFAULT_REQUIREMENT_STATUSES = ['authoring', 'approved', 'swarm_ready', 'development'];

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
            version: 7,
            migrate: (persisted, version) => {
                // req #2332: ensure 'waiting' and 'planning' exist in the persisted
                // sessionStatusFilter for EVERY incoming version. v0/v1 below replace the
                // filter wholesale (DEFAULT/ALL already include them); this top-level pass
                // covers v2–v6, whose version blocks otherwise carry the filter through
                // unchanged. Their returns spread `persisted`/`rest`, so this rides along.
                {
                    const sf = [...(persisted.sessionStatusFilter || DEFAULT_SESSION_STATUSES)];
                    if (!sf.includes('waiting')) sf.push('waiting');
                    if (!sf.includes('planning')) sf.push('planning');
                    persisted = { ...persisted, sessionStatusFilter: sf };
                }
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
                if (version === 5) {
                    // v5→v6: expand grouped chip labels to individual status values
                    const old = persisted.requirementStatusFilter || ['open'];
                    const newFilter = [];
                    if (old.includes('open') || old.includes('active')) {
                        newFilter.push('authoring', 'approved', 'swarm_ready', 'development');
                    }
                    if (old.includes('deferred')) newFilter.push('deferred');
                    if (old.includes('completed') || old.includes('met')) newFilter.push('met');
                    return {
                        ...persisted,
                        requirementStatusFilter: newFilter.length > 0 ? newFilter : DEFAULT_REQUIREMENT_STATUSES,
                    };
                }
                // v6→v7 and any unmatched version: the top-level pass above already
                // injected 'waiting'/'planning', so return the (possibly mutated) state.
                return persisted;
            },
        }
    )
);
