// Req #3877 — the epics table deletes an epic other epics depend on by FREEING
// them first. What is pinned is the order (every edge naming the epic goes
// before the epic, because `dep_epic_fk` is ON DELETE RESTRICT) and the undo
// (a later failure re-creates the edges already removed).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
// `failures` maps the Nth call (0-based) to the HTTP status it is refused with.
let failures = {};
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        const n = calls.length;
        calls.push({ table: uri.split('/').pop(), method, body });
        if (failures[n]) return Promise.resolve({ httpStatus: { httpStatus: failures[n] }, data: null });
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: null });
    }),
}));

import { deleteEpicFreeingDependents } from '../epicsApi';

const URI = 'https://api/darwin';
const brief = () => calls.map(({ table, method, body }) => `${method} ${table} ${JSON.stringify(body)}`);

beforeEach(() => {
    calls.length = 0;
    failures = {};
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('deleteEpicFreeingDependents', () => {
    it('with no dependents is the single epic DELETE', async () => {
        await deleteEpicFreeingDependents(URI, 'tok', 10, []);
        expect(brief()).toEqual(['DELETE epics {"id":10}']);
    });

    it('removes every dependent edge onto the epic, THEN deletes the epic', async () => {
        await deleteEpicFreeingDependents(URI, 'tok', 10, [20, 21]);
        expect(brief()).toEqual([
            'DELETE epic_deps {"epic_fk":20,"dep_epic_fk":10}',
            'DELETE epic_deps {"epic_fk":21,"dep_epic_fk":10}',
            'DELETE epics {"id":10}',
        ]);
    });

    it('treats a 404 edge as already gone and carries on', async () => {
        failures = { 0: 404 };
        await deleteEpicFreeingDependents(URI, 'tok', 10, [20, 21]);
        expect(brief().slice(1)).toEqual([
            'DELETE epic_deps {"epic_fk":21,"dep_epic_fk":10}',
            'DELETE epics {"id":10}',
        ]);
    });

    it('a refused epic DELETE restores the freed edges, newest first, and rethrows', async () => {
        failures = { 2: 423 };
        await expect(deleteEpicFreeingDependents(URI, 'tok', 10, [20, 21]))
            .rejects.toThrow(/deleteEpic failed: HTTP 423/);
        expect(brief().slice(3)).toEqual([
            'POST epic_deps {"epic_fk":21,"dep_epic_fk":10}',
            'POST epic_deps {"epic_fk":20,"dep_epic_fk":10}',
        ]);
    });

    it('a refused edge stops before the epic and restores only the edges already freed', async () => {
        failures = { 1: 423 };
        await expect(deleteEpicFreeingDependents(URI, 'tok', 10, [20, 21, 22]))
            .rejects.toThrow(/deleteEpicDep failed: HTTP 423/);
        expect(brief()).toEqual([
            'DELETE epic_deps {"epic_fk":20,"dep_epic_fk":10}',
            'DELETE epic_deps {"epic_fk":21,"dep_epic_fk":10}',
            'POST epic_deps {"epic_fk":20,"dep_epic_fk":10}',
        ]);
    });

    it('frees a self-edge but never restores it', async () => {
        failures = { 1: 500 };
        await expect(deleteEpicFreeingDependents(URI, 'tok', 10, [10])).rejects.toThrow();
        expect(brief()).toEqual([
            'DELETE epic_deps {"epic_fk":10,"dep_epic_fk":10}',
            'DELETE epics {"id":10}',
        ]);
    });
});
