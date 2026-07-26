// Req #3049 — the REST mutation layer for editable instructions.
//
// agentRegistryUtils.test.js covers the PURE planning helpers. This file covers
// the part that actually talks to the network, where the risk lives:
//
//   * `agent_instructions` has no `id` column, so every insert uses an ARRAY
//     body — one multi-value INSERT for N links instead of N round trips. It
//     began as a workaround: a single-object POST used to commit the row and
//     THEN return 500, because rest_post.py re-read it with `WHERE id = ...`.
//     Req #3057 fixed that (it now returns 201 with no body), so the array
//     body is a choice rather than a necessity — but it is still the right
//     choice, and it is what the assertions below lock. Lambda-Rest side:
//     tests/test_agent_instructions.py.
//   * A load-order change is DELETE + re-POST across two non-atomic Lambda
//     invocations under autocommit. The restore-on-failure path is the only
//     thing standing between a failed write and an agent booting without its
//     binding instructions — and it is unreachable from an integration test.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn() }));

import call_rest_api from '../../RestApi/RestApi';
import {
    linkAgentInstruction, linkAgentInstructions,
    unlinkAgentInstruction, setAgentInstructionOrder,
    createInstruction, updateInstruction, deleteInstruction,
} from '../actions/instructionsApi';

const URI = 'https://api.test/darwin_dev';
const TOKEN = 'id-token';

const ok = (status = 200, data = null) =>
    ({ data, httpStatus: { httpStatus: status, httpMessage: 'OK' } });

// call_rest_api rejects with a bare object (`throw {data, httpStatus}`), not an
// Error — the 404-tolerant paths read that shape directly.
const rejectWith = (status, httpMessage = '') =>
    Promise.reject({ data: null, httpStatus: { httpStatus: status, httpMessage } });

const calls = () => call_rest_api.mock.calls.map(
    ([url, method, body]) => ({ table: url.split('/').pop(), method, body }));

beforeEach(() => {
    call_rest_api.mockReset();
    call_rest_api.mockResolvedValue(ok(201, { inserted: 1 }));
});

describe('junction inserts never use the single-object POST path', () => {
    it('sends an ARRAY body even for one link', async () => {
        await linkAgentInstruction(URI, TOKEN, 7, 42, 3);

        const [c] = calls();
        expect(c.table).toBe('agent_instructions');
        expect(c.method).toBe('POST');
        expect(Array.isArray(c.body)).toBe(true);
        expect(c.body).toEqual([{ agent_fk: 7, instruction_fk: 42, sort_order: 3 }]);
    });

    it('normalizes every row to the same key set', async () => {
        // _rest_post_bulk builds ONE multi-value INSERT from the FIRST item's key
        // list and then reads `item[k]` on every later item. A row missing a key
        // raises KeyError inside the Lambda (an unhandled 500, not a pymysql
        // error); a row with EXTRA keys silently drops them. Both are prevented
        // by normalizing here, so assert the normalization rather than trusting it.
        await linkAgentInstructions(URI, TOKEN, [
            { agent_fk: 7, instruction_fk: 1, sort_order: 1, stray: 'x' },
            { agent_fk: 7, instruction_fk: 2 },
        ]);

        const [c] = calls();
        expect(c.body).toEqual([
            { agent_fk: 7, instruction_fk: 1, sort_order: 1 },
            { agent_fk: 7, instruction_fk: 2, sort_order: null },
        ]);
        expect(c.body.every(r => Object.keys(r).length === 3)).toBe(true);
    });

    it('issues no request at all for an empty row list', async () => {
        expect(await linkAgentInstructions(URI, TOKEN, [])).toBeNull();
        expect(call_rest_api).not.toHaveBeenCalled();
    });
});

describe('unlinkAgentInstruction', () => {
    it('deletes by composite key', async () => {
        await unlinkAgentInstruction(URI, TOKEN, 7, 42);
        expect(calls()[0]).toEqual({
            table: 'agent_instructions', method: 'DELETE',
            body: { agent_fk: 7, instruction_fk: 42 },
        });
    });

    it('reports true when a row was actually removed', async () => {
        await expect(unlinkAgentInstruction(URI, TOKEN, 7, 42)).resolves.toBe(true);
    });

    it('swallows a 404 and reports false — an absent link IS the desired end state', async () => {
        // The boolean matters: setAgentInstructionOrder restores only what it
        // genuinely deleted, so resurrecting a row that was never there is itself
        // a corruption it has to avoid.
        call_rest_api.mockReturnValue(rejectWith(404, 'NOT FOUND'));
        await expect(unlinkAgentInstruction(URI, TOKEN, 7, 42)).resolves.toBe(false);
    });

    it('rethrows anything that is not a 404', async () => {
        call_rest_api.mockReturnValue(rejectWith(500, 'SQL FAILED'));
        await expect(unlinkAgentInstruction(URI, TOKEN, 7, 42)).rejects.toMatchObject(
            { httpStatus: { httpStatus: 500 } });
    });
});

