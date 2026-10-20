// @vitest-environment jsdom
//
// req #3663 — the Swarm cards view's ONE onDragEnd. Each rule of
// memory/architecture.md § SwarmView Requirement-Row DnD, resolved against the
// registered lists: one write per drop, both sides' arrays set, the requirement
// caches written through, and a cancel that writes nothing.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';

const calls = [];
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        calls.push({ uri, method, body });
        return Promise.resolve(respond());
    }),
}));

import { useSwarmDnd } from '../useSwarmDnd';
import {
    AGGREGATOR, CATEGORY_CARDS, CATEGORY_REQS, PROJECT_TABS, swarmIds, useSwarmDragStore,
} from '../swarmDnd';
import { useSwarmTabStore } from '../../stores/useSwarmTabStore';
import { requirementKeys } from '../../hooks/useQueryKeys';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const req = (id, category, extra = {}) => ({ id, title: `r${id}`, requirement_status: 'authoring',
    category_fk: category, sort_order: id, ...extra });
const template = (category) => ({ id: '', title: '', category_fk: category });
const cat = (id, project) => ({ id, category_name: `c${id}`, project_fk: project, sort_order: id });

function list(items, extra = {}) {
    const entry = { items, ready: true, getItems: () => entry.items, setItems: (next) => {
        entry.items = typeof next === 'function' ? next(entry.items) : next;
    }, ...extra };
    return { current: entry };
}

let handlers;
let queryClient;
let showError;
let invalidateCategories;
let respond = () => ({ httpStatus: { httpStatus: 200 }, data: [] });
function mount(registry) {
    showError = vi.fn();
    invalidateCategories = vi.fn();
    const Probe = () => {
        handlers = useSwarmDnd({
            registry,
            writeCtx: { darwinUri: 'http://t', idToken: 'tok', showError, queryClient, userName: 'u' },
            invalidateCategories,
        });
        return null;
    };
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
    return root;
}

const item = (id, type, containerId, policy, row, sortMode) => ({
    id, rect: { top: 0, height: 20 },
    data: { current: { kind: 'item', type, containerId, policy, row, sortMode } },
});
const container = (id, policy, sortMode) => ({ id, data: { current: { kind: 'container', containerId: id, policy, sortMode } } });
const activeOf = (it) => ({ id: it.id, data: it.data, rect: { current: { translated: { top: 0, height: 20 } } } });
const reqItem = (row, sortMode = 'hand') =>
    item(swarmIds.req(row.id), 'requirement', swarmIds.reqs(row.category_fk), CATEGORY_REQS, row, sortMode);

// Spied BEFORE mount: the hook reads the store's function when it renders.
let spies = [];
const spy = (name) => {
    const s = vi.spyOn(useSwarmTabStore.getState(), name);
    spies.push(s);
    return s;
};

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

async function drop(src, overs, end = overs.at(-1)) {
    act(() => handlers.onDragStart({ active: activeOf(src) }));
    overs.forEach(over => act(() => handlers.onDragOver({ active: activeOf(src), over })));
    await act(async () => handlers.onDragEnd({ active: activeOf(src), over: end }));
    await flush();
}

beforeEach(() => {
    spies.forEach(s => s.mockRestore());
    spies = [];
    calls.length = 0;
    respond = () => ({ httpStatus: { httpStatus: 200 }, data: [] });
    useSwarmDragStore.getState().end();
    queryClient = new QueryClient();
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
});

