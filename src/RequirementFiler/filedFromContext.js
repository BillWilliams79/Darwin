// filedFromContext.js — where a requirement was filed from (req #3813). The
// Requirement Filer snapshots it the moment its + is clicked (req #3830) —
// before the editor opens, so the editor is never the subject. Since req #3815
// (user ruling 2026-10-23, absorbing #3818) it is one category of the debug
// capture — `filedFrom` in RequirementFiler/debugBundle.js, droppable like the
// others — rather than a block in the description; the description's `Debug
// capture` block carries its Surface and URL lines. What it records:
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
//   • Pointed at — the page element(s) a floating filer sits over (req #3829,
//               `pointedAt`; null with `pointedAtReason` when racked) — on a
//               canvas, the OBJECT drawn there (req #4158, filerPointResolvers.js).
//   • Subject — the record(s) the page's address names, titled from the React
//               Query cache, with the database their ids belong to (req #4158,
//               filerSubject.js).
//
// `surface` is `<path>?<query>` exactly as /devops-devserver-start takes a deep
// link, so a worker opens its dev server on the surface the requirement was
// filed from.
//
// NEVER A CREDENTIAL. Persisted state is read from an ALLOWLIST of the owning
// application's view keys (never the auth/profile keys), and everything that
// goes in — query, hash, view state, page options — is redacted on top of that:
// credential-shaped names dropped, JWT-shaped values replaced (`redact`).

import { PROXY_AUTH } from '../config/product';
import { slotOffset } from '../Components/AnchoredPanel/usePanelRack';
import { DEV_APP_GROUPS, DEV_APPS, NAV_GROUPS, appForRoute, isGroupVisible } from '../NavBar/navConfig';
import { rackPlacement, usePanelRackStore } from '../stores/usePanelRackStore';
import { queryClient } from '../QueryClient/QueryClientSetup';
import { resolveSubjects } from './filerSubject';
import { hasPointResolver, objectLabel, resolveAt, specificUnder } from './filerPointResolvers';

export const FILED_FROM_VERSION = 1;
/** The context's size ceiling in the capture, serialized chars. */
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
// req #4076 — the auth provider's own name is a credential marker only where
// that provider is in the build (the internal, proxy-auth bundle names no AWS service).
const SECRET_NAME = PROXY_AUTH
    ? /token|secret|passw|credential|pkce|jwt|cookie|api[-_]?key|verifier|^auth(orization)?$/i
    : /token|secret|passw|credential|cognito|pkce|jwt|cookie|api[-_]?key|verifier|^auth(orization)?$/i;
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

/** The query/hash with credential parameters (and any `drop`ped names)
 *  removed, still raw-encoded. */
