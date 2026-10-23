// Req #3581 — the ONE browser implementation of a seat move, shared by the
// requirement page's epic picker and the plan visualizer's drag-and-drop.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let status = { DELETE: 200, POST: 200 };
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        calls.push({ uri, method, body });
        const st = status[method] ?? 200;
        if (st === 503) {
            // call_rest_api RETURNS a fetch-level failure rather than throwing.
            return Promise.resolve({ httpStatus: { httpStatus: 503 }, data: null });
        }
        return st >= 200 && st < 300
            ? Promise.resolve({ httpStatus: { httpStatus: st }, data: [] })
            : Promise.reject({ httpStatus: { httpStatus: st }, data: [] });
    }),
}));

import { moveEpicRequirement } from '../epicsApi';

const URI = 'https://api/darwin';

beforeEach(() => {
    calls.length = 0;
    status = { DELETE: 200, POST: 200 };
});

describe('moveEpicRequirement', () => {
    it('deletes the old seat (both columns) and THEN inserts the new', async () => {
        await moveEpicRequirement(URI, 'tok', { requirementId: 7, fromEpicId: 1, toEpicId: 2 });
        expect(calls.map(({ method, body }) => ({ method, body }))).toEqual([
            { method: 'DELETE', body: { epic_fk: 1, requirement_fk: 7 } },
            { method: 'POST', body: { epic_fk: 2, requirement_fk: 7 } },
        ]);
        expect(calls.every((c) => c.uri === `${URI}/epic_requirements`)).toBe(true);
    });

    it('only inserts for an unseated requirement, only deletes to unseat one', async () => {
        await moveEpicRequirement(URI, 'tok', { requirementId: 7, toEpicId: 2 });
        await moveEpicRequirement(URI, 'tok', { requirementId: 7, fromEpicId: 1 });
        expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE']);
    });

    it('writes nothing for a move onto the same epic', async () => {
        await moveEpicRequirement(URI, 'tok', { requirementId: 7, fromEpicId: 1, toEpicId: 1 });
        expect(calls).toEqual([]);
    });

    it('never inserts after a failed delete — a stale seat aborts the move', async () => {
        status.DELETE = 404;
        await expect(moveEpicRequirement(URI, 'tok',
            { requirementId: 7, fromEpicId: 1, toEpicId: 2 })).rejects.toBeTruthy();
        expect(calls.map((c) => c.method)).toEqual(['DELETE']);
    });

    it('treats a RETURNED fetch failure as a failure too', async () => {
        status.DELETE = 503;
        await expect(moveEpicRequirement(URI, 'tok',
            { requirementId: 7, fromEpicId: 1, toEpicId: 2 })).rejects.toThrow(/503/);
        expect(calls.map((c) => c.method)).toEqual(['DELETE']);
    });

    it('tags which half failed, so a caller can tell nothing-changed from seated-nowhere', async () => {
        status.DELETE = 404;
        const unseat = await moveEpicRequirement(URI, 'tok',
            { requirementId: 7, fromEpicId: 1, toEpicId: 2 }).catch((e) => e);
        expect(unseat.seatStage).toBe('unseat');

        status = { DELETE: 200, POST: 409 };
        const seat = await moveEpicRequirement(URI, 'tok',
            { requirementId: 7, fromEpicId: 1, toEpicId: 2 }).catch((e) => e);
        expect(seat.seatStage).toBe('seat');
    });
});
