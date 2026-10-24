// pipelineInitiativeDeps.js — initiative-to-initiative dependencies in the
// browser (req #3823). PURE: rows in, plain objects out.
//
// "Initiative B depends on initiative A" means no epic under B launches while
// any epic under A holds open work. The HOLD is the server's
// (`Lambda-Rest/pipeline2_derive.py` — `derived.initiative_rows` and each row's
// `initiative_blocked_by`); nothing here derives it. This module only reshapes
// what the composed read carries and does the bookkeeping the editors need:
// which edges a save adds and removes, which initiatives a dependency may name,
// and the edge counts the list pages show. The refusals (self, another plan, a
// cycle on the combined initiative + epic graph) are the GATEWAY's
// (`initiative_deps_guard.py`); `dependencyChoices` only greys out the choices
// that would obviously close a cycle of initiative edges, and the server's
// message is what a reader sees for anything subtler.

const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * The plan's initiative edges, `{ id, from, to }` — `from` WAITS FOR `to`.
 * @param {Object[]} rows  `initiative_deps` rows (`initiative_fk`, `dep_initiative_fk`)
 */
export function initiativeDepEdges(rows) {
    return asArray(rows)
        .filter((r) => r && r.initiative_fk != null && r.dep_initiative_fk != null)
        .map((r) => ({ id: r.id ?? null, from: r.initiative_fk, to: r.dep_initiative_fk }));
}

/**
 * Per initiative, the server's gate: `Map<id, { depIds, holdsOpenWork, blockedBy }>`.
 * Read from `derived.initiative_rows`; an initiative it does not name (a
 * gateway older than #3823) has no entry, which every reader takes as "waits
 * for nothing".
 */
export function initiativeGates(derived) {
    const out = new Map();
    for (const r of asArray(derived && derived.initiative_rows)) {
        if (!r || r.id == null) continue;
        out.set(r.id, {
            depIds: asArray(r.dep_initiative_ids),
            holdsOpenWork: Boolean(r.holds_open_work),
            blockedBy: asArray(r.initiative_blocked_by),
        });
    }
    return out;
}

/**
 * What a save writes: the dependency ids to ADD and the edges to REMOVE.
 * Adds go first (`initiativesApi.setInitiativeDeps`), so a refused add leaves
 * the old set standing rather than an initiative briefly waiting on nothing.
 * @param {Object[]} currentRows  this initiative's own `initiative_deps` rows
 * @param {number[]} nextIds      the dependency ids it should have
 */
export function initiativeDepDiff(currentRows, nextIds) {
    const want = new Set(asArray(nextIds));
    const have = new Set(asArray(currentRows).map((r) => r.dep_initiative_fk));
    return {
        add: [...want].filter((id) => !have.has(id)),
        remove: asArray(currentRows).filter((r) => !want.has(r.dep_initiative_fk)),
    };
}

/** Every initiative `start` reaches by following "waits for" edges. */
function reachable(edges, start) {
    const out = new Set();
    const stack = [start];
    while (stack.length) {
        const id = stack.pop();
        for (const e of edges) {
            if (e.from === id && !out.has(e.to)) {
                out.add(e.to);
                stack.push(e.to);
            }
        }
    }
    return out;
}

/**
 * The initiatives `initiativeId` may be made to wait for: the others of its
 * plan, each `{ id, title, disabled, reason }`. One that already waits for
 * `initiativeId` (directly or through other initiatives) is disabled — the
 * edge would close a cycle and the gateway would refuse it.
 * @param {Object[]} initiatives  the plan's initiatives (`id`, `title`, `pipeline_fk`)
 * @param {number} initiativeId
 * @param {Object[]} edges        `initiativeDepEdges` output, the whole plan's
 */
export function dependencyChoices(initiatives, initiativeId, edges) {
    const self = asArray(initiatives).find((i) => i.id === initiativeId);
    return asArray(initiatives)
        .filter((i) => i.id !== initiativeId
            && (self?.pipeline_fk == null || i.pipeline_fk == null
                || i.pipeline_fk === self.pipeline_fk))
        .map((i) => {
            const cycles = reachable(asArray(edges), i.id).has(initiativeId);
            return {
                id: i.id,
                title: i.title,
                disabled: cycles,
                reason: cycles ? `${i.title} already waits for this initiative` : null,
            };
        });
}

/**
 * Edge counts for the list pages: `{ byPipeline: Map<pipelineId, n>,
 * byInitiative: Map<initiativeId, { dependsOn: number[], dependents: number[] }> }`.
 * @param {Object[]} rows         every `initiative_deps` row the page read
 * @param {Object[]} initiatives  every initiative row (to place an edge in its plan)
 */
