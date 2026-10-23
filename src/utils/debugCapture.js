// debugCapture.js — the always-on buffers behind the Requirement Filer's debug
// capture (req #3815). Design, caps, redaction and the measurements behind them:
// memory/action-popup-requirement-filer.md (req #3814).
//
// ── WHY IT INSTALLS ON IMPORT ──────────────────────────────────────────────
// A console cannot be read after the fact: whatever is not recorded from boot
// does not exist when the reader opens a requirement. So this module installs itself as
// a SIDE EFFECT OF BEING IMPORTED, and index.jsx imports it on its FIRST line —
// ES modules evaluate every static import before the importing module's body,
// so a call in index.jsx's body (or an App effect, where installFocusCapture
// sits) would run after every page module had already logged and fetched.
// It imports nothing from the app for the same reason. Idempotent on a window
// key, so a dev hot reload neither wraps twice nor loses the history.
//
// What it records, each into a ring bounded TWICE (entries and serialized
// bytes), evicting oldest first and counting what it dropped:
//
//   console     log/info/warn/error/debug, args serialized AT LOG TIME
//   errors      window 'error' (scripts AND failed resource loads, capture
//               phase) + 'unhandledrejection'
//   network     fetch + XHR: method, URL, status, duration, sizes, and the first
//               2 KB of a FAILED response's body — never a header, never a
//               request body (the id token rides in Authorization, the Cognito
//               refresh token in a POST body)
//   navigation  pushState / replaceState / popstate
//
// plus the browser's ResourceTiming buffer raised to 1,000, and the same
// buffers hooked into every same-origin iframe on its load (/systems2 draws
// Topology in one) — tagged `frame`, into the same rings.
//
// Every URL is redacted on the way in (`cleanUrl`). The capture itself — and
// the rest of the redaction — is RequirementFiler/debugBundle.js.

const KB = 1024;

/** The design's caps (memory/action-popup-requirement-filer.md § Caps and windows). */
export const DEBUG_CAPTURE_CAPS = Object.freeze({
    rings: Object.freeze({
        console: Object.freeze({ entries: 200, bytes: 64 * KB }),
        errors: Object.freeze({ entries: 50, bytes: 32 * KB }),
        network: Object.freeze({ entries: 200, bytes: 64 * KB }),
        navigation: Object.freeze({ entries: 50, bytes: 8 * KB }),
    }),
    entryBytes: 8 * KB,      // one ring entry, serialized, never more than this …
    nodeBudget: 500,         // … nor more values walked serializing it
    stringMax: 2000,         // characters of any one string
    stackMax: 2000,
    urlMax: 2000,            // characters of any URL kept anywhere
    failBodyMax: 2 * KB,     // first bytes of a failed (status ≥ 400) response
    failBodyWaitMs: 250,     // the capture waits this long for a body still being read
    rtBuffer: 1000,          // browser ResourceTiming buffer (default 250)
});

const STATE_KEY = '__darwinDebugCapture';
const FRAME_KEY = '__darwinDebugCaptureFrame';
const CAPS = DEBUG_CAPTURE_CAPS;

// ── Bounded serialization ───────────────────────────────────────────────────

/** `v` as plain JSON-safe data: depth 3, ≤ 50 keys/items per level, ≤ the
 *  node budget, strings ≤ 2,000 chars. Never throws. */