export function cleanQuery(s, prefix = '?', drop = []) {
    const kept = rawPairs(s).filter(p => !drop.includes(p.name)).map(p => p.raw);
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
 * A page reports what its URL cannot say — `read()` returns `{ options, surface,
 * subject? }` at press time (`surface`: the page's canonical deep link for what
 * is on screen; `subject`: records it shows that its address does not name, as
 * `[{ kind, id, title, database? }]` — req #4158). Returns the unregister function; a later registration replaces an
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
function popupRecord(el, off, rackIndexOf) {
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
        ...(inRack ? { rackIndex: rackIndexOf(id) } : null),
        ...(el.getAttribute('data-title-locked') === '1' ? { titleLocked: true } : null),
        open: body ? body.getAttribute('data-folded') !== '1' : null,
        dock: el.getAttribute('data-dock'),
        rect: { x: px(r.left + off.left), y: px(r.top + off.top), w: px(r.width), h: px(r.height) },
    };
}

/** Every Action Popup drawn now — floating in Darwin's page or racked in a
 *  rack: the navbar's, or a page toolbar's shadow root in an iframe (req #3792,
 *  both at once since req #3886). `rackIndex` is its place in the stack it is
 *  drawn in (a toolbar's popup drawn in the navbar meanwhile: after the
 *  navbar's own). A popup drawn as its icon in a minimized bar has no head or
 *  body: no title, `open: null`. */
export function openActionPopups(doc = document) {
    const s = usePanelRackStore.getState();
    const rackIndexOf = (id) => rackPlacement(s, id)?.pos ?? -1;
    const seen = new Set();
    const out = [];
    const collect = (root, off) => {
        root?.querySelectorAll?.('[data-rack-id]').forEach((el) => {
            if (seen.has(el)) return;
            seen.add(el);
            out.push(popupRecord(el, off, rackIndexOf));
        });
    };
    collect(doc, { left: 0, top: 0 });
    [s.slot, s.pageSlot].forEach((slot) => {
        const node = slot?.node;
        if (node && node.ownerDocument !== doc) collect(node, slotOffset(slot));
    });
    return out;
}

// ── What the filer points at (req #3829) ────────────────────────────────────
//
// THE CONVENTION: drag the filer over the thing the requirement is about, then
// press Create. A floating filer's rect is probed at its centre and four inset
// corners with elementsFromPoint, skipping the filer's own two windows (the
// other Action Popups — the plan's Active box, Engine … — are pickable like any
// element, req #4044: FILER_OWN_POPUPS); each distinct
// element found is recorded, in probe order (the centre's first when the centre
// found one) — the nearest one carrying a data-testid (the
// element the page names), its testid path, role/aria-label, visible text and
// rect. A racked filer points at nothing: `pointedAt: null` with the reason —
// and so, since req #3958, does one locked into the title bar. And it records
// its place only while its PUSHPIN is pressed (user ruling 2026-10-26) — then a
// drag outlines the element as it goes (filerHover.js) and docks only in the navbar, so
// the other bars' own elements (title bar, topology toolbar …) are pickable
// too (user, 2026-10-27); unpinned, `pointedAt: null`, notPinned.
//
// A FIELD'S VALUE (user ruling 2026-10-23, req #3829): an unfocused field is a
// record's displayed data (a /swarm title is a TextField) and its text is
// recorded; the field being typed in, and any password/hidden/credential-shaped
// field, is NAMED and never copied.

/** Each pointed-at element's visible text ceiling, chars. */
export const POINTED_TEXT_MAX = 160;
/** Testids kept per path, and each one's ceiling. */
const POINTED_PATH_MAX = 12;
const POINTED_TESTID_MAX = 100;
/** Corner probes sit this far inside the filer's edge, px. */
const POINT_INSET = 4;
/** Elements a text walk visits at most — a big container with little early text. */
const TEXT_WALK_MAX_NODES = 2000;

export const POINTED_AT_REASONS = Object.freeze({
    racked: 'racked — a filer in the navbar or a toolbar rack points at nothing',
    titleLocked: 'locked into the title bar — a docked filer points at nothing',
    notPinned: 'not pinned — the filer records its place only while its pushpin is pressed',
    notDrawn: 'the filer is not drawn — nothing to point from',
    nothing: 'nothing under the filer but the page itself',
    overCap: 'dropped — the capture was over its size cap',
});

const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const UNREAD_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const UNREAD_INPUT_TYPES = new Set(['password', 'hidden', 'file']);
const CREDENTIAL_AUTOCOMPLETE = /password|one-time-code|cc-/i;

const isField = (el) => FIELD_TAGS.has(el.tagName) || !!el.isContentEditable;

/** Whether a field's text may be recorded: not the one being typed in (focused
 *  now, or `typingIn` — focused as the press began, since a click moves focus
 *  to the filer before it files), not a password/hidden/file input, nothing
 *  credential-shaped in its names. */
function fieldCopyable(el, typingIn = null) {
    // Inside a contenteditable, the editing host is what holds focus.
    let host = el;
    while (host.isContentEditable && host.parentElement?.isContentEditable) host = host.parentElement;
    const holds = (f) => !!f && (f === host || (typeof host.contains === 'function' && host.contains(f)));
    if (holds(el.ownerDocument?.activeElement) || holds(typingIn)) return false;
    if (el.tagName === 'INPUT' && UNREAD_INPUT_TYPES.has((el.type || 'text').toLowerCase())) return false;
    if (CREDENTIAL_AUTOCOMPLETE.test(el.getAttribute('autocomplete') || '')) return false;
    if (['name', 'id', 'aria-label', 'placeholder'].some(a => SECRET_NAME.test(el.getAttribute(a) || ''))) return false;
    // Its visible label too (an MUI TextField's is a <label for>, not an attribute).
    const doc = el.ownerDocument;
    const labels = [...(el.labels || []),
        ...(el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => doc?.getElementById(id))];
    return !labels.some(l => l && SECRET_NAME.test((l.textContent || '').trim().replace(/\s+/g, '_')));
}

function fieldText(el) {
    if (el.tagName === 'SELECT') return Array.from(el.selectedOptions || []).map(o => o.textContent).join(', ');
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.value ?? '';
    return el.textContent ?? '';
}

const shown = (el) => el.getAttribute('aria-hidden') !== 'true'
    && (typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true }));

