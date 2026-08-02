// useSavedViewport.js — the LIFECYCLE half of the canvas-camera memory (req #3252).
//
// `utils/viewportMemory.js` is the whole mechanism: read, write, clear, and the
// doctrine for why a camera is stored per-tab and fingerprinted. It is a pure
// module with no React in it, deliberately. This file is the small amount of
// component lifecycle that a canvas would otherwise hand-roll, and it exists
// because that is the half that is silently wrong when hand-rolled.
//
// ── WHY record/commit AND NOT A DEBOUNCE ───────────────────────────────────
// d3-zoom fires `'zoom'` per pointermove — ~60 a second during a drag — and
// `'end'` exactly ONCE per gesture: at the close of a drag, after the wheel's own
// settle timeout, and at the end of a transition or a programmatic
// `zoom.transform`. The gesture boundary a write wants already exists and is
// emitted for free. So `record()` on every move costs one ref assignment and no
// storage write, and `commit()` on `'end'` writes once.
//
// A trailing debounce was the obvious alternative and it is worse on exactly the
// path that matters: the reader's last act is a pan and their very next act is a
// click, so a 200ms timer is routinely outrun by the unmount — dropping precisely
// the camera this feature exists to remember. A timer would still need the
// unmount flush below, and then it is a timer nobody needs on top of it.
//
// ── THE UNMOUNT COMMIT IS LOAD-BEARING, NOT A TIDY-UP ──────────────────────
// A navigation can land between `'zoom'` and `'end'` — d3 emits no `'end'` for a
// gesture whose container is torn out from under it — and that is the single most
// likely moment for this feature to be exercised at all. `pagehide` covers the
// returns where nothing unmounts: a reload, a tab close, and a Back served from
// the bfcache.

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { clearViewport, readViewport, writeViewport } from '../utils/viewportMemory';

/**
 * Save-and-restore for one canvas's camera.
 *
 * @param {?string} key          storage key from `viewportStorageKey()`; null
 *                               disables persistence entirely, which is what an
 *                               unresolved record id must do — a canvas with no
 *                               identity must never read or write another
 *                               canvas's camera
 * @param {string}  fingerprint  a string that CHANGES whenever the world geometry
 *                               changes, so a stale camera is discarded rather
 *                               than restored onto a layout it does not describe
 * @returns {{record: function({x:number,y:number,k:number}): void,
 *            commit: function(): void,
 *            read: function(): ?{x:number,y:number,k:number},
 *            clear: function(): void}}
 */
export function useSavedViewport(key, fingerprint) {
    // Read through a ref rather than closing over the arguments, so every
    // returned callback is identity-stable for the life of the component. That
    // matters concretely: the caller attaches `record`/`commit` inside its
    // d3-zoom effect, so these land in that effect's dependency list, and a new
    // identity per render would tear the zoom behaviour down and rebuild it on
    // every pointermove of a drag.
    //
    // Written during render on purpose — it mirrors props, and doing it in an
    // effect would leave `record` stamping the PREVIOUS fingerprint for one
    // commit, which is exactly the commit a geometry change lands in.
    const argsRef = useRef({ key, fingerprint });
    argsRef.current = { key, fingerprint };

    const pendingRef = useRef(null);

    // THE KEY AND FINGERPRINT ARE TAKEN WHEN THE CAMERA MOVED, not when the write
    // lands. A transform belongs to the world it was produced in, so a commit
    // that straddles a layout toggle — or an in-place switch from one plan to the
    // next, which this page survives without remounting — must not stamp the
    // outgoing camera with the incoming geometry. That is the one bad record the
    // fingerprint check cannot catch, because it looks perfectly valid.
    const record = useCallback((cam) => {
        const { key: k, fingerprint: fp } = argsRef.current;
        if (!k || !cam) return;
        pendingRef.current = { key: k, fp, x: cam.x, y: cam.y, k: cam.k };
    }, []);

    const commit = useCallback(() => {
        const p = pendingRef.current;
        if (!p) return;
        pendingRef.current = null;
        writeViewport(p.key, p.fp, p);
    }, []);

    const read = useCallback(() => {
        const { key: k, fingerprint: fp } = argsRef.current;
        return readViewport(k, fp);
    }, []);

    const clear = useCallback(() => {
        pendingRef.current = null;
        clearViewport(argsRef.current.key);
    }, []);

    useEffect(() => {
        window.addEventListener('pagehide', commit);
        return () => {
            window.removeEventListener('pagehide', commit);
            commit();
        };
    }, [commit]);

    // Memoized, not a fresh literal per render — see the stability contract on
    // `argsRef` above; the object itself lands in the caller's effect deps too.
    return useMemo(() => ({ record, commit, read, clear }),
        [record, commit, read, clear]);
}

export default useSavedViewport;
