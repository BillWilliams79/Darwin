// pipelineGroupModel.js — every pipeline in one 3D scene, laid out (req #3972).
//
// User directive: *"see all the pipeline in a single view with all the epics
// and all the requirements and I can move around … like uplevelling from
// SuperPod to Data Center of 14 SU, so component group is data center and SU
// is Pipeline."* So the "pipeline group" is a FLOOR and each pipeline is a
// platform on it, the way the TPU v8t Data Center lays its superpods out:
//
//   pipeline     → a platform (slab) on the floor, packed in rows
//   initiative   → a tinted strip across its platform, in the band colour the
//                  plan page draws it in
//   epic         → a pedestal on its strip at (dependency column, lane) — the
//                  plan's OWN structure, from `computePlanLayout`, re-spaced
//                  on a world pitch exactly as `planOverview.js` re-spaces it
//                  for the card thumbnail
//   requirement  → a cube stacked on its epic's pedestal, coloured by its
//                  requirement status (the palette that renders)
//   dependency   → an arc from one pedestal to the next
//
// World axes: x runs along a plan's dependency columns (left → right, as the
// plan page reads), z across its lanes (back → front), y is up.
//
// THE FLOOR IS A CALENDAR (req #4042). User directive: *"make the view be a
// calendar view so the pipelines are roughly ordered by time and then when
// worked closely, by their sort order."* So the platforms are not packed in
// page order any more:
//
//   time         → x. One COLUMN per occupied calendar bucket (Day · Week ·
//                  Month), earliest on the left. Buckets with no pipeline are
//                  not drawn — the axis is ordinal, "roughly by time" — and a
//                  skipped stretch is a wider aisle carrying its length
//                  ("9 weeks"), so a compressed gap is never mistaken for none.
//   sort order   → z. Pipelines in one bucket were worked close together, so
//                  within a column they stand back → front in the page's own
//                  hand-set `sort_order` (unset last, then time, then id).
//
// A pipeline's time is when work on it BEGAN: `started_at`, else `create_ts`
// for a plan never started (a draft). `update_ts` is no signal — bulk writes
// stamp every row at once. The day is the reader's LOCAL day (`localDayOf`).
//
// PURE: plans in, positions out. `pipelineGroupScene.js` draws them.

import { localDayOf } from '../SwarmView/pipelines/pipelinePlanTime';
import {
    DEFAULT_PLAN_PALETTE,
    PLAN_VIZ_PALETTE,
    REQ_STATUS_ORDER,
    planPalette,
} from '../SwarmView/pipelines/pipelinePlanLayout';

export const GROUP = Object.freeze({
    col: 3.2,          // one dependency column
    lane: 2.6,         // one lane
    bandGap: 0.8,      // between two initiative strips
    pad: 1.6,          // platform edge → first column / strip (sides and front)
    title: 2.4,        // the platform's back margin, its title printed on it (req #4045)
    bandHead: 1.1,     // an initiative strip's back margin, its name printed on it
    slabH: 0.4,        // platform thickness
    aisle: 7,          // between two platforms
    emptySize: 6,      // the footprint of a plan with nothing drawn on it
    pedestal: 2.4,     // an epic pedestal's side — roomy enough for a nameplate in front of its stack (req #4130)
    pedestalH: 0.5,    // tall enough that its front face is the epic's nameplate
    cube: 0.5,         // a requirement cube's side
    cubeGap: 0.1,
    stackShift: -0.35, // the cube stack sits toward the back; the pedestal's front strip carries the epic's name
    perLayer: 3,       // cubes per row of a layer (3 × 3 = 9 per layer)
    arcLift: 1.6,      // how far above the higher pedestal an arc's apex rides
    header: 6,         // the calendar's header strip, behind the first platform row
    gapAisle: 8,       // added to the aisle where the calendar skips buckets
});

// The status palette that RENDERS on the plan page (req #3503's lesson: the
// registry an edit targets must be the one the canvas draws).
const STATUS_COLORS = planPalette(DEFAULT_PLAN_PALETTE).status;
export const UNKNOWN_STATUS_COLOR = PLAN_VIZ_PALETTE.dim;

