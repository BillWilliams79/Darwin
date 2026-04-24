import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchExportData } from '../exportService';

// Mock call_rest_api
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn(),
}));

import call_rest_api from '../../RestApi/RestApi';

const DARWIN_URI = 'https://api.example.com/darwin';
const ID_TOKEN = 'mock-token';
const PROFILE = {
    name: 'Test User',
    email: 'test@example.com',
    userName: 'user-123',
    timezone: 'America/Los_Angeles',
    theme_mode: 'dark',
    app_tasks: 1,
    app_maps: 1,
    app_swarm: 0,
};

// Helper: configure mock responses by URL substring
function mockApi(responses) {
    call_rest_api.mockImplementation((url) => {
        for (const [key, data] of Object.entries(responses)) {
            if (url.includes(key)) {
                return Promise.resolve({ data, httpStatus: { httpStatus: 200 } });
            }
        }
        // Default: 404 (empty table)
        const err = new Error('Not found');
        err.httpStatus = { httpStatus: 404 };
        return Promise.reject(err);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('fetchExportData', () => {
    it('returns v2.0 with selectedApps metadata', async () => {
        mockApi({});
        const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, {
            tasks: false, maps: false, swarm: false,
        });
        expect(result.exportVersion).toBe('2.0');
        expect(result.exportDate).toBeTruthy();
        expect(result.selectedApps).toEqual({ tasks: false, maps: false, swarm: false });
    });

    it('exports profile with all fields', async () => {
        mockApi({});
        const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, {
            tasks: false, maps: false, swarm: false,
        });
        expect(result.profile).toEqual({
            name: 'Test User',
            email: 'test@example.com',
            userName: 'user-123',
            timezone: 'America/Los_Angeles',
            theme_mode: 'dark',
            app_tasks: 1,
            app_maps: 1,
            app_swarm: 0,
        });
    });

    it('omits app keys when not selected', async () => {
        mockApi({});
        const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, {
            tasks: false, maps: false, swarm: false,
        });
        expect(result.domains).toBeUndefined();
        expect(result.recurringTasks).toBeUndefined();
        expect(result.mapRoutes).toBeUndefined();
        expect(result.requirements).toBeUndefined();
        expect(result.swarmSessions).toBeUndefined();
    });

    describe('Tasks app', () => {
        const SELECTED = { tasks: true, maps: false, swarm: false };

        it('fetches domains/areas/tasks/recurring_tasks', async () => {
            mockApi({
                '/domains': [{ id: 1, domain_name: 'D1', closed: 0, sort_order: 1, create_ts: 't', update_ts: null }],
                '/areas': [{ id: 10, area_name: 'A1', domain_fk: 1, closed: 0, sort_order: 1, sort_mode: 'priority', create_ts: 't', update_ts: null }],
                '/tasks': [{ id: 100, description: 'T1', priority: 0, done: 0, area_fk: 10, sort_order: 1, recurring_task_fk: null, create_ts: 't', update_ts: null, done_ts: null }],
                '/recurring_tasks': [{ id: 200, description: 'RT1', recurrence: 'daily', anchor_date: '2026-01-01', area_fk: 10, priority: 0, accumulate: 0, insert_position: 'bottom', active: 1, last_generated: null, create_ts: 't', update_ts: null }],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, SELECTED);

            expect(result.domains).toHaveLength(1);
            expect(result.domains[0].areas).toHaveLength(1);
            expect(result.domains[0].areas[0].tasks).toHaveLength(1);
            expect(result.domains[0].areas[0].tasks[0].recurring_task_fk).toBeNull();
            expect(result.recurringTasks).toHaveLength(1);
            expect(result.recurringTasks[0].recurrence).toBe('daily');
            expect(result.recurringTasks[0].anchor_date).toBe('2026-01-01');
        });

        it('nests tasks under correct areas and areas under correct domains', async () => {
            mockApi({
                '/domains': [
                    { id: 1, domain_name: 'D1', closed: 0, sort_order: 1, create_ts: 't', update_ts: null },
                    { id: 2, domain_name: 'D2', closed: 0, sort_order: 2, create_ts: 't', update_ts: null },
                ],
                '/areas': [
                    { id: 10, area_name: 'A1', domain_fk: 1, closed: 0, sort_order: 1, sort_mode: 'priority', create_ts: 't', update_ts: null },
                    { id: 20, area_name: 'A2', domain_fk: 2, closed: 0, sort_order: 1, sort_mode: 'hand', create_ts: 't', update_ts: null },
                ],
                '/tasks': [
                    { id: 100, description: 'T1', priority: 0, done: 0, area_fk: 10, sort_order: 1, recurring_task_fk: null, create_ts: 't', update_ts: null, done_ts: null },
                    { id: 101, description: 'T2', priority: 1, done: 0, area_fk: 20, sort_order: 1, recurring_task_fk: null, create_ts: 't', update_ts: null, done_ts: null },
                ],
                '/recurring_tasks': [],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, SELECTED);
            expect(result.domains[0].areas[0].tasks[0].description).toBe('T1');
            expect(result.domains[1].areas[0].tasks[0].description).toBe('T2');
        });

        it('handles 404 (empty tables) gracefully', async () => {
            mockApi({}); // All tables return 404
            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, SELECTED);
            expect(result.domains).toEqual([]);
            expect(result.recurringTasks).toEqual([]);
        });
    });

    describe('Maps app', () => {
        const SELECTED = { tasks: false, maps: true, swarm: false };

        it('nests runs under routes and separates unassigned runs', async () => {
            mockApi({
                '/map_routes': [{ id: 1, route_id: 5, name: 'Route A', create_ts: 't', update_ts: null }],
                '/map_runs': [
                    { id: 10, run_id: 1, map_route_fk: 1, activity_id: 4, activity_name: 'Ride', start_time: '2026-01-01', run_time_sec: 3600, stopped_time_sec: 0, distance_mi: 10, ascent_ft: 100, descent_ft: 100, calories: 300, max_speed_mph: 20, avg_speed_mph: 10, notes: null, source: 'cyclemeter', create_ts: 't', update_ts: null },
                    { id: 11, run_id: 2, map_route_fk: null, activity_id: 4, activity_name: 'Ride', start_time: '2026-01-02', run_time_sec: 1800, stopped_time_sec: 0, distance_mi: 5, ascent_ft: 50, descent_ft: 50, calories: 150, max_speed_mph: 18, avg_speed_mph: 10, notes: null, source: 'strava', create_ts: 't', update_ts: null },
                ],
                '/map_views': [],
                '/map_partners': [],
                '/map_run_partners': [],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, SELECTED);

            expect(result.mapRoutes).toHaveLength(1);
            expect(result.mapRoutes[0].runs).toHaveLength(1);
            expect(result.mapRoutes[0].runs[0].id).toBe(10);
            expect(result.unassignedRuns).toHaveLength(1);
            expect(result.unassignedRuns[0].id).toBe(11);
        });

        it('excludes coordinates when mapsGps is not set', async () => {
            mockApi({
                '/map_routes': [],
                '/map_runs': [{ id: 10, run_id: 1, map_route_fk: null, activity_id: 4, activity_name: 'Ride', start_time: '2026-01-01', run_time_sec: 3600, stopped_time_sec: 0, distance_mi: 10, ascent_ft: 100, descent_ft: 100, calories: 300, max_speed_mph: 20, avg_speed_mph: 10, notes: null, source: 'cyclemeter', create_ts: 't', update_ts: null }],
                '/map_views': [],
                '/map_partners': [],
                '/map_run_partners': [],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, SELECTED);
            expect(result.unassignedRuns[0].coordinates).toBeUndefined();
            // No coordinate API calls should have been made
            const coordCalls = call_rest_api.mock.calls.filter(c => c[0].includes('map_coordinates'));
            expect(coordCalls).toHaveLength(0);
        });

        it('fetches coordinates per-run when mapsGps is true', async () => {
            mockApi({
                '/map_routes': [],
                '/map_runs': [{ id: 10, run_id: 1, map_route_fk: null, activity_id: 4, activity_name: 'Ride', start_time: '2026-01-01', run_time_sec: 3600, stopped_time_sec: 0, distance_mi: 10, ascent_ft: 100, descent_ft: 100, calories: 300, max_speed_mph: 20, avg_speed_mph: 10, notes: null, source: 'cyclemeter', create_ts: 't', update_ts: null }],
                'map_coordinates?map_run_fk=10': [
                    { map_run_fk: 10, seq: 1, latitude: 37.123, longitude: -122.456, altitude: 100 },
                    { map_run_fk: 10, seq: 2, latitude: 37.124, longitude: -122.457, altitude: 101 },
                ],
                '/map_views': [],
                '/map_partners': [],
                '/map_run_partners': [],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, {
                ...SELECTED, mapsGps: true,
            });

            expect(result.unassignedRuns[0].coordinates).toHaveLength(2);
            expect(result.unassignedRuns[0].coordinates[0]).toEqual({
                seq: 1, latitude: 37.123, longitude: -122.456, altitude: 100,
            });
        });

        it('exports map views, partners, and run_partners', async () => {
            mockApi({
                '/map_routes': [],
                '/map_runs': [],
                '/map_views': [{ id: 1, name: 'All', criteria: '{}', sort_order: 1, create_ts: 't', update_ts: null }],
                '/map_partners': [{ id: 1, name: 'Alice', create_ts: 't', update_ts: null }],
                '/map_run_partners': [{ map_run_fk: 10, map_partner_fk: 1, create_ts: 't' }],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, SELECTED);
            expect(result.mapViews).toHaveLength(1);
            expect(result.mapPartners).toHaveLength(1);
            expect(result.mapRunPartners).toHaveLength(1);
            expect(result.mapRunPartners[0].create_ts).toBe('t');
        });
    });

    describe('Swarm app', () => {
        const SELECTED = { tasks: false, maps: false, swarm: true };

        it('exports requirements with all fields including deferred_at, FKs, and coordination_type', async () => {
            mockApi({
                '/requirements': [{ id: 1, title: 'P1', description: 'desc', requirement_status: 'authoring', coordination_type: 'implemented', started_at: null, completed_at: null, deferred_at: '2026-03-01', project_fk: 5, category_fk: 10, create_ts: 't', update_ts: null }],
                '/swarm_sessions': [],
                '/projects': [],
                '/categories': [],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, SELECTED);
            expect(result.requirements[0].requirement_status).toBe('authoring');
            expect(result.requirements[0].coordination_type).toBe('implemented');
            expect(result.requirements[0].deferred_at).toBe('2026-03-01');
            expect(result.requirements[0].project_fk).toBe(5);
            expect(result.requirements[0].category_fk).toBe(10);
        });

        it('exports swarm session with review status transparently', async () => {
            mockApi({
                '/requirements': [],
                '/swarm_sessions': [{ id: 1, branch: 'feature/x', task_name: 'x', source_type: 'roadmap', source_ref: 'p:1', title: 'X', pr_url: null, swarm_status: 'review', worktree_path: '/tmp/x', started_at: 't', completed_at: null, start_summary: null, complete_summary: null, telemetry: null, plan: '## Plan', create_ts: 't', update_ts: null }],
                '/projects': [],
                '/categories': [],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, SELECTED);
            expect(result.swarmSessions[0].swarm_status).toBe('review');
        });

        it('preserves null coordination_type on requirements', async () => {
            mockApi({
                '/requirements': [{ id: 2, title: 'P2', description: 'd', requirement_status: 'approved', coordination_type: null, started_at: null, completed_at: null, deferred_at: null, project_fk: null, category_fk: null, create_ts: 't', update_ts: null }],
                '/swarm_sessions': [],
                '/projects': [],
                '/categories': [],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, SELECTED);
            expect(result.requirements[0].coordination_type).toBeNull();
        });

        it('exports swarm sessions with summary, telemetry, and plan fields', async () => {
            mockApi({
                '/requirements': [],
                '/swarm_sessions': [{ id: 1, branch: 'feature/x', task_name: 'x', source_type: 'roadmap', source_ref: 'p:1', title: 'X', pr_url: 'https://github.com/x', swarm_status: 'completed', worktree_path: '/tmp/x', started_at: 't', completed_at: 't2', start_summary: 'Started work', complete_summary: 'Done', telemetry: 'data', plan: '## Plan', create_ts: 't', update_ts: null }],
                '/projects': [],
                '/categories': [],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, SELECTED);
            const s = result.swarmSessions[0];
            expect(s.completed_at).toBe('t2');
            expect(s.start_summary).toBe('Started work');
            expect(s.complete_summary).toBe('Done');
            expect(s.telemetry).toBe('data');
            expect(s.plan).toBe('## Plan');
        });

        it('exports projects and categories with correct field names', async () => {
            mockApi({
                '/requirements': [],
                '/swarm_sessions': [],
                '/projects': [{ id: 1, project_name: 'Proj1', sort_order: 1, closed: 0, create_ts: 't', update_ts: null }],
                '/categories': [{ id: 1, category_name: 'Cat1', project_fk: 1, sort_order: 1, sort_mode: 'hand', color: '#ff0000', closed: 0, create_ts: 't', update_ts: null }],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, SELECTED);
            expect(result.projects[0].project_name).toBe('Proj1');
            expect(result.projects[0].closed).toBe(0);
            expect(result.categories[0].category_name).toBe('Cat1');
            expect(result.categories[0].sort_mode).toBe('hand');
            expect(result.categories[0].color).toBe('#ff0000');
        });

        it('exports features, test_cases, and test_plans (req #2380)', async () => {
            mockApi({
                '/requirements': [],
                '/swarm_sessions': [],
                '/projects': [],
                '/categories': [],
                '/features': [{
                    id: 1, title: 'Feature X', description: '**Given**...\n**When**...\n**Then**...',
                    feature_status: 'active', category_fk: 1, closed: 0, sort_order: 5,
                    create_ts: 't', update_ts: null,
                }],
                '/test_cases': [{
                    id: 10, title: 'Feature X validates input', preconditions: 'logged in',
                    steps: '1. Click', expected: 'modal opens', test_type: 'automated',
                    tags: 'smoke,auth', category_fk: 1, closed: 0, sort_order: 1,
                    create_ts: 't', update_ts: null,
                }],
                '/test_plans': [{
                    id: 100, title: 'Smoke plan', description: 'Core path coverage',
                    category_fk: 1, closed: 0, sort_order: 1,
                    create_ts: 't', update_ts: null,
                }],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, SELECTED);
            expect(result.features).toHaveLength(1);
            expect(result.features[0].feature_status).toBe('active');
            expect(result.features[0].description).toContain('Given');
            expect(result.testCases).toHaveLength(1);
            expect(result.testCases[0].test_type).toBe('automated');
            expect(result.testCases[0].tags).toBe('smoke,auth');
            expect(result.testCases[0].expected).toBe('modal opens');
            expect(result.testPlans).toHaveLength(1);
            expect(result.testPlans[0].title).toBe('Smoke plan');
            // Verify junction tables and execution tables are NOT exported
            expect(result.featureTestCases).toBeUndefined();
            expect(result.testPlanCases).toBeUndefined();
            expect(result.testRuns).toBeUndefined();
            expect(result.testResults).toBeUndefined();
        });
    });

    describe('multiple apps selected', () => {
        it('includes data for all selected apps', async () => {
            mockApi({
                '/domains': [{ id: 1, domain_name: 'D1', closed: 0, sort_order: 1, create_ts: 't', update_ts: null }],
                '/areas': [],
                '/tasks': [],
                '/recurring_tasks': [],
                '/map_routes': [],
                '/map_runs': [],
                '/map_views': [],
                '/map_partners': [],
                '/map_run_partners': [],
                '/requirements': [],
                '/swarm_sessions': [],
                '/projects': [],
                '/categories': [],
            });

            const result = await fetchExportData(DARWIN_URI, 'user-123', ID_TOKEN, PROFILE, {
                tasks: true, maps: true, swarm: true,
            });

            expect(result.domains).toBeDefined();
            expect(result.mapRoutes).toBeDefined();
            expect(result.requirements).toBeDefined();
            expect(result.swarmSessions).toBeDefined();
        });
    });
});
