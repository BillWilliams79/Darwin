// filedFromContext.js — where a requirement was filed from (req #3813). The
// Requirement Filer's REQUIREMENT button snapshots it at the moment it is
// pressed — before the editor opens, so the editor is never the subject — and
// the new draft's description carries it as a delimited, machine-readable
// block the AI that later builds the requirement can read:
//
//   • URL     — path + query + hash of the page the reader was on.
//   • Options — the page's view options: its query, the record ids in its
//               path, what the page itself reports live (registerPageOptions —
//               AI Architecture's on-screen view, which its iframe never writes
//               back to Darwin's URL), and the persisted view/toolbar state of
//               the application that owns the page (VIEW_STATE_KEYS).
//   • State   — app-level context: visible applications, dev vs prod build and
//               database, theme, viewport, the reader's other open Action Popups.
//   • Popup   — the filer's own rack / dock position and size.
//
// The block's `Surface:` line is `<path>?<query>` exactly as
// /devops-devserver-start takes a deep link, so a worker opens its dev server
// on the surface the requirement was filed from.
//
// NEVER A CREDENTIAL. Persisted state is read from an ALLOWLIST of the owning
// application's view keys (never the auth/profile keys), and everything that
// goes in — query, hash, view state, page options — is redacted on top of that:
// credential-shaped names dropped, JWT-shaped values replaced (`redact`).

import { slotOffset } from '../Components/AnchoredPanel/usePanelRack';
import { DEV_APP_GROUPS, DEV_APPS, NAV_GROUPS, appForRoute, isGroupVisible } from '../NavBar/navConfig';
import { usePanelRackStore } from '../stores/usePanelRackStore';

export const FILED_FROM_VERSION = 1;
export const FILED_FROM_BEGIN = `--- Filed-from context v${FILED_FROM_VERSION} (req #3813) ---`;
export const FILED_FROM_END = '--- end Filed-from context ---';
/** The block's size ceiling, chars — requirements.description is a TEXT column. */
export const FILED_FROM_MAX_CHARS = 16000;
/** One persisted view key's ceiling, chars; a bigger value is named, not copied. */
const VIEW_VALUE_MAX_CHARS = 2000;

/** The persisted view/toolbar state each application's pages are drawn with —
 *  localStorage keys (zustand persist names and the pages' own keys). An
 *  ALLOWLIST: a key no pattern names is never read. */
export const VIEW_STATE_KEYS = Object.freeze({
    tasks: [/^darwin_working_(domain|project)$/, /^darwin_closed_tasks$/, /^darwin_optional_cards$/,
        /^darwin_calendar_view$/],
    maps: [/^darwin_active_map_view$/, /^darwin_map_/, /^darwin-maps-/, /^mapStatsStyle$/,
        /^photo-browser-enabled$/, /^darwin_trends_view$/],
    systems: [/^topology\./, /^darwin\.bv\./, /^darwin\.buildVisualizer\./],
    swarm: [/^darwin-swarm-(?!test)/, /^darwin-pipeline-/, /^darwin-plan-/, /^darwin_swarm_/, /^darwin_plan_/,
        /^darwin_show_closed$/, /^darwin_model_effort_display$/, /^darwin_category_count_display$/,
        /^darwin_filter_colors$/, /^darwin_trends_view$/, /^darwin-instructions-/, /^darwin-documents-/],
    'swarm-validate': [/^darwin-swarm-test/],
});

// ── Redaction ───────────────────────────────────────────────────────────────
const SECRET_NAME = /token|secret|passw|credential|cognito|pkce|jwt|cookie|api[-_]?key|verifier|^auth(orization)?$/i;
/** An OAuth callback's query/hash parameters, on top of SECRET_NAME. */
const URL_SECRET_PARAM = /^(code|state)$/i;
const JWT_LIKE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
export const REDACTED = '[redacted]';

/** `value` with every credential-shaped key dropped and JWT-shaped string replaced. */
export function redact(value, depth = 0) {
    if (typeof value === 'string') return JWT_LIKE.test(value) ? REDACTED : value;
    if (value == null || typeof value !== 'object') return value;
    if (depth > 12) return '[too deep]';
    if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (SECRET_NAME.test(k)) continue;
        out[k] = redact(v, depth + 1);
    }
    return out;
}

