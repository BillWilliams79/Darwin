// focusLossRecorder.js — catch whatever takes focus away from a text field
// the reader is typing into, at the moment it happens (req #3632).
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// The add-a-requirement template title intermittently loses focus right after
// the reader clicks into it. Two investigations (req #2884, req #3632) could
// not reproduce it — jsdom re-seeds, real-Chrome Playwright runs with a cold
// load, 600 ms of network latency, the aggregator card, a window-focus
// refetch and a jittered click all kept focus. Nothing on /swarm calls
// `focus()` or carries `autoFocus`. So the culprit has to be caught in the
// reader's own browser, when it happens, and it has to be caught WITHOUT the
// reader having switched anything on first: req #2884's logger was opt-in and
// in four months recorded nothing, because nobody is holding DevTools open
// when a focus loss surprises them.
//
// ── WHAT IT RECORDS ────────────────────────────────────────────────────────
// A watch session opens when the field gains focus and closes when focus
// leaves it. It is a loss only if the reader did NOT cause it and the field is
// not still the active element (switching to another app blurs the field
// without moving `document.activeElement`, and that is not a loss).
//
// READER INTENT is a pointer press outside the field, Tab / Escape / Enter, or
// Back/Forward — and it is a claim about the NEXT focus change only. A press
// or key that leaves focus where it was (Escape, Enter on an empty title, a
// click on a non-focusable spot) is cleared on the next task, and Enter's
// intent — kept, because a save navigates only after its POST returns — is
// cleared by the next keystroke, which proves the reader is still typing. A
// sticky intent would silence a real steal for the rest of the session.
//
// A loss is classified by what the evidence shows:
//
//   remounted    the field left the document while focused (React replaced
//                it — a key change, a parent swapped for a spinner, …)
//   moved        the field was taken out and put back in the document
//   disabled     the field itself became disabled
//   hidden       an ancestor became `hidden`/`inert`/display:none/
//                visibility:hidden, so the browser dropped focus
//   focus-stolen something called `.focus()` on another element — the call's
//                stack is captured, which names the component that did it
//                (React's own `autoFocus` arrives this way too)
//   blur-called  something called `.blur()` on the field — stack captured
//   focus-moved  focus landed on another element with no script call and no
//                reader input seen — `relatedTarget` names where
//   blurred      none of the above: browser- or extension-level (autofill, a
//                password manager, …)
//
// While a session is open `HTMLElement.prototype.focus` / `.blur` (and SVG's
// `focus`) are wrapped so a programmatic call carries its stack, and a
// MutationObserver watches the field's ancestry. Both exist ONLY while a
// watched field holds focus and are removed when it closes, so the rest of the
// app never runs through them. Production stacks are minified (no sourcemaps
// ship); resolving one needs a sourcemapped build of the same commit.
//
// ── WHERE A LOSS GOES ──────────────────────────────────────────────────────
// Every loss: `console.warn('[focus-loss]', …)` and `window.__darwinFocusLoss`
// (newest last, capped). In DevTools, `copy(darwinFocusLossReport())` puts
// them all on the clipboard as JSON — the artifact to hand back for diagnosis.
// `onLoss(report)` — the caller's visible alert — is NOT called for two
// shapes that are recorded but are not the bug: a loss that coincides with a
// ROUTE CHANGE (another field's save navigated away; the bug happens on one
// page), and an evidence-free blur after a TOUCH focus (an on-screen keyboard
// dismissed with "Done" blurs the field with no page event at all).

const MAX_REPORTS = 20;
const MAX_EVIDENCE = 25;
const STACK_DEPTH = 40;
const WATCHED_ATTRIBUTES = ['hidden', 'inert', 'style', 'disabled'];
const INTENT_KEYS = new Set(['Tab', 'Enter', 'Escape']);
const EVIDENCE_FREE_CAUSES = new Set(['blurred', 'focus-moved']);

// One open session at a time: only one element can hold focus.
let active = null;

