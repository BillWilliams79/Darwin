// planMoves.js — what a drop on the Plan view MEANS, as pure functions
// (req #3662).
//
// Each resolver takes the lists as they stand plus the drop, and returns the new
// lists AND the one bulk payload that persists them. Nothing here touches React
// state or the network, so every rule the old per-row react-dnd handlers kept
// implicitly — history rows keep their stored position, the template row stays
// below the live rows, a priority-sorted card appends — is a unit test away.
//
// Records are never mutated in place: local arrays are seeded from the query
// cache by shallow copy, so a row object here may BE the cached one.

import { arrayMove } from '@dnd-kit/sortable';
import { isOrderableTask, isClosedHistory } from './closedTasks';

const sameIndex = (from, to) => from === to || from < 0 || to < 0;

// ── Tasks ───────────────────────────────────────────────────────────────────

/**
 * Reorder within one hand-sorted card. Only orderable rows are renumbered —
 * a closed (history) row's stored position survives a live reorder above it.
 * @returns {{tasks: object[], bulk: object[]} | null} null when nothing moved
 */
export function reorderTasksInCard(tasks, fromIndex, toIndex) {
    if (sameIndex(fromIndex, toIndex)) return null;
    const moved = arrayMove(tasks, fromIndex, toIndex);
    const bulk = [];
    const renumbered = moved.map((t, idx) => {
        if (!isOrderableTask(t)) return t;
        bulk.push({ id: t.id, sort_order: idx });
        return { ...t, sort_order: idx };
    });
    return { tasks: renumbered, bulk };
}

/**
 * Move a task into a HAND-sorted card at `insertIndex` among its live rows.
 * The target's live rows are renumbered 0..n; the moved row also carries its
 * new area. Template and history rows are re-appended unchanged.
 */
export function insertTaskIntoHandCard(targetTasks, task, insertIndex, areaId) {
    const area = parseInt(areaId);
    const live = targetTasks.filter(t => isOrderableTask(t) && t.id !== task.id);
    const template = targetTasks.find(t => t.id === '');
    const closed = targetTasks.filter(isClosedHistory);
    const at = Math.max(0, Math.min(insertIndex, live.length));
    live.splice(at, 0, { ...task, area_fk: area });
    const bulk = [];
    const renumbered = live.map((t, idx) => {
        const update = { id: t.id, sort_order: idx };
        if (t.id === task.id) update.area_fk = area;
        bulk.push(update);
        return { ...t, sort_order: idx };
    });
    const tasks = [...renumbered];
    if (template) tasks.push(template);
    tasks.push(...closed);
    return { tasks, bulk };
}

/**
 * Move a task into a card that does not honour a position (priority sort): it
 * takes the next sort_order and the card's own comparator places it.
 */
export function appendTaskToCard(targetTasks, task, areaId, sortRows = (rows) => rows) {
    const area = parseInt(areaId);
    const maxSort = Math.max(0, ...targetTasks.filter(isOrderableTask).map(t => t.sort_order ?? 0));
    const moved = { ...task, area_fk: area, sort_order: maxSort + 1 };
    const tasks = sortRows([...targetTasks.filter(t => t.id !== task.id), moved]);
    return { tasks, bulk: [{ id: task.id, area_fk: area, sort_order: moved.sort_order }] };
}

// ── Priority card ───────────────────────────────────────────────────────────

/** Reorder the priority card's rows; returns the new rows and the LIVE order to persist. */
export function reorderPriorityRows(tasks, fromIndex, toIndex) {
    if (sameIndex(fromIndex, toIndex)) return null;
    const moved = arrayMove(tasks, fromIndex, toIndex);
    return { tasks: moved, live: moved.filter(t => !isClosedHistory(t)) };
}

// ── Area cards ──────────────────────────────────────────────────────────────

const renumberAreas = (areas, extra = () => ({})) => {
    const bulk = [];
    let next = 0;
    const out = areas.map(a => {
        if (a.id === '') return a;
        const sort_order = next++;
        const { _isAdopted, ...clean } = a;
        bulk.push({ id: a.id, sort_order, ...extra(a) });
        return { ...clean, sort_order };
    });
    return { areas: out, bulk };
};

/** Reorder area cards within one domain. */
export function reorderAreas(areas, fromIndex, toIndex) {
    if (sameIndex(fromIndex, toIndex)) return null;
    return renumberAreas(arrayMove(areas, fromIndex, toIndex));
}

/**
 * Move an area card to another domain at `insertIndex` among its real cards.
 * BOTH domains are renumbered, and the result is one bulk payload covering
 * both — a single write, rather than one per side.
 */
export function moveAreaToDomain(sourceAreas, targetAreas, area, insertIndex, domainId) {
    const domain = parseInt(domainId);
    const source = renumberAreas(sourceAreas.filter(a => a.id !== area.id));
    const real = targetAreas.filter(a => a.id !== '' && a.id !== area.id);
    const template = targetAreas.find(a => a.id === '');
    const at = Math.max(0, Math.min(insertIndex, real.length));
    real.splice(at, 0, { ...area, domain_fk: domain });
    const target = renumberAreas(template ? [...real, template] : real,
        (a) => (a.id === area.id ? { domain_fk: domain } : {}));
    return { sourceAreas: source.areas, targetAreas: target.areas, bulk: [...source.bulk, ...target.bulk] };
}

// ── Domain tabs ─────────────────────────────────────────────────────────────

/** Reorder domain tabs; also says where the active tab's domain landed. */
export function reorderDomains(domains, fromIndex, toIndex, activeIndex) {
    if (sameIndex(fromIndex, toIndex)) return null;
    const activeId = domains[activeIndex]?.id;
    const moved = arrayMove(domains, fromIndex, toIndex)
        .map((d, idx) => ({ ...d, sort_order: idx }));
    return {
        domains: moved,
        bulk: moved.map(d => ({ id: d.id, sort_order: d.sort_order })),
        activeIndex: activeId === undefined ? activeIndex : moved.findIndex(d => d.id === activeId),
    };
}

// ── The drag session's view of a list ───────────────────────────────────────
// Shared by every list surface since req #3663 — re-exported under the names
// the Plan view's callers and tests use.

export { withPlacement, removeRecord } from '../dnd/listSession';
