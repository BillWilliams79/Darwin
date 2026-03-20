import { useQuery } from '@tanstack/react-query';
import { useContext } from 'react';
import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { domainKeys, areaKeys, taskKeys, projectKeys, categoryKeys, priorityKeys, sessionKeys, devServerKeys, priorityCardOrderKeys, recurringTaskKeys, mapRunKeys, mapRouteKeys } from './useQueryKeys';

// Extract .data from the REST envelope, handle 404 as empty array
const fetchEntity = async (uri, idToken) => {
    try {
        const result = await call_rest_api(uri, 'GET', '', idToken);
        // call_rest_api returns (not throws) on network errors (e.g. CORS) with httpStatus 503
        // Treat non-2xx returns as errors so TanStack Query gets error state, not bad data
        if (result.httpStatus.httpStatus < 200 || result.httpStatus.httpStatus >= 300) {
            throw result;
        }
        return result.data;
    } catch (error) {
        if (error.httpStatus?.httpStatus === 404) {
            return [];
        }
        throw error;
    }
};

export function useDomains(creatorFk, { closed, fields = 'id,domain_name,sort_order', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const closedParam = closed !== undefined ? `&closed=${closed}` : '';
    const uri = `${darwinUri}/domains?fields=${fields}${closedParam}`;
    const queryKey = closed === 0 ? domainKeys.open(creatorFk)
        : closed === undefined ? domainKeys.withClosed(creatorFk)
        : domainKeys.all(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useAreas(creatorFk, domainId, { closed, fields = 'id,area_name,domain_fk,sort_order,sort_mode,creator_fk', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const closedParam = closed !== undefined ? `&closed=${closed}` : '';
    const uri = `${darwinUri}/areas?domain_fk=${domainId}&fields=${fields}${closedParam}`;
    const queryKey = closed === 0 ? areaKeys.byDomainOpen(creatorFk, domainId)
        : closed === undefined ? areaKeys.byDomainWithClosed(creatorFk, domainId)
        : areaKeys.byDomain(creatorFk, domainId);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!domainId && !!idToken,
    });
}

export function useAllAreas(creatorFk, { fields = 'id,domain_fk', closed, enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const closedParam = closed !== undefined ? `&closed=${closed}` : '';
    const uri = `${darwinUri}/areas?fields=${fields}${closedParam}`;

    return useQuery({
        queryKey: closed !== undefined ? [...areaKeys.all(creatorFk), { closed }] : areaKeys.all(creatorFk),
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useTasks(creatorFk, areaId, { done = 0, fields = 'id,priority,done,description,area_fk,sort_order', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/tasks?done=${done}&area_fk=${areaId}&fields=${fields}`;
    const queryKey = taskKeys.byAreaOpen(creatorFk, areaId);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!areaId && !!idToken,
    });
}

export function useTasksDone(creatorFk, startStr, endStr, { fields = 'id,priority,done,description,done_ts', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/tasks?done=1&filter_ts=(done_ts,${startStr},${endStr})&fields=${fields}`;
    const queryKey = taskKeys.done(creatorFk, `${startStr}_${endStr}`);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!startStr && !!endStr && !!idToken,
    });
}

export function useTaskCounts(creatorFk, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/tasks?fields=count(*),area_fk`;
    const queryKey = taskKeys.counts(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useProjects(creatorFk, { closed, fields = 'id,project_name,sort_order', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const closedParam = closed !== undefined ? `&closed=${closed}` : '';
    const uri = `${darwinUri}/projects?fields=${fields}${closedParam}`;
    const queryKey = closed === 0 ? projectKeys.open(creatorFk)
        : closed === undefined ? projectKeys.withClosed(creatorFk)
        : projectKeys.all(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useCategories(creatorFk, projectId, { closed, fields = 'id,category_name,project_fk,sort_order,sort_mode,creator_fk', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const closedParam = closed !== undefined ? `&closed=${closed}` : '';
    const uri = `${darwinUri}/categories?project_fk=${projectId}&fields=${fields}${closedParam}`;
    const queryKey = closed === 0 ? categoryKeys.byProjectOpen(creatorFk, projectId)
        : closed === undefined ? categoryKeys.byProjectWithClosed(creatorFk, projectId)
        : categoryKeys.byProject(creatorFk, projectId);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!projectId && !!idToken,
    });
}

export function usePriorities(creatorFk, categoryId, { closed, fields = 'id,title,in_progress,closed,scheduled,category_fk,sort_order,completed_at', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const closedParam = closed !== undefined ? `&closed=${closed}` : '';
    const uri = `${darwinUri}/priorities?category_fk=${categoryId}&fields=${fields}${closedParam}`;
    const queryKey = closed === 0 ? priorityKeys.byCategoryOpen(creatorFk, categoryId)
        : closed === undefined ? priorityKeys.byCategoryWithClosed(creatorFk, categoryId)
        : priorityKeys.byCategory(creatorFk, categoryId);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!categoryId && !!idToken,
    });
}

export function useSessions(creatorFk, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/swarm_sessions`;
    const queryKey = sessionKeys.all(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useSession(sessionId, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/swarm_sessions?id=${sessionId}`;
    const queryKey = sessionKeys.byId(sessionId);

    return useQuery({
        queryKey,
        queryFn: async () => {
            const data = await fetchEntity(uri, idToken);
            return data.length > 0 ? data[0] : null;
        },
        enabled: enabled && !!sessionId && !!idToken,
    });
}

export function usePrioritiesDone(creatorFk, startStr, endStr, { fields = 'id,title,completed_at', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/priorities?closed=1&filter_ts=(completed_at,${startStr},${endStr})&fields=${fields}`;
    const queryKey = priorityKeys.done(creatorFk, `${startStr}_${endStr}`);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!startStr && !!endStr && !!idToken,
    });
}

export function useAllPriorities(creatorFk, { fields = 'id,title', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/priorities?fields=${fields}`;
    const queryKey = priorityKeys.all(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useDevServers(creatorFk, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/dev_servers`;
    const queryKey = devServerKeys.all(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function usePriorityTasks(creatorFk, domainId, areaIds, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/tasks?priority=1&done=0&area_fk=(${areaIds.join(',')})&fields=id,priority,done,description,area_fk,sort_order`;
    const queryKey = taskKeys.priorityByDomain(creatorFk, domainId, areaIds);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!domainId && areaIds.length > 0 && !!idToken,
    });
}

export function usePriorityCardOrder(creatorFk, domainId, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/priority_card_order?domain_id=${domainId}&fields=id,task_id,sort_order&sort=sort_order:asc`;
    const queryKey = priorityCardOrderKeys.byDomain(creatorFk, domainId);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!domainId && !!idToken,
    });
}

export function useDevServersBySession(sessionId, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/dev_servers?session_fk=${sessionId}`;
    const queryKey = devServerKeys.bySession(sessionId);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!sessionId && !!idToken,
    });
}

export function useRecurringTasks(creatorFk, {
    fields = 'id,description,recurrence,anchor_date,area_fk,priority,accumulate,insert_position,active,last_generated',
    enabled = true
} = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/recurring_tasks?fields=${fields}`;
    const queryKey = recurringTaskKeys.all(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useMapRuns(creatorFk, {
    fields = 'id,run_id,map_route_fk,activity_id,activity_name,start_time,run_time_sec,stopped_time_sec,distance_mi,ascent_ft,descent_ft,calories,max_speed_mph,avg_speed_mph,notes',
    enabled = true
} = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/map_runs?fields=${fields}&sort=start_time:desc`;
    const queryKey = mapRunKeys.all(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useMapRoutes(creatorFk, { fields = 'id,route_id,name', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/map_routes?fields=${fields}`;
    const queryKey = mapRouteKeys.all(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}
