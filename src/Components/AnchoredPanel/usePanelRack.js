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
//   • `track(x, y, fromRack, color, canRack, z)` on every move frame — publishes the drag,
//     so the rack under it glows in `color` (the window's frame), and answers
//     whether a release there would rack it — `canRack` false (a host's picker
//     mode, req #3958) publishes the carry but never over a rack;
//   • `release(x, y, fromRack)` on a real release — racks it when dropped on a
//     rack ('racked' — into THAT rack, out of any other), unracks it when a
//     racked one is dropped off every rack ('unracked'), else null: the host
//     places it as it always would;
//   • `cancel()` on a cancelled pointer — ends the drag, changes nothing.
// `isOver(x, y, fromRack)` asks, without acting, whether a release there would
// rack it — for a host whose release can mean something else first (the
// Orchestrables box's carry-to-seat); `isOverOwn` whether it is over the rack it
// is drawn in now (a reorder, not a move to the other rack).
// While `inRack`, the host portals its window into `slot.node` (the slot of the
// rack it is drawn in) at that rack's width, ordered by `rackOrder(rackPos)`.
//
// SUSPENDED (req #3735): while a page is drawn over the navbar — the Plan page
// maximized, any full screen mode (req #4053) — it publishes `covered`
// (Components/fullScreenLayer.js useCoverNavbar). The
// navbar is still mounted underneath, so without it a racked window would be
// drawn hidden under the page and a drop at the window's left edge would land
// in a rack nobody can see. ONE fact suspends EVERY rackable window, whatever
// page it belongs to (the app-wide Dev Servers dashboard included): no drop
// zone, and a racked window floats at its own spot; where it sits in the rack
// order is kept for when the page is restored.
//
// A PAGE'S OWN TOOLBAR (req #3792): a page that shows its own toolbar (AI
// Architecture's topology navbar, in a same-origin iframe) publishes it as a
// SECOND rack while it is on the page (usePanelRackStore `pageSlot`,
// Systems/ToolbarRack.jsx). Both are drop zones at once, and each keeps the
// popups dropped on it (req #3886): a popup is drawn in the rack it was racked
// in (`rackPlacement`). The toolbar's slot names its own drop `zone`, its
// document's `offset()` in Darwin's viewport (every rect below is translated by
// it, so hit tests and gestures stay in Darwin's viewport px), and the emotion
// `cache` that styles a window portalled into its shadow root (`rackPortal`).

import { createElement, useEffect } from 'react';
import { createPortal } from 'react-dom';

import { CacheProvider } from '@emotion/react';

import { rackPlacement, usePanelRackStore } from '../../stores/usePanelRackStore';
import { RACK_NARROW_PX, pointInRect, rackDropIndex } from './panelRack';

const NO_OFFSET = { left: 0, top: 0 };
const NOWHERE = { over: false, rack: null, own: false, index: null };

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

/** The racks, the page toolbar's first: `[where, slot, its stack, its zone]`. */
function racks(s) {
    return [
        ['page', s.pageSlot, s.pageRacked, s.pageSlot?.zone],
        ['nav', s.slot, s.racked, s.slot?.zone || document.querySelector('[data-panel-rack-zone]')],
    ];
}

/** Where a window released at (x, y) would be racked: `over` a rack's drop
 *  zone, which (`rack`: 'nav' | 'page'), at which `index` of the other windows
 *  in that rack — the bottom, unless pointed into the stack (req #3744,
 *  `rackDropIndex`) — and whether that is the rack it is drawn in now (`own`).
 *  A window from the OTHER rack arrives there; only its own rack reorders it. */
export function rackTarget(rackId, x, y, fromRack, navOnly = false) {
    const s = usePanelRackStore.getState();
    const from = fromRack ? rackPlacement(s, rackId)?.where ?? null : null;
    for (const [where, slot, stack, zone] of racks(s)) {
        const off = slotOffset(slot);
        if (navOnly && where !== 'nav') continue;
        if (!zone || !slot?.node || !pointInRect(x, y, rectIn(zone, off))) continue;
        const own = from === where;
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
        return { over: true, rack: where, own, index: rackDropIndex(stack.filter(id => id !== rackId), mids, y,
            bottom, own, top === Infinity ? -Infinity : top) };
    }
    return NOWHERE;
}

