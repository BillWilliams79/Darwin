// anchoredPanelGeometry.js — the pure geometry of a viewport-docked, collapsible panel
// (req #3643). Pattern doc: memory/anchored-collapse-pattern.md.
//
// A DOCK is where a `position: fixed` panel sits and how big it is:
//   { h: 'l'|'r', x, v: 't'|'b', y, w: ?px, ht: ?px }
// — its offset from the nearer horizontal edge and the nearer vertical edge,
// so it stays in its corner as the window resizes. `w`/`ht` null = content
// size on that axis (the default: minimal, not a guessed number).
//
// ── THE HEAD IS THE ANCHOR ─────────────────────────────────────────────────
// The head is ALWAYS the panel's top row (user ruling: the title belongs on
// top), and its ▾ is at the row's LEFT. Folding makes the panel tight — just
// its head row, its right edge pulled in (user directive) — so on a click the
// panel is first PINNED at its current left and top (`dockForToggle`): the ▾
// holds while the bottom edge folds up and the right edge pulls in, or both
// push back out on unfold. Once drawn, it re-docks to its nearest sides where
// it now IS (`dockAfterToggle`) — nothing moves, and a lower-right panel is
// bottom/right-anchored again, so it keeps its corner as the window resizes.
// The one exception: unfolding with too little room to the right of or below
// the ▾ for the rows, the panel moves left/up just far enough to show them —
// the only time the ▾ moves on a click, because the rows cannot fit.

/** Within this many px of a viewport edge, a dropped panel goes flush to it. */
export const DOCK_SNAP = 12;

const clampTo = (v, lo, hi) => Math.min(Math.max(lo, v), Math.max(lo, hi));
const snap = (d) => Math.round(d <= DOCK_SNAP ? 0 : d);

/**
 * Where a MOVED panel docks: the nearer horizontal and the nearer vertical
 * side of the box, at the size it had — a move never reshapes. The box is
 * drawn exactly where it was dropped either way.
 *
 * @param {{left, top, width, height}} box   the panel's rect at release.
 * @param {{w, ht}} size
 */
export function dockFromMove(box, vw, vh, size, { snapToEdges = true } = {}) {
    const left = clampTo(box.left, 0, vw - box.width);
    const top = clampTo(box.top, 0, vh - box.height);
    const right = Math.max(0, vw - left - box.width);
    const bottom = Math.max(0, vh - top - box.height);
    const h = left + box.width / 2 > vw / 2 ? 'r' : 'l';
    const v = top + box.height / 2 > vh / 2 ? 'b' : 't';
    const fix = snapToEdges ? snap : Math.round;
    return {
        h, x: fix(h === 'r' ? right : left),
        v, y: fix(v === 'b' ? bottom : top),
        w: size.w ?? null, ht: size.ht ?? null,
    };
}

/**
 * Where a panel docks once a toggle has drawn: at the pin (its ▾ where it
 * was clicked), docked to the nearer sides, unsnapped — nothing moves —
 * unless its content needs more room than lies right of / below the pin,
 * when it moves left / up just enough to fit (never off the viewport).
 *
 * @param {{left, top}} pin       where the panel was pinned for the toggle.
 * @param {{width, height}} size  the size its content now wants.
 * @param {Object} dock           the dock it was drawn from (its size is kept).
 */
export function dockAfterToggle(pin, size, vw, vh, dock) {
    const left = Math.max(0, Math.min(pin.left, vw - size.width));
    const top = Math.max(0, Math.min(pin.top, vh - size.height));
    return dockFromMove({ left, top, width: size.width, height: size.height }, vw, vh, dock,
        { snapToEdges: false });
}

/**
 * The dock to toggle from: the panel pinned at its current LEFT and TOP, so
 * folding pulls its right and bottom edges in to the head row (and unfolding
 * pushes them back out) while the ▾ — at the head row's left — stays put.
 *
 * @param {Object} dock
 * @param {{left, top}} rect   the panel's current position, viewport px.
 */
