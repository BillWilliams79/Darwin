// closedTasks.js — the pure core of the Tasks page's "Closed" option (req #3506).
//
// Exported separately from the controls and the cards so the rules that are easy
// to get quietly wrong — where the window boundary lands, which rows are history
// rather than work, and where a history row sits in a sorted card — are reachable
// by a unit test rather than only by looking at a rendered page.

// The three buttons, in the order the requirement names them.
// `hours: null` is "All closed", which carries no lower bound at all.
export const CLOSED_WINDOWS = [
    { value: '1h',  label: '1h',  hours: 1 },
    { value: '24h', label: '24h', hours: 24 },
    { value: 'all', label: 'All', hours: null },
];

export const CLOSED_WINDOW_VALUES = CLOSED_WINDOWS.map(w => w.value);

export function isClosedWindow(value) {
    return CLOSED_WINDOW_VALUES.includes(value);
}

// A bounded window's lower edge moves with the clock, so the query behind it has
// to be re-asked or the label stops being true: a card left open for three hours
// on '1h' would be showing a three-hour-old boundary. 'all' has no edge to move,
// so it is not polled. `refetchIntervalInBackground` stays at its default false,
// which keeps this to the tab the user is actually looking at.
export const CLOSED_WINDOW_REFETCH_MS = 60 * 1000;

export function closedWindowRefetchInterval(window) {
    const spec = CLOSED_WINDOWS.find(w => w.value === window);
    return spec && spec.hours !== null ? CLOSED_WINDOW_REFETCH_MS : false;
}

// `filter_ts=(col,START,END)` wants MySQL DATETIME text, and `tasks.done_ts` is
// written by every writer as `new Date().toISOString()` — UTC. So the bounds are
// UTC too, sliced to seconds the way every other range query in this app builds
// them (CalendarFC, useTasksDone).
const toSqlUtc = (date) => date.toISOString().slice(0, 19);

// The END bound sits slightly ahead of `now` so a task closed during the same
// second the query is built is inside its own window. Clock skew between the
// browser and RDS is the same hazard from the other direction, and a minute of
// headroom costs nothing: nothing can be closed in the future by intent.
const END_HEADROOM_MS = 60 * 1000;

/**
 * Resolve a window name to the `{ start, end }` bounds of a `filter_ts` range.
 *
 * Returns `null` for 'all' (no range — every closed task qualifies) and for any
 * value that is not a bounded window, including the OFF state. A caller that
 * gets `null` must decide between "no filter" and "no query" from the window
 * name itself; `useTasksClosed` does exactly that.
 *
 * @param window  '1h' | '24h' | 'all' | null
 * @param now     Date — injectable so tests do not depend on wall-clock time
 */
export function closedWindowRange(window, now = new Date()) {
    const spec = CLOSED_WINDOWS.find(w => w.value === window);
    if (!spec || spec.hours === null) return null;

    const end = new Date(now.getTime() + END_HEADROOM_MS);
    const start = new Date(now.getTime() - spec.hours * 60 * 60 * 1000);
    return { start: toSqlUtc(start), end: toSqlUtc(end) };
}

// ── History vs work ─────────────────────────────────────────────────────────
//
// THE DISCRIMINATOR IS THE FLAG, NEVER `done`. A row is closed HISTORY only if
// it arrived from the closed query, which is what `markClosedHistory` stamps.
//
// This distinction is the whole reason the option is a no-op when it is OFF.
// `done` is truthy for two quite different rows: a history row, and an open row
// the user has just ticked, which every card deliberately leaves in place with a
// strikethrough until the refetch lands. Grouping on `done` moved that
// just-ticked row below the "add new task" row on the next re-sort, and dropped
// it out of the `sort_order` renumbering so the next saved task collided with
// its stored value — both with the option switched off entirely.
const CLOSED_HISTORY_FLAG = '_closedHistory';

export function isClosedHistory(task) {
    return Boolean(task && task[CLOSED_HISTORY_FLAG]);
}

export function markClosedHistory(task) {
    return { ...task, [CLOSED_HISTORY_FLAG]: true };
}

