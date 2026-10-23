// stepSeatLock.test.js — the live effective-lock check behind the
// requirement page's "+"-opened create (req #3750 review). A step has no state;
// what refuses a seat is a LOCK, and the lock cascades step -> initiative -> plan.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let rows;
const calls = [];
vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn((uri) => {
        calls.push(String(uri));
        const hit = Object.keys(rows).find((k) => String(uri).includes(k));
        if (hit === undefined) return Promise.reject(new Error('network'));
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: rows[hit] });
    }),
}));

import { readStepSeatLock, seatLockMessage } from '../stepSeatLock';

const chain = ({ step = 0, initiative = 0, plan = 0 } = {}) => ({
    '/pipeline_steps?id=412': [{ id: 412, locked: step, initiative_fk: 55 }],
    '/initiatives?id=55': [{ id: 55, locked: initiative, pipeline_fk: 7 }],
    '/pipelines?id=7': [{ id: 7, locked: plan }],
});

beforeEach(() => { calls.length = 0; });

describe('readStepSeatLock', () => {
    it('answers unlocked when no level of the chain is locked', async () => {
        rows = chain();
        expect(await readStepSeatLock('https://x/darwin_dev', 't', 412))
            .toEqual({ ok: true, lockedBy: null });
        expect(calls).toEqual([
            'https://x/darwin_dev/pipeline_steps?id=412&fields=id,locked,initiative_fk',
            'https://x/darwin_dev/initiatives?id=55&fields=id,locked,pipeline_fk',
            'https://x/darwin_dev/pipelines?id=7&fields=id,locked',
        ]);
    });

    it('names each level, the OUTERMOST lock winning', async () => {
        rows = chain({ step: 1 });
        expect((await readStepSeatLock('u', 't', 412)).lockedBy).toBe('step');
        rows = chain({ step: 1, initiative: '1' });
        expect((await readStepSeatLock('u', 't', 412)).lockedBy).toBe('initiative');
        rows = chain({ step: 1, initiative: 1, plan: true });
        expect((await readStepSeatLock('u', 't', 412)).lockedBy).toBe('pipeline');
    });

    it('reads "0" as unlocked — a TINYINT off the wire', async () => {
        rows = chain({ step: '0', initiative: '0', plan: '0' });
        expect((await readStepSeatLock('u', 't', 412)).lockedBy).toBeNull();
    });

    // "Cannot check" is never "not locked".
    it('fails closed when any read in the chain finds nothing or fails', async () => {
        rows = { ...chain(), '/initiatives?id=55': [] };
        expect((await readStepSeatLock('u', 't', 412)).ok).toBe(false);
        rows = { '/pipeline_steps?id=412': [{ id: 412, locked: 0, initiative_fk: 55 }],
            '/initiatives?id=55': [{ id: 55, locked: 0, pipeline_fk: 7 }] };
        expect((await readStepSeatLock('u', 't', 412)).ok).toBe(false);
        rows = {};
        expect((await readStepSeatLock('u', 't', 412)).ok).toBe(false);
    });
});

describe('seatLockMessage', () => {
    it('says which lock to lift', () => {
        expect(seatLockMessage(412, 'step'))
            .toBe('Step 412 is locked — it takes no new work; nothing was created');
        expect(seatLockMessage(412, 'initiative'))
            .toBe("Step 412's initiative is locked — it takes no new work; nothing was created");
        expect(seatLockMessage(412, 'pipeline'))
            .toBe("Step 412's plan is locked — it takes no new work; nothing was created");
    });
});
