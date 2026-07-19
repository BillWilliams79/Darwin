import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// req #2810: 'paused' moved to the end of the selector order (was after 'review').
// req #2332: 'waiting' and 'planning' added as first-class statuses.
export const ALL_SESSION_STATUSES = ['starting', 'waiting', 'planning', 'active', 'review', 'completing', 'completed', 'paused'];
export const DEFAULT_SESSION_STATUSES = ['starting', 'waiting', 'planning', 'active', 'review', 'completing'];

// req #2784 reordered filter chips to met-before-deferred; req #2783 appends wontfix last.
export const ALL_REQUIREMENT_STATUSES = ['authoring', 'approved', 'swarm_ready', 'development', 'met', 'deferred', 'wontfix'];
export const DEFAULT_REQUIREMENT_STATUSES = ['authoring', 'approved', 'swarm_ready', 'development'];

// req #2992: the machine dimension is data-backed, not a fixed vocabulary, so
// its "all selected" default is null rather than an enumerated list. A machine
// registered after the user last touched this filter is visible by default —
// an enumerated default would silently hide it.
export const DEFAULT_SESSION_MACHINES = null;

export const useShowClosedStore = create(
    persist(
        (set) => ({
            requirementStatusFilter: DEFAULT_REQUIREMENT_STATUSES,
            sessionStatusFilter: DEFAULT_SESSION_STATUSES,
            sessionMachineFilter: DEFAULT_SESSION_MACHINES,

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

            // req #2992. `allValues` is the currently-known option set (machine
            // ids plus the UNASSIGNED_MACHINE sentinel), supplied by the caller
            // because the store does not know the machines query.
            //
            // Two asymmetries with the status togglers, both deliberate:
            //   - null (all) must be materialized before one value can be
            //     removed from it.
            //   - re-selecting every known value collapses back to null, which
            //     restores the "future machines are visible" property. Without
            //     this, a user who toggled a machine off and on again would be
            //     left with a frozen enumerated list.
            toggleSessionMachine: (value, allValues = []) =>
                set((state) => {
                    const current = state.sessionMachineFilter === null
                        ? [...allValues]
                        : state.sessionMachineFilter;

                    const next = current.includes(value)
                        ? current.filter(v => v !== value)
                        : [...current, value];

                    const isAll = allValues.length > 0
                        && allValues.every(v => next.includes(v));

                    return { sessionMachineFilter: isAll ? null : next };
                }),
        }),
        {
            name: 'darwin_show_closed',
            version: 8,
            migrate: (persisted, version) => {
                // req #2992: v7→v8 adds sessionMachineFilter. Every prior
                // version predates the machine dimension, so the only correct
                // carry-forward is the default (null = all machines). Applied
                // before the version blocks below for the same reason the
                // #2332 pass is: those blocks spread `persisted`/`rest` and
                // would otherwise drop the key on v0/v1/v2/v4 paths.
                if (persisted.sessionMachineFilter === undefined) {
                    persisted = { ...persisted, sessionMachineFilter: DEFAULT_SESSION_MACHINES };
                }
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
