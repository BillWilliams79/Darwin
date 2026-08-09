import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useContext, useMemo } from 'react';
import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import { domainKeys, areaKeys, taskKeys, projectKeys, categoryKeys, requirementKeys, priorityCardOrderKeys, recurringTaskKeys, mapRunKeys, mapRouteKeys, mapCoordinateKeys, mapViewKeys, mapPartnerKeys, mapRunPartnerKeys, epicKeys, featureKeys, testCaseKeys, featureTestCaseKeys, testPlanKeys, testPlanCaseKeys, testRunKeys, testResultKeys, customerKeys, buildProjectKeys, branchKeys, buildKeys, customerReleaseKeys } from './useQueryKeys';
import { devServers, sessions, swarmStarts, swarmStartSessions, swarmUndos, swarmCompletes, swarmCompleteSessions, machines, agents, instructions, architectureDocuments, agentDocuments, agentInstructions, agentTelemetryRuns, agentTelemetryRows, agentTelemetryRowDocs, orchestrationClaims, pipelines, pipelineSteps, pipelineStepRequirements, pipelineStepDeps, requirementSessions, sessionCostRollups } from './factory/devopsQueries';
// `fetchEntity` is shared with the factory so both layers handle REST errors
// identically (req #2593).
import { fetchEntity } from './factory/createEntityQueries';
// req #3166 — THE batched GET /map_coordinates, shared with the export paths.
import { fetchCoordinatesForRuns, buildRunTrackUri, COORD_TRACK_FIELDS } from '../services/mapCoordinatesBatch';
// req #3180 — THE browser's one derivation of pipeline-step membership.
import { pipelinedRequirementIds } from '../utils/pipelineMembership';
import { epicRequirementIds } from '../utils/epicMembership';

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

