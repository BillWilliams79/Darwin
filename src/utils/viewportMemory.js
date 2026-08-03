// viewportMemory.js — "the canvas I come back to is the canvas I left" (req #3252),
// and, since req #3311, the LIST I come back to is the list I left. The camera
// half is everything down to `clearViewport`; the scroll half is the section
// after it, and the doctrine below governs both.
//
// THE DEFECT THIS EXISTS FOR. A pan/zoom canvas holds its camera in component
// state. Every way of leaving the page unmounts that component, so the camera is
// gone before the browser has finished navigating — and coming back re-lands on
// the default view. The user reported it as three cases (a requirement link, a
// step link, "link to anything") and then named the general form: *all occasions,
// not just the three I mentioned*.
//
// THE POINT IS THAT THERE IS NO LIST OF OCCASIONS. Every return — a link out and
// Back, a bead click that switches to the Table and a switch back, a mode toggle,
// a breadcrumb round-trip, a reload — arrives at one place: the canvas mounts.
// Write the camera down when it moves, read it back when the canvas lands, and
// the enumeration disappears. A per-call-site patch would have to be exhaustive
// today AND stay exhaustive as links are added. Two of the plan visualizer's own
// return paths involve NO NAVIGATION AT ALL (a bead click and the Table|Plan
// toggle both unmount the canvas inside one route), so there is no navigation to
// hang a patch on even if the list were complete.
//
// ── A PLAIN MODULE, NOT A HOOK AND NOT A STORE ─────────────────────────────
// It holds no state and has no lifecycle, so it is a module — and it must stay
// one. `useViewPreference` is a hook because it OWNS THE VALUE REACT RENDERS. A
// camera must never be React state owned by a second party: the d3-zoom BEHAVIOR
// owns the camera, and a second copy desyncs on the first wheel event
// (PipelinePlanVisualizer's own "the classic integration bug" note). This is a
// SIDE CHANNEL, and a side channel with no state is a function.
//
// It is not a Zustand store either: a store is cross-tab by default (wrong, see
// below) and re-renders every subscriber on a value that changes at pointermove
// frequency during a drag.
//
// No JSX and no React, so vitest exercises it without a DOM — the same rule
// `pipelineStepLink.js` and `normalizeView.js` are written to.
//
// ── PER TAB, NEVER CROSS-TAB (sessionStorage only, no localStorage seed) ────
// A VIEWPORT IS NOT A VIEW PREFERENCE, and conflating them breaks three ways.
// A preference answers "how do I like to look at this KIND of page" — durable,
// meaningful with no context, so `useViewPreference` seeds a new tab from
// localStorage. A viewport answers "where was I in THIS artifact, a moment ago".
// A second tab was never there, and handing it a camera from a different task is
// the browser's own scroll restoration getting it wrong — which is why no
// browser does that either.
//
// THERE IS A MEASURED DARWIN PRECEDENT. `stores/useSwarmVisualizerStore.js`
// persisted the swarm canvas's `currentDate` to localStorage as the reader
// panned, and the next page load rehydrated a camera from days earlier — the
// "late-May affinity", req #2799. `partialize` now strips it and `migrate`
// deletes it from old blobs. A plan camera in localStorage is that bug with two
// axes instead of one. sessionStorage gets the #2799 protection for free, from
// the storage boundary itself rather than from an exclusion list, while still
// surviving the things that matter: a reload and every in-tab navigation.
//
// Same call req #3220 made for the pipelines status filter, and the same shape
// as the three shipped scroll-restore precedents (`visualizer_scrollY`,
// `maps_scrollY`, `calview_scrollY`) — the closest existing thing in the
// codebase to what was asked for.
//
// ── A CAMERA IS ONLY VALID FOR THE GEOMETRY IT WAS TAKEN IN ────────────────
// `{x, y, k}` is a camera over a WORLD, and the world is a layout. Change the
// layout — a wider column, a step added by a background refetch, a band gained —
// and the same numbers point at different content. A stale camera DOES NOT FAIL
// LOUDLY: it lands somewhere unrelated, which reads as a defect in the drawing
// rather than in the restore. So every record carries a FINGERPRINT of the
// geometry it was taken under, and a mismatch means NO RESTORE — never an
// approximate one. The caller computes the fingerprint, because only the caller
// knows what its own world is made of.
//
// ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
// It does not clamp. A stored camera is validated for SHAPE (three finite
// numbers, a positive scale) and for the geometry it belongs to, and that is
// all. The legal range of a transform is the caller's zoom behaviour's business —
// scale extent and pan bound — and lives in the caller's own pure layout module;
// a copy here would be the desync class that file has already taken two review
// findings on. Read, then clamp with your own rule. This matters more than it
// sounds: `zoom.transform` applies what it is given VERBATIM and runs neither
// `constrain` nor `scaleExtent`, so an unclamped restore sits out of range
// looking correct until the reader's first wheel event snaps it.
//
// ── ADOPTION ───────────────────────────────────────────────────────────────
// One caller today: `SwarmView/pipelines/PipelinePlanVisualizer.jsx`, through
// `hooks/useSavedViewport.js` (the lifecycle half — see that file). Darwin has
// exactly three React-owned pan/zoom cameras and they are one idiom, so the
// other two are the candidate adopters, and NEITHER should adopt blindly:
//
//   · `BuildVisualizer/KonvaBuildCanvas.jsx` can adopt as-is — fingerprint
//     `projectId` + rounded world dimensions, and its `lastFramedProjectRef`
//     becomes "restore, else frame".
//   · `SwarmView/KonvaSwarmCanvas.jsx` MUST NOT restore across page loads: that
//     is precisely what req #2799 removed. If it adopts, it adopts for the
//     in-tab return path only, with `selectedDate|rangeEnd` in the fingerprint,
//     and it must be reconciled with the `recenterDecision`/`userPannedRef`
//     machinery it already carries, which a restore would otherwise fight.

