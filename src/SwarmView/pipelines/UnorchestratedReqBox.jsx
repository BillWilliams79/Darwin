// UnorchestratedReqBox.jsx — the Plan visualizer's "Orchestrables" box
// (req #3583; titled and outlined in purple by req #3605; retitled from
// "Orchestration Ready" by req #3648).
//
// A floating panel in the canvas's top-right corner listing every requirement
// that is ready to run but sits on no plan step. Each row is the SOURCE of a
// drag: pick it up, drop it on a step card, and it is seated there. That is
// what makes it "go hand in hand with" the visualizer's drag-and-drop (req
// #3581) — that one moves work between steps, this one feeds new work in.
//
// ── NATIVE HTML5 DRAG, NO HANDLE ───────────────────────────────────────────
// The whole row is draggable. The browser's own drag image is a full-size
// snapshot of the row, so what follows the cursor looks exactly like what was
// picked up. The row left behind greys out — set one frame AFTER dragstart,
// because the browser snapshots the drag image when the handler returns, and
// greying synchronously would grey the image too. Nothing on the canvas
// re-lays-out while the requirement is in the air; the drop target is shown
// by an outline overlay the visualizer draws (see its `seatTarget`).
//
// ── IT IS CHROME, NOT CANVAS ───────────────────────────────────────────────
// `data-viz-chrome` keeps d3-zoom from taking a mousedown here as the start of
// a pan (which would also `preventDefault` the native drag away), and keeps the
// world-click hit-test from firing whatever bead lies beneath. The WHEEL is
// stopped at this element natively, but only when the list can actually
// scroll: d3 binds its wheel listener to the container, so a React handler
// (delegated to the root, an ancestor) would run too late to matter.
//
// ── MOVED BY ITS TITLE BAR, FIXED TO THE PANE (user directive) ────────────
// The box opens in the panel's top-right corner. Drag its TITLE BAR and it is
// relocated wherever it is dropped, in PANEL coordinates — it never pans or
// zooms with the plan, it just stays put while the plan moves under it.
// Pointer events with capture, one pointer at a time, a slop before a press
// counts as a move (so a click that wobbles does not pin it), and the −/+ is
// its own button so a move never toggles it. Double-click the title bar to
// send it home. The spot is remembered per browser (a viewer convenience —
// localStorage, wrapped, since it may be unavailable) and written once, on
// release, only if the box moved. CSS `clamp` keeps a remembered spot inside a
// pane that has since become smaller, and `minHeight` keeps the title bar whole
// at the pane's bottom edge until the box is lifted (req #3677). A box dropped in the RIGHT half is remembered by
// its distance from the right edge, so it stays flush right as the zoom resizes
// it or the window narrows — the same anchoring its home corner has.
//
// ── DROPPED ON A STEP, IT SEATS THE WHOLE SET (req #3608) ─────────────────
// The same title-bar move doubles as a drag of EVERY requirement the box
// lists. Each move frame hands the pointer to the visualizer (`onMoveOver`),
// which outlines the step card beneath it; on release `onMoveDrop` is offered
// the drop, and when it takes it (the pointer is over a step) the box goes back
// to where it was before the drag — that gesture was a seat, not a relocation —
// and the spot is not remembered. The visualizer asks before writing anything.
// An empty box has nothing to seat, so it only ever moves.
//
// While a carrying move is under way (req #3614) the box turns see-through, so
// the step card it is aimed at can be read; undone on release.
// `onCarryingChange` tells the visualizer, which then draws its seat-target
// outline above the box.
//
// ── FULL SIZE THE WHOLE TIME (req #3677, user directive) ──────────────────
// A move never changes the box's size: the list stays open while carried
// (#3614 folded it), the grip's strip stays while the grip hides, and the move
// is clamped by the box's FULL height — not just its title bar — so it cannot
// be dragged low enough for the pane's `maxHeight` to squeeze it. A placed box
// that later GROWS (unfolded, zoomed in, more rows, a smaller pane) is lifted
// to stay whole, and a corner stretch stops where the whole box still fits.
//
// ── SIZED LIKE THE REQUIREMENTS (user directive) ───────────────────────────
// Its TYPE is the
// requirement ids' own on-screen size — `fontPx` is the card's requirement font
// times the live zoom — and every dimension below is in `em`, so the whole box
// shrinks as the reader zooms out and grows as they zoom in, in step with the
// marks it feeds — held within 9–16px (`unseatedBoxFontPx`) so it stays
// legible zoomed far out and never covers the canvas zoomed in (user ruling).
//
// ── AS WIDE AS A STEP (req #3620, user directive) ──────────────────────────
// The one dimension NOT in em: the WIDTH is the step card's own on-screen
// frame width (`widthPx`, from `unseatedBoxWidthPx`), so it follows the Step
// Width rung and the zoom — "whatever the step width, the box will mirror its
// width". Never narrower than its whole title bar (`UNSEATED_MIN_WIDTH_EM`):
// zoomed out past the type's 9px floor, a card is too thin to hold it.
//
// ── STRETCHED BY ITS CORNER, IN THREE TEXT SIZES (req #3654) ─────────────
// On top of all that, the reader may drag the grip in the box's bottom corner
// to stretch it wider or narrower, taller or shorter. Stretched a full step
// wider its text goes ONE size bigger, a full step narrower ONE size smaller,
// and never further — three sizes (user directive; the arithmetic is
// `unseatedResizedBox`). The grip sits on the corner AWAY from the side the box
// is anchored to — bottom-left at home or when remembered from the right, so
// it grows leftward off the right edge it stays flush with; bottom-right when
// remembered from the left. The stretch is held relative to the zoom size, so
// a stretched box still scales with the zoom; it is remembered per browser
// like the spot, written once on release, and double-clicking the grip puts
// the box back to its zoom size. The grip has its own strip under the list so
// it never covers a row, and is hidden while folded, carried or moved.
//
// ── A CATEGORY COLOR BAR ON EVERY ROW (req #3619) ─────────────────────────
// Like the aggregator card, the box gathers requirements from many categories,
// so each row leads with the same pill that card draws (RequirementRow, req
// #2752): the category's own color as the fill, outlined in a same-hue
// lightened shade so a very dark color still has an edge — the box is always
// dark, so it is the card's dark-mode rule. A row with no color keeps the slot,
// transparent, so the ids stay in one column.
//
// ── FOLDED, IT IS A NARROW "OR" BAR (req #3648, user directive) ───────────
// The count leads the title bar as a badge, then the name, then the −/+.
// Folding the box swaps the name for "OR" and narrows the box to exactly that
// bar — badge, "OR", toggle, nothing else changed — and both the width and the
// list's height animate, so it shrinks in and out smoothly. The width only
// transitions for the length of a fold: the zoom resizes the box on every
// wheel frame, and a transition there would make it trail the plan. Reduced
// motion turns both animations off.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import useMediaQuery from '@mui/material/useMediaQuery';
import { lighten } from '@mui/material/styles';

