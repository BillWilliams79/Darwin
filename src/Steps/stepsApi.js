// Mutation utilities for the pipeline_steps data type (req #3140).
//
// Steps are the members of an execution plan (req #3111, migration 076). The
// frontend has READ them since req #3114 (`useAllPipelineSteps`) and renders
// them in the plan table and the plan visualizer, but had no write path at all —
// every step in production was created by the Primary AI through the MCP tools.
// This module is the browser's write half, and it goes through the SAME gateway
// path `darwin-mcp/services/pipelines.py` already POSTs, PUTs and DELETEs:
// `{darwinUri}/pipeline_steps`. No new backend surface exists or is needed.
//
// Pattern mirrors Epics/epicsApi.js — call_rest_api directly, callers handle
// TanStack Query cache invalidation via queryClient.invalidateQueries.
//
// ## The invariants this module has to carry itself
//
// The browser does NOT go through the MCP service, so the two design rules
// `pipelines.py` enforces in Python are unenforced on this path unless they are
// reproduced here. They are, and `stepsModel.js` holds the decision half as pure
// tested functions:
//
//   * design rule 1 — `completed_at` is valid ONLY on a step with zero GATING
//     requirements (tracking containers exempt, req #3123). `completeStep` is the
//     only function here that stamps it. What DECIDES is StepsPage's
//     `completeFlow`, from a LIVE re-read (`fetchStepRequirementIds` +
//     `fetchRequirementTracking` below); `stepsModel`'s `completionGuard` is the
//     cached fast path in front of it, not the rule.
//   * design rule 4 — a step another step depends on cannot be deleted. Here the
//     schema really is the enforcement (`dep_step_fk` is ON DELETE RESTRICT) and
//     `deleteStep` is deliberately ONE statement so that the refusal is atomic;
//     see its own note for why three statements from a browser would be worse
//     than none.
//
// Column shape (measured against `darwin://pipeline/2` and services/pipelines.py):
//   pipeline_fk   required, the step's plan membership — its IDENTITY, never updated
//   title         NOT NULL, VARCHAR(256)
//   run           'auto' | 'manual'
//   notes         nullable TEXT
//   completed_at  nullable DATETIME — stamped by completeStep, cleared by reopenStep

import call_rest_api from '../RestApi/RestApi';
import { fetchEntity } from '../hooks/factory/createEntityQueries';

const isOk = (status) => status === 200 || status === 201 || status === 204;

// Only ever reached for the status call_rest_api RETURNS rather than throws —
// the synthetic 503 it manufactures for a transport-level failure. Every gateway
// error (4xx/5xx) is thrown from call_rest_api as a bare `{data, httpStatus}`
// object and never arrives here. The thrown Error carries `httpStatus` so BOTH
// shapes read identically to useSnackBarStore's two-argument form, which renders
// the status code beside the caller's message.
function assertOk(result, action) {
    const status = result.httpStatus?.httpStatus;
    if (!isOk(status)) {
        const msg = result.httpStatus?.httpMessage || 'unknown';
        const error = new Error(`${action} failed: HTTP ${status} ${msg}`);
        error.httpStatus = result.httpStatus;
        throw error;
    }
    return result.data;
}

// Lambda-Rest's clear-a-column sentinel: the literal string 'NULL'. A JSON null
// is not what it recognizes on a PUT, which is why an update that wants to empty
// `notes` has to send this (the same rule the MCP's `update_pipeline_step` obeys
// via its own NULL constant).
//
// IT IS NOT PUT-ONLY. `rest_post.py` applies the identical substitution, so a
// POST carrying the string 'NULL' stores SQL NULL too — the create path below
// sends a real `null` for an empty field because that is clearer at the call
// site, not because the sentinel would be stored verbatim.
//
// The consequence is on BOTH verbs and it reaches free text: a user who types the
// four characters N-U-L-L into a field gets SQL NULL stored. Harmless for `notes`
// (nullable), fatal for `title` (NOT NULL — MySQL 1048, an opaque 500 at the
// gateway), which is why `isRestNullLiteral` exists and StepsPage refuses it in
// the form rather than letting the user meet that 500.
export const REST_NULL = 'NULL';