export const VIEWPORT_STORAGE_PREFIX = 'darwin-viewport-';

// Bumped only if the record's SHAPE changes. On a mismatch a record is dropped
// rather than migrated: a one-time reset to the default view costs a reader one
// gesture, and a migration branch for a convenience feature lives forever.
export const VIEWPORT_SCHEMA_VERSION = 1;

/**
 * The storage key for one camera.
 *
 * Deliberately NOT the `darwin-<feature>-view` shape: that namespace belongs to
 * view PREFERENCES, and the whole point of this module is that a camera is not
 * one.
 *
 * @param {string} surface e.g. `pipeline-plan`
 * @param {string|number} recordId the artifact the camera is over
 */
export const viewportStorageKey = (surface, recordId) =>
    `${VIEWPORT_STORAGE_PREFIX}${surface}-${recordId}`;

/**
 * The camera stored under `key`, or null.
 *
 * VALIDATED, NEVER TRUSTED. The value is JSON out of web storage, so it can be
 * anything an older version of this app wrote, anything a different feature
 * wrote under a colliding key, or anything a reader typed into devtools. It is
 * handed to a d3-zoom transform and multiplied into every coordinate on the
 * canvas: a NaN in any of the three fields DOES NOT THROW — it renders an empty
 * canvas with no error to see, the worst possible failure for a view whose only
 * job is to be looked at. This is the discipline `pipelinePlanLayout.js` already
 * applies to every storage-sourced value it hands to Konva, for the same reason.
 *
 * @param {?string} key
 * @param {string}  fingerprint the geometry the caller is rendering NOW
 * @returns {?{x: number, y: number, k: number}}
 */
export function readViewport(key, fingerprint) {
    if (!key) return null;
    try {
        const raw = sessionStorage.getItem(key);
        if (raw == null) return null;
        const rec = JSON.parse(raw);
        // `typeof null === 'object'`, and a stored `"7"` parses to a number —
        // both sail past a bare truthiness check straight into `rec.fp`.
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
        if (rec.v !== VIEWPORT_SCHEMA_VERSION) return null;
        if (rec.fp !== fingerprint) return null;
        const { x, y, k } = rec;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(k)) return null;
        // A zero or negative scale is not a small view, it is a collapsed or
        // mirrored world. No zoom behaviour can produce one; only corruption can.
        if (!(k > 0)) return null;
        return { x, y, k };
    } catch {
        // Storage unavailable (Safari private mode) or unparseable JSON. There
        // is no saved camera — a state the caller already handles, because it is
        // the first-ever visit.
        return null;
    }
}

/**
 * Store `cam` under `key`, stamped with the geometry it was taken in.
 *
 * @param {?string} key
 * @param {string}  fingerprint
 * @param {{x: number, y: number, k: number}} cam
 */
export function writeViewport(key, fingerprint, cam) {
    if (!key || !cam) return;
    if (!Number.isFinite(cam.x) || !Number.isFinite(cam.y) || !Number.isFinite(cam.k)) return;
    try {
        sessionStorage.setItem(key, JSON.stringify({
            v: VIEWPORT_SCHEMA_VERSION, fp: fingerprint, x: cam.x, y: cam.y, k: cam.k,
        }));
    } catch {
        // Safari private mode / quota exceeded. The camera still works; it just
        // will not be there next time. Never worth breaking the canvas over, and
        // never worth surfacing — this is a convenience, not a feature that can
        // fail loudly.
    }
}

/** Forget the camera under `key`. */
export function clearViewport(key) {
    if (!key) return;
    try {
        sessionStorage.removeItem(key);
    } catch {
        // See writeViewport.
    }
}

