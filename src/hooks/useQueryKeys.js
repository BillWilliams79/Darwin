// Centralized query key factory for TanStack Query
// Ensures consistent keys across queries and invalidations

export const domainKeys = {
    all: (creatorFk) => ['domains', creatorFk],
    open: (creatorFk) => ['domains', creatorFk, { closed: 0 }],
    withClosed: (creatorFk) => ['domains', creatorFk, { withClosed: true }],
};

export const areaKeys = {
    all: (creatorFk) => ['areas', creatorFk],
    byDomain: (creatorFk, domainId) => ['areas', creatorFk, { domainId }],
    byDomainOpen: (creatorFk, domainId) => ['areas', creatorFk, { domainId, closed: 0 }],
    byDomainWithClosed: (creatorFk, domainId) => ['areas', creatorFk, { domainId, withClosed: true }],
};

export const taskKeys = {
    all: (creatorFk) => ['tasks', creatorFk],
    byArea: (creatorFk, areaId) => ['tasks', creatorFk, { areaId }],
    byAreaOpen: (creatorFk, areaId) => ['tasks', creatorFk, { areaId, done: 0 }],
    done: (creatorFk, dateRange) => ['tasks', creatorFk, { done: 1, dateRange }],
    counts: (creatorFk) => ['tasks', creatorFk, 'counts'],
    priorityByDomain: (creatorFk, domainId, areaIds) => ['tasks', creatorFk, { priorityByDomain: domainId, areaIds }],
};

export const priorityCardOrderKeys = {
    byDomain: (creatorFk, domainId) => ['priority_card_order', creatorFk, { domainId }],
};

export const projectKeys = {
    all: (creatorFk) => ['projects', creatorFk],
    open: (creatorFk) => ['projects', creatorFk, { closed: 0 }],
    withClosed: (creatorFk) => ['projects', creatorFk, { withClosed: true }],
};

export const categoryKeys = {
    all: (creatorFk) => ['categories', creatorFk],
    colors: (creatorFk) => ['categories', creatorFk, 'colors'],
    byProject: (creatorFk, projectId) => ['categories', creatorFk, { projectId }],
    byProjectOpen: (creatorFk, projectId) => ['categories', creatorFk, { projectId, closed: 0 }],
    byProjectWithClosed: (creatorFk, projectId) => ['categories', creatorFk, { projectId, withClosed: true }],
};

export const priorityKeys = {
    all: (creatorFk) => ['priorities', creatorFk],
    byCategory: (creatorFk, categoryId) => ['priorities', creatorFk, { categoryId }],
    byCategoryOpen: (creatorFk, categoryId) => ['priorities', creatorFk, { categoryId, closed: 0 }],
    byCategoryWithClosed: (creatorFk, categoryId) => ['priorities', creatorFk, { categoryId, withClosed: true }],
    done: (creatorFk, dateRange) => ['priorities', creatorFk, { closed: 1, dateRange }],
};

export const sessionKeys = {
    all: (creatorFk) => ['swarm_sessions', creatorFk],
    byId: (sessionId) => ['swarm_sessions', { id: sessionId }],
};

export const devServerKeys = {
    all: (creatorFk) => ['dev_servers', creatorFk],
    bySession: (sessionId) => ['dev_servers', { sessionId }],
};

export const recurringTaskKeys = {
    all: (creatorFk) => ['recurring_tasks', creatorFk],
    active: (creatorFk) => ['recurring_tasks', creatorFk, { active: 1 }],
};

export const mapRunKeys = {
    all: (creatorFk) => ['map_runs', creatorFk],
};

export const mapRouteKeys = {
    all: (creatorFk) => ['map_routes', creatorFk],
};

export const mapCoordinateKeys = {
    byRun: (runId) => ['map_coordinates', { runId }],
};
