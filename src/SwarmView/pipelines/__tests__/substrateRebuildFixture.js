// substrateRebuildFixture.js — the Substrate Rebuild Pipeline (req #3083 PLAN-JSON,
// fetched live 2026-07-26, 34 rows) translated to the swarm-orchestration table
// shapes fixed by req #3112 (mirroring the req #3111 schema). STATIC — tests never
// hit the DB.
//
// ID MAPPING CONVENTION (coordinate with the req #3111 darwin_dev fixture header):
//   plan epic id      -> epics.id, IDENTITY MAP (epic "12" -> id 12).
//                        #3111's SQL fixture may allocate AUTO_INCREMENT ids; its
//                        header documents the same plan-epic-id -> row-id mapping.
//   requirement ids   -> real Darwin requirement ids, unchanged.
//   initiative ids          -> 1..4 in first-appearance order of the PLAN-JSON rows.
//   feature ids       -> 101+ in first-appearance order (labels attach to
//                        REQUIREMENTS — design rule 10; req-less epic 7 has none).
//   machine ids       -> real Darwin machine ids: 2 = Mac mini, 3 = WSL.
//   pipeline id       -> 1.
//
// Requirement statuses are chosen so deriveEpicState() reproduces the exact
// PLAN-JSON states: done rows -> all terminal (met; #3041 wontfix per its real
// disposition), active rows -> development, pending rows -> approved/swarm_ready.
// Epic 7 is the one exception: PLAN-JSON records it `done` from the manual
// stamp it carried then, but it holds no work, so it now derives pending — a
// epic has no completion stamp (req #3750; req #3752 dropped the column).
//
// ONE requirement is deliberately NOT chosen that way, and it is the point of req
// #3123: #3083 carries `tracking: 1` and stays in `development`, its real status,
// because it is this plan's CONTAINER and a container never leaves development
// while the plan it holds is running. Epic 19 links it and still derives done —
// through the exemption, on its real inputs, rather than through a status picked
// to make the arithmetic work. Before the flag existed this row said `met`, which
// got the right answer for the wrong reason and left the exemption untested.
// Req #3105 is attached to feature "Swarm Lifecycle" under the Swarm Substrate
// Rebuild initiative — the real cross-initiative batch-mate of epic 19 ("cross-initiative per rule
// 10" in the plan) — so dominant-label derivation is exercised by the fixture
// (epic 19 dominant initiative stays Swarm Orchestration Feature, 2 reqs vs 1).
// coordination_type is carried for shape completeness; no engine function reads it.

