// planOverview.js — the pipeline card's preview, laid out (req #3804).
//
// User directive, req #3804 review: *"redesign it like level 2 … L1 look and
// feel but with a count of issues badge and its condensed … excellent taste in
// white space and sizing and fits the whole view of the initiatives and
// steps."* So the preview is no longer a crop of the L3 canvas: it is the WHOLE
// plan, every initiative band and every epic, as L1 beads with the L2 count
// badge (the epic's requirement count), condensed to the frame.
//
// CONDENSED, NOT SCALED. The plan page's geometry reserves a full card per epic
// at every level, so fitting it whole into a 132px strip would shrink the beads
// to specks between acres of empty card room. This keeps the plan's STRUCTURE —
// `computePlanLayout`'s initiative bands, its dependency columns (`depth`) and
// its lanes — and re-spaces it on its own pitch, sized to the frame and capped
// so a small plan sits centred with air around it rather than blown up.
//
// ITS LIMIT, stated: in a 160px frame, with the marks drawn at `markScale`,
// the tight spacing keeps beads apart up to about 12 single-lane initiative
// bands, and badges apart while a lane is at least ~12px or a column
// ~badge-wide; past that they overlap, and past ~25 bands the outermost are
// clipped. Production's largest plan (6 bands, 9
// lanes; 23 columns) sits well inside it.
//
// PURE: a layout and its rows in, positions out. The component draws them.

