// pipelinePlanLayout.js — pure geometry for the Plan visualizer (req #3115),
// the product form of the POC viz-generate.py Plan mode archived in req #3080.
//
// PURE LOGIC ONLY: engine PlanRows + LaunchBatches in, world-space geometry out.
// No React, no Konva, no DOM text measurement — widths come from a fixed
// monospace character metric so the zero-overlap guarantee is decidable here and
// testable in vitest without a canvas (the konvaSwarmModel.js separation).
//
// The layout language (POC, kept verbatim unless noted):
//   - Epic bands stacked vertically, one per DOMINANT epic (design rule 10), in
//     first-appearance order over the given rows (callers pass display order, so
//     completed epics surface first exactly as the POC page read).
//   - Dependency-depth columns left-to-right; a step's column is
//     1 + max(dep columns).
//   - Chain-aware swim lanes inside each band: a step takes its first same-epic
//     dependency's lane when free, and that lane is RESERVED across the columns
//     the chain spans, so no unrelated bead sits on an arc's path.
//   - Requirement ids BELOW the bead: 'horizontal' lays them on one line and the
//     column grows to fit; 'vertical' stacks one per line and the lane pitch
//     grows instead. Step label ABOVE the bead: the step id, or the step title
//     (req #3080 POC addendum 2026-07-27 — the ID/Title toggle #3115 inherits);
//     column widths account for whichever is drawn. Zero label overlap holds in
//     all four combinations BY CONSTRUCTION, and the exported label rects let
//     tests assert it rather than trust it.
//   - Launch-batch dashed boxes around batch-mates (identical gate + run +
//     machines — the engine's launchKey). Identical dep sets mean identical
//     depth, so a batch is one column; a box may legitimately span epic bands.
//
// Two deliberate deviations from the POC, both documented for the PR:
//   1. Band header height 40 (POC 34): the POC's epic label and a lane-0 step
//      label could brush within a pixel; the taller header buys a real gap so
//      the overlap invariant is provable, not marginal.
//   2. Every lane reserves a TITLE SLOT under the requirement ids (pitch grows
//      ~14px): the 'in' zoom level draws the step title there, truncated to the
//      column width. Reserving it unconditionally keeps zoom a pure transform —
//      level changes never relayout, so the overlap guarantee holds at every k.

import { STEP_DONE, STEP_RUNNING, STEP_PENDING } from './pipelineModel';

// ── POC design language (viz-generate.py palette, kept verbatim) ────────────
export const PLAN_VIZ_PALETTE = {
    bg: '#0d1420',
    panel: '#111b2b',
    line: '#26374f',
    wire: '#3a5580',
    text: '#d7e3f4',
    dim: '#6f83a0',
    accent: '#4ad9c8',
    req: '#7fb4ff',
    doneFill: '#2e7d32',
    doneRing: '#7ee08a',
    doneCheck: '#c9f7cf',
    runningFill: '#FFB300',
    runningRing: '#ffd769',
    pendingFill: '#22314b',
    pendingRing: '#5b729355',
    manualRing: '#ff9bf5',
    eligibleRing: '#7ee08a',
    batch: '#4ad9c8',
};

// Epic band palette (POC EPAL) — band index cycles through it.
export const EPIC_PALETTE = ['#7c4dff', '#00897b', '#c2185b', '#f57c00', '#3949ab', '#5d4037'];

// ── World-space metrics ─────────────────────────────────────────────────────
const LEFT = 66;
const RIGHT = 14;
const MIN_WORLD_W = 1180;       // POC viewBox floor
const CHW = 6.7;                // px per mono char at font 11 (POC constant)
const CHW_TITLE = 5.8;          // px per mono char at font 9.5 (the title slot)
const CHW_EPIC = 7.3;           // px per mono char at font 12 (epic band label)
const BEAD_R = 10;
const BAND_HEADER = 40;         // deviation 1 (POC 34) — see header comment
const BATCH_HEADER_EXTRA = 16;  // extra header for bands hosting batch members:
                                // reserves the letter strip + keeps box tops
                                // below the epic label (review finding)
