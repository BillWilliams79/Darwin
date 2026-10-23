// req #3583 — the pure half of the Plan visualizer's swarm-ready,
// not-orchestrated box: which rows it lists and where a drop lands.

import { describe, it, expect, vi } from 'vitest';

import {
    unorchestratedSwarmReady, epicAcceptsNewWork, seatTargetAt,
    screenToWorld, screenRectOf, UNSEATED_REQ_MIME, resolveSeatDrop,
    unseatedBoxFontPx, UNSEATED_FONT_MIN, UNSEATED_FONT_MAX, bulkSeatRequest,
    unseatedBoxWidthPx, UNSEATED_MIN_WIDTH_EM, unseatedBoxZoom, UNSEATED_MAX_EPICS_ACROSS,
    unseatedTextStep, unseatedResizedBox, unseatedMinStretchPx, UNSEATED_TEXT_RATIO,
    UNSEATED_MIN_LIST_EM,
    pointInRect, pointerCanSeat, runBulkSeat, bulkSeatFailureMessage,
} from '../pipelineUnseated';
import {
    CARD_FONT, CARD_FRAME_W, computePlanLayout, EPIC_WIDTH_RUNGS, epicsAcrossScale,
} from '../pipelinePlanLayout';

describe('unorchestratedSwarmReady', () => {
    const reqs = [
        { id: 30, requirement_status: 'swarm_ready', title: 'c' },
        { id: 10, requirement_status: 'swarm_ready', title: 'a' },
        { id: 20, requirement_status: 'swarm_ready', title: 'b' },
        { id: 40, requirement_status: 'development', title: 'not ready' },
    ];

    it('lists swarm-ready requirements no epic carries, ascending by id', () => {
        const junction = [{ epic_fk: 7, requirement_fk: 20 }];
        expect(unorchestratedSwarmReady(reqs, junction).map((r) => r.id))
            .toEqual([10, 30]);
    });

    it('drops a non-swarm-ready row even if the read handed it over', () => {
        expect(unorchestratedSwarmReady(reqs, []).map((r) => r.id))
            .not.toContain(40);
    });

    it('matches junction ids across number/string encodings', () => {
        const junction = [{ epic_fk: 1, requirement_fk: '10' }];
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
        [1, { id: 1 }],
        [2, { id: 2, effectiveLocked: true }],
    ]);

    it('resolves a point inside a card frame, edges inclusive', () => {
        expect(seatTargetAt(nodes, rowById, { x: 50, y: 25 })).toEqual({ epicId: 1, ok: true });
        expect(seatTargetAt(nodes, rowById, { x: 100, y: 50 })).toEqual({ epicId: 1, ok: true });
    });

    it('refuses an effectively locked epic (req #3649 — the gateway answers 423)', () => {
        expect(seatTargetAt(nodes, rowById, { x: 250, y: 10 })).toEqual({ epicId: 2, ok: false });
    });

    // req #3750 — an epic has no state, so finished work never closes it.
    it('accepts an epic whose work is all finished', () => {
        expect(epicAcceptsNewWork({ id: 3, state: 'done' })).toBe(true);
    });

    it('answers null between cards and without a point', () => {
        expect(seatTargetAt(nodes, rowById, { x: 150, y: 10 })).toBeNull();
        expect(seatTargetAt(nodes, rowById, null)).toBeNull();
    });

    it('treats an epic with no plan row as unable to take work', () => {
        expect(seatTargetAt(nodes, new Map(), { x: 10, y: 10 })).toEqual({ epicId: 1, ok: false });
        expect(epicAcceptsNewWork(null)).toBe(false);
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
    const rowById = new Map([[1, { id: 1 }]]);
    const t = { x: 10, y: 40, k: 1 };

    it('projects the screen point through the transform onto a card', () => {
        expect(resolveSeatDrop({ point: { x: 60, y: 60 }, t, nodes, rowById }))
            .toEqual({ epicId: 1, ok: true });
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

// req #3620 — the box is as wide as an epic card, whatever the rung and zoom.
describe('unseatedBoxWidthPx', () => {
    const rows = [{ id: 1, name: 'A', depIds: [], requirementIds: [] }];
    // The zoom at which the box's type hits its 16px ceiling.
    const kMaxFont = UNSEATED_FONT_MAX / CARD_FONT.req;

    it('is the card frame through the zoom wherever the card is wider', () => {
        expect(unseatedBoxWidthPx(600, 1)).toBe(600);
        expect(unseatedBoxWidthPx(600, 2.5)).toBe(1500);
    });

    it('never goes narrower than its title bar, zoomed far out', () => {
        // Plan 7 opens near k=0.05: a ~18px card, the type at its 9px floor.
        expect(unseatedBoxWidthPx(358, 0.05)).toBe(UNSEATED_MIN_WIDTH_EM * UNSEATED_FONT_MIN);
        expect(UNSEATED_MIN_WIDTH_EM * UNSEATED_FONT_MIN).toBe(162);
    });

    it('is exactly the card wherever the type tracks the ids, every rung', () => {
        const kMinFont = UNSEATED_FONT_MIN / CARD_FONT.req;
        EPIC_WIDTH_RUNGS.forEach((rung) => {
            const frameW = computePlanLayout(rows, { epicWidthLevel: rung }).cardFrameW;
            [kMinFont, 0.6, 1, kMaxFont, 3].forEach((k) => {
                // The 3/4 card (req #3648) can be narrower than the box's own
                // title bar, which is the box's floor at any rung.
                const floor = UNSEATED_MIN_WIDTH_EM * unseatedBoxFontPx(k);
                expect(unseatedBoxWidthPx(frameW, k))
                    .toBeCloseTo(Math.max(frameW * k, floor), 6);
            });
        });
    });

    it('mirrors every rung\'s drawn card frame, the seat outline\'s width', () => {
        EPIC_WIDTH_RUNGS.forEach((rung) => {
            const layout = computePlanLayout(rows, { epicWidthLevel: rung });
            const node = [...layout.nodes.values()][0];
            const k = 2;
            const t = { k, x: 0, y: 0 };
            expect(unseatedBoxWidthPx(layout.cardFrameW, k))
                .toBeCloseTo(screenRectOf(node, t).width, 6);
        });
        const wide = computePlanLayout(rows, { epicWidthLevel: 6 }).cardFrameW;
        expect(wide).toBeGreaterThan(CARD_FRAME_W);
    });

    it('an empty plan still answers its rung\'s frame width', () => {
        expect(computePlanLayout([], { epicWidthLevel: 4 }).cardFrameW).toBe(CARD_FRAME_W);
    });

    it('never answers NaN for a missing width or degenerate scale', () => {
        expect(Number.isFinite(unseatedBoxWidthPx(undefined, 1))).toBe(true);
        expect(Number.isFinite(unseatedBoxWidthPx(CARD_FRAME_W, 0))).toBe(true);
        expect(Number.isFinite(unseatedBoxWidthPx(NaN, undefined))).toBe(true);
    });
});

// req #3654 — the reader's stretch, and the three text sizes it allows.
describe('unseatedTextStep', () => {
    it('is one size smaller a full step narrower, one bigger a full step wider', () => {
        expect(unseatedTextStep(1)).toBe(0);
        expect(unseatedTextStep(0.9)).toBe(0);
        expect(unseatedTextStep(1.2)).toBe(0);
        expect(unseatedTextStep(1 / UNSEATED_TEXT_RATIO)).toBe(-1);
        expect(unseatedTextStep(UNSEATED_TEXT_RATIO)).toBe(1);
    });

    it('never goes past one size either way, however far it is stretched', () => {
        expect(unseatedTextStep(0.1)).toBe(-1);
        expect(unseatedTextStep(40)).toBe(1);
    });

    it('treats a missing or degenerate scale as unstretched', () => {
        expect(unseatedTextStep(undefined)).toBe(0);
        expect(unseatedTextStep(0)).toBe(0);
        expect(unseatedTextStep(-2)).toBe(0);
        expect(unseatedTextStep(NaN)).toBe(0);
    });
});

describe('unseatedResizedBox', () => {
    it('is the zoom size, untouched, when never stretched', () => {
        expect(unseatedResizedBox(400, 12, null))
            .toEqual({ widthPx: 400, fontPx: 12, step: 0, listHeightPx: null });
    });

    it('draws exactly three type sizes across every stretch', () => {
        const sizes = new Set([0.2, 0.5, 0.8, 0.9, 1, 1.1, 1.25, 2, 5, 30]
            .map((ws) => unseatedResizedBox(600, 12, { ws, hEm: null }).fontPx));
        expect([...sizes].sort((a, b) => a - b)).toEqual([12 / 1.25, 12, 15]);
    });

    it('follows the stretch in width, and keeps tracking the zoom', () => {
        expect(unseatedResizedBox(400, 12, { ws: 1.5, hEm: null }).widthPx).toBe(600);
        // Same stretch, zoomed in: the box is twice as wide, the type twice as big.
        const zoomed = unseatedResizedBox(800, 24, { ws: 1.5, hEm: 10 });
        expect(zoomed.widthPx).toBe(1200);
        expect(zoomed.fontPx).toBe(30);
        expect(zoomed.listHeightPx).toBe(240);
    });

    it('never narrower than its title bar in the type it is drawn in', () => {
        // At the zoom floor the box is exactly its title bar wide: shrinking
        // part of an epic holds it there; a full epic drops the type a size.
        const floor = UNSEATED_MIN_WIDTH_EM * 9;
        expect(unseatedResizedBox(floor, 9, { ws: 0.9 }).widthPx).toBe(floor);
        const small = unseatedResizedBox(floor, 9, { ws: 0.5 });
        expect(small.step).toBe(-1);
        expect(small.widthPx).toBeCloseTo(unseatedMinStretchPx(9), 6);
        expect(small.widthPx).toBeCloseTo(UNSEATED_MIN_WIDTH_EM * small.fontPx, 6);
    });

    it('holds a stretched list at least about two rows tall', () => {
        expect(unseatedResizedBox(400, 10, { ws: 1, hEm: 0.5 }).listHeightPx)
            .toBe(UNSEATED_MIN_LIST_EM * 10);
    });

    it('ignores a corrupt stretch', () => {
        expect(unseatedResizedBox(400, 12, { ws: 'x', hEm: -3 }))
            .toEqual({ widthPx: 400, fontPx: 12, step: 0, listHeightPx: null });
    });
});

// req #3608 — the whole box dropped on an epic.
describe('bulkSeatRequest', () => {
    const rowById = new Map([[7, { id: 7, title: 'Build it' }], [8, { id: 8, title: 'Done' }]]);
    const items = [{ id: 12, title: 'B' }, { id: '11', title: 'A' }];

    it('carries every row in the box, bound for the epic under the pointer', () => {
        expect(bulkSeatRequest(items, { epicId: 7, ok: true }, rowById)).toEqual({
            epicId: 7, epicTitle: 'Build it', ok: true,
            reqs: [{ id: 12, title: 'B' }, { id: 11, title: 'A' }],
        });
    });

    it('still answers for a locked epic, marked not ok, so the caller can say why', () => {
        expect(bulkSeatRequest(items, { epicId: 8, ok: false }, rowById).ok).toBe(false);
    });

    it('is nothing to ask with no epic under the pointer or an empty box', () => {
        expect(bulkSeatRequest(items, null, rowById)).toBeNull();
        expect(bulkSeatRequest([], { epicId: 7, ok: true }, rowById)).toBeNull();
        expect(bulkSeatRequest([{ id: 'x' }], { epicId: 7, ok: true }, rowById)).toBeNull();
    });

    it('names an epic the rows do not carry by its id', () => {
        expect(bulkSeatRequest(items, { epicId: 99, ok: true }, rowById).epicTitle)
            .toBe('epic 99');
    });

    it('is a snapshot — later changes to the box do not reach it', () => {
        const live = [{ id: 5, title: 'x' }];
        const req = bulkSeatRequest(live, { epicId: 7, ok: true }, rowById);
        live.push({ id: 6, title: 'y' });
        expect(req.reqs.map((r) => r.id)).toEqual([5]);
    });
});

// req #3614 — the release point must be on the plan panel, over something.
describe('pointInRect / pointerCanSeat', () => {
    const rect = { left: 10, top: 20, right: 110, bottom: 220 };
    it('is inclusive of the edges and false for a null rect or NaN', () => {
        expect(pointInRect(10, 20, rect)).toBe(true);
        expect(pointInRect(110, 220, rect)).toBe(true);
        expect(pointInRect(9, 50, rect)).toBe(false);
        expect(pointInRect(50, 221, rect)).toBe(false);
        expect(pointInRect(50, 50, null)).toBe(false);
        expect(pointInRect(NaN, 50, rect)).toBe(false);
    });
    it('needs both the panel and an element beneath', () => {
        const el = {};
        expect(pointerCanSeat(50, 50, rect, el)).toBe(true);
        // Past the window edge: elementsFromPoint answers [] — nothing beneath.
        expect(pointerCanSeat(50, 50, rect, undefined)).toBe(false);
        // Outside the panel, even over an element.
        expect(pointerCanSeat(500, 50, rect, el)).toBe(false);
    });
});

describe('runBulkSeat', () => {
    it('seats every id, never more than `concurrency` at once, and reports failures', async () => {
        let inflight = 0;
        let peak = 0;
        const seat = vi.fn(async (id) => {
            inflight += 1;
            peak = Math.max(peak, inflight);
            await new Promise((r) => setTimeout(r, 5));
            inflight -= 1;
            if (id === 3) throw Object.assign(new Error('x'), { httpStatus: { httpStatus: 409 } });
        });
        const ids = [1, 2, 3, 4, 5, 6, 7];
        const failed = await runBulkSeat(ids, seat, 3);
        expect(seat.mock.calls.map((c) => c[0]).sort()).toEqual(ids);
        expect(peak).toBe(3);
        expect(failed.map((f) => f.id)).toEqual([3]);
    });
    it('copes with fewer ids than workers and with none', async () => {
        const seat = vi.fn(async () => {});
        expect(await runBulkSeat([9], seat, 4)).toEqual([]);
        expect(seat).toHaveBeenCalledTimes(1);
        expect(await runBulkSeat([], seat, 4)).toEqual([]);
    });
});

describe('bulkSeatFailureMessage', () => {
    const f = (id, status) => ({ id, error: status ? { httpStatus: { httpStatus: status } } : new Error('x') });
    it('is null when nothing failed', () => {
        expect(bulkSeatFailureMessage(3, [])).toBeNull();
    });
    it('names each failed id with its own status', () => {
        expect(bulkSeatFailureMessage(5, [f(12, 500), f(11, 409)]))
            .toBe('Added 3 of 5; unable to add 11 (409), 12 (500)');
    });
    it('says plainly when every one failed, and tolerates a missing status', () => {
        expect(bulkSeatFailureMessage(2, [f(11, 409), f(12)]))
            .toBe('Unable to add 11 (409), 12 to the epic');
    });
});

// req #3648 — "Orchestrables shouldn't get any bigger than it is at six window
// widths": the box follows the zoom only up to the six-epics-across scale.
describe('unseatedBoxZoom — capped at six epics across (req #3648)', () => {
    const VW = 1600;
    const pitch = 600;
    const k6 = epicsAcrossScale(UNSEATED_MAX_EPICS_ACROSS, VW, pitch);

    it('follows the zoom below six across', () => {
        expect(unseatedBoxZoom(k6 / 2, VW, pitch)).toBe(k6 / 2);
    });

    it('holds at the six-across scale when zoomed further in', () => {
        expect(unseatedBoxZoom(k6 * 3, VW, pitch)).toBe(k6);
        const at6 = unseatedBoxWidthPx(CARD_FRAME_W, unseatedBoxZoom(k6, VW, pitch));
        const past = unseatedBoxWidthPx(CARD_FRAME_W, unseatedBoxZoom(k6 * 3, VW, pitch));
        expect(past).toBe(at6);
        expect(unseatedBoxFontPx(unseatedBoxZoom(k6 * 3, VW, pitch)))
            .toBe(unseatedBoxFontPx(k6));
    });

    it('passes the zoom through when the viewport is not measured yet', () => {
        expect(unseatedBoxZoom(2, 0, pitch)).toBe(2);
    });
});
