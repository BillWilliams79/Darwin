// req #3861 — initiatives carry a HARD order the reader sets by dragging.
import { describe, it, expect } from 'vitest';
import { computePlanLayout } from '../pipelinePlanLayout';
import {
    nextInitiativeSortOrder, planInitiativeOrder, initiativeDropSlot, moveInitiativeInOrder,
    sortOrderWrites, initiativeOrderRefusal, applyInitiativeOrder,
    applyInitiativeOrderToInitiatives, initiativeOrderReflected,
} from '../pipelineInitiativeDrag';

// The shape `computePlanLayout` exports: `height`, never `h`.
const band = (initiativeId, y, height = 100) => ({ initiativeId, y, height });

describe('nextInitiativeSortOrder', () => {
    it('appends one past the plan\'s highest order', () => {
        expect(nextInitiativeSortOrder([{ sort_order: 3 }, { sort_order: 7 }, { sort_order: null }]))
            .toBe(8);
    });
    it('starts at 1 for an empty or wholly unordered plan', () => {
        expect(nextInitiativeSortOrder([])).toBe(1);
        expect(nextInitiativeSortOrder(null)).toBe(1);
        expect(nextInitiativeSortOrder([{ sort_order: null }])).toBe(1);
    });
});

describe('planInitiativeOrder', () => {
    it('is the stored order when every initiative is ordered and drawn', () => {
        const inits = [{ id: 1, sort_order: 2 }, { id: 2, sort_order: 1 }, { id: 3, sort_order: 3 }];
        expect(planInitiativeOrder(inits, [2, 1, 3])).toEqual([2, 1, 3]);
    });
    it('takes the drawn order for unordered rows, keeping a bandless initiative in its slot', () => {
        // 9 has no band (no epics); 4/5/6 are unordered and drawn 6, 4, 5.
        const inits = [{ id: 9, sort_order: 1 }, { id: 4 }, { id: 5 }, { id: 6 }];
        expect(planInitiativeOrder(inits, [6, 4, 5, null])).toEqual([9, 6, 4, 5]);
    });
    it('puts unordered rows after ordered ones, id as the tie-break', () => {
        expect(planInitiativeOrder([{ id: 8 }, { id: 3 }, { id: 5, sort_order: 4 }], []))
            .toEqual([5, 3, 8]);
    });
});

describe('initiativeDropSlot', () => {
    const bands = [band(1, 0), band(2, 100), band(3, 200), band(null, 300)];
    it('lands above the band whose middle the pointer is over the top half of', () => {
        const s = initiativeDropSlot(bands, 140, 3);
        expect(s).toMatchObject({ index: 1, beforeId: 2, afterId: 1, lineY: 100, noop: false });
    });
    it('is the bottom slot below the last initiative band, never under "No initiative"', () => {
        const s = initiativeDropSlot(bands, 900, 1);
        expect(s).toMatchObject({ index: 3, beforeId: null, afterId: 3, lineY: 300, noop: false });
    });
    it('is the top slot above the first band', () => {
        expect(initiativeDropSlot(bands, -50, 3)).toMatchObject({ index: 0, beforeId: 1, afterId: null, lineY: 0 });
    });
    it('is a no-op on either side of the dragged band itself', () => {
        expect(initiativeDropSlot(bands, 120, 2).noop).toBe(true);
        expect(initiativeDropSlot(bands, 180, 2).noop).toBe(true);
        expect(initiativeDropSlot(bands, 260, 2).noop).toBe(false);
    });
    it('follows the pointer across the bands a real layout draws', () => {
        const row = (id, initiativeId, initiativeSortOrder) => ({
            id, title: `E${id}`, initiativeId, initiative: `I${initiativeId}`, initiativeSortOrder,
            depIds: [], reqIds: [id * 10], launchReqIds: [], state: 'pending',
        });
        const { bands } = computePlanLayout([row(1, 7, 1), row(2, 8, 2), row(3, 9, 3)]);
        expect(bands.map((b) => b.initiativeId)).toEqual([7, 8, 9]);
        const [a, b, c] = bands;
        const mid = (x) => x.y + x.height / 2;
        expect(initiativeDropSlot(bands, mid(a) + 1, 7)).toMatchObject({ index: 1, noop: true });
        expect(initiativeDropSlot(bands, mid(b) + 1, 7)).toMatchObject(
            { index: 2, beforeId: 9, afterId: 8, noop: false });
        expect(initiativeDropSlot(bands, mid(c) + 1, 7)).toMatchObject(
            { index: 3, beforeId: null, afterId: 9, lineY: c.y + c.height, noop: false });
        expect(initiativeDropSlot(bands, mid(b) - 1, 9)).toMatchObject({ index: 1, beforeId: 8 });
    });

    it('answers null with no initiative bands', () => {
        expect(initiativeDropSlot([band(null, 0)], 10, 1)).toBeNull();
    });
});

describe('moveInitiativeInOrder', () => {
    it('moves above the named band', () => {
        expect(moveInitiativeInOrder([1, 2, 3, 4], 4, { beforeId: 2 })).toEqual([1, 4, 2, 3]);
    });
    it('moves below the last drawn band when there is none below', () => {
        // 9 is bandless and stays after.
        expect(moveInitiativeInOrder([1, 2, 3, 9], 1, { beforeId: null, afterId: 3 }))
            .toEqual([2, 3, 1, 9]);
    });
    it('leaves the order alone for a drop onto itself', () => {
        expect(moveInitiativeInOrder([1, 2, 3], 2, { beforeId: 2 })).toEqual([1, 2, 3]);
    });
});

