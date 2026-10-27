// req #3967 — the initiative editor's delete: the live read of what it touches
// (`planInitiativeDelete`) and the delete with the reader's choices
// (`deleteInitiativeWithOptions`) — epics deleted or moved, requirements kept
// or deleted, every dependency onto what goes detached, rollback on failure.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls = [];
let respond;
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        calls.push({ uri, method, body });
        return Promise.resolve(respond(uri, method, body));
    }),
}));

import { planInitiativeDelete, deleteInitiativeWithOptions, moveClosesGateCycle } from '../initiativesApi';

const URI = 'http://test.local/darwin';
const ok = (data = []) => ({ httpStatus: { httpStatus: 200 }, data });
const notFound = () => ({ httpStatus: { httpStatus: 404, httpMessage: 'NOT FOUND' }, data: [] });
const okOrEmpty = (rows) => (rows.length ? ok(rows) : notFound());

const DEFAULTS = {
    epics: [
        { id: 500, title: 'A', initiative_fk: 40, locked: 0 },
        { id: 501, title: 'B', initiative_fk: 40, locked: 0 },
        { id: 600, title: 'Out', initiative_fk: 41, locked: 0 },
    ],
    epicDeps: [
        { id: 11, epic_fk: 501, dep_epic_fk: 500 },
        { id: 12, epic_fk: 600, dep_epic_fk: 501 },
    ],
    initiativeDeps: [{ id: 3, initiative_fk: 42, dep_initiative_fk: 40 }],
};

// Initiative 40 in plan 7, beside 41 and 42. Its epics 500, 501 (501 waits on
// 500); epic 600 (initiative 41) waits on 501; initiative 42 waits on 40.
function world(overrides = {}) {
    const w = {
        plan: { id: 7, locked: 0 },
        initiatives: [
            { id: 40, title: 'Doomed', pipeline_fk: 7, locked: 0, sort_order: 1 },
            { id: 41, title: 'Keeper', pipeline_fk: 7, locked: 0, sort_order: 2 },
            { id: 42, title: 'Waiter', pipeline_fk: 7, locked: 0, sort_order: 3 },
        ],
        epics: DEFAULTS.epics,
        seats: [{ epic_fk: 500, requirement_fk: 9002 }, { epic_fk: 501, requirement_fk: 9001 }],
        epicDeps: DEFAULTS.epicDeps,
        initiativeDeps: DEFAULTS.initiativeDeps,
        fail: {},
        ...overrides,
    };
    return (uri, method) => {
        const key = `${method} ${uri.replace(URI, '')}`;
        if (w.fail[key]) return w.fail[key];
        if (method !== 'GET') return method === 'POST' ? { httpStatus: { httpStatus: 201 }, data: [{ id: 1 }] } : ok();
        const q = uri.slice(uri.indexOf('?') + 1);
        const param = (name) => new URLSearchParams(q).get(name);
        const inIds = (v) => (v.startsWith('(') ? v.slice(1, -1).split(',').map(Number) : [Number(v)]);
        if (uri.includes('/pipelines?')) return ok([w.plan]);
        if (uri.includes('/initiatives?')) {
            if (param('id')) return okOrEmpty(w.initiatives.filter((r) => r.id === Number(param('id'))));
            return okOrEmpty(w.initiatives.filter((r) => r.pipeline_fk === Number(param('pipeline_fk'))));
        }
        if (uri.includes('/epics?')) {
            if (param('id')) return okOrEmpty(w.epics.filter((r) => inIds(param('id')).includes(r.id)));
            return okOrEmpty(w.epics.filter((r) => inIds(param('initiative_fk')).includes(r.initiative_fk)));
        }
        if (uri.includes('/epic_requirements?')) {
            return okOrEmpty(w.seats.filter((r) => inIds(param('epic_fk')).includes(r.epic_fk)));
        }
        if (uri.includes('/epic_deps?')) {
            if (param('epic_fk')) return okOrEmpty(w.epicDeps.filter((r) => inIds(param('epic_fk')).includes(r.epic_fk)));
            return okOrEmpty(w.epicDeps.filter((r) => inIds(param('dep_epic_fk')).includes(r.dep_epic_fk)));
        }
        if (uri.includes('/initiative_deps?')) {
            if (param('initiative_fk')) {
                return okOrEmpty(w.initiativeDeps.filter((r) => inIds(param('initiative_fk')).includes(r.initiative_fk)));
            }
            return okOrEmpty(w.initiativeDeps.filter((r) => r.dep_initiative_fk === Number(param('dep_initiative_fk'))));
        }
        return notFound();
    };
}

