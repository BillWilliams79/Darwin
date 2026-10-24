// useTitleBarLock.js — the DOM half of an Action Popup LOCKED INTO A PAGE'S
// TITLE BAR (req #3857; pure half titleBarLock.js, pattern doc
// memory/anchored-collapse-pattern.md § Locked into the title bar).
//
// While a lock is held, the popup's place in the bar is re-worked whenever the
// bar can have changed — every render, a window resize, any scroll, the bar's
// own size or content changing, and a slow poll for the bar appearing or going
// (a page navigated to, a visualizer maximized over it). `place` is
// `{ left, top, width }` in viewport px, or null: no bar drawn, or no gap in it
// wide enough — the popup then floats at its dock until there is.
//
// A head drag calls `track(x, y, color)` per move frame — the bar glows in the
// popup's frame colour while the pointer is over it, the rack's look
// (rackGlow) — and `release(x, y, rect)` on the release: the lock to take, or
// null when it was not dropped on a bar with room for it. `cancel()` ends the
// glow. `over` is true while the bar glows, so the popup itself can say it
// would lock if let go (req #3893).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { rackGlow } from './panelRack';
import {
    findTitleBar, lockFromDrop, onTitleBar, titleBarOccupied, titleBarPlace, validLock,
} from './titleBarLock';

/** The poll that notices a bar appearing or going, ms. */
const POLL_MS = 500;

const samePlace = (a, b) => a === b
    || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width);

/**
 * @param {Object} p
 * @param {?{side, x}} p.lock     the stored lock; null = not locked
 * @param {boolean} p.offered     the host offers the lock: the bar is a drop zone
 *   (a racked panel's drag included — dropped there it leaves the rack locked)
 * @param {boolean} p.racked      drawn in the rack: a held lock waits
 * @param {boolean} p.paused      a gesture is drawing the panel: leave it be
 * @param {React.RefObject} p.boxRef  the panel
 * @param {{minW, headPx, autoMaxW}} p.limits
 */
export function useTitleBarLock({ lock, offered, racked, paused, boxRef, limits }) {
    const held = offered && !racked ? validLock(lock) : null;
    const [place, setPlace] = useState(null);
    const latest = useRef(null);
    latest.current = { held, paused, limits };

    // Where it goes now. Its natural width is read with the bar's cap lifted for
    // the one read, so a gap that narrowed it never sets what it wants.
    const measure = () => {
        const { held: h, paused: p, limits: l } = latest.current;
        if (p) return;
        const box = boxRef.current;
        const bar = h && box ? findTitleBar(box.ownerDocument) : null;
        let next = null;
        if (bar) {
            const { width, maxWidth } = box.style;
            box.style.width = 'max-content';
            box.style.maxWidth = `${l.autoMaxW}px`;
            const naturalW = Math.max(box.offsetWidth, l.minW);
            box.style.width = width;
            box.style.maxWidth = maxWidth;
            next = titleBarPlace(h, bar.rect, titleBarOccupied(bar.el), naturalW, l);
        }
        setPlace(prev => (samePlace(prev, next) ? prev : next));
    };
    useLayoutEffect(measure);

    const lockKey = held ? `${held.side}${held.x}` : null;
    useEffect(() => {
        if (!lockKey) return undefined;
        let raf = 0;
        const schedule = () => {
            if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); });
        };
        let observed = null;
        const observers = [];
        const watch = () => {
            const el = findTitleBar(boxRef.current?.ownerDocument || document)?.el ?? null;
            if (el === observed) return;
            observers.splice(0).forEach(o => o.disconnect());
            observed = el;
            if (!el) return;
            if (typeof ResizeObserver !== 'undefined') {
                const ro = new ResizeObserver(schedule);
                ro.observe(el);
                observers.push(ro);
            }
            const mo = new MutationObserver(schedule);
            mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
            observers.push(mo);
        };
        const poll = () => { watch(); schedule(); };
        watch();
        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', schedule, true);
        const timer = setInterval(poll, POLL_MS);
        return () => {
            clearInterval(timer);
            window.removeEventListener('resize', schedule);
            window.removeEventListener('scroll', schedule, true);
            observers.forEach(o => o.disconnect());
            if (raf) cancelAnimationFrame(raf);
        };
        // `measure` reads everything it needs through `latest`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lockKey]);

    // The drop glow: on the bar under the pointer, off everywhere else.
    const glowRef = useRef(null);
    const [over, setOver] = useState(false);
    const unglow = () => {
        const g = glowRef.current;
        if (!g) return;
        g.el.style.boxShadow = g.prev;
        g.el.removeAttribute('data-title-bar-over');
        glowRef.current = null;
        setOver(false);
    };
    useEffect(() => unglow, []);
    const track = (x, y, color) => {
        if (!offered) return;
        const bar = findTitleBar(boxRef.current?.ownerDocument || document);
        const el = bar && onTitleBar(x, y, bar.rect) ? bar.el : null;
        if (glowRef.current?.el === el) return;
        unglow();
        if (!el) return;
        glowRef.current = { el, prev: el.style.boxShadow };
        el.style.boxShadow = rackGlow(color);
        el.setAttribute('data-title-bar-over', '1');
        setOver(true);
    };
    const release = (x, y, rect) => {
        unglow();
        if (!offered) return null;
        const bar = findTitleBar(boxRef.current?.ownerDocument || document);
        if (!bar || !onTitleBar(x, y, bar.rect)) return null;
        // Only where it can be drawn: a bar with no gap wide enough is no drop
        // zone. Dropped over the bar's own elements, it is locked where it
        // lands — the gap beside them — not under them.
        const fits = titleBarPlace(lockFromDrop(rect, bar.rect), bar.rect, titleBarOccupied(bar.el),
            Math.max(rect.width, limits.minW), limits);
        return fits ? lockFromDrop(fits, bar.rect) : null;
    };

    return { place: held ? place : null, over, track, release, cancel: unglow };
}