// The PLAN-JSON rows verbatim (insertion order — stored order is insertion
// history, never display order). Used by the POC-parity test to build rows the
// same shape the archived generate.py consumed.
export const PLAN_JSON_ROWS = [
    {"epic": "1", "feature": "Session Drain", "reqs": [3050, 3056, 3063, 3064, 3068], "state": "done", "summary": "Drain: close every open swarm session so substrate surgery starts with zero in-flight work", "deps": "-", "initiative": "Swarm Substrate Rebuild", "run": "auto"},
    {"epic": "2", "feature": "MCP Hardening", "reqs": [3078], "state": "done", "summary": "Bound every MCP list read under Lambda's 6 MB response ceiling; heavy columns move to by-id reads", "deps": "-", "initiative": "Swarm Substrate Rebuild", "run": "auto"},
    {"epic": "3", "feature": "Substrate Safety", "reqs": [3072], "state": "done", "summary": "Eliminate dual-path git access (symlinks deleted, all repos moved off Desktop into real dirs), audit every git call, pr-finalize made read-only, ff-only Primary sync, hard clean-Primary gate", "deps": "1", "initiative": "Swarm Substrate Rebuild", "run": "auto"},
    {"epic": "4", "feature": "Substrate Safety", "reqs": [3041], "state": "done", "summary": "Dispositioned wontfix; live scope folded into 3072 (W7 clean gate) and 3077 (C1 grep gate, C2 origin fingerprint)", "deps": "3", "initiative": "Swarm Substrate Rebuild", "run": "auto"},
    {"epic": "5", "feature": "Substrate Safety", "reqs": [3069], "state": "done", "summary": "Validation: first full worker lifecycle run clean on the repaired substrate (also fixed the statusline dev-server indicator)", "deps": "3", "initiative": "Swarm Substrate Rebuild", "run": "auto"},
    {"epic": "6", "feature": "Green Baseline", "reqs": [3061], "state": "done", "summary": "Repair every pre-existing test failure - backend fixture drift, MCP count asserts, two harness scripts - so the full suite reads truly green", "deps": "5", "initiative": "Swarm Substrate Rebuild", "run": "auto"},
    {"epic": "7", "feature": "Green Baseline", "reqs": [], "state": "done", "summary": "Record the all-passing regression baseline across every suite; the fixed reference point for the clone-substrate regression gate - RECORDED 2026-07-26: harness 3736/3736, Lambda-Rest 134, Cognito 18, mcp unit 252 / integration 688 / production 62 - all passing", "deps": "6", "initiative": "Swarm Substrate Rebuild", "run": "auto"},
    {"epic": "8", "initiative": "Swarm Substrate Rebuild", "feature": "WSL Parity", "reqs": [3079], "state": "done", "summary": "MCP setup on machine 3 - strictly serial: (1) /primary-ai-sync brings the WSL workspace current, (2) req 3079 migrates credentials and stands up the darwin-mcp daemon. No epic/time deps: eligible whenever the user is at the WSL box", "deps": "-", "run": "manual"},
    {"epic": "9", "initiative": "Swarm Substrate Rebuild", "feature": "WSL Parity", "reqs": [3084], "state": "done", "summary": "Verification 1 of 3 - full MCP validation: health, wrapper read+mutation round-trips, bounded list reads, all three darwin-mcp test tiers, auto-restart. No pipeline gate - runnable immediately after W1", "deps": "8", "run": "manual"},
    {"epic": "23", "initiative": "Application Backlog", "feature": "WSL Backlog", "reqs": [3065], "state": "done", "run": "manual", "summary": "Agent Context polish (session 2439, machine 3). CORRECTED 2026-07-26: #3079 completed at 02:14Z, session created 02:17Z - it has run on the NEW daemon + credentials from birth. No stale-stack risk; normal lifecycle applies", "deps": "-"},
    {"epic": "33", "state": "done", "run": "auto", "initiative": "Application Backlog", "feature": "Agentic Telemetry", "reqs": [3096, 3098], "summary": "AGENTIC TELEMETRY BATCH - one swarm-start, two sessions: per-document actual-token capture for architecture documents (3096), machine/model/effort columns on agent telemetry runs (3098)", "deps": "23"},
    {"epic": "34", "state": "active", "run": "manual", "initiative": "Application Backlog", "feature": "Agentic Telemetry", "reqs": [3095], "summary": "Ground-truth breakdown of the Claude Code base token figure (spawned by #3065). Discuss coordination on the Windows/WSL machine — user starts and drives it there.", "deps": "23"},
    {"epic": "21", "initiative": "Swarm Substrate Rebuild", "feature": "Clone Substrate", "reqs": [3077], "state": "done", "run": "auto", "summary": "MILESTONE 1 (R20): mirror layer + protections land first - mirror-update.sh with the R18 single-flight freshness contract (mandatory synchronous fetch at every provision, per-repo lock, loud failure) and provision-repo.sh with R19 --no-hardlinks fully-private clones (greenfield-verified). Reviewable unit before any cutover work", "deps": "7"},
    {"epic": "10", "feature": "Clone Substrate", "reqs": [3077], "state": "done", "summary": "Clone substrate core: B3 discovery + provisioning cutover (flag-gated), dual-mode cleanup, worker git_op guard, docs - wrapped in feature review, gap analysis, and full regression vs the epic-7 baseline", "deps": "21", "initiative": "Swarm Substrate Rebuild", "run": "auto"},
    {"epic": "26", "state": "done", "run": "auto", "initiative": "Swarm Substrate Rebuild", "feature": "Clone Substrate", "reqs": [3088], "summary": "Substrate remediation from gate findings: R19 --no-hardlinks (tests assert the opposite today), R18 FRESH_WINDOW dedup + stale_ok degrade, B3 skill cutover (/swarm-start + /swarm-resume still hardcode wt- paths — breaks at flip time), R6 attribution coverage fix, MED/LOW gap tests. Blocks the flip and canaries.", "deps": "10"},
    {"epic": "28", "state": "done", "run": "auto", "initiative": "Swarm Substrate Rebuild", "feature": "Clone Substrate", "reqs": [3091], "summary": "CANARY CATCH (major): clone sessions are new project roots — Claude Code folder-trust dialog blocked both canaries; worktrees had inherited trust via their .git pointer. Fixed same-day: trust-session.sh pre-registers the trust entry in ~/.claude.json, wired into worker-launch-batch.sh before backend dispatch. Landed fa7ed2b.", "deps": "25"},
    {"epic": "25", "state": "done", "run": "auto", "initiative": "Swarm Substrate Rebuild", "feature": "Clone Substrate", "reqs": [3087], "summary": "Primary gate execution: G-feature + G-gap reviews (done — 5 deviations, 12 gaps found), independent G-regression after remediation, then B5a flag flip (LAYOUT_DEFAULT_PROVISIONING -> clone) deployed via /primary-ai-swarm-complete. Mirrors+sessions layout created and 7 mirrors seeded 2026-07-26.", "deps": "10 26"},
    {"epic": "11", "feature": "Clone Substrate", "reqs": [3058], "state": "done", "summary": "Canary: a docs-only requirement runs the first clone-provisioned session through its entire lifecycle", "deps": "25", "initiative": "Swarm Substrate Rebuild", "run": "auto"},
    {"epic": "22", "initiative": "Swarm Substrate Rebuild", "feature": "Clone Substrate", "reqs": [3090], "state": "done", "run": "auto", "summary": "Clone canary 2 (Mac mini, #3077 R13): throwaway requirement exercising what canary 1 cannot - >=2 repos, mid-session /hygiene checkout of a third, npm install in the session clone, dev-server registration, pause -> resume -> undo round-trip, deploy path, and the mid-flight rm -rf isolation test. Throwaway req filed at execution time", "deps": "11"},
    {"epic": "12", "feature": "Backlog Wave", "reqs": [3071, 3059, 3057, 3051, 3045, 3076, 3075], "state": "done", "summary": "Seven parallel sessions on the proven substrate: house dialog pattern under /agents, IntegrityError-to-409 mapping, junction-POST 500 fix, editable Documents page, agent telemetry collection, delete-dialog wording test, sort-order invariant decision", "deps": "11 22 28", "initiative": "Application Backlog", "run": "auto"},
    {"epic": "13", "feature": "Post-Wave Batch", "reqs": [3089, 3092, 3093, 3060, 3094], "state": "done", "summary": "POST-WAVE BATCH - one swarm-start, five sessions: provision-repo.sh venv python3.10+ fix (3089), per-repo provisioning telemetry persisted to the session record (3092), mcp-restart-if-stale.sh cross-session write to the PRIMARY clone (3093), E2E coverage for the editable agent instruction registry (3060), SECURITY POST /profiles read-back cross-tenant leak (3094)", "deps": "12", "initiative": "Application Backlog", "run": "auto"},
    {"epic": "14", "feature": "Backlog Wave", "reqs": [3067], "state": "done", "summary": "Instructions Table View - hardened generic edit-in-place table pattern", "deps": "12 13", "initiative": "Application Backlog", "run": "auto"},
    {"epic": "16", "initiative": "Swarm Substrate Rebuild", "feature": "WSL Parity", "reqs": [3085], "state": "done", "summary": "Verification 2 of 3 - WSL CLONE TESTING (mirror of the mini canaries on machine 3): mirrors + session-clone layout via the same scripts, real /swarm-start full lifecycle, write isolation, machine-pin routing. The clone mechanism is proven per-machine, never assumed portable", "deps": "9 11", "run": "manual"},
    {"epic": "17", "feature": "Primary Parity", "reqs": [3082], "state": "pending", "summary": "PLAN-COMPLETION GATE. Relocate Primary to ~/darwin/primary via the same clone pattern as workers; migrate memory, config, and MCP daemon; decommission the old path (no dual-path overlap); validation battery ends with a canary swarm launch from the new home", "deps": "12 13 14", "initiative": "Swarm Substrate Rebuild", "run": "manual"},
    {"epic": "31", "state": "pending", "run": "manual", "initiative": "Swarm Substrate Rebuild", "feature": "Primary Parity", "reqs": [3097], "summary": "Human-verified #3082 battery, executed BY the new primary session at ~/darwin/primary after cutover: layout resolution, MCP, statusline walk-ups, dev server, a canary /swarm-start from the new home, hooks/darcfg, old-path decommission audit. Failures file defects, never inline patches.", "deps": "17"},
    {"epic": "18", "initiative": "Swarm Substrate Rebuild", "feature": "WSL Parity", "reqs": [3086], "state": "pending", "summary": "Verification 3 of 3 - full primary session independence: execute the epic-12 runbook on machine 3, old-path decommission, validation battery from the new home. Completes WSL parity", "deps": "16 17", "run": "manual"},
    {"epic": "19", "feature": "Swarm Orchestration Feature", "reqs": [3080, 3083, 3105], "state": "done", "summary": "Cherry: discuss session specs the pipelines-as-data feature and files its follow-on requirements - this plan is its seed dataset, held by tracking req 3083 (single source of truth this page renders from) + BATCHED same launch: swarm-complete RDS-snapshots without asking permission (3105, cross-initiative per rule 10)", "deps": "14", "initiative": "Swarm Orchestration Feature", "run": "auto"},
    {"epic": "20", "feature": "Agent Infra Leverage", "reqs": [3074], "state": "pending", "summary": "Darwin Primary AI and swarm workers leverage the Agent infrastructure (final epic of the plan)", "deps": "17 31", "initiative": "Primary and Swarm Agentic Integration", "run": "auto"},
    {"epic": "38", "state": "active", "run": "auto", "initiative": "Swarm Orchestration Feature", "feature": "Foundation Wave", "reqs": [3110, 3111, 3112], "summary": "FOUNDATION BATCH - one swarm-start, three sessions: design-intent grooming into Swarm Architect docs (3110), schema foundation - initiatives/features/requirements hierarchy + pipelines/epics/epic-requirements/epic-deps tables + API routes + darwin_dev fixtures from this plan (3111), pure-JS ordering/derivation engine with self-checking invariants (3112)", "deps": "19"},
    {"epic": "39", "state": "pending", "run": "auto", "initiative": "Swarm Orchestration Feature", "feature": "API & Table Wave", "reqs": [3113, 3114], "summary": "API & TABLE BATCH: MCP pipelines resources + echo-verified mutation tools with single-read render (3113); SwarmView pipelines hooks/routes/list page + plan-rows table view per pipeline-plan-tracking rules (3114)", "deps": "38"},
    {"epic": "40", "state": "pending", "run": "auto", "initiative": "Swarm Orchestration Feature", "feature": "Visualizer & Doctrine Wave", "reqs": [3115, 3116, 3117], "summary": "VISUALIZER & DOCTRINE BATCH: Plan (no time anchor) visualizer with drag-pan + three-level zoom, clickable epics/reqs/initiatives (3115); Primary execution doctrine + 8-case mutation playbook + fail-loud watchdog (3116); server-side cost rollup + Time/Tokens enable (3117)", "deps": "39"},
    {"epic": "41", "state": "pending", "run": "auto", "initiative": "Swarm Orchestration Feature", "feature": "Acceptance", "reqs": [3118], "summary": "Acceptance battery: Playwright E2E over the seeded darwin_dev plan + replay of all 8 recorded mutation classes via MCP tools, asserting derived state and invariant-clean rendered order after each", "deps": "40"},
    {"epic": "42", "state": "pending", "run": "auto", "initiative": "Swarm Orchestration Feature", "feature": "Polish & Showcase", "reqs": [3119], "summary": "FINAL POLISH & SHOWCASE (implemented - the initiative's only user-review stop): re-seed darwin_dev with the full live 3083 plan, cosmetic polish pass, dev server deep-linked to /swarm/pipelines, concise executive summary; user checks all features", "deps": "41"},
    {"epic": "43", "state": "pending", "run": "manual", "initiative": "Swarm Orchestration Feature", "feature": "Design Discussion", "reqs": [3108], "summary": "Design discussion (discuss, user-driven): cooperative inter-Claude message system - grounded by the shipped orchestration core + Primary doctrine; informs future proactive Primary/worker communication", "deps": "40"},
];

