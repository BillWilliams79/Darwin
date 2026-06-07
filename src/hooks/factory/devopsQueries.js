// Req #2593 — declarative wiring of the 4 existing devops data objects through
// createEntityQueries. Adding a new devops table (build_runs, deployment_logs,
// release_artifacts, etc.) follows the same shape — add one block below.
//
// Every existing hook signature, URL, cache key, and `enabled` predicate is
// preserved byte-for-byte by the factory output; parity is locked down by
// __tests__/devopsQueriesParity.test.js.
//
// Req #2697 — `ops: true` on every block here. These four tables live
// exclusively in the production `darwin` schema (the MCP daemon's
// `DB_NAME=darwin` is hard-wired). The factory routes their reads through
// `darwinOpsUri` instead of `darwinUri` so dev-mode builds (where
// `darwinUri` ends in `/darwin_dev` per req #2683) still see real rows.
// A future devops table that genuinely IS per-database (e.g. recurring_tasks)
// would omit `ops` and inherit the default `darwinUri` routing.

import { createEntityQueries } from './createEntityQueries';

// ---------------------------------------------------------------------------
// dev_servers
// Hooks: useDevServers (all) + useDevServersBySession (legacy: sessionId-only,
// no creator in cache key).
// ---------------------------------------------------------------------------
export const devServers = createEntityQueries({
    entity: 'dev_servers',
    ops: true,
    foreignKeys: [
        // `keyParam: 'sessionId'` preserves the legacy `devServerKeys.bySession(id)`
        // cache-key shape `['dev_servers', { sessionId }]`. New devops entities
        // can omit it and inherit the consistent SQL-column shape automatically.
        { field: 'session_fk', as: 'session', creatorScoped: false, keyParam: 'sessionId' },
    ],
});

// ---------------------------------------------------------------------------
// swarm_sessions
// Hooks: useSessions (all) + useSession (legacy: sessionId-only, no creator in
// cache key — SwarmSessionDetail.jsx invalidates with sessionKeys.byId(id)).
// ---------------------------------------------------------------------------
export const sessions = createEntityQueries({
    entity: 'swarm_sessions',
    ops: true,
    byIdCreatorScoped: false,
});

// ---------------------------------------------------------------------------
// swarm_starts (req #2422)
// Hooks: useAllSwarmStarts (fields-in-key, sort started_at:desc) +
// useSwarmStartById (creator-scoped key).
// ---------------------------------------------------------------------------
const SWARM_START_DEFAULT_FIELDS =
    'id,arguments,autonomy_filter,auto_start,session_count,' +
    'tokens_input,tokens_cache_write,tokens_cache_read,tokens_output,' +
    'wall_seconds,turn_count,start_summary,telemetry,started_at,creator_fk';

export const swarmStarts = createEntityQueries({
    entity: 'swarm_starts',
    ops: true,
    defaultFields: SWARM_START_DEFAULT_FIELDS,
    fieldsInKey: true,
    defaultSort: 'started_at:desc',
});

// ---------------------------------------------------------------------------
// swarm_start_sessions junction (req #2422)
// Hooks: useAllSwarmStartSessions (fixed projection, no fields in key).
// ---------------------------------------------------------------------------
export const swarmStartSessions = createEntityQueries({
    entity: 'swarm_start_sessions',
    ops: true,
    defaultFields: 'swarm_start_fk,session_fk',
});

// ---------------------------------------------------------------------------
// swarm_undos (req #2719)
// Hooks: useAllSwarmUndos (fields-in-key, sort undone_at:desc) +
// useSwarmUndoById (creator-scoped key).
//
// Intentionally NOT ops:true (departure from req #2697's pattern for the four
// pre-existing swarm tables). swarm_undos is a brand-new data type whose data
// has no reason to live exclusively in the production `darwin` schema during
// development — routing through the default `darwinUri` lets dev-mode builds
// read seeded fixtures from `darwin_dev`. The broader question of whether
// req #2697's ops-routing rule should apply to every operational table by
// default is a separate design conversation the data-architect should groom
// (filed for follow-up per user direction 2026-05-28).
// ---------------------------------------------------------------------------
const SWARM_UNDO_DEFAULT_FIELDS =
    'id,session_fk,swarm_start_fk_at_undo,req_id_at_undo,' +
    'task_name,branch,coordination_type,reason,undone_at,creator_fk';

export const swarmUndos = createEntityQueries({
    entity: 'swarm_undos',
    defaultFields: SWARM_UNDO_DEFAULT_FIELDS,
    fieldsInKey: true,
    defaultSort: 'undone_at:desc',
});

// ---------------------------------------------------------------------------
// swarm_completes (req #2497)
// Hooks: useAllSwarmCompletes (fields-in-key, sort completed_at:desc) +
// useSwarmCompleteById (creator-scoped key).
//
// Intentionally NOT ops:true — same rationale as swarm_undos above: a brand-new
// data type whose rows should be readable from `darwin_dev` in dev-mode builds
// (the prod `darwin` table lands at /swarm-complete time). Routing through the
// default `darwinUri` lets dev-mode read seeded fixtures from `darwin_dev`.
// ---------------------------------------------------------------------------
const SWARM_COMPLETE_DEFAULT_FIELDS =
    'id,skill_name,coordination_type,status,session_count,' +
    'tokens_input,tokens_cache_write,tokens_cache_read,tokens_output,' +
    'wall_seconds,turn_count,complete_summary,telemetry,' +
    'started_at,completed_at,creator_fk';

export const swarmCompletes = createEntityQueries({
    entity: 'swarm_completes',
    defaultFields: SWARM_COMPLETE_DEFAULT_FIELDS,
    fieldsInKey: true,
    // started_at (always populated) not completed_at (NULL while in_progress) —
    // matches the page DataGrid's client sort, so in-progress rows aren't
    // shoved to the end by a NULL-last server sort.
    defaultSort: 'started_at:desc',
});

// ---------------------------------------------------------------------------
// swarm_complete_sessions junction (req #2497)
// Hooks: useAllSwarmCompleteSessions (fixed projection, no fields in key).
// ---------------------------------------------------------------------------
export const swarmCompleteSessions = createEntityQueries({
    entity: 'swarm_complete_sessions',
    defaultFields: 'swarm_complete_fk,session_fk',
});
