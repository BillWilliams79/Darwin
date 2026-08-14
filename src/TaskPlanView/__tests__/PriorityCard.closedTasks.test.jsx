// @vitest-environment jsdom
//
// req #3506 — the "Closed" window on the OTHER task list of the Tasks page.
//
// The requirement asks for closed tasks in any search within the bounds, and
// the Priority card is the page's second task list. It is also the harder of the
// two: it had no re-open path at all before this (its done handler hard-coded
// `done: 1`, unreachable while the card could only ever show live rows), and it
// persists a hand order to `priority_card_order` that history must stay out of.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let liveRows;
let closedRows;
let cardOrderRows;
let closedWindowSeenByHook;
let enabledSeenByHook;

vi.mock('../../hooks/useDataQueries', () => ({
    usePriorityTasks: () => ({ data: liveRows }),
    usePriorityCardOrder: () => ({ data: cardOrderRows }),
    usePriorityTasksClosed: (creatorFk, domainId, areaIds, closedWindow, opts) => {
        closedWindowSeenByHook = closedWindow;
        enabledSeenByHook = opts?.enabled;
        return { data: closedWindow && opts?.enabled ? closedRows : undefined };
    },
}));

vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri, method, body });
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

const restCalls = [];

import PriorityCard from '../PriorityCard';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useClosedTasksStore } from '../../stores/useClosedTasksStore';
import { useOptionalCardStore } from '../../stores/useOptionalCardStore';

let root;
let container;
let queryClient;

const tree = (props = {}) => (
    <QueryClientProvider client={queryClient}>
        <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
            <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester' } }}>
                <DndProvider backend={TouchBackend} options={{ enableMouseEvents: true }}>
                    <PriorityCard domainId={1} areaIds={[5, 6]} {...props} />
                </DndProvider>
            </AuthContext.Provider>
        </AppContext.Provider>
    </QueryClientProvider>
);

let mountedProps = {};

async function mount(props = {}) {
    mountedProps = props;
    container = document.createElement('div');
    document.body.appendChild(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(container);
    await act(async () => { root.render(tree(mountedProps)); });
    await flush();
}

// Re-render in place. The query doubles read their module-level arrays every
// render, so swapping one and calling this is how a refetch is simulated.
async function rerender() {
    await act(async () => { root.render(tree(mountedProps)); });
    await flush();
}

const textareaIn = (testId) => rowEl(testId).querySelector('textarea');

const typeInto = async (testId, text) => {
    const ta = textareaIn(testId);
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, text);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
};

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    });
}

const renderedRows = () =>
    [...container.querySelectorAll('[data-testid^="task-"]')]
        .map(el => el.getAttribute('data-testid'));

const rowEl = (testId) => container.querySelector(`[data-testid="${testId}"]`);
const doneBoxIn = (testId) => rowEl(testId).querySelectorAll('input[type="checkbox"]')[1];

const clickEl = async (el) => {
    expect(el, 'element must exist to be clicked').toBeTruthy();
    await act(async () => { el.click(); });
    await flush();
};

// The sort items live in a MUI Menu — closed until the three-dot button is
// clicked, and portalled to document.body rather than into the card.
const openSortMenu = async () => {
    await clickEl(container.querySelector('[data-testid="priority-card-menu-1"]'));
};

beforeEach(() => {
    useClosedTasksStore.setState({ closedWindow: null });
    useOptionalCardStore.setState({ cards: {} });
    restCalls.length = 0;
    closedWindowSeenByHook = 'unset';
    enabledSeenByHook = 'unset';
    liveRows = [
        { id: 1, description: 'ship it', priority: 1, done: 0, area_fk: 5, sort_order: 0 },
        { id: 2, description: 'call bank', priority: 1, done: 0, area_fk: 6, sort_order: 1 },
    ];
    closedRows = [
        { id: 8, description: 'closed early', priority: 1, done: 1, area_fk: 5, sort_order: 4, done_ts: '2026-08-14T09:00:00' },
        { id: 9, description: 'closed late', priority: 1, done: 1, area_fk: 6, sort_order: 5, done_ts: '2026-08-14T11:30:00' },
    ];
    cardOrderRows = [];
});

afterEach(async () => {
    if (root) await act(async () => { root.unmount(); });
    container?.remove();
    root = null;
    container = null;
});