/** `el`'s visible text, clipped — a field contributes its value only when
 *  `fieldCopyable`; otherwise it is skipped, never read. */
export function visibleText(el, max = POINTED_TEXT_MAX, typingIn = null) {
    const parts = [];
    let n = 0;
    let visited = 0;
    const walk = (node) => {
        if (n > max || ++visited > TEXT_WALK_MAX_NODES) return;
        if (node.nodeType === 3) {
            const t = node.nodeValue.replace(/\s+/g, ' ').trim();
            if (t) { parts.push(t); n += t.length + 1; }
            return;
        }
        if (node.nodeType !== 1 || UNREAD_TAGS.has(node.tagName) || !shown(node)) return;
        if (isField(node)) {
            if (fieldCopyable(node, typingIn)) {
                const t = fieldText(node).replace(/\s+/g, ' ').trim();
                if (t) { parts.push(t); n += t.length + 1; }
            }
            return;
        }
        for (const c of node.childNodes) walk(c);
    };
    walk(el);
    const text = parts.join(' ');
    return redact(text.length > max ? `${text.slice(0, max)}…` : text);
}

/** The testids from `el` up, innermost first (as the capture's activeElement). */
function testidPath(el) {
    const ids = [];
    for (let n = el; n && n.tagName !== 'BODY' && n.tagName !== 'HTML'; n = n.parentElement) {
        const id = n.getAttribute?.('data-testid');
        if (id) ids.push(id.slice(0, POINTED_TESTID_MAX));
    }
    return ids.slice(0, POINTED_PATH_MAX);
}

/** The Action Popups a probe never finds: the filer itself and its editor —
 *  RequirementFiler.jsx FILER_RACK_ID and RequirementEditorPopup.jsx
 *  EDITOR_RACK_ID (named here, not imported: both components depend on this module).
 *  Every other Action Popup is an element like any other (req #4044). */
export const FILER_OWN_POPUPS = Object.freeze(['requirement-filer', 'requirement-editor']);
const OWN_POPUP_SELECTOR = FILER_OWN_POPUPS.map(id => `[data-rack-id="${id}"]`).join(',');

/** The topmost page element at (x, y) of `doc` — the filer's own popups, html and body skipped. */
function pageElementAt(doc, x, y) {
    const els = typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint(x, y) : [];
    return els.find(el => el.tagName !== 'HTML' && el.tagName !== 'BODY' && !el.closest?.(OWN_POPUP_SELECTOR)) || null;
}

/** The one iframe under (x, y) inside `hit` — a frame whose pointer is off
 *  while a popup is carried over it (Systems/ToolbarRack.jsx) is skipped by
 *  elementsFromPoint, so its container is hit instead. */
function frameUnder(hit, x, y) {
    const frames = hit.tagName === 'IFRAME' ? [hit] : Array.from(hit.querySelectorAll?.('iframe') || []);
    return frames.find((f) => {
        const r = f.getBoundingClientRect();
        return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    }) || null;
}

/**
 * The page element at (x, y) of `doc`, as a popup over it points at it:
 * `{ hit, off, frame, typing }` — `hit` the topmost element (the filer's own
 * popups, html and body skipped), one level into a same-origin iframe (`off` — that
 * document's origin in Darwin's viewport; `frame` — the iframe's testid path
 * and label); `typing` — `typingIn`, or the frame's focused element when focus
 * was in the frame. Null over nothing.
 */
export function probeAt(doc, x, y, typingIn = null) {
    let hit = pageElementAt(doc, x, y);
    if (!hit) return null;
    let off = { left: 0, top: 0 };
    let frame = null;
    let typing = typingIn;
    // A same-origin frame (Topology, AI Architecture): what is under the point inside it.
    const iframe = frameUnder(hit, x, y);
    if (iframe) {
        try {
            const fr = iframe.getBoundingClientRect();
            const inner = iframe.contentDocument && pageElementAt(iframe.contentDocument,
                x - fr.left - iframe.clientLeft, y - fr.top - iframe.clientTop);
            if (inner) {
                off = { left: fr.left + iframe.clientLeft, top: fr.top + iframe.clientTop };
                // Focus held inside the frame as the press began.
                if (typingIn === iframe) typing = iframe.contentDocument.activeElement;
                frame = { testidPath: testidPath(iframe), label: (iframe.getAttribute('data-testid') || iframe.getAttribute('src') || 'iframe').slice(0, POINTED_TESTID_MAX) };
                hit = inner;
            } else if (hit !== iframe) {
                hit = iframe;
            }
        } catch {
            // Cross-origin: the iframe itself is what it points at.
            hit = iframe;
        }
    }
    return { hit, off, frame, typing };
}