describe('setAgentInstructionOrder — the non-atomic reorder', () => {
    const rows = [
        { agent_fk: 7, instruction_fk: 10, sort_order: 2 },
        { agent_fk: 7, instruction_fk: 11, sort_order: 1 },
    ];
    const originals = [
        { agent_fk: 7, instruction_fk: 10, sort_order: 1 },
        { agent_fk: 7, instruction_fk: 11, sort_order: 2 },
    ];

    it('deletes every affected row BEFORE re-posting any of them', async () => {
        await setAgentInstructionOrder(URI, TOKEN, rows, originals);

        expect(calls().map(c => c.method)).toEqual(['DELETE', 'DELETE', 'POST']);
        // One POST, not one per row — the whole point of the array body.
        expect(calls()[2].body).toEqual(rows);
    });

    it('touches only the two swapped rows', async () => {
        await setAgentInstructionOrder(URI, TOKEN, rows, originals);
        const touched = new Set(calls().flatMap(c =>
            Array.isArray(c.body) ? c.body.map(r => r.instruction_fk)
                                  : [c.body.instruction_fk]));
        expect([...touched].sort()).toEqual([10, 11]);
    });

    it('restores the ORIGINAL sort_orders when the re-POST fails', async () => {
        // The failure that matters: the DELETEs landed, the POST did not. Without
        // the restore the agent boots missing both instructions.
        call_rest_api
            .mockResolvedValueOnce(ok(200))                    // DELETE 10
            .mockResolvedValueOnce(ok(200))                    // DELETE 11
            .mockReturnValueOnce(rejectWith(500, 'bulk failed'))// POST (fails)
            .mockResolvedValueOnce(ok(201, { inserted: 2 }));  // restore POST

        await expect(setAgentInstructionOrder(URI, TOKEN, rows, originals))
            .rejects.toMatchObject({ httpStatus: { httpStatus: 500 } });

        const posts = calls().filter(c => c.method === 'POST');
        expect(posts).toHaveLength(2);
        expect(posts[1].body).toEqual(originals);   // pre-change state, restored
    });

    it('propagates the ORIGINAL error when the restore also fails', async () => {
        // A restore failure must not mask the real cause — the first error is the
        // one worth putting in front of a human.
        call_rest_api
            .mockResolvedValueOnce(ok(200))
            .mockResolvedValueOnce(ok(200))
            .mockReturnValueOnce(rejectWith(500, 'ORIGINAL bulk failure'))
            .mockReturnValueOnce(rejectWith(503, 'restore also failed'));

        await expect(setAgentInstructionOrder(URI, TOKEN, rows, originals))
            .rejects.toMatchObject({ httpStatus: { httpMessage: 'ORIGINAL bulk failure' } });
    });

    it('tolerates a DELETE that 404s — the row was already gone', async () => {
        call_rest_api
            .mockReturnValueOnce(rejectWith(404, 'NOT FOUND'))
            .mockResolvedValueOnce(ok(200))
            .mockResolvedValueOnce(ok(201, { inserted: 2 }));

        await expect(setAgentInstructionOrder(URI, TOKEN, rows, originals))
            .resolves.toBeTruthy();
        expect(calls().filter(c => c.method === 'POST')).toHaveLength(1);
    });

    it('restores what it already deleted when a MID-LOOP DELETE fails', async () => {
        // The DELETE loop is inside the same try as the re-POST, so a non-404
        // failure on the second delete restores the first row rather than leaving
        // the agent silently short a binding instruction.
        call_rest_api
            .mockResolvedValueOnce(ok(200))                     // DELETE 10 — lands
            .mockReturnValueOnce(rejectWith(500, 'SQL FAILED')) // DELETE 11 — fails
            .mockResolvedValueOnce(ok(201, { inserted: 1 }));   // restore POST

        await expect(setAgentInstructionOrder(URI, TOKEN, rows, originals))
            .rejects.toMatchObject({ httpStatus: { httpStatus: 500 } });

        const posts = calls().filter(c => c.method === 'POST');
        expect(posts).toHaveLength(1);
        // Only row 10 was actually deleted, so only row 10 is restored — at its
        // ORIGINAL sort_order.
        expect(posts[0].body).toEqual([
            { agent_fk: 7, instruction_fk: 10, sort_order: 1 },
        ]);
    });

    it('does not resurrect a link that was already absent', async () => {
        // DELETE 10 → 404 (already gone), DELETE 11 lands, then the POST fails.
        // Only row 11 was genuinely removed, so only row 11 may be restored.
        call_rest_api
            .mockReturnValueOnce(rejectWith(404, 'NOT FOUND'))  // DELETE 10
            .mockResolvedValueOnce(ok(200))                     // DELETE 11
            .mockReturnValueOnce(rejectWith(500, 'bulk failed'))// POST
            .mockResolvedValueOnce(ok(201, { inserted: 1 }));   // restore POST

        await expect(setAgentInstructionOrder(URI, TOKEN, rows, originals))
            .rejects.toMatchObject({ httpStatus: { httpStatus: 500 } });

        const posts = calls().filter(c => c.method === 'POST');
        expect(posts[1].body).toEqual([
            { agent_fk: 7, instruction_fk: 11, sort_order: 2 },
        ]);
    });

    it('does nothing for an empty plan', async () => {
        expect(await setAgentInstructionOrder(URI, TOKEN, [], originals)).toBeNull();
        expect(call_rest_api).not.toHaveBeenCalled();
    });
});

