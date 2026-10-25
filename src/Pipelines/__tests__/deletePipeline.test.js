// req #3934 — the browser's plan delete: refusals before any write, the
// RESTRICT edges cleared before the plan row, and a rollback of those edges
// when the plan delete fails.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls = [];
let respond;
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        calls.push({ uri, method, body });
        return Promise.resolve(respond(uri, method, body));
    }),
}));

import { deletePipeline } from '../pipelinesApi';

const URI = 'http://test.local/darwin';
const ok = (data = []) => ({ httpStatus: { httpStatus: 200 }, data });
const notFound = () => ({ httpStatus: { httpStatus: 404, httpMessage: 'NOT FOUND' }, data: [] });

// A plan of two initiatives (40 waits for 41) and three epics (501 waits on 500).
function planWorld(overrides = {}) {
    const world = {
        pipeline: { id: 7, title: 'Plan Seven', locked: 0 },
        initiatives: [{ id: 40, locked: 0 }, { id: 41, locked: 0 }],
        epics: [{ id: 500, locked: 0 }, { id: 501, locked: 0 }, { id: 502, locked: 0 }],
        epicDeps: [{ id: 9, epic_fk: 501, dep_epic_fk: 500 }],
        initiativeDeps: [{ id: 3, initiative_fk: 40, dep_initiative_fk: 41 }],
        claims: [],
        failPipelineDelete: false,
        failRestore: false,
        ...overrides,
    };
    return (uri, method) => {
        if (method === 'GET') {
            if (uri.includes('/pipelines?')) return world.pipeline ? ok([world.pipeline]) : notFound();
            if (uri.includes('/initiatives?')) return world.initiatives.length ? ok(world.initiatives) : notFound();
            if (uri.includes('/epics?')) return world.epics.length ? ok(world.epics) : notFound();
            if (uri.includes('/epic_deps?')) return world.epicDeps.length ? ok(world.epicDeps) : notFound();
            if (uri.includes('/orchestration_claims?')) return world.claims.length ? ok(world.claims) : notFound();
            if (uri.includes('/initiative_deps?')) {
                return world.initiativeDeps.length ? ok(world.initiativeDeps) : notFound();
            }
        }
        if (method === 'DELETE' && uri.endsWith('/pipelines') && world.failPipelineDelete) {
            return { httpStatus: { httpStatus: 500, httpMessage: 'boom' }, data: [] };
        }
        if (method === 'POST' && uri.endsWith('/initiative_deps') && world.failRestore) {
            return { httpStatus: { httpStatus: 409, httpMessage: 'Conflict' }, data: [] };
        }
        return method === 'POST' ? { httpStatus: { httpStatus: 201 }, data: [{ id: 1 }] } : ok();
    };
}

const writes = () => calls.filter((c) => c.method !== 'GET');

beforeEach(() => {
    calls.length = 0;
    respond = planWorld();
});