export function groupStatusColor(status) {
    return Object.hasOwn(STATUS_COLORS, status) ? STATUS_COLORS[status] : UNKNOWN_STATUS_COLOR;
}

/** The legend: every status, in lifecycle order. */
export const GROUP_STATUS_LEGEND = REQ_STATUS_ORDER.map((status) => ({
    status, color: groupStatusColor(status), label: status.replace('_', ' '),
}));

// Terminal first, so a stack reads as a gauge: done work at the bottom, open
// work on top.
const STACK_RANK = new Map(['met', 'wontfix', 'deferred', 'development', 'swarm_ready',
    'approved', 'authoring'].map((s, i) => [s, i]));
const stackRank = (status) => (STACK_RANK.has(status) ? STACK_RANK.get(status) : STACK_RANK.size);

const TERMINAL = new Set(['met', 'deferred', 'wontfix']);

/**
 * One plan's own footprint and contents, in platform-local coordinates
 * (origin at the platform's back-left corner, on its top face).
 */
function layoutPlan(plan) {
    const G = GROUP;
    const { layout, rows, requirementsById } = plan;
    const nodes = layout?.nodes;
    if (!nodes || !nodes.size) {
        return { w: G.emptySize, d: G.emptySize, bands: [], epics: [], arcs: [] };
    }

    // Lanes are PACKED per band, as `planOverview` packs them: a lane the plan
    // page keeps for card room but no epic sits in is dropped.
    let cols = 0;
    const usedLanes = new Map();
    for (const n of nodes.values()) {
        cols = Math.max(cols, (n.depth ?? 0) + 1);
        const b = n.bandIndex ?? 0;
        if (!usedLanes.has(b)) usedLanes.set(b, new Set());
        usedLanes.get(b).add(n.lane ?? 0);
    }
    const laneRank = new Map();
    let z = G.title;
    const bands = [];
    const bandZ = new Map();
    const bandOf = new Map();         // band index -> its drawn strip
    (layout.bands || []).forEach((band, index) => {
        const set = usedLanes.get(index);
        if (!set || !set.size) return;
        const sorted = [...set].sort((a, b) => a - b);
        laneRank.set(index, new Map(sorted.map((lane, i) => [lane, i])));
        const depth = G.bandHead + sorted.length * G.lane;
        const strip = {
            key: band.key == null ? 'none' : band.key,
            label: band.initiative || 'No initiative',
            color: band.color || PLAN_VIZ_PALETTE.accent,
            x: 0, z, d: depth,
        };
        bands.push(strip);
        bandOf.set(index, strip);
        bandZ.set(index, z);
        z += depth + G.bandGap;
    });
    if (!bands.length) {
        return { w: G.emptySize, d: G.emptySize, bands: [], epics: [], arcs: [] };
    }
    const d = z - G.bandGap + G.pad;
    const w = Math.max(G.emptySize, cols * G.col + 2 * G.pad);
    for (const b of bands) b.w = w;

    const at = new Map();
    for (const [id, n] of nodes) {
        const band = n.bandIndex ?? 0;
        if (!bandZ.has(band)) continue;
        at.set(id, {
            x: G.pad + ((n.depth ?? 0) + 0.5) * G.col,
            z: bandZ.get(band) + G.bandHead + (laneRank.get(band).get(n.lane ?? 0) + 0.5) * G.lane,
            band,
        });
    }

    const step = G.cube + G.cubeGap;
    const epics = [];
    const top = new Map();
    for (const row of rows || []) {
        const p = at.get(row.id);
        if (!p) continue;
        const reqs = (row.reqIds || []).map((rid) => {
            const r = requirementsById?.get(rid);
            const status = r?.requirement_status ?? null;
            return {
                id: rid,
                title: r?.title ?? '',
                status,
                color: groupStatusColor(status),
            };
        }).sort((a, b) => stackRank(a.status) - stackRank(b.status) || a.id - b.id);
        // Stack: rows of `perLayer` cubes, `perLayer` rows to a layer, centred
        // on the pedestal.
        const per = G.perLayer;
        const span = per * step - G.cubeGap;
        reqs.forEach((req, i) => {
            const layer = Math.floor(i / (per * per));
            const inLayer = i % (per * per);
            req.x = p.x - span / 2 + (inLayer % per) * step + G.cube / 2;
            req.z = p.z + G.stackShift - span / 2 + Math.floor(inLayer / per) * step + G.cube / 2;
            req.y = G.pedestalH + layer * step + G.cube / 2;
        });
        const layers = Math.ceil(reqs.length / (per * per));
        const height = G.pedestalH + layers * step;
        top.set(row.id, height);
        const met = reqs.filter((r) => r.status === 'met').length;
        const open = reqs.filter((r) => !TERMINAL.has(r.status)).length;
        epics.push({
            id: row.id,
            title: row.title || `Epic ${row.id}`,
            initiative: bandOf.get(p.band).label,
            band: bandOf.get(p.band).key,
            color: bandOf.get(p.band).color,
            x: p.x, z: p.z, height,
            reqs, met, open,
        });
    }

    const arcs = [];
    for (const row of rows || []) {
        const to = at.get(row.id);
        if (!to) continue;
        for (const dep of row.depIds || []) {
            const from = at.get(dep);
            if (!from) continue;
            const y0 = top.get(dep) ?? G.pedestalH;
            const y1 = top.get(row.id) ?? G.pedestalH;
            arcs.push({
                from: [from.x, y0, from.z],
                to: [to.x, y1, to.z],
                apex: Math.max(y0, y1) + G.arcLift,
            });
        }
    }

    return { w, d, bands, epics, arcs };
}

