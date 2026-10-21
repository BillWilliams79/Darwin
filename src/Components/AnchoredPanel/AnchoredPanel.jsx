// AnchoredPanel.jsx — a floating panel docked to the Darwin viewport that the
// reader moves, reshapes and collapses (req #3643). Pattern doc:
// memory/anchored-collapse-pattern.md; geometry in anchoredPanelGeometry.js.
//
// ── THE HEAD IS THE ANCHOR ─────────────────────────────────────────────────
// The head row is always the panel's top row: the CollapseHead (▾), then the
// host's `extras` (a count badge), then the title — left-aligned — and the
// host's `actions`: at the far right while open; folded, right after the
// title, with the panel's right edge pulled in so the whole package is tight
// (user directives). Clicking ▾ never moves it: the panel is pinned at its
// current left and top first (`dockForToggle`), so the right and bottom edges
// do the moving, then re-docked where it is drawn (`dockAfterToggle`).

// ── MOVED BY ITS HEAD ROW, RESHAPED FROM ANY EDGE OR CORNER ─────────────────
// The head row's non-button space (badge, title, gap) is the drag handle: pointer
// capture, one pointer at a time, a slop before a press counts as a move.
// Every edge and corner reshapes it; a drag sizes only the axes it touched,
// so an untouched axis stays content-sized. A visible grip marks a bottom
// corner (never the head row's). A cancelled pointer reverts. Double-click the head row's free space
// to send the panel home.
//
// It owns no state: `dock`/`open` come in, `onDockChange`/`onToggle` go out,
// so the host decides where they persist.
//
// ── RACKABLE (req #3720) ───────────────────────────────────────────────────
// A host that names a `rackId` can drop its panel onto the Darwin navbar: while
// the head is dragged, the pointer is hit-tested against the navbar's drop zone
// (`[data-panel-rack-zone]`) and the drag published to usePanelRackStore, so the
// navbar glows in the panel's frame colour while it is over (req #3728).
// Released there,
// the panel is RACKED — portalled into the navbar's rack slot below its nav
// buttons, at the navbar's width, content-sized in height, nothing to reshape.
// Dragging a racked panel's head off the navbar floats it again, docked where it
// was dropped. Where the reader racks it is the rack's (pure half in
// panelRack.js); the host's own `dock` is left alone while it is racked.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import Box from '@mui/material/Box';

import { usePanelRackStore } from '../../stores/usePanelRackStore';
import CollapseHead from './CollapseHead';
import {
    RESIZE_EDGES, dockAfterToggle, dockForToggle, dockFromMove, dockFromResize, dockedStyle, freeCorner,
    moveRect, resizeRect,
} from './anchoredPanelGeometry';
import { RACK_NARROW_PX, pointInRect, rackDropIndex, rackOrder } from './panelRack';

/** Pointer travel, px, before a head press becomes a move. */
const MOVE_SLOP = 4;
/** A double-click this soon after a move ended is the move's own release. */
const DBLCLICK_AFTER_MOVE_MS = 500;
/** Reshape hit zones, px: an edge's thickness and a corner's square. Small
 *  enough to stay clear of the head row's ▾ and ×, which sit 0.7em in. */
const EDGE_PX = 5;
const CORNER_PX = 8;

const viewport = () => ({
    vw: document.documentElement.clientWidth || window.innerWidth,
    vh: document.documentElement.clientHeight || window.innerHeight,
});

const CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };

/** Where the rack would put a panel released at (x, y): `over` the navbar's
 *  drop zone, and at which `index` of the other racked panels. */
function rackTarget(rackId, x, y) {
    const zone = document.querySelector('[data-panel-rack-zone]');
    const { slot, racked } = usePanelRackStore.getState();
    if (!zone || !slot?.node || !pointInRect(x, y, zone.getBoundingClientRect())) {
        return { over: false, index: null };
    }
    const mids = new Map();
    slot.node.querySelectorAll('[data-rack-id]').forEach((el) => {
        const r = el.getBoundingClientRect();
        mids.set(el.getAttribute('data-rack-id'), r.top + r.height / 2);
    });
    return { over: true, index: rackDropIndex(racked.filter(id => id !== rackId), mids, y) };
}

/** Publish a rack drag, writing only when it changed (a move fires per pixel). */
function publishDrag(next) {
    const { drag, setDrag } = usePanelRackStore.getState();
    if (drag === next) return;
    if (drag && next && ['id', 'over', 'index', 'fromRack', 'color'].every(k => drag[k] === next[k])) return;
    setDrag(next);
}

