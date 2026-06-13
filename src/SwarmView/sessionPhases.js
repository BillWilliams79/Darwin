// Shared session phase-duration constants (req #2332, extracted req #2825).
//
// Single source of truth for the 8 per-phase `*_secs` buckets on
// `swarm_sessions`: their display labels, agentic/human/machine/legacy grouping,
// and per-phase colors. Consumed by SwarmSessionDetail's phase breakdown and by
// SessionsStatsView's cross-session aggregation so the two never drift on color
// or grouping. Phase grouping is canonical per CLAUDE.md:
//   agentic = planning + implementing + completion
//   human   = waiting + review + paused
//   machine = starting
//   legacy  = legacy_secs (instrumented=0 sessions only)

export const PHASE_BUCKETS = [
    { key: 'starting_secs',      label: 'Starting',      group: 'machine', color: '#5c6bc0' },
    { key: 'waiting_secs',       label: 'Waiting',       group: 'human',   color: '#ffb74d' },
    { key: 'planning_secs',      label: 'Planning',      group: 'agentic', color: '#4fc3f7' },
    { key: 'implementing_secs',  label: 'Implementing',  group: 'agentic', color: '#4caf50' },
    { key: 'review_secs',        label: 'Review',        group: 'human',   color: '#ce93d8' },
    { key: 'completion_secs',    label: 'Completion',    group: 'agentic', color: '#8d6e63' },
    { key: 'paused_secs',        label: 'Paused',        group: 'human',   color: '#f0d000' },
    { key: 'legacy_secs',        label: 'Legacy',        group: 'legacy',  color: '#bdbdbd' },
];

export const GROUP_COLORS = {
    agentic: '#4fc3f7',
    human:   '#ffb74d',
    machine: '#90caf9',
    legacy:  '#bdbdbd',
};