export function ser(v, budget = { n: CAPS.nodeBudget }, depth = 0, seen = new WeakSet()) {
    if (--budget.n < 0) return '[…budget]';
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.length > CAPS.stringMax ? `${v.slice(0, CAPS.stringMax)}…` : v;
    if (typeof v === 'undefined') return '[undefined]';
    if (typeof v === 'function') return `[fn ${v.name || 'anon'}]`;
    if (typeof v === 'bigint' || typeof v === 'symbol') return String(v);
    // By shape, not instanceof: an Error or element from a same-origin iframe
    // belongs to another realm, and `instanceof` against this one is false.
    // Probing a cross-origin WindowProxy or a throwing Proxy throws, so guarded.
    let isError, isElement;
    try {
        isError = Object.prototype.toString.call(v) === '[object Error]'
            || (typeof v === 'object' && typeof v.message === 'string' && typeof v.stack === 'string');
        isElement = !isError && typeof v === 'object' && v.nodeType === 1
            && typeof v.tagName === 'string' && typeof v.getAttribute === 'function';
    } catch { return '[unreadable]'; }
    if (isError) {
        const out = { error: String(v.name || 'Error'), message: ser(v.message, budget), stack: String(v.stack || '').slice(0, CAPS.stackMax) };
        // Its own fields too (a `code`, a `status`) — within the same bounds.
        try {
            for (const k of Object.keys(v).slice(0, 20)) {
                if (!(k in out) && k !== 'name') out[k] = ser(v[k], budget, depth + 1, seen);
            }
        } catch { /* the three above are the error */ }
        return out;
    }
    if (isElement) {
        const testid = v.getAttribute('data-testid');
        return `[<${v.tagName.toLowerCase()}${v.id ? `#${v.id}` : ''}${testid ? ` testid=${testid}` : ''}>]`;
    }
    if (typeof v !== 'object') return String(v);
    if (seen.has(v)) return '[circular]';
    if (depth >= 3) return Array.isArray(v) ? `[array(${v.length})]` : '[object]';
    seen.add(v);
    if (Array.isArray(v)) {
        const out = [];
        for (const x of v.slice(0, 50)) {
            if (budget.n <= 0) { out.push('[…budget]'); break; }
            out.push(ser(x, budget, depth + 1, seen));
        }
        if (v.length > 50) out.push(`…+${v.length - 50}`);
        return out;
    }
    const out = {};
    let keys;
    try { keys = Object.keys(v); } catch { return '[unreadable]'; }
    for (const k of keys.slice(0, 50)) {
        if (budget.n <= 0) { out['…'] = 'budget'; break; }
        try { out[k] = ser(v[k], budget, depth + 1, seen); } catch { out[k] = '[unreadable]'; }
    }
    if (keys.length > 50) out['…+'] = `${keys.length - 50} keys`;
    return out;
}

/** One value never outgrows `max` serialized: past it, it keeps its head as
 *  text. The head is itself JSON and serializing it again escapes every quote,
 *  so it shrinks until the stub fits. */
export function bounded(entry, max = CAPS.entryBytes) {
    let s;
    try { s = JSON.stringify(entry); } catch { return { unserializable: true }; }
    if (s === undefined || s.length <= max) return entry;
    let n = max - 64;
    let stub;
    do {
        stub = { t: entry?.t ?? null, truncated: s.length, head: s.slice(0, Math.max(0, n)) };
        n = Math.floor(n * 0.75);
    } while (JSON.stringify(stub).length > max && n > 0);
    return stub;
}

/** Items in priority order, kept until their serialized total would pass `max`. */
export function capList(items, max) {
    const kept = [];
    let total = 2;
    for (const it of items) {
        const n = JSON.stringify(it).length + 1;
        if (total + n > max) break;
        kept.push(it);
        total += n;
    }
    return { kept, dropped: items.length - kept.length };
}

// ── URL redaction ───────────────────────────────────────────────────────────

/** A query parameter that carries a credential on the OAuth/S3 shapes. */
const SECRET_PARAM = /^(code|token|id_token|access_token|refresh_token|x-amz-security-token|x-amz-signature|signature)$/i;

/** `u` resolved against `base`, its credential parameters `[redacted]`, a hash
 *  carrying a token or a code dropped, ≤ 2,000 chars. Applied to EVERY URL the
 *  capture keeps — the page's own included (the OAuth redirect's `code`). */
export function cleanUrl(u, base = (typeof location !== 'undefined' ? location.href : undefined)) {
    const s = String(u ?? '');
    try {
        const url = new URL(s, base);
        for (const k of [...url.searchParams.keys()]) {
            if (SECRET_PARAM.test(k)) url.searchParams.set(k, '[redacted]');
        }
        if (/token|code=/i.test(url.hash)) url.hash = '#[redacted]';
        return url.toString().slice(0, CAPS.urlMax);
    } catch {
        return s.slice(0, CAPS.urlMax);
    }
}

// ── Rings ───────────────────────────────────────────────────────────────────

function ring({ entries: cap, bytes: byteCap }, entryCap = CAPS.entryBytes) {
    const items = [];      // { e, bytes }
    // Every entry is bounded on the way in, to at most a quarter of its ring,
    // so one oversized entry can never evict the ring's whole history.
    const entryMax = Math.min(entryCap, Math.floor(byteCap / 4));
    let head = 0;
    let total = 0;
    let dropped = 0;
    return {
        // `reserve`: bytes the entry will grow by later (a failure body still being read).
        push(e, reserve = 0) {
            const kept = bounded(e, entryMax - reserve);
            const bytes = JSON.stringify(kept).length + reserve;
            items.push({ e: kept, bytes });
            total += bytes;
            while (items.length - head > cap || total > byteCap) {
                total -= items[head].bytes;
                head++;
                dropped++;
            }
            if (head > 1024) { items.splice(0, head); head = 0; }
        },
        all() { return items.slice(head).map((x) => x.e); },
        get size() { return items.length - head; },
        get bytes() { return total; },
        get dropped() { return dropped; },
    };
}