// The press that FOCUSES a field arrives before its session opens, so the
// pointer type is tracked here, once, for the session to read when it opens.
let lastPress = { touch: false, at: 0 };
let pressTrackerInstalled = false;
function installPressTracker() {
    if (pressTrackerInstalled || typeof document === 'undefined') return;
    pressTrackerInstalled = true;
    document.addEventListener('pointerdown', (e) => {
        lastPress = { touch: e.pointerType === 'touch', at: Date.now() };
    }, true);
    document.addEventListener('touchstart', () => {
        lastPress = { touch: true, at: Date.now() };
    }, true);
}
const FOCUSING_PRESS_MS = 1000;

export function describeElement(node) {
    if (!node) return String(node);
    if (node === document.body) return 'document.body';
    if (node === document.documentElement) return 'html';
    if (!node.tagName) return node.nodeName || 'node';
    const testid = node.closest?.('[data-testid]')?.getAttribute('data-testid');
    const name = node.getAttribute?.('name');
    const label = node.getAttribute?.('aria-label');
    return `${node.tagName.toLowerCase()}`
        + (testid ? `[testid=${testid}]` : '')
        + (name ? `[name=${name}]` : '')
        + (label ? `[aria-label=${label}]` : '');
}

function captureStack() {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = STACK_DEPTH;
    const stack = new Error().stack;
    Error.stackTraceLimit = limit;
    // Drop the Error line and this module's own frames; keep the caller's.
    return (stack || '').split('\n').slice(1)
        .filter((line) => !line.includes('focusLossRecorder.js')
            && !line.includes('focusWithStack') && !line.includes('blurWithStack')
            && !line.includes('captureStack'))
        .map((line) => line.trim());
}

function pushCapped(list, item) {
    list.push(item);
    if (list.length > MAX_EVIDENCE) list.shift();
}

// `aria-hidden` is deliberately NOT here: it does not drop focus (MUI's Modal
// sets it on #root while a dialog is open), so counting it would mislabel a
// dialog's programmatic steal as `hidden`.
function hiddenAncestor(el) {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        if (n.hidden || n.inert) return n;
        const view = n.ownerDocument?.defaultView;
        if (view?.getComputedStyle) {
            const style = view.getComputedStyle(n);
            if (style.display === 'none') return n;
            if (n === el && style.visibility === 'hidden') return n;
        }
    }
    return null;
}

function record(report) {
    if (typeof window === 'undefined') return;
    const list = window.__darwinFocusLoss || (window.__darwinFocusLoss = []);
    list.push(report);
    if (list.length > MAX_REPORTS) list.splice(0, list.length - MAX_REPORTS);
}

if (typeof window !== 'undefined') {
    window.darwinFocusLossReport = () => JSON.stringify(window.__darwinFocusLoss || [], null, 2);
}

const currentPath = () => (typeof window !== 'undefined' ? window.location.pathname : '');

function resetEvidence(session) {
    session.focusedAt = Date.now();
    session.path = currentPath();
    session.voluntary = null;
    session.focusCalls = [];
    session.blurCalls = [];
    session.mutations = [];
}

