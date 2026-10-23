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
// A NEW REQUIREMENT STARTS FROM THE LAST ONE (user ruling 2026-10-23, req #3815,
// replacing #3812's Defaults form): its settings — status, autonomy, model,
// effort, machine, tracking — are the last filed requirement's
// (useRequirementFilerStore `defaults`, written on every save), its place is
// where that one was filed, and before any has been filed it is SRDOH — Swarm
// Ready · Deployed · Opus · High — on Any machine (FILER_DEFAULT_SPEC). A
// carried machine is checked against live data before the draft can be filed.
//
// THE SPEC CODE (same ruling) — the editor shows the four launch fields as
// their five-letter code (SRDOH, SRIOH, SRISM …) on the button that opens them.
// It is DERIVED from the fields and never stored or sent. The letter table is
// darwin-mcp/services/requirement_spec.py's; this copy is held to it by
// __tests__/requirementFilerModel.test.js, which reads that file when the
// workspace has it.

import { requirementStatusTimestampFields } from '../utils/requirementStatusTimestamps';

export const REQUIREMENT_STATUSES = Object.freeze(
    ['authoring', 'approved', 'swarm_ready', 'development', 'met', 'deferred', 'wontfix']);
export const COORDINATION_TYPES = Object.freeze(['discuss', 'planned', 'implemented', 'deployed']);
const ENUMS = ['requirement_status', 'coordination_type', 'ai_model', 'effort'];

/** The filer's first requirement: SRDOH (Swarm Ready · Deployed · Opus · High). */
export const FILER_DEFAULT_SPEC = Object.freeze({
    requirement_status: 'swarm_ready',
    coordination_type: 'deployed',
    ai_model: 'opus',
    effort: 'high',
});

/** The spec code's letters per field (darwin-mcp/services/requirement_spec.py). */
export const SPEC_LETTERS = Object.freeze({
    requirement_status: Object.freeze({ authoring: 'AU', approved: 'AP', swarm_ready: 'SR', development: 'DV',
        met: 'MT', deferred: 'DF', wontfix: 'WF' }),
    coordination_type: Object.freeze({ discuss: 'C', planned: 'P', implemented: 'I', deployed: 'D' }),
    ai_model: Object.freeze({ haiku: 'H', sonnet: 'S', opus: 'O', fable: 'F' }),
    effort: Object.freeze({ low: 'L', medium: 'M', high: 'H', xhigh: 'X', ultracode: 'U' }),
});

/** The five-letter code for `values`'s four launch fields; '?' marks an unset one. */
export function specCode(values) {
    const v = values || {};
    return ENUMS.map((f) => SPEC_LETTERS[f][v[f]] ?? (f === 'requirement_status' ? '??' : '?')).join('');
}

/** The settings a new requirement takes from the last one filed. */
export const CARRIED_FIELDS = Object.freeze([...ENUMS, 'machine_fk', 'tracking']);

/** The last requirement's settings, as `defaults` keeps them. */
export function carriedSettings(values) {
    const out = {};
    for (const f of CARRIED_FIELDS) if (values && values[f] !== undefined) out[f] = values[f];
    return out;
}

const blank = (v) => v == null || String(v).trim() === '';

/** A new requirement: the last one's settings (`defaults`), SRDOH for any it
 *  never had, filed where the last one was (`projectId` / `categoryId`).
 *  `defaultsUnchecked` names the references taken from `defaults` — the editor
 *  checks each against live data once and drops a stale one, so Save waits. */
export function newRequirementDraft(projectId = null, categoryId = null, defaults = {}) {
    const d = { ...FILER_DEFAULT_SPEC, machine_fk: null, tracking: 0 };
    for (const f of CARRIED_FIELDS) {
        if (defaults && defaults[f] !== undefined && !(ENUMS.includes(f) && blank(defaults[f]))) d[f] = defaults[f];
    }
    return {
        title: '',
        description: '',
        projectId: projectId ?? null,
        category_fk: categoryId ?? null,
        requirement_status: d.requirement_status,
        coordination_type: d.coordination_type,
        ai_model: d.ai_model,
        effort: d.effort,
        machine_fk: d.machine_fk ?? null,
        affected_repos: '',
        tracking: d.tracking ? 1 : 0,
        // The carried place and machine are checked against live data before File.
        defaultsUnchecked: [...(categoryId != null ? ['category'] : []), ...(d.machine_fk != null ? ['machine'] : [])],
        notice: null,
    };
}

