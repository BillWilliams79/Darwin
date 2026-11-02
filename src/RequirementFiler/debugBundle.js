// debugBundle.js — the Requirement Filer's debug capture (req #3815):
// the bundle assembled at the press from utils/debugCapture.js's always-on
// buffers plus what can be read retroactively, redacted, sized per category so
// the editor can show it and drop a category before Save, and the short
// `Debug capture` block the requirement's description carries.
//
// Design, caps, redaction and the measurements behind every number here:
// memory/action-popup-requirement-filer.md (req #3814).
//
// ONE BUTTON (user ruling 2026-10-23, absorbing #3818): every requirement the
// filer files carries this capture, and where it was filed from (#3813's
// context, filedFromContext.js) is its first category, `filedFrom`. Dropping a
// category before the first save is how a plain request strips it; dropping
// them all files the requirement with no capture at all.
//
// STORED in `requirement_debug_captures` (one row per requirement), never in
// the description: the 92 production bundles of 2026-10-23…31 had a median of
// 47 KB (40 KB re-encoded by req #4159, losslessly), ~270 K chars at the caps,
// and the description rides into every MCP live-work read.
//
// CORRECT AND COMPLETE (req #4159): an empty Lambda-Rest list read is counted,
// never listed as a failure; what the reader SAW (snackbar, alerts, dialogs) is
// its own category and failure evidence; focus losses carry their age; and
// repeated GETs and storage the view state already records are stored once —
// `networkOccurrences` / `expandStorage` give the old encoding back. A worker
// reads the block in the description and pulls the bundle by id —
// `darwin://requirement-debug/<requirement id>`.
//
// NEVER A CREDENTIAL. Cookies, headers and request bodies are never read
// (debugCapture.js); storage keys that look like credentials are dropped whole;
// every URL has its credential parameters redacted; and every category's
// serialized text is scrubbed of anything token-shaped, counting the hits.

import { PRODUCT, PROXY_AUTH } from '../config/product';
import { database as userDatabase } from '../Context/AppContext';
import { queryClient } from '../QueryClient/QueryClientSetup';
import { usePressStore } from '../dnd/pressStore';
import { useDragTabStore } from '../stores/useDragTabStore';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { bounded, capList, cleanUrl, debugCaptureState, DEBUG_CAPTURE_CAPS, networkOccurrences, ser } from '../utils/debugCapture';
import { focusTimeline, storedFocusLosses } from '../utils/focusLossRecorder';
import { objectLabel } from './filerPointResolvers';
import { databaseNote, subjectLabel } from './filerSubject';

// v2 (req #4160): the block is written for its reader, and the stored bundle
// opens with a `summary` index. A v1 block (req #3815) is still replaced in place.
export const DEBUG_CAPTURE_VERSION = 2;
export const DEBUG_BLOCK_BEGIN = `--- Debug capture v${DEBUG_CAPTURE_VERSION} (req #4160) ---`;
export const DEBUG_BLOCK_END = '--- end Debug capture ---';
/** The begin marker of a block of ANY version, v1 included. */
const ANY_BLOCK_BEGIN = /--- Debug capture v\d+ \(req #\d+\) ---/;
/** Where a worker reads the full bundle. */
export const debugCaptureUri = (requirementId) => `darwin://requirement-debug/${requirementId}`;
/** THE way to read a capture in context (req #4160): the full stored bundle,
 *  and exactly the portion asked for, verbatim. */
export const READ_CAPTURE = 'scripts/debug/read-capture.py';

const KB = 1024;
/** The caps the rings do not already enforce (design § Caps and windows). */
export const BUNDLE_CAPS = Object.freeze({
    rtKeep: 100, rtSlowMs: 1000, rtBytes: 16 * KB,
    rqQueries: 200, queryBytes: 512, rqBytes: 32 * KB,
    storageValueBytes: 2 * KB, storageBytes: 16 * KB, keyMax: 200, namesMax: 50,
    titleMax: 200, testidPath: 20,
    storesBytes: 4 * KB, focusBytes: 8 * KB,
    // What the reader saw (req #4159): ≤ 10 visible alerts/dialogs, each ≤ 500
    // chars, ≤ 4 KB together — plus the snackbar's ≤ 5 messages of ≤ 500.
    screenItems: 10, screenTextMax: 500, screenAlertBytes: 4 * KB,
    // The description block's verbatim lines: at most 5 distinct of each kind (identical
    // ones counted ×N), ≤ 1.2 KB together (the spec allows 2 KB): on the 95 real captures the
    // worst bug block was 2,492 chars at 2 KB and 1,163 (490 tokens measured) at 1.2 KB with the
    // merges (req #4160, memory/requirement-filer-efficacy.md § The reading pipeline).
    blockLines: 5, blockLineMax: 400, blockDetailBytes: 1200,
    // The quoted text of what was pointed at, in the block and the index (whole in the bundle).
    pointedTextMax: 120,
});

/** The categories, in bundle order. `label` is what the editor shows. */
export const DEBUG_CATEGORIES = Object.freeze([
    { key: 'filedFrom', label: 'Filed from' },
    { key: 'environment', label: 'Environment' },
    { key: 'identity', label: 'Identity' },
    { key: 'console', label: 'Console' },
    { key: 'errors', label: 'Errors' },
    { key: 'screen', label: 'On screen' },
    { key: 'network', label: 'Network' },
    { key: 'resourceTiming', label: 'Resource timing' },
    { key: 'navigation', label: 'Navigation' },
    { key: 'reactQuery', label: 'Query cache' },
    { key: 'storage', label: 'Storage' },
    { key: 'stores', label: 'Stores' },
    { key: 'focus', label: 'Focus' },
]);

// ── Redaction ───────────────────────────────────────────────────────────────

/** Storage keys dropped whole — the Cognito SDK leaves its token cache in
 *  localStorage (`CognitoIdentityServiceProvider.<client>.<user>.idToken` …). */
// req #4076 — `cognito` only where the Cognito SDK is in the build (see filedFromContext.js).
export const CREDENTIAL_KEY = PROXY_AUTH
    ? /token|auth|secret|password|passwd|credential|session|jwt|cookie|apikey|api_key|pkce|verifier/i
    : /token|auth|cognito|secret|password|passwd|credential|session|jwt|cookie|apikey|api_key|pkce|verifier/i;
/** A JWS is three dot-separated segments; Cognito's refresh token is a JWE — five. */
const JWT = /eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){2,4}/g;
export const REDACTED_JWT = '[REDACTED-JWT]';

/** A credential query parameter INSIDE free text — a message, a stack, a
 *  logged string — which `cleanUrl` (URL fields only) never sees. */
