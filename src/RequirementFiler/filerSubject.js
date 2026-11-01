// filerSubject.js — the RECORD(S) a requirement was filed about, not just the
// route (req #4158).
//
// `Surface: /swarm/pipeline/12?mode=plan` names a route. The worker's dev
// server reads `darwin_dev`, where id 12 names some other plan or none: on
// the 76 workers req #4157 traced, 26 opened the right page with a different
// id and chose or seeded a substitute themselves, with nothing to go on. So
// the capture resolves the ids it can see — the route's (`routeIds`) and the
// id-bearing query parameters (`?epic=`, `?initiative=`) — to the record's
// TITLE, from the React Query cache the page already filled. No request is
// made: a record the page never read is named by id alone.
//
// Each subject carries the DATABASE its id belongs to (`darwin` on darwin.one,
// `darwin_dev` on a dev server — `filedFrom.state.database`): a darwin_dev id
// opens as-is on a worker's dev server, a production one must be matched or
// seeded. Since req #3888 the filer files into production from either build,
// so the requirement's own id says nothing about which one this was.

/** The kinds a capture can name, and where the cache holds their rows:
 *  `tables` — the Lambda-Rest table a query key starts with; `compose` — the
 *  field of a `pipeline_compose` payload (req #3367) that carries them. */
export const SUBJECT_KINDS = Object.freeze({
    pipeline: { tables: ['pipelines'], compose: 'pipeline' },
    initiative: { tables: ['initiatives'], compose: 'initiatives' },
    epic: { tables: ['epics'], compose: 'epics' },
    requirement: { tables: ['requirements'], compose: 'requirements' },
    'swarm session': { tables: ['swarm_sessions'] },
    'swarm start': { tables: ['swarm_starts'] },
    'swarm complete': { tables: ['swarm_completes'] },
    'swarm undo': { tables: ['swarm_undos'] },
    agent: { tables: ['agents'] },
    'map run': { tables: ['map_runs'] },
    'test run': { tables: ['test_runs'] },
});

/** A route segment before an id → the kind it names (App's routes). */
const ROUTE_KIND = Object.freeze({
    pipeline: 'pipeline', requirement: 'requirement', session: 'swarm session',
    'swarm-starts': 'swarm start', 'swarm-completes': 'swarm complete', 'swarm-undos': 'swarm undo',
    agents: 'agent', maps: 'map run', photos: 'map run', testruns: 'test run',
});

/** The query parameters that name a record by id. */
const QUERY_KIND = Object.freeze({ epic: 'epic', initiative: 'initiative', requirement: 'requirement' });

/** Subjects named at most, and each title's ceiling. */
export const SUBJECT_MAX = 6;
const TITLE_MAX = 120;

/** A row's display name — the column each table names it by (schema.sql). */
export function titleOf(row) {
    if (!row || typeof row !== 'object') return null;
    const t = row.title ?? row.name ?? row.task_name ?? row.activity_name ?? row.category_name ?? row.hostname;
    return typeof t === 'string' && t.trim() ? t.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : null;
}

const asRows = (v) => (Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : []));
const sameId = (row, id) => row && typeof row === 'object' && row.id != null && String(row.id) === String(id);

