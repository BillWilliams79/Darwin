// Req #2593 — declarative wiring of the 4 existing devops data objects through
// createEntityQueries. Adding a new devops table (build_runs, deployment_logs,
// release_artifacts, etc.) follows the same shape — add one block below.
//
// Every existing hook signature, URL, cache key, and `enabled` predicate is
// preserved byte-for-byte by the factory output; parity is locked down by
// __tests__/devopsQueriesParity.test.js.
//
// Req #2827 — every block here routes through the default `darwinUri`
// (dev/prod split per req #2683). The four original ops tables (`dev_servers`,
// `swarm_sessions`, `swarm_starts`, `swarm_start_sessions`) previously carried
// `ops: true` (req #2697) to pin their reads to production `darwin` so a
// dev-mode build still saw the daemon's live rows. That pin defeated dev/prod
// separation for TESTING — you could not seed viewable test data without
// polluting production. Removing it lets all six ops tables follow the same
// rule the newer two (swarm_undos, swarm_completes) already did: dev reads
// seeded fixtures from `darwin_dev`, production reads `darwin` unchanged
// (in prod `darwinUri === /darwin`, so production behavior is identical).
//
// ACCEPTED CONSEQUENCE: the dev server no longer shows live production ops —
// the daemon still writes real ops to production for the production app; dev
// shows seeded test data. The `ops` flag remains a generic capability of
// createEntityQueries (and `darwinOpsUri` stays defined in AppContext for the
// JWT call) — it is simply no longer used by any block here.

import { createEntityQueries } from './createEntityQueries';

// ---------------------------------------------------------------------------
// dev_servers
// Hooks: useDevServers (all) + useDevServersBySession (legacy: sessionId-only,
// no creator in cache key).
// ---------------------------------------------------------------------------
export const devServers = createEntityQueries({
    entity: 'dev_servers',
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
    byIdCreatorScoped: false,
});

// ---------------------------------------------------------------------------
// swarm_starts (req #2422)
// Hooks: useAllSwarmStarts (fields-in-key, sort started_at:desc) +
// useSwarmStartById (creator-scoped key).
// ---------------------------------------------------------------------------
const SWARM_START_DEFAULT_FIELDS =
    'id,arguments,auto_start,session_count,' +
    'tokens_input,tokens_cache_write,tokens_cache_read,tokens_output,' +
    'wall_seconds,turn_count,start_summary,telemetry,started_at,creator_fk';

export const swarmStarts = createEntityQueries({
    entity: 'swarm_starts',
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
    defaultFields: 'swarm_start_fk,session_fk',
});

// ---------------------------------------------------------------------------
// swarm_undos (req #2719)
// Hooks: useAllSwarmUndos (fields-in-key, sort undone_at:desc) +
// useSwarmUndoById (creator-scoped key).
//
// Routes through the default `darwinUri` (dev/prod split) so dev-mode builds
// read seeded fixtures from `darwin_dev`. This was the first ops table to drop
// the req #2697 `ops: true` pin; req #2827 brought the four original ops tables
// into line, so every ops block now follows this same dev/prod-split rule.
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
// Routes through the default `darwinUri` (dev/prod split) — same rule as every
// ops block here after req #2827. Dev-mode reads seeded fixtures from
// `darwin_dev`; the prod `darwin` rows land at /swarm-complete time.
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