export function useCategoryColors(creatorFk, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/categories?fields=id,color`;
    const queryKey = categoryKeys.colors(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useCategories(creatorFk, projectId, { closed, fields = 'id,category_name,project_fk,sort_order,sort_mode,color,creator_fk', enabled = true } = {}) {
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

export function useAllCategories(creatorFk, { fields = 'id,project_fk', closed, enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const closedParam = closed !== undefined ? `&closed=${closed}` : '';
    const uri = `${darwinUri}/categories?fields=${fields}${closedParam}`;

    // Key on `fields` too: different callers request different column sets (e.g.
    // RequirementsTrendsView needs `closed`, CalendarFC does not). Without this,
    // a shorter-field response could be served from cache and silently drop a
    // column the consumer relies on (req #2821). This must hold regardless of
    // `closed` — keying on `{closed}` alone let same-`closed` callers with
    // different `fields` collide and serve each other's narrower column set
    // (req #3015).
    return useQuery({
        queryKey: [...categoryKeys.all(creatorFk), { closed, fields }],
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useRequirementCounts(creatorFk, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/requirements?fields=count(*),category_fk`;
    const queryKey = requirementKeys.counts(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

// `feature_fk` joined the projection with req #3114 (column added by #3111
// migration 076). It is where the Epic > Feature > Story hierarchy attaches —
// design rule 10 puts epic/feature labels on the REQUIREMENT and never on the
// plan step, so any surface that wants to show them needs the column. A NULL-able
// INT costs nothing on the wire, and this key already carries no `fields`, so
// widening it cannot collide (the callers here all take the default).
export function useRequirements(creatorFk, categoryId, { fields = 'id,title,requirement_status,category_fk,completed_at,deferred_at,started_at,coordination_type,ai_model,effort,machine_fk,feature_fk,sort_order', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/requirements?category_fk=${categoryId}&fields=${fields}`;
    const queryKey = requirementKeys.byCategoryWithClosed(creatorFk, categoryId);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!categoryId && !!idToken,
    });
}

// Req #2593 — devops query hooks produced by createEntityQueries.
// See factory/devopsQueries.js. Public names + signatures preserved verbatim
// for backwards compat (parity locked in __tests__/devopsQueriesParity.test.js).
export const useSessions = sessions.useAll;
export const useSession  = sessions.useById;

// Req #2422 — swarm_starts: list every /swarm-start invocation, newest first.
// Default fields include the captured invocation metadata + finalize-time
// summary/telemetry/token rollups. `fields` is in the cache key (req #2213) so
// callers requesting different projections don't collide on a shared cache entry.
// TEXT columns (start_summary, telemetry) are <3KB each at typical scale, so
// including them in the list query is acceptable; the detail dialog reads them
// without a separate fetch.
//
// Req #2593 — produced by createEntityQueries via factory/devopsQueries.js.
export const useAllSwarmStarts        = swarmStarts.useAll;
export const useSwarmStartById        = swarmStarts.useById;
export const useAllSwarmStartSessions = swarmStartSessions.useAll;

// Req #2719 — swarm_undos: one row per /swarm-undo invocation. Snapshot
// columns (swarm_start_fk_at_undo, req_id_at_undo, …) outlive the cascading
// session delete that /swarm-undo performs, so the visualizer can match
// surviving swarm_starts against undone sessions.
export const useAllSwarmUndos = swarmUndos.useAll;
export const useSwarmUndoById = swarmUndos.useById;

// Req #2497 — swarm_completes: one row per /swarm-complete or
// /primary-ai-swarm-complete invocation (the close-out counterpart to
// swarm_starts). swarm_complete_sessions links a close-out to the session(s)
// it closed; primary closeouts link a `primary-fix` session.
export const useAllSwarmCompletes        = swarmCompletes.useAll;
export const useSwarmCompleteById        = swarmCompletes.useById;
export const useAllSwarmCompleteSessions = swarmCompleteSessions.useAll;

export function useRequirementsByStatus(creatorFk, status, { fields = 'id,title,requirement_status,coordination_type,ai_model,effort,machine_fk,category_fk', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/requirements?requirement_status=${status}&fields=${fields}`;
    const queryKey = requirementKeys.byStatus(creatorFk, status);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!status && !!idToken,
    });
}

// Backwards-compat wrapper: previous single-status consumer.
export function useSwarmReadyRequirements(creatorFk, options = {}) {
    return useRequirementsByStatus(creatorFk, 'swarm_ready', options);
}

export function useRequirementsDone(creatorFk, startStr, endStr, { fields = 'id,title,completed_at', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/requirements?requirement_status=met&filter_ts=(completed_at,${startStr},${endStr})&fields=${fields}`;
    // Include `fields` in the cache key (mirrors useAllRequirements) — multiple
    // consumers hit this hook for the SAME window with DIFFERENT projections
    // (SwarmStartCard needs ai_model,effort for its Model/Effort chips; CalendarFC
    // does not). Without `fields` in the key they'd share one cache entry and the
    // narrower fetch could win, blanking the Model/Effort columns to fallbacks
    // (req #3029). Prefix invalidation via requirementKeys.all still matches.
    const queryKey = [...requirementKeys.done(creatorFk, `${startStr}_${endStr}`), { fields }];

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!startStr && !!endStr && !!idToken,
        // Visualizer Sidewalk/Elevator scroll slides this date window as the
        // centered day changes, producing a new query key per window. Keep the
        // previous window's rows on screen while the next window loads so the
        // strip scrolls smoothly instead of blanking out and re-rendering on
        // every refetch (req #2777).
        placeholderData: keepPreviousData,
    });
}

export function useAllRequirements(creatorFk, { fields = 'id,title', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/requirements?fields=${fields}`;
    // Include `fields` in the cache key so callers requesting different projections
    // (e.g. DevServersView wants id,title; SwarmStartCard wants id,requirement_status)
    // don't collide on a shared cache entry and render missing columns.
    // `requirementKeys.all(creatorFk)` stays the invalidation prefix — adding a trailing
    // `{ fields }` object still invalidates via TanStack Query's prefix match.
    const queryKey = [...requirementKeys.all(creatorFk), { fields }];

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

// Req #2593 — produced by createEntityQueries via factory/devopsQueries.js.
export const useDevServers = devServers.useAll;

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

// Req #2593 — produced by createEntityQueries via factory/devopsQueries.js.
export const useDevServersBySession = devServers.useBySession;

// Req #2943 — machines registry: which machine ran a session / start / dev-server
// claim. useMachines drives the /swarm/machines management page AND the client-
// side id→title resolution for the Machine columns on Sessions / Starts / Dev
// Servers. machineKeys.all(creatorFk) is the invalidation prefix after an inline
// rename / close.
export const useMachines = machines.useAll;
export const useMachine  = machines.useById;
export const machineKeys = machines.keys;

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

export function useMapRunsDone(creatorFk, startStr, endStr, {
    fields = 'id,activity_name,map_route_fk,start_time,run_time_sec,distance_mi,avg_speed_mph',
    enabled = true
} = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/map_runs?filter_ts=(start_time,${startStr},${endStr})&fields=${fields}&sort=start_time:asc`;
    const queryKey = mapRunKeys.done(creatorFk, `${startStr}_${endStr}`);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!startStr && !!endStr && !!idToken,
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

// A finished ride's GPS track NEVER changes — the importer writes coordinates
// once and nothing in Darwin edits them, which is why no invalidation site for
// mapCoordinateKeys exists anywhere in src/. So the client-wide staleTime of 30 s
// and refetchOnWindowFocus: true buy nothing here and cost a great deal: the
// RouteCardView "All" page size mounts up to 300 RouteMapThumbnails, and every
// one of them re-requested its whole track on each tab refocus and each remount
// past the 30 s mark (req #3166 item 3). Infinity + no refocus refetch makes a
// track load exactly once per cache lifetime, and matches what
// useMapCoordinatesForRuns already did for the same rows.
export function useMapCoordinates(runId, { fields = COORD_TRACK_FIELDS, enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = buildRunTrackUri(darwinUri, runId, fields);
    const queryKey = mapCoordinateKeys.byRun(runId);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!runId && !!idToken,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    });
}

// Combined tracks for a set of runs (req #3158 — the /maps aggregator card;
// batched by req #3166).
//
// ONE aggregate query per distinct run-id set, and inside it a BATCHED read:
// services/mapCoordinatesBatch.js asks Lambda-Rest for many runs per request via
// the `?map_run_fk=(1,2,3)` IN filter, packed against a measured row budget. At
// 200 runs that is ~3 requests where the per-run fan-out made 200 — the point of
// req #3166 item 2.
//
// Cache sharing with the per-ride thumbnails survives the change and is the
// reason for the shape here. Every run the batch fetches is written back into
// mapCoordinateKeys.byRun, in the same row shape useMapCoordinates would have
// stored (same `buildRunTrackUri` field list, `map_run_fk` stripped), so the card
// and RouteMapThumbnail still share one cached track per run in both directions.
// Deliberately takes no `fields` option: that sharing is only correct while every
// writer of these entries requests the same row shape.
//
// THE SHARING HAS THREE CASES, NOT TWO, AND THE THIRD IS THE EXPENSIVE ONE TO
// MISS. RouteCardView renders MapAggregatorCard and the RouteCards in the SAME
// commit, so on a cold cache this hook runs while N RouteMapThumbnails are
// already fetching those very runs. `getQueryData` returns undefined for a query
// that is fetching for the first time — indistinguishable from an absent one — so
// treating "no data" as "must batch" fetches every visible run's rows TWICE. At
// the "All" page size (up to 300 runs, the case req #3166 item 3 names) that is
// 100% duplication: fewer requests than the old fan-out, but more bytes and more
// Lambda invocations than before the change. So an in-flight per-run query is
// JOINED via ensureQueryData — no new request, and it settles into the same entry.
//
// staleTime: Infinity for the same immutability reason as useMapCoordinates
// above. Any failed batch fails the whole aggregate loudly (isError) instead of
// quietly rendering fewer tracks than rides.
export function useMapCoordinatesForRuns(runIds = [], { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const queryClient = useQueryClient();

    const sortedIds = [...runIds].map(Number).sort((a, b) => a - b);
    return useQuery({
        queryKey: ['map_coordinates', 'aggregate', sortedIds],
        queryFn: async () => {
            const byRun = new Map();
            const missing = [];
            const inFlight = [];
            for (const runId of sortedIds) {
                const state = queryClient.getQueryState(mapCoordinateKeys.byRun(runId));
                if (state?.data) byRun.set(runId, state.data);
                else if (state?.fetchStatus === 'fetching') inFlight.push(runId);
                else missing.push(runId);
            }

            // Joins the thumbnail's own in-flight promise; issues a request only
            // if that query has since settled without data.
            await Promise.all(inFlight.map(async (runId) => {
                byRun.set(runId, await queryClient.ensureQueryData({
                    queryKey: mapCoordinateKeys.byRun(runId),
                    queryFn: () => fetchEntity(buildRunTrackUri(darwinUri, runId), idToken),
                    staleTime: Infinity,
                }));
            }));

            if (missing.length > 0) {
                // fetchEntity directly rather than queryClient.fetchQuery: a
                // batch response spans many runs, so it maps to no single per-run
                // cache key. `onTracks` seeds each batch AS IT LANDS, so the
                // client-wide retry: 2 re-reads only what never arrived — without
                // it, one failed batch would discard every successful one and
                // triple the whole transfer.
                await fetchCoordinatesForRuns({
                    fetchJson: uri => fetchEntity(uri, idToken),
                    darwinUri,
                    runIds: missing,
                    onTracks: (tracks) => {
                        for (const [runId, track] of tracks) {
                            queryClient.setQueryData(mapCoordinateKeys.byRun(runId), track);
                            byRun.set(runId, track);
                        }
                    },
                });
            }

            return sortedIds.map(runId => byRun.get(runId) || []);
        },
        enabled: enabled && runIds.length > 0 && !!idToken,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        // A filter change mints a new aggregate key; without this the map
        // blanks to a spinner even though every per-run track is already
        // cached. Callers gate on runs.length so the placeholder can never
        // outlive the run set that produced it.
        placeholderData: keepPreviousData,
    });
}

export function useMapViews(creatorFk, { fields = 'id,name,criteria,sort_order', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/map_views?fields=${fields}&sort=sort_order:asc,create_ts:asc`;
    const queryKey = mapViewKeys.all(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useMapPartners(creatorFk, { fields = 'id,name', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/map_partners?fields=${fields}&sort=name:asc`;
    const queryKey = mapPartnerKeys.all(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useMapRunPartners(creatorFk, { fields = 'id,map_run_fk,map_partner_fk', enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const uri = `${darwinUri}/map_run_partners?fields=${fields}`;
    const queryKey = mapRunPartnerKeys.all(creatorFk);

    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

// ---------------------------------------------------------------------------
// Req #2380 — Swarm Features & Test Cases registry
// `fields` is included in every extended query key (req #2213 — avoids cache collisions
// across callers with different projections).
// ---------------------------------------------------------------------------

// `epic_fk` (req #3111 migration 076) joined both projections with req #3114:
// features are the middle tier of Epic > Feature > Story, and the plan table
// walks requirement -> feature -> epic to derive a step's dominant label
// (design rule 10). Both keys already carry `fields`, so widening them cannot
// collide with a narrower caller (req #2213).
const FEATURE_DEFAULT_FIELDS = 'id,title,feature_status,epic_fk,category_fk,closed,sort_order,create_ts';
const FEATURE_FULL_FIELDS    = 'id,title,description,feature_status,epic_fk,category_fk,creator_fk,closed,sort_order,create_ts,update_ts';
const TESTCASE_DEFAULT_FIELDS = 'id,title,test_type,tags,category_fk,closed,sort_order,create_ts';
const TESTCASE_FULL_FIELDS    = 'id,title,preconditions,steps,expected,test_type,tags,category_fk,creator_fk,closed,sort_order,create_ts,update_ts';
const TESTPLAN_DEFAULT_FIELDS = 'id,title,description,category_fk,closed,sort_order,create_ts';
const TESTPLANCASE_FIELDS = 'test_plan_fk,test_case_fk,sort_order';
const TESTRUN_DEFAULT_FIELDS = 'id,test_plan_fk,run_status,started_at,completed_at,notes,create_ts';
const TESTRESULT_FIELDS = 'id,test_run_fk,test_case_fk,result_status,actual,notes,executed_at,create_ts';

// "Do not filter on `closed` at all" (req #3114).
//
// A SENTINEL STRING, not `undefined`, and that distinction is load-bearing:
// TanStack Query hashes a query key with JSON.stringify, which DROPS properties
// whose value is `undefined`. `{ fields, closed: undefined }` and `{ fields }`
// therefore hash to the SAME key — two reads with different URLs sharing one
// cache entry, with whichever observer registered first deciding what a refetch
// actually fetches. A string survives the hash and keeps them apart.
export const ALL_ROWS = 'all';

// ----- epics (req #3111 migration 076; hooks req #3114) -----
//
// The top tier of Epic > Feature > Story. Hand-written here rather than as a
// `createEntityQueries` block because this is the agile hierarchy's home — epics
// sits directly above the features hooks below it and shares their conventions
// (fields-in-key, sort_order:asc, an explicit `closed` filter). The four
// EXECUTION tables of the same feature — pipelines, pipeline_steps and their two
// link tables — ARE factory blocks, in factory/devopsQueries.js.
//
// `closed` defaults to ALL_ROWS = fetch every epic, deliberately unlike the
// features hooks. Epics here are read as a LABEL DICTIONARY (step -> dominant
// epic, design rule 10), not as a browsable catalog: filtering closed rows out
// would blank the Epic column on plan rows whose epic has since been closed,
// which reads as a data bug rather than as a filter.
// `epic_status` (req #3223, migration 20260801125029) — suppression, not
// lifecycle: whether this epic's scope may be swarm-started. Carried here so
// every label-dictionary reader (the plan visualizer's pause bubble, req
// #3226) gets it for free, the same way `closed` already rides along.
const EPIC_DEFAULT_FIELDS =
    'id,title,description,category_fk,closed,epic_status,sort_order,create_ts';

export function useAllEpics(creatorFk,
    { fields = EPIC_DEFAULT_FIELDS, closed = ALL_ROWS, enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const closedParam = closed === ALL_ROWS ? '' : `closed=${closed}&`;
    const uri = `${darwinUri}/epics?${closedParam}fields=${fields}&sort=sort_order:asc`;
    // `closed` is always in the key and always a stringify-surviving value, so
    // the filtered and unfiltered reads can never collide (see ALL_ROWS above).
    const queryKey = [...epicKeys.all(creatorFk), { fields, closed }];
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useEpicById(creatorFk, id, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/epics?id=${id}&fields=${EPIC_DEFAULT_FIELDS}`;
    const queryKey = epicKeys.byId(creatorFk, id);
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        // `creatorFk` in the enabled gate matches every other hook in this file
        // (code review, req #3234) — it is already in `queryKey`, so firing
        // without it would cache a row under `['epics', undefined, {id}]`, a
        // key the `epicKeys.all(creatorFk)` prefix invalidation used elsewhere
        // can never reach.
        enabled: enabled && !!creatorFk && !!id && !!idToken,
    });
}

// ----- features -----

// `closed` defaults to 0 — the historical behavior every existing caller relies
// on (a browsable catalog hides closed rows). Req #3114 added the option so the
// plan table can pass ALL_ROWS and read features as a LABEL DICTIONARY, for the
// same reason spelled out on useAllEpics above.
//
// `closed` is ALWAYS in the cache key. That does change the key for existing
// callers (from `{fields}` to `{fields, closed: 0}`), which is safe because both
// of them invalidate by the `featureKeys.all` PREFIX and nothing reconstructs the
// full key — and it is the only shape that cannot collide: a key that omits the
// filter for one value and includes it for another is one JSON.stringify quirk
// away from serving the wrong rows.
export function useAllFeatures(creatorFk,
    { fields = FEATURE_DEFAULT_FIELDS, closed = 0, enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const closedParam = closed === ALL_ROWS ? '' : `closed=${closed}&`;
    const uri = `${darwinUri}/features?${closedParam}fields=${fields}&sort=sort_order:asc`;
    const queryKey = [...featureKeys.all(creatorFk), { fields, closed }];
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useFeaturesByCategory(creatorFk, categoryId, { fields = FEATURE_DEFAULT_FIELDS, enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/features?category_fk=${categoryId}&closed=0&fields=${fields}&sort=sort_order:asc`;
    const queryKey = [...featureKeys.byCategory(creatorFk, categoryId), { fields }];
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!categoryId && !!idToken,
    });
}

export function useFeatureById(creatorFk, id, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/features?id=${id}&fields=${FEATURE_FULL_FIELDS}`;
    const queryKey = featureKeys.byId(creatorFk, id);
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        // See useEpicById's identical comment (code review, req #3234).
        enabled: enabled && !!creatorFk && !!id && !!idToken,
    });
}

// ----- test_cases -----

export function useAllTestCases(creatorFk, { fields = TESTCASE_DEFAULT_FIELDS, enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/test_cases?closed=0&fields=${fields}&sort=sort_order:asc`;
    const queryKey = [...testCaseKeys.all(creatorFk), { fields }];
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useTestCaseById(creatorFk, id, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/test_cases?id=${id}&fields=${TESTCASE_FULL_FIELDS}`;
    const queryKey = testCaseKeys.byId(creatorFk, id);
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!id && !!idToken,
    });
}

// Full feature_test_cases link table. The callers (coverage indicator, link-check)
// compute coverage client-side by joining against the features list.
export function useFeatureTestCaseLinks(creatorFk, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/feature_test_cases?fields=feature_fk,test_case_fk`;
    const queryKey = featureTestCaseKeys.all(creatorFk);
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

// ----- test_plans -----

export function useAllTestPlans(creatorFk, { fields = TESTPLAN_DEFAULT_FIELDS, enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/test_plans?closed=0&fields=${fields}&sort=sort_order:asc`;
    const queryKey = [...testPlanKeys.all(creatorFk), { fields }];
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useTestPlanById(creatorFk, id, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/test_plans?id=${id}&fields=${TESTPLAN_DEFAULT_FIELDS}`;
    const queryKey = testPlanKeys.byId(creatorFk, id);
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!id && !!idToken,
    });
}

// Cases contained in one plan, in sort_order (for Plan Detail / DnD reorder).
export function useTestPlanCases(creatorFk, planId, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/test_plan_cases?test_plan_fk=${planId}&fields=${TESTPLANCASE_FIELDS}&sort=sort_order:asc`;
    const queryKey = testPlanCaseKeys.byPlan(creatorFk, planId);
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!planId && !!idToken,
    });
}

// ----- test_runs + test_results -----

export function useAllTestRuns(creatorFk, { fields = TESTRUN_DEFAULT_FIELDS, enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/test_runs?fields=${fields}&sort=started_at:desc`;
    const queryKey = [...testRunKeys.all(creatorFk), { fields }];
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useTestRunById(creatorFk, id, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/test_runs?id=${id}&fields=${TESTRUN_DEFAULT_FIELDS}`;
    const queryKey = testRunKeys.byId(creatorFk, id);
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!id && !!idToken,
    });
}

export function useTestRunsByPlan(creatorFk, planId, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/test_runs?test_plan_fk=${planId}&fields=${TESTRUN_DEFAULT_FIELDS}&sort=started_at:desc`;
    const queryKey = testRunKeys.byPlan(creatorFk, planId);
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!planId && !!idToken,
    });
}

export function useTestResultsByRun(creatorFk, runId, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/test_results?test_run_fk=${runId}&fields=${TESTRESULT_FIELDS}`;
    const queryKey = testResultKeys.byRun(creatorFk, runId);
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!runId && !!idToken,
    });
}