function createState() {
    return {
        installedAt: Date.now(),
        rings: Object.fromEntries(Object.entries(CAPS.rings).map(([k, c]) => [k, ring(c)])),
        // A failure's body is read asynchronously; the capture waits for these.
        pendingBodies: new Set(),
        // Requests sent and not yet settled — a hung page's request is here, not in the ring.
        inFlight: new Set(),
        frames: [],
    };
}

/** The live buffers, or null when they were never installed (no window). */
export function debugCaptureState(win = (typeof window !== 'undefined' ? window : undefined)) {
    return win?.[STATE_KEY] || null;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];

/** Wraps `win`'s console, error events, fetch, XHR and history into `state`'s
 *  rings. `frame` — the iframe's path, tagged on every entry it produces. */
function hookWindow(win, state, frame) {
    const { rings } = state;
    const tag = frame ? { frame } : null;
    const here = () => win.location?.href;

    for (const level of LEVELS) {
        const orig = win.console?.[level];
        if (typeof orig !== 'function') continue;
        win.console[level] = function debugCaptureConsole(...args) {
            try {
                const budget = { n: CAPS.nodeBudget };
                rings.console.push({ t: Date.now(), level, ...tag, args: args.map((a) => ser(a, budget)) });
            } catch { /* never break logging */ }
            return orig.apply(this, args);
        };
    }

    win.addEventListener('error', (e) => {
        try {
            const target = e.target;
            if (target && target !== win && target.tagName) {
                rings.errors.push({ t: Date.now(), kind: 'resource', ...tag, tag: target.tagName.toLowerCase(),
                    src: cleanUrl(target.src || target.href || '', here()) });
            } else {
                rings.errors.push({ t: Date.now(), kind: 'error', ...tag, message: ser(e.message),
                    source: e.filename ? cleanUrl(e.filename, here()) : null, line: e.lineno ?? null, col: e.colno ?? null,
                    stack: String(e.error?.stack || '').slice(0, CAPS.stackMax) });
            }
        } catch { /* never break the page */ }
    }, true);
    win.addEventListener('unhandledrejection', (e) => {
        try {
            const r = e.reason;
            rings.errors.push({ t: Date.now(), kind: 'unhandledrejection', ...tag,
                // A Darwin call_rest_api rejection is a plain {data, httpStatus}:
                // keep its shape rather than "[object Object]".
                message: typeof r?.message === 'string' ? ser(r.message) : ser(r),
                stack: String(r?.stack || '').slice(0, CAPS.stackMax) });
        } catch { /* never break the page */ }
    });

    const origFetch = win.fetch;
    if (typeof origFetch === 'function') {
        win.fetch = function debugCaptureFetch(input, init) {
            const start = Date.now();
            let entry = null;
            try {
                const method = String(init?.method || input?.method || 'GET').toUpperCase();
                const raw = typeof input === 'string' ? input : (input?.url ?? String(input));
                const body = init?.body;
                // The byte count only — a request body can carry a credential.
                entry = { t: start, kind: 'fetch', ...tag, method, url: cleanUrl(raw, here()),
                    reqBytes: typeof body === 'string' ? body.length : null };
            } catch { /* record nothing rather than break the request */ }
            const p = origFetch.apply(this, arguments);
            if (!entry) return p;
            state.inFlight.add(entry);
            return p.then((res) => {
                state.inFlight.delete(entry);
                try {
                    entry.status = res.status;
                    entry.ms = Date.now() - start;
                    const len = res.headers?.get?.('content-length');
                    entry.resBytes = len == null ? null : Number(len);
                    if (!res.ok && typeof res.clone === 'function') {
                        // The failure's own message is the most useful byte in the trace.
                        const read = res.clone().text()
                            .then((txt) => { entry.failBody = String(txt).slice(0, CAPS.failBodyMax); })
                            .catch(() => {})
                            .finally(() => state.pendingBodies.delete(read));
                        state.pendingBodies.add(read);
                    }
                    // Reserve twice the body: JSON-escaping a quote-heavy body can double it.
                    rings.network.push(entry, res.ok ? 0 : 2 * CAPS.failBodyMax);
                } catch { /* never break the response */ }
                return res;
            }, (err) => {
                state.inFlight.delete(entry);
                try {
                    entry.status = 0;
                    entry.ms = Date.now() - start;
                    entry.error = ser(String(err?.message || err));
                    rings.network.push(entry);
                } catch { /* never mask the failure */ }
                throw err;
            });
        };
    }

    const XHR = win.XMLHttpRequest;
    if (XHR?.prototype) {
        const { open, send } = XHR.prototype;
        XHR.prototype.open = function debugCaptureOpen(method, url) {
            // open() on a request still in flight aborts it WITHOUT a loadend:
            // drop that entry and its listener so the next load is not theirs.
            const prev = this.__darwinDc;
            if (prev) {
                state.inFlight.delete(prev);
                if (prev.onLoadEnd) this.removeEventListener('loadend', prev.onLoadEnd);
            }
            try { this.__darwinDc = { kind: 'xhr', ...tag, method: String(method).toUpperCase(), url: cleanUrl(url, here()) }; } catch { /* */ }
            return open.apply(this, arguments);
        };
        XHR.prototype.send = function debugCaptureSend(body) {
            const e = this.__darwinDc;
            if (e) {
                e.t = Date.now();
                e.reqBytes = typeof body === 'string' ? body.length : null;
                state.inFlight.add(e);
                // Once: a reused XHR object gets one listener per send, each for its own entry.
                const onLoadEnd = () => {
                    delete e.onLoadEnd;
                    state.inFlight.delete(e);
                    try {
                        e.status = this.status;
                        e.ms = Date.now() - e.t;
                        const len = this.getResponseHeader('content-length');
                        e.resBytes = len == null ? null : Number(len);
                        if (this.status >= 400 && (this.responseType === '' || this.responseType === 'text')) {
                            e.failBody = String(this.responseText || '').slice(0, CAPS.failBodyMax);
                        }
                        rings.network.push(e);
                    } catch { /* never break the request */ }
                };
                // Kept on the entry only until it fires, so it never reaches the ring.
                Object.defineProperty(e, 'onLoadEnd', { value: onLoadEnd, enumerable: false, configurable: true, writable: true });
                this.addEventListener('loadend', onLoadEnd, { once: true });
            }
            return send.apply(this, arguments);
        };
    }

    const navPush = (how) => {
        try {
            const l = win.location;
            rings.navigation.push({ t: Date.now(), how, ...tag,
                url: cleanUrl(`${l.pathname}${l.search}${l.hash}`, l.href) });
        } catch { /* */ }
    };
    for (const fn of ['pushState', 'replaceState']) {
        const orig = win.history?.[fn];
        if (typeof orig !== 'function') continue;
        win.history[fn] = function debugCaptureHistory() {
            const r = orig.apply(this, arguments);
            navPush(fn);
            return r;
        };
    }
    win.addEventListener('popstate', () => navPush('popstate'));
    navPush(frame ? 'frame-load' : 'boot');
}

