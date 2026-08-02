// viewportMemory.js — "the canvas I come back to is the canvas I left" (req #3252).
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
