// useScrollMemory.js — the LIFECYCLE half of scroll memory (req #3311), exactly
// as `useSavedViewport.js` is the lifecycle half of camera memory (req #3252).
// `utils/viewportMemory.js` holds the whole mechanism and the doctrine; this file
// is only the component lifecycle, and it exists because that is the half that is
// silently wrong when hand-rolled.
//
// ── THERE IS NO LIST OF RETURN PATHS, AND THAT IS THE POINT ────────────────
// Darwin already had three scroll restores (`maps_scrollY`, `calview_scrollY`,
// `visualizer_scrollY`) and all three are the SAME shape: every navigating click
// site does its own `sessionStorage.setItem(key, String(window.scrollY))` before
// calling `navigate()`. That has to be exhaustive today AND stay exhaustive as
// links are added — `SwarmVisualizerView.jsx` alone carries four copies of the
// line — and it cannot cover a return that involves no navigation at all, which
// is precisely how the plan page's Table|Plan toggle and its bead-click handshake
// leave and re-enter a surface. Recording on `scroll` and committing on unmount
// covers every one of them without naming any.
//
// ── record/commit, NOT A WRITE PER SCROLL EVENT ────────────────────────────
// `useSavedViewport`'s argument, one surface over: a scroll listener fires at
// frame rate on a trackpad fling, and `sessionStorage.setItem` is synchronous and
// serializing. So `record()` costs one ref assignment and `commit()` writes once,
// at the boundary — unmount, or `pagehide` for the returns where nothing unmounts
// (a reload, a tab close, a Back served from the bfcache).
//
// ── THE RESTORE RETRIES, AND ITS OWN ECHO IS NEVER RECORDED ────────────────
// A scroller cannot be scrolled to a position its content is not yet tall enough
// to reach: the browser CLAMPS on assignment, so an early restore does not fail,
// it silently lands short. The tree is painted one frame after mount, but MUI's
// own layout still has round trips left (a DataGrid auto-heights from `rowsMeta`
// through a ResizeObserver), so a fixed two-frame delay is a guess about when
// somebody else's layout settles. Instead the restore ASKS: apply, read back, and
// try again next frame while the answer disagrees, up to `RESTORE_FRAMES`.
//
// THE ECHO IS THE DANGEROUS HALF, and it is why the two are one mechanism. A
// scroll assignment emits a `scroll` event, so a restore that lands SHORT would
// otherwise record the clamped value and commit it on unmount — destroying the
// very position it failed to apply, and destroying it worse on each visit rather
// than self-correcting. So a scroll event carrying exactly the position this hook
// just produced is CONSUMED: not recorded, and not treated as the reader taking
// over. Anything else is the reader, and it both records and cancels the retry —
// which is what stops the retry fighting somebody who scrolled during it.
//
// ── record/commit, NOT A WRITE PER SCROLL EVENT ────────────────────────────
// (continued below at `record`.)

import { useCallback, useEffect, useRef } from 'react';

import { readScroll, writeScroll } from '../utils/viewportMemory';

// ~200ms at 60fps. Long enough for a DataGrid's measure-and-remeasure, short
// enough that a genuinely unreachable position (the list really did get shorter)
// stops costing frames almost immediately — and a reader's own scroll ends it
// early regardless.
const RESTORE_FRAMES = 12;

// `window` reports its offsets as `scrollX/scrollY`, an element as
// `scrollLeft/scrollTop`. This is the only place the two differ.
const readPos = (target) => (target === window
    ? { x: window.scrollX, y: window.scrollY }
    : { x: target.scrollLeft, y: target.scrollTop });

// `scrollTo(x, y)` and NOT a pair of property assignments, even on an element.
// Both axes have to move as ONE operation: two assignments are two scroll
// events, and the first carries a half-applied position that the echo test
// below would not recognise — so it would read as the reader scrolling, cancel
// the retry, and record a position nobody chose. `Element.scrollTo` has the same
// signature as `window.scrollTo` and is on every browser this app supports; the
// property fallback is for a target that has none (a test double, an exotic
// scroller).
const applyPos = (target, pos) => {
    if (typeof target.scrollTo === 'function') target.scrollTo(pos.x, pos.y);
    else { target.scrollLeft = pos.x; target.scrollTop = pos.y; }
};

const samePos = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;