const SECRET_PARAM_IN_TEXT = /([?&#](?:code|token|id_token|access_token|refresh_token|x-amz-security-token|x-amz-signature|signature)=)[^&#\s"'\\<>]+/gi;

/** `text` with every token-shaped run replaced, and how many there were; a
 *  credential URL parameter anywhere in the text is redacted too. */
export function scrubJwt(text) {
    let hits = 0;
    const out = String(text).replace(JWT, () => { hits++; return REDACTED_JWT; })
        .replace(SECRET_PARAM_IN_TEXT, (_, name) => `${name}[redacted]`);
    return { text: out, hits };
}

// ── The categories ──────────────────────────────────────────────────────────

const names = (list) => ({ count: list.length, names: list.slice(0, BUNDLE_CAPS.namesMax) });

function describeActive() {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const ids = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) {
        const id = n.getAttribute?.('data-testid');
        if (id) ids.push(id.slice(0, 100));
    }
    return { tag: el.tagName.toLowerCase(), testidPath: ids.slice(0, BUNDLE_CAPS.testidPath) };
}

/** One storage area: credential-shaped keys dropped, each value and the area capped. */
export function snapshotStorage(store) {
    const entries = {};
    const droppedKeys = [];
    const truncatedKeys = [];
    if (!store) return { unavailable: true };
    let total = 2;
    let length = 0;
    try { length = store.length; } catch { return { unavailable: true }; }
    for (let i = 0; i < length; i++) {
        let k;
        try { k = store.key(i); } catch { continue; }
        if (k == null) continue;
        if (CREDENTIAL_KEY.test(k)) { droppedKeys.push(k.slice(0, BUNDLE_CAPS.keyMax)); continue; }
        if (k.length > BUNDLE_CAPS.keyMax) { truncatedKeys.push(k.slice(0, BUNDLE_CAPS.keyMax)); continue; }
        let raw;
        try { raw = store.getItem(k); } catch { continue; }
        let v;
        try { v = JSON.parse(raw); } catch { v = raw; }
        v = ser(v);
        let s = JSON.stringify(v);
        if (s.length > BUNDLE_CAPS.storageValueBytes) {
            v = { truncated: s.length, head: s.slice(0, BUNDLE_CAPS.storageValueBytes - 64) };
            s = JSON.stringify(v);
        }
        const n = s.length + k.length + 4;
        if (total + n > BUNDLE_CAPS.storageBytes) { truncatedKeys.push(k); continue; }
        total += n;
        entries[k] = v;
    }
    return { droppedKeys: names(droppedKeys), truncatedKeys: names(truncatedKeys), entries };
}

function ringCategory(state, name) {
    const r = state?.rings?.[name];
    if (!r) return { installed: false };
    return { dropped: r.dropped, entries: r.all() };
}

/** A store's state without its actions (and without `omit`, recorded elsewhere). */
function storeState(store, omit = []) {
    const out = {};
    for (const [k, v] of Object.entries(store.getState() || {})) {
        if (typeof v !== 'function' && !omit.includes(k)) out[k] = v;
    }
    return ser(out);
}

// ── What the reader saw (req #4159) ─────────────────────────────────────────
// The error a reader files about is often one they SAW and that no trace
// holds: a client-side refusal shown in the snackbar before any request
// (3877), or an alert on the page (4154, "this immediately showed"). So the
// capture keeps the snackbar's recent messages and the text of every alert and
// dialog on screen at the press — the filer's own UI excepted.

const SEEN = '[role="alert"], [role="alertdialog"], [role="dialog"], dialog[open], .MuiAlert-root';
const FILER_UI = '[data-testid^="requirement-editor"], [data-testid^="requirement-filer"]';
const SEVERITY = /\bMuiAlert-(?:standard|filled|outlined|color)(Error|Warning|Info|Success)\b/;

/** Drawn and not hidden. A real browser answers checkVisibility; without
 *  layout (jsdom) an element is shown unless it or an ancestor is hidden. */
function isShown(el) {
    if (typeof el.checkVisibility === 'function') {
        return el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    }
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        if (n.hidden) return false;
        const cs = n.ownerDocument?.defaultView?.getComputedStyle?.(n);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    }
    return true;
}

function seenIn(doc, frame, out) {
    let els = [];
    try { els = [...doc.querySelectorAll(SEEN)]; } catch { return; }
    for (const el of els) {
        if (el.closest(FILER_UI) || !isShown(el)) continue;
        const text = oneLine(el.textContent);
        if (!text) continue;
        const role = el.getAttribute('role') || (el.tagName === 'DIALOG' ? 'dialog' : 'alert');
        // MUI's SnackbarContent is a role=alert with no severity: a toast — an
        // error or a plain message alike — so it is recorded as what it is, and
        // the snackbar store's own history says which kind it was.
        const toast = !!el.closest('.MuiSnackbar-root, .MuiSnackbarContent-root, [data-testid="snackbar"]');
        const severity = SEVERITY.exec(String(el.className?.baseVal ?? el.className ?? ''))?.[1]?.toLowerCase();
        const testid = el.getAttribute('data-testid') || el.closest('[data-testid]')?.getAttribute('data-testid');
        out.push({
            // A toast holding an MUI Alert carries its own severity (Maps, imports,
            // Build Visualizer keep local snackbars that never reach the store's
            // history), so only a severity-less toast defers to that history.
            kind: toast && !severity ? 'snackbar' : (/dialog/.test(role) && role !== 'alertdialog' ? 'dialog' : 'alert'),
            role,
            ...(severity ? { severity } : null),
            ...(testid ? { testid: testid.slice(0, 100) } : null),
            ...(frame ? { frame } : null),
            text: text.length > BUNDLE_CAPS.screenTextMax ? `${text.slice(0, BUNDLE_CAPS.screenTextMax)}…` : text,
            ...(text.length > BUNDLE_CAPS.screenTextMax ? { chars: text.length } : null),
        });
    }
}

/** Every alert and dialog on screen now, the page's same-origin frames included. */
export function seenOnScreen(doc = document) {
    const found = [];
    seenIn(doc, null, found);
    for (const f of doc.querySelectorAll?.('iframe') || []) {
        let fd;
        try { fd = f.contentDocument; } catch { fd = null; }
        if (!fd) continue;
        let frame;
        try { frame = cleanUrl(f.contentWindow.location.pathname, f.contentWindow.location.href); } catch { frame = 'iframe'; }
        seenIn(fd, frame, found);
    }
    const { kept, dropped } = capList(found.slice(0, BUNDLE_CAPS.screenItems), BUNDLE_CAPS.screenAlertBytes);
    return { alerts: kept, alertsDropped: dropped + Math.max(0, found.length - BUNDLE_CAPS.screenItems) };
}