describe('useSwarmDnd — requirement rows', () => {
    it('hand mode, same card: reorders and persists sort_order in one PUT', async () => {
        const A = list([req(1, 5), req(2, 5), req(3, 5), template(5)], { sortMode: 'hand', categoryId: 5 });
        mount(new Map([[swarmIds.reqs(5), A]]));
        await drop(reqItem(A.current.items[0]), [reqItem(A.current.items[2])]);
        expect(A.current.items.map(r => r.id)).toEqual([2, 3, 1, '']);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ method: 'PUT', uri: 'http://t/requirements' });
        expect(calls[0].body).toEqual([
            { id: 2, sort_order: 0 }, { id: 3, sort_order: 1 }, { id: 1, sort_order: 2 },
        ]);
    });

    it('process/reverse, same card: a no-op — nothing written', async () => {
        const A = list([req(1, 5), req(2, 5), template(5)], { sortMode: 'process', categoryId: 5 });
        const before = A.current.items;
        mount(new Map([[swarmIds.reqs(5), A]]));
        await drop(reqItem(A.current.items[0], 'process'), [reqItem(A.current.items[1], 'process')]);
        expect(calls).toHaveLength(0);
        expect(A.current.items).toBe(before);
    });

    it('hand → hand across cards: placed, then category_fk AND the target\'s sort_order', async () => {
        const A = list([req(1, 5), req(2, 5), template(5)], { sortMode: 'hand', categoryId: 5 });
        const B = list([req(7, 6), req(8, 6), template(6)], { sortMode: 'hand', categoryId: 6 });
        mount(new Map([[swarmIds.reqs(5), A], [swarmIds.reqs(6), B]]));
        const src = reqItem(A.current.items[0]);
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over: reqItem(B.current.items[1]) }));
        expect(useSwarmDragStore.getState().placement).toEqual({ containerId: 'reqs:6', index: 1 });
        expect(useSwarmDragStore.getState().highlight).toBeNull();
        const settled = item(src.id, 'requirement', 'reqs:6', CATEGORY_REQS, src.data.current.row, 'hand');
        await act(async () => handlers.onDragEnd({ active: activeOf(settled), over: settled }));
        await flush();
        expect(A.current.items.map(r => r.id)).toEqual([2, '']);
        expect(B.current.items.map(r => r.id)).toEqual([7, 1, 8, '']);
        expect(calls).toHaveLength(1);
        expect(calls[0].body).toEqual([
            { id: 7, sort_order: 0 }, { id: 1, sort_order: 1, category_fk: 6 }, { id: 8, sort_order: 2 },
        ]);
    });

    it('into a process/reverse card: highlighted, category_fk only', async () => {
        const A = list([req(1, 5), template(5)], { sortMode: 'hand', categoryId: 5 });
        const B = list([req(7, 6), template(6)], { sortMode: 'process', categoryId: 6, sortRows: (r) => r });
        mount(new Map([[swarmIds.reqs(5), A], [swarmIds.reqs(6), B]]));
        const over = container('reqs:6', CATEGORY_REQS, 'process');
        const src = reqItem(A.current.items[0]);
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over }));
        expect(useSwarmDragStore.getState().highlight).toBe('reqs:6');
        expect(useSwarmDragStore.getState().placement).toBeNull();
        await act(async () => handlers.onDragEnd({ active: activeOf(src), over }));
        await flush();
        expect(A.current.items.map(r => r.id)).toEqual(['']);
        expect(B.current.items.map(r => r.id)).toEqual([7, 1, '']);
        expect(calls[0].body).toEqual([{ id: 1, category_fk: 6 }]);
    });

    it('writes every requirement cache through: source slice loses it, target gains it, status slice keeps it', async () => {
        const A = list([req(1, 5), template(5)], { sortMode: 'hand', categoryId: 5 });
        const B = list([req(7, 6), template(6)], { sortMode: 'process', categoryId: 6, sortRows: (r) => r });
        queryClient.setQueryData(requirementKeys.byCategory('u', 5), [req(1, 5)]);
        queryClient.setQueryData(requirementKeys.byCategory('u', 6), [req(7, 6)]);
        queryClient.setQueryData(requirementKeys.byStatus('u', 'authoring', 'x'), [req(1, 5), req(7, 6)]);
        mount(new Map([[swarmIds.reqs(5), A], [swarmIds.reqs(6), B]]));
        await drop(reqItem(A.current.items[0]), [container('reqs:6', CATEGORY_REQS, 'process')]);
        expect(queryClient.getQueryData(requirementKeys.byCategory('u', 5))).toEqual([]);
        expect(queryClient.getQueryData(requirementKeys.byCategory('u', 6)).map(r => r.id)).toEqual([7, 1]);
        const status = queryClient.getQueryData(requirementKeys.byStatus('u', 'authoring', 'x'));
        expect(status.map(r => [r.id, r.category_fk])).toEqual([[1, 6], [7, 6]]);
    });

    it('a failed write restores both lists AND every cache', async () => {
        respond = () => ({ httpStatus: { httpStatus: 500 }, data: [] });
        const A = list([req(1, 5), template(5)], { sortMode: 'hand', categoryId: 5 });
        const B = list([req(7, 6), template(6)], { sortMode: 'process', categoryId: 6, sortRows: (r) => r });
        const beforeA = A.current.items, beforeB = B.current.items;
        const slice = [req(1, 5)];
        queryClient.setQueryData(requirementKeys.byCategory('u', 5), slice);
        mount(new Map([[swarmIds.reqs(5), A], [swarmIds.reqs(6), B]]));
        await drop(reqItem(A.current.items[0]), [container('reqs:6', CATEGORY_REQS, 'process')]);
        expect(A.current.items).toBe(beforeA);
        expect(B.current.items).toBe(beforeB);
        expect(queryClient.getQueryData(requirementKeys.byCategory('u', 5))).toEqual(slice);
        expect(showError).toHaveBeenCalledWith(expect.anything(), 'Unable to move requirement to category');
    });

    it('the aggregator is never a target: a drop there is no drop', async () => {
        const A = list([req(1, 5), template(5)], { sortMode: 'hand', categoryId: 5 });
        mount(new Map([[swarmIds.reqs(5), A]]));
        const agg = item(swarmIds.aggReq(2, 9), 'requirement', swarmIds.aggregator(2), AGGREGATOR, req(9, 7));
        await drop(reqItem(A.current.items[0]), [agg]);
        expect(calls).toHaveLength(0);
        expect(A.current.items.map(r => r.id)).toEqual([1, '']);
    });

    // The aggregator registers no list: nothing is ever taken out of it.
    it('FROM the aggregator into a process card: the row moves, category_fk only', async () => {
        const row = req(1, 5, { requirement_status: 'swarm_ready' });
        const B = list([req(7, 6), template(6)], { sortMode: 'process', categoryId: 6, sortRows: (r) => r });
        mount(new Map([[swarmIds.reqs(6), B]]));
        const src = item(swarmIds.aggReq(2, 1), 'requirement', swarmIds.aggregator(2), AGGREGATOR, row);
        await drop(src, [container('reqs:6', CATEGORY_REQS, 'process')]);
        expect(B.current.items.map(r => r.id)).toEqual([7, 1, '']);
        expect(calls[0].body).toEqual([{ id: 1, category_fk: 6 }]);
    });

    it('FROM the aggregator into ANOTHER hand card: placed, then lands — even though dnd-kit now reports the target\'s data', async () => {
        const row = req(1, 5, { requirement_status: 'swarm_ready' });
        const B = list([req(7, 6), req(8, 6), template(6)], { sortMode: 'hand', categoryId: 6 });
        mount(new Map([[swarmIds.reqs(6), B]]));
        const src = item(swarmIds.aggReq(2, 1), 'requirement', swarmIds.aggregator(2), AGGREGATOR, row);
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over: reqItem(B.current.items[1]) }));
        expect(useSwarmDragStore.getState().placement).toEqual({ containerId: 'reqs:6', index: 1 });
        // Re-homed into the card, the dragged node is the card's now: its data
        // carries CATEGORY_REQS, not AGGREGATOR (dnd-kit reads the live node).
        const settled = item(src.id, 'requirement', 'reqs:6', CATEGORY_REQS, row, 'hand');
        await act(async () => handlers.onDragEnd({ active: activeOf(settled), over: settled }));
        await flush();
        expect(B.current.items.map(r => r.id)).toEqual([7, 1, 8, '']);
        expect(calls).toHaveLength(1);
        expect(calls[0].body).toEqual([
            { id: 7, sort_order: 0 }, { id: 1, sort_order: 1, category_fk: 6 }, { id: 8, sort_order: 2 },
        ]);
    });

    it('FROM the aggregator onto the row\'s OWN process card: a no-op', async () => {
        const row = req(7, 6);
        const B = list([row, template(6)], { sortMode: 'process', categoryId: 6, sortRows: (r) => r });
        mount(new Map([[swarmIds.reqs(6), B]]));
        const src = item(swarmIds.aggReq(2, 7), 'requirement', swarmIds.aggregator(2), AGGREGATOR, row);
        await drop(src, [container('reqs:6', CATEGORY_REQS, 'process')]);
        expect(calls).toHaveLength(0);
    });

    it('FROM the aggregator into the row\'s OWN hand card: a reorder, no category write', async () => {
        const B = list([req(7, 6), req(8, 6), template(6)], { sortMode: 'hand', categoryId: 6 });
        mount(new Map([[swarmIds.reqs(6), B]]));
        const row = B.current.items[1];
        const src = item(swarmIds.aggReq(2, 8), 'requirement', swarmIds.aggregator(2), AGGREGATOR, row);
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over: reqItem(B.current.items[0]) }));
        // Above row 7: the card's own copy of 8 is dropped before placing.
        expect(useSwarmDragStore.getState().placement).toEqual({ containerId: 'reqs:6', index: 0 });
        const settled = item(src.id, 'requirement', 'reqs:6', CATEGORY_REQS, row, 'hand');
        await act(async () => handlers.onDragEnd({ active: activeOf(settled), over: settled }));
        await flush();
        expect(B.current.items.map(r => r.id)).toEqual([8, 7, '']);
        expect(calls[0].body).toEqual([{ id: 8, sort_order: 0 }, { id: 7, sort_order: 1 }]);
    });

    it('a drop on nothing, or on a project tab, is a cancel: no write, hover-switch reverted', async () => {
        const A = list([req(1, 5), template(5)], { sortMode: 'hand', categoryId: 5 });
        const revert = spy('revertDragTabSwitch');
        mount(new Map([[swarmIds.reqs(5), A]]));
        const src = reqItem(A.current.items[0]);
        await drop(src, [], null);
        const tab = item(swarmIds.project(3), 'project', swarmIds.projects, PROJECT_TABS, { id: 3 });
        await drop(src, [tab]);
        expect(calls).toHaveLength(0);
        expect(useSwarmDragStore.getState().active).toBeNull();
        expect(revert).toHaveBeenCalled();
    });
});

