// req #3583 — the pure half of the Plan visualizer's swarm-ready,
// not-orchestrated box: which rows it lists and where a drop lands.

import { describe, it, expect } from 'vitest';

import {
    unorchestratedSwarmReady, stepAcceptsNewWork, seatTargetAt,
    screenToWorld, screenRectOf, UNSEATED_REQ_MIME, resolveSeatDrop,
    unseatedBoxFontPx, UNSEATED_FONT_MIN, UNSEATED_FONT_MAX, bulkSeatRequest,
} from '../pipelineUnseated';
import { CARD_FONT } from '../pipelinePlanLayout';

describe('unorchestratedSwarmReady', () => {
    const reqs = [
        { id: 30, requirement_status: 'swarm_ready', title: 'c' },
        { id: 10, requirement_status: 'swarm_ready', title: 'a' },
        { id: 20, requirement_status: 'swarm_ready', title: 'b' },
        { id: 40, requirement_status: 'development', title: 'not ready' },
    ];

    it('lists swarm-ready requirements no step carries, ascending by id', () => {
        const junction = [{ step_fk: 7, requirement_fk: 20 }];
        expect(unorchestratedSwarmReady(reqs, junction).map((r) => r.id))
            .toEqual([10, 30]);
    });

    it('drops a non-swarm-ready row even if the read handed it over', () => {
        expect(unorchestratedSwarmReady(reqs, []).map((r) => r.id))
            .not.toContain(40);
    });

    it('matches junction ids across number/string encodings', () => {
        const junction = [{ step_fk: 1, requirement_fk: '10' }];
        expect(unorchestratedSwarmReady(
            [{ id: '10', requirement_status: 'swarm_ready' }], junction)).toEqual([]);
    });

    it('answers empty for missing input and does not mutate it', () => {
        expect(unorchestratedSwarmReady(undefined, [])).toEqual([]);
        const copy = reqs.slice();
        unorchestratedSwarmReady(reqs, undefined);
        expect(reqs).toEqual(copy);
    });
});

describe('seatTargetAt', () => {
    const nodes = new Map([
        [1, { frameLeft: 0, frameW: 100, top: 0, h: 50 }],
        [2, { frameLeft: 200, frameW: 100, top: 0, h: 50 }],
    ]);
    const rowById = new Map([
        [1, { id: 1, completedAt: null }],
        [2, { id: 2, completedAt: '2026-10-01T00:00:00' }],
    ]);

    it('resolves a point inside a card frame, edges inclusive', () => {
        expect(seatTargetAt(nodes, rowById, { x: 50, y: 25 })).toEqual({ stepId: 1, ok: true });
        expect(seatTargetAt(nodes, rowById, { x: 100, y: 50 })).toEqual({ stepId: 1, ok: true });
    });

    it('refuses a step with a stamped completed_at (design rule 1)', () => {
        expect(seatTargetAt(nodes, rowById, { x: 250, y: 10 })).toEqual({ stepId: 2, ok: false });
    });

    it('answers null between cards and without a point', () => {
        expect(seatTargetAt(nodes, rowById, { x: 150, y: 10 })).toBeNull();
        expect(seatTargetAt(nodes, rowById, null)).toBeNull();
    });

    it('treats a step with no plan row as unable to take work', () => {
        expect(seatTargetAt(nodes, new Map(), { x: 10, y: 10 })).toEqual({ stepId: 1, ok: false });
        expect(stepAcceptsNewWork(null)).toBe(false);
    });
});

describe('screen <-> world', () => {
    const t = { x: 40, y: -10, k: 2 };

    it('screenToWorld inverts screenRectOf', () => {
        const n = { frameLeft: 30, frameW: 60, top: 5, h: 20 };
        const r = screenRectOf(n, t);
        expect(r).toEqual({ left: 100, top: 0, width: 120, height: 40 });
        expect(screenToWorld({ x: r.left, y: r.top }, t)).toEqual({ x: 30, y: 5 });
    });

    it('refuses a degenerate transform', () => {
        expect(screenToWorld({ x: 1, y: 1 }, { x: 0, y: 0, k: 0 })).toBeNull();
    });

    it('uses a custom MIME so foreign drags are never ours', () => {
        expect(UNSEATED_REQ_MIME).not.toBe('text/plain');
    });
});

