// useGrabScroll — press and drag to scroll, like the map and 3D views
// (req #3804 user directive: "you can scroll around through the cards using
// the click as a grabber. like in 3D or map view").
//
// A MOUSE press on the surface, anywhere that is not itself a control, grabs
// the page: past a 4px move it scrolls the nearest scrolling ancestor (the
// window when nothing nearer scrolls) by the distance moved, and on release it
// glides on for a moment with the speed it was let go at, slowing smoothly.
// Below 4px nothing happened, so the click is an ordinary click; past it the
// click that ends the grab is swallowed, so a pan that began on a card's
// preview does not also open the plan.
//
// Touch and pen are left alone — a finger already scrolls the page natively.
// A press on a text field, a button, a link, a menu or a drag grip is that
// control's, never a grab — unless the control opts in with `data-grab-through`.

import { useCallback, useEffect, useRef, useState } from 'react';

export const GRAB_THRESHOLD_PX = 4;
// The glide: velocity (px/ms) is multiplied by this every 16ms frame, and the
// glide ends below `GLIDE_STOP` px/ms. 0.94 gives about half a second of
// coast from a brisk flick — enough to feel thrown, not enough to lose place.
export const GLIDE_DECAY = 0.94;
const GLIDE_STOP = 0.02;
// A release this long after the last move is a stop, not a throw.
const GLIDE_WINDOW_MS = 80;

export const GRAB_EXCLUDE = [
    'input', 'textarea', 'select', 'button', 'a[href]', '[contenteditable="true"]',
    '[role="button"]', '[role="menuitem"]', '[role="option"]', '[data-drag-handle]',
    '.MuiChip-clickable', '.MuiInputBase-root',
].join(', ');

/** The element that scrolls `node` — the nearest overflowing ancestor, or the page. */
export function scrollParentOf(node) {
    const doc = node?.ownerDocument || document;
    for (let el = node?.parentElement; el && el !== doc.body; el = el.parentElement) {
        const { overflowY, overflowX } = doc.defaultView.getComputedStyle(el);
        const scrollsY = /(auto|scroll|overlay)/.test(overflowY) && el.scrollHeight > el.clientHeight;
        const scrollsX = /(auto|scroll|overlay)/.test(overflowX) && el.scrollWidth > el.clientWidth;
        if (scrollsY || scrollsX) return el;
    }
    return doc.scrollingElement || doc.documentElement;
}

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.enabled]
 * @returns {{ ref: (node) => void, grabbing: boolean }}  `ref` goes on the
 *          surface; `grabbing` is true while a pan is under way (for the cursor)
 */
export default function useGrabScroll({ enabled = true } = {}) {
    const [node, setNode] = useState(null);
    const [grabbing, setGrabbing] = useState(false);
    const ref = useCallback((el) => setNode(el), []);
    const glideRef = useRef(0);

    useEffect(() => {
        if (!node || !enabled) return undefined;
        const win = node.ownerDocument.defaultView;
        const doc = node.ownerDocument;
        let press = null;

        // Body styles are restored only by the pan that set them — a cleanup with
        // no pan running must not wipe what a drag in progress set (setPageDragging).
        const setPanStyles = (on) => {
            doc.body.style.userSelect = on ? 'none' : '';
            doc.body.style.cursor = on ? 'grabbing' : '';
        };
        // A mouse press would otherwise begin a text selection that the pan drags along.
        const noSelect = (e) => { if (press) e.preventDefault(); };
        const listen = (on) => {
            const method = on ? 'addEventListener' : 'removeEventListener';
            win[method]('pointermove', onMove);
            // Capture phase: a descendant stopping the pointerup's propagation must
            // not leave a pan running under a released button.
            win[method]('pointerup', onUp, true);
            win[method]('pointercancel', onUp, true);
            doc[method]('selectstart', noSelect, true);
        };

        const stopGlide = () => {
            if (glideRef.current) win.cancelAnimationFrame(glideRef.current);
            glideRef.current = 0;
        };
        const scrollBy = (scroller, dx, dy) => {
            scroller.scrollLeft += dx;
            scroller.scrollTop += dy;
        };
        const glide = (scroller, vx, vy) => {
            let last = win.performance.now();
            const step = (now) => {
                const dt = Math.min(48, now - last);
                last = now;
                const decay = GLIDE_DECAY ** (dt / 16);
                vx *= decay;
                vy *= decay;
                if (Math.hypot(vx, vy) < GLIDE_STOP) { glideRef.current = 0; return; }
                scrollBy(scroller, vx * dt, vy * dt);
                glideRef.current = win.requestAnimationFrame(step);
            };
            glideRef.current = win.requestAnimationFrame(step);
        };
        const swallowClick = (e) => { e.stopPropagation(); e.preventDefault(); };

        function onMove(e) {
            if (!press) return;
            // The button came up somewhere this never heard about: end here.
            if (e.buttons === 0) { onUp(); return; }
            if (!press.panning) {
                if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < GRAB_THRESHOLD_PX) return;
                press.panning = true;
                setGrabbing(true);
                setPanStyles(true);
                win.getSelection?.()?.removeAllRanges?.();
            }
            const now = win.performance.now();
            const dx = e.clientX - press.x;
            const dy = e.clientY - press.y;
            const dt = Math.max(1, now - press.t);
            scrollBy(press.scroller, -dx, -dy);
            // Smoothed release speed, so one jittery last event does not decide the throw.
            press.vx = 0.7 * (-dx / dt) + 0.3 * press.vx;
            press.vy = 0.7 * (-dy / dt) + 0.3 * press.vy;
            press.x = e.clientX;
            press.y = e.clientY;
            press.t = now;
        }
        function onUp() {
            listen(false);
            const p = press;
            press = null;
            if (!p?.panning) return;
            setGrabbing(false);
            setPanStyles(false);
            // The click that ends a pan is not a click on what it ended over.
            win.addEventListener('click', swallowClick, { capture: true, once: true });
            win.setTimeout(() => win.removeEventListener('click', swallowClick, true), 0);
            if (win.performance.now() - p.t < GLIDE_WINDOW_MS) glide(p.scroller, p.vx, p.vy);
        }
        const onDown = (e) => {
            stopGlide();
            if (e.pointerType !== 'mouse' || e.button !== 0) return;
            const target = e.target;
            if (!(target instanceof win.Element) || !node.contains(target)) return;
            // A control marked `data-grab-through` (a link that is also a picture to
            // pan from — the pipeline card's preview, req #4027) still grabs.
            const control = target.closest(GRAB_EXCLUDE);
            if (control && !control.hasAttribute('data-grab-through')) return;
            press = {
                x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
                t: win.performance.now(), vx: 0, vy: 0, panning: false,
                scroller: scrollParentOf(node),
            };
            listen(true);
        };
        // A wheel turn takes over from a glide.
        const onWheel = () => stopGlide();

        node.addEventListener('pointerdown', onDown);
        node.addEventListener('wheel', onWheel, { passive: true });
        return () => {
            stopGlide();
            node.removeEventListener('pointerdown', onDown);
            node.removeEventListener('wheel', onWheel);
            listen(false);
            if (press?.panning) { setPanStyles(false); setGrabbing(false); }
            press = null;
        };
    }, [node, enabled]);

    return { ref, grabbing };
}