export const OVERVIEW = Object.freeze({
    padX: 14,       // frame edge -> band edge
    padY: 10,
    bandGap: 6,     // between initiative bands
    bandPadX: 10,   // band edge -> first/last bead column
    bandPadY: 4,
    // A CROWDED plan (many bands, many lanes) gives its air back to the lanes:
    // below `crowdedLane` px a lane, the gaps tighten to these.
    crowdedLane: 16,
    tightPadY: 6,
    tightBandGap: 3,
    tightBandPadY: 1,
    colMax: 60,     // the widest a dependency column gets — a 3-epic plan stays compact
    laneMax: 26,    // the tallest a lane gets
    beadMin: 2.5,
    beadMax: 6.5,
    beadShare: 0.32, // bead radius as a share of the smaller pitch
    // req #3804 review — "make the requirement badges and the epic bubble 50%
    // bigger but keep rest same": the bead and its badge are drawn at this
    // multiple of the size the spacing above gives them; bands, columns, lanes
    // and the frame are unchanged.
    markScale: 1.5,
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {Object} layout   a `computePlanLayout` result
 * @param {Object[]} rows   the adapted plan rows that layout was computed from
 * @param {number} width    the frame, in screen px
 * @param {number} height
 * @returns {null | {
 *   bands: {key, color, x, y, w, h}[],
 *   beads: {id, row, x, y, count}[],
 *   arcs: {x1, y1, x2, y2}[],
 *   wires: {x1, x2, y, color}[],
 *   r: number,
 * }}
 */
export function planOverview(layout, rows, width, height) {
    const nodes = layout?.nodes;
    if (!nodes || !nodes.size || !(width > 0) || !(height > 0)) return null;
    const O = OVERVIEW;

    // Lanes are PACKED: a band's lanes that hold no bead here (the plan page
    // keeps them for card room) are dropped, so every row of the overview
    // carries a bead.
    let cols = 0;
    const usedLanes = new Map();      // band -> Set of lane indices holding a bead
    for (const n of nodes.values()) {
        cols = Math.max(cols, (n.depth ?? 0) + 1);
        const b = n.bandIndex ?? 0;
        if (!usedLanes.has(b)) usedLanes.set(b, new Set());
        usedLanes.get(b).add(n.lane ?? 0);
    }
    const laneRank = new Map();       // band -> Map(lane -> packed row)
    const lanesByBand = new Map();
    for (const [b, set] of usedLanes) {
        const sorted = [...set].sort((x, y) => x - y);
        laneRank.set(b, new Map(sorted.map((lane, i) => [lane, i])));
        lanesByBand.set(b, sorted.length);
    }
    const bands = (layout.bands || [])
        .map((band, index) => ({ band, index, lanes: lanesByBand.get(index) || 0 }))
        .filter((b) => b.lanes > 0);
    if (!bands.length || !cols) return null;

    const totalLanes = bands.reduce((s, b) => s + b.lanes, 0);
    const availW = width - 2 * O.padX - 2 * O.bandPadX;
    const colPitch = Math.max(1, Math.min(O.colMax, availW / cols));
    const pitchWith = (padY, gap, bandPadY) => Math.max(1, Math.min(O.laneMax,
        (height - 2 * padY - (bands.length - 1) * gap - bands.length * 2 * bandPadY)
        / totalLanes));
    let gaps = { padY: O.padY, bandGap: O.bandGap, bandPadY: O.bandPadY };
    let lanePitch = pitchWith(gaps.padY, gaps.bandGap, gaps.bandPadY);
    if (lanePitch < O.crowdedLane) {
        gaps = { padY: O.tightPadY, bandGap: O.tightBandGap, bandPadY: O.tightBandPadY };
        lanePitch = pitchWith(gaps.padY, gaps.bandGap, gaps.bandPadY);
    }
    const r = clamp(Math.min(colPitch, lanePitch) * O.beadShare, O.beadMin, O.beadMax)
        * O.markScale;

    const contentW = cols * colPitch + 2 * O.bandPadX;
    const contentH = bands.reduce((s, b) => s + b.lanes * lanePitch + 2 * gaps.bandPadY, 0)
        + (bands.length - 1) * gaps.bandGap;
    const x0 = (width - contentW) / 2;
    let y = (height - contentH) / 2;

    const bandBoxes = [];
    const laneTop = new Map();
    for (const b of bands) {
        const h = b.lanes * lanePitch + 2 * gaps.bandPadY;
        bandBoxes.push({ key: b.band.key, color: b.band.color, x: x0, y, w: contentW, h });
        laneTop.set(b.index, y + gaps.bandPadY);
        y += h + gaps.bandGap;
    }

    const at = new Map();
    for (const [id, n] of nodes) {
        if (!laneTop.has(n.bandIndex ?? 0)) continue;
        const band = n.bandIndex ?? 0;
        const row = laneRank.get(band).get(n.lane ?? 0);
        at.set(id, {
            x: x0 + O.bandPadX + ((n.depth ?? 0) + 0.5) * colPitch,
            y: laneTop.get(band) + (row + 0.5) * lanePitch,
            band,
        });
    }

    const beads = [];
    const arcs = [];
    for (const row of rows || []) {
        const p = at.get(row.id);
        if (!p) continue;
        beads.push({ id: row.id, row, x: p.x, y: p.y, count: (row.reqIds || []).length });
        for (const dep of row.depIds || []) {
            const q = at.get(dep);
            if (q) arcs.push({ x1: q.x, y1: q.y, x2: p.x, y2: p.y });
        }
    }

    // A lane's wire runs bead to bead, as L1's does — never past either end.
    const span = new Map();
    for (const p of at.values()) {
        const key = `${p.band}:${p.y}`;
        const s = span.get(key) || { x1: p.x, x2: p.x, y: p.y, band: p.band };
        s.x1 = Math.min(s.x1, p.x);
        s.x2 = Math.max(s.x2, p.x);
        span.set(key, s);
    }
    const colorOf = new Map(bands.map((b) => [b.index, b.band.color]));
    const wires = [...span.values()].filter((s) => s.x2 > s.x1)
        .map((s) => ({ x1: s.x1, x2: s.x2, y: s.y, color: colorOf.get(s.band) }));

    return { bands: bandBoxes, beads, arcs, wires, r, lanePitch, colPitch };
}

/** A curve from one bead to the next column's, flat at both ends like L1's arcs. */
export function overviewArcPath({ x1, y1, x2, y2 }) {
    if (y1 === y2) return `M${x1},${y1} L${x2},${y2}`;
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}
