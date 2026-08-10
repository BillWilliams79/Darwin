// Shared styling + labeling for swarm-session-status chips (req #2332).
// Mirrors the pattern in statusChipStyles.js (requirement status chips).
// Used by:
//   SessionsView, SwarmSessionDetail, SwarmSessionDeleteDialog,
//   SwarmStartDetail, SwarmCompleteDetail, RequirementsTableView,
//   RequirementDetail

export const swarmStatusChipProps = (status) => {
    switch (status) {
        case 'active':     return { sx: { bgcolor: '#4caf50', color: '#fff' } };
        case 'review':     return { sx: { bgcolor: '#ce93d8', color: '#000' } };
        case 'paused':     return { sx: { bgcolor: '#f0d000', color: '#000' } };
        case 'waiting':    return { sx: { bgcolor: '#ffb74d', color: '#000' } };
        case 'planning':   return { sx: { bgcolor: '#4fc3f7', color: '#000' } };
        case 'starting':   return { color: 'info' };
        case 'completing': return { color: 'info' };
        case 'completed':  return { color: 'success' };
        default:           return { color: 'default' };
    }
};

// EVERY label is capitalised. The old version special-cased two statuses and
// returned the RAW DB value for the rest, so a Sessions row read "Implementing"
// next to "planning" and "waiting" — the column looked like it held two
// different kinds of data. `completing` was even hardcoded lowercase.
//
// Declared as a map rather than capitalising the raw value, so a status whose
// display name differs from its column value (active -> Implementing,
// review -> Reviewing) stays in the same place as the ones that do not.
const SWARM_STATUS_LABEL = {
    starting:   'Starting',
    waiting:    'Waiting',
    planning:   'Planning',
    active:     'Implementing',
    review:     'Reviewing',
    paused:     'Paused',
    completing: 'Completing',
    completed:  'Completed',
};

export const swarmStatusLabel = (status) => {
    if (SWARM_STATUS_LABEL[status]) return SWARM_STATUS_LABEL[status];
    // An unknown status is still shown, capitalised — never blank, and never
    // raw lowercase beside eight capitalised siblings.
    if (!status) return '';
    return String(status).charAt(0).toUpperCase() + String(status).slice(1);
};
