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
// PURE: plans in, positions out. `pipelineGroupScene.js` draws them.

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
    pad: 1.6,          // platform edge → first column / strip
    slabH: 0.4,        // platform thickness
    aisle: 7,          // between two platforms
    emptySize: 6,      // the footprint of a plan with nothing drawn on it
    pedestal: 1.8,     // an epic pedestal's side
    pedestalH: 0.3,
    cube: 0.5,         // a requirement cube's side
    cubeGap: 0.1,
    perLayer: 3,       // cubes per row of a layer (3 × 3 = 9 per layer)
    arcLift: 1.6,      // how far above the higher pedestal an arc's apex rides
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
    let z = G.pad;
    const bands = [];
    const bandZ = new Map();
    const bandOf = new Map();         // band index -> its drawn strip
    (layout.bands || []).forEach((band, index) => {
        const set = usedLanes.get(index);
        if (!set || !set.size) return;
        const sorted = [...set].sort((a, b) => a - b);
        laneRank.set(index, new Map(sorted.map((lane, i) => [lane, i])));
        const depth = sorted.length * G.lane;
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
            z: bandZ.get(band) + (laneRank.get(band).get(n.lane ?? 0) + 0.5) * G.lane,
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
            req.z = p.z - span / 2 + Math.floor(inLayer / per) * step + G.cube / 2;
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

/**
 * Pack the platforms into rows on one floor. Rows wrap at a width chosen so
 * the field comes out roughly square — the Data Center's floor, not a
 * corridor — and every row is centred, so the field is symmetric about x = 0
 * and z = 0.
 */
function packFloor(items) {
    const G = GROUP;
    if (!items.length) return { width: 0, depth: 0 };
    const area = items.reduce((s, it) => s + (it.w + G.aisle) * (it.d + G.aisle), 0);
    const widest = Math.max(...items.map((it) => it.w));
    const target = Math.max(widest, Math.sqrt(area) * 1.15);

    const rows = [];
    let row = [];
    let rowW = 0;
    for (const it of items) {
        const add = (row.length ? G.aisle : 0) + it.w;
        if (row.length && rowW + add > target) {
            rows.push({ items: row, w: rowW });
            row = [];
            rowW = 0;
        }
        rowW += (row.length ? G.aisle : 0) + it.w;
        row.push(it);
    }
    if (row.length) rows.push({ items: row, w: rowW });

    const depth = rows.reduce((s, r) => s + Math.max(...r.items.map((it) => it.d)), 0)
        + (rows.length - 1) * G.aisle;
    const width = Math.max(...rows.map((r) => r.w));
    let z = -depth / 2;
    for (const r of rows) {
        let x = -r.w / 2;
        const rowD = Math.max(...r.items.map((it) => it.d));
        for (const it of r.items) {
            it.x = x;
            it.z = z;
            x += it.w + G.aisle;
        }
        z += rowD + G.aisle;
    }
    return { width, depth };
}

/**
 * @param {Array<{
 *   pipeline: Object,                 // the list row: id, title, pipeline_status, …
 *   state: 'loading'|'error'|'empty'|'drawn',
 *   layout?: Object,                  // computePlanLayout result
 *   rows?: Object[],                  // the adapted plan rows that layout came from
 *   requirementsById?: Map<number, Object>,
 * }>} plans  in the page's own order
 * @returns {{
 *   pipelines: Object[],              // world-placed: x, z (back-left corner), w, d, bands, epics, arcs
 *   bounds: {minX, maxX, minZ, maxZ, maxY},
 *   counts: {pipelines, initiatives, epics, requirements, met},
 * }}
 */
export function buildPipelineGroupModel(plans) {
    const G = GROUP;
    const items = (plans || []).map((plan) => {
        const local = plan.state === 'drawn' ? layoutPlan(plan)
            : { w: G.emptySize, d: G.emptySize, bands: [], epics: [], arcs: [] };
        const reqs = local.epics.flatMap((e) => e.reqs);
        return {
            id: plan.pipeline.id,
            title: plan.pipeline.title || `Pipeline ${plan.pipeline.id}`,
            status: plan.pipeline.pipeline_status ?? null,
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

    const floor = packFloor(items);
    let maxY = G.slabH;
    for (const it of items) {
        for (const e of it.epics) maxY = Math.max(maxY, G.slabH + e.height);
        for (const a of it.arcs) maxY = Math.max(maxY, G.slabH + a.apex);
    }

    const sum = (k) => items.reduce((s, it) => s + it.counts[k], 0);
    return {
        pipelines: items,
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