/** Every cached row of `kind`, with the compose payloads it was found in. */
function cachedRows(queries, kind) {
    const spec = SUBJECT_KINDS[kind];
    if (!spec) return { rows: [], composes: [] };
    const rows = [];
    const composes = [];
    for (const q of queries) {
        const key = q?.queryKey;
        const data = q?.state?.data;
        if (!Array.isArray(key) || data == null) continue;
        if (spec.tables.includes(key[0])) rows.push(...asRows(data));
        else if (key[0] === 'pipeline_compose' && data && typeof data === 'object') {
            composes.push(data);
            if (spec.compose) rows.push(...asRows(data[spec.compose]));
        }
    }
    return { rows, composes };
}

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** What a composed plan says about a subject in it — its size. */
function composeDetail(kind, id, composes) {
    for (const c of composes) {
        if (kind === 'pipeline' && sameId(c.pipeline, id)) {
            const parts = [];
            if (Array.isArray(c.initiatives)) parts.push(plural(c.initiatives.length, 'initiative'));
            if (Array.isArray(c.epics)) parts.push(plural(c.epics.length, 'epic'));
            if (Array.isArray(c.requirements)) parts.push(plural(c.requirements.length, 'requirement'));
            return parts.join(', ') || null;
        }
        if (kind === 'epic' && Array.isArray(c.epics) && c.epics.some((e) => sameId(e, id))) {
            const n = (c.epic_requirements || []).filter((l) => String(l.epic_fk) === String(id)).length;
            return `${plural(n, 'requirement')}, in pipeline ${c.pipeline?.id ?? '?'}`;
        }
        if (kind === 'initiative' && Array.isArray(c.initiatives) && c.initiatives.some((e) => sameId(e, id))) {
            const n = (c.epics || []).filter((e) => String(e.initiative_fk) === String(id)).length;
            return `${plural(n, 'epic')}, in pipeline ${c.pipeline?.id ?? '?'}`;
        }
    }
    return null;
}

/** The (kind, id) pairs a page's address names, in order, de-duplicated. */
export function addressIds(routeIds = {}, query = {}) {
    const out = [];
    const seen = new Set();
    const add = (kind, raw) => {
        const v = Array.isArray(raw) ? raw[0] : raw;
        if (v == null || !/^\d+$/.test(String(v).trim())) return;
        const id = Number(v);
        const k = `${kind}:${id}`;
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ kind, id });
    };
    for (const [seg, id] of Object.entries(routeIds || {})) add(ROUTE_KIND[seg] || seg, id);
    for (const [name, kind] of Object.entries(QUERY_KIND)) if (query && name in query) add(kind, query[name]);
    return out;
}

/**
 * The subject records — `[{ kind, id, title, database, detail? }]` — that a
 * page at `routeIds`/`query` was showing, titled from `queryCache` (a React
 * Query QueryCache, or anything with `getAll()`), plus any the page itself
 * named (`pageSubjects`, from registerPageOptions — the Topology view, which
 * no database holds: `database: null`).
 */
export function resolveSubjects({ routeIds, query, database = null, queryCache = null, pageSubjects = null }) {
    let queries = [];
    try { queries = queryCache?.getAll?.() || []; } catch { queries = []; }
    const out = addressIds(routeIds, query).map(({ kind, id }) => {
        const { rows, composes } = cachedRows(queries, kind);
        const row = rows.find((r) => sameId(r, id) && titleOf(r)) || null;
        const detail = composeDetail(kind, id, composes);
        return { kind, id, title: titleOf(row), database: database ?? null, ...(detail ? { detail } : null) };
    });
    for (const s of Array.isArray(pageSubjects) ? pageSubjects : []) {
        if (!s?.kind || s.id == null || s.id === '') continue;
        if (out.some((o) => o.kind === s.kind && String(o.id) === String(s.id))) continue;
        out.push({ kind: String(s.kind).slice(0, 40), id: s.id,
            title: typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, TITLE_MAX) : null,
            database: 'database' in s ? s.database : (database ?? null) });
    }
    return out.slice(0, SUBJECT_MAX);
}

/** What a database means to the worker reading the ids. */
export function databaseNote(database) {
    if (database === 'darwin') return 'production ids (darwin) — on a dev server, find or seed the matching darwin_dev record';
    if (database === 'darwin_dev') return 'darwin_dev ids — they open as-is on a dev server';
    return database ? `ids from ${database}` : null;
}

/** One subject as the block names it: `pipeline 12 "Current Work" (6 initiatives, 160 epics)`. */
export function subjectLabel(s) {
    const id = /^\d+$/.test(String(s.id)) ? String(s.id) : JSON.stringify(String(s.id));
    return `${s.kind} ${id}${s.title ? ` "${s.title}"` : ''}${s.detail ? ` (${s.detail})` : ''}`;
}
