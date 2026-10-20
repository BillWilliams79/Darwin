// @vitest-environment jsdom
//
// req #3662 — the Plan view's ONE onDragEnd. A drop resolves against the
// registered lists, updates BOTH sides' local arrays and fires exactly one
// write; a cancel writes nothing and reverts any tab hover-switch.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const calls = [];
vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        calls.push({ uri, method, body });
        return Promise.resolve(respond());
    }),
}));

import { usePlanDnd } from '../usePlanDnd';
import { AREA_TASKS, AREA_CARDS, DOMAIN_TABS, planIds, usePlanDragStore } from '../planDnd';
import { useDragTabStore } from '../../stores/useDragTabStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const task = (id, area) => ({ id, description: `t${id}`, priority: 0, done: 0, area_fk: area, sort_order: id });
const template = (area) => ({ id: '', description: '', priority: 0, done: 0, area_fk: area, sort_order: null });

function list(items, extra = {}) {
    const entry = { items, ready: true, getItems: () => entry.items, setItems: (next) => {
        entry.items = typeof next === 'function' ? next(entry.items) : next;
    }, ...extra };
    return { current: entry };
}

let handlers;
let invalidateTasks;
let respond = () => ({ httpStatus: { httpStatus: 200 }, data: [] });
function mount(registry, extra = {}) {
    invalidateTasks = vi.fn();
    const Probe = () => {
        handlers = usePlanDnd({
            registry, writeCtx: { darwinUri: 'http://t', idToken: 'tok', showError: vi.fn() },
            invalidateTasks, invalidateAreas: vi.fn(), invalidateDomains: vi.fn(),
            domains: extra.domains ?? [], setDomains: extra.setDomains ?? vi.fn(),
            activeTab: 0, setActiveTab: extra.setActiveTab ?? vi.fn(),
        });
        return null;
    };
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
    return root;
}

const item = (id, containerId, policy, row, sortMode) => ({
    id, rect: { top: 0, height: 20 },
    data: { current: { kind: 'item', type: id.split(':')[0], containerId, policy, row, sortMode } },
});
const container = (id, policy, sortMode) => ({ id, data: { current: { kind: 'container', containerId: id, policy, sortMode } } });
const activeOf = (it) => ({ id: it.id, data: it.data, rect: { current: { translated: { top: 0, height: 20 } } } });

const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
    calls.length = 0;
    respond = () => ({ httpStatus: { httpStatus: 200 }, data: [] });
    usePlanDragStore.getState().end();
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
});

