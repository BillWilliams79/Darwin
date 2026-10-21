// panelRack.js — the pure half of the panel RACK (req #3720): the Darwin navbar
// as a drop zone for AnchoredPanel pop-up information windows (the Dev Servers
// dashboard first). Pattern doc: memory/anchored-collapse-pattern.md § The rack.
//
// A racked panel leaves the viewport and locks into the navbar, directly below
// its nav buttons, at the navbar's own width; more than one stack top to bottom
// in the RACK ORDER — a list of panel ids, persisted per browser
// (usePanelRackStore). A panel dropped on the navbar lands at the top unless it
// is pointed into the stack, where the pointer against the stacked panels'
// midpoints decides; a racked panel is reordered the same way (req #3729).
//
// The stack is drawn by CSS `order` so a panel's DOM position (wherever its
// host mounts it) never matters: a racked panel is order 2·i.

/** A rack slot narrower than this, px (the icon-only sidebar), keeps only the
 *  ▾ and the host's extras in a racked panel's head. */
export const RACK_NARROW_PX = 120;

/** The navbar's z-index while a RACKED window is dragged out of it: the window
 *  is drawn `position: fixed` from inside the navbar's stacking context, so the
 *  navbar lifts itself above the page (and anything a page draws over the
 *  dragged window — the plan's seat-target outline — must clear this). */
export const RACK_DRAG_Z = 1250;

/** The rack order with `id` placed at `index` of the OTHER panels (clamped). */
export function rackInsert(racked, id, index) {
    const without = racked.filter(x => x !== id);
    const at = Math.max(0, Math.min(Number.isFinite(index) ? index : without.length, without.length));
    return [...without.slice(0, at), id, ...without.slice(at)];
}

/** The rack order without `id`. */
export function rackRemove(racked, id) {
    return racked.filter(x => x !== id);
}

/**
 * Where a panel dropped at pointer `y` lands among the OTHER racked panels
 * (`others`, in rack order) — req #3729: "first in, at the top", then dragged
 * into position.
 *
 * Pointed INTO the stack (above `stackBottom`, the lowest drawn edge of the
 * other panels), it lands above the first DRAWN panel
 * whose midpoint lies below the pointer — so the nav buttons above the stack
 * mean the top, and the lower half of the last panel the bottom. Anywhere on
 * the navbar BELOW the stack, a panel arriving from off the navbar lands
 * first, at the top; a racked panel being reordered (`fromRack`) goes to the
 * bottom, the end it was dragged toward. A racked panel its host is not
 * drawing (hidden) has no midpoint and never decides the slot — with none of
 * the others drawn, an arrival lands first.
 *
 * @param {string[]} others
 * @param {Map<string, number>} midById  each drawn panel's vertical midpoint.
 * @param {number} y
 * @param {number} [stackBottom]  the stack's lowest drawn edge; callers pass
 *   -Infinity when nothing is drawn. Omitted (Infinity), only the midpoints
 *   decide.
 * @param {boolean} [fromRack]    the dragged panel is racked: a reorder.
 */
export function rackDropIndex(others, midById, y, stackBottom = Infinity, fromRack = false) {
    if (!fromRack && (y > stackBottom || midById.size === 0)) return 0;
    const i = others.findIndex(id => midById.has(id) && y < midById.get(id));
    return i === -1 ? others.length : i;
}

/** The CSS `order` of the panel at `index` of the rack order. */
export function rackOrder(index) {
    return 2 * index;
}

/** The point lies inside the rect (edges included). */
export function pointInRect(x, y, r) {
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
