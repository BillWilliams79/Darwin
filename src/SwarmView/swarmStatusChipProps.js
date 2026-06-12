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

export const swarmStatusLabel = (status) => {
    switch (status) {
        case 'active':     return 'Implementing';
        case 'review':     return 'Reviewing';
        case 'completing': return 'completing';
        default:           return status;
    }
};
