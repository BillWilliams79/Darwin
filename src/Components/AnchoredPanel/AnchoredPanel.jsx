// AnchoredPanel.jsx — the frame of an Action Popup: a floating panel docked to
// the Darwin viewport that the reader moves, reshapes and collapses (req
// #3643). Pattern doc: memory/anchored-collapse-pattern.md; geometry in
// anchoredPanelGeometry.js.
//
// ── THE HEAD IS THE ANCHOR ─────────────────────────────────────────────────
// The head row is always the panel's top row — ActionPopupHead, the one every
// Action Popup draws (req #3821): the CollapseHead (▾) at the upper left —
// one control (req #3741) — then the badge slot holding the host's `extras`
// (a count badge; blank, it still holds its place, so titles line up — unless
// the host says `badgeSlot={false}`, the Requirement Filer, req #3830), then
// the title — left-aligned — and the
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
//
// ── LOCKED INTO THE TITLE BAR (req #3857) ─────────────────────────────────
// A host that passes `onTitleLockChange` (the Requirement Filer and the Dev
// Servers popups, req #3961) can drop its
// panel on the page's TITLE BAR (`[data-title-bar]`): the bar glows as the rack
// does, and released there the panel is LOCKED — drawn in the bar where it was
// dropped, its head on the bar's line, staying there as the bar resizes and
// scrolls, and only ever in the bar's free space: it never covers the bar's own
// buttons and text, and they never move for it (titleBarLock.js — a gap
// narrower than its content narrows it; a bar with no room floats it at its
// dock until there is). Locked, nothing reshapes it and ▾ folds it in place, its
// rows dropping below the bar. Dragged along the bar it re-locks where dropped
// (straight out of the rack, too); off the bar it floats again; onto the navbar
// it racks (the lock is dropped).
//
// ── TWO RACKS, AND AN ICON IN A MINIMIZED ONE (req #3886) ──────────────────
// The navbar and a page's own toolbar are both drop zones at once, and each
// keeps the panels dropped on it (usePanelRackStore `rackPlacement`): dragged
// from one onto the other, a panel moves there; folding a bar never moves it.
// In a MINIMIZED bar (`narrow` — the icon-only navbar, the folded toolbar) a
// host that names a `rackIcon` is drawn as that ONE icon, like the bar's own
// nav icons, in a box framed in the panel's own colour: its label is the
// tooltip, a click runs `onRackIcon` (the Requirement Filer's + files a new
// requirement) or else unfolds the bar (`slot.expand`), and dragging it moves
// the panel as its head does. A host without one keeps its head row there.
//
// ── POLISH (req #3893) ─────────────────────────────────────────────────────
// Double-click a reshape CORNER — the 2-D thumb — and the panel FITS ITS
// CONTENT: one measuring render with every cap lifted (the host is told it is
// content-sized, so a small view gives its titles back), then it docks at that
// natural size, capped at the viewport, its docked corner held (`dockToFit`).
// While a drag would dock it on release — over a rack, or the title bar — the
// panel shimmers in its frame colour (`actionPopupDockCue`), so the reader
// knows to let go.
//
// ── WHAT IT FLIES OVER (req #3958) ─────────────────────────────────────────
// A host that passes `onMoveTrack` is told, every frame of a head drag, the
// rect it is drawn at and whether a release would DOCK it (`docking` — over a
// rack, or the title bar), then once how the drag ended: `drop` (docking: it
// racked or locked) or `cancel`. The host answers each move frame with whether
// it is pointing at something — or, deciding later, calls that frame's `aim`
// (req #4046); while it is, the panel is drawn translucent so what it points
// at shows through (the Requirement Filer — filerHover.js).
// `dockable={false}` (the filer's pushpin picker mode) suspends docking for the
// drag: no rack and no title bar takes it — dragged out of one it floats — so
// a bar's own elements are something it can point at. `dockable="navbar"` (req
// #4172) lets the navbar's rack alone take it: no page toolbar, no title bar.

import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';

import ActionPopupHead from './ActionPopupHead';
import { ACTION_POPUP_EDGE_PX, actionPopupDockCue, actionPopupReshapeZone } from './actionPopupChrome';
import {
    RESIZE_EDGES, dockAfterToggle, dockForToggle, dockFromMove, dockFromResize, dockToFit, dockedStyle,
    freeCorner, moveRect, resizeRect,
} from './anchoredPanelGeometry';
import { rackOrder } from './panelRack';
import { rackPortal, slotOffset, usePanelRack } from './usePanelRack';
import { useTitleBarLock } from './useTitleBarLock';