import { CARD_FRAME_W, PLAN_VIZ_PALETTE as P } from './pipelinePlanLayout';
import {
    UNSEATED_MIN_LIST_EM, UNSEATED_REQ_MIME, unseatedMinStretchPx, unseatedResizedBox,
} from './pipelineUnseated';
import { usePlanViewSetting } from './planViewSettings';

const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

/** The box's outline (req #3605, user directive: "a strong visible purple" —
 *  neither dark nor pastel). ~4.5:1 against the box's own background. */
const OUTLINE = '#a64dff';

/** Panel inset of the home corner, px. */
const CORNER_INSET = 8;
/** The title bar's height in em — what must stay inside the pane. */
const HEADER_EM = 3;
/** Pointer travel, px, before a title-bar press becomes a move. */
const MOVE_SLOP = 4;
/** Vertical travel, px, before a corner stretch takes the height too: a
 *  sideways stretch that drifts a little leaves the list its natural height. */
const STRETCH_HEIGHT_SLOP = 12;
/** Bounds on a remembered stretch, so a hand-edited value cannot draw nonsense. */
const MAX_STRETCH_WS = 20;
const MAX_STRETCH_H_EM = 400;
/** The list's height cap, in em, when it is not stretched. */
const LIST_MAX_EM = 26;
/** Slack, px, between the box's full height and the pane's bottom inset: the
 *  parts are measured as whole-px `offsetHeight`s of a fractional-em layout. */
const ROUNDING_SLACK_PX = 2;
/** How long a fold or unfold animates, ms. */
export const FOLD_MS = 220;
/** The folded bar's fixed parts, in em: the title bar's side padding (2 × 0.8),
 *  its two gaps (2 × 0.6), the toggle (1.6em of its own 1.25em type = 2.0) and
 *  a little slack. The badge and "OR" itself are added in `ch`. */