/** A shown alert that is failure evidence: an alert dialog, or an alert not
 *  marked info/success. A snackbar on screen is not judged here — the store's
 *  history records whether it was an error. */
export const isAlarming = (a) => a?.kind === 'alert' && a.severity !== 'info' && a.severity !== 'success';

// ── Failure classification (req #4159) ──────────────────────────────────────
// A Lambda-Rest LIST read that matches no rows answers `404 "NOT FOUND"`, and
// every Darwin reader (darwin-mcp's client included) takes it as `[]`. Counted
// as a failure, a plan page's empty `engine_outcomes` / `initiative_deps`
// reads turned 61 of 69 verbose blocks verbose on nothing, and hid the one
// real failure (4113) among them. So an empty list read is counted, not
// listed. It is matched on the PATH — `…/<database>/<table>` — so any gateway
// host is covered (the internal product's `/api/internal/<table>`, req #4079 /
// #4151), and it is never a single-record lookup (an `id=` filter, or
// `pipeline_compose`, which composes ONE plan): that 404 means the record the
// page asked for does not exist, which is a failure.

const DATABASE_SEGMENTS = new Set(['darwin', 'darwin_dev', PRODUCT?.opsDatabase, PRODUCT?.buildVizDatabase, userDatabase]
    .filter(Boolean));
const TABLE = /^[A-Za-z0-9_]+$/;
const SINGLE_RECORD_TABLES = new Set(['pipeline_compose']);

/** A GET 404 from a Lambda-Rest table list read — an empty result, not a failure. */
export function isEmptyListRead(e) {
    if (!e || e.status !== 404 || String(e.method || 'GET').toUpperCase() !== 'GET') return false;
    let u;
    try { u = new URL(String(e.url), 'http://localhost/'); } catch { return false; }
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length < 2) return false;
    const table = segs[segs.length - 1];
    return DATABASE_SEGMENTS.has(segs[segs.length - 2]) && TABLE.test(table)
        && !SINGLE_RECORD_TABLES.has(table) && !u.searchParams.has('id');
}

/** A request that failed: no answer (status 0), or any status ≥ 400 that is not an empty list read. */
export const isFailed = (e) => !!e && (e.status === 0 || (e.status >= 400 && !isEmptyListRead(e)));

// ── Storage, stored once (req #4159) ────────────────────────────────────────
// A median 51% of the localStorage keys a capture held are the page's view
// state, which `filedFrom.options.viewState` already records. A key whose
// stored value is EXACTLY what serializing that view-state value gives — or a
// zustand persist envelope around it — is named instead of copied, so nothing
// is lost: `expandStorage` puts every value back byte for byte.

export const VIEW_STATE_AT = 'filedFrom.options.viewState';
const STATE_SLOT = `[${VIEW_STATE_AT}]`;
const same = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };
const isEnvelope = (v) => v && typeof v === 'object' && !Array.isArray(v) && 'state' in v && 'version' in v;

function dedupeArea(area, vs) {
    if (!area?.entries || !vs) return area;
    const entries = {};
    const keys = [];
    const wrapped = {};
    for (const [k, v] of Object.entries(area.entries)) {
        if (Object.prototype.hasOwnProperty.call(vs, k)) {
            if (same(ser(vs[k]), v)) { keys.push(k); continue; }
            if (isEnvelope(v) && same(ser({ ...v, state: vs[k] }), v)) { wrapped[k] = { ...v, state: STATE_SLOT }; continue; }
        }
        entries[k] = v;
    }
    if (!keys.length && !Object.keys(wrapped).length) return area;
    return { ...area, entries, sameAsViewState: { at: VIEW_STATE_AT, keys,
        ...(Object.keys(wrapped).length ? { wrapped } : null) } };
}

/** `storage` with each value already in `filedFrom`'s view state named rather than copied. */
export function dedupeStorage(storage, filedFrom) {
    const vs = filedFrom?.options?.viewState;
    if (!storage || typeof storage !== 'object' || !vs || typeof vs !== 'object') return storage;
    return { ...storage, local: dedupeArea(storage.local, vs), session: dedupeArea(storage.session, vs) };
}

/** `storage` with every named value put back — the encoding before req #4159. */
export function expandStorage(storage, filedFrom) {
    const vs = filedFrom?.options?.viewState || {};
    const expand = (area) => {
        const ref = area?.sameAsViewState;
        if (!ref) return area;
        const { sameAsViewState, ...rest } = area;
        const entries = { ...rest.entries };
        for (const k of ref.keys || []) entries[k] = ser(vs[k]);
        for (const [k, env] of Object.entries(ref.wrapped || {})) entries[k] = ser({ ...env, state: vs[k] });
        return { ...rest, entries };
    };
    if (!storage || typeof storage !== 'object') return storage;
    return { ...storage, ...(storage.local ? { local: expand(storage.local) } : null),
        ...(storage.session ? { session: expand(storage.session) } : null) };
}

function errorText(err) {
    if (typeof err?.message === 'string') return err.message;
    const st = err?.httpStatus;
    if (st && typeof st === 'object') return `HTTP ${st.httpStatus ?? '?'}${st.httpMessage ? ` ${st.httpMessage}` : ''}`;
    try { return JSON.stringify(ser(err)); } catch { return String(err); }
}

function readProfile(profile) {
    let p = profile;
    if (!p) {
        try { p = JSON.parse(localStorage.getItem('darwin-profile') || 'null'); } catch { p = null; }
    }
    // Who filed it — never how they are authenticated.
    return p ? { id: p.id ?? null, userName: p.userName ?? null, email: p.email ?? null } : null;
}

/** When this page loaded (ms epoch) — the start of the reader's page session. */
function pageSessionStart() {
    const o = performance.timeOrigin;
    if (Number.isFinite(o) && o > 0) return Math.round(o);
    const installed = debugCaptureState()?.installedAt;
    return Number.isFinite(installed) ? installed : null;
}

