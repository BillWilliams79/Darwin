// Req #3586 — the plan visualizer's two add-epic actions: split an edge
// (A -> N -> B) and add a dependent epic (A -> N). What is pinned is the ORDER of
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
        const data = method === 'POST' && uri.endsWith('/epics') ? postData : null;
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data });
    }),
}));

import { insertEpicOnEdge, addDependentEpic, precedeEpicWith, createdRowOf } from '../epicsApi';

const URI = 'https://api/darwin';
const brief = () => calls.map(({ table, method, body }) => `${method} ${table} ${JSON.stringify(body)}`);

beforeEach(() => {
    calls.length = 0;
    fail = null;
    failStatus = 409;
    postData = [{ id: 99 }];
});

describe('insertEpicOnEdge', () => {
    const args = { fromEpicId: 1, toEpicId: 2, initiative_fk: 5, title: 'Mid' };

    it('creates N, gates N on A, gates B on N, THEN removes B -> A', async () => {
        const created = await insertEpicOnEdge(URI, 'tok', args);
        expect(created).toEqual({ id: 99 });
        expect(calls.map((c) => `${c.method} ${c.table}`)).toEqual([
            'POST epics',
            'POST epic_deps',
            'POST epic_deps',
            'DELETE epic_deps',
        ]);
        expect(calls[0].body).toMatchObject({ initiative_fk: 5, title: 'Mid' });
        // An epic has no state (req #3750): a create never names `completed_at`.
        expect(calls[0].body).not.toHaveProperty('completed_at');
        expect(calls[1].body).toEqual({ epic_fk: 99, dep_epic_fk: 1 });
        expect(calls[2].body).toEqual({ epic_fk: 2, dep_epic_fk: 99 });
        expect(calls[3].body).toEqual({ epic_fk: 2, dep_epic_fk: 1 });
    });

    it('a refused B -> N edge deletes B -> N anyway (it may have landed), then N', async () => {
        fail = 2;
        await expect(insertEpicOnEdge(URI, 'tok', args)).rejects.toThrow(/createEpicDep/);
        expect(brief().slice(3)).toEqual([
            'DELETE epic_deps {"epic_fk":2,"dep_epic_fk":99}',
            'DELETE epics {"id":99}',
        ]);
    });

    it('a 404 on the final delete means the edge was already gone — success', async () => {
        fail = 3;
        failStatus = 404;
        await expect(insertEpicOnEdge(URI, 'tok', args)).resolves.toEqual({ id: 99 });
    });

    it('a refused N -> A edge deletes N and writes nothing else', async () => {
        fail = 1;
        await expect(insertEpicOnEdge(URI, 'tok', args)).rejects.toThrow();
        expect(brief().slice(2)).toEqual(['DELETE epics {"id":99}']);
    });

    it('a refused final delete is flagged redundantEdge and NOT rolled back', async () => {
        fail = 3;
        const err = await insertEpicOnEdge(URI, 'tok', args).catch((e) => e);
        expect(err.redundantEdge).toBe(true);
        expect(calls).toHaveLength(4);
    });

    it('a create whose id cannot be read back writes no edges', async () => {
        postData = null;
        const err = await insertEpicOnEdge(URI, 'tok', args).catch((e) => e);
        expect(err.message).toMatch(/id could not be read/);
        expect(err.orphanEpic).toBe(true);
        expect(calls).toHaveLength(1);
    });
});

describe('addDependentEpic', () => {
    it('creates N and gates it on the one epic', async () => {
        await addDependentEpic(URI, 'tok', { fromEpicId: 7, initiative_fk: 5, title: 'Side' });
        expect(brief().slice(1)).toEqual(['POST epic_deps {"epic_fk":99,"dep_epic_fk":7}']);
    });

    it('a refused edge deletes the new epic', async () => {
        fail = 1;
        await expect(addDependentEpic(URI, 'tok', { fromEpicId: 7, initiative_fk: 5, title: 'S' }))
            .rejects.toThrow();
        expect(brief().slice(2)).toEqual(['DELETE epics {"id":99}']);
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
describe('precedeEpicWith', () => {
    const args = { toEpicId: 2, initiative_fk: 5, title: 'Before' };

    it('creates N, then gates T on N — nothing else', async () => {
        await expect(precedeEpicWith(URI, 'tok', args)).resolves.toEqual({ id: 99 });
        expect(brief().slice(1)).toEqual(['POST epic_deps {"epic_fk":2,"dep_epic_fk":99}']);
        expect(calls[0].body).toMatchObject({ initiative_fk: 5, title: 'Before' });
    });

    it('a refused T -> N edge deletes T -> N anyway (it may have landed), then N', async () => {
        fail = 1;
        await expect(precedeEpicWith(URI, 'tok', args)).rejects.toThrow(/createEpicDep/);
        expect(brief().slice(2)).toEqual([
            'DELETE epic_deps {"epic_fk":2,"dep_epic_fk":99}',
            'DELETE epics {"id":99}',
        ]);
    });

    it('a create whose id cannot be read back writes no edge and is flagged orphanEpic', async () => {
        postData = [];
        await expect(precedeEpicWith(URI, 'tok', args)).rejects.toMatchObject({ orphanEpic: true });
        expect(calls).toHaveLength(1);
    });
});