export const MACHINES = [
    { id: 2, title: "Mac mini" },
    { id: 3, title: "WSL" },
];

export const INITIATIVES = [
    { id: 1, title: "Swarm Substrate Rebuild" },
    { id: 2, title: "Application Backlog" },
    { id: 3, title: "Swarm Orchestration Feature" },
    { id: 4, title: "Primary and Swarm Agentic Integration" },
];

export const FEATURES = [
    { id: 101, title: "Session Drain", initiative_fk: 1 },
    { id: 102, title: "MCP Hardening", initiative_fk: 1 },
    { id: 103, title: "Substrate Safety", initiative_fk: 1 },
    { id: 104, title: "Green Baseline", initiative_fk: 1 },
    { id: 105, title: "WSL Parity", initiative_fk: 1 },
    { id: 106, title: "WSL Backlog", initiative_fk: 2 },
    { id: 107, title: "Agentic Telemetry", initiative_fk: 2 },
    { id: 108, title: "Clone Substrate", initiative_fk: 1 },
    { id: 109, title: "Backlog Wave", initiative_fk: 2 },
    { id: 110, title: "Post-Wave Batch", initiative_fk: 2 },
    { id: 111, title: "Primary Parity", initiative_fk: 1 },
    { id: 112, title: "Swarm Orchestration Feature", initiative_fk: 3 },
    { id: 113, title: "Agent Infra Leverage", initiative_fk: 4 },
    { id: 114, title: "Foundation Wave", initiative_fk: 3 },
    { id: 115, title: "API & Table Wave", initiative_fk: 3 },
    { id: 116, title: "Visualizer & Doctrine Wave", initiative_fk: 3 },
    { id: 117, title: "Acceptance", initiative_fk: 3 },
    { id: 118, title: "Polish & Showcase", initiative_fk: 3 },
    { id: 119, title: "Design Discussion", initiative_fk: 3 },
    { id: 120, title: "Swarm Lifecycle", initiative_fk: 1 },
];