function openSession(el, opts) {
    const session = {
        el, opts, closed: false,
        touch: lastPress.touch && Date.now() - lastPress.at < FOCUSING_PRESS_MS,
    };
    resetEvidence(session);

    // Intent is about the NEXT focus change only — see the header.
    const clearIntentIfStayed = () => {
        setTimeout(() => {
            if (!session.closed && document.activeElement === el) session.voluntary = null;
        }, 0);
    };

    const protos = [HTMLElement.prototype];
    if (typeof SVGElement !== 'undefined') protos.push(SVGElement.prototype);
    const originals = protos.map((proto) => ({ proto, focus: proto.focus, blur: proto.blur }));
    const focusWithStack = function focusWithStack(...args) {
        if (this !== el) {
            pushCapped(session.focusCalls, {
                target: describeElement(this),
                stack: captureStack(),
                atMs: Date.now() - session.focusedAt,
            });
        }
        const original = originals.find((o) => o.proto.isPrototypeOf(this)) || originals[0];
        return original.focus.apply(this, args);
    };
    const blurWithStack = function blurWithStack(...args) {
        if (this === el) {
            pushCapped(session.blurCalls, {
                stack: captureStack(),
                atMs: Date.now() - session.focusedAt,
            });
        }
        const original = originals.find((o) => o.proto.isPrototypeOf(this)) || originals[0];
        return original.blur.apply(this, args);
    };
    for (const { proto } of originals) {
        proto.focus = focusWithStack;
        proto.blur = blurWithStack;
    }

    const onPointerDown = (e) => {
        if (el.contains(e.target)) {
            if (e.pointerType === 'touch' || e.type === 'touchstart') session.touch = true;
            return;
        }
        session.voluntary = `${e.type} on ${describeElement(e.target)}`;
        clearIntentIfStayed();
    };
    const onKeyDown = (e) => {
        if (!INTENT_KEYS.has(e.key)) {
            // The reader is still typing here, so any earlier intent is spent.
            if (el.contains(e.target)) session.voluntary = null;
            return;
        }
        session.voluntary = `${e.key} key`;
        if (e.key !== 'Enter') clearIntentIfStayed();
    };
    const onPopState = () => { session.voluntary = 'history navigation'; };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    // Capture, so intent is set before React Router's own listener runs.
    window.addEventListener('popstate', onPopState, true);

    const onMutations = (mutations) => {
        for (const m of mutations) {
            if (m.type === 'childList') {
                for (const removed of m.removedNodes) {
                    if (removed === el || removed.contains?.(el)) {
                        pushCapped(session.mutations, {
                            kind: 'removed',
                            node: describeElement(removed),
                            from: describeElement(m.target),
                            atMs: Date.now() - session.focusedAt,
                        });
                    }
                }
            } else if (m.type === 'attributes' && m.target.contains?.(el)) {
                pushCapped(session.mutations, {
                    kind: 'attribute',
                    attribute: m.attributeName,
                    node: describeElement(m.target),
                    value: m.target.getAttribute(m.attributeName),
                    atMs: Date.now() - session.focusedAt,
                });
            }
        }
    };
    let observer = null;
    if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver((mutations) => {
            onMutations(mutations);
            if (!el.isConnected) closeSession(session, 'removed-from-document');
        });
        observer.observe(document.body, {
            subtree: true, childList: true, attributes: true, attributeFilter: WATCHED_ATTRIBUTES,
        });
    }

    session.teardown = () => {
        for (const { proto, focus, blur } of originals) {
            if (proto.focus === focusWithStack) proto.focus = focus;
            if (proto.blur === blurWithStack) proto.blur = blur;
        }
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('mousedown', onPointerDown, true);
        document.removeEventListener('touchstart', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('popstate', onPopState, true);
        if (observer) {
            // The removal that ended the session is often still queued.
            onMutations(observer.takeRecords());
            observer.disconnect();
        }
    };
    return session;
}

function classify(session, relatedTarget) {
    const { el } = session;
    if (!el.isConnected) return 'remounted';
    if (session.mutations.some((m) => m.kind === 'removed')) return 'moved';
    if (el.disabled) return 'disabled';
    if (hiddenAncestor(el)) return 'hidden';
    if (session.focusCalls.length > 0) return 'focus-stolen';
    if (session.blurCalls.length > 0) return 'blur-called';
    if (relatedTarget) return 'focus-moved';
    return 'blurred';
}

