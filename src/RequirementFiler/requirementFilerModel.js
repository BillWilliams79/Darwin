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

/** A new requirement: SRIOH (DEFAULT_REQUIREMENT_SPEC), Any machine, work
 *  (not a container), filed where the last one was. */
export function newRequirementDraft(projectId = null, categoryId = null) {
    return {
        title: '',
        description: '',
        projectId: projectId ?? null,
        category_fk: categoryId ?? null,
        ...DEFAULT_REQUIREMENT_SPEC,
        machine_fk: null,
        affected_repos: '',
        tracking: 0,
    };
}

/** Why the draft cannot be saved, or null when it can. */
export function draftProblem(draft) {
    if (!draft) return 'Nothing to save';
    if (blank(draft.title)) return 'A title is required';
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

/** Whether Save has anything to send. */
export function draftDirty(draft, savedId, saved) {
    if (!draft) return false;
    if (savedId == null || !saved) return true;
    return buildPutBody(savedId, draft, saved) !== null;
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