function edgeZone(e) {
    const z = { position: 'absolute', zIndex: 3, touchAction: 'none', cursor: CURSOR[e.id] };
    const corner = e.h && e.v;
    if (e.v) Object.assign(z, { [e.v === 't' ? 'top' : 'bottom']: 0, height: corner ? CORNER_PX : EDGE_PX });
    else Object.assign(z, { top: CORNER_PX, bottom: CORNER_PX });
    if (e.h) Object.assign(z, { [e.h === 'l' ? 'left' : 'right']: 0, width: corner ? CORNER_PX : EDGE_PX });
    else Object.assign(z, { left: CORNER_PX, right: CORNER_PX });
    return z;
}

/**
 * @param {Object} props
 * @param {Object} props.dock            a valid dock (see anchoredPanelGeometry)
 * @param {function} props.onDockChange  (dock | null) — null = home
 * @param {boolean} props.open
 * @param {function} props.onToggle
 * @param {string} props.name            the CollapseHead's name
 * @param {string} props.testid          root testid; parts are suffixed
 * @param {React.ReactNode} [props.extras]   left-aligned after the head
 * @param {React.ReactNode} [props.actions]  right-aligned
 * @param {function} props.children      ({ shapedWidth }) → body; shapedWidth
 *   is the reader's width (live while reshaping), null when content-sized
 * @param {{minW, minH, autoMaxW, headPx}} props.limits
 * @param {number} [props.fontPx]        everything inside is in em off it
 * @param {number} [props.border]        the frame's width, px
 * @param {{frame, background, line, head, headHover, text}} props.colors
 *   `frame` is a concrete CSS colour: the navbar's drop glow mixes it (req #3728)
 * @param {Object} [props.sx]            more panel chrome
 * @param {number} [props.zIndex]
 * @param {string} [props.rackId]        names the panel in the navbar rack;
 *   absent = it never racks (req #3720)
 */
