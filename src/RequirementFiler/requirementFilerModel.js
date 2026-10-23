// requirementFilerModel.js — the pure half of the popup requirement editor
// (req #3811): what a draft holds, whether it can be saved, and the exact
// bodies its Save sends to Lambda-Rest.
//
// The editor holds ONE requirement's DIRECTLY SETTABLE values only — nothing
// derived or server-managed (id, timestamps, sort_order, session counts,
// pipelined). `projectId` is the editor's own: it narrows the category list
// and is never sent (a requirement's place is its category).
//
// The first Save POSTs (one object); every Save after it PUTs that same row
// (an array of one) with only the values that changed. A blank enum is never
// sent — the gateway refuses one (req #3432) — and a status write re-derives
// the three status timestamps, as every requirement_status writer does
// (req #3244, utils/requirementStatusTimestamps.js).
//
// DEFAULTS (req #3812) — the values every requirement filed from the popup
// starts with, set in the editor's "defaults" mode and kept per browser
// (useRequirementFilerStore). A field never set is ABSENT from `defaults` and
// falls back to DEFAULT_REQUIREMENT_SPEC (the place: to where the last one was
// filed). The SEAT — pipeline -> initiative -> epic — is editor-own like `projectId`:
// never in a requirement body; Save writes it to `epic_requirements`
// after the requirement exists (Epics/epicsApi.js::moveEpicRequirement).

import { DEFAULT_REQUIREMENT_SPEC } from '../SwarmView/requirementSpec';
import { AI_MODELS, aiModelLabel } from '../SwarmView/modelChipStyles';
import { EFFORTS, effortLabel } from '../SwarmView/effortChipStyles';
import { requirementStatusTimestampFields } from '../utils/requirementStatusTimestamps';

export const REQUIREMENT_STATUSES = Object.freeze(
    ['authoring', 'approved', 'swarm_ready', 'development', 'met', 'deferred', 'wontfix']);
export const COORDINATION_TYPES = Object.freeze(['discuss', 'planned', 'implemented', 'deployed']);