describe('sortOrderWrites', () => {
    const w = (initiatives, order, locked) => sortOrderWrites(initiatives, order,
        { lockedInitiativeIds: locked });
    it('renumbers densely from 1 and writes only what changed', () => {
        const inits = [{ id: 1, sort_order: 1 }, { id: 2, sort_order: 2 }, { id: 3, sort_order: null }];
        expect(w(inits, [1, 3, 2])).toEqual({ writes: [
            { id: 3, sort_order: 2 }, { id: 2, sort_order: 3 }], blockedIds: [] });
    });
    it('gives every unordered row a value — the order becomes hard', () => {
        expect(w([{ id: 5 }, { id: 6 }], [6, 5]).writes).toEqual([
            { id: 6, sort_order: 1 }, { id: 5, sort_order: 2 }]);
    });
    it('writes nothing for an order already stored', () => {
        expect(w([{ id: 1, sort_order: 1 }, { id: 2, sort_order: '2' }], [1, 2]).writes).toEqual([]);
    });
    it('stays dense when the locked rows keep their dense values', () => {
        const inits = [{ id: 1, sort_order: 1 }, { id: 2, sort_order: 2 }, { id: 3, sort_order: 3 }];
        expect(w(inits, [1, 3, 2], [1])).toEqual({ writes: [
            { id: 3, sort_order: 2 }, { id: 2, sort_order: 3 }], blockedIds: [] });
    });
    it('numbers around a locked initiative rather than rewriting its place', () => {
        // 2 is locked at 2; 1 moves to the bottom — dense would rewrite 2 to 1.
        const inits = [{ id: 1, sort_order: 1 }, { id: 2, sort_order: 2 }, { id: 3, sort_order: 3 }];
        expect(w(inits, [2, 3, 1], [2])).toEqual({
            writes: [{ id: 1, sort_order: 4 }], blockedIds: [] });
        // ...and above it, below its value.
        expect(w(inits, [3, 2, 1], [2]).writes).toEqual([
            { id: 3, sort_order: 1 }, { id: 1, sort_order: 3 }]);
    });
    it('places a run between two anchors in the integers between them', () => {
        const inits = [{ id: 1, sort_order: 1 }, { id: 2, sort_order: 5 },
            { id: 3, sort_order: 6 }, { id: 4, sort_order: 9 }];
        expect(w(inits, [1, 3, 2, 4], [1, 4])).toEqual({ writes: [
            { id: 3, sort_order: 2 }, { id: 2, sort_order: 3 }], blockedIds: [] });
    });
    it('is blocked, naming the anchors, when the integers between them are too few', () => {
        const inits = [{ id: 1, sort_order: 1 }, { id: 2, sort_order: 2 }, { id: 3, sort_order: 3 }];
        expect(w(inits, [1, 3, 2], [1, 2])).toEqual({ writes: [], blockedIds: [1, 2] });
    });
    it('lets two locked initiatives tied on one value stand side by side', () => {
        const inits = [{ id: 1, sort_order: 1 }, { id: 2, sort_order: 5 },
            { id: 3, sort_order: 5 }, { id: 4, sort_order: 6 }];
        // 1 drops to the bottom; dense would rewrite the locked pair.
        expect(w(inits, [2, 3, 4, 1], [2, 3])).toEqual({
            writes: [{ id: 1, sort_order: 7 }], blockedIds: [] });
    });

    it('is blocked by a locked initiative with no place at all', () => {
        expect(w([{ id: 1 }, { id: 2, sort_order: 1 }], [2, 1], [1]))
            .toEqual({ writes: [], blockedIds: [1] });
    });
});

describe('initiativeOrderRefusal', () => {
    const plan = { writes: [{ id: 1, sort_order: 2 }], blockedIds: [] };
    it('refuses on a locked plan', () => {
        expect(initiativeOrderRefusal(plan, { planLocked: true })).toEqual({ lockedBy: 'pipeline', ids: [] });
    });
    it('names the locked initiatives the order cannot be numbered around', () => {
        expect(initiativeOrderRefusal({ writes: [], blockedIds: [2] }))
            .toEqual({ lockedBy: 'initiative', ids: [2] });
    });
    it('allows a re-order with room, and nothing at all is never refused', () => {
        expect(initiativeOrderRefusal(plan)).toBeNull();
        expect(initiativeOrderRefusal({ writes: [], blockedIds: [] }, { planLocked: true })).toBeNull();
    });
});

describe('the pending order overlay', () => {
    const overlay = new Map([[1, 2], [2, 1]]);
    it('rewrites each row\'s initiativeSortOrder and keeps untouched rows\' identity', () => {
        const rows = [{ id: 10, initiativeId: 1, initiativeSortOrder: 1 },
            { id: 11, initiativeId: 2, initiativeSortOrder: 2 },
            { id: 12, initiativeId: null, initiativeSortOrder: null }];
        const out = applyInitiativeOrder(rows, overlay);
        expect(out.map((r) => r.initiativeSortOrder)).toEqual([2, 1, null]);
        expect(out[2]).toBe(rows[2]);
        expect(applyInitiativeOrder(rows, new Map())).toBe(rows);
    });
    it('rewrites the initiatives list too', () => {
        expect(applyInitiativeOrderToInitiatives([{ id: 1, sort_order: 1 }, { id: 3 }], overlay))
            .toEqual([{ id: 1, sort_order: 2 }, { id: 3 }]);
    });
    it('is reflected once the server carries every written value', () => {
        expect(initiativeOrderReflected([{ id: 1, sort_order: 1 }, { id: 2, sort_order: 2 }], overlay))
            .toBe(false);
        expect(initiativeOrderReflected([{ id: 1, sort_order: 2 }, { id: 2, sort_order: '1' }], overlay))
            .toBe(true);
    });
});