const FOLDED_FIXED_EM = 1.6 + 1.2 + 2.0 + 0.6;
/** The count badge's side padding (2 × 0.45) and its floor, in em. */
const BADGE_PAD_EM = 0.9;
const BADGE_MIN_EM = 1.8;

/** A double-click this soon after a move ended is the move's own release
 *  pairing with a click, not a request to send the box home. */
const DBLCLICK_AFTER_MOVE_MS = 500;
const POS_STORAGE_KEY = 'darwin-plan-unseated-box-pos';
const SIZE_STORAGE_KEY = 'darwin-plan-unseated-box-size';

/** The bar's edge: a same-hue lightened shade of its fill, or a neutral edge
 *  for a value MUI cannot parse (RequirementRow's rule, req #2752). */
function barEdge(color) {
    try { return lighten(color, 0.45); } catch { return 'rgba(128,128,128,0.5)'; }
}

/** The box's heights, px (req #3677): `frame` is everything but the list —
 *  title bar, grip strip, borders — and `full` adds the list at its natural
 *  height (the stretched one, else its rows up to `LIST_MAX_EM`). Summed from
 *  the parts, never read off the box, so neither the pane's `maxHeight`
 *  squeezing it nor a fold mid-animation can make it read short. Border-box. */
function boxHeights({ box, header, strip, list }, open, { listHeightPx, fontPx }) {
    const frame = (header?.offsetHeight ?? 0) + (strip?.offsetHeight ?? 0)
        + box.offsetHeight - box.clientHeight;
    if (!open || !list) return { frame, full: frame };
    const natural = listHeightPx ?? Math.min(LIST_MAX_EM * fontPx,
        list.scrollHeight + list.offsetHeight - list.clientHeight);
    return { frame, full: frame + natural };
}

function readPos() {
    try {
        const v = JSON.parse(window.localStorage.getItem(POS_STORAGE_KEY));
        if (!v || !Number.isFinite(v.y)) return null;
        if (Number.isFinite(v.x)) return { x: v.x, y: v.y };
        if (Number.isFinite(v.r)) return { r: v.r, y: v.y };
        return null;
    } catch { return null; }
}
function writePos(pos) {
    try {
        if (pos) window.localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos));
        else window.localStorage.removeItem(POS_STORAGE_KEY);
    } catch { /* storage unavailable — the box still moves, it just forgets */ }
}

function readSize() {
    try {
        const v = JSON.parse(window.localStorage.getItem(SIZE_STORAGE_KEY));
        if (!v || !Number.isFinite(v.ws) || v.ws <= 0) return null;
        return { ws: Math.min(v.ws, MAX_STRETCH_WS),
            hEm: Number.isFinite(v.hEm) && v.hEm > 0
                ? Math.min(v.hEm, MAX_STRETCH_H_EM) : null };
    } catch { return null; }
}
function writeSize(size) {
    try {
        if (size) window.localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size));
        else window.localStorage.removeItem(SIZE_STORAGE_KEY);
    } catch { /* storage unavailable — the box still stretches, it just forgets */ }
}

