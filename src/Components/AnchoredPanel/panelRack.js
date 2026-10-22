// panelRack.js — the pure half of the panel RACK (req #3720): the Darwin navbar
// as a drop zone for AnchoredPanel pop-up information windows (the Dev Servers
// dashboard first). Pattern doc: memory/anchored-collapse-pattern.md § The rack.
//
// A racked panel leaves the viewport and locks into the navbar, directly below
// its nav buttons, at the navbar's own width; more than one stack top to bottom
// in the RACK ORDER — a list of panel ids, persisted per browser
// (usePanelRackStore). A panel dropped on the navbar lands at the BOTTOM unless
// it is pointed into the stack, where the pointer against the stacked panels'
// midpoints decides (req #3744, reversing #3729's top); a racked panel is
// reordered the same way. Each racked panel takes only the height its content
// needs, never more (req #3747, reversing #3744's fill). The nav buttons come
// first: the rack has only the height they leave (req #3751), and when that is
// too short for all of them, small panels keep their content and the big ones
// split the rest evenly (the rack's grid rows, NavBarSidebar).
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

/** The frame purple of the info windows, for a drag that names no colour. */
const RACK_GLOW_DEFAULT = '#a64dff';

/** The drop glow (req #3728): a rack's edges glow in the dragged window's own
 *  frame colour while the pointer is over it. ONE look for every rack — the
 *  Darwin navbar and a page's own toolbar (req #3792). */
export function rackGlow(color) {
    return `inset 0 0 16px 2px color-mix(in srgb, ${color || RACK_GLOW_DEFAULT} 75%, transparent)`;
}

/** The rack's own box, for every rack (req #3792 — the navbar's and a page
 *  toolbar's are one CSS): racked windows portal into a `display: contents`
 *  slot inside it, so they are its grid items and CSS `order` stacks them in
 *  rack order. Each takes only the height its content needs, never more (req
 *  #3747): a row is `minmax(auto, max-content)`, so a short rack gives every
 *  window its content while it fits and, when it does not, small windows keep
 *  theirs and the big ones split the rest evenly, scrolling inside. The rack is
 *  content-sized and shrinks — it alone — to the height the nav buttons leave
 *  (req #3751). Spaced off the buttons only while it holds something drawn. */
export const RACK_SX = {
    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)',
    gridAutoRows: 'minmax(auto, max-content)', alignContent: 'start',
    rowGap: '4px',
    flex: '0 1 auto', minHeight: 0,
    overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'thin',
    '&:has([data-rack-id])': { pt: '6px' },
};

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
 * (`others`, in rack order) — req #3744: "first in, at the bottom", then
 * dragged into position.
 *
 * Pointed INTO the stack (between `stackTop` and `stackBottom`, the highest and
 * lowest drawn edges of the other panels), it lands above the first DRAWN panel
 * whose midpoint lies below the pointer — so the upper half of a panel puts it
 * above, the lower half of the last panel the bottom. Anywhere else on the
 * navbar (the nav buttons above the stack, or below it), a panel arriving from
 * off the navbar lands LAST, at the bottom. A racked panel being reordered
 * (`fromRack`) goes where the pointer is dragged toward: the nav buttons mean the
 * top, below the stack the bottom. A racked panel its host is not drawing
 * (hidden) has no midpoint and never decides the slot — with none of the others
 * drawn, an arrival lands last.
 *
 * @param {string[]} others
 * @param {Map<string, number>} midById  each drawn panel's vertical midpoint.
 * @param {number} y
 * @param {number} [stackBottom]  the stack's lowest drawn edge; callers pass
 *   -Infinity when nothing is drawn. Omitted (Infinity), only the midpoints
 *   decide.
 * @param {boolean} [fromRack]    the dragged panel is racked: a reorder.
 * @param {number} [stackTop]     the stack's highest drawn edge; omitted
 *   (-Infinity), nothing is "above" the stack.
 */
export function rackDropIndex(others, midById, y, stackBottom = Infinity, fromRack = false, stackTop = -Infinity) {
    if (!fromRack && (y > stackBottom || y < stackTop || midById.size === 0)) return others.length;
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
