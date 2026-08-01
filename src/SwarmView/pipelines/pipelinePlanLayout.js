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
//     DERIVED-START order since req #3201: earliest-starting epic on top,
//     never-started epics last, epic id ascending as the tie-break. (Was
//     first-appearance over display order, which had two problems: it made a
//     band's position move whenever a step was appended, and it said nothing at
//     all about time.)
//   - TIME-SLOT columns left-to-right (req #3201). A column is a position on a
//     calendar proxy, no longer raw dependency depth — see the block comment
//     above `computeTimeColumns` for the whole model. Dependency depth survives
//     as the HARD FLOOR: a step's column is never less than 1 + the maximum of
//     its dependencies', so every arc still points forward.
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
//   - Launch-batch dashed boxes around batch-mates (identical epic + remaining
//     gate + run + machines — the engine's launchKey), drawn as ONE SEGMENT PER
//     (BAND, COLUMN). Both axes matter and for different reasons. Since req
//     #3188 the key carries the dominant epic — the same field these bands are
//     keyed on — so an ENGINE-PRODUCED box always sits in exactly one BAND; that
//     segmentation stays as a tested defence, because this module takes rows and
//     batches as arguments and cannot know they were derived together. The
//     COLUMN axis is the live one: #3188 also keys on the REMAINING gate, so a
//     step gated by an already-Complete dep and a gate-less step are one launch
//     unit at different dependency depths. A rect spanning either axis would
//     enclose a non-member, which is the review finding this shape exists for.
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
// Type scale (user directive 2026-07-31): step label +50%, requirement ids
// +25%, epic label +25% over the POC's font-11/12 base. Char-width metrics
// scale linearly with font size (mono: ~0.609 px/pt per char) — they MUST move
// with PLAN_VIZ_FONT or the zero-overlap contract silently rots.
const CHW_LABEL = 10.05;        // px per mono char at font 16.5 (step label)
const CHW_REQ = 8.4;            // px per mono char at font 13.75 (req ids)
const CHW_TITLE = 5.8;          // px per mono char at font 9.5 (the title slot)
export const CHW_EPIC = 9.15;   // px per mono char at font 15 (epic band label)
const BEAD_R = 10;
const BAND_HEADER = 46;         // deviation 1 (POC 34) + type-scale headroom
const BATCH_HEADER_EXTRA = 16;  // extra header for bands hosting batch members:
                                // reserves the letter strip + keeps box tops
                                // below the epic label (review finding)
const BAND_GAP = 8;
const LANE_BASE_H = 62;         // POC 56 + type-scale headroom, before the title slot
const TITLE_SLOT = 14;          // deviation 2 — reserved per-lane title line
const REQ_LINE_H = 15;          // vertical layout: one req id per line at font 13.75
const STEP_LABEL_MAX = 60;      // hard ceiling on a title label above the bead
// Staggering (req #3119, the Build Visualizer's version-label pattern —
// `d3LayoutEngine.js` offsets every odd build by `versionLaneGap`). Odd columns
// draw their long text one line further from the bead, so a label and its
// left/right neighbours are never on the same line and each may overflow its own
// column. Only the SAME-PARITY columns (d±2) share a line, and the budget below
// keeps two of those from meeting.
const STAGGER_GAP = 18;
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
const TITLE_COL_MIN = 144;
export const PLAN_VIZ_FONT = {
    label: 16.5, req: 13.75, title: 9.5, epic: 15, batch: 10, check: 9,
};

export const BEAD_RADIUS = BEAD_R;

// ── The time axis (req #3201) ───────────────────────────────────────────────
// Sentinel slot prefixes. Sorting the composed keys lexicographically IS the
// chronological order: '0' < '1' < '2', and ISO days sort as strings.
const SLOT_UNKNOWN = '0:unknown';
const SLOT_FUTURE = '2:future';
const slotOfDay = (at) => `1:${String(at).slice(0, 10)}`;

// Comparable rank for a step's derived start. UNKNOWN sorts BEFORE every date
// and FUTURE AFTER every date, which is what makes the monotone max below mean
// "the latest thing this step is downstream of".
const TIME_RANK = { unknown: 0, dated: 1, future: 2 };
const rankOf = (t) => TIME_RANK[t && t.kind] || 0;
function timeCmp(a, b) {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== rb) return ra - rb;
    const xa = (a && a.at) || '';
    const xb = (b && b.at) || '';
    return xa === xb ? 0 : (xa < xb ? -1 : 1);
}