export const REQUIREMENTS = [
    { id: 3041, requirement_status: "wontfix", machine_fk: 2, feature_fk: 103, coordination_type: "implemented" },
    { id: 3045, requirement_status: "met", machine_fk: 2, feature_fk: 109, coordination_type: "implemented" },
    { id: 3050, requirement_status: "met", machine_fk: 2, feature_fk: 101, coordination_type: "implemented" },
    { id: 3051, requirement_status: "met", machine_fk: 2, feature_fk: 109, coordination_type: "implemented" },
    { id: 3056, requirement_status: "met", machine_fk: 2, feature_fk: 101, coordination_type: "implemented" },
    { id: 3057, requirement_status: "met", machine_fk: 2, feature_fk: 109, coordination_type: "implemented" },
    { id: 3058, requirement_status: "met", machine_fk: 2, feature_fk: 108, coordination_type: "implemented" },
    { id: 3059, requirement_status: "met", machine_fk: 2, feature_fk: 109, coordination_type: "implemented" },
    { id: 3060, requirement_status: "met", machine_fk: 2, feature_fk: 110, coordination_type: "implemented" },
    { id: 3061, requirement_status: "met", machine_fk: 2, feature_fk: 104, coordination_type: "implemented" },
    { id: 3063, requirement_status: "met", machine_fk: 2, feature_fk: 101, coordination_type: "implemented" },
    { id: 3064, requirement_status: "met", machine_fk: 2, feature_fk: 101, coordination_type: "implemented" },
    { id: 3065, requirement_status: "met", machine_fk: 3, feature_fk: 106, coordination_type: "implemented" },
    { id: 3067, requirement_status: "met", machine_fk: 2, feature_fk: 109, coordination_type: "implemented" },
    { id: 3068, requirement_status: "met", machine_fk: 2, feature_fk: 101, coordination_type: "implemented" },
    { id: 3069, requirement_status: "met", machine_fk: 2, feature_fk: 103, coordination_type: "implemented" },
    { id: 3071, requirement_status: "met", machine_fk: 2, feature_fk: 109, coordination_type: "implemented" },
    { id: 3072, requirement_status: "met", machine_fk: 2, feature_fk: 103, coordination_type: "implemented" },
    { id: 3074, requirement_status: "approved", machine_fk: null, feature_fk: 113, coordination_type: "implemented" },
    { id: 3075, requirement_status: "met", machine_fk: 2, feature_fk: 109, coordination_type: "implemented" },
    { id: 3076, requirement_status: "met", machine_fk: 2, feature_fk: 109, coordination_type: "implemented" },
    { id: 3077, requirement_status: "met", machine_fk: 2, feature_fk: 108, coordination_type: "implemented" },
    { id: 3078, requirement_status: "met", machine_fk: 2, feature_fk: 102, coordination_type: "implemented" },
    { id: 3079, requirement_status: "met", machine_fk: 3, feature_fk: 105, coordination_type: "implemented" },
    { id: 3080, requirement_status: "met", machine_fk: 2, feature_fk: 112, coordination_type: "discuss" },
    { id: 3082, requirement_status: "approved", machine_fk: 2, feature_fk: 111, coordination_type: "implemented" },
    // THE tracking container (req #3123, `requirements.tracking`). #3083 HOLDS this
    // plan — the PLAN-JSON lived in its description — so it stays in `development`
    // for the plan's whole life and can never gate an epic of the plan it describes.
    // Its status here is `development` and NOT `met` for exactly that reason: with
    // `met` the fixture would derive epic 19 correctly for the WRONG reason and
    // exercise nothing. Epic 19 is the mixed case — #3080 met, #3083 tracking, #3105
    // met — so the gating set is all-terminal and the epic derives done, which is
    // what the plan recorded. Req #3169: req #3184's Python engine pins its ported
    // predicates against THIS file, so the signal has to be here or both engines
    // agree and both are wrong.
    { id: 3083, requirement_status: "development", tracking: 1, machine_fk: 2, feature_fk: 112, coordination_type: "implemented" },
    { id: 3084, requirement_status: "met", machine_fk: 3, feature_fk: 105, coordination_type: "implemented" },
    { id: 3085, requirement_status: "met", machine_fk: 3, feature_fk: 105, coordination_type: "implemented" },
    { id: 3086, requirement_status: "approved", machine_fk: 3, feature_fk: 105, coordination_type: "implemented" },
    { id: 3087, requirement_status: "met", machine_fk: 2, feature_fk: 108, coordination_type: "implemented" },
    { id: 3088, requirement_status: "met", machine_fk: 2, feature_fk: 108, coordination_type: "implemented" },
    { id: 3089, requirement_status: "met", machine_fk: 2, feature_fk: 110, coordination_type: "implemented" },
    { id: 3090, requirement_status: "met", machine_fk: 2, feature_fk: 108, coordination_type: "implemented" },
    { id: 3091, requirement_status: "met", machine_fk: 2, feature_fk: 108, coordination_type: "implemented" },
    { id: 3092, requirement_status: "met", machine_fk: 2, feature_fk: 110, coordination_type: "implemented" },
    { id: 3093, requirement_status: "met", machine_fk: 2, feature_fk: 110, coordination_type: "implemented" },
    { id: 3094, requirement_status: "met", machine_fk: 2, feature_fk: 110, coordination_type: "implemented" },
    { id: 3095, requirement_status: "development", machine_fk: 3, feature_fk: 107, coordination_type: "discuss" },
    { id: 3096, requirement_status: "met", machine_fk: 2, feature_fk: 107, coordination_type: "implemented" },
    { id: 3097, requirement_status: "approved", machine_fk: 2, feature_fk: 111, coordination_type: "implemented" },
    { id: 3098, requirement_status: "met", machine_fk: 2, feature_fk: 107, coordination_type: "implemented" },
    { id: 3105, requirement_status: "met", machine_fk: 2, feature_fk: 120, coordination_type: "deployed" },
    { id: 3108, requirement_status: "approved", machine_fk: 2, feature_fk: 119, coordination_type: "discuss" },
    { id: 3110, requirement_status: "development", machine_fk: 2, feature_fk: 114, coordination_type: "deployed" },
    { id: 3111, requirement_status: "development", machine_fk: 2, feature_fk: 114, coordination_type: "deployed" },
    { id: 3112, requirement_status: "development", machine_fk: 2, feature_fk: 114, coordination_type: "deployed" },
    { id: 3113, requirement_status: "swarm_ready", machine_fk: 2, feature_fk: 115, coordination_type: "deployed" },
    { id: 3114, requirement_status: "swarm_ready", machine_fk: 2, feature_fk: 115, coordination_type: "deployed" },
    { id: 3115, requirement_status: "swarm_ready", machine_fk: 2, feature_fk: 116, coordination_type: "deployed" },
    { id: 3116, requirement_status: "swarm_ready", machine_fk: 2, feature_fk: 116, coordination_type: "deployed" },
    { id: 3117, requirement_status: "swarm_ready", machine_fk: 2, feature_fk: 116, coordination_type: "deployed" },
    { id: 3118, requirement_status: "approved", machine_fk: 2, feature_fk: 117, coordination_type: "implemented" },
    { id: 3119, requirement_status: "approved", machine_fk: 2, feature_fk: 118, coordination_type: "implemented" },
];

