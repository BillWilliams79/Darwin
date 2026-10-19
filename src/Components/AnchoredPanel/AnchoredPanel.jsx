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

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';

import CollapseHead from './CollapseHead';
import {
    RESIZE_EDGES, dockAfterToggle, dockForToggle, dockFromMove, dockFromResize, dockedStyle, freeCorner,
    moveRect, resizeRect,
} from './anchoredPanelGeometry';

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
 * @param {Object} [props.sx]            more panel chrome
 * @param {number} [props.zIndex]
 */
export default function AnchoredPanel({
    dock, onDockChange, open, onToggle, name, testid, extras, actions, children,
    limits, fontPx = 12, border = 2, colors, sx, zIndex = 1250,
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
    // Unmounted mid-gesture, the release never comes.
    useEffect(() => () => { gestureRef.current = null; }, []);

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
            r0: { left: r.left, top: r.top, width: r.width, height: r.height },
            last: null,
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
    };
    const onUp = (e) => {
        const g = gestureRef.current;
        if (!g || e.pointerId !== g.id) return;
        gestureRef.current = null;
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setLive(null);
        // Only a release places it: a cancelled pointer (or capture lost
        // without one) puts the panel back where it was.
        if (!g.last || e.type !== 'pointerup') return;
        lastMoveEndRef.current = Date.now();
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
    const toggle = () => {
        const box = boxRef.current;
        if (box) {
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
    }, [open, dock]);
    const onHeadDoubleClick = (e) => {
        if (e.target.closest('button, a')) return;
        if (Date.now() - lastMoveEndRef.current < DBLCLICK_AFTER_MOVE_MS) return;
        onDockChange(null);
    };

    const reshapingH = !!live?.edge?.h;
    const reshapingV = !!live?.edge?.v;
    const placement = live
        ? { left: `${live.left}px`, top: `${live.top}px`,
            ...((reshapingH || dock.w != null || !live.edge)
                ? { width: `${live.width}px` } : { width: 'max-content', maxWidth: `${limits.autoMaxW}px` }),
            maxHeight: `calc(100% - ${live.top}px)`,
            ...((reshapingV || (open && dock.ht != null)) ? { height: `${live.height}px` } : {}) }
        : dockedStyle(dock, { open, headPx: limits.headPx, autoMaxW: limits.autoMaxW,
            minW: limits.minW });
    const shapedWidth = reshapingH ? live.width : dock.w;
    const grip = freeCorner(dock);
    const moving = live && !live.edge;
    // Folded, the panel is its head row, tight: nothing to reshape.
    const edges = open ? RESIZE_EDGES : [];

    return (
        <Box ref={boxRef} data-testid={testid}
             data-dock={`${dock.h}${dock.x},${dock.v}${dock.y}`}
             style={{ fontSize: `${fontPx}px`, ...placement }}
             sx={{ position: 'fixed', zIndex,
                    minHeight: `${limits.headPx}px`,
                    display: 'flex', flexDirection: 'column',
                    background: colors.background,
                    border: `${border}px solid ${colors.frame}`,
                    color: colors.text, userSelect: 'none',
                    overflow: 'hidden', boxSizing: 'border-box', ...sx }}>
            <Box data-testid={`${testid}-header`}
                 title="Drag to move · double-click to put back"
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
                <Box component="span" data-testid={`${testid}-title`}
                     sx={{ color: colors.head, fontSize: '0.9em', fontWeight: 700,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                            whiteSpace: 'nowrap', overflow: 'hidden',
                            textOverflow: 'ellipsis', minWidth: 0 }}>
                    {name}
                </Box>
                {/* Open: far right. Folded: right after the title. */}
                <Box sx={{ ml: open ? 'auto' : 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {actions}
                </Box>
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

            {open && (
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
}