// Re-opening a history row makes it live work again: it rejoins the open group,
// is renumbered with the rest, and becomes draggable. Clearing the flag is what
// says so, and a card that re-opens a row must re-sort so its position matches
// the group it now belongs to — an index-based callback addresses rows by their
// place in the array.
export function clearClosedHistory(task) {
    return { ...task, [CLOSED_HISTORY_FLAG]: false };
}

// Where a row sits in a card. History rows go BELOW the "add new task" template
// row: the template is the card's live edge and has to stay reachable without
// scrolling past a history list, however long that list gets.
//
// This is the one rule the cards' comparators open with, so it holds for
// priority sort, hand sort, and every re-sort that follows a mutation.
export const TASK_GROUP_OPEN = 0;
export const TASK_GROUP_TEMPLATE = 1;
export const TASK_GROUP_CLOSED = 2;

export function taskGroupRank(task) {
    if (isClosedHistory(task)) return TASK_GROUP_CLOSED;
    if (task.id === '') return TASK_GROUP_TEMPLATE;
    return TASK_GROUP_OPEN;
}

// Within the closed group: most recently closed first, so the top of the list is
// what "closed in the last hour" is actually about. A missing `done_ts` sorts
// last rather than throwing off the comparison — rows predating the column exist.
export function closedTaskSort(taskA, taskB) {
    const a = taskA.done_ts || '';
    const b = taskB.done_ts || '';
    if (a === b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a < b ? 1 : -1;
}

// The rows a `sort_order` renumbering pass owns — real, live tasks. Excludes the
// template row (no id yet) and every history row, whose stored position is a
// fact about when it was closed and must survive a reorder above it.
export function isOrderableTask(task) {
    return task.id !== '' && !isClosedHistory(task);
}

/**
 * The history rows a card should render, ready to append.
 *
 * Deduped against the ids the OPEN query already returned: ticking a task done
 * mutates the open row in place before the refetch lands, so for one render the
 * same id can be in both result sets. Two rows with one id would collide on
 * React's key and draw the task twice; the open copy wins because it is the one
 * the index-based callbacks address.
 *
 * Every row is COPIED, not just tagged in place — the source objects belong to
 * the TanStack cache, and the cards mutate rows in place on a priority/done
 * click. Without the copy that click writes through into the cache entry.
 */
export function buildClosedRows(serverClosedTasks, openIds) {
    if (!serverClosedTasks) return [];
    const exclude = openIds instanceof Set ? openIds : new Set(openIds || []);
    return serverClosedTasks
        .filter(t => !exclude.has(t.id))
        .sort(closedTaskSort)
        .map(markClosedHistory);
}

/**
 * Swap a card's history for a freshly fetched one, touching nothing else.
 *
 * This is what a card does when ONLY the closed window moved — its own poll, or
 * a row ageing out of '1h'. Rebuilding the card from the server on that cadence
 * would throw away whatever the user is in the middle of, once a minute.
 *
 * Three rules, and each one is a defect this closed:
 *
 *  - LIVE ROWS ARE NEVER TOUCHED. They carry unsaved text and local reorders
 *    that the open query has not answered for yet.
 *  - A row that is LIVE HERE WINS over the same id arriving as history. A task
 *    the user just re-opened is live locally while the closed query — whose poll
 *    can land inside the PUT's flight, or outlive a PUT that failed — still
 *    reports it closed. Without this it comes back struck through beside itself
 *    and the two collide on React's key, which React resolves by silently
 *    dropping one.
 *  - AN ALREADY-RENDERED HISTORY ROW KEEPS ITS OBJECT. Replacing it wholesale
 *    would discard an edit typed into it and not yet committed, which is the
 *    same loss the first rule exists to prevent. A closed row's server fields do
 *    not change underneath it, so keeping the local copy costs nothing; the next
 *    full rebuild re-syncs it anyway.
 */
export function mergeClosedRows(prev, closedRows) {
    const rows = prev || [];
    const live = rows.filter(t => !isClosedHistory(t));
    const liveIds = new Set(live.map(t => t.id));
    const alreadyShown = new Map(rows.filter(isClosedHistory).map(t => [t.id, t]));
    const history = (closedRows || [])
        .filter(t => !liveIds.has(t.id))
        .map(t => alreadyShown.get(t.id) || t);
    return [...live, ...history];
}
