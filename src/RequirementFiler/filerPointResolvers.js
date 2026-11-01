// filerPointResolvers.js — what the Requirement Filer points at when the page
// element under it is a CANVAS (req #4158).
//
// The probe (filedFromContext.js `probeAt`) finds DOM elements and names the
// nearest one carrying a data-testid. A canvas has no DOM below it: the plan
// visualizer draws its epics, requirement rows and initiative bands on Konva,
// so a pinned filer over epic #385 named `pipeline-plan-visualizer` and
// recorded the overlay chips' text run together. Measured on the 92 captures
// req #4157 read: 39 of the 78 pointed captures named a canvas host.
//
// A page that draws on a canvas registers a POINT RESOLVER for its host's
// testid. The probe asks it — only when the named element IS that host, so a
// DOM chip drawn over the canvas (its own testid) still names itself — and
// records the object it answers: `{ kind, id, title, rect }`, the rect in the
// host document's client px. That object is what the outline shows while the
// filer is carried (filerHover.js) and what `pointedAt[].object` and the
// block's `Pointed at:` line name.
//
// A LARGE DOM CONTAINER is the other half of the same failure (6 of the 45):
// the probe landed in a gap of `pipelines-page`, `initiatives-datagrid`, a
// category card … and named the whole container. `specificUnder` descends from
// the element actually under the probe to the most specific IDENTIFIABLE
// element below the named one — a grid row's `data-id`, an aria-label, a role,
// a heading — so the record names the row, not the grid.

/** testid → the registered resolvers, latest last (the latest answers). */
const resolvers = new Map();

/**
 * Registers `resolve(clientX, clientY, hostEl)` for the element carrying
 * `data-testid="<hostTestid>"`. It returns `{ kind, id, title?, rect? }` (rect:
 * `{ left, top, width, height }`, client px of the host's document) for the
 * object drawn at that point, or null. Returns the unregister function.
 */
export function registerPointResolver(hostTestid, resolve) {
    if (!hostTestid || typeof resolve !== 'function') return () => {};
    const entry = { resolve };
    const list = resolvers.get(hostTestid) || [];
    list.push(entry);
    resolvers.set(hostTestid, list);
    return () => {
        const l = resolvers.get(hostTestid);
        if (!l) return;
        const i = l.indexOf(entry);
        if (i >= 0) l.splice(i, 1);
        if (!l.length) resolvers.delete(hostTestid);
    };
}

/** Whether a resolver is registered for `hostTestid`. */
export const hasPointResolver = (hostTestid) => !!resolvers.get(hostTestid)?.length;

/** Each object's title ceiling, chars. */
export const OBJECT_TITLE_MAX = 120;
/** The kinds' ceiling, chars. */
const KIND_MAX = 40;
/** Extra scalar fields kept per object. */
const EXTRA_MAX = 4;

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function normalizeRect(r) {
    if (!r) return null;
    const left = Number(r.left ?? r.x);
    const top = Number(r.top ?? r.y);
    const width = Number(r.width ?? r.w);
    const height = Number(r.height ?? r.h);
    if (![left, top, width, height].every(Number.isFinite) || width < 0 || height < 0) return null;
    return { left, top, width, height };
}

/** A resolver's answer as recorded: kind and id required, title clipped. */
export function normalizeObject(o) {
    if (!o || typeof o !== 'object') return null;
    const kind = clean(o.kind, KIND_MAX);
    if (!kind || o.id == null || o.id === '') return null;
    const id = typeof o.id === 'number' ? o.id : clean(o.id, OBJECT_TITLE_MAX);
    const title = o.title == null ? null : clean(o.title, OBJECT_TITLE_MAX) || null;
    // What else a resolver says about it (a requirement row's epicId, an arc's
    // fromId/toId) is kept — scalar values only, a few of them.
    const extra = {};
    for (const [k, v] of Object.entries(o)) {
        if (['kind', 'id', 'title', 'rect'].includes(k) || Object.keys(extra).length >= EXTRA_MAX) continue;
        if (typeof v === 'number' && Number.isFinite(v)) extra[k] = v;
        else if (typeof v === 'string' && v) extra[k] = clean(v, OBJECT_TITLE_MAX);
    }
    return { kind, id, ...(title ? { title } : null), ...extra, rect: normalizeRect(o.rect) };
}