/** Pointer travel, px, before a head press becomes a move. */
const MOVE_SLOP = 4;
/** The panel's opacity while its host points at what it flies over (req #3958). */
const AIMED_OPACITY = 0.6;
/** Every Action Popup's stacking, and every one's while racked: a panel given
 *  its own `zIndex` (the Requirement Filer, req #4044) is raised only floating
 *  and carried — in a rack it neither covers nor passes over its neighbours. */
export const PANEL_Z = 1250;
/** A double-click this soon after a move ended is the move's own release. */
const DBLCLICK_AFTER_MOVE_MS = 500;
/** The body's right margin: its scrollbar sits inside the right reshape zone. */
const EDGE_PX = ACTION_POPUP_EDGE_PX;

const NO_OFFSET = { left: 0, top: 0 };
const POINTER_EVENTS = ['pointermove', 'pointerup', 'pointercancel'];

const viewport = () => ({
    vw: document.documentElement.clientWidth || window.innerWidth,
    vh: document.documentElement.clientHeight || window.innerHeight,
});

/**
 * @param {Object} props
 * @param {Object} props.dock            a valid dock (see anchoredPanelGeometry)
 * @param {function} props.onDockChange  (dock | null) — null = home
 * @param {boolean} props.open
 * @param {function} props.onToggle
 * @param {string} props.name            the CollapseHead's name
 * @param {string} props.testid          root testid; parts are suffixed
 * @param {React.ReactNode} [props.extras]   the badge slot, after the ▾
 * @param {boolean} [props.badgeSlot]  false = no badge slot: the title sits
 *   against the ▾ (the Requirement Filer, req #3830)
 * @param {React.ReactNode} [props.actions]  right-aligned: blank, or × where
 *   the host supports closing (req #3741)
 * @param {function} props.children      ({ shapedWidth }) → body; shapedWidth
 *   is the reader's width (live while reshaping), null when content-sized
 * @param {{minW, minH, autoMaxW, headPx, fitMinW}} props.limits  `fitMinW`:
 *   the narrowest a corner double-click's fit may be — the width below which
 *   the host drops to a smaller layout than the one it measured (req #3893)
 * @param {number} [props.fontPx]        everything inside is in em off it
 * @param {number} [props.border]        the frame's width, px
 * @param {{frame, background, line, head, headHover, text}} props.colors
 *   `frame` is a concrete CSS colour: the navbar's drop glow mixes it (req #3728)
 * @param {Object} [props.sx]            more panel chrome
 * @param {number} [props.zIndex]
 * @param {string} [props.rackId]        names the panel in the navbar rack;
 *   absent = it never racks (req #3720)
 * @param {?{side, x}} [props.titleLock] where it is locked into the page's
 *   title bar; null = not locked (req #3857)
 * @param {function} [props.onTitleLockChange]  ({side, x} | null); absent =
 *   it never locks into a title bar
 * @param {React.ElementType} [props.rackIcon]  its icon in a minimized bar
 *   (req #3886); absent = its head row is drawn there
 * @param {string} [props.rackIconLabel]  the icon's tooltip; default its name
 * @param {function} [props.onRackIcon]  the icon's click; default: unfold the bar
 * @param {function} [props.onRackIconPress]  a press on the icon begins, before
 *   focus moves (the Filer notes the field being typed in, req #3829)
 * @param {function} [props.onMoveTrack]  ({phase: 'move'|'drop'|'cancel', rect,
 *   docking, aim}) during and at the end of a head drag; a move frame's truthy
 *   answer draws the panel translucent (req #3958), as does `aim(true)` called
 *   later in the drag — a host that decides off the frame (req #4046)
 * @param {boolean|'navbar'} [props.dockable]  false = a drag never racks or title-locks
 *   it (dragged out of either, it floats) — the filer's picker mode (req #3958);
 *   'navbar' = only the navbar's rack takes it — no page toolbar, no title bar
 *   (the pinned filer, req #4172)
 * @param {boolean} [props.overhang]  true = a head drag may carry it half off
 *   the viewport, its centre kept inside (req #4046); released, it docks back
 *   whole on screen as always
 */