// ── SCROLL POSITIONS — the same doctrine, a different surface (req #3311) ────
//
// A pan/zoom camera and a scroll offset are the SAME FACT about two kinds of
// surface: where in this artifact was I, a moment ago. Req #3252 answered it for
// the one Darwin surface that has a camera; req #3311 asks it of the two that
// have scrollbars — the pipelines LIST and the plan detail's Table mode — and
// the ask names both with one word ("the list viewport ... the viewport in a
// visualizer"). So this lives here rather than in a second module: everything
// above about per-tab storage, about validating a value that came out of web
// storage, and about a position being a convenience that must never fail loudly,
// applies verbatim and would otherwise be restated.
//
// ── NO FINGERPRINT, AND THAT IS THE DIFFERENCE ─────────────────────────────
// A camera is `{x, y, k}` over a WORLD, and a stale one lands somewhere
// unrelated with nothing to see but a wrong-looking drawing — hence the
// fingerprint above. A scroll offset is bounded by the scroller itself: every
// browser clamps `scrollTop` to `scrollHeight - clientHeight` on assignment, so
// the worst a stale offset can do is land at the end of a shorter list. That is
// a benign miss, and a fingerprint over "the content" would have to be recomputed
// from data this module cannot see. Validate the SHAPE and let the browser bound
// the value.
export const SCROLL_STORAGE_PREFIX = 'darwin-scroll-';

// Bumped only if the record's SHAPE changes; a mismatch drops the record. See
// VIEWPORT_SCHEMA_VERSION for why dropping beats migrating here.
export const SCROLL_SCHEMA_VERSION = 1;

/**
 * The storage key for one scrolling surface.
 *
 * `recordId` is optional: a page-level list (`/swarm/pipelines`) has exactly one
 * scroll position, while a per-artifact surface (one plan's table) needs one per
 * record, for the same reason the camera is keyed on the plan — two plans open in
 * one tab must not inherit each other's position.
 *
 * @param {string} surface e.g. `pipelines-list`
 * @param {string|number} [recordId]
 */
export const scrollStorageKey = (surface, recordId) => (recordId == null
    ? `${SCROLL_STORAGE_PREFIX}${surface}`
    : `${SCROLL_STORAGE_PREFIX}${surface}-${recordId}`);

/**
 * The scroll offset stored under `key`, or null.
 *
 * VALIDATED, NEVER TRUSTED, for the reason readViewport gives: this is JSON out
 * of web storage and it is handed to `scrollTo`. A NaN there is not an error —
 * `window.scrollTo(0, NaN)` is specified to normalize the value to 0, so a
 * corrupt record would silently scroll the reader to the top and read as the
 * feature simply not working.
 *
 * @param {?string} key
 * @returns {?{x: number, y: number}}
 */
export function readScroll(key) {
    if (!key) return null;
    try {
        const raw = sessionStorage.getItem(key);
        if (raw == null) return null;
        const rec = JSON.parse(raw);
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
        if (rec.v !== SCROLL_SCHEMA_VERSION) return null;
        const { x, y } = rec;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        // A negative offset is not a position any scroller can be in. Browsers
        // clamp it to 0 rather than rejecting it, so it would restore silently
        // and wrongly.
        if (x < 0 || y < 0) return null;
        return { x, y };
    } catch {
        return null;
    }
}

/**
 * Store `pos` under `key`.
 *
 * NEGATIVES ARE CLAMPED, NOT REFUSED, and the asymmetry with `readScroll` is
 * deliberate. Safari reports a NEGATIVE offset during rubber-band overscroll, so
 * a fling to the top followed straight away by a click is an ordinary gesture
 * that produces `y = -30` — and refusing the record would throw away a perfectly
 * good `x` with it, because a record is read whole. 0 is what that gesture
 * actually means. On the READ side a negative is still refused, because by then
 * it can only have come from corruption: nothing here can write one.
 *
 * @param {?string} key
 * @param {{x: number, y: number}} pos
 */
export function writeScroll(key, pos) {
    if (!key || !pos) return;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    try {
        sessionStorage.setItem(key, JSON.stringify({
            v: SCROLL_SCHEMA_VERSION,
            x: Math.max(0, pos.x),
            y: Math.max(0, pos.y),
        }));
    } catch {
        // See writeViewport: a position that cannot be stored is never worth
        // breaking the page over.
    }
}

// There is deliberately NO `clearScroll`. `clearViewport` exists because a
// camera has a "go back to the default view" affordance that must forget where
// the reader was; a scroll position has no such control and needs none —
// scrolling to the top IS the reset, and it is recorded like any other move. An
// exported function with no caller is an API somebody has to keep working.
