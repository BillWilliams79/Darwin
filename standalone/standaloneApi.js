// standaloneApi.js — backend-free data adapter for the standalone Build
// Visualizer export (req #2743).
//
// Aliased in at build time (see vite.standalone.js resolve.alias) to REPLACE
// the two Darwin data-layer modules the BuildVisualizer subtree imports:
//   ../RestApi/RestApi            → default export call_rest_api
//   ../hooks/factory/createEntityQueries → named export fetchEntity
//
// Same signatures and { data, httpStatus } return shape as the originals, so
// the BuildVisualizer source is UNTOUCHED — every read/write call site works
// verbatim against localStorage instead of Lambda-Rest / RDS.
//
// Seeds five in-memory tables on first use from an inline
//   <script id="bv-standalone-seed" type="application/json">{...}</script>
// (so the bundle works offline / over file://), falling back to
// fetch('./data/<table>.json') when the inline seed is absent.
//
// Mirrors the production behaviors the React code depends on:
//   • POST assigns a monotonic id and stamps create_ts; returns [row].
//   • PUT body is an array of { id, ...patch }; stamps update_ts.
//   • DELETE body keys are AND-ed; build_projects / branches / builds cascade
//     to their children exactly like the SQL ON DELETE CASCADE chain.

const TABLES = ['build_projects', 'branches', 'builds', 'customer_releases', 'customers'];
const LS_PREFIX = 'bv.standalone.';
// Content-hash of the seed currently in localStorage. A bundle re-seeds (wipes
// + reloads) whenever its seed hashes differently from what's stored — so a
// freshly exported bundle ALWAYS supersedes stale data, even though file://
// shares one localStorage across every bundle on the machine. Edits within the
// same bundle persist (same hash → no re-seed).
const SEEDVER_KEY = `${LS_PREFIX}seedVersion.v1`;
const NEXTID_KEY = `${LS_PREFIX}nextId.v1`;
// Query params that are NOT row filters (none of the BV call sites use them
// today, but ignore them defensively so they never narrow a result set).
const NON_FILTER_KEYS = new Set(['fields', 'sort', 'count', 'group_by']);

function lsGet(table) {
    try { return JSON.parse(window.localStorage.getItem(LS_PREFIX + table) || '[]'); }
    catch (_) { return []; }
}

function lsSet(table, rows) {
    try { window.localStorage.setItem(LS_PREFIX + table, JSON.stringify(rows)); }
    catch (err) { console.warn('[standaloneApi] persist failed:', err && err.message); }
}

function getNextId() {
    const n = Number(window.localStorage.getItem(NEXTID_KEY));
    return Number.isFinite(n) && n > 0 ? n : 1;
}

function setNextId(n) {
    try { window.localStorage.setItem(NEXTID_KEY, String(n)); } catch (_) { /* private mode */ }
}

function nowIso() {
    return new Date().toISOString();
}

// Deterministic, dependency-free string hash (djb2) — used to fingerprint the
// seed so a changed dataset triggers a re-seed. Not cryptographic; collision
// risk is irrelevant for change detection.
function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'v' + h.toString(36);
}

function resp(status, data) {
    return {
        data,
        httpStatus: {
            httpMethod: '',
            httpStatus: status,
            httpMessage: status === 200 ? 'OK' : (status === 201 ? 'CREATED' : ''),
        },
    };
}

// ─── Seeding ───────────────────────────────────────────────────────────────

async function loadSeed() {
    const el = (typeof document !== 'undefined')
        ? document.getElementById('bv-standalone-seed')
        : null;
    if (el && el.textContent && el.textContent.trim()) {
        const raw = el.textContent;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return { seed: parsed, raw };
        } catch (err) {
            console.warn('[standaloneApi] inline seed parse failed:', err && err.message);
        }
    }
    // Fallback: fetch one file per table (works under python3 -m http.server).
    const seed = {};
    await Promise.all(TABLES.map(async (t) => {
        try {
            const r = await fetch(`./data/${t}.json`, { cache: 'no-store' });
            seed[t] = r.ok ? await r.json() : [];
        } catch (_) { seed[t] = []; }
    }));
    return { seed, raw: JSON.stringify(seed) };
}

let _seedPromise = null;
async function ensureSeeded() {
    if (!_seedPromise) {
        _seedPromise = (async () => {
            const { seed, raw } = await loadSeed();
            const version = hashStr(raw);
            let stored = null;
            try { stored = window.localStorage.getItem(SEEDVER_KEY); } catch (_) { /* private mode */ }
            // Up to date with THIS bundle's data → keep localStorage (user edits persist).
            if (stored !== null && stored === version) return;
            // Different (or never-seeded) → (re)seed, replacing any stale rows from
            // a previously-opened bundle sharing this origin's localStorage.
            let maxId = 0;
            for (const t of TABLES) {
                const rows = Array.isArray(seed[t]) ? seed[t] : [];
                lsSet(t, rows);
                for (const r of rows) {
                    const id = Number(r && r.id);
                    if (Number.isFinite(id) && id > maxId) maxId = id;
                }
            }
            setNextId(maxId + 1);
            try { window.localStorage.setItem(SEEDVER_KEY, version); } catch (_) { /* private mode */ }
        })();
    }
    return _seedPromise;
}

