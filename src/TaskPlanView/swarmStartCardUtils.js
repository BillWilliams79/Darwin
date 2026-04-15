// Pure utilities for SwarmStartCard — extracted for testability.
// Part of the "Optional Domain-Scoped Filter Card" pattern.

// Sort swarm-ready requirements chronologically by id (creation order).
export const sortSwarmReadyItems = (items) => {
    return [...items].sort((a, b) => a.id - b.id);
};

// Map coordination_type to a display label for tooltips / aria.
export const getCoordLabel = (coordType) => {
    switch (coordType) {
        case 'planned':     return 'Planned';
        case 'implemented': return 'Implemented';
        case 'deployed':    return 'Deployed';
        default:            return 'No coordination';
    }
};