export default function UnorchestratedReqBox({
    items, categoryColors = {}, isLoading = false, isError = false,
    fontPx = 12, widthPx = CARD_FRAME_W, statusColor = P.req,
    draggingId = null, onDragStartItem, onDragEndItem, onOpen,
    onMoveOver, onMoveDrop, onCarryingChange,
}) {
    // Open by default: the box exists to be seen next to the plan it feeds.
    // REMEMBERED across every transition (req #3651) — it was local state, so a
    // reader who folded it found it open again after any Back or mode switch.
    const [open, setOpen] = usePlanViewSetting('unseatedOpen');
    // True for the length of a fold/unfold, so the width transitions then and
    // only then (see the header).
    const [folding, setFolding] = useState(false);
    const foldTimerRef = useRef(null);
    useEffect(() => () => clearTimeout(foldTimerRef.current), []);
    const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const foldMs = reduceMotion ? 0 : FOLD_MS;
    // The list's width, px, held at the OPEN box's inner width for the length
    // of a fold (req #3684). Titles wrap to two lines, so a row's height now
    // depends on the width — and Collapse measures the height to unfold to
    // before the width transition has moved, at the folded width, where every
    // title wraps: the list would animate to too tall and snap back. Held, it
    // lays out at the width it ends at and the narrow box just clips it.
    const [foldListW, setFoldListW] = useState(null);
    const toggleOpen = () => {
        setOpen((v) => !v);
        if (!foldMs) return;
        setFolding(true);
        setFoldListW(openListWidth());
        clearTimeout(foldTimerRef.current);
        foldTimerRef.current = setTimeout(() => {
            setFolding(false);
            setFoldListW(null);
        }, foldMs + 50);
    };
    const listRef = useRef(null);
    const boxRef = useRef(null);
    // The open box's inner width, px: its drawn width capped at the pane (the
    // `maxWidth` below), less its border. Null when it cannot be measured.
    const openListWidth = () => {
        const box = boxRef.current;
        const pane = box?.offsetParent;
        if (!box || !pane) return null;
        const border = box.offsetWidth - box.clientWidth;
        const outer = Math.min(drawn.widthPx, pane.clientWidth - 2 * CORNER_INSET);
        return getComputedStyle(box).boxSizing === 'border-box' ? outer - border : outer;
    };
    const headerRef = useRef(null);
    const stripRef = useRef(null);
    // `null` = home (top-right); else panel-relative px of the top-left corner.
    const [pos, setPos] = useState(readPos);
    // The gesture lives in a ref; `moving` is state only so the cursor
    // re-renders on press and release.
    const moveRef = useRef(null);
    const [moving, setMoving] = useState(false);
    // True from the first move frame of a title-bar move that carries rows
    // until it ends (req #3614): the box turns see-through so the step card
    // beneath it can be read, and is restored on release.
    const [carrying, setCarrying] = useState(false);
    useEffect(() => { onCarryingChange?.(carrying); }, [carrying]);
    const lastMoveEndRef = useRef(0);
    // `null` = the zoom size; else the reader's stretch (req #3654), `{ws, hEm}`.
    const [size, setSize] = useState(readSize);
    const resizeRef = useRef(null);
    const [resizing, setResizing] = useState(false);
    const lastResizeEndRef = useRef(0);
    const drawn = unseatedResizedBox(widthPx, fontPx, size);
    // The zoom size, read LIVE by the stretch: a wheel mid-gesture still zooms.
    const zoomRef = useRef({ widthPx, fontPx });
    zoomRef.current = { widthPx, fontPx };
    // Grows away from the side it is anchored to (see the header).
    const anchoredRight = !pos || pos.r != null;

    const onBarDown = (e) => {
        if (moveRef.current || e.button !== 0 || e.target.closest('button')) return;
        const box = boxRef.current;
        const pane = box?.offsetParent;
        if (!box || !pane) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        moveRef.current = {
            id: e.pointerId, sx: e.clientX, sy: e.clientY,
            left: box.offsetLeft, top: box.offsetTop, last: null,
            // Where to send the box back to if this drag turns out to be a seat.
            before: pos, carries: items.length > 0,
        };
        setMoving(true);
    };
    const onBarMove = (e) => {
        const m = moveRef.current;
        if (!m || e.pointerId !== m.id) return;
        const dx = e.clientX - m.sx;
        const dy = e.clientY - m.sy;
        if (!m.last && Math.hypot(dx, dy) <= MOVE_SLOP) return;
        // Limits read LIVE, every frame: a wheel over the bar still zooms, and
        // the box's em size changes with it mid-drag.
        const box = boxRef.current;
        const pane = box?.offsetParent;
        if (!box || !pane) return;
        const clampTo = (v, hi) => Math.min(Math.max(0, v), Math.max(0, hi));
        m.last = {
            x: Math.round(clampTo(m.left + dx, pane.clientWidth - box.offsetWidth)),
            y: Math.min(Math.round(Math.max(0, m.top + dy)), maxTop(box, pane)),
        };
        setPos(m.last);
        if (m.carries) {
            setCarrying(true);
            onMoveOver?.(e.clientX, e.clientY);
        }
    };
    const onBarUp = (e) => {
        const m = moveRef.current;
        if (!m || e.pointerId !== m.id) return;
        moveRef.current = null;
        setMoving(false);
        setCarrying(false);
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        if (!m.last) return;
        lastMoveEndRef.current = Date.now();
        if (m.carries) {
            // A cancelled pointer (or lost capture) is no drop: clear the
            // outline and keep the box wherever it got to.
            const seated = e.type === 'pointerup'
                && !!onMoveDrop?.(e.clientX, e.clientY);
            if (!seated) onMoveOver?.(null, null);
            if (seated) {
                setPos(m.before);
                return;
            }
        }
        // Anchor to the nearer side: right half → remembered from the right.
        const box = boxRef.current;
        const pane = box?.offsetParent;
        let final = m.last;
        if (box && pane && m.last.x + box.offsetWidth / 2 > pane.clientWidth / 2) {
            final = { r: Math.max(0, pane.clientWidth - m.last.x - box.offsetWidth),
                y: m.last.y };
        }
        setPos(final);
        writePos(final);
    };
    const goHome = () => { setPos(null); writePos(null); };

    const heights = (box) => boxHeights({ box, header: headerRef.current,
        strip: stripRef.current, list: listRef.current }, open, drawn);
    // The lowest top at which the WHOLE box still clears the pane's bottom
    // inset — the one `maxHeight` holds — so it is never squeezed (req #3677).
    const maxTop = (box, pane) => Math.max(0, Math.floor(
        pane.clientHeight - CORNER_INSET - ROUNDING_SLACK_PX - heights(box).full));
    // A placed box that has GROWN since it was dropped — unfolded, zoomed in,
    // more rows, a smaller pane, a seat sending it back — is lifted so it is
    // still whole, never squeezed. Not remembered: the spot the reader chose
    // stays theirs, and a smaller pane re-lifts it on the next load.
    const reclampRef = useRef(null);
    reclampRef.current = () => {
        if (!pos || moveRef.current || resizeRef.current) return;
        const box = boxRef.current;
        const pane = box?.offsetParent;
        if (!box || !pane) return;
        const top = maxTop(box, pane);
        if (pos.y > top) setPos({ ...pos, y: top });
    };
    useLayoutEffect(() => { reclampRef.current(); });
    useEffect(() => {
        const pane = boxRef.current?.offsetParent;
        if (!pane || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(() => reclampRef.current());
        ro.observe(pane);
        return () => ro.disconnect();
    }, []);

    const onGripDown = (e) => {
        if (resizeRef.current || e.button !== 0) return;
        const box = boxRef.current;
        const pane = box?.offsetParent;
        if (!box || !pane) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        // Re-anchor to where the box is DRAWN. A remembered spot the pane's
        // clamp is overriding (zoomed wide, it no longer fits beside its edge)
        // would otherwise grow from the far edge, not the grip.
        let rebased = null;
        if (pos) {
            const at = anchoredRight
                ? { r: Math.max(0, pane.clientWidth - box.offsetLeft - box.offsetWidth),
                    y: box.offsetTop }
                : { x: box.offsetLeft, y: box.offsetTop };
            if (at.x !== pos.x || at.r !== pos.r || at.y !== pos.y) {
                rebased = at;
                setPos(at);
            }
        }
        const room = anchoredRight ? box.offsetLeft + box.offsetWidth
            : pane.clientWidth - box.offsetLeft;
        const list = listRef.current;
        resizeRef.current = {
            id: e.pointerId, sx: e.clientX, sy: e.clientY,
            // Border-box, like the `height` it becomes.
            w: box.offsetWidth, h: list?.offsetHeight ?? null, right: anchoredRight,
            maxW: Math.min(room, pane.clientWidth - 2 * CORNER_INSET),
            // To the pane's bottom inset with the grip strip and border still
            // above it — no taller than the WHOLE box can be seen (req #3677).
            maxH: list ? pane.clientHeight - CORNER_INSET - ROUNDING_SLACK_PX
                - box.offsetTop - heights(box).frame : 0,
            hEm: size?.hEm ?? null, vertical: false, last: null, rebased,
        };
        setResizing(true);
    };
    const onGripMove = (e) => {
        const r = resizeRef.current;
        if (!r || e.pointerId !== r.id) return;
        const dx = e.clientX - r.sx;
        const dy = e.clientY - r.sy;
        if (!r.last && Math.hypot(dx, dy) <= MOVE_SLOP) return;
        const clampTo = (v, lo, hi) => Math.min(Math.max(lo, v), Math.max(lo, hi));
        const z = zoomRef.current;
        const w = clampTo(r.w + (r.right ? -dx : dx), unseatedMinStretchPx(z.fontPx), r.maxW);
        // Only a gesture that has gone up or down sets the height; a sideways
        // stretch leaves the list its natural height.
        if (Math.abs(dy) > STRETCH_HEIGHT_SLOP) r.vertical = true;
        let hEm = r.hEm;
        if (r.vertical && r.h != null) {
            hEm = clampTo(r.h + dy, UNSEATED_MIN_LIST_EM * z.fontPx, r.maxH) / z.fontPx;
        }
        r.last = { ws: w / z.widthPx, hEm };
        setSize(r.last);
    };
    const onGripUp = (e) => {
        const r = resizeRef.current;
        if (!r || e.pointerId !== r.id) return;
        resizeRef.current = null;
        setResizing(false);
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        if (!r.last) return;
        lastResizeEndRef.current = Date.now();
        writeSize(r.last);
        // Remembered with the stretch it made room for.
        if (r.rebased) writePos(r.rebased);
    };
    const onGripDoubleClick = (e) => {
        e.stopPropagation();
        if (Date.now() - lastResizeEndRef.current < DBLCLICK_AFTER_MOVE_MS) return;
        setSize(null);
        writeSize(null);
    };
    const onBarDoubleClick = (e) => {
        if (e.target.closest('button')) return;
        if (Date.now() - lastMoveEndRef.current < DBLCLICK_AFTER_MOVE_MS) return;
        goHome();
    };

    // Geometry in `style` (it changes on every move frame — see fontSize below).
    const clampTop = (y) => `clamp(0px, ${y}px, calc(100% - ${HEADER_EM}em))`;
    // The DRAWN width — `maxWidth` caps it at the pane — so this agrees with
    // the move clamp, which reads `offsetWidth`.
    const count = items.length;
    // Folded, the box is exactly its "OR" bar wide: the badge holds the count's
    // digits (or the one-character loading/error mark) and "OR" is two.
    const badgeChars = isError || isLoading ? 1 : String(count).length;
    const foldedW = `calc(${FOLDED_FIXED_EM}em + 2ch`
        + ` + max(${BADGE_MIN_EM}em, ${badgeChars}ch + ${BADGE_PAD_EM}em) + 4px)`;
    const drawnW = open ? `min(${drawn.widthPx}px, 100% - ${2 * CORNER_INSET}px)`
        : `min(${foldedW}, 100% - ${2 * CORNER_INSET}px)`;
    const clampSide = (v) => `clamp(0px, ${v}px, calc(100% - ${drawnW}))`;
    const placement = pos
        ? { ...(pos.r != null ? { right: clampSide(pos.r) } : { left: clampSide(pos.x) }),
            top: clampTop(pos.y),
            // Never below the title bar: parked at the bottom edge it shows
            // the bar whole rather than a squeezed sliver.
            maxHeight: `max(${HEADER_EM}em, calc(100% - ${clampTop(pos.y)} - ${CORNER_INSET}px))` }
        : { top: CORNER_INSET, right: CORNER_INSET,
            maxHeight: `calc(100% - ${2 * CORNER_INSET}px)` };

    useEffect(() => {
        const el = listRef.current;
        if (!el) return undefined;
        const onWheel = (ev) => {
            if (el.scrollHeight > el.clientHeight) ev.stopPropagation();
        };
        el.addEventListener('wheel', onWheel, { passive: true });
        return () => el.removeEventListener('wheel', onWheel);
    }, [open]);

    // No grip while folded or being moved (its corner follows the side the
    // box is anchored to, which a move is changing). A move keeps the grip's
    // STRIP, so the box stays its full height (req #3677).
    const gripShown = open && !moving;
    // A grip that goes away mid-stretch ends the stretch.
    useEffect(() => {
        if (gripShown || !resizeRef.current) return;
        resizeRef.current = null;
        setResizing(false);
    }, [gripShown]);

    return (
        <Box ref={boxRef} data-viz-chrome="unseated" data-viz-unseated=""
             data-testid="pipeline-viz-unseated"
             data-carrying={carrying ? '1' : '0'}
             data-text-step={drawn.step}
             data-stretched={size ? '1' : '0'}
             data-pos={!pos ? 'home'
                 : (pos.r != null ? `r${pos.r},${pos.y}` : `${pos.x},${pos.y}`)}
             // Everything inside is in em off this one number. In `style`, NOT
             // `sx`: it changes on every zoom frame, and each distinct value
             // through `sx` makes Emotion mint (and never free) a new rule —
             // the badge layer's own "geometry in style" rule.
             data-open={open ? '1' : '0'}
             style={{ fontSize: `${drawn.fontPx}px`,
                      width: open ? `${drawn.widthPx}px` : foldedW,
                      ...placement }}
             sx={{ position: 'absolute',
                    maxWidth: `calc(100% - ${2 * CORNER_INSET}px)`,
                    // Beats max-height: the title bar is always whole.
                    minHeight: `${HEADER_EM}em`,
                    display: 'flex', flexDirection: 'column',
                    // The key's own panel treatment, outlined in purple.
                    background: 'rgba(13, 20, 32, 0.94)',
                    backdropFilter: 'blur(2px)',
                    borderRadius: '0.8em', border: `2px solid ${OUTLINE}`,
                    boxShadow: '0 0.5em 1.5em rgba(0, 0, 0, 0.45)',
                    fontFamily: MONO, color: P.text, userSelect: 'none',
                    overflow: 'hidden', zIndex: 2,
                    // See-through while carried (req #3614) so the outlined
                    // step beneath can be read.
                    opacity: carrying ? 0.35 : 1,
                    // Only while folding — see the header.
                    transition: folding ? `width ${foldMs}ms ease` : 'none' }}>
            <Box ref={headerRef} data-testid="pipeline-viz-unseated-header"
                 title={count > 0
                     ? 'Drag to move · drop on a step to seat them all · double-click to put back'
                     : 'Drag to move · double-click to put back'}
                 onPointerDown={onBarDown}
                 onPointerMove={onBarMove}
                 onPointerUp={onBarUp}
                 onPointerCancel={onBarUp}
                 onLostPointerCapture={onBarUp}
                 onDoubleClick={onBarDoubleClick}
                 sx={{ display: 'flex', alignItems: 'center', gap: '0.6em',
                        px: '0.8em', py: '0.45em', flexShrink: 0,
                        cursor: moving ? 'grabbing' : 'move', touchAction: 'none',
                        fontWeight: 600 }}>
                {/* The count is a badge LEFT of the name (req #3648), folded
                    or not. */}
                <Box component="span" data-testid="pipeline-viz-unseated-count"
                     sx={{ flexShrink: 0, minWidth: `${BADGE_MIN_EM}em`,
                            px: `${BADGE_PAD_EM / 2}em`, boxSizing: 'border-box',
                            borderRadius: '1em', bgcolor: statusColor,
                            color: '#0d1420', fontWeight: 700, lineHeight: 1.45,
                            textAlign: 'center' }}>
                    {isError ? '!' : (isLoading ? '…' : count)}
                </Box>
                <Box component="span" data-testid="pipeline-viz-unseated-title"
                     // Folded, "OR" never gives way: the bar is sized to it.
                     sx={{ flex: open ? 1 : '1 0 auto', minWidth: open ? 0 : 'auto',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {open ? 'Orchestrables' : 'OR'}
                </Box>
                <Box component="button" type="button"
                     onClick={toggleOpen}
                     aria-expanded={open}
                     aria-label={open ? 'Collapse the list' : 'Expand the list'}
                     data-testid="pipeline-viz-unseated-toggle"
                     sx={{ width: '1.6em', height: '1.6em', p: 0, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'transparent', border: 'none',
                            borderRadius: '0.4em', color: P.text, cursor: 'pointer',
                            fontFamily: MONO, fontSize: '1.25em', lineHeight: 1,
                            '&:hover': { color: P.accent } }}>
                    {open ? '−' : '+'}
                </Box>
            </Box>

            {/* Animated by the toggle, and nothing else — a carry keeps it open
                (req #3677). Once ENTERED the wrappers are flex columns that may
                shrink, so a list the pane cuts short still scrolls inside the
                box. Only then: Collapse measures the wrapper's height to
                animate to, and a shrinkable wrapper in a flex root measures 0
                — the unfold would animate 0 → 0 and then pop (req #3648 code
                review). */}
            <Collapse in={open} timeout={foldMs} unmountOnExit
                      sx={{ flex: '0 1 auto', minHeight: 0,
                            '&.MuiCollapse-entered': {
                                display: 'flex', flexDirection: 'column',
                                '& .MuiCollapse-wrapper': { flex: '0 1 auto', minHeight: 0 },
                                '& .MuiCollapse-wrapperInner': {
                                    display: 'flex', flexDirection: 'column', minHeight: 0 } } }}>
            <Box ref={listRef} data-testid="pipeline-viz-unseated-list"
                 // A stretched height, in `style` for the same reason as
                 // the box's own geometry: it changes on every frame.
                 style={{
                     ...(drawn.listHeightPx != null
                         && { height: `${drawn.listHeightPx}px`, maxHeight: 'none' }),
                     // Mid-fold only — see `foldListW`.
                     ...(foldListW > 0 && { width: `${foldListW}px` }) }}
                 sx={{ overflowY: 'auto', overscrollBehavior: 'contain',
                        minHeight: 0, flex: '0 1 auto', maxHeight: `${LIST_MAX_EM}em`,
                        borderTop: `1px solid ${P.line}`, py: '0.35em' }}>
                {isError && (
                    <Box sx={{ px: '0.8em', py: '0.5em', color: '#ff8a80' }}>
                        Could not load swarm-ready requirements.
                    </Box>
                )}
                {!isError && !isLoading && count === 0 && (
                    <Box data-testid="pipeline-viz-unseated-empty"
                         sx={{ px: '0.8em', py: '0.5em', color: P.dim }}>
                        None
                    </Box>
                )}
                {items.map((r) => {
                    const id = Number(r.id);
                    const dragging = draggingId === id;
                    const barColor = categoryColors[r.category_fk];
                    return (
                        <Box key={id}
                             draggable
                             data-testid={`pipeline-viz-unseated-item-${id}`}
                             onDragStart={(e) => {
                                 e.dataTransfer.setData(UNSEATED_REQ_MIME, String(id));
                                 e.dataTransfer.effectAllowed = 'move';
                                 // Next tick — see the header: the drag
                                 // image is snapshotted after this returns.
                                 setTimeout(() => onDragStartItem?.(id), 0);
                             }}
                             onDragEnd={() => onDragEndItem?.(id)}
                             onClick={() => onOpen?.(id)}
                             sx={{ display: 'flex', alignItems: 'baseline', gap: '0.6em',
                                    px: '0.8em', py: '0.3em',
                                    cursor: 'grab', opacity: dragging ? 0.3 : 1,
                                    // An opaque row so the drag image is a
                                    // solid copy, not a ghost of the canvas.
                                    background: dragging ? 'transparent' : '#0d1420',
                                    '&:hover': { background: '#16233a' } }}>
                            <Box component="span"
                                 data-testid={`pipeline-viz-unseated-bar-${id}`}
                                 sx={{ width: '0.45em', alignSelf: 'stretch',
                                        minHeight: '1.2em', flexShrink: 0,
                                        borderRadius: '0.25em', boxSizing: 'border-box',
                                        bgcolor: barColor || 'transparent',
                                        ...(barColor && {
                                            border: '0.1em solid',
                                            borderColor: barEdge(barColor),
                                        }) }} />
                            <Box component="span"
                                 sx={{ color: statusColor, fontWeight: 700, flexShrink: 0 }}>
                                {id}
                            </Box>
                            <Box component="span"
                                 data-testid={`pipeline-viz-unseated-item-title-${id}`}
                                 // Wraps to two lines at most, then "…"
                                 // (req #3684). An unbroken run breaks
                                 // rather than overflowing the clamp.
                                 sx={{ flex: 1, minWidth: 0, overflow: 'hidden',
                                        display: '-webkit-box', WebkitBoxOrient: 'vertical',
                                        WebkitLineClamp: 2, overflowWrap: 'anywhere' }}>
                                {r.title}
                            </Box>
                        </Box>
                    );
                })}
            </Box>
            </Collapse>

            {open && (
                // Its own strip under the list, so it never lies over a row.
                <Box ref={stripRef} data-testid="pipeline-viz-unseated-grip-strip"
                     sx={{ display: 'flex', flexShrink: 0, height: '1.3em',
                            justifyContent: anchoredRight ? 'flex-start' : 'flex-end' }}>
                {gripShown && (
                <Box data-testid="pipeline-viz-unseated-grip"
                     data-corner={anchoredRight ? 'bottom-left' : 'bottom-right'}
                     title="Drag to resize · double-click for the default size"
                     onPointerDown={onGripDown}
                     onPointerMove={onGripMove}
                     onPointerUp={onGripUp}
                     onPointerCancel={onGripUp}
                     onLostPointerCapture={onGripUp}
                     onDoubleClick={onGripDoubleClick}
                     sx={{ width: '1.3em', height: '1.3em',
                            p: '0.2em', boxSizing: 'border-box', touchAction: 'none',
                            cursor: anchoredRight ? 'nesw-resize' : 'nwse-resize',
                            color: OUTLINE, opacity: resizing ? 1 : 0.75,
                            '&:hover': { opacity: 1 } }}>
                    {/* Three diagonal strokes into the corner, mirrored to it. */}
                    <svg viewBox="0 0 10 10" width="100%" height="100%" aria-hidden="true"
                         style={anchoredRight ? { transform: 'scaleX(-1)' } : undefined}>
                        <path d="M9 1 L1 9 M9 4.5 L4.5 9 M9 8 L8 9"
                              stroke="currentColor" strokeWidth="1.3"
                              strokeLinecap="round" fill="none" />
                    </svg>
                </Box>
                )}
                </Box>
            )}
        </Box>
    );
}
