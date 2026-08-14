import { describe, it, expect } from 'vitest';
import {
    CLOSED_WINDOWS,
    CLOSED_WINDOW_VALUES,
    isClosedWindow,
    closedWindowRange,
    taskGroupRank,
    closedTaskSort,
    isClosedHistory,
    markClosedHistory,
    clearClosedHistory,
    buildClosedRows,
    mergeClosedRows,
    closedWindowRefetchInterval,
    isOrderableTask,
    TASK_GROUP_OPEN,
    TASK_GROUP_TEMPLATE,
    TASK_GROUP_CLOSED,
} from '../closedTasks';

// req #3506 — the Tasks page's "Closed" title option.
//
// Two things get quietly wrong in a feature shaped like this and neither is
// visible from a rendered card: the window boundary landing in local time rather
// than the UTC `done_ts` is written in, and a closed row drifting above the
// template row after some later re-sort. Both are pinned here.

const NOW = new Date('2026-08-14T12:00:00.000Z');

describe('CLOSED_WINDOWS', () => {
    it('is exactly the three buttons the requirement names, in order', () => {
        expect(CLOSED_WINDOWS.map(w => w.label)).toEqual(['1h', '24h', 'All']);
        expect(CLOSED_WINDOW_VALUES).toEqual(['1h', '24h', 'all']);
    });

    it('recognises its own values and nothing else', () => {
        expect(isClosedWindow('1h')).toBe(true);
        expect(isClosedWindow('24h')).toBe(true);
        expect(isClosedWindow('all')).toBe(true);
        expect(isClosedWindow(null)).toBe(false);
        expect(isClosedWindow(undefined)).toBe(false);
        expect(isClosedWindow('7d')).toBe(false);
    });
});

