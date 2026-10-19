// pipelineReqDrag.js — the pure half of dragging a requirement between steps
// on the Plan visualizer (req #3581).
//
// The gesture itself — hit-testing the mark, the floating preview, edge
// auto-pan — is DOM and Konva work and lives in PipelinePlanVisualizer.jsx.
// What lives here is every DECISION that gesture makes, so a test can reach it:
// what counts as a drag rather than a click, which step a point lands on,
// whether that step may take the requirement, and what the plan looks like the
// instant the requirement is dropped.
//
// ── THE SCREEN REDRAWS ONCE, ON DROP ───────────────────────────────────────
// Nothing re-lays-out while the requirement is in the air (user directive:
// "when you drop, only then does the screen redraw to show"). On drop the move
// is applied to the rows LOCALLY (`applyReqMoves`) so the card heights change
// exactly once, at the moment of the drop, rather than snapping back to the
// source for the round trip and then jumping again when the refetch lands.
// The local move is IDEMPOTENT, so it stays applied across that refetch and is
// dropped only once the server's own rows already say the same thing.

/**
 * How far the pointer must travel before a press on a requirement becomes a
 * drag. The SAME number the visualizer's manual click hit-test uses to stop
 * calling a gesture a click — two numbers would leave a band of movement that
 * is neither a click nor a drag, and a press there would silently do nothing.
 */
export const REQ_DRAG_SLOP = 4;

/** Screen pixels from the panel edge inside which a drag auto-pans. */
export const REQ_DRAG_EDGE_PX = 40;

/** Fastest auto-pan, in screen pixels per animation frame. */
export const REQ_DRAG_EDGE_MAX_SPEED = 16;

/** Whether the pointer has left the press far enough to be a drag. */
export function passedDragSlop(down, x, y) {
    if (!down) return false;
    return Math.hypot(x - down.x, y - down.y) > REQ_DRAG_SLOP;
}

/**
 * The step whose CARD BOX contains a world point, or null. The box is the
 * layout's own frame — the same `frameLeft/top/frameW/h` the card is painted
 * into — and it is the same box at every level, so a drop resolves to the same
 * step whether the card is drawn or only its bead is.
 *
 * @param {Map<number, Object>} nodes  `computePlanLayout(...).nodes`
 * @param {{x: number, y: number}} p   world coordinates
 * @returns {?number}
 */
export function dropTargetAt(nodes, p) {
    if (!nodes || !p) return null;
    for (const [stepId, n] of nodes) {
        if (p.x >= n.frameLeft && p.x <= n.frameLeft + n.frameW
            && p.y >= n.top && p.y <= n.top + n.h) {
            return stepId;
        }
    }
    return null;
}

/**
 * May this step take a requirement dragged off `fromStepId`? Mirrors the
 * requirement page's own step picker (`orchestrationIndex.js::stepOptions`):
 * a step with a stamped `completed_at` is not a place to put new work — design
 * rule 1 makes a stamp valid only with zero gating requirements — and dropping
 * back onto the step it came from is not a move.
 *
 * @param {?Object} row         the target's plan row
 * @param {?number} fromStepId
 */
export function canDropOn(row, fromStepId) {
    if (!row) return false;
    if (row.id === fromStepId) return false;
    // req #3649 — a locked step (or one under a locked epic/plan) takes no
    // seat; the gateway would answer 423, so the target is not offered.
    if (row.effectiveLocked) return false;
    return row.completedAt == null;
}

// Ascending insert: the composed read lists a step's requirements in junction
// order, and the junction's key is `requirement_fk`, so ascending id is where
// the refetch will put it — inserting there is what keeps the refetch from
// moving the mark a second time.
function insertAscending(ids, id) {
    if (ids.includes(id)) return ids;
    const out = ids.slice();
    const at = out.findIndex((x) => x > id);
    if (at === -1) out.push(id); else out.splice(at, 0, id);
    return out;
}

/**
 * The plan rows with each pending move applied — the requirement leaves every
 * row that lists it and joins its target. Applied in order, idempotent, and
 * a no-op for a move whose target is not on this plan. Rows the moves do not
 * touch keep their identity.
 *
 * Only membership moves. `launchReqIds` loses the requirement on the way out
 * but is never GIVEN it: whether it launches from the new step is the engine's
 * answer, and it arrives with the refetch.
 *
 * @param {Object[]} rows
 * @param {Array<{reqId: number, toStepId: number}>} moves
 * @returns {Object[]}
 */
export function applyReqMoves(rows, moves) {
    if (!Array.isArray(rows) || !rows.length || !moves?.length) return rows;
    let out = rows;
    for (const { reqId, toStepId } of moves) {
        if (!out.some((r) => r.id === toStepId)) continue;
        const wasTracking = out.some((r) => (r.trackingReqIds || []).includes(reqId));
        out = out.map((r) => {
            const has = (r.reqIds || []).includes(reqId);
            if (r.id === toStepId) {
                if (has) return r;
                return {
                    ...r,
                    reqIds: insertAscending(r.reqIds || [], reqId),
                    trackingReqIds: wasTracking
                        ? insertAscending(r.trackingReqIds || [], reqId)
                        : (r.trackingReqIds || []),
                };
            }
            if (!has) return r;
            const drop = (ids) => (ids || []).filter((x) => x !== reqId);
            return {
                ...r,
                reqIds: drop(r.reqIds),
                trackingReqIds: drop(r.trackingReqIds),
                launchReqIds: drop(r.launchReqIds),
            };
        });
    }
    return out;
}

/**
 * Auto-pan velocity for a pointer near the panel edge, in screen pixels per
 * frame — positive `vx` means the content should slide LEFT (the reader is
 * reaching right). Linear from zero at `REQ_DRAG_EDGE_PX` in to the max at the
 * edge, and zero outside the panel so a pointer that has left it does not
 * keep the plan scrolling.
 *
 * @param {{x: number, y: number}} p  pointer, panel-relative
 * @param {{w: number, h: number}} size
 */
export function edgePanVelocity(p, size) {
    if (!p || !size || p.x < 0 || p.y < 0 || p.x > size.w || p.y > size.h) {
        return { vx: 0, vy: 0 };
    }
    const ramp = (d) => (d >= REQ_DRAG_EDGE_PX ? 0
        : REQ_DRAG_EDGE_MAX_SPEED * (1 - Math.max(0, d) / REQ_DRAG_EDGE_PX));
    return {
        vx: ramp(size.w - p.x) - ramp(p.x),
        vy: ramp(size.h - p.y) - ramp(p.y),
    };
}
