// UnorchestratedReqBox.jsx — the Plan visualizer's "Orchestrables" box
// (req #3583; titled and outlined in purple by req #3605; retitled from
// "Orchestration Ready" by req #3648).
//
// An Action Popup in the canvas's top-right corner listing every requirement
// that is ready to run but sits on no plan step. Each row is the SOURCE of a
// drag: pick it up, drop it on a step card, and it is seated there. That is
// what makes it "go hand in hand with" the visualizer's drag-and-drop (req
// #3581) — that one moves work between steps, this one feeds new work in.
//
// ── A dnd-kit DRAG ON THE SHARED PRESS TIMELINE, NO HANDLE (req #3665) ────
// The whole row is the grip (`useDarwinDraggable`), and it lifts the way every
// Darwin drag surface does (`dnd/pressTimeline.js`): a mouse moved a few px or
// held, a finger HELD STILL — a finger that moves first scrolls the list. The
// shared DragOverlay carries a faithful copy of the row (its type size and
// face are set on the row itself, so the copy reads the same outside the box);
// the row left behind greys out. Nothing on the canvas re-lays-out while the
// requirement is in the air; the visualizer's collision detection hit-tests
// the step cards and draws the outline (see its `seatTarget`). It replaced a
// native HTML5 `draggable`, which touch browsers do not drive.
//
// ── IT IS CHROME, NOT CANVAS ───────────────────────────────────────────────
// `data-viz-chrome` keeps d3-zoom from taking a press here as the start of a
// pan, and keeps the world-click hit-test from firing whatever bead lies
// beneath. The WHEEL is
// stopped at this element natively, but only when the list can actually
// scroll: d3 binds its wheel listener to the container, so a React handler
// (delegated to the root, an ancestor) would run too late to matter.
//
// ── MOVED BY ITS TITLE BAR, ANYWHERE IN THE WINDOW (req #3687) ────────────
// The box opens in the panel's top-right corner. Drag its TITLE BAR and it is
// relocated wherever it is dropped — anywhere in the WINDOW, over the Darwin
// navbar or the page header as readily as over the plan ("can the orchestrables
// move outside the viewport and sit atop the darwin navbar or anywhere else").
// It never pans or zooms with the plan, it just stays put while the plan moves
// under it. At home it is `absolute` in the pane, so the corner follows the
// pane; once placed it is `position: fixed` in window coordinates at
// `UNSEATED_FLOAT_Z` — above the navbar, the bottom nav and the drawer, below
// the modal layer so the seat dialog still opens over it. It stays a DOM child
// of the pane (fixed escapes the pane's `overflow: hidden`; nothing between
// here and the root forms a containing block, and the only stacking context —
// the maximized page, fixed over the whole window — covers everywhere it can
// go), so every listener on the pane still sees its events exactly as it did
// at home. The pane's own controls that must never be covered — the maximize
// switch, a requirement in flight, the seat-target outline — sit above it.
// Pointer events with capture, one pointer at a time, on the shared press
// timeline (req #3665): a mouse moves it past MOUSE_ACTIVATION_PX (so a click
// that wobbles does not pin it) or lifts it on a LIFT_DELAY_MS hold; a finger
// lifts it on a hold within TOUCH_TOLERANCE_PX (a haptic tick) and then carries
// it — a finger that slides off first moves nothing. A lifted box says so (a
// deeper shadow, a purple glow). The ▾ is its own button so a move never
// toggles it. Double-click the title bar to
// send it home. The spot is remembered per browser (a viewer convenience —
// localStorage, wrapped, since it may be unavailable) and written once, on
// release, only if the box moved. CSS `clamp` keeps a remembered spot inside a
// window that has since become smaller, and `minHeight` keeps the title bar
// whole at the window's bottom edge until the box is lifted (req #3677). A box
// dropped in the RIGHT half is remembered by its distance from the right edge,
// so it stays flush right as the zoom resizes it or the window narrows — the
// same anchoring its home corner has. A wheel over a box parked OFF the plan
// does not zoom the plan about a point it cannot see.
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
// be dragged low enough for its `maxHeight` to squeeze it. A placed box
// that later GROWS (unfolded, zoomed in, more rows, a smaller window) is lifted
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
// ── THE ID FOLLOWS THE COLOUR PREFERENCE (req #3702) ───────────────────────
// Each row's id is painted by the same colour key the reader picked for the
// plan's requirement marks (State, Session, Autonomy, Machine or none), through
// the visualizer's own resolver (`idStyleOf`), so the box and the canvas say the
// same thing about a requirement. Without a resolver it keeps `statusColor`.
// The title takes the id's colour too (req #3745), in regular weight — only
// the id goes bold.
//
// ── FOLDED, IT IS A NARROW "OR" BAR (req #3648, user directive) ───────────
// The title bar is every Action Popup's (req #3741): the ▾ (CollapseHead) at
// the upper left, then the count as a badge, then the name — and the upper
// right blank, since the box has no close. Folding swaps the name for "OR" and
// narrows the box to exactly that bar — ▾, badge, "OR", nothing else changed —
// and both the width and the list's height animate, so it shrinks in and out
// smoothly. The width only transitions for the length of a fold: the zoom
// resizes the box on every wheel frame, and a transition there would make it
// trail the plan. Reduced motion turns both animations off.
//
// THE ▾ IS THE ANCHOR (memory/anchored-collapse-pattern.md): the box folds
// toward its LEFT edge, whichever side it is anchored to. A box anchored right
// (home, or dropped in the right half) draws its folded bar where the open
// box's ▾ is — its right offset is the open box's plus the width it shed — and
// a folded bar dropped there is remembered by its OPEN box's right edge, so
// unfolding grows it rightward again. While the width animates the left is
// pinned in px, since the right offset would otherwise jump at once. A box
// anchored left is re-based to where it is drawn on every toggle. The one
// exception is the pattern's: an unfold with no room to its right moves the
// box left just far enough to show it.
//
// ── IT DOCKS TO THE DARWIN NAVBAR TOO (req #3735) ─────────────────────────
// It is one of Darwin's Action Popups, so it racks like the rest
// (the Dev Servers dashboard, the Dev Server panel, the Active box — pattern doc
// memory/anchored-collapse-pattern.md § The rack). It draws its own frame rather
// than being an AnchoredPanel — its zoom-following type, step-card width, text
// sizes and carry-to-seat are its own — so it takes the rack from the SAME hook
// AnchoredPanel does (`usePanelRack`): its title-bar move hit-tests the navbar,
// the navbar glows in its purple while the pointer is over, and released there
// it is RACKED — portalled into the navbar's rack slot at the navbar's width, in
// the Action Popups' 12px type, its title whole even folded, no grip, stacked and
// reordered with the others. Its rows still drag onto step cards from there, and
// a carried move released over a step still seats the whole set — and leaves it
// racked: that gesture was a seat, not a relocation. Dragged off the navbar it
// floats again where it was dropped. In the icon-only navbar it keeps its badge
// and ▾, and its rows their ids. While the page is MAXIMIZED the navbar is
// covered, so the rack is suspended and the box floats at its own spot. Racking
// re-mounts its DOM (inline ↔ portal, or a new rack slot), so every native
// listener is bound per mount. Lifted out of the rack it stays FULL SIZE, as
// every move of this box does (req #3677) — an AnchoredPanel shrinks to its head.
//
// ── A REQUIREMENT DROPPED ON IT LEAVES THE PLAN (req #3817) ───────────────
// The box is a drop TARGET as well as a source: drag a requirement off a step
// card, release it over the box — home, floated anywhere, or racked in the
// navbar — and it is un-orchestrated (its step seat deleted), so it is the
// box's. The gesture is the visualizer's; the box hands it its element
// (`dropTargetRef`) to hit-test and draws what it is told: while a requirement
// is in flight (`dropArmed`) a dashed purple outline says it takes drops, and
// with the requirement over it (`dropOver`) it glows and its title reads
// "Drop to un-orchestrate". A requirement on a LOCKED step cannot leave it
// (`dropArmed` 'refused'): no outline, a no-drop cursor.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import useMediaQuery from '@mui/material/useMediaQuery';
import { lighten } from '@mui/material/styles';