export const EPICS = [
    { id: 1, title: "Drain: close every open swarm session so substrate surgery starts with zero in-flight work", run: "auto", notes: null },
    { id: 2, title: "Bound every MCP list read under Lambda's 6 MB response ceiling; heavy columns move to by-id reads", run: "auto", notes: null },
    { id: 3, title: "Eliminate dual-path git access (symlinks deleted, all repos moved off Desktop into real dirs), audit every git call, pr-finalize made read-only, ff-only Primary sync, hard clean-Primary gate", run: "auto", notes: null },
    { id: 4, title: "Dispositioned wontfix; live scope folded into 3072 (W7 clean gate) and 3077 (C1 grep gate, C2 origin fingerprint)", run: "auto", notes: null },
    { id: 5, title: "Validation: first full worker lifecycle run clean on the repaired substrate (also fixed the statusline dev-server indicator)", run: "auto", notes: null },
    { id: 6, title: "Repair every pre-existing test failure - backend fixture drift, MCP count asserts, two harness scripts - so the full suite reads truly green", run: "auto", notes: null },
    { id: 7, title: "Record the all-passing regression baseline across every suite; the fixed reference point for the clone-substrate regression gate - RECORDED 2026-07-26: harness 3736/3736, Lambda-Rest 134, Cognito 18, mcp unit 252 / integration 688 / production 62 - all passing", run: "auto", notes: null },
    { id: 8, title: "MCP setup on machine 3 - strictly serial: (1) /primary-ai-sync brings the WSL workspace current, (2) req 3079 migrates credentials and stands up the darwin-mcp daemon. No epic/time deps: eligible whenever the user is at the WSL box", run: "manual", notes: null },
    { id: 9, title: "Verification 1 of 3 - full MCP validation: health, wrapper read+mutation round-trips, bounded list reads, all three darwin-mcp test tiers, auto-restart. No pipeline gate - runnable immediately after W1", run: "manual", notes: null },
    { id: 23, title: "Agent Context polish (session 2439, machine 3). CORRECTED 2026-07-26: #3079 completed at 02:14Z, session created 02:17Z - it has run on the NEW daemon + credentials from birth. No stale-stack risk; normal lifecycle applies", run: "manual", notes: null },
    { id: 33, title: "AGENTIC TELEMETRY BATCH - one swarm-start, two sessions: per-document actual-token capture for architecture documents (3096), machine/model/effort columns on agent telemetry runs (3098)", run: "auto", notes: null },
    { id: 34, title: "Ground-truth breakdown of the Claude Code base token figure (spawned by #3065). Discuss coordination on the Windows/WSL machine — user starts and drives it there.", run: "manual", notes: null },
    { id: 21, title: "MILESTONE 1 (R20): mirror layer + protections land first - mirror-update.sh with the R18 single-flight freshness contract (mandatory synchronous fetch at every provision, per-repo lock, loud failure) and provision-repo.sh with R19 --no-hardlinks fully-private clones (greenfield-verified). Reviewable unit before any cutover work", run: "auto", notes: null },
    { id: 10, title: "Clone substrate core: B3 discovery + provisioning cutover (flag-gated), dual-mode cleanup, worker git_op guard, docs - wrapped in feature review, gap analysis, and full regression vs the epic-7 baseline", run: "auto", notes: null },
    { id: 26, title: "Substrate remediation from gate findings: R19 --no-hardlinks (tests assert the opposite today), R18 FRESH_WINDOW dedup + stale_ok degrade, B3 skill cutover (/swarm-start + /swarm-resume still hardcode wt- paths — breaks at flip time), R6 attribution coverage fix, MED/LOW gap tests. Blocks the flip and canaries.", run: "auto", notes: null },
    { id: 28, title: "CANARY CATCH (major): clone sessions are new project roots — Claude Code folder-trust dialog blocked both canaries; worktrees had inherited trust via their .git pointer. Fixed same-day: trust-session.sh pre-registers the trust entry in ~/.claude.json, wired into worker-launch-batch.sh before backend dispatch. Landed fa7ed2b.", run: "auto", notes: null },
    { id: 25, title: "Primary gate execution: G-feature + G-gap reviews (done — 5 deviations, 12 gaps found), independent G-regression after remediation, then B5a flag flip (LAYOUT_DEFAULT_PROVISIONING -> clone) deployed via /primary-ai-swarm-complete. Mirrors+sessions layout created and 7 mirrors seeded 2026-07-26.", run: "auto", notes: null },
    { id: 11, title: "Canary: a docs-only requirement runs the first clone-provisioned session through its entire lifecycle", run: "auto", notes: null },
    { id: 22, title: "Clone canary 2 (Mac mini, #3077 R13): throwaway requirement exercising what canary 1 cannot - >=2 repos, mid-session /hygiene checkout of a third, npm install in the session clone, dev-server registration, pause -> resume -> undo round-trip, deploy path, and the mid-flight rm -rf isolation test. Throwaway req filed at execution time", run: "auto", notes: null },
    { id: 12, title: "Seven parallel sessions on the proven substrate: house dialog pattern under /agents, IntegrityError-to-409 mapping, junction-POST 500 fix, editable Documents page, agent telemetry collection, delete-dialog wording test, sort-order invariant decision", run: "auto", notes: null },
    { id: 13, title: "POST-WAVE BATCH - one swarm-start, five sessions: provision-repo.sh venv python3.10+ fix (3089), per-repo provisioning telemetry persisted to the session record (3092), mcp-restart-if-stale.sh cross-session write to the PRIMARY clone (3093), E2E coverage for the editable agent instruction registry (3060), SECURITY POST /profiles read-back cross-tenant leak (3094)", run: "auto", notes: null },
    { id: 14, title: "Instructions Table View - hardened generic edit-in-place table pattern", run: "auto", notes: null },
    { id: 16, title: "Verification 2 of 3 - WSL CLONE TESTING (mirror of the mini canaries on machine 3): mirrors + session-clone layout via the same scripts, real /swarm-start full lifecycle, write isolation, machine-pin routing. The clone mechanism is proven per-machine, never assumed portable", run: "manual", notes: null },
    { id: 17, title: "PLAN-COMPLETION GATE. Relocate Primary to ~/darwin/primary via the same clone pattern as workers; migrate memory, config, and MCP daemon; decommission the old path (no dual-path overlap); validation battery ends with a canary swarm launch from the new home", run: "manual", notes: null },
    { id: 31, title: "Human-verified #3082 battery, executed BY the new primary session at ~/darwin/primary after cutover: layout resolution, MCP, statusline walk-ups, dev server, a canary /swarm-start from the new home, hooks/darcfg, old-path decommission audit. Failures file defects, never inline patches.", run: "manual", notes: null },
    { id: 18, title: "Verification 3 of 3 - full primary session independence: execute the epic-12 runbook on machine 3, old-path decommission, validation battery from the new home. Completes WSL parity", run: "manual", notes: null },
    { id: 19, title: "Cherry: discuss session specs the pipelines-as-data feature and files its follow-on requirements - this plan is its seed dataset, held by tracking req 3083 (single source of truth this page renders from) + BATCHED same launch: swarm-complete RDS-snapshots without asking permission (3105, cross-initiative per rule 10)", run: "auto", notes: null },
    { id: 20, title: "Darwin Primary AI and swarm workers leverage the Agent infrastructure (final epic of the plan)", run: "auto", notes: null },
    { id: 38, title: "FOUNDATION BATCH - one swarm-start, three sessions: design-intent grooming into Swarm Architect docs (3110), schema foundation - initiatives/features/requirements hierarchy + pipelines/epics/epic-requirements/epic-deps tables + API routes + darwin_dev fixtures from this plan (3111), pure-JS ordering/derivation engine with self-checking invariants (3112)", run: "auto", notes: null },
    { id: 39, title: "API & TABLE BATCH: MCP pipelines resources + echo-verified mutation tools with single-read render (3113); SwarmView pipelines hooks/routes/list page + plan-rows table view per pipeline-plan-tracking rules (3114)", run: "auto", notes: null },
    { id: 40, title: "VISUALIZER & DOCTRINE BATCH: Plan (no time anchor) visualizer with drag-pan + three-level zoom, clickable epics/reqs/initiatives (3115); Primary execution doctrine + 8-case mutation playbook + fail-loud watchdog (3116); server-side cost rollup + Time/Tokens enable (3117)", run: "auto", notes: null },
    { id: 41, title: "Acceptance battery: Playwright E2E over the seeded darwin_dev plan + replay of all 8 recorded mutation classes via MCP tools, asserting derived state and invariant-clean rendered order after each", run: "auto", notes: null },
    { id: 42, title: "FINAL POLISH & SHOWCASE (implemented - the initiative's only user-review stop): re-seed darwin_dev with the full live 3083 plan, cosmetic polish pass, dev server deep-linked to /swarm/pipelines, concise executive summary; user checks all features", run: "auto", notes: null },
    { id: 43, title: "Design discussion (discuss, user-driven): cooperative inter-Claude message system - grounded by the shipped orchestration core + Primary doctrine; informs future proactive Primary/worker communication", run: "manual", notes: null },
];

