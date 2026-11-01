// planPointObject.js — what the plan canvas draws at a point, for the
// Requirement Filer's pushpin (req #4158).
//
// The plan is drawn on Konva, so the filer's DOM probe finds only the canvas
// and named `pipeline-plan-visualizer` — on 22 of the captures req #4157 read.
// This answers the question the probe cannot: WHICH epic, requirement row,
// dependency arc or initiative band is under (x, y)?
//
// GEOMETRY OVER THE LAYOUT, NOT THE HIT GRAPH. The layout (pipelinePlanLayout)
// publishes every box the canvas draws — each card's frame, each requirement
// row's box, each band's extent, each arc's endpoints and path — and the
// renderer reads exactly those boxes, so testing a point against them names
// what is SEEN there. Konva's hit graph cannot: most of these shapes are drawn
// `listening={false}` (the rows' pills, every arc, the band's header), a
// requirement row and the card under it are both hits, and the band has no
// shape at all. One pure function over the layout is also one a unit test can
// reach.
//
// Precedence follows what sits on top: a requirement row (drawn inside its
// card) before the card, the card before an arc running beside it, and the
// band last — it is the background the rest is drawn on.

import { REQ_TEXT_H } from './pipelinePlanLayout';

/** An arc counts as pointed at within this many SCREEN px of its line. */
export const ARC_HIT_PX = 5;
/** A bead (Overview) counts as pointed at within this many screen px, at least. */
export const BEAD_MIN_HIT_PX = 8;

const inBox = (p, x, y, w, h) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

/** Distance from p to the segment a–b. */
function segDist(p, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2)) : 0;
    return Math.hypot(p.x - (ax + u * dx), p.y - (ay + u * dy));
}

