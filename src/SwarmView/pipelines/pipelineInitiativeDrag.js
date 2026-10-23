// pipelineInitiativeDrag.js — the pure half of dragging an initiative to a new
// place in the Plan visualizer's band stack (req #3861).
//
// ── INITIATIVES HAVE A HARD ORDER ─────────────────────────────────────────
// `initiatives.sort_order` (req #3430) is THE initiative display order. Before
// req #3861 it was optional, and an initiative without one stacked by DERIVED
// START TIME (req #3201) — so most plans were laid out by a clock nobody had
// chosen. Now every initiative carries one: a new initiative is appended to its
// plan's order (`nextInitiativeSortOrder`, used by every creator), and the
// user re-orders by dragging the initiative's name bar.
//
// A DROP RENUMBERS THE WHOLE PLAN, densely 1..N, and writes only the rows whose
// value changed, in ONE bulk PUT (one UPDATE statement at the gateway, so a
// refusal writes nothing). Dense renumbering is what keeps the order hard: a
// plan whose rows were partly NULL becomes fully ordered the first time
// anything in it is moved, in the order the reader was looking at. A LOCKED
// initiative's place is frozen, so it is numbered around (`sortOrderWrites`).
//
// The gesture — pointer handling, the floating copy, the insertion line — is
// DOM work and lives in PipelinePlanVisualizer.jsx. Every DECISION it makes is
// here, so a test can reach it. It is pressed on the shared press timeline
// exactly as a requirement mark is (`pipelineReqDrag.js::reqPressOutcome`):
// a mouse lifts by moving, a finger by holding still; a click, a double click
// and a long press on the name keep their own meanings.

const isNum = (v) => v != null && v !== '' && Number.isFinite(Number(v));

/**
 * The sort order a NEW initiative takes in a plan: one past the plan's highest,
 * so it lands at the bottom of the stack. 1 for a plan with none.
 *
 * @param {Array<{sort_order?: ?number}>} initiatives  the plan's initiatives
 * @returns {number}
 */
export function nextInitiativeSortOrder(initiatives) {
    let max = 0;
    for (const i of Array.isArray(initiatives) ? initiatives : []) {
        if (isNum(i?.sort_order)) max = Math.max(max, Number(i.sort_order));
    }
    return max + 1;
}

/**
 * The plan's FULL initiative order as the reader sees it, ids only.
 *
 * Starts from the stored order (`sort_order` ascending, NULL after every
 * ordered row, id as the tie-break), then re-sequences the initiatives that
 * HAVE a band into the order the bands are drawn in — the slots they occupy
 * are kept, so an initiative with no epics (no band to see) keeps its place
 * among them. For a fully ordered plan the two agree and this is the stored
 * order; for one with NULL rows it is what is on screen.
 *
 * @param {Array<{id: number, sort_order?: ?number}>} initiatives
 * @param {Array<?number>} bandOrder  initiative ids in drawn band order (null = "No initiative")
 * @returns {number[]}
 */
export function planInitiativeOrder(initiatives, bandOrder) {
    const list = (Array.isArray(initiatives) ? initiatives : [])
        .filter((i) => i && i.id != null)
        .slice()
        .sort((a, b) => {
            const oa = isNum(a.sort_order) ? Number(a.sort_order) : null;
            const ob = isNum(b.sort_order) ? Number(b.sort_order) : null;
            if ((oa == null) !== (ob == null)) return oa == null ? 1 : -1;
            if (oa != null && oa !== ob) return oa - ob;
            return a.id - b.id;
        })
        .map((i) => i.id);
    const known = new Set(list);
    const drawn = (Array.isArray(bandOrder) ? bandOrder : [])
        .filter((id) => id != null && known.has(id));
    const drawnSet = new Set(drawn);
    let next = 0;
    return list.map((id) => (drawnSet.has(id) ? drawn[next++] : id));
}

// A band's height, as `computePlanLayout` exports it (`height`).
const bandH = (b) => (Number.isFinite(b.height) ? b.height : 0);

