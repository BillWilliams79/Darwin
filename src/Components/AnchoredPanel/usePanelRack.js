// usePanelRack.js — the DOM half of the panel RACK (req #3720): what makes an
// Action Popup dockable onto the Darwin navbar. Pattern doc:
// memory/anchored-collapse-pattern.md § The rack; pure half in panelRack.js,
// shared state in usePanelRackStore.
//
// ONE mechanism for every Action Popup (req #3735). AnchoredPanel uses it for
// its hosts (the Dev Servers dashboard, the Dev Server panel, the Active box),
// and a window that draws its own frame — the Plan visualizer's Orchestrables
// box — uses it directly, so all of them hit-test the same drop zone, glow the
// navbar the same way, land in the same stack and reorder by the same rule.
//
// A host owns its own move gesture and calls three things from it:
//   • `track(x, y, fromRack, color)` on every move frame — publishes the drag,
//     so the navbar glows in `color` (the window's frame) while it is over;
//   • `release(x, y, fromRack)` on a real release — racks it when dropped on the
//     navbar ('racked'), unracks it when a racked one is dropped off it
//     ('unracked'), else null: the host places it as it always would;
//   • `cancel()` on a cancelled pointer — ends the drag, changes nothing.
// `isOver(x, y, fromRack)` asks, without acting, whether a release there would
// rack it — for a host whose release can mean something else first (the
// Orchestrables box's carry-to-seat).
// While `inRack`, the host portals its window into `slot.node` (the navbar's
// rack slot) at the navbar's width, ordered by `rackOrder(rackPos)`.
//
// SUSPENDED (req #3735): while a page is drawn over the navbar — the Plan page
// maximized — that page publishes `covered` (usePanelRackStore.setCovered). The
// navbar is still mounted underneath, so without it a racked window would be
// drawn hidden under the page and a drop at the window's left edge would land
// in a rack nobody can see. ONE fact suspends EVERY rackable window, whatever
// page it belongs to (the app-wide Dev Servers dashboard included): no drop
// zone, and a racked window floats at its own spot; where it sits in the rack
// order is kept for when the page is restored.
//
// A PAGE'S OWN TOOLBAR (req #3792): a page that shows its own toolbar (AI
// Architecture's topology navbar, in a same-origin iframe) publishes it as the
// rack while it is drawn (usePanelRackStore `pageSlot`, Systems/ToolbarRack.jsx).
// Nothing here changes for it but WHERE: the slot names its own drop `zone`, its
// document's `offset()` in Darwin's viewport (every rect below is translated by
// it, so hit tests and gestures stay in Darwin's viewport px), and the emotion
// `cache` that styles a window portalled into its shadow root (`rackPortal`).

import { createElement, useEffect } from 'react';
import { createPortal } from 'react-dom';

import { CacheProvider } from '@emotion/react';

import { usePanelRackStore } from '../../stores/usePanelRackStore';
import { RACK_NARROW_PX, pointInRect, rackDropIndex } from './panelRack';

const NO_OFFSET = { left: 0, top: 0 };

/** The slot's document origin in Darwin's viewport, px — {0, 0} for the navbar. */
export function slotOffset(slot) {
    return slot?.offset?.() || NO_OFFSET;
}

/** An element's rect in Darwin's viewport px (`off` = its document's origin). */
function rectIn(el, off) {
    const r = el.getBoundingClientRect();
    return { left: r.left + off.left, right: r.right + off.left,
        top: r.top + off.top, bottom: r.bottom + off.top, height: r.height, width: r.width };
}

/** Portal a racked window into the slot — through the slot's emotion cache when
 *  the slot is a shadow root's (a page toolbar), so its styles land there. */
export function rackPortal(panel, slot) {
    return createPortal(slot.cache
        ? createElement(CacheProvider, { value: slot.cache }, panel) : panel, slot.node);
}

/** Where the rack would put a window released at (x, y): `over` the navbar's
 *  drop zone, and at which `index` of the other racked windows — the
 *  bottom, unless pointed into the stack (req #3744, `rackDropIndex`). */