describe('closedWindowRange', () => {
    it('puts the 1h start exactly one hour back, in UTC', () => {
        const range = closedWindowRange('1h', NOW);
        expect(range.start).toBe('2026-08-14T11:00:00');
    });

    it('puts the 24h start exactly one day back, in UTC', () => {
        const range = closedWindowRange('24h', NOW);
        expect(range.start).toBe('2026-08-13T12:00:00');
    });

    it('ends slightly ahead of now, so a task closed this second is inside its own window', () => {
        const range = closedWindowRange('1h', NOW);
        expect(range.end > '2026-08-14T12:00:00').toBe(true);
    });

    it('emits second-resolution DATETIME text, not an ISO string with millis', () => {
        const range = closedWindowRange('24h', NOW);
        expect(range.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
        expect(range.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    it('has no range for "All" — every closed task qualifies', () => {
        expect(closedWindowRange('all', NOW)).toBeNull();
    });

    it('has no range for the OFF state or an unknown window', () => {
        expect(closedWindowRange(null, NOW)).toBeNull();
        expect(closedWindowRange(undefined, NOW)).toBeNull();
        expect(closedWindowRange('7d', NOW)).toBeNull();
    });
});

describe('taskGroupRank', () => {
    const open = { id: 7, done: 0 };
    const template = { id: '', done: 0 };
    const closed = markClosedHistory({ id: 8, done: 1 });

    it('orders open tasks, then the template row, then closed tasks', () => {
        expect(taskGroupRank(open)).toBe(TASK_GROUP_OPEN);
        expect(taskGroupRank(template)).toBe(TASK_GROUP_TEMPLATE);
        expect(taskGroupRank(closed)).toBe(TASK_GROUP_CLOSED);
        expect(TASK_GROUP_OPEN).toBeLessThan(TASK_GROUP_TEMPLATE);
        expect(TASK_GROUP_TEMPLATE).toBeLessThan(TASK_GROUP_CLOSED);
    });

    it('sorts a whole card into open / template / closed', () => {
        const card = [closed, template, open];
        const sorted = [...card].sort((a, b) => taskGroupRank(a) - taskGroupRank(b));
        expect(sorted).toEqual([open, template, closed]);
    });
});

describe('closedTaskSort', () => {
    it('puts the most recently closed task first', () => {
        const older = { id: 1, done: 1, done_ts: '2026-08-14T09:00:00' };
        const newer = { id: 2, done: 1, done_ts: '2026-08-14T11:30:00' };
        expect([older, newer].sort(closedTaskSort).map(t => t.id)).toEqual([2, 1]);
    });

    it('sorts a missing done_ts last rather than throwing off the order', () => {
        const dated = { id: 1, done: 1, done_ts: '2026-08-14T09:00:00' };
        const undated = { id: 2, done: 1, done_ts: null };
        expect([undated, dated].sort(closedTaskSort).map(t => t.id)).toEqual([1, 2]);
    });

    it('treats equal timestamps as a tie', () => {
        const a = { id: 1, done: 1, done_ts: '2026-08-14T09:00:00' };
        const b = { id: 2, done: 1, done_ts: '2026-08-14T09:00:00' };
        expect(closedTaskSort(a, b)).toBe(0);
    });
});

describe('isClosedHistory / isOrderableTask', () => {
    it('only the live rows are renumbered', () => {
        const rows = [
            { id: 1, done: 0 },
            markClosedHistory({ id: 2, done: 1 }),
            { id: '', done: 0 },
        ];
        expect(rows.filter(isOrderableTask).map(t => t.id)).toEqual([1]);
        expect(rows.filter(isClosedHistory).map(t => t.id)).toEqual([2]);
    });

    // The discriminator is the flag, never `done`. This is what makes the option
    // a genuine no-op when it is OFF: a row the user has just ticked is still
    // live work — it stays above the template row and stays in the sort_order
    // renumbering — until the refetch turns it into history.
    it('a just-ticked row is live work, not history', () => {
        const justTicked = { id: 3, done: 1 };
        expect(isClosedHistory(justTicked)).toBe(false);
        expect(taskGroupRank(justTicked)).toBe(TASK_GROUP_OPEN);
        expect(isOrderableTask(justTicked)).toBe(true);
    });

    it('a template row is the template even if its done box is ticked', () => {
        expect(taskGroupRank({ id: '', done: 1 })).toBe(TASK_GROUP_TEMPLATE);
    });

    it('re-opening a history row returns it to the live group', () => {
        const reopened = clearClosedHistory({ ...markClosedHistory({ id: 4, done: 1 }), done: 0 });
        expect(isClosedHistory(reopened)).toBe(false);
        expect(taskGroupRank(reopened)).toBe(TASK_GROUP_OPEN);
        expect(isOrderableTask(reopened)).toBe(true);
    });
});

describe('buildClosedRows', () => {
    const rows = [
        { id: 8, done: 1, done_ts: '2026-08-14T09:00:00' },
        { id: 9, done: 1, done_ts: '2026-08-14T11:30:00' },
    ];

    it('tags every row as history and orders newest first', () => {
        const built = buildClosedRows(rows, []);
        expect(built.map(t => t.id)).toEqual([9, 8]);
        expect(built.every(isClosedHistory)).toBe(true);
    });

    it('drops ids the open query already returned', () => {
        expect(buildClosedRows(rows, [9]).map(t => t.id)).toEqual([8]);
        expect(buildClosedRows(rows, new Set([8, 9]))).toEqual([]);
    });

    it('copies rather than tagging the cached row in place', () => {
        const source = [{ id: 8, done: 1, done_ts: '2026-08-14T09:00:00' }];
        buildClosedRows(source, []);
        expect(isClosedHistory(source[0])).toBe(false);
    });

    it('is empty when the query has not answered', () => {
        expect(buildClosedRows(undefined, [])).toEqual([]);
    });
});

describe('mergeClosedRows', () => {
    const live = (id) => ({ id, description: `live ${id}`, done: 0 });
    const hist = (id, ts) => markClosedHistory({ id, description: `hist ${id}`, done: 1, done_ts: ts });

    it('swaps the history and leaves the live rows alone', () => {
        const prev = [live(1), live(2), { id: '', done: 0 }, hist(8), hist(9)];
        const next = mergeClosedRows(prev, [hist(7), hist(9)]);
        expect(next.map(t => t.id)).toEqual([1, 2, '', 7, 9]);
    });

    it('never touches a live row it is handed', () => {
        const typing = { id: 1, description: 'half typed', done: 0 };
        const next = mergeClosedRows([typing, hist(8)], [hist(8)]);
        expect(next[0]).toBe(typing);
    });

    it('lets a locally re-opened row win over the same id arriving as history', () => {
        // The user un-ticked 9; the closed query has not caught up. Two rows with
        // one id would collide on React's key and one would be dropped silently.
        const reopened = { id: 9, description: 'hist 9', done: 0 };
        const next = mergeClosedRows([live(1), reopened], [hist(9), hist(8)]);
        expect(next.map(t => t.id)).toEqual([1, 9, 8]);
        expect(next.filter(t => t.id === 9)).toHaveLength(1);
        expect(next.find(t => t.id === 9).done).toBe(0);
    });

    it('keeps the object of a history row it is already showing', () => {
        const edited = { ...hist(8), description: 'edited but not committed' };
        const next = mergeClosedRows([live(1), edited], [hist(8)]);
        expect(next[1]).toBe(edited);
        expect(next[1].description).toBe('edited but not committed');
    });

    it('takes the fresh object for a row it has not shown yet', () => {
        const fresh = hist(7);
        const next = mergeClosedRows([live(1)], [fresh]);
        expect(next[1]).toBe(fresh);
    });

    it('drops the history entirely when handed none', () => {
        expect(mergeClosedRows([live(1), hist(8)], []).map(t => t.id)).toEqual([1]);
    });
});

describe('closedWindowRefetchInterval', () => {
    // A bounded window's lower edge moves with the clock, so it has to be
    // re-asked; 'All' has no edge and must not poll.
    it('polls the bounded windows and nothing else', () => {
        expect(closedWindowRefetchInterval('1h')).toBeGreaterThan(0);
        expect(closedWindowRefetchInterval('24h')).toBeGreaterThan(0);
        expect(closedWindowRefetchInterval('all')).toBe(false);
        expect(closedWindowRefetchInterval(null)).toBe(false);
    });
});
