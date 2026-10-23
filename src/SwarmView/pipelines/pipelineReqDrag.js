// pipelineReqDrag.js — the pure half of dragging a requirement between steps
// on the Plan visualizer (req #3581).
//
// The gesture itself — hit-testing the mark, the floating preview, edge
// auto-pan — is DOM and Konva work and lives in PipelinePlanVisualizer.jsx.
// What lives here is every DECISION that gesture makes, so a test can reach it:
// what a press has become (a pan, a lift, still a press), which step a point
// lands on, whether that step may take the requirement, and what the plan
// looks like the instant the requirement is dropped.
//
// ── THE SHARED PRESS TIMELINE (req #3665, design req #3645) ───────────────
// The mark is pressed the way every Darwin drag surface is (`dnd/pressTimeline.js`),
// through POINTER events so one path serves mouse, pen and touch:
//
//   touch  moved past TOUCH_TOLERANCE_PX before LIFT_DELAY_MS .. a PAN — d3-zoom
//                                                                 has the finger
//          held still to LIFT_DELAY_MS ......................... the requirement LIFTS
//          lifted, then moved ................................... a DRAG to another step,
//                                                                 however long the hold
//          held past LONG_PRESS_MS, released in place ........... the title EDIT (req #3661)
//   mouse  moved past MOUSE_ACTIVATION_PX ............................. it LIFTS — a hold never
//                                                                 does (user directive below)
//          held still to LONG_PRESS_MS ......................... the title EDIT, while held:
//                                                                 the caret blinks under the
//                                                                 pointer before it lets go
//
// ── WHY A MOUSE HOLD DOES NOT LIFT HERE (req #3665 review) ────────────────
// Elsewhere a long mouse click lifts (`pressTimeline.js`). Here the same hold
// is the title edit, and the two cannot share it: a requirement that lifted at
// LIFT_DELAY_MS taught people to wait for the lift before moving, and the edit
// took the press ("it will long press to move but then drop into the edit
// requirement title every time"); moving the edit to the release lost the
// editor appearing under the held pointer ("after the long press the cursor
// would select that area and blink ... let's see that again"). Without the
// mouse hold-lift both hold: moving drags at once, holding edits. A finger
// must hold to lift, so on touch the edit stays on the release.
//
// The marks are Konva shapes, not DOM nodes, so dnd-kit cannot measure them:
// the canvas keeps its own hit test and its d3-zoom coexistence, and reads the
// timeline's NUMBERS rather than its sensors.
//
// ── THE SCREEN REDRAWS ONCE, ON DROP ───────────────────────────────────────
// Nothing re-lays-out while the requirement is in the air (user directive:
// "when you drop, only then does the screen redraw to show"). On drop the move
// is applied to the rows LOCALLY (`applyReqMoves`) so the card heights change
// exactly once, at the moment of the drop, rather than snapping back to the
// source for the round trip and then jumping again when the refetch lands.
// The local move is IDEMPOTENT, so it stays applied across that refetch and is
// dropped only once the server's own rows already say the same thing.

import {
    MOUSE_ACTIVATION_PX, TOUCH_TOLERANCE_PX, PRESS_SLOP_PX,
} from '../../dnd/pressTimeline';

/**
 * How far a MOUSE must travel before a press on a requirement becomes a drag —
 * the app-wide `MOUSE_ACTIVATION_PX`. The SAME number the visualizer's manual
 * click hit-test uses to stop calling a gesture a click — two numbers would
 * leave a band of movement that is neither a click nor a drag, and a press
 * there would silently do nothing.
 */
export const REQ_DRAG_SLOP = MOUSE_ACTIVATION_PX;

/** Screen pixels from the panel edge inside which a drag auto-pans. */
export const REQ_DRAG_EDGE_PX = 40;

/** Fastest auto-pan, in screen pixels per animation frame. */
export const REQ_DRAG_EDGE_MAX_SPEED = 16;

/**
 * What a press on a requirement mark has become.
 *
 *   'pan'    a touch that moved before it was held long enough — the canvas
 *            pans under it and the requirement stays where it is
 *   'lift'   the requirement is picked up (a drag begins)
 *   'press'  nothing yet
 *
 * @param {string} pointerType  the press's `PointerEvent.pointerType`
 * @param {number} travel       furthest the pointer has been from the press, px
 * @param {boolean} held        LIFT_DELAY_MS has passed since the press
 * @returns {'pan' | 'lift' | 'press'}
 */
export function reqPressOutcome(pointerType, travel, held) {
    if (pointerType === 'touch') {
        if (travel > TOUCH_TOLERANCE_PX) return 'pan';
        return held ? 'lift' : 'press';
    }
    // A mouse or pen lifts by moving only — its hold is the title edit.
    return travel > REQ_DRAG_SLOP ? 'lift' : 'press';
}

/**
 * Has a press stayed a LONG PRESS candidate — never further than the slop
 * from where it began? A mouse asks at LONG_PRESS_MS, still held; a finger
 * asks on the release after it — a lifted requirement let go where it was
 * picked up is an edit (it is put back), one that moved past the slop at any
 * point is a drag.
 *
 * @param {number} travel  furthest the pointer has been from the press, px
 */
export function stillHeld(travel) {
    return travel <= PRESS_SLOP_PX;
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
 * any step takes new work — a step has no state, so finished work on it never
 * closes it (req #3750) — except an effectively LOCKED one, and dropping back
 * onto the step it came from is not a move.
 *
 * @param {?Object} row         the target's plan row
 * @param {?number} fromStepId
 */
export function canDropOn(row, fromStepId) {
    if (!row) return false;
    if (row.id === fromStepId) return false;
    // req #3649 — a locked step (or one under a locked initiative/plan) takes no
    // seat; the gateway would answer 423, so the target is not offered.
    return !row.effectiveLocked;
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
