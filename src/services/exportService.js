import call_rest_api from '../RestApi/RestApi';

/**
 * Fetch all user data for selected apps and assemble into nested hierarchy.
 * @param {string} darwinUri - API base URL
 * @param {string} userName - Cognito username (creator_fk filter)
 * @param {string} idToken - Auth token
 * @param {object} profile - User profile object
 * @param {object} selectedApps - { tasks: boolean, maps: boolean, swarm: boolean }
 */
export async function fetchExportData(darwinUri, userName, idToken, profile, selectedApps) {
    // Lambda-Rest returns 404 when a table has no rows — treat as empty array, not error.
    const safeGet = async (url) => {
        try {
            const result = await call_rest_api(url, 'GET', '', idToken);
            return result.data || [];
        } catch (e) {
            if (e.httpStatus?.httpStatus === 404) return [];
            throw e;
        }
    };

    const result = {
        exportVersion: '2.0',
        exportDate: new Date().toISOString(),
        selectedApps: { ...selectedApps },
        profile: {
            name: profile.name,
            email: profile.email,
            userName: profile.userName,
            timezone: profile.timezone,
            theme_mode: profile.theme_mode,
            app_tasks: profile.app_tasks,
            app_maps: profile.app_maps,
            app_swarm: profile.app_swarm,
        },
    };

    // Tasks: domains → areas → tasks (nested), recurring_tasks (flat)
    if (selectedApps.tasks) {
        const [domains, areas, tasks, recurringTasks] = await Promise.all([
            safeGet(`${darwinUri}/domains`),
            safeGet(`${darwinUri}/areas`),
            safeGet(`${darwinUri}/tasks`),
            safeGet(`${darwinUri}/recurring_tasks`),
        ]);

        const tasksByArea = {};
        for (const task of tasks) {
            const areaId = task.area_fk;
            if (!tasksByArea[areaId]) tasksByArea[areaId] = [];
            tasksByArea[areaId].push({
                id: task.id,
                description: task.description,
                priority: task.priority,
                done: task.done,
                sort_order: task.sort_order,
                recurring_task_fk: task.recurring_task_fk,
                create_ts: task.create_ts,
                update_ts: task.update_ts,
                done_ts: task.done_ts,
            });
        }

        const areasByDomain = {};
        for (const area of areas) {
            const domainId = area.domain_fk;
            if (!areasByDomain[domainId]) areasByDomain[domainId] = [];
            areasByDomain[domainId].push({
                id: area.id,
                area_name: area.area_name,
                closed: area.closed,
                sort_order: area.sort_order,
                sort_mode: area.sort_mode,
                create_ts: area.create_ts,
                update_ts: area.update_ts,
                tasks: tasksByArea[area.id] || [],
            });
        }

        result.domains = domains.map(domain => ({
            id: domain.id,
            domain_name: domain.domain_name,
            closed: domain.closed,
            sort_order: domain.sort_order,
            create_ts: domain.create_ts,
            update_ts: domain.update_ts,
            areas: areasByDomain[domain.id] || [],
        }));

        result.recurringTasks = recurringTasks.map(rt => ({
            id: rt.id,
            description: rt.description,
            recurrence: rt.recurrence,
            anchor_date: rt.anchor_date,
            area_fk: rt.area_fk,
            priority: rt.priority,
            accumulate: rt.accumulate,
            insert_position: rt.insert_position,
            active: rt.active,
            last_generated: rt.last_generated,
            create_ts: rt.create_ts,
            update_ts: rt.update_ts,
        }));
    }

    // Maps: routes (nested with runs → coordinates), views, partners, run_partners
    if (selectedApps.maps) {
        const [routes, runs, views, partners, runPartners] = await Promise.all([
            safeGet(`${darwinUri}/map_routes`),
            safeGet(`${darwinUri}/map_runs`),
            safeGet(`${darwinUri}/map_views`),
            safeGet(`${darwinUri}/map_partners`),
            safeGet(`${darwinUri}/map_run_partners`),
        ]);

        // GPS coordinates: fetched per-run when mapsGps is selected.
        // Bulk fetch of all coordinates exceeds Lambda timeout (100k+ rows).
        const coordsByRun = {};
        if (selectedApps.mapsGps && runs.length > 0) {
            const BATCH_SIZE = 15;
            for (let i = 0; i < runs.length; i += BATCH_SIZE) {
                const batch = runs.slice(i, i + BATCH_SIZE);
                const results = await Promise.all(
                    batch.map(run =>
                        safeGet(`${darwinUri}/map_coordinates?map_run_fk=${run.id}&sort=seq:asc`)
                    )
                );
                batch.forEach((run, idx) => {
                    const coords = results[idx];
                    if (coords.length > 0) {
                        coordsByRun[run.id] = coords.map(c => ({
                            seq: c.seq,
                            latitude: c.latitude,
                            longitude: c.longitude,
                            altitude: c.altitude,
                        }));
                    }
                });
            }
        }

        // Group runs by map_route_fk
        const runsByRoute = {};
        const unassignedRuns = [];
        for (const run of runs) {
            const cleanRun = {
                id: run.id,
                run_id: run.run_id,
                activity_id: run.activity_id,
                activity_name: run.activity_name,
                start_time: run.start_time,
                run_time_sec: run.run_time_sec,
                stopped_time_sec: run.stopped_time_sec,
                distance_mi: run.distance_mi,
                ascent_ft: run.ascent_ft,
                descent_ft: run.descent_ft,
                calories: run.calories,
                max_speed_mph: run.max_speed_mph,
                avg_speed_mph: run.avg_speed_mph,
                notes: run.notes,
                source: run.source,
                create_ts: run.create_ts,
                update_ts: run.update_ts,
            };
            if (coordsByRun[run.id]) {
                cleanRun.coordinates = coordsByRun[run.id];
            }

            if (run.map_route_fk) {
                if (!runsByRoute[run.map_route_fk]) runsByRoute[run.map_route_fk] = [];
                runsByRoute[run.map_route_fk].push(cleanRun);
            } else {
                unassignedRuns.push(cleanRun);
            }
        }

        result.mapRoutes = routes.map(route => ({
            id: route.id,
            route_id: route.route_id,
            name: route.name,
            create_ts: route.create_ts,
            update_ts: route.update_ts,
            runs: runsByRoute[route.id] || [],
        }));

        result.unassignedRuns = unassignedRuns;

        result.mapViews = views.map(v => ({
            id: v.id,
            name: v.name,
            criteria: v.criteria,
            sort_order: v.sort_order,
            create_ts: v.create_ts,
            update_ts: v.update_ts,
        }));

        result.mapPartners = partners.map(p => ({
            id: p.id,
            name: p.name,
            create_ts: p.create_ts,
            update_ts: p.update_ts,
        }));

        result.mapRunPartners = runPartners.map(rp => ({
            map_run_fk: rp.map_run_fk,
            map_partner_fk: rp.map_partner_fk,
            create_ts: rp.create_ts,
        }));
    }

    // Swarm: requirements, swarm_sessions, projects, categories,
    // features, test_cases, test_plans (req #2380 — persistent content).
    // test_runs and test_results are ephemeral execution data and NOT exported.
    // feature_test_cases and test_plan_cases are link-only junction tables and NOT exported.
    if (selectedApps.swarm) {
        const [requirements, swarmSessions, projects, categories,
               features, testCases, testPlans] = await Promise.all([
            safeGet(`${darwinUri}/requirements`),
            safeGet(`${darwinUri}/swarm_sessions`),
            safeGet(`${darwinUri}/projects`),
            safeGet(`${darwinUri}/categories`),
            safeGet(`${darwinUri}/features`),
            safeGet(`${darwinUri}/test_cases`),
            safeGet(`${darwinUri}/test_plans`),
        ]);

        result.requirements = requirements.map(p => ({
            id: p.id,
            title: p.title,
            description: p.description,
            requirement_status: p.requirement_status,
            coordination_type: p.coordination_type,
            sort_order: p.sort_order,
            started_at: p.started_at,
            completed_at: p.completed_at,
            deferred_at: p.deferred_at,
            project_fk: p.project_fk,
            category_fk: p.category_fk,
            create_ts: p.create_ts,
            update_ts: p.update_ts,
        }));

        result.swarmSessions = swarmSessions.map(s => ({
            id: s.id,
            branch: s.branch,
            task_name: s.task_name,
            source_type: s.source_type,
            source_ref: s.source_ref,
            title: s.title,
            pr_url: s.pr_url,
            swarm_status: s.swarm_status,
            worktree_path: s.worktree_path,
            started_at: s.started_at,
            completed_at: s.completed_at,
            start_summary: s.start_summary,
            complete_summary: s.complete_summary,
            telemetry: s.telemetry,
            plan: s.plan,
            create_ts: s.create_ts,
            update_ts: s.update_ts,
        }));

        result.projects = projects.map(p => ({
            id: p.id,
            project_name: p.project_name,
            sort_order: p.sort_order,
            closed: p.closed,
            create_ts: p.create_ts,
            update_ts: p.update_ts,
        }));

        result.categories = categories.map(c => ({
            id: c.id,
            category_name: c.category_name,
            project_fk: c.project_fk,
            sort_order: c.sort_order,
            sort_mode: c.sort_mode,
            color: c.color,
            closed: c.closed,
            create_ts: c.create_ts,
            update_ts: c.update_ts,
        }));

        result.features = features.map(f => ({
            id: f.id,
            title: f.title,
            description: f.description,
            feature_status: f.feature_status,
            category_fk: f.category_fk,
            closed: f.closed,
            sort_order: f.sort_order,
            create_ts: f.create_ts,
            update_ts: f.update_ts,
        }));

        result.testCases = testCases.map(tc => ({
            id: tc.id,
            title: tc.title,
            preconditions: tc.preconditions,
            steps: tc.steps,
            expected: tc.expected,
            test_type: tc.test_type,
            tags: tc.tags,
            category_fk: tc.category_fk,
            closed: tc.closed,
            sort_order: tc.sort_order,
            create_ts: tc.create_ts,
            update_ts: tc.update_ts,
        }));

        result.testPlans = testPlans.map(tp => ({
            id: tp.id,
            title: tp.title,
            description: tp.description,
            category_fk: tp.category_fk,
            closed: tp.closed,
            sort_order: tp.sort_order,
            create_ts: tp.create_ts,
            update_ts: tp.update_ts,
        }));
    }

    return result;
}

/**
 * Download a JS object as a pretty-printed JSON file.
 */
export function downloadJson(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}