export function initiativeDepCounts(rows, initiatives) {
    const planOf = new Map(asArray(initiatives).map((i) => [i.id, i.pipeline_fk]));
    const byPipeline = new Map();
    const byInitiative = new Map();
    const entry = (id) => {
        if (!byInitiative.has(id)) byInitiative.set(id, { dependsOn: [], dependents: [] });
        return byInitiative.get(id);
    };
    for (const e of initiativeDepEdges(rows)) {
        entry(e.from).dependsOn.push(e.to);
        entry(e.to).dependents.push(e.from);
        const plan = planOf.get(e.from);
        if (plan != null) byPipeline.set(plan, (byPipeline.get(plan) || 0) + 1);
    }
    return { byPipeline, byInitiative };
}

/**
 * The words a held initiative shows on the plan: `"waiting on A, B"` while the
 * initiatives it waits for hold open work, `"after A"` once they hold none, or
 * null when it waits for nothing. `titleOf(id)` names an initiative.
 */
export function initiativeWaitText(gate, titleOf) {
    if (!gate || !gate.depIds.length) return null;
    const name = (id) => titleOf(id) ?? `initiative ${id}`;
    return gate.blockedBy.length
        ? `waiting on ${gate.blockedBy.map(name).join(', ')}`
        : `after ${gate.depIds.map(name).join(', ')}`;
}

// ── The connector on the canvas ─────────────────────────────────────────────
// Initiatives are horizontal bands stacked down the plan, and an epic edge runs
// BETWEEN CARDS, left to right in time. An initiative edge runs between BANDS,
// so it is drawn in the plan's left gutter (world x below the first card
// column, which starts at `LEFT` = 66 in pipelinePlanLayout.js): a bracket from
// the band waited on to the band that waits, arrowhead into the waiting band.
// Distinct from an epic arc by place (the gutter, never among the cards),
// shape (a bracket, not a curve) and stroke (dashed, heavier). Each edge takes
// its own gutter lane so two brackets spanning the same bands stay apart.
export const INITIATIVE_DEP_GUTTER_X0 = 8;
export const INITIATIVE_DEP_GUTTER_STEP = 8;
export const INITIATIVE_DEP_GUTTER_LANES = 4;
export const INITIATIVE_DEP_STUB_X = 40;

/**
 * Where each initiative edge is drawn, in WORLD px: `{ key, from, to, held, x,
 * yFrom, yTo }` — `yTo` is the band WAITED ON, `yFrom` the waiting band, each
 * the middle of that band's header. An edge whose band is not on the plan (a
 * machine filter emptied it) is not drawn. `held` says the edge is holding
 * work back now: the initiative waited on holds open work, or is itself held.
 * @param {Object[]} bands   `computePlanLayout().bands` (`initiativeId`, `y`, `headerH`)
 * @param {Object[]} edges   `initiativeDepEdges` output
 * @param {Map} gates        `initiativeGates` output
 */
export function initiativeDepConnectors(bands, edges, gates) {
    const anchor = new Map();
    for (const b of asArray(bands)) {
        if (b && b.initiativeId != null) anchor.set(b.initiativeId, b.y + (b.headerH || 0) / 2);
    }
    const out = [];
    for (const e of asArray(edges)) {
        if (!anchor.has(e.from) || !anchor.has(e.to)) continue;
        const lane = out.length % INITIATIVE_DEP_GUTTER_LANES;
        const target = gates?.get?.(e.to);
        const waiter = gates?.get?.(e.from);
        out.push({
            key: `${e.from}-${e.to}`,
            from: e.from,
            to: e.to,
            held: Boolean(waiter?.blockedBy?.includes(e.to)
                || (target && target.blockedBy.length)),
            x: INITIATIVE_DEP_GUTTER_X0 + lane * INITIATIVE_DEP_GUTTER_STEP,
            yFrom: anchor.get(e.from),
            yTo: anchor.get(e.to),
        });
    }
    return out;
}

/**
 * What a save writes, from the reader's OWN change (code review, req #3823):
 * `seenIds` the set the field showed when they first changed it, `chosenIds`
 * the set they left. Only their delta is applied to the rows as they are NOW,
 * so an edge that arrived after the dialog opened (a slow first read, a
 * refetch, another tab or the MCP) is never removed by a save that did not
 * touch it. `{ add: [ids], remove: [rows] }`.
 */
export function initiativeDepEdit(currentRows, seenIds, chosenIds) {
    const seen = new Set(asArray(seenIds));
    const chosen = new Set(asArray(chosenIds));
    const have = new Set(asArray(currentRows).map((r) => r.dep_initiative_fk));
    return {
        add: [...chosen].filter((id) => !seen.has(id) && !have.has(id)),
        remove: asArray(currentRows).filter((r) => seen.has(r.dep_initiative_fk)
            && !chosen.has(r.dep_initiative_fk)),
    };
}
