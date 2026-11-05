// plusDrag.js — the Requirement Filer's + can be DRAGGED (req #4197): "click the
// plus and drag it; the drag preview becomes just the plus sign and it will
// become the pointer, as is done with drag of the whole requirement bar. It
// highlights blue and I can drag it around and then drop it on the target HTML
// element or area, and then the requirement editor initiates. This works whether
// the pushpin is clicked or not."
//
// A press on the + that travels PLUS_DRAG_PX becomes a drag (a press that does
// not is the click it always was). While it lasts the native cursor is hidden
// and a blue + — the whole preview — rides the pointer; the element under it is
// outlined and named by the SAME overlay the pinned head drag uses
// (filerHover.js showAim), so the picker reads the same either way. Letting go
// DROPS: the caller files the requirement with the drop point as its place. The
// click the browser would send after the release is swallowed, so a drag never
// also files. Escape, or a drop back on the filer itself, files nothing.
//
// DOM only, no React: the ghost and the outline are nodes moved by style per
// frame, and take no pointer, so neither is what the probe finds.

import { AIM_COLOR, AIM_POINT_Z, aimAt, clearAim, showAim } from './filerHover';

/** How far the press must travel to be a drag rather than a click, px. */
export const PLUS_DRAG_PX = 5;
/** The ghost +'s box, px. */
export const PLUS_GHOST_PX = 28;
/** Above the aim reticle (AIM_POINT_Z) and the editor (EDITOR_Z). */
export const PLUS_GHOST_Z = AIM_POINT_Z + 2;
const GHOST_ID = 'darwin-requirement-plus-drag';
const STYLE_ID = 'darwin-requirement-plus-drag-style';

/** The drop point as the 2px probe rect `captureFiledFrom` takes (`dropRect`). */
export const dropRectAt = (x, y) => ({ x: Math.round(x) - 1, y: Math.round(y) - 1, w: 2, h: 2 });

/** The same, in the aim overlay's {left, top, width, height}. */
const aimRectAt = (x, y) => ({ left: x - 1, top: y - 1, width: 2, height: 2 });

function ghost(doc) {
    let g = doc.getElementById(GHOST_ID);
    if (g) return g;
    g = doc.createElement('div');
    g.id = GHOST_ID;
    g.setAttribute('data-testid', 'requirement-plus-drag');
    g.setAttribute('aria-hidden', 'true');
    Object.assign(g.style, {
        position: 'fixed', left: '0', top: '0', zIndex: String(PLUS_GHOST_Z), pointerEvents: 'none',
        width: `${PLUS_GHOST_PX}px`, height: `${PLUS_GHOST_PX}px`, marginLeft: `${-PLUS_GHOST_PX / 2}px`,
        marginTop: `${-PLUS_GHOST_PX / 2}px`, boxSizing: 'border-box', borderRadius: '50%',
        border: `2px solid ${AIM_COLOR}`, background: 'rgba(79, 195, 247, 0.22)', color: AIM_COLOR,
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.55), 0 0 12px rgba(79, 195, 247, 0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
    });
    g.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">'
        + '<path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
    doc.body.appendChild(g);
    return g;
}

/** While a drag lasts: no native cursor (the + IS the pointer), no text selected. */
function dragStyle(doc) {
    let s = doc.getElementById(STYLE_ID);
    if (s) return s;
    s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent = '* { cursor: none !important; user-select: none !important; -webkit-user-select: none !important; }';
    doc.head.appendChild(s);
    return s;
}

/** Whether the point is over the filer or its editor — a drop there is a cancel. */
function overOwnWindow(doc, x, y) {
    const els = typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint(x, y) : [];
    return els.some(el => el.closest?.('[data-testid="requirement-filer"], [data-testid="requirement-editor"], [data-testid="requirement-filer-add"]'));
}

/** Swallows the click the browser sends after a release (it would file as a plain press):
 *  the first one, or none if it never comes. */
function swallowNextClick(win) {
    const swallow = (e) => { e.stopPropagation(); e.preventDefault(); off(); };
    const off = () => win.removeEventListener('click', swallow, true);
    win.addEventListener('click', swallow, true);
    win.setTimeout(off, 0);
}

/**
 * Begins tracking a press on the +. Call from its pointerdown. `onDrop({ x, y,
 * rect })` runs once on a release past the threshold (`rect` — dropRectAt),
 * `onMove({ x, y })` on each frame of the drag, `onStart()` when the press becomes
 * a drag, and `onEnd()` when it is over — dropped, cancelled or never a drag.
 * Escape cancels (the release that follows files nothing and clicks nothing); a
 * release that never arrives (the button is up when the pointer next moves, the
 * window loses focus) abandons the drag. Returns a function that abandons the press.
 */
export function beginPlusDrag(down, { onDrop, onMove, onStart, onEnd, doc = document } = {}) {
    if (down.button != null && down.button !== 0) return () => {};
    const win = doc.defaultView || window;
    const start = { x: down.clientX, y: down.clientY };
    let dragging = false;
    let last = start;
    let frame = 0;
    let scheduled = false;
    let done = false;

    const paint = () => {
        scheduled = false;
        const g = ghost(doc);
        g.style.transform = `translate(${last.x}px, ${last.y}px)`;
        if (overOwnWindow(doc, last.x, last.y)) clearAim(doc);
        else showAim(aimAt(aimRectAt(last.x, last.y), doc), '', doc);
        onMove?.({ x: last.x, y: last.y });
    };
    // `after`: 'release' — the release has just happened, swallow its click; 'pending' —
    // the button is still down (Escape), swallow the click of the release to come; null — neither.
    const cleanup = (after = null) => {
        if (done) return;
        done = true;
        win.removeEventListener('pointermove', move, true);
        win.removeEventListener('pointerup', up, true);
        win.removeEventListener('pointercancel', abandon, true);
        win.removeEventListener('keydown', key, true);
        win.removeEventListener('blur', abandon, true);
        if (scheduled) win.cancelAnimationFrame(frame);
        doc.getElementById(GHOST_ID)?.remove();
        doc.getElementById(STYLE_ID)?.remove();
        clearAim(doc);
        if (dragging && after === 'release') swallowNextClick(win);
        if (dragging && after === 'pending') {
            win.addEventListener('pointerup', () => swallowNextClick(win), { capture: true, once: true });
        }
        onEnd?.();
    };
    function move(e) {
        // A mouse that is no longer down: its release went somewhere we never heard.
        if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) { cleanup(); return; }
        last = { x: e.clientX, y: e.clientY };
        if (!dragging) {
            if (Math.hypot(last.x - start.x, last.y - start.y) < PLUS_DRAG_PX) return;
            dragging = true;
            dragStyle(doc);
            onStart?.();
        }
        e.preventDefault();
        if (!scheduled) { scheduled = true; frame = win.requestAnimationFrame(paint); }
    }
    function up(e) {
        if (!dragging) { cleanup(); return; }
        const point = { x: e.clientX ?? last.x, y: e.clientY ?? last.y };
        const cancelled = overOwnWindow(doc, point.x, point.y);
        cleanup('release');
        if (!cancelled) onDrop?.({ ...point, rect: dropRectAt(point.x, point.y) });
    }
    function abandon() { cleanup(); }
    function key(e) {
        if (e.key === 'Escape' && dragging) { e.stopPropagation(); e.preventDefault(); cleanup('pending'); }
    }
    win.addEventListener('pointermove', move, true);
    win.addEventListener('pointerup', up, true);
    win.addEventListener('pointercancel', abandon, true);
    win.addEventListener('keydown', key, true);
    win.addEventListener('blur', abandon, true);
    return abandon;
}