/** Publish a rack drag, writing only when it changed (a move fires per pixel). */
export function publishRackDrag(next) {
    const { drag, setDrag } = usePanelRackStore.getState();
    if (drag === next) return;
    if (drag && next && ['id', 'over', 'rack', 'index', 'fromRack', 'from', 'color', 'z'].every(k => drag[k] === next[k])) return;
    setDrag(next);
}

/**
 * @param {?string} rackId   the window's id in the rack; null/absent = it
 *   never racks, and every call below is a no-op.
 * @returns {{rackPos: number, racked: boolean, inRack: boolean, slot: ?Object,
 *   suspended: boolean, overRack: boolean, narrow: boolean, track: function,
 *   isOver: function, isOverOwn: function, release: function, cancel: function}}
 *   `rackPos` — its place in its rack's stack, -1 = not racked; `inRack` —
 *   racked AND drawn there (a slot exists and the racks are not suspended);
 *   `slot` — the slot of the rack it is drawn in; `suspended` — a page covers
 *   the navbar; `narrow` — in a minimized bar (< RACK_NARROW_PX: the icon-only
 *   navbar, the folded toolbar).
 */
export function usePanelRack(rackId) {
    const rackPos = usePanelRackStore(s => rackPlacement(s, rackId)?.pos ?? -1);
    const racked = rackPos !== -1;
    const slot = usePanelRackStore(s => rackPlacement(s, rackId)?.slot ?? null);
    const overRack = usePanelRackStore(s => !!rackId && s.drag?.id === rackId && s.drag.over);
    const suspended = usePanelRackStore(s => s.covered);
    // Racked AND a rack is drawn to hold it; with none (mobile), or the
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
    // `canRack` 'navbar' (req #4172): the navbar's rack takes it, a page toolbar's does not.
    const target = (x, y, fromRack, canRack = true) => (rackId && canRack && !usePanelRackStore.getState().covered
        ? rackTarget(rackId, x, y, fromRack, canRack === 'navbar') : NOWHERE);
    const track = (x, y, fromRack, color, canRack = true, z = null) => {
        if (!rackId) return false;
        const from = fromRack ? rackPlacement(usePanelRackStore.getState(), rackId)?.where ?? null : null;
        // Still published when it cannot rack: a page toolbar's frame gives up
        // the pointer to a carried window (Systems/ToolbarRack.jsx).
        const { over, rack, index } = target(x, y, fromRack, canRack);
        // `color` — its frame: the rack under it glows in it (req #3728). `z` —
        // its own stacking, which the navbar lifts to while carrying it (req #4044).
        publishRackDrag({ id: rackId, fromRack, from, color, over, rack, index, z });
        // Whether a release here would rack it (req #3958: the host aims at nothing then).
        return over;
    };
    const isOver = (x, y, fromRack) => target(x, y, fromRack).over;
    const isOverOwn = (x, y, fromRack, canRack = true) => target(x, y, fromRack, canRack).own;
    const cancel = () => { if (rackId) publishRackDrag(null); };
    const release = (x, y, fromRack, canRack = true) => {
        if (!rackId) return null;
        const t = target(x, y, fromRack, canRack);
        publishRackDrag(null);
        const { rack, unrack } = usePanelRackStore.getState();
        // Dropped on a rack: into its stack where the pointer is, out of the other.
        if (t.over) { rack(rackId, t.index, t.rack); return 'racked'; }
        // Dragged off the racks: it floats again.
        if (fromRack) { unrack(rackId); return 'unracked'; }
        return null;
    };

    return { rackPos, racked, inRack, slot, suspended, overRack, narrow, track, isOver, isOverOwn, release, cancel };
}