const BUILDERS = {
    // Where it was filed from (filedFromContext.js), snapshotted by the caller at
    // the same press and already held under its own size cap.
    filedFrom: ({ filedFrom }) => filedFrom ?? null,
    environment: () => ({
        url: cleanUrl(location.href),
        referrer: document.referrer ? cleanUrl(document.referrer) : null,
        title: document.title.slice(0, BUNDLE_CAPS.titleMax),
        userAgent: navigator.userAgent,
        language: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        screen: window.screen ? { w: window.screen.width, h: window.screen.height } : null,
        visibility: document.visibilityState,
        hasFocus: document.hasFocus(),
        online: navigator.onLine,
        memory: performance.memory
            ? { usedJSHeap: performance.memory.usedJSHeapSize, totalJSHeap: performance.memory.totalJSHeapSize }
            : null,
        uptimeMs: Math.round(performance.now()),
        build: { commit: import.meta.env.VITE_BUILD_COMMIT || 'unknown', mode: import.meta.env.MODE },
        activeElement: describeActive(),
    }),
    identity: ({ profile }) => readProfile(profile),
    console: ({ state }) => ringCategory(state, 'console'),
    errors: ({ state }) => ringCategory(state, 'errors'),
    // Plus what was sent and never answered — a hung page's request is not in the ring.
    // Which requests are held is fixed NOW; each is encoded when the category is
    // serialized, after the failure bodies still being read have landed.
    network: ({ state, now }) => {
        const r = state?.rings?.network;
        if (!r) return { installed: false };
        const inFlight = [...(state?.inFlight ?? [])].slice(-20)
            .map(e => ({ method: e.method, url: e.url, kind: e.kind, ...(e.frame ? { frame: e.frame } : null), elapsedMs: now - e.t }));
        const dropped = r.dropped;
        const entries = typeof r.snapshot === 'function' ? r.snapshot() : (() => r.all());
        return {
            toJSON() {
                const list = entries();
                const all = networkOccurrences(list);
                return { dropped, entries: list, requests: all.length,
                    emptyListReads: all.filter(isEmptyListRead).length, inFlight };
            },
        };
    },
    screen: ({ now }) => {
        const sb = useSnackBarStore.getState() || {};
        const clip500 = (m) => { const t = typeof m === 'string' ? m : String(m ?? ''); return t.length > BUNDLE_CAPS.screenTextMax ? `${t.slice(0, BUNDLE_CAPS.screenTextMax)}…` : t; };
        return {
            snackbar: {
                open: !!sb.open,
                message: clip500(sb.message),
                history: (Array.isArray(sb.history) ? sb.history : []).map(({ t, ...h }) => ({ msBeforePress: now - t, ...h })),
            },
            ...seenOnScreen(document),
        };
    },
    resourceTiming: () => {
        // A per-type aggregate, plus only the entries worth reading: failed or slow.
        const all = performance.getEntriesByType?.('resource') || [];
        const byType = {};
        const notable = [];
        for (const r of all) {
            const a = byType[r.initiatorType] || (byType[r.initiatorType] = { count: 0, transfer: 0, maxMs: 0 });
            a.count++;
            a.transfer += r.transferSize || 0;
            a.maxMs = Math.max(a.maxMs, Math.round(r.duration));
            if ((r.responseStatus ?? 0) >= 400 || r.duration >= BUNDLE_CAPS.rtSlowMs) notable.push(r);
        }
        const recent = notable.slice(-BUNDLE_CAPS.rtKeep).reverse().map((r) => ({
            name: cleanUrl(r.name), type: r.initiatorType, start: Math.round(r.startTime),
            ms: Math.round(r.duration), transfer: r.transferSize, status: r.responseStatus ?? null,
        }));
        const { kept } = capList(recent, BUNDLE_CAPS.rtBytes);
        return { total: all.length, byType, notable: kept.reverse(), notableDropped: notable.length - kept.length };
    },
    navigation: ({ state }) => ({ ...ringCategory(state, 'navigation'), frames: state?.frames?.slice() ?? [] }),
    reactQuery: () => {
        const qs = queryClient.getQueryCache().getAll().slice().sort((a, b) =>
            Math.max(b.state.dataUpdatedAt, b.state.errorUpdatedAt) - Math.max(a.state.dataUpdatedAt, a.state.errorUpdatedAt));
        const summaries = qs.slice(0, BUNDLE_CAPS.rqQueries).map((q) => {
            const d = q.state.data;
            return bounded({
                key: ser(q.queryKey, { n: 40 }),
                status: q.state.status,
                fetchStatus: q.state.fetchStatus,
                updatedAt: q.state.dataUpdatedAt || null,
                observers: q.getObserversCount(),
                rows: Array.isArray(d) ? d.length : (d && typeof d === 'object' ? Object.keys(d).length : null),
                // A call_rest_api rejection is a plain {data, httpStatus}: its status, not "[object Object]".
                error: q.state.error ? errorText(q.state.error).slice(0, 300) : null,
                stale: q.isStale(),
            }, BUNDLE_CAPS.queryBytes);
        });
        const { kept } = capList(summaries, BUNDLE_CAPS.rqBytes);
        return { total: qs.length, dropped: qs.length - kept.length, queries: kept };
    },
    storage: () => ({ local: snapshotStorage(window.localStorage), session: snapshotStorage(window.sessionStorage) }),
    // The four zustand stores without `persist` — the persisted ones are in `storage`.
    stores: () => bounded({
        // Its message history is the `screen` category's.
        snackBar: storeState(useSnackBarStore, ['history']),
        dragTab: storeState(useDragTabStore),
        swarmTab: storeState(useSwarmTabStore),
        press: storeState(usePressStore),
    }, BUNDLE_CAPS.storesBytes),
    // The focus-loss evidence req #3632/#3652 already keeps. Losses persist
    // across reloads, so each says how long before the press it happened, and
    // one from before this page loaded is `stale` — history, not evidence
    // about what the reader is filing (req #4159: 77 of 92 captures carried
    // the same three days-old losses, unmarked).
    focus: ({ now }) => {
        const pageStart = pageSessionStart();
        const losses = capList(storedFocusLosses().slice(-5).reverse().map((l) => {
            const at = Date.parse(l?.at);
            if (!Number.isFinite(at)) return l;
            return { msBeforePress: now - at, ...(pageStart != null && at < pageStart ? { stale: true } : null), ...l };
        }), BUNDLE_CAPS.focusBytes / 2);
        const timeline = capList(focusTimeline(now - 60000).reverse()
            .map(({ t, ...e }) => ({ msBeforePress: now - t, ...e })), BUNDLE_CAPS.focusBytes / 2);
        return {
            pageSessionStart: pageStart != null ? new Date(pageStart).toISOString() : null,
            losses: losses.kept, lossesDropped: losses.dropped, timeline: timeline.kept, timelineDropped: timeline.dropped,
        };
    },
};