/**
 * Turn derived START TIMES into COLUMNS, with dependency depth as a hard floor.
 *
 * The axis is a sequence of TIME SLOTS: one leading slot for steps whose start
 * is UNKNOWN, one per distinct calendar DAY that carries work, and one trailing
 * slot for steps that have positively not begun. Day granularity is a choice: a
 * slot per distinct timestamp degenerates the drawing into a one-step-per-column
 * diagonal and hides every bit of parallelism, while a slot per day puts the
 * work of one day side by side, which is how the plan is actually read.
 *
 * Four steps, and the order matters:
 *
 * 1. **Monotonize.** A step's effective time is `max(its own, every
 *    dependency's)`. A step cannot begin before its gate; where the stored
 *    timestamps disagree — and they DO, twice, in live pipeline 2 — the gate
 *    wins. This is the same "topology outranks presentation" ruling design rule
 *    3 makes, applied to the DATA so that step 4 below needs no special case.
 *    It also resolves UNKNOWN for free: a req-less step inherits the time of the
 *    work it gates, exactly as it already inherits that work's epic label.
 * 2. **Local depth.** Inside one slot, a step's offset is its dependency depth
 *    counting only same-slot dependencies. A chain done in one day reads as
 *    consecutive columns.
 * 3. **Origins.** `origin[k] = Σ (span[i] + 1)` over earlier slots, where
 *    `span[i]` is slot i's deepest local chain. Every slot therefore starts at
 *    least one column past the last column any earlier slot can reach.
 * 4. **Columns.** `col(r) = max(origin[slot] + localDepth, 1 + max col(deps))`.
 *
 * TWO PROPERTIES FALL OUT, and both are asserted in the tests:
 *
 * - **Every arc points forward**, unconditionally, from the second term. No
 *   step can render left of something it depends on because a date said so —
 *   the constraint this requirement was told not to break.
 * - **Slot k renders strictly right of slot j < k.** Proof: by induction, a
 *   same-slot dep contributes `1 + col(d) ≤ origin[k] + localDepth(r)`, and an
 *   earlier-slot dep contributes `1 + col(d) ≤ origin[j] + span[j] + 1 ≤
 *   origin[k]`. Step 1 is what guarantees there is no LATER-slot dep to break
 *   the induction. So a never-started epic renders right of every started one
 *   with no synthetic dependency edge anywhere.
 *
 * DEGENERATE CASE, and it is the reason there is no second code path: with no
 * time axis supplied every step is UNKNOWN, so there is ONE slot, local depth is
 * global dependency depth and `col` is exactly the pre-#3201 depth column.
 *
 * @param {Object[]} rows                 PlanRows
 * @param {Map<number, Object>} byId
 * @param {(r: Object) => number[]} depsOf  in-set dependency ids
 * @param {?Object} timeAxis              planTimeAxis() output, or null
 * @returns {{colOf: Map<number, number>, maxCol: number,
 *            slotKeys: string[], slotOf: Map<number, number>,
 *            origins: number[], spans: number[]}}
 */