// ─── URL parsing + filtering ─────────────────────────────────────────────────

function parseUrl(url) {
    const qIdx = url.indexOf('?');
    const pathPart = qIdx >= 0 ? url.slice(0, qIdx) : url;
    const queryPart = qIdx >= 0 ? url.slice(qIdx + 1) : '';
    const table = pathPart.split('/').filter(Boolean).pop();
    const filters = [];
    if (queryPart) {
        for (const pair of queryPart.split('&')) {
            if (!pair) continue;
            const eq = pair.indexOf('=');
            if (eq < 0) continue;
            const key = decodeURIComponent(pair.slice(0, eq));
            const val = decodeURIComponent(pair.slice(eq + 1));
            filters.push({ key, val });
        }
    }
    return { table, filters };
}

function matchFilter(row, key, val) {
    if (NON_FILTER_KEYS.has(key)) return true;
    // IN-clause: val like "(1,2,3)" — the cascading branch_fk / build_fk reads.
    if (val.startsWith('(') && val.endsWith(')')) {
        const list = val.slice(1, -1).split(',').map(s => s.trim()).filter(s => s !== '');
        return list.some(v => String(row[key]) === String(v));
    }
    return String(row[key]) === String(val);
}

function applyFilters(rows, filters) {
    if (!filters.length) return rows;
    return rows.filter(row => filters.every(f => matchFilter(row, f.key, f.val)));
}

// ─── Cascade deletes (mirror SQL ON DELETE CASCADE) ──────────────────────────

function cascadeDeleteBuild(buildId) {
    const rels = lsGet('customer_releases');
    lsSet('customer_releases', rels.filter(r => String(r.build_fk) !== String(buildId)));
}

function cascadeDeleteBranch(branchId) {
    const builds = lsGet('builds');
    const childBuildIds = builds
        .filter(b => String(b.branch_fk) === String(branchId))
        .map(b => b.id);
    lsSet('builds', builds.filter(b => String(b.branch_fk) !== String(branchId)));
    childBuildIds.forEach(cascadeDeleteBuild);
}

function cascadeDeleteProject(projectId) {
    const branches = lsGet('branches');
    const childBranchIds = branches
        .filter(b => String(b.project_fk) === String(projectId))
        .map(b => b.id);
    lsSet('branches', branches.filter(b => String(b.project_fk) !== String(projectId)));
    childBranchIds.forEach(cascadeDeleteBranch);
}

// ─── Public API (drop-in for call_rest_api + fetchEntity) ────────────────────

const call_rest_api = async (url, method, body, _idToken) => {
    await ensureSeeded();
    const { table, filters } = parseUrl(url);
    if (!TABLES.includes(table)) return resp(404, []);
    const M = (method || 'GET').toUpperCase();
    const rows = lsGet(table);

    if (M === 'GET') {
        return resp(200, applyFilters(rows, filters));
    }

    if (M === 'POST') {
        const id = getNextId();
        setNextId(id + 1);
        const now = nowIso();
        const newRow = { ...(body || {}), id, create_ts: (body && body.create_ts) || now, update_ts: now };
        rows.push(newRow);
        lsSet(table, rows);
        // Lambda-Rest POST reads back the inserted row; callers read data[0].id.
        return resp(200, [newRow]);
    }

    if (M === 'PUT') {
        const patches = Array.isArray(body) ? body : [body];
        const now = nowIso();
        const updated = [];
        for (const patch of patches) {
            if (!patch || patch.id == null) continue;
            const idx = rows.findIndex(r => String(r.id) === String(patch.id));
            if (idx >= 0) {
                rows[idx] = { ...rows[idx], ...patch, update_ts: now };
                updated.push(rows[idx]);
            }
        }
        lsSet(table, rows);
        return resp(200, updated);
    }

    if (M === 'DELETE') {
        const keys = Object.keys(body || {});
        const isMatch = r => keys.length > 0 && keys.every(k => String(r[k]) === String(body[k]));
        const deleted = rows.filter(isMatch);
        lsSet(table, rows.filter(r => !isMatch(r)));
        if (table === 'build_projects') deleted.forEach(p => cascadeDeleteProject(p.id));
        else if (table === 'branches') deleted.forEach(b => cascadeDeleteBranch(b.id));
        else if (table === 'builds') deleted.forEach(b => cascadeDeleteBuild(b.id));
        return resp(200, deleted);
    }

    return resp(405, null);
};

// Mirrors createEntityQueries.fetchEntity: GET, treat non-2xx as error,
// 404 → empty array.
export async function fetchEntity(uri, idToken) {
    const result = await call_rest_api(uri, 'GET', '', idToken);
    const status = result.httpStatus.httpStatus;
    if (status < 200 || status >= 300) {
        if (status === 404) return [];
        throw result;
    }
    return result.data;
}

// Source modules that import createEntityQueries also reference the factory by
// name; provide a harmless stub so an accidental import never breaks the build.
export function createEntityQueries() {
    throw new Error('createEntityQueries is not available in the standalone build');
}

export default call_rest_api;