export const EPIC_REQUIREMENTS = [
    { epic_fk: 1, requirement_fk: 3050 },
    { epic_fk: 1, requirement_fk: 3056 },
    { epic_fk: 1, requirement_fk: 3063 },
    { epic_fk: 1, requirement_fk: 3064 },
    { epic_fk: 1, requirement_fk: 3068 },
    { epic_fk: 2, requirement_fk: 3078 },
    { epic_fk: 3, requirement_fk: 3072 },
    { epic_fk: 4, requirement_fk: 3041 },
    { epic_fk: 5, requirement_fk: 3069 },
    { epic_fk: 6, requirement_fk: 3061 },
    { epic_fk: 8, requirement_fk: 3079 },
    { epic_fk: 9, requirement_fk: 3084 },
    { epic_fk: 23, requirement_fk: 3065 },
    { epic_fk: 33, requirement_fk: 3096 },
    { epic_fk: 33, requirement_fk: 3098 },
    { epic_fk: 34, requirement_fk: 3095 },
    { epic_fk: 21, requirement_fk: 3077 },
    { epic_fk: 10, requirement_fk: 3077 },
    { epic_fk: 26, requirement_fk: 3088 },
    { epic_fk: 28, requirement_fk: 3091 },
    { epic_fk: 25, requirement_fk: 3087 },
    { epic_fk: 11, requirement_fk: 3058 },
    { epic_fk: 22, requirement_fk: 3090 },
    { epic_fk: 12, requirement_fk: 3071 },
    { epic_fk: 12, requirement_fk: 3059 },
    { epic_fk: 12, requirement_fk: 3057 },
    { epic_fk: 12, requirement_fk: 3051 },
    { epic_fk: 12, requirement_fk: 3045 },
    { epic_fk: 12, requirement_fk: 3076 },
    { epic_fk: 12, requirement_fk: 3075 },
    { epic_fk: 13, requirement_fk: 3089 },
    { epic_fk: 13, requirement_fk: 3092 },
    { epic_fk: 13, requirement_fk: 3093 },
    { epic_fk: 13, requirement_fk: 3060 },
    { epic_fk: 13, requirement_fk: 3094 },
    { epic_fk: 14, requirement_fk: 3067 },
    { epic_fk: 16, requirement_fk: 3085 },
    { epic_fk: 17, requirement_fk: 3082 },
    { epic_fk: 31, requirement_fk: 3097 },
    { epic_fk: 18, requirement_fk: 3086 },
    { epic_fk: 19, requirement_fk: 3080 },
    { epic_fk: 19, requirement_fk: 3083 },
    { epic_fk: 19, requirement_fk: 3105 },
    { epic_fk: 20, requirement_fk: 3074 },
    { epic_fk: 38, requirement_fk: 3110 },
    { epic_fk: 38, requirement_fk: 3111 },
    { epic_fk: 38, requirement_fk: 3112 },
    { epic_fk: 39, requirement_fk: 3113 },
    { epic_fk: 39, requirement_fk: 3114 },
    { epic_fk: 40, requirement_fk: 3115 },
    { epic_fk: 40, requirement_fk: 3116 },
    { epic_fk: 40, requirement_fk: 3117 },
    { epic_fk: 41, requirement_fk: 3118 },
    { epic_fk: 42, requirement_fk: 3119 },
    { epic_fk: 43, requirement_fk: 3108 },
];

