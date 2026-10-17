// Req #3581 — dragging a requirement between steps on the Plan visualizer.
// The gesture is DOM work; every decision it makes is pinned here.

import { describe, it, expect } from 'vitest';
import {
    REQ_DRAG_SLOP, REQ_DRAG_EDGE_PX, REQ_DRAG_EDGE_MAX_SPEED,
    passedDragSlop, dropTargetAt, canDropOn, applyReqMoves, edgePanVelocity,
} from '../pipelineReqDrag';

const row = (id, reqIds, extra = {}) => ({
    id, reqIds, trackingReqIds: [], launchReqIds: reqIds.slice(), completedAt: null, ...extra,
});

describe('passedDragSlop', () => {
    it('is a click up to and including the slop, a drag past it', () => {
        const down = { x: 100, y: 100 };
        expect(passedDragSlop(down, 100 + REQ_DRAG_SLOP, 100)).toBe(false);
        expect(passedDragSlop(down, 100 + REQ_DRAG_SLOP + 0.5, 100)).toBe(true);
        expect(passedDragSlop(down, 103, 103)).toBe(true);   // hypot 4.24
    });

    it('never starts without a press', () => {
        expect(passedDragSlop(null, 500, 500)).toBe(false);
    });
});

describe('dropTargetAt', () => {
    const nodes = new Map([
        [1, { frameLeft: 0, frameW: 100, top: 0, h: 50 }],
        [2, { frameLeft: 200, frameW: 100, top: 0, h: 80 }],
    ]);

    it('resolves a world point to the card box it lies in, edges inclusive', () => {
        expect(dropTargetAt(nodes, { x: 50, y: 25 })).toBe(1);
        expect(dropTargetAt(nodes, { x: 200, y: 80 })).toBe(2);
        expect(dropTargetAt(nodes, { x: 300, y: 0 })).toBe(2);
    });

    it('answers null between cards and outside them', () => {
        expect(dropTargetAt(nodes, { x: 150, y: 25 })).toBeNull();
        expect(dropTargetAt(nodes, { x: 50, y: 51 })).toBeNull();
        expect(dropTargetAt(nodes, null)).toBeNull();
        expect(dropTargetAt(null, { x: 50, y: 25 })).toBeNull();
    });
});

describe('canDropOn', () => {
    it('accepts another open step', () => {
        expect(canDropOn(row(2, []), 1)).toBe(true);
    });

    it('refuses the step it came from — that is not a move', () => {
        expect(canDropOn(row(1, [10]), 1)).toBe(false);
    });

    it('refuses a stamped step, as the requirement page\'s picker does', () => {
        expect(canDropOn(row(2, [], { completedAt: '2026-10-01 00:00:00' }), 1)).toBe(false);
    });

    it('refuses no step at all', () => {
        expect(canDropOn(undefined, 1)).toBe(false);
    });
});

describe('applyReqMoves', () => {
    const rows = [row(1, [10, 30]), row(2, [5, 20, 40]), row(3, [7])];

    it('moves the requirement into the target in ascending junction order', () => {
        const out = applyReqMoves(rows, [{ reqId: 30, fromStepId: 1, toStepId: 2 }]);
        expect(out.find((r) => r.id === 1).reqIds).toEqual([10]);
        expect(out.find((r) => r.id === 2).reqIds).toEqual([5, 20, 30, 40]);
    });

    it('takes it out of the source launch list and never adds it to the target\'s', () => {
        const out = applyReqMoves(rows, [{ reqId: 30, fromStepId: 1, toStepId: 2 }]);
        expect(out.find((r) => r.id === 1).launchReqIds).toEqual([10]);
        expect(out.find((r) => r.id === 2).launchReqIds).toEqual([5, 20, 40]);
    });

    it('keeps the identity of rows it does not touch', () => {
        const out = applyReqMoves(rows, [{ reqId: 30, fromStepId: 1, toStepId: 2 }]);
        expect(out[2]).toBe(rows[2]);
    });

    it('is idempotent — still right once the refetch already says the same thing', () => {
        const once = applyReqMoves(rows, [{ reqId: 30, fromStepId: 1, toStepId: 2 }]);
        const twice = applyReqMoves(once, [{ reqId: 30, fromStepId: 1, toStepId: 2 }]);
        expect(twice.map((r) => r.reqIds)).toEqual(once.map((r) => r.reqIds));
        expect(twice[1]).toBe(once[1]);
    });

    it('carries a tracking container\'s flag with it', () => {
        const withTracker = [row(1, [10, 30], { trackingReqIds: [30] }), row(2, [5])];
        const out = applyReqMoves(withTracker, [{ reqId: 30, fromStepId: 1, toStepId: 2 }]);
        expect(out[0].trackingReqIds).toEqual([]);
        expect(out[1].trackingReqIds).toEqual([30]);
    });

    it('applies several moves in order', () => {
        const out = applyReqMoves(rows, [
            { reqId: 30, fromStepId: 1, toStepId: 2 },
            { reqId: 7, fromStepId: 3, toStepId: 1 },
        ]);
        expect(out.map((r) => r.reqIds)).toEqual([[7, 10], [5, 20, 30, 40], []]);
    });

    it('ignores a move whose target is not on this plan', () => {
        const out = applyReqMoves(rows, [{ reqId: 30, fromStepId: 1, toStepId: 99 }]);
        expect(out).toBe(rows);
    });

    it('returns the rows untouched with nothing pending', () => {
        expect(applyReqMoves(rows, [])).toBe(rows);
        expect(applyReqMoves([], [{ reqId: 1, toStepId: 2 }])).toEqual([]);
    });
});

describe('edgePanVelocity', () => {
    const size = { w: 1000, h: 600 };

    it('is still away from the edges', () => {
        expect(edgePanVelocity({ x: 500, y: 300 }, size)).toEqual({ vx: 0, vy: 0 });
        expect(edgePanVelocity({ x: REQ_DRAG_EDGE_PX, y: 300 }, size).vx).toBe(0);
    });

    it('ramps to full speed at each edge, signed by direction', () => {
        expect(edgePanVelocity({ x: 1000, y: 300 }, size).vx).toBe(REQ_DRAG_EDGE_MAX_SPEED);
        expect(edgePanVelocity({ x: 0, y: 300 }, size).vx).toBe(-REQ_DRAG_EDGE_MAX_SPEED);
        expect(edgePanVelocity({ x: 500, y: 600 }, size).vy).toBe(REQ_DRAG_EDGE_MAX_SPEED);
        expect(edgePanVelocity({ x: 500, y: 0 }, size).vy).toBe(-REQ_DRAG_EDGE_MAX_SPEED);
        const half = edgePanVelocity({ x: 1000 - REQ_DRAG_EDGE_PX / 2, y: 300 }, size).vx;
        expect(half).toBeCloseTo(REQ_DRAG_EDGE_MAX_SPEED / 2);
    });

    it('stops once the pointer has left the panel', () => {
        expect(edgePanVelocity({ x: 1001, y: 300 }, size)).toEqual({ vx: 0, vy: 0 });
        expect(edgePanVelocity({ x: -1, y: 300 }, size)).toEqual({ vx: 0, vy: 0 });
    });
});