export function dockForToggle(dock, rect) {
    return { ...dock, h: 'l', x: Math.max(0, Math.round(rect.left)),
        v: 't', y: Math.max(0, Math.round(rect.top)) };
}

/**
 * Where a RESHAPED panel docks: on the sides it already had (reshaping never
 * pulls it off its edges), with a size only on the axes the drag touched —
 * an untouched axis stays content-sized.
 *
 * @param {{left, top, width, height}} rect  the panel's rect at release.
 * @param {Object} dock   the dock before the drag.
 * @param {{h: ?string, v: ?string}} edge     which edges were dragged.
 */
export function dockFromResize(rect, vw, vh, dock, edge) {
    const right = Math.max(0, vw - rect.left - rect.width);
    const bottom = Math.max(0, vh - rect.top - rect.height);
    const xRaw = dock.h === 'r' ? right : rect.left;
    const yRaw = dock.v === 'b' ? bottom : rect.top;
    const x = snap(xRaw);
    const y = snap(yRaw);
    // A dragged edge that snapped flush to the viewport carries the snap in the
    // SIZE, so the edge the reader did not drag stays where it was.
    const grewW = edge.h === dock.h ? xRaw - x : 0;
    const grewH = edge.v === dock.v ? yRaw - y : 0;
    return {
        h: dock.h, x,
        v: dock.v, y,
        w: edge.h ? Math.round(rect.width + grewW) : dock.w,
        ht: edge.v ? Math.round(rect.height + grewH) : dock.ht,
    };
}

/**
 * Where a panel FITTED TO ITS CONTENT docks (req #3893 — a double-click on a
 * reshape corner): its natural size, capped at the viewport and never under
 * the minimum, on the sides it already had — its docked corner held, so it
 * grows away from it — and moved only as far as it must to stay on screen.
 * Both axes are shaped, so the size is kept until the reader reshapes it.
 *
 * @param {{left, top, width, height}} r0  the panel's rect before the fit.
 * @param {{width, height}} natural  its content's size, uncapped.
 * @param {Object} dock   the dock it was drawn from.
 */
export function dockToFit(r0, natural, vw, vh, dock, minW, minH) {
    const width = Math.min(Math.max(Math.ceil(natural.width), minW), vw);
    const height = Math.min(Math.max(Math.ceil(natural.height), minH), vh);
    const left = clampTo(dock.h === 'r' ? r0.left + r0.width - width : r0.left, 0, vw - width);
    const top = clampTo(dock.v === 'b' ? r0.top + r0.height - height : r0.top, 0, vh - height);
    const right = Math.max(0, vw - left - width);
    const bottom = Math.max(0, vh - top - height);
    return {
        h: dock.h, x: Math.round(dock.h === 'r' ? right : left),
        v: dock.v, y: Math.round(dock.v === 'b' ? bottom : top),
        w: width, ht: height,
    };
}

/** The rect a head drag moves to, kept whole inside the viewport — or, with
 *  `overhang` (the Requirement Filer's pushpin mode, req #4046), only its
 *  CENTRE kept inside, so the point it aims from reaches every pixel.
 *  `overhang` may be the {width, height} it is DRAWN at, when that is not
 *  `r0`'s (dragged out of a rack, `r0` is only its head). */
export function moveRect(r0, dx, dy, vw, vh, overhang = false) {
    const ox = overhang ? (overhang.width ?? r0.width) / 2 : 0;
    const oy = overhang ? (overhang.height ?? r0.height) / 2 : 0;
    return {
        left: overhang ? clampTo(r0.left + dx, -ox, vw - 1 - ox) : clampTo(r0.left + dx, 0, vw - r0.width),
        top: overhang ? clampTo(r0.top + dy, -oy, vh - 1 - oy) : clampTo(r0.top + dy, 0, vh - r0.height),
        width: r0.width,
        height: r0.height,
    };
}

/**
 * The rect an edge or corner drag shapes: the dragged edges follow the
 * pointer, the opposite ones stay put, within the minimum and the viewport.
 *
 * @param {{h: 'l'|'r'|null, v: 't'|'b'|null}} edge  null = that axis untouched.
 */
