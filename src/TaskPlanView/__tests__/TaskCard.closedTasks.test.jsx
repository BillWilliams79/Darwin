// @vitest-environment jsdom
//
// req #3506 — the "Closed" option END TO END, in the card that has to show it.
//
// `closedTasks.test.js` pins the arithmetic and `ClosedTasksControl.test.jsx`
// pins the control. Neither can tell you whether a closed task ever REACHES a
// card, and that is the whole requirement: a store nobody reads and a query
// nobody renders would leave both of those suites green while the page looked
// exactly as it did before. So mount the real TaskCard, flip the real store, and
// read the real rows.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let openRows;
let closedRows;
let closedWindowSeenByHook;
let enabledSeenByHook;

vi.mock('../../hooks/useDataQueries', () => ({
    useTasks: () => ({ data: openRows }),
    useTasksClosed: (creatorFk, areaId, window, opts) => {
        closedWindowSeenByHook = window;
        enabledSeenByHook = opts?.enabled;
        // The real hook is disabled when the window is off, and when the card's
        // domain is not the visible one — a card must not be handed closed rows
        // it did not ask for.
        return { data: window && opts?.enabled ? closedRows : undefined };
    },
}));

vi.mock('../../RestApi/RestApi', () => ({
    // Lazy body: the factory is hoisted above the declarations below, but this
    // function only runs once a test has called it.
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri, method, body });
        if (method === 'POST' && postResponse) return Promise.resolve(postResponse);
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

const restCalls = [];
let postResponse = null;

import TaskCard from '../TaskCard';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useClosedTasksStore } from '../../stores/useClosedTasksStore';

const AREA = { id: 5, area_name: 'Errands', domain_fk: 1, sort_order: 0, sort_mode: 'priority' };

const noop = () => {};

let root;
let container;
let queryClient;

const tree = (props = {}) => (
    <QueryClientProvider client={queryClient}>
        <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
            <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester' } }}>
                <DndProvider backend={TouchBackend} options={{ enableMouseEvents: true }}>
                    <TaskCard
                        area={AREA}
                        areaIndex={0}
                        domainId={1}
                        areaChange={noop}
                        areaKeyDown={noop}
                        areaOnBlur={noop}
                        clickCardClosed={noop}
                        clickCardDelete={noop}
                        moveCard={noop}
                        persistAreaOrder={noop}
                        removeArea={noop}
                        isTemplate={false}
                        autoFocusTemplate={false}
                        clearAutoFocusTemplate={noop}
                        {...props}
                    />
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

// Re-render in place. The query doubles read their module-level arrays on every
// render, so swapping one and calling this is how a refetch is simulated.
async function rerender() {
    await act(async () => { root.render(tree(mountedProps)); });
    await flush();
}

// The rows, by data-testid, plus a couple of row-level accessors.
const rowEl = (testId) => container.querySelector(`[data-testid="${testId}"]`);
const textareaIn = (testId) => rowEl(testId).querySelector('textarea');
// TaskEdit draws priority first, then done.
const doneBoxIn = (testId) => rowEl(testId).querySelectorAll('input[type="checkbox"]')[1];
const priorityBoxIn = (testId) => rowEl(testId).querySelectorAll('input[type="checkbox"]')[0];

const clickEl = async (el) => {
    expect(el, 'element must exist to be clicked').toBeTruthy();
    await act(async () => { el.click(); });
    await flush();
};

// Type into a row's description field the way the browser does: set the value,
// fire input, then blur — which is what commits it.
const typeInto = async (testId, text) => {
    const ta = textareaIn(testId);
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, text);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
};

// React maps onBlur to the bubbling `focusout`, not the native non-bubbling
// `blur`, so that is what has to be dispatched for the commit to fire.
const blurRow = async (testId) => {
    await act(async () => {
        textareaIn(testId).dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await flush();
};

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    });
}

// The rows the card actually drew, in order, by their data-testid.
const renderedRows = () =>
    [...container.querySelectorAll('[data-testid^="task-"]')]
        .map(el => el.getAttribute('data-testid'));

