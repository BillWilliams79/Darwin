import call_rest_api from '../RestApi/RestApi';

/**
 * Fetch all user data and assemble into nested hierarchy.
 * Returns { exportVersion, exportDate, profile, domains[], priorities[], swarmSessions[] }
 */
export async function fetchExportData(darwinUri, userName, idToken, profile) {
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

    const [domains, areas, tasks, priorities, swarmSessions] = await Promise.all([
        safeGet(`${darwinUri}/domains`),
        safeGet(`${darwinUri}/areas`),
        safeGet(`${darwinUri}/tasks`),
        safeGet(`${darwinUri}/priorities`),
        safeGet(`${darwinUri}/swarm_sessions`),
    ]);

    // Group tasks by area_fk
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
            create_ts: task.create_ts,
            update_ts: task.update_ts,
            done_ts: task.done_ts,
        });
    }

    // Group areas by domain_fk, attach tasks
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

    // Build nested domains
    const nestedDomains = domains.map(domain => ({
        id: domain.id,
        domain_name: domain.domain_name,
        closed: domain.closed,
        sort_order: domain.sort_order,
        create_ts: domain.create_ts,
        update_ts: domain.update_ts,
        areas: areasByDomain[domain.id] || [],
    }));

    // Strip internal FKs from priorities
    const cleanPriorities = priorities.map(p => ({
        id: p.id,
        title: p.title,
        description: p.description,
        priority_status: p.priority_status,
        scheduled: p.scheduled,
        sort_order: p.sort_order,
        started_at: p.started_at,
        completed_at: p.completed_at,
        create_ts: p.create_ts,
        update_ts: p.update_ts,
    }));

    // Strip internal FKs from swarm sessions
    const cleanSessions = swarmSessions.map(s => ({
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
        create_ts: s.create_ts,
        update_ts: s.update_ts,
    }));

    return {
        exportVersion: '1.0',
        exportDate: new Date().toISOString(),
        profile: {
            name: profile.name,
            email: profile.email,
            userName: profile.userName,
        },
        domains: nestedDomains,
        priorities: cleanPriorities,
        swarmSessions: cleanSessions,
    };
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