// ── THE CALENDAR (req #4042) ───────────────────────────────────────────────

/** The calendar's granularities, finest first; Week is the default. */
export const CALENDAR_BUCKETS = Object.freeze(['day', 'week', 'month']);
export const DEFAULT_CALENDAR_BUCKET = 'week';
const UNDATED = 'undated';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
const DAY_MS = 86_400_000;

/**
 * When a pipeline's work began: `started_at`, else `create_ts` (a plan never
 * started). Null when it carries neither.
 * @returns {?{at: string, source: 'started'|'created', day: string}}
 */
export function pipelineWhen(pipeline) {
    for (const [field, source] of [['started_at', 'started'], ['create_ts', 'created']]) {
        const at = pipeline?.[field];
        const day = at ? localDayOf(at) : null;
        if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) return { at: String(at), source, day };
    }
    return null;
}

// A local day as a UTC midnight: pure calendar arithmetic, no DST.
const dayMs = (day) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
const dayOfMs = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * The calendar bucket a local day falls in. Weeks start on Sunday.
 * @returns {{key: string, start: string, index: number}}  `index` counts buckets
 *          from a fixed origin, so two buckets' distance is a subtraction
 */
export function calendarBucket(day, bucket = DEFAULT_CALENDAR_BUCKET) {
    if (!day) return { key: UNDATED, start: null, index: Infinity };
    const ms = dayMs(day);
    if (bucket === 'month') {
        const y = +day.slice(0, 4);
        const m = +day.slice(5, 7);
        return { key: day.slice(0, 7), start: `${day.slice(0, 7)}-01`, index: y * 12 + (m - 1) };
    }
    if (bucket === 'week') {
        const start = ms - new Date(ms).getUTCDay() * DAY_MS;
        return { key: dayOfMs(start), start: dayOfMs(start), index: Math.round(start / (7 * DAY_MS)) };
    }
    return { key: day, start: day, index: Math.round(ms / DAY_MS) };
}

/** A column's header: "Oct 27" · "Week of Oct 25" · "October 2026". */
export function calendarLabel(start, bucket, { withYear = false } = {}) {
    if (!start) return 'Undated';
    const y = start.slice(0, 4);
    const m = +start.slice(5, 7) - 1;
    const d = +start.slice(8, 10);
    if (bucket === 'month') return `${MONTHS_LONG[m]} ${y}`;
    const date = `${MONTHS[m]} ${d}${withYear ? `, ${y}` : ''}`;
    return bucket === 'week' ? `Week of ${date}` : date;
}