export const EPIC_DEPS = [
    { epic_fk: 3, dep_epic_fk: 1, time_at: null },
    { epic_fk: 4, dep_epic_fk: 3, time_at: null },
    { epic_fk: 5, dep_epic_fk: 3, time_at: null },
    { epic_fk: 6, dep_epic_fk: 5, time_at: null },
    { epic_fk: 7, dep_epic_fk: 6, time_at: null },
    { epic_fk: 9, dep_epic_fk: 8, time_at: null },
    { epic_fk: 33, dep_epic_fk: 23, time_at: null },
    { epic_fk: 34, dep_epic_fk: 23, time_at: null },
    { epic_fk: 21, dep_epic_fk: 7, time_at: null },
    { epic_fk: 10, dep_epic_fk: 21, time_at: null },
    { epic_fk: 26, dep_epic_fk: 10, time_at: null },
    { epic_fk: 28, dep_epic_fk: 25, time_at: null },
    { epic_fk: 25, dep_epic_fk: 10, time_at: null },
    { epic_fk: 25, dep_epic_fk: 26, time_at: null },
    { epic_fk: 11, dep_epic_fk: 25, time_at: null },
    { epic_fk: 22, dep_epic_fk: 11, time_at: null },
    { epic_fk: 12, dep_epic_fk: 11, time_at: null },
    { epic_fk: 12, dep_epic_fk: 22, time_at: null },
    { epic_fk: 12, dep_epic_fk: 28, time_at: null },
    { epic_fk: 13, dep_epic_fk: 12, time_at: null },
    { epic_fk: 14, dep_epic_fk: 12, time_at: null },
    { epic_fk: 14, dep_epic_fk: 13, time_at: null },
    { epic_fk: 16, dep_epic_fk: 9, time_at: null },
    { epic_fk: 16, dep_epic_fk: 11, time_at: null },
    { epic_fk: 17, dep_epic_fk: 12, time_at: null },
    { epic_fk: 17, dep_epic_fk: 13, time_at: null },
    { epic_fk: 17, dep_epic_fk: 14, time_at: null },
    { epic_fk: 31, dep_epic_fk: 17, time_at: null },
    { epic_fk: 18, dep_epic_fk: 16, time_at: null },
    { epic_fk: 18, dep_epic_fk: 17, time_at: null },
    { epic_fk: 19, dep_epic_fk: 14, time_at: null },
    { epic_fk: 20, dep_epic_fk: 17, time_at: null },
    { epic_fk: 20, dep_epic_fk: 31, time_at: null },
    { epic_fk: 38, dep_epic_fk: 19, time_at: null },
    { epic_fk: 39, dep_epic_fk: 38, time_at: null },
    { epic_fk: 40, dep_epic_fk: 39, time_at: null },
    { epic_fk: 41, dep_epic_fk: 40, time_at: null },
    { epic_fk: 42, dep_epic_fk: 41, time_at: null },
    { epic_fk: 43, dep_epic_fk: 40, time_at: null },
];

export const SUBSTRATE_REBUILD_MODEL = {
    pipeline: { id: 1, title: "Substrate Rebuild Pipeline", description: null,
        pipeline_status: "active", machine_fk: 2 },
    epics: EPICS,
    epicRequirements: EPIC_REQUIREMENTS,
    epicDeps: EPIC_DEPS,
    requirements: REQUIREMENTS,
    features: FEATURES,
    initiatives: INITIATIVES,
    machines: MACHINES,
};
