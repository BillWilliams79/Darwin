// devopsQueries2.js — Pipeline 2.0 plan-layer query layer (req #3393).
//
// Stands BESIDE devopsQueries.js, never inside it. It is a NEW file that
// imports nothing from devopsQueries.js, useDataQueries.js or useQueryKeys.js,
// and nothing there imports from here — the two eras' read paths share only
// the entity-agnostic factory (createEntityQueries.js) and RestApi.js. This
// mirrors the backend rule darwin-mcp/services/pipelines2.py states for
// itself: "must not import from, call, or otherwise touch pipelines.py."
//
// The five pipeline2_* tables (req #3348's MCP mutation surface; the schema
// is unread here beyond what darwin-mcp/services/pipelines2.py's docstrings
// and function bodies establish, since DarwinSQL/Lambda-Rest are not checked
// out in this session) are reachable through Lambda-Rest's GENERIC entity
// routes exactly like every 1.0 devops table — same gateway, same
// `createEntityQueries` factory, different table names:
//
//   pipeline2_pipelines ──< pipeline2_epics ──< pipeline2_steps
//                                            │
//                         pipeline2_step_requirements >── requirements
//                                            │
//                                 pipeline2_step_deps ──> pipeline2_steps
//
// Unlike 1.0, a step carries `epic_fk`, not `pipeline_fk` — containment means
// a step's plan is a consequence of its epic, not a fact of its own (design
// rule: nothing stated twice). `pipeline2_step_deps` carries no `time_at`
// column either — the one-instant time gate lives on the step itself
// (`not_before`) now, not on a dependency row.
//
// Routes through the default `darwinUri` (dev/prod split, req #2683), NOT
// `ops: true` — same reasoning devopsQueries.js gives for `pipelines`: a plan
// is durable content a person and the Primary AI curate, not live machine
// state, and `darwin_dev` carries the seeded 2.0 fixture (req #3393 seeding
// step) while production stays sparse during the parallel-run period.
//
// Every read here is an UNFILTERED, WHOLE-TABLE list read, exactly like
// devopsQueries.js's pipeline block — never a per-plan or per-step fetch
// (the same design rule 1.0's pages already follow). Real, server-derived
// step/plan STATE (the `pipeline2_compose` composed route) is deliberately
// NOT wired here: this file only carries raw row reads and the small
// completion-guard predicate in steps2Model.js needs (does this step have any
// non-container linked requirement at all) — see PLAN.md for the full
// rationale on why full Pending/Running/Done derivation is out of scope for
// this requirement.

import { createEntityQueries } from './createEntityQueries';

// ---------------------------------------------------------------------------
// pipeline2_pipelines
// ---------------------------------------------------------------------------
export const pipelines2 = createEntityQueries({
    entity: 'pipeline2_pipelines',
    defaultFields:
        'id,title,description,pipeline_status,execution_mode,machine_fk,' +
        'started_at,completed_at,creator_fk,create_ts,update_ts',
    fieldsInKey: true,
    // Newest plan first — matches devopsQueries.js's `pipelines` block.
    defaultSort: 'id:desc',
});

// ---------------------------------------------------------------------------
// pipeline2_epics
// ---------------------------------------------------------------------------
export const pipeline2Epics = createEntityQueries({
    entity: 'pipeline2_epics',
    defaultFields:
        'id,pipeline_fk,title,description,epic_status,sort_order,category_fk,' +
        'closed,creator_fk,create_ts,update_ts',
    fieldsInKey: true,
    defaultSort: 'sort_order:asc',
});

// ---------------------------------------------------------------------------
// pipeline2_steps
// ---------------------------------------------------------------------------
// `sort=id:asc` — carried over from devopsQueries.js's `pipelineSteps` block
// for the identical reason: pipeline2_steps has no sequence column of its own
// (order is derived), so "canonical stored order" means the auto-increment id
// ascending, and any page presenting these rows before deriving its own order
// needs a stable input order to do it from.
export const pipeline2Steps = createEntityQueries({
    entity: 'pipeline2_steps',
    defaultFields: 'id,epic_fk,title,run,notes,not_before,completed_at,creator_fk',
    fieldsInKey: true,
    defaultSort: 'id:asc',
});

// Junction, composite PK (requirement_fk) — NO `id` column, never request one.
// No creator_fk either — ownership is inherited from the step, same rule
// devopsQueries.js states for pipelineStepRequirements.
export const pipeline2StepRequirements = createEntityQueries({
    entity: 'pipeline2_step_requirements',
    defaultFields: 'step_fk,requirement_fk',
    fieldsInKey: true,
});

// Dependency edges. Surrogate `id`, no `time_at` (schema difference from 1.0
// — the time gate moved to pipeline2_steps.not_before), no creator_fk (same
// inherited-ownership rule as the junction above).
export const pipeline2StepDeps = createEntityQueries({
    entity: 'pipeline2_step_deps',
    defaultFields: 'id,step_fk,dep_step_fk',
    fieldsInKey: true,
});

// ---------------------------------------------------------------------------
// Cache-key exports, matching useQueryKeys.js's `pipelineKeys` /
// `pipelineStepKeys` / … naming for the 1.0 tables — this file's own copy
// rather than an addition to useQueryKeys.js, for the same file-isolation
// reason as everything else here.
// ---------------------------------------------------------------------------
export const pipeline2Keys = pipelines2.keys;
export const pipeline2EpicKeys = pipeline2Epics.keys;
export const pipeline2StepKeys = pipeline2Steps.keys;
export const pipeline2StepRequirementKeys = pipeline2StepRequirements.keys;
export const pipeline2StepDepKeys = pipeline2StepDeps.keys;

// ---------------------------------------------------------------------------
// Named hook exports, matching useDataQueries.js's `useAllPipelines` /
// `useAllPipelineSteps` / … naming so the new pages read exactly the way the
// 1.0 pages do.
// ---------------------------------------------------------------------------
export const useAllPipelines2 = pipelines2.useAll;
export const useAllPipeline2Epics = pipeline2Epics.useAll;
export const useAllPipeline2Steps = pipeline2Steps.useAll;
export const useAllPipeline2StepRequirements = pipeline2StepRequirements.useAll;
export const useAllPipeline2StepDeps = pipeline2StepDeps.useAll;