const UNIT = { day: 'day', week: 'week', month: 'month' };
/** "9 weeks" — the stretch of empty buckets between two columns. */
export function gapLabel(count, bucket) {
    const unit = UNIT[bucket] || 'day';
    return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

// A stamp as epoch ms (UTC, zone suffix optional), Infinity when there is none.
function stampMs(at) {
    if (!at) return Infinity;
    const str = String(at).replace(' ', 'T');
    const ms = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(str) ? str : `${str}Z`);
    return Number.isNaN(ms) ? Infinity : ms;
}

// Unset sort order last, then the earlier start, then the lower id.
function inColumnOrder(a, b) {
    const sa = a.sortOrder ?? Infinity;
    const sb = b.sortOrder ?? Infinity;
    if (sa !== sb) return sa < sb ? -1 : 1;
    const ta = stampMs(a.when?.at);
    const tb = stampMs(b.when?.at);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id - b.id;
}

/**
 * Lay the platforms out as a calendar: a column per occupied bucket, left to
 * right in time; within a column, back to front in sort order. Each platform
 * is centred in its column; the field is centred on x = 0 and z = 0, its back
 * edge carrying the header strip the column labels stand in.
 */
function packCalendar(items, bucket) {
    const G = GROUP;
    if (!items.length) return { width: 0, depth: 0, columns: [] };
    const byKey = new Map();
    for (const it of items) {
        const b = calendarBucket(it.when?.day ?? null, bucket);
        if (!byKey.has(b.key)) byKey.set(b.key, { ...b, items: [] });
        byKey.get(b.key).items.push(it);
    }
    const ordered = [...byKey.values()].sort((a, b) => a.index - b.index);
    const years = new Set(ordered.filter((c) => c.start).map((c) => c.start.slice(0, 4)));
    const withYear = years.size > 1;

    let x = 0;
    let depth = 0;
    const columns = ordered.map((c, i) => {
        c.items.sort(inColumnOrder);
        const prev = ordered[i - 1];
        const skipped = prev && Number.isFinite(c.index) && Number.isFinite(prev.index)
            ? c.index - prev.index - 1 : 0;
        if (i > 0) x += G.aisle + (skipped > 0 ? G.gapAisle : 0);
        const w = Math.max(...c.items.map((it) => it.w));
        let z = 0;
        c.items.forEach((it, rank) => {
            it.x = x + (w - it.w) / 2;
            it.z = z;
            it.bucket = c.key;
            it.rank = rank + 1;
            z += it.d + G.aisle;
        });
        const d = z - G.aisle;
        depth = Math.max(depth, d);
        const col = {
            key: c.key,
            start: c.start,
            label: calendarLabel(c.start, bucket, { withYear }),
            x, w, d,
            pipelineIds: c.items.map((it) => it.id),
            gapBefore: skipped > 0 ? { count: skipped, label: gapLabel(skipped, bucket) } : null,
        };
        x += w;
        return col;
    });
    const width = x;
    const total = depth + G.header;
    const dx = -width / 2;
    const dz = -total / 2 + G.header;
    for (const it of items) {
        it.x += dx;
        it.z += dz;
    }
    for (const c of columns) {
        c.x += dx;
        c.z = dz;
        c.headerZ = dz - G.header / 2;
    }
    return { width, depth: total, columns };
}

/**
 * @param {Array<{
 *   pipeline: Object,                 // the list row: id, title, pipeline_status, …
 *   state: 'loading'|'error'|'empty'|'drawn',
 *   layout?: Object,                  // computePlanLayout result
 *   rows?: Object[],                  // the adapted plan rows that layout came from
 *   requirementsById?: Map<number, Object>,
 * }>} plans  in the page's own order
 * @param {{bucket?: 'day'|'week'|'month'}} [options]  the calendar's granularity
 * @returns {{
 *   pipelines: Object[],              // world-placed: x, z (back-left corner), w, d, bands, epics, arcs,
 *                                     // when, bucket (its column's key), rank (1-based, in its column)
 *   columns: Object[],                // the calendar, left to right: key, label, x, w, z, d, headerZ,
 *                                     // pipelineIds (back to front), gapBefore
 *   bucket: string,
 *   bounds: {minX, maxX, minZ, maxZ, maxY},
 *   counts: {pipelines, initiatives, epics, requirements, met},
 * }}
 */