world.defaults = DEFAULTS;

const writes = () => calls.filter((c) => c.method !== 'GET')
    .map(({ uri, method, body }) => ({ uri: uri.replace(URI, ''), method, body }));

beforeEach(() => {
    calls.length = 0;
    respond = world();
});

describe('planInitiativeDelete (req #3967)', () => {
    it('reads its epics, their requirements, the edges onto them and who waits on it', async () => {
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        expect(planned.epics).toEqual([{ id: 500, title: 'A' }, { id: 501, title: 'B' }]);
        expect(planned.reqIds).toEqual([9001, 9002]);
        expect(planned.epicEdges.map((r) => r.id)).toEqual([11, 12]);
        expect(planned.outsideDependents).toEqual([600]);
        expect(planned.waitingEdges.map((r) => r.id)).toEqual([3]);
        expect(planned.moveTargets).toEqual([{ id: 41, title: 'Keeper', cycle: false },
            { id: 42, title: 'Waiter', cycle: false }]);
        expect(planned.blocked).toBeNull();
        expect(planned.blockedDeletingEpics).toBeNull();
        expect(writes()).toEqual([]);
    });

    it('names a lock anywhere the delete would write', async () => {
        respond = world({ plan: { id: 7, locked: 1 } });
        expect((await planInitiativeDelete(URI, 'tok', 40)).blocked).toMatch(/plan is locked/);
        respond = world({ epics: [{ id: 500, title: 'A', initiative_fk: 40, locked: 1 }] });
        expect((await planInitiativeDelete(URI, 'tok', 40)).blocked).toMatch(/Epic 500 under it is locked/);
        respond = world({ epics: [
            { id: 501, title: 'B', initiative_fk: 40, locked: 0 },
            { id: 600, title: 'Out', initiative_fk: 41, locked: 1 },
        ] });
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        expect(planned.blocked).toBeNull();
        expect(planned.blockedDeletingEpics).toMatch(/Epic 600 waits on its epics and is locked/);
    });

    it('marks a move target whose gates would loop through the moved epics', async () => {
        // 41 waits for 42; epic 700 in 42 waits on epic 501. Moving 501 into 41
        // makes 501 wait on 700, which waits on 501.
        respond = world({
            epics: [...world.defaults.epics, { id: 700, title: 'W', initiative_fk: 42, locked: 0 }],
            epicDeps: [...world.defaults.epicDeps, { id: 13, epic_fk: 700, dep_epic_fk: 501 }],
            initiativeDeps: [...world.defaults.initiativeDeps, { id: 4, initiative_fk: 41, dep_initiative_fk: 42 }],
        });
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        expect(planned.moveTargets.map((t) => [t.id, t.cycle])).toEqual([[41, true], [42, false]]);
        await expect(deleteInitiativeWithOptions(URI, 'tok', planned,
            { deleteEpics: false, moveToInitiativeFk: 41 })).rejects.toMatchObject({ namedRefusal: true });
    });

    it('a locked sibling is no place to move epics, and blocks when it waits on this one', async () => {
        respond = world({ initiatives: [
            { id: 40, title: 'Doomed', pipeline_fk: 7, locked: 0 },
            { id: 42, title: 'Waiter', pipeline_fk: 7, locked: 1 },
        ] });
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        expect(planned.moveTargets).toEqual([]);
        expect(planned.blocked).toMatch(/Initiative 42 waits on it and is locked/);
    });

    it('refuses by name when the initiative is gone', async () => {
        respond = world({ initiatives: [] });
        await expect(planInitiativeDelete(URI, 'tok', 40)).rejects.toMatchObject({ namedRefusal: true });
    });
});