describe('deletePipeline (req #3934)', () => {
    it('clears the RESTRICT edges, then deletes the plan', async () => {
        const result = await deletePipeline(URI, 'tok', 7);
        expect(writes()).toEqual([
            { uri: `${URI}/initiative_deps`, method: 'DELETE', body: [{ id: 3 }] },
            { uri: `${URI}/epic_deps`, method: 'DELETE', body: [{ id: 9 }] },
            { uri: `${URI}/pipelines`, method: 'DELETE', body: { id: 7 } },
        ]);
        expect(result).toMatchObject({ id: 7, initiative_count: 2, epic_count: 3,
            dep_rows_removed: 1, initiative_dep_rows_removed: 1 });
    });

    it('reads the plan epics and edges with IN-lists', async () => {
        await deletePipeline(URI, 'tok', 7);
        const gets = calls.filter((c) => c.method === 'GET').map((c) => c.uri);
        expect(gets).toContain(`${URI}/epics?initiative_fk=(40,41)&fields=id,locked`);
        expect(gets).toContain(`${URI}/epic_deps?dep_epic_fk=(500,501,502)&fields=id,epic_fk,dep_epic_fk`);
        expect(gets).toContain(
            `${URI}/initiative_deps?dep_initiative_fk=(40,41)&fields=id,initiative_fk,dep_initiative_fk`);
    });

    it('deletes an empty plan with one statement', async () => {
        respond = planWorld({ initiatives: [], epics: [], epicDeps: [], initiativeDeps: [] });
        await deletePipeline(URI, 'tok', 7);
        expect(writes()).toEqual([{ uri: `${URI}/pipelines`, method: 'DELETE', body: { id: 7 } }]);
    });

    it.each([
        ['the plan', { pipeline: { id: 7, title: 'Plan Seven', locked: 1 } }, /the plan itself is locked/],
        ['an initiative', { initiatives: [{ id: 40, locked: 1 }] }, /initiative 40 in it is locked/],
        ['an epic', { epics: [{ id: 500, locked: 0 }, { id: 502, locked: 1 }] }, /epic 502 in it is locked/],
    ])('refuses, writing nothing, when %s is locked', async (_label, over, message) => {
        respond = planWorld(over);
        await expect(deletePipeline(URI, 'tok', 7)).rejects.toMatchObject({
            message: expect.stringMatching(message), namedRefusal: true,
            httpStatus: { httpStatus: 423 } });
        expect(writes()).toEqual([]);
    });

    it('refuses, writing nothing, when an epic in another plan waits on one of its epics', async () => {
        respond = planWorld({ epicDeps: [{ id: 9, epic_fk: 501, dep_epic_fk: 500 },
            { id: 10, epic_fk: 777, dep_epic_fk: 502 }] });
        await expect(deletePipeline(URI, 'tok', 7)).rejects.toMatchObject({
            message: expect.stringMatching(/epic 777 in another plan waits on it/),
            httpStatus: { httpStatus: 409 } });
        expect(writes()).toEqual([]);
    });

    it('refuses when an initiative in another plan waits on one of its initiatives', async () => {
        respond = planWorld({ initiativeDeps: [{ id: 3, initiative_fk: 88, dep_initiative_fk: 41 }] });
        await expect(deletePipeline(URI, 'tok', 7)).rejects.toThrow(/initiative 88 in another plan/);
        expect(writes()).toEqual([]);
    });

    it('refuses, writing nothing, while a live claim holds an initiative of the plan', async () => {
        const now = new Date().toISOString().slice(0, 19);
        respond = planWorld({ claims: [{ id: 1, pipeline_fk: 7, initiative_fk: 40, update_ts: now }] });
        await expect(deletePipeline(URI, 'tok', 7)).rejects.toMatchObject({
            message: expect.stringMatching(/\/pipeline-stop it first/), namedRefusal: true });
        expect(writes()).toEqual([]);
    });

    it('goes ahead over a STALE claim — it cascades away with the plan', async () => {
        respond = planWorld({ claims: [{ id: 1, pipeline_fk: 7, initiative_fk: null,
            update_ts: '2026-01-01T00:00:00' }] });
        await deletePipeline(URI, 'tok', 7);
        expect(writes().at(-1)).toEqual({ uri: `${URI}/pipelines`, method: 'DELETE', body: { id: 7 } });
    });

    it('says so when the plan is already gone', async () => {
        respond = planWorld({ pipeline: null });
        await expect(deletePipeline(URI, 'tok', 7)).rejects.toMatchObject({
            httpStatus: { httpStatus: 404 } });
        expect(writes()).toEqual([]);
    });

    it('re-creates the cleared edges when the plan delete fails, and rethrows', async () => {
        respond = planWorld({ failPipelineDelete: true });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(deletePipeline(URI, 'tok', 7)).rejects.toThrow(/deletePipeline failed: HTTP 500/);
        expect(writes().slice(3)).toEqual([
            { uri: `${URI}/epic_deps`, method: 'POST', body: { epic_fk: 501, dep_epic_fk: 500 } },
            { uri: `${URI}/initiative_deps`, method: 'POST',
              body: { initiative_fk: 40, dep_initiative_fk: 41 } },
        ]);
    });

    it('names the edges it could not restore on the error it rethrows', async () => {
        respond = planWorld({ failPipelineDelete: true, failRestore: true });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(deletePipeline(URI, 'tok', 7)).rejects.toThrow(
            /1 of its 2 dependency edges could not be restored/);
    });
});