/** A same-origin iframe's own console, network and navigation, into the
 *  parent's rings — hooked on each load (a frame navigation is a new window). */
function hookFrame(iframe, state) {
    let fw;
    try {
        fw = iframe.contentWindow;
        if (!fw || !fw.document) return;        // cross-origin access throws
    } catch { return; }
    if (fw[FRAME_KEY]) return;
    fw[FRAME_KEY] = true;
    let frame;
    try { frame = cleanUrl(fw.location.pathname, fw.location.href); } catch { frame = 'iframe'; }
    state.frames.push({ t: Date.now(), frame });
    if (state.frames.length > 20) state.frames.splice(0, state.frames.length - 20);
    hookWindow(fw, state, frame);
}

/** Install the buffers on `win`. Idempotent — returns the existing buffers. */
export function installDebugCapture(win = (typeof window !== 'undefined' ? window : undefined)) {
    if (!win) return null;
    if (win[STATE_KEY]) return win[STATE_KEY];
    const state = createState();
    win[STATE_KEY] = state;
    hookWindow(win, state, null);
    try { win.performance?.setResourceTimingBufferSize?.(CAPS.rtBuffer); } catch { /* older browsers */ }
    // `load` does not bubble, but the capture phase sees an iframe's — on the
    // DOCUMENT: the event path stops there for `load` (a Document's parent is
    // null for that one event type, so window.onload never fires per image).
    win.document?.addEventListener('load', (e) => {
        if (e.target?.tagName === 'IFRAME') hookFrame(e.target, state);
    }, true);
    return state;
}

installDebugCapture();
