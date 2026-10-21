// @vitest-environment jsdom
//
// req #3663 — the Recurring page's ONE onDragEnd: a row moves between area
// cards (in a domain or across one by tab hover-switch) with one area_fk PUT;
// its own card, a tab, or nothing is a cancel that writes nothing and reverts
// the hover-switch.

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

import { useRecurringDnd, moveRecurringTask } from '../useRecurringDnd';
import { RECURRING_TABS, RECURRING_TASKS, recurringIds, useRecurringDragStore } from '../recurringDnd';
import { useDragTabStore } from '../../stores/useDragTabStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const def = (id, area) => ({ id, description: `d${id}`, recurrence: 'daily', area_fk: area });

function list(items, extra = {}) {
    const entry = { items, ready: true, getItems: () => entry.items, setItems: (next) => {
        entry.items = typeof next === 'function' ? next(entry.items) : next;
    }, ...extra };
    return { current: entry };
}

let handlers;
let invalidateRecurring;
let showError;
let respond = () => ({ httpStatus: { httpStatus: 200 }, data: [] });
function mount(registry) {
    invalidateRecurring = vi.fn();
    showError = vi.fn();
    const Probe = () => {
        handlers = useRecurringDnd({
            registry, writeCtx: { darwinUri: 'http://t', idToken: 'tok', showError }, invalidateRecurring,
        });
        return null;
    };
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
}

const rowItem = (row) => ({
    id: recurringIds.task(row.id), rect: { top: 0, height: 20 },
    data: { current: { kind: 'item', type: 'recurring', containerId: recurringIds.tasks(row.area_fk), policy: RECURRING_TASKS, row } },
});
const card = (areaId) => ({ id: recurringIds.tasks(areaId), data: { current: { kind: 'container', containerId: recurringIds.tasks(areaId), policy: RECURRING_TASKS } } });
const activeOf = (it) => ({ id: it.id, data: it.data, rect: { current: { translated: { top: 0, height: 20 } } } });
// Spied BEFORE mount: the hook reads the store's function when it renders.
let spies = [];
const spy = (name) => {
    const s = vi.spyOn(useDragTabStore.getState(), name);
    spies.push(s);
    return s;
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

async function drop(src, over) {
    act(() => handlers.onDragStart({ active: activeOf(src) }));
    if (over) act(() => handlers.onDragOver({ active: activeOf(src), over }));
    await act(async () => handlers.onDragEnd({ active: activeOf(src), over }));
    await flush();
}

beforeEach(() => {
    spies.forEach(s => s.mockRestore());
    spies = [];
    calls.length = 0;
    respond = () => ({ httpStatus: { httpStatus: 200 }, data: [] });
    useRecurringDragStore.getState().end();
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
});

describe('moveRecurringTask', () => {
    it('joins the end of the target card with its new area; the write is the area alone', () => {
        const out = moveRecurringTask([def(7, 6)], def(1, 5), '6');
        expect(out.defs.map(d => [d.id, d.area_fk])).toEqual([[7, 6], [1, 6]]);
        expect(out.bulk).toEqual([{ id: 1, area_fk: 6 }]);
    });
});

describe('useRecurringDnd', () => {
    it('over another card: highlighted (no position), then ONE PUT moves it on both sides', async () => {
        const A = list([def(1, 5), def(2, 5)], { areaId: 5 });
        const B = list([def(7, 6)], { areaId: 6 });
        const clear = spy('clearDragTabSwitch');
        mount(new Map([[recurringIds.tasks(5), A], [recurringIds.tasks(6), B]]));
        const src = rowItem(A.current.items[0]);
        act(() => handlers.onDragStart({ active: activeOf(src) }));
        act(() => handlers.onDragOver({ active: activeOf(src), over: card(6) }));
        expect(useRecurringDragStore.getState().highlight).toBe(recurringIds.tasks(6));
        expect(useRecurringDragStore.getState().placement).toBeNull();
        await act(async () => handlers.onDragEnd({ active: activeOf(src), over: card(6) }));
        await flush();
        expect(A.current.items.map(d => d.id)).toEqual([2]);
        expect(B.current.items.map(d => d.id)).toEqual([7, 1]);
        expect(calls).toEqual([{ uri: 'http://t/recurring_tasks', method: 'PUT', body: [{ id: 1, area_fk: 6 }] }]);
        expect(invalidateRecurring).toHaveBeenCalledTimes(1);
        expect(clear).toHaveBeenCalled();
    });

    it('a row of another card is that card', async () => {
        const A = list([def(1, 5)], { areaId: 5 });
        const B = list([def(7, 6)], { areaId: 6 });
        mount(new Map([[recurringIds.tasks(5), A], [recurringIds.tasks(6), B]]));
        await drop(rowItem(A.current.items[0]), rowItem(B.current.items[0]));
        expect(B.current.items.map(d => d.id)).toEqual([7, 1]);
        expect(calls).toHaveLength(1);
    });

    it('its own card, a tab, or nothing: no write, hover-switch reverted', async () => {
        const A = list([def(1, 5), def(2, 5)], { areaId: 5 });
        const revert = spy('revertDragTabSwitch');
        mount(new Map([[recurringIds.tasks(5), A]]));
        const src = rowItem(A.current.items[0]);
        await drop(src, card(5));
        await drop(src, rowItem(A.current.items[1]));
        const tab = { id: recurringIds.domain(3), data: { current: { kind: 'item', type: 'domain', containerId: recurringIds.domains, policy: RECURRING_TABS, row: { id: 3 } } } };
        await drop(src, tab);
        await drop(src, null);
        expect(calls).toHaveLength(0);
        expect(A.current.items.map(d => d.id)).toEqual([1, 2]);
        expect(revert).toHaveBeenCalledTimes(4);
    });

    it('a failed write puts both cards back', async () => {
        respond = () => ({ httpStatus: { httpStatus: 500 }, data: [] });
        const A = list([def(1, 5)], { areaId: 5 });
        const B = list([def(7, 6)], { areaId: 6 });
        const beforeA = A.current.items, beforeB = B.current.items;
        mount(new Map([[recurringIds.tasks(5), A], [recurringIds.tasks(6), B]]));
        await drop(rowItem(A.current.items[0]), card(6));
        expect(A.current.items).toBe(beforeA);
        expect(B.current.items).toBe(beforeB);
        expect(showError).toHaveBeenCalledWith(expect.anything(), 'Unable to move recurring task');
    });
});