export function resizeRect(r0, dx, dy, edge, vw, vh, minW, minH) {
    // A panel already smaller than the minimum (short content) is not snapped
    // up to it on the first pixel of a drag.
    minW = Math.min(minW, r0.width);
    minH = Math.min(minH, r0.height);
    const right0 = r0.left + r0.width;
    const bottom0 = r0.top + r0.height;
    let { left, top, width, height } = r0;
    if (edge.h === 'r') {
        width = clampTo(r0.width + dx, minW, vw - r0.left);
    } else if (edge.h === 'l') {
        width = clampTo(r0.width - dx, minW, right0);
        left = right0 - width;
    }
    if (edge.v === 'b') {
        height = clampTo(r0.height + dy, minH, vh - r0.top);
    } else if (edge.v === 't') {
        height = clampTo(r0.height - dy, minH, bottom0);
        top = bottom0 - height;
    }
    return { left, top, width, height };
}

/** Every edge and corner a panel can be reshaped from. */
export const RESIZE_EDGES = [
    { id: 'n', v: 't', h: null }, { id: 's', v: 'b', h: null },
    { id: 'w', v: null, h: 'l' }, { id: 'e', v: null, h: 'r' },
    { id: 'nw', v: 't', h: 'l' }, { id: 'ne', v: 't', h: 'r' },
    { id: 'sw', v: 'b', h: 'l' }, { id: 'se', v: 'b', h: 'r' },
];

/** Where the visible grip sits: the BOTTOM corner away from the docked side —
 *  never a top corner, which is the head row's (the ▾ is at its left). Every
 *  edge reshapes; the grip only says so. */
export function freeCorner(dock) {
    return { h: dock.h === 'r' ? 'l' : 'r', v: 'b' };
}

/** A stored dock, or null when it is not one this module could have made. */
export function validDock(d, minW, minH) {
    if (!d || (d.h !== 'l' && d.h !== 'r') || (d.v !== 't' && d.v !== 'b')) return null;
    if (![d.x, d.y].every(Number.isFinite) || d.x < 0 || d.y < 0) return null;
    if (d.w != null && !(Number.isFinite(d.w) && d.w >= minW)) return null;
    if (d.ht != null && !(Number.isFinite(d.ht) && d.ht >= minH)) return null;
    return d;
}

/**
 * The docked geometry as CSS: offsets from the docked edges, clamped so a
 * window that has since shrunk still shows the head; content size on any
 * axis the reader has not shaped.
 *
 * @param {Object} dock
 * @param {{open: boolean, headPx: number, autoMaxW: number, minW: number}} opts
 */
export function dockedStyle(dock, { open, headPx, autoMaxW, minW }) {
    const shaped = dock.w != null && open;
    const drawnW = shaped ? `min(${dock.w}px, 100%)` : `min(${autoMaxW}px, 100%)`;
    // The offset clamp keeps a panel on screen in a window that has shrunk. A
    // content-sized (or folded) panel's width is unknowable to CSS, so it is
    // clamped by the minimum — the cap would shove a narrow panel sideways.
    const clampW = shaped ? drawnW : `min(${minW}px, 100%)`;
    const drawnY = `clamp(0px, ${dock.y}px, calc(100% - ${headPx}px))`;
    return {
        [dock.h === 'r' ? 'right' : 'left']: `clamp(0px, ${dock.x}px, calc(100% - ${clampW}))`,
        [dock.v === 'b' ? 'bottom' : 'top']: drawnY,
        // Folded, the panel is its head row, tight — whatever width the
        // reader shaped it to open.
        ...(shaped ? { width: drawnW } : { width: 'max-content', maxWidth: drawnW }),
        ...(open && dock.ht != null ? { height: `${dock.ht}px` } : {}),
        // Never past the far edge, never smaller than the head — measured from
        // the offset actually DRAWN: a window that has shrunk below a stored
        // top offset draws the panel higher, and must give it that room.
        maxHeight: `max(${headPx}px, calc(100% - ${drawnY}))`,
    };
}