/** What the editor's summary says beside each category's size. */
function countNote(key, v) {
    if (!v || typeof v !== 'object') return '';
    const n = (x) => (Array.isArray(x) ? x.length : 0);
    const plus = (d) => (d ? ` (+${d} dropped)` : '');
    const of = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
    switch (key) {
    case 'filedFrom': {
        const at = pointedAtLabel(v);
        return [v.surface && String(v.surface), at && `over ${at.path.split(' > ').pop()}`].filter(Boolean).join(' · ');
    }
    case 'console': return `${of(n(v.entries), 'line')}${plus(v.dropped)}`;
    case 'errors': return `${of(n(v.entries), 'error')}${plus(v.dropped)}`;
    case 'network': {
        const all = networkOccurrences(v.entries);
        const failed = all.filter(isFailed).length;
        const empty = all.filter(isEmptyListRead).length;
        return `${of(all.length, 'request')}${all.length !== n(v.entries) ? ` in ${of(n(v.entries), 'entry', 'entries')}` : ''}`
            + `, ${failed} failed${empty ? `, ${of(empty, 'empty list read')}` : ''}`
            + `${n(v.inFlight) ? `, ${n(v.inFlight)} pending` : ''}${plus(v.dropped)}`;
    }
    case 'screen': {
        const hist = v.snackbar?.history || [];
        const errs = hist.filter((h) => h.kind === 'error').length;
        return [`${of(hist.length, 'snackbar message')}${errs ? ` (${errs} error${errs === 1 ? '' : 's'})` : ''}`,
            `${of(n(v.alerts), 'alert/dialog', 'alerts/dialogs')} shown`].join(', ');
    }
    case 'resourceTiming': return `${of(v.total ?? 0, 'entry', 'entries')}, ${n(v.notable)} failed/slow`;
    case 'navigation': return `${of(n(v.entries), 'change')}`;
    case 'reactQuery': return `${of(v.total ?? 0, 'query', 'queries')}`;
    case 'storage': {
        // Keys stored once against the view state are still captured keys.
        const named = (a) => (a?.sameAsViewState?.keys?.length || 0) + Object.keys(a?.sameAsViewState?.wrapped || {}).length;
        const inVs = named(v.local) + named(v.session);
        const keys = Object.keys(v.local?.entries || {}).length + Object.keys(v.session?.entries || {}).length + inVs;
        return `${of(keys, 'key')}${inVs ? ` (${inVs} in view state)` : ''}`
            + `, ${of((v.local?.droppedKeys?.count || 0) + (v.session?.droppedKeys?.count || 0), 'credential key')} dropped`;
    }
    case 'focus': {
        const stale = (v.losses || []).filter((l) => l?.stale).length;
        return `${of(n(v.losses), 'loss', 'losses')}${stale ? ` (${stale} stale)` : ''}, ${of(n(v.timeline), 'event')}`;
    }
    default: return '';
    }
}

/** Text the block carries never holds the block's own grammar (a filer over a
 *  description holding a Debug capture block would nest a fake one): no
 *  marker, no v1 pointer line, and no other requirement's bundle URI. */