describe('PriorityCard — the Closed window (req #3506)', () => {
    it('shows live priority tasks only when the option is OFF', async () => {
        await mount();
        expect(renderedRows()).toEqual(['task-1', 'task-2']);
        expect(closedWindowSeenByHook).toBeNull();
    });

    it('appends closed priority tasks below the live ones, newest first', async () => {
        useClosedTasksStore.setState({ closedWindow: '24h' });
        await mount();
        expect(renderedRows()).toEqual(['task-1', 'task-2', 'task-9', 'task-8']);
    });

    it('does not fetch history for a domain the user is not looking at', async () => {
        useClosedTasksStore.setState({ closedWindow: 'all' });
        await mount({ domainActive: false });
        expect(enabledSeenByHook).toBe(false);
        expect(renderedRows()).toEqual(['task-1', 'task-2']);
    });

    it('re-opens a closed task rather than re-closing it', async () => {
        useClosedTasksStore.setState({ closedWindow: '24h' });
        await mount();

        await clickEl(doneBoxIn('task-9'));

        const put = restCalls.find(c => c.method === 'PUT' && c.uri.endsWith('/tasks'));
        expect(put.body[0]).toMatchObject({ id: 9, done: 0, done_ts: 'NULL' });

        // …and it rejoins the live rows above the remaining history.
        const rows = renderedRows();
        expect(rows.indexOf('task-9')).toBeLessThan(rows.indexOf('task-8'));
    });

    it('closing a live task still marks it done', async () => {
        await mount();
        await clickEl(doneBoxIn('task-1'));

        const put = restCalls.find(c => c.method === 'PUT' && c.uri.endsWith('/tasks'));
        expect(put.body[0]).toMatchObject({ id: 1, done: 1 });
        expect(put.body[0].done_ts).not.toBe('NULL');
    });

    it('never gives a history row a hand-order record', async () => {
        useClosedTasksStore.setState({ closedWindow: '24h' });
        await mount();

        // Switching to hand sort with no records yet POSTs one per task.
        await openSortMenu();
        await clickEl(document.body.querySelector('[data-testid="priority-card-sort-hand"]'));

        const posted = restCalls
            .filter(c => c.method === 'POST' && c.uri.endsWith('/priority_card_order'))
            .map(c => c.body.task_id);
        expect(posted.sort()).toEqual([1, 2]);
    });

    // The rolling window re-asks its question every 60s. Everything below is
    // what must NOT happen on that tick.
    it('does not erase what the user is typing when the closed window refetches', async () => {
        useClosedTasksStore.setState({ closedWindow: '1h' });
        await mount();

        await typeInto('task-1', 'half typed live row');
        expect(textareaIn('task-1').value).toBe('half typed live row');

        closedRows = closedRows.filter(t => t.id === 9);
        await rerender();

        expect(textareaIn('task-1').value).toBe('half typed live row');
    });

    it('does not put a just-re-opened task back into the history', async () => {
        useClosedTasksStore.setState({ closedWindow: '24h' });
        await mount();

        await clickEl(doneBoxIn('task-9'));
        const rowsAfterReopen = renderedRows();
        expect(rowsAfterReopen.indexOf('task-9')).toBeLessThan(rowsAfterReopen.indexOf('task-8'));

        // A different task is closed elsewhere; the closed query answers before
        // the live one has caught up and still reports 9 closed.
        closedRows = [...closedRows,
            { id: 7, description: 'closed elsewhere', priority: 1, done: 1, area_fk: 5, sort_order: 6, done_ts: '2026-08-14T11:59:00' }];
        await rerender();

        expect(renderedRows().filter(id => id === 'task-9')).toHaveLength(1);
        const rows = renderedRows();
        expect(rows.indexOf('task-9')).toBeLessThan(rows.indexOf('task-7'));
    });

    it('keeps the history below the live rows after a sort-mode change', async () => {
        useClosedTasksStore.setState({ closedWindow: '24h' });
        await mount();

        await openSortMenu();
        await clickEl(document.body.querySelector('[data-testid="priority-card-sort-created"]'));
        expect(renderedRows()).toEqual(['task-1', 'task-2', 'task-9', 'task-8']);
    });
});