export default function AnchoredPanel({
    dock, onDockChange, open, onToggle, name, testid, extras, actions, children,
    limits, fontPx = 12, border = 2, colors, sx, zIndex = 1250, rackId,
}) {
    const boxRef = useRef(null);
    const bodyRef = useRef(null);
    // The pin a toggle set, consumed once the toggle has drawn (see below).
    const pinRef = useRef(null);
    // The gesture lives in a ref; `live` is the rect it is drawing, in
    // viewport px, until release docks it.
    const gestureRef = useRef(null);
    const [live, setLive] = useState(null);
    const lastMoveEndRef = useRef(0);
    // Its place in the rack's stack; -1 = not racked.
    const rackPos = usePanelRackStore(s => (rackId ? s.racked.indexOf(rackId) : -1));
    const racked = rackPos !== -1;
    const slot = usePanelRackStore(s => s.slot);
    const overRack = usePanelRackStore(s => !!rackId && s.drag?.id === rackId && s.drag.over);
    // Racked AND the navbar is drawn to hold it; with no rack (mobile) it floats.
    const inRack = racked && !!slot?.node;
    // Unmounted mid-gesture, the release never comes — nor the drag's end.
    useEffect(() => () => {
        if (gestureRef.current && rackId && usePanelRackStore.getState().drag?.id === rackId) {
            usePanelRackStore.getState().setDrag(null);
        }
        gestureRef.current = null;
    }, [rackId]);

    const begin = (kind, edge = null) => (e) => {
        if (gestureRef.current || e.button !== 0) return;
        if (kind === 'move' && e.target.closest('button, a')) return;
        const box = boxRef.current;
        if (!box) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const r = box.getBoundingClientRect();
        gestureRef.current = {
            kind, edge, id: e.pointerId, sx: e.clientX, sy: e.clientY,
            // Dragged out of the rack, a tall stack-sized panel would be held
            // high by the viewport clamp: only its head need stay on screen
            // (the drawn height is capped below the pointer anyway).
            r0: { left: r.left, top: r.top, width: r.width,
                height: kind === 'move' && inRack ? Math.min(r.height, limits.headPx) : r.height },
            last: null, fromRack: inRack,
        };
    };
    const onMove = (e) => {
        const g = gestureRef.current;
        if (!g || e.pointerId !== g.id) return;
        const dx = e.clientX - g.sx;
        const dy = e.clientY - g.sy;
        if (!g.last && g.kind === 'move' && Math.hypot(dx, dy) <= MOVE_SLOP) return;
        const { vw, vh } = viewport();
        g.last = g.kind === 'move'
            ? moveRect(g.r0, dx, dy, vw, vh)
            : resizeRect(g.r0, dx, dy, g.edge, vw, vh, limits.minW, limits.minH);
        setLive({ ...g.last, edge: g.edge });
        if (g.kind === 'move' && rackId) {
            // `color` — its frame: the navbar glows in it while it is over (req #3728).
            publishDrag({ id: rackId, fromRack: g.fromRack, color: colors.frame,
                ...rackTarget(rackId, e.clientX, e.clientY) });
        }
    };
    const onUp = (e) => {
        const g = gestureRef.current;
        if (!g || e.pointerId !== g.id) return;
        gestureRef.current = null;
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setLive(null);
        const racking = g.kind === 'move' && !!rackId;
        if (racking) publishDrag(null);
        // Only a release places it: a cancelled pointer (or capture lost
        // without one) puts the panel back where it was.
        if (!g.last || e.type !== 'pointerup') return;
        lastMoveEndRef.current = Date.now();
        if (racking) {
            const target = rackTarget(rackId, e.clientX, e.clientY);
            const { rack, unrack } = usePanelRackStore.getState();
            // Dropped on the navbar: into the stack where the pointer is.
            // Its floating dock is kept for the day it is dragged back out.
            if (target.over) { rack(rackId, target.index); return; }
            // Dragged off the navbar: floats where it was dropped. Its floating
            // size is not the navbar's, so — like a toggle — pin its left and
            // top, and re-dock once that size has drawn (the effect below).
            if (g.fromRack) {
                unrack(rackId);
                pinRef.current = { left: g.last.left, top: g.last.top };
                onDockChange(dockForToggle(dock, g.last));
                return;
            }
        }
        const { vw, vh } = viewport();
        onDockChange(g.kind === 'move'
            ? dockFromMove(g.last, vw, vh, dock)
            : dockFromResize(g.last, vw, vh, dock, g.edge));
    };
    const gesture = (kind, edge) => ({
        onPointerDown: begin(kind, edge),
        onPointerMove: onMove,
        onPointerUp: onUp,
        onPointerCancel: onUp,
        onLostPointerCapture: onUp,
    });
    // THE HEAD IS THE ANCHOR: pin the panel at its current left and top before
    // it folds or unfolds, so the ▾ stays put and the far edges move.
    // Racked, the navbar holds it: nothing to pin, the stack below just moves.
    const toggle = () => {
        const box = boxRef.current;
        if (box && !inRack) {
            const r = box.getBoundingClientRect();
            pinRef.current = { left: r.left, top: r.top };
            onDockChange(dockForToggle(dock, r));
        }
        onToggle();
    };
    // Once the toggle has drawn (before paint), re-dock at the pin to the
    // nearest sides — nothing moves, and a lower-right panel is anchored to
    // its corner again — moving left/up only if unfolded rows lack the room.
    useLayoutEffect(() => {
        const pin = pinRef.current;
        if (!pin) return;
        pinRef.current = null;
        const box = boxRef.current;
        const body = bodyRef.current;
        if (!box) return;
        const r = box.getBoundingClientRect();
        const hidden = open && body ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
        const height = open && dock.ht != null ? Math.max(r.height, dock.ht) : r.height + hidden;
        const { vw, vh } = viewport();
        const next = dockAfterToggle(pin, { width: r.width, height }, vw, vh, dock);
        if (['h', 'x', 'v', 'y'].some(k => next[k] !== dock[k])) onDockChange(next);
    }, [open, dock, inRack]);
    const onHeadDoubleClick = (e) => {
        // Racked, it has no home to go to: it is dragged out instead.
        if (inRack) return;
        if (e.target.closest('button, a')) return;
        if (Date.now() - lastMoveEndRef.current < DBLCLICK_AFTER_MOVE_MS) return;
        onDockChange(null);
    };

    const reshapingH = !!live?.edge?.h;
    const reshapingV = !!live?.edge?.v;
    // Racked and at rest, it is in the navbar's flow at the navbar's width;
    // dragged out, it is drawn fixed under the pointer like any move.
    const racking = inRack && !live;
    const placement = live
        ? { left: `${live.left}px`, top: `${live.top}px`,
            ...((reshapingH || dock.w != null || !live.edge)
                ? { width: `${live.width}px` } : { width: 'max-content', maxWidth: `${limits.autoMaxW}px` }),
            maxHeight: `calc(100% - ${live.top}px)`,
            ...((reshapingV || (open && dock.ht != null && !inRack)) ? { height: `${live.height}px` } : {}) }
        : racking ? { width: '100%' }
            : dockedStyle(dock, { open, headPx: limits.headPx, autoMaxW: limits.autoMaxW,
                minW: limits.minW });
    const shapedWidth = reshapingH ? live.width : (inRack ? slot.width : dock.w);
    // The icon-only navbar has room for the ▾ and the host's extras alone.
    const narrow = inRack && slot.width < RACK_NARROW_PX;
    const grip = freeCorner(dock);
    const moving = live && !live.edge;
    // Folded, the panel is its head row, tight: nothing to reshape. Racked,
    // the navbar sets its width and its rows its height.
    const edges = open && !inRack ? RESIZE_EDGES : [];

    const panel = (
        <Box ref={boxRef} data-testid={testid}
             data-dock={`${dock.h}${dock.x},${dock.v}${dock.y}`}
             {...(rackId ? { 'data-rack-id': rackId, 'data-racked': inRack ? '1' : '0' } : {})}
             style={{ fontSize: `${fontPx}px`, ...placement }}
             sx={{ position: racking ? 'relative' : 'fixed', zIndex,
                    minHeight: `${limits.headPx}px`,
                    display: 'flex', flexDirection: 'column',
                    background: colors.background,
                    border: `${border}px solid ${colors.frame}`,
                    color: colors.text, userSelect: 'none',
                    overflow: 'hidden', boxSizing: 'border-box', ...sx,
                    // Over the navbar, see the drop zone through it.
                    ...(overRack && { opacity: 0.75 }),
                    // In the stack: square, flat, never squeezed by its
                    // neighbours (the rack scrolls instead).
                    ...(racking && { order: rackOrder(rackPos),
                        flexShrink: 0, borderRadius: 0, boxShadow: 'none' }) }}>
            <Box data-testid={`${testid}-header`}
                 title={inRack ? 'Drag off the navbar to float it'
                     : `Drag to move · double-click to put back${rackId ? ' · drop on the navbar to rack it' : ''}`}
                 {...gesture('move')}
                 onDoubleClick={onHeadDoubleClick}
                 sx={{ display: 'flex', alignItems: 'center', gap: '0.6em',
                        px: '0.7em', py: '0.3em', flexShrink: 0, minWidth: 0,
                        cursor: moving ? 'grabbing' : 'move', touchAction: 'none' }}>
                <CollapseHead open={open} onToggle={toggle} name={name}
                              testid={`${testid}-toggle`}
                              color={colors.head} hoverColor={colors.headHover}
                              fontSize="0.9em" showName={false} />
                {extras}
                {/* The title, in the head's own small caps. Not a button:
                    pressing it starts a move, like the rest of the row. */}
                {!narrow && <Box component="span" data-testid={`${testid}-title`}
                     sx={{ color: colors.head, fontSize: '0.9em', fontWeight: 700,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                            whiteSpace: 'nowrap', overflow: 'hidden',
                            textOverflow: 'ellipsis', minWidth: 0 }}>
                    {name}
                </Box>}
                {/* Open: far right. Folded: right after the title. */}
                {!narrow && <Box sx={{ ml: open ? 'auto' : 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {actions}
                </Box>}
            </Box>

            {/* Folded, the body takes no room at all — the panel is its head
                row, tight. (The ▾ cannot slide: the toggle pinned the left.)
                It stays mounted so the list keeps its scroll position. */}
            <Box ref={bodyRef} data-testid={`${testid}-body`}
                 data-folded={open ? '0' : '1'}
                 aria-hidden={open ? undefined : 'true'}
                 sx={{ overflowY: 'auto', overscrollBehavior: 'contain',
                        // A classic scrollbar must not change the open
                        // width as rows come and go.
                        scrollbarGutter: 'stable',
                        minHeight: 0, flex: '1 1 auto',
                        borderTop: `1px solid ${colors.line}`,
                        py: '0.2em',
                        ...(!open && { display: 'none' }) }}>
                {children({ shapedWidth })}
            </Box>

            {open && !inRack && (
                <Box data-testid={`${testid}-grip`} aria-hidden="true"
                     data-corner={`${grip.v}${grip.h}`}
                     sx={{ position: 'absolute', width: '0.8em', height: '0.8em',
                            pointerEvents: 'none', zIndex: 2,
                            [grip.h === 'r' ? 'right' : 'left']: '0.15em',
                            [grip.v === 'b' ? 'bottom' : 'top']: '0.15em',
                            // A corner bracket on the grip's own two sides.
                            [grip.h === 'r' ? 'borderRight' : 'borderLeft']: `2px solid ${colors.frame}`,
                            [grip.v === 'b' ? 'borderBottom' : 'borderTop']: `2px solid ${colors.frame}`,
                            borderRadius: '0.15em' }} />
            )}
            {edges.map(e => (
                <Box key={e.id} data-testid={`${testid}-edge-${e.id}`}
                     title="Drag to reshape"
                     {...gesture('resize', { h: e.h, v: e.v })}
                     sx={edgeZone(e)} />
            ))}
        </Box>
    );
    return inRack ? createPortal(panel, slot.node) : panel;
}