beforeEach(() => {
    useClosedTasksStore.setState({ closedWindow: null });
    closedWindowSeenByHook = 'unset';
    enabledSeenByHook = 'unset';
    restCalls.length = 0;
    postResponse = null;
    openRows = [
        { id: 1, description: 'buy milk', priority: 1, done: 0, area_fk: 5, sort_order: 0 },
        { id: 2, description: 'call bank', priority: 0, done: 0, area_fk: 5, sort_order: 1 },
    ];
    closedRows = [
        { id: 8, description: 'closed early', priority: 0, done: 1, area_fk: 5, sort_order: 4, done_ts: '2026-08-14T09:00:00' },
        { id: 9, description: 'closed late', priority: 0, done: 1, area_fk: 5, sort_order: 5, done_ts: '2026-08-14T11:30:00' },
    ];
});

afterEach(async () => {
    if (root) await act(async () => { root.unmount(); });
    container?.remove();
    root = null;
    container = null;
});

describe('TaskCard — the Closed window (req #3506)', () => {
    it('shows open tasks and the template only when the option is OFF', async () => {
        await mount();
        expect(renderedRows()).toEqual(['task-1', 'task-2', 'task-template']);
        expect(closedWindowSeenByHook).toBeNull();
    });

    it('shows closed tasks below the template when a window is selected', async () => {
        useClosedTasksStore.setState({ closedWindow: '24h' });
        await mount();

        expect(renderedRows()).toEqual(['task-1', 'task-2', 'task-template', 'task-9', 'task-8']);
        expect(container.textContent).toContain('closed late');
        expect(container.textContent).toContain('closed early');
    });

    it('passes the selected window down to the query hook', async () => {
        useClosedTasksStore.setState({ closedWindow: '1h' });
        await mount();
        expect(closedWindowSeenByHook).toBe('1h');
    });

    it('does not fetch history for a domain the user is not looking at', async () => {
        // Inactive tab panels are hidden, not unmounted. Without this gate,
        // switching the option on would fire one request per area across every
        // domain in the account, and again on every rolling-window refetch.
        useClosedTasksStore.setState({ closedWindow: 'all' });
        await mount({ domainActive: false });
        expect(enabledSeenByHook).toBe(false);
        expect(renderedRows()).toEqual(['task-1', 'task-2', 'task-template']);
    });

    it('drops the closed rows again when the option is switched back OFF', async () => {
        useClosedTasksStore.setState({ closedWindow: 'all' });
        await mount();
        expect(renderedRows()).toContain('task-9');

        await act(async () => { useClosedTasksStore.setState({ closedWindow: null }); });
        await flush();

        expect(renderedRows()).toEqual(['task-1', 'task-2', 'task-template']);
    });

    it('renders a closed row once when the same id is in both result sets', async () => {
        // Marking a task done mutates the open row in place, so for one render
        // the id can be in the open cache AND the closed query's result.
        openRows = [{ id: 1, description: 'buy milk', priority: 0, done: 1, area_fk: 5, sort_order: 0 }];
        closedRows = [{ id: 1, description: 'buy milk', priority: 0, done: 1, area_fk: 5, sort_order: 0, done_ts: '2026-08-14T11:59:00' }];
        useClosedTasksStore.setState({ closedWindow: '1h' });
        await mount();

        expect(renderedRows().filter(id => id === 'task-1')).toHaveLength(1);
    });

    it('shows closed tasks on a card whose open list is empty', async () => {
        openRows = [];
        useClosedTasksStore.setState({ closedWindow: 'all' });
        await mount();

        expect(renderedRows()).toEqual(['task-template', 'task-9', 'task-8']);
    });
});

