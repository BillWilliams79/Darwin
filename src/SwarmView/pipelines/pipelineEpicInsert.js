// pipelineEpicInsert.js — the pure half of adding epics from the Plan
// visualizer (req #3586).
//
// Three "+" marks, all drawn wherever the cards are (a fourth, req #3719, is
// not on a card at all: the ADD-INITIATIVE "+" under the last initiative band — see
// `initiativeAddMark`):
//
//   EDGE "+"    on every dependency arc A → B. It SPLITS the edge: a new epic N
//               is created depending on A, and B's dependency switches from A
//               to N, so the plan reads A → N → B.
//   DEPENDENT "+" at the end of a short stub off each card's right side. It
//               adds a DEPENDENT EPIC: an epic N depending on that epic ALONE.
//               (req #3647: the reader-facing name everywhere is "dependent
//               epic" — never "parallel" or "branch".)
//   PRECEDE "+" (req #3617) the dependent stub's mirror, off the LEFT side of a
//               card that has no dependency arc landing on it. It adds an epic
//               N that this epic then DEPENDS ON: N → epic.
//
// What lives here is the GEOMETRY (where each mark sits, in world coordinates,
// derived from the layout's own arcs and nodes — never re-measured) and the
// ORDER OF WRITES each action performs. The Konva drawing, the dialog and the
// REST calls are in PipelinePlanVisualizer.jsx and Epics/epicsApi.js.
//
// ── WHERE AN EDGE'S "+" SITS ───────────────────────────────────────────────
// Not at the arc's arithmetic midpoint. Every arc leaves its source card's
// right-edge midpoint and lands on its target's left-edge midpoint, so all of a
// epic's outgoing arcs share a start point and all its incoming arcs share an
// end point — the ends are exactly where arcs are indistinguishable. And a long
// straight arc runs BEHIND the cards on its lane, so its midpoint can sit under
// a card. The one stretch each arc owns is its BEND, which the router confines
// to the gutter between two columns (`CARD_GAP_X`): the bend's midpoint is
// where the "+" goes. For these symmetric control points the cubic's t=0.5
// point is exactly (start.x + bend/2, (y1 + y2)/2), so no curve evaluation is
// needed. A straight arc has no bend; its "+" sits in the gutter just past its
// source card, the one place a straight run is guaranteed to be in open air.
// Either way the mark is CENTRED ON THE LINE, and its opaque disc hides the
// line inside it, so the line reads as running through the "+".

import { CARD_GAP_X, CARD_RADIUS } from './pipelinePlanLayout';

/** Gap between the last initiative band's bottom edge and the add-initiative mark's rim. */
const INITIATIVE_ADD_GAP = 8;

/** The mark's world radius at scale `k`: ~7 screen px, never smaller than 7
 * world px (it stays inside the gutter) nor larger than 12 (two marks in one
 * gutter keep clear air at the pinned low-zoom levels). */
export function insertMarkRadius(k) {
    const kk = Number.isFinite(k) && k > 0 ? k : 1;
    return Math.min(12, Math.max(7, 7 / kk));
}

// The router's own bend length, recomputed from the arc's endpoints — the same
// expression `computePlanLayout` uses, so the mark lands on the drawn curve.
const bendOf = (arc) => Math.min(Math.max(40, CARD_GAP_X - 2), Math.max(40, arc.x2 - arc.x1));

/**
 * The candidate points for one arc's "+", best first.
 * @param {Object} arc  one of `computePlanLayout(...).arcs`
 * @returns {{x: number, y: number}[]}
 */
export function arcInsertCandidates(arc) {
    if (arc.straight) {
        const span = arc.x2 - arc.x1;
        const g = Math.min(CARD_GAP_X, span);
        const cands = [{ x: arc.x1 + g / 2, y: arc.y1 }];
        // A straight arc spanning more than one gutter also owns the gutter
        // just before its target — open air too, and a second chance when a
        // sibling arc already holds the first.
        if (span > CARD_GAP_X) cands.push({ x: arc.x2 - g / 2, y: arc.y2 });
        return cands;
    }
    const bend = bendOf(arc);
    const start = arc.route === 'late' ? Math.max(arc.x1, arc.x2 - bend) : arc.x1;
    return [{ x: start + bend / 2, y: (arc.y1 + arc.y2) / 2 }];
}

