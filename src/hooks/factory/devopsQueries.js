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
// shows seeded test data.
//
// Req #2871 — ONE carve-out: `dev_servers` is restored to `ops: true`. Unlike
// the visualizer/session ops tables, `dev_servers` is live machine state that
// is NEVER a seeded fixture: `/devops-devserver-start` claims a row via the MCP
// `claim_dev_server` tool, and the daemon writes it to production `darwin`. The
// NavBar dev-server callout (NavBarSidebar.jsx "Terminal - N") matches the live
// browser's `window.location.port` against those rows, so the READ must hit the
// same schema the claim WROTE. Routing `dev_servers` reads through `darwinUri`
// (→ `darwin_dev` in dev) made a dev browser match seeded fixtures instead of
// real claims — wrong/missing terminal numbers. Always-production is correct for
// both read and write here. The other three original ops tables keep the
// dev/prod split so dev review still sees seeded fixtures. `darwinOpsUri` stays
// defined in AppContext for this block and the JWT call.

import { createEntityQueries } from './createEntityQueries';

// ---------------------------------------------------------------------------
// dev_servers
// Hooks: useDevServers (all) + useDevServersBySession (legacy: sessionId-only,
// no creator in cache key).
// ---------------------------------------------------------------------------
export const devServers = createEntityQueries({
    entity: 'dev_servers',
    // Req #2871 — pin reads to production `darwin` (via darwinOpsUri). dev_servers
    // is live machine state written by the MCP claim_dev_server tool to production;
    // a dev browser must read from where the claim wrote, not seeded darwin_dev
    // fixtures, so the NavBar "Terminal - N" callout matches the real port claim.
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
//
// Req #2834 — the list query (useSessions) projects every column EXCEPT the four
// heavy TEXT fields (`telemetry`, `plan`, `start_summary`, `complete_summary`).
// Those four are only read by the detail view (useSession/byId, which does NOT
// apply defaultFields — it still fetches the full single row) and by
// exportService.js (which fetches swarm_sessions directly, not via this hook).
// Without this projection the unfiltered all-rows fetch grew past AWS Lambda's
// 6 MB synchronous response limit (~6.06 MB at 668 rows) → the Lambda failed →
// API Gateway returned 502 Bad Gateway (surfacing as a CORS error) → the
// sessions page / visualizer hung on an infinite spinner. The projection drops
// the response to ~0.56 MB. `fieldsInKey` stays false so the cache key
// (`['swarm_sessions', creator]`) and every existing invalidation are unchanged.
// ---------------------------------------------------------------------------
// Req #2839 — `phase_tokens` (per-phase token cost JSON, ~200 B/row) is included
// so the Stats view's token aggregation works on the list fetch. The internal
// `tokens_at_last_transition` baseline is intentionally OMITTED (engine-only,
// never read by the UI). The detail view fetches the full single row, so it gets
// phase_tokens regardless of this projection.
const SWARM_SESSION_DEFAULT_FIELDS =
    'id,branch,task_name,source_type,source_ref,title,pr_url,swarm_status,ai_model,effort,' +
    'worktree_path,machine_fk,started_at,completed_at,last_transition_at,' +
    'starting_secs,waiting_secs,planning_secs,implementing_secs,review_secs,' +
    'completion_secs,paused_secs,legacy_secs,instrumented,pre_pause_status,' +
    'phase_tokens,creator_fk,create_ts,update_ts';

export const sessions = createEntityQueries({
    entity: 'swarm_sessions',
    defaultFields: SWARM_SESSION_DEFAULT_FIELDS,
    byIdCreatorScoped: false,
});

// ---------------------------------------------------------------------------
// swarm_starts (req #2422)
// Hooks: useAllSwarmStarts (fields-in-key, sort started_at:desc) +
// useSwarmStartById (creator-scoped key).
// ---------------------------------------------------------------------------
const SWARM_START_DEFAULT_FIELDS =
    'id,arguments,auto_start,session_count,machine_fk,' +
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

// ---------------------------------------------------------------------------
// machines (req #2943) — which machine ran a session / start / dev-server claim.
// Hooks: useMachines (all) + useMachine (byId, creator-scoped).
//
// Routes through the default `darwinUri` (dev/prod split, req #2683): dev reads
// darwin_dev.machines (seeded fixtures), prod reads darwin.machines. NOT an
// `ops` table — machine attribution is real content the user manages on the
// /swarm/machines page. `fieldsInKey` so a projection change doesn't collide on
// the shared cache entry. `closed` machines still render (page shows a Closed
// column) so no closed-filter here — sort_order-then-id, NULLs last, server-side.
// ---------------------------------------------------------------------------
const MACHINE_DEFAULT_FIELDS =
    'id,title,description,hostname,platform,arch,hw_model,os_version,' +
    'last_seen_at,closed,sort_order,creator_fk,create_ts,update_ts';

export const machines = createEntityQueries({
    entity: 'machines',
    defaultFields: MACHINE_DEFAULT_FIELDS,
    fieldsInKey: true,
    defaultSort: 'sort_order:asc',
});

// ---------------------------------------------------------------------------
// agents registry (req #2997 / #2998) — the five tables behind /agents.
//
// Routes through the default `darwinUri` (dev/prod split, req #2683). NOT `ops`
// tables: the registry is content the user manages via the /agents UI + MCP
// tools, and the MCP daemon reads it from production while the dev UI reads
// darwin_dev rows. The registry is present in both databases (the DB is the sole
// source of truth — no git-hardcoded row source), so dev review sees real data.
//
// `agent_documents` and `agent_instructions` are JUNCTIONS with composite PKs
// and NO `id` column — never request `fields=id` on them, and they take no
// byId hook. They also carry no `creator_fk` (correctly absent from
// Lambda-Rest CREATOR_FK_TABLES), so their foreign keys are `creatorScoped:
// false`; scoping happens on the parent rows the UI joins them against.
// ---------------------------------------------------------------------------

export const agents = createEntityQueries({
    entity: 'agents',
    defaultFields:
        'id,name,file_name,overview,ai_model,effort,location,closed,sort_order,' +
        'creator_fk,create_ts,update_ts',
    fieldsInKey: true,
    defaultSort: 'sort_order:asc',
});

export const instructions = createEntityQueries({
    entity: 'instructions',
    defaultFields: 'id,name,content,closed,sort_order,creator_fk,create_ts,update_ts',
    fieldsInKey: true,
    defaultSort: 'sort_order:asc',
});

export const architectureDocuments = createEntityQueries({
    entity: 'architecture_documents',
    defaultFields:
        'id,name,doc_type,location,url,closed,sort_order,creator_fk,create_ts,update_ts',
    fieldsInKey: true,
    defaultSort: 'sort_order:asc',
});

export const agentDocuments = createEntityQueries({
    entity: 'agent_documents',
    // No `id` column — composite PK (agent_fk, document_fk). `owned_document_fk`
    // is a VIRTUAL generated column carrying the one-owner-per-document UNIQUE
    // key; it is deliberately not projected (the UI derives ownership from
    // `relationship === 'owned'`).
    defaultFields: 'agent_fk,document_fk,relationship,notes,sort_order',
    fieldsInKey: true,
    foreignKeys: [
        { field: 'agent_fk', as: 'agent', creatorScoped: false },
        { field: 'document_fk', as: 'document', creatorScoped: false },
    ],
});

export const agentInstructions = createEntityQueries({
    entity: 'agent_instructions',
    defaultFields: 'agent_fk,instruction_fk,sort_order',
    fieldsInKey: true,
    foreignKeys: [
        { field: 'agent_fk', as: 'agent', creatorScoped: false },
        { field: 'instruction_fk', as: 'instruction', creatorScoped: false },
    ],
});
