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
// the description: the bundle is 7.5-44.4 KB on real pages and ~254 K chars at
// the caps, and the description rides into every MCP live-work read. A worker
// reads the block in the description and pulls the bundle by id —
// `darwin://requirement-debug/<requirement id>`.
//
// NEVER A CREDENTIAL. Cookies, headers and request bodies are never read
// (debugCapture.js); storage keys that look like credentials are dropped whole;
// every URL has its credential parameters redacted; and every category's
// serialized text is scrubbed of anything token-shaped, counting the hits.

import { PROXY_AUTH } from '../config/product';
import { queryClient } from '../QueryClient/QueryClientSetup';
import { usePressStore } from '../dnd/pressStore';
import { useDragTabStore } from '../stores/useDragTabStore';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { bounded, capList, cleanUrl, debugCaptureState, DEBUG_CAPTURE_CAPS, ser } from '../utils/debugCapture';
import { focusTimeline, storedFocusLosses } from '../utils/focusLossRecorder';
import { objectLabel } from './filerPointResolvers';
import { databaseNote, subjectLabel } from './filerSubject';

export const DEBUG_CAPTURE_VERSION = 1;
export const DEBUG_BLOCK_BEGIN = `--- Debug capture v${DEBUG_CAPTURE_VERSION} (req #3815) ---`;
export const DEBUG_BLOCK_END = '--- end Debug capture ---';
/** Where a worker reads the full bundle. */
export const debugCaptureUri = (requirementId) => `darwin://requirement-debug/${requirementId}`;

const KB = 1024;
/** The caps the rings do not already enforce (design § Caps and windows). */
export const BUNDLE_CAPS = Object.freeze({
    rtKeep: 100, rtSlowMs: 1000, rtBytes: 16 * KB,
    rqQueries: 200, queryBytes: 512, rqBytes: 32 * KB,
    storageValueBytes: 2 * KB, storageBytes: 16 * KB, keyMax: 200, namesMax: 50,
    titleMax: 200, testidPath: 20,
    storesBytes: 4 * KB, focusBytes: 8 * KB,
    // The description block's verbatim lines: at most 5 of each kind, ≤ 2 KB together.
    blockLines: 5, blockLineMax: 400, blockDetailBytes: 2 * KB,
});

/** The categories, in bundle order. `label` is what the editor shows. */
export const DEBUG_CATEGORIES = Object.freeze([
    { key: 'filedFrom', label: 'Filed from' },
    { key: 'environment', label: 'Environment' },
    { key: 'identity', label: 'Identity' },
    { key: 'console', label: 'Console' },
    { key: 'errors', label: 'Errors' },
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

/** A store's state without its actions. */
function storeState(store) {
    const out = {};
    for (const [k, v] of Object.entries(store.getState() || {})) {
        if (typeof v !== 'function') out[k] = v;
    }
    return ser(out);
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
    network: ({ state }) => {
        const now = Date.now();
        const inFlight = [...(state?.inFlight ?? [])].slice(-20)
            .map(e => ({ method: e.method, url: e.url, kind: e.kind, ...(e.frame ? { frame: e.frame } : null), elapsedMs: now - e.t }));
        return { ...ringCategory(state, 'network'), inFlight };
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
        snackBar: storeState(useSnackBarStore),
        dragTab: storeState(useDragTabStore),
        swarmTab: storeState(useSwarmTabStore),
        press: storeState(usePressStore),
    }, BUNDLE_CAPS.storesBytes),
    // The focus-loss evidence req #3632/#3652 already keeps.
    focus: () => {
        const now = Date.now();
        const losses = capList(storedFocusLosses().slice(-5).reverse(), BUNDLE_CAPS.focusBytes / 2);
        const timeline = capList(focusTimeline(now - 60000).reverse()
            .map(({ t, ...e }) => ({ msAgo: now - t, ...e })), BUNDLE_CAPS.focusBytes / 2);
        return { losses: losses.kept, lossesDropped: losses.dropped, timeline: timeline.kept, timelineDropped: timeline.dropped };
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
        const failed = (v.entries || []).filter(isFailed).length;
        return `${of(n(v.entries), 'request')}, ${failed} failed${n(v.inFlight) ? `, ${n(v.inFlight)} pending` : ''}${plus(v.dropped)}`;
    }
    case 'resourceTiming': return `${of(v.total ?? 0, 'entry', 'entries')}, ${n(v.notable)} failed/slow`;
    case 'navigation': return `${of(n(v.entries), 'change')}`;
    case 'reactQuery': return `${of(v.total ?? 0, 'query', 'queries')}`;
    case 'storage': return `${of(Object.keys(v.local?.entries || {}).length + Object.keys(v.session?.entries || {}).length, 'key')}`
        + `, ${of((v.local?.droppedKeys?.count || 0) + (v.session?.droppedKeys?.count || 0), 'credential key')} dropped`;
    case 'focus': return `${of(n(v.losses), 'loss', 'losses')}, ${of(n(v.timeline), 'event')}`;
    default: return '';
    }
}

