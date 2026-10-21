// planPressGesture.js — quick click / double click / long press on one target
// (req #3580, user directive: "fast click to zoom, long click to edit, double
// click to double zoom").
//
// ── WHY POINTER EVENTS, AND WHY NOT `click`/`dblclick` ─────────────────────
// The plan canvas's d3-zoom behaviour owns MOUSEDOWN on the panel and stops it
// (`stopImmediatePropagation`), so a React `onMouseDown` on anything over the
// canvas never runs, and a drag-pan that ends on the same element still emits a
// native `click`. `pointerdown`/`pointerup` are separate events d3 never
// touches, so this module reads those and decides the gesture itself — moving
// further than `PRESS_SLOP_PX` is a pan and cancels everything.
//
// ── THE THREE GESTURES ─────────────────────────────────────────────────────
//   long press   held still for `LONG_PRESS_MS` — fires WHILE STILL HELD, so
//                the reader sees the editor open without having to let go; the
//                release that follows is swallowed. It is handed the PRESS
//                POINT, so the editor can put its caret where the text was
//                pressed (req #3665, `planCaretPoint.js`).
//   double click two releases on the SAME target within `DOUBLE_CLICK_MS`.
//   click        one release, fired once the double-click window has closed
//                with no second one. That wait is the price of having a double
//                click at all; a target with no `onDoubleClick` fires at once.
//
// ONE tracker serves every target on the canvas (the targets are rendered in a
// loop, where a hook per target is not allowed) — only one pointer press is
// ever in flight, so one state slot is the whole state.

// The numbers are the app-wide press timeline's (req #3662) — one file owns
// them so this canvas and every drag surface read a press identically.
import { LONG_PRESS_MS, DOUBLE_CLICK_MS, PRESS_SLOP_PX } from '../../dnd/pressTimeline';

export { LONG_PRESS_MS, DOUBLE_CLICK_MS, PRESS_SLOP_PX };

/**
 * @param {Object} [opts]
 * @param {number} [opts.longMs]
 * @param {number} [opts.doubleMs]
 * @param {number} [opts.slop]
 * @returns {{down: Function, move: Function, up: Function, cancel: Function,
 *            dispose: Function}}
 */
export function createPressTracker({
    longMs = LONG_PRESS_MS, doubleMs = DOUBLE_CLICK_MS, slop = PRESS_SLOP_PX,
} = {}) {
    let press = null;     // { key, x, y, cbs, fired, timer }
    let pending = null;   // a released single click waiting out the double window

    const clearPress = () => {
        if (press) clearTimeout(press.timer);
        press = null;
    };
    // A press that ended as neither click nor long press — it became a PAN,
    // or was taken away. A single click it was holding back (see `down`) is
    // DROPPED, not fired: firing it would start a zoom animation while the
    // reader's drag is still moving the camera, and the animation would win.
    const abortPress = () => {
        clearPress();
        if (pending && pending.timer == null) pending = null;
    };
    const flushPending = () => {
        if (!pending) return;
        clearTimeout(pending.timer);
        const { cbs } = pending;
        pending = null;
        cbs.onClick?.();
    };

    return {
        /** A pointer went down on target `key` at client (x, y). */
        down(key, x, y, cbs) {
            clearPress();
            // A press on ANOTHER target ends the first target's double window:
            // its single click is owed now, not after this press resolves. A
            // press on the SAME target holds it — this press decides whether it
            // was half of a double (a quick release), or is dropped (a long
            // press), or is owed after all (the press turned into a pan).
            if (pending) {
                if (pending.key !== key) flushPending();
                else { clearTimeout(pending.timer); pending.timer = null; }
            }
            press = {
                key, x, y, cbs, fired: false,
                timer: cbs.onLongPress ? setTimeout(() => {
                    if (!press || press.key !== key) return;
                    press.fired = true;
                    // A long press is never ALSO the second half of a double.
                    if (pending?.key === key) { clearTimeout(pending.timer); pending = null; }
                    cbs.onLongPress({ x, y });
                }, longMs) : null,
            };
        },
        /** The pointer moved; past the slop it is a pan, not a press. */
        move(x, y) {
            if (!press || press.fired) return;
            if (Math.hypot(x - press.x, y - press.y) > slop) abortPress();
        },
        /** The pointer came up on target `key`. */
        up(key) {
            if (!press || press.key !== key) { abortPress(); return; }
            const { fired, cbs } = press;
            clearPress();
            if (fired) return;                      // the long press already acted
            if (pending && pending.key === key) {   // the second release: a double
                clearTimeout(pending.timer);
                pending = null;
                (cbs.onDoubleClick || cbs.onClick)?.();
                return;
            }
            if (!cbs.onDoubleClick) { cbs.onClick?.(); return; }
            pending = { key, cbs, timer: setTimeout(flushPending, doubleMs) };
        },
        /** The press was taken away (pointercancel, the pointer left). */
        cancel() { abortPress(); },
        /**
         * A pointer went down somewhere that is NOT a target. Any click still
         * waiting out its double window is owed NOW — fired before the pan that
         * press may start, so the pan's own interrupt stops its animation rather
         * than the animation overriding the pan 260ms later.
         */
        flush() { abortPress(); flushPending(); },
        /** Unmount: drop every timer, owe nothing. */
        dispose() {
            clearPress();
            if (pending) clearTimeout(pending.timer);
            pending = null;
        },
    };
}