describe('usePlanDnd', () => {
    it('same-card hand reorder: one PUT, the card\'s array reordered', async () => {
        const A = list([task(1, 5), task(2, 5), task(3, 5), template(5)], { sortMode: 'hand', areaId: 5 });
        const registry = new Map([[planIds.tasks(5), A]]);
        mount(registry);
        const src = item('task:1', 'tasks:5', AREA_TASKS, A.current.items[0], 'hand');
        const over = item('task:3', 'tasks:5', AREA_TASKS, A.current.items[2], 'hand');
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over }));
        await act(async () => handlers.onDragEnd({ active: activeOf(src), over }));
        await flush();
        expect(A.current.items.map(t => t.id)).toEqual([2, 3, 1, '']);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ method: 'PUT', uri: 'http://t/tasks' });
        // The cache learns the new order (a remounted card seeds from it).
        expect(invalidateTasks).toHaveBeenCalledTimes(1);
    });

    it('a failed write puts BOTH lists back exactly as they were', async () => {
        respond = () => ({ httpStatus: { httpStatus: 500 }, data: [] });
        const A = list([task(1, 5), task(2, 5), template(5)], { sortMode: 'hand', areaId: 5 });
        const B = list([task(7, 6), template(6)], { sortMode: 'priority', areaId: 6, sortRows: (r) => r });
        const beforeA = A.current.items, beforeB = B.current.items;
        mount(new Map([[planIds.tasks(5), A], [planIds.tasks(6), B]]));
        const src = item('task:1', 'tasks:5', AREA_TASKS, A.current.items[0], 'hand');
        const over = container('tasks:6', AREA_TASKS, 'priority');
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over }));
        await act(async () => handlers.onDragEnd({ active: activeOf(src), over }));
        await flush();
        expect(A.current.items).toBe(beforeA);
        expect(B.current.items).toBe(beforeB);
        expect(invalidateTasks).toHaveBeenCalled();
    });

    it('a hand-sorted target is not highlighted — its sliding rows are the feedback', () => {
        const A = list([task(1, 5), template(5)], { sortMode: 'hand', areaId: 5 });
        const B = list([task(7, 6), template(6)], { sortMode: 'hand', areaId: 6 });
        mount(new Map([[planIds.tasks(5), A], [planIds.tasks(6), B]]));
        const src = item('task:1', 'tasks:5', AREA_TASKS, A.current.items[0], 'hand');
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over: container('tasks:6', AREA_TASKS, 'hand') }));
        expect(usePlanDragStore.getState().highlight).toBeNull();
        expect(usePlanDragStore.getState().placement).toEqual({ containerId: 'tasks:6', index: 1 });
    });

    it('a card still loading is not a place to land', async () => {
        const A = list([task(1, 5), template(5)], { sortMode: 'hand', areaId: 5 });
        const B = list([], { sortMode: 'hand', areaId: 6, ready: false });
        mount(new Map([[planIds.tasks(5), A], [planIds.tasks(6), B]]));
        const src = item('task:1', 'tasks:5', AREA_TASKS, A.current.items[0], 'hand');
        const over = container('tasks:6', AREA_TASKS, 'hand');
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over }));
        expect(usePlanDragStore.getState().placement).toBeNull();
        await act(async () => handlers.onDragEnd({ active: activeOf(src), over }));
        await flush();
        expect(calls).toHaveLength(0);
    });

    it('carried into a hand-sorted card: placed, then ONE PUT moves it on both sides', async () => {
        const A = list([task(1, 5), task(2, 5), template(5)], { sortMode: 'priority', areaId: 5 });
        const B = list([task(7, 6), task(8, 6), template(6)], { sortMode: 'hand', areaId: 6 });
        const registry = new Map([[planIds.tasks(5), A], [planIds.tasks(6), B]]);
        mount(registry);
        const src = item('task:1', 'tasks:5', AREA_TASKS, A.current.items[0], 'priority');
        const over = item('task:8', 'tasks:6', AREA_TASKS, B.current.items[1], 'hand');
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over }));
        expect(usePlanDragStore.getState().placement).toEqual({ containerId: 'tasks:6', index: 1 });
        // Re-homed, the item's own slot is now under the pointer — dnd-kit
        // reports the item itself as `over`, and it lands where it shows.
        const settled = item('task:1', 'tasks:6', AREA_TASKS, src.data.current.row, 'hand');
        await act(async () => handlers.onDragEnd({ active: activeOf(settled), over: settled }));
        await flush();
        expect(A.current.items.map(t => t.id)).toEqual([2, '']);
        expect(B.current.items.map(t => t.id)).toEqual([7, 1, 8, '']);
        expect(calls).toHaveLength(1);
        expect(calls[0].body).toEqual([
            { id: 7, sort_order: 0 }, { id: 1, sort_order: 1, area_fk: 6 }, { id: 8, sort_order: 2 },
        ]);
    });

    it('carried in, then sorted past a row: lands where the sortable shows it', async () => {
        const A = list([task(1, 5), template(5)], { sortMode: 'hand', areaId: 5 });
        const B = list([task(7, 6), task(8, 6), template(6)], { sortMode: 'hand', areaId: 6 });
        mount(new Map([[planIds.tasks(5), A], [planIds.tasks(6), B]]));
        const src = item('task:1', 'tasks:5', AREA_TASKS, A.current.items[0], 'hand');
        const enter = item('task:7', 'tasks:6', AREA_TASKS, B.current.items[0], 'hand');
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over: enter }));
        const past = item('task:8', 'tasks:6', AREA_TASKS, B.current.items[1], 'hand');
        await act(async () => handlers.onDragEnd({ active: activeOf(src), over: past }));
        await flush();
        expect(B.current.items.map(t => t.id)).toEqual([7, 8, 1, '']);
        expect(calls).toHaveLength(1);
    });

    it('over a priority-sorted card: highlighted, not placed; the drop appends', async () => {
        const A = list([task(1, 5), template(5)], { sortMode: 'hand', areaId: 5 });
        const B = list([task(7, 6), template(6)], { sortMode: 'priority', areaId: 6, sortRows: (r) => r });
        const registry = new Map([[planIds.tasks(5), A], [planIds.tasks(6), B]]);
        mount(registry);
        const src = item('task:1', 'tasks:5', AREA_TASKS, A.current.items[0], 'hand');
        const over = container('tasks:6', AREA_TASKS, 'priority');
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over }));
        expect(usePlanDragStore.getState().placement).toBeNull();
        expect(usePlanDragStore.getState().highlight).toBe('tasks:6');
        await act(async () => handlers.onDragEnd({ active: activeOf(src), over }));
        await flush();
        expect(B.current.items.map(t => t.id)).toContain(1);
        expect(A.current.items.map(t => t.id)).toEqual(['']);
        expect(calls).toHaveLength(1);
        expect(calls[0].body).toEqual([{ id: 1, area_fk: 6, sort_order: 8 }]);
    });

    it('a drop on nothing, or on a tab, is a cancel: no write, hover-switch reverted', async () => {
        const A = list([task(1, 5), template(5)], { sortMode: 'hand', areaId: 5 });
        mount(new Map([[planIds.tasks(5), A]]));
        const revert = vi.spyOn(useDragTabStore.getState(), 'revertDragTabSwitch');
        const src = item('task:1', 'tasks:5', AREA_TASKS, A.current.items[0], 'hand');
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        await act(async () => handlers.onDragEnd({ active: activeOf(src), over: null }));
        const tab = item('domain:3', 'domains', DOMAIN_TABS, { id: 3 });
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        await act(async () => handlers.onDragEnd({ active: activeOf(src), over: tab }));
        await flush();
        expect(calls).toHaveLength(0);
        expect(usePlanDragStore.getState().active).toBeNull();
        revert.mockRestore();
    });

    it('an area card carried to another domain: ONE PUT covering both domains', async () => {
        const area = (id, d, s) => ({ id, area_name: `a${id}`, domain_fk: d, sort_order: s });
        const A = list([area(1, 10, 0), area(2, 10, 1), { id: '', domain_fk: 10 }], { domainId: 10 });
        const B = list([area(5, 11, 0), { id: '', domain_fk: 11 }], { domainId: 11 });
        mount(new Map([[planIds.areas(10), A], [planIds.areas(11), B]]));
        const src = item('area:1', 'areas:10', AREA_CARDS, A.current.items[0]);
        const over = item('area:5', 'areas:11', AREA_CARDS, B.current.items[0]);
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over }));
        const settled = item('area:1', 'areas:11', AREA_CARDS, src.data.current.row);
        await act(async () => handlers.onDragEnd({ active: activeOf(settled), over: settled }));
        await flush();
        expect(A.current.items.map(a => a.id)).toEqual([2, '']);
        expect(B.current.items.map(a => a.id)).toEqual([1, 5, '']);
        expect(calls).toHaveLength(1);
        expect(calls[0].uri).toBe('http://t/areas');
        expect(calls[0].body).toContainEqual({ id: 1, sort_order: 0, domain_fk: 11 });
    });

    it('a domain tab reorder: one PUT, the active tab follows its domain', async () => {
        const domains = [{ id: 10 }, { id: 11 }, { id: 12 }];
        const setDomains = vi.fn();
        const setActiveTab = vi.fn();
        mount(new Map(), { domains, setDomains, setActiveTab });
        const src = item('domain:10', 'domains', DOMAIN_TABS, domains[0]);
        const over = item('domain:12', 'domains', DOMAIN_TABS, domains[2]);
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        await act(async () => handlers.onDragEnd({ active: activeOf(src), over }));
        await flush();
        expect(setDomains.mock.calls[0][0].map(d => d.id)).toEqual([11, 12, 10]);
        expect(setActiveTab).toHaveBeenCalledWith(2);
        expect(calls).toHaveLength(1);
        expect(calls[0].uri).toBe('http://t/domains');
    });
});
