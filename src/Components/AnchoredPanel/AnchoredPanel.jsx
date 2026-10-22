// AnchoredPanel.jsx — a floating panel docked to the Darwin viewport that the
// reader moves, reshapes and collapses (req #3643). Pattern doc:
// memory/anchored-collapse-pattern.md; geometry in anchoredPanelGeometry.js.
//
// ── THE HEAD IS THE ANCHOR ─────────────────────────────────────────────────
// The head row is always the panel's top row: the CollapseHead (▾) at the
// upper left — every pop-up window's, one control (req #3741) — then the
// host's `extras` (a count badge), then the title — left-aligned — and the
// host's `actions`: at the far right while open; folded, right after the
// title, with the panel's right edge pulled in so the whole package is tight
// (user directives). The upper right is blank, or × where the host supports
// closing (req #3741). Clicking ▾ never moves it: the panel is pinned at its
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
// navbar glows in the panel's frame colour while it is over (req #3728). It
// lands at the bottom, unless pointed into the stack (req #3744). Released there,
// the panel is RACKED — portalled into the navbar's rack slot below its nav
// buttons, at the navbar's width, nothing to reshape. Open, it is as tall as
// its rows need and no taller, sharing a short navbar fairly with the other
// racked panels (req #3747); folded, it is its head row. The rack is the
// navbar's — or, on a page that shows its own toolbar, that toolbar's (req #3792:
// AI Architecture's, in its iframe), by the same rules. A head drag that starts
// in a rack in another document is worked in Darwin's viewport px (`slotOffset`)
// and, once the pointer is off that rack, LIFTS the panel into Darwin's page, so
// it follows the pointer over the whole page — an iframe would clip it — the way
// a panel dragged out of the navbar does; a reorder inside the rack stays where
// it is. Its pointer is followed on both documents (no element capture survives
// the lift), and its body's scroll position is carried across the remount.
// Dragging a racked panel's head up or down the stack reorders it; off the
// navbar, it floats again, docked where it was dropped. Where the reader racks it is the rack's (pure half in
// panelRack.js, DOM half in usePanelRack.js — shared with the Orchestrables box,
// req #3735); the host's own `dock` is left alone while it is racked. While a
// page covers the navbar (usePanelRackStore `covered`), the panel floats.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';

import CollapseHead from './CollapseHead';
import {
    RESIZE_EDGES, dockAfterToggle, dockForToggle, dockFromMove, dockFromResize, dockedStyle, freeCorner,
    moveRect, resizeRect,
} from './anchoredPanelGeometry';
import { rackOrder } from './panelRack';
import { rackPortal, slotOffset, usePanelRack } from './usePanelRack';

/** Pointer travel, px, before a head press becomes a move. */
const MOVE_SLOP = 4;
/** A double-click this soon after a move ended is the move's own release. */
const DBLCLICK_AFTER_MOVE_MS = 500;
/** Reshape hit zones, px (req #3743: "the activation area is tiny" — they were
 *  5 px / 8 px). Below the head row the sides and bottom are wide and the
 *  bottom corners generous; the head row's own sides, top edge and top corners
 *  stay slim so they keep clear of the ▾ and ×, which sit 0.7em in. */
const EDGE_PX = 10;
const CORNER_PX = 18;
const HEAD_EDGE_PX = 5;
const HEAD_CORNER_PX = 8;

const NO_OFFSET = { left: 0, top: 0 };
const POINTER_EVENTS = ['pointermove', 'pointerup', 'pointercancel'];

const viewport = () => ({
    vw: document.documentElement.clientWidth || window.innerWidth,
    vh: document.documentElement.clientHeight || window.innerHeight,
});

const CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };

function edgeZone(e, headPx, frame) {
    const z = { position: 'absolute', zIndex: 3, touchAction: 'none', cursor: CURSOR[e.id],
        // The zone shows itself under the pointer, so the reader sees what to grab.
        '&:hover': { background: `color-mix(in srgb, ${frame} 40%, transparent)` } };
    const corner = e.h && e.v;
    const top = e.v === 't';
    if (e.v) Object.assign(z, { [top ? 'top' : 'bottom']: 0,
        height: corner ? (top ? HEAD_CORNER_PX : CORNER_PX) : (top ? HEAD_EDGE_PX : EDGE_PX) });
    else Object.assign(z, { top: HEAD_CORNER_PX, bottom: CORNER_PX });
    if (e.h) Object.assign(z, { [e.h === 'l' ? 'left' : 'right']: 0,
        width: corner ? (top ? HEAD_CORNER_PX : CORNER_PX) : EDGE_PX });
    else Object.assign(z, { left: top ? HEAD_CORNER_PX : CORNER_PX, right: top ? HEAD_CORNER_PX : CORNER_PX });
    // A side edge is wide below the head row and slim beside it (clip-path
    // clips hit-testing too).
    if (e.h && !e.v) {
        const l = e.h === 'l';
        const a = HEAD_EDGE_PX;
        const h = Math.max(headPx - HEAD_CORNER_PX, 0);
        z.clipPath = l
            ? `polygon(0 0, ${a}px 0, ${a}px ${h}px, ${EDGE_PX}px ${h}px, ${EDGE_PX}px 100%, 0 100%)`
            : `polygon(${EDGE_PX - a}px 0, ${EDGE_PX}px 0, ${EDGE_PX}px 100%, 0 100%, 0 ${h}px, ${EDGE_PX - a}px ${h}px)`;
    }
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
 * @param {React.ReactNode} [props.actions]  right-aligned: blank, or × where
 *   the host supports closing (req #3741)
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
    // Its place in the rack's stack (-1 = not racked), and whether it is drawn
    // there: racked, a navbar to hold it, the navbar not covered.
    const rackApi = usePanelRack(rackId);
    const { rackPos, inRack, slot, overRack, narrow } = rackApi;
    // What the rack is called on the page: the navbar, or a page's toolbar.
    const rackName = slot?.name || 'navbar';
    useEffect(() => () => { gestureRef.current?.unlisten?.(); gestureRef.current = null; }, []);
    // The body's scroll position, kept across a remount (a lift out of a rack in
    // another document and back) — not written while a gesture reshapes it.
    const scrollRef = useRef(0);
    const onBodyScroll = (e) => { if (!gestureRef.current?.last) scrollRef.current = e.currentTarget.scrollTop; };

    const begin = (kind, edge = null) => (e) => {
        if (gestureRef.current || e.button !== 0) return;
        if (kind === 'move' && e.target.closest('button, a')) return;
        const box = boxRef.current;
        if (!box) return;
        e.preventDefault();
        e.stopPropagation();
        const r = box.getBoundingClientRect();
        // Racked in a page toolbar's iframe, its pointer and rect are in that
        // document's px: the gesture is worked in Darwin's (req #3792), and the
        // panel is lifted into Darwin's page once it moves — so the pointer is
        // followed on both documents rather than captured by an element the
        // lift unmounts.
        const slotDoc = inRack ? slot.node.ownerDocument : null;
        const foreign = !!slotDoc && slotDoc !== document;
        const off = foreign ? slotOffset(slot) : NO_OFFSET;
        let unlisten = null;
        if (foreign) {
            const docs = [slotDoc, document];
            const on = (ev) => (ev.type === 'pointermove' ? onMove(ev) : onUp(ev));
            docs.forEach(d => POINTER_EVENTS.forEach(t => d.addEventListener(t, on)));
            unlisten = () => docs.forEach(d => POINTER_EVENTS.forEach(t => d.removeEventListener(t, on)));
        } else {
            e.currentTarget.setPointerCapture?.(e.pointerId);
        }
        gestureRef.current = {
            kind, edge, id: e.pointerId, off, slotDoc: foreign ? slotDoc : null, unlisten,
            sx: e.clientX + off.left, sy: e.clientY + off.top,
            // Dragged out of the rack, a tall stack-sized panel would be held
            // high by the viewport clamp: only its head need stay on screen
            // (the drawn height is capped below the pointer anyway).
            r0: { left: r.left + off.left, top: r.top + off.top, width: r.width,
                height: kind === 'move' && inRack ? Math.min(r.height, limits.headPx) : r.height },
            last: null, fromRack: inRack,
        };
    };
    // The pointer in Darwin's viewport px — offset when it reports in the
    // slot's document. A gesture followed on the documents ignores its
    // element's own handlers (the same event, bubbling).
    const ownEvent = (g, e) => !g.unlisten || e.currentTarget?.nodeType === 9;
    const at = (g, e) => {
        const t = e.currentTarget;
        const off = (t?.nodeType === 9 ? t : t?.ownerDocument) === g.slotDoc ? g.off : NO_OFFSET;
        return { x: e.clientX + off.left, y: e.clientY + off.top };
    };
    const onMove = (e) => {
        const g = gestureRef.current;
        if (!g || e.pointerId !== g.id || !ownEvent(g, e)) return;
        // No capture backs a gesture followed on the documents: a release that
        // never arrived (outside the window) ends it as a cancel.
        if (g.unlisten && e.buttons === 0) {
            onUp({ type: 'pointercancel', pointerId: e.pointerId, currentTarget: e.currentTarget,
                clientX: e.clientX, clientY: e.clientY });
            return;
        }
        const { x, y } = at(g, e);
        const dx = x - g.sx;
        const dy = y - g.sy;
        if (!g.last && g.kind === 'move' && Math.hypot(dx, dy) <= MOVE_SLOP) return;
        const { vw, vh } = viewport();
        g.last = g.kind === 'move'
            ? moveRect(g.r0, dx, dy, vw, vh)
            : resizeRect(g.r0, dx, dy, g.edge, vw, vh, limits.minW, limits.minH);
        // Lifted only off the rack: a reorder inside it is drawn where it is.
        setLive({ ...g.last, edge: g.edge, lifted: !!g.slotDoc && !rackApi.isOver(x, y, g.fromRack) });
        if (g.kind === 'move') rackApi.track(x, y, g.fromRack, colors.frame);
    };
    const onUp = (e) => {
        const g = gestureRef.current;
        if (!g || e.pointerId !== g.id || !ownEvent(g, e)) return;
        gestureRef.current = null;
        g.unlisten?.();
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setLive(null);
        // Only a release places it: a cancelled pointer (or capture lost
        // without one) puts the panel back where it was.
        if (!g.last || e.type !== 'pointerup') {
            if (g.kind === 'move') rackApi.cancel();
            return;
        }
        lastMoveEndRef.current = Date.now();
        if (g.kind === 'move') {
            const { x, y } = at(g, e);
            const placed = rackApi.release(x, y, g.fromRack);
            // Dropped on the navbar: into the stack where the pointer is.
            // Its floating dock is kept for the day it is dragged back out.
            if (placed === 'racked') return;
            // Dragged off the navbar: floats where it was dropped. Its floating
            // size is not the navbar's, so — like a toggle — pin its left and
            // top, and re-dock once that size has drawn (the effect below).
            if (placed === 'unracked') {
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
    // Remounted (lifted out of a rack in another document, or back): its rows
    // keep their scroll position.
    const lifted = !!live?.lifted;
    useLayoutEffect(() => {
        if (bodyRef.current && scrollRef.current) bodyRef.current.scrollTop = scrollRef.current;
    }, [lifted, inRack, slot?.node]);
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
    // Dragged within a rack in another document, it is still drawn there: in
    // that document's px.
    const drawnOff = live && inRack && !live.lifted ? slotOffset(slot) : NO_OFFSET;
    const placement = live
        ? { left: `${live.left - drawnOff.left}px`, top: `${live.top - drawnOff.top}px`,
            ...((reshapingH || dock.w != null || !live.edge)
                ? { width: `${live.width}px` } : { width: 'max-content', maxWidth: `${limits.autoMaxW}px` }),
            maxHeight: `calc(100% - ${live.top - drawnOff.top}px)`,
            ...((reshapingV || (open && dock.ht != null && !inRack)) ? { height: `${live.height}px` } : {}) }
        : racking ? { width: '100%' }
            : dockedStyle(dock, { open, headPx: limits.headPx, autoMaxW: limits.autoMaxW,
                minW: limits.minW });
    const shapedWidth = reshapingH ? live.width : (inRack ? slot.width : dock.w);
    // The icon-only navbar (`narrow`) has room for the ▾ and the host's extras alone.
    const grip = freeCorner(dock);
    const moving = live && !live.edge;
    // Folded, the panel is its head row, tight: nothing to reshape. Racked,
    // the navbar sets its width and its rows its height.
    const edges = open && !inRack ? RESIZE_EDGES : [];

    const panel = (
        <Box ref={boxRef} data-testid={testid}
             data-dock={`${dock.h}${dock.x},${dock.v}${dock.y}`}
             {...(rackId ? { 'data-rack-id': rackId, 'data-racked': inRack ? '1' : '0',
                 'data-rack-open': inRack && open ? '1' : '0' } : {})}
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
                    // In the stack: square, flat. The rack's row sizes it: open,
                    // the height its rows need and no more (req #3747), giving
                    // way fairly when the rack is short — its body scrolls.
                    // Folded, it is its head.
                    ...(racking && { order: rackOrder(rackPos),
                        borderRadius: 0, boxShadow: 'none' }) }}>
            <Box data-testid={`${testid}-header`}
                 title={inRack ? `Drag to reorder · drag off the ${rackName} to float it`
                     : `Drag to move · double-click to put back${rackId ? ` · drop on the ${rackName} to rack it` : ''}`}
                 {...gesture('move')}
                 onDoubleClick={onHeadDoubleClick}
                 sx={{ display: 'flex', alignItems: 'center', gap: '0.6em',
                        px: '0.7em', py: '0.3em', flexShrink: 0, minWidth: 0,
                        ...(open && { borderBottom: `1px solid ${colors.line}` }),
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
            <Box ref={bodyRef} data-testid={`${testid}-body`} onScroll={onBodyScroll}
                 data-folded={open ? '0' : '1'}
                 aria-hidden={open ? undefined : 'true'}
                 sx={{ overflowY: 'auto', overscrollBehavior: 'contain',
                        // A classic scrollbar must not change the open
                        // width as rows come and go. Racked, the navbar sets
                        // the width, so nothing to hold — and a reserved gutter
                        // there is only a blank strip inside the right frame
                        // (req #3748).
                        scrollbarGutter: inRack ? 'auto' : 'stable',
                        minHeight: 0, flex: '1 1 auto',
                        py: '0.2em',
                        // Its scrollbar sits inside the right reshape zone, not under it.
                        ...(!inRack && { mr: `${EDGE_PX}px` }),
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
                     sx={edgeZone(e, limits.headPx, colors.frame)} />
            ))}
        </Box>
    );
    // Lifted out of a rack in another document, it is drawn in Darwin's page.
    return inRack && !lifted ? rackPortal(panel, slot) : panel;
}