export function rackTarget(rackId, x, y, fromRack) {
    const { slot, racked } = usePanelRackStore.getState();
    const zone = slot?.zone || document.querySelector('[data-panel-rack-zone]');
    const off = slotOffset(slot);
    if (!zone || !slot?.node || !pointInRect(x, y, rectIn(zone, off))) {
        return { over: false, index: null };
    }
    const mids = new Map();
    let bottom = -Infinity;
    let top = Infinity;
    slot.node.querySelectorAll('[data-rack-id]').forEach((el) => {
        const id = el.getAttribute('data-rack-id');
        if (id === rackId) return;
        const r = rectIn(el, off);
        mids.set(id, r.top + r.height / 2);
        bottom = Math.max(bottom, r.bottom);
        top = Math.min(top, r.top);
    });
    // A stack taller than the rack scrolls: below the rack's visible edge is
    // below the stack, whatever is scrolled out of sight there. So does the
    // column holding the nav list and the rack (`data-rack-clip`), when the
    // nav list alone outgrows the navbar (req #3751): its edges clip the rack's.
    const rack = slot.node.parentElement;
    [rack, rack?.parentElement?.closest('[data-rack-clip]')].forEach((clip) => {
        if (!clip) return;
        const cr = rectIn(clip, off);
        bottom = Math.min(bottom, cr.bottom);
        top = Math.max(top, cr.top);
    });
    // Above the stack (the nav buttons) is not "in the list" either (req #3744).
    return { over: true, index: rackDropIndex(racked.filter(id => id !== rackId), mids, y, bottom, fromRack, top === Infinity ? -Infinity : top) };
}

/** Publish a rack drag, writing only when it changed (a move fires per pixel). */
export function publishRackDrag(next) {
    const { drag, setDrag } = usePanelRackStore.getState();
    if (drag === next) return;
    if (drag && next && ['id', 'over', 'index', 'fromRack', 'color'].every(k => drag[k] === next[k])) return;
    setDrag(next);
}

const NOWHERE = { over: false, index: null };

/**
 * @param {?string} rackId   the window's id in the rack; null/absent = it
 *   never racks, and every call below is a no-op.
 * @returns {{rackPos: number, racked: boolean, inRack: boolean, slot: ?Object,
 *   suspended: boolean, overRack: boolean, narrow: boolean, track: function,
 *   isOver: function, release: function, cancel: function}}
 *   `rackPos` — its place in the stack, -1 = not racked; `inRack` — racked AND
 *   drawn there (a slot exists and the rack is not suspended); `suspended` — a
 *   page covers the navbar; `narrow` — in the icon-only navbar (< RACK_NARROW_PX).
 */
export function usePanelRack(rackId) {
    const rackPos = usePanelRackStore(s => (rackId ? s.racked.indexOf(rackId) : -1));
    const racked = rackPos !== -1;
    const slot = usePanelRackStore(s => s.slot);
    const overRack = usePanelRackStore(s => !!rackId && s.drag?.id === rackId && s.drag.over);
    const suspended = usePanelRackStore(s => s.covered);
    // Racked AND the navbar is drawn to hold it; with no rack (mobile), or the
    // navbar covered (suspended), it floats.
    const inRack = racked && !!slot?.node && !suspended;
    const narrow = inRack && slot.width < RACK_NARROW_PX;

    // Unmounted mid-drag, the release never comes — nor the drag's end.
    useEffect(() => () => {
        if (rackId && usePanelRackStore.getState().drag?.id === rackId) {
            usePanelRackStore.getState().setDrag(null);
        }
    }, [rackId]);

    // Read live: a gesture's release must see the page as it is now.
    const target = (x, y, fromRack) => (rackId && !usePanelRackStore.getState().covered
        ? rackTarget(rackId, x, y, fromRack) : NOWHERE);
    const track = (x, y, fromRack, color) => {
        if (!rackId) return;
        // `color` — its frame: the navbar glows in it while it is over (req #3728).
        publishRackDrag({ id: rackId, fromRack, color, ...target(x, y, fromRack) });
    };
    const isOver = (x, y, fromRack) => target(x, y, fromRack).over;
    const cancel = () => { if (rackId) publishRackDrag(null); };
    const release = (x, y, fromRack) => {
        if (!rackId) return null;
        const t = target(x, y, fromRack);
        publishRackDrag(null);
        const { rack, unrack } = usePanelRackStore.getState();
        // Dropped on the navbar: into the stack where the pointer is.
        if (t.over) { rack(rackId, t.index); return 'racked'; }
        // Dragged off the navbar: it floats again.
        if (fromRack) { unrack(rackId); return 'unracked'; }
        return null;
    };

    return { rackPos, racked, inRack, slot, suspended, overRack, narrow, track, isOver, release, cancel };
}
