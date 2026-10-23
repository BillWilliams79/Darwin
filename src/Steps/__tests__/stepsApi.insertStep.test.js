// Req #3586 — the plan visualizer's two add-step actions: split an edge
// (A -> N -> B) and add a dependent step (A -> N). What is pinned is the ORDER of
// writes, because the order is what keeps B gated at every instant.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
// `fail` names the Nth call (0-based) that is refused with a 409.
let fail = null;
let failStatus = 409;
let postData = [{ id: 99 }];
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        const n = calls.length;
        calls.push({ table: uri.split('/').pop(), method, body });
        if (n === fail) return Promise.resolve({ httpStatus: { httpStatus: failStatus }, data: null });
        const data = method === 'POST' && uri.endsWith('/pipeline_steps') ? postData : null;
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data });
    }),
}));

import { insertStepOnEdge, addDependentStep, precedeStepWith, createdRowOf } from '../stepsApi';

const URI = 'https://api/darwin';
const brief = () => calls.map(({ table, method, body }) => `${method} ${table} ${JSON.stringify(body)}`);

beforeEach(() => {
    calls.length = 0;
    fail = null;
    failStatus = 409;
    postData = [{ id: 99 }];
});

describe('insertStepOnEdge', () => {
    const args = { fromStepId: 1, toStepId: 2, initiative_fk: 5, title: 'Mid' };

    it('creates N, gates N on A, gates B on N, THEN removes B -> A', async () => {
        const created = await insertStepOnEdge(URI, 'tok', args);
        expect(created).toEqual({ id: 99 });
        expect(calls.map((c) => `${c.method} ${c.table}`)).toEqual([
            'POST pipeline_steps',
            'POST pipeline_step_deps',
            'POST pipeline_step_deps',
            'DELETE pipeline_step_deps',
        ]);
        expect(calls[0].body).toMatchObject({ initiative_fk: 5, title: 'Mid' });
        // A step has no state (req #3750): a create never names `completed_at`.
        expect(calls[0].body).not.toHaveProperty('completed_at');
        expect(calls[1].body).toEqual({ step_fk: 99, dep_step_fk: 1 });
        expect(calls[2].body).toEqual({ step_fk: 2, dep_step_fk: 99 });
        expect(calls[3].body).toEqual({ step_fk: 2, dep_step_fk: 1 });
    });

    it('a refused B -> N edge deletes B -> N anyway (it may have landed), then N', async () => {
        fail = 2;
        await expect(insertStepOnEdge(URI, 'tok', args)).rejects.toThrow(/createStepDep/);
        expect(brief().slice(3)).toEqual([
            'DELETE pipeline_step_deps {"step_fk":2,"dep_step_fk":99}',
            'DELETE pipeline_steps {"id":99}',
        ]);
    });

    it('a 404 on the final delete means the edge was already gone — success', async () => {
        fail = 3;
        failStatus = 404;
        await expect(insertStepOnEdge(URI, 'tok', args)).resolves.toEqual({ id: 99 });
    });

    it('a refused N -> A edge deletes N and writes nothing else', async () => {
        fail = 1;
        await expect(insertStepOnEdge(URI, 'tok', args)).rejects.toThrow();
        expect(brief().slice(2)).toEqual(['DELETE pipeline_steps {"id":99}']);
    });

    it('a refused final delete is flagged redundantEdge and NOT rolled back', async () => {
        fail = 3;
        const err = await insertStepOnEdge(URI, 'tok', args).catch((e) => e);
        expect(err.redundantEdge).toBe(true);
        expect(calls).toHaveLength(4);
    });

    it('a create whose id cannot be read back writes no edges', async () => {
        postData = null;
        const err = await insertStepOnEdge(URI, 'tok', args).catch((e) => e);
        expect(err.message).toMatch(/id could not be read/);
        expect(err.orphanStep).toBe(true);
        expect(calls).toHaveLength(1);
    });
});

describe('addDependentStep', () => {
    it('creates N and gates it on the one step', async () => {
        await addDependentStep(URI, 'tok', { fromStepId: 7, initiative_fk: 5, title: 'Side' });
        expect(brief().slice(1)).toEqual(['POST pipeline_step_deps {"step_fk":99,"dep_step_fk":7}']);
    });

    it('a refused edge deletes the new step', async () => {
        fail = 1;
        await expect(addDependentStep(URI, 'tok', { fromStepId: 7, initiative_fk: 5, title: 'S' }))
            .rejects.toThrow();
        expect(brief().slice(2)).toEqual(['DELETE pipeline_steps {"id":99}']);
    });
});

describe('createdRowOf', () => {
    it('reads the gateway array, a bare object, or nothing', () => {
        expect(createdRowOf([{ id: 3 }])).toEqual({ id: 3 });
        expect(createdRowOf({ id: 4 })).toEqual({ id: 4 });
        expect(createdRowOf(null)).toBeNull();
        expect(createdRowOf([])).toBeNull();
    });
});

// Req #3617 — the PRECEDE "+" off a card's free left side: N -> T.
describe('precedeStepWith', () => {
    const args = { toStepId: 2, initiative_fk: 5, title: 'Before' };

    it('creates N, then gates T on N — nothing else', async () => {
        await expect(precedeStepWith(URI, 'tok', args)).resolves.toEqual({ id: 99 });
        expect(brief().slice(1)).toEqual(['POST pipeline_step_deps {"step_fk":2,"dep_step_fk":99}']);
        expect(calls[0].body).toMatchObject({ initiative_fk: 5, title: 'Before' });
    });

    it('a refused T -> N edge deletes T -> N anyway (it may have landed), then N', async () => {
        fail = 1;
        await expect(precedeStepWith(URI, 'tok', args)).rejects.toThrow(/createStepDep/);
        expect(brief().slice(2)).toEqual([
            'DELETE pipeline_step_deps {"step_fk":2,"dep_step_fk":99}',
            'DELETE pipeline_steps {"id":99}',
        ]);
    });

    it('a create whose id cannot be read back writes no edge and is flagged orphanStep', async () => {
        postData = [];
        await expect(precedeStepWith(URI, 'tok', args)).rejects.toMatchObject({ orphanStep: true });
        expect(calls).toHaveLength(1);
    });
});