// ── After the first render ──────────────────────────────────────────────────
//
// Every defect this section pins was invisible at mount time and appeared only
// once the user did something. A suite that only mounts and reads stays green
// through all of them.
describe('TaskCard — the Closed window, after a mutation (req #3506)', () => {
    it('keeps the "add new task" row above the history when a task is saved', async () => {
        useClosedTasksStore.setState({ closedWindow: 'all' });
        postResponse = {
            httpStatus: { httpStatus: 200 },
            data: [{ id: 99, description: 'new thing', priority: 0, done: 0, area_fk: 5, sort_order: 2 }],
        };
        await mount();

        await typeInto('task-template', 'new thing');
        await blurRow('task-template');

        // The card's live edge must not sink below an arbitrarily long history.
        const rows = renderedRows();
        expect(rows.indexOf('task-template')).toBeLessThan(rows.indexOf('task-9'));
        expect(rows).toEqual(['task-1', 'task-2', 'task-99', 'task-template', 'task-9', 'task-8']);
    });

    it('does not erase what the user is typing when the closed window refetches', async () => {
        useClosedTasksStore.setState({ closedWindow: '1h' });
        await mount();

        await typeInto('task-template', 'pick up dry cleaning');
        expect(textareaIn('task-template').value).toBe('pick up dry cleaning');

        // The 1h boundary rolls forward and the older row drops out of the window.
        closedRows = closedRows.filter(t => t.id === 9);
        await rerender();

        expect(renderedRows()).toEqual(['task-1', 'task-2', 'task-template', 'task-9']);
        expect(textareaIn('task-template').value).toBe('pick up dry cleaning');
    });

    it('moves a re-opened task back above the "add new task" row', async () => {
        useClosedTasksStore.setState({ closedWindow: '24h' });
        await mount();
        expect(renderedRows()).toEqual(['task-1', 'task-2', 'task-template', 'task-9', 'task-8']);

        await clickEl(doneBoxIn('task-9'));

        // It is live work again, so it rejoins the rows above the template —
        // which is what keeps the index-based callbacks addressing the right row.
        const rows = renderedRows();
        expect(rows.indexOf('task-9')).toBeLessThan(rows.indexOf('task-template'));
    });

    it('does not resurrect a just-re-opened task as history when the poll lands mid-write', async () => {
        useClosedTasksStore.setState({ closedWindow: '1h' });
        await mount();

        await clickEl(doneBoxIn('task-9'));
        expect(renderedRows().filter(id => id === 'task-9')).toHaveLength(1);

        // The rolling-window poll fires before the server has the re-open, so
        // the closed query still reports task-9 closed.
        closedRows = [...closedRows];
        await rerender();

        expect(renderedRows().filter(id => id === 'task-9')).toHaveLength(1);
    });

    it('does not erase an uncommitted edit to a history row when the closed window refetches', async () => {
        useClosedTasksStore.setState({ closedWindow: '1h' });
        await mount();

        await typeInto('task-9', 'edited history');
        expect(textareaIn('task-9').value).toBe('edited history');

        // A row ages out of the window — the closed set changes, task-9 does not.
        closedRows = closedRows.filter(t => t.id === 9);
        await rerender();

        expect(textareaIn('task-9').value).toBe('edited history');
    });

    it('re-opening sends done=0 and clears done_ts', async () => {
        useClosedTasksStore.setState({ closedWindow: '24h' });
        await mount();

        await clickEl(doneBoxIn('task-9'));

        const put = restCalls.find(c => c.method === 'PUT' && c.uri.endsWith('/tasks'));
        expect(put.body[0]).toMatchObject({ id: 9, done: 0, done_ts: 'NULL' });
    });

    it('is a no-op with the option OFF: ticking a task then flagging another does not reorder', async () => {
        await mount();
        expect(renderedRows()).toEqual(['task-1', 'task-2', 'task-template']);

        // Tick task-2 done. It stays in place with a strikethrough — unchanged behaviour.
        await clickEl(doneBoxIn('task-2'));
        expect(renderedRows()).toEqual(['task-1', 'task-2', 'task-template']);

        // Now flag task-1, which re-sorts the whole card. A just-ticked row is
        // still live work, so it must not be pushed below the template row.
        await clickEl(priorityBoxIn('task-1'));
        expect(renderedRows()).toEqual(['task-1', 'task-2', 'task-template']);
    });

    it('is a no-op with the option OFF: a just-ticked task still counts for the next sort_order', async () => {
        postResponse = {
            httpStatus: { httpStatus: 200 },
            data: [{ id: 99, description: 'new thing', priority: 0, done: 0, area_fk: 5, sort_order: 2 }],
        };
        await mount();

        await clickEl(doneBoxIn('task-2'));   // task-2 holds sort_order 1
        await typeInto('task-template', 'new thing');
        await blurRow('task-template');

        // max(sort_order) over the live rows is still 1, so the new row takes 2.
        // Skipping the ticked row would hand it 1 and collide with task-2.
        const post = restCalls.find(c => c.method === 'POST');
        expect(post.body.sort_order).toBe(2);
    });
});