/** Text the block carries never holds the block's own grammar (a filer over a
 *  description holding a Debug capture block would nest a fake one). */
const blockSafe = (s) => oneLine(s).replace(/-{3,}/g, '—').replace(/Debug capture:/gi, 'Debug capture -');

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
        return { path: blockSafe(`${objectLabel(p.object)} (${where})`), text: '', more };
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

const isFailed = (e) => e && (e.status === 0 || e.status >= 400);
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
    const capturedAt = new Date().toISOString();
    const values = {};
    for (const { key } of DEBUG_CATEGORIES) {
        try { values[key] = BUILDERS[key]({ profile, state, filedFrom }); } catch (e) { values[key] = { captureError: String(e?.message || e) }; }
    }
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

/** The bundle as stored: the kept categories' redacted text, and the ones the
 *  reader dropped named. `{ text, bytes }`. */
export function assembleBundle(capture, dropped = []) {
    const drop = new Set(dropped);
    const head = {
        capture: 'darwin debug capture (req #3815)',
        version: capture.version,
        capturedAt: capture.capturedAt,
        dropped: capture.categories.filter((c) => drop.has(c.key)).map((c) => c.key),
        jwtRedacted: capture.jwtHits,
    };
    const body = capture.categories.filter((c) => !drop.has(c.key))
        .map((c) => `${JSON.stringify(c.key)}:${c.text}`);
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

/** The verbatim lines a worker should not need the bundle for. */
function detailLines(cats) {
    const lines = [];
    const errors = (cats.errors?.entries || []).slice(-BUNDLE_CAPS.blockLines);
    if (errors.length) {
        lines.push(`Uncaught errors (${cats.errors.entries.length}):`);
        for (const e of errors) {
            lines.push(`- ${clip(oneLine(e.kind === 'resource'
                ? `[resource] <${e.tag}> failed to load ${e.src}`
                : `[${e.kind}] ${argText(e.message)}${e.source ? ` — ${pathOf(e.source)}:${e.line}:${e.col}` : ''}`))}`);
        }
    }
    const failed = (cats.network?.entries || []).filter(isFailed);
    if (failed.length) {
        lines.push(`Failed requests (${failed.length}):`);
        for (const r of failed.slice(-BUNDLE_CAPS.blockLines)) {
            const why = r.failBody ? ` ${JSON.stringify(oneLine(r.failBody).slice(0, 200))}` : (r.error ? ` ${r.error}` : '');
            lines.push(`- ${clip(oneLine(`${r.method} ${pathOf(r.url)} → ${r.status}${r.ms != null ? ` (${r.ms} ms)` : ''}${why}`))}`);
        }
    }
    const pending = cats.network?.inFlight || [];
    if (pending.length) {
        lines.push(`Still pending at the press (${pending.length}):`);
        for (const r of pending.slice(-BUNDLE_CAPS.blockLines)) {
            lines.push(`- ${clip(oneLine(`${r.method} ${pathOf(r.url)} — ${r.elapsedMs} ms without an answer`))}`);
        }
    }
    const consoleErrors = (cats.console?.entries || []).filter((c) => c.level === 'error' || c.level === 'warn');
    if (consoleErrors.length) {
        lines.push(`Console errors and warnings (${consoleErrors.length}):`);
        for (const c of consoleErrors.slice(-BUNDLE_CAPS.blockLines)) {
            lines.push(`- ${clip(oneLine(`console.${c.level}: ${(c.args || []).map(argText).join(' ')}`))}`);
        }
    }
    // ≤ 2 KB together: the headers stay, the lines that do not fit are counted.
    const kept = [];
    let total = 0;
    let cut = 0;
    for (const l of lines) {
        if (!l.startsWith('- ')) { kept.push(l); continue; }
        if (total + l.length + 1 > BUNDLE_CAPS.blockDetailBytes) { cut++; continue; }
        kept.push(l);
        total += l.length + 1;
    }
    if (cut) kept.push(`(${cut} more lines in the bundle)`);
    return kept;
}

/** Whether a capture was given nothing to keep — then nothing is saved. */
export const keepsNothing = (capture, dropped) =>
    !!capture && capture.categories.every((c) => (dropped || []).includes(c.key));

/**
 * The description's `Debug capture` block for `capture` saved as requirement
 * `requirementId` with `dropped` left out. It always says WHERE it was filed —
 * `Surface:` (a /devops-devserver-start deep link) and `URL:`, from the kept
 * `filedFrom` category, plus `Pointed at:` when the filer floated over an
 * element (req #3829) — and where the bundle is. When something went wrong
 * (uncaught errors, failed or pending requests, console errors and warnings) it
 * adds the counts and sizes per category and those lines verbatim (≤ 5 of each,
 * ≤ 2 KB together); otherwise it stops there, so a plain requirement reads as
 * one always did (req #3818). A capture lost to a reload (null) still says
 * where its row is.
 */
export function formatDebugBlock(capture, dropped, requirementId) {
    const pointer = `Debug capture: ${debugCaptureUri(requirementId)}`;
    if (!capture) return [DEBUG_BLOCK_BEGIN, pointer, DEBUG_BLOCK_END].join('\n');
    const drop = new Set(dropped || []);
    const kept = capture.categories.filter((c) => !drop.has(c.key));
    const cats = {};
    for (const c of kept) { try { cats[c.key] = JSON.parse(c.text); } catch { /* */ } }
    const where = cats.filedFrom;
    const lines = [DEBUG_BLOCK_BEGIN];
    if (where?.surface) lines.push(`Surface: ${where.surface}`);
    const subject = subjectLine(where);
    if (subject) lines.push(subject);
    if (where?.url?.full) lines.push(`URL: ${where.url.full}`);
    const at = pointedAtLabel(where);
    if (at) {
        lines.push(clip(`Pointed at: ${at.path}${at.text ? ` "${at.text}"` : ''}`)
            + (at.more ? ` (+${at.more} more in the bundle)` : ''));
    }
    lines.push(pointer);
    const detail = detailLines(cats);
    if (detail.length) {
        const build = cats.environment?.build;
        lines.push(
            `Captured at: ${capture.capturedAt} · ${formatBytes(assembleBundle(capture, dropped).bytes)}`
                + (build ? ` · build ${build.commit} (${build.mode})` : ''),
            `Categories: ${kept.map((c) => `${c.key} ${formatBytes(c.bytes)}${c.note ? ` (${c.note})` : ''}`).join(' · ') || 'none'}`,
        );
        if (drop.size) lines.push(`Dropped before save: ${capture.categories.filter((c) => drop.has(c.key)).map((c) => c.key).join(', ')}`);
        if (capture.jwtHits) lines.push(`Redacted: ${capture.jwtHits} token-shaped value${capture.jwtHits === 1 ? '' : 's'}`);
        lines.push(...detail);
    }
    lines.push(DEBUG_BLOCK_END);
    return scrubJwt(lines.join('\n')).text;
}

/** `text` carrying `block` once: an earlier Debug capture block is replaced in
 *  place (a retried save), otherwise the block is appended below. */
export function withDebugBlock(text, block) {
    const s = String(text ?? '');
    const begin = s.indexOf(DEBUG_BLOCK_BEGIN);
    const end = begin < 0 ? -1 : s.indexOf(DEBUG_BLOCK_END, begin);
    if (begin >= 0 && end >= 0) return `${s.slice(0, begin)}${block}${s.slice(end + DEBUG_BLOCK_END.length)}`;
    return s.trim() === '' ? block : `${s.replace(/\s+$/, '')}\n\n${block}`;
}