export default function AnchoredPanel({
    dock, onDockChange, open, onToggle, name, testid, extras, badgeSlot = true, actions, children,
    limits, fontPx = 12, border = 2, colors, sx, zIndex = PANEL_Z, rackId, titleLock = null, onTitleLockChange,
    rackIcon, rackIconLabel, onRackIcon, onRackIconPress, onMoveTrack, dockable = true, overhang = false,
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
    // The host points at what the panel flies over (req #3958): drawn translucent.
    // Set every frame: a gesture followed on the documents runs the press's
    // closures, whose `aimed` is stale (React skips an unchanged value).
    const [aimed, setAimed] = useState(false);
    const aim = setAimed;
    const onMoveTrackRef = useRef(onMoveTrack);
    onMoveTrackRef.current = onMoveTrack;
    // The rect a head drag draws it at — at the height it is drawn: dragged
    // out of a rack, `last` is only its head's.
    const drawnRect = (g) => {
        const h = boxRef.current?.getBoundingClientRect().height;
        return h ? { ...g.last, height: h } : g.last;
    };
    // The drag's end, told once to a host that tracks it.
    const endTrack = (g, phase, docking = false) => {
        aim(false);
        if (g.tracked) onMoveTrack?.({ phase, rect: drawnRect(g), docking });
    };
    // A fit to content (req #3893) in progress: the rect it was drawn at, for
    // the one measuring render with every cap lifted. Null otherwise.
    const [fitFrom, setFitFrom] = useState(null);
    // Its place in the rack's stack (-1 = not racked), and whether it is drawn
    // there: racked, a navbar to hold it, the navbar not covered.
    const rackApi = usePanelRack(rackId);
    const { rackPos, inRack, slot, overRack, narrow } = rackApi;
    // What the rack is called on the page: the navbar, or a page's toolbar.
    const rackName = slot?.name || 'navbar';
    // In a minimized bar, the host's icon stands for the whole panel (req #3886).
    const asIcon = narrow && !!rackIcon;
    const iconAction = () => (onRackIcon ? onRackIcon() : slot?.expand?.());
    // Locked into the page's title bar (req #3857): `titlePlace` is where, or
    // null — not locked, racked, or no bar with room drawn — and it floats.
    const titleBar = useTitleBarLock({ lock: titleLock, offered: !!onTitleLockChange, racked: inRack,
        paused: !!live, boxRef, limits });
    const titlePlace = titleBar.place;
    const inTitleBar = !!titlePlace;
    useEffect(() => () => {
        const g = gestureRef.current;
        g?.unlisten?.();
        // Unmounted mid-drag: the host is told it ended, so its outline goes too.
        if (g?.tracked) onMoveTrackRef.current?.({ phase: 'cancel', rect: g.last, docking: false });
        gestureRef.current = null;
    }, []);
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
            last: null, fromRack: inRack, icon: asIcon,
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
        // A reshape gets the slop too: a double-click on a corner that drifts a
        // pixel is a fit (req #3893), not a 1 px reshape that swallows it.
        if (!g.last && Math.hypot(dx, dy) <= MOVE_SLOP) return;
        const { vw, vh } = viewport();
        g.last = g.kind === 'move'
            ? moveRect(g.r0, dx, dy, vw, vh, overhang && (boxRef.current?.getBoundingClientRect() ?? true))
            : resizeRect(g.r0, dx, dy, g.edge, vw, vh, limits.minW, limits.minH);
        // Lifted only off its own rack: a reorder inside it is drawn where it is.
        // Not dockable, it never stays in the rack it came from: lifted at once.
        setLive({ ...g.last, edge: g.edge,
            lifted: !!g.slotDoc && (!dockable || !rackApi.isOverOwn(x, y, g.fromRack, dockable)) });
        if (g.kind === 'move') {
            const overRackNow = rackApi.track(x, y, g.fromRack, colors.frame, dockable, zIndex);
            const overBarNow = dockable === true && titleBar.track(x, y, colors.frame);
            if (onMoveTrack) {
                g.tracked = true;
                aim(!!onMoveTrack({ phase: 'move', rect: drawnRect(g), docking: !!(overRackNow || overBarNow), aim }));
            }
        }
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
        // A press on the icon that never moved is its click.
        if (!g.last && g.icon && e.type === 'pointerup') { rackApi.cancel(); iconAction(); return; }
        // Only a release places it: a cancelled pointer (or capture lost
        // without one) puts the panel back where it was.
        if (!g.last || e.type !== 'pointerup') {
            if (g.kind === 'move') { rackApi.cancel(); titleBar.cancel(); endTrack(g, 'cancel'); }
            return;
        }
        lastMoveEndRef.current = Date.now();
        if (g.kind === 'move') {
            const { x, y } = at(g, e);
            const placed = rackApi.release(x, y, g.fromRack, dockable);
            // Dropped on the navbar: into the stack where the pointer is.
            // Its floating dock is kept for the day it is dragged back out.
            if (placed === 'racked') {
                titleBar.cancel();
                if (titleLock) onTitleLockChange(null);
                endTrack(g, 'drop', true);
                return;
            }
            // Dropped on the title bar: locked where it landed (req #3857).
            // Dragged off it, it floats where it was dropped, as below.
            if (onTitleLockChange) {
                const lock = dockable === true ? titleBar.release(x, y, g.last) : (titleBar.cancel(), null);
                if (lock) { onTitleLockChange(lock); endTrack(g, 'drop', true); return; }
                if (titleLock) onTitleLockChange(null);
            }
            endTrack(g, 'drop');
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
    // Locked into the title bar, the bar holds it: its rows fold below the bar.
    const toggle = () => {
        const box = boxRef.current;
        if (box && !inRack && !inTitleBar) {
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
    // A double-click on a reshape corner — the 2-D thumb — fits the panel to
    // its content (req #3893): measured in the render below, docked here.
    const onCornerDoubleClick = (e) => {
        e.stopPropagation();
        if (!open || inRack || inTitleBar) return;
        if (Date.now() - lastMoveEndRef.current < DBLCLICK_AFTER_MOVE_MS) return;
        const r = boxRef.current?.getBoundingClientRect();
        if (r) setFitFrom({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    useLayoutEffect(() => {
        const from = fitFrom;
        if (!from) return;
        setFitFrom(null);
        const box = boxRef.current;
        if (!box) return;
        const r = box.getBoundingClientRect();
        const { vw, vh } = viewport();
        // Never narrower than the host's own full layout (`fitMinW`): a fit
        // ends in the layout it was measured in.
        onDockChange(dockToFit(from, { width: r.width, height: r.height }, vw, vh, dock,
            Math.max(limits.minW, limits.fitMinW ?? 0), limits.minH));
    }, [fitFrom]);
    const onHeadDoubleClick = (e) => {
        // Racked or locked in the title bar, it has no home to go to: it is
        // dragged out instead.
        if (inRack || inTitleBar) return;
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
    // Measuring a fit: its content's own size, no cap on either axis — never
    // painted (the layout effect above re-docks it first).
    const placement = fitFrom
        ? { left: `${fitFrom.left}px`, top: `${fitFrom.top}px`, width: 'max-content', maxWidth: 'none',
            maxHeight: 'none' }
        : live
        ? { left: `${live.left - drawnOff.left}px`, top: `${live.top - drawnOff.top}px`,
            ...((reshapingH || dock.w != null || !live.edge)
                ? { width: `${live.width}px` } : { width: 'max-content', maxWidth: `${limits.autoMaxW}px` }),
            maxHeight: `calc(100% - ${live.top - drawnOff.top}px)`,
            ...((reshapingV || (open && dock.ht != null && !inRack)) ? { height: `${live.height}px` } : {}) }
        : racking ? { width: '100%' }
            : inTitleBar ? { left: `${titlePlace.left}px`, top: `${titlePlace.top}px`,
                width: `${titlePlace.width}px`,
                maxHeight: `max(${limits.headPx}px, calc(100% - ${titlePlace.top}px))` }
            : dockedStyle(dock, { open, headPx: limits.headPx, autoMaxW: limits.autoMaxW,
                minW: limits.minW });
    const shapedWidth = fitFrom ? null
        : (reshapingH ? live.width : (inRack ? slot.width : inTitleBar ? null : dock.w));
    // The icon-only navbar (`narrow`) has room for the ▾ and the host's extras alone.
    const grip = freeCorner(dock);
    const moving = live && !live.edge;
    // Dragged where a release would dock it — a rack, the title bar — it says
    // so (req #3893).
    const dockCue = moving && (overRack || titleBar.over);
    // Folded, the panel is its head row, tight: nothing to reshape. Racked,
    // the navbar sets its width and its rows its height.
    const edges = open && !inRack && !inTitleBar ? RESIZE_EDGES : [];

    const panel = !asIcon && (
        <Box ref={boxRef} data-testid={testid}
             data-dock={`${dock.h}${dock.x},${dock.v}${dock.y}`}
             data-dock-cue={dockCue ? '1' : '0'}
             {...(rackId ? { 'data-rack-id': rackId, 'data-racked': inRack ? '1' : '0',
                 'data-rack-open': inRack && open ? '1' : '0' } : {})}
             // Not while a drag draws it elsewhere: the others locked in the
             // bar would make way for it as it passes (req #3961).
             {...(onTitleLockChange ? { 'data-title-locked': inTitleBar && !live ? '1' : '0' } : {})}
             style={{ fontSize: `${fontPx}px`, ...placement }}
             sx={{ position: racking ? 'relative' : 'fixed', zIndex: racking ? PANEL_Z : zIndex,
                    minHeight: `${limits.headPx}px`,
                    display: 'flex', flexDirection: 'column',
                    background: colors.background,
                    border: `${border}px solid ${colors.frame}`,
                    color: colors.text, userSelect: 'none',
                    overflow: 'hidden', boxSizing: 'border-box', ...sx,
                    // Over the navbar, see the drop zone through it.
                    ...(overRack && { opacity: 0.75 }),
                    // Pointing at what it flies over: see that through it.
                    ...(aimed && moving && { opacity: AIMED_OPACITY }),
                    ...(dockCue && actionPopupDockCue(colors.frame)),
                    // In the stack: square, flat. The rack's row sizes it: open,
                    // the height its rows need and no more (req #3747), giving
                    // way fairly when the rack is short — its body scrolls.
                    // Folded, it is its head.
                    ...(racking && { order: rackOrder(rackPos),
                        borderRadius: 0, boxShadow: 'none' }) }}>
            <ActionPopupHead open={open} onToggle={toggle} name={name} testid={testid}
                             badge={extras} badgeSlot={badgeSlot} actions={actions} narrow={narrow} colors={colors}
                             title={inRack ? `Drag to reorder · drag off the ${rackName} to float it`
                                 : inTitleBar ? 'Drag along the title bar to move it · drag off it to float it'
                                     : `Drag to move · double-click to put back${rackId ? ` · drop on the ${rackName} to rack it` : ''}${
                                         onTitleLockChange ? ' · drop on the title bar to lock it there' : ''}`}
                             {...gesture('move')}
                             onDoubleClick={onHeadDoubleClick}
                             sx={{ cursor: moving ? 'grabbing' : 'move' }} />

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
                        ...(!inRack && !inTitleBar && { mr: `${EDGE_PX}px` }),
                        ...(!open && { display: 'none' }) }}>
                {children({ shapedWidth })}
            </Box>

            {open && !inRack && !inTitleBar && (
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
                     title={e.h && e.v ? 'Drag to reshape · double-click to fit its content' : 'Drag to reshape'}
                     {...gesture('resize', { h: e.h, v: e.v })}
                     {...(e.h && e.v && { onDoubleClick: onCornerDoubleClick })}
                     sx={actionPopupReshapeZone(e, limits.headPx, colors.frame)} />
            ))}
        </Box>
    );
    // Its icon in a minimized bar (req #3886): the panel's frame and place in
    // the stack, holding one icon in a box of its frame colour.
    const label = rackIconLabel || name;
    const iconPanel = asIcon && (
        <Box ref={boxRef} data-testid={testid} data-dock={`${dock.h}${dock.x},${dock.v}${dock.y}`}
             data-rack-id={rackId} data-racked="1" data-rack-open="0" data-rack-icon="1"
             data-dock-cue={dockCue ? '1' : '0'}
             {...(onTitleLockChange ? { 'data-title-locked': '0' } : {})}
             style={{ fontSize: `${fontPx}px`, ...placement }}
             sx={{ position: racking ? 'relative' : 'fixed', zIndex: racking ? PANEL_Z : zIndex, display: 'flex', justifyContent: 'center',
                    py: '2px', boxSizing: 'border-box', userSelect: 'none',
                    ...(overRack && { opacity: 0.75 }),
                    ...(dockCue && { borderRadius: '4px', ...actionPopupDockCue(colors.frame) }),
                    ...(racking && { order: rackOrder(rackPos) }) }}>
            <Box role="button" tabIndex={0} aria-label={label} title={label}
                 data-testid={`${testid}-rack-icon`}
                 onPointerDownCapture={onRackIconPress}
                 // The box in the panel's own frame colour.
                 style={{ border: `${border}px solid ${colors.frame}` }}
                 {...gesture('move')}
                 onKeyDown={(e) => {
                     if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); iconAction(); }
                 }}
                 sx={{ width: 'min(30px, 100%)', aspectRatio: '1', flex: '0 0 auto',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxSizing: 'border-box', borderRadius: '4px',
                        background: colors.background, color: colors.frame, outline: 'none',
                        cursor: moving ? 'grabbing' : 'pointer',
                        '&:hover, &:focus-visible': { boxShadow: 'inset 0 0 0 99px rgba(255, 255, 255, 0.1)' } }}>
                {createElement(rackIcon, { sx: { fontSize: 18 } })}
            </Box>
        </Box>
    );
    const drawnPanel = iconPanel || panel;
    // Lifted out of a rack in another document, it is drawn in Darwin's page.
    return inRack && !lifted ? rackPortal(drawnPanel, slot) : drawnPanel;
}