/** The element a probe names — the nearest carrying a data-testid. */
export const namedElement = (hit) => hit.closest?.('[data-testid]') || hit;

/**
 * What a probe at (x, y) of Darwin's viewport POINTS AT (req #4158): the named
 * element, refined. A canvas host with a registered point resolver
 * (filerPointResolvers.js) answers the OBJECT drawn there — an epic, a
 * requirement row, an initiative band — and a large DOM container is
 * descended to the most specific identifiable element under the probe.
 *
 * `{ named, key, object?, specific?, rect }` — `key` tells two targets apart
 * (two objects on one canvas are two targets), `rect` is what an outline
 * draws, in Darwin's viewport px ({left, top, width, height}).
 */
export function pointTarget(probe, x, y) {
    const { hit, off } = probe;
    const named = namedElement(hit);
    const testid = named.getAttribute?.('data-testid');
    const offRect = (r) => ({ left: r.left + off.left, top: r.top + off.top, width: r.width, height: r.height });
    if (testid && hasPointResolver(testid)) {
        const object = resolveAt(named, x - off.left, y - off.top);
        if (object) {
            const { rect, ...o } = object;
            return { named, key: `object:${testid}:${o.kind}:${o.id}`, object: o, host: testid,
                rect: offRect(rect || named.getBoundingClientRect()) };
        }
    }
    const specific = specificUnder(hit, named);
    if (specific) {
        return { named, key: specific.el, specific, rect: offRect(specific.el.getBoundingClientRect()) };
    }
    return { named, key: named, rect: offRect(named.getBoundingClientRect()) };
}

const rectRecord = (r) => ({ x: px(r.left), y: px(r.top), w: px(r.width), h: px(r.height) });

/** One element as recorded; `off` — its document's origin in Darwin's viewport.
 *  `target` — its pointTarget, when the probe point is known: an object a
 *  canvas resolved is recorded as `object` (its rect, its own label as the
 *  text, the canvas as `host`), a specific child of a large container as
 *  `specific` (req #4158). */
export function elementRecord(hit, off, frame, typingIn, target = null) {
    const named = target?.named || namedElement(hit);
    const r = named.getBoundingClientRect();
    const role = named.getAttribute('role');
    const ariaLabel = named.getAttribute('aria-label');
    const field = isField(hit)
        ? { tag: hit.tagName.toLowerCase(), ...(hit.type && hit.tagName === 'INPUT' ? { type: hit.type } : null),
            ...(hit.getAttribute('name') ? { name: hit.getAttribute('name') } : null), copied: fieldCopyable(hit, typingIn) }
        : null;
    const namedRect = { x: px(r.left + off.left), y: px(r.top + off.top), w: px(r.width), h: px(r.height) };
    const base = {
        tag: named.tagName.toLowerCase(),
        ...(named !== hit ? { hit: hit.tagName.toLowerCase() } : null),
        testidPath: [...testidPath(named), ...(frame?.testidPath || [])].slice(0, POINTED_PATH_MAX),
        ...(frame ? { frame: frame.label } : null),
        ...(role ? { role } : null),
        ...(ariaLabel ? { ariaLabel: redact(ariaLabel.slice(0, POINTED_TEXT_MAX)) } : null),
        ...(field ? { field } : null),
    };
    if (target?.object) {
        const object = redact(target.object);
        return { ...base, object, host: target.host, text: redact(objectLabel(object)).slice(0, POINTED_TEXT_MAX),
            rect: rectRecord(target.rect), hostRect: namedRect };
    }
    if (target?.specific) {
        const el = target.specific.el;
        const text = visibleText(el, POINTED_TEXT_MAX, typingIn);
        const elLabel = el.getAttribute('aria-label');
        const title = (elLabel ? redact(elLabel.slice(0, POINTED_TEXT_MAX)) : text) || null;
        return {
            ...base,
            ...(target.specific.id != null
                ? { object: { kind: target.specific.kind, id: redact(target.specific.id), ...(title ? { title } : null) } }
                : null),
            specific: { tag: el.tagName.toLowerCase(), kind: target.specific.kind,
                ...(elLabel ? { ariaLabel: redact(elLabel.slice(0, POINTED_TEXT_MAX)) } : null) },
            within: named.getAttribute('data-testid'),
            text,
            rect: rectRecord(target.rect),
            hostRect: namedRect,
        };
    }
    return { ...base, text: visibleText(named, POINTED_TEXT_MAX, typingIn), rect: namedRect };
}

