// panelRack.js — the pure half of the panel RACK (req #3720): the Darwin navbar
// as a drop zone for AnchoredPanel pop-up information windows (the Dev Servers
// dashboard first). Pattern doc: memory/anchored-collapse-pattern.md § The rack.
//
// A racked panel leaves the viewport and locks into the navbar, directly below
// its nav buttons, at the navbar's own width; more than one stack top to bottom
// in the RACK ORDER — a list of panel ids, persisted per browser
// (usePanelRackStore). Where in the stack a dropped panel lands is decided by
// the pointer against the stacked panels' midpoints.
//
// The stack is drawn by CSS `order` so a panel's DOM position (wherever its
// host mounts it) never matters: a racked panel is order 2·i, and the drop
// placeholder the odd slot just before the panel it would land above.

/** A rack slot narrower than this, px (the icon-only sidebar), keeps only the
 *  ▾ and the host's extras in a racked panel's head. */
export const RACK_NARROW_PX = 120;

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
 * (`others`, in rack order): above the first DRAWN one whose midpoint lies
 * below the pointer. A racked panel its host is not drawing (hidden) has no
 * midpoint and never decides the slot.
 *
 * @param {string[]} others
 * @param {Map<string, number>} midById  each drawn panel's vertical midpoint.
 */
export function rackDropIndex(others, midById, y) {
    const i = others.findIndex(id => midById.has(id) && y < midById.get(id));
    return i === -1 ? others.length : i;
}

/** The CSS `order` of the panel at `index` of the rack order. */
export function rackOrder(index) {
    return 2 * index;
}

/** The drop placeholder's CSS `order`: just before the panel at `index` of the
 *  others (`id` excluded), or after every panel. */
export function placeholderOrder(racked, id, index) {
    const without = racked.filter(x => x !== id);
    return index < without.length ? rackOrder(racked.indexOf(without[index])) - 1
        : rackOrder(racked.length) + 1;
}

/** The point lies inside the rect (edges included). */
export function pointInRect(x, y, r) {
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