describe('useSwarmDnd — category cards', () => {
    const catItem = (row, projectId) =>
        item(swarmIds.category(row.id), 'category', swarmIds.categories(projectId), CATEGORY_CARDS, row);

    it('reorders within a project: one PUT /categories', async () => {
        const P = list([cat(1, 2), cat(2, 2), cat(3, 2), cat('', 2)], { projectId: 2 });
        mount(new Map([[swarmIds.categories(2), P]]));
        await drop(catItem(P.current.items[2], 2), [catItem(P.current.items[0], 2)]);
        expect(P.current.items.map(c => c.id)).toEqual([3, 1, 2, '']);
        expect(calls[0]).toMatchObject({ method: 'PUT', uri: 'http://t/categories' });
        expect(invalidateCategories).toHaveBeenCalledTimes(1);
    });

    it('carried to another project (tab hover-switch): project_fk + both sides\' order, one PUT', async () => {
        const P = list([cat(1, 2), cat(2, 2), cat('', 2)], { projectId: 2 });
        const Q = list([cat(7, 3), cat('', 3)], { projectId: 3 });
        const clear = spy('clearDragTabSwitch');
        mount(new Map([[swarmIds.categories(2), P], [swarmIds.categories(3), Q]]));
        const src = catItem(P.current.items[0], 2);
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over: container('categories:3', CATEGORY_CARDS) }));
        expect(useSwarmDragStore.getState().placement).toEqual({ containerId: 'categories:3', index: 1 });
        const settled = item(src.id, 'category', 'categories:3', CATEGORY_CARDS, src.data.current.row);
        await act(async () => handlers.onDragEnd({ active: activeOf(settled), over: settled }));
        await flush();
        expect(P.current.items.map(c => c.id)).toEqual([2, '']);
        expect(Q.current.items.map(c => c.id)).toEqual([7, 1, '']);
        expect(calls).toHaveLength(1);
        expect(calls[0].body).toEqual([
            { id: 2, sort_order: 0 }, { id: 7, sort_order: 0 }, { id: 1, sort_order: 1, project_fk: 3 },
        ]);
        expect(clear).toHaveBeenCalled();
    });
});