import CollapseHead from '../../Components/AnchoredPanel/CollapseHead';
import { ACTION_POPUP_COLORS, ACTION_POPUP_FONT_PX } from '../../Components/AnchoredPanel/actionPopupChrome';
import { rackOrder } from '../../Components/AnchoredPanel/panelRack';
import { rackPortal, usePanelRack } from '../../Components/AnchoredPanel/usePanelRack';
import { CARD_FRAME_W, PLAN_VIZ_PALETTE as P } from './pipelinePlanLayout';
import {
    UNSEATED_DRAG_TYPE, UNSEATED_MIN_LIST_EM, pointInRect, unseatedDragId,
    unseatedMinStretchPx, unseatedResizedBox,
} from './pipelineUnseated';
import {
    useDarwinDraggable, LIFT_DELAY_MS, LIFT_VIBRATE_MS, MOUSE_ACTIVATION_PX,
    TOUCH_TOLERANCE_PX,
} from '../../dnd';
import { usePlanViewSetting } from './planViewSettings';

const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

/** The box's outline (req #3605, user directive: "a strong visible purple" —
 *  neither dark nor pastel). ~4.5:1 against the box's own background. */
const OUTLINE = '#a64dff';

/** Its id in the navbar's panel rack (req #3735). */
export const ORCHESTRABLES_RACK_ID = 'orchestrables';

/** Panel inset of the home corner, px — and a placed box's inset from the
 *  window's bottom edge. */
const CORNER_INSET = 8;
/** A PLACED box's z-index (req #3687): above the navbar, the mobile bottom nav
 *  (1200) and the drawer (MUI 1200), below the modal layer (MUI 1300), so the
 *  seat dialog and every menu still open over it. The visualizer lifts the
 *  seat-target outline one above it while the box is carried. */
export const UNSEATED_FLOAT_Z = 1201;
/** The title bar's height — what must stay inside the pane or window: its
 *  padding (2 × 0.45em) and its tallest item, the 1.45em badge, plus the 2px
 *  frame top and bottom. */
const HEADER_H = 'calc(2.35em + 4px)';
/** Pointer travel, px, before a mouse press on the title bar (or the grip)
 *  becomes a move — the press timeline's (req #3665). */