/**
 * Whether a user-typed value would be swallowed by the REST_NULL sentinel.
 *
 * Compared against the TRIMMED value because that is what the page sends, and
 * case-sensitively because the substitution in `rest_post`/`rest_put` is `v ==
 * "NULL"` — 'null' and 'Null' reach the column as ordinary text and must not be
 * refused.
 */
export const isRestNullLiteral = (value) => String(value ?? '').trim() === REST_NULL;

// The MySQL naive-datetime form Darwin stores everywhere, in UTC — the same
// expression TestCatalog/actions/validationApi.js uses for `completed_at`, and the
// browser's equivalent of the MCP's `sql_now()`. `toISOString()` is UTC by
// definition, so a step completed from any timezone stamps the same instant.
// The 'T' has to go: `dateFormat.formatDateTime` reads the space-separated form
// as UTC and the 'T' form as LOCAL, so shipping the ISO form would render the
// stamp offset-shifted on every page that displays it.
export const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export const VALID_RUN_MODES = ['auto', 'manual'];

/**
 * Create a step in a plan.
 *
 * `completed_at` is never set here — a step is born incomplete, and a step with
 * requirements may never carry the stamp at all (design rule 1). Requirement
 * links and dependency rows are not created either: the MCP's
 * `create_pipeline_step` is atomic over all three precisely because plan edit and
 * launch are ONE action (req #3083), and this page deliberately does not own that
 * act — see the header of StepsPage.jsx.
 */
export async function createStep(darwinUri, idToken,
    { pipeline_fk, title, run = 'auto', notes = null }) {
    const r = await call_rest_api(`${darwinUri}/pipeline_steps`, 'POST',
        { pipeline_fk, title, run, notes, completed_at: null }, idToken);
    return assertOk(r, 'createStep');
}

/**
 * Update a step's own columns.
 *
 * `fields` is a partial update. Nullable columns the caller wants CLEARED must
 * arrive as REST_NULL; StepsPage does that conversion where it knows which
 * fields are nullable, rather than this transport guessing from a falsy value
 * (an empty-string title and a cleared notes field are not the same act).
 *
 * `notes` REPLACES, never appends — the MCP rule, and for its reason: the
 * transport has no append primitive, so an "append" would be a read-modify-write
 * with the read hidden inside the call and a concurrent editor would lose an
 * entry with no error anywhere.
 */
export async function updateStep(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/pipeline_steps`, 'PUT',
        [{ id, ...fields }], idToken);
    return assertOk(r, 'updateStep');
}

/**
 * Stamp `completed_at` — the manual-step completion, and the ONLY place it is
 * ever set from the browser.
 *
 * DESIGN RULE 1 IS THE CALLER'S PRECONDITION, and it is not optional: this must
 * be called only for a step whose gating set was just confirmed EMPTY BY A LIVE
 * READ (StepsPage's `completeFlow`). `completionGuard` alone is not sufficient —
 * it answers from the ≤30s cache. A requirement-backed step's
 * state is DERIVED from its requirements, so a stored stamp could only ever agree
 * with them by luck — and the plan renderers would keep showing the derived
 * answer while this column quietly said something else.
 */
export async function completeStep(darwinUri, idToken, id) {
    return updateStep(darwinUri, idToken, id, { completed_at: sqlNow() });
}

/**
 * Clear `completed_at` — mutation honesty for a step marked done by mistake.
 * Idempotent: reopening a step that was never completed is a no-op.
 */
export async function reopenStep(darwinUri, idToken, id) {
    return updateStep(darwinUri, idToken, id, { completed_at: REST_NULL });
}

/**
 * HARD-delete a step. Dropped stays dropped (req #3080 playbook case 8) — no
 * tombstone, no residue.
 *
 * ## ONE STATEMENT, and that is the whole safety argument
 *
 * The MCP's `drop_pipeline_step` issues three (own deps, links, step) wrapped in
 * a hand-written compensation, because it owes its caller a receipt counting what
 * was removed. This page owes no receipt, and three statements from a browser is
 * strictly worse: every intermediate failure leaves the step ALIVE and UN-GATED
 * — which every renderer reads as eligible-immediately and the orchestration
 * engine then launches — and a compensating restore can itself fail with nobody
 * to tell.
 *
 * The database already does all of it, atomically:
 *   * `pipeline_step_requirements.step_fk` CASCADES — the links go with the step.
 *   * `pipeline_step_deps.step_fk` CASCADES — the step's OWN gate rows go with it.
 *   * `pipeline_step_deps.dep_step_fk` is ON DELETE RESTRICT — MySQL REFUSES the
 *     whole statement if another step gates on this one, which is design rule 4
 *     enforced by the schema rather than by a check that could be stale. Nothing
 *     is stripped on the refusal path, because nothing else was attempted.
 *
 * So the worst case here is a clean 409 with the plan untouched. `dropBlockers`
 * still runs first in the page, but only to REFUSE POLITELY and name the steps
 * responsible — correctness no longer depends on it being right.
 *
 * (MySQL evaluates that RESTRICT even against a dep row inside the same cascade,
 * which is why a MULTI-step sweep needs two phases — see the note in
 * darwin-mcp/tests/conftest.py. Deleting ONE step never hits that case: the only
 * dep rows cascaded are its own, and those reference steps that survive.)
 */
export async function deleteStep(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/pipeline_steps`, 'DELETE', { id }, idToken);
    return assertOk(r, 'deleteStep');
}