/** The click/hover radius of a mark, as a multiple of its drawn radius. */
export const INSERT_HIT_SCALE = 1.25;

const cubicAt = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/**
 * Points ON one arc's drawn path, about every `epic` world px — the same
 * pieces `computePlanLayout` emits (a straight run and/or the bend's cubic),
 * so a mark placed on any of them sits on the line the canvas draws.
 */
export function arcPathPoints(arc, epic = 4) {
    const pts = [];
    const line = (xa, ya, xb, yb) => {
        const n = Math.max(1, Math.ceil(Math.hypot(xb - xa, yb - ya) / epic));
        for (let i = 0; i <= n; i++) {
            pts.push({ x: xa + ((xb - xa) * i) / n, y: ya + ((yb - ya) * i) / n });
        }
    };
    const cubic = (x0, y0, x1, y1, x2, y2, x3, y3) => {
        const n = Math.max(8, Math.ceil(Math.hypot(x3 - x0, y3 - y0) / epic));
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            pts.push({ x: cubicAt(x0, x1, x2, x3, t), y: cubicAt(y0, y1, y2, y3, t) });
        }
    };
    const { x1, y1, x2, y2 } = arc;
    if (arc.straight) {
        line(x1, y1, x2, y2);
        return pts;
    }
    const bend = bendOf(arc);
    if (arc.route === 'late') {
        const xb = Math.max(x1, x2 - bend);
        line(x1, y1, xb, y1);
        cubic(xb, y1, xb + bend * 0.45, y1, xb + bend * 0.55, y2, x2, y2);
    } else {
        cubic(x1, y1, x1 + bend * 0.45, y1, x1 + bend * 0.55, y2, x1 + bend, y2);
        line(x1 + bend, y2, Math.max(x2, x1 + bend), y2);
    }
    return pts;
}

/**
 * One "+" per dependency arc, CENTRED ON THE ARC'S OWN LINE (user directive:
 * the line passes through the middle of the mark). Two arcs can genuinely
 * share a stretch of line — a long same-lane edge A -> C runs exactly along
 * A -> B -> C, behind B — so a mark's best point may already be taken. It then
 * SLIDES ALONG ITS OWN PATH to the nearest point that is clear of every other
 * mark (`obstacles` — the dependent marks — included) and not under a card, so
 * it never leaves the line and no two hit areas overlap. Only a path with no
 * such point at all keeps its best point; the dialog names the two epics.
 *
 * @param {Object[]} arcs  `computePlanLayout(...).arcs`
 * @param {number} r       the mark radius it is placed at
 * @param {{x: number, y: number}[]} [obstacles]
 * @param {Iterable<Object>} [nodes]  the layout's nodes — card boxes to avoid
 * @returns {{fromId: number, toId: number, x: number, y: number}[]}
 */