// ----- customers (req #2604) -----

const CUSTOMER_DEFAULT_FIELDS = 'id,customer_name,description,closed,sort_order,create_ts';
const CUSTOMER_FULL_FIELDS    = 'id,customer_name,description,creator_fk,closed,sort_order,create_ts,update_ts';

export function useAllCustomers(creatorFk, { fields = CUSTOMER_DEFAULT_FIELDS, enabled = true } = {}) {
    const { darwinBuildVizUri: darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/customers?closed=0&fields=${fields}&sort=sort_order:asc`;
    const queryKey = [...customerKeys.all(creatorFk), { fields }];
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useCustomerById(creatorFk, id, { enabled = true } = {}) {
    const { darwinBuildVizUri: darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/customers?id=${id}&fields=${CUSTOMER_FULL_FIELDS}`;
    const queryKey = customerKeys.byId(creatorFk, id);
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!id && !!idToken,
    });
}

// ----- build_projects / branches / builds / customer_releases (req #2606) -----

const BUILD_PROJECT_DEFAULT_FIELDS = 'id,title,description,project_status,trunk_branch_fk,category_fk,creator_fk,create_ts';
const BRANCH_DEFAULT_FIELDS        = 'id,project_fk,branch_type,name,major,minor,parent_build_fk,side,row_order,label_end,sort_order,creator_fk';
const BUILD_DEFAULT_FIELDS         = 'id,branch_fk,position,build_number,branch_number,dot_color,approved_for_release,creator_fk';
const CUSTOMER_RELEASE_DEFAULT_FIELDS = 'id,customer_fk,build_fk,release_notes,creator_fk,create_ts,update_ts';