export function computeTimeColumns(rows, byId, depsOf, timeAxis) {
    const starts = (timeAxis && timeAxis.stepStarts) || new Map();
    const own = (r) => starts.get(r.id) || { at: null, kind: 'unknown' };

    // 1. Monotonize along the dep graph.
    const effMemo = new Map();
    const eff = (r) => {
        if (effMemo.has(r.id)) return effMemo.get(r.id);
        effMemo.set(r.id, own(r)); // cycle guard — a cycle keeps its own time
        let best = own(r);
        for (const d of depsOf(r)) {
            const up = eff(byId.get(d));
            if (timeCmp(up, best) > 0) best = up;
        }
        effMemo.set(r.id, best);
        return best;
    };
    const slotKeyOf = (r) => {
        const t = eff(r);
        if (t.kind === 'dated' && t.at) return slotOfDay(t.at);
        return t.kind === 'future' ? SLOT_FUTURE : SLOT_UNKNOWN;
    };
    // UNKNOWN GETS NO SLOT OF ITS OWN when any dated slot exists (review
    // finding). A dedicated leading slot put every UNKNOWN step one column
    // LEFT of all dated work — "earlier than everything", which is precisely
    // the claim UNKNOWN means we cannot make, and the opposite of this
    // module's own rule that topology alone should place it. Sharing the
    // EARLIEST dated slot gives it the weakest lower bound there is (that
    // slot's origin is 0), so its column comes from its dependencies and
    // nothing else. It keeps a slot of its own only when there is no dated
    // slot to share — otherwise it would fall into FUTURE, which is a claim
    // in the other direction.
    const rawKeys = new Set(rows.map(slotKeyOf));
    const hasUnknown = rawKeys.delete(SLOT_UNKNOWN);
    const slotKeys = [...rawKeys].sort();
    if (hasUnknown && (slotKeys.length === 0 || slotKeys[0] === SLOT_FUTURE)) {
        slotKeys.unshift(SLOT_UNKNOWN);
    }
    const slotIndex = new Map(slotKeys.map((k, i) => [k, i]));
    const slotFor = (r) => {
        const k = slotKeyOf(r);
        const i = slotIndex.get(k);
        return i === undefined ? 0 : i;   // UNKNOWN folded into the first slot
    };
    const slotOf = new Map(rows.map((r) => [r.id, slotFor(r)]));

    // 2. Local depth, counting only same-slot dependencies.
    const ldMemo = new Map();
    const slotIdx = (id) => {
        const i = slotOf.get(id);
        return i === undefined ? 0 : i;   // a caller's byId may exceed rows
    };
    const ld = (r) => {
        if (ldMemo.has(r.id)) return ldMemo.get(r.id);
        ldMemo.set(r.id, 0); // cycle guard
        const v = 1 + Math.max(-1, ...depsOf(r)
            .filter((d) => slotIdx(d) === slotIdx(r.id))
            .map((d) => ld(byId.get(d))));
        ldMemo.set(r.id, v);
        return v;
    };
    rows.forEach(ld);

    // 3. Slot spans and cumulative origins.
    const spans = slotKeys.map(() => 0);
    for (const r of rows) {
        const k = slotIdx(r.id);
        if (ldMemo.get(r.id) > spans[k]) spans[k] = ldMemo.get(r.id);
    }
    const origins = [];
    {
        let acc = 0;
        for (let k = 0; k < slotKeys.length; k++) { origins.push(acc); acc += spans[k] + 1; }
    }

    // 4. Columns — the time position, floored by topology.
    const colOf = new Map();
    const col = (r) => {
        if (colOf.has(r.id)) return colOf.get(r.id);
        colOf.set(r.id, 0); // cycle guard — a cycle collapses toward column 0
        const v = Math.max(origins[slotIdx(r.id)] + ldMemo.get(r.id),
            ...depsOf(r).map((d) => 1 + col(byId.get(d))));
        colOf.set(r.id, v);
        return v;
    };
    rows.forEach(col);
    const maxCol = Math.max(0, ...rows.map((r) => colOf.get(r.id)));
    return { colOf, maxCol, slotKeys, slotOf, origins, spans };
}

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
 * @param {Object[]} rows      engine PlanRows, DISPLAY order (steps sort within
 *                             a band by column, so pass displayOrder output)
 * @param {Object[]} batches   engine LaunchBatch[] (launchBatches output)
 * @param {Object} [opts]
 * @param {('horizontal'|'vertical')} [opts.reqLayout]
 * @param {('id'|'title')} [opts.stepLabel]
 * @param {?Object} [opts.timeAxis]  planTimeAxis() output (req #3201). Omitted,
 *                             the axis degenerates to pure dependency depth and
 *                             bands stack by epic id — see computeTimeColumns.
 * @returns {Object} layout — see the shape assembled at the bottom
 */
export function computePlanLayout(rows, batches, {
    reqLayout = 'horizontal', stepLabel = 'id', timeAxis = null,
} = {}) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const safeBatches = Array.isArray(batches) ? batches : [];
    if (safeRows.length === 0) {
        return {
            width: MIN_WORLD_W, height: 120, bands: [], nodes: new Map(),
            arcs: [], batchBoxes: [], labels: [], colW: [], colX: [],
            slots: [], slotOf: new Map(), reqLayout, stepLabel, empty: true,
        };
    }

    const byId = new Map(safeRows.map((r) => [r.id, r]));
    const depsOf = (r) => (r.depIds || []).filter((d) => byId.has(d));

    // ── Time-slot columns, floored by dependency depth (req #3201) ──────────
    const { colOf, maxCol, slotKeys, slotOf, origins: slotOrigins } =
        computeTimeColumns(safeRows, byId, depsOf, timeAxis);

    // ── Column widths (the zero-overlap contract, half 1) ───────────────────
    // A column is as wide as the widest thing DRAWN in it: the one-line req-id
    // string (horizontal) or the widest single id (vertical), and the step
    // label — id or truncated title — in either mode.
    const colSteps = [];
    for (const r of safeRows) {
        const d = colOf.get(r.id);
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
    for (let d = 0; d <= maxCol; d++) {
        const steps = colSteps[d] || [];
        const labelW = staggerLabels ? TITLE_COL_MIN
            : Math.max(0, ...steps.map((r) => stepLabelText(r, stepLabel).length * CHW_LABEL + 16));
        let w;
        if (reqLayout === 'horizontal') {
            w = Math.max(64, labelW, ...steps.map((r) => reqStr(r).length * CHW_REQ + 30));
        } else {
            w = Math.max(70, labelW,
                ...steps.map((r) => Math.min(reqStr(r).length, 6) * CHW_REQ + 40));
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
        const right = d < maxCol ? colW[d + 1] : RIGHT + 40;
        return colW[d] + 2 * STAGGER_REACH * Math.min(left, right);
    };
    const staggerOf = (d) => (d % 2) * STAGGER_GAP;
    const colX = [];
    {
        let acc = LEFT;
        for (let d = 0; d <= maxCol; d++) {
            colX.push(acc + colW[d] / 2);
            acc += colW[d];
        }
    }
    const totalW = Math.max(MIN_WORLD_W, colX[maxCol] + colW[maxCol] / 2 + RIGHT + 40);

    // ── Epic bands (dominant label), stacked by DERIVED START (req #3201) ───
    // The vertical axis reads as time too: the epic whose work began first sits
    // on top. An epic's start is the minimum over its requirements — there is no
    // `epics.started_at` and design rule 1 says there never will be — and
    // `pipelinePlanTime.js` owns the derivation, including the ruling that a
    // requirement which completed without ever being stamped `started_at`
    // counts as started.
    //
    // THREE TIERS, then tie-breaks, stated rather than left to sort stability:
    //   1. `dated`   — sort ascending on the derived start;
    //   2. `unknown` — no start, but evidence of work whose timing was never
    //                  recorded. A NULL start alone used to mean both this and
    //                  tier 3, which let a pure BACKLOG epic stack above an
    //                  ACTIVE one on an id tie-break (review finding);
    //   3. `future`  — every step positively has not begun. Sorts LAST.
    // Within a tier: EPIC ID ascending, the label-less "No epic" band last of
    // all. Id rather than first appearance on purpose — first appearance moved
    // a band down the stack whenever a step was appended to another epic, a
    // documented wart of the old rule, and it carried no time meaning.
    const bandStarts = (timeAxis && timeAxis.bandStarts) || new Map();
    const bandKinds = (timeAxis && timeAxis.bandKinds) || new Map();
    const BAND_TIER = { dated: 0, unknown: 1, future: 2 };
    const bandTierOf = (key) => {
        const t = BAND_TIER[bandKinds.get(key)];
        return t === undefined ? BAND_TIER.future : t;
    };
    const bandKeys = [];
    const bandByKey = new Map();
    for (const r of safeRows) {
        const key = r.epicId != null ? r.epicId : null;
        if (!bandByKey.has(key)) {
            bandByKey.set(key, { key, epicId: key, epic: r.epic || 'No epic', steps: [] });
            bandKeys.push(key);
        }
        bandByKey.get(key).steps.push(r);
    }
    const bandStartOf = (key) => {
        const v = bandStarts.get(key);
        return v == null ? null : String(v);
    };
    bandKeys.sort((a, b) => {
        const ta = bandTierOf(a);
        const tb = bandTierOf(b);
        if (ta !== tb) return ta - tb;
        const sa = bandStartOf(a);
        const sb = bandStartOf(b);
        if ((sa === null) !== (sb === null)) return sa === null ? 1 : -1;
        if (sa !== null && sa !== sb) return sa < sb ? -1 : 1;
        if (a === b) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        return a < b ? -1 : 1;
    });
    // Colour AFTER the sort: the palette cycles on the band's position in the
    // stack, so assigning at discovery time would hand two adjacent bands the
    // same hue once the order stopped being discovery order.
    bandKeys.forEach((key, i) => {
        bandByKey.get(key).color = EPIC_PALETTE[i % EPIC_PALETTE.length];
    });

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
    const bandUsed = [];       // bandIndex -> the band's cell map (kept for arc routing)
    const RESERVED = Symbol('reserved');
    for (const key of bandKeys) {
        const band = bandByKey.get(key);
        const steps = [...band.steps].sort((a, b) =>
            (colOf.get(a.id) - colOf.get(b.id)) ||
            ((batchOf.has(a.id) ? 0 : 1) - (batchOf.has(b.id) ? 0 : 1)) ||
            String(batchOf.get(a.id) || '').localeCompare(String(batchOf.get(b.id) || '')));
        const used = new Map(); // depth -> Map(lane -> step id | RESERVED)
        const laneBeads = new Map(); // lane -> [{id, d}] — real beads only
        const take = (d, lane, occupant) => {
            if (!used.has(d)) used.set(d, new Map());
            const cells = used.get(d);
            if (!cells.has(lane)) {
                cells.set(lane, occupant);
                if (occupant !== RESERVED) {
                    if (!laneBeads.has(lane)) laneBeads.set(lane, []);
                    laneBeads.get(lane).push({ id: occupant, d });
                }
            }
        };
        const occupant = (d, lane) =>
            (used.has(d) ? used.get(d).get(lane) : undefined);
        const free = (d, lane) => occupant(d, lane) === undefined;
        const corridorOk = (a, r, lane) => {
            for (let dd = colOf.get(a.id) + 1; dd < colOf.get(r.id); dd++) {
                const o = occupant(dd, lane);
                if (o === undefined) continue;
                if (o === RESERVED) return false;
                if (!(reach(o).has(a.id) && reach(r.id).has(o))) return false;
            }
            return true;
        };
        const sameEpicDepsOf = (r) => depsOf(r).map((x) => byId.get(x))
            .filter((a) => (a.epicId != null ? a.epicId : null) === key);
        // Same-band dependents, for the corridor-aware placement check below.
        const dependentsInBand = new Map(); // id -> [dependent ids]
        for (const r of steps) {
            for (const a of sameEpicDepsOf(r)) {
                if (!dependentsInBand.has(a.id)) dependentsInBand.set(a.id, []);
                dependentsInBand.get(a.id).push(r.id);
            }
        }
        // A lane is usable only if (1) the cell is free, (2) every same-lane
        // dependency arc into it crosses only in-chain beads, and (3) — the
        // corridor-aware rule (user directive, epic #6 plan) — no shallower
        // bead already on the lane still owes an arc PAST this column to a
        // deeper same-band dependent: parking here would sit this bead on that
        // arc's horizontal run (the 50-under-49 spaghetti). Exempt when the
        // shallower bead is one of r's own deps (r continues that chain — the
        // arc anchors elsewhere or reroutes) or when r is in-chain between the
        // two ends.
        const laneOk = (r, d, lane) => {
            if (!free(d, lane)) return false;
            for (const a of sameEpicDepsOf(r)) {
                const al = laneById.get(a.id);
                if (al === lane && !corridorOk(a, r, lane)) {
                    return false;
                }
                // Cross-lane dep: the arc will need EITHER its source-lane
                // corridor (late bend) or this candidate lane's corridor
                // (early bend). If both are already blocked, any drawing of
                // the arc runs over an unrelated bead — reject the lane and
                // let dep-adjacent insertion open a clean one. (Found live:
                // a two-dep step parked where one dep's arc had no clear
                // corridor on either lane and overdrew two beads.)
                if (al !== undefined && al !== lane
                    && !corridorOk(a, r, al) && !corridorOk(a, r, lane)) {
                    return false;
                }
            }
            const rDeps = new Set(depsOf(r));
            for (const { id: sid, d: ds } of laneBeads.get(lane) || []) {
                if (ds >= d || rDeps.has(sid)) continue;
                for (const tid of dependentsInBand.get(sid) || []) {
                    if (tid === r.id) continue;
                    if (colOf.get(tid) <= d) continue;
                    if (reach(r.id).has(sid) && reach(tid).has(r.id)) continue;
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
            const d = colOf.get(r.id);
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
                    // Dep-adjacent lane INSERTION (user directive, epic #6 plan
                    // image review): when every anchored lane is occupied or
                    // corridor-blocked, a branch step opens a FRESH lane
                    // directly below its parent instead of scanning downward
                    // past every reserved corridor — the scan banished the
                    // branch below unrelated roots and its dependency arc then
                    // dove across all of their outgoing corridors. Lanes are
                    // fractional during placement (0.5 sits between 0 and 1)
                    // and renumbered ordinally at band close, so a fresh value
                    // carries no cells, no corridors, and always places.
                    const anchors = sameEpicDepsOf(r)
                        .map((a) => laneById.get(a.id))
                        .filter((v) => v !== undefined);
                    if (anchors.length > 0) {
                        const al = Math.min(...anchors);
                        const below = [...laneBeads.keys()]
                            .filter((v) => v > al)
                            .sort((p, q) => p - q)[0];
                        lane = below === undefined ? al + 1 : (al + below) / 2;
                    } else {
                        lane = 0;
                        while (!laneOk(r, d, lane)) lane += 1;
                    }
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
                    for (let dd = colOf.get(a.id) + 1; dd < d; dd++) {
                        take(dd, lane, RESERVED);
                    }
                }
            }
        }
        // Ordinal renumber: fractional inserted lanes become whole rows here.
        // Everything downstream — bandUsed (arc-corridor checks), laneReqs,
        // laneY, node positions — speaks the renumbered values, so the
        // fractions never escape this loop.
        const laneVals = [...new Set(steps.map((r) => laneById.get(r.id)))].sort((p, q) => p - q);
        const laneRemap = new Map(laneVals.map((v, i) => [v, i]));
        for (const r of steps) laneById.set(r.id, laneRemap.get(laneById.get(r.id)));
        for (const [dd, cells] of used) {
            const remapped = new Map();
            for (const [lv, occ] of cells) {
                remapped.set(laneRemap.has(lv) ? laneRemap.get(lv) : lv, occ);
            }
            used.set(dd, remapped);
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
            ? 64 + (Math.max(1, laneReqs.get(lane) || 1) - 1) * REQ_LINE_H
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
        bandUsed.push(used);
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
            const d = colOf.get(r.id);
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

    // ── Dependency arcs: straight same-lane, cubic cross-lane ───────────────
    // Cross-lane routing is ADAPTIVE (user directive, epic #6 plan — "less
    // crossover"). The POC bent EARLY: the arc joined the DESTINATION lane's y
    // right after the source column and ran horizontally through every
    // intermediate column at that height — straight through any bead parked on
    // the destination lane (the convergence into a penultimate step overdrew
    // the whole main chain). Now an arc runs the horizontal on its SOURCE lane
    // and dives just before the destination column (LATE bend) whenever that
    // corridor is clear of unrelated beads and reservations; if only the
    // destination-lane corridor is clear it bends early as before; if neither
    // is clear, early is the fallback. Corridor-aware PLACEMENT (laneOk above)
    // keeps source corridors clear in the common case, so late is the norm.
    const corridorClear = (bandIndex, lane, dFrom, dTo, aId, rId) => {
        const used = bandUsed[bandIndex];
        if (!used) return true;
        for (let dd = dFrom + 1; dd < dTo; dd++) {
            const o = used.has(dd) ? used.get(dd).get(lane) : undefined;
            if (o === undefined) continue;
            if (o === RESERVED) return false;
            if (!(reach(o).has(aId) && reach(rId).has(o))) return false;
        }
        return true;
    };
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
                arcs.push({ fromId: dId, toId: r.id, straight: true, route: 'straight', x1, y1, x2, y2 });
                continue;
            }
            const sameBand = a.bandIndex === b.bandIndex;
            const late = sameBand
                && corridorClear(a.bandIndex, a.lane, a.depth, b.depth, dId, r.id);
            let path;
            if (late) {
                const bend = Math.min((colW[b.depth] || 110) * 0.9, Math.max(40, x2 - x1));
                const xb = Math.max(x1, x2 - bend);
                path = `M${x1},${y1} L${xb},${y1} C${xb + bend * 0.45},${y1} `
                    + `${xb + bend * 0.55},${y2} ${x2},${y2}`;
            } else {
                const bend = Math.min((colW[a.depth] || 110) * 0.9, Math.max(40, x2 - x1));
                path = `M${x1},${y1} C${x1 + bend * 0.45},${y1} ${x1 + bend * 0.55},${y2} `
                    + `${x1 + bend},${y2} L${Math.max(x2, x1 + bend)},${y2}`;
            }
            arcs.push({
                fromId: dId, toId: r.id, straight: false,
                route: late ? 'late' : 'early', x1, y1, x2, y2, path,
            });
        }
    }

    // ── Launch-batch boxes ─────────────────────────────────────────────────
    // One box SEGMENT per (epic band, column) the batch touches, not one rect:
    // a single rect spanning either axis also encloses whatever unrelated band
    // or column lies between two members (review finding) — a user would read a
    // non-member as launching in the batch. Segments share the letter and the
    // hover payload, so the launch unit stays one visible thing.
    //
    // Since req #3188 an engine-produced batch cannot span BANDS (the launch key
    // and the band key are both the dominant epic); that half is kept as a
    // DEFENCE on an argument this module does not derive — see the module
    // header. The COLUMN half is live and reachable: #3188 keys on the remaining
    // gate, so batch-mates legitimately sit at different dependency depths.
    const batchBoxes = [];
    for (const b of safeBatches) {
        const members = (b.stepIds || []).map((id) => nodes.get(id)).filter(Boolean);
        if (members.length < 2) continue;
        // ONE SEGMENT PER (BAND, COLUMN) — req #3188 made the column half of that
        // load-bearing, and getting it wrong is the SAME defect the band half was
        // built for, on the other axis. Until #3188 batch-mates shared a raw dep
        // set, so they shared a depth, so one column and one x/width for the
        // whole batch was sound. Now they share the REMAINING gate: a step gated
        // by an already-Complete dep and a step with no gate at all are one
        // launch unit at DIFFERENT depths. Measured on the corpus's own
        // `batch-groups-on-remaining-gate` case — batch A is [3, 5, 2] with 3
        // and 5 at depth 0 and 2 at depth 1 — a single-column box left member 2
        // outside it and enclosed the unrelated Complete step 1.
        const byCell = new Map();
        for (const n of members) {
            const cell = `${n.bandIndex}|${n.depth}`;
            if (!byCell.has(cell)) byCell.set(cell, []);
            byCell.get(cell).push(n);
        }
        // Band first, then column: the letter goes on the FIRST segment, and the
        // plan reads top-to-bottom before left-to-right.
        const cells = [...byCell.keys()].sort((p, q) => {
            const [pb, pd] = p.split('|').map(Number);
            const [qb, qd] = q.split('|').map(Number);
            return (pb - qb) || (pd - qd);
        });
        for (const cell of cells) {
            const ms = byCell.get(cell);
            const [bandIndex, depth] = cell.split('|').map(Number);
            const w = Math.max((colW[depth] || 110) - 8, 56);
            const yTop = Math.min(...ms.map((n) => n.y)) - 40;
            const yBot = Math.max(...ms.map((n) => {
                const row = byId.get(n.id);
                const nReqs = (row.reqIds || []).length;
                return n.y + (reqLayout === 'vertical'
                    ? 28 + Math.max(0, nReqs - 1) * REQ_LINE_H : 30);
            }));
            batchBoxes.push({
                letter: b.letter, stepIds: ms.map((n) => n.id),
                batchStepIds: b.stepIds, x: ms[0].x - w / 2, y: yTop,
                width: w, height: yBot - yTop,
                // `(bandIndex, depth)` identifies the segment — the renderer's
                // React key, since `letter` alone stopped being unique per box
                // when a batch acquired more than one segment (req #3188).
                bandIndex, depth,
            });
        }
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
            ? Math.floor((staggerBudget(n.depth) - 8) / CHW_LABEL)
            : STEP_LABEL_MAX;
        const label = stepLabelText(r, stepLabel, labelMax);
        const lw = label.length * CHW_LABEL;
        labels.push({
            kind: 'step', stepId: r.id, text: label,
            x: n.x - lw / 2,
            y: n.y - 31 - (staggerLabels ? staggerOf(n.depth) : 0),
            w: lw, h: 17,
        });
        const ids = r.reqIds || [];
        if (reqLayout === 'horizontal') {
            const totalReqW = reqStr(r).length * CHW_REQ;
            let rx = n.x - totalReqW / 2;
            for (const reqId of ids) {
                const t = String(reqId);
                const w = t.length * CHW_REQ;
                labels.push({
                    kind: 'req', stepId: r.id, reqId, text: t,
                    x: rx, y: n.y + 14, w, h: 14,
                });
                rx += w + CHW_REQ; // one mono space between ids
            }
        } else {
            ids.forEach((reqId, i) => {
                const t = String(reqId);
                labels.push({
                    kind: 'req', stepId: r.id, reqId, text: t,
                    x: n.x - 15, y: n.y + 14 + i * REQ_LINE_H, w: t.length * CHW_REQ, h: 14,
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
                    : n.y + 30) + staggerOf(n.depth);
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
            x: 12, y: band.y + 6, w: band.epic.length * CHW_EPIC, h: 16,
        });
    }
    // Batch letters live in the reserved header strip of a segment's band —
    // below the epic label (ends at band.y+19), above lane 0's step label
    // (starts at band.y + headerH − 16 = band.y + 40 with the extended header)
    // — so the letter can never collide with either, whatever the epic title
    // length. Letters sharing a band stagger rightward.
    //
    // EVERY SEGMENT IS LABELLED, not just the first (req #3188). While a batch
    // could only segment across BANDS — which the engine can no longer produce
    // at all — one letter for the whole batch read as one launch unit stacked
    // vertically. Column segments sit SIDE BY SIDE and are reachable on any plan
    // where mates share only their remaining gate, and an unlabelled dashed box
    // beside a labelled one reads as a second, anonymous batch. Repeating
    // "batch A" is the honest rendering: both boxes ARE batch A. The stagger
    // loop already keeps two letters in one band apart, and segments in
    // different columns start far enough apart that it rarely has to.
    const placedLetters = new Map(); // bandIndex -> [{x, w}]
    for (const box of batchBoxes) {
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
        const y = band.y + 26;
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
        // The time axis as GEOMETRY (req #3201): the ordered slots and the
        // column each one starts at. Exported so the axis is assertable from
        // this module's output — "slot k begins right of everything in slot
        // k-1" is the property the whole design rests on, and a test that
        // re-derives it from the input would be a second implementation.
        slots: slotKeys.map((key, i) => ({
            key,
            kind: key === SLOT_UNKNOWN ? 'unknown' : key === SLOT_FUTURE ? 'future' : 'dated',
            day: key === SLOT_UNKNOWN || key === SLOT_FUTURE ? null : key.slice(2),
            origin: slotOrigins[i],
        })),
        slotOf,
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

// ── Epic focus geometry (req #3204) ─────────────────────────────────────────
// Clicking an epic's name fits that epic's steps to the viewport. This is pure
// geometry over a layout that is already computed, so it lives beside the
// layout rather than in the component: the component's job is to hand the
// resulting {x, y, k} to the d3-zoom BEHAVIOR, and nothing else.
//
// IT IS NOT A MODE. Nothing here is remembered — the two functions below take
// a band and return a transform, and the caller retains neither.

// Margin left on all four sides, in SCREEN px. Screen, not world: it is
// subtracted from the viewport BEFORE the scale is chosen, so the whitespace is
// the same handful of pixels whether the fit lands at k=0.2 or k=2. A world-space
// pad would shrink to nothing on a wide epic and swallow the view on a narrow one.
export const FOCUS_PAD = 44;
// The zoom behavior's scale extent, as multiples of kBase (the fit-to-width
// scale). Exported so the component's `scaleExtent` call, the focus clamp and
// the tests all read ONE pair of numbers instead of three copies.
export const ZOOM_MIN_RATIO = 0.25;
export const ZOOM_MAX_RATIO = 8;
// The focus ceiling and floor, in the same units. The ceiling exists because
// "as close as possible" on a one-step epic is absurd magnification; 2.6 is
// past SEMANTIC_IN_MIN (1.9), so a small epic lands on the Detail level, which
// is the level a reader focusing on one epic wants.
//
// The clamp is NOT a belt-and-braces duplicate of the behavior's own extent.
// `zoom.transform` applies what it is given VERBATIM — unlike `scaleTo` /
// `translateBy` it never calls `constrain`, so nothing re-clamps this at write
// time (verified against d3-zoom 3.0.0's source). What it does do is clamp the
// NEXT wheel gesture against `scaleExtent`, so an out-of-extent k here would
// look fine until the user's first scroll and then jump. Hence: the clamp is
// load-bearing, and it has to agree with the extent — which is why both now
// come from the constants above.
export const FOCUS_MAX_RATIO = 2.6;
export const FOCUS_MIN_RATIO = ZOOM_MIN_RATIO;

/**
 * The world-space rectangle an epic band occupies.
 *
 * Vertically: the band's own extent, which the layout already computed
 * (`band.y` → `band.y + band.height`, header strip included — the epic name
 * lives there and belongs inside its own fit).
 *
 * Horizontally: everything the band's OWN steps DRAW, not the whole plan's
 * width. That is the union of
 *   - the columns those steps occupy (min depth → max depth), and
 *   - the beads and every label belonging to those steps.
 *
 * The second term is not redundant. Since req #3119 a step label is CENTRED on
 * its column and sized to `staggerBudget()` — its own column plus 40% of the
 * narrower neighbour on each side — so a label in the band's first or last
 * column legitimately draws OUTSIDE the column extent. Fitting to columns alone
 * clips it, and does so worst in the production default view (`vertical` +
 * `title`, PipelineDetail.jsx), where the labels are longest. Measured on the
 * live plan before this was fixed: the rightmost title of one band landed 7px
 * PAST the viewport edge with the pad supposedly reserving 44.
 *
 * Batch boxes are deliberately not consulted: `computePlanLayout` sizes them at
 * `colW[depth] - 8`, so they can never exceed the column extent already taken.
 *
 * Non-contiguous columns are spanned rather than skipped: an epic with steps at
 * depth 0 and depth 4 wants both on screen, and there is no meaningful fit that
 * omits the middle.
 *
 * Reads only `band.stepIds`, `layout.nodes` and `layout.labels`, so it makes no
 * assumption about the ORDER of `layout.bands` (req #3201 changes that order
 * and introduces per-band horizontal origins).
 *
 * @returns {{x:number,y:number,w:number,h:number}|null} null when the band has
 *   no placed steps or the layout has no columns — the caller must not fit.
 */
export function bandFitRect(layout, band) {
    if (!layout || !band || !layout.nodes || !Array.isArray(layout.colX)) return null;
    if (!(band.height > 0) || !Number.isFinite(band.y)) return null;
    const ids = new Set(band.stepIds || []);
    let left = Infinity;
    let right = -Infinity;
    const span = (a, b) => {
        if (!Number.isFinite(a) || !Number.isFinite(b)) return;
        if (a < left) left = a;
        if (b > right) right = b;
    };
    for (const id of ids) {
        const n = layout.nodes.get(id);
        if (!n || !Number.isFinite(n.depth)) continue;
        // The column, and the bead drawn in it.
        span(layout.colX[n.depth] - layout.colW[n.depth] / 2,
             layout.colX[n.depth] + layout.colW[n.depth] / 2);
        span(n.x - BEAD_R, n.x + BEAD_R);
    }
    if (right <= left) return null;
    // Every label this band's steps draw — step titles/ids, requirement ids and
    // the reserved title slot all carry `stepId`. The epic label does not, and
    // must not: it renders as an HTML overlay pinned to the viewport, not in the
    // world, so its world x=12 would drag every band's fit back to the gutter.
    for (const l of (layout.labels || [])) {
        if (l.stepId == null || !ids.has(l.stepId)) continue;
        span(l.x, l.x + (l.w || 0));
    }
    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return null;
    return { x: left, y: band.y, w: right - left, h: band.height };
}

/**
 * The {x, y, k} that centres `band` in a `size.w` × `size.h` viewport with
 * FOCUS_PAD screen px of margin on all four sides.
 *
 * The scale is the tighter of the two axis fits, clamped into the behavior's
 * scale extent; the translation then centres the rect, which spends the slack
 * on the non-binding axis as equal margin rather than piling it on one side.
 *
 * @returns {{x:number,y:number,k:number}|null} null when there is nothing
 *   sensible to fit (no viewport yet, no columns, degenerate band).
 */
export function epicFocusTransform(layout, band, size, kBase) {
    const rect = bandFitRect(layout, band);
    if (!rect) return null;
    const w = size?.w || 0;
    const h = size?.h || 0;
    if (!(w > 0) || !(h > 0) || !(kBase > 0)) return null;
    // A viewport narrower than twice the pad has no room for the margin at all.
    // `max(half, minus-the-pad)` rather than a conditional: the conditional has
    // a cliff at exactly 2 × FOCUS_PAD where one pixel of growth changes the
    // available width from 88 to 1 and zooms out ~88×. Never reachable in
    // production (the panel has `minHeight: 480`), but a discontinuity that
    // sharp is a trap for the next caller, not a saved branch.
    const availW = Math.max(w * 0.5, w - 2 * FOCUS_PAD);
    const availH = Math.max(h * 0.5, h - 2 * FOCUS_PAD);
    const kFit = Math.min(availW / rect.w, availH / rect.h);
    const k = Math.min(Math.max(kFit, kBase * FOCUS_MIN_RATIO), kBase * FOCUS_MAX_RATIO);
    return {
        x: w / 2 - (rect.x + rect.w / 2) * k,
        y: h / 2 - (rect.y + rect.h / 2) * k,
        k,
    };
}

export { STEP_DONE, STEP_RUNNING, STEP_PENDING };
