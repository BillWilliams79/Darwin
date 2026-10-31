// Pipeline 20 "WSL Enterprise Topology" — the composed read of 2026-10-31T22:37Z,
// trimmed to the fields the layout reads (req #4145's live repro).
export const PLAN20_READ = {
 "pipeline": {
  "id": 20,
  "title": "WSL Enterprise Topology",
  "pipeline_status": "orchestrating",
  "locked": 0,
  "machine_fk": 3,
  "epic_count": 9
 },
 "initiatives": [
  {
   "id": 56,
   "title": "File sharing",
   "sort_order": 1,
   "closed": 0,
   "initiative_status": "active",
   "locked": 0,
   "pipeline_fk": 20
  },
  {
   "id": 57,
   "title": "DNS",
   "sort_order": 2,
   "closed": 0,
   "initiative_status": "active",
   "locked": 0,
   "pipeline_fk": 20
  }
 ],
 "initiative_deps": [],
 "epics": [
  {
   "id": 438,
   "title": "Login Credentials",
   "initiative_fk": 56,
   "checkpoint": 1,
   "not_before": null,
   "run": "auto",
   "locked": 0
  },
  {
   "id": 442,
   "title": "WSL Swarm and Orchestration Patchup",
   "initiative_fk": 56,
   "checkpoint": 1,
   "not_before": null,
   "run": "manual",
   "locked": 0
  },
  {
   "id": 454,
   "title": "MUST RUN MAC PRIMARY AI",
   "initiative_fk": 56,
   "checkpoint": 1,
   "not_before": null,
   "run": "manual",
   "locked": 0
  },
  {
   "id": 456,
   "title": "WSL Patchup closeout",
   "initiative_fk": 56,
   "checkpoint": 1,
   "not_before": null,
   "run": "manual",
   "locked": 0
  },
  {
   "id": 458,
   "title": "Microchip Service Access",
   "initiative_fk": 56,
   "checkpoint": 0,
   "not_before": null,
   "run": "manual",
   "locked": 0
  },
  {
   "id": 459,
   "title": "Internal foundation",
   "initiative_fk": 56,
   "checkpoint": 1,
   "not_before": null,
   "run": "auto",
   "locked": 0
  },
  {
   "id": 460,
   "title": "Internal deploy",
   "initiative_fk": 56,
   "checkpoint": 1,
   "not_before": null,
   "run": "auto",
   "locked": 0
  },
  {
   "id": 461,
   "title": "AD login",
   "initiative_fk": 56,
   "checkpoint": 1,
   "not_before": null,
   "run": "auto",
   "locked": 0
  },
  {
   "id": 462,
   "title": "Internal API Gateway",
   "initiative_fk": 56,
   "checkpoint": 1,
   "not_before": null,
   "run": "auto",
   "locked": 0
  }
 ],
 "epic_requirements": [
  {
   "epic_fk": 438,
   "requirement_fk": 4015
  },
  {
   "epic_fk": 438,
   "requirement_fk": 4074
  },
  {
   "epic_fk": 442,
   "requirement_fk": 3176
  },
  {
   "epic_fk": 442,
   "requirement_fk": 3457
  },
  {
   "epic_fk": 442,
   "requirement_fk": 3832
  },
  {
   "epic_fk": 442,
   "requirement_fk": 4018
  },
  {
   "epic_fk": 442,
   "requirement_fk": 4048
  },
  {
   "epic_fk": 442,
   "requirement_fk": 4050
  },
  {
   "epic_fk": 442,
   "requirement_fk": 4055
  },
  {
   "epic_fk": 442,
   "requirement_fk": 4059
  },
  {
   "epic_fk": 442,
   "requirement_fk": 4068
  },
  {
   "epic_fk": 454,
   "requirement_fk": 4052
  },
  {
   "epic_fk": 454,
   "requirement_fk": 4060
  },
  {
   "epic_fk": 454,
   "requirement_fk": 4061
  },
  {
   "epic_fk": 454,
   "requirement_fk": 4073
  },
  {
   "epic_fk": 456,
   "requirement_fk": 4020
  },
  {
   "epic_fk": 458,
   "requirement_fk": 4072
  },
  {
   "epic_fk": 459,
   "requirement_fk": 4075
  },
  {
   "epic_fk": 459,
   "requirement_fk": 4076
  },
  {
   "epic_fk": 460,
   "requirement_fk": 4077
  },
  {
   "epic_fk": 461,
   "requirement_fk": 4078
  },
  {
   "epic_fk": 462,
   "requirement_fk": 4079
  }
 ],
 "epic_deps": [
  {
   "epic_fk": 438,
   "dep_epic_fk": 442
  },
  {
   "epic_fk": 454,
   "dep_epic_fk": 442
  },
  {
   "epic_fk": 456,
   "dep_epic_fk": 454
  },
  {
   "epic_fk": 458,
   "dep_epic_fk": 438
  },
  {
   "epic_fk": 459,
   "dep_epic_fk": 438
  },
  {
   "epic_fk": 460,
   "dep_epic_fk": 462
  },
  {
   "epic_fk": 461,
   "dep_epic_fk": 460
  },
  {
   "epic_fk": 462,
   "dep_epic_fk": 459
  }
 ],
 "requirements": [
  {
   "id": 3176,
   "title": "MCHP Primary AI Only: Cut Over to New Swarm",
   "requirement_status": "met",
   "coordination_type": "implemented",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": null,
   "completed_at": "2026-10-29T15:03:30"
  },
  {
   "id": 3457,
   "title": "MCHP Windows: Build/Test Terminal Link Button",
   "requirement_status": "met",
   "coordination_type": "implemented",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": null,
   "completed_at": "2026-10-29T16:08:42"
  },
  {
   "id": 3832,
   "title": "Statusline scope label (Primary): epic2: becomes initiative2:, with the registry keys and ~/.claude/statusline.sh",
   "requirement_status": "met",
   "coordination_type": "implemented",
   "machine_fk": null,
   "tracking": 0,
   "started_at": null,
   "completed_at": "2026-10-29T15:40:41"
  },
  {
   "id": 4015,
   "title": "Provide login creditals and access",
   "requirement_status": "met",
   "coordination_type": "discuss",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": null,
   "completed_at": "2026-10-29T21:13:11"
  },
  {
   "id": 4018,
   "title": "WSL: install and prove Engine 2 (MCP, supervisor unit, executor launch in Windows Terminal)",
   "requirement_status": "met",
   "coordination_type": "implemented",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": null,
   "completed_at": "2026-10-29T15:31:24"
  },
  {
   "id": 4020,
   "title": "CONTROL: WSL Swarm Patchup to 100% (walk order for epic 442)",
   "requirement_status": "swarm_ready",
   "coordination_type": "implemented",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": null,
   "completed_at": null
  },
  {
   "id": 4048,
   "title": "darcfg per-machine settings overlay (e.g. Opus effort per machine)",
   "requirement_status": "met",
   "coordination_type": "deployed",
   "machine_fk": null,
   "tracking": 0,
   "started_at": null,
   "completed_at": "2026-10-29T18:58:30"
  },
  {
   "id": 4050,
   "title": "Remove legacy-layout fallback (both machines now on mirrors/primary/sessions)",
   "requirement_status": "met",
   "coordination_type": "deployed",
   "machine_fk": null,
   "tracking": 0,
   "started_at": null,
   "completed_at": "2026-10-29T17:16:45"
  },
  {
   "id": 4052,
   "title": "Engine 2 cross-machine join: WSL subscribes to a Mac-led plan (req #4018 item 6)",
   "requirement_status": "swarm_ready",
   "coordination_type": "discuss",
   "machine_fk": 2,
   "tracking": 0,
   "started_at": null,
   "completed_at": null
  },
  {
   "id": 4055,
   "title": "Remove the legacy ../../Topology rung from Darwin vite.config.js",
   "requirement_status": "met",
   "coordination_type": "deployed",
   "machine_fk": null,
   "tracking": 0,
   "started_at": null,
   "completed_at": "2026-10-29T17:48:31"
  },
  {
   "id": 4059,
   "title": "Post-#4050 canary: /swarm-start lifecycle on the fallback-free layout (Primary, WSL)",
   "requirement_status": "met",
   "coordination_type": "implemented",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": null,
   "completed_at": "2026-10-29T18:11:01"
  },
  {
   "id": 4060,
   "title": "Mac Mini catch-up after WSL patchup: /primary-ai-sync + close #4022",
   "requirement_status": "swarm_ready",
   "coordination_type": "discuss",
   "machine_fk": 2,
   "tracking": 0,
   "started_at": null,
   "completed_at": null
  },
  {
   "id": 4061,
   "title": "Mac half of #4048: apply the per-machine settings overlay on the Mac",
   "requirement_status": "swarm_ready",
   "coordination_type": "discuss",
   "machine_fk": 2,
   "tracking": 0,
   "started_at": null,
   "completed_at": null
  },
  {
   "id": 4068,
   "title": "Reconcile modelSettings effort in the darcfg canon (follow-on to #4048)",
   "requirement_status": "met",
   "coordination_type": "implemented",
   "machine_fk": null,
   "tracking": 0,
   "started_at": null,
   "completed_at": "2026-10-29T20:32:39"
  },
  {
   "id": 4072,
   "title": "Connect WSL Claude Code to the Microchip DevAI MCP Gateway servers",
   "requirement_status": "swarm_ready",
   "coordination_type": "discuss",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": null,
   "completed_at": null
  },
  {
   "id": 4073,
   "title": "Verify #4068 on the Mac: Opus statusline shows high, saved /effort heals",
   "requirement_status": "swarm_ready",
   "coordination_type": "deployed",
   "machine_fk": 2,
   "tracking": 0,
   "started_at": null,
   "completed_at": null
  },
  {
   "id": 4074,
   "title": "Enterprise Architect agent",
   "requirement_status": "met",
   "coordination_type": "deployed",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": null,
   "completed_at": "2026-10-30T15:21:47"
  },
  {
   "id": 4075,
   "title": "Internal database",
   "requirement_status": "met",
   "coordination_type": "implemented",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": null,
   "completed_at": "2026-10-31T22:26:36"
  },
  {
   "id": 4076,
   "title": "Internal Topology build",
   "requirement_status": "development",
   "coordination_type": "implemented",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": "2026-10-31T21:45:01",
   "completed_at": null
  },
  {
   "id": 4077,
   "title": "Internal deploy",
   "requirement_status": "swarm_ready",
   "coordination_type": "implemented",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": null,
   "completed_at": null
  },
  {
   "id": 4078,
   "title": "AD login",
   "requirement_status": "swarm_ready",
   "coordination_type": "discuss",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": null,
   "completed_at": null
  },
  {
   "id": 4079,
   "title": "Internal API Gateway",
   "requirement_status": "swarm_ready",
   "coordination_type": "deployed",
   "machine_fk": 3,
   "tracking": 0,
   "started_at": null,
   "completed_at": null
  }
 ],
 "derived": {
  "initiative_order": [
   56,
   57
  ],
  "display_order": [
   442,
   438,
   454,
   459,
   458,
   456,
   462,
   460,
   461
  ],
  "rows": [
   {
    "id": 442,
    "run": "manual",
    "checkpoint": true,
    "locked": false,
    "eligible": false,
    "open_req_ids": [],
    "gate_open": true,
    "launch_candidate": false,
    "initiative_id": 56,
    "dep_ids": [],
    "req_ids": [
     3176,
     3457,
     3832,
     4018,
     4048,
     4050,
     4055,
     4059,
     4068
    ],
    "gating_req_ids": [
     3176,
     3457,
     3832,
     4018,
     4048,
     4050,
     4055,
     4059,
     4068
    ],
    "tracking_req_ids": [],
    "not_before": null
   },
   {
    "id": 438,
    "run": "auto",
    "checkpoint": true,
    "locked": false,
    "eligible": false,
    "open_req_ids": [],
    "gate_open": true,
    "launch_candidate": false,
    "initiative_id": 56,
    "dep_ids": [
     442
    ],
    "req_ids": [
     4015,
     4074
    ],
    "gating_req_ids": [
     4015,
     4074
    ],
    "tracking_req_ids": [],
    "not_before": null
   },
   {
    "id": 454,
    "run": "manual",
    "checkpoint": true,
    "locked": false,
    "eligible": true,
    "open_req_ids": [
     4052,
     4060,
     4061,
     4073
    ],
    "gate_open": true,
    "launch_candidate": true,
    "initiative_id": 56,
    "dep_ids": [
     442
    ],
    "req_ids": [
     4052,
     4060,
     4061,
     4073
    ],
    "gating_req_ids": [
     4052,
     4060,
     4061,
     4073
    ],
    "tracking_req_ids": [],
    "not_before": null
   },
   {
    "id": 459,
    "run": "auto",
    "checkpoint": true,
    "locked": false,
    "eligible": false,
    "open_req_ids": [
     4076
    ],
    "gate_open": true,
    "launch_candidate": false,
    "initiative_id": 56,
    "dep_ids": [
     438
    ],
    "req_ids": [
     4075,
     4076
    ],
    "gating_req_ids": [
     4075,
     4076
    ],
    "tracking_req_ids": [],
    "not_before": null
   },
   {
    "id": 458,
    "run": "manual",
    "checkpoint": false,
    "locked": false,
    "eligible": true,
    "open_req_ids": [
     4072
    ],
    "gate_open": true,
    "launch_candidate": true,
    "initiative_id": 56,
    "dep_ids": [
     438
    ],
    "req_ids": [
     4072
    ],
    "gating_req_ids": [
     4072
    ],
    "tracking_req_ids": [],
    "not_before": null
   },
   {
    "id": 456,
    "run": "manual",
    "checkpoint": true,
    "locked": false,
    "eligible": false,
    "open_req_ids": [
     4020
    ],
    "gate_open": false,
    "launch_candidate": false,
    "initiative_id": 56,
    "dep_ids": [
     454
    ],
    "req_ids": [
     4020
    ],
    "gating_req_ids": [
     4020
    ],
    "tracking_req_ids": [],
    "not_before": null
   },
   {
    "id": 462,
    "run": "auto",
    "checkpoint": true,
    "locked": false,
    "eligible": false,
    "open_req_ids": [
     4079
    ],
    "gate_open": false,
    "launch_candidate": false,
    "initiative_id": 56,
    "dep_ids": [
     459
    ],
    "req_ids": [
     4079
    ],
    "gating_req_ids": [
     4079
    ],
    "tracking_req_ids": [],
    "not_before": null
   },
   {
    "id": 460,
    "run": "auto",
    "checkpoint": true,
    "locked": false,
    "eligible": false,
    "open_req_ids": [
     4077
    ],
    "gate_open": false,
    "launch_candidate": false,
    "initiative_id": 56,
    "dep_ids": [
     462
    ],
    "req_ids": [
     4077
    ],
    "gating_req_ids": [
     4077
    ],
    "tracking_req_ids": [],
    "not_before": null
   },
   {
    "id": 461,
    "run": "auto",
    "checkpoint": true,
    "locked": false,
    "eligible": false,
    "open_req_ids": [
     4078
    ],
    "gate_open": false,
    "launch_candidate": false,
    "initiative_id": 56,
    "dep_ids": [
     460
    ],
    "req_ids": [
     4078
    ],
    "gating_req_ids": [
     4078
    ],
    "tracking_req_ids": [],
    "not_before": null
   }
  ],
  "launch_queue": [
   {
    "epic_id": 454,
    "requirement_id": 4073
   },
   {
    "epic_id": 454,
    "requirement_id": 4052
   },
   {
    "epic_id": 454,
    "requirement_id": 4060
   },
   {
    "epic_id": 454,
    "requirement_id": 4061
   },
   {
    "epic_id": 458,
    "requirement_id": 4072
   }
  ],
  "pause": {
   "pipeline_status": "orchestrating",
   "pipeline_orchestrating": true,
   "paused_initiative_ids": [],
   "suppressed_epic_ids": []
  }
 }
};
export const PLAN20_NOW = new Date('2026-10-31T22:37:00Z');