export function buildPipelineGroupModel(plans, { bucket = DEFAULT_CALENDAR_BUCKET } = {}) {
    const G = GROUP;
    const unit = CALENDAR_BUCKETS.includes(bucket) ? bucket : DEFAULT_CALENDAR_BUCKET;
    const items = (plans || []).map((plan) => {
        const local = plan.state === 'drawn' ? layoutPlan(plan)
            : { w: G.emptySize, d: G.emptySize, bands: [], epics: [], arcs: [] };
        const reqs = local.epics.flatMap((e) => e.reqs);
        return {
            id: plan.pipeline.id,
            title: plan.pipeline.title || `Pipeline ${plan.pipeline.id}`,
            status: plan.pipeline.pipeline_status ?? null,
            sortOrder: plan.pipeline.sort_order ?? null,
            when: pipelineWhen(plan.pipeline),
            state: plan.state,
            ...local,
            counts: {
                initiatives: local.bands.length,
                epics: local.epics.length,
                requirements: reqs.length,
                met: reqs.filter((r) => r.status === 'met').length,
                open: reqs.filter((r) => !TERMINAL.has(r.status)).length,
            },
        };
    });

    const floor = packCalendar(items, unit);
    let maxY = G.slabH;
    for (const it of items) {
        for (const e of it.epics) maxY = Math.max(maxY, G.slabH + e.height);
        for (const a of it.arcs) maxY = Math.max(maxY, G.slabH + a.apex);
    }

    const sum = (k) => items.reduce((s, it) => s + it.counts[k], 0);
    // Back to front within a column, columns left to right: the calendar's
    // own reading order, which the Info panel's index follows too.
    const order = new Map(floor.columns.flatMap((c) => c.pipelineIds).map((id, i) => [id, i]));
    items.sort((a, b) => order.get(a.id) - order.get(b.id));
    return {
        pipelines: items,
        columns: floor.columns,
        bucket: unit,
        bounds: {
            minX: -floor.width / 2, maxX: floor.width / 2,
            minZ: -floor.depth / 2, maxZ: floor.depth / 2,
            maxY,
        },
        counts: {
            pipelines: items.length,
            initiatives: sum('initiatives'),
            epics: sum('epics'),
            requirements: sum('requirements'),
            met: sum('met'),
        },
    };
}

/** A pipeline's world box: its platform plus everything stacked on it. */
export function pipelineBox(p) {
    const G = GROUP;
    let maxY = G.slabH;
    for (const e of p.epics) maxY = Math.max(maxY, G.slabH + e.height);
    for (const a of p.arcs) maxY = Math.max(maxY, G.slabH + a.apex);
    return { minX: p.x, maxX: p.x + p.w, minZ: p.z, maxZ: p.z + p.d, maxY };
}

// ── TEXT ON THE PANELS (req #4045) ─────────────────────────────────────────
// User directive: *"I want all text to be integrated into the 3D simulated of
// the panels in this view, not as a floating helper text."* So no label hovers
// over the scene: every word is PRINTED on a surface, as the Topology viewer
// prints a part's name on its top face (tpu3d.js `tpu3dHostNvme`):
//
//   column date     → the calendar's header strip, on the floor behind it
//   skipped stretch → the floor of its wider aisle
//   pipeline title  → its platform's top, in the back margin (`GROUP.title`)
//   initiative      → its strip's top, in the strip's back margin (`GROUP.bandHead`)
//   epic            → its pedestal's front face AND the strip of its top in front of the cubes (req #4130)
//   requirement     → the top face of each cube nothing sits on (req #4130)
//
// Printed text is part of the world: it foreshortens with the view, a nearer
// panel hides it, and it is read by moving in (a focus frames one platform).
// Nothing can print over anything else, so there is no declutter.

/** A plate's margin inside the face it is printed on. */
const PLATE_INSET = 0.4;
const SURFACE_LIFT = 0.012;        // over the face it lies on: no depth fight
const MIN_PLATE = 0.1;             // never a zero or mirrored (negative) plate

const plate = (spec) => ({ ...spec, w: Math.max(MIN_PLATE, spec.w), h: Math.max(MIN_PLATE, spec.h) });

