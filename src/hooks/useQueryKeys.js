// Centralized query key factory for TanStack Query
// Ensures consistent keys across queries and invalidations.
//
// Devops data objects (dev_servers, swarm_sessions, swarm_starts,
// swarm_start_sessions and any future addition) source their key factories
// from `factory/devopsQueries.js` via the `createEntityQueries` factory
// (req #2593). Their re-exports live at the bottom of this file.

import { devServers, sessions, swarmStarts, swarmStartSessions, swarmUndos, orchestrationClaims, pipelines, epics, pipelineSteps, pipelineStepRequirements, pipelineStepDeps, requirementSessions, sessionCostRollups } from './factory/devopsQueries';

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
    // `fields` in the key (req #3500) — the same hazard `done` and
    // `useAllRequirements` already guard against (req #3029, stated there in
    // full): two observers can now hit the SAME (creatorFk, status) with
    // DIFFERENT projections (`SwarmStartCard`'s epic-scoped all-time `met`
    // read beside its normal active-status read), and without `fields` in the
    // key the narrower one silently wins the shared cache entry regardless of
    // which observer actually wants the wider one. `requirementKeys.all`
    // prefix invalidation is unaffected — it matches on the leading
    // `['requirements', creatorFk]` segment, before this one.
    byStatus: (creatorFk, status, fields) => ['requirements', creatorFk, { requirement_status: status }, { fields }],
    swarmReady: (creatorFk) => ['requirements', creatorFk, { requirement_status: 'swarm_ready' }],
};

// Devops key factories (req #2593) — produced by createEntityQueries via
// factory/devopsQueries.js. Shapes are byte-identical to the legacy hand-
// written versions; parity is locked down in __tests__/devopsQueriesParity.test.js.
export const sessionKeys = sessions.keys;
export const swarmStartKeys = swarmStarts.keys;
export const swarmStartSessionKeys = swarmStartSessions.keys;
export const swarmUndoKeys = swarmUndos.keys;
export const devServerKeys = devServers.keys;

// Req #3114 — Swarm Orchestration pipelines. Bounded list reads joined
// client-side by the plan page (design rule 5: no N+1 at render).
// `epicKeys` joined them at req #3356, when the plan layer collapsed to one era
// and `epics` stopped being a hand-written hierarchy read (see below).
export const pipelineKeys = pipelines.keys;
export const epicKeys = epics.keys;
export const pipelineStepKeys = pipelineSteps.keys;
export const pipelineStepRequirementKeys = pipelineStepRequirements.keys;
export const pipelineStepDepKeys = pipelineStepDeps.keys;

// Req #3224 — the durable orchestration reservation. Its own cache entry rather
// than a slice of the pipelines one: it is LIVE process state on a separate
// refresh cadence, and folding it into the plan read would make every plan
// render depend on it.
export const orchestrationClaimKeys = orchestrationClaims.keys;

// Req #3117 — the plan page's Cost column, from two more bounded list reads.
// `sessionCostRollupKeys.all` shares the `['swarm_sessions', creator]` PREFIX
// with `sessionKeys.all` on purpose: the light 3-column read is a projection of
// the same table, so anything that already invalidates sessions refreshes the
// cost numbers too. The `{fields}` suffix (fieldsInKey) is what keeps the two
// cache ENTRIES apart.
export const requirementSessionKeys = requirementSessions.keys;
export const sessionCostRollupKeys = sessionCostRollups.keys;

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

// Req #3381 — the composed plan read (the `pipeline_compose` route, req #3367).
// Not creator-scoped in the key: the route itself scopes by the authenticated
// token (Lambda-Rest req #3050), and this cache entry is one per PLAN, the same
// way `mapCoordinateKeys.byRun` is one per run rather than one per (creator,
// run).
export const pipelineComposeKeys = {
    byId: (pipelineId) => ['pipeline_compose', { id: pipelineId }],
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

// `epicKeys` MOVED to the factory re-export block above (req #3356). It was
// hand-written here while `epics` was the 1.0 hierarchy's top tier and the plan
// EXECUTION tables were factory keys; the plan layer collapse made `epics` a
// plan-layer table like the other four, so its key comes from the same
// declaration its hooks do rather than being stated a second time here.

// Trimmed to `.all` by req #3357 — the Features route, its by-id/by-category
// pages and their hooks are retired; `useAllFeatures` (the LABEL DICTIONARY
// read `src/SwarmView/pipelines/usePlanSources.js` still depends on) is the
// one surviving consumer.
export const featureKeys = {
    all: (creatorFk) => ['features', creatorFk],
};

export const testCaseKeys = {
    all: (creatorFk) => ['test_cases', creatorFk],
    byId: (creatorFk, id) => ['test_cases', creatorFk, { id }],
    byCategory: (creatorFk, categoryId) => ['test_cases', creatorFk, { categoryId }],
    byFeature: (creatorFk, featureId) => ['test_cases', creatorFk, { featureId }],
};

// Req #3357 — feature_test_cases re-homed onto the requirement (req #3352's
// junction). feature_test_cases the TABLE survives as a Feature concern the
// SCHEMA still carries (eradication phase E6, req #3355) but the frontend no
// longer reads it.
export const requirementTestCaseKeys = {
    all: (creatorFk) => ['requirement_test_cases', creatorFk],
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

// Req #2604 — Customer Release. Customers are recipients of build releases
// (HP, NVIDIA, Cisco, Google, …). `fields` is appended to the extended key
// per req #2213 to avoid cross-projection cache collisions.
export const customerKeys = {
    all: (creatorFk) => ['customers', creatorFk],
    byId: (creatorFk, id) => ['customers', creatorFk, { id }],
};

// Req #2606 — Customer Release Events + SQL-backed Build Visualizer.
export const buildProjectKeys = {
    all: (creatorFk) => ['build_projects', creatorFk],
    byId: (creatorFk, id) => ['build_projects', creatorFk, { id }],
};

export const branchKeys = {
    all: (creatorFk) => ['branches', creatorFk],
    byProject: (creatorFk, projectId) => ['branches', creatorFk, { projectId }],
};

export const buildKeys = {
    all: (creatorFk) => ['builds', creatorFk],
    byBranch: (creatorFk, branchId) => ['builds', creatorFk, { branchId }],
    byId: (creatorFk, id) => ['builds', creatorFk, { id }],
};

export const customerReleaseKeys = {
    all: (creatorFk) => ['customer_releases', creatorFk],
    byBuild: (creatorFk, buildId) => ['customer_releases', creatorFk, { buildId }],
    byCustomer: (creatorFk, customerId) => ['customer_releases', creatorFk, { customerId }],
};
