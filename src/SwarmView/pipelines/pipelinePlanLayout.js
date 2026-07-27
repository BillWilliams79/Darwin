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
const BAND_GAP = 8;
const LANE_BASE_H = 56;         // POC horizontal pitch, before the title slot
const TITLE_SLOT = 14;          // deviation 2 — reserved per-lane title line
const REQ_LINE_H = 12;          // vertical layout: one requirement id per line
const STEP_LABEL_MAX = 40;      // title label truncation above the bead
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
export function stepLabelText(row, stepLabel) {
    return stepLabel === 'title'
        ? truncate(row.title || `step ${row.id}`, STEP_LABEL_MAX)
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
    const colW = [];
    for (let d = 0; d <= maxD; d++) {
        const steps = colSteps[d] || [];
        const labelW = Math.max(0, ...steps.map((r) => stepLabelText(r, stepLabel).length * CHW + 16));
        let w;
        if (reqLayout === 'horizontal') {
            w = Math.max(64, labelW, ...steps.map((r) => reqStr(r).length * CHW + 30));
        } else {
            w = Math.max(70, labelW,
                ...steps.map((r) => Math.min(reqStr(r).length, 6) * CHW + 40));
        }
        colW.push(w);
    }
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
    const laneById = new Map();
    const bands = [];
    for (const key of bandKeys) {
        const band = bandByKey.get(key);
        const steps = [...band.steps].sort((a, b) =>
            (depthMemo.get(a.id) - depthMemo.get(b.id)) ||
            (batchOf.get(a.id) || '~').localeCompare(batchOf.get(b.id) || '~'));
        const used = new Map(); // depth -> Set(lane)
        const take = (d, lane) => {
            if (!used.has(d)) used.set(d, new Set());
            used.get(d).add(lane);
        };
        const free = (d, lane) => !(used.has(d) && used.get(d).has(lane));
        for (const r of steps) {
            const d = depthMemo.get(r.id);
            const sameEpicDeps = depsOf(r).map((x) => byId.get(x))
                .filter((a) => (a.epicId != null ? a.epicId : null) === key);
            let lane = null;
            for (const a of sameEpicDeps) {
                const al = laneById.get(a.id);
                if (al !== undefined && free(d, al)) { lane = al; break; }
            }
            if (lane === null) {
                lane = 0;
                while (!free(d, lane)) lane += 1;
            }
            laneById.set(r.id, lane);
            take(d, lane);
            // Reservation: the chain's lane is held across every column the arc
            // spans, so nothing else is placed on the arc's path.
            for (const a of sameEpicDeps) {
                if (laneById.get(a.id) === lane) {
                    for (let dd = depthMemo.get(a.id) + 1; dd < d; dd++) take(dd, lane);
                }
            }
        }
        const sub = Math.max(1, ...steps.map((r) => laneById.get(r.id) + 1));
        const maxReqs = Math.max(1, ...steps.map((r) => (r.reqIds || []).length));
        // Lane pitch (zero-overlap contract, half 2): the vertical envelope of
        // one lane — step label above, bead, req ids below, then the reserved
        // title slot — never reaches the next lane's label.
        const pitch = (reqLayout === 'vertical'
            ? 58 + (maxReqs - 1) * REQ_LINE_H
            : LANE_BASE_H) + TITLE_SLOT;
        bands.push({ ...band, steps, sub, maxReqs, pitch });
    }
    let y = 8;
    for (const band of bands) {
        band.y = y;
        band.height = BAND_HEADER + band.sub * band.pitch;
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
                y: band.y + BAND_HEADER + laneById.get(r.id) * band.pitch + 10,
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
    const batchBoxes = [];
    for (const b of safeBatches) {
        const members = (b.stepIds || []).map((id) => nodes.get(id)).filter(Boolean);
        if (members.length < 2) continue;
        const d = members[0].depth;
        const w = Math.max((colW[d] || 110) - 8, 56);
        const x = members[0].x - w / 2;
        const yTop = Math.min(...members.map((n) => n.y)) - 40;
        const yBot = Math.max(...members.map((n) => {
            const row = byId.get(n.id);
            const nReqs = (row.reqIds || []).length;
            return n.y + (reqLayout === 'vertical'
                ? 28 + Math.max(0, nReqs - 1) * REQ_LINE_H : 30);
        }));
        batchBoxes.push({
            letter: b.letter, stepIds: b.stepIds, x, y: yTop,
            width: w, height: yBot - yTop,
        });
    }

    // ── Label rectangles — every piece of text the canvas draws, as world
    // boxes, so the zero-overlap invariant is a testable property of THIS
    // module's output rather than a hope about the renderer.
    const labels = [];
    for (const r of safeRows) {
        const n = nodes.get(r.id);
        const label = stepLabelText(r, stepLabel);
        const lw = label.length * CHW;
        labels.push({
            kind: 'step', stepId: r.id, text: label,
            x: n.x - lw / 2, y: n.y - 26, w: lw, h: 12,
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
            const maxChars = Math.max(4, Math.floor((colW[n.depth] - 8) / CHW_TITLE));
            const t = truncate(r.title || '', maxChars);
            if (t) {
                const slotY = reqLayout === 'vertical'
                    ? n.y + 14 + band.maxReqs * REQ_LINE_H + 2
                    : n.y + 28;
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
    for (const box of batchBoxes) {
        labels.push({
            kind: 'batch', letter: box.letter, text: `batch ${box.letter}`,
            x: box.x + 5, y: box.y + 3, w: `batch ${box.letter}`.length * 6, h: 11,
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