// The one element that best answers "who did this", per cause — for focus
// causes it is where focus went; for the others focus went to <body>, and the
// culprit is what removed, hid or disabled the field.
function culpritFor(cause, report, session) {
    const lastRemoval = [...session.mutations].reverse().find((m) => m.kind === 'removed');
    switch (cause) {
        case 'remounted':
        case 'moved':
            return lastRemoval ? `${lastRemoval.node} removed from ${lastRemoval.from}` : 'unknown parent';
        case 'hidden': return `hidden by ${report.hiddenBy}`;
        case 'disabled': return 'field disabled';
        case 'blur-called': return session.blurCalls[0]?.stack[0] || 'blur() call';
        default: return report.takenBy;
    }
}

function closeSession(session, trigger, relatedTarget = null) {
    if (session.closed) return;
    session.closed = true;
    session.teardown();
    if (active === session) active = null;
    if (session.voluntary) return;

    const takenBy = typeof document !== 'undefined' ? document.activeElement : null;
    const hidden = session.el.isConnected ? hiddenAncestor(session.el) : null;
    const cause = classify(session, relatedTarget);
    const routeChanged = currentPath() !== session.path;
    const report = {
        at: new Date().toISOString(),
        label: session.opts.label || describeElement(session.el),
        cause,
        msAfterFocus: Date.now() - session.focusedAt,
        trigger,
        takenBy: describeElement(takenBy),
        relatedTarget: relatedTarget ? describeElement(relatedTarget) : null,
        hiddenBy: hidden ? describeElement(hidden) : null,
        focusCalls: session.focusCalls,
        blurCalls: session.blurCalls,
        mutations: session.mutations.slice(-10),
        url: session.path,
        routeChanged,
        touch: session.touch,
        visibilityState: typeof document !== 'undefined' ? document.visibilityState : '',
    };
    report.culprit = culpritFor(cause, report, session);
    const quiet = routeChanged || (session.touch && EVIDENCE_FREE_CAUSES.has(cause)
        && session.focusCalls.length === 0 && session.mutations.length === 0);
    report.alerted = !quiet;
    record(report);
    // eslint-disable-next-line no-console
    console.warn('[focus-loss]', report,
        '\n→ copy(darwinFocusLossReport()) puts every captured loss on the clipboard.');
    if (!quiet && session.opts.onLoss) session.opts.onLoss(report);
}

/**
 * Watch `el` for focus taken away from it without the reader asking.
 * Returns a cleanup to call when the field unmounts — a cleanup that runs
 * while the field still holds an open session IS a loss (`remounted`), unless
 * the reader caused it.
 *
 * @param {HTMLElement} el
 * @param {{ label?: string, onLoss?: (report: object) => void }} opts
 */
export function watchFocusLoss(el, opts = {}) {
    if (!el || typeof document === 'undefined') return () => {};
    installPressTracker();

    const onFocus = () => {
        if (active && active.el === el && !active.closed) {
            // The window came back (or focus bounced within one task): the
            // same session resumes, but its old evidence describes a moment
            // that is over and must not be blamed for a later loss.
            resetEvidence(active);
            return;
        }
        if (active) closeSession(active, 'superseded');
        active = openSession(el, opts);
    };
    const onBlur = (e) => {
        const session = active;
        if (!session || session.el !== el) return;
        const relatedTarget = e.relatedTarget;
        // Let the browser settle `document.activeElement` before judging.
        setTimeout(() => {
            if (session.closed) return;
            // Still the active element: the WINDOW lost focus (another app,
            // DevTools), not the field. The session stays open.
            if (document.activeElement === el && el.isConnected) return;
            closeSession(session, 'blur', relatedTarget);
        }, 0);
    };
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
    if (document.activeElement === el) onFocus();

    return () => {
        el.removeEventListener('focus', onFocus);
        el.removeEventListener('blur', onBlur);
        if (!active || active.el !== el) return;
        // React detaches an unmounting field's DOM BEFORE passive-effect
        // cleanups run, so a field still in the document here is only being
        // re-watched (the caller's options changed) — close quietly and let
        // the next watch reopen the session.
        if (el.isConnected) {
            active.voluntary = 're-watched';
            closeSession(active, 'rewatch');
            return;
        }
        closeSession(active, 'unmounted');
    };
}