describe('deleteInitiativeWithOptions (req #3967)', () => {
    it('default: detaches who waits, detaches the edges onto its epics, deletes it — requirements kept', async () => {
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        calls.length = 0;
        const result = await deleteInitiativeWithOptions(URI, 'tok', planned);
        expect(writes()).toEqual([
            { uri: '/initiative_deps', method: 'DELETE', body: [{ id: 3 }] },
            { uri: '/epic_deps', method: 'DELETE', body: [{ id: 11 }, { id: 12 }] },
            { uri: '/initiatives', method: 'DELETE', body: { id: 40 } },
        ]);
        expect(result).toEqual({ id: 40, epicsDeleted: 2, epicsMoved: 0, requirementsDeleted: 0 });
    });

    it('deletes the requirements LAST, in one bulk DELETE', async () => {
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        calls.length = 0;
        await deleteInitiativeWithOptions(URI, 'tok', planned, { deleteRequirements: true });
        const w = writes();
        expect(w[w.length - 2]).toEqual({ uri: '/initiatives', method: 'DELETE', body: { id: 40 } });
        expect(w[w.length - 1]).toEqual(
            { uri: '/requirements', method: 'DELETE', body: [{ id: 9001 }, { id: 9002 }] });
    });

    it('keeping its epics MOVES them (edges intact), then deletes the initiative', async () => {
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        calls.length = 0;
        const result = await deleteInitiativeWithOptions(URI, 'tok', planned,
            { deleteEpics: false, moveToInitiativeFk: 41 });
        expect(writes()).toEqual([
            { uri: '/initiative_deps', method: 'DELETE', body: [{ id: 3 }] },
            { uri: '/epics', method: 'PUT',
              body: [{ id: 500, initiative_fk: 41 }, { id: 501, initiative_fk: 41 }] },
            { uri: '/initiatives', method: 'DELETE', body: { id: 40 } },
        ]);
        expect(result).toMatchObject({ epicsDeleted: 0, epicsMoved: 2 });
    });

    it('keeping its epics needs somewhere to move them', async () => {
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        calls.length = 0;
        await expect(deleteInitiativeWithOptions(URI, 'tok', planned, { deleteEpics: false }))
            .rejects.toMatchObject({ namedRefusal: true });
        expect(writes()).toEqual([]);
    });

    it('a blocked plan writes nothing', async () => {
        respond = world({ plan: { id: 7, locked: 1 } });
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        calls.length = 0;
        await expect(deleteInitiativeWithOptions(URI, 'tok', planned)).rejects.toMatchObject({
            namedRefusal: true, httpStatus: { httpStatus: 423 } });
        expect(writes()).toEqual([]);
    });

    it('a refused initiative delete restores the detached edges, and never deletes requirements', async () => {
        respond = world({ fail: { 'DELETE /initiatives': { httpStatus: { httpStatus: 423, httpMessage: 'Locked' }, data: [] } } });
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        calls.length = 0;
        await expect(deleteInitiativeWithOptions(URI, 'tok', planned, { deleteRequirements: true }))
            .rejects.toThrow(/deleteInitiative failed: HTTP 423/);
        const w = writes();
        expect(w.slice(3)).toEqual([
            { uri: '/epic_deps', method: 'POST', body: { epic_fk: 600, dep_epic_fk: 501 } },
            { uri: '/epic_deps', method: 'POST', body: { epic_fk: 501, dep_epic_fk: 500 } },
            { uri: '/initiative_deps', method: 'POST', body: { initiative_fk: 42, dep_initiative_fk: 40 } },
        ]);
        expect(w.some((c) => c.uri === '/requirements')).toBe(false);
    });

    it('a refused delete after a move moves the epics back', async () => {
        respond = world({ fail: { 'DELETE /initiatives': { httpStatus: { httpStatus: 500, httpMessage: 'x' }, data: [] } } });
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        calls.length = 0;
        await expect(deleteInitiativeWithOptions(URI, 'tok', planned,
            { deleteEpics: false, moveToInitiativeFk: 41 })).rejects.toThrow();
        expect(writes()[3]).toEqual({ uri: '/epics', method: 'PUT',
            body: [{ id: 500, initiative_fk: 40 }, { id: 501, initiative_fk: 40 }] });
    });

    it('a locked outside dependent blocks deleting the epics, not keeping them', async () => {
        respond = world({ epics: [...DEFAULTS.epics.slice(0, 2),
            { id: 600, title: 'Out', initiative_fk: 41, locked: 1 }] });
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        calls.length = 0;
        await expect(deleteInitiativeWithOptions(URI, 'tok', planned)).rejects.toMatchObject({
            httpStatus: { httpStatus: 423 } });
        expect(writes()).toEqual([]);
        await deleteInitiativeWithOptions(URI, 'tok', planned, { deleteEpics: false, moveToInitiativeFk: 42 });
        expect(writes().map((w) => w.uri)).toEqual(['/initiative_deps', '/epics', '/initiatives']);
    });

    it('refuses, writing nothing, when its epics changed since the panel read', async () => {
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        respond = world({ epics: [...DEFAULTS.epics, { id: 502, title: 'Late', initiative_fk: 40, locked: 0 }] });
        calls.length = 0;
        await expect(deleteInitiativeWithOptions(URI, 'tok', planned,
            { deleteEpics: false, moveToInitiativeFk: 41 })).rejects.toMatchObject({
            namedRefusal: true, message: expect.stringMatching(/epics changed since/) });
        expect(writes()).toEqual([]);
    });

    it('edges already gone (404) are not restored', async () => {
        respond = world({ fail: {
            'DELETE /epic_deps': notFound(),
            'DELETE /initiatives': { httpStatus: { httpStatus: 500, httpMessage: 'x' }, data: [] },
        } });
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        calls.length = 0;
        await expect(deleteInitiativeWithOptions(URI, 'tok', planned)).rejects.toThrow();
        expect(writes().filter((w) => w.method === 'POST').map((w) => w.uri)).toEqual(['/initiative_deps']);
    });

    it('a rollback that cannot restore says so, keeping the status', async () => {
        respond = world({ fail: {
            'DELETE /initiatives': { httpStatus: { httpStatus: 409, httpMessage: 'Conflict' }, data: [] },
            'POST /epic_deps': { httpStatus: { httpStatus: 503, httpMessage: 'down' }, data: [] },
        } });
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        await expect(deleteInitiativeWithOptions(URI, 'tok', planned)).rejects.toMatchObject({
            namedRefusal: true, httpStatus: { httpStatus: 409 },
            message: expect.stringMatching(/2 of 3 undo steps could not be applied/) });
    });

    it('a failed requirement delete says the initiative is gone', async () => {
        respond = world({ fail: { 'DELETE /requirements': { httpStatus: { httpStatus: 500, httpMessage: 'x' }, data: [] } } });
        const planned = await planInitiativeDelete(URI, 'tok', 40);
        await expect(deleteInitiativeWithOptions(URI, 'tok', planned, { deleteRequirements: true }))
            .rejects.toMatchObject({ initiativeDeleted: true,
                message: expect.stringMatching(/^Initiative 40 was deleted, but its 2 requirements could not be/) });
    });
});

describe('moveClosesGateCycle', () => {
    const graph = {
        planEpics: [{ id: 1, initiative_fk: 10 }, { id: 2, initiative_fk: 20 }, { id: 3, initiative_fk: 30 }],
        epicDeps: [{ epic_fk: 2, dep_epic_fk: 1 }],
        initiativeDeps: [{ initiative_fk: 30, dep_initiative_fk: 20 }],
    };
    it('epic 1 moved under 30 waits on 2, which waits on 1 — a loop', () => {
        expect(moveClosesGateCycle([1], 30, graph)).toBe(true);
    });
    it('the wait carries through an initiative holding no epic', () => {
        expect(moveClosesGateCycle([1], 40, { ...graph, initiativeDeps: [
            { initiative_fk: 40, dep_initiative_fk: 50 }, { initiative_fk: 50, dep_initiative_fk: 20 }] }))
            .toBe(true);
    });
    it('moved under 20 it does not', () => {
        expect(moveClosesGateCycle([1], 20, graph)).toBe(false);
    });
});