/**
 * Save-and-restore for one scrolling surface.
 *
 * @param {?string} key  storage key from `scrollStorageKey()`. `null` disables
 *                       persistence entirely — which is what a surface with no
 *                       resolved identity must do, and also how a caller says
 *                       "not yet" (still loading) or "not this time" (a deep link
 *                       owns the scroll position this landing).
 * @param {?Element|Window} [target]  the scrolling element. OMIT it for the
 *                       document scroller. Pass `null` — which is what a
 *                       `useState`-held callback ref holds until its node lands —
 *                       and persistence waits for the element rather than
 *                       silently falling back to the window and filing one
 *                       surface's position under another's key.
 *
 *                       An ELEMENT and not a ref, deliberately: a ref's `.current`
 *                       cannot appear in a dependency list, so an effect keyed on
 *                       one never re-runs when the node arrives. This is
 *                       `PipelinePlanVisualizer`'s own `const [containerEl,
 *                       setContainer] = useState(null)` idiom, for that reason.
 * @param {{restore?: boolean}} [opts]  `restore: false` keeps RECORDING and skips
 *                       the one restore — what a deep link needs. `?step=`
 *                       scrolls its row to centre, so a restore racing it puts
 *                       the reader somewhere neither asked for; but where the
 *                       link left them IS where they are, so their position must
 *                       still be remembered from that moment on. Suppressing the
 *                       whole hook instead would silently drop it. Same shape as
 *                       `PipelinePlanVisualizer`'s `suppressSaveRef`: the default
 *                       is the ordinary behaviour and exactly one path opts out.
 */
export function useScrollMemory(key, target = window, { restore = true } = {}) {
    // The pending position, and the key it was taken under. Taking the key at
    // RECORD time rather than at COMMIT time is `useSavedViewport`'s rule and it
    // matters for the same reason: this page survives an in-place switch from one
    // plan to the next without remounting, so a commit that straddles the switch
    // must not file the outgoing position under the incoming plan's key.
    const pendingRef = useRef(null);

    const commit = useCallback(() => {
        const p = pendingRef.current;
        if (!p) return;
        pendingRef.current = null;
        writeScroll(p.key, p);
    }, []);

    useEffect(() => {
        if (!key || !target) return undefined;

        const saved = restore ? readScroll(key) : null;
        let rafId = 0;
        let framesLeft = RESTORE_FRAMES;
        // ── TWO GUARDS, BECAUSE A SCROLL EVENT HAS TWO POSSIBLE TIMINGS ────
        // Browsers QUEUE the event (dispatched in the rendering steps, before
        // animation-frame callbacks), so it arrives long after the assignment
        // returns and `echo` — the position the scroller actually took, clamped
        // — is what recognises it. But a scroller that dispatches SYNCHRONOUSLY
        // re-enters `onScroll` from inside `applyPos`, i.e. before `echo` can be
        // assigned at all, and the echo test alone would then read that event as
        // the reader and record a clamped position. `applying` covers exactly
        // that window. Neither guard subsumes the other, and getting this wrong
        // is invisible: what breaks is a stored position, one visit later.
        let applying = false;
        let echo = null;

        const stopRestoring = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = 0;
            echo = null;
        };

        const attempt = () => {
            rafId = 0;
            applying = true;
            applyPos(target, saved);
            applying = false;
            // Read BACK, never assume: this is both the retry's exit test and
            // the value a queued echo is recognised by.
            echo = readPos(target);
            if (!samePos(echo, saved) && --framesLeft > 0) {
                rafId = requestAnimationFrame(attempt);
            } else {
                // Done restoring. The echo survives exactly ONE more frame:
                // long enough for its own event to arrive (scroll events are
                // dispatched before animation-frame callbacks), short enough
                // that a reader who later scrolls back to that same position
                // is recorded normally instead of swallowed.
                rafId = requestAnimationFrame(() => { rafId = 0; echo = null; });
            }
        };

        const onScroll = () => {
            const pos = readPos(target);
            if (applying || samePos(pos, echo)) {
                // Ours. Consume it once — a later event at the same position is
                // the reader, and by then there is nothing different to record
                // anyway.
                echo = null;
                return;
            }
            // The reader has taken over. Their position wins over any restore
            // still in flight.
            stopRestoring();
            pendingRef.current = { key, x: pos.x, y: pos.y };
        };

        // LISTEN FIRST, then restore. The other order loses the echo of a
        // restore that fires synchronously, which is exactly the case the echo
        // test exists for.
        //
        // `passive` — this listener never prevents default, and saying so keeps
        // it off the critical path of a scroll gesture.
        target.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('pagehide', commit);
        if (saved) rafId = requestAnimationFrame(attempt);

        return () => {
            stopRestoring();
            target.removeEventListener('scroll', onScroll);
            window.removeEventListener('pagehide', commit);
            // LOAD-BEARING, not a tidy-up: unmount is the single most likely
            // moment for this feature to be exercised at all, because the
            // reader's last act before leaving is usually the scroll being
            // remembered.
            commit();
        };
    }, [key, target, restore, commit]);
}

export default useScrollMemory;