const MOVE_SLOP = MOUSE_ACTIVATION_PX;
/** Vertical travel, px, before a corner stretch takes the height too: a
 *  sideways stretch that drifts a little leaves the list its natural height. */
const STRETCH_HEIGHT_SLOP = 12;
/** Bounds on a remembered stretch, so a hand-edited value cannot draw nonsense. */
const MAX_STRETCH_WS = 20;
const MAX_STRETCH_H_EM = 400;
/** The list's height cap, in em, when it is not stretched. */
const LIST_MAX_EM = 26;
/** Slack, px, between the box's full height and the bottom inset: the
 *  parts are measured as whole-px `offsetHeight`s of a fractional-em layout. */
const ROUNDING_SLACK_PX = 2;
/** How long a fold or unfold animates, ms. */
export const FOLD_MS = 220;
/** The folded bar's fixed parts, in em: the title bar's side padding (2 × 0.8),
 *  its two gaps (2 × 0.6), the ▾ (1em of its own 0.9em type = 0.9) and a
 *  little slack. The badge and "OR" itself are added in `ch`. */
const FOLDED_FIXED_EM = 1.6 + 1.2 + 0.9 + 0.6;
/** The count badge's side padding (2 × 0.45) and its floor, in em. */
const BADGE_PAD_EM = 0.9;
const BADGE_MIN_EM = 1.8;

/** A double-click this soon after a move ended is the move's own release
 *  pairing with a click, not a request to send the box home. */
const DBLCLICK_AFTER_MOVE_MS = 500;
/** WINDOW coordinates since req #3687. The pane-relative spots stored under
 *  the old key mean something else now, so they are dropped, not misread. */
const POS_STORAGE_KEY = 'darwin-plan-unseated-box-window-pos';
const OLD_POS_STORAGE_KEY = 'darwin-plan-unseated-box-pos';
const SIZE_STORAGE_KEY = 'darwin-plan-unseated-box-size';

/** Where the box is laid out (req #3687): its containing block's size and the
 *  box's top-left in it. PLACED, that is the window — a fixed box's `100%` is
 *  the viewport, scrollbars excluded — and the box's client rect; at HOME it is
 *  the pane it is absolute in. Null when the pane cannot be found. */