const decode = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
const secretParam = (name) => SECRET_NAME.test(name) || URL_SECRET_PARAM.test(name);

/** A query string (or `#a=b&c` hash) as its raw `name=value` pairs, in order —
 *  without a credential: a credential-named pair, or one whose text is
 *  JWT-shaped whatever its name (a bare `#eyJ…` hash included). */
const rawPairs = (s) => (s || '').replace(/^[?#]/, '').split('&').filter(Boolean)
    .map(raw => ({ raw, name: decode(raw.split('=')[0]) }))
    .filter(p => !secretParam(p.name) && !JWT_LIKE.test(decode(p.raw)));

/** The query/hash with credential parameters removed, still raw-encoded. */
export function cleanQuery(s, prefix = '?') {
    const kept = rawPairs(s).map(p => p.raw);
    return kept.length ? `${prefix}${kept.join('&')}` : '';
}

/** A query as an object: one value a string, a repeated name an array. */
export function queryObject(s) {
    const out = {};
    for (const { raw, name } of rawPairs(s)) {
        const i = raw.indexOf('=');
        const v = i < 0 ? '' : decode(raw.slice(i + 1));
        out[name] = name in out ? [].concat(out[name], v) : v;
    }
    return redact(out);
}

// ── The page ────────────────────────────────────────────────────────────────

/** The surface a worker's dev server opens on: `<path>?<query>` without the
 *  filer's own `filer` parameter or any credential — /devops-devserver-start's
 *  deep-link form. A page that reports its own (registerPageOptions) wins. */
export function surfaceOf(pathname, search, pageSurface = null) {
    if (typeof pageSurface === 'string' && pageSurface.startsWith('/')) {
        // The page's own link is held to the same filter.
        const i = pageSurface.indexOf('?');
        return i < 0 ? pageSurface.split('#')[0] : surfaceOf(pageSurface.slice(0, i), pageSurface.slice(i).split('#')[0]);
    }
    const kept = rawPairs(search).filter(p => p.name !== 'filer').map(p => p.raw);
    return `${pathname || '/'}${kept.length ? `?${kept.join('&')}` : ''}`;
}

/** The record ids a path names — each numeric segment under the one before it:
 *  `/swarm/pipeline/2` → `{ pipeline: 2 }`. */
export function routeIds(pathname) {
    const segs = (pathname || '').split('/').filter(Boolean);
    const out = {};
    segs.forEach((s, i) => { if (/^\d+$/.test(s) && i > 0) out[segs[i - 1]] = Number(s); });
    return out;
}

// The one page that reports its own live options, if any is mounted.
let pageOptions = null;

/**
 * A page reports what its URL cannot say — `read()` returns `{ options, surface }`
 * at press time (`surface`: the page's canonical deep link for what is on
 * screen). Returns the unregister function; a later registration replaces an
 * earlier one, and unregistering a replaced one is a no-op.
 */
export function registerPageOptions(read) {
    const entry = { read };
    pageOptions = entry;
    return () => { if (pageOptions === entry) pageOptions = null; };
}

function readPageOptions() {
    if (!pageOptions) return null;
    try { return pageOptions.read() || null; } catch (e) { return { options: { error: String(e?.message || e) } }; }
}

/** The owning application's persisted view state, from VIEW_STATE_KEYS. */
export function viewState(app, storage = globalThis.localStorage) {
    const patterns = VIEW_STATE_KEYS[app];
    if (!patterns || !storage) return {};
    const out = {};
    let keys = [];
    try { keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(Boolean).sort(); } catch { return {}; }
    for (const key of keys) {
        if (!patterns.some(p => p.test(key)) || SECRET_NAME.test(key)) continue;
        let raw;
        try { raw = storage.getItem(key); } catch { continue; }
        if (raw == null) continue;
        if (raw.length > VIEW_VALUE_MAX_CHARS) { out[key] = `[${raw.length} chars — not copied]`; continue; }
        let v = raw;
        try { v = JSON.parse(raw); } catch { /* a plain string */ }
        // A zustand persist envelope: the state is what matters.
        if (v && typeof v === 'object' && 'state' in v && 'version' in v) v = v.state;
        out[key] = redact(v);
    }
    return out;
}

// ── The Action Popups ───────────────────────────────────────────────────────

const px = (n) => Math.round(n);

/** One Action Popup as drawn: id, title, racked, open, dock and rect in Darwin's
 *  viewport px (`off` — its document's origin, for a rack in an iframe). */
function popupRecord(el, off, racked) {
    const r = el.getBoundingClientRect();
    const id = el.getAttribute('data-rack-id');
    const testid = el.getAttribute('data-testid');
    const body = testid ? el.querySelector(`[data-testid="${testid}-body"]`) : null;
    const title = testid ? el.querySelector(`[data-testid="${testid}-title"]`)?.textContent : null;
    const inRack = el.getAttribute('data-racked') === '1';
    return {
        id,
        ...(title ? { title } : null),
        racked: inRack,
        ...(inRack ? { rackIndex: racked.indexOf(id) } : null),
        open: body ? body.getAttribute('data-folded') !== '1' : null,
        dock: el.getAttribute('data-dock'),
        rect: { x: px(r.left + off.left), y: px(r.top + off.top), w: px(r.width), h: px(r.height) },
    };
}

/** Every Action Popup drawn now — floating in Darwin's page or racked in the
 *  rack, which may be a page toolbar's shadow root in an iframe (req #3792). */
export function openActionPopups(doc = document) {
    const { slot, racked } = usePanelRackStore.getState();
    const seen = new Set();
    const out = [];
    const collect = (root, off) => {
        root?.querySelectorAll?.('[data-rack-id]').forEach((el) => {
            if (seen.has(el)) return;
            seen.add(el);
            out.push(popupRecord(el, off, racked || []));
        });
    };
    collect(doc, { left: 0, top: 0 });
    const node = slot?.node;
    if (node && node.ownerDocument !== doc) collect(node, slotOffset(slot));
    return out;
}

// ── The snapshot ────────────────────────────────────────────────────────────

function visibleApps(profile) {
    const groups = new Set(NAV_GROUPS.map(g => g.id));
    return Object.entries(DEV_APP_GROUPS)
        .filter(([, gs]) => gs.some(g => groups.has(g) && isGroupVisible(profile, g)))
        .map(([app]) => app);
}

/**
 * Where the reader is filing from, now.
 *
 * @param {Object} p
 * @param {{pathname, search, hash}} p.location  the router's location
 * @param {?Object} p.profile    AuthContext profile (its app toggles)
 * @param {?string} p.database   AppContext database
 * @param {?{themeMode, effectiveMode}} p.theme  ThemeContext
 * @param {string} p.popupId     the filer's rack id
 * @param {?Object} p.popupStore the filer's { dock, open }
 * @param {Date} [p.now]
 */
export function captureFiledFrom({ location, profile, database, theme, popupId, popupStore, now = new Date() }) {
    const { pathname = '/', search = '', hash = '' } = location || {};
    const page = readPageOptions();
    const app = appForRoute(pathname);
    const popups = typeof document !== 'undefined' ? openActionPopups(document) : [];
    const self = popups.find(p => p.id === popupId) || null;
    const query = cleanQuery(search);
    const cleanHash = cleanQuery(hash, '#');
    return {
        version: FILED_FROM_VERSION,
        filedAt: now.toISOString(),
        surface: surfaceOf(pathname, search, page?.surface),
        url: { full: `${pathname}${query}${cleanHash}`, path: pathname, query, hash: cleanHash },
        options: {
            app,
            query: queryObject(search),
            routeIds: routeIds(pathname),
            ...(page?.options ? { page: redact(page.options) } : null),
            viewState: viewState(app),
        },
        state: {
            build: import.meta.env.DEV ? 'dev' : 'prod',
            database: database ?? null,
            origin: typeof window !== 'undefined' ? window.location.origin : null,
            apps: { visible: visibleApps(profile), devScope: DEV_APPS ? [...DEV_APPS] : null },
            theme: { mode: theme?.themeMode ?? null, effective: theme?.effectiveMode ?? null },
            viewport: typeof window !== 'undefined'
                ? { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 }
                : null,
            actionPopups: popups.filter(p => p !== self),
        },
        popup: {
            id: popupId,
            racked: self ? self.racked : (usePanelRackStore.getState().racked || []).includes(popupId),
            ...(self?.racked ? { rackIndex: self.rackIndex } : null),
            open: popupStore?.open ?? self?.open ?? null,
            dock: popupStore?.dock ?? null,
            rect: self?.rect ?? null,
        },
    };
}

// ── The block ───────────────────────────────────────────────────────────────

const render = (ctx) => [
    FILED_FROM_BEGIN,
    `Surface: ${ctx.surface}`,
    `URL: ${ctx.url.full}`,
    `Filed at: ${ctx.filedAt}`,
    JSON.stringify(ctx, null, 2),
    FILED_FROM_END,
].join('\n');

/** One header line's ceiling, chars. */
const LINE_MAX_CHARS = 2000;
const clip = (s) => (s.length > LINE_MAX_CHARS ? `${s.slice(0, LINE_MAX_CHARS)}…` : s);

/** The description block for `ctx`, held under FILED_FROM_MAX_CHARS: the
 *  persisted view state goes first, then its largest keys' places are kept
 *  by name, then the other popups shrink to ids — and when even that is too
 *  big (a huge query), the header lines alone, clipped, which always fit. */
export function formatFiledFromBlock(ctx) {
    let text = render(ctx);
    if (text.length <= FILED_FROM_MAX_CHARS) return text;
    const vs = ctx.options.viewState && typeof ctx.options.viewState === 'object' ? ctx.options.viewState : {};
    // Biggest first, until it fits: each dropped key keeps its name.
    const sized = Object.keys(vs).map(k => [k, JSON.stringify(vs[k]).length]).sort((a, b) => b[1] - a[1]);
    const trimmed = { ...vs };
    for (const [k, n] of sized) {
        trimmed[k] = `[${n} chars — over the block's size cap]`;
        ctx = { ...ctx, options: { ...ctx.options, viewState: trimmed } };
        text = render(ctx);
        if (text.length <= FILED_FROM_MAX_CHARS) return text;
    }
    ctx = { ...ctx, state: { ...ctx.state, actionPopups: (ctx.state.actionPopups || []).map(p => p.id ?? p) } };
    text = render(ctx);
    if (text.length <= FILED_FROM_MAX_CHARS) return text;
    return [
        FILED_FROM_BEGIN,
        `Surface: ${clip(ctx.surface)}`,
        `URL: ${clip(ctx.url.full)}`,
        `Filed at: ${ctx.filedAt}`,
        `Context: over the block's ${FILED_FROM_MAX_CHARS}-char size cap — omitted`,
        FILED_FROM_END,
    ].join('\n');
}

/** The last Filed-from block in `text`: `{ surface, url, context }`, or null. */
export function parseFiledFromBlock(text) {
    if (typeof text !== 'string') return null;
    const end = text.lastIndexOf(FILED_FROM_END);
    const begin = end < 0 ? -1 : text.lastIndexOf(FILED_FROM_BEGIN, end);
    if (begin < 0) return null;
    const body = text.slice(begin + FILED_FROM_BEGIN.length, end);
    const line = (name) => body.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1]?.trim() ?? null;
    let context = null;
    // The JSON opens its own line — a `{` in the URL line is not it.
    const json = body.indexOf('\n{');
    if (json >= 0) { try { context = JSON.parse(body.slice(json + 1)); } catch { context = null; } }
    return { surface: line('Surface'), url: line('URL'), context };
}

/** The block for a requirement filed now. A capture that fails still files —
 *  with the URL and the failure, never silently without the block. */
export function filedFromBlockNow(args) {
    try {
        return formatFiledFromBlock(captureFiledFrom(args));
    } catch (e) {
        const { pathname = '/', search = '', hash = '' } = args?.location || {};
        return [
            FILED_FROM_BEGIN,
            `Surface: ${surfaceOf(pathname, search)}`,
            `URL: ${pathname}${cleanQuery(search)}${cleanQuery(hash, '#')}`,
            `Capture failed: ${String(e?.message || e)}`,
            FILED_FROM_END,
        ].join('\n');
    }
}