// The `syncInstructionAgents` suite was removed with the function in req #3063.
// Membership is now edited one chip at a time, so a bind IS `linkAgentInstruction`
// and an unbind IS `unlinkAgentInstruction` — both covered above, including the
// array-body requirement and the 404-tolerant delete. There is no longer a set
// diff to test, and the thing its tests were really guarding (a loop of
// independent writes presented to the user as one atomic save) no longer exists to
// be guarded.

describe('instruction row mutations', () => {
    it('PUT sends an array — rest_put.py requires one even for a single row', async () => {
        await updateInstruction(URI, TOKEN, 42, { closed: 1 });
        expect(calls()[0]).toEqual({
            table: 'instructions', method: 'PUT', body: [{ id: 42, closed: 1 }],
        });
    });

    it('PUT carries ONLY the column it was given (req #3063 one-PUT-per-field)', async () => {
        // Each ghost field commits alone. If the payload ever grew to the whole
        // row, a rejected name would take an edited body down with it and a stale
        // sibling field would silently overwrite a concurrent change.
        await updateInstruction(URI, TOKEN, 42, { name: 'renamed' });
        expect(calls()[0].body).toEqual([{ id: 42, name: 'renamed' }]);
        expect(Object.keys(calls()[0].body[0])).toEqual(['id', 'name']);
    });


    it('POST sends a single object — `instructions` HAS an id column', async () => {
        await createInstruction(URI, TOKEN,
            { name: 'n', content: 'c', creator_fk: 'sub' });
        const [c] = calls();
        expect(c.method).toBe('POST');
        expect(Array.isArray(c.body)).toBe(false);
        expect(c.body).toMatchObject({ name: 'n', content: 'c', closed: 0 });
        // Migration 072 dropped instructions.sort_order — sending it would now be
        // an unknown column.
        expect(c.body).not.toHaveProperty('sort_order');
    });

    it('DELETE targets the row by id', async () => {
        await deleteInstruction(URI, TOKEN, 42);
        expect(calls()[0]).toEqual({
            table: 'instructions', method: 'DELETE', body: { id: 42 },
        });
    });
});

describe('bind-all uses one bulk INSERT, not a loop (req #3063)', () => {
    // The bind-all pill binds every remaining agent behind one click. A loop of
    // single binds would be eleven sequential Lambda invocations AND would
    // reintroduce the half-applied-set failure the one-chip-one-write rule exists
    // to avoid. One array body is one multi-value INSERT: it lands or it doesn't.
    it('sends every link in a single array-body POST', async () => {
        await linkAgentInstructions(URI, TOKEN, [
            { agent_fk: 1, instruction_fk: 42, sort_order: 4 },
            { agent_fk: 2, instruction_fk: 42, sort_order: 7 },
            { agent_fk: 3, instruction_fk: 42, sort_order: 101 },
        ]);

        expect(call_rest_api).toHaveBeenCalledOnce();
        const [c] = calls();
        expect(c.method).toBe('POST');
        expect(Array.isArray(c.body)).toBe(true);
        expect(c.body).toHaveLength(3);
    });

    it('gives each agent its OWN slot rather than reusing one', async () => {
        // Slots are computed from one snapshot, which is safe only because every
        // row targets a different agent_fk — no two rows compete for one agent's
        // next slot. If this ever collapsed to a shared value, two instructions
        // would load at the same position for that agent, in arbitrary order.
        await linkAgentInstructions(URI, TOKEN, [
            { agent_fk: 1, instruction_fk: 42, sort_order: 4 },
            { agent_fk: 2, instruction_fk: 42, sort_order: 7 },
        ]);
        const slots = calls()[0].body.map(r => r.sort_order);
        expect(new Set(calls()[0].body.map(r => r.agent_fk)).size).toBe(2);
        expect(slots).toEqual([4, 7]);
    });
});