export function useAllBuildProjects(creatorFk, { fields = BUILD_PROJECT_DEFAULT_FIELDS, enabled = true } = {}) {
    const { darwinBuildVizUri: darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/build_projects?fields=${fields}`;
    const queryKey = [...buildProjectKeys.all(creatorFk), { fields }];
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useAllBranches(creatorFk, { fields = BRANCH_DEFAULT_FIELDS, enabled = true } = {}) {
    const { darwinBuildVizUri: darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/branches?fields=${fields}`;
    const queryKey = [...branchKeys.all(creatorFk), { fields }];
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useAllBuilds(creatorFk, { fields = BUILD_DEFAULT_FIELDS, enabled = true } = {}) {
    const { darwinBuildVizUri: darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/builds?fields=${fields}`;
    const queryKey = [...buildKeys.all(creatorFk), { fields }];
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useAllCustomerReleases(creatorFk, { fields = CUSTOMER_RELEASE_DEFAULT_FIELDS, enabled = true } = {}) {
    const { darwinBuildVizUri: darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/customer_releases?fields=${fields}`;
    const queryKey = [...customerReleaseKeys.all(creatorFk), { fields }];
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!idToken,
    });
}

export function useCustomerReleasesByBuild(creatorFk, buildId, { enabled = true } = {}) {
    const { darwinBuildVizUri: darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const uri = `${darwinUri}/customer_releases?build_fk=${buildId}&fields=${CUSTOMER_RELEASE_DEFAULT_FIELDS}`;
    const queryKey = customerReleaseKeys.byBuild(creatorFk, buildId);
    return useQuery({
        queryKey,
        queryFn: () => fetchEntity(uri, idToken),
        enabled: enabled && !!creatorFk && !!buildId && !!idToken,
    });
}

// Req #2997 / #2998 — agents registry. Five hooks families drive /agents,
// /agents/:id, /agents/instructions, and /agents/documents. The two junctions
// expose no byId hook (composite PK, no `id` column); the UI joins them
// client-side against the agent / instruction / document rows.
export const useAgents     = agents.useAll;
export const useAgent      = agents.useById;
export const agentKeys     = agents.keys;

export const useInstructions   = instructions.useAll;
export const useInstruction    = instructions.useById;
export const instructionKeys   = instructions.keys;

export const useArchitectureDocuments = architectureDocuments.useAll;
export const useArchitectureDocument  = architectureDocuments.useById;
export const architectureDocumentKeys = architectureDocuments.keys;

export const useAgentDocuments    = agentDocuments.useAll;
export const agentDocumentKeys    = agentDocuments.keys;

export const useAgentInstructions = agentInstructions.useAll;
export const agentInstructionKeys = agentInstructions.keys;

// Req #3031 — agent context telemetry. The run list drives the /agents/context
// run picker; the per-agent rows (fetched by run_fk) drive the table body.
export const useAgentTelemetryRuns      = agentTelemetryRuns.useAll;
export const useAgentTelemetryRun       = agentTelemetryRuns.useById;
export const agentTelemetryRunKeys      = agentTelemetryRuns.keys;
export const useAgentTelemetryRowsByRun = agentTelemetryRows.useByRun;
export const agentTelemetryRowKeys      = agentTelemetryRows.keys;
// Req #3096 — per-document breakdown. ContextPage.jsx achieves laziness by only
// mounting the consumer component while a row is expanded (conditional mount, not
// a conditional hook call) rather than passing an `enabled` option here — either
// approach works, but a future caller reusing this hook can pick whichever fits.
export const useAgentTelemetryRowDocsByRow = agentTelemetryRowDocs.useByRow;
export const agentTelemetryRowDocKeys      = agentTelemetryRowDocs.keys;

// Req #3114 — Swarm Orchestration pipelines (schema req #3111). Four bounded
// list reads; /swarm/pipelines and /swarm/pipeline/:id join them client-side in
// a useMemo.
//
// ONLY list hooks are exported, including for `pipelines` itself: the junction
// and dep tables carry no pipeline_fk, so nothing can be fetched per-pipeline
// without the fan-out design rule 5 forbids — and once the four lists are in
// cache, the detail page selects its pipeline from the list it already has
// (memory/detail-page-interlinking.md's composition rule) rather than opening a
// second cache entry that is guaranteed to refetch on every navigation. A by-id
// hook would be dead code that quietly invites that regression back.
export const useAllPipelines                = pipelines.useAll;
export const useAllPipelineSteps            = pipelineSteps.useAll;
// Req #3224 — live orchestration reservations: who is orchestrating what, from
// where. ONE unfiltered list read per page, joined client-side by pipeline_fk /
// epic_fk; the table holds one row per RESERVED SCOPE, so it is a handful of
// rows and never grows with the size of a plan.
export const useOrchestrationClaims         = orchestrationClaims.useAll;
export const useAllPipelineStepRequirements = pipelineStepRequirements.useAll;
export const useAllPipelineStepDeps         = pipelineStepDeps.useAll;

// Req #3180 — the requirement ids a pipeline STEP carries, as a Set.
//
// One shared hook over the junction read above, so the two surfaces that need
// this (the SwarmStartCard aggregator, the requirements-page filter) consult ONE
// query cache entry and ONE derivation. It costs no extra fetch on the plan
// pages, which already hold this exact read.
//
// The Set is memoized on the query data, so it is referentially stable between
// refetches that change nothing — consumers use it as a useMemo dependency.
export function usePipelinedRequirementIds(creatorFk, { enabled = true } = {}) {
    const { data } = useAllPipelineStepRequirements(creatorFk, { enabled });
    return useMemo(() => pipelinedRequirementIds(data), [data]);
}

// Req #3428 — the requirement ids one EPIC contains, as a Set, plus the narrow
// requirement rows the page needs to decide WHERE that work lives.
//
// Modelled on `usePipelinedRequirementIds` above and for the same reason: four
// surfaces need this answer (the Cards view's rows, the aggregator's rows, the
// aggregator's chip badges, and which project tab to open), and they must
// consult ONE derivation or they will disagree with each other in ways nothing
// fails on.
//
// AN ID SET RATHER THAN A WIDER PROJECTION. Three of those four consumers read
// requirements through queries that do not carry `feature_fk`
// (`useRequirementsByStatus`, `useRequirementsDone`, and the counts read), and
// teaching all three about epics would put a column on the wire for every reader
// of those shared cache entries, forever, to serve a filter that is off almost
// all the time. One narrow read answers all four instead.
//
// `epicId == null` DISABLES BOTH READS, so a page with no filter active pays
// nothing — not a fetch, not a parse. It returns `{ epicReqIds: null, … }`, and
// `null` is what every consumer treats as "no filter" (an EMPTY SET means the
// filter is on and matches nothing, which is a different page).
//
// `closed: ALL_ROWS` on the features read, matching the plan pages: a CLOSED
// feature's requirements still belong to their epic, and dropping them here
// would silently shrink the filter's population with no visible cause. It is
// also the exact cache entry `PipelineDetail`/`StepsPage` already hold, so
// arriving from the plan visualizer — which is how this filter is reached —
// costs no features fetch at all.
//
// The narrowest projection that answers both questions: membership needs
// `feature_fk`, and "which project tab holds this epic's work" needs
// `category_fk`. `useAllRequirements` puts `fields` in its cache key (req #2213),
// so this gets its own entry and cannot serve — or be served by — a wider
// consumer's rows.
const EPIC_MEMBERSHIP_REQUIREMENT_FIELDS = 'id,feature_fk,category_fk';

//
// A FAILED READ IS NOT AN EMPTY EPIC. Both `isError`s are read, and on either one
// the hook returns `epicReqIds: null` — the same value that means "no filter" —
// plus `isError: true` so the caller can say why. Discarding the error instead
// leaves `features`/`requirements` undefined forever, which derives an EMPTY SET,
// which renders every card gone and every badge zero: a page indistinguishable
// from "this epic has no work", permanently, with nothing surfaced anywhere (the
// QueryClient has no error handler). `filterToEpic`'s in-flight direction is
// deliberate and unchanged — an empty set while a read is IN FLIGHT is a brief,
// self-correcting state; a failed read is neither, so it must not share it.
export function useEpicRequirementIds(creatorFk, epicId) {
    const active = epicId !== null && epicId !== undefined;
    const { data: features, isError: featuresError } = useAllFeatures(creatorFk, {
        closed: ALL_ROWS, enabled: active,
    });
    const { data: requirements, isError: requirementsError } = useAllRequirements(creatorFk, {
        fields: EPIC_MEMBERSHIP_REQUIREMENT_FIELDS, enabled: active,
    });
    const isError = active && (featuresError || requirementsError);

    const epicReqIds = useMemo(
        () => ((active && !isError) ? epicRequirementIds(features, requirements, epicId) : null),
        [active, isError, features, requirements, epicId]);

    return { epicReqIds, isError, requirements: active ? requirements : undefined };
}

// Req #3117 — the plan page's Cost column. TWO more bounded list reads, never a
// per-requirement fetch: the junction maps requirements to their sessions, the
// projected swarm_sessions read carries migration 077's two flat rollup columns,
// and `buildCostIndex` folds them into one cost index in a single pass.
//
// The rollups themselves are computed SERVER-SIDE by darwin-mcp on every session
// status transition. That is the whole design: the client sums three-column rows
// it already has rather than reconstructing cost from phase blobs it cannot even
// read (list projections drop `phase_tokens`, req #3078).
export const useAllRequirementSessions  = requirementSessions.useAll;
export const useAllSessionCostRollups   = sessionCostRollups.useAll;