const BAND_GAP = 8;
const LANE_BASE_H = 56;         // POC horizontal pitch, before the title slot
const TITLE_SLOT = 14;          // deviation 2 — reserved per-lane title line
const REQ_LINE_H = 12;          // vertical layout: one requirement id per line
const STEP_LABEL_MAX = 60;      // hard ceiling on a title label above the bead
// Staggering (req #3119, the Build Visualizer's version-label pattern —
// `d3LayoutEngine.js` offsets every odd build by `versionLaneGap`). Odd columns
// draw their long text one line further from the bead, so a label and its
// left/right neighbours are never on the same line and each may overflow its own
// column. Only the SAME-PARITY columns (d±2) share a line, and the budget below
// keeps two of those from meeting.
const STAGGER_GAP = 14;
// Fraction of a neighbouring column a staggered label may reach into, PER SIDE.
// Labels are centred on their column, so the budget must bound the reach into
// the NARROWER neighbour and then apply symmetrically — bounding the sum of both
// neighbours does not work, because a wide left neighbour would buy half-width
// that gets spent on the right. (That was the first version of this, and it
// admits an overlap: with colW = [224, 64, 64, 64, 224] the labels at d=1 and
// d=3 — the only pair that shares a line — overlapped by ~40px. Found in review,
// with the dataset.) Two same-line labels intrude on the shared column d±1 from
// opposite sides, so anything under 0.5 per side cannot meet; 0.4 leaves margin
// for the mono-width estimate itself.
const STAGGER_REACH = 0.4;
// Minimum column width when STEP TITLES are drawn (req #3119, user directive:
// "increase the display of the step name by 50% more characters"). The binding
// constraint on a step name was never STEP_LABEL_MAX — it was the stagger
// budget, which is derived from the column, and a column sized to a 4-digit
// requirement id is ~64px, i.e. ~16 characters after the reach is added. Giving
// the column a floor raises the budget for every title at once; STEP_LABEL_MAX
// is only the ceiling that stops a pathological title from running forever.
const TITLE_COL_MIN = 96;
export const PLAN_VIZ_FONT = {
    label: 11, req: 11, title: 9.5, epic: 12, batch: 10, check: 9,
};

export const BEAD_RADIUS = BEAD_R;

