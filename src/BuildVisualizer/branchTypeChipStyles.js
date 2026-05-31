// Shared styling + labeling for branch-type filter chips on the Build
// Visualizer toolbar. Mirrors SwarmView/statusChipStyles.js so the two
// chip rails feel like the same UI grammar.
//
// Order matters: the toolbar renders chips in BRANCH_TYPES order, which
// matches the visual stacking of the diagram (above-main types first,
// below-main last). Keep in sync with REGISTRY in d3LayoutEngine.js.

export const BRANCH_TYPES = [
    'release',
    'sample-release',
    'hotfix',
    'bootleg',
    'csr',
    'development',
];

export const branchTypeChipProps = (type) => {
    switch (type) {
        case 'release':         return { sx: { bgcolor: '#2e7d32', color: '#fff' } };
        case 'sample-release':  return { sx: { bgcolor: '#00897b', color: '#fff' } };
        case 'hotfix':          return { sx: { bgcolor: '#d32f2f', color: '#fff' } };
        case 'bootleg':         return { sx: { bgcolor: '#6d4c41', color: '#fff' } };
        case 'csr':             return { sx: { bgcolor: '#1976d2', color: '#fff' } };
        case 'development':     return { sx: { bgcolor: '#fbc02d', color: '#000' } };
        default:                return { color: 'default' };
    }
};

export const branchTypeLabel = (type) => {
    switch (type) {
        case 'release':         return 'Release';
        case 'sample-release':  return 'Sprint = Sample';
        case 'hotfix':          return 'Hot Fix';
        case 'bootleg':         return 'Bootleg';
        case 'csr':             return 'CSR';
        case 'development':     return 'Development';
        default:                return type;
    }
};