function layoutIn(box, placed) {
    if (placed) {
        const d = document.documentElement;
        const r = box.getBoundingClientRect();
        return { w: d.clientWidth || window.innerWidth,
            h: d.clientHeight || window.innerHeight, left: r.left, top: r.top };
    }
    const pane = box.offsetParent;
    if (!pane) return null;
    return { w: pane.clientWidth, h: pane.clientHeight,
        left: box.offsetLeft, top: box.offsetTop };
}

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
        window.localStorage.removeItem(OLD_POS_STORAGE_KEY);
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
    idStyleOf = null, onOpen,
    onMoveOver, onMoveDrop, onCarryingChange,
    dropTargetRef = null, dropArmed = null, dropOver = false,
}) {
    // The navbar rack (req #3735) — suspended while a page covers the navbar.
    const rack = usePanelRack(ORCHESTRABLES_RACK_ID);
    const { inRack, rackPos, overRack, narrow, slot, suspended } = rack;
    // True from the first frame of a move that started in the rack until its
    // release: drawn fixed under the pointer, still portalled (a re-mount would
    // lose the pointer capture).
    const [lifted, setLifted] = useState(false);
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
    // The box's left, px in its containing block, held for the length of a
    // fold (req #3741 — the ▾ is the anchor; see the header). Null otherwise.
    const [foldLeft, setFoldLeft] = useState(null);
    const toggleOpen = () => {
        const unfolding = !open;
        const box = boxRef.current;
        const at = box && !inRack && layoutIn(box, !!pos);
        // Where the ▾ will be once this toggle has drawn: where it is — unless
        // an unfold has no room to its right, the pattern's one exception.
        let left = null;
        if (at) {
            left = Math.round(at.left);
            if (unfolding) {
                const openW = Math.min(drawn.widthPx, at.w - 2 * CORNER_INSET);
                left = Math.max(0, Math.min(left, at.w - openW));
            }
            // Anchored left, the box is re-based to where it is drawn, so a
            // spot the window's clamp is overriding does not move it on fold.
            if (!unfolding && pos?.x != null && left !== pos.x) {
                const rebased = { x: left, y: pos.y };
                setPos(rebased);
                writePos(rebased);
            }
        }
        setOpen((v) => !v);
        if (!foldMs) return;
        setFolding(true);
        // Racked, the width never changes: nothing to hold.
        setFoldListW(inRack ? null : openListWidth());
        setFoldLeft(left);
        clearTimeout(foldTimerRef.current);
        foldTimerRef.current = setTimeout(() => {
            setFolding(false);
            setFoldListW(null);
            setFoldLeft(null);
        }, foldMs + 50);
    };
    const listRef = useRef(null);
    const boxRef = useRef(null);
    // The box's element, shared with the visualizer's requirement drag (req
    // #3817). A callback ref, since racking re-mounts the element.
    const setBoxEl = (el) => {
        boxRef.current = el;
        if (dropTargetRef) dropTargetRef.current = el;
    };
    // The open box's inner width, px: its drawn width capped at its containing
    // block (the `maxWidth` below), less its border. Null when it cannot be
    // measured.
    const openListWidth = () => {
        const box = boxRef.current;
        const at = box && layoutIn(box, !!pos);
        if (!at) return null;
        const border = box.offsetWidth - box.clientWidth;
        const outer = Math.min(drawn.widthPx, at.w - 2 * CORNER_INSET);
        return getComputedStyle(box).boxSizing === 'border-box' ? outer - border : outer;
    };
    const headerRef = useRef(null);
    const stripRef = useRef(null);
    // `null` = home (the pane's top-right); else WINDOW px of the top-left
    // corner, or of the top and the distance from the right edge (req #3687).
    const [pos, setPos] = useState(readPos);
    // The gesture lives in a ref; `moving` is state only so the cursor
    // re-renders on press and release.
    const moveRef = useRef(null);
    const [moving, setMoving] = useState(false);
    // True once a title-bar press has LIFTED the box (req #3665) — held still
    // to LIFT_DELAY_MS — until it ends: the lift cue, and on touch the licence
    // to move at all. (Not `lifted`, which is a racked box carried out of the
    // navbar, req #3735.)
    const [barLifted, setBarLifted] = useState(false);
    useEffect(() => () => clearTimeout(moveRef.current?.liftTimer), []);
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
        if (!box) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        // In WINDOW coordinates even from home: the first move frame places it.
        const at = layoutIn(box, true);
        const m = {
            id: e.pointerId, sx: e.clientX, sy: e.clientY,
            left: at.left, top: at.top, last: null,
            // Where to send the box back to if this drag turns out to be a seat
            // (or a rack, or a move that started in the rack and stays there).
            before: pos, carries: items.length > 0, fromRack: inRack,
            touch: e.pointerType === 'touch', lifted: false,
        };
        // Held still, it lifts — a finger must, a mouse may (req #3665).
        m.liftTimer = setTimeout(() => {
            if (moveRef.current !== m || m.last) return;
            m.lifted = true;
            setBarLifted(true);
            if (m.touch) navigator.vibrate?.(LIFT_VIBRATE_MS);
        }, LIFT_DELAY_MS);
        moveRef.current = m;
        setMoving(true);
    };
    // The title-bar press ends, however it ends.
    const endBarPress = (m, e) => {
        clearTimeout(m.liftTimer);
        moveRef.current = null;
        setMoving(false);
        setBarLifted(false);
        setLifted(false);
        setCarrying(false);
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
    };
    const onBarMove = (e) => {
        const m = moveRef.current;
        if (!m || e.pointerId !== m.id) return;
        const dx = e.clientX - m.sx;
        const dy = e.clientY - m.sy;
        if (!m.last && !m.lifted) {
            const travel = Math.hypot(dx, dy);
            if (m.touch) {
                // A finger that slides off before the lift moves nothing.
                if (travel > TOUCH_TOLERANCE_PX) { endBarPress(m, e); rack.cancel(); }
                return;
            }
            if (travel <= MOVE_SLOP) return;
        }
        clearTimeout(m.liftTimer);
        // Limits read LIVE, every frame: a wheel over the bar still zooms, and
        // the box's em size changes with it mid-drag.
        const box = boxRef.current;
        if (!box) return;
        const win = layoutIn(box, true);
        const clampTo = (v, hi) => Math.min(Math.max(0, v), Math.max(0, hi));
        if (!m.last && m.fromRack) setLifted(true);
        m.last = {
            x: Math.round(clampTo(m.left + dx, win.w - box.offsetWidth)),
            y: Math.min(Math.round(Math.max(0, m.top + dy)), maxTop(box, win)),
        };
        setPos(m.last);
        rack.track(e.clientX, e.clientY, m.fromRack, OUTLINE);
        if (m.carries) {
            setCarrying(true);
            onMoveOver?.(e.clientX, e.clientY);
        }
    };
    const onBarUp = (e) => {
        const m = moveRef.current;
        if (!m || e.pointerId !== m.id) return;
        endBarPress(m, e);
        if (!m.last) { rack.cancel(); return; }
        lastMoveEndRef.current = Date.now();
        const released = e.type === 'pointerup';
        // The navbar first (req #3735): released over it, the box is racked
        // whatever it carries — the navbar is no step. Its floating spot is
        // kept for the day it is dragged back out. A cancelled move that
        // started in the rack stays there.
        if (released ? rack.isOver(e.clientX, e.clientY, m.fromRack) : m.fromRack) {
            if (released) rack.release(e.clientX, e.clientY, m.fromRack);
            else rack.cancel();
            if (m.carries) onMoveOver?.(null, null);
            setPos(m.before);
            return;
        }
        if (m.carries) {
            // A cancelled pointer (or lost capture) is no drop: clear the
            // outline and keep the box wherever it got to.
            const seated = e.type === 'pointerup'
                && !!onMoveDrop?.(e.clientX, e.clientY);
            if (!seated) onMoveOver?.(null, null);
            if (seated) {
                // Seated from the rack, it stays racked.
                rack.cancel();
                setPos(m.before);
                return;
            }
        }
        // Dragged off the navbar, it floats again — where it was dropped,
        // anchored by its left: its floating width is not the navbar's.
        if (!released) rack.cancel();
        else if (rack.release(e.clientX, e.clientY, m.fromRack) === 'unracked') {
            const final = { x: m.last.x, y: m.last.y };
            setPos(final);
            writePos(final);
            return;
        }
        // Anchor to the nearer side of the window: right half → remembered
        // from the right.
        const box = boxRef.current;
        const win = box && layoutIn(box, true);
        let final = m.last;
        if (win && m.last.x + box.offsetWidth / 2 > win.w / 2) {
            // Folded, by the OPEN box's right edge (req #3741), so the bar is
            // drawn where it was dropped and unfolds rightward from its ▾ —
            // or by its left, when the open box would not fit there.
            const w = open ? box.offsetWidth
                : Math.min(drawn.widthPx, win.w - 2 * CORNER_INSET);
            const r = win.w - m.last.x - w;
            if (open || r >= 0) final = { r: Math.max(0, r), y: m.last.y };
        }
        setPos(final);
        writePos(final);
    };
    const goHome = () => { setPos(null); writePos(null); };

    const heights = (box) => boxHeights({ box, header: headerRef.current,
        strip: stripRef.current, list: listRef.current }, open, drawn);
    // The lowest top at which the WHOLE box still clears the window's bottom
    // inset — the one `maxHeight` holds — so it is never squeezed (req #3677).
    const maxTop = (box, win) => Math.max(0, Math.floor(
        win.h - CORNER_INSET - ROUNDING_SLACK_PX - heights(box).full));
    // A placed box that has GROWN since it was dropped — unfolded, zoomed in,
    // more rows, a smaller window, a seat sending it back — is lifted so it is
    // still whole, never squeezed. Not remembered: the spot the reader chose
    // stays theirs, and a smaller window re-lifts it on the next load.
    const reclampRef = useRef(null);
    reclampRef.current = () => {
        if (inRack || !pos || moveRef.current || resizeRef.current) return;
        const box = boxRef.current;
        if (!box) return;
        const top = maxTop(box, layoutIn(box, true));
        if (pos.y > top) setPos({ ...pos, y: top });
    };
    useLayoutEffect(() => { reclampRef.current(); });
    useEffect(() => {
        const onResize = () => reclampRef.current();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const onGripDown = (e) => {
        if (resizeRef.current || e.button !== 0) return;
        const box = boxRef.current;
        // The pane at home, the window once placed (req #3687).
        const cb = box && layoutIn(box, !!pos);
        if (!cb) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        // Re-anchor to where the box is DRAWN. A remembered spot the window's
        // clamp is overriding (zoomed wide, it no longer fits beside its edge)
        // would otherwise grow from the far edge, not the grip.
        let rebased = null;
        if (pos) {
            const at = anchoredRight
                ? { r: Math.max(0, cb.w - cb.left - box.offsetWidth), y: cb.top }
                : { x: cb.left, y: cb.top };
            if (at.x !== pos.x || at.r !== pos.r || at.y !== pos.y) {
                rebased = at;
                setPos(at);
            }
        }
        const room = anchoredRight ? cb.left + box.offsetWidth : cb.w - cb.left;
        const list = listRef.current;
        resizeRef.current = {
            id: e.pointerId, sx: e.clientX, sy: e.clientY,
            // Border-box, like the `height` it becomes.
            w: box.offsetWidth, h: list?.offsetHeight ?? null, right: anchoredRight,
            maxW: Math.min(room, cb.w - 2 * CORNER_INSET),
            // To the bottom inset with the grip strip and border still above
            // it — no taller than the WHOLE box can be seen (req #3677).
            maxH: list ? cb.h - CORNER_INSET - ROUNDING_SLACK_PX
                - cb.top - heights(box).frame : 0,
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
        // Racked, it has no home to go to: it is dragged out instead.
        if (inRack) return;
        if (e.target.closest('button')) return;
        if (Date.now() - lastMoveEndRef.current < DBLCLICK_AFTER_MOVE_MS) return;
        goHome();
    };

    // Geometry in `style` (it changes on every move frame — see fontSize below).
    const clampTop = (y) => `clamp(0px, ${y}px, calc(100% - ${HEADER_H}))`;
    // The DRAWN width — `maxWidth` caps it at the pane or window — so this agrees with
    // the move clamp, which reads `offsetWidth`.
    const count = items.length;
    // Folded, the box is exactly its "OR" bar wide: the badge holds the count's
    // digits (or the one-character loading/error mark) and "OR" is two.
    const badgeChars = isError || isLoading ? 1 : String(count).length;
    const foldedW = `calc(${FOLDED_FIXED_EM}em + 2ch`
        + ` + max(${BADGE_MIN_EM}em, ${badgeChars}ch + ${BADGE_PAD_EM}em) + 4px)`;
    const openDrawnW = `min(${drawn.widthPx}px, 100% - ${2 * CORNER_INSET}px)`;
    const drawnW = open ? openDrawnW : `min(${foldedW}, 100% - ${2 * CORNER_INSET}px)`;
    const clampSide = (v) => `clamp(0px, ${v}px, calc(100% - ${drawnW}))`;
    // Anchored right, the folded bar sits where the open box's ▾ is: the open
    // box's right offset plus the width the fold shed (req #3741).
    const rightOf = (openRight) => (open ? openRight
        : `calc(${openRight} + ${openDrawnW} - ${drawnW})`);
    // Mid-fold, the left is pinned instead (see `foldLeft`).
    const side = (anchor) => (foldLeft != null ? { left: `${foldLeft}px`, right: 'auto' } : anchor);
    // Placed, it is fixed in the WINDOW, so every `100%` below is the window's
    // (req #3687).
    // RACKED (req #3735): at rest, in the navbar's flow at its width; lifted
    // out, fixed under the pointer at that width until released.
    const placement = inRack
        ? (lifted
            ? { position: 'fixed', zIndex: UNSEATED_FLOAT_Z,
                left: `${pos?.x ?? 0}px`, top: `${pos?.y ?? 0}px`,
                maxHeight: `calc(100% - ${pos?.y ?? 0}px)` }
            : { position: 'relative', order: rackOrder(rackPos) })
        : pos
        ? { position: 'fixed', zIndex: UNSEATED_FLOAT_Z,
            ...side(pos.r != null
                ? { right: rightOf(`clamp(0px, ${pos.r}px, calc(100% - ${openDrawnW}))`) }
                : { left: clampSide(pos.x) }),
            top: clampTop(pos.y),
            // Never below the title bar: parked at the bottom edge it shows
            // the bar whole rather than a squeezed sliver.
            maxHeight: `max(${HEADER_H}, calc(100% - ${clampTop(pos.y)} - ${CORNER_INSET}px))` }
        : { top: CORNER_INSET, ...side({ right: rightOf(`${CORNER_INSET}px`) }),
            maxHeight: `calc(100% - ${2 * CORNER_INSET}px)` };

    useEffect(() => {
        const el = listRef.current;
        if (!el) return undefined;
        const onWheel = (ev) => {
            if (el.scrollHeight > el.clientHeight) ev.stopPropagation();
        };
        el.addEventListener('wheel', onWheel, { passive: true });
        return () => el.removeEventListener('wheel', onWheel);
    }, [open, inRack, slot?.node]);
    // Parked OFF the plan (req #3687), a wheel over the box is not a zoom: it
    // would reach the pane's d3 listener — the box is still its DOM child,
    // wherever it is drawn — and zoom about a point outside the canvas.
    // Racked, it is not in the pane at all: d3 never sees its wheel.
    useEffect(() => {
        const box = boxRef.current;
        if (!box || inRack) return undefined;
        const onWheel = (ev) => {
            const pane = box.parentElement;
            if (pane && !pointInRect(ev.clientX, ev.clientY, pane.getBoundingClientRect())) {
                ev.stopPropagation();
            }
        };
        box.addEventListener('wheel', onWheel, { passive: true });
        return () => box.removeEventListener('wheel', onWheel);
    }, [inRack, slot?.node]);

    // No grip while folded or being moved (its corner follows the side the
    // box is anchored to, which a move is changing). A move keeps the grip's
    // STRIP, so the box stays its full height (req #3677).
    // Racked, the navbar sets its width and its rows its height: no grip.
    const gripShown = open && !moving && !inRack;
    // A grip that goes away mid-stretch ends the stretch.
    useEffect(() => {
        if (gripShown || !resizeRef.current) return;
        resizeRef.current = null;
        setResizing(false);
    }, [gripShown]);

    // Racked, the Action Popups' type and the navbar's width (req #3735).
    const typePx = inRack ? ACTION_POPUP_FONT_PX : drawn.fontPx;
    const boxW = inRack ? (lifted ? `${slot.width}px` : '100%')
        : (open ? `${drawn.widthPx}px` : foldedW);
    const racking = inRack && !lifted;

    const panel = (
        <Box ref={setBoxEl} data-viz-chrome="unseated" data-viz-unseated=""
             data-testid="pipeline-viz-unseated"
             data-drop-armed={dropArmed || ''}
             data-drop-over={dropOver ? '1' : '0'}
             data-rack-id={ORCHESTRABLES_RACK_ID}
             data-racked={inRack ? '1' : '0'}
             data-rack-open={inRack && open ? '1' : '0'}
             data-carrying={carrying ? '1' : '0'}
             data-lifted={barLifted ? '1' : '0'}
             data-text-step={drawn.step}
             data-stretched={size ? '1' : '0'}
             data-pos={!pos ? 'home'
                 : (pos.r != null ? `r${pos.r},${pos.y}` : `${pos.x},${pos.y}`)}
             // Everything inside is in em off this one number. In `style`, NOT
             // `sx`: it changes on every zoom frame, and each distinct value
             // through `sx` makes Emotion mint (and never free) a new rule —
             // the badge layer's own "geometry in style" rule.
             data-open={open ? '1' : '0'}
             style={{ fontSize: `${typePx}px`, width: boxW, ...placement }}
             sx={{ position: 'absolute',
                    maxWidth: inRack ? 'none' : `calc(100% - ${2 * CORNER_INSET}px)`,
                    // Beats max-height: the title bar is always whole.
                    minHeight: HEADER_H,
                    display: 'flex', flexDirection: 'column',
                    // The key's own panel treatment, outlined in purple.
                    background: 'rgba(13, 20, 32, 0.94)',
                    backdropFilter: 'blur(2px)',
                    borderRadius: '0.8em', border: `2px solid ${OUTLINE}`,
                    // Lifted by a held title bar (req #3665): picked up. A
                    // requirement over it (req #3817): a strong purple glow.
                    // Racked, the rack clips anything outside the box, so the
                    // glow is drawn inside it — on an overlay, since an inset
                    // shadow would paint under the rows' opaque backgrounds.
                    boxShadow: dropOver && !inRack
                        ? `0 0 0 0.3em ${OUTLINE}aa, 0 0 1.6em 0.3em ${OUTLINE}88`
                        : (barLifted
                            ? `0 1em 2.4em rgba(0, 0, 0, 0.6), 0 0 0 0.25em ${OUTLINE}55`
                            : '0 0.5em 1.5em rgba(0, 0, 0, 0.45)'),
                    // req #3817 — a requirement in flight: the box takes drops.
                    ...(dropArmed === 'ok' && !dropOver && {
                        outline: `2px dashed ${OUTLINE}`, outlineOffset: inRack ? '-5px' : '3px' }),
                    ...(dropArmed && {
                        cursor: dropArmed === 'ok' ? 'grabbing' : 'no-drop',
                        '& *': { cursor: 'inherit !important' } }),
                    fontFamily: MONO, color: P.text, userSelect: 'none',
                    overflow: 'hidden', zIndex: 2,
                    // See-through while carried (req #3614) so the outlined
                    // step beneath can be read; over the navbar, the drop
                    // zone shows through, as it does for every rackable window.
                    opacity: overRack ? 0.75 : (carrying ? 0.35 : 1),
                    // Only while folding — see the header.
                    transition: folding && !inRack ? `width ${foldMs}ms ease` : 'none',
                    // In the stack: square, flat. The rack's row sizes it: open,
                    // the height its rows need and no more, its list scrolling
                    // when the rack is short (req #3747); folded, its title bar.
                    ...(racking && { borderRadius: 0, boxShadow: 'none' }),
                    ...(dropOver && inRack && {
                        '&::after': { content: '""', position: 'absolute', inset: 0,
                            borderRadius: 'inherit', pointerEvents: 'none', zIndex: 3,
                            boxShadow: `inset 0 0 0 0.3em ${OUTLINE}aa, inset 0 0 1.4em ${OUTLINE}88` } }) }}>
            <Box ref={headerRef} data-testid="pipeline-viz-unseated-header"
                 title={inRack
                     ? `Drag to reorder · drag off the navbar to float it${count > 0 ? ' · drop on a step to seat them all' : ''}`
                     : `Drag to move${count > 0 ? ' · drop on a step to seat them all' : ''}`
                         + `${suspended ? '' : ' · drop on the navbar to rack it'} · double-click to put back`}
                 onPointerDown={onBarDown}
                 onPointerMove={onBarMove}
                 onPointerUp={onBarUp}
                 onPointerCancel={onBarUp}
                 onLostPointerCapture={onBarUp}
                 onDoubleClick={onBarDoubleClick}
                 // A held finger raises no long-press menu or callout.
                 onContextMenu={(e) => e.preventDefault()}
                 sx={{ display: 'flex', alignItems: 'center', gap: '0.6em',
                        px: '0.8em', py: '0.45em', flexShrink: 0,
                        cursor: moving ? 'grabbing' : 'move', touchAction: 'none',
                        WebkitTouchCallout: 'none', fontWeight: 600 }}>
                {/* The ▾ at the upper left, as every Action Popup has it
                    (req #3741); the upper right is left blank. */}
                <CollapseHead open={open} onToggle={toggleOpen} name="Orchestrables"
                              testid="pipeline-viz-unseated-toggle"
                              color={ACTION_POPUP_COLORS.head} hoverColor={ACTION_POPUP_COLORS.headHover}
                              fontSize="0.9em" showName={false} />
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
                {/* Folded, "OR" never gives way: the bar is sized to it. Racked,
                    the navbar sets the width, so the name stays whole — and the
                    icon-only navbar has room for the ▾ and badge alone. */}
                {!narrow && (
                <Box component="span" data-testid="pipeline-viz-unseated-title"
                     sx={{ flex: open || inRack ? 1 : '1 0 auto',
                            minWidth: open || inRack ? 0 : 'auto',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {dropOver && (open || inRack) ? 'Drop to un-orchestrate'
                        : (open || inRack ? 'Orchestrables' : 'OR')}
                </Box>
                )}
            </Box>

            {/* Animated by the toggle, and nothing else — a carry keeps it open
                (req #3677). Once ENTERED the wrappers are flex columns that may
                shrink, so a list the pane cuts short still scrolls inside the
                box. Only then: Collapse measures the wrapper's height to
                animate to, and a shrinkable wrapper in a flex root measures 0
                — the unfold would animate 0 → 0 and then pop (req #3648 code
                review). */}
            <Collapse in={open} timeout={foldMs} unmountOnExit
                      sx={{ flex: racking ? '1 1 auto' : '0 1 auto', minHeight: 0,
                            '&.MuiCollapse-entered': {
                                display: 'flex', flexDirection: 'column',
                                '& .MuiCollapse-wrapper': { flex: racking ? '1 1 auto' : '0 1 auto', minHeight: 0 },
                                '& .MuiCollapse-wrapperInner': {
                                    display: 'flex', flexDirection: 'column', minHeight: 0 } } }}>
            <Box ref={listRef} data-testid="pipeline-viz-unseated-list"
                 // A stretched height, in `style` for the same reason as
                 // the box's own geometry: it changes on every frame. Racked,
                 // the reader's stretch is ignored: the list is its rows
                 // (req #3747).
                 style={{
                     ...(drawn.listHeightPx != null && !racking
                         && { height: `${drawn.listHeightPx}px`, maxHeight: 'none' }),
                     // Mid-fold only — see `foldListW`.
                     ...(foldListW > 0 && { width: `${foldListW}px` }) }}
                 sx={{ overflowY: 'auto', overscrollBehavior: 'contain',
                        minHeight: 0, flex: racking ? '1 1 auto' : '0 1 auto',
                        // Racked, the rack's row is the cap: its rows, or its
                        // fair share of a short navbar (req #3747).
                        maxHeight: racking ? 'none' : `${LIST_MAX_EM}em`,
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
                    return (
                        <UnseatedRow key={id} row={r} id={id} fontPx={typePx}
                                     barColor={categoryColors[r.category_fk]}
                                     // req #3702 — the id wears the visualizer's
                                     // colour key; without a resolver it keeps
                                     // the swarm-ready colour.
                                     idStyle={idStyleOf
                                         ? idStyleOf(id) : { fill: statusColor, bold: true }}
                                     narrow={narrow}
                                     onOpen={onOpen} />
                    );
                })}
            </Box>
            </Collapse>

            {open && !inRack && (
                // Its own strip under the list, so it never lies over a row.
                <Box ref={stripRef} data-testid="pipeline-viz-unseated-grip-strip"
                     sx={{ display: 'flex', flexShrink: 0, height: '1.8em',
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
                     sx={{ width: '1.8em', height: '1.8em',
                            p: '0.35em', boxSizing: 'border-box', touchAction: 'none',
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
    return inRack ? rackPortal(panel, slot) : panel;
}

/**
 * One box row — the SOURCE of a seat drag (req #3665, dnd-kit). Its type size,
 * face and colour are set here rather than inherited from the box, so the
 * DragOverlay's copy (mounted outside the box) reads exactly like the row.
 */
function UnseatedRow({ row, id, fontPx, barColor, idStyle, narrow, onOpen }) {
    const { ref, style, attributes, listeners, isDragging } = useDarwinDraggable({
        id: unseatedDragId(id), type: UNSEATED_DRAG_TYPE, row,
        // req #3817 — un-orchestrated a moment ago, its seat not yet deleted.
        disabled: !!row.unseating,
    });
    // No keyboard lift: the step it would land on is a canvas card a key
    // cannot reach (the collision detection needs a pointer). From the keys a
    // row is a button — Enter or Space opens the requirement.
    const { onKeyDown: _keyLift, ...pointerListeners } = listeners || {};
    // ...and is announced as one: no "draggable", no "press space to pick up".
    const {
        'aria-roledescription': _role, 'aria-describedby': _howTo, ...buttonAttributes
    } = attributes;
    return (
        <Box ref={ref} {...buttonAttributes} {...pointerListeners}
             data-testid={`pipeline-viz-unseated-item-${id}`}
             // The drag copy finds the row by this, its roledescription gone.
             data-darwin-drag=""
             data-dragging={isDragging ? '1' : '0'}
             onClick={() => onOpen?.(id)}
             onKeyDown={(e) => {
                 if (e.key !== 'Enter' && e.key !== ' ') return;
                 e.preventDefault();
                 onOpen?.(id);
             }}
             style={{ fontSize: `${fontPx}px`, ...style }}
             sx={{ display: 'flex', alignItems: 'baseline', gap: '0.6em',
                    px: '0.8em', py: '0.3em', fontFamily: MONO, color: P.text,
                    cursor: isDragging ? 'grabbing' : 'grab', opacity: isDragging ? 0.3 : 1,
                    // An opaque row so the lifted copy is solid, not a ghost
                    // of the canvas.
                    background: isDragging ? 'transparent' : '#0d1420',
                    WebkitTouchCallout: 'none',
                    '&:hover': { background: '#16233a' },
                    '&:focus-visible': { outline: `2px solid ${OUTLINE}`, outlineOffset: '-2px' } }}>
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
                 data-testid={`pipeline-viz-unseated-item-id-${id}`}
                 sx={{ color: idStyle.fill,
                        fontWeight: idStyle.bold ? 700 : 400, flexShrink: 0 }}>
                {id}
            </Box>
            {/* The icon-only navbar keeps the ids alone (req #3735). */}
            {!narrow && (
            <Box component="span"
                 data-testid={`pipeline-viz-unseated-item-title-${id}`}
                 // Wraps to two lines at most, then "…" (req #3684). An
                 // unbroken run breaks rather than overflowing the clamp.
                 sx={{ flex: 1, minWidth: 0, overflow: 'hidden', color: idStyle.fill,
                        display: '-webkit-box', WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: 2, overflowWrap: 'anywhere' }}>
                {row.title}
            </Box>
            )}
        </Box>
    );
}