/**
 * Every piece of text in the scene, as a plate on the surface it is printed on.
 * `face: 'up'` lies flat (its top edge toward the back, −z), `'front'` stands
 * on a face looking at +z. x/y/z is the plate's world centre; w × h its extent
 * across the face; `lines` how many lines the text may wrap to.
 *
 * @returns {Array<{kind: 'column'|'gap'|'pipeline'|'initiative'|'epic', text: string,
 *   pipelineId: ?number, face: 'up'|'front', x: number, y: number, z: number,
 *   w: number, h: number, lines: number, align: 'left'|'center', accent?: string}>}
 */
export function textPlates(model) {
    const G = GROUP;
    const plates = [];
    if (!model) return plates;
    const cols = model.columns || [];
    cols.forEach((c, i) => {
        plates.push(plate({
            kind: 'column', text: c.label, pipelineId: null, face: 'up',
            x: c.x + c.w / 2, y: SURFACE_LIFT, z: c.headerZ,
            w: c.w + G.aisle - 1 - 2 * PLATE_INSET, h: G.header * 0.5, lines: 1, align: 'center',
        }));
        if (c.gapBefore && i > 0) {
            const prev = cols[i - 1];
            plates.push(plate({
                kind: 'gap', text: `· ${c.gapBefore.label} ·`, pipelineId: null, face: 'up',
                x: (prev.x + prev.w + c.x) / 2, y: SURFACE_LIFT, z: c.headerZ,
                w: c.x - (prev.x + prev.w) - 2 * PLATE_INSET, h: G.header * 0.3, lines: 1, align: 'center',
            }));
        }
    });
    const top = G.slabH + SURFACE_LIFT;
    for (const p of model.pipelines || []) {
        const title = p.state === 'loading' ? `${p.title} · loading…`
            : p.state === 'error' ? `${p.title} · could not load`
                : p.title;
        plates.push(plate({
            kind: 'pipeline', text: title, pipelineId: p.id, face: 'up',
            x: p.x + p.w / 2, y: top, z: p.z + G.title / 2,
            w: p.w - 2 * PLATE_INSET, h: G.title - 2 * PLATE_INSET, lines: 2, align: 'left',
        }));
        for (const band of p.bands) {
            plates.push(plate({
                kind: 'initiative', text: band.label, pipelineId: p.id, face: 'up',
                x: p.x + p.w / 2, y: top + SURFACE_LIFT, z: p.z + band.z + G.bandHead / 2,
                w: p.w - 2 * PLATE_INSET, h: G.bandHead - 0.3, lines: 1, align: 'left',
                accent: band.color,
            }));
        }
        for (const e of p.epics) {
            plates.push(plate({
                kind: 'epic', text: e.title, pipelineId: p.id, face: 'front',
                x: p.x + e.x, y: G.slabH + G.pedestalH / 2, z: p.z + e.z + G.pedestal / 2 + 0.004,
                w: G.pedestal - 0.12, h: G.pedestalH - 0.08, lines: 2, align: 'center',
            }));
            // Req #4130: the Front view looks down, so the epic's name is also
            // printed on its pedestal's top, in the strip in front of the cubes.
            const stripBack = G.stackShift + (G.perLayer * (G.cube + G.cubeGap) - G.cubeGap) / 2;
            const stripFront = G.pedestal / 2;
            plates.push(plate({
                kind: 'epic', text: e.title, pipelineId: p.id, face: 'up',
                x: p.x + e.x, y: G.slabH + G.pedestalH + SURFACE_LIFT,
                z: p.z + e.z + (stripBack + stripFront) / 2,
                w: G.pedestal - 0.2, h: stripFront - stripBack - 0.06, lines: 2, align: 'center',
            }));
            // Requirement titles: printed on the top face of every cube nothing
            // sits on, readable by moving in.
            const per2 = G.perLayer * G.perLayer;
            e.reqs.forEach((r, i) => {
                if (i + per2 < e.reqs.length || !r.title) return;
                plates.push(plate({
                    kind: 'req', text: r.title, pipelineId: p.id, face: 'up',
                    x: p.x + r.x, y: G.slabH + r.y + G.cube / 2 + SURFACE_LIFT, z: p.z + r.z,
                    w: G.cube - 0.04, h: G.cube - 0.04, lines: 3, align: 'center',
                }));
            });
        }
    }
    return plates;
}