/** What a floating filer sits over — `{ pointedAt, pointedAtReason? }`, for the
 *  filer's own `self` popup record (openActionPopups). `typingIn` — the element
 *  that held focus as the press began; it is never copied. */
export function pointedAtNow(self, doc = document, typingIn = null) {
    if (self?.racked) return { pointedAt: null, pointedAtReason: POINTED_AT_REASONS.racked };
    // Docked in the title bar, it sits over the bar (req #3958).
    if (self?.titleLocked) return { pointedAt: null, pointedAtReason: POINTED_AT_REASONS.titleLocked };
    if (!self?.rect) return { pointedAt: null, pointedAtReason: POINTED_AT_REASONS.notDrawn };
    const { x, y, w, h } = self.rect;
    const view = doc.defaultView;
    const maxX = Math.max(0, (view?.innerWidth || x + w) - 1);
    const maxY = Math.max(0, (view?.innerHeight || y + h) - 1);
    const ix = Math.min(POINT_INSET, w / 4);
    const iy = Math.min(POINT_INSET, h / 4);
    const points = [
        ['centre', x + w / 2, y + h / 2],
        ['top-left', x + ix, y + iy], ['top-right', x + w - ix, y + iy],
        ['bottom-left', x + ix, y + h - iy], ['bottom-right', x + w - ix, y + h - iy],
    ];
    const byElement = new Map();
    for (const [name, rawX, rawY] of points) {
        const px0 = Math.min(maxX, Math.max(0, rawX));
        const py0 = Math.min(maxY, Math.max(0, rawY));
        const probe = probeAt(doc, px0, py0, typingIn);
        if (!probe) continue;
        const { hit, off, frame, typing } = probe;
        const target = pointTarget(probe, px0, py0);
        const { key } = target;
        if (!byElement.has(key)) byElement.set(key, { points: [], hit, off, frame, typing, target });
        byElement.get(key).points.push(name);
    }
    if (!byElement.size) return { pointedAt: [], pointedAtReason: POINTED_AT_REASONS.nothing };
    return {
        pointedAt: [...byElement.values()].map(({ points: p, hit, off, frame, typing, target }) => ({ points: p, ...elementRecord(hit, off, frame, typing, target) })),
    };
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
 * @param {?Object} p.popupStore the filer's { dock, open, titleLock }
 * @param {?Element} [p.typingIn] the element focused as the press began
 * @param {boolean} [p.pinned]   the filer's pushpin — unpressed, it records no place (req #3958)
 * @param {?Object} [p.heldRect] {x, y, w, h} — where a pinned filer was let go
 *   half off screen (req #4046): it slid back on, and the place it HOLDS, not
 *   where it now sits, is what it points at
 * @param {?Object} [p.queryCache] the React Query cache the subject titles come from (req #4158)
 * @param {Date} [p.now]
 */
export function captureFiledFrom({ location, profile, database, theme, popupId, popupStore, typingIn = null, pinned = false, heldRect = null, queryCache = queryClient.getQueryCache(), now = new Date() }) {
    const { pathname = '/', search = '', hash = '' } = location || {};
    const page = readPageOptions();
    const app = appForRoute(pathname);
    const popups = typeof document !== 'undefined' ? openActionPopups(document) : [];
    const self = popups.find(p => p.id === popupId) || null;
    // Without the filer's own `filer` parameter: opening the URL must not file again.
    const query = cleanQuery(search, '?', ['filer']);
    const cleanHash = cleanQuery(hash, '#');
    const racked = self ? self.racked : rackPlacement(usePanelRackStore.getState(), popupId) != null;
    const pointed = !pinned ? { pointedAt: null, pointedAtReason: POINTED_AT_REASONS.notPinned }
        : typeof document !== 'undefined'
        ? (self && heldRect && !self.racked && !self.titleLocked
            ? { ...pointedAtNow({ ...self, rect: heldRect }, document, typingIn), pointedAtFrom: 'held', heldRect }
            : pointedAtNow(self ?? (racked ? { racked } : null), document, typingIn))
        : { pointedAt: null, pointedAtReason: POINTED_AT_REASONS.notDrawn };
    const ids = routeIds(pathname);
    const queryObj = queryObject(search);
    return {
        version: FILED_FROM_VERSION,
        filedAt: now.toISOString(),
        surface: surfaceOf(pathname, search, page?.surface),
        // What the page was showing, by record (req #4158): never a request.
        subject: redact(resolveSubjects({ routeIds: ids, query: queryObj, database, queryCache, pageSubjects: page?.subject })),
        url: { full: `${pathname}${query}${cleanHash}`, path: pathname, query, hash: cleanHash },
        options: {
            app,
            query: queryObj,
            routeIds: ids,
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
        // What the filer sits over — the requirement is about it (req #3829).
        ...pointed,
        popup: {
            id: popupId,
            racked,
            pinned: !!pinned,
            ...(self?.racked ? { rackIndex: self.rackIndex } : null),
            open: popupStore?.open ?? self?.open ?? null,
            dock: popupStore?.dock ?? null,
            // Locked into the page's title bar (req #3857): where, and whether
            // it is drawn there now.
            ...(popupStore?.titleLock ? { titleLock: popupStore.titleLock, titleLocked: !!self?.titleLocked } : null),
            rect: self?.rect ?? null,
        },
    };
}

// ── At the press ────────────────────────────────────────────────────────────

/** Where the reader is filing from, now, held under FILED_FROM_MAX_CHARS: the
 *  persisted view state goes first (each dropped key keeps its name), then the
 *  other popups shrink to ids. A capture that fails still records the URL and
 *  the failure — a requirement is never filed silently without its place. */
export function filedFromNow(args) {
    let ctx;
    try {
        ctx = captureFiledFrom(args);
    } catch (e) {
        const { pathname = '/', search = '', hash = '' } = args?.location || {};
        return {
            version: FILED_FROM_VERSION,
            surface: surfaceOf(pathname, search),
            url: { full: `${pathname}${cleanQuery(search, '?', ['filer'])}${cleanQuery(hash, '#')}` },
            captureError: String(e?.message || e),
        };
    }
    const size = (c) => JSON.stringify(c).length;
    if (size(ctx) <= FILED_FROM_MAX_CHARS) return ctx;
    const vs = ctx.options.viewState && typeof ctx.options.viewState === 'object' ? ctx.options.viewState : {};
    const trimmed = { ...vs };
    for (const [k, n] of Object.keys(vs).map(k => [k, JSON.stringify(vs[k]).length]).sort((a, b) => b[1] - a[1])) {
        trimmed[k] = `[${n} chars — over the size cap]`;
        ctx = { ...ctx, options: { ...ctx.options, viewState: trimmed } };
        if (size(ctx) <= FILED_FROM_MAX_CHARS) return ctx;
    }
    ctx = { ...ctx, state: { ...ctx.state, actionPopups: (ctx.state.actionPopups || []).map(p => p.id ?? p) } };
    if (size(ctx) <= FILED_FROM_MAX_CHARS) return ctx;
    // What it points at keeps its first element (the centre's, when the centre found one).
    if (Array.isArray(ctx.pointedAt) && ctx.pointedAt.length > 1) {
        ctx = { ...ctx, pointedAt: ctx.pointedAt.slice(0, 1), pointedAtOmitted: ctx.pointedAt.length - 1 };
        if (size(ctx) <= FILED_FROM_MAX_CHARS) return ctx;
    }
    return { version: ctx.version, filedAt: ctx.filedAt, surface: ctx.surface.slice(0, 2000),
        ...(Array.isArray(ctx.subject) ? { subject: ctx.subject } : null),
        state: { database: ctx.state?.database ?? null },
        url: { full: ctx.url.full.slice(0, 2000) }, omitted: `over the ${FILED_FROM_MAX_CHARS}-char size cap`,
        // A press that recorded no place keeps saying why (req #3958: not pinned, racked …).
        pointedAt: null, pointedAtReason: ctx.pointedAt == null && ctx.pointedAtReason ? ctx.pointedAtReason : POINTED_AT_REASONS.overCap,
        popup: { id: ctx.popup?.id, pinned: !!ctx.popup?.pinned } };
}
