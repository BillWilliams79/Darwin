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

export const requirementKeys = {
    all: (creatorFk) => ['requirements', creatorFk],
    byCategory: (creatorFk, categoryId) => ['requirements', creatorFk, { categoryId }],
    byCategoryOpen: (creatorFk, categoryId) => ['requirements', creatorFk, { categoryId, closed: 0 }],
    byCategoryWithClosed: (creatorFk, categoryId) => ['requirements', creatorFk, { categoryId, withClosed: true }],
    done: (creatorFk, dateRange) => ['requirements', creatorFk, { closed: 1, dateRange }],
    counts: (creatorFk) => ['requirements', creatorFk, 'counts'],
    byStatus: (creatorFk, status) => ['requirements', creatorFk, { requirement_status: status }],
    swarmReady: (creatorFk) => ['requirements', creatorFk, { requirement_status: 'swarm_ready' }],
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
    done: (creatorFk, dateRange) => ['map_runs', creatorFk, { dateRange }],
};

export const mapRouteKeys = {
    all: (creatorFk) => ['map_routes', creatorFk],
};

export const mapCoordinateKeys = {
    byRun: (runId) => ['map_coordinates', { runId }],
};

export const mapViewKeys = {
    all: (creatorFk) => ['map_views', creatorFk],
};

export const mapPartnerKeys = {
    all: (creatorFk) => ['map_partners', creatorFk],
};

export const mapRunPartnerKeys = {
    all: (creatorFk) => ['map_run_partners', creatorFk],
};

// Req #2380 — Swarm Features & Test Cases registry. `fields` must appear in the
// extended key (req #2213) so two callers with different projections don't collide.

export const featureKeys = {
    all: (creatorFk) => ['features', creatorFk],
    byId: (creatorFk, id) => ['features', creatorFk, { id }],
    byCategory: (creatorFk, categoryId) => ['features', creatorFk, { categoryId }],
};

export const testCaseKeys = {
    all: (creatorFk) => ['test_cases', creatorFk],
    byId: (creatorFk, id) => ['test_cases', creatorFk, { id }],
    byCategory: (creatorFk, categoryId) => ['test_cases', creatorFk, { categoryId }],
    byFeature: (creatorFk, featureId) => ['test_cases', creatorFk, { featureId }],
};

export const featureTestCaseKeys = {
    all: (creatorFk) => ['feature_test_cases', creatorFk],
};

export const testPlanKeys = {
    all: (creatorFk) => ['test_plans', creatorFk],
    byId: (creatorFk, id) => ['test_plans', creatorFk, { id }],
    byCategory: (creatorFk, categoryId) => ['test_plans', creatorFk, { categoryId }],
};

export const testPlanCaseKeys = {
    byPlan: (creatorFk, planId) => ['test_plan_cases', creatorFk, { planId }],
};

export const testRunKeys = {
    all: (creatorFk) => ['test_runs', creatorFk],
    byId: (creatorFk, id) => ['test_runs', creatorFk, { id }],
    byPlan: (creatorFk, planId) => ['test_runs', creatorFk, { planId }],
};

export const testResultKeys = {
    byRun: (creatorFk, runId) => ['test_results', creatorFk, { runId }],
};