describe('resolveSeatDrop', () => {
    const nodes = new Map([[1, { frameLeft: 0, frameW: 100, top: 0, h: 50 }]]);
    const rowById = new Map([[1, { id: 1, completedAt: null }]]);
    const t = { x: 10, y: 40, k: 1 };

    it('projects the screen point through the transform onto a card', () => {
        expect(resolveSeatDrop({ point: { x: 60, y: 60 }, t, nodes, rowById }))
            .toEqual({ stepId: 1, ok: true });
    });

    it('lands nowhere over chrome or a chip, even with a card beneath', () => {
        expect(resolveSeatDrop({ point: { x: 60, y: 60 }, overChrome: true, t, nodes, rowById }))
            .toBeNull();
    });

    it('lands nowhere under the sticky ruler', () => {
        expect(resolveSeatDrop({ point: { x: 60, y: 45 }, rulerBottom: 50, t, nodes, rowById }))
            .toBeNull();
    });
});

describe('unseatedBoxFontPx', () => {
    it('tracks the requirement ids exactly between the bounds', () => {
        const k = 12 / CARD_FONT.req;
        expect(unseatedBoxFontPx(k)).toBeCloseTo(12, 6);
        expect(unseatedBoxFontPx(k * 1.2)).toBeCloseTo(14.4, 6);
    });

    it('holds 9px zoomed far out and 16px zoomed far in', () => {
        expect(unseatedBoxFontPx(0.05)).toBe(UNSEATED_FONT_MIN);
        expect(unseatedBoxFontPx(6.4)).toBe(UNSEATED_FONT_MAX);
        expect([UNSEATED_FONT_MIN, UNSEATED_FONT_MAX]).toEqual([9, 16]);
    });

    it('never answers NaN for a missing or degenerate scale', () => {
        expect(Number.isFinite(unseatedBoxFontPx(undefined))).toBe(true);
        expect(Number.isFinite(unseatedBoxFontPx(0))).toBe(true);
    });
});

// req #3608 — the whole box dropped on a step.
describe('bulkSeatRequest', () => {
    const rowById = new Map([[7, { id: 7, title: 'Build it' }], [8, { id: 8, title: 'Done' }]]);
    const items = [{ id: 12, title: 'B' }, { id: '11', title: 'A' }];

    it('carries every row in the box, bound for the step under the pointer', () => {
        expect(bulkSeatRequest(items, { stepId: 7, ok: true }, rowById)).toEqual({
            stepId: 7, stepTitle: 'Build it', ok: true,
            reqs: [{ id: 12, title: 'B' }, { id: 11, title: 'A' }],
        });
    });

    it('still answers for a stamped step, marked not ok, so the caller can say why', () => {
        expect(bulkSeatRequest(items, { stepId: 8, ok: false }, rowById).ok).toBe(false);
    });

    it('is nothing to ask with no step under the pointer or an empty box', () => {
        expect(bulkSeatRequest(items, null, rowById)).toBeNull();
        expect(bulkSeatRequest([], { stepId: 7, ok: true }, rowById)).toBeNull();
        expect(bulkSeatRequest([{ id: 'x' }], { stepId: 7, ok: true }, rowById)).toBeNull();
    });

    it('names a step the rows do not carry by its id', () => {
        expect(bulkSeatRequest(items, { stepId: 99, ok: true }, rowById).stepTitle)
            .toBe('step 99');
    });

    it('is a snapshot — later changes to the box do not reach it', () => {
        const live = [{ id: 5, title: 'x' }];
        const req = bulkSeatRequest(live, { stepId: 7, ok: true }, rowById);
        live.push({ id: 6, title: 'y' });
        expect(req.reqs.map((r) => r.id)).toEqual([5]);
    });
});
