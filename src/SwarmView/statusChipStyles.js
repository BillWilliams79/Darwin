// Shared styling + labeling for requirement-status chips.
// Used by:
//   • SwarmView header — multi-select requirement-status filter
//   • SwarmStartCard header — single-select cross-category status selector

export const requirementStatusChipProps = (status) => {
    switch (status) {
        case 'authoring':    return { sx: { bgcolor: '#fbc02d', color: '#000' } };
        case 'approved':     return { sx: { bgcolor: '#90caf9', color: '#000' } };
        case 'swarm_ready':  return { sx: { bgcolor: '#1976d2', color: '#fff' } };
        case 'development':  return { sx: { bgcolor: '#81c784', color: '#000' } };
        case 'deferred':     return { sx: { bgcolor: '#ff9800', color: '#fff' } };
        case 'met':          return { sx: { bgcolor: '#2e7d32', color: '#fff' } };
        default:             return { color: 'default' };
    }
};

export const requirementStatusLabel = (status) => {
    switch (status) {
        case 'swarm_ready':  return 'Swarm-Start';
        case 'development':  return 'Dev';
        default:             return status;
    }
};