/**
 * Where an initiative dragged to world y `worldY` would land among the drawn
 * bands. Only initiative bands are slots — the "No initiative" band has no row
 * to order and always stacks last.
 *
 *   index    the slot, 0..n over the drawn initiative bands (the dragged one included)
 *   beforeId the band the drop goes ABOVE, or null at the bottom
 *   afterId  the band the drop goes BELOW, or null at the top
 *   lineY    world y of the insertion line
 *   noop     dropping here leaves the order as it is
 *
 * @param {Array<{initiativeId: ?number, y: number, height: number}>} bands  `layout.bands`
 * @param {number} worldY
 * @param {number} dragId
 * @returns {?{index: number, beforeId: ?number, afterId: ?number, lineY: number, noop: boolean}}
 */
export function initiativeDropSlot(bands, worldY, dragId) {
    const list = (Array.isArray(bands) ? bands : []).filter((b) => b && b.initiativeId != null);
    if (!list.length || !Number.isFinite(worldY)) return null;
    let index = 0;
    while (index < list.length && worldY > list[index].y + bandH(list[index]) / 2) index += 1;
    const above = index > 0 ? list[index - 1] : null;
    const below = index < list.length ? list[index] : null;
    const lineY = above && below ? (above.y + bandH(above) + below.y) / 2
        : below ? below.y : above.y + bandH(above);
    const from = list.findIndex((b) => b.initiativeId === dragId);
    return {
        index,
        beforeId: below ? below.initiativeId : null,
        afterId: above ? above.initiativeId : null,
        lineY,
        noop: from !== -1 && (index === from || index === from + 1),
    };
}

/**
 * The full order with `dragId` moved to sit directly above `beforeId`, or —
 * when `beforeId` is null — directly below `afterId` (the bottom slot of the
 * drawn bands; an initiative with no band after it stays after it).
 *
 * @param {number[]} order
 * @param {number} dragId
 * @param {{beforeId: ?number, afterId: ?number}} slot
 * @returns {number[]}
 */
export function moveInitiativeInOrder(order, dragId, { beforeId = null, afterId = null } = {}) {
    const ids = Array.isArray(order) ? order : [];
    if (!ids.includes(dragId)) return ids.slice();
    if (beforeId === dragId || (beforeId == null && afterId === dragId)) return ids.slice();
    const rest = ids.filter((id) => id !== dragId);
    let at;
    if (beforeId != null && rest.includes(beforeId)) at = rest.indexOf(beforeId);
    else if (afterId != null && rest.includes(afterId)) at = rest.indexOf(afterId) + 1;
    else at = beforeId != null ? 0 : rest.length;
    rest.splice(at, 0, dragId);
    return rest;
}

/**
 * The writes that make the stored order equal `order`. Only rows whose value
 * changes are written.
 *
 * Numbered densely from 1 — unless that would rewrite a LOCKED initiative's
 * `sort_order`, which a lock freezes (Lambda-Rest `plan_lock.py`; the bulk PUT
 * would be refused whole). Then every locked initiative keeps its value as a
 * fixed ANCHOR and the others are numbered around them: just below the first
 * anchor, just above the last, and in the free integers between two. A re-order
 * that cannot fit — more initiatives between two anchors than integers between
 * their values, or an anchor with no value at all — is `blocked`, naming the
 * anchors in its way. (A drag cannot change the relative order of two locked
 * initiatives: neither of them is what moves.)
 *
 * @param {Array<{id: number, sort_order?: ?number}>} initiatives
 * @param {number[]} order
 * @param {{lockedInitiativeIds?: Iterable<number>}} [opts]
 * @returns {{writes: Array<{id: number, sort_order: number}>, blockedIds: number[]}}
 */