/**
 * The requirement ids currently linked to a step, read LIVE.
 *
 * Design rule 1 cannot be enforced against a cache. `staleTime` is 30s
 * (QueryClientSetup.jsx), and the Primary AI links requirements onto steps of the
 * live plan while this page is open — so a guard that trusts the grid's own data
 * can approve a stamp on a step that acquired a gating requirement seconds ago,
 * and the resulting `completed_at` is silent: `deriveStepState` ignores it while
 * the requirement exists, so the disagreement only surfaces later, when unlinking
 * that requirement makes the step derive Complete from a stamp nobody intended.
 * The MCP's `complete_pipeline_step` re-reads for exactly this reason.
 *
 * `fetchEntity` is the house GET helper and carries the convention that matters
 * here: Lambda-Rest answers a filtered GET that matches nothing with a 404, which
 * `call_rest_api` THROWS on, and `fetchEntity` turns back into `[]`. A step with
 * no links is the common case, so getting that wrong would break the guard on
 * precisely the steps it is meant to let through.
 *
 * It does NOT swallow a real failure — a 5xx propagates, and the caller must
 * refuse the stamp rather than proceed on an unknown link set.
 */
export async function fetchStepRequirementIds(darwinUri, idToken, stepId) {
    const rows = await fetchEntity(
        `${darwinUri}/pipeline_step_requirements?step_fk=${stepId}`, idToken);
    return (Array.isArray(rows) ? rows : []).map(r => r.requirement_fk);
}

/**
 * One requirement's `tracking` flag, read LIVE. Returns null when the row is gone.
 *
 * The companion to the read above, and it exists because live IDS with cached
 * FLAGS is still half a cached guard. Only the ids the cache wants to EXEMPT are
 * worth re-reading — an id it does not know already gates, and an id it calls
 * work already gates — so this is called on a set that is empty for essentially
 * every step and never bigger than that step's container count.
 *
 * `null` means NOT CONFIRMED, and the caller must treat it as gating EXPLICITLY —
 * it cannot leave that to the merge. A null row contributes nothing, so the merge
 * falls back to whatever the cache held, and the cache holding `tracking: 1` is
 * exactly the case this call exists to distrust. A 5xx propagates instead and
 * refuses the stamp; this is only the quiet path.
 *
 * `fields` is narrowed to the two columns the decision needs. It does not share
 * `useAllRequirements`' cache — this is a deliberate uncached read, and going
 * through the query client would defeat its own purpose.
 */
export async function fetchRequirementTracking(darwinUri, idToken, requirementId) {
    const rows = await fetchEntity(
        `${darwinUri}/requirements?id=${requirementId}&fields=id,tracking`, idToken);
    return (Array.isArray(rows) && rows.length) ? rows[0] : null;
}