const blockSafe = (s) => oneLine(s).replace(/-{3,}/g, '—').replace(/Debug capture:/gi, 'Debug capture -')
    .replace(/darwin:\/\/requirement-debug\//gi, 'requirement-debug/');

/** What a floating filer pointed at, as the block names it (req #3829): the
 *  centre's element by its testid path (outermost first) or tag, its text, and
 *  how many more the bundle holds — null when it pointed at nothing. An OBJECT
 *  a canvas resolved (req #4158) is named by kind, id and title, its canvas
 *  after it — `epic #385 "Login Credentials" (pipeline-plan-visualizer)` —
 *  with no text: its title is the text. A specific child of a large container
 *  is named in that container. */
export function pointedAtLabel(filedFrom) {
    const all = Array.isArray(filedFrom?.pointedAt) ? filedFrom.pointedAt : [];
    const p = all[0];
    if (!p) return null;
    const more = all.length - 1 + (filedFrom.pointedAtOmitted || 0);
    const testids = Array.isArray(p.testidPath) ? p.testidPath : [];
    if (p.object && p.object.kind && p.object.id != null) {
        const where = p.host || p.within || testids[0] || p.tag || '?';
        return { path: blockSafe(`${objectLabel(p.object)} (${where})`), text: '', more, object: true };
    }
    const path = testids.length ? [...testids].reverse().join(' > ') : (p.tag || '?');
    const text = p.text ? blockSafe(p.text) : '';
    if (p.specific) {
        return { path: `${p.specific.kind || p.specific.tag || '?'} in ${path}`, text, more };
    }
    return { path, text, more };
}

/** The block's location line about the RECORDS (req #4158): the subjects the
 *  page's address names, titled, and the database their ids belong to — or,
 *  with none, the database alone. Null with neither. */
export function subjectLine(filedFrom) {
    const subjects = Array.isArray(filedFrom?.subject) ? filedFrom.subject : [];
    const db = filedFrom?.state?.database ?? null;
    const dbBacked = subjects.filter((x) => x.database);
    const notes = [...new Set(dbBacked.map((x) => x.database))].map(databaseNote).filter(Boolean);
    if (!subjects.length) {
        const note = databaseNote(db);
        return note ? `Database: ${note}` : null;
    }
    const names = subjects.map((x) => `${subjectLabel(x)}${x.database ? '' : ' (not in a database)'}`);
    return clip(blockSafe(`Subject: ${names.join(' · ')}${notes.length ? ` — ${notes.join('; ')}` : ''}`));
}

const utf8 = (s) => new TextEncoder().encode(s).length;
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The debug capture, NOW. Every category is snapshotted SYNCHRONOUSLY when this
 * is called — call it at the press, before the editor opens (the editor is not
 * the subject). The ring entries are live objects, so a failure body still being
 * read lands when it resolves; the promise waits for those ≤ 250 ms, then
 * serializes and redacts each category.
 *
 * @returns {Promise<{version, capturedAt, categories: Array<{key, label, text,
 *   bytes, note}>, jwtHits, buildMs}>}
 */
export async function buildDebugCapture({ profile = null, state = debugCaptureState(), filedFrom = null } = {}) {
    const t0 = performance.now();
    const now = Date.now();
    const capturedAt = new Date(now).toISOString();
    const values = {};
    for (const { key } of DEBUG_CATEGORIES) {
        try { values[key] = BUILDERS[key]({ profile, state, filedFrom, now }); } catch (e) { values[key] = { captureError: String(e?.message || e) }; }
    }
    try { values.storage = dedupeStorage(values.storage, values.filedFrom); } catch { /* kept whole */ }
    const syncMs = performance.now() - t0;
    if (state?.pendingBodies?.size) {
        await Promise.race([Promise.allSettled([...state.pendingBodies]), settle(DEBUG_CAPTURE_CAPS.failBodyWaitMs)]);
    }
    const t1 = performance.now();
    let jwtHits = 0;
    const categories = DEBUG_CATEGORIES.map(({ key, label }) => {
        let raw;
        try { raw = JSON.stringify(values[key] ?? null); } catch (e) { raw = JSON.stringify({ captureError: String(e?.message || e) }); }
        const { text, hits } = scrubJwt(raw);
        jwtHits += hits;
        let note = '';
        try { note = countNote(key, JSON.parse(text)); } catch { /* */ }
        return { key, label, text, bytes: utf8(text), note };
    });
    return {
        version: DEBUG_CAPTURE_VERSION, capturedAt, categories, jwtHits,
        buildMs: Math.round((syncMs + performance.now() - t1) * 10) / 10,
    };
}

/** The storage category's text standing alone: with `filedFrom` dropped, the
 *  values it named in the view state are copied back in. */
function inlineStorage(capture, text) {
    try {
        const storage = JSON.parse(text);
        if (!storage?.local?.sameAsViewState && !storage?.session?.sameAsViewState) return text;
        const filedFrom = JSON.parse(capture.categories.find((c) => c.key === 'filedFrom')?.text ?? 'null');
        return JSON.stringify(expandStorage(storage, filedFrom));
    } catch { return text; }
}

/** The bundle as stored: its `summary` index FIRST (req #4160), then the kept
 *  categories' redacted text, and the ones the reader dropped named. The index
 *  only points into the bundle; nothing is left out for it. `{ text, bytes }`. */
export function assembleBundle(capture, dropped = []) {
    const drop = new Set(dropped);
    let summary;
    try { summary = buildSummary(capture, dropped); } catch (e) { summary = { captureError: String(e?.message || e) }; }
    const head = {
        summary,
        capture: 'darwin debug capture (req #3815)',
        version: capture.version,
        capturedAt: capture.capturedAt,
        dropped: capture.categories.filter((c) => drop.has(c.key)).map((c) => c.key),
        jwtRedacted: capture.jwtHits,
    };
    const body = capture.categories.filter((c) => !drop.has(c.key))
        .map((c) => `${JSON.stringify(c.key)}:${c.key === 'storage' && drop.has('filedFrom') ? inlineStorage(capture, c.text) : c.text}`);
    const raw = `${JSON.stringify(head).slice(0, -1)}${body.length ? `,${body.join(',')}` : ''}}`;
    // Every category was scrubbed already; once more over the whole, for free.
    const { text } = scrubJwt(raw);
    return { text, bytes: utf8(text) };
}

/** Bytes as the editor and the block show them. */
export function formatBytes(n) {
    if (n < 1000) return `${n} B`;
    return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, max = BUNDLE_CAPS.blockLineMax) => (s.length > max ? `${s.slice(0, max)}…` : s);
const pathOf = (url) => { try { const u = new URL(url); return `${u.host}${u.pathname}${u.search}`; } catch { return String(url); } };
const argText = (a) => (typeof a === 'string' ? a : JSON.stringify(a));
/** A URL as the index names it: its last two path segments — `…/darwin/epics`. */
const tailOf = (url) => {
    let p;
    try { p = new URL(url, 'http://localhost/').pathname; } catch { p = String(url).split('?')[0]; }
    const segs = p.split('/').filter(Boolean);
    return segs.length > 2 ? `…/${segs.slice(-2).join('/')}` : `/${segs.join('/')}`;
};
/** `ms` as the block says an age: `12 s`, `4 min`, `3 h`. */
const ago = (ms) => {
    if (!Number.isFinite(ms)) return 'some time';
    const sec = Math.max(0, Math.round(ms / 1000));
    if (sec < 120) return `${sec} s`;
    const min = Math.round(sec / 60);
    return min < 120 ? `${min} min` : `${Math.round(min / 60)} h`;
};

// ── What went wrong, each where the bundle holds it whole (req #4160) ───────
// ONE classifier feeds the block's verbatim lines and the bundle index's
// `anomalies` / `whereToLook`, so the two can never disagree about what failed.

/** `{ kind, header, why, items: [{ path, text }] }` per kind of anomaly, plus
 *  the empty list reads (counted, never anomalies). Every item names the bundle
 *  path holding it whole: `errors.entries[0]`, `network.entries[41]` … */
export function captureAnomalies(cats) {
    const groups = [];
    // `count` is how many of the kind there were — an item may stand for several (`n`).
    const group = (kind, header, items) => {
        if (items.length) groups.push({ kind, header, items, count: items.reduce((t, it) => t + (it.n || 1), 0) });
    };
    group('errors', 'Uncaught errors', (cats.errors?.entries || []).map((e, i) => ({
        path: `errors.entries[${i}]`,
        text: e?.kind === 'resource'
            ? `[resource] <${e.tag}> failed to load ${e.src}`
            : `[${e?.kind}] ${argText(e?.message)}${e?.source ? ` — ${pathOf(e.source)}:${e.line}:${e.col}` : ''}`,
    })));
    // What the reader saw: a snackbar error and a shown alert are failure
    // evidence exactly like an uncaught error (req #4159). An alert repeating
    // a snackbar message is the snackbar itself, still open.
    const history = cats.screen?.snackbar?.history || [];
    const snackErrors = history.map((h, i) => [h, i]).filter(([h]) => h?.kind === 'error');
    const seen = snackErrors.map(([h, i]) => ({ path: `screen.snackbar.history[${i}]`,
        text: `snackbar error, ${ago(h.msBeforePress)} before the press: ${h.message}` }));
    (cats.screen?.alerts || []).forEach((a, i) => {
        if (!isAlarming(a) || snackErrors.some(([h]) => h.message && a.text.includes(oneLine(h.message)))) return;
        seen.push({ path: `screen.alerts[${i}]`,
            text: `${a.role}${a.severity ? ` (${a.severity})` : ''}${a.testid ? ` ${a.testid}` : ''}: ${a.text}` });
    });
    group('seen', 'What the user saw', seen);
    // A grouped GET entry holds every occurrence; the failing one may be earlier than its latest.
    const failed = [];
    (cats.network?.entries || []).forEach((e, i) => {
        const occ = networkOccurrences([e]);
        occ.forEach((o, k) => { if (isFailed(o)) failed.push({ o, i, nth: k + 1, of: occ.length }); });
    });
    failed.sort((a, b) => ((a.o.t ?? 0) + (a.o.ms ?? 0)) - ((b.o.t ?? 0) + (b.o.ms ?? 0)));
    // One entry's occurrences that failed ALIKE (same status and answer) are one line: the
    // request, status and answer verbatim, how many, and their durations' range.
    const merged = new Map();
    for (const f of failed) {
        const r = f.o;
        const k = `${f.i}|${r.status}|${r.failBody ?? ''}|${r.error ?? ''}`;
        const m = merged.get(k) || { ...f, nths: [], ms: [] };
        m.nths.push(f.nth);
        if (r.ms != null) m.ms.push(r.ms);
        merged.delete(k);
        merged.set(k, m);
    }
    group('requests', 'Failed requests', [...merged.values()].map(({ o: r, i, of, nths, ms }) => {
        const n = nths.length;
        const which = of > 1 ? (n > 1 ? ` [${n} of ${of} occurrences]` : ` [occurrence ${nths[0]} of ${of}]`) : '';
        const took = n > 1 ? (ms.length ? ` (${Math.min(...ms)}–${Math.max(...ms)} ms)` : '') : (r.ms != null ? ` (${r.ms} ms)` : '');
        return {
            path: `network.entries[${i}]`,
            n,
            // The index names it short — the query and the body are the entry's.
            why: `${r.method} ${tailOf(r.url)} → ${r.status}${of > 1 ? (n > 1 ? ` [${n} of ${of} occurrences]` : ` [occurrence ${nths[0]} of ${of}]`) : ''}`,
            text: `${r.method} ${pathOf(r.url)} → ${r.status}${took}`
                + (r.failBody ? ` ${JSON.stringify(oneLine(r.failBody).slice(0, 200))}` : (r.error ? ` ${r.error}` : ''))
                + which,
        };
    }));
    group('pending', 'Still pending at the press', (cats.network?.inFlight || []).map((r, i) => ({
        path: `network.inFlight[${i}]`, text: `${r.method} ${pathOf(r.url)} — ${r.elapsedMs} ms without an answer`,
    })));
    const consoleBad = [];
    (cats.console?.entries || []).forEach((c, i) => {
        if (c?.level === 'error' || c?.level === 'warn') {
            consoleBad.push({ path: `console.entries[${i}]`, text: `console.${c.level}: ${(c.args || []).map(argText).join(' ')}` });
        }
    });
    group('console', 'Console errors and warnings', consoleBad);
    const emptyReads = networkOccurrences(cats.network?.entries).filter(isEmptyListRead).length;
    return { groups, emptyReads };
}

/** `items` with identical texts merged, in order of their LAST occurrence:
 *  `[{ text, why, n, paths }]` — `paths` oldest first. */
function alike(items) {
    const by = new Map();
    for (const it of items) {
        const x = by.get(it.text) || { text: it.text, why: it.why, n: 0, paths: [] };
        x.n++;
        x.paths.push(it.path);
        by.delete(it.text);
        by.set(it.text, x);
    }
    return [...by.values()];
}

/** The anomalies as the block (and the index) quote them: a header per kind,
 *  its last ≤ 5 lines verbatim, ≤ 2 KB of lines together — the rest counted. */
function anomalyLines(an) {
    const lines = [];
    for (const g of an.groups) {
        lines.push(`${g.header} (${g.count}):`);
        // Identical lines once, counted: the bundle keeps every one.
        for (const { text, n } of alike(g.items).slice(-BUNDLE_CAPS.blockLines)) {
            lines.push(`- ${clip(blockSafe(text))}${n > 1 ? ` (×${n})` : ''}`);
        }
    }
    // Counted once, and only beside something that did go wrong: on its own an
    // empty read is not an anomaly.
    if (lines.length && an.emptyReads) lines.push(`Empty list reads: ${an.emptyReads} (GET 404 = no rows; not failures)`);
    // Every kind keeps at least its first line (each ≤ blockLineMax), so no header stands empty.
    const kept = [];
    let total = 0;
    let cut = 0;
    let first = false;
    for (const l of lines) {
        if (!l.startsWith('- ')) { kept.push(l); first = true; continue; }
        if (!first && total + l.length + 1 > BUNDLE_CAPS.blockDetailBytes) { cut++; continue; }
        first = false;
        kept.push(l);
        total += l.length + 1;
    }
    if (cut) kept.push(`(${cut} more lines in the bundle)`);
    return kept;
}

/** Whether a capture was given nothing to keep — then nothing is saved. */
export const keepsNothing = (capture, dropped) =>
    !!capture && capture.categories.every((c) => (dropped || []).includes(c.key));

/** The dropped categories by name, in bundle order. */
const droppedKeys = (drop) => DEBUG_CATEGORIES.map((c) => c.key).filter((k) => drop.has(k));

function keptCategories(capture, dropped) {
    const drop = new Set(dropped || []);
    const kept = capture.categories.filter((c) => !drop.has(c.key));
    const cats = {};
    for (const c of kept) { try { cats[c.key] = JSON.parse(c.text); } catch { /* */ } }
    return { drop, kept, cats };
}

/** `Pointed at:`'s text: the object or element, its text quoted, the rest counted. */
function pointedAtText(at) {
    if (!at) return null;
    // Its innermost two testids — the ones a session searches the code for; the whole path is the
    // bundle's. A canvas OBJECT's label is a title, never a testid path: kept whole.
    const m = /^(.+? in )?(.*)$/.exec(at.path);
    const segs = m[2].split(' > ');
    const path = at.object ? at.path : `${m[1] || ''}${segs.length > 2 ? `… > ${segs.slice(-2).join(' > ')}` : m[2]}`;
    return clip(`${path}${at.text ? ` "${clip(at.text, BUNDLE_CAPS.pointedTextMax)}"` : ''}`)
        + (at.more ? ` (+${at.more} more in the bundle)` : '');
}

/** The URL line only when it says something the surface does not — another path, a hash,
 *  or a query parameter the surface lacks (they matched on 80 of 92; a surface that only
 *  ADDS page state, `?mode=plan&level=3` over `?mode=plan`, already says it all). */
function urlBeyondSurface(where) {
    const full = where?.url?.full;
    if (!full || full === where.surface) return null;
    let u;
    let sf;
    try { u = new URL(full, 'http://x/'); sf = new URL(String(where.surface ?? ''), 'http://x/'); } catch { return full; }
    if (u.pathname !== sf.pathname || u.hash) return full;
    for (const [k, v] of u.searchParams) if (!sf.searchParams.getAll(k).includes(v)) return full;
    return null;
}

/** The index's `whereToLook`: at most this many paths, the rest counted, each `why` ≤ WHY_MAX chars. */
export const WHERE_TO_LOOK_MAX = 12;
const WHY_MAX = 60;

/**
 * The bundle INDEX (req #4160) — the stored JSON's first key, `summary`. It
 * points INTO the bundle and replaces nothing: `mode` (`broken` when anything
 * went wrong, else `improve`), where and what (surface, subject, pointedAt),
 * the anomalies as the block quotes them, `whereToLook` — `<path> <what>` for
 * THIS capture's relevant entries (`network.entries[41] DELETE …/epics → 500`),
 * which `scripts/debug/read-capture.py --entry <path>` / `--look` return
 * verbatim — and what every kept category holds.
 */
export function buildSummary(capture, dropped = []) {
    const { drop, kept, cats } = keptCategories(capture, dropped);
    const where = cats.filedFrom;
    const an = captureAnomalies(cats);
    const at = pointedAtLabel(where);
    const look = [];
    const seenPath = new Set();
    // `<path> <what>`: the path first, so `read-capture.py --look` fetches it whole.
    const add = (path, why, suffix = '') => {
        if (!seenPath.has(path)) { seenPath.add(path); look.push(`${path} ${clip(blockSafe(why), WHY_MAX)}${suffix}`); }
    };
    // Alike entries are named once, by their first path, with how many more there are.
    for (const g of an.groups) {
        // Clipped first, so the count is never cut off.
        for (const x of alike(g.items)) add(x.paths[0], x.why ?? x.text, x.n > 1 ? ` (+${x.n - 1} alike)` : '');
    }
    if (at) add('filedFrom.pointedAt[0]', 'the element the user pointed at: rect, frame, text, field');
    if (Array.isArray(where?.subject) && where.subject.length) add('filedFrom.subject', 'the page\'s record(s), titled, and their database');
    if (where?.options) add('filedFrom.options', 'page state the URL cannot say (view state, open popups)');
    const build = cats.environment?.build;
    return {
        readMe: `An index: nothing is left out of the bundle. Fetch what bears on the requirement, verbatim, with ${READ_CAPTURE}: `
            + '--look (every whereToLook path), --entry <path>, --section <category>, --status/--method/--level/--window/--grep.',
        mode: an.groups.length ? 'broken' : 'improve',
        surface: where?.surface ?? null,
        ...(urlBeyondSurface(where) ? { url: urlBeyondSurface(where) } : null),
        subject: Array.isArray(where?.subject) ? where.subject.map(({ kind, id, title, database }) => ({ kind, id, title, database: database ?? null })) : [],
        pointedAt: pointedAtText(at),
        anomalies: anomalyLines(an),
        counts: Object.fromEntries([...an.groups.map((g) => [g.kind, g.count]), ['emptyListReads', an.emptyReads]]),
        whereToLook: look.slice(0, WHERE_TO_LOOK_MAX),
        ...(look.length > WHERE_TO_LOOK_MAX ? { whereToLookMore: look.length - WHERE_TO_LOOK_MAX } : null),
        categories: Object.fromEntries(kept.map((c) => [c.key, `${formatBytes(c.bytes)}${c.note ? ` · ${c.note}` : ''}`])),
        dropped: droppedKeys(drop),
        capturedAt: capture.capturedAt,
        ...(build ? { build: `${build.commit} (${build.mode})` } : null),
    };
}

/**
 * The description's `Debug capture` block (v2, req #4160) for `capture` saved
 * as requirement `requirementId` with `dropped` left out — written for the
 * session that reads it, in this order: what this is and what to do with it;
 * WHERE (`Surface:` — a /devops-devserver-start deep link — the `Subject:`
 * records and their database, `URL:` only when it differs from the surface);
 * WHAT (`Pointed at:`, when the pinned filer pointed at something, req #3829 /
 * #4158); the ANOMALIES verbatim, only when something went wrong (uncaught
 * errors, what the reader saw, failed or pending requests, console errors and
 * warnings — ≤ 5 of each, ≤ 2 KB; never an empty list read); and one line
 * naming the bundle, its size and the helper that reads it. Per-category sizes
 * and the capture time are the editor's Details view and the bundle index's.
 * A capture lost to a reload (null) still says where its row is.
 */
export function formatDebugBlock(capture, dropped, requirementId) {
    const read = `python3 ${READ_CAPTURE} ${requirementId}`;
    if (!capture) {
        return [DEBUG_BLOCK_BEGIN, `Bundle (if one was saved): ${debugCaptureUri(requirementId)} — index first: ${read}`, DEBUG_BLOCK_END].join('\n');
    }
    const { drop, cats } = keptCategories(capture, dropped);
    const where = cats.filedFrom;
    const at = pointedAtLabel(where);
    const anomalies = anomalyLines(captureAnomalies(cats));
    const what = [where && 'the page', at && 'the element pointed at', 'the bundle'].filter(Boolean);
    const lines = [DEBUG_BLOCK_BEGIN,
        `Filed with the Requirement Filer — start from ${what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what.at(-1)}` : what[0]}`
            + `${anomalies.length ? ', and what went wrong (verbatim)' : ''}.`];
    const body = [];
    if (where?.surface) body.push(`Surface: ${where.surface}`);
    const subject = subjectLine(where);
    if (subject) body.push(subject);
    if (urlBeyondSurface(where)) body.push(`URL: ${urlBeyondSurface(where)}`);
    if (at) body.push(`Pointed at: ${pointedAtText(at)}`);
    body.push(...anomalies);
    // Every line from the page passes blockSafe: nothing it holds can forge the grammar.
    lines.push(...body.map(blockSafe));
    const gone = droppedKeys(drop);
    lines.push(`Bundle: ${debugCaptureUri(requirementId)} · ${formatBytes(assembleBundle(capture, dropped).bytes)}`
        + ` (network, console, navigation, page state${gone.length ? `; dropped before save: ${gone.join(', ')}` : ''})`
        + ` — index first: ${read}`);
    lines.push(DEBUG_BLOCK_END);
    return scrubJwt(lines.join('\n')).text;
}

/** `text` carrying `block` once: the Debug capture block already there, of any
 *  version (v1 included), is replaced in place (a retried save), otherwise the
 *  block is appended below. */
export function withDebugBlock(text, block) {
    const s = String(text ?? '');
    // The LAST marker with an end after it is the block (the filer appends it): a marker
    // the user typed or pasted above it is their text, never replaced.
    let begin = -1;
    let end = -1;
    for (const m of s.matchAll(new RegExp(ANY_BLOCK_BEGIN.source, 'g'))) {
        const e = s.indexOf(DEBUG_BLOCK_END, m.index);
        if (e >= 0) { begin = m.index; end = e; }
    }
    if (begin >= 0 && end >= 0) return `${s.slice(0, begin)}${block}${s.slice(end + DEBUG_BLOCK_END.length)}`;
    return s.trim() === '' ? block : `${s.replace(/\s+$/, '')}\n\n${block}`;
}
