// UnorchestratedReqBox.jsx — the Plan visualizer's "Orchestration Ready" box
// (req #3583; titled and outlined in purple by req #3605).
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
// at the pane's bottom edge. A box dropped in the RIGHT half is remembered by
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
// ── SIZED LIKE THE REQUIREMENTS (user directive) ───────────────────────────
// Its TYPE is the
// requirement ids' own on-screen size — `fontPx` is the card's requirement font
// times the live zoom — and every dimension below is in `em`, so the whole box
// shrinks as the reader zooms out and grows as they zoom in, in step with the
// marks it feeds — held within 9–16px (`unseatedBoxFontPx`) so it stays
// legible zoomed far out and never covers the canvas zoomed in (user ruling).
//
// ── ONE BOX, TWO LISTS (req #3622) ─────────────────────────────────────────
// The "Urgent Review" box (`UrgentReviewBox.jsx`) is this same panel over a
// different list — requirements whose session is waiting on the user. Every
// prop below that names it (title, outline, test id, remembered spot, home
// spot, width, per-row colour and trailing content) defaults to the
// Orchestration Ready box's own value, and `seatable={false}` turns off the two
// drags that feed a step: its rows are already somebody's work, so they only
// open on click. `homeOffset` moves the home spot along the top edge — the
// Urgent Review box docks against this box's left edge with it.

import { useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';

import { PLAN_VIZ_PALETTE as P } from './pipelinePlanLayout';
import {
    UNSEATED_REQ_MIME, UNSEATED_BOX_WIDTH_EM, UNSEATED_BOX_INSET_PX,
} from './pipelineUnseated';

const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

/** The box's outline (req #3605, user directive: "a strong visible purple" —
 *  neither dark nor pastel). ~4.5:1 against the box's own background. */
const OUTLINE = '#a64dff';

/** Panel inset of the home corner, px. */
const CORNER_INSET = UNSEATED_BOX_INSET_PX;
/** The title bar's height in em — what must stay inside the pane. */
const HEADER_EM = 3;
/** Pointer travel, px, before a title-bar press becomes a move. */
const MOVE_SLOP = 4;
/** A double-click this soon after a move ended is the move's own release
 *  pairing with a click, not a request to send the box home. */
const DBLCLICK_AFTER_MOVE_MS = 500;
const POS_STORAGE_KEY = 'darwin-plan-unseated-box-pos';

function readPos(key) {
    try {
        const v = JSON.parse(window.localStorage.getItem(key));
        if (!v || !Number.isFinite(v.y)) return null;
        if (Number.isFinite(v.x)) return { x: v.x, y: v.y };
        if (Number.isFinite(v.r)) return { r: v.r, y: v.y };
        return null;
    } catch { return null; }
}
function writePos(key, pos) {
    try {
        if (pos) window.localStorage.setItem(key, JSON.stringify(pos));
        else window.localStorage.removeItem(key);
    } catch { /* storage unavailable — the box still moves, it just forgets */ }
}

export default function UnorchestratedReqBox({
    items, isLoading = false, isError = false,
    fontPx = 12, statusColor = P.req,
    draggingId = null, onDragStartItem, onDragEndItem, onOpen,
    onMoveOver, onMoveDrop,
    // req #3622 — what lets the Urgent Review box be this same panel.
    title = 'Orchestration Ready',
    outline = OUTLINE,
    testId = 'pipeline-viz-unseated',
    chrome = 'unseated',
    posStorageKey = POS_STORAGE_KEY,
    home = 'right',
    homeOffset = null,
    widthEm = UNSEATED_BOX_WIDTH_EM,
    emptyText = 'None — every swarm-ready requirement is on a step.',
    errorText = 'Could not load swarm-ready requirements.',
    itemColor = null,
    renderItemEnd = null,
    seatable = true,
}) {
    // Open by default: the box exists to be seen next to the plan it feeds.
    const [open, setOpen] = useState(true);
    const listRef = useRef(null);
    const boxRef = useRef(null);
    // `null` = home (top corner on the `home` side); else panel-relative px of
    // the top-left corner.
    const [pos, setPos] = useState(() => readPos(posStorageKey));
    // The gesture lives in a ref; `moving` is state only so the cursor
    // re-renders on press and release.
    const moveRef = useRef(null);
    const [moving, setMoving] = useState(false);
    const lastMoveEndRef = useRef(0);

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
            before: pos, carries: seatable && items.length > 0,
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
            y: Math.round(clampTo(m.top + dy,
                pane.clientHeight - e.currentTarget.offsetHeight)),
        };
        setPos(m.last);
        if (m.carries) onMoveOver?.(e.clientX, e.clientY);
    };
    const onBarUp = (e) => {
        const m = moveRef.current;
        if (!m || e.pointerId !== m.id) return;
        moveRef.current = null;
        setMoving(false);
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
        writePos(posStorageKey, final);
    };
    const goHome = () => { setPos(null); writePos(posStorageKey, null); };
    const onBarDoubleClick = (e) => {
        if (e.target.closest('button')) return;
        if (Date.now() - lastMoveEndRef.current < DBLCLICK_AFTER_MOVE_MS) return;
        goHome();
    };

    // Geometry in `style` (it changes on every move frame — see fontSize below).
    const clampTop = (y) => `clamp(0px, ${y}px, calc(100% - ${HEADER_EM}em))`;
    const clampSide = (v) => `clamp(0px, ${v}px, calc(100% - ${widthEm}em))`;
    const placement = pos
        ? { ...(pos.r != null ? { right: clampSide(pos.r) } : { left: clampSide(pos.x) }),
            top: clampTop(pos.y),
            // Never below the title bar: parked at the bottom edge it shows
            // the bar whole rather than a squeezed sliver.
            maxHeight: `max(${HEADER_EM}em, calc(100% - ${clampTop(pos.y)} - ${CORNER_INSET}px))` }
        : { top: CORNER_INSET,
            [home === 'left' ? 'left' : 'right']: homeOffset ?? CORNER_INSET,
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

    const count = items.length;

    return (
        <Box ref={boxRef} data-viz-chrome={chrome}
             // The visualizer's seat hit-test looks THROUGH this attribute, so
             // only a box whose drags seat work carries it.
             data-viz-unseated={seatable ? '' : undefined}
             data-testid={testId}
             data-pos={!pos ? 'home'
                 : (pos.r != null ? `r${pos.r},${pos.y}` : `${pos.x},${pos.y}`)}
             // Everything inside is in em off this one number. In `style`, NOT
             // `sx`: it changes on every zoom frame, and each distinct value
             // through `sx` makes Emotion mint (and never free) a new rule —
             // the badge layer's own "geometry in style" rule.
             style={{ fontSize: `${fontPx}px`, ...placement }}
             sx={{ position: 'absolute',
                    // Wide enough for an id plus a readable slice of title.
                    width: `${widthEm}em`,
                    maxWidth: `calc(100% - ${2 * CORNER_INSET}px)`,
                    // Beats max-height: the title bar is always whole.
                    minHeight: `${HEADER_EM}em`,
                    display: 'flex', flexDirection: 'column',
                    // The key's own panel treatment, outlined in purple.
                    background: 'rgba(13, 20, 32, 0.94)',
                    backdropFilter: 'blur(2px)',
                    borderRadius: '0.8em', border: `2px solid ${outline}`,
                    boxShadow: '0 0.5em 1.5em rgba(0, 0, 0, 0.45)',
                    fontFamily: MONO, color: P.text, userSelect: 'none',
                    overflow: 'hidden', zIndex: 2 }}>
            <Box data-testid={`${testId}-header`}
                 title={seatable && count > 0
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
                <Box component="span"
                     sx={{ flex: 1, minWidth: 0, overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}
                </Box>
                <Box component="span" data-testid={`${testId}-count`}
                     sx={{ color: statusColor, fontWeight: 700 }}>
                    {isError ? '!' : (isLoading ? '…' : count)}
                </Box>
                <Box component="button" type="button"
                     onClick={() => setOpen((v) => !v)}
                     aria-expanded={open}
                     aria-label={open ? 'Collapse the list' : 'Expand the list'}
                     data-testid={`${testId}-toggle`}
                     sx={{ width: '1.6em', height: '1.6em', p: 0, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'transparent', border: 'none',
                            borderRadius: '0.4em', color: P.text, cursor: 'pointer',
                            fontFamily: MONO, fontSize: '1.25em', lineHeight: 1,
                            '&:hover': { color: P.accent } }}>
                    {open ? '−' : '+'}
                </Box>
            </Box>

            {open && (
                <Box ref={listRef} data-testid={`${testId}-list`}
                     sx={{ overflowY: 'auto', overscrollBehavior: 'contain',
                            minHeight: 0, flex: '0 1 auto', maxHeight: '26em',
                            borderTop: `1px solid ${P.line}`, py: '0.35em' }}>
                    {isError && (
                        <Box sx={{ px: '0.8em', py: '0.5em', color: '#ff8a80' }}>
                            {errorText}
                        </Box>
                    )}
                    {!isError && !isLoading && count === 0 && (
                        <Box data-testid={`${testId}-empty`}
                             sx={{ px: '0.8em', py: '0.5em', color: P.dim }}>
                            {emptyText}
                        </Box>
                    )}
                    {items.map((r) => {
                        const id = Number(r.id);
                        const dragging = draggingId === id;
                        const color = itemColor?.(r) || statusColor;
                        const end = renderItemEnd?.(r);
                        return (
                            <Box key={id}
                                 draggable={seatable}
                                 data-testid={`${testId}-item-${id}`}
                                 onDragStart={!seatable ? undefined : (e) => {
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
                                        cursor: seatable ? 'grab' : 'pointer',
                                        opacity: dragging ? 0.3 : 1,
                                        // An opaque row so the drag image is a
                                        // solid copy, not a ghost of the canvas.
                                        background: dragging ? 'transparent' : '#0d1420',
                                        '&:hover': { background: '#16233a' } }}>
                                <Box component="span"
                                     sx={{ color, fontWeight: 700, flexShrink: 0 }}>
                                    {id}
                                </Box>
                                <Box component="span"
                                     sx={{ flex: 1, minWidth: 0, overflow: 'hidden',
                                            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {r.title}
                                </Box>
                                {end}
                            </Box>
                        );
                    })}
                </Box>
            )}
        </Box>
    );
}