export function sortOrderWrites(initiatives, order, { lockedInitiativeIds = [] } = {}) {
    const stored = new Map((Array.isArray(initiatives) ? initiatives : [])
        .filter((i) => i && i.id != null)
        .map((i) => [i.id, isNum(i.sort_order) ? Number(i.sort_order) : null]));
    const ids = (Array.isArray(order) ? order : []).filter((id) => stored.has(id));
    const diff = (target) => ids
        .filter((id) => stored.get(id) !== target.get(id))
        .map((id) => ({ id, sort_order: target.get(id) }));
    const locked = new Set(lockedInitiativeIds || []);
    const dense = new Map(ids.map((id, i) => [id, i + 1]));
    const denseWrites = diff(dense);
    if (!denseWrites.some((w) => locked.has(w.id))) return { writes: denseWrites, blockedIds: [] };

    const anchors = ids.filter((id) => locked.has(id));
    const blocked = new Set(anchors.filter((id) => stored.get(id) == null));
    if (blocked.size) return { writes: [], blockedIds: [...blocked] };
    const target = new Map();
    let prev = null;                         // the last anchor passed, by id
    let run = [];                            // unlocked ids since it
    const place = (nextAnchor) => {
        const lo = prev == null ? null : stored.get(prev);
        const hi = nextAnchor == null ? null : stored.get(nextAnchor);
        if (run.length && lo != null && hi != null && hi - lo - 1 < run.length) {
            blocked.add(prev);
            blocked.add(nextAnchor);
        }
        const first = lo != null ? lo + 1 : hi - run.length;
        run.forEach((id, i) => target.set(id, first + i));
        run = [];
    };
    for (const id of ids) {
        if (!locked.has(id)) { run.push(id); continue; }
        // Two locked initiatives tied on one value are fine side by side; only a
        // run between them needs integers (`place`) — so only a DECREASE blocks.
        if (prev != null && stored.get(id) < stored.get(prev)) {
            blocked.add(prev);
            blocked.add(id);
        }
        place(id);
        target.set(id, stored.get(id));
        prev = id;
    }
    place(null);
    if (blocked.size) return { writes: [], blockedIds: [...blocked] };
    return { writes: diff(target), blockedIds: [] };
}

/**
 * Why a re-order may not be written, or null when it may: the whole plan is
 * locked, or `sortOrderWrites` found locked initiatives the order cannot be
 * numbered around.
 *
 * @param {{writes: Array, blockedIds: number[]}} plan  `sortOrderWrites`' answer
 * @param {{planLocked?: boolean}} lock
 * @returns {?{lockedBy: 'pipeline'|'initiative', ids: number[]}}
 */
export function initiativeOrderRefusal({ writes = [], blockedIds = [] } = {}, { planLocked = false } = {}) {
    if (planLocked && (writes.length || blockedIds.length)) return { lockedBy: 'pipeline', ids: [] };
    return blockedIds.length ? { lockedBy: 'initiative', ids: blockedIds } : null;
}

/**
 * The plan rows with a pending order applied — each row's `initiativeSortOrder`
 * replaced from `overlay` (initiative id -> sort order), so the band stack
 * redraws ONCE, on the drop, rather than waiting out the round trip. Rows the
 * overlay does not name keep their identity.
 *
 * @param {Object[]} rows
 * @param {?Map<number, number>} overlay
 * @returns {Object[]}
 */
export function applyInitiativeOrder(rows, overlay) {
    if (!Array.isArray(rows) || !overlay?.size) return rows;
    return rows.map((r) => (r.initiativeId != null && overlay.has(r.initiativeId)
        && r.initiativeSortOrder !== overlay.get(r.initiativeId)
        ? { ...r, initiativeSortOrder: overlay.get(r.initiativeId) }
        : r));
}

/**
 * The plan's initiatives with a pending order applied (`sort_order`).
 *
 * @param {Object[]} initiatives
 * @param {?Map<number, number>} overlay
 * @returns {Object[]}
 */
export function applyInitiativeOrderToInitiatives(initiatives, overlay) {
    if (!Array.isArray(initiatives) || !overlay?.size) return initiatives;
    return initiatives.map((i) => (overlay.has(i.id) && i.sort_order !== overlay.get(i.id)
        ? { ...i, sort_order: overlay.get(i.id) } : i));
}

/**
 * Do the server's initiatives already carry every value a re-order wrote?
 *
 * @param {Object[]} initiatives  the server's rows
 * @param {Map<number, number>} overlay
 */
export function initiativeOrderReflected(initiatives, overlay) {
    if (!overlay?.size) return true;
    const byId = new Map((Array.isArray(initiatives) ? initiatives : []).map((i) => [i.id, i]));
    for (const [id, order] of overlay) {
        const row = byId.get(id);
        if (row && Number(row.sort_order) !== order) return false;
    }
    return true;
}