export function edgeInsertMarks(arcs, r, obstacles = [], nodes = []) {
    const placed = [];
    const minGap = 2 * r * INSERT_HIT_SCALE;
    const boxes = [...nodes];
    // A grid of cell size `minGap`: a point can only conflict with marks in
    // its own and the eight neighbouring cells, so the spacing check is O(1)
    // rather than a scan of every mark placed so far.
    const grid = new Map();
    const cellOf = (v) => Math.floor(v / minGap);
    const add = (p) => {
        const k = `${cellOf(p.x)},${cellOf(p.y)}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(p);
    };
    const clear = (p) => {
        const cx = cellOf(p.x);
        const cy = cellOf(p.y);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (const q of grid.get(`${cx + dx},${cy + dy}`) || []) {
                    if (Math.hypot(p.x - q.x, p.y - q.y) < minGap) return false;
                }
            }
        }
        return true;
    };
    const offCards = (p) => boxes.every((n) => p.x < n.left - r || p.x > n.right + r
        || p.y < n.top - r || p.y > n.bottom + r);
    for (const q of obstacles) add(q);
    for (const arc of arcs || []) {
        const cands = arcInsertCandidates(arc);
        let p = cands.find(clear);
        if (!p) {
            const best = cands[0];
            p = arcPathPoints(arc)
                .map((q) => ({ q, d: Math.hypot(q.x - best.x, q.y - best.y) }))
                .sort((a, b) => a.d - b.d)
                .map(({ q }) => q)
                .find((q) => clear(q) && offCards(q));
        }
        p = p || cands[0];
        const mark = { fromId: arc.fromId, toId: arc.toId, x: p.x, y: p.y };
        placed.push(mark);
        add(mark);
    }
    return placed;
}

/**
 * The dependent stub off a card's right side: a short line from the card edge to
 * the "+", leaving just above the BOTTOM-RIGHT corner (user directive) — on
 * the straight part of the right edge, clear of the corner's rounding, and
 * well below the edge midpoint where every outgoing arc starts.
 *
 * @param {Object} n  one node of `computePlanLayout(...).nodes`
 * @param {number} r  the mark radius
 * @returns {{x1: number, y: number, x: number}}  stub from (x1, y) to the mark at (x, y)
 */
export function dependentStub(n, r) {
    const y = Math.max(n.y + 8, n.bottom - CARD_RADIUS - 3);
    const x1 = n.right + 1;
    return { x1, y, x: x1 + r + 8 };
}

/**
 * The precede stub off a card's LEFT side (req #3617): `dependentStub`'s mirror —
 * the same height, just above the BOTTOM-LEFT corner (user directive: "bottom
 * aligned on the left side line"), the same length out into the gutter before
 * the card. Only drawn on a card no dependency arc lands on.
 *
 * @param {Object} n  one node of `computePlanLayout(...).nodes`
 * @param {number} r  the mark radius
 * @returns {{x1: number, y: number, x: number}}  stub from (x1, y) to the mark at (x, y)
 */
export function precedeStub(n, r) {
    const { y } = dependentStub(n, r);
    const x1 = n.left - 1;
    return { x1, y, x: x1 - r - 8 };
}

/** The largest radius `insertMarkRadius` returns — marks are PLACED at it. */
export const INSERT_MARK_MAX_R = 12;

/**
 * The add-initiative "+" (req #3719): directly under the bottom of the LAST initiative band,
 * left-aligned with the initiative chips (which start at x = 12). Null when the plan
 * draws no band — the empty-plan panel owns that case. Placed at radius `r`
 * like every other mark; `computePlanLayout` reserves `INITIATIVE_ADD_RESERVE` below
 * the last band so the whole disc is inside the world.
 *
 * @returns {?{key: 'initiative-add', kind: 'initiative', fromId: null, toId: null, x: number, y: number}}
 */
export function initiativeAddMark(layout, r = INSERT_MARK_MAX_R) {
    const bands = layout?.bands || [];
    if (!bands.length) return null;
    // The band the mark sits under: its initiative seeds the dialog's category.
    const last = bands.reduce((a, b) => (b.y + b.height > a.y + a.height ? b : a));
    const bottom = last.y + last.height;
    return { key: 'initiative-add', kind: 'initiative', fromId: null, toId: null,
        afterInitiativeId: last.initiativeId ?? null,
        x: 12 + r, y: bottom + INITIATIVE_ADD_GAP + r };
}

/**
 * Every add-epic mark for a layout, computed ONCE per layout — never per frame
 * and never per zoom. The canvas re-renders on every pan and zoom event, so
 * anything here that ran in the render body ran at pointer rate (the req #3586
 * first cut did, and made the plan unscrollable). Placement uses the LARGEST
 * radius, so the no-overlap spacing holds at every smaller radius the zoom
 * draws at, and the zoom never has to re-place anything. Dependent and precede
 * marks are placed first and the edge marks keep clear of them.
 *
 * A precede mark is drawn on a card only when the epic has no dependency
 * among the plan's rows (req #3650 — read from `depIds`, since a folded initiative
 * draws no arcs for a dependency that still exists).
 * (An unrelated early-route arc can still pass BEHIND such a card; the test is
 * the dependency data, not the pixels.) A stub runs from `x1` (the card edge) towards `x2`
 * (the mark's centre), on either side.
 *
 * @returns {{r: number, edgeCount: number, dependentCount: number, precedeCount: number,
 *            initiativeCount: number,
 *            stubs: {x1: number, x2: number, y: number}[],
 *            marks: {key: string, kind: 'edge'|'dependent'|'precede'|'initiative', fromId: ?number,
 *                    toId: ?number, x: number, y: number}[]}}
 */
export function buildInsertMarks(layout, rows, r = INSERT_MARK_MAX_R, { initiativeAdd = true } = {}) {
    const stubs = [];
    const marks = [];
    // From the DEPENDENCY DATA, not from the drawn arcs (req #3650): a folded
    // initiative draws no arcs into or out of its epics, and an epic waiting on one of
    // them still HAS a dependency — it must not be offered a "nothing precedes
    // this" mark. With nothing folded the two answers are identical, because
    // the layout draws exactly one arc per in-plan dependency.
    const rowIds = new Set((rows || []).map((row) => row.id));
    const landed = new Set((rows || [])
        .filter((row) => (row.depIds || []).some((d) => rowIds.has(d)))
        .map((row) => row.id));
    let dependentCount = 0;
    let precedeCount = 0;
    for (const row of rows || []) {
        const n = layout?.nodes?.get(row.id);
        if (!n) continue;
        const b = dependentStub(n, r);
        stubs.push({ x1: b.x1, x2: b.x, y: b.y });
        marks.push({ key: `dependent-${row.id}`, kind: 'dependent', fromId: row.id, toId: null, x: b.x, y: b.y });
        dependentCount++;
        if (landed.has(row.id)) continue;
        const p = precedeStub(n, r);
        stubs.push({ x1: p.x1, x2: p.x, y: p.y });
        marks.push({ key: `precede-${row.id}`, kind: 'precede', fromId: null, toId: row.id, x: p.x, y: p.y });
        precedeCount++;
    }
    const edges = edgeInsertMarks(layout?.arcs, r, marks, layout?.nodes?.values?.() || []);
    for (const m of edges) {
        marks.push({ key: `edge-${m.fromId}-${m.toId}`, kind: 'edge', ...m });
    }
    // The add-initiative "+" (req #3719). Not an epic mark, but the same shape, hit
    // test and hover — so it rides the same list. `initiativeAdd: false` is the
    // caller's word that initiatives cannot be added (a locked plan).
    const initiativeMark = initiativeAdd ? initiativeAddMark(layout, r) : null;
    if (initiativeMark) marks.push(initiativeMark);
    return { r, stubs, marks, edgeCount: edges.length, dependentCount, precedeCount,
        initiativeCount: initiativeMark ? 1 : 0 };
}

/** The mark whose hit circle — at the DRAWN radius `r` — contains world point
 * `p`, or null. */
export function insertMarkAt(geom, p, r = geom?.r) {
    if (!geom || !p) return null;
    const reach = r * INSERT_HIT_SCALE;
    let best = null;
    let bestD = Infinity;
    for (const m of geom.marks) {
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d <= reach && d < bestD) { best = m; bestD = d; }
    }
    return best;
}

/** Default title of an epic created from the canvas, before the reader edits it. */
export const NEW_EPIC_TITLE = 'New epic';

/** Default title of an initiative created from the canvas's add-initiative "+" (req #3719). */
export const NEW_INITIATIVE_TITLE = 'New initiative';

/**
 * The dialog's request for each action, so the visualizer and its tests agree
 * on what is being asked: which epic(s) it touches and which initiative the new epic
 * defaults to (the epic to its LEFT — the one it depends on — or, for a
 * precede, which has no epic on its left, the epic it will gate).
 *
 * @param {'edge'|'dependent'|'precede'} kind
 * @param {{fromId?: ?number, toId?: ?number}} ids
 * @param {Map<number, Object>} rowById
 */
export function insertRequest(kind, { fromId = null, toId = null }, rowById) {
    if (kind === 'precede') {
        const to = rowById?.get(toId);
        return {
            kind,
            fromId: null,
            toId,
            initiativeId: to?.initiativeId ?? null,
            fromTitle: null,
            toTitle: to?.title || `epic ${toId}`,
        };
    }
    const from = rowById?.get(fromId);
    const to = toId != null ? rowById?.get(toId) : null;
    return {
        kind,
        fromId,
        toId: kind === 'edge' ? toId : null,
        initiativeId: from?.initiativeId ?? to?.initiativeId ?? null,
        fromTitle: from?.title || `epic ${fromId}`,
        toTitle: kind === 'edge' ? (to?.title || `epic ${toId}`) : null,
    };
}