/** An arc's SVG path (`M x,y C … L x,y`) as a polyline, cubic segments sampled. */
export function pathPoints(path, steps = 16) {
    const tokens = String(path || '').match(/[MCL]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
    const pts = [];
    let cmd = null;
    let nums = [];
    const flush = () => {
        if (cmd === 'M' || cmd === 'L') {
            for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
        } else if (cmd === 'C' && pts.length) {
            for (let i = 0; i + 5 < nums.length; i += 6) {
                const [x0, y0] = pts[pts.length - 1];
                const [x1, y1, x2, y2, x3, y3] = nums.slice(i, i + 6);
                for (let s = 1; s <= steps; s++) {
                    const u = s / steps;
                    const v = 1 - u;
                    pts.push([
                        v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3,
                        v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3,
                    ]);
                }
            }
        }
        nums = [];
    };
    for (const tk of tokens) {
        if (/^[MCL]$/i.test(tk)) { flush(); cmd = tk.toUpperCase(); } else nums.push(Number(tk));
    }
    flush();
    return pts;
}

function arcDistance(arc, p) {
    if (arc.straight || !arc.path) return segDist(p, arc.x1, arc.y1, arc.x2, arc.y2);
    const pts = pathPoints(arc.path);
    let d = Infinity;
    for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    return d;
}

/**
 * The object drawn at panel point `p` ({x, y}, px from the canvas host's
 * top-left), or null.
 *
 * @param {Object} layout  the layout the canvas DRAWS (`drawLayout`)
 * @param {{x, y, k}} t    the camera
 * @param {{x, y}} p
 * @param {Object} o
 * @param {(kind: string) => boolean} o.drawsKind  which label kinds are drawn now
 * @param {boolean} o.drawsCard   cards (L2/L3) — else beads (Overview)
 * @param {string} [o.level]      'out' | 'mid' | 'in' — a requirement row is drawn at its
 *   TITLE box only at 'in'; below it, its bare id sits at `idY` (the renderer's own choice)
 * @param {number} o.beadHitRadius  the bead's world hit radius
 * @param {(id) => ?string} [o.epicTitle]
 * @param {(id) => ?string} [o.reqTitle]
 * @returns {?{kind, id, title, rect: {left, top, width, height}}}  rect in panel px
 */
export function planObjectAt(layout, t, p, {
    drawsKind = () => false, drawsCard = false, beadHitRadius = 0, level = 'in',
    epicTitle = () => null, reqTitle = () => null,
} = {}) {
    if (!layout || !t || !(t.k > 0) || !p) return null;
    const w = { x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k };
    const screen = (x, y, bw, bh) => ({ left: x * t.k + t.x, top: y * t.k + t.y, width: bw * t.k, height: bh * t.k });
    const epic = (id) => ({ kind: 'epic', id, title: epicTitle(id) ?? null });

    // 1. A requirement row, inside its card.
    if (drawsKind('req')) {
        for (const l of layout.labels || []) {
            if (l.kind !== 'req' || l.reqId == null) continue;
            // WHERE IT IS DRAWN: PipelinePlanVisualizer's `showTitle` / `reqY` — the
            // title box at L3, the one-line id packed at `idY` below it.
            const titled = level === 'in' && l.idText != null;
            const box = titled || l.idY == null
                ? { y: l.y, w: l.w, h: l.h }
                : { y: l.idY, w: l.idW ?? l.w, h: Math.min(l.h, REQ_TEXT_H) };
            if (!inBox(w, l.x, box.y, box.w, box.h)) continue;
            return { kind: 'requirement', id: l.reqId, title: reqTitle(l.reqId) ?? l.text ?? null,
                epicId: l.epicId, rect: screen(l.x, box.y, box.w, box.h) };
        }
    }
    // 2. The card — or, at Overview, the bead.
    const nodes = layout.nodes instanceof Map ? [...layout.nodes.values()] : [];
    for (const n of nodes) {
        if (n.reveal != null && n.reveal <= 0) continue;
        if (drawsCard) {
            const left = n.frameLeft ?? n.left;
            const fw = n.frameW ?? n.w;
            if (inBox(w, left, n.top, fw, n.h)) return { ...epic(n.id), rect: screen(left, n.top, fw, n.h) };
        } else {
            const r = Math.max(beadHitRadius, BEAD_MIN_HIT_PX / t.k);
            if (Math.hypot(w.x - n.x, w.y - n.y) <= r) return { ...epic(n.id), rect: screen(n.x - r, n.y - r, 2 * r, 2 * r) };
        }
    }
    // 3. A dependency arc.
    const tol = ARC_HIT_PX / t.k;
    for (const a of layout.arcs || []) {
        if (a.fromId == null || a.toId == null || arcDistance(a, w) > tol) continue;
        const from = epicTitle(a.fromId);
        const to = epicTitle(a.toId);
        const xs = a.path ? pathPoints(a.path).map((q) => q[0]) : [a.x1, a.x2];
        const ys = a.path ? pathPoints(a.path).map((q) => q[1]) : [a.y1, a.y2];
        const x0 = Math.min(...xs);
        const y0 = Math.min(...ys);
        return {
            kind: 'dependency', id: `${a.fromId}→${a.toId}`,
            title: `epic #${a.toId}${to ? ` "${to}"` : ''} waits for epic #${a.fromId}${from ? ` "${from}"` : ''}`,
            fromId: a.fromId, toId: a.toId,
            rect: screen(x0 - tol, y0 - tol, Math.max(...xs) - x0 + 2 * tol, Math.max(...ys) - y0 + 2 * tol),
        };
    }
    // 4. The initiative band it all sits in.
    for (const b of layout.bands || []) {
        if (!(w.y >= b.y && w.y <= b.y + b.height)) continue;
        if (w.x < 0 || w.x > (layout.width || Infinity)) continue;
        return {
            kind: 'initiative', id: b.initiativeId ?? 'none', title: b.initiative ?? null,
            rect: screen(0, b.y, layout.width || 0, b.height),
        };
    }
    return null;
}