const STATUS_LABEL = {
    authoring: 'Authoring', approved: 'Approved', swarm_ready: 'Swarm Ready',
    development: 'Development', met: 'Met', deferred: 'Deferred', wontfix: "Won't Fix",
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The editor's four enum selects: field, label, options as { value, label }. */
export const ENUM_FIELDS = Object.freeze([
    { field: 'requirement_status', label: 'Status', testid: 'status',
      options: REQUIREMENT_STATUSES.map(v => ({ value: v, label: STATUS_LABEL[v] })) },
    { field: 'coordination_type', label: 'Autonomy', testid: 'autonomy',
      options: COORDINATION_TYPES.map(v => ({ value: v, label: cap(v) })) },
    { field: 'ai_model', label: 'Model', testid: 'model',
      options: AI_MODELS.map(v => ({ value: v, label: aiModelLabel(v) })) },
    { field: 'effort', label: 'Effort', testid: 'effort',
      options: EFFORTS.map(v => ({ value: v, label: effortLabel(v) })) },
]);
const ENUMS = ENUM_FIELDS.map(e => e.field);

const blank = (v) => v == null || String(v).trim() === '';

/** The settable defaults, in the order the Defaults form shows them. The seat's
 *  pipeline and initiative only scope the epic list; the epic is what seats. */
export const DEFAULT_FIELDS = Object.freeze([
    'projectId', 'category_fk', ...ENUMS, 'machine_fk', 'affected_repos', 'tracking',
    'seatPipelineId', 'seatInitiativeId', 'seatEpicId',
]);

const has = (defaults, f) => !!defaults && Object.prototype.hasOwnProperty.call(defaults, f);

/** What the Defaults form shows: every set default, the standard value for the rest. */
export function defaultsFormValues(defaults = {}) {
    const d = defaults || {};
    const out = {
        projectId: null, category_fk: null, ...DEFAULT_REQUIREMENT_SPEC,
        machine_fk: null, affected_repos: '', tracking: 0,
        seatPipelineId: null, seatInitiativeId: null, seatEpicId: null,
    };
    for (const f of DEFAULT_FIELDS) {
        if (has(d, f) && !(ENUMS.includes(f) && blank(d[f]))) out[f] = d[f];
    }
    return out;
}

/** A new requirement: the reader's defaults (requirementFilerModel DEFAULTS),
 *  SRIOH (DEFAULT_REQUIREMENT_SPEC) for any never set, Any machine, work (not a
 *  container), filed where the last one was unless a default place is set.
 *  `defaultsUnchecked` names the references taken from defaults — the editor
 *  checks each against live data once and drops a stale one, so Save waits.
 *  `filedFrom` — the Filed-from block (filedFromContext.js, req #3813): the
 *  description starts as it, below room for the reader's own words, and
 *  `startDescription` remembers it so an untouched block is not "changes". */
export function newRequirementDraft(projectId = null, categoryId = null, defaults = {}, filedFrom = null) {
    const d = defaultsFormValues(defaults);
    const placeFromDefaults = d.projectId != null;
    const unchecked = [];
    if (placeFromDefaults) unchecked.push('category');
    if (d.machine_fk != null) unchecked.push('machine');
    if (d.seatEpicId != null || d.seatPipelineId != null) unchecked.push('seat');
    const description = typeof filedFrom === 'string' && filedFrom ? `\n\n${filedFrom}` : '';
    return {
        title: '',
        description,
        startDescription: description,
        projectId: placeFromDefaults ? d.projectId : (projectId ?? null),
        category_fk: placeFromDefaults ? (d.category_fk ?? null) : (categoryId ?? null),
        requirement_status: d.requirement_status,
        coordination_type: d.coordination_type,
        ai_model: d.ai_model,
        effort: d.effort,
        machine_fk: d.machine_fk ?? null,
        affected_repos: d.affected_repos ?? '',
        tracking: d.tracking ? 1 : 0,
        // A pipeline (and initiative) with no epic pre-scopes the epic list.
        seatPipelineId: d.seatPipelineId ?? null,
        seatInitiativeId: d.seatPipelineId != null ? (d.seatInitiativeId ?? null) : null,
        seatEpicId: d.seatEpicId ?? null,
        defaultsUnchecked: unchecked,
        notice: null,
    };
}

const flagOn = (v) => v === true || Number(v) === 1;

/**
 * Which references in `values` no longer resolve: each of `project`,
 * `category`, `machine` and `seat` is null (unset or valid), a reason string
 * (stale), or undefined (its read has not landed — not yet known).
 *
 * @param {Object} values   draft or defaults-form values
 * @param {Object} data
 * @param {?Object[]} data.projects    OPEN projects
 * @param {?Object[]} data.categories  OPEN categories of `values.projectId`
 * @param {?Object[]} data.machines    all machines (closed included)
 * @param {?Object}   data.index       orchestration index (detail/orchestrationIndex.js),
 *                                     null until its reads have settled
 */
export function staleRefs(values, { projects, categories, machines, index } = {}) {
    const v = values || {};
    const out = { project: null, category: null, machine: null, seat: null };
    if (v.projectId != null) {
        if (!Array.isArray(projects)) out.project = undefined;
        else if (!projects.some(p => p.id === v.projectId)) out.project = 'closed or deleted';
    }
    // Until the project is known the place is not — even with no category.
    if (v.projectId != null && out.project === undefined) out.category = undefined;
    else if (v.category_fk != null) {
        if (out.project) out.category = `its project is ${out.project}`;
        else if (!Array.isArray(categories)) out.category = undefined;
        else if (!categories.some(c => c.id === v.category_fk)) out.category = 'closed or deleted';
    }
    if (v.machine_fk != null) {
        const m = Array.isArray(machines) ? machines.find(x => x.id === v.machine_fk) : undefined;
        if (!Array.isArray(machines)) out.machine = undefined;
        else if (!m) out.machine = 'no longer exists';
        else if (flagOn(m.closed)) out.machine = 'closed';
    }
    if (v.seatEpicId != null) {
        if (!index) out.seat = undefined;
        else {
            const epic = index.epicsById.get(v.seatEpicId);
            const initiative = index.initiativesById.get(index.initiativeByEpic.get(v.seatEpicId));
            const plan = index.pipelinesById.get(index.pipelineByEpic.get(v.seatEpicId));
            if (!epic) out.seat = 'no longer exists';
            else if (!initiative || flagOn(initiative.closed)) out.seat = 'its initiative is closed or deleted';
            else if (!plan || plan.pipeline_status === 'completed') out.seat = 'its pipeline is completed or deleted';
        }
    } else if (v.seatPipelineId != null) {
        // A scope with no epic: the pipeline (and initiative) it names must still be open.
        if (!index) out.seat = undefined;
        else {
            const plan = index.pipelinesById.get(v.seatPipelineId);
            const initiative = v.seatInitiativeId != null ? index.initiativesById.get(v.seatInitiativeId) : null;
            if (!plan || plan.pipeline_status === 'completed') out.seat = 'its pipeline is completed or deleted';
            else if (v.seatInitiativeId != null && (!initiative || flagOn(initiative.closed)
                     || initiative.pipeline_fk !== v.seatPipelineId)) out.seat = 'its initiative is closed or deleted';
        }
    }
    return out;
}

/** Why the draft cannot be saved, or null when it can. */
export function draftProblem(draft) {
    if (!draft) return 'Nothing to save';
    if (blank(draft.title)) return 'A title is required';
    if (draft.defaultsUnchecked?.length) return 'Checking defaults…';
    if (draft.category_fk == null) return 'Choose a project and a category';
    for (const f of ENUMS) if (blank(draft[f])) return `Choose a ${f.replace(/_/g, ' ')}`;
    return null;
}

/** The draft as it is stored: trimmed, with the editor's own projectId kept
 *  so a reopened editor still shows the category's project. */
export function savedValues(draft) {
    return {
        title: (draft.title ?? '').trim(),
        description: draft.description ?? '',
        projectId: draft.projectId ?? null,
        category_fk: draft.category_fk,
        requirement_status: draft.requirement_status,
        coordination_type: draft.coordination_type,
        ai_model: draft.ai_model,
        effort: draft.effort,
        machine_fk: draft.machine_fk ?? null,
        affected_repos: (draft.affected_repos ?? '').trim(),
        tracking: draft.tracking ? 1 : 0,
        seatEpicId: draft.seatEpicId ?? null,
    };
}

/** The POST body (one object) for a draft that has never been saved. */
export function buildPostBody(draft, now = new Date().toISOString()) {
    const v = savedValues(draft);
    const body = { title: v.title, category_fk: v.category_fk, tracking: v.tracking };
    if (v.description !== '') body.description = v.description;
    for (const f of ENUMS) if (!blank(v[f])) body[f] = v[f];
    if (v.machine_fk != null) body.machine_fk = v.machine_fk;
    if (v.affected_repos !== '') body.affected_repos = v.affected_repos;
    if (body.requirement_status) Object.assign(body, requirementStatusTimestampFields(body.requirement_status, now));
    return body;
}

/** The PUT body (an array of one row) carrying only what changed since
 *  `saved`, or null when nothing did. Cleared machine / repos send Lambda-Rest's
 *  'NULL' sentinel; a blank enum is never sent. */
export function buildPutBody(id, draft, saved, now = new Date().toISOString()) {
    const v = savedValues(draft);
    const row = {};
    for (const f of ['title', 'description', 'category_fk', 'tracking']) {
        if (v[f] !== saved[f]) row[f] = v[f];
    }
    for (const f of ENUMS) {
        if (v[f] !== saved[f] && !blank(v[f])) row[f] = v[f];
    }
    if (row.requirement_status) Object.assign(row, requirementStatusTimestampFields(row.requirement_status, now));
    if (v.machine_fk !== saved.machine_fk) row.machine_fk = v.machine_fk ?? 'NULL';
    if (v.affected_repos !== saved.affected_repos) row.affected_repos = v.affected_repos || 'NULL';
    if (!Object.keys(row).length) return null;
    return [{ id, ...row }];
}

/** Whether the draft's seat differs from the one last written. */
export function seatDirty(draft, saved) {
    return (draft?.seatEpicId ?? null) !== (saved?.seatEpicId ?? null);
}

/** Whether Save has anything to send. */
export function draftDirty(draft, savedId, saved) {
    if (!draft) return false;
    if (savedId == null || !saved) return true;
    return buildPutBody(savedId, draft, saved) !== null || seatDirty(draft, saved);
}

/** The open machines a requirement may be pinned to, in the Machines page's
 *  order (hand sort_order first, then title) — plus a closed machine the
 *  draft is already pinned to, so the pin is never silently shown as Any. */
export function machineOptions(machines, currentId) {
    const all = Array.isArray(machines) ? machines : [];
    const open = all.filter(m => !m.closed).sort((a, b) => {
        const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
        return ao !== bo ? ao - bo : (a.title || '').localeCompare(b.title || '');
    });
    const opts = open.map(m => ({ value: m.id, label: m.title || `Machine ${m.id}` }));
    if (currentId != null && !opts.some(o => o.value === currentId)) {
        const m = all.find(x => x.id === currentId);
        opts.push({ value: currentId, label: `${m?.title || `Machine ${currentId}`} (closed)` });
    }
    return opts;
}