/**
 * The object the canvas `host` (an element with a registered testid) draws at
 * client (x, y) of its document, or null — a resolver that throws answers null.
 */
export function resolveAt(host, x, y) {
    const testid = host?.getAttribute?.('data-testid');
    const list = testid ? resolvers.get(testid) : null;
    if (!list?.length) return null;
    for (let i = list.length - 1; i >= 0; i--) {
        let out = null;
        try { out = normalizeObject(list[i].resolve(x, y, host)); } catch { out = null; }
        if (out) return out;
    }
    return null;
}

/** How a recorded object reads: `epic #385 "Login Credentials"`. */
export function objectLabel(o) {
    if (!o) return '';
    const id = typeof o.id === 'number' || /^\d+$/.test(String(o.id)) ? `#${o.id}` : String(o.id);
    return `${o.kind} ${id}${o.title ? ` "${o.title}"` : ''}`;
}

// ── Large DOM containers ────────────────────────────────────────────────────

/** A named element covering at least this share of the viewport is a CONTAINER. */
export const LARGE_SHARE = 0.5;
const SPECIFIC_ROLES = new Set(['row', 'gridcell', 'cell', 'listitem', 'option', 'treeitem', 'tab',
    'menuitem', 'button', 'link', 'article', 'heading', 'checkbox', 'switch']);
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'BUTTON', 'A', 'LABEL']);

/** Whether `el` covers at least LARGE_SHARE of its window's viewport. */
export function isLargeElement(el) {
    const view = el?.ownerDocument?.defaultView;
    if (!view || typeof el.getBoundingClientRect !== 'function') return false;
    const r = el.getBoundingClientRect();
    const vw = view.innerWidth || 0;
    const vh = view.innerHeight || 0;
    if (!(vw > 0) || !(vh > 0)) return false;
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return w * h >= LARGE_SHARE * vw * vh;
}

/** Why `el` identifies something: its `data-id`, aria-label, role or tag. */
function identity(el) {
    const dataId = el.getAttribute?.('data-id');
    const role = el.getAttribute?.('role');
    if (dataId != null && dataId !== '') return { dataId, role };
    if (el.getAttribute?.('aria-label')) return { role };
    if (role && SPECIFIC_ROLES.has(role)) return { role };
    if (HEADING_TAGS.has(el.tagName)) return { role: null };
    return null;
}

/**
 * The most specific identifiable element between `hit` (the topmost element
 * under the probe) and `named` (the nearest testid above it, a container),
 * exclusive of `named` — or null when there is none or `named` is not large.
 * `{ el, kind, id? }`: kind from the container's `data-filer-kind` for a
 * `data-id` row (`initiative #12`), else the role or tag.
 */
export function specificUnder(hit, named) {
    if (!hit || !named || hit === named || !isLargeElement(named)) return null;
    const containerKind = named.closest?.('[data-filer-kind]')?.getAttribute('data-filer-kind') || null;
    // Innermost first — but a row beats a cell inside it, since the row is the record.
    let first = null;
    for (let n = hit; n && n !== named; n = n.parentElement) {
        const idn = identity(n);
        if (!idn) continue;
        if (idn.dataId != null) {
            const num = Number(idn.dataId);
            return { el: n, kind: containerKind || idn.role || n.tagName.toLowerCase(), id: Number.isInteger(num) ? num : idn.dataId };
        }
        if (!first) first = { el: n, kind: idn.role || n.tagName.toLowerCase() };
    }
    return first;
}