/** The project a new requirement is filed under when it carries none. */
export const DEFAULT_PROJECT_NAME = 'Darwin';

/** The project a draft with none starts in (user ruling 2026-10-23, req #3830:
 *  "don't make me set that one — it's only Darwin"): the open project named
 *  Darwin, else the only open project, else none. Only a default — the Project
 *  select still offers every open project (darwin_dev holds many). */
export function defaultProjectId(projects) {
    if (!Array.isArray(projects)) return null;
    const named = projects.find(p => String(p.project_name ?? '').trim().toLowerCase()
        === DEFAULT_PROJECT_NAME.toLowerCase());
    if (named) return named.id;
    return projects.length === 1 ? projects[0].id : null;
}

const flagOn = (v) => v === true || Number(v) === 1;

/** Whether the carried place still resolves: null (unset or valid),
 *  `{ project, text }` (stale — `project` when the whole project went), or
 *  undefined (a read has not landed). `failed` — a read failed: it cannot vouch. */
export function staleCategory(values, projects, categories, failed = false) {
    const pid = values?.projectId;
    const cid = values?.category_fk;
    if (cid == null) return null;
    // A category with no project to read it under cannot be vouched for.
    if (pid == null) return { project: false, text: 'could not be checked' };
    {
        if (!Array.isArray(projects)) return failed ? { project: true, text: 'could not be checked' } : undefined;
        if (!projects.some(p => p.id === pid)) return { project: true, text: 'is closed or deleted' };
    }
    if (!Array.isArray(categories)) return failed ? { project: false, text: 'could not be checked' } : undefined;
    if (!categories.some(c => c.id === cid)) return { project: false, text: 'is closed or deleted' };
    return null;
}

/** Whether a carried machine still resolves: null (unset or valid), a reason
 *  string (stale), or undefined (its read has not landed — not yet known). */
export function staleMachine(values, machines) {
    const id = values?.machine_fk;
    if (id == null) return null;
    if (!Array.isArray(machines)) return undefined;
    const m = machines.find(x => x.id === id);
    if (!m) return 'no longer exists';
    if (flagOn(m.closed)) return 'closed';
    return null;
}

/** The columns a filed requirement is read back with, to reopen it. */
export const REOPEN_FIELDS = Object.freeze(['id', 'title', 'description', 'category_fk', ...ENUMS,
    'machine_fk', 'affected_repos', 'tracking']);

/** A filed requirement's row, as the editor's draft — under `projectId`, its
 *  category's project. Nothing in it is carried, so nothing waits on a check. */
export function draftFromRow(row, projectId) {
    return {
        title: row.title ?? '',
        description: row.description ?? '',
        projectId: projectId ?? null,
        category_fk: row.category_fk ?? null,
        requirement_status: row.requirement_status,
        coordination_type: row.coordination_type,
        ai_model: row.ai_model,
        effort: row.effort,
        machine_fk: row.machine_fk ?? null,
        affected_repos: row.affected_repos ?? '',
        tracking: flagOn(row.tracking) ? 1 : 0,
        defaultsUnchecked: [],
        notice: null,
    };
}

/** How many filed requirements the filer lists (newest first). */
export const FILED_LIMIT = 50;

/** The filer's list with `id` (now titled `title`) in it: an entry already
 *  there keeps its place, a new one goes first; the oldest past FILED_LIMIT go. */
export function withFiled(filed, id, title) {
    const list = Array.isArray(filed) ? filed : [];
    if (list.some(f => f.id === id)) return list.map(f => (f.id === id ? { ...f, title } : f));
    return [{ id, title }, ...list].slice(0, FILED_LIMIT);
}

/** Why the draft cannot be saved, or null when it can. */
export function draftProblem(draft) {
    if (!draft) return 'Nothing to save';
    if (blank(draft.title)) return 'A title is required';
    if (draft.defaultsUnchecked?.length) return 'Checking the last settings…';
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