const truncate = (s, n) => {
    const str = String(s == null ? '' : s);
    return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

// The text drawn ABOVE a bead. NO '#' anywhere — ids render bare (production
// directive), titles render verbatim (stored plan content).
export function stepLabelText(row, stepLabel, maxChars = STEP_LABEL_MAX) {
    return stepLabel === 'title'
        ? truncate(row.title || `step ${row.id}`, Math.max(4, Math.min(STEP_LABEL_MAX, maxChars)))
        : String(row.id);
}

const reqStr = (row) => (row.reqIds || []).join(' ');

/**
 * Compute the full Plan-mode layout.
 *
 * @param {Object[]} rows      engine PlanRows, DISPLAY order (band order follows
 *                             first appearance, so pass displayOrder output)
 * @param {Object[]} batches   engine LaunchBatch[] (launchBatches output)
 * @param {Object} [opts]
 * @param {('horizontal'|'vertical')} [opts.reqLayout]
 * @param {('id'|'title')} [opts.stepLabel]
 * @returns {Object} layout — see the shape assembled at the bottom
 */
export function computePlanLayout(rows, batches, { reqLayout = 'horizontal', stepLabel = 'id' } = {}) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const safeBatches = Array.isArray(batches) ? batches : [];
    if (safeRows.length === 0) {
        return {
            width: MIN_WORLD_W, height: 120, bands: [], nodes: new Map(),
            arcs: [], batchBoxes: [], labels: [], colW: [], colX: [],
            reqLayout, stepLabel, empty: true,
        };
    }

    const byId = new Map(safeRows.map((r) => [r.id, r]));
    const depsOf = (r) => (r.depIds || []).filter((d) => byId.has(d));

    // ── Dependency-depth columns ────────────────────────────────────────────
    const depthMemo = new Map();
    const depth = (r) => {
        if (depthMemo.has(r.id)) return depthMemo.get(r.id);
        depthMemo.set(r.id, 0); // cycle guard — a cycle collapses to column 0
        const v = 1 + Math.max(-1, ...depsOf(r).map((d) => depth(byId.get(d))));
        depthMemo.set(r.id, v);
        return v;
    };
    safeRows.forEach(depth);
    const maxD = Math.max(...safeRows.map((r) => depthMemo.get(r.id)));

    // ── Column widths (the zero-overlap contract, half 1) ───────────────────
    // A column is as wide as the widest thing DRAWN in it: the one-line req-id
    // string (horizontal) or the widest single id (vertical), and the step
    // label — id or truncated title — in either mode.
    const colSteps = [];
    for (const r of safeRows) {
        const d = depthMemo.get(r.id);
        (colSteps[d] ||= []).push(r);
    }
    // Title-mode step labels are STAGGERED, so a column no longer has to be as
    // wide as its longest title — the label overflows into the neighbouring
    // columns, which draw on the other line (req #3119). Sizing columns to full
    // titles is what made the world 5800px wide on the live plan; the ids and
    // the layout drive the width now, and the label is fitted to the room it
    // actually has, below.
    const staggerLabels = stepLabel === 'title';
    const colW = [];
    for (let d = 0; d <= maxD; d++) {
        const steps = colSteps[d] || [];
        const labelW = staggerLabels ? TITLE_COL_MIN
            : Math.max(0, ...steps.map((r) => stepLabelText(r, stepLabel).length * CHW + 16));
        let w;
        if (reqLayout === 'horizontal') {
            w = Math.max(64, labelW, ...steps.map((r) => reqStr(r).length * CHW + 30));
        } else {
            w = Math.max(70, labelW,
                ...steps.map((r) => Math.min(reqStr(r).length, 6) * CHW + 40));
        }
        colW.push(w);
    }
    // How much horizontal room a STAGGERED label at depth d may occupy: its own
    // column plus a bounded reach into each neighbour. Ends have one neighbour.
    // At the ends there is no neighbouring column, but there IS margin: the
    // left gutter the lane wires start after, and the right padding the world
    // width already reserves. Bounding by those keeps a d=0 label out of the
    // gutter instead of letting a wide colW[1] push it off the world.
    const staggerBudget = (d) => {
        const left = d > 0 ? colW[d - 1] : LEFT;
        const right = d < maxD ? colW[d + 1] : RIGHT + 40;
        return colW[d] + 2 * STAGGER_REACH * Math.min(left, right);
    };
    const staggerOf = (d) => (d % 2) * STAGGER_GAP;
    const colX = [];
    {
        let acc = LEFT;
        for (let d = 0; d <= maxD; d++) {
            colX.push(acc + colW[d] / 2);
            acc += colW[d];
        }
    }
    const totalW = Math.max(MIN_WORLD_W, colX[maxD] + colW[maxD] / 2 + RIGHT + 40);

    // ── Epic bands (dominant label, first-appearance order) ─────────────────
    const bandKeys = [];
    const bandByKey = new Map();
    for (const r of safeRows) {
        const key = r.epicId != null ? r.epicId : null;
        if (!bandByKey.has(key)) {
            bandByKey.set(key, {
                key, epicId: key, epic: r.epic || 'No epic',
                color: EPIC_PALETTE[bandKeys.length % EPIC_PALETTE.length],
                steps: [],
            });
            bandKeys.push(key);
        }
        bandByKey.get(key).steps.push(r);
    }

    // Batch letters, for adjacency inside a band (a box must never enclose a
    // non-member — POC sorted batch-mates together within the band).
    const batchOf = new Map();
    for (const b of safeBatches) {
        for (const id of b.stepIds || []) batchOf.set(id, b.letter);
    }

    // ── Chain-aware lanes with cross-column reservation ─────────────────────
    // Steps place in ascending depth order, so by the time a step chooses a
    // lane every shallower column is FINAL — checking the arc's intermediate
    // cells at inheritance time is complete, not heuristic. (The POC reserved
    // cells only after placement, which the ascending order made unreachable:
    // an arc could still run straight through an unrelated bead placed earlier
    // at an intermediate depth. Found in code review; fixed by checking the
    // corridor BEFORE inheriting — a blocked corridor falls back to a fresh
    // lane, turning the arc curved instead of driving it through a bead.)
    // Transitive dependency closure — corridor cells occupied by an IN-CHAIN
    // bead (a transitive dependent of the arc's tail and dependency of its
    // head, e.g. 13 on the 12→14 arc where 14 gates on both) are legitimate:
    // the chain reads as one line through its own members. Only unrelated
    // occupants and foreign reservations block a corridor.
    const reachMemo = new Map();
    const reach = (id) => {
        if (reachMemo.has(id)) return reachMemo.get(id);
        const out = new Set();
        reachMemo.set(id, out); // cycle guard
        const row = byId.get(id);
        for (const d of (row ? depsOf(row) : [])) {
            out.add(d);
            for (const dd of reach(d)) out.add(dd);
        }
        return out;
    };

    const laneById = new Map();
    const bands = [];
    const RESERVED = Symbol('reserved');
    for (const key of bandKeys) {
        const band = bandByKey.get(key);
        const steps = [...band.steps].sort((a, b) =>
            (depthMemo.get(a.id) - depthMemo.get(b.id)) ||
            ((batchOf.has(a.id) ? 0 : 1) - (batchOf.has(b.id) ? 0 : 1)) ||
            String(batchOf.get(a.id) || '').localeCompare(String(batchOf.get(b.id) || '')));
        const used = new Map(); // depth -> Map(lane -> step id | RESERVED)
        const take = (d, lane, occupant) => {
            if (!used.has(d)) used.set(d, new Map());
            const cells = used.get(d);
            if (!cells.has(lane)) cells.set(lane, occupant);
        };
        const occupant = (d, lane) =>
            (used.has(d) ? used.get(d).get(lane) : undefined);
        const free = (d, lane) => occupant(d, lane) === undefined;
        const corridorOk = (a, r, lane) => {
            for (let dd = depthMemo.get(a.id) + 1; dd < depthMemo.get(r.id); dd++) {
                const o = occupant(dd, lane);
                if (o === undefined) continue;
                if (o === RESERVED) return false;
                if (!(reach(o).has(a.id) && reach(r.id).has(o))) return false;
            }
            return true;
        };
        const sameEpicDepsOf = (r) => depsOf(r).map((x) => byId.get(x))
            .filter((a) => (a.epicId != null ? a.epicId : null) === key);
        // A lane is usable only if the cell is free AND every same-lane
        // dependency arc into it crosses only in-chain beads.
        const laneOk = (r, d, lane) => {
            if (!free(d, lane)) return false;
            for (const a of sameEpicDepsOf(r)) {
                if (laneById.get(a.id) === lane && !corridorOk(a, r, lane)) {
                    return false;
                }
            }
            return true;
        };
        // Same-band batch-mates take a CONTIGUOUS RUN of lanes, allocated when
        // the first mate places: the lowest run of members.length lanes that
        // all pass laneOk (dep-anchored candidates first, so a gate on this
        // band's lane keeps its straight arc when possible). Mates share one
        // dep set, so laneOk is member-independent and the pre-check holds for
        // every mate; the sort keeps mates consecutive, so nothing else places
        // between the pre-check and the last mate. A batch box therefore
        // encloses exactly its members — never a foreign bead. (Review found
        // the earlier next-free-lane packing letting mates spread around an
        // occupied lane, boxing unrelated steps in ~15% of multi-batch plans.)
        const batchRunNext = new Map(); // letter -> next lane in this band's run
        for (const r of steps) {
            const d = depthMemo.get(r.id);
            const letter = batchOf.get(r.id);
            let lane = null;
            if (letter !== undefined) {
                if (!batchRunNext.has(letter)) {
                    const n = steps.filter((s) => batchOf.get(s.id) === letter).length;
                    const runOk = (start) => {
                        for (let k = 0; k < n; k++) {
                            if (!laneOk(r, d, start + k)) return false;
                        }
                        return true;
                    };
                    let start = null;
                    for (const a of sameEpicDepsOf(r)) {
                        const al = laneById.get(a.id);
                        if (al !== undefined && runOk(al)) { start = al; break; }
                    }
                    if (start === null) {
                        start = 0;
                        while (!runOk(start)) start += 1;
                    }
                    batchRunNext.set(letter, start);
                }
                lane = batchRunNext.get(letter);
                batchRunNext.set(letter, lane + 1);
            } else {
                for (const a of sameEpicDepsOf(r)) {
                    const al = laneById.get(a.id);
                    if (al !== undefined && laneOk(r, d, al)) { lane = al; break; }
                }
                if (lane === null) {
                    lane = 0;
                    while (!laneOk(r, d, lane)) lane += 1;
                }
            }
            laneById.set(r.id, lane);
            take(d, lane, r.id);
            // Reserve the corridor of every straight (same-lane) arc into this
            // step, so no LATER chain inherits a lane through it. take() never
            // overwrites, so an in-chain bead already in the corridor keeps its
            // identity for later corridorOk checks.
            for (const a of sameEpicDepsOf(r)) {
                if (laneById.get(a.id) === lane) {
                    for (let dd = depthMemo.get(a.id) + 1; dd < d; dd++) {
                        take(dd, lane, RESERVED);
                    }
                }
            }
        }
        const sub = Math.max(1, ...steps.map((r) => laneById.get(r.id) + 1));
        const maxReqs = Math.max(1, ...steps.map((r) => (r.reqIds || []).length));
        // Lane pitch (zero-overlap contract, half 2): the vertical envelope of
        // one lane — step label above, bead, req ids below, then the reserved
        // title slot — never reaches the next lane's label.
        //
        // PER-LANE since req #3119. In 'vertical' mode a lane is as tall as ITS
        // OWN deepest requirement stack, not as tall as the band's. One 5-req
        // step used to set the pitch for every lane in its band: in the live
        // Substrate plan that made all nine lanes of "Swarm Substrate Rebuild"
        // 120px tall to accommodate step 1, when eight of them carry a single
        // requirement and need 72 — ~380px of dead vertical space in one band,
        // and the whole plan taller than the panel for no reason. 'horizontal'
        // keeps a constant pitch because its req ids sit on ONE line whatever
        // the count, so there is nothing lane-specific to measure.
        const laneReqs = new Map();
        for (const r of steps) {
            const lane = laneById.get(r.id);
            const n = (r.reqIds || []).length;
            if (n > (laneReqs.get(lane) || 0)) laneReqs.set(lane, n);
        }
        // The stagger costs one extra line per lane, and it is charged ONCE
        // because the two staggered things are mutually exclusive: in 'title'
        // mode the step label above the bead staggers and the title slot is not
        // drawn at all; in 'id' mode the label is a 4-digit id that never needed
        // the room and the title slot below staggers instead.
        const lanePitch = (lane) => (reqLayout === 'vertical'
            ? 58 + (Math.max(1, laneReqs.get(lane) || 1) - 1) * REQ_LINE_H
            : LANE_BASE_H) + TITLE_SLOT + STAGGER_GAP;
        // Cumulative lane tops, so a lane's y is the SUM of the lanes above it
        // rather than index × a single pitch. `laneY` is exported on the band:
        // every consumer that draws per-lane furniture (the visualizer's lane
        // wires) must use it or the wires detach from the beads.
        const laneY = [];
        {
            let acc = 0;
            for (let l = 0; l < sub; l++) { laneY.push(acc); acc += lanePitch(l); }
            laneY.push(acc); // sentinel: total lane height
        }
        // Retained for consumers that want a representative pitch; band height
        // now comes from laneY, never from sub × pitch.
        const pitch = lanePitch(0);
        // Bands hosting batch members take a taller header: the batch letter
        // lives in a reserved header strip (below the epic label, above lane
        // 0's step label) and the box top must clear the epic label — found in
        // review as an epic-label × batch-label collision on long epic titles.
        // The header also absorbs the stagger, but ONLY in title mode: lane 0's
        // step label is what gets LIFTED on odd columns (req #3119), and without
        // the extra line it rises into the epic label — and, in a band hosting a
        // batch, into the batch letter strip. Both collisions were caught by the
        // overlap invariant. In id mode nothing above the bead moves (the title
        // slot staggers DOWNWARD instead), so charging the header there would be
        // 14px of dead space per band in the default view.
        const headerH = BAND_HEADER + (staggerLabels ? STAGGER_GAP : 0)
            + (steps.some((r) => batchOf.has(r.id)) ? BATCH_HEADER_EXTRA : 0);
        bands.push({ ...band, steps, sub, maxReqs, pitch, laneY, laneReqs, headerH });
    }
    let y = 8;
    for (const band of bands) {
        band.y = y;
        band.height = band.headerH + band.laneY[band.sub];
        y += band.height + BAND_GAP;
    }
    const totalH = y + 8;

    // ── Node positions ──────────────────────────────────────────────────────
    const nodes = new Map();
    bands.forEach((band, bandIndex) => {
        for (const r of band.steps) {
            const d = depthMemo.get(r.id);
            nodes.set(r.id, {
                id: r.id,
                x: colX[d],
                y: band.y + band.headerH + band.laneY[laneById.get(r.id)] + 10,
                depth: d,
                lane: laneById.get(r.id),
                bandIndex,
            });
        }
    });

    // ── Dependency arcs: straight same-lane, cubic cross-lane (POC bend) ────
    const arcs = [];
    for (const r of safeRows) {
        for (const dId of depsOf(r)) {
            const a = nodes.get(dId);
            const b = nodes.get(r.id);
            if (!a || !b) continue;
            const x1 = a.x + BEAD_R + 1;
            const y1 = a.y;
            const x2 = b.x - BEAD_R - 1;
            const y2 = b.y;
            if (y1 === y2) {
                arcs.push({ fromId: dId, toId: r.id, straight: true, x1, y1, x2, y2 });
            } else {
                const bend = Math.min((colW[a.depth] || 110) * 0.9, Math.max(40, x2 - x1));
                const path = `M${x1},${y1} C${x1 + bend * 0.45},${y1} ${x1 + bend * 0.55},${y2} `
                    + `${x1 + bend},${y2} L${Math.max(x2, x1 + bend)},${y2}`;
                arcs.push({ fromId: dId, toId: r.id, straight: false, x1, y1, x2, y2, path });
            }
        }
    }

    // ── Launch-batch boxes (identical gate ⇒ identical column) ──────────────
    // One box SEGMENT per epic band the batch touches, not one tall rect: a
    // single rect spanning bands would also enclose whatever unrelated band
    // lies between two members (review finding) — a user would read a
    // non-member as launching in the batch. Segments share the letter and the
    // hover payload, so the launch unit stays one visible thing.
    const batchBoxes = [];
    for (const b of safeBatches) {
        const members = (b.stepIds || []).map((id) => nodes.get(id)).filter(Boolean);
        if (members.length < 2) continue;
        const d = members[0].depth;
        const w = Math.max((colW[d] || 110) - 8, 56);
        const x = members[0].x - w / 2;
        const byBand = new Map();
        for (const n of members) {
            if (!byBand.has(n.bandIndex)) byBand.set(n.bandIndex, []);
            byBand.get(n.bandIndex).push(n);
        }
        [...byBand.keys()].sort((p, q) => p - q).forEach((bandIndex, i) => {
            const ms = byBand.get(bandIndex);
            const yTop = Math.min(...ms.map((n) => n.y)) - 40;
            const yBot = Math.max(...ms.map((n) => {
                const row = byId.get(n.id);
                const nReqs = (row.reqIds || []).length;
                return n.y + (reqLayout === 'vertical'
                    ? 28 + Math.max(0, nReqs - 1) * REQ_LINE_H : 30);
            }));
            batchBoxes.push({
                letter: b.letter, stepIds: ms.map((n) => n.id),
                batchStepIds: b.stepIds, x, y: yTop,
                width: w, height: yBot - yTop,
                bandIndex, topSegment: i === 0,
            });
        });
    }

    // ── Label rectangles — every piece of text the canvas draws, as world
    // boxes, so the zero-overlap invariant is a testable property of THIS
    // module's output rather than a hope about the renderer.
    const labels = [];
    for (const r of safeRows) {
        const n = nodes.get(r.id);
        // A staggered title label is fitted to its budget (own column + a
        // bounded reach into each neighbour) and lifted one line on odd columns.
        const labelMax = staggerLabels
            ? Math.floor((staggerBudget(n.depth) - 8) / CHW)
            : STEP_LABEL_MAX;
        const label = stepLabelText(r, stepLabel, labelMax);
        const lw = label.length * CHW;
        labels.push({
            kind: 'step', stepId: r.id, text: label,
            x: n.x - lw / 2,
            y: n.y - 26 - (staggerLabels ? staggerOf(n.depth) : 0),
            w: lw, h: 12,
        });
        const ids = r.reqIds || [];
        if (reqLayout === 'horizontal') {
            const totalReqW = reqStr(r).length * CHW;
            let rx = n.x - totalReqW / 2;
            for (const reqId of ids) {
                const t = String(reqId);
                const w = t.length * CHW;
                labels.push({
                    kind: 'req', stepId: r.id, reqId, text: t,
                    x: rx, y: n.y + 14, w, h: 12,
                });
                rx += w + CHW; // one mono space between ids
            }
        } else {
            ids.forEach((reqId, i) => {
                const t = String(reqId);
                labels.push({
                    kind: 'req', stepId: r.id, reqId, text: t,
                    x: n.x - 15, y: n.y + 14 + i * REQ_LINE_H, w: t.length * CHW, h: 12,
                });
            });
        }
        // The reserved title slot (drawn at the 'in' zoom level, and skipped
        // when the step label already IS the title — it would duplicate).
        if (stepLabel !== 'title') {
            const band = bands[n.bandIndex];
            // Staggered too, and therefore budgeted the same way: the title may
            // reach into its neighbours because they draw on the other line.
            // Before req #3119 this was capped at the bare column width, which
            // is what cut plan titles to a few characters in narrow columns.
            const maxChars = Math.max(4, Math.floor((staggerBudget(n.depth) - 8) / CHW_TITLE));
            const t = truncate(r.title || '', maxChars);
            if (t) {
                // The slot clears THIS LANE's requirement stack — the same count
                // that sized the lane (req #3119). It used to clear the BAND's
                // deepest stack, which was equivalent only while every lane in a
                // band shared one pitch; with per-lane heights a one-req lane in
                // a five-req band had its title pushed 48px past its own lane
                // and straight onto the next lane's bead. Caught by the
                // label-vs-bead invariant, which is why that test exists.
                const laneN = Math.max(1, band.laneReqs.get(n.lane) || 1);
                const slotY = (reqLayout === 'vertical'
                    ? n.y + 14 + laneN * REQ_LINE_H + 2
                    : n.y + 28) + staggerOf(n.depth);
                labels.push({
                    kind: 'title', stepId: r.id, text: t,
                    x: n.x - (t.length * CHW_TITLE) / 2, y: slotY,
                    w: t.length * CHW_TITLE, h: 11,
                });
            }
        }
    }
    for (const band of bands) {
        labels.push({
            kind: 'epic', epicId: band.epicId, text: band.epic,
            x: 12, y: band.y + 6, w: band.epic.length * CHW_EPIC, h: 13,
        });
    }
    // Batch letters live in the reserved header strip of the top segment's
    // band — below the epic label (ends at band.y+19), above lane 0's step
    // label (starts at band.y + headerH − 16 = band.y + 40 with the extended
    // header) — so the letter can never collide with either, whatever the epic
    // title length. Letters sharing a band stagger rightward.
    const placedLetters = new Map(); // bandIndex -> [{x, w}]
    for (const box of batchBoxes) {
        if (!box.topSegment) continue;
        const text = `batch ${box.letter}`;
        const w = text.length * 6;
        const band = bands[box.bandIndex];
        let x = box.x + 5;
        const others = placedLetters.get(box.bandIndex) || [];
        let moved = true;
        while (moved) {
            moved = false;
            for (const o of others) {
                if (x < o.x + o.w + 8 && o.x < x + w + 8) {
                    x = o.x + o.w + 8;
                    moved = true;
                }
            }
        }
        others.push({ x, w });
        placedLetters.set(box.bandIndex, others);
        const y = band.y + 22;
        // A box whose top member sits below lane 0 leaves a gap between the
        // header-strip letter and the box; the leader is a dashed drop-line the
        // renderer draws from the letter to the box top so the association
        // stays readable (review finding: a 133px orphaned letter). Clamped
        // into the box's x-range for staggered letters.
        const leader = box.y - (y + 11) > 6
            ? {
                x1: x + 4, y1: y + 12,
                x2: Math.min(Math.max(x + 4, box.x + 6), box.x + box.width - 6),
                y2: box.y,
            }
            : null;
        labels.push({
            kind: 'batch', letter: box.letter, text,
            x, y, w, h: 11, leader,
        });
    }

    return {
        width: totalW,
        height: totalH,
        bands: bands.map(({ steps, ...b }) => ({ ...b, stepIds: steps.map((s) => s.id) })),
        nodes,
        arcs,
        batchBoxes,
        labels,
        colW,
        colX,
        reqLayout,
        stepLabel,
        empty: false,
    };
}

// Bead visual roles (POC vocabulary): fill/ring/width per state, manual ring,
// eligible-now ring. Kept here so the component and any test agree on one
// mapping. `eligible` wins the ring color (POC behavior); manual and eligible
// both draw the thick ring.
export function beadStyle(row, eligible) {
    const P = PLAN_VIZ_PALETTE;
    const done = row.state === STEP_DONE;
    const running = row.state === STEP_RUNNING;
    const fill = done ? P.doneFill : running ? P.runningFill : P.pendingFill;
    const baseRing = row.run === 'manual'
        ? P.manualRing
        : done ? P.doneRing : running ? P.runningRing : P.pendingRing;
    return {
        fill,
        ring: eligible ? P.eligibleRing : baseRing,
        ringWidth: row.run === 'manual' || eligible ? 2.5 : 1.5,
        pulse: running,
        check: done,
    };
}

export { STEP_DONE, STEP_RUNNING, STEP_PENDING };
