// useVisualizerMaximize.js — every visualizer's full screen switch: the Plan
// (req #3658, where it was born as `usePlanMaximize`), the Build and the Swarm
// visualizers (req #3793, which moved it here so the three share ONE copy).
//
// User direction (req #3658): "Add a maximize visualizer screen button. Borrow
// the button and default collapse but don't completely hide supporting text
// boxes … hide the darwin navbar and the top UI option/title bar also." The
// button borrowed is the TPU 3D views' Full screen switch (`tpu3dStageChrome`
// in Topology/systems2/tpu3d.js, req #3568/#3600), and so is its behaviour:
//
//   · It takes the BROWSER's own full screen, on the document — not on the
//     canvas, because every dialog a visualizer opens (seat, insert, a build
//     menu) is portalled to the body and would be left outside a full-screen
//     canvas, invisible.
//   · The page's own overlay (a fixed full-window box above the navbar — the
//     page draws it from `maximized`) is what actually hides the chrome, so it
//     stands in alone where the browser refuses the request.
//   · Esc leaves it, as does the switch, the browser's own exit, the canvas
//     going away (another mode or view, a load) and leaving the page.
//   · While it is up the page COVERS the navbar, so the panel rack is
//     suspended (`usePanelRackStore.covered`, req #3735) — published here,
//     once, so no covering page can forget it.
//
// WHERE THE SWITCH SITS is the page's (req #3793, user rule): in the controls'
// title/header row while controls are on screen, in the canvas's upper-left
// corner when they are not. The switch itself is `Components/FullscreenSwitch`.
//
// A browser transition is not instant, so the browser's exit leaves OURS only
// when it ends a full screen that the CURRENT switch-on saw entered — the TPU
// switch's `tpu3dFsEntered` rule. A late exit from an earlier toggle must not
// cancel a newer switch-on; a switch-on made while that exit is still pending
// runs on the overlay alone.
//
// ── ESC BELONGS TO THE PAGE FIRST ─────────────────────────────────────────
// In a browser full screen the BROWSER takes Esc to leave it, before the page
// sees the key — so an Esc meant for an open dialog, an in-place rename or a
// canvas drag would throw the reader out of maximize instead. Where the
// Keyboard Lock API exists (Chromium) the hook locks Escape while full screen
// is up: a press then reaches the page like any other key, the nearest owner
// takes it, and only an Esc nobody took leaves maximize (holding Esc still
// leaves the browser's full screen, which the browser guarantees). Elsewhere
// the browser's own Esc behaviour stands.
//
// "Nobody took it" is judged AFTER the whole dispatch, not in the listener:
// window keydown listeners run in registration order, and a canvas remounted
// while maximized registers its drag-cancel Esc AFTER this one.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { usePanelRackStore } from '../stores/usePanelRackStore';

const lockEscape = () => {
    try { Promise.resolve(navigator.keyboard?.lock?.(['Escape'])).catch(() => {}); } catch { /* unsupported */ }
};
const unlockKeys = () => {
    try { navigator.keyboard?.unlock?.(); } catch { /* unsupported */ }
};
const exitFs = () => {
    if (document.fullscreenElement && document.exitFullscreen) {
        Promise.resolve(document.exitFullscreen()).catch(() => {});
    }
};

/**
 * @param {boolean} enabled  the visualizer's canvas is the one showing — off,
 *                           the switch is released and stays off
 * @returns {{maximized: boolean, toggle: function}}
 */
export function useVisualizerMaximize(enabled) {
    const [want, setWant] = useState(false);
    const maximized = want && enabled;

    // req #3735 — maximized, the page is drawn OVER the navbar, so the panel
    // rack is suspended for every pop-up window until it is not (before paint,
    // so nothing is portalled into the covered navbar for a frame).
    useLayoutEffect(() => {
        if (!maximized) return undefined;
        usePanelRackStore.getState().setCovered(true);
        return () => usePanelRackStore.getState().setCovered(false);
    }, [maximized]);

    const onRef = useRef(maximized);
    onRef.current = maximized;
    // A full screen THIS hook requested may be pending or showing — the only
    // kind it will ever exit. One somebody else took (a TPU frame, the reader's
    // own) is never ours to leave.
    const ownsRef = useRef(false);
    // Which request owns it. A late refusal of an OLDER request must not
    // disown a newer one that the browser did grant.
    const genRef = useRef(0);
    // The current switch-on has seen its full screen entered.
    const enteredRef = useRef(false);

    useEffect(() => { if (!enabled) setWant(false); }, [enabled]);

    useEffect(() => {
        enteredRef.current = false;
        if (maximized) {
            const el = document.documentElement;
            if (!document.fullscreenElement && el.requestFullscreen) {
                const gen = ++genRef.current;
                ownsRef.current = true;
                // Refused (no user gesture, a permissions policy, an embedding
                // frame): the overlay carries it alone.
                Promise.resolve(el.requestFullscreen()).catch(() => {
                    if (genRef.current === gen) ownsRef.current = false;
                });
            }
            return;
        }
        unlockKeys();
        if (ownsRef.current) exitFs();
    }, [maximized]);

    useEffect(() => {
        const onChange = () => {
            if (document.fullscreenElement) {
                if (onRef.current) {
                    enteredRef.current = true;
                    if (ownsRef.current) lockEscape();
                }
                // A late entry for a switch already turned off.
                else if (ownsRef.current) exitFs();
                return;
            }
            ownsRef.current = false;
            unlockKeys();
            if (onRef.current && enteredRef.current) setWant(false);
            enteredRef.current = false;
        };
        document.addEventListener('fullscreenchange', onChange);
        return () => {
            document.removeEventListener('fullscreenchange', onChange);
            if (!ownsRef.current) return;
            unlockKeys();
            if (document.fullscreenElement) { exitFs(); return; }
            // Left the page while the request was still on its way: the entry
            // lands on whatever page comes next, so leave it when it does.
            const late = () => {
                document.removeEventListener('fullscreenchange', late);
                exitFs();
            };
            document.addEventListener('fullscreenchange', late);
        };
    }, []);

    useEffect(() => {
        if (!maximized) return undefined;
        let timer = null;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            // Esc in a text field belongs to the field (abandoning what was
            // typed — the Swarm visualizer's req# jump stays on screen while
            // maximized), not to the page (req #3793 review).
            const t = e.target;
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
            // An open dialog stops its Esc from propagating, so it never gets
            // here; a drag cancel and the in-place editors `preventDefault`
            // theirs, and that is read once every listener has had the event.
            timer = setTimeout(() => { if (!e.defaultPrevented) setWant(false); }, 0);
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            clearTimeout(timer);
        };
    }, [maximized]);

    // The page behind the overlay does not scroll under it. On <html>, not
    // <body>: MUI's modal manager saves and restores the BODY's overflow around
    // every dialog, and two save-and-restores on one property, released out of
    // order (leave maximize with a dialog still open), leave it locked for the
    // rest of the app.
    useEffect(() => {
        if (!maximized) return undefined;
        const root = document.documentElement;
        const prev = root.style.overflow;
        root.style.overflow = 'hidden';
        return () => { root.style.overflow = prev; };
    }, [maximized]);

    const toggle = useCallback(() => setWant((v) => !v), []);
    return { maximized, toggle };
}
